// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TapPredictor} from "../src/TapPredictor.sol";
import {TapToken} from "../src/TapToken.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {CopyVault} from "../src/CopyVault.sol";

/// @title INITTAP Full Deployment (evm-1 testnet)
/// @notice Deploys all four contracts and wires every cross-reference setter.
/// @dev Canonical evm-1 addresses verified via:
///        GET https://rest-evm-1.anvil.asia-southeast.initia.xyz/minievm/evm/v1/contracts/{name}
///      Run:
///        forge script script/Deploy.s.sol \
///          --rpc-url https://jsonrpc-evm-1.anvil.asia-southeast.initia.xyz \
///          --private-key $PRIVATE_KEY \
///          --broadcast --legacy
contract Deploy is Script {
    // ------------------------------------------------------------------
    // evm-1 canonical helper contracts (verified 2026-04-16)
    // ------------------------------------------------------------------
    address constant ORACLE = 0x031ECb63480983FD216D17BB6e1d393f3816b72F;
    address constant ERC20_FACTORY = 0xf108dc9560D3e547270c1B6A334501b71d2F2321;
    address constant ERC20_WRAPPER = 0x7FD385d69908247436f49de2A1AFf6438d75C3c0;

    // evm-1 fee denom (the gas token denom used by the fee market)
    string constant FEE_DENOM = "evm/2eE7007DF876084d4C74685e90bB7f4cd7c86e22";

    // ------------------------------------------------------------------
    // Product parameters (hackathon defaults)
    // ------------------------------------------------------------------
    uint256 constant INTERVAL_SECONDS = 180; // 3-minute rounds
    uint256 constant BUFFER_SECONDS = 30;
    uint256 constant MIN_BET = 0.1 ether; // 0.1 INIT
    uint256 constant MAX_BET = 100 ether; // 100 INIT
    uint256 constant TREASURY_FEE_BPS = 300; // 3%

    // AgentRegistry
    uint256 constant REGISTRATION_FEE = 1 ether; // 1 INIT to register an agent
    uint256 constant MIN_SUBSCRIPTION = 0.5 ether; // 0.5 INIT min follower stake

    // VIP scoring (stage lifecycle — admin can rotate via setVipStage)
    uint64 constant VIP_INITIAL_STAGE = 1;

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        console.log("=========================================");
        console.log("INITTAP Deployment - evm-1 testnet");
        console.log("=========================================");
        console.log("Deployer:       ", deployer);
        console.log("Oracle:         ", ORACLE);
        console.log("ERC20 Factory:  ", ERC20_FACTORY);
        console.log("ERC20 Wrapper:  ", ERC20_WRAPPER);
        console.log("Fee denom:      ", FEE_DENOM);
        console.log("");

        // Initial Slinky pairs (verified available on evm-1)
        string[] memory pairs = new string[](3);
        pairs[0] = "BTC/USD";
        pairs[1] = "ETH/USD";
        pairs[2] = "SOL/USD";

        vm.startBroadcast(deployerPk);

        // ==================================================================
        // 1. TapPredictor (core prediction market)
        // ==================================================================
        TapPredictor predictor = new TapPredictor(
            ORACLE,
            deployer, // admin
            deployer, // operator (same as deployer for hackathon demo)
            INTERVAL_SECONDS,
            BUFFER_SECONDS,
            MIN_BET,
            MAX_BET,
            TREASURY_FEE_BPS,
            pairs
        );
        console.log("1. TapPredictor: ", address(predictor));

        // ==================================================================
        // 2. TapToken (reward token — constructor registers Cosmos denom)
        // ==================================================================
        TapToken tapToken = new TapToken(address(predictor));
        console.log("2. TapToken:     ", address(tapToken));

        // ==================================================================
        // 3. AgentRegistry (agent identity + stats + share-token CREATE2)
        // ==================================================================
        AgentRegistry registry = new AgentRegistry(
            deployer, // owner
            deployer, // operator
            REGISTRATION_FEE,
            MIN_SUBSCRIPTION
        );
        console.log("3. AgentRegistry:", address(registry));

        // ==================================================================
        // 4. CopyVault (follower deposits + proportional copy trades)
        // ==================================================================
        CopyVault vault = new CopyVault(
            deployer, // owner
            deployer // platformFeeRecipient (treasury for hackathon)
        );
        console.log("4. CopyVault:    ", address(vault));

        // ==================================================================
        // Wiring — cross-references between contracts
        // ==================================================================
        console.log("");
        console.log("--- Wiring ---");

        // TapPredictor links
        predictor.setTapToken(address(tapToken));
        console.log("  predictor.setTapToken");

        predictor.setCopyVault(address(vault));
        console.log("  predictor.setCopyVault");

        // Wave 5: ERC20Wrapper alternate bridge path
        predictor.setErc20Wrapper(ERC20_WRAPPER);
        console.log("  predictor.setErc20Wrapper");

        // Fee denom (requires paused state)
        predictor.pause();
        predictor.setFeeDenom(FEE_DENOM);
        console.log("  predictor.setFeeDenom");
        predictor.unpause();
        console.log("  predictor.unpause");

        // AgentRegistry links
        registry.setPredictor(address(predictor));
        console.log("  registry.setPredictor");

        // Wave 5: ERC20Factory for CREATE2 share tokens
        registry.setErc20Factory(ERC20_FACTORY);
        console.log("  registry.setErc20Factory");

        // CopyVault links
        vault.setPredictor(address(predictor));
        console.log("  vault.setPredictor");

        vault.setRegistry(address(registry));
        console.log("  vault.setRegistry");

        // Executor = deployer for hackathon (backend signer in production)
        vault.setExecutor(deployer);
        console.log("  vault.setExecutor");

        // Wave 5 VIP: skipped at deploy time. Operator deploys VipScore
        // (from initia-labs/vip-score-evm), then calls:
        //   predictor.setVipScore(<vipScore>);
        //   predictor.setVipStage(VIP_INITIAL_STAGE);
        //   predictor.setVipHookEnabled(true);
        //   vault.setVipScore(<vipScore>);
        //   vault.setVipStage(VIP_INITIAL_STAGE);
        //   vault.setVipHookEnabled(true);
        // Allowlist both contracts on the VipScore allowList.

        vm.stopBroadcast();

        // ==================================================================
        // Deployment summary
        // ==================================================================
        console.log("");
        console.log("=========================================");
        console.log("Deployment complete");
        console.log("=========================================");
        console.log("TapPredictor:  ", address(predictor));
        console.log("TapToken:      ", address(tapToken));
        console.log("AgentRegistry: ", address(registry));
        console.log("CopyVault:     ", address(vault));
        console.log("");
        console.log("Save these addresses. Next steps:");
        console.log(" 1. Deploy VipScore (initia-labs/vip-score-evm)");
        console.log(" 2. Call setVipScore on predictor + vault");
        console.log(" 3. Backend wires these addresses");
    }
}
