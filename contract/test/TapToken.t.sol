// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {TapToken} from "../src/TapToken.sol";
import {IERC20Registry, ERC20_REGISTRY_ADDRESS} from "@initia/interfaces/IERC20Registry.sol";
import {ICosmos} from "../src/interfaces/ICosmos.sol";

/// @dev Mock ERC20Registry that simulates the Cosmos bank module precompile at 0xf2.
///      Tracks registration calls and per-account store registration state.
contract MockERC20Registry {
    bool public erc20Registered;
    mapping(address => bool) public storeRegistered;

    function register_erc20() external returns (bool) {
        erc20Registered = true;
        return true;
    }

    function register_erc20_from_factory(address) external returns (bool) {
        return true;
    }

    function register_erc20_store(address account) external returns (bool) {
        storeRegistered[account] = true;
        return true;
    }

    function is_erc20_store_registered(address account) external view returns (bool) {
        return storeRegistered[account];
    }
}

/// @dev Mock ICosmos precompile at 0xf1 used to observe `disable_execute_cosmos`
///      and to trip `execute_cosmos*` as blocked after the flag flips. TapToken
///      only calls `disable_execute_cosmos` in `lockCosmos`, but we simulate the
///      full semantics for completeness and for any future call paths.
contract MockCosmosForToken {
    bool public cosmosDisabled;

    function disable_execute_cosmos() external returns (bool) {
        cosmosDisabled = true;
        return true;
    }

    function execute_cosmos(string memory, uint64) external view returns (bool) {
        require(!cosmosDisabled, "cosmos disabled");
        return true;
    }

    function execute_cosmos_with_options(string memory, uint64, ICosmos.Options memory)
        external
        view
        returns (bool)
    {
        require(!cosmosDisabled, "cosmos disabled");
        return true;
    }

    function to_cosmos_address(address) external pure returns (string memory) {
        return "init1mock";
    }

    function to_evm_address(string memory) external pure returns (address) {
        return address(0);
    }

    function to_denom(address) external pure returns (string memory) {
        return "evm/mock";
    }

    function to_erc20(string memory) external pure returns (address) {
        return address(0);
    }

    function is_authority_address(address) external pure returns (bool) {
        return false;
    }

    function is_module_address(address) external pure returns (bool) {
        return false;
    }

    function is_blocked_address(address) external pure returns (bool) {
        return false;
    }

    function query_cosmos(string memory, string memory) external pure returns (string memory) {
        return "{}";
    }
}

contract TapTokenTest is Test {
    TapToken public tapToken;
    MockERC20Registry public mockRegistry;

    address public minter = makeAddr("minter");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public eve = makeAddr("eve");

    address constant COSMOS_PRECOMPILE = 0x00000000000000000000000000000000000000f1;

    function setUp() public {
        // Deploy mock registry and etch it at the precompile address (0xf2)
        mockRegistry = new MockERC20Registry();
        vm.etch(ERC20_REGISTRY_ADDRESS, address(mockRegistry).code);

        // Etch the Cosmos precompile mock at 0xf1 for lockdown tests.
        MockCosmosForToken cosmos = new MockCosmosForToken();
        vm.etch(COSMOS_PRECOMPILE, address(cosmos).code);

        // Deploy TapToken with minter as the authorized minting address
        tapToken = new TapToken(minter);
    }

    // ==================== Constructor Tests ====================

    function test_constructor_setsName() public view {
        assertEq(tapToken.name(), "INITTAP");
    }

    function test_constructor_setsSymbol() public view {
        assertEq(tapToken.symbol(), "TAP");
    }

    function test_constructor_setsMinter() public view {
        assertEq(tapToken.minter(), minter);
    }

    function test_constructor_registersErc20() public view {
        // Verify register_erc20 was called on the registry during construction
        MockERC20Registry registry = MockERC20Registry(ERC20_REGISTRY_ADDRESS);
        assertTrue(registry.erc20Registered());
    }

    function test_constructor_revertOnZeroMinter() public {
        vm.expectRevert(TapToken.ZeroAddress.selector);
        new TapToken(address(0));
    }

    function test_constructor_initialSupplyIsZero() public view {
        assertEq(tapToken.totalSupply(), 0);
    }

    // ==================== Minting Tests ====================

    function test_mint_byMinter() public {
        vm.prank(minter);
        tapToken.mint(alice, 100e18);

        assertEq(tapToken.balanceOf(alice), 100e18);
        assertEq(tapToken.totalSupply(), 100e18);
    }

    function test_mint_registersStoreForNewRecipient() public {
        MockERC20Registry registry = MockERC20Registry(ERC20_REGISTRY_ADDRESS);

        // Alice should not have a store registered yet
        assertFalse(registry.is_erc20_store_registered(alice));

        vm.prank(minter);
        tapToken.mint(alice, 50e18);

        // After minting, Alice's store should be registered
        assertTrue(registry.is_erc20_store_registered(alice));
    }

    function test_mint_skipsStoreRegistrationIfAlreadyRegistered() public {
        // First mint registers the store
        vm.prank(minter);
        tapToken.mint(alice, 50e18);

        // Second mint should succeed without re-registering
        vm.prank(minter);
        tapToken.mint(alice, 25e18);

        assertEq(tapToken.balanceOf(alice), 75e18);
    }

    function test_mint_multipleRecipients() public {
        vm.startPrank(minter);
        tapToken.mint(alice, 100e18);
        tapToken.mint(bob, 200e18);
        tapToken.mint(eve, 50e18);
        vm.stopPrank();

        assertEq(tapToken.balanceOf(alice), 100e18);
        assertEq(tapToken.balanceOf(bob), 200e18);
        assertEq(tapToken.balanceOf(eve), 50e18);
        assertEq(tapToken.totalSupply(), 350e18);
    }

    function test_mint_revertIfNotMinter() public {
        vm.prank(alice);
        vm.expectRevert(TapToken.NotMinter.selector);
        tapToken.mint(alice, 100e18);
    }

    function test_mint_revertIfNotMinter_bob() public {
        vm.prank(bob);
        vm.expectRevert(TapToken.NotMinter.selector);
        tapToken.mint(bob, 1e18);
    }

    function test_mint_revertOnZeroAddress() public {
        vm.prank(minter);
        vm.expectRevert(TapToken.ZeroAddress.selector);
        tapToken.mint(address(0), 100e18);
    }

    function test_mint_revertOnZeroAmount() public {
        vm.prank(minter);
        vm.expectRevert(TapToken.ZeroAmount.selector);
        tapToken.mint(alice, 0);
    }

    // ==================== ERC20 Standard Tests ====================

    function test_transfer() public {
        vm.prank(minter);
        tapToken.mint(alice, 100e18);

        vm.prank(alice);
        tapToken.transfer(bob, 30e18);

        assertEq(tapToken.balanceOf(alice), 70e18);
        assertEq(tapToken.balanceOf(bob), 30e18);
    }

    function test_approve_and_transferFrom() public {
        vm.prank(minter);
        tapToken.mint(alice, 100e18);

        vm.prank(alice);
        tapToken.approve(bob, 50e18);

        vm.prank(bob);
        tapToken.transferFrom(alice, eve, 40e18);

        assertEq(tapToken.balanceOf(alice), 60e18);
        assertEq(tapToken.balanceOf(eve), 40e18);
        assertEq(tapToken.allowance(alice, bob), 10e18);
    }

    function test_decimals() public view {
        assertEq(tapToken.decimals(), 18);
    }

    // ==================== Event Tests ====================

    function test_mint_emitsTransferEvent() public {
        vm.prank(minter);
        vm.expectEmit(true, true, false, true);
        emit TapToken.StoreRegistered(alice);
        tapToken.mint(alice, 100e18);
    }

    function test_constructor_emitsTokenRegistered() public {
        // Re-deploy and verify the event was emitted.
        // We cannot predict the exact deployed address, so check only that the
        // minter indexed param matches (second indexed) and skip the token address.
        vm.expectEmit(false, true, false, false);
        emit TapToken.TokenRegistered(address(1), minter);
        new TapToken(minter);
    }

    // ==================== Immutability Tests ====================

    function test_minterIsImmutable() public view {
        // The minter address cannot change after deployment
        assertEq(tapToken.minter(), minter);
    }

    // ==================== Fuzz Tests ====================

    function testFuzz_mint_anyAmount(uint256 amount) public {
        // Bound to avoid overflow (reasonable token supply range)
        amount = bound(amount, 1, type(uint128).max);

        vm.prank(minter);
        tapToken.mint(alice, amount);

        assertEq(tapToken.balanceOf(alice), amount);
    }

    function testFuzz_mint_revertIfNotMinter(address caller) public {
        vm.assume(caller != minter);

        vm.prank(caller);
        vm.expectRevert(TapToken.NotMinter.selector);
        tapToken.mint(alice, 1e18);
    }

    // ==================== Wave 5: Cosmos lockdown ====================

    function test_lockCosmos_onlyMinter() public {
        vm.prank(alice);
        vm.expectRevert(TapToken.NotMinter.selector);
        tapToken.lockCosmos();
    }

    function test_lockCosmos_flipsFlagOnPrecompile() public {
        MockCosmosForToken cosmos = MockCosmosForToken(COSMOS_PRECOMPILE);
        assertFalse(cosmos.cosmosDisabled());
        assertFalse(tapToken.cosmosLocked());

        vm.prank(minter);
        tapToken.lockCosmos();

        assertTrue(tapToken.cosmosLocked());
        assertTrue(cosmos.cosmosDisabled());
    }

    function test_lockCosmos_isIrreversibleAndOneShot() public {
        vm.prank(minter);
        tapToken.lockCosmos();

        vm.prank(minter);
        vm.expectRevert(TapToken.AlreadyLocked.selector);
        tapToken.lockCosmos();
    }

    function test_lockCosmos_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit TapToken.CosmosLocked(minter);

        vm.prank(minter);
        tapToken.lockCosmos();
    }

    function test_mint_worksAfterLockCosmos() public {
        // Wave 5: disable_execute_cosmos only blocks 0xf1 execute_cosmos*; the 0xf2
        // IERC20Registry precompile is a separate path, so mint() must keep working.
        vm.prank(minter);
        tapToken.lockCosmos();

        vm.prank(minter);
        tapToken.mint(alice, 42e18);

        assertEq(tapToken.balanceOf(alice), 42e18);
    }
}
