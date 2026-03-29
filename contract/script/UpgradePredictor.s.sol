// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TapPredictor} from "../src/TapPredictor.sol";
import {CopyVault} from "../src/CopyVault.sol";

/// @title Upgrade TapPredictor (multi-bet support)
/// @notice Deploys a new TapPredictor and re-wires CopyVault.
///         TapToken minting is skipped (immutable minter on old contract).
/// @dev Run:
///        forge script script/UpgradePredictor.s.sol \
///          --rpc-url https://jsonrpc-evm-1.anvil.asia-southeast.initia.xyz \
///          --private-key $PRIVATE_KEY \
///          --broadcast --legacy
contract UpgradePredictor is Script {
    // Canonical evm-1 addresses
    address constant ORACLE = 0x031ECb63480983FD216D17BB6e1d393f3816b72F;
    address constant ERC20_WRAPPER = 0x7FD385d69908247436f49de2A1AFf6438d75C3c0;

    // Existing contracts (keep these)
    address constant COPY_VAULT = 0x29238F71b552a5bcC772d830B867B67D37E0af5C;
    address constant VIP_SCORE = 0x02dd9E4b05Dd4a67A073EE9746192afE1FA30906;

    // Fee denom
    string constant FEE_DENOM = "evm/2eE7007DF876084d4C74685e90bB7f4cd7c86e22";

    // Same parameters as original deployment
    uint256 constant INTERVAL_SECONDS = 180;
    uint256 constant BUFFER_SECONDS = 30;
    uint256 constant MIN_BET = 0.1 ether;
    uint256 constant MAX_BET = 100 ether;
    uint256 constant TREASURY_FEE_BPS = 300;
    uint64 constant VIP_INITIAL_STAGE = 1;

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        console.log("=========================================");
        console.log("TapPredictor Upgrade (multi-bet)");
        console.log("=========================================");
        console.log("Deployer:", deployer);

        string[] memory pairs = new string[](3);
        pairs[0] = "BTC/USD";
        pairs[1] = "ETH/USD";
        pairs[2] = "SOL/USD";

        vm.startBroadcast(deployerPk);

        // 1. Deploy new TapPredictor
        TapPredictor predictor = new TapPredictor(
            ORACLE,
            deployer, // admin
            deployer, // operator
            INTERVAL_SECONDS,
            BUFFER_SECONDS,
            MIN_BET,
            MAX_BET,
            TREASURY_FEE_BPS,
            pairs
        );
        console.log("New TapPredictor:", address(predictor));

        // 2. Wire CopyVault to new predictor
        predictor.setCopyVault(COPY_VAULT);
        console.log("  setCopyVault done");

        // 3. Wire ERC20Wrapper
        predictor.setErc20Wrapper(ERC20_WRAPPER);
        console.log("  setErc20Wrapper done");

        // 4. Set fee denom (requires pause/unpause cycle)
        predictor.pause();
        predictor.setFeeDenom(FEE_DENOM);
        predictor.unpause();
        console.log("  setFeeDenom done");

        // 5. Wire VipScore
        predictor.setVipScore(VIP_SCORE);
        predictor.setVipStage(VIP_INITIAL_STAGE);
        predictor.setVipHookEnabled(true);
        console.log("  setVipScore done");

        // 6. Update CopyVault to point to new predictor
        CopyVault(payable(COPY_VAULT)).setPredictor(address(predictor));
        console.log("  CopyVault.setPredictor done");

        // NOTE: TapToken NOT set. Old TapToken has immutable minter
        // bound to the old predictor. TAP minting will not work with
        // the new predictor, but betting/claiming works fine.

        vm.stopBroadcast();

        console.log("");
        console.log("=========================================");
        console.log("Upgrade complete!");
        console.log("=========================================");
        console.log("New TapPredictor:", address(predictor));
        console.log("");
        console.log("Update these files:");
        console.log("  web/src/config.ts  -> tapPredictor");
        console.log("  backend/.env       -> TAPPREDICTOR_ADDRESS");
        console.log("Then restart backend to begin new rounds.");
    }
}
