// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TrustedSpenders} from "./TrustedSpenders.sol";

/// @title MockUSDC
/// @notice Testnet-only 6-decimal dollar with an open faucet. Has no value.
/// @dev Nadbell's own vault and order book are trusted spenders, so users skip approval pop-ups.
contract MockUSDC is ERC20, Ownable, TrustedSpenders {
    uint256 public constant FAUCET_AMOUNT = 5_000e6;

    constructor(address owner_) ERC20("Nadbell Test USDC", "tUSDC") Ownable(owner_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Anyone can take 5,000 tUSDC. Testnet only.
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function setTrusted(address spender, bool t) external onlyOwner {
        _setTrusted(spender, t);
    }

    function allowance(address owner_, address spender) public view override returns (uint256) {
        return trusted[spender] ? type(uint256).max : super.allowance(owner_, spender);
    }

    function _spendAllowance(address owner_, address spender, uint256 value) internal override {
        if (trusted[spender]) return;
        super._spendAllowance(owner_, spender, value);
    }
}
