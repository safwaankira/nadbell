// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {StockToken} from "../src/StockToken.sol";
import {PriceGate} from "../src/PriceGate.sol";
import {Vault} from "../src/Vault.sol";
import {OrderBook} from "../src/OrderBook.sol";
import {OpenCall} from "../src/OpenCall.sol";
import {IReopenListener} from "../src/PriceGate.sol";

contract RevertingListener is IReopenListener {
    function onReopen(uint64, uint32, uint32) external pure {
        revert("boom");
    }
}

contract NadbellTest is Test {
    MockUSDC usdc;
    StockToken stock;
    PriceGate gate;
    Vault vault;
    OrderBook book;
    OpenCall openCall;
    MockPyth pyth;

    bytes32 constant FEED = bytes32(uint256(0xAA));
    address owner = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    uint256 constant LOT = 1e16;

    function setUp() public {
        vm.warp(1_760_000_000);
        pyth = new MockPyth(60, 1);
        usdc = new MockUSDC(owner);
        stock = new StockToken("Nadbell Mock AAPL", "tAAPL", owner);
        gate = new PriceGate(IPyth(address(pyth)), FEED, 120, "test feed", owner);
        vault = new Vault(usdc, stock, gate);
        stock.setVault(address(vault));
        book = new OrderBook(stock, usdc);
        openCall = new OpenCall(gate, book);
        gate.setListener(openCall);

        gate.push(22300); // $223.00, market opens
        address[3] memory who = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            vm.startPrank(who[i]);
            for (uint256 k; k < 10; k++) usdc.faucet(); // $50k each
            usdc.approve(address(vault), type(uint256).max);
            usdc.approve(address(book), type(uint256).max);
            stock.approve(address(book), type(uint256).max);
            vault.mint(10_000); // 100 shares
            vm.stopPrank();
        }
    }

    // ------------------------------------------------------------- vault + gate

    function test_MintPricesAtPrintPlusFee() public {
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.mint(100); // 1 share
        // $223.00 + 0.5% = $224.115
        assertEq(before - usdc.balanceOf(alice), 224_115_000);
        assertEq(stock.balanceOf(alice), 101e18);
    }

    function test_MintRejectedWhenPrintIsStale() public {
        vm.warp(block.timestamp + 121);
        assertFalse(gate.isFresh());
        vm.prank(alice);
        vm.expectRevert(Vault.MarketClosed.selector);
        vault.mint(100);
        vm.prank(alice);
        vm.expectRevert(Vault.MarketClosed.selector);
        vault.redeem(100);
    }

    function test_BookStillTradesWhenPrintIsStale() public {
        vm.warp(block.timestamp + 3 days);
        vm.prank(alice);
        book.placeLimit(false, 23000, 200);
        vm.prank(bob);
        (, uint64 filled) = book.placeLimit(true, 23000, 200);
        assertEq(filled, 200);
        assertEq(book.lastPrice(), 23000);
    }

    function test_RedeemAndBacking() public {
        (uint256 held, uint256 owed, uint256 ratio) = vault.backing();
        assertEq(owed, 300 * 223e6); // 300 shares at $223
        assertGt(held, owed); // fees stay in the vault
        assertGt(ratio, 10_000);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(100);
        assertEq(usdc.balanceOf(alice) - before, 223e6 - 1_115_000);
        assertEq(stock.balanceOf(alice), 99e18);
    }

    function test_PythPushConvertsAndChecksConfidence() public {
        bytes[] memory upd = new bytes[](1);
        upd[0] = pyth.createPriceFeedUpdateData(FEED, 22_812_345, 10_000, -5, 22_812_345, 10_000, uint64(block.timestamp), 0);
        gate.pushPyth{value: 1}(upd);
        assertEq(gate.priceCents(), 22812); // $228.12345 -> 22812 cents
        assertEq(gate.source(), 2);
        assertTrue(gate.isFresh());

        upd[0] = pyth.createPriceFeedUpdateData(FEED, 22_812_345, 300_000, -5, 22_812_345, 300_000, uint64(block.timestamp + 1), 0);
        vm.warp(block.timestamp + 1);
        vm.expectRevert(PriceGate.WideConfidence.selector);
        gate.pushPyth{value: 1}(upd);
    }

    function test_PythRefundsExcessFee() public {
        bytes[] memory upd = new bytes[](1);
        upd[0] = pyth.createPriceFeedUpdateData(FEED, 22_300_000, 1_000, -5, 22_300_000, 1_000, uint64(block.timestamp), 0);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        gate.pushPyth{value: 1 ether}(upd);
        assertEq(alice.balance, 1 ether - 1);
    }

    function test_OnlyKeeperPushes() public {
        vm.prank(alice);
        vm.expectRevert();
        gate.push(22301);
    }

    // ------------------------------------------------------------- token

    function test_OnlyVaultMints() public {
        vm.expectRevert(StockToken.NotVault.selector);
        stock.mint(alice, 1);
    }

    function test_MultiplierChangesDisplayNotRawBalance() public {
        stock.setUIMultiplier(1.005e18, block.timestamp + 1 days);
        assertEq(stock.uiMultiplier(), 1e18);
        assertEq(stock.balanceOfUI(alice), 100e18);
        vm.warp(block.timestamp + 1 days);
        assertEq(stock.uiMultiplier(), 1.005e18);
        assertEq(stock.balanceOf(alice), 100e18);
        assertEq(stock.balanceOfUI(alice), 100.5e18);
    }

    function test_PauseAndBlocklist() public {
        stock.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(StockToken.TransfersPaused.selector);
        stock.transfer(bob, 1);
        stock.setPaused(false);
        stock.setBlocked(bob, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StockToken.AccountBlocked.selector, bob));
        stock.transfer(bob, 1);
    }

    // ------------------------------------------------------------- book

    function test_RestsWhenNoCross() public {
        vm.prank(alice);
        (uint64 id, uint64 filled) = book.placeLimit(true, 22200, 150);
        assertEq(id, 1);
        assertEq(filled, 0);
        assertEq(book.bestBid(), 22200);
        assertEq(usdc.balanceOf(address(book)), 22200 * 150 * 100);
    }

    function test_FillsAtMakerPriceAndRefundsBuyer() public {
        vm.prank(alice);
        book.placeLimit(false, 22320, 200);
        uint256 usdcBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        (uint64 id, uint64 filled) = book.placeLimit(true, 22500, 200); // bids higher
        assertEq(id, 0);
        assertEq(filled, 200);
        assertEq(usdcBefore - usdc.balanceOf(bob), 22320 * 200 * 100); // paid maker price only
        assertEq(stock.balanceOf(bob), 102e18);
        assertEq(usdc.balanceOf(address(book)), 0);
        assertEq(stock.balanceOf(address(book)), 0);
    }

    function test_PartialFillRestsRemainder() public {
        vm.prank(alice);
        book.placeLimit(false, 22320, 100);
        vm.prank(bob);
        (uint64 id, uint64 filled) = book.placeLimit(true, 22320, 250);
        assertEq(filled, 100);
        assertGt(id, 0);
        assertEq(book.bestBid(), 22320);
        assertEq(book.bestAsk(), 0);
    }

    function test_PriceThenTimePriority() public {
        vm.prank(alice);
        book.placeLimit(false, 22400, 100); // id1 worse price
        vm.prank(bob);
        book.placeLimit(false, 22300, 100); // id2 best price, first in time
        vm.prank(carol);
        book.placeLimit(false, 22300, 100); // id3 best price, second in time

        vm.prank(alice);
        book.placeLimit(true, 22400, 150);
        // bob filled fully, carol 50, alice's own ask untouched
        (,,, uint64 bobLeft,,) = _order(2);
        (,,, uint64 carolLeft,,) = _order(3);
        assertEq(bobLeft, 0);
        assertEq(carolLeft, 50);
        (,,, uint64 aliceAskLeft,,) = _order(1);
        assertEq(aliceAskLeft, 100);
        assertEq(book.bestAsk(), 22300);
    }

    function test_CancelReturnsEscrow() public {
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        (uint64 id,) = book.placeLimit(true, 22000, 500);
        vm.prank(bob);
        vm.expectRevert(OrderBook.NotOwner.selector);
        book.cancel(id);
        vm.prank(alice);
        book.cancel(id);
        assertEq(usdc.balanceOf(alice), before);
        assertEq(book.bestBid(), 0);
        vm.prank(alice);
        vm.expectRevert(OrderBook.NoOrder.selector);
        book.cancel(id);
    }

    function test_SelfTradeIsValueNeutral() public {
        uint256 u0 = usdc.balanceOf(alice);
        uint256 s0 = stock.balanceOf(alice);
        vm.startPrank(alice);
        book.placeLimit(false, 22310, 500);
        book.placeLimit(true, 22310, 500);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), u0);
        assertEq(stock.balanceOf(alice), s0);
    }

    function test_FillCapRefundsLeftoverAndNeverCrosses() public {
        vm.startPrank(alice);
        for (uint256 i; i < 25; i++) book.placeLimit(false, uint32(22300 + i), 1);
        vm.stopPrank();
        uint256 before = usdc.balanceOf(bob);
        vm.prank(bob);
        (uint64 id, uint64 filled) = book.placeLimit(true, 23000, 100);
        assertEq(filled, 20);
        assertEq(id, 0); // leftover refunded, not rested
        assertEq(book.bestAsk(), 22320);
        assertEq(book.bestBid(), 0);
        uint256 spent = before - usdc.balanceOf(bob);
        uint256 expected;
        for (uint256 i; i < 20; i++) expected += (22300 + i) * 100;
        assertEq(spent, expected);
    }

    function test_DepthAndTrades() public {
        vm.startPrank(alice);
        book.placeLimit(true, 22000, 100);
        book.placeLimit(true, 22200, 100);
        book.placeLimit(true, 22100, 100);
        book.placeLimit(false, 22500, 100);
        book.placeLimit(false, 22400, 100);
        vm.stopPrank();
        (uint32[] memory bp,) = book.depth(true, 10);
        assertEq(bp.length, 3);
        assertEq(bp[0], 22200);
        assertEq(bp[1], 22100);
        assertEq(bp[2], 22000);
        (uint32[] memory ap,) = book.depth(false, 1);
        assertEq(ap.length, 1);
        assertEq(ap[0], 22400);

        vm.prank(bob);
        book.placeLimit(false, 22100, 150);
        OrderBook.Trade[] memory t = book.recentTrades(10);
        assertEq(t.length, 2);
        assertEq(t[0].price, 22100); // newest first
        assertEq(t[1].price, 22200);
        assertFalse(t[0].takerBuy);

        (uint64[] memory ids,) = book.openOrdersOf(alice, 100);
        assertEq(ids.length, 4);
    }


    // ------------------------------------------------------------- sessions, keeper, Call the Open

    function test_CloseFreezesAndReopenSettlesCalls() public {
        gate.close();
        assertFalse(gate.marketOpen());
        assertEq(gate.sessionId(), 1);
        assertEq(gate.closeCents(), 22300);
        vm.prank(alice);
        vm.expectRevert(Vault.MarketClosed.selector);
        vault.mint(100);

        // Weekend: the book trades, players call the open.
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        book.placeLimit(false, 22900, 100);
        vm.prank(bob);
        book.placeLimit(true, 22900, 100);
        vm.prank(alice);
        openCall.callOpen(23000);
        vm.prank(bob);
        openCall.callOpen(22000);
        vm.prank(bob);
        openCall.callOpen(22500); // change of mind, still one entry
        assertEq(openCall.playerCount(1), 2);

        vm.warp(block.timestamp + 1 days);
        gate.push(22950); // Monday open
        assertTrue(gate.isFresh());
        (uint32 c, uint32 b, uint32 o,) = openCall.results(1);
        assertEq(c, 22300);
        assertEq(b, 22900);
        assertEq(o, 22950);
        assertEq(openCall.errorBps(1, alice), 21); // |230.00-229.50|/229.50
        assertEq(openCall.errorBps(1, bob), 196);

        vm.prank(carol);
        vm.expectRevert(OpenCall.MarketOpen.selector);
        openCall.callOpen(23000);
    }

    function test_BookPriceIsZeroWithoutWeekendTrades() public {
        vm.prank(alice);
        book.placeLimit(false, 22900, 100);
        vm.prank(bob);
        book.placeLimit(true, 22900, 100); // Friday trade, before the close
        vm.warp(block.timestamp + 10);
        gate.close();
        vm.warp(block.timestamp + 1 days);
        gate.push(22400);
        (, uint32 b,,) = openCall.results(1);
        assertEq(b, 0);
    }

    function test_CallBoundsAndOpenMarket() public {
        vm.prank(alice);
        vm.expectRevert(OpenCall.MarketOpen.selector);
        openCall.callOpen(22300);
        gate.close();
        vm.prank(alice);
        vm.expectRevert(OpenCall.BadCall.selector);
        openCall.callOpen(100);
    }

    function test_BrokenListenerNeverBlocksReopen() public {
        gate.setListener(new RevertingListener());
        gate.close();
        gate.push(22310);
        assertTrue(gate.marketOpen());
    }

    function test_KeeperRoleAndMoveGuard() public {
        gate.setKeeper(carol);
        vm.prank(carol);
        gate.push(22350);
        vm.prank(carol);
        vm.expectRevert(PriceGate.TooFarMove.selector);
        gate.push(30000);
        gate.forcePush(30000); // owner override, e.g. after a split
        assertEq(gate.priceCents(), 30000);
        vm.prank(alice);
        vm.expectRevert(PriceGate.NotKeeper.selector);
        gate.close();
        vm.prank(carol);
        gate.close();
        vm.prank(carol);
        vm.expectRevert(PriceGate.AlreadyClosed.selector);
        gate.close();
    }

    // ------------------------------------------------------------- easy-mode trading

    function test_NoApprovalNeededForNadbellContracts() public {
        usdc.setTrusted(address(book), true);
        usdc.setTrusted(address(vault), true);
        stock.setTrusted(address(book), true);
        address dave = makeAddr("dave");
        vm.startPrank(dave);
        usdc.faucet();
        vault.mint(200); // no approve()
        book.placeLimit(false, 22900, 100); // no approve()
        vm.stopPrank();
        assertEq(stock.balanceOf(dave), 1e18);
        // A stranger contract still needs an allowance.
        vm.prank(carol);
        vm.expectRevert();
        usdc.transferFrom(dave, carol, 1);
    }

    function test_IOCFillsWhatCrossesAndRefundsRest() public {
        vm.prank(alice);
        book.placeLimit(false, 22320, 100);
        vm.prank(alice);
        book.placeLimit(false, 22500, 100);
        uint256 before = usdc.balanceOf(bob);
        vm.prank(bob);
        uint64 filled = book.placeIOC(true, 22400, 300); // only the 223.20 level is within limit
        assertEq(filled, 100);
        assertEq(before - usdc.balanceOf(bob), 22320 * 100 * 100);
        assertEq(book.bestBid(), 0); // nothing rested
        assertEq(book.bestAsk(), 22500);
        assertEq(usdc.balanceOf(address(book)), 0);
    }

    // ------------------------------------------------------------- fuzz

    /// Random sequences of places and cancels: escrow always matches resting orders,
    /// the book is never crossed, and nobody gains or loses value overall.
    function testFuzz_EscrowAndNoCross(uint256 seed) public {
        address[3] memory who = [alice, bob, carol];
        uint256 totalUsdc = usdc.balanceOf(alice) + usdc.balanceOf(bob) + usdc.balanceOf(carol);
        uint256 totalStock = stock.balanceOf(alice) + stock.balanceOf(bob) + stock.balanceOf(carol);

        for (uint256 step; step < 60; step++) {
            seed = uint256(keccak256(abi.encode(seed, step)));
            address u = who[seed % 3];
            if (seed % 7 == 0 && book.nextOrderId() > 1) {
                uint64 id = uint64(1 + (seed >> 8) % (book.nextOrderId() - 1));
                (address o,,, uint64 left,,) = _order(id);
                if (o == u && left > 0) {
                    vm.prank(u);
                    book.cancel(id);
                }
                continue;
            }
            bool isBuy = (seed >> 16) % 2 == 0;
            uint32 price = uint32(22000 + (seed >> 24) % 600);
            uint64 lots = uint64(1 + (seed >> 40) % 300);
            vm.prank(u);
            book.placeLimit(isBuy, price, lots);

            uint32 bb = book.bestBid();
            uint32 ba = book.bestAsk();
            if (bb != 0 && ba != 0) assertLt(bb, ba, "crossed book");
        }

        (uint256 bidEscrow, uint256 askEscrow) = _sumEscrow();
        assertEq(usdc.balanceOf(address(book)), bidEscrow, "usdc escrow");
        assertEq(stock.balanceOf(address(book)), askEscrow, "stock escrow");
        assertEq(
            usdc.balanceOf(alice) + usdc.balanceOf(bob) + usdc.balanceOf(carol) + bidEscrow, totalUsdc, "usdc leak"
        );
        assertEq(
            stock.balanceOf(alice) + stock.balanceOf(bob) + stock.balanceOf(carol) + askEscrow,
            totalStock,
            "stock leak"
        );
    }

    // ------------------------------------------------------------- helpers

    function _order(uint64 id)
        internal
        view
        returns (address owner_, uint32 price, bool isBuy, uint64 lots, uint64 prev, uint64 next)
    {
        return book.orders(id);
    }

    function _sumEscrow() internal view returns (uint256 bidUsdc, uint256 askStock) {
        for (uint64 i = 1; i < book.nextOrderId(); i++) {
            (, uint32 price, bool isBuy, uint64 lots,,) = book.orders(i);
            if (lots == 0) continue;
            if (isBuy) bidUsdc += uint256(price) * lots * 100;
            else askStock += uint256(lots) * LOT;
        }
    }
}
