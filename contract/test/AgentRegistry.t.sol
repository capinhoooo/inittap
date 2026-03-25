// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";
import {ICosmos} from "../src/interfaces/ICosmos.sol";

/// @dev Minimal mock of the Initia ICosmos precompile used for block-list
///      + bech32 conversion during AgentRegistry flows. Storage-backed so each
///      test can flip a blocked address via `setBlocked`.
contract MockCosmosRegistry {
    address public blockedAddr;

    function setBlocked(address who) external {
        blockedAddr = who;
    }

    function is_blocked_address(address account) external view returns (bool) {
        return account == blockedAddr && account != address(0);
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

    function execute_cosmos(string memory, uint64) external pure returns (bool) {
        return true;
    }

    function execute_cosmos_with_options(string memory, uint64, ICosmos.Options memory)
        external
        pure
        returns (bool)
    {
        return true;
    }

    function disable_execute_cosmos() external pure returns (bool) {
        return true;
    }

    function query_cosmos(string memory, string memory) external pure returns (string memory) {
        return "{\"pairs\":[]}";
    }
}

contract AgentRegistryTest is Test {
    AgentRegistry public registry;

    address public owner = makeAddr("owner");
    address public operator = makeAddr("operator");
    address public predictor = makeAddr("predictor");
    address public creator = makeAddr("creator");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public charlie = makeAddr("charlie");
    address public agentWallet1 = makeAddr("agentWallet1");
    address public agentWallet2 = makeAddr("agentWallet2");

    uint256 constant REG_FEE = 0.1 ether;
    uint256 constant MIN_SUB = 0.5 ether;

    address constant COSMOS_PRECOMPILE = 0x00000000000000000000000000000000000000f1;

    function setUp() public {
        // Etch the mock Initia Cosmos precompile at 0xf1 so the block-list guard
        // and `to_cosmos_address` conversions resolve during registerAgent/subscribe.
        MockCosmosRegistry mockCosmos = new MockCosmosRegistry();
        vm.etch(COSMOS_PRECOMPILE, address(mockCosmos).code);

        registry = new AgentRegistry(owner, operator, REG_FEE, MIN_SUB);

        // Fund test accounts
        vm.deal(creator, 100 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);

        // Set predictor
        vm.prank(owner);
        registry.setPredictor(predictor);
    }

    // ==================== Registration Tests ====================

    function test_registerAgent() public {
        vm.prank(creator);
        uint256 agentId = registry.registerAgent{value: REG_FEE}(agentWallet1, "ipfs://strategy1", 1000);

        assertEq(agentId, 1);
        assertEq(registry.agentCount(), 1);

        IAgentRegistry.Agent memory agent = registry.getAgent(1);
        assertEq(agent.creator, creator);
        assertEq(agent.agentWallet, agentWallet1);
        assertEq(agent.performanceFeeBps, 1000);
        assertEq(agent.isActive, true);
        assertEq(agent.subscriberCount, 0);
        assertEq(agent.totalTrades, 0);
        assertEq(agent.wins, 0);
        assertEq(agent.totalPnL, 0);
    }

    function test_registerAgent_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit IAgentRegistry.AgentRegistered(1, creator, agentWallet1, "ipfs://strategy1");

        vm.prank(creator);
        registry.registerAgent{value: REG_FEE}(agentWallet1, "ipfs://strategy1", 1000);
    }

    function test_registerAgent_multipleAgents() public {
        vm.prank(creator);
        uint256 id1 = registry.registerAgent{value: REG_FEE}(agentWallet1, "ipfs://s1", 500);

        vm.prank(alice);
        uint256 id2 = registry.registerAgent{value: REG_FEE}(agentWallet2, "ipfs://s2", 1500);

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(registry.agentCount(), 2);
    }

    function test_registerAgent_revertZeroWallet() public {
        vm.prank(creator);
        vm.expectRevert(AgentRegistry.ZeroAddress.selector);
        registry.registerAgent{value: REG_FEE}(address(0), "ipfs://s1", 1000);
    }

    function test_registerAgent_revertFeeTooHigh() public {
        vm.prank(creator);
        vm.expectRevert(AgentRegistry.FeeTooHigh.selector);
        registry.registerAgent{value: REG_FEE}(agentWallet1, "ipfs://s1", 2001);
    }

    function test_registerAgent_revertInsufficientFee() public {
        vm.prank(creator);
        vm.expectRevert(AgentRegistry.InsufficientRegistrationFee.selector);
        registry.registerAgent{value: REG_FEE - 1}(agentWallet1, "ipfs://s1", 1000);
    }

    function test_registerAgent_revertDuplicateWallet() public {
        vm.prank(creator);
        registry.registerAgent{value: REG_FEE}(agentWallet1, "ipfs://s1", 1000);

        vm.prank(alice);
        vm.expectRevert(AgentRegistry.AgentWalletAlreadyRegistered.selector);
        registry.registerAgent{value: REG_FEE}(agentWallet1, "ipfs://s2", 500);
    }

    function test_registerAgent_maxFee() public {
        vm.prank(creator);
        uint256 agentId = registry.registerAgent{value: REG_FEE}(agentWallet1, "ipfs://s1", 2000);

        IAgentRegistry.Agent memory agent = registry.getAgent(agentId);
        assertEq(agent.performanceFeeBps, 2000);
    }

    function test_registerAgent_zeroFeeWhenRegistrationFreeIsZero() public {
        AgentRegistry freeRegistry = new AgentRegistry(owner, operator, 0, MIN_SUB);

        vm.prank(creator);
        uint256 agentId = freeRegistry.registerAgent{value: 0}(agentWallet1, "ipfs://s1", 1000);
        assertEq(agentId, 1);
    }

    function test_registerAgent_registrationFeeAccumulatesInPlatformBalance() public {
        vm.prank(creator);
        registry.registerAgent{value: REG_FEE}(agentWallet1, "ipfs://s1", 1000);

        assertEq(registry.platformFeeBalance(), REG_FEE);

        vm.prank(alice);
        registry.registerAgent{value: REG_FEE}(agentWallet2, "ipfs://s2", 500);

        assertEq(registry.platformFeeBalance(), REG_FEE * 2);
    }

    // ==================== Subscription Tests ====================

    function test_subscribe() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        registry.subscribe{value: 5 ether}(agentId);

        IAgentRegistry.Subscription memory sub = registry.getSubscription(agentId, alice);
        assertEq(sub.depositAmount, 5 ether);
        assertEq(sub.remainingAmount, 5 ether);
        assertEq(sub.pnl, 0);
        assertTrue(sub.active);

        IAgentRegistry.Agent memory agent = registry.getAgent(agentId);
        assertEq(agent.subscriberCount, 1);
    }

    function test_subscribe_emitsEvent() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.expectEmit(true, true, false, true);
        emit IAgentRegistry.Subscribed(agentId, alice, 5 ether);

        vm.prank(alice);
        registry.subscribe{value: 5 ether}(agentId);
    }

    function test_subscribe_multipleUsers() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        registry.subscribe{value: 5 ether}(agentId);

        vm.prank(bob);
        registry.subscribe{value: 3 ether}(agentId);

        IAgentRegistry.Agent memory agent = registry.getAgent(agentId);
        assertEq(agent.subscriberCount, 2);

        address[] memory subs = registry.getSubscribers(agentId);
        assertEq(subs.length, 2);
    }

    function test_subscribe_revertIfBelowMinimum() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        vm.expectRevert(AgentRegistry.InsufficientSubscription.selector);
        registry.subscribe{value: MIN_SUB - 1}(agentId);
    }

    function test_subscribe_revertIfAlreadySubscribed() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        registry.subscribe{value: 1 ether}(agentId);

        vm.prank(alice);
        vm.expectRevert(AgentRegistry.AlreadySubscribed.selector);
        registry.subscribe{value: 1 ether}(agentId);
    }

    function test_subscribe_revertIfAgentNotFound() public {
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.AgentNotFound.selector);
        registry.subscribe{value: 1 ether}(999);
    }

    function test_subscribe_revertIfAgentDeactivated() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(creator);
        registry.deactivateAgent(agentId);

        vm.prank(alice);
        vm.expectRevert(AgentRegistry.AgentNotActive.selector);
        registry.subscribe{value: 1 ether}(agentId);
    }

    // ==================== Unsubscribe Tests ====================

    function test_unsubscribe() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        registry.subscribe{value: 5 ether}(agentId);

        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        registry.unsubscribe(agentId);

        assertEq(alice.balance - balanceBefore, 5 ether);

        IAgentRegistry.Subscription memory sub = registry.getSubscription(agentId, alice);
        assertFalse(sub.active);
        assertEq(sub.remainingAmount, 0);

        IAgentRegistry.Agent memory agent = registry.getAgent(agentId);
        assertEq(agent.subscriberCount, 0);
    }

    function test_unsubscribe_emitsEvent() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        registry.subscribe{value: 5 ether}(agentId);

        vm.expectEmit(true, true, false, true);
        emit IAgentRegistry.Unsubscribed(agentId, alice, 5 ether);

        vm.prank(alice);
        registry.unsubscribe(agentId);
    }

    function test_unsubscribe_revertIfNotSubscribed() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        vm.expectRevert(AgentRegistry.NotSubscribed.selector);
        registry.unsubscribe(agentId);
    }

    function test_unsubscribe_removesFromSubscribersArray() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        registry.subscribe{value: 1 ether}(agentId);
        vm.prank(bob);
        registry.subscribe{value: 2 ether}(agentId);
        vm.prank(charlie);
        registry.subscribe{value: 3 ether}(agentId);

        // Unsubscribe bob (middle element) triggers swap-and-pop
        vm.prank(bob);
        registry.unsubscribe(agentId);

        address[] memory subs = registry.getSubscribers(agentId);
        assertEq(subs.length, 2);
        // After swap-and-pop: alice stays at 0, charlie moves to 1 (bob's old position)
        assertEq(subs[0], alice);
        assertEq(subs[1], charlie);
    }

    function test_unsubscribe_worksWhenAgentDeactivated() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        registry.subscribe{value: 5 ether}(agentId);

        vm.prank(creator);
        registry.deactivateAgent(agentId);

        // Users can still unsubscribe from deactivated agents
        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        registry.unsubscribe(agentId);

        assertEq(alice.balance - balanceBefore, 5 ether);
    }

    // ==================== Trade Recording Tests ====================

    function test_recordTrade_win() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(operator);
        registry.recordTrade(agentId, true, 1 ether);

        IAgentRegistry.Agent memory agent = registry.getAgent(agentId);
        assertEq(agent.totalTrades, 1);
        assertEq(agent.wins, 1);
        assertEq(agent.totalPnL, 1 ether);
    }

    function test_recordTrade_loss() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(operator);
        registry.recordTrade(agentId, false, -0.5 ether);

        IAgentRegistry.Agent memory agent = registry.getAgent(agentId);
        assertEq(agent.totalTrades, 1);
        assertEq(agent.wins, 0);
        assertEq(agent.totalPnL, -0.5 ether);
    }

    function test_recordTrade_emitsEvent() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.expectEmit(true, false, false, true);
        emit IAgentRegistry.TradeRecorded(agentId, true, 2 ether);

        vm.prank(operator);
        registry.recordTrade(agentId, true, 2 ether);
    }

    function test_recordTrade_byPredictor() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(predictor);
        registry.recordTrade(agentId, true, 1 ether);

        IAgentRegistry.Agent memory agent = registry.getAgent(agentId);
        assertEq(agent.totalTrades, 1);
    }

    function test_recordTrade_revertIfNotAuthorized() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        vm.expectRevert(AgentRegistry.NotAuthorized.selector);
        registry.recordTrade(agentId, true, 1 ether);
    }

    function test_recordTrade_revertIfAgentNotActive() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(creator);
        registry.deactivateAgent(agentId);

        vm.prank(operator);
        vm.expectRevert(AgentRegistry.AgentNotActive.selector);
        registry.recordTrade(agentId, true, 1 ether);
    }

    function test_recordTrade_multipleTrades() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.startPrank(operator);
        registry.recordTrade(agentId, true, 2 ether);
        registry.recordTrade(agentId, true, 1 ether);
        registry.recordTrade(agentId, false, -0.5 ether);
        registry.recordTrade(agentId, true, 3 ether);
        vm.stopPrank();

        IAgentRegistry.Agent memory agent = registry.getAgent(agentId);
        assertEq(agent.totalTrades, 4);
        assertEq(agent.wins, 3);
        assertEq(agent.totalPnL, 5.5 ether);
    }

    // ==================== Performance Fee Distribution Tests ====================

    function test_distributePerformanceFee_singleSubscriber() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        registry.subscribe{value: 10 ether}(agentId);

        // Fund registry to cover fee transfers
        vm.deal(address(registry), 100 ether);

        // Record a winning trade with 2 ETH profit
        vm.prank(operator);
        registry.recordTrade(agentId, true, 2 ether);

        // Fee calculation:
        // Follower profit = 2 ETH / 1 subscriber = 2 ETH
        // Performance fee = 2 ETH * 10% = 0.2 ETH
        // Creator fee = 0.2 ETH * 70% = 0.14 ETH
        // Platform fee = 0.2 ETH * 30% = 0.06 ETH

        // C-01 fix: creator fees are accumulated, not sent directly
        assertEq(registry.creatorFeeBalance(creator), 0.14 ether);

        // Creator must claim
        uint256 creatorBalBefore = creator.balance;
        vm.prank(creator);
        registry.claimCreatorFees();
        assertEq(creator.balance - creatorBalBefore, 0.14 ether);
        assertEq(registry.creatorFeeBalance(creator), 0);
    }

    function test_distributePerformanceFee_multipleSubscribers() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        registry.subscribe{value: 5 ether}(agentId);
        vm.prank(bob);
        registry.subscribe{value: 5 ether}(agentId);

        vm.deal(address(registry), 100 ether);

        uint256 platformBalBefore = registry.platformFeeBalance();

        // Record a winning trade with 4 ETH profit
        vm.prank(operator);
        registry.recordTrade(agentId, true, 4 ether);

        // Per subscriber: 4 ETH / 2 = 2 ETH each
        // Fee per sub: 2 * 10% = 0.2 ETH
        // Creator per sub: 0.2 * 70% = 0.14 ETH
        // Platform per sub: 0.2 * 30% = 0.06 ETH
        // Total creator: 0.28 ETH
        // Total platform: 0.12 ETH

        // C-01 fix: creator fees accumulated, not sent directly
        assertEq(registry.creatorFeeBalance(creator), 0.28 ether);
        assertEq(registry.platformFeeBalance() - platformBalBefore, 0.12 ether);

        // Creator claims
        uint256 creatorBalBefore = creator.balance;
        vm.prank(creator);
        registry.claimCreatorFees();
        assertEq(creator.balance - creatorBalBefore, 0.28 ether);
    }

    function test_distributePerformanceFee_emitsEvent() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        registry.subscribe{value: 5 ether}(agentId);

        vm.deal(address(registry), 100 ether);

        // followerProfit = 1 ether, creatorFee = 0.07 ether, platformFee = 0.03 ether
        vm.expectEmit(true, true, false, true);
        emit IAgentRegistry.PerformanceFeeDistributed(agentId, alice, 1 ether, 0.07 ether, 0.03 ether);

        vm.prank(operator);
        registry.recordTrade(agentId, true, 1 ether);
    }

    function test_distributePerformanceFee_noFeeOnLoss() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        registry.subscribe{value: 5 ether}(agentId);

        uint256 creatorBalBefore = creator.balance;
        uint256 platformBalBefore = registry.platformFeeBalance();

        vm.prank(operator);
        registry.recordTrade(agentId, false, -1 ether);

        // No fees on losses
        assertEq(creator.balance, creatorBalBefore);
        assertEq(registry.platformFeeBalance(), platformBalBefore);
    }

    function test_distributePerformanceFee_noSubscribers() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        uint256 creatorBalBefore = creator.balance;

        // No subscribers, should not revert
        vm.prank(operator);
        registry.recordTrade(agentId, true, 2 ether);

        // No fees collected
        assertEq(creator.balance, creatorBalBefore);
    }

    function test_distributePerformanceFee_updatesSubscriberPnl() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        registry.subscribe{value: 10 ether}(agentId);

        vm.deal(address(registry), 100 ether);

        vm.prank(operator);
        registry.recordTrade(agentId, true, 2 ether);

        IAgentRegistry.Subscription memory sub = registry.getSubscription(agentId, alice);
        // Net profit = 2 ETH - 0.2 ETH fee = 1.8 ETH
        assertEq(sub.pnl, 1.8 ether);
    }

    // ==================== Deactivation Tests ====================

    function test_deactivateAgent_byCreator() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(creator);
        registry.deactivateAgent(agentId);

        IAgentRegistry.Agent memory agent = registry.getAgent(agentId);
        assertFalse(agent.isActive);
    }

    function test_deactivateAgent_byOwner() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(owner);
        registry.deactivateAgent(agentId);

        IAgentRegistry.Agent memory agent = registry.getAgent(agentId);
        assertFalse(agent.isActive);
    }

    function test_deactivateAgent_emitsEvent() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.expectEmit(true, true, false, false);
        emit IAgentRegistry.AgentDeactivated(agentId, creator);

        vm.prank(creator);
        registry.deactivateAgent(agentId);
    }

    function test_deactivateAgent_revertIfNotCreatorOrOwner() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        vm.expectRevert(AgentRegistry.NotCreatorOrOwner.selector);
        registry.deactivateAgent(agentId);
    }

    function test_deactivateAgent_revertIfAlreadyDeactivated() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(creator);
        registry.deactivateAgent(agentId);

        vm.prank(creator);
        vm.expectRevert(AgentRegistry.AgentNotActive.selector);
        registry.deactivateAgent(agentId);
    }

    // ==================== Win Rate Tests ====================

    function test_getWinRate_zeroTrades() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);
        assertEq(registry.getWinRate(agentId), 0);
    }

    function test_getWinRate_allWins() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.startPrank(operator);
        registry.recordTrade(agentId, true, 1 ether);
        registry.recordTrade(agentId, true, 1 ether);
        registry.recordTrade(agentId, true, 1 ether);
        vm.stopPrank();

        assertEq(registry.getWinRate(agentId), 10000); // 100%
    }

    function test_getWinRate_mixed() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.startPrank(operator);
        registry.recordTrade(agentId, true, 1 ether);
        registry.recordTrade(agentId, false, -0.5 ether);
        registry.recordTrade(agentId, true, 2 ether);
        registry.recordTrade(agentId, false, -1 ether);
        vm.stopPrank();

        // 2 wins out of 4 = 50% = 5000 bps
        assertEq(registry.getWinRate(agentId), 5000);
    }

    function test_getWinRate_revertIfAgentNotFound() public {
        vm.expectRevert(AgentRegistry.AgentNotFound.selector);
        registry.getWinRate(999);
    }

    // ==================== View Function Tests ====================

    function test_getAgentWallet() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);
        assertEq(registry.getAgentWallet(agentId), agentWallet1);
    }

    function test_getAgentWallet_revertIfNotFound() public {
        vm.expectRevert(AgentRegistry.AgentNotFound.selector);
        registry.getAgentWallet(999);
    }

    function test_agentCount() public {
        assertEq(registry.agentCount(), 0);

        _registerAgent(creator, agentWallet1, 1000);
        assertEq(registry.agentCount(), 1);

        _registerAgent(alice, agentWallet2, 500);
        assertEq(registry.agentCount(), 2);
    }

    function test_walletToAgentId() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);
        assertEq(registry.walletToAgentId(agentWallet1), agentId);
    }

    // ==================== Admin Function Tests ====================

    function test_setPredictor() public {
        address newPredictor = makeAddr("newPredictor");

        vm.expectEmit(true, true, false, false);
        emit IAgentRegistry.PredictorUpdated(predictor, newPredictor);

        vm.prank(owner);
        registry.setPredictor(newPredictor);

        assertEq(registry.predictorAddress(), newPredictor);
    }

    function test_setPredictor_revertIfNotOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        registry.setPredictor(makeAddr("x"));
    }

    function test_setPredictor_revertIfZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(AgentRegistry.ZeroAddress.selector);
        registry.setPredictor(address(0));
    }

    function test_setOperator() public {
        address newOp = makeAddr("newOp");

        vm.prank(owner);
        registry.setOperator(newOp);

        assertEq(registry.operatorAddress(), newOp);
    }

    function test_setOperator_revertIfZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(AgentRegistry.ZeroAddress.selector);
        registry.setOperator(address(0));
    }

    function test_setRegistrationFee() public {
        vm.expectEmit(false, false, false, true);
        emit IAgentRegistry.RegistrationFeeUpdated(REG_FEE, 0.5 ether);

        vm.prank(owner);
        registry.setRegistrationFee(0.5 ether);

        assertEq(registry.registrationFee(), 0.5 ether);
    }

    function test_setMinSubscription() public {
        vm.prank(owner);
        registry.setMinSubscription(1 ether);

        assertEq(registry.minSubscription(), 1 ether);
    }

    function test_claimPlatformFees() public {
        // Register to generate fees
        _registerAgent(creator, agentWallet1, 1000);

        assertEq(registry.platformFeeBalance(), REG_FEE);

        address treasury = makeAddr("treasury");
        uint256 balBefore = treasury.balance;

        vm.prank(owner);
        registry.claimPlatformFees(treasury);

        assertEq(treasury.balance - balBefore, REG_FEE);
        assertEq(registry.platformFeeBalance(), 0);
    }

    function test_claimPlatformFees_revertIfZeroBalance() public {
        vm.prank(owner);
        vm.expectRevert(AgentRegistry.ZeroAmount.selector);
        registry.claimPlatformFees(makeAddr("treasury"));
    }

    function test_claimPlatformFees_revertIfZeroAddress() public {
        _registerAgent(creator, agentWallet1, 1000);

        vm.prank(owner);
        vm.expectRevert(AgentRegistry.ZeroAddress.selector);
        registry.claimPlatformFees(address(0));
    }

    function test_claimPlatformFees_revertIfNotOwner() public {
        _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        registry.claimPlatformFees(alice);
    }

    // ==================== Pause Tests ====================

    function test_pause_blocksRegistration() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(creator);
        vm.expectRevert();
        registry.registerAgent{value: REG_FEE}(agentWallet1, "ipfs://s1", 1000);
    }

    function test_pause_blocksSubscription() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.subscribe{value: 1 ether}(agentId);
    }

    function test_pause_allowsUnsubscribe() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        registry.subscribe{value: 1 ether}(agentId);

        vm.prank(owner);
        registry.pause();

        // Unsubscribe is not gated by whenNotPaused
        vm.prank(alice);
        registry.unsubscribe(agentId);
    }

    function test_unpause() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(owner);
        registry.unpause();

        // Should work after unpause
        vm.prank(creator);
        registry.registerAgent{value: REG_FEE}(agentWallet1, "ipfs://s1", 1000);
    }

    // ==================== Constructor Tests ====================

    function test_constructor_revertZeroOperator() public {
        vm.expectRevert(AgentRegistry.ZeroAddress.selector);
        new AgentRegistry(owner, address(0), REG_FEE, MIN_SUB);
    }

    function test_constructor_setsState() public {
        AgentRegistry r = new AgentRegistry(owner, operator, 0.2 ether, 1 ether);
        assertEq(r.owner(), owner);
        assertEq(r.operatorAddress(), operator);
        assertEq(r.registrationFee(), 0.2 ether);
        assertEq(r.minSubscription(), 1 ether);
        assertEq(r.agentCount(), 0);
    }

    // ==================== Edge Cases ====================

    function test_unsubscribe_afterRecordTradeProfitUpdatesCorrectly() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        vm.prank(alice);
        registry.subscribe{value: 10 ether}(agentId);

        vm.deal(address(registry), 100 ether);

        // Record winning trade with 5 ETH profit
        vm.prank(operator);
        registry.recordTrade(agentId, true, 5 ether);

        // H-02 fix: fees are deducted from remainingAmount
        // Fee = 5 ETH * 10% = 0.5 ETH total performance fee
        // This is deducted from alice's remainingAmount
        // remainingAmount = 10 ETH - 0.5 ETH = 9.5 ETH
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        registry.unsubscribe(agentId);

        assertEq(alice.balance - aliceBefore, 9.5 ether);
    }

    function test_receive_acceptsEth() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        (bool success,) = address(registry).call{value: 1 ether}("");
        assertTrue(success);
    }

    function test_agentId_startsAtOne() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);
        assertEq(agentId, 1);
    }

    function test_getAgent_revertIfZeroId() public {
        vm.expectRevert(AgentRegistry.AgentNotFound.selector);
        registry.getAgent(0);
    }

    function test_recordTrade_revertIfAgentNotFound() public {
        vm.prank(operator);
        vm.expectRevert(AgentRegistry.AgentNotFound.selector);
        registry.recordTrade(999, true, 1 ether);
    }

    // ==================== Wave 3: Initia integration ====================

    function test_registerAgent_revertIfBlocked() public {
        MockCosmosRegistry(COSMOS_PRECOMPILE).setBlocked(creator);

        vm.prank(creator);
        vm.expectRevert(AgentRegistry.BlockedAddress.selector);
        registry.registerAgent{value: REG_FEE}(agentWallet1, "ipfs://s1", 1000);
    }

    function test_subscribe_revertIfBlocked() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        MockCosmosRegistry(COSMOS_PRECOMPILE).setBlocked(alice);

        vm.prank(alice);
        vm.expectRevert(AgentRegistry.BlockedAddress.selector);
        registry.subscribe{value: 1 ether}(agentId);
    }

    function test_getAgentCosmosAddress() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 1000);

        // Mock returns deterministic "init1mock" for any address.
        string memory bech = registry.getAgentCosmosAddress(agentId);
        assertEq(bech, "init1mock");
    }

    function test_getAgentCosmosAddress_revertIfNotFound() public {
        vm.expectRevert(AgentRegistry.AgentNotFound.selector);
        registry.getAgentCosmosAddress(999);
    }

    // ==================== Wave 5: CREATE2 share tokens ====================

    function test_setErc20Factory_once() public {
        MockERC20FactoryCreate2 factory = new MockERC20FactoryCreate2();

        assertEq(registry.erc20Factory(), address(0));

        vm.prank(owner);
        registry.setErc20Factory(address(factory));
        assertEq(registry.erc20Factory(), address(factory));

        vm.prank(owner);
        vm.expectRevert(AgentRegistry.Erc20FactoryAlreadySet.selector);
        registry.setErc20Factory(address(factory));
    }

    function test_setErc20Factory_revertIfZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(AgentRegistry.ZeroAddress.selector);
        registry.setErc20Factory(address(0));
    }

    function test_setErc20Factory_revertIfNotOwner() public {
        MockERC20FactoryCreate2 factory = new MockERC20FactoryCreate2();

        vm.prank(alice);
        vm.expectRevert();
        registry.setErc20Factory(address(factory));
    }

    function test_registerAgent_deploysShareTokenEagerly() public {
        MockERC20FactoryCreate2 factory = new MockERC20FactoryCreate2();
        vm.prank(owner);
        registry.setErc20Factory(address(factory));

        uint256 agentId = _registerAgent(creator, agentWallet1, 500);

        address token = registry.getAgentShareToken(agentId);
        assertTrue(token != address(0), "share token created");
        // Predicted matches what was deployed
        address predicted = registry.computeAgentShareToken(agentId);
        assertEq(token, predicted, "predicted == deployed");
    }

    function test_registerAgent_skipsShareTokenWhenFactoryUnset() public {
        uint256 agentId = _registerAgent(creator, agentWallet1, 500);
        assertEq(registry.getAgentShareToken(agentId), address(0));
    }

    function test_agentShareToken_uniquePerAgent() public {
        MockERC20FactoryCreate2 factory = new MockERC20FactoryCreate2();
        vm.prank(owner);
        registry.setErc20Factory(address(factory));

        uint256 id1 = _registerAgent(creator, agentWallet1, 500);
        uint256 id2 = _registerAgent(alice, agentWallet2, 800);

        address t1 = registry.getAgentShareToken(id1);
        address t2 = registry.getAgentShareToken(id2);

        assertTrue(t1 != address(0));
        assertTrue(t2 != address(0));
        assertTrue(t1 != t2, "different agents -> different tokens");
    }

    function test_computeAgentShareToken_revertsWhenFactoryUnset() public {
        vm.expectRevert(AgentRegistry.Erc20FactoryNotSet.selector);
        registry.computeAgentShareToken(1);
    }

    function test_shareToken_deterministicAcrossRegistries() public {
        // Two different registries + two different factories must produce two
        // different predicted addresses for the same agent id, demonstrating the
        // CREATE2 salt is composed of (msg.sender, salt) per the upstream factory.
        MockERC20FactoryCreate2 factoryA = new MockERC20FactoryCreate2();
        MockERC20FactoryCreate2 factoryB = new MockERC20FactoryCreate2();

        AgentRegistry regB = new AgentRegistry(owner, operator, REG_FEE, MIN_SUB);

        vm.prank(owner);
        registry.setErc20Factory(address(factoryA));

        vm.prank(owner);
        regB.setErc20Factory(address(factoryB));

        uint256 id1 = _registerAgent(creator, agentWallet1, 500);
        vm.prank(creator);
        uint256 id2 = regB.registerAgent{value: REG_FEE}(agentWallet1, "ipfs://s", 500);

        assertEq(id1, id2, "same id scheme");
        assertTrue(
            registry.getAgentShareToken(id1) != regB.getAgentShareToken(id2),
            "different registries deploy to different addresses"
        );
    }

    // ==================== Helpers ====================

    function _registerAgent(address _creator, address _wallet, uint16 feeBps) internal returns (uint256) {
        vm.prank(_creator);
        return registry.registerAgent{value: REG_FEE}(_wallet, "ipfs://strategy", feeBps);
    }
}

/// @dev Mock ERC20Factory that mimics the Initia factory's CREATE2 salt composition.
///      Deploys a minimal placeholder contract per call so each agent id maps to a
///      unique, caller-scoped address. Also exposes `computeERC20Address` for the
///      registry's `computeAgentShareToken` pass-through.
contract MockERC20FactoryCreate2 {
    event Created(address token, bytes32 salt);

    function createERC20(string memory, string memory, uint8) external returns (address token) {
        // Non-deterministic fallback used only by legacy paths; keep deterministic
        // for test stability by hashing the nonce.
        token = _deployDummy(keccak256(abi.encodePacked(msg.sender, "plain")));
    }

    function createERC20WithSalt(
        string memory name,
        string memory symbol,
        uint8 decimals,
        bytes32 salt
    ) external returns (address token) {
        bytes32 finalSalt = keccak256(abi.encodePacked(msg.sender, salt));
        bytes memory bytecode = _initCode(name, symbol, decimals);
        assembly {
            token := create2(0, add(bytecode, 0x20), mload(bytecode), finalSalt)
        }
        require(token != address(0), "create2 failed");
        emit Created(token, finalSalt);
    }

    function computeERC20Address(
        address creator,
        string memory name,
        string memory symbol,
        uint8 decimals,
        bytes32 salt
    ) external view returns (address) {
        bytes32 finalSalt = keccak256(abi.encodePacked(creator, salt));
        bytes32 codeHash = keccak256(_initCode(name, symbol, decimals));
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            finalSalt,
            codeHash
        )))));
    }

    function _deployDummy(bytes32 salt) internal returns (address out) {
        bytes memory bytecode = hex"6080604052600080fdfea26469706673";
        assembly {
            out := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        }
    }

    function _initCode(string memory name, string memory symbol, uint8 decimals)
        internal
        pure
        returns (bytes memory)
    {
        // Use name/symbol/decimals as constructor args so they affect the codehash,
        // matching the Initia factory's property that changing any of them produces
        // a different CREATE2 address.
        return abi.encodePacked(
            type(DummyERC20).creationCode,
            abi.encode(name, symbol, decimals)
        );
    }
}

/// @dev Minimal payload contract used by MockERC20FactoryCreate2. We only care
///      about the bytecode hash + constructor args; no ERC20 behavior needed.
contract DummyERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }
}
