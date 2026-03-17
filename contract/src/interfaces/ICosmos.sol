// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

address constant COSMOS_ADDRESS = 0x00000000000000000000000000000000000000f1;
ICosmos constant COSMOS_CONTRACT = ICosmos(COSMOS_ADDRESS);

interface ICosmos {
    struct Options {
        bool allow_failure;
        uint64 callback_id;
    }

    function is_blocked_address(address account) external view returns (bool blocked);
    function is_module_address(address account) external view returns (bool module);
    function is_authority_address(address addr) external view returns (bool);
    function to_cosmos_address(address evm_address) external view returns (string memory cosmos_address);
    function to_evm_address(string memory cosmos_address) external view returns (address evm_address);
    function to_denom(address erc20_address) external view returns (string memory denom);
    function to_erc20(string memory denom) external view returns (address erc20_address);
    function execute_cosmos(string memory msg, uint64 gas_limit) external returns (bool dummy);
    function execute_cosmos_with_options(
        string memory message,
        uint64 gas_limit,
        Options memory options
    ) external returns (bool);
    function disable_execute_cosmos() external returns (bool);
    function query_cosmos(string memory path, string memory req) external view returns (string memory result);
}
