// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {StockToken} from "../src/StockToken.sol";
import {PriceGate} from "../src/PriceGate.sol";
import {Vault} from "../src/Vault.sol";
import {OrderBook} from "../src/OrderBook.sol";
import {OpenCall} from "../src/OpenCall.sol";

/// Deploys Nadbell and seeds a small ladder around the starting price.
/// The keeper/maker bot (keeper/keeper.mjs) takes over from there.
///
/// Env (all optional):
///   PYTH_ADDRESS      Pyth contract (default: Monad testnet 0x2880…7B43; set 0x0 to disable)
///   FEED_ID           Pyth feed id (default: Equity.US.AAPL/USD)
///   START_PRICE_CENTS opening price (default 22300 = $223.00); use today's real AAPL price
///   MAX_AGE           seconds a price stays fresh while open (default 1800; keeper pushes every ~5 min)
///   SOURCE_LABEL      shown in the app next to the price (default "Alpaca (IEX)")
///   KEEPER_ADDRESS    wallet the keeper bot signs with (default: deployer)
contract Deploy is Script {
    struct Deployed {
        MockUSDC usdc;
        StockToken stock;
        PriceGate gate;
        Vault vault;
        OrderBook book;
        OpenCall openCall;
    }

    function run() external {
        uint32 start = uint32(vm.envOr("START_PRICE_CENTS", uint256(22300)));
        vm.startBroadcast();
        Deployed memory d = _deploy(msg.sender);
        _seed(d, start);
        vm.stopBroadcast();
        _record(d);
    }

    function _deploy(address me) internal returns (Deployed memory d) {
        address pythAddr = vm.envOr("PYTH_ADDRESS", address(0x2880aB155794e7179c9eE2e38200202908C17B43));
        bytes32 feed =
            vm.envOr("FEED_ID", bytes32(0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688));
        uint32 maxAge = uint32(vm.envOr("MAX_AGE", uint256(1800)));
        string memory label = vm.envOr("SOURCE_LABEL", string("Alpaca (IEX)"));
        address keeperAddr = vm.envOr("KEEPER_ADDRESS", me);

        d.usdc = new MockUSDC(me);
        d.stock = new StockToken("Nadbell Mock AAPL", "tAAPL", me);
        d.gate = new PriceGate(IPyth(pythAddr), feed, maxAge, label, me);
        d.vault = new Vault(d.usdc, d.stock, d.gate);
        d.stock.setVault(address(d.vault));
        d.book = new OrderBook(d.stock, d.usdc);
        d.openCall = new OpenCall(d.gate, d.book);
        d.gate.setListener(d.openCall);
        if (keeperAddr != me) d.gate.setKeeper(keeperAddr);

        // Testnet convenience: Nadbell's own contracts need no approve() pop-ups.
        d.usdc.setTrusted(address(d.vault), true);
        d.usdc.setTrusted(address(d.book), true);
        d.stock.setTrusted(address(d.book), true);
    }

    function _seed(Deployed memory d, uint32 start) internal {
        d.gate.push(start);
        for (uint256 i; i < 40; i++) d.usdc.faucet(); // $200k of test dollars
        d.vault.mint(20_000); // 200 shares
        d.book.placeLimit(false, start + 20, 200);
        d.book.placeLimit(false, start + 90, 1_000);
        d.book.placeLimit(true, start - 20, 200);
        d.book.placeLimit(true, start - 90, 1_000);
    }

    function _record(Deployed memory d) internal {
        string memory o = "deploy";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "usdc", address(d.usdc));
        vm.serializeAddress(o, "stock", address(d.stock));
        vm.serializeAddress(o, "gate", address(d.gate));
        vm.serializeAddress(o, "vault", address(d.vault));
        vm.serializeAddress(o, "pyth", address(d.gate.pyth()));
        vm.serializeBytes32(o, "feedId", d.gate.feedId());
        vm.serializeAddress(o, "openCall", address(d.openCall));
        string memory json = vm.serializeAddress(o, "book", address(d.book));
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));

        console2.log("usdc ", address(d.usdc));
        console2.log("stock", address(d.stock));
        console2.log("gate ", address(d.gate));
        console2.log("vault", address(d.vault));
        console2.log("book ", address(d.book));
        console2.log("call ", address(d.openCall));
    }
}
