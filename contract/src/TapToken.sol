// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Registry, ERC20_REGISTRY_ADDRESS} from "@initia/interfaces/IERC20Registry.sol";
import {ICosmos, COSMOS_CONTRACT} from "./interfaces/ICosmos.sol";

contract TapToken is ERC20 {
    error NotMinter();
    error ZeroAddress();
    error ZeroAmount();
    error AlreadyLocked();

    IERC20Registry private constant REGISTRY = IERC20Registry(ERC20_REGISTRY_ADDRESS);

    address public immutable minter;
    bool public cosmosLocked;

    event TokenRegistered(address indexed token, address indexed minter);
    event StoreRegistered(address indexed account);
    event CosmosLocked(address indexed caller);

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter();
        _;
    }

    constructor(address _minter) ERC20("INITTAP", "TAP") {
        if (_minter == address(0)) revert ZeroAddress();
        minter = _minter;

        REGISTRY.register_erc20();

        emit TokenRegistered(address(this), _minter);
    }


    function mint(address to, uint256 amount) external onlyMinter {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (!REGISTRY.is_erc20_store_registered(to)) {
            REGISTRY.register_erc20_store(to);
            emit StoreRegistered(to);
        }

        _mint(to, amount);
    }

    function lockCosmos() external onlyMinter {
        if (cosmosLocked) revert AlreadyLocked();
        cosmosLocked = true;
        COSMOS_CONTRACT.disable_execute_cosmos();
        emit CosmosLocked(msg.sender);
    }
}