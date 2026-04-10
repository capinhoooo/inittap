import {
  COPY_TRADE_INTERVAL_MS,
  ACTIVE_PAIRS,
} from '../config/main-config.ts';
import { copyVault, copyVaultReadonly } from '../lib/evm/contracts.ts';
import { prismaQuery } from '../lib/prisma.ts';
import { computePairHash } from '../utils/evmUtils.ts';

// ============================================
// State
// ============================================

let isRunning = false;

// Fixed bet percentage: 20% of each follower's deposit per trade
const BET_PERCENT_BPS = 2000;

// ============================================
// Helpers
// ============================================

/**
 * Determine bull/bear direction using simple price momentum.
 * Looks at the previous round's lockPrice vs closePrice for the same pair.
 * If closePrice > lockPrice, go Bull. Otherwise, Bear.
 * Defaults to Bull if no previous round data is available.
 */
async function decideBullBear(pairId: string, currentEpoch: number): Promise<boolean> {
  const previousEpoch = currentEpoch - 1;
  if (previousEpoch < 1) {
    return true; // Default to Bull
  }

  const previousRound = await prismaQuery.round.findUnique({
    where: {
      pairId_epoch: {
        pairId,
        epoch: previousEpoch,
      },
    },
    select: {
      lockPrice: true,
      closePrice: true,
      status: true,
    },
  });

  // No previous round or round not ended: default Bull
  if (!previousRound || previousRound.status !== 'ENDED') {
    return true;
  }

  // Missing price data: default Bull
  if (!previousRound.lockPrice || !previousRound.closePrice) {
    return true;
  }

  const lockPrice = BigInt(previousRound.lockPrice);
  const closePrice = BigInt(previousRound.closePrice);

  // Momentum: if price went up, bet Bull; otherwise Bear
  return closePrice > lockPrice;
}

// ============================================
// Main Executor Logic
// ============================================

const executeCopyTrades = async (): Promise<void> => {
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));

    // Step 1: Find all LIVE rounds where bets are still open (lockTimestamp in the future)
    const liveRounds = await prismaQuery.round.findMany({
      where: {
        status: 'LIVE',
        lockTimestamp: { gt: nowSeconds },
      },
      select: {
        pairId: true,
        epoch: true,
      },
    });

    if (liveRounds.length === 0) {
      return;
    }

    // Step 2: Get all active agents from DB
    const activeAgents = await prismaQuery.agent.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    if (activeAgents.length === 0) {
      return;
    }

    // Step 3: For each live round, check which agents already have a CopyTrade record
    for (const round of liveRounds) {
      const existingTrades = await prismaQuery.copyTrade.findMany({
        where: {
          pairId: round.pairId,
          epoch: round.epoch,
        },
        select: { agentId: true },
      });

      const agentIdsWithTrades = new Set(existingTrades.map((t) => t.agentId));

      // Pre-compute pair hash from the pairId (which is already a bytes32 hash)
      // The pairId in the DB IS the pairHash, so use it directly
      const pairHash = round.pairId;

      for (const agent of activeAgents) {
        if (agentIdsWithTrades.has(agent.id)) {
          continue; // Already traded for this round
        }

        try {
          // Step 4a: Check follower count on-chain
          const followerCount: bigint = await copyVaultReadonly.getFollowerCount(agent.id);
          if (followerCount === 0n) {
            continue; // No followers, skip
          }

          // Step 4b: Decide bull/bear
          const isBull = await decideBullBear(round.pairId, round.epoch);

          // Step 4c: Execute copy trade on-chain
          console.log(
            `[CopyTradeExecutor] Executing for agentId=${agent.id} pair=${pairHash.slice(0, 10)}... epoch=${round.epoch} isBull=${isBull}`,
          );

          const tx = await copyVault.executeCopyTrades(
            pairHash,
            agent.id,
            round.epoch,
            isBull,
            BET_PERCENT_BPS,
          );
          const receipt = await tx.wait();

          console.log(
            `[CopyTradeExecutor] Tx confirmed for agentId=${agent.id} epoch=${round.epoch}: ${receipt.hash}`,
          );
        } catch (txError) {
          // Log and skip this agent. Don't crash the entire loop.
          const msg = txError instanceof Error ? txError.message : String(txError);
          console.error(
            `[CopyTradeExecutor] Failed for agentId=${agent.id} pair=${pairHash.slice(0, 10)}... epoch=${round.epoch}: ${msg}`,
          );
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[CopyTradeExecutor] Fatal error: ${message}`);
  } finally {
    isRunning = false;
  }
};

export const startCopyTradeExecutor = (): void => {
  console.log(`[CopyTradeExecutor] Started (interval: ${COPY_TRADE_INTERVAL_MS}ms)`);
  setInterval(executeCopyTrades, COPY_TRADE_INTERVAL_MS);
};
