// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TrustedSpenders} from "./TrustedSpenders.sol";

/// @title StockToken
/// @notice Mock tokenized-stock tracker (e.g. tAAPL). Testnet only, no value, no claim on any security.
/// @dev Mirrors the pattern Robinhood Stock Tokens use (ERC-8056 "Scaled UI Amount", draft):
///      raw balances never change on a corporate action; a display multiplier does.
///      Primary mint/burn is restricted to the vault, like an issuer. Secondary transfers are open
///      except for an admin blocklist and a global pause.
contract StockToken is ERC20, Ownable, TrustedSpenders {
    uint256 public constant ONE = 1e18;

    address public vault;
    bool public paused;
    mapping(address => bool) public blocked;

    uint256 private _multiplier = ONE;
    uint256 private _nextMultiplier = ONE;
    uint256 private _effectiveAt;

    event VaultSet(address vault);
    event Paused(bool paused);
    event Blocked(address account, bool blocked);
    /// @notice ERC-8056-style event: oldMultiplier -> newMultiplier from effectiveAtTimestamp.
    event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);

    error NotVault();
    error TransfersPaused();
    error AccountBlocked(address account);
    error BadMultiplier();

    constructor(string memory name_, string memory symbol_, address owner_) ERC20(name_, symbol_) Ownable(owner_) {}

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    function setVault(address v) external onlyOwner {
        vault = v;
        emit VaultSet(v);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    function setBlocked(address account, bool b) external onlyOwner {
        blocked[account] = b;
        emit Blocked(account, b);
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

    function mint(address to, uint256 amount) external onlyVault {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyVault {
        _burn(from, amount);
    }

    // ---------------------------------------------------------------- multiplier

    /// @notice Current display multiplier (1e18 = 1.0).
    function uiMultiplier() public view returns (uint256) {
        return block.timestamp >= _effectiveAt ? _nextMultiplier : _multiplier;
    }

    function newUIMultiplier() external view returns (uint256) {
        return _nextMultiplier;
    }

    function effectiveAt() external view returns (uint256) {
        return _effectiveAt;
    }

    /// @notice Balance a wallet should display: raw balance x multiplier.
    function balanceOfUI(address account) external view returns (uint256) {
        return (balanceOf(account) * uiMultiplier()) / ONE;
    }

    /// @notice Schedule a corporate action (split, reinvested dividend). Raw balances are untouched.
    function setUIMultiplier(uint256 newMultiplier, uint256 effectiveAtTimestamp) external onlyOwner {
        if (newMultiplier == 0) revert BadMultiplier();
        uint256 current = uiMultiplier();
        _multiplier = current;
        _nextMultiplier = newMultiplier;
        _effectiveAt = effectiveAtTimestamp < block.timestamp ? block.timestamp : effectiveAtTimestamp;
        emit UIMultiplierUpdated(current, newMultiplier, _effectiveAt);
    }

    // ---------------------------------------------------------------- hooks

    function _update(address from, address to, uint256 value) internal override {
        bool isMintOrBurn = from == address(0) || to == address(0);
        if (paused && !isMintOrBurn) revert TransfersPaused();
        if (from != address(0) && blocked[from]) revert AccountBlocked(from);
        if (to != address(0) && blocked[to]) revert AccountBlocked(to);
        super._update(from, to, value);
    }
}
