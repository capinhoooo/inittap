// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm, console} from "forge-std/Test.sol";
import {TapPredictor} from "../src/TapPredictor.sol";
import {IConnectOracle} from "@initia/interfaces/IConnectOracle.sol";
import {ICosmos} from "../src/interfaces/ICosmos.sol";

/// @dev Mock oracle supporting multiple pairs
contract MockOracle {
    mapping(bytes32 => int256) public prices;
    mapping(bytes32 => uint64) public nonces;
    mapping(bytes32 => uint64) public heights;

    function setPrice(string memory pair, int256 _price, uint64 _height) external {
        bytes32 key = keccak256(bytes(pair));
        prices[key] = _price;
        nonces[key]++;
        heights[key] = _height;
    }

    function get_price(string memory pair) external view returns (IConnectOracle.Price memory) {
        bytes32 key = keccak256(bytes(pair));
        return IConnectOracle.Price({
            price: uint256(prices[key]),
            timestamp: block.timestamp * 1e9,
            height: heights[key],
            nonce: nonces[key],
            decimal: 8,
            id: 1
        });
    }

    function get_prices(string[] memory pairs) external view returns (IConnectOracle.Price[] memory) {
        IConnectOracle.Price[] memory result = new IConnectOracle.Price[](pairs.length);
        for (uint256 i = 0; i < pairs.length; i++) {
            bytes32 key = keccak256(bytes(pairs[i]));
            result[i] = IConnectOracle.Price({
                price: uint256(prices[key]),
                timestamp: block.timestamp * 1e9,
                height: heights[key],
                nonce: nonces[key],
                decimal: 8,
                id: uint64(i + 1)
            });
        }
        return result;
    }

    function get_all_currency_pairs() external pure returns (string memory) {
        return '["BTC/USD","ETH/USD","SOL/USD"]';
    }
}

/// @dev Mock ICosmos precompile for testing OP bridge withdrawal
contract MockCosmos {
    string public lastMessage;
    uint64 public lastGasLimit;
    bool public shouldFail;

    function to_cosmos_address(address evm_address) external pure returns (string memory) {
        // Return a deterministic bech32-like string for testing
        return string(abi.encodePacked("init1mock", _toHexString(evm_address)));
    }

    function to_denom(address) external pure returns (string memory) {
        return "uinit";
    }

    function execute_cosmos(string memory msg_, uint64 gas_limit) external returns (bool) {
        lastMessage = msg_;
        lastGasLimit = gas_limit;
        if (shouldFail) return false;
        return true;
    }

    function execute_cosmos_with_options(string memory, uint64, ICosmos.Options memory) external pure returns (bool) {
        return true;
    }

    function is_blocked_address(address) external pure returns (bool) {
        return false;
    }

    function is_authority_address(address) external pure returns (bool) {
        return false;
    }

    function disable_execute_cosmos() external pure returns (bool) {
        return true;
    }

    function to_erc20(string memory) external pure returns (address) {
        return address(0);
    }

    function setFail(bool _fail) external {
        shouldFail = _fail;
    }

    function _toHexString(address addr) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes20 data = bytes20(addr);
        bytes memory str = new bytes(40);
        for (uint256 i = 0; i < 20; i++) {
            str[i * 2] = alphabet[uint8(data[i] >> 4)];
            str[1 + i * 2] = alphabet[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }
}

/// @dev Mock IJSONUtils precompile: merge_json returns concatenation for test purposes
contract MockJSONUtils {
    function merge_json(string memory dst, string memory src) external pure returns (string memory) {
        return string(abi.encodePacked(dst, src));
    }

    function stringify_json(string memory json) external pure returns (string memory) {
        return json;
    }
}

/// @dev Mock VipScore contract capturing increaseScore calls and optionally
///      reverting with one of the upstream errors to exercise the try/catch path.
contract MockVipScore {
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

/// @dev Mock ERC20Wrapper recording the last call + configurable revert modes.
contract MockERC20Wrapper {
    error Dust();

    string public lastReceiver;
    string public lastDenom;
    uint256 public lastAmount;
    uint64 public lastGasLimit;
    bool public revertOnCall;
    uint256 public callCount;

    function setRevertOnCall(bool v) external { revertOnCall = v; }

    function toRemoteAndOPWithdraw(
        string memory receiver,
        string memory localDenom,
        uint256 localAmount,
        uint64 gasLimit
    ) external {
        if (revertOnCall) revert Dust();
        if (localAmount % 1e12 != 0) revert Dust();
        lastReceiver = receiver;
        lastDenom = localDenom;
        lastAmount = localAmount;
        lastGasLimit = gasLimit;
        callCount++;
    }
}

/// @dev Mock VipScore that burns all remaining gas via `invalid()`. Used to
///      prove that the 80k gas stipend prevents a malicious/buggy scorer from
///      griefing the entire claim flow (try/catch does NOT catch OOG).
contract GasBurnScorer {
    function increaseScore(uint64, address, uint64) external pure {
        assembly {
            invalid()
        }
    }
}

contract TapPredictorTest is Test {
    TapPredictor public predictor;
    MockOracle public mockOracle;

    address public admin = makeAddr("admin");
    address public operator = makeAddr("operator");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    uint256 constant INTERVAL = 180;
    uint256 constant BUFFER = 30;
    uint256 constant MIN_BET = 0.1 ether;
    uint256 constant MAX_BET = 100 ether;
    uint256 constant TREASURY_FEE = 300;

    int256 constant BTC_PRICE = 7400000000000;
    int256 constant ETH_PRICE = 232740000000;
    int256 constant SOL_PRICE = 8337000000;

    bytes32 public btcHash;
    bytes32 public ethHash;
    bytes32 public solHash;

    // Explicit timestamps
    uint256 constant T0 = 1000;
    uint256 constant T1 = T0 + INTERVAL;
    uint256 constant T2 = T1 + INTERVAL;
    uint256 constant T3 = T2 + INTERVAL;
    uint256 constant T4 = T3 + INTERVAL;

    uint64 constant B0 = 10;
    uint64 constant B1 = 11;
    uint64 constant B2 = 12;
    uint64 constant B3 = 13;
    uint64 constant B4 = 14;

    function setUp() public {
        vm.warp(T0);
        vm.roll(B0);

        // Etch MockCosmos at the precompile address so block-list checks
        // and cosmos helper calls resolve during claim/treasury flows.
        MockCosmos mockCosmos = new MockCosmos();
        vm.etch(address(0x00000000000000000000000000000000000000f1), address(mockCosmos).code);

        mockOracle = new MockOracle();

        // Initialize oracle prices
        mockOracle.setPrice("BTC/USD", BTC_PRICE, B0);
        mockOracle.setPrice("ETH/USD", ETH_PRICE, B0);
        mockOracle.setPrice("SOL/USD", SOL_PRICE, B0);

        string[] memory pairs = new string[](3);
        pairs[0] = "BTC/USD";
        pairs[1] = "ETH/USD";
        pairs[2] = "SOL/USD";

        predictor = new TapPredictor(
            address(mockOracle),
            admin,
            operator,
            INTERVAL,
            BUFFER,
            MIN_BET,
            MAX_BET,
            TREASURY_FEE,
            pairs
        );

        btcHash = keccak256(bytes("BTC/USD"));
        ethHash = keccak256(bytes("ETH/USD"));
        solHash = keccak256(bytes("SOL/USD"));

        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    // ==================== Multi-Pair Tests ====================

    function test_activePairsCount() public view {
        assertEq(predictor.getActivePairsCount(), 3);
    }

    function test_pairHashes() public view {
        assertEq(predictor.getPairHash("BTC/USD"), btcHash);
        assertEq(predictor.getPairHash("ETH/USD"), ethHash);
    }

    function test_pairState() public view {
        (uint256 epoch,, bool started, bool locked, bool active) = predictor.pairState(btcHash);
        assertEq(epoch, 0);
        assertEq(started, false);
        assertEq(locked, false);
        assertEq(active, true);
    }

    // ==================== Genesis Tests ====================

    function test_genesisStartRound() public {
        vm.prank(operator);
        predictor.genesisStartRound(btcHash);

        (uint256 epoch,, bool started,,) = predictor.pairState(btcHash);
        assertEq(epoch, 1);
        assertEq(started, true);
    }

    function test_genesisStartRound_revertIfNotOperator() public {
        vm.prank(alice);
        vm.expectRevert(TapPredictor.NotOperator.selector);
        predictor.genesisStartRound(btcHash);
    }

    function test_genesisStartRound_revertIfInactivePair() public {
        bytes32 fakePair = keccak256(bytes("FAKE/USD"));
        vm.prank(operator);
        vm.expectRevert(TapPredictor.PairNotActive.selector);
        predictor.genesisStartRound(fakePair);
    }

    function test_genesisLockRound() public {
        vm.prank(operator);
        predictor.genesisStartRound(btcHash);

        vm.warp(T1);
        vm.roll(B1);
        mockOracle.setPrice("BTC/USD", BTC_PRICE + 100, B1);

        vm.prank(operator);
        predictor.genesisLockRound(btcHash);

        (uint256 epoch,, bool started, bool locked,) = predictor.pairState(btcHash);
        assertEq(epoch, 2);
        assertEq(started, true);
        assertEq(locked, true);
    }

    // ==================== Betting Tests (Multi-Pair) ====================

    function test_betBull_btc() public {
        _startGenesisPair(btcHash, "BTC/USD");

        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        vm.prank(alice);
        predictor.betBull{value: 1 ether}(btcHash, epoch);

        (uint128 bullAmount, uint128 bearAmount, bool claimed) = predictor.ledger(btcHash, epoch, alice);
        assertEq(uint256(bullAmount), 1 ether);
        assertEq(uint256(bearAmount), 0);
        assertEq(claimed, false);
    }

    function test_betBear_eth() public {
        _startGenesisPair(ethHash, "ETH/USD");

        (uint256 epoch,,,,) = predictor.pairState(ethHash);

        vm.prank(bob);
        predictor.betBear{value: 2 ether}(ethHash, epoch);

        (uint128 bullAmount, uint128 bearAmount,) = predictor.ledger(ethHash, epoch, bob);
        assertEq(uint256(bullAmount), 0);
        assertEq(uint256(bearAmount), 2 ether);
    }

    function test_betBull_revertIfBelowMinimum() public {
        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        vm.prank(alice);
        vm.expectRevert(TapPredictor.BetTooSmall.selector);
        predictor.betBull{value: 0.01 ether}(btcHash, epoch);
    }

    function test_betBull_revertIfAboveMaximum() public {
        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        vm.prank(alice);
        vm.expectRevert(TapPredictor.BetTooLarge.selector);
        predictor.betBull{value: 101 ether}(btcHash, epoch);
    }

    function test_betBull_accumulatesSamePosition() public {
        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        vm.prank(alice);
        predictor.betBull{value: 1 ether}(btcHash, epoch);

        // Second Bull bet on same round accumulates
        vm.prank(alice);
        predictor.betBull{value: 0.5 ether}(btcHash, epoch);

        (uint128 bullAmt, uint128 bearAmt, bool claimed) = predictor.ledger(btcHash, epoch, alice);
        assertEq(uint256(bullAmt), 1.5 ether);
        assertEq(uint256(bearAmt), 0);
        assertFalse(claimed);

        // totalBets incremented only on first bet
        assertEq(predictor.totalBets(alice), 1);
    }

    function test_betBothSides_allowedInSameRound() public {
        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        // Bet Bear first, then Bull on same round
        vm.prank(alice);
        predictor.betBear{value: 1 ether}(btcHash, epoch);

        vm.prank(alice);
        predictor.betBull{value: 2 ether}(btcHash, epoch);

        (uint128 bullAmt, uint128 bearAmt,) = predictor.ledger(btcHash, epoch, alice);
        assertEq(uint256(bullAmt), 2 ether);
        assertEq(uint256(bearAmt), 1 ether);

        // totalBets only incremented once
        assertEq(predictor.totalBets(alice), 1);
    }

    function test_betBothSides_bullThenBear() public {
        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        // Bet Bull first, then Bear on same round
        vm.prank(alice);
        predictor.betBull{value: 1 ether}(btcHash, epoch);

        vm.prank(alice);
        predictor.betBear{value: 1 ether}(btcHash, epoch);

        (uint128 bullAmt, uint128 bearAmt,) = predictor.ledger(btcHash, epoch, alice);
        assertEq(uint256(bullAmt), 1 ether);
        assertEq(uint256(bearAmt), 1 ether);
    }

    function test_betBull_revertIfAccumulatedExceedsMax() public {
        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        vm.prank(alice);
        predictor.betBull{value: 80 ether}(btcHash, epoch);

        // Bull total would be 110 ether, exceeding MAX_BET (100 ether) per-side
        vm.prank(alice);
        vm.expectRevert(TapPredictor.BetTooLarge.selector);
        predictor.betBull{value: 30 ether}(btcHash, epoch);
    }

    function test_maxBetPerSide_independentLimits() public {
        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        // Max out bull side
        vm.prank(alice);
        predictor.betBull{value: 100 ether}(btcHash, epoch);

        // Bear side should still accept up to max independently
        vm.prank(alice);
        predictor.betBear{value: 100 ether}(btcHash, epoch);

        (uint128 bullAmt, uint128 bearAmt,) = predictor.ledger(btcHash, epoch, alice);
        assertEq(uint256(bullAmt), 100 ether);
        assertEq(uint256(bearAmt), 100 ether);
    }

    // ==================== Round Execution Tests ====================

    function test_executeRound_bullWins() public {
        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 500, BTC_PRICE + 1000);

        (,,,,bool oracleCalled, int128 lockPrice, int128 closePrice,,, uint128 totalAmount, uint128 bullAmount, uint128 bearAmount,,)
            = predictor.rounds(btcHash, epoch);

        assertTrue(oracleCalled);
        assertTrue(closePrice > lockPrice);
        assertEq(uint256(totalAmount), 15 ether);
        assertEq(uint256(bullAmount), 10 ether);
        assertEq(uint256(bearAmount), 5 ether);
    }

    // ==================== Batch Execute (Multi-Pair) ====================

    function test_executeRoundsAll() public {
        // Start genesis for BTC only (SOL not initialized = skipped by executeRoundsAll)
        _startGenesisPair(btcHash, "BTC/USD");

        // After genesis, BTC is at epoch 3, clock is at T2
        (uint256 btcEpoch,,,,) = predictor.pairState(btcHash);
        assertEq(btcEpoch, 3);

        // Now start ETH genesis at current time (T2)
        vm.prank(operator);
        predictor.genesisStartRound(ethHash);

        // Advance to T3 for both pairs
        vm.warp(T3);
        vm.roll(B3);
        mockOracle.setPrice("BTC/USD", BTC_PRICE + 500, B3);
        mockOracle.setPrice("ETH/USD", ETH_PRICE + 100, B3);
        mockOracle.setPrice("SOL/USD", SOL_PRICE + 50, B3);

        // Lock ETH genesis (started at T2, lock at T2+INTERVAL=T3)
        vm.prank(operator);
        predictor.genesisLockRound(ethHash);

        // Place bets on BTC pair
        // BTC round 3 lockTimestamp = T2 + INTERVAL = T3, so we need to be before T3
        // But we're already at T3. BTC round 3 is now past bettable.
        // Use executeRoundsAll to advance BTC (lock round 3, resolve round 2, start round 4)
        vm.prank(operator);
        predictor.executeRoundsAll();

        // BTC should have advanced (genesis was complete)
        // ETH should NOT advance (genesis lock done but not full executeRound yet)
        (uint256 btcEpochAfter,,,,) = predictor.pairState(btcHash);
        assertEq(btcEpochAfter, 4);

        // Advance again
        vm.warp(T4);
        vm.roll(B4);
        mockOracle.setPrice("BTC/USD", BTC_PRICE + 600, B4);
        mockOracle.setPrice("ETH/USD", ETH_PRICE + 200, B4);
        mockOracle.setPrice("SOL/USD", SOL_PRICE + 100, B4);

        // Now ETH has completed genesis lock (at T3), genesis epoch 2 started at T3
        // ETH round 2 lockTimestamp = T3 + INTERVAL = T4
        // executeRoundsAll should advance ETH now
        vm.prank(operator);
        predictor.executeRoundsAll();

        (uint256 ethEpochAfter,,,,) = predictor.pairState(ethHash);
        assertEq(ethEpochAfter, 3); // ETH: lock 2, resolve 1, start 3
    }

    // ==================== Claim Tests ====================

    function test_claim_bullWins() public {
        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 500, BTC_PRICE + 1000);

        uint256 aliceBalanceBefore = alice.balance;

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = btcHash;
        uint256[] memory epochs = new uint256[](1);
        epochs[0] = epoch;

        vm.prank(alice);
        predictor.claim(phs, epochs);

        // Alice bet 10, Bob bet 5, total 15, treasury 0.45, reward 14.55
        assertEq(alice.balance - aliceBalanceBefore, 14.55 ether);
    }

    function test_claim_bearWins() public {
        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 500, BTC_PRICE - 1000);

        uint256 bobBalanceBefore = bob.balance;

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = btcHash;
        uint256[] memory epochs = new uint256[](1);
        epochs[0] = epoch;

        vm.prank(bob);
        predictor.claim(phs, epochs);

        assertEq(bob.balance - bobBalanceBefore, 14.55 ether);
    }

    function test_claim_revertIfAlreadyClaimed() public {
        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 500, BTC_PRICE + 1000);

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = btcHash;
        uint256[] memory epochs = new uint256[](1);
        epochs[0] = epoch;

        vm.prank(alice);
        predictor.claim(phs, epochs);

        vm.prank(alice);
        vm.expectRevert(TapPredictor.NotClaimable.selector);
        predictor.claim(phs, epochs);
    }

    // ==================== Dual-Side Betting Tests ====================

    function test_dualSide_bullWins_onlyBullPaysOut() public {
        // Alice bets both sides, bulls win: only bull side earns reward, bear side is lost
        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        // Alice: 5 ETH bull, 3 ETH bear = 8 ETH total
        vm.prank(alice);
        predictor.betBull{value: 5 ether}(btcHash, epoch);
        vm.prank(alice);
        predictor.betBear{value: 3 ether}(btcHash, epoch);

        // Bob: 5 ETH bear
        vm.prank(bob);
        predictor.betBear{value: 5 ether}(btcHash, epoch);

        // Execute rounds: lock then close with bulls winning
        vm.warp(T3);
        vm.roll(B3);
        mockOracle.setPrice("BTC/USD", BTC_PRICE + 500, B3);
        vm.prank(operator);
        predictor.executeRound(btcHash);

        vm.warp(T4);
        vm.roll(B4);
        mockOracle.setPrice("BTC/USD", BTC_PRICE + 1000, B4);
        vm.prank(operator);
        predictor.executeRound(btcHash);

        // Round totals: bullAmount = 5, bearAmount = 8, totalAmount = 13
        // Treasury = 13 * 300 / 10000 = 0.39 ether
        // rewardAmount = 13 - 0.39 = 12.61 ether
        // rewardBaseCalAmount = bullAmount = 5 (only bulls)
        // Alice reward = (5 * 12.61) / 5 = 12.61 ether (she was the only bull bettor)
        // Alice's bear bet of 3 ETH is lost (goes to winners pool)

        assertTrue(predictor.claimable(btcHash, epoch, alice));

        uint256 aliceBalBefore = alice.balance;
        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = epoch;

        vm.prank(alice);
        predictor.claim(phs, eps);

        uint256 aliceReward = alice.balance - aliceBalBefore;
        assertEq(aliceReward, 12.61 ether);
    }

    function test_dualSide_bearWins_onlyBearPaysOut() public {
        // Alice bets both sides, bears win: only bear side earns reward
        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        // Alice: 2 ETH bull, 4 ETH bear
        vm.prank(alice);
        predictor.betBull{value: 2 ether}(btcHash, epoch);
        vm.prank(alice);
        predictor.betBear{value: 4 ether}(btcHash, epoch);

        // Bob: 8 ETH bull
        vm.prank(bob);
        predictor.betBull{value: 8 ether}(btcHash, epoch);

        // Execute: bears win
        vm.warp(T3);
        vm.roll(B3);
        mockOracle.setPrice("BTC/USD", BTC_PRICE + 500, B3);
        vm.prank(operator);
        predictor.executeRound(btcHash);

        vm.warp(T4);
        vm.roll(B4);
        mockOracle.setPrice("BTC/USD", BTC_PRICE - 1000, B4);
        vm.prank(operator);
        predictor.executeRound(btcHash);

        // Round totals: bullAmount = 10, bearAmount = 4, totalAmount = 14
        // Treasury = 14 * 300 / 10000 = 0.42 ether
        // rewardAmount = 14 - 0.42 = 13.58 ether
        // rewardBaseCalAmount = bearAmount = 4
        // Alice reward = (4 * 13.58) / 4 = 13.58 ether (she was the only bear bettor)

        assertTrue(predictor.claimable(btcHash, epoch, alice));

        uint256 aliceBalBefore = alice.balance;
        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = epoch;

        vm.prank(alice);
        predictor.claim(phs, eps);

        assertEq(alice.balance - aliceBalBefore, 13.58 ether);
    }

    function test_dualSide_draw_refundsBothSides() public {
        // Alice bets both sides, draw: both sides refunded
        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        vm.prank(alice);
        predictor.betBull{value: 3 ether}(btcHash, epoch);
        vm.prank(alice);
        predictor.betBear{value: 2 ether}(btcHash, epoch);

        vm.prank(bob);
        predictor.betBull{value: 5 ether}(btcHash, epoch);

        // Execute: draw (same lock and close price)
        vm.warp(T3);
        vm.roll(B3);
        mockOracle.setPrice("BTC/USD", BTC_PRICE + 500, B3);
        vm.prank(operator);
        predictor.executeRound(btcHash);

        vm.warp(T4);
        vm.roll(B4);
        mockOracle.setPrice("BTC/USD", BTC_PRICE + 500, B4); // same as lock price
        vm.prank(operator);
        predictor.executeRound(btcHash);

        assertTrue(predictor.claimable(btcHash, epoch, alice));

        uint256 aliceBalBefore = alice.balance;
        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = epoch;

        vm.prank(alice);
        predictor.claim(phs, eps);

        // Full refund of both sides: 3 + 2 = 5 ether
        assertEq(alice.balance - aliceBalBefore, 5 ether);
    }

    function test_dualSide_refund_bothSidesReturned() public {
        // If oracle never called, both sides get refunded
        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        vm.prank(alice);
        predictor.betBull{value: 3 ether}(btcHash, epoch);
        vm.prank(alice);
        predictor.betBear{value: 2 ether}(btcHash, epoch);

        vm.warp(T2 + INTERVAL * 3 + BUFFER + 1);

        assertTrue(predictor.refundable(btcHash, epoch, alice));

        uint256 aliceBalBefore = alice.balance;
        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = epoch;

        vm.prank(alice);
        predictor.claim(phs, eps);

        assertEq(alice.balance - aliceBalBefore, 5 ether);
    }

    // ==================== Refund Tests ====================

    function test_refundable_whenOracleNotCalled() public {
        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        vm.prank(alice);
        predictor.betBull{value: 1 ether}(btcHash, epoch);

        vm.warp(T2 + INTERVAL * 3 + BUFFER + 1);

        assertTrue(predictor.refundable(btcHash, epoch, alice));
    }

    function test_claim_refund() public {
        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        vm.prank(alice);
        predictor.betBull{value: 5 ether}(btcHash, epoch);

        uint256 balanceBefore = alice.balance;
        vm.warp(T2 + INTERVAL * 3 + BUFFER + 1);

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = btcHash;
        uint256[] memory epochs = new uint256[](1);
        epochs[0] = epoch;

        vm.prank(alice);
        predictor.claim(phs, epochs);

        assertEq(alice.balance - balanceBefore, 5 ether);
    }

    // ==================== Tie Tests ====================

    function test_tie_refundsEveryone() public {
        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 500, BTC_PRICE + 500);

        // H-01 fix: tie rounds refund everyone, no treasury fee
        assertTrue(predictor.claimable(btcHash, epoch, alice));
        assertTrue(predictor.claimable(btcHash, epoch, bob));
        assertEq(predictor.treasuryAmount(), 0);

        // Alice gets her 10 ETH back
        uint256 aliceBalBefore = alice.balance;
        bytes32[] memory phs = new bytes32[](1);
        phs[0] = btcHash;
        uint256[] memory epochs = new uint256[](1);
        epochs[0] = epoch;

        vm.prank(alice);
        predictor.claim(phs, epochs);
        assertEq(alice.balance - aliceBalBefore, 10 ether);

        // Bob gets his 5 ETH back
        uint256 bobBalBefore = bob.balance;
        vm.prank(bob);
        predictor.claim(phs, epochs);
        assertEq(bob.balance - bobBalBefore, 5 ether);
    }

    // ==================== Treasury Tests ====================

    function test_claimTreasury() public {
        _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 500, BTC_PRICE + 1000);

        assertEq(predictor.treasuryAmount(), 0.45 ether);

        uint256 adminBalanceBefore = admin.balance;
        vm.prank(admin);
        predictor.claimTreasury();

        assertEq(admin.balance - adminBalanceBefore, 0.45 ether);
        assertEq(predictor.treasuryAmount(), 0);
    }

    // ==================== Streak Tests ====================

    function test_streak_incrementsOnWin() public {
        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 500, BTC_PRICE + 1000);

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = btcHash;
        uint256[] memory epochs = new uint256[](1);
        epochs[0] = epoch;

        vm.prank(alice);
        predictor.claim(phs, epochs);

        assertEq(predictor.currentStreak(alice), 1);
        assertEq(predictor.totalWins(alice), 1);
    }

    function test_streak_resetsOnLoss() public {
        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 500, BTC_PRICE - 1000);

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = btcHash;
        uint256[] memory epochs = new uint256[](1);
        epochs[0] = epoch;

        vm.prank(alice);
        predictor.claim(phs, epochs);

        assertEq(predictor.currentStreak(alice), 0);
    }

    // ==================== Pause Tests ====================

    function test_pause_blocksBetting() public {
        _startGenesisPair(btcHash, "BTC/USD");

        vm.prank(admin);
        predictor.pause();

        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        vm.prank(alice);
        vm.expectRevert();
        predictor.betBull{value: 1 ether}(btcHash, epoch);
    }

    function test_unpause_resetsGenesis() public {
        _startGenesisPair(btcHash, "BTC/USD");

        vm.prank(admin);
        predictor.pause();

        vm.prank(admin);
        predictor.unpause();

        (,, bool started, bool locked,) = predictor.pairState(btcHash);
        assertEq(started, false);
        assertEq(locked, false);
    }

    // ==================== Admin Pair Management ====================

    function test_addPair() public {
        vm.prank(admin);
        predictor.addPair("ATOM/USD");

        assertEq(predictor.getActivePairsCount(), 4);
    }

    function test_addPair_revertIfDuplicate() public {
        vm.prank(admin);
        vm.expectRevert(TapPredictor.PairAlreadyActive.selector);
        predictor.addPair("BTC/USD");
    }

    function test_removePair() public {
        vm.prank(admin);
        predictor.pause();

        vm.prank(admin);
        predictor.removePair("SOL/USD");

        assertEq(predictor.getActivePairsCount(), 2);
    }

    // ==================== Bridge Tests ====================

    function test_claimAndBridgeToL1() public {
        // Deploy mock cosmos at the precompile address for testing
        MockCosmos mockCosmos = new MockCosmos();
        vm.etch(address(0x00000000000000000000000000000000000000f1), address(mockCosmos).code);

        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 500, BTC_PRICE + 1000);

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = btcHash;
        uint256[] memory epochs = new uint256[](1);
        epochs[0] = epoch;

        // Fund the contract to cover the bridge amount
        vm.deal(address(predictor), 20 ether);

        vm.prank(alice);
        predictor.claimAndBridgeToL1(phs, epochs);

        // Verify alice's bet was marked claimed
        (,, bool claimed2) = predictor.ledger(btcHash, epoch, alice);
        assertTrue(claimed2);
    }

    function test_bridgeTreasuryToL1() public {
        MockCosmos mockCosmos = new MockCosmos();
        vm.etch(address(0x00000000000000000000000000000000000000f1), address(mockCosmos).code);

        _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 500, BTC_PRICE + 1000);

        vm.deal(address(predictor), 20 ether);

        vm.prank(admin);
        predictor.bridgeTreasuryToL1();

        assertEq(predictor.treasuryAmount(), 0);
    }

    // ==================== Wave 2: Callback / Denom / Memo ====================

    function test_callback_revertsIfNotSelf() public {
        // Any external caller (not address(this)) must hit OnlyChainCanCallback
        vm.prank(alice);
        vm.expectRevert(TapPredictor.OnlyChainCanCallback.selector);
        predictor.callback(1, true);

        vm.prank(admin);
        vm.expectRevert(TapPredictor.OnlyChainCanCallback.selector);
        predictor.callback(1, false);
    }

    function test_setFeeDenom_once() public {
        // Initially empty
        assertEq(predictor.feeDenom(), "");

        // M-07 (Wave 4) fix: setFeeDenom is now gated to `whenPaused`
        vm.prank(admin);
        predictor.pause();

        vm.prank(admin);
        predictor.setFeeDenom("uinit");
        assertEq(predictor.feeDenom(), "uinit");

        // Second call reverts
        vm.prank(admin);
        vm.expectRevert(TapPredictor.FeeDenomAlreadySet.selector);
        predictor.setFeeDenom("uinit");
    }

    function test_setFeeDenom_revertIfEmpty() public {
        // M-07 (Wave 4) fix: setFeeDenom requires pause
        vm.prank(admin);
        predictor.pause();

        // L-03 (Wave 4) fix: custom error instead of require string
        vm.prank(admin);
        vm.expectRevert(TapPredictor.EmptyDenom.selector);
        predictor.setFeeDenom("");
    }

    function test_setFeeDenom_revertIfNotAdmin() public {
        vm.prank(alice);
        vm.expectRevert(TapPredictor.NotAdmin.selector);
        predictor.setFeeDenom("uinit");
    }

    function test_setFeeDenom_revertIfNotPaused() public {
        // M-07 (Wave 4) fix: calling while unpaused must revert
        vm.prank(admin);
        vm.expectRevert();
        predictor.setFeeDenom("uinit");
    }

    function test_buildAsyncCallbackMemo() public {
        // Install MockJSONUtils at precompile address 0xf3 so merge_json is callable
        MockJSONUtils mockJson = new MockJSONUtils();
        vm.etch(address(0x00000000000000000000000000000000000000f3), address(mockJson).code);

        // Without user memo
        string memory memo = predictor.buildAsyncCallbackMemo(42, "");
        assertGt(bytes(memo).length, 0);

        // With user memo merged in
        string memory merged = predictor.buildAsyncCallbackMemo(42, '{"foo":"bar"}');
        assertGt(bytes(merged).length, 0);
    }

    function test_callback_refundsOnFailure() public {
        // Register a pending callback via the async bridge path, then simulate the chain
        // invoking callback(id, false). M-05 (Wave 4) fix: refund is now pull-based
        // via `claimRefund` rather than a direct push from the callback.
        MockCosmos mockCosmos = new MockCosmos();
        vm.etch(address(0x00000000000000000000000000000000000000f1), address(mockCosmos).code);

        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 500, BTC_PRICE + 1000);

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = btcHash;
        uint256[] memory epochs = new uint256[](1);
        epochs[0] = epoch;

        vm.deal(address(predictor), 100 ether);
        uint256 aliceBalBefore = alice.balance;

        vm.prank(alice);
        predictor.claimAndBridgeToL1(phs, epochs);

        // Callback id 1 must now be pending
        (address pendingUser, uint256 pendingAmount, bool active) = predictor.pendingCosmosCallbacks(1);
        assertEq(pendingUser, alice);
        assertEq(pendingAmount, 14.55 ether);
        assertTrue(active);

        // Simulate chain invoking callback with success=false (bridge tx failed post-submission)
        vm.prank(address(predictor));
        predictor.callback(1, false);

        // Record cleared, but alice NOT auto-refunded. She has a pending refund balance.
        (,, bool activeAfter) = predictor.pendingCosmosCallbacks(1);
        assertFalse(activeAfter);
        assertEq(alice.balance, aliceBalBefore, "no auto push");
        assertEq(predictor.pendingRefunds(alice), 14.55 ether, "refund accrued");

        // Alice pulls the refund.
        vm.prank(alice);
        predictor.claimRefund();

        assertEq(alice.balance - aliceBalBefore, 14.55 ether, "claimed");
        assertEq(predictor.pendingRefunds(alice), 0, "balance cleared");
    }

    function test_claimRefund_revertsIfZero() public {
        // M-05 (Wave 4) fix: claimRefund must revert with NoRefundPending when nothing is credited.
        vm.prank(alice);
        vm.expectRevert(TapPredictor.NoRefundPending.selector);
        predictor.claimRefund();
    }

    function test_callback_noOpOnSuccess() public {
        MockCosmos mockCosmos = new MockCosmos();
        vm.etch(address(0x00000000000000000000000000000000000000f1), address(mockCosmos).code);

        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 500, BTC_PRICE + 1000);

        bytes32[] memory phs = new bytes32[](1);
        phs[0] = btcHash;
        uint256[] memory epochs = new uint256[](1);
        epochs[0] = epoch;

        vm.deal(address(predictor), 100 ether);
        uint256 aliceBalBefore = alice.balance;

        vm.prank(alice);
        predictor.claimAndBridgeToL1(phs, epochs);

        // Successful settlement: callback(1, true) should clear record and not refund
        vm.prank(address(predictor));
        predictor.callback(1, true);

        (,, bool activeAfter) = predictor.pendingCosmosCallbacks(1);
        assertFalse(activeAfter);
        // Alice should receive no refund (bridge succeeded)
        assertEq(alice.balance, aliceBalBefore);
    }

    // ==================== Wave 5: VIP Score Hook ====================

    function test_setVipScore_once() public {
        MockVipScore vip = new MockVipScore();
        assertEq(address(predictor.vipScore()), address(0));

        vm.prank(admin);
        predictor.setVipScore(address(vip));
        assertEq(address(predictor.vipScore()), address(vip));

        vm.prank(admin);
        vm.expectRevert(TapPredictor.VipScoreAlreadySet.selector);
        predictor.setVipScore(address(vip));
    }

    function test_setVipScore_revertZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(TapPredictor.ZeroAddress.selector);
        predictor.setVipScore(address(0));
    }

    function test_setVipStage_updatesValue() public {
        vm.prank(admin);
        predictor.setVipStage(42);
        assertEq(predictor.vipStage(), 42);
    }

    function test_setVipHookEnabled_toggles() public {
        assertFalse(predictor.vipHookEnabled());
        vm.prank(admin);
        predictor.setVipHookEnabled(true);
        assertTrue(predictor.vipHookEnabled());
    }

    function test_vipHook_incrementsOnClaim() public {
        MockVipScore vip = new MockVipScore();
        vm.prank(admin);
        predictor.setVipScore(address(vip));
        vm.prank(admin);
        predictor.setVipStage(5);
        vm.prank(admin);
        predictor.setVipHookEnabled(true);

        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 1000, BTC_PRICE + 2000);

        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = epoch;

        vm.prank(alice);
        predictor.claim(phs, eps);

        assertEq(vip.callCount(), 1, "vip write occurred");
        (uint64 stage, address addr,) = vip.calls(0);
        assertEq(uint256(stage), 5);
        assertEq(addr, alice);
    }

    function test_vipHook_silentWhenDisabled() public {
        MockVipScore vip = new MockVipScore();
        vm.prank(admin);
        predictor.setVipScore(address(vip));
        // Hook stays disabled

        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 1000, BTC_PRICE + 2000);

        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = epoch;

        vm.prank(alice);
        predictor.claim(phs, eps);

        assertEq(vip.callCount(), 0, "disabled hook: no write");
    }

    function test_vipHook_silentOnStageNotFound() public {
        MockVipScore vip = new MockVipScore();
        vip.setRevertNotFound(true);
        vm.prank(admin);
        predictor.setVipScore(address(vip));
        vm.prank(admin);
        predictor.setVipHookEnabled(true);

        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 1000, BTC_PRICE + 2000);

        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = epoch;

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        predictor.claim(phs, eps);

        // Claim still paid out despite vip revert
        assertGt(alice.balance, aliceBefore, "claim reward still paid");
        assertEq(vip.callCount(), 0, "revert swallowed, no write recorded");
    }

    function test_vipHook_silentOnStageFinalized() public {
        MockVipScore vip = new MockVipScore();
        vip.setRevertFinalized(true);
        vm.prank(admin);
        predictor.setVipScore(address(vip));
        vm.prank(admin);
        predictor.setVipHookEnabled(true);

        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 1000, BTC_PRICE + 2000);

        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = epoch;

        vm.prank(alice);
        predictor.claim(phs, eps); // must not revert
    }

    // ==================== Wave 5: ERC20Wrapper bridge path ====================

    function test_setErc20Wrapper_once() public {
        MockERC20Wrapper wrapper = new MockERC20Wrapper();
        assertEq(address(predictor.erc20Wrapper()), address(0));

        vm.prank(admin);
        predictor.setErc20Wrapper(address(wrapper));
        assertEq(address(predictor.erc20Wrapper()), address(wrapper));

        vm.prank(admin);
        vm.expectRevert(TapPredictor.WrapperAlreadySet.selector);
        predictor.setErc20Wrapper(address(wrapper));
    }

    function test_setErc20Wrapper_revertZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(TapPredictor.ZeroAddress.selector);
        predictor.setErc20Wrapper(address(0));
    }

    function test_claimAndBridgeViaWrapper_revertIfUnset() public {
        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = 1;

        vm.prank(alice);
        vm.expectRevert(TapPredictor.WrapperNotSet.selector);
        predictor.claimAndBridgeViaWrapper(phs, eps, "uinit");
    }

    function test_claimAndBridgeViaWrapper_success() public {
        MockERC20Wrapper wrapper = new MockERC20Wrapper();
        vm.prank(admin);
        predictor.setErc20Wrapper(address(wrapper));

        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 1000, BTC_PRICE + 2000);
        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = epoch;

        vm.prank(alice);
        predictor.claimAndBridgeViaWrapper(phs, eps, "uinit");

        assertEq(wrapper.callCount(), 1);
        assertEq(wrapper.lastDenom(), "uinit");
        assertGt(wrapper.lastAmount(), 0);
    }

    function test_claimAndBridgeViaWrapper_revertOnWrapperFailure() public {
        MockERC20Wrapper wrapper = new MockERC20Wrapper();
        wrapper.setRevertOnCall(true);
        vm.prank(admin);
        predictor.setErc20Wrapper(address(wrapper));

        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 1000, BTC_PRICE + 2000);
        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = epoch;

        vm.prank(alice);
        vm.expectRevert();
        predictor.claimAndBridgeViaWrapper(phs, eps, "uinit");
    }

    function test_Wrapper_DustRoundingEmitsEvent() public {
        // M-03 (Wave 5) fix: when the reward has a non-zero `% 1e12` dust, the
        // wrapper call is passed `bridgeable = reward - dust`, the full reward
        // is paid natively to the caller, and BridgeViaWrapperDustRounded is emitted.
        MockERC20Wrapper wrapper = new MockERC20Wrapper();
        vm.prank(admin);
        predictor.setErc20Wrapper(address(wrapper));

        // Craft a round whose reward has sub-1e12 dust by using non-clean bets.
        // Alice bets 0.5 ether + 1 wei; Bob bets 0.1 ether clean.
        // total = 600000000000000001, treasuryFee 3% = 18000000000000000 (dividend truncation),
        // reward = 582000000000000001. Alice wins and takes the full reward because
        // bearAmount maps to 1:1 on her contribution (rewardBaseCalAmount == alice bet).
        uint256 aliceBet = 0.5 ether + 1;
        uint256 bobBet = 0.1 ether;

        // Custom genesis then bet path
        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        vm.prank(alice);
        predictor.betBull{value: aliceBet}(btcHash, epoch);
        vm.prank(bob);
        predictor.betBear{value: bobBet}(btcHash, epoch);

        vm.warp(T3);
        vm.roll(B3);
        mockOracle.setPrice("BTC/USD", BTC_PRICE + 500, B3);
        vm.prank(operator);
        predictor.executeRound(btcHash);

        vm.warp(T4);
        vm.roll(B4);
        mockOracle.setPrice("BTC/USD", BTC_PRICE + 1000, B4);
        vm.prank(operator);
        predictor.executeRound(btcHash);

        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = epoch;

        uint256 aliceBefore = alice.balance;

        // Fund predictor so native reward payout can clear
        vm.deal(address(predictor), 100 ether);

        vm.prank(alice);
        predictor.claimAndBridgeViaWrapper(phs, eps, "uinit");

        // Wrapper got a clean 1e12-multiple; alice got the full reward natively.
        uint256 lastAmt = wrapper.lastAmount();
        assertTrue(lastAmt > 0, "bridgeable > 0");
        assertEq(lastAmt % 1e12, 0, "bridgeable is 1e12-divisible");

        // Alice's native balance delta equals the untruncated reward
        uint256 aliceDelta = alice.balance - aliceBefore;
        assertGt(aliceDelta, lastAmt, "alice got full reward including dust");
        assertEq(aliceDelta - lastAmt, aliceDelta % 1e12, "delta - bridgeable == dust");
    }

    function test_Wrapper_PureDustReverts() public {
        // M-03 (Wave 5) fix: a reward smaller than 1e12 has `bridgeable == 0`, so
        // the call must revert with WrapperDustOnly rather than silently no-op.
        // We synthesize a 1-wei refund via the tie-refund path with small bets.
        MockERC20Wrapper wrapper = new MockERC20Wrapper();
        vm.prank(admin);
        predictor.setErc20Wrapper(address(wrapper));

        // Reduce the min bet so we can exercise a sub-1e12 refund amount.
        vm.prank(admin);
        predictor.pause();
        vm.prank(admin);
        predictor.setMinBetAmount(1);
        vm.prank(admin);
        predictor.unpause();

        _startGenesisPair(btcHash, "BTC/USD");
        (uint256 epoch,,,,) = predictor.pairState(btcHash);

        // Alice bets 999 wei (sub 1e12). Rewards via refund path return the exact bet.
        uint256 tinyBet = 999; // < 1e12
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        predictor.betBull{value: tinyBet}(btcHash, epoch);

        // Let the round close without resolving to trigger refundable().
        vm.warp(T2 + INTERVAL * 3 + BUFFER + 1);

        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = epoch;

        vm.prank(alice);
        vm.expectRevert(TapPredictor.WrapperDustOnly.selector);
        predictor.claimAndBridgeViaWrapper(phs, eps, "uinit");
    }

    // ==================== Wave 5: Misc (H-01, L-02) ====================

    function test_VipStage_RejectZero() public {
        // L-02 (Wave 5) fix: stage 0 is reserved as "unset" in the upstream VipScore
        vm.prank(admin);
        vm.expectRevert(TapPredictor.InvalidVipStage.selector);
        predictor.setVipStage(0);
    }

    function test_VipHook_NoCodeAddress_EmitsNoCodeReason() public {
        // H-01 (Wave 5) fix: if an admin points VipScore at an EOA, the code.length
        // check short-circuits the try/catch and emits a NO_CODE reason.
        address eoaScore = makeAddr("eoaScore");
        vm.prank(admin);
        predictor.setVipScore(eoaScore);
        vm.prank(admin);
        predictor.setVipStage(1);
        vm.prank(admin);
        predictor.setVipHookEnabled(true);

        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 1000, BTC_PRICE + 2000);
        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = epoch;

        vm.recordLogs();
        vm.prank(alice);
        predictor.claim(phs, eps);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 failSelector = keccak256("VipScoreIncreaseFailed(address,uint64,uint64,bytes)");
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == failSelector) {
                // decode non-indexed bytes reason from data: (uint64 stage, uint64 amount, bytes reason)
                (,, bytes memory reason) = abi.decode(logs[i].data, (uint64, uint64, bytes));
                assertEq(reason, bytes("NO_CODE"));
                found = true;
                break;
            }
        }
        assertTrue(found, "VipScoreIncreaseFailed with NO_CODE reason expected");
    }

    function test_VipHook_GasGriefingScorer_DoesNotBrick() public {
        // H-01 (Wave 5) fix: a scorer that burns all gas with `invalid()` would,
        // without the 80k gas stipend, consume all remaining gas and revert the
        // whole claim (try/catch does NOT catch OOG). With the stipend, only 80k
        // is spent inside the hook and the claim itself completes.
        GasBurnScorer burner = new GasBurnScorer();
        vm.prank(admin);
        predictor.setVipScore(address(burner));
        vm.prank(admin);
        predictor.setVipStage(1);
        vm.prank(admin);
        predictor.setVipHookEnabled(true);

        uint256 epoch = _playFullRound(btcHash, "BTC/USD", BTC_PRICE + 1000, BTC_PRICE + 2000);
        bytes32[] memory phs = new bytes32[](1); phs[0] = btcHash;
        uint256[] memory eps = new uint256[](1); eps[0] = epoch;

        uint256 aliceBefore = alice.balance;

        vm.prank(alice);
        predictor.claim(phs, eps);

        // Claim still paid out despite the hook trying to burn all gas.
        assertGt(alice.balance, aliceBefore, "reward still paid");
    }

    // ==================== Wave 5: Oracle stale guard ====================

    function test_setOracleMaxStaleBlocks_updatesValue() public {
        // M-01 (Wave 5) fix: setOracleMaxStaleBlocks is gated behind whenPaused
        vm.prank(admin);
        predictor.pause();

        vm.prank(admin);
        predictor.setOracleMaxStaleBlocks(60);
        assertEq(predictor.oracleMaxStaleBlocks(), 60);
    }

    function test_setOracleMaxStaleBlocks_revertInvalidWindow() public {
        // M-01 (Wave 5) fix: must be paused before the setter can run. Pause first
        // so the revert we observe is `InvalidStalenessWindow`, not `ExpectedPause`.
        vm.prank(admin);
        predictor.pause();

        // Zero and anything below 5 must revert with InvalidStalenessWindow.
        vm.prank(admin);
        vm.expectRevert(TapPredictor.InvalidStalenessWindow.selector);
        predictor.setOracleMaxStaleBlocks(0);

        uint256 aboveCap = predictor.MAX_ORACLE_STALENESS_HARD_CAP() + 1;
        vm.prank(admin);
        vm.expectRevert(TapPredictor.InvalidStalenessWindow.selector);
        predictor.setOracleMaxStaleBlocks(aboveCap);
    }

    function test_Oracle_RejectTooLowStaleness() public {
        // M-01 (Wave 5) fix: floor of 5 blocks prevents a bricked resolver via `1`.
        vm.prank(admin);
        predictor.pause();

        vm.prank(admin);
        vm.expectRevert(TapPredictor.InvalidStalenessWindow.selector);
        predictor.setOracleMaxStaleBlocks(1);

        vm.prank(admin);
        vm.expectRevert(TapPredictor.InvalidStalenessWindow.selector);
        predictor.setOracleMaxStaleBlocks(4);

        // 5 is the minimum accepted
        vm.prank(admin);
        predictor.setOracleMaxStaleBlocks(5);
        assertEq(predictor.oracleMaxStaleBlocks(), 5);
    }

    function test_setOracleMaxStaleBlocks_revertIfNotPaused() public {
        // M-01 (Wave 5) fix: unpaused setter reverts
        vm.prank(admin);
        vm.expectRevert();
        predictor.setOracleMaxStaleBlocks(50);
    }

    function test_genesisLock_revertOnStaleOracle() public {
        vm.prank(operator);
        predictor.genesisStartRound(btcHash);

        vm.warp(T1);
        vm.roll(B1 + 1000); // far past staleness window
        // oracle price recorded at B0; height 1000 blocks behind current block
        mockOracle.setPrice("BTC/USD", BTC_PRICE, B0);

        vm.prank(operator);
        vm.expectRevert(TapPredictor.OracleStale.selector);
        predictor.genesisLockRound(btcHash);
    }

    function test_oracleMaxStaleBlocks_adminCanWiden() public {
        // M-01 (Wave 5) fix: setter is now `whenPaused`, so we pause to tighten the
        // window, unpause to exercise the genesis flow, then pause/unpause again to
        // widen it. Pausing resets genesis state in `unpause()`, so we re-run the
        // genesis start path on each iteration.

        // Default window is 30. Tighten to a small value (>= 5 floor), verify stale.
        vm.prank(admin);
        predictor.pause();
        vm.prank(admin);
        predictor.setOracleMaxStaleBlocks(5);
        vm.prank(admin);
        predictor.unpause();

        vm.prank(operator);
        predictor.genesisStartRound(btcHash);

        vm.warp(T1);
        vm.roll(B1 + 10); // 10 blocks past a 5-block window
        mockOracle.setPrice("BTC/USD", BTC_PRICE, B1);

        vm.prank(operator);
        vm.expectRevert(TapPredictor.OracleStale.selector);
        predictor.genesisLockRound(btcHash);

        // Widen the window, then unpause and retry (genesis reset on unpause).
        vm.prank(admin);
        predictor.pause();
        vm.prank(admin);
        predictor.setOracleMaxStaleBlocks(100);
        vm.prank(admin);
        predictor.unpause();

        // Re-run genesis start since unpause() cleared `genesisStartOnce`.
        vm.prank(operator);
        predictor.genesisStartRound(btcHash);

        mockOracle.setPrice("BTC/USD", BTC_PRICE, uint64(block.number));

        vm.warp(block.timestamp + INTERVAL);
        vm.roll(block.number + 1);
        mockOracle.setPrice("BTC/USD", BTC_PRICE, uint64(block.number));

        vm.prank(operator);
        predictor.genesisLockRound(btcHash);
    }

    // ==================== Force Advance Round Tests ====================

    function test_forceAdvanceRound_recoversStuckPair() public {
        // Set up BTC pair through genesis and into a running state.
        // After _startGenesisPair, BTC is at epoch 3 and timestamp is T2.
        _startGenesisPair(btcHash, "BTC/USD");

        (uint256 epochBefore,,,,) = predictor.pairState(btcHash);
        assertEq(epochBefore, 3);

        // Alice places a bet on the current round (epoch 3)
        vm.prank(alice);
        predictor.betBull{value: 1 ether}(btcHash, epochBefore);

        // Simulate the keeper missing the execution window:
        // Jump far past lockTimestamp + bufferSeconds for epoch 3.
        // Round 3 was started at T2, so lockTimestamp = T2 + INTERVAL.
        // Buffer window ends at T2 + INTERVAL + BUFFER.
        // Jump well past that.
        uint256 farFuture = T2 + INTERVAL + BUFFER + 1000;
        vm.warp(farFuture);
        vm.roll(B2 + 100);
        mockOracle.setPrice("BTC/USD", BTC_PRICE + 900, uint64(B2 + 100));

        // Confirm the pair is stuck: executeRound should revert
        vm.prank(operator);
        vm.expectRevert(TapPredictor.RoundNotLockable.selector);
        predictor.executeRound(btcHash);

        // Admin force-advances the stuck pair
        vm.prank(admin);
        predictor.forceAdvanceRound(btcHash);

        // Genesis flags should be reset
        (, , bool started, bool locked,) = predictor.pairState(btcHash);
        assertFalse(started, "genesisStartOnce should be reset");
        assertFalse(locked, "genesisLockOnce should be reset");

        // Epoch stays at the stuck value (genesis will increment it)
        (uint256 epochAfterForce,,,,) = predictor.pairState(btcHash);
        assertEq(epochAfterForce, epochBefore, "epoch unchanged until genesis restarts");

        // The stuck round (epoch 3) should have oracleCalled = false
        // so Alice can get a refund via refundable()
        (,,,,bool oracleCalled,,,,,,,,, ) = predictor.rounds(btcHash, epochBefore);
        assertFalse(oracleCalled, "stuck round should NOT have oracleCalled set");

        // Confirm Alice can get a refund (closeTimestamp + buffer has passed)
        assertTrue(predictor.refundable(btcHash, epochBefore, alice), "alice should be refundable");

        // Now the operator can restart the pair via genesis
        vm.prank(operator);
        predictor.genesisStartRound(btcHash);

        vm.warp(farFuture + INTERVAL);
        vm.roll(B2 + 110);
        mockOracle.setPrice("BTC/USD", BTC_PRICE + 1000, uint64(B2 + 110));

        vm.prank(operator);
        predictor.genesisLockRound(btcHash);

        vm.warp(farFuture + 2 * INTERVAL);
        vm.roll(B2 + 120);
        mockOracle.setPrice("BTC/USD", BTC_PRICE + 1100, uint64(B2 + 120));

        // executeRound should succeed now
        vm.prank(operator);
        predictor.executeRound(btcHash);

        (uint256 finalEpoch,,,,) = predictor.pairState(btcHash);
        // Genesis: epoch 3 -> 4 (start), 4 -> 5 (lock), then executeRound: 5 -> 6
        assertEq(finalEpoch, 6, "pair should be running again at epoch 6");

        // Alice claims her refund from the stuck round
        bytes32[] memory phs = new bytes32[](1);
        phs[0] = btcHash;
        uint256[] memory epochs = new uint256[](1);
        epochs[0] = epochBefore;

        uint256 aliceBalBefore = alice.balance;
        vm.prank(alice);
        predictor.claim(phs, epochs);
        assertEq(alice.balance - aliceBalBefore, 1 ether, "alice should get full refund");
    }

    function test_forceAdvanceRound_revertIfNotAdmin() public {
        _startGenesisPair(btcHash, "BTC/USD");

        // Jump past buffer
        vm.warp(T2 + INTERVAL + BUFFER + 100);
        vm.roll(B2 + 50);

        vm.prank(operator);
        vm.expectRevert(TapPredictor.NotAdmin.selector);
        predictor.forceAdvanceRound(btcHash);

        vm.prank(alice);
        vm.expectRevert(TapPredictor.NotAdmin.selector);
        predictor.forceAdvanceRound(btcHash);
    }

    function test_forceAdvanceRound_revertIfNotStuck() public {
        _startGenesisPair(btcHash, "BTC/USD");

        // Still within the lock window: should revert
        vm.prank(admin);
        vm.expectRevert(TapPredictor.RoundNotStuck.selector);
        predictor.forceAdvanceRound(btcHash);
    }

    function test_forceAdvanceRound_worksWhenGenesisLockMissed() public {
        // Only genesis-start, no lock: force advance resets genesis flags
        vm.prank(operator);
        predictor.genesisStartRound(btcHash);

        vm.warp(T0 + INTERVAL + BUFFER + 100);
        vm.roll(B0 + 50);

        vm.prank(admin);
        predictor.forceAdvanceRound(btcHash);

        (,,bool gs, bool gl,) = predictor.pairState(btcHash);
        assertFalse(gs);
        assertFalse(gl);
    }

    function test_forceAdvanceRound_revertIfPairNotActive() public {
        bytes32 fakePair = keccak256(bytes("FAKE/USD"));

        vm.prank(admin);
        vm.expectRevert(TapPredictor.PairNotActive.selector);
        predictor.forceAdvanceRound(fakePair);
    }

    function test_forceAdvanceRound_worksWhilePaused() public {
        _startGenesisPair(btcHash, "BTC/USD");

        vm.warp(T2 + INTERVAL + BUFFER + 100);
        vm.roll(B2 + 50);

        // Pause the protocol
        vm.prank(admin);
        predictor.pause();

        // Force advance should still work (no whenNotPaused)
        // Note: pause() does NOT reset genesis flags for individual pairs,
        // but unpause() does. Since we paused after genesis, flags are still set.
        // However, the unpause() in setUp resets them. Let me re-check...
        // Actually _startGenesisPair runs genesis at the start of the test,
        // and then we pause. genesisStartOnce and genesisLockOnce are still true.

        // Pause resets nothing. unpause() resets genesis. We only paused.
        vm.prank(admin);
        predictor.forceAdvanceRound(btcHash);

        (, , bool started, bool locked,) = predictor.pairState(btcHash);
        assertFalse(started);
        assertFalse(locked);
    }

    function test_forceAdvanceRound_emitsEvent() public {
        _startGenesisPair(btcHash, "BTC/USD");

        (uint256 epochBefore,,,,) = predictor.pairState(btcHash);

        vm.warp(T2 + INTERVAL + BUFFER + 100);
        vm.roll(B2 + 50);

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit TapPredictor.RoundForceAdvanced(btcHash, epochBefore, epochBefore);
        predictor.forceAdvanceRound(btcHash);
    }

    // ==================== Helpers ====================

    function _startGenesisPair(bytes32 pairHash, string memory pairName) internal {
        _startGenesisPairAt(pairHash, pairName, T0, B0, T1, B1, T2, B2);
    }

    function _startGenesisPairAt(
        bytes32 pairHash,
        string memory pairName,
        uint256, uint64,
        uint256 t1, uint64 b1,
        uint256 t2, uint64 b2
    ) internal {
        vm.prank(operator);
        predictor.genesisStartRound(pairHash);

        vm.warp(t1);
        vm.roll(b1);
        mockOracle.setPrice(pairName, BTC_PRICE + 100, b1);

        vm.prank(operator);
        predictor.genesisLockRound(pairHash);

        vm.warp(t2);
        vm.roll(b2);
        mockOracle.setPrice(pairName, BTC_PRICE + 200, b2);

        vm.prank(operator);
        predictor.executeRound(pairHash);
    }

    function _playFullRound(bytes32 pairHash, string memory pairName, int256 lockPrice, int256 closePrice)
        internal
        returns (uint256 epoch)
    {
        _startGenesisPair(pairHash, pairName);

        (epoch,,,,) = predictor.pairState(pairHash);

        vm.prank(alice);
        predictor.betBull{value: 10 ether}(pairHash, epoch);

        vm.prank(bob);
        predictor.betBear{value: 5 ether}(pairHash, epoch);

        vm.warp(T3);
        vm.roll(B3);
        mockOracle.setPrice(pairName, lockPrice, B3);

        vm.prank(operator);
        predictor.executeRound(pairHash);

        vm.warp(T4);
        vm.roll(B4);
        mockOracle.setPrice(pairName, closePrice, B4);

        vm.prank(operator);
        predictor.executeRound(pairHash);
    }
}
