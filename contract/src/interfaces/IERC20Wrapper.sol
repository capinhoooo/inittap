// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC20Wrapper
/// @notice Minimal consumer interface for Initia's ERC20Wrapper contract.
/// @dev Source: https://github.com/initia-labs/minievm/blob/main/x/evm/contracts/erc20_wrapper/ERC20Wrapper.sol
///      The wrapper pulls `localAmount` from the caller via `transferFrom`, converts the
///      18-decimal local token to its 6-decimal remote representation, and submits
///      `MsgInitiateTokenWithdrawal` through the Cosmos precompile.
///      Callers MUST `approve(wrapper, localAmount)` before invocation.
///      The wrapper reverts when `localAmount % 1e12 != 0` (dust amount must be zero).
interface IERC20Wrapper {
    /// @notice Convert `localAmount` of `localDenom` into its remote representation and
    ///         submit an OP bridge withdrawal targeting `receiver` on L1.
    /// @param receiver Bech32-encoded recipient on L1.
    /// @param localDenom Bank-module denom string of the local ERC20 being bridged.
    /// @param localAmount 18-decimal amount; must be divisible by 1e12 to avoid dust revert.
    /// @param gasLimit Cosmos SDK gas limit for the withdrawal message (typically 250_000).
    function toRemoteAndOPWithdraw(
        string memory receiver,
        string memory localDenom,
        uint256 localAmount,
        uint64 gasLimit
    ) external;
}
