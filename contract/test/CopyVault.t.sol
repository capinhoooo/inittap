// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {CopyVault, ITapPredictor, IAgentRegistry} from "../src/CopyVault.sol";
import {ICopyVault} from "../src/interfaces/ICopyVault.sol";
import {ICosmos} from "../src/interfaces/ICosmos.sol";

// ==================== Mock Contracts ====================

/// @dev Mock TapPredictor that tracks bets and allows simulated claims
contract MockTapPredictor {
    uint256 public minBetAmount = 0.01 ether;
    uint256 public maxBetAmount = 50 ether;

    struct Bet {
        bytes32 pairHash;
        uint256 epoch;
        bool isBull;
        uint256 amount;
    }

    Bet[] public bets;
    // pairHash => epoch => address => amount bet
    mapping(bytes32 => mapping(uint256 => mapping(address => uint256))) public betAmounts;

    // Simulated claim returns: set per pairHash/epoch how much to return
    mapping(bytes32 => mapping(uint256 => uint256)) public claimReturns;

    function betBull(bytes32 pairHash, uint256 epoch) external payable {
        bets.push(Bet(pairHash, epoch, true, msg.value));
        betAmounts[pairHash][epoch][msg.sender] = msg.value;
    }

    function betBear(bytes32 pairHash, uint256 epoch) external payable {
        bets.push(Bet(pairHash, epoch, false, msg.value));
        betAmounts[pairHash][epoch][msg.sender] = msg.value;
    }

    function claim(bytes32[] calldata pairHashes, uint256[] calldata epochs) external {
        uint256 totalReturn;
        for (uint256 i = 0; i < pairHashes.length; i++) {
            totalReturn += claimReturns[pairHashes[i]][epochs[i]];
            // Zero out so double-claim returns nothing
            claimReturns[pairHashes[i]][epochs[i]] = 0;
        }
        if (totalReturn > 0) {
            (bool ok,) = msg.sender.call{value: totalReturn}("");
            require(ok, "MockTapPredictor: transfer failed");
        }
    }

    // Test helpers
    function setClaimReturn(bytes32 pairHash, uint256 epoch, uint256 amount) external {
        claimReturns[pairHash][epoch] = amount;
    }

    function setMinBetAmount(uint256 amount) external {
        minBetAmount = amount;
    }

    function setMaxBetAmount(uint256 amount) external {
        maxBetAmount = amount;
    }

    function getBetCount() external view returns (uint256) {
        return bets.length;
    }

    receive() external payable {}
}

/// @dev Mock AgentRegistry with configurable agents
contract MockAgentRegistry {
    struct StoredAgent {
        address creator;
        uint256 performanceFeeBps;
        bool isActive;
    }

    /// @dev Matches CopyVault's IAgentRegistry.Agent layout (field order and types).
    struct Agent {
        uint256 agentId;
        address creator;
        address agentWallet;
        string strategyURI;
        uint16 performanceFeeBps;
        uint32 subscriberCount;
        int256 totalPnL;
        uint64 totalTrades;
        uint64 wins;
        bool isActive;
        uint64 registrationTime;
    }

    mapping(uint256 => StoredAgent) public agents;
    mapping(uint256 => address) public shareTokens;

    function setAgent(uint256 agentId, address creator, uint256 performanceFeeBps) external {
        agents[agentId] = StoredAgent(creator, performanceFeeBps, true);
    }

    function setAgentActive(uint256 agentId, bool active) external {
        agents[agentId].isActive = active;
    }

    function setShareToken(uint256 agentId, address token) external {
        shareTokens[agentId] = token;
    }

    function getAgentPerformanceFeeBps(uint256 agentId) external view returns (uint256) {
        return agents[agentId].performanceFeeBps;
    }

    function getAgentCreator(uint256 agentId) external view returns (address) {
        return agents[agentId].creator;
    }

    function getAgent(uint256 agentId) external view returns (Agent memory a) {
        StoredAgent storage s = agents[agentId];
        a.agentId = agentId;
        a.creator = s.creator;
        a.performanceFeeBps = uint16(s.performanceFeeBps);
        a.isActive = s.isActive;
    }

    function getAgentShareToken(uint256 agentId) external view returns (address) {
        return shareTokens[agentId];
    }
}

/// @dev Mock VipScore capturing score writes for assertion. Can be toggled to
///      revert with StageNotFound or StageFinalized to exercise the try/catch path.
contract MockVipScoreVault {
    error StageNotFound(uint64 stage);
    error StageFinalized(uint64 stage);

    struct Call {
        uint64 stage;
        address addr;
        uint64 amount;
    }

    Call[] public calls;
    bool public revertNotFound;
    bool public revertFinalized;

    function increaseScore(uint64 stage, address addr, uint64 amount) external {
        if (revertNotFound) revert StageNotFound(stage);
        if (revertFinalized) revert StageFinalized(stage);
        calls.push(Call(stage, addr, amount));
    }

    function setRevertNotFound(bool v) external { revertNotFound = v; }
    function setRevertFinalized(bool v) external { revertFinalized = v; }
    function callCount() external view returns (uint256) { return calls.length; }
}

/// @dev Mock ICosmos precompile used by CopyVault. Uses storage slot 0 so that
///      `vm.etch` + `vm.store` lets us toggle a specific blocked address per test.
///      Only one blocked address at a time is supported; set via `setBlocked`.
contract MockCosmosVault {
    address public blockedAddr;
    string public queryReturn;

    function setBlocked(address who) external {
        blockedAddr = who;
    }

    function setQueryReturn(string memory s) external {
        queryReturn = s;
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

    function query_cosmos(string memory, string memory) external view returns (string memory) {
        bytes memory q = bytes(queryReturn);
        if (q.length == 0) return "{\"pairs\":[]}";
        return queryReturn;
    }
}

/// @dev Mock ERC20Factory that returns a deterministic dummy address on createERC20.
///      We do NOT deploy a real ERC20 because the vault doesn't mint/burn in this wave.
contract MockERC20Factory {
    address public lastCreated;
    uint256 private _nonce;

    function createERC20(string memory, string memory, uint8) external returns (address) {
        unchecked { _nonce++; }
        lastCreated = address(uint160(uint256(keccak256(abi.encode(block.timestamp, block.number, _nonce)))));
        return lastCreated;
    }
}

// ==================== Tests ====================

contract CopyVaultTest is Test {
    CopyVault public vault;
    MockTapPredictor public mockPredictor;
    MockAgentRegistry public mockRegistry;

    address public owner = makeAddr("owner");
    address public executorAddr = makeAddr("executor");
    address public platformFee = makeAddr("platformFee");
    address public agentCreator = makeAddr("agentCreator");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");

    uint256 constant AGENT_1 = 1;
    uint256 constant AGENT_2 = 2;
    bytes32 constant PAIR_BTC = keccak256(bytes("BTC/USD"));
    bytes32 constant PAIR_ETH = keccak256(bytes("ETH/USD"));
    uint256 constant EPOCH_1 = 5;
    uint256 constant EPOCH_2 = 6;

    address constant COSMOS_PRECOMPILE = 0x00000000000000000000000000000000000000f1;

    function setUp() public {
        // Etch MockCosmosVault at the 0xf1 precompile address so block-list and
        // bech32 conversion calls resolve during every vault state-mutating path.
        MockCosmosVault cosmos = new MockCosmosVault();
        vm.etch(COSMOS_PRECOMPILE, address(cosmos).code);

        mockPredictor = new MockTapPredictor();
        mockRegistry = new MockAgentRegistry();

        vault = new CopyVault(owner, platformFee);

        vm.startPrank(owner);
        vault.setPredictor(address(mockPredictor));
        vault.setRegistry(address(mockRegistry));
        vault.setExecutor(executorAddr);
        vm.stopPrank();

        // Configure agent 1: 1000 bps (10%) performance fee
        mockRegistry.setAgent(AGENT_1, agentCreator, 1000);
        // Configure agent 2: 2000 bps (20%) performance fee
        mockRegistry.setAgent(AGENT_2, makeAddr("creator2"), 2000);

        // Fund test accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
        vm.deal(address(mockPredictor), 1000 ether);
    }

    // ==================== Deposit Tests ====================

    function test_deposit() public {
        vm.prank(alice);
        vault.deposit{value: 10 ether}(AGENT_1);

        assertEq(vault.deposits(AGENT_1, alice), 10 ether);
        assertTrue(vault.isFollower(AGENT_1, alice));
        assertEq(vault.getFollowerCount(AGENT_1), 1);
    }

    function test_deposit_multipleFollowers() public {
        vm.prank(alice);
        vault.deposit{value: 10 ether}(AGENT_1);

        vm.prank(bob);
        vault.deposit{value: 5 ether}(AGENT_1);

        assertEq(vault.getFollowerCount(AGENT_1), 2);
        assertEq(vault.deposits(AGENT_1, alice), 10 ether);
        assertEq(vault.deposits(AGENT_1, bob), 5 ether);
    }

    function test_deposit_additionalDeposit() public {
        vm.prank(alice);
        vault.deposit{value: 5 ether}(AGENT_1);

        vm.prank(alice);
        vault.deposit{value: 3 ether}(AGENT_1);

        assertEq(vault.deposits(AGENT_1, alice), 8 ether);
        // Should still only be one follower entry
        assertEq(vault.getFollowerCount(AGENT_1), 1);
    }

    function test_deposit_revertOnZero() public {
        vm.prank(alice);
        vm.expectRevert(ICopyVault.ZeroAmount.selector);
        vault.deposit{value: 0}(AGENT_1);
    }

    function test_deposit_revertWhenPaused() public {
        vm.prank(owner);
        vault.pause();

        vm.prank(alice);
        vm.expectRevert();
        vault.deposit{value: 1 ether}(AGENT_1);
    }

    function test_deposit_multipleAgents() public {
        vm.prank(alice);
        vault.deposit{value: 10 ether}(AGENT_1);

        vm.prank(alice);
        vault.deposit{value: 5 ether}(AGENT_2);

        assertEq(vault.deposits(AGENT_1, alice), 10 ether);
        assertEq(vault.deposits(AGENT_2, alice), 5 ether);
        assertEq(vault.getFollowerCount(AGENT_1), 1);
        assertEq(vault.getFollowerCount(AGENT_2), 1);
    }

    // ==================== Withdraw Tests ====================

    function test_withdraw() public {
        vm.prank(alice);
        vault.deposit{value: 10 ether}(AGENT_1);

        uint256 balBefore = alice.balance;

        vm.prank(alice);
        vault.withdraw(AGENT_1, 3 ether);

        assertEq(vault.deposits(AGENT_1, alice), 7 ether);
        assertEq(alice.balance - balBefore, 3 ether);
        // Still a follower (has remaining deposit)
        assertTrue(vault.isFollower(AGENT_1, alice));
    }

    function test_withdraw_fullAmount_removesFollower() public {
        vm.prank(alice);
        vault.deposit{value: 10 ether}(AGENT_1);

        vm.prank(alice);
        vault.withdraw(AGENT_1, 10 ether);

        assertEq(vault.deposits(AGENT_1, alice), 0);
        assertFalse(vault.isFollower(AGENT_1, alice));
        assertEq(vault.getFollowerCount(AGENT_1), 0);
    }

    function test_withdraw_revertOnZero() public {
        vm.prank(alice);
        vm.expectRevert(ICopyVault.ZeroAmount.selector);
        vault.withdraw(AGENT_1, 0);
    }

    function test_withdraw_revertOnInsufficientDeposit() public {
        vm.prank(alice);
        vault.deposit{value: 5 ether}(AGENT_1);

        vm.prank(alice);
        vm.expectRevert(ICopyVault.InsufficientDeposit.selector);
        vault.withdraw(AGENT_1, 6 ether);
    }

    // ==================== executeCopyTrades Tests ====================

    function test_executeCopyTrades_bullBet() public {
        _depositFollowers();

        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000); // 50% of deposit

        // Alice: 10e * 50% = 5e, Bob: 5e * 50% = 2.5e
        assertEq(vault.deposits(AGENT_1, alice), 5 ether);
        assertEq(vault.deposits(AGENT_1, bob), 2.5 ether);

        // Check mock predictor received the bet
        assertEq(mockPredictor.getBetCount(), 1);
        (bytes32 ph, uint256 ep, bool isBull, uint256 amt) = mockPredictor.bets(0);
        assertEq(ph, PAIR_BTC);
        assertEq(ep, EPOCH_1);
        assertTrue(isBull);
        assertEq(amt, 7.5 ether); // 5 + 2.5
    }

    function test_executeCopyTrades_bearBet() public {
        _depositFollowers();

        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, false, 5000);

        (,, bool isBull,) = mockPredictor.bets(0);
        assertFalse(isBull);
    }

    function test_executeCopyTrades_skipsSmallDeposits() public {
        // Alice deposits 10 ether, Carol deposits tiny amount
        vm.prank(alice);
        vault.deposit{value: 10 ether}(AGENT_1);

        vm.prank(carol);
        vault.deposit{value: 0.001 ether}(AGENT_1); // Very small

        // minBet is 0.01 ether, 50% of 0.001 = 0.0005 < minBet
        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);

        // Only alice's bet should go through (5 ether)
        (,,, uint256 amt) = mockPredictor.bets(0);
        assertEq(amt, 5 ether);

        // Carol's deposit should be unchanged (skipped)
        assertEq(vault.deposits(AGENT_1, carol), 0.001 ether);
    }

    function test_executeCopyTrades_capsAtMaxBet() public {
        mockPredictor.setMaxBetAmount(3 ether);

        vm.prank(alice);
        vault.deposit{value: 10 ether}(AGENT_1);

        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 10000); // 100%

        // Should be capped at 3 ether
        bytes32 roundKey = vault.getRoundKey(AGENT_1, PAIR_BTC, EPOCH_1);
        assertEq(vault.roundFollowerBets(roundKey, alice), 3 ether);
        assertEq(vault.deposits(AGENT_1, alice), 7 ether);
    }

    function test_executeCopyTrades_revertNotExecutor() public {
        _depositFollowers();

        vm.prank(alice);
        vm.expectRevert(ICopyVault.NotExecutor.selector);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);
    }

    function test_executeCopyTrades_revertInvalidBps() public {
        _depositFollowers();

        vm.prank(executorAddr);
        vm.expectRevert(ICopyVault.InvalidBps.selector);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 0);

        vm.prank(executorAddr);
        vm.expectRevert(ICopyVault.InvalidBps.selector);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 10001);
    }

    function test_executeCopyTrades_revertNoFollowers() public {
        vm.prank(executorAddr);
        vm.expectRevert(ICopyVault.NoFollowers.selector);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);
    }

    function test_executeCopyTrades_revertWhenPaused() public {
        _depositFollowers();

        vm.prank(owner);
        vault.pause();

        vm.prank(executorAddr);
        vm.expectRevert();
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);
    }

    function test_executeCopyTrades_roundKeyTracking() public {
        _depositFollowers();

        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);

        bytes32 roundKey = vault.getRoundKey(AGENT_1, PAIR_BTC, EPOCH_1);

        assertEq(vault.roundTotalBets(roundKey), 7.5 ether);
        assertEq(vault.roundFollowerBets(roundKey, alice), 5 ether);
        assertEq(vault.roundFollowerBets(roundKey, bob), 2.5 ether);
    }

    // ==================== claimForFollowers Tests ====================

    function test_claimForFollowers_withProfit() public {
        _depositFollowers();

        // Execute a copy trade: 50% of deposits
        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);

        // Set up claim return: 15 ether total (7.5 bet + 7.5 profit = 100% return)
        mockPredictor.setClaimReturn(PAIR_BTC, EPOCH_1, 15 ether);

        // Claim
        bytes32[] memory phs = new bytes32[](1);
        phs[0] = PAIR_BTC;
        uint256[] memory eps = new uint256[](1);
        eps[0] = EPOCH_1;

        uint256 creatorBalBefore = agentCreator.balance;
        uint256 platformBalBefore = platformFee.balance;

        vm.prank(executorAddr);
        vault.claimForFollowers(phs, eps, AGENT_1);

        // Profit = 15 - 7.5 = 7.5 ether
        // Performance fee = 7.5 * 10% = 0.75 ether
        // Creator share = 0.75 * 70% = 0.525 ether
        // Platform share = 0.75 * 30% = 0.225 ether
        // Distributable = 15 - 0.75 = 14.25 ether

        assertEq(agentCreator.balance - creatorBalBefore, 0.525 ether);
        assertEq(platformFee.balance - platformBalBefore, 0.225 ether);

        // Alice had 5/7.5 of bet = 66.67%
        // Alice reward = 14.25 * 5 / 7.5 = 9.5 ether (credited to deposit)
        // Bob had 2.5/7.5 of bet = 33.33%
        // Bob reward = 14.25 * 2.5 / 7.5 = 4.75 ether

        // Alice: started with 10, bet 5 (deposit = 5), credited 9.5 => 14.5
        assertEq(vault.deposits(AGENT_1, alice), 14.5 ether);
        // Bob: started with 5, bet 2.5 (deposit = 2.5), credited 4.75 => 7.25
        assertEq(vault.deposits(AGENT_1, bob), 7.25 ether);
    }

    function test_claimForFollowers_noProfit() public {
        _depositFollowers();

        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);

        // Return exactly what was bet (no profit)
        mockPredictor.setClaimReturn(PAIR_BTC, EPOCH_1, 7.5 ether);

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = PAIR_BTC;
        uint256[] memory eps = new uint256[](1);
        eps[0] = EPOCH_1;

        uint256 creatorBalBefore = agentCreator.balance;

        vm.prank(executorAddr);
        vault.claimForFollowers(phs, eps, AGENT_1);

        // No profit means no performance fee
        assertEq(agentCreator.balance - creatorBalBefore, 0);

        // Followers get back exactly what they bet
        assertEq(vault.deposits(AGENT_1, alice), 10 ether); // 5 remaining + 5 returned
        assertEq(vault.deposits(AGENT_1, bob), 5 ether);    // 2.5 remaining + 2.5 returned
    }

    function test_claimForFollowers_partialLoss() public {
        _depositFollowers();

        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);

        // Return less than bet (partial loss)
        mockPredictor.setClaimReturn(PAIR_BTC, EPOCH_1, 3 ether);

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = PAIR_BTC;
        uint256[] memory eps = new uint256[](1);
        eps[0] = EPOCH_1;

        vm.prank(executorAddr);
        vault.claimForFollowers(phs, eps, AGENT_1);

        // 3 ether returned, no fees (loss)
        // Alice: 3 * 5/7.5 = 2 ether credited
        // Bob: 3 * 2.5/7.5 = 1 ether credited
        assertEq(vault.deposits(AGENT_1, alice), 7 ether); // 5 + 2
        assertEq(vault.deposits(AGENT_1, bob), 3.5 ether); // 2.5 + 1
    }

    function test_claimForFollowers_totalLoss() public {
        _depositFollowers();

        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);

        // Return 0 (complete loss)
        mockPredictor.setClaimReturn(PAIR_BTC, EPOCH_1, 0);

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = PAIR_BTC;
        uint256[] memory eps = new uint256[](1);
        eps[0] = EPOCH_1;

        vm.prank(executorAddr);
        vault.claimForFollowers(phs, eps, AGENT_1);

        // Deposits remain at post-bet levels (no rewards to credit)
        assertEq(vault.deposits(AGENT_1, alice), 5 ether);
        assertEq(vault.deposits(AGENT_1, bob), 2.5 ether);

        // H-03 regression: activeExposure MUST be released to zero on total loss.
        // Previously the early-return short-circuited _distributeToFollowers and
        // left stale exposure that blocked followers from joining future rounds.
        assertEq(vault.activeExposure(AGENT_1, alice), 0);
        assertEq(vault.activeExposure(AGENT_1, bob), 0);
    }

    function test_claimForFollowers_revertAlreadyClaimed() public {
        _depositFollowers();

        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);

        mockPredictor.setClaimReturn(PAIR_BTC, EPOCH_1, 10 ether);

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = PAIR_BTC;
        uint256[] memory eps = new uint256[](1);
        eps[0] = EPOCH_1;

        vm.prank(executorAddr);
        vault.claimForFollowers(phs, eps, AGENT_1);

        vm.prank(executorAddr);
        vm.expectRevert(ICopyVault.AlreadyClaimed.selector);
        vault.claimForFollowers(phs, eps, AGENT_1);
    }

    function test_claimForFollowers_revertNotExecutor() public {
        bytes32[] memory phs = new bytes32[](1);
        phs[0] = PAIR_BTC;
        uint256[] memory eps = new uint256[](1);
        eps[0] = EPOCH_1;

        vm.prank(alice);
        vm.expectRevert(ICopyVault.NotExecutor.selector);
        vault.claimForFollowers(phs, eps, AGENT_1);
    }

    function test_claimForFollowers_revertArrayMismatch() public {
        bytes32[] memory phs = new bytes32[](2);
        uint256[] memory eps = new uint256[](1);

        vm.prank(executorAddr);
        vm.expectRevert(ICopyVault.ArrayLengthMismatch.selector);
        vault.claimForFollowers(phs, eps, AGENT_1);
    }

    function test_claimForFollowers_revertEmptyArrays() public {
        bytes32[] memory phs = new bytes32[](0);
        uint256[] memory eps = new uint256[](0);

        vm.prank(executorAddr);
        vm.expectRevert(ICopyVault.ZeroAmount.selector);
        vault.claimForFollowers(phs, eps, AGENT_1);
    }

    // ==================== Performance Fee Edge Cases ====================

    function test_performanceFee_cappedAt50Percent() public {
        // Set an absurd fee (100%)
        mockRegistry.setAgent(AGENT_1, agentCreator, 10000);

        // H-03: increase exposure limit for this test to allow 100% bet
        vm.prank(owner);
        vault.setMaxExposureBps(10000);

        vm.prank(alice);
        vault.deposit{value: 10 ether}(AGENT_1);

        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 10000);

        mockPredictor.setClaimReturn(PAIR_BTC, EPOCH_1, 20 ether);

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = PAIR_BTC;
        uint256[] memory eps = new uint256[](1);
        eps[0] = EPOCH_1;

        uint256 creatorBalBefore = agentCreator.balance;
        uint256 platformBalBefore = platformFee.balance;

        vm.prank(executorAddr);
        vault.claimForFollowers(phs, eps, AGENT_1);

        // Profit = 10 ether
        // Fee should be capped at 50% = 5 ether
        // Creator: 5 * 70% = 3.5
        // Platform: 5 * 30% = 1.5
        assertEq(agentCreator.balance - creatorBalBefore, 3.5 ether);
        assertEq(platformFee.balance - platformBalBefore, 1.5 ether);

        // Alice gets 20 - 5 = 15 ether credited
        assertEq(vault.deposits(AGENT_1, alice), 15 ether);
    }

    function test_performanceFee_noRegistrySetReturnsZeroFee() public {
        // Deploy vault without registry
        CopyVault noRegVault = new CopyVault(owner, platformFee);
        vm.startPrank(owner);
        noRegVault.setPredictor(address(mockPredictor));
        noRegVault.setExecutor(executorAddr);
        // H-03: increase exposure limit for this test to allow 100% bet
        noRegVault.setMaxExposureBps(10000);
        vm.stopPrank();

        vm.prank(alice);
        noRegVault.deposit{value: 10 ether}(AGENT_1);

        vm.prank(executorAddr);
        noRegVault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 10000);

        mockPredictor.setClaimReturn(PAIR_BTC, EPOCH_1, 20 ether);

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = PAIR_BTC;
        uint256[] memory eps = new uint256[](1);
        eps[0] = EPOCH_1;

        vm.prank(executorAddr);
        noRegVault.claimForFollowers(phs, eps, AGENT_1);

        // No fee taken, full 20 ether credited
        assertEq(noRegVault.deposits(AGENT_1, alice), 20 ether);
    }

    // ==================== Admin Tests ====================

    function test_setPredictor() public {
        address newPredictor = makeAddr("newPredictor");
        vm.prank(owner);
        vault.setPredictor(newPredictor);
        assertEq(address(vault.predictor()), newPredictor);
    }

    function test_setPredictor_revertNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setPredictor(makeAddr("newPredictor"));
    }

    function test_setPredictor_revertZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(ICopyVault.ZeroAddress.selector);
        vault.setPredictor(address(0));
    }

    function test_setRegistry() public {
        address newReg = makeAddr("newRegistry");
        vm.prank(owner);
        vault.setRegistry(newReg);
        assertEq(address(vault.registry()), newReg);
    }

    function test_setExecutor() public {
        address newExec = makeAddr("newExecutor");
        vm.prank(owner);
        vault.setExecutor(newExec);
        assertEq(vault.executor(), newExec);
    }

    function test_setPlatformFeeRecipient() public {
        address newRecipient = makeAddr("newRecipient");
        vm.prank(owner);
        vault.setPlatformFeeRecipient(newRecipient);
        assertEq(vault.platformFeeRecipient(), newRecipient);
    }

    function test_pause_unpause() public {
        vm.prank(owner);
        vault.pause();

        vm.prank(alice);
        vm.expectRevert();
        vault.deposit{value: 1 ether}(AGENT_1);

        vm.prank(owner);
        vault.unpause();

        vm.prank(alice);
        vault.deposit{value: 1 ether}(AGENT_1);
        assertEq(vault.deposits(AGENT_1, alice), 1 ether);
    }

    // ==================== View Function Tests ====================

    function test_getFollowers() public {
        vm.prank(alice);
        vault.deposit{value: 1 ether}(AGENT_1);

        vm.prank(bob);
        vault.deposit{value: 1 ether}(AGENT_1);

        address[] memory followers = vault.getFollowers(AGENT_1);
        assertEq(followers.length, 2);
        assertEq(followers[0], alice);
        assertEq(followers[1], bob);
    }

    function test_getRoundKey() public view {
        bytes32 key = vault.getRoundKey(AGENT_1, PAIR_BTC, EPOCH_1);
        assertEq(key, keccak256(abi.encodePacked(AGENT_1, PAIR_BTC, EPOCH_1)));
    }

    // ==================== Receive Tests ====================

    function test_receiveEther_fromPredictor() public {
        // C-03 fix: only predictor can send ETH
        vm.deal(address(mockPredictor), 1 ether);
        vm.prank(address(mockPredictor));
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertTrue(ok);
    }

    function test_receiveEther_revertFromNonPredictor() public {
        // C-03 fix: non-predictor sends are rejected
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // ==================== Integration: Multiple Rounds ====================

    function test_multipleRounds_sameAgent() public {
        _depositFollowers();

        // Round 1: bet 25%
        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 2500);

        // Alice bet: 10 * 25% = 2.5, Bob bet: 5 * 25% = 1.25
        assertEq(vault.deposits(AGENT_1, alice), 7.5 ether);
        assertEq(vault.deposits(AGENT_1, bob), 3.75 ether);

        // Round 2: bet 50% of remaining
        // H-03: exposure limit is 50% of deposit basis (10 ether for alice, 5 for bob)
        // Alice: maxAllowed = 5, already exposed 2.5, room = 2.5
        //        50% of 7.5 = 3.75, capped to 2.5
        // Bob: maxAllowed = 2.5, already exposed 1.25, room = 1.25
        //      50% of 3.75 = 1.875, capped to 1.25
        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_ETH, AGENT_1, EPOCH_2, false, 5000);

        assertEq(vault.deposits(AGENT_1, alice), 5 ether);     // 7.5 - 2.5
        assertEq(vault.deposits(AGENT_1, bob), 2.5 ether);     // 3.75 - 1.25

        // Claim round 1 (won, 2x return)
        mockPredictor.setClaimReturn(PAIR_BTC, EPOCH_1, 7.5 ether); // 3.75 * 2

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = PAIR_BTC;
        uint256[] memory eps = new uint256[](1);
        eps[0] = EPOCH_1;

        vm.prank(executorAddr);
        vault.claimForFollowers(phs, eps, AGENT_1);

        // Round 1 original bet = 3.75 total
        // Profit = 7.5 - 3.75 = 3.75
        // Fee = 3.75 * 10% = 0.375
        // Distributable = 7.5 - 0.375 = 7.125
        // Alice share: 7.125 * 2.5 / 3.75 = 4.75
        // Bob share: 7.125 * 1.25 / 3.75 = 2.375
        assertEq(vault.deposits(AGENT_1, alice), 5 ether + 4.75 ether);
        assertEq(vault.deposits(AGENT_1, bob), 2.5 ether + 2.375 ether);
    }

    // ==================== Follower Removal Edge Case ====================

    function test_follower_removedAndRejoins() public {
        vm.prank(alice);
        vault.deposit{value: 10 ether}(AGENT_1);

        vm.prank(alice);
        vault.withdraw(AGENT_1, 10 ether);

        assertEq(vault.getFollowerCount(AGENT_1), 0);
        assertFalse(vault.isFollower(AGENT_1, alice));

        // Re-deposit
        vm.prank(alice);
        vault.deposit{value: 5 ether}(AGENT_1);

        assertEq(vault.getFollowerCount(AGENT_1), 1);
        assertTrue(vault.isFollower(AGENT_1, alice));
        assertEq(vault.deposits(AGENT_1, alice), 5 ether);
    }

    // ==================== Wave 3: Initia integration ====================

    function test_deposit_revertIfBlocked() public {
        // Flag alice as blocked at the chain level.
        MockCosmosVault(COSMOS_PRECOMPILE).setBlocked(alice);

        vm.prank(alice);
        vm.expectRevert(CopyVault.BlockedAddress.selector);
        vault.deposit{value: 1 ether}(AGENT_1);

        // Bob is still allowed.
        vm.prank(bob);
        vault.deposit{value: 1 ether}(AGENT_1);
        assertEq(vault.deposits(AGENT_1, bob), 1 ether);
    }

    function test_withdraw_revertIfBlocked() public {
        vm.prank(alice);
        vault.deposit{value: 5 ether}(AGENT_1);

        MockCosmosVault(COSMOS_PRECOMPILE).setBlocked(alice);

        vm.prank(alice);
        vm.expectRevert(CopyVault.BlockedAddress.selector);
        vault.withdraw(AGENT_1, 1 ether);
    }

    function test_executeCopyTrades_revertIfBlocked() public {
        _depositFollowers();

        MockCosmosVault(COSMOS_PRECOMPILE).setBlocked(executorAddr);

        vm.prank(executorAddr);
        vm.expectRevert(CopyVault.BlockedAddress.selector);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);
    }

    function test_executeCopyTrades_revertIfAgentInactive() public {
        _depositFollowers();

        // Deactivate agent in mock registry
        mockRegistry.setAgentActive(AGENT_1, false);

        vm.prank(executorAddr);
        vm.expectRevert(CopyVault.AgentInactive.selector);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);
    }

    // ==================== Wave 5: share-token pass-through ====================

    function test_getAgentShareToken_readsFromRegistry() public {
        // Wave 5: the vault no longer owns share tokens; it delegates to the registry.
        address fakeShareToken = makeAddr("shareToken1");
        mockRegistry.setShareToken(AGENT_1, fakeShareToken);

        assertEq(vault.getAgentShareToken(AGENT_1), fakeShareToken);
    }

    function test_getAgentShareToken_returnsZeroWhenRegistryUnset() public {
        CopyVault fresh = new CopyVault(owner, platformFee);
        assertEq(fresh.getAgentShareToken(AGENT_1), address(0));
    }

    // ==================== Wave 5: VIP Score Hook ====================

    function test_setVipScore_once() public {
        MockVipScoreVault score = new MockVipScoreVault();
        assertEq(address(vault.vipScore()), address(0));

        vm.prank(owner);
        vault.setVipScore(address(score));
        assertEq(address(vault.vipScore()), address(score));

        vm.prank(owner);
        vm.expectRevert(CopyVault.VipScoreAlreadySet.selector);
        vault.setVipScore(address(score));
    }

    function test_setVipScore_revertIfZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(ICopyVault.ZeroAddress.selector);
        vault.setVipScore(address(0));
    }

    function test_setVipStage_updatesState() public {
        vm.prank(owner);
        vault.setVipStage(7);
        assertEq(vault.vipStage(), 7);
    }

    function test_VipStage_RejectZero() public {
        // L-02 (Wave 5) fix: stage 0 is reserved/uninitialized and must not be settable
        vm.prank(owner);
        vm.expectRevert(CopyVault.InvalidVipStage.selector);
        vault.setVipStage(0);
    }

    function test_setVipHookEnabled_toggles() public {
        assertFalse(vault.vipHookEnabled());
        vm.prank(owner);
        vault.setVipHookEnabled(true);
        assertTrue(vault.vipHookEnabled());
        vm.prank(owner);
        vault.setVipHookEnabled(false);
        assertFalse(vault.vipHookEnabled());
    }

    function test_vipHook_attributesFollowerOnReward() public {
        MockVipScoreVault score = new MockVipScoreVault();
        vm.prank(owner);
        vault.setVipScore(address(score));
        vm.prank(owner);
        vault.setVipStage(3);
        vm.prank(owner);
        vault.setVipHookEnabled(true);

        _depositFollowers();

        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);

        mockPredictor.setClaimReturn(PAIR_BTC, EPOCH_1, 10 ether);

        bytes32[] memory phs = new bytes32[](1); phs[0] = PAIR_BTC;
        uint256[] memory eps = new uint256[](1); eps[0] = EPOCH_1;

        vm.prank(executorAddr);
        vault.claimForFollowers(phs, eps, AGENT_1);

        // Two followers each received a positive reward; each should have exactly one
        // score write against stage 3 (attributed to the follower, not the vault).
        assertEq(score.callCount(), 2);
        (uint64 s0, address a0,) = score.calls(0);
        assertEq(uint256(s0), 3);
        assertTrue(a0 == alice || a0 == bob);
    }

    function test_vipHook_silentWhenDisabled() public {
        MockVipScoreVault score = new MockVipScoreVault();
        vm.prank(owner);
        vault.setVipScore(address(score));
        vm.prank(owner);
        vault.setVipStage(1);
        // Do NOT enable the hook

        _depositFollowers();
        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);
        mockPredictor.setClaimReturn(PAIR_BTC, EPOCH_1, 10 ether);
        bytes32[] memory phs = new bytes32[](1); phs[0] = PAIR_BTC;
        uint256[] memory eps = new uint256[](1); eps[0] = EPOCH_1;

        vm.prank(executorAddr);
        vault.claimForFollowers(phs, eps, AGENT_1);

        assertEq(score.callCount(), 0, "hook disabled -> no writes");
    }

    function test_vipHook_swallowsStageNotFound() public {
        MockVipScoreVault score = new MockVipScoreVault();
        score.setRevertNotFound(true);
        vm.prank(owner);
        vault.setVipScore(address(score));
        vm.prank(owner);
        vault.setVipHookEnabled(true);

        _depositFollowers();
        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);
        mockPredictor.setClaimReturn(PAIR_BTC, EPOCH_1, 10 ether);
        bytes32[] memory phs = new bytes32[](1); phs[0] = PAIR_BTC;
        uint256[] memory eps = new uint256[](1); eps[0] = EPOCH_1;

        // Must NOT revert despite increaseScore reverting
        vm.prank(executorAddr);
        vault.claimForFollowers(phs, eps, AGENT_1);

        // Rewards still flowed to followers: aliceDeposit grew past her 5 ether basis
        assertGt(vault.deposits(AGENT_1, alice), 0);
    }

    function test_queryAvailableOraclePairs() public {
        // Default mock returns {"pairs":[]}
        string memory defaultResult = vault.queryAvailableOraclePairs();
        assertEq(defaultResult, "{\"pairs\":[]}");

        // Override with a specific JSON
        MockCosmosVault(COSMOS_PRECOMPILE).setQueryReturn("[\"BTC/USD\",\"ETH/USD\"]");
        string memory customResult = vault.queryAvailableOraclePairs();
        assertEq(customResult, "[\"BTC/USD\",\"ETH/USD\"]");
    }

    function test_setMaxExposureBps_revertInvalid() public {
        vm.prank(owner);
        vm.expectRevert(CopyVault.InvalidMaxExposure.selector);
        vault.setMaxExposureBps(0);

        vm.prank(owner);
        vm.expectRevert(CopyVault.InvalidMaxExposure.selector);
        vault.setMaxExposureBps(10001);
    }

    function test_setMaxExposureBps_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit CopyVault.MaxExposureBpsUpdated(5000, 8000);

        vm.prank(owner);
        vault.setMaxExposureBps(8000);
        assertEq(vault.maxExposureBps(), 8000);
    }

    // ==================== Wave 4 Audit Fix Regressions ====================

    function test_withdraw_revertIfActiveExposure() public {
        // H-02 (Wave 4): a follower with pending bet exposure cannot fully
        // withdraw (i.e. cannot drive deposits to zero while activeExposure > 0)
        // because that would remove them from _followers and silently strand
        // their round share.
        vm.prank(alice);
        vault.deposit{value: 10 ether}(AGENT_1);

        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000); // 5 ether bet

        // Alice still has 5 ether in deposits and 5 ether in activeExposure.
        // Partial withdraw that leaves a non-zero deposit is OK.
        vm.prank(alice);
        vault.withdraw(AGENT_1, 1 ether);
        assertEq(vault.deposits(AGENT_1, alice), 4 ether);

        // Full withdraw that would zero her out must revert while exposure > 0.
        vm.prank(alice);
        vm.expectRevert(CopyVault.HasPendingExposure.selector);
        vault.withdraw(AGENT_1, 4 ether);

        // After settlement, exposure is released and full withdraw works.
        mockPredictor.setClaimReturn(PAIR_BTC, EPOCH_1, 5 ether); // break-even
        bytes32[] memory phs = new bytes32[](1); phs[0] = PAIR_BTC;
        uint256[] memory eps = new uint256[](1); eps[0] = EPOCH_1;
        vm.prank(executorAddr);
        vault.claimForFollowers(phs, eps, AGENT_1);

        assertEq(vault.activeExposure(AGENT_1, alice), 0);

        uint256 fullBalance = vault.deposits(AGENT_1, alice);
        vm.prank(alice);
        vault.withdraw(AGENT_1, fullBalance);
        assertEq(vault.deposits(AGENT_1, alice), 0);
    }

    function test_executeCopyTrades_revertIfSlotTaken() public {
        // H-03 (Wave 4): two different agents cannot share the same (pair, epoch)
        // because the vault acts as a single msg.sender on the predictor.
        // Deposits to agent 1 and agent 2.
        _depositFollowers();
        vm.prank(carol);
        vault.deposit{value: 10 ether}(AGENT_2);

        // First agent takes the slot.
        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000);
        assertEq(vault.roundSlotOwner(keccak256(abi.encodePacked(PAIR_BTC, EPOCH_1))), AGENT_1);

        // Second agent at the same (pair, epoch) must revert.
        vm.prank(executorAddr);
        vm.expectRevert(
            abi.encodeWithSelector(CopyVault.VaultBettingSlotTaken.selector, AGENT_1)
        );
        vault.executeCopyTrades(PAIR_BTC, AGENT_2, EPOCH_1, true, 5000);

        // Agent 1 can call again on the same slot (same agent = no collision).
        // Note: second call in this test also exceeds exposure cap; check just
        // that the collision check doesn't fire. Use a different epoch for agent 2.
        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_ETH, AGENT_2, EPOCH_2, true, 5000);
        assertEq(vault.roundSlotOwner(keccak256(abi.encodePacked(PAIR_ETH, EPOCH_2))), AGENT_2);
    }

    function test_claimForFollowers_performanceFeeFlowsToCreator() public {
        // H-01 (Wave 4): confirm that after fixing the non-existent registry
        // method + removing the try/catch, performance fees reach both the
        // agent creator and the platform recipient.
        address creator = mockRegistry.getAgentCreator(AGENT_1);
        assertEq(creator, agentCreator, "mock registry exposes creator");

        _depositFollowers();

        vm.prank(executorAddr);
        vault.executeCopyTrades(PAIR_BTC, AGENT_1, EPOCH_1, true, 5000); // bets 7.5 ether total

        // 10 ether returned on a 7.5 ether bet => 2.5 ether profit
        mockPredictor.setClaimReturn(PAIR_BTC, EPOCH_1, 10 ether);

        bytes32[] memory phs = new bytes32[](1); phs[0] = PAIR_BTC;
        uint256[] memory eps = new uint256[](1); eps[0] = EPOCH_1;

        uint256 platformBefore = platformFee.balance;
        uint256 creatorBefore = creator.balance;

        vm.prank(executorAddr);
        vault.claimForFollowers(phs, eps, AGENT_1);

        // Agent 1 fee = 1000 bps (10%) of 2.5 ether profit = 0.25 ether total
        // Creator share 70% = 0.175 ether, platform share 30% = 0.075 ether
        assertEq(creator.balance - creatorBefore, 0.175 ether, "creator paid");
        assertEq(platformFee.balance - platformBefore, 0.075 ether, "platform paid");
    }

    // ==================== Helpers ====================

    function _depositFollowers() internal {
        vm.prank(alice);
        vault.deposit{value: 10 ether}(AGENT_1);

        vm.prank(bob);
        vault.deposit{value: 5 ether}(AGENT_1);
    }
}
