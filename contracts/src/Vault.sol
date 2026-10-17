// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {StockToken} from "./StockToken.sol";
import {PriceGate} from "./PriceGate.sol";

/// @title Vault
/// @notice Mock primary market. Mint and redeem at the official print +/- 0.5%, only while the print
///         is fresh (market open). Mirrors how issuers gate primary issuance to market hours.
/// @dev Amounts are in lots: 1 lot = 0.01 share = 1e16 token units. Prices are cents per share.
///      USDC cost of `lots` at `cents` = cents * lots * 100 (6-decimal units).
contract Vault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant LOT = 1e16;
    uint256 public constant FEE_BPS = 50;

    IERC20 public immutable usdc;
    StockToken public immutable stock;
    PriceGate public immutable gate;

    event Minted(address indexed who, uint64 lots, uint32 priceCents, uint256 paid);
    event Redeemed(address indexed who, uint64 lots, uint32 priceCents, uint256 received);

    error MarketClosed();
    error ZeroLots();
    error VaultShort();

    constructor(IERC20 usdc_, StockToken stock_, PriceGate gate_) {
        usdc = usdc_;
        stock = stock_;
        gate = gate_;
    }

    function quoteMint(uint64 lots) public view returns (uint256 cost, uint32 cents) {
        cents = gate.priceCents();
        uint256 gross = uint256(cents) * lots * 100;
        cost = gross + _ceilFee(gross);
    }

    function quoteRedeem(uint64 lots) public view returns (uint256 proceeds, uint32 cents) {
        cents = gate.priceCents();
        uint256 gross = uint256(cents) * lots * 100;
        proceeds = gross - _ceilFee(gross);
    }

    function mint(uint64 lots) external nonReentrant {
        if (lots == 0) revert ZeroLots();
        if (!gate.isFresh()) revert MarketClosed();
        (uint256 cost, uint32 cents) = quoteMint(lots);
        usdc.safeTransferFrom(msg.sender, address(this), cost);
        stock.mint(msg.sender, uint256(lots) * LOT);
        emit Minted(msg.sender, lots, cents, cost);
    }

    function redeem(uint64 lots) external nonReentrant {
        if (lots == 0) revert ZeroLots();
        if (!gate.isFresh()) revert MarketClosed();
        (uint256 proceeds, uint32 cents) = quoteRedeem(lots);
        if (usdc.balanceOf(address(this)) < proceeds) revert VaultShort();
        stock.burn(msg.sender, uint256(lots) * LOT);
        usdc.safeTransfer(msg.sender, proceeds);
        emit Redeemed(msg.sender, lots, cents, proceeds);
    }

    /// @notice Real, onchain backing: USDC held vs. outstanding tokens marked at the last print.
    /// @return held USDC in the vault (6 decimals)
    /// @return owed outstanding supply x last print (6 decimals)
    /// @return ratioBps held / owed in basis points (10000 = 1.00x); 0 when nothing is outstanding
    function backing() external view returns (uint256 held, uint256 owed, uint256 ratioBps) {
        held = usdc.balanceOf(address(this));
        owed = (stock.totalSupply() * gate.priceCents()) / 1e14;
        ratioBps = owed == 0 ? 0 : (held * 10_000) / owed;
    }

    function _ceilFee(uint256 gross) internal pure returns (uint256) {
        return (gross * FEE_BPS + 9_999) / 10_000;
    }
}
