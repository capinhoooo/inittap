// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VipScore} from "../src/VipScore.sol";

/// @title Deploy VipScore + Wire to TapPredictor & CopyVault
/// @notice Run:
///   PRIVATE_KEY=<key> forge script script/DeployVipScore.s.sol:DeployVipScore \
///     --rpc-url https://jsonrpc-evm-1.anvil.asia-southeast.initia.xyz \
///     --broadcast --legacy
contract DeployVipScore is Script {
    // Existing deployed contracts (from deployments/evm-1.json)
    address constant PREDICTOR = 0x790080F8232a7b82321459e1BaAf8100665d9485;
    address constant VAULT = 0x29238F71b552a5bcC772d830B867B67D37E0af5C;

    uint64 constant VIP_STAGE = 1;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        console.log("=========================================");
        console.log("VipScore Deployment + Wiring");
        console.log("=========================================");
        console.log("Deployer:    ", deployer);
        console.log("Predictor:   ", PREDICTOR);
        console.log("Vault:       ", VAULT);
        console.log("Init Stage:  ", VIP_STAGE);
        console.log("");

        vm.startBroadcast(pk);

        // 1. Deploy VipScore
        VipScore vipScore = new VipScore(VIP_STAGE);
        console.log("VipScore deployed at:", address(vipScore));

        // 2. Wire TapPredictor
        //    setVipScore is one-shot (reverts VipScoreAlreadySet on 2nd call)
        (bool s1,) = PREDICTOR.call(abi.encodeWithSignature("setVipScore(address)", address(vipScore)));
        require(s1, "predictor.setVipScore failed");
        console.log("  predictor.setVipScore OK");

        (bool s2,) = PREDICTOR.call(abi.encodeWithSignature("setVipStage(uint64)", VIP_STAGE));
        require(s2, "predictor.setVipStage failed");
        console.log("  predictor.setVipStage OK");

        (bool s3,) = PREDICTOR.call(abi.encodeWithSignature("setVipHookEnabled(bool)", true));
        require(s3, "predictor.setVipHookEnabled failed");
        console.log("  predictor.setVipHookEnabled OK");

        // 3. Wire CopyVault
        (bool s4,) = VAULT.call(abi.encodeWithSignature("setVipScore(address)", address(vipScore)));
        require(s4, "vault.setVipScore failed");
        console.log("  vault.setVipScore OK");

        (bool s5,) = VAULT.call(abi.encodeWithSignature("setVipStage(uint64)", VIP_STAGE));
        require(s5, "vault.setVipStage failed");
        console.log("  vault.setVipStage OK");

        (bool s6,) = VAULT.call(abi.encodeWithSignature("setVipHookEnabled(bool)", true));
        require(s6, "vault.setVipHookEnabled failed");
        console.log("  vault.setVipHookEnabled OK");

        // 4. Add both contracts to VipScore allowList
        //    (deployer is already on the allowList from constructor)
        vipScore.addAllowList(PREDICTOR);
        console.log("  vipScore.addAllowList(predictor) OK");

        vipScore.addAllowList(VAULT);
        console.log("  vipScore.addAllowList(vault) OK");

        vm.stopBroadcast();

        console.log("");
        console.log("=========================================");
        console.log("VipScore deployment + wiring complete!");
        console.log("=========================================");
        console.log("VipScore:    ", address(vipScore));
        console.log("");
        console.log("Next: Set VIPSCORE_ADDRESS in backend .env");
    }
}
