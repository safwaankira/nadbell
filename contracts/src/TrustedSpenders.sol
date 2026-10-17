// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Testnet convenience: contracts the owner marks as trusted can move a holder's tokens
///         without a prior approve(). Nadbell's vault and order book only ever pull from msg.sender,
///         so a user still has to call them directly. Never use this pattern for real-value tokens.
abstract contract TrustedSpenders {
    mapping(address => bool) public trusted;

    event TrustedSet(address indexed spender, bool trusted);

    function _setTrusted(address spender, bool t) internal {
        trusted[spender] = t;
        emit TrustedSet(spender, t);
    }
}
