// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICopyVault} from "./interfaces/ICopyVault.sol";
import {COSMOS_CONTRACT} from "./interfaces/ICosmos.sol";
import {IVipScore} from "./interfaces/IVipScore.sol";

interface ITapPredictor {
    function betBull(bytes32 pairHash, uint256 epoch) external payable;
    function betBear(bytes32 pairHash, uint256 epoch) external payable;
    function claim(bytes32[] calldata pairHashes, uint256[] calldata epochs) external;
    function minBetAmount() external view returns (uint256);
    function maxBetAmount() external view returns (uint256);
}

interface IAgentRegistry {
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

    function getAgentPerformanceFeeBps(uint256 agentId) external view returns (uint256);
    function getAgentCreator(uint256 agentId) external view returns (address);
    function getAgent(uint256 agentId) external view returns (Agent memory);
    function getAgentShareToken(uint256 agentId) external view returns (address);
}


contract CopyVault is ICopyVault, Ownable, Pausable, ReentrancyGuard {
    
    error UnauthorizedDeposit();
    error BlockedAddress();
    error AgentInactive();
    error InvalidMaxExposure();
    error HasPendingExposure();
    error VaultBettingSlotTaken(uint256 existingAgent);
    error MaxFollowersReached();
    error VipScoreAlreadySet();
    error InvalidVipStage();

    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 5000;
    uint256 public constant CREATOR_SHARE_BPS = 7000;
    uint256 public constant PLATFORM_SHARE_BPS = 3000;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_FOLLOWERS_PER_AGENT = 100;

    ITapPredictor public predictor;
    IAgentRegistry public registry;
    IVipScore public vipScore;

    address public executor;
    address public platformFeeRecipient;
    uint256 public maxExposureBps = 5000;
    uint64 public vipStage;
    bool public vipHookEnabled;

    mapping(uint256 => mapping(address => uint256)) public deposits;
    mapping(uint256 => address[]) internal _followers;
    mapping(uint256 => mapping(address => bool)) public isFollower;
    mapping(uint256 => mapping(address => uint256)) public activeExposure;
    mapping(uint256 => mapping(address => uint256)) public depositBasis;
    mapping(bytes32 => uint256) public roundTotalBets;
    mapping(bytes32 => mapping(address => uint256)) public roundFollowerBets;
    mapping(bytes32 => bool) public roundClaimed;
    mapping(bytes32 => uint256) public roundSlotOwner;
    mapping(address => uint256) public frozenDeposits;

    event DepositFrozen(address indexed follower, uint256 amount);
    event MaxExposureBpsUpdated(uint256 oldBps, uint256 newBps);
    event VipScoreSet(address indexed scorer);
    event VipStageUpdated(uint64 oldStage, uint64 newStage);
    event VipHookToggled(bool enabled);
    event VipScoreIncreaseFailed(address indexed user, uint64 stage, uint64 amount, bytes reason);

    modifier onlyExecutor() {
        if (msg.sender != executor) revert NotExecutor();
        _;
    }

    constructor(address _owner, address _platformFeeRecipient) Ownable(_owner) {
        if (_platformFeeRecipient == address(0)) revert ZeroAddress();
        platformFeeRecipient = _platformFeeRecipient;
    }

    function deposit(uint256 agentId) external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert ZeroAmount();

        if (COSMOS_CONTRACT.is_blocked_address(msg.sender)) revert BlockedAddress();

        deposits[agentId][msg.sender] += msg.value;

        if (deposits[agentId][msg.sender] > depositBasis[agentId][msg.sender]) {
            depositBasis[agentId][msg.sender] = deposits[agentId][msg.sender];
        }

        if (!isFollower[agentId][msg.sender]) {
            if (_followers[agentId].length >= MAX_FOLLOWERS_PER_AGENT) revert MaxFollowersReached();
            isFollower[agentId][msg.sender] = true;
            _followers[agentId].push(msg.sender);
        }

        emit Deposited(agentId, msg.sender, msg.value);
    }

    function withdraw(uint256 agentId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (COSMOS_CONTRACT.is_blocked_address(msg.sender)) revert BlockedAddress();
        if (deposits[agentId][msg.sender] < amount) revert InsufficientDeposit();

        uint256 newDeposit = deposits[agentId][msg.sender] - amount;
        if (newDeposit == 0 && activeExposure[agentId][msg.sender] > 0) {
            revert HasPendingExposure();
        }

        deposits[agentId][msg.sender] = newDeposit;

        if (newDeposit == 0) {
            _removeFollower(agentId, msg.sender);
            depositBasis[agentId][msg.sender] = 0;
        }

        emit Withdrawn(agentId, msg.sender, amount);

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function executeCopyTrades(bytes32 pairHash, uint256 agentId, uint256 epoch, bool isBull, uint256 betPercentBps)
        external
        onlyExecutor
        nonReentrant
        whenNotPaused
    {
        if (betPercentBps == 0 || betPercentBps > BPS_DENOMINATOR) revert InvalidBps();
        if (COSMOS_CONTRACT.is_blocked_address(msg.sender)) revert BlockedAddress();
        _requireAgentActive(agentId);

        address[] storage followerList = _followers[agentId];
        uint256 followerCount = followerList.length;
        if (followerCount == 0) revert NoFollowers();

        bytes32 predictorSlot = keccak256(abi.encodePacked(pairHash, epoch));
        uint256 existing = roundSlotOwner[predictorSlot];
        if (existing != 0 && existing != agentId) revert VaultBettingSlotTaken(existing);
        if (existing == 0) roundSlotOwner[predictorSlot] = agentId;

        uint256 minBet = predictor.minBetAmount();
        uint256 maxBet = predictor.maxBetAmount();

        bytes32 roundKey = _roundKey(agentId, pairHash, epoch);

        uint256 totalBetAmount;
        uint256 actualFollowerCount;

        for (uint256 i; i < followerCount;) {
            address follower = followerList[i];
            uint256 followerDeposit = deposits[agentId][follower];

            uint256 followerBet = (followerDeposit * betPercentBps) / BPS_DENOMINATOR;

            if (followerBet >= minBet) {
                if (maxBet > 0 && followerBet > maxBet) {
                    followerBet = maxBet;
                }

                if (followerBet > followerDeposit) {
                    followerBet = followerDeposit;
                }

                uint256 basis = depositBasis[agentId][follower];
                uint256 maxAllowed = (basis * maxExposureBps) / BPS_DENOMINATOR;
                uint256 currentExposure = activeExposure[agentId][follower];
                if (currentExposure + followerBet > maxAllowed) {
                    if (maxAllowed > currentExposure) {
                        followerBet = maxAllowed - currentExposure;
                    } else {
                        unchecked { ++i; }
                        continue;
                    }
                    if (followerBet < minBet) {
                        unchecked { ++i; }
                        continue;
                    }
                }

                deposits[agentId][follower] -= followerBet;
                activeExposure[agentId][follower] += followerBet;
                roundFollowerBets[roundKey][follower] += followerBet;
                totalBetAmount += followerBet;
                actualFollowerCount++;
            }

            unchecked { ++i; }
        }

        if (totalBetAmount == 0) revert ZeroAmount();

        roundTotalBets[roundKey] = totalBetAmount;

        if (isBull) {
            predictor.betBull{value: totalBetAmount}(pairHash, epoch);
        } else {
            predictor.betBear{value: totalBetAmount}(pairHash, epoch);
        }

        emit CopyTradeExecuted(agentId, pairHash, epoch, isBull, totalBetAmount, actualFollowerCount);
    }

    function claimForFollowers(bytes32[] calldata pairHashes, uint256[] calldata epochs, uint256 agentId)
        external
        onlyExecutor
        nonReentrant
    {
        if (pairHashes.length != epochs.length) revert ArrayLengthMismatch();
        if (pairHashes.length == 0) revert ZeroAmount();
        if (COSMOS_CONTRACT.is_blocked_address(msg.sender)) revert BlockedAddress();

        uint256 totalOriginalBet;
        bytes32[] memory roundKeys = new bytes32[](pairHashes.length);

        for (uint256 i; i < pairHashes.length;) {
            roundKeys[i] = _roundKey(agentId, pairHashes[i], epochs[i]);
            if (roundClaimed[roundKeys[i]]) revert AlreadyClaimed();
            totalOriginalBet += roundTotalBets[roundKeys[i]];
            unchecked { ++i; }
        }

        if (totalOriginalBet == 0) revert ZeroAmount();

        for (uint256 i; i < roundKeys.length;) {
            roundClaimed[roundKeys[i]] = true;
            unchecked { ++i; }
        }

        uint256 balanceBefore = address(this).balance;
        predictor.claim(pairHashes, epochs);
        uint256 balanceAfter = address(this).balance;

        uint256 totalClaimed = balanceAfter - balanceBefore;

        uint256 totalFees;
        uint256 distributable = totalClaimed;

        if (totalClaimed > totalOriginalBet) {
            uint256 profit = totalClaimed - totalOriginalBet;

            uint256 performanceFeeBps = _getAgentPerformanceFeeBps(agentId);
            if (performanceFeeBps > MAX_PERFORMANCE_FEE_BPS) {
                performanceFeeBps = MAX_PERFORMANCE_FEE_BPS;
            }

            totalFees = (profit * performanceFeeBps) / BPS_DENOMINATOR;
            distributable = totalClaimed - totalFees;

            if (totalFees > 0) {
                _distributePerformanceFee(agentId, totalFees);
            }
        }

        _distributeToFollowers(agentId, roundKeys, distributable, totalOriginalBet);

        emit RewardsDistributed(agentId, pairHashes[0], epochs[0], totalClaimed, totalFees);
    }

    function setPredictor(address _predictor) external onlyOwner {
        if (_predictor == address(0)) revert ZeroAddress();
        predictor = ITapPredictor(_predictor);
        emit PredictorUpdated(_predictor);
    }

    function setRegistry(address _registry) external onlyOwner {
        if (_registry == address(0)) revert ZeroAddress();
        registry = IAgentRegistry(_registry);
        emit RegistryUpdated(_registry);
    }

    function setExecutor(address _executor) external onlyOwner {
        if (_executor == address(0)) revert ZeroAddress();
        executor = _executor;
        emit ExecutorUpdated(_executor);
    }

    function setPlatformFeeRecipient(address _recipient) external onlyOwner {
        if (_recipient == address(0)) revert ZeroAddress();
        platformFeeRecipient = _recipient;
        emit PlatformFeeRecipientUpdated(_recipient);
    }

    function setMaxExposureBps(uint256 _maxExposureBps) external onlyOwner {
        if (_maxExposureBps == 0 || _maxExposureBps > BPS_DENOMINATOR) revert InvalidMaxExposure();
        uint256 old = maxExposureBps;
        maxExposureBps = _maxExposureBps;
        emit MaxExposureBpsUpdated(old, _maxExposureBps);
    }

    function setVipScore(address _vipScore) external onlyOwner {
        if (_vipScore == address(0)) revert ZeroAddress();
        if (address(vipScore) != address(0)) revert VipScoreAlreadySet();
        vipScore = IVipScore(_vipScore);
        emit VipScoreSet(_vipScore);
    }

    function setVipStage(uint64 _stage) external onlyOwner {
        if (_stage == 0) revert InvalidVipStage();
        uint64 old = vipStage;
        vipStage = _stage;
        emit VipStageUpdated(old, _stage);
    }

    function setVipHookEnabled(bool _enabled) external onlyOwner {
        vipHookEnabled = _enabled;
        emit VipHookToggled(_enabled);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getFollowers(uint256 agentId) external view returns (address[] memory) {
        return _followers[agentId];
    }

    function getFollowerCount(uint256 agentId) external view returns (uint256) {
        return _followers[agentId].length;
    }

    function getRoundKey(uint256 agentId, bytes32 pairHash, uint256 epoch) external pure returns (bytes32) {
        return _roundKey(agentId, pairHash, epoch);
    }

    function queryAvailableOraclePairs() external view returns (string memory) {
        return COSMOS_CONTRACT.query_cosmos(
            "/connect.oracle.v2.Query/GetAllCurrencyPairs",
            "{}"
        );
    }

    function _distributeToFollowers(
        uint256 agentId,
        bytes32[] memory roundKeys,
        uint256 distributable,
        uint256 totalOriginalBet
    ) internal {
        address[] storage followerList = _followers[agentId];
        uint256 followerCount = followerList.length;

        for (uint256 i; i < followerCount;) {
            address follower = followerList[i];

            uint256 followerTotalContribution;
            for (uint256 j; j < roundKeys.length;) {
                followerTotalContribution += roundFollowerBets[roundKeys[j]][follower];
                unchecked { ++j; }
            }

            if (followerTotalContribution > 0) {
                if (activeExposure[agentId][follower] >= followerTotalContribution) {
                    activeExposure[agentId][follower] -= followerTotalContribution;
                } else {
                    activeExposure[agentId][follower] = 0;
                }

                uint256 followerReward = (followerTotalContribution * distributable) / totalOriginalBet;

                if (followerReward > 0) {
                    if (COSMOS_CONTRACT.is_blocked_address(follower)) {
                        frozenDeposits[follower] += followerReward;
                        emit DepositFrozen(follower, followerReward);
                    } else {
                        deposits[agentId][follower] += followerReward;

                        if (deposits[agentId][follower] > depositBasis[agentId][follower]) {
                            depositBasis[agentId][follower] = deposits[agentId][follower];
                        }

                        emit FollowerRewardPaid(agentId, follower, followerReward);

                        _reportVipScore(follower, followerReward);
                    }
                }
            }

            unchecked { ++i; }
        }
    }

    function _distributePerformanceFee(uint256 agentId, uint256 totalFee) internal {
        uint256 creatorShare = (totalFee * CREATOR_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 platformShare = totalFee - creatorShare; // Avoid rounding loss

        address creator = _getAgentCreator(agentId);

        if (creatorShare > 0 && creator != address(0)) {
            (bool s1,) = creator.call{value: creatorShare}("");
            if (!s1) revert TransferFailed();
        }

        if (platformShare > 0) {
            (bool s2,) = platformFeeRecipient.call{value: platformShare}("");
            if (!s2) revert TransferFailed();
        }

        emit PerformanceFeePaid(agentId, creator, creatorShare, platformShare);
    }

    function _getAgentPerformanceFeeBps(uint256 agentId) internal view returns (uint256) {
        if (address(registry) == address(0)) return 0;
        return registry.getAgentPerformanceFeeBps(agentId);
    }

    function _getAgentCreator(uint256 agentId) internal view returns (address) {
        if (address(registry) == address(0)) return address(0);
        return registry.getAgentCreator(agentId);
    }

    function _removeFollower(uint256 agentId, address follower) internal {
        isFollower[agentId][follower] = false;

        address[] storage list = _followers[agentId];
        uint256 len = list.length;

        for (uint256 i; i < len;) {
            if (list[i] == follower) {
                list[i] = list[len - 1];
                list.pop();
                return;
            }
            unchecked { ++i; }
        }
    }

    function _roundKey(uint256 agentId, bytes32 pairHash, uint256 epoch) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(agentId, pairHash, epoch));
    }

    function getAgentShareToken(uint256 agentId) external view returns (address token) {
        if (address(registry) == address(0)) return address(0);
        return registry.getAgentShareToken(agentId);
    }

    function _reportVipScore(address follower, uint256 reward) internal {
        if (!vipHookEnabled) return;
        if (address(vipScore) == address(0)) return;
        if (follower == address(0)) return;

        uint256 points = reward / 1e16;
        if (points == 0) return;
        if (points > type(uint64).max) points = type(uint64).max;

        uint64 amount = uint64(points);
        uint64 stage = vipStage;

        if (address(vipScore).code.length == 0) {
            emit VipScoreIncreaseFailed(follower, stage, amount, bytes("NO_CODE"));
            return;
        }

        try vipScore.increaseScore{gas: 80_000}(stage, follower, amount) {
        } catch (bytes memory reason) {
            emit VipScoreIncreaseFailed(follower, stage, amount, reason);
        }
    }

    function _requireAgentActive(uint256 agentId) internal view {
        if (address(registry) == address(0)) return;
        IAgentRegistry.Agent memory a = registry.getAgent(agentId);
        if (!a.isActive) revert AgentInactive();
    }

    receive() external payable {
        if (msg.sender != address(predictor)) revert UnauthorizedDeposit();
    }
}

