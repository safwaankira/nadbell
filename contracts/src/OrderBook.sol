// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OrderBook
/// @notice Fully onchain limit-order book for one mock stock against USDC. Trades 24/7.
/// @dev - Price-time priority: best price first, FIFO within a price level.
///      - Fills happen at the resting (maker) price; a buyer who bid higher is refunded the difference.
///      - All funds are escrowed in this contract while an order rests; cancel returns them.
///      - At most MAX_FILLS fills per call so gas stays bounded (Monad charges the gas limit).
///        If the cap is hit while the order still crosses, the leftover is refunded instead of resting,
///        so the book can never be left crossed.
///      Units: price in cents per share, size in lots (1 lot = 0.01 share = 1e16 base units).
contract OrderBook is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant LOT = 1e16;
    uint256 public constant MAX_FILLS = 20;
    uint256 public constant MAX_WALK = 64;
    uint256 public constant RING = 64;
    uint8 internal constant BID = 0;
    uint8 internal constant ASK = 1;

    IERC20 public immutable base; // stock token, 18 decimals
    IERC20 public immutable quote; // USDC, 6 decimals

    struct Order {
        address owner;
        uint32 price;
        bool isBuy;
        uint64 lots;
        uint64 prev;
        uint64 next;
    }

    struct Level {
        uint64 head;
        uint64 tail;
        uint128 lots;
        uint32 better; // next level toward the top of book
        uint32 worse; // next level away from the top of book
    }

    struct Trade {
        uint32 price;
        uint64 lots;
        uint40 time;
        bool takerBuy;
    }

    mapping(uint64 => Order) public orders;
    mapping(uint8 => mapping(uint32 => Level)) public levels;
    uint32[2] public best; // [bestBid, bestAsk]; 0 = empty side
    uint64 public nextOrderId = 1;

    Trade[64] internal _trades;
    uint64 public tradeCount;
    uint32 public lastPrice;

    event OrderPlaced(uint64 indexed id, address indexed owner, bool isBuy, uint32 price, uint64 lots);
    event OrderCancelled(uint64 indexed id, address indexed owner, uint64 lotsLeft);
    event Fill(
        uint64 indexed makerId,
        address indexed maker,
        address indexed taker,
        bool takerBuy,
        uint32 price,
        uint64 lots
    );
    event LeftoverRefunded(address indexed taker, uint64 lots);

    error BadParams();
    error NotOwner();
    error NoOrder();
    error BookTooDeep();

    constructor(IERC20 base_, IERC20 quote_) {
        base = base_;
        quote = quote_;
    }

    // ---------------------------------------------------------------- trading

    /// @notice Place a limit order. Crosses what it can, rests the rest.
    /// @return id resting order id (0 if nothing rested)
    /// @return filledLots lots filled immediately
    function placeLimit(bool isBuy, uint32 price, uint64 lots)
        external
        nonReentrant
        returns (uint64 id, uint64 filledLots)
    {
        return _place(isBuy, price, lots, true);
    }

    /// @notice Immediate-or-cancel: fill what crosses up to `price`, refund the rest. Never rests.
    ///         This is the "Buy $50" / "Sell all" button: a market order with a price limit.
    function placeIOC(bool isBuy, uint32 price, uint64 lots) external nonReentrant returns (uint64 filledLots) {
        (, filledLots) = _place(isBuy, price, lots, false);
    }

    function _place(bool isBuy, uint32 price, uint64 lots, bool rest) internal returns (uint64 id, uint64 filledLots) {
        if (price == 0 || lots == 0 || lots > 1e12) revert BadParams();

        if (isBuy) quote.safeTransferFrom(msg.sender, address(this), _quoteFor(price, lots));
        else base.safeTransferFrom(msg.sender, address(this), uint256(lots) * LOT);

        uint64 remaining = lots;
        uint8 opp = isBuy ? ASK : BID;
        uint256 fills;

        while (remaining > 0 && fills < MAX_FILLS) {
            uint32 top = best[opp];
            if (top == 0) break;
            if (isBuy ? top > price : top < price) break;
            remaining -= _fillTop(opp, isBuy, price, top, remaining);
            fills++;
        }

        filledLots = lots - remaining;
        if (remaining == 0) return (0, filledLots);

        uint32 topNow = best[opp];
        bool stillCrosses = topNow != 0 && (isBuy ? topNow <= price : topNow >= price);
        if (stillCrosses || !rest) {
            // Fill cap reached. Refund instead of resting a crossed order.
            if (isBuy) quote.safeTransfer(msg.sender, _quoteFor(price, remaining));
            else base.safeTransfer(msg.sender, uint256(remaining) * LOT);
            emit LeftoverRefunded(msg.sender, remaining);
            return (0, filledLots);
        }

        id = _rest(isBuy, price, remaining);
    }

    function cancel(uint64 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.lots == 0) revert NoOrder();
        if (o.owner != msg.sender) revert NotOwner();
        uint64 left = o.lots;
        bool isBuy = o.isBuy;
        uint32 price = o.price;
        uint8 side = isBuy ? BID : ASK;

        levels[side][price].lots -= left;
        _unlinkOrder(side, price, id);

        if (isBuy) quote.safeTransfer(msg.sender, _quoteFor(price, left));
        else base.safeTransfer(msg.sender, uint256(left) * LOT);
        emit OrderCancelled(id, msg.sender, left);
    }

    // ---------------------------------------------------------------- views

    function bestBid() external view returns (uint32) {
        return best[BID];
    }

    function bestAsk() external view returns (uint32) {
        return best[ASK];
    }

    /// @notice Top `n` price levels on one side, best first.
    function depth(bool isBuy, uint256 n) external view returns (uint32[] memory prices, uint128[] memory lots) {
        uint8 side = isBuy ? BID : ASK;
        uint256 count;
        for (uint32 p = best[side]; p != 0 && count < n; p = levels[side][p].worse) count++;
        prices = new uint32[](count);
        lots = new uint128[](count);
        uint32 q = best[side];
        for (uint256 i; i < count; i++) {
            prices[i] = q;
            lots[i] = levels[side][q].lots;
            q = levels[side][q].worse;
        }
    }

    /// @notice Most recent trades, newest first (max 64).
    function recentTrades(uint256 n) external view returns (Trade[] memory out) {
        uint256 have = tradeCount < RING ? tradeCount : RING;
        if (n > have) n = have;
        out = new Trade[](n);
        for (uint256 i; i < n; i++) {
            out[i] = _trades[(tradeCount - 1 - i) % RING];
        }
    }

    /// @notice Open orders of `owner` among the last `scan` order ids.
    function openOrdersOf(address owner, uint256 scan)
        external
        view
        returns (uint64[] memory ids, Order[] memory list)
    {
        uint64 hi = nextOrderId - 1;
        uint64 lo = scan >= hi ? 1 : hi - uint64(scan) + 1;
        uint256 count;
        for (uint64 i = hi; i >= lo && i > 0; i--) {
            if (orders[i].owner == owner && orders[i].lots > 0) count++;
        }
        ids = new uint64[](count);
        list = new Order[](count);
        uint256 k;
        for (uint64 i = hi; i >= lo && i > 0; i--) {
            if (orders[i].owner == owner && orders[i].lots > 0) {
                ids[k] = i;
                list[k] = orders[i];
                k++;
            }
        }
    }

    // ---------------------------------------------------------------- internals

    function _quoteFor(uint32 cents, uint64 lots) internal pure returns (uint256) {
        return uint256(cents) * lots * 100;
    }

    /// @dev Fill against the head order of the best opposite level. Returns lots filled.
    function _fillTop(uint8 opp, bool isBuy, uint32 limit, uint32 top, uint64 want) internal returns (uint64 f) {
        Level storage lvl = levels[opp][top];
        uint64 makerId = lvl.head;
        Order storage m = orders[makerId];
        f = want < m.lots ? want : m.lots;
        m.lots -= f;
        lvl.lots -= f;
        address maker = m.owner;

        if (isBuy) {
            quote.safeTransfer(maker, _quoteFor(top, f));
            base.safeTransfer(msg.sender, uint256(f) * LOT);
            if (limit > top) quote.safeTransfer(msg.sender, _quoteFor(limit - top, f));
        } else {
            base.safeTransfer(maker, uint256(f) * LOT);
            quote.safeTransfer(msg.sender, _quoteFor(top, f));
        }

        _recordTrade(top, f, isBuy);
        emit Fill(makerId, maker, msg.sender, isBuy, top, f);
        if (m.lots == 0) _unlinkOrder(opp, top, makerId);
    }

    function _recordTrade(uint32 price, uint64 lots, bool takerBuy) internal {
        _trades[tradeCount % RING] = Trade(price, lots, uint40(block.timestamp), takerBuy);
        tradeCount++;
        lastPrice = price;
    }

    function _isBetter(uint8 side, uint32 a, uint32 b) internal pure returns (bool) {
        return side == BID ? a > b : a < b;
    }

    function _rest(bool isBuy, uint32 price, uint64 lots) internal returns (uint64 id) {
        uint8 side = isBuy ? BID : ASK;
        id = nextOrderId++;
        Level storage lvl = levels[side][price];

        if (lvl.head == 0) _insertLevel(side, price);

        orders[id] = Order(msg.sender, price, isBuy, lots, lvl.tail, 0);
        if (lvl.tail != 0) orders[lvl.tail].next = id;
        else lvl.head = id;
        lvl.tail = id;
        lvl.lots += lots;

        emit OrderPlaced(id, msg.sender, isBuy, price, lots);
    }

    function _insertLevel(uint8 side, uint32 price) internal {
        uint32 top = best[side];
        if (top == 0) {
            best[side] = price;
            return;
        }
        if (_isBetter(side, price, top)) {
            levels[side][price].worse = top;
            levels[side][top].better = price;
            best[side] = price;
            return;
        }
        uint32 cur = top;
        uint256 walked;
        while (true) {
            uint32 w = levels[side][cur].worse;
            if (w == 0 || _isBetter(side, price, w)) break;
            cur = w;
            if (++walked > MAX_WALK) revert BookTooDeep();
        }
        uint32 after_ = levels[side][cur].worse;
        levels[side][price].better = cur;
        levels[side][price].worse = after_;
        levels[side][cur].worse = price;
        if (after_ != 0) levels[side][after_].better = price;
    }

    function _removeLevel(uint8 side, uint32 price) internal {
        Level storage lvl = levels[side][price];
        uint32 b = lvl.better;
        uint32 w = lvl.worse;
        if (b != 0) levels[side][b].worse = w;
        else best[side] = w;
        if (w != 0) levels[side][w].better = b;
        delete levels[side][price];
    }

    function _unlinkOrder(uint8 side, uint32 price, uint64 id) internal {
        Order storage o = orders[id];
        Level storage lvl = levels[side][price];
        if (o.prev != 0) orders[o.prev].next = o.next;
        else lvl.head = o.next;
        if (o.next != 0) orders[o.next].prev = o.prev;
        else lvl.tail = o.prev;
        o.lots = 0;
        o.prev = 0;
        o.next = 0;
        if (lvl.head == 0) _removeLevel(side, price);
    }
}
