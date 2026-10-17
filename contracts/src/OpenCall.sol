// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PriceGate, IReopenListener} from "./PriceGate.sol";
import {OrderBook} from "./OrderBook.sol";

/// @title OpenCall ("Call the Open")
/// @notice While the market is closed, anyone can call where the stock will reopen. Free, no stakes.
///         When the keeper posts the reopening print, the session is settled: the frozen close, the
///         order book's last weekend trade and the real open are recorded so every call can be scored.
/// @dev Scoring is done in views / the frontend (|call - open| / open), so settling costs one write.
contract OpenCall is IReopenListener {
    uint256 public constant MAX_CALLS = 1_000;

    PriceGate public immutable gate;
    OrderBook public immutable book;

    struct Result {
        uint32 closeCents; // frozen close
        uint32 bookCents; // last order-book trade during the closed session (0 = none)
        uint32 openCents; // reopening print
        uint40 settledAt;
    }

    mapping(uint64 => address[]) internal _players;
    mapping(uint64 => mapping(address => uint32)) public callOf;
    mapping(uint64 => Result) public results;

    event Called(uint64 indexed sessionId, address indexed player, uint32 cents);
    event Settled(uint64 indexed sessionId, uint32 closeCents, uint32 bookCents, uint32 openCents, uint256 players);

    error MarketOpen();
    error BadCall();
    error Full();
    error OnlyGate();

    constructor(PriceGate gate_, OrderBook book_) {
        gate = gate_;
        book = book_;
    }

    /// @notice Call (or change) your reopening price for the current closed session.
    function callOpen(uint32 cents) external {
        if (gate.marketOpen() || gate.sessionId() == 0) revert MarketOpen();
        uint32 ref = gate.closeCents();
        // Keep calls within 0.5x..2x of the close so typos don't skew the board.
        if (cents == 0 || cents < ref / 2 || cents > uint256(ref) * 2) revert BadCall();
        uint64 sid = gate.sessionId();
        if (callOf[sid][msg.sender] == 0) {
            if (_players[sid].length >= MAX_CALLS) revert Full();
            _players[sid].push(msg.sender);
        }
        callOf[sid][msg.sender] = cents;
        emit Called(sid, msg.sender, cents);
    }

    function onReopen(uint64 sid, uint32 closeCents, uint32 openCents) external {
        if (msg.sender != address(gate)) revert OnlyGate();
        uint32 bookCents;
        OrderBook.Trade[] memory t = book.recentTrades(1);
        if (t.length == 1 && t[0].time >= gate.closedAt()) bookCents = t[0].price;
        results[sid] = Result(closeCents, bookCents, openCents, uint40(block.timestamp));
        emit Settled(sid, closeCents, bookCents, openCents, _players[sid].length);
    }

    // ---------------------------------------------------------------- views

    function playerCount(uint64 sid) external view returns (uint256) {
        return _players[sid].length;
    }

    /// @notice All calls for a session.
    function calls(uint64 sid) external view returns (address[] memory players, uint32[] memory cents) {
        players = _players[sid];
        cents = new uint32[](players.length);
        for (uint256 i; i < players.length; i++) cents[i] = callOf[sid][players[i]];
    }

    /// @notice Error of a call vs the open, in basis points (0 if unsettled or no call).
    function errorBps(uint64 sid, address player) external view returns (uint256) {
        Result memory r = results[sid];
        uint32 c = callOf[sid][player];
        if (r.openCents == 0 || c == 0) return 0;
        uint256 d = c > r.openCents ? c - r.openCents : r.openCents - c;
        return (d * 10_000) / r.openCents;
    }
}
