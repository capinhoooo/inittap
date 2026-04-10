import {
  ROUND_KEEPER_INTERVAL_MS,
  ACTIVE_PAIRS,
  ROUND_BUFFER_SECONDS,
} from '../config/main-config.ts';
import { provider } from '../lib/evm/provider.ts';
import { tapPredictor, tapPredictorReadonly } from '../lib/evm/contracts.ts';
import { computePairHash } from '../utils/evmUtils.ts';

let isRunning = false;

interface PairState {
  currentEpoch: bigint;
  oracleLatestNonce: bigint;
  genesisStartOnce: boolean;
  genesisLockOnce: boolean;
  active: boolean;
}

interface RoundData {
  epoch: bigint;
  startTimestamp: bigint;
  lockTimestamp: bigint;
  closeTimestamp: bigint;
  oracleCalled: boolean;
  lockPrice: bigint;
  closePrice: bigint;
  lockOracleNonce: bigint;
  closeOracleNonce: bigint;
  totalAmount: bigint;
  bullAmount: bigint;
  bearAmount: bigint;
  rewardBaseCalAmount: bigint;
  rewardAmount: bigint;
}

const keepRounds = async (): Promise<void> => {
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    const block = await provider.getBlock('latest');
    if (!block) {
      console.error('[RoundKeeper] Failed to fetch latest block');
      return;
    }
    const blockTimestamp = BigInt(block.timestamp);

    // Track whether we need to call executeRoundsAll (single call for all pairs)
    let needsExecuteAll = false;

    // Pre-compute pair hashes
    const pairEntries = ACTIVE_PAIRS.map((name) => ({
      name,
      hash: computePairHash(name),
    }));

    for (const pair of pairEntries) {
      try {
        const state: PairState = await tapPredictorReadonly.pairState(pair.hash);

        // Phase 1: Genesis start has never been called
        if (!state.genesisStartOnce) {
          console.log(`[RoundKeeper] Calling genesisStartRound for ${pair.name}`);
          const tx = await tapPredictor.genesisStartRound(pair.hash);
          await tx.wait();
          console.log(`[RoundKeeper] genesisStartRound tx confirmed for ${pair.name}: ${tx.hash}`);
          continue;
        }

        // Phase 2: Genesis started but not yet locked
        if (state.genesisStartOnce && !state.genesisLockOnce) {
          const currentEpoch = state.currentEpoch;
          const round: RoundData = await tapPredictorReadonly.rounds(pair.hash, currentEpoch);

          if (blockTimestamp >= round.lockTimestamp) {
            console.log(`[RoundKeeper] Calling genesisLockRound for ${pair.name} epoch=${currentEpoch}`);
            const tx = await tapPredictor.genesisLockRound(pair.hash);
            await tx.wait();
            console.log(`[RoundKeeper] genesisLockRound tx confirmed for ${pair.name}: ${tx.hash}`);
          }
          continue;
        }

        // Phase 3: Both genesis done, check if current round needs execution
        const currentEpoch = state.currentEpoch;
        const round: RoundData = await tapPredictorReadonly.rounds(pair.hash, currentEpoch);

        // The current round's lockTimestamp determines when executeRound should fire.
        // Adding bufferSeconds to account for oracle delays.
        if (blockTimestamp >= round.lockTimestamp + BigInt(ROUND_BUFFER_SECONDS)) {
          needsExecuteAll = true;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[RoundKeeper] Error processing pair ${pair.name}: ${message}`);
        // Continue to next pair; do not let one pair failure block others.
      }
    }

    // Single call that handles all pairs at once
    if (needsExecuteAll) {
      try {
        console.log('[RoundKeeper] Calling executeRoundsAll()');
        const tx = await tapPredictor.executeRoundsAll();
        await tx.wait();
        console.log(`[RoundKeeper] executeRoundsAll tx confirmed: ${tx.hash}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[RoundKeeper] executeRoundsAll failed: ${message}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[RoundKeeper] Fatal error: ${message}`);
  } finally {
    isRunning = false;
  }
};

export const startRoundKeeperWorker = (): void => {
  console.log(`[RoundKeeper] Worker started (interval: ${ROUND_KEEPER_INTERVAL_MS}ms)`);
  setInterval(keepRounds, ROUND_KEEPER_INTERVAL_MS);
  keepRounds();
};
