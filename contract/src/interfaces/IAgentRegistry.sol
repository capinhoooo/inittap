// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAgentRegistry
/// @notice Interface for the INITTAP Agent Registry contract
interface IAgentRegistry {
    // --- Structs ---

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

    struct Subscription {
        uint256 depositAmount;
        uint256 remainingAmount;
        int256 pnl;
        bool active;
    }

    // --- Events ---

    event AgentRegistered(uint256 indexed agentId, address indexed creator, address agentWallet, string strategyURI);
    event AgentDeactivated(uint256 indexed agentId, address indexed deactivatedBy);
    event Subscribed(uint256 indexed agentId, address indexed subscriber, uint256 amount);
    event Unsubscribed(uint256 indexed agentId, address indexed subscriber, uint256 refundAmount);
    event TradeRecorded(uint256 indexed agentId, bool won, int256 pnl);
    event PerformanceFeeDistributed(
        uint256 indexed agentId, address indexed follower, uint256 profit, uint256 creatorFee, uint256 platformFee
    );
    event PredictorUpdated(address indexed oldPredictor, address indexed newPredictor);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee);
    event MinSubscriptionUpdated(uint256 oldMin, uint256 newMin);
    event PlatformFeeClaimed(address indexed to, uint256 amount);
    event Erc20FactorySet(address indexed factory);
    event AgentShareTokenCreated(uint256 indexed agentId, address indexed token);

    // --- External Functions ---

    /// @notice Register a new AI agent
    /// @param agentWallet The wallet address the agent trades from
    /// @param strategyURI IPFS URI pointing to the agent's strategy metadata
    /// @param performanceFeeBps Performance fee in basis points (max 2000 = 20%)
    /// @return agentId The ID of the newly registered agent
    function registerAgent(address agentWallet, string calldata strategyURI, uint16 performanceFeeBps)
        external
        payable
        returns (uint256 agentId);

    /// @notice Subscribe to an agent by depositing INIT
    /// @param agentId The agent to subscribe to
    function subscribe(uint256 agentId) external payable;

    /// @notice Unsubscribe from an agent and reclaim remaining allocation
    /// @param agentId The agent to unsubscribe from
    function unsubscribe(uint256 agentId) external;

    /// @notice Record a trade result for an agent (operator/predictor only)
    /// @param agentId The agent that made the trade
    /// @param won Whether the trade was a win
    /// @param pnl The profit/loss from the trade (signed)
    function recordTrade(uint256 agentId, bool won, int256 pnl) external;

    /// @notice Deactivate an agent (creator or owner)
    /// @param agentId The agent to deactivate
    function deactivateAgent(uint256 agentId) external;

    /// @notice Set the authorized TapPredictor contract
    /// @param predictor The TapPredictor contract address
    function setPredictor(address predictor) external;

    /// @notice Set the operator address
    /// @param operator The new operator address
    function setOperator(address operator) external;

    /// @notice Get an agent's win rate in basis points (0-10000)
    /// @param agentId The agent to query
    /// @return winRateBps Win rate as basis points (e.g., 7500 = 75%)
    function getWinRate(uint256 agentId) external view returns (uint256 winRateBps);

    /// @notice Get an agent's wallet address (used by CopyVault)
    /// @param agentId The agent to query
    /// @return wallet The agent's trading wallet address
    function getAgentWallet(uint256 agentId) external view returns (address wallet);

    /// @notice Get full agent details
    /// @param agentId The agent to query
    /// @return agent The agent struct
    function getAgent(uint256 agentId) external view returns (Agent memory agent);

    /// @notice Get subscription details for a user and agent
    /// @param agentId The agent
    /// @param subscriber The subscriber address
    /// @return subscription The subscription details
    function getSubscription(uint256 agentId, address subscriber)
        external
        view
        returns (Subscription memory subscription);

    /// @notice Get total number of registered agents
    /// @return count The agent count
    function agentCount() external view returns (uint256 count);

    /// @notice Get an agent's performance fee in basis points
    /// @param agentId The agent to query
    /// @return feeBps Performance fee in basis points
    function getAgentPerformanceFeeBps(uint256 agentId) external view returns (uint256 feeBps);

    /// @notice Get an agent's creator address
    /// @param agentId The agent to query
    /// @return creator The creator's address
    function getAgentCreator(uint256 agentId) external view returns (address creator);

    /// @notice Get the CREATE2-deployed share token for an agent
    /// @dev Created eagerly during `registerAgent` when the ERC20Factory is set.
    ///      Returns `address(0)` when the factory was not configured at registration time.
    /// @param agentId The agent to query
    /// @return token The ERC20 share token address for the agent
    function getAgentShareToken(uint256 agentId) external view returns (address token);

    /// @notice Predict the CREATE2 share token address for a given agent id
    /// @dev Proxies to the factory's `computeERC20Address`. Reverts when the factory
    ///      has not been configured.
    /// @param agentId The agent to predict the share token for
    /// @return token The deterministic share token address
    function computeAgentShareToken(uint256 agentId) external view returns (address token);
}
