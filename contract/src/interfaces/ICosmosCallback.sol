// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICosmosCallback
/// @notice Callback interface invoked by the chain after
///         `execute_cosmos_with_options` settles. The caller passes a non-zero
///         callback_id in the Options struct to opt-in.
///         Source: https://github.com/initia-labs/minievm/tree/main/x/evm/contracts/i_cosmos_callback
interface ICosmosCallback {
    /// @notice Called once the cosmos message settles
    /// @param callback_id The id that was passed inside Options on the originating call
    /// @param success Whether the original cosmos message succeeded
    function callback(uint64 callback_id, bool success) external;
}
