// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVipScore {
    struct StageInfo {
        uint64 stage;
        uint64 totalScore;
        bool isFinalized;
    }

    struct Score {
        bool isIndexed;
        uint64 amount;
    }

    struct ScoreResponse {
        address addr;
        uint64 amount;
        uint64 index;
    }

    event CreateStage(uint64 stage);
    event FinalizeStage(uint64 stage);
    event UpdateScore(address indexed addr, uint64 indexed stage, uint64 score, uint64 totalScore);


    function finalizeStage(uint64 stage) external;
    function increaseScore(uint64 stage, address addr, uint64 amount) external;
    function decreaseScore(uint64 stage, address addr, uint64 amount) external;
    function updateScore(uint64 stage, address addr, uint64 amount) external;
    function updateScores(uint64 stage, address[] calldata addrs, uint64[] calldata amounts) external;
    function addAllowList(address addr) external;
    function removeAllowList(address addr) external;
    function initStage() external view returns (uint64);
    function stages(uint64 stage) external view returns (StageInfo memory);
    function scores(uint64 stage, address addr) external view returns (Score memory);
    function allowList(address addr) external view returns (bool);
    function getScores(uint64 stage, uint64 offset, uint64 limit)
        external
        view
        returns (ScoreResponse[] memory);
}
