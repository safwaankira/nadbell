// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

interface IReopenListener {
    function onReopen(uint64 sessionId, uint32 closeCents, uint32 openCents) external;
}

/// @title PriceGate
/// @notice The official price of one stock and whether its market is open.
///         Open + recent price  -> primary mint/redeem allowed.
///         Closed               -> the last price stays frozen as the "close"; only the order book trades.
/// @dev A keeper pushes the price during regular hours and calls close() after the bell. Each close
///      starts a new closed session; the first push after it is that session's reopening print, which
///      is passed to an optional listener (Call the Open) so calls can be scored against it.
///      Prices can also come from Pyth pull updates when a feed is available.
contract PriceGate is Ownable {
    uint8 public constant SOURCE_NONE = 0;
    uint8 public constant SOURCE_KEEPER = 1;
    uint8 public constant SOURCE_PYTH = 2;

    IPyth public immutable pyth;
    bytes32 public immutable feedId;

    address public keeper;
    IReopenListener public listener;
    string public sourceLabel;

    uint32 public maxAge;
    uint32 public maxMoveBps = 1_500; // reject a single push more than 15% away

    uint32 public priceCents;
    uint64 public publishTime;
    uint8 public source;

    bool public marketOpen;
    uint64 public sessionId; // number of closes so far; the current closed session while closed
    uint32 public closeCents;
    uint64 public closedAt;

    event Print(uint32 priceCents, uint64 publishTime, uint8 source);
    event Closed(uint64 indexed sessionId, uint32 closeCents, uint64 closedAt);
    event Reopened(uint64 indexed sessionId, uint32 closeCents, uint32 openCents, uint64 openedAt);
    event KeeperSet(address keeper);
    event ListenerSet(address listener);
    event ConfigSet(uint32 maxAge, uint32 maxMoveBps, string sourceLabel);
    event ListenerFailed(uint64 indexed sessionId);

    error NotKeeper();
    error NoPyth();
    error BadPrice();
    error WideConfidence();
    error OldUpdate();
    error TooFarMove();
    error AlreadyClosed();

    constructor(IPyth pyth_, bytes32 feedId_, uint32 maxAge_, string memory sourceLabel_, address owner_)
        Ownable(owner_)
    {
        pyth = pyth_;
        feedId = feedId_;
        maxAge = maxAge_;
        sourceLabel = sourceLabel_;
        keeper = owner_;
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    // ---------------------------------------------------------------- admin

    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    function setListener(IReopenListener l) external onlyOwner {
        listener = l;
        emit ListenerSet(address(l));
    }

    function setConfig(uint32 maxAge_, uint32 maxMoveBps_, string calldata label) external onlyOwner {
        maxAge = maxAge_;
        maxMoveBps = maxMoveBps_;
        sourceLabel = label;
        emit ConfigSet(maxAge_, maxMoveBps_, label);
    }

    // ---------------------------------------------------------------- views

    /// @notice True while the market is open and the last print is younger than maxAge.
    function isFresh() public view returns (bool) {
        return marketOpen && block.timestamp <= uint256(publishTime) + maxAge;
    }

    function latest() external view returns (uint32 cents, uint64 time, uint8 src, bool fresh) {
        return (priceCents, publishTime, source, isFresh());
    }

    // ---------------------------------------------------------------- keeper

    /// @notice Keeper pushes the current official price. Opens the market if it was closed.
    function push(uint32 cents) external onlyKeeper {
        _store(cents, uint64(block.timestamp), SOURCE_KEEPER, false);
    }

    /// @notice Owner-only emergency push that skips the move check (e.g. after a stock split).
    function forcePush(uint32 cents) external onlyOwner {
        _store(cents, uint64(block.timestamp), SOURCE_KEEPER, true);
    }

    /// @notice Keeper rings the closing bell. The current price becomes the frozen close.
    function close() external onlyKeeper {
        if (!marketOpen) revert AlreadyClosed();
        marketOpen = false;
        sessionId++;
        closeCents = priceCents;
        closedAt = uint64(block.timestamp);
        emit Closed(sessionId, priceCents, closedAt);
    }

    /// @notice Push a Pyth update (anyone; pays the Pyth fee, excess refunded).
    function pushPyth(bytes[] calldata updateData) external payable {
        if (address(pyth) == address(0)) revert NoPyth();
        uint256 fee = pyth.getUpdateFee(updateData);
        pyth.updatePriceFeeds{value: fee}(updateData);
        PythStructs.Price memory p = pyth.getPriceUnsafe(feedId);
        if (p.price <= 0) revert BadPrice();
        if (uint256(p.conf) * 100 >= uint256(uint64(p.price))) revert WideConfidence();
        if (p.publishTime < publishTime) revert OldUpdate();
        _store(_toCents(p.price, p.expo), uint64(p.publishTime), SOURCE_PYTH, false);
        if (msg.value > fee) {
            (bool ok,) = msg.sender.call{value: msg.value - fee}("");
            require(ok, "refund");
        }
    }

    // ---------------------------------------------------------------- internals

    function _store(uint32 cents, uint64 time, uint8 src, bool force) internal {
        if (cents == 0) revert BadPrice();
        if (!force && priceCents != 0) {
            uint256 diff = cents > priceCents ? cents - priceCents : priceCents - cents;
            if (diff * 10_000 > uint256(priceCents) * maxMoveBps) revert TooFarMove();
        }
        bool reopening = !marketOpen;
        priceCents = cents;
        publishTime = time;
        source = src;
        marketOpen = true;
        emit Print(cents, time, src);

        if (reopening && sessionId > 0) {
            emit Reopened(sessionId, closeCents, cents, time);
            if (address(listener) != address(0)) {
                // A broken listener must never stop the market from reopening.
                try listener.onReopen(sessionId, closeCents, cents) {}
                catch {
                    emit ListenerFailed(sessionId);
                }
            }
        }
    }

    /// @dev price * 10^expo dollars -> cents, rounded down.
    function _toCents(int64 price, int32 expo) internal pure returns (uint32) {
        int256 e = int256(expo) + 2;
        uint256 v = uint256(uint64(price));
        if (e >= 0) v = v * (10 ** uint256(e));
        else v = v / (10 ** uint256(-e));
        if (v == 0 || v > type(uint32).max) revert BadPrice();
        return uint32(v);
    }
}
