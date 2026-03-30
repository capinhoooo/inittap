# INITTAP Contract Verification Guide (v2 redeployment)

All four contracts redeployed to Initia evm-1 testnet on 2026-04-17. Celatone (the explorer powering scan.testnet.initia.xyz) exposes a UI-based verification flow only. No public `forge verify-contract` backend for Initia yet.

## Compiler settings (match exactly)

- **Compiler:** `v0.8.24+commit.e11b9ed9`
- **Language:** Solidity
- **EVM version:** `shanghai`
- **Optimizer:** enabled, runs = `200`
- **Via IR:** enabled (true)
- **License:** MIT

## Verify URL

https://scan.testnet.initia.xyz/evm-1/evm-contracts/verify

Pick **Solidity Standard JSON Input**. For each contract upload the matching file in this folder.

## Per-contract inputs

### 1. TapPredictor

- Address: `0x790080F8232a7b82321459e1BaAf8100665d9485`
- Contract name: `src/TapPredictor.sol:TapPredictor`
- Standard-input JSON: `TapPredictor.standard-input.json`
- Constructor args (ABI-encoded, no `0x` prefix):

```
000000000000000000000000031ecb63480983fd216d17bb6e1d393f3816b72f000000000000000000000000564323ae0d8473103f3763814c5121ca9e48004b000000000000000000000000564323ae0d8473103f3763814c5121ca9e48004b00000000000000000000000000000000000000000000000000000000000000b4000000000000000000000000000000000000000000000000000000000000001e000000000000000000000000000000000000000000000000016345785d8a00000000000000000000000000000000000000000000000000056bc75e2d63100000000000000000000000000000000000000000000000000000000000000000012c00000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000074254432f5553440000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000074554482f555344000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007534f4c2f55534400000000000000000000000000000000000000000000000000
```

### 2. TapToken

- Address: `0xE935dbf15c2418be20Ad0be81A3a2203934d8B3e`
- Contract name: `src/TapToken.sol:TapToken`
- Standard-input JSON: `TapToken.standard-input.json`
- Constructor args:

```
000000000000000000000000790080f8232a7b82321459e1baaf8100665d9485
```

### 3. AgentRegistry

- Address: `0x3582d890fe61189B012Be63f550d54cf6dE1F9DC`
- Contract name: `src/AgentRegistry.sol:AgentRegistry`
- Standard-input JSON: `AgentRegistry.standard-input.json`
- Constructor args:

```
000000000000000000000000564323ae0d8473103f3763814c5121ca9e48004b000000000000000000000000564323ae0d8473103f3763814c5121ca9e48004b0000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000006f05b59d3b20000
```

### 4. CopyVault

- Address: `0x29238F71b552a5bcC772d830B867B67D37E0af5C`
- Contract name: `src/CopyVault.sol:CopyVault`
- Standard-input JSON: `CopyVault.standard-input.json`
- Constructor args:

```
000000000000000000000000564323ae0d8473103f3763814c5121ca9e48004b000000000000000000000000564323ae0d8473103f3763814c5121ca9e48004b
```

## If upload fails

1. **Bytecode mismatch** on TapToken because the IERC20Registry precompile returns nothing locally. Try "Multi-file upload" with all `.sol` under `src/` plus `lib/openzeppelin-contracts/`. Keep compiler settings the same.
2. **Constructor args rejected.** Celatone expects the args as a single hex string WITHOUT the `0x` prefix.

## Regenerating

```bash
cd /Users/macbookair/Documents/inittap/contract

# Standard-input JSON
for c in TapPredictor TapToken AgentRegistry CopyVault; do
  forge verify-contract --show-standard-json-input 0x0000000000000000000000000000000000000000 "src/${c}.sol:${c}" > "verification/${c}.standard-input.json"
done

# Constructor args
DEPLOYER=0x564323aE0D8473103F3763814c5121Ca9e48004B
ORACLE=0x031ECb63480983FD216D17BB6e1d393f3816b72F
PREDICTOR=0x790080F8232a7b82321459e1BaAf8100665d9485

cast abi-encode "constructor(address,address,address,uint256,uint256,uint256,uint256,uint256,string[])" \
  $ORACLE $DEPLOYER $DEPLOYER 180 30 100000000000000000 100000000000000000000 300 "[BTC/USD,ETH/USD,SOL/USD]"

cast abi-encode "constructor(address)" $PREDICTOR

cast abi-encode "constructor(address,address,uint256,uint256)" \
  $DEPLOYER $DEPLOYER 1000000000000000000 500000000000000000

cast abi-encode "constructor(address,address)" $DEPLOYER $DEPLOYER
```
