// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICosmos, COSMOS_CONTRACT} from "./interfaces/ICosmos.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";
import {IERC20Factory} from "./interfaces/IERC20Factory.sol";
import {UintToString} from "./lib/UintToString.sol";

contract AgentRegistry is IAgentRegistry, Ownable, Pausable, ReentrancyGuard {
    error ZeroAddress();
    error ZeroAmount();
    error FeeTooHigh();
    error AgentNotFound();
    error AgentNotActive();
    error AlreadySubscribed();
    error NotSubscribed();
    error NotCreatorOrOwner();
    error NotAuthorized();
    error InsufficientRegistrationFee();
    error TransferFailed();
    error InsufficientSubscription();
    error NoProfitToDistribute();
    error AgentWalletAlreadyRegistered();
    error BlockedAddress();
    error Erc20FactoryAlreadySet();
    error Erc20FactoryNotSet();
    error ShareTokenAlreadyDeployed();


    uint16 public constant MAX_PERFORMANCE_FEE_BPS = 2000;
    uint16 public constant PERFORMANCE_FEE_RATE_BPS = 1000;
    uint16 public constant CREATOR_FEE_SHARE_BPS = 7000;
    uint16 public constant PLATFORM_FEE_SHARE_BPS = 3000;
    uint16 public constant BPS_DENOMINATOR = 10000;

    uint256 private _nextAgentId;
    uint256 public registrationFee;
    uint256 public minSubscription;
    address public predictorAddress;
    address public operatorAddress;
    address public erc20Factory;
    uint256 public platformFeeBalance;

    mapping(address => uint256) public creatorFeeBalance;
    mapping(uint256 => Agent) internal _agents;
    mapping(uint256 => mapping(address => Subscription)) internal _subscriptions;
    mapping(address => uint256) public walletToAgentId;
    mapping(uint256 => address[]) internal _subscribers;
    mapping(uint256 => mapping(address => uint256)) internal _subscriberIndex;
    mapping(uint256 => address) public agentShareToken;

    modifier onlyOperatorOrPredictor() {
        if (msg.sender != operatorAddress && msg.sender != predictorAddress) {
            revert NotAuthorized();
        }
        _;
    }

    modifier agentExists(uint256 agentId) {
        if (agentId == 0 || agentId >= _nextAgentId) revert AgentNotFound();
        _;
    }

    modifier agentActive(uint256 agentId) {
        if (!_agents[agentId].isActive) revert AgentNotActive();
        _;
    }

    constructor(address _owner, address _operatorAddress, uint256 _registrationFee, uint256 _minSubscription)
        Ownable(_owner)
    {
        if (_operatorAddress == address(0)) revert ZeroAddress();

        operatorAddress = _operatorAddress;
        registrationFee = _registrationFee;
        minSubscription = _minSubscription;
        _nextAgentId = 1;
    }

    function registerAgent(address agentWallet, string calldata strategyURI, uint16 performanceFeeBps)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 agentId)
    {
        if (agentWallet == address(0)) revert ZeroAddress();
        if (performanceFeeBps > MAX_PERFORMANCE_FEE_BPS) revert FeeTooHigh();
        if (msg.value < registrationFee) revert InsufficientRegistrationFee();
        if (walletToAgentId[agentWallet] != 0) revert AgentWalletAlreadyRegistered();

        if (COSMOS_CONTRACT.is_blocked_address(msg.sender)) revert BlockedAddress();

        COSMOS_CONTRACT.to_cosmos_address(agentWallet);

        agentId = _nextAgentId;

        _agents[agentId] = Agent({
            agentId: agentId,
            creator: msg.sender,
            agentWallet: agentWallet,
            strategyURI: strategyURI,
            performanceFeeBps: performanceFeeBps,
            subscriberCount: 0,
            totalPnL: 0,
            totalTrades: 0,
            wins: 0,
            isActive: true,
            registrationTime: uint64(block.timestamp)
        });

        walletToAgentId[agentWallet] = agentId;

        unchecked {
            _nextAgentId = agentId + 1;
        }

        platformFeeBalance += msg.value;

        emit AgentRegistered(agentId, msg.sender, agentWallet, strategyURI);

        if (erc20Factory != address(0)) {
            _createAgentShareToken(agentId);
        }
    }

    function subscribe(uint256 agentId)
        external
        payable
        whenNotPaused
        nonReentrant
        agentExists(agentId)
        agentActive(agentId)
    {
        if (msg.value < minSubscription) revert InsufficientSubscription();

        if (COSMOS_CONTRACT.is_blocked_address(msg.sender)) revert BlockedAddress();

        Subscription storage sub = _subscriptions[agentId][msg.sender];
        if (sub.active) revert AlreadySubscribed();

        sub.depositAmount = msg.value;
        sub.remainingAmount = msg.value;
        sub.pnl = 0;
        sub.active = true;

        _subscribers[agentId].push(msg.sender);
        _subscriberIndex[agentId][msg.sender] = _subscribers[agentId].length - 1;

        _agents[agentId].subscriberCount++;

        emit Subscribed(agentId, msg.sender, msg.value);
    }

    function unsubscribe(uint256 agentId) external nonReentrant agentExists(agentId) {
        Subscription storage sub = _subscriptions[agentId][msg.sender];
        if (!sub.active) revert NotSubscribed();

        uint256 refundAmount = sub.remainingAmount;

        sub.active = false;
        sub.remainingAmount = 0;

        _removeSubscriber(agentId, msg.sender);

        if (_agents[agentId].subscriberCount > 0) {
            _agents[agentId].subscriberCount--;
        }

        emit Unsubscribed(agentId, msg.sender, refundAmount);

        if (refundAmount > 0) {
            (bool success,) = msg.sender.call{value: refundAmount}("");
            if (!success) revert TransferFailed();
        }
    }

    function recordTrade(uint256 agentId, bool won, int256 pnl)
        external
        onlyOperatorOrPredictor
        agentExists(agentId)
        agentActive(agentId)
    {
        Agent storage agent = _agents[agentId];

        agent.totalTrades++;
        agent.totalPnL += pnl;

        if (won) {
            agent.wins++;
        }

        emit TradeRecorded(agentId, won, pnl);

        if (pnl > 0) {
            _distributePerformanceFees(agentId, uint256(pnl));
        }
    }

    function deactivateAgent(uint256 agentId) external agentExists(agentId) agentActive(agentId) {
        Agent storage agent = _agents[agentId];
        if (msg.sender != agent.creator && msg.sender != owner()) {
            revert NotCreatorOrOwner();
        }

        agent.isActive = false;

        emit AgentDeactivated(agentId, msg.sender);
    }


    function setPredictor(address predictor) external onlyOwner {
        if (predictor == address(0)) revert ZeroAddress();
        address old = predictorAddress;
        predictorAddress = predictor;
        emit PredictorUpdated(old, predictor);
    }

    function setOperator(address operator) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();
        address old = operatorAddress;
        operatorAddress = operator;
        emit OperatorUpdated(old, operator);
    }

    function setRegistrationFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = registrationFee;
        registrationFee = newFee;
        emit RegistrationFeeUpdated(oldFee, newFee);
    }

    function setMinSubscription(uint256 newMin) external onlyOwner {
        uint256 oldMin = minSubscription;
        minSubscription = newMin;
        emit MinSubscriptionUpdated(oldMin, newMin);
    }

    function claimPlatformFees(address to) external nonReentrant onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = platformFeeBalance;
        if (amount == 0) revert ZeroAmount();

        platformFeeBalance = 0;

        emit PlatformFeeClaimed(to, amount);

        // Interactions
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function setErc20Factory(address _factory) external onlyOwner {
        if (_factory == address(0)) revert ZeroAddress();
        if (erc20Factory != address(0)) revert Erc20FactoryAlreadySet();
        erc20Factory = _factory;
        emit Erc20FactorySet(_factory);
    }

    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract
    function unpause() external onlyOwner {
        _unpause();
    }

    function getWinRate(uint256 agentId) external view agentExists(agentId) returns (uint256 winRateBps) {
        Agent storage agent = _agents[agentId];
        if (agent.totalTrades == 0) return 0;
        winRateBps = (uint256(agent.wins) * uint256(BPS_DENOMINATOR)) / uint256(agent.totalTrades);
    }

    function getAgentWallet(uint256 agentId) external view agentExists(agentId) returns (address wallet) {
        return _agents[agentId].agentWallet;
    }

    function getAgent(uint256 agentId) external view agentExists(agentId) returns (Agent memory agent) {
        return _agents[agentId];
    }

    function getSubscription(uint256 agentId, address subscriber)
        external
        view
        agentExists(agentId)
        returns (Subscription memory subscription)
    {
        return _subscriptions[agentId][subscriber];
    }

    function agentCount() external view returns (uint256 count) {
        return _nextAgentId - 1;
    }

    function getSubscribers(uint256 agentId) external view agentExists(agentId) returns (address[] memory subscribers) {
        return _subscribers[agentId];
    }

    function getAgentCosmosAddress(uint256 agentId)
        external
        view
        agentExists(agentId)
        returns (string memory cosmosAddress)
    {
        return COSMOS_CONTRACT.to_cosmos_address(_agents[agentId].agentWallet);
    }

    function getAgentPerformanceFeeBps(uint256 agentId)
        external
        view
        agentExists(agentId)
        returns (uint256)
    {
        return uint256(_agents[agentId].performanceFeeBps);
    }

    function getAgentCreator(uint256 agentId)
        external
        view
        agentExists(agentId)
        returns (address)
    {
        return _agents[agentId].creator;
    }

    function getAgentShareToken(uint256 agentId)
        external
        view
        agentExists(agentId)
        returns (address token)
    {
        return agentShareToken[agentId];
    }

    function computeAgentShareToken(uint256 agentId) external view returns (address token) {
        if (erc20Factory == address(0)) revert Erc20FactoryNotSet();
        (string memory name, string memory symbol) = _shareTokenMetadata(agentId);
        return IERC20Factory(erc20Factory).computeERC20Address(
            address(this),
            name,
            symbol,
            18,
            bytes32(agentId)
        );
    }

    function _shareTokenMetadata(uint256 agentId)
        internal
        pure
        returns (string memory name, string memory symbol)
    {
        string memory idStr = UintToString.toString(agentId);
        name = string(abi.encodePacked("INITTAP Agent Share #", idStr));
        symbol = string(abi.encodePacked("TAP", idStr));
    }

    function _createAgentShareToken(uint256 agentId) internal returns (address token) {
        if (agentShareToken[agentId] != address(0)) revert ShareTokenAlreadyDeployed();
        (string memory name, string memory symbol) = _shareTokenMetadata(agentId);
        token = IERC20Factory(erc20Factory).createERC20WithSalt(
            name,
            symbol,
            18,
            bytes32(agentId)
        );
        agentShareToken[agentId] = token;
        emit AgentShareTokenCreated(agentId, token);
    }


    function _distributePerformanceFees(uint256 agentId, uint256 totalProfit) internal {
        Agent storage agent = _agents[agentId];
        address[] storage subs = _subscribers[agentId];
        uint256 subCount = subs.length;

        if (subCount == 0) return;

        uint256 creatorTotalFee;
        uint256 platformTotalFee;

        for (uint256 i; i < subCount;) {
            address follower = subs[i];
            Subscription storage sub = _subscriptions[agentId][follower];

            if (sub.active && sub.remainingAmount > 0) {
                uint256 followerProfit = totalProfit / subCount;

                uint256 fee = (followerProfit * uint256(PERFORMANCE_FEE_RATE_BPS)) / uint256(BPS_DENOMINATOR);

                if (fee > 0) {
                    if (fee > sub.remainingAmount) {
                        fee = sub.remainingAmount;
                    }

                    sub.remainingAmount -= fee;

                    uint256 creatorFee = (fee * uint256(CREATOR_FEE_SHARE_BPS)) / uint256(BPS_DENOMINATOR);
                    uint256 platformFee = fee - creatorFee;

                    creatorTotalFee += creatorFee;
                    platformTotalFee += platformFee;

                    uint256 netProfit = followerProfit - fee;

                    sub.pnl += int256(netProfit);

                    emit PerformanceFeeDistributed(agentId, follower, followerProfit, creatorFee, platformFee);
                }
            }

            unchecked {
                ++i;
            }
        }

        platformFeeBalance += platformTotalFee;

        creatorFeeBalance[agent.creator] += creatorTotalFee;
    }

    function claimCreatorFees() external nonReentrant {
        uint256 amount = creatorFeeBalance[msg.sender];
        if (amount == 0) revert ZeroAmount();

        creatorFeeBalance[msg.sender] = 0;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function _removeSubscriber(uint256 agentId, address subscriber) internal {
        address[] storage subs = _subscribers[agentId];
        uint256 index = _subscriberIndex[agentId][subscriber];
        uint256 lastIndex = subs.length - 1;

        if (index != lastIndex) {
            address lastSubscriber = subs[lastIndex];
            subs[index] = lastSubscriber;
            _subscriberIndex[agentId][lastSubscriber] = index;
        }

        subs.pop();
        delete _subscriberIndex[agentId][subscriber];
    }

    receive() external payable {}
}
