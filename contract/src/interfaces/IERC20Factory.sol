// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC20Factory
/// @notice Minimal interface for the Initia MiniEVM ERC20Factory contract.
/// @dev Source: https://github.com/initia-labs/minievm/blob/main/x/evm/contracts/erc20_factory/ERC20Factory.sol
///      The vendored factory auto-registers the new token with the chain's ERC20 registry and
///      transfers ownership of the new token to msg.sender. Consumers that want minting rights
///      must be prepared to own the returned token.
///
///      CREATE2 salt composition: `keccak256(abi.encodePacked(msg.sender, salt))`. The final
///      address also depends on name, symbol, and decimals (they are baked into the constructor
///      bytecode hash). Changing any of these produces a different address even with an
///      identical caller-supplied salt.
interface IERC20Factory {
    /// @notice Deploy a new Initia ERC20 and register it with the chain's registry
    /// @param name Token display name (e.g. "INITTAP Agent Share #1")
    /// @param symbol Token ticker (e.g. "TAP1")
    /// @param decimals Token decimals (18 recommended for share tokens)
    /// @return token Address of the newly deployed ERC20
    function createERC20(string memory name, string memory symbol, uint8 decimals) external returns (address token);

    /// @notice Deploy a new Initia ERC20 at a deterministic CREATE2 address
    /// @param name Token display name
    /// @param symbol Token ticker
    /// @param decimals Token decimals
    /// @param salt Caller-scoped salt; the effective CREATE2 salt is keccak256(msg.sender, salt)
    /// @return token Address of the newly deployed ERC20
    function createERC20WithSalt(
        string memory name,
        string memory symbol,
        uint8 decimals,
        bytes32 salt
    ) external returns (address token);

    /// @notice Predict the CREATE2 address for a future `createERC20WithSalt` call
    /// @dev Must be invoked with `creator = address that will call createERC20WithSalt`.
    ///      Changing name/symbol/decimals produces a different predicted address because
    ///      those values enter the bytecode hash.
    function computeERC20Address(
        address creator,
        string memory name,
        string memory symbol,
        uint8 decimals,
        bytes32 salt
    ) external view returns (address);
}
