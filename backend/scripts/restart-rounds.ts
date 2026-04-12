/**
 * Restart rounds by pausing and unpausing the TapPredictor contract.
 * This resets the genesis flags so the round keeper can start fresh rounds.
 *
 * Usage: bun run scripts/restart-rounds.ts
 */
import 'dotenv/config';
import { Contract, Wallet, JsonRpcProvider } from 'ethers';
import TapPredictorABI from '../src/lib/evm/abi/TapPredictor.json';

const EVM_RPC_URL = process.env.EVM_RPC_URL as string;
const CHAIN_ID = Number(process.env.CHAIN_ID) || 2124225178762456;
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY as string;
const TAPPREDICTOR_ADDRESS =
  process.env.TAPPREDICTOR_ADDRESS || '0x790080F8232a7b82321459e1BaAf8100665d9485';

if (!EVM_RPC_URL || !OPERATOR_PRIVATE_KEY) {
  console.error('Missing EVM_RPC_URL or OPERATOR_PRIVATE_KEY in .env');
  process.exit(1);
}

const provider = new JsonRpcProvider(EVM_RPC_URL, CHAIN_ID, {
  staticNetwork: true,
  batchMaxCount: 1,
});

const wallet = new Wallet(OPERATOR_PRIVATE_KEY, provider);
const contract = new Contract(TAPPREDICTOR_ADDRESS, TapPredictorABI, wallet);

async function main() {
  console.log(`[RestartRounds] Contract: ${TAPPREDICTOR_ADDRESS}`);
  console.log(`[RestartRounds] Operator: ${wallet.address}`);

  // Check if already paused
  const paused = await contract.paused();
  console.log(`[RestartRounds] Currently paused: ${paused}`);

  if (!paused) {
    console.log('[RestartRounds] Pausing contract...');
    const pauseTx = await contract.pause();
    await pauseTx.wait();
    console.log(`[RestartRounds] Paused. TX: ${pauseTx.hash}`);
  }

  // Small delay to ensure state propagation
  await new Promise((r) => setTimeout(r, 2000));

  console.log('[RestartRounds] Unpausing contract (resets genesis flags)...');
  const unpauseTx = await contract.unpause();
  await unpauseTx.wait();
  console.log(`[RestartRounds] Unpaused. TX: ${unpauseTx.hash}`);

  console.log('[RestartRounds] Done! The round keeper will start fresh rounds automatically.');
}

main().catch((err) => {
  console.error('[RestartRounds] Error:', err);
  process.exit(1);
});
