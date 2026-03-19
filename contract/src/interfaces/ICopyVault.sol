// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICopyVault {
    struct RoundBet {
        uint256 totalBet;
        uint256 followerCount;
        bool claimed;
    }

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientDeposit();
    error NotExecutor();
    error InvalidBps();
    error NoFollowers();
    error AlreadyClaimed();
    error ClaimFailed();
    error TransferFailed();
    error AgentNotFound();
    error ArrayLengthMismatch();

    event Deposited(uint256 indexed agentId, address indexed follower, uint256 amount);
    event Withdrawn(uint256 indexed agentId, address indexed follower, uint256 amount);
    event CopyTradeExecuted(
        uint256 indexed agentId,
        bytes32 indexed pairHash,
        uint256 indexed epoch,
        bool isBull,
        uint256 totalBetAmount,
        uint256 followerCount
    );
    event RewardsDistributed(
        uint256 indexed agentId, bytes32 indexed pairHash, uint256 indexed epoch, uint256 totalClaimed, uint256 totalFees
    );
    event FollowerRewardPaid(uint256 indexed agentId, address indexed follower, uint256 netReward);
    event PerformanceFeePaid(uint256 indexed agentId, address indexed creator, uint256 creatorFee, uint256 platformFee);
    event PredictorUpdated(address predictor);
    event RegistryUpdated(address registry);
    event ExecutorUpdated(address executor);
    event PlatformFeeRecipientUpdated(address recipient);

    function deposit(uint256 agentId) external payable;
    function withdraw(uint256 agentId, uint256 amount) external;
    function executeCopyTrades(bytes32 pairHash, uint256 agentId, uint256 epoch, bool isBull, uint256 betPercentBps)
        external;
    function claimForFollowers(bytes32[] calldata pairHashes, uint256[] calldata epochs, uint256 agentId) external;
    function setPredictor(address predictor) external;
    function setRegistry(address registry) external;
    function setExecutor(address executor) external;
}
