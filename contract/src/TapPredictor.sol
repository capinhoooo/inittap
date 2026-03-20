// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IConnectOracle} from "@initia/interfaces/IConnectOracle.sol";
import {ICosmos, COSMOS_CONTRACT} from "./interfaces/ICosmos.sol";
import {ICosmosCallback} from "./interfaces/ICosmosCallback.sol";
import {IJSONUtils, JSONUTILS_CONTRACT} from "./interfaces/IJSONUtils.sol";
import {IVipScore} from "./interfaces/IVipScore.sol";
import {IERC20Wrapper} from "./interfaces/IERC20Wrapper.sol";
import {UintToString} from "./lib/UintToString.sol";
import {TapToken} from "./TapToken.sol";

contract TapPredictor is Ownable, Pausable, ReentrancyGuard, ICosmosCallback {
    enum Position {
        Bull,
        Bear
    }

    struct Round {
        uint256 epoch;
        uint64 startTimestamp;
        uint64 lockTimestamp;
        uint64 closeTimestamp;
        bool oracleCalled;
        int128 lockPrice;
        int128 closePrice;
        uint64 lockOracleNonce;
        uint64 closeOracleNonce;
        uint128 totalAmount;
        uint128 bullAmount;
        uint128 bearAmount;
        uint128 rewardBaseCalAmount;
        uint128 rewardAmount;
    }

    struct BetInfo {
        uint128 bullAmount;
        uint128 bearAmount;
        bool claimed;
    }

    struct PairState {
        uint256 currentEpoch;
        uint64 oracleLatestNonce;
        bool genesisStartOnce;
        bool genesisLockOnce;
        bool active; 
    }

    struct CosmosCallbackRecord {
        address user;   
        uint256 amount; 
        bool active;    
    }

    error ZeroAddress();
    error NotOperator();
    error NotAdmin();
    error NotAdminOrOperator();
    error RoundNotBettable();
    error BetTooSmall();
    error AlreadyBet();
    error NotClaimable();
    error TransferFailed();
    error InvalidEpoch();
    error GenesisNotStarted();
    error GenesisAlreadyStarted();
    error GenesisAlreadyLocked();
    error GenesisNotLocked();
    error RoundNotLockable();
    error RoundNotEndable();
    error OracleStale();
    error OraclePriceInvalid();
    error InvalidTreasuryFee();
    error InvalidInterval();
    error BetTooLarge();
    error PairNotActive();
    error PairAlreadyActive();
    error BridgeFailed();
    error TapTokenAlreadySet();
    error CopyVaultAlreadySet();
    error FeeDenomAlreadySet();
    error OnlyChainCanCallback();
    error LengthMismatch();
    error TooManyPairs();
    error EmptyDenom();
    error NoRefundPending();
    error VipScoreAlreadySet();
    error WrapperNotSet();
    error WrapperAlreadySet();
    error InvalidStalenessWindow();
    error WrapperDustOnly();
    error InvalidVipStage();
    error RoundNotStuck();

    uint256 public constant MAX_TREASURY_FEE = 1000;
    uint256 public constant MAX_ORACLE_STALENESS_HARD_CAP = 300;
    uint64 public constant BRIDGE_GAS_LIMIT = 250_000; 
    uint256 public constant MAX_PAIRS = 10;
    uint256 private constant ASSUMED_BLOCK_TIME_SECONDS = 2;

    IConnectOracle public oracle;
    TapToken public tapToken;
    IVipScore public vipScore;
    IERC20Wrapper public erc20Wrapper;

    address public adminAddress;
    address public operatorAddress;
    uint256 public bufferSeconds;
    uint256 public intervalSeconds;
    uint256 public minBetAmount;
    uint256 public maxBetAmount;
    uint256 public treasuryFee; 
    uint256 public treasuryAmount;
    address public copyVault;
    string[] public activePairs; 
    uint64 public vipStage;
    bool public vipHookEnabled;
    string public feeDenom;
    uint64 public cosmosCallbackIdCounter;
    uint256 public oracleMaxStaleBlocks = 30;

    mapping(bytes32 => PairState) public pairState;
    mapping(bytes32 => string) public pairNames; 
    mapping(uint64 => CosmosCallbackRecord) public pendingCosmosCallbacks;
    mapping(address => uint256) public pendingRefunds;
    mapping(bytes32 => mapping(uint256 => Round)) public rounds;
    mapping(bytes32 => mapping(uint256 => mapping(address => BetInfo))) public ledger;
    mapping(address => uint256) public currentStreak;
    mapping(address => uint256) public maxStreak;
    mapping(address => uint256) public totalWins;
    mapping(address => uint256) public totalBets;


    event BetBull(bytes32 indexed pairId, address indexed sender, uint256 indexed epoch, uint256 amount);
    event BetBear(bytes32 indexed pairId, address indexed sender, uint256 indexed epoch, uint256 amount);
    event Claim(address indexed sender, uint256 indexed epoch, uint256 amount);
    event StartRound(bytes32 indexed pairId, uint256 indexed epoch);
    event LockRound(bytes32 indexed pairId, uint256 indexed epoch, int256 price);
    event EndRound(bytes32 indexed pairId, uint256 indexed epoch, int256 price);
    event RewardsCalculated(
        bytes32 indexed pairId, uint256 indexed epoch, uint256 rewardBaseCalAmount, uint256 rewardAmount, uint256 treasuryAmount
    );
    event PairAdded(string pairName, bytes32 pairId);
    event PairRemoved(string pairName, bytes32 pairId);
    event NewOracle(address oracle);
    event NewTreasuryFee(uint256 treasuryFee);
    event NewMinBetAmount(uint256 minBetAmount);
    event NewMaxBetAmount(uint256 maxBetAmount);
    event NewBufferAndInterval(uint256 bufferSeconds, uint256 intervalSeconds);
    event NewOperator(address operator);
    event NewAdmin(address admin);
    event Pause(uint256 timestamp);
    event Unpause(uint256 timestamp);
    event TreasuryClaim(uint256 amount);
    event StreakUpdate(address indexed user, uint256 streak);
    event BridgeToL1(address indexed user, uint256 amount, string receiver);
    event TapTokenSet(address indexed tapToken);
    event TapMinted(address indexed user, uint256 tapAmount);
    event CopyVaultSet(address indexed copyVault);
    event FeeDenomSet(string denom);
    event BridgeCallbackRegistered(uint64 indexed callbackId, address indexed user, uint256 amount);
    event BridgeCallbackReceived(uint64 indexed callbackId, bool success);
    event BridgeFailureRefunded(uint64 indexed callbackId, address indexed user, uint256 amount);
    event RefundAccrued(address indexed user, uint256 amount);
    event RefundClaimed(address indexed user, uint256 amount);
    event VipScoreSet(address indexed scorer);
    event VipStageUpdated(uint64 oldStage, uint64 newStage);
    event VipHookToggled(bool enabled);
    event VipScoreIncreaseFailed(address indexed user, uint64 stage, uint64 amount, bytes reason);
    event Erc20WrapperSet(address indexed wrapper);
    event BridgeToL1ViaWrapper(address indexed user, uint256 amount, string receiver);
    event BridgeViaWrapperDustRounded(address indexed user, uint256 totalReward, uint256 bridgeable, uint256 dust);
    event OracleMaxStaleBlocksUpdated(uint256 oldBlocks, uint256 newBlocks);
    event RoundForceAdvanced(bytes32 indexed pairId, uint256 stuckEpoch, uint256 newEpoch);

    modifier onlyAdmin() {
        if (msg.sender != adminAddress) revert NotAdmin();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operatorAddress) revert NotOperator();
        _;
    }

    modifier onlyAdminOrOperator() {
        if (msg.sender != adminAddress && msg.sender != operatorAddress) {
            revert NotAdminOrOperator();
        }
        _;
    }

    modifier validPair(bytes32 pairHash) {
        if (!pairState[pairHash].active) revert PairNotActive();
        _;
    }

    modifier onlyCosmosModule() {
        if (msg.sender != address(this)) revert OnlyChainCanCallback();
        _;
    }

    constructor(
        address _oracle,
        address _adminAddress,
        address _operatorAddress,
        uint256 _intervalSeconds,
        uint256 _bufferSeconds,
        uint256 _minBetAmount,
        uint256 _maxBetAmount,
        uint256 _treasuryFee,
        string[] memory _pairs
    ) Ownable(msg.sender) {
        if (_treasuryFee > MAX_TREASURY_FEE) revert InvalidTreasuryFee();
        if (_intervalSeconds == 0) revert InvalidInterval();
        if (_oracle == address(0)) revert ZeroAddress();
        if (_adminAddress == address(0)) revert ZeroAddress();
        if (_operatorAddress == address(0)) revert ZeroAddress();

        oracle = IConnectOracle(_oracle);
        adminAddress = _adminAddress;
        operatorAddress = _operatorAddress;
        intervalSeconds = _intervalSeconds;
        bufferSeconds = _bufferSeconds;
        minBetAmount = _minBetAmount;
        maxBetAmount = _maxBetAmount;
        treasuryFee = _treasuryFee;

        for (uint256 i = 0; i < _pairs.length; i++) {
            _addPair(_pairs[i]);
        }
    }

    function betBull(bytes32 pairHash, uint256 epoch) external payable whenNotPaused nonReentrant validPair(pairHash) {
        PairState storage ps = pairState[pairHash];
        if (epoch != ps.currentEpoch) revert InvalidEpoch();
        if (!_bettable(pairHash, epoch)) revert RoundNotBettable();
        if (msg.value < minBetAmount) revert BetTooSmall();
        if (msg.value > type(uint128).max) revert BetTooLarge();

        uint128 amount = uint128(msg.value);
        BetInfo storage existing = ledger[pairHash][epoch][msg.sender];
        if (maxBetAmount > 0 && uint256(existing.bullAmount) + uint256(amount) > maxBetAmount) revert BetTooLarge();

        bool isFirstBet = existing.bullAmount == 0 && existing.bearAmount == 0;

        Round storage round = rounds[pairHash][epoch];
        round.totalAmount += amount;
        round.bullAmount += amount;

        existing.bullAmount += amount;
        existing.claimed = false;

        if (isFirstBet) totalBets[msg.sender]++;

        emit BetBull(pairHash, msg.sender, epoch, msg.value);
    }

    function betBear(bytes32 pairHash, uint256 epoch) external payable whenNotPaused nonReentrant validPair(pairHash) {
        PairState storage ps = pairState[pairHash];
        if (epoch != ps.currentEpoch) revert InvalidEpoch();
        if (!_bettable(pairHash, epoch)) revert RoundNotBettable();
        if (msg.value < minBetAmount) revert BetTooSmall();
        if (msg.value > type(uint128).max) revert BetTooLarge();

        uint128 amount = uint128(msg.value);
        BetInfo storage existing = ledger[pairHash][epoch][msg.sender];
        if (maxBetAmount > 0 && uint256(existing.bearAmount) + uint256(amount) > maxBetAmount) revert BetTooLarge();

        bool isFirstBet = existing.bullAmount == 0 && existing.bearAmount == 0;

        Round storage round = rounds[pairHash][epoch];
        round.totalAmount += amount;
        round.bearAmount += amount;

        existing.bearAmount += amount;
        existing.claimed = false;

        if (isFirstBet) totalBets[msg.sender]++;

        emit BetBear(pairHash, msg.sender, epoch, msg.value);
    }

    function claim(bytes32[] calldata pairHashes, uint256[] calldata epochs) external nonReentrant {
        if (pairHashes.length != epochs.length) revert LengthMismatch();
        uint256 reward;

        for (uint256 i = 0; i < epochs.length;) {
            bytes32 ph = pairHashes[i];
            uint256 epoch = epochs[i];

            if (rounds[ph][epoch].startTimestamp == 0) revert InvalidEpoch();
            if (ledger[ph][epoch][msg.sender].claimed) revert NotClaimable();

            uint256 addedReward = 0;

            if (claimable(ph, epoch, msg.sender)) {
                Round storage round = rounds[ph][epoch];
                addedReward = _calcWinningReward(ledger[ph][epoch][msg.sender], round);
                _updateStreak(msg.sender, true);
                totalWins[msg.sender]++;
            } else if (refundable(ph, epoch, msg.sender)) {
                BetInfo storage betInfo = ledger[ph][epoch][msg.sender];
                addedReward = uint256(betInfo.bullAmount) + uint256(betInfo.bearAmount);
            } else {
                _updateStreak(msg.sender, false);
            }

            ledger[ph][epoch][msg.sender].claimed = true;
            reward += addedReward;

            unchecked { ++i; }
        }

        if (reward > 0) {
            if (COSMOS_CONTRACT.is_blocked_address(msg.sender)) revert TransferFailed();

            (bool success,) = msg.sender.call{value: reward}("");
            if (!success) revert TransferFailed();

            _mintTapReward(msg.sender, pairHashes, epochs);

            _reportVipScore(msg.sender, reward);
        }
    }

    function claimAndBridgeToL1(bytes32[] calldata pairHashes, uint256[] calldata epochs) external nonReentrant {
        if (pairHashes.length != epochs.length) revert LengthMismatch();
        uint256 reward;

        for (uint256 i = 0; i < epochs.length;) {
            bytes32 ph = pairHashes[i];
            uint256 epoch = epochs[i];

            if (rounds[ph][epoch].startTimestamp == 0) revert InvalidEpoch();
            if (ledger[ph][epoch][msg.sender].claimed) revert NotClaimable();

            uint256 addedReward = 0;

            if (claimable(ph, epoch, msg.sender)) {
                Round storage round = rounds[ph][epoch];
                addedReward = _calcWinningReward(ledger[ph][epoch][msg.sender], round);
                _updateStreak(msg.sender, true);
                totalWins[msg.sender]++;
            } else if (refundable(ph, epoch, msg.sender)) {
                BetInfo storage betInfo = ledger[ph][epoch][msg.sender];
                addedReward = uint256(betInfo.bullAmount) + uint256(betInfo.bearAmount);
            } else {
                _updateStreak(msg.sender, false);
            }

            ledger[ph][epoch][msg.sender].claimed = true;
            reward += addedReward;

            unchecked { ++i; }
        }

        if (reward > 0) {
            if (COSMOS_CONTRACT.is_blocked_address(msg.sender)) revert TransferFailed();

            string memory receiver = COSMOS_CONTRACT.to_cosmos_address(msg.sender);
            _opBridgeWithdrawWithCallback(msg.sender, receiver, reward);
            emit BridgeToL1(msg.sender, reward, receiver);

            _mintTapReward(msg.sender, pairHashes, epochs);

            _reportVipScore(msg.sender, reward);
        }
    }

    function claimAndBridgeViaWrapper(
        bytes32[] calldata pairHashes,
        uint256[] calldata epochs,
        string calldata localDenom
    ) external nonReentrant {
        if (address(erc20Wrapper) == address(0)) revert WrapperNotSet();
        if (pairHashes.length != epochs.length) revert LengthMismatch();

        uint256 reward;
        for (uint256 i = 0; i < epochs.length;) {
            bytes32 ph = pairHashes[i];
            uint256 epoch = epochs[i];

            if (rounds[ph][epoch].startTimestamp == 0) revert InvalidEpoch();
            if (ledger[ph][epoch][msg.sender].claimed) revert NotClaimable();

            uint256 addedReward = 0;
            if (claimable(ph, epoch, msg.sender)) {
                Round storage round = rounds[ph][epoch];
                addedReward = _calcWinningReward(ledger[ph][epoch][msg.sender], round);
                _updateStreak(msg.sender, true);
                totalWins[msg.sender]++;
            } else if (refundable(ph, epoch, msg.sender)) {
                BetInfo storage betInfo = ledger[ph][epoch][msg.sender];
                addedReward = uint256(betInfo.bullAmount) + uint256(betInfo.bearAmount);
            } else {
                _updateStreak(msg.sender, false);
            }

            ledger[ph][epoch][msg.sender].claimed = true;
            reward += addedReward;

            unchecked { ++i; }
        }

        if (reward > 0) {
            if (COSMOS_CONTRACT.is_blocked_address(msg.sender)) revert TransferFailed();

            uint256 dust = reward % 1e12;
            uint256 bridgeable = reward - dust;
            if (bridgeable == 0) revert WrapperDustOnly();

            (bool success,) = msg.sender.call{value: reward}("");
            if (!success) revert TransferFailed();

            _mintTapReward(msg.sender, pairHashes, epochs);
            _reportVipScore(msg.sender, reward);

            if (dust != 0) {
                emit BridgeViaWrapperDustRounded(msg.sender, reward, bridgeable, dust);
            }

            string memory receiver = COSMOS_CONTRACT.to_cosmos_address(msg.sender);
            erc20Wrapper.toRemoteAndOPWithdraw(receiver, localDenom, bridgeable, BRIDGE_GAS_LIMIT);
            emit BridgeToL1ViaWrapper(msg.sender, bridgeable, receiver);
        }
    }

    function genesisStartRound(bytes32 pairHash) external onlyOperator whenNotPaused validPair(pairHash) {
        PairState storage ps = pairState[pairHash];
        if (ps.genesisStartOnce) revert GenesisAlreadyStarted();

        ps.currentEpoch++;
        _startRound(pairHash, ps.currentEpoch);
        ps.genesisStartOnce = true;
    }

    function genesisLockRound(bytes32 pairHash) external onlyOperator whenNotPaused validPair(pairHash) {
        PairState storage ps = pairState[pairHash];
        if (!ps.genesisStartOnce) revert GenesisNotStarted();
        if (ps.genesisLockOnce) revert GenesisAlreadyLocked();

        (int128 currentPrice, uint64 currentNonce) = _getPriceFromOracle(pairHash);

        _safeLockRound(pairHash, ps.currentEpoch, currentPrice, currentNonce);

        ps.currentEpoch++;
        _startRound(pairHash, ps.currentEpoch);
        ps.genesisLockOnce = true;
    }

    function executeRound(bytes32 pairHash) external onlyOperator whenNotPaused validPair(pairHash) {
        PairState storage ps = pairState[pairHash];
        if (!ps.genesisStartOnce) revert GenesisNotStarted();
        if (!ps.genesisLockOnce) revert GenesisNotLocked();

        (int128 currentPrice, uint64 currentNonce) = _getPriceFromOracle(pairHash);
        ps.oracleLatestNonce = currentNonce;

        _safeLockRound(pairHash, ps.currentEpoch, currentPrice, currentNonce);
        _safeEndRound(pairHash, ps.currentEpoch - 1, currentPrice, currentNonce);
        _calculateRewards(pairHash, ps.currentEpoch - 1);

        ps.currentEpoch++;
        _startRound(pairHash, ps.currentEpoch);
    }

    function executeRoundsAll() external onlyOperator whenNotPaused {
        uint256 pairCount = activePairs.length;
        if (pairCount == 0) return;

        string[] memory pairIds = new string[](pairCount);
        for (uint256 i = 0; i < pairCount; i++) {
            pairIds[i] = activePairs[i];
        }

        IConnectOracle.Price[] memory prices = oracle.get_prices(pairIds);

        for (uint256 i = 0; i < pairCount; i++) {
            bytes32 ph = keccak256(bytes(activePairs[i]));
            PairState storage ps = pairState[ph];

            if (!ps.genesisStartOnce || !ps.genesisLockOnce) continue;

            if (prices[i].price == 0) continue;
            if (prices[i].price > uint256(uint128(type(int128).max))) continue;
            if (uint64(block.number) > prices[i].height + oracleMaxStaleBlocks) continue;

            int128 currentPrice = int128(int256(prices[i].price));
            uint64 currentNonce = prices[i].nonce;
            if (currentNonce <= ps.oracleLatestNonce && ps.oracleLatestNonce != 0) continue;

            ps.oracleLatestNonce = currentNonce;

            Round storage currentRound = rounds[ph][ps.currentEpoch];
            if (block.timestamp < currentRound.lockTimestamp) continue;
            if (block.timestamp > currentRound.lockTimestamp + bufferSeconds) continue;

            Round storage prevRound = rounds[ph][ps.currentEpoch - 1];
            if (block.timestamp < prevRound.closeTimestamp) continue;
            if (block.timestamp > prevRound.closeTimestamp + bufferSeconds) continue;

            _safeLockRound(ph, ps.currentEpoch, currentPrice, currentNonce);
            _safeEndRound(ph, ps.currentEpoch - 1, currentPrice, currentNonce);
            _calculateRewards(ph, ps.currentEpoch - 1);

            ps.currentEpoch++;
            _startRound(ph, ps.currentEpoch);
        }
    }


    function addPair(string calldata pairName) external onlyAdmin {
        _addPair(pairName);
    }

    function removePair(string calldata pairName) external whenPaused onlyAdmin {
        bytes32 ph = keccak256(bytes(pairName));
        if (!pairState[ph].active) revert PairNotActive();

        pairState[ph].active = false;

        for (uint256 i = 0; i < activePairs.length; i++) {
            if (keccak256(bytes(activePairs[i])) == ph) {
                activePairs[i] = activePairs[activePairs.length - 1];
                activePairs.pop();
                break;
            }
        }

        emit PairRemoved(pairName, ph);
    }

    function pause() external onlyAdminOrOperator {
        _pause();
        emit Pause(block.timestamp);
    }

    function unpause() external onlyAdminOrOperator {
        for (uint256 i = 0; i < activePairs.length; i++) {
            bytes32 ph = keccak256(bytes(activePairs[i]));
            pairState[ph].genesisStartOnce = false;
            pairState[ph].genesisLockOnce = false;
        }
        _unpause();
        emit Unpause(block.timestamp);
    }

    function setBufferAndIntervalSeconds(uint256 _bufferSeconds, uint256 _intervalSeconds)
        external
        whenPaused
        onlyAdmin
    {
        if (_intervalSeconds == 0) revert InvalidInterval();
        bufferSeconds = _bufferSeconds;
        intervalSeconds = _intervalSeconds;
        emit NewBufferAndInterval(_bufferSeconds, _intervalSeconds);
    }

    function setMinBetAmount(uint256 _minBetAmount) external whenPaused onlyAdmin {
        minBetAmount = _minBetAmount;
        emit NewMinBetAmount(_minBetAmount);
    }

    function setMaxBetAmount(uint256 _maxBetAmount) external whenPaused onlyAdmin {
        maxBetAmount = _maxBetAmount;
        emit NewMaxBetAmount(_maxBetAmount);
    }

    function setTreasuryFee(uint256 _treasuryFee) external whenPaused onlyAdmin {
        if (_treasuryFee > MAX_TREASURY_FEE) revert InvalidTreasuryFee();
        treasuryFee = _treasuryFee;
        emit NewTreasuryFee(_treasuryFee);
    }

    function setOracle(address _oracle) external whenPaused onlyAdmin {
        oracle = IConnectOracle(_oracle);
        emit NewOracle(_oracle);
    }

    function setOperator(address _operatorAddress) external onlyAdmin {
        operatorAddress = _operatorAddress;
        emit NewOperator(_operatorAddress);
    }

    function setAdmin(address _adminAddress) external onlyOwner {
        adminAddress = _adminAddress;
        emit NewAdmin(_adminAddress);
    }

    function claimTreasury() external nonReentrant onlyAdmin {
        uint256 currentTreasuryAmount = treasuryAmount;
        treasuryAmount = 0;

        if (COSMOS_CONTRACT.is_blocked_address(adminAddress)) revert TransferFailed();

        (bool success,) = adminAddress.call{value: currentTreasuryAmount}("");
        if (!success) revert TransferFailed();

        emit TreasuryClaim(currentTreasuryAmount);
    }

    function bridgeTreasuryToL1() external nonReentrant onlyAdmin {
        uint256 currentTreasuryAmount = treasuryAmount;
        treasuryAmount = 0;

        string memory receiver = COSMOS_CONTRACT.to_cosmos_address(adminAddress);
        _opBridgeWithdrawWithCallback(adminAddress, receiver, currentTreasuryAmount);
        emit TreasuryClaim(currentTreasuryAmount);
        emit BridgeToL1(adminAddress, currentTreasuryAmount, receiver);
    }

    function setFeeDenom(string calldata _denom) external onlyAdmin whenPaused {
        if (bytes(feeDenom).length != 0) revert FeeDenomAlreadySet();
        if (bytes(_denom).length == 0) revert EmptyDenom();
        feeDenom = _denom;
        emit FeeDenomSet(_denom);
    }

    function setTapToken(address _tapToken) external onlyAdmin {
        if (address(tapToken) != address(0)) revert TapTokenAlreadySet();
        tapToken = TapToken(_tapToken);
        emit TapTokenSet(_tapToken);
    }

    function setCopyVault(address _copyVault) external onlyAdmin {
        if (copyVault != address(0)) revert CopyVaultAlreadySet();
        if (_copyVault == address(0)) revert ZeroAddress();
        copyVault = _copyVault;
        emit CopyVaultSet(_copyVault);
    }

    function setVipScore(address _vipScore) external onlyAdmin {
        if (_vipScore == address(0)) revert ZeroAddress();
        if (address(vipScore) != address(0)) revert VipScoreAlreadySet();
        vipScore = IVipScore(_vipScore);
        emit VipScoreSet(_vipScore);
    }

    function setVipStage(uint64 _stage) external onlyAdmin {
        if (_stage == 0) revert InvalidVipStage();
        uint64 old = vipStage;
        vipStage = _stage;
        emit VipStageUpdated(old, _stage);
    }

    function setVipHookEnabled(bool _enabled) external onlyAdmin {
        vipHookEnabled = _enabled;
        emit VipHookToggled(_enabled);
    }

    function setErc20Wrapper(address _wrapper) external onlyAdmin {
        if (_wrapper == address(0)) revert ZeroAddress();
        if (address(erc20Wrapper) != address(0)) revert WrapperAlreadySet();
        erc20Wrapper = IERC20Wrapper(_wrapper);
        emit Erc20WrapperSet(_wrapper);
    }

    function setOracleMaxStaleBlocks(uint256 _blocks) external onlyAdmin whenPaused {
        if (_blocks < 5 || _blocks > MAX_ORACLE_STALENESS_HARD_CAP) revert InvalidStalenessWindow();
        uint256 old = oracleMaxStaleBlocks;
        oracleMaxStaleBlocks = _blocks;
        emit OracleMaxStaleBlocksUpdated(old, _blocks);
    }

    function addPairValidated(string calldata pairName) external onlyAdmin {
        IConnectOracle.Price memory price = oracle.get_price(pairName);
        if (price.nonce == 0) revert OraclePriceInvalid();
        _addPair(pairName);
    }

    /// @notice Recovery function: force-advances a stuck pair past its missed
    ///         execution window. Abandons the two in-flight rounds (currentEpoch
    ///         and currentEpoch-1) without oracle data so bettors can claim
    ///         refunds via `refundable()`, then resets the genesis lifecycle for
    ///         this pair so the operator can restart it cleanly.
    /// @dev    Does NOT require whenNotPaused so it can be called even while the
    ///         protocol is paused for emergency recovery.
    /// @param pairHash The keccak256 hash of the pair name (e.g. "BTC/USD")
    function forceAdvanceRound(bytes32 pairHash) external onlyAdmin {
        PairState storage ps = pairState[pairHash];
        if (!ps.active) revert PairNotActive();
        if (!ps.genesisStartOnce) revert GenesisNotStarted();

        uint256 stuckEpoch = ps.currentEpoch;

        // Verify the pair is actually stuck: current round's lock window must
        // have been missed (block.timestamp > lockTimestamp + bufferSeconds).
        Round storage currentRound = rounds[pairHash][stuckEpoch];
        if (currentRound.lockTimestamp == 0) revert RoundNotStuck();
        if (block.timestamp <= currentRound.lockTimestamp + bufferSeconds) {
            revert RoundNotStuck();
        }

        // Leave both in-flight rounds with oracleCalled = false so bettors
        // can claim refunds via refundable() once closeTimestamp + buffer
        // passes. No prices, no rewards: a clean abandonment.

        // Reset genesis flags for this pair only. The operator must call
        // genesisStartRound and genesisLockRound to re-enter the normal
        // round lifecycle (which naturally increments currentEpoch and
        // starts fresh rounds that the next executeRound can process).
        ps.genesisStartOnce = false;
        ps.genesisLockOnce = false;

        emit RoundForceAdvanced(pairHash, stuckEpoch, ps.currentEpoch);
    }

    function claimable(bytes32 pairHash, uint256 epoch, address user) public view returns (bool) {
        BetInfo memory betInfo = ledger[pairHash][epoch][user];
        Round memory round = rounds[pairHash][epoch];

        bool hasBet = betInfo.bullAmount > 0 || betInfo.bearAmount > 0;
        if (!round.oracleCalled || !hasBet || betInfo.claimed) return false;

        // Draw: everyone with any bet gets a refund
        if (round.closePrice == round.lockPrice) return true;

        // Bulls win: claimable if user has a bull position
        if (round.closePrice > round.lockPrice && betInfo.bullAmount > 0) return true;

        // Bears win: claimable if user has a bear position
        if (round.closePrice < round.lockPrice && betInfo.bearAmount > 0) return true;

        return false;
    }

    function refundable(bytes32 pairHash, uint256 epoch, address user) public view returns (bool) {
        BetInfo memory betInfo = ledger[pairHash][epoch][user];
        Round memory round = rounds[pairHash][epoch];

        bool hasBet = betInfo.bullAmount > 0 || betInfo.bearAmount > 0;
        return !round.oracleCalled && !betInfo.claimed
            && block.timestamp > round.closeTimestamp + bufferSeconds
            && hasBet;
    }

    function getActivePairsCount() external view returns (uint256) {
        return activePairs.length;
    }

    function getActivePairs() external view returns (string[] memory) {
        return activePairs;
    }

    function getPairHash(string calldata pairName) external pure returns (bytes32) {
        return keccak256(bytes(pairName));
    }

    function queryAvailableOraclePairs() external view returns (string memory) {
        return COSMOS_CONTRACT.query_cosmos(
            "/connect.oracle.v2.Query/GetAllCurrencyPairs",
            "{}"
        );
    }

    function getCosmosAddress() external view returns (string memory) {
        return COSMOS_CONTRACT.to_cosmos_address(address(this));
    }

    function getTokenDenom(address token) external view returns (string memory) {
        return COSMOS_CONTRACT.to_denom(token);
    }

    function _addPair(string memory pairName) internal {
        bytes32 ph = keccak256(bytes(pairName));
        if (pairState[ph].active) revert PairAlreadyActive();
        if (activePairs.length >= MAX_PAIRS) revert TooManyPairs();

        pairState[ph] = PairState({
            currentEpoch: 0,
            oracleLatestNonce: 0,
            genesisStartOnce: false,
            genesisLockOnce: false,
            active: true
        });
        pairNames[ph] = pairName;
        activePairs.push(pairName);

        emit PairAdded(pairName, ph);
    }

    function _startRound(bytes32 pairHash, uint256 epoch) internal {
        Round storage round = rounds[pairHash][epoch];
        round.epoch = epoch;
        round.startTimestamp = uint64(block.timestamp);
        round.lockTimestamp = uint64(block.timestamp + intervalSeconds);
        round.closeTimestamp = uint64(block.timestamp + 2 * intervalSeconds);
        round.totalAmount = 0;

        emit StartRound(pairHash, epoch);
    }

    function _safeLockRound(bytes32 pairHash, uint256 epoch, int128 price, uint64 nonce) internal {
        Round storage round = rounds[pairHash][epoch];
        if (block.timestamp < round.lockTimestamp) revert RoundNotLockable();
        if (block.timestamp > round.lockTimestamp + bufferSeconds) revert RoundNotLockable();

        round.lockPrice = price;
        round.lockOracleNonce = nonce;
        round.closeTimestamp = uint64(block.timestamp + intervalSeconds);

        emit LockRound(pairHash, epoch, int256(price));
    }

    function _safeEndRound(bytes32 pairHash, uint256 epoch, int128 price, uint64 nonce) internal {
        Round storage round = rounds[pairHash][epoch];
        if (block.timestamp < round.closeTimestamp) revert RoundNotEndable();
        if (block.timestamp > round.closeTimestamp + bufferSeconds) revert RoundNotEndable();

        round.closePrice = price;
        round.closeOracleNonce = nonce;
        round.oracleCalled = true;

        emit EndRound(pairHash, epoch, int256(price));
    }

    function _calculateRewards(bytes32 pairHash, uint256 epoch) internal {
        Round storage round = rounds[pairHash][epoch];
        uint256 rewardAmount;
        uint256 treasuryAmt;
        uint256 rewardBaseCalAmount;

        if (round.closePrice > round.lockPrice) {
            rewardBaseCalAmount = uint256(round.bullAmount);
            treasuryAmt = (uint256(round.totalAmount) * treasuryFee) / 10000;
            rewardAmount = uint256(round.totalAmount) - treasuryAmt;
        } else if (round.closePrice < round.lockPrice) {
            rewardBaseCalAmount = uint256(round.bearAmount);
            treasuryAmt = (uint256(round.totalAmount) * treasuryFee) / 10000;
            rewardAmount = uint256(round.totalAmount) - treasuryAmt;
        } else {
            rewardBaseCalAmount = uint256(round.totalAmount);
            rewardAmount = uint256(round.totalAmount);
            treasuryAmt = 0;
        }

        round.rewardBaseCalAmount = uint128(rewardBaseCalAmount);
        round.rewardAmount = uint128(rewardAmount);
        treasuryAmount += treasuryAmt;

        emit RewardsCalculated(pairHash, epoch, rewardBaseCalAmount, rewardAmount, treasuryAmt);
    }

    function _getPriceFromOracle(bytes32 pairHash) internal returns (int128, uint64) {
        string memory pairName = pairNames[pairHash];
        IConnectOracle.Price memory price = oracle.get_price(pairName);

        if (price.price == 0) revert OraclePriceInvalid();

        if (uint64(block.number) > price.height + oracleMaxStaleBlocks) {
            revert OracleStale();
        }

        uint256 tsBound = price.timestamp + (oracleMaxStaleBlocks * ASSUMED_BLOCK_TIME_SECONDS);
        if (price.timestamp != 0 && block.timestamp > tsBound) {
            revert OracleStale();
        }

        PairState storage ps = pairState[pairHash];
        if (price.nonce <= ps.oracleLatestNonce && ps.oracleLatestNonce != 0) {
            revert OracleStale();
        }

        if (price.price > uint256(uint128(type(int128).max))) revert OraclePriceInvalid();

        return (int128(int256(price.price)), price.nonce);
    }

    /// @notice Calculate the reward for a winning bet, handling bull-win, bear-win, and draw cases.
    /// @dev For draw rounds, the full bet (both sides) is returned as a refund.
    ///      For directional wins, only the winning side earns the proportional share of the reward pool.
    ///      The losing side's amount is forfeited to the winners pool.
    function _calcWinningReward(BetInfo storage betInfo, Round storage round) internal view returns (uint256) {
        if (round.closePrice == round.lockPrice) {
            // Draw: full refund of both sides
            return uint256(betInfo.bullAmount) + uint256(betInfo.bearAmount);
        } else if (round.closePrice > round.lockPrice) {
            // Bulls win: reward proportional to bullAmount
            return (uint256(betInfo.bullAmount) * uint256(round.rewardAmount)) / uint256(round.rewardBaseCalAmount);
        } else {
            // Bears win: reward proportional to bearAmount
            return (uint256(betInfo.bearAmount) * uint256(round.rewardAmount)) / uint256(round.rewardBaseCalAmount);
        }
    }

    function _bettable(bytes32 pairHash, uint256 epoch) internal view returns (bool) {
        Round memory round = rounds[pairHash][epoch];
        return round.startTimestamp != 0 && round.lockTimestamp != 0
            && block.timestamp >= round.startTimestamp && block.timestamp < round.lockTimestamp;
    }

    function _updateStreak(address user, bool won) internal {
        if (won) {
            currentStreak[user]++;
            if (currentStreak[user] > maxStreak[user]) {
                maxStreak[user] = currentStreak[user];
            }
        } else {
            currentStreak[user] = 0;
        }
        emit StreakUpdate(user, currentStreak[user]);
    }

    function _opBridgeWithdrawWithCallback(address user, string memory receiver, uint256 amount) internal {
        uint64 id = ++cosmosCallbackIdCounter;

        pendingCosmosCallbacks[id] = CosmosCallbackRecord({
            user: user,
            amount: amount,
            active: true
        });
        emit BridgeCallbackRegistered(id, user, amount);

        string memory sender = COSMOS_CONTRACT.to_cosmos_address(address(this));
        string memory message = string(
            abi.encodePacked(
                '{"@type": "/opinit.opchild.v1.MsgInitiateTokenWithdrawal"',
                ',"sender": "', sender,
                '","to": "', receiver,
                '","amount": {"denom": "', _getNativeDenom(),
                '","amount": "', UintToString.toString(amount),
                '"}}'
            )
        );

        bool success = COSMOS_CONTRACT.execute_cosmos_with_options(
            message,
            BRIDGE_GAS_LIMIT,
            ICosmos.Options({allow_failure: true, callback_id: id})
        );
        if (!success) {
            delete pendingCosmosCallbacks[id];
            revert BridgeFailed();
        }
    }

    function callback(uint64 callback_id, bool success) external onlyCosmosModule nonReentrant {
        CosmosCallbackRecord memory record = pendingCosmosCallbacks[callback_id];
        if (!record.active) return;

        delete pendingCosmosCallbacks[callback_id];
        emit BridgeCallbackReceived(callback_id, success);

        if (!success) {
            pendingRefunds[record.user] += record.amount;
            emit RefundAccrued(record.user, record.amount);
            emit BridgeFailureRefunded(callback_id, record.user, record.amount);
        }
    }

    function claimRefund() external nonReentrant {
        uint256 amount = pendingRefunds[msg.sender];
        if (amount == 0) revert NoRefundPending();
        if (COSMOS_CONTRACT.is_blocked_address(msg.sender)) revert TransferFailed();

        pendingRefunds[msg.sender] = 0;

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit RefundClaimed(msg.sender, amount);
    }

    function buildAsyncCallbackMemo(uint64 callbackId, string calldata userMemo) external view returns (string memory) {
        string memory baseMemo = string(abi.encodePacked(
            '{"evm": {"async_callback": {"id": ',
            UintToString.toString(uint256(callbackId)),
            ',"contract_address":"0x',
            _toHexString(address(this)),
            '"}}}'
        ));
        if (bytes(userMemo).length == 0) return baseMemo;
        return JSONUTILS_CONTRACT.merge_json(baseMemo, userMemo);
    }

    function _toHexString(address a) internal pure returns (string memory) {
        bytes memory data = abi.encodePacked(a);
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(40);
        for (uint256 i = 0; i < 20; i++) {
            str[i*2] = alphabet[uint8(data[i] >> 4)];
            str[i*2+1] = alphabet[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }

    function _mintTapReward(address user, bytes32[] calldata pairHashes, uint256[] calldata epochs) internal {
        if (address(tapToken) == address(0)) return;
        if (user == copyVault && copyVault != address(0)) return;

        uint256 totalBetAmount;
        for (uint256 i = 0; i < pairHashes.length;) {
            BetInfo storage bet = ledger[pairHashes[i]][epochs[i]][user];
            totalBetAmount += uint256(bet.bullAmount) + uint256(bet.bearAmount);
            unchecked { ++i; }
        }

        uint256 tapReward = totalBetAmount / 1e16;
        if (tapReward > 0) {
            tapToken.mint(user, tapReward * 1e18);
            emit TapMinted(user, tapReward * 1e18);
        }
    }

    function _reportVipScore(address user, uint256 reward) internal {
        if (!vipHookEnabled) return;
        if (address(vipScore) == address(0)) return;
        if (user == address(0)) return;
        if (user == copyVault && copyVault != address(0)) return; // vault proxy: skip

        uint256 points = reward / 1e16;
        if (points == 0) return;
        if (points > type(uint64).max) points = type(uint64).max;

        uint64 amount = uint64(points);
        uint64 stage = vipStage;

        if (address(vipScore).code.length == 0) {
            emit VipScoreIncreaseFailed(user, stage, amount, bytes("NO_CODE"));
            return;
        }

        try vipScore.increaseScore{gas: 80_000}(stage, user, amount) {
        } catch (bytes memory reason) {
            emit VipScoreIncreaseFailed(user, stage, amount, reason);
        }
    }

    function _getNativeDenom() internal view returns (string memory) {
        return bytes(feeDenom).length > 0 ? feeDenom : "uinit";
    }

    receive() external payable {}
}
