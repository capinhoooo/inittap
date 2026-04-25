import { Interface, type LogDescription } from 'ethers';
import { CLAIM_EXECUTOR_INTERVAL_MS, COPYVAULT_ADDRESS } from '../config/main-config.ts';
import { copyVault, agentRegistryWrite } from '../lib/evm/contracts.ts';
import { prismaQuery } from '../lib/prisma.ts';

import CopyVaultABI from '../lib/evm/abi/CopyVault.json';

// ============================================
// State
// ============================================

let isRunning = false;

const copyVaultInterface = new Interface(CopyVaultABI);

// ============================================
// Main Claim Executor Logic
// ============================================

const executeClaims = async (): Promise<void> => {
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    // Step 1: Find all unclaimed CopyTrade records
    const unclaimedTrades = await prismaQuery.copyTrade.findMany({
      where: { claimed: false },
      select: {
        id: true,
        agentId: true,
        pairId: true,
        epoch: true,
      },
    });

    if (unclaimedTrades.length === 0) {
      return;
    }

    // Step 2: For each unclaimed trade, check if the corresponding round has ENDED
    // Batch-fetch all relevant rounds to avoid N+1 queries
    const roundKeys = unclaimedTrades.map((t) => ({
      pairId: t.pairId,
      epoch: t.epoch,
    }));

    // Use OR conditions to fetch all relevant rounds in one query
    const endedRounds = await prismaQuery.round.findMany({
      where: {
        status: 'ENDED',
        OR: roundKeys.map((k) => ({
          pairId: k.pairId,
          epoch: k.epoch,
        })),
      },
      select: {
        pairId: true,
        epoch: true,
      },
    });

    // Build a set of ended round keys for fast lookup
    const endedRoundSet = new Set(
      endedRounds.map((r) => `${r.pairId}:${r.epoch}`),
    );

    // Filter to only trades whose rounds have ended
    const claimableTrades = unclaimedTrades.filter(
      (t) => endedRoundSet.has(`${t.pairId}:${t.epoch}`),
    );

    if (claimableTrades.length === 0) {
      return;
    }

    // Step 3: Group by agentId
    const groupedByAgent = new Map<number, typeof claimableTrades>();
    for (const trade of claimableTrades) {
      const existing = groupedByAgent.get(trade.agentId);
      if (existing) {
        existing.push(trade);
      } else {
        groupedByAgent.set(trade.agentId, [trade]);
      }
    }

    // Step 4: For each agent group, call claimForFollowers
    for (const [agentId, trades] of groupedByAgent) {
      try {
        const pairHashes = trades.map((t) => t.pairId);
        const epochs = trades.map((t) => t.epoch);

        console.log(
          `[ClaimExecutor] Claiming for agentId=${agentId} (${trades.length} trades)`,
        );

        const tx = await copyVault.claimForFollowers(pairHashes, epochs, agentId);
        const receipt = await tx.wait();

        console.log(
          `[ClaimExecutor] Claim tx confirmed for agentId=${agentId}: ${receipt.hash}`,
        );

        // Step 4c: Parse RewardsDistributed events from receipt to get totalClaimed/totalFees
        // Build a map of (pairHash:epoch) -> { totalClaimed, totalFees }
        const rewardMap = new Map<string, { totalClaimed: string; totalFees: string }>();

        if (receipt.logs) {
          for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== COPYVAULT_ADDRESS.toLowerCase()) {
              continue;
            }
            try {
              const parsed: LogDescription | null = copyVaultInterface.parseLog({
                topics: log.topics as string[],
                data: log.data,
              });
              if (parsed && parsed.name === 'RewardsDistributed') {
                const eventPairHash = parsed.args[1] as string;
                const eventEpoch = Number(parsed.args[2] as bigint);
                const totalClaimed = (parsed.args[3] as bigint).toString();
                const totalFees = (parsed.args[4] as bigint).toString();
                rewardMap.set(`${eventPairHash}:${eventEpoch}`, { totalClaimed, totalFees });
              }
            } catch {
              // Not a parseable CopyVault event, skip
            }
          }
        }

        // Step 4d: Update CopyTrade records to claimed = true with reward data
        const tradeIds = trades.map((t) => t.id);

        // Batch update claimed = true for all trades in this group
        await prismaQuery.copyTrade.updateMany({
          where: { id: { in: tradeIds } },
          data: { claimed: true },
        });

        // Update individual records with reward data if available
        for (const trade of trades) {
          const rewardKey = `${trade.pairId}:${trade.epoch}`;
          const reward = rewardMap.get(rewardKey);
          if (reward) {
            await prismaQuery.copyTrade.update({
              where: { agentId_pairId_epoch: { agentId: trade.agentId, pairId: trade.pairId, epoch: trade.epoch } },
              data: {
                totalClaimed: reward.totalClaimed,
                totalFees: reward.totalFees,
              },
            });
          }
        }

        // Step 4e: Record trade stats on AgentRegistry (wins, PnL, totalTrades)
        // Sum up totalBetAmount from CopyTrade DB records for this batch
        const copyTradeRecords = await prismaQuery.copyTrade.findMany({
          where: { id: { in: tradeIds } },
          select: { totalBetAmount: true, totalClaimed: true },
        });

        let totalBetSum = 0n;
        let totalClaimedSum = 0n;
        for (const record of copyTradeRecords) {
          totalBetSum += BigInt(record.totalBetAmount || '0');
          totalClaimedSum += BigInt(record.totalClaimed || '0');
        }

        const won = totalClaimedSum > totalBetSum;
        const pnl = BigInt(totalClaimedSum) - BigInt(totalBetSum);

        try {
          const recordTx = await agentRegistryWrite.recordTrade(agentId, won, pnl);
          await recordTx.wait();
          console.log(
            `[ClaimExecutor] Recorded trade for agentId=${agentId}: won=${won}, pnl=${pnl.toString()}`,
          );
        } catch (recordError) {
          const recordMsg = recordError instanceof Error ? recordError.message : String(recordError);
          console.error(
            `[ClaimExecutor] Failed to record trade for agentId=${agentId}: ${recordMsg}`,
          );
          // Don't fail the whole claim, stats will be recorded on next cycle or manually
        }
      } catch (txError) {
        // Log and skip this agent. Will retry next tick.
        const msg = txError instanceof Error ? txError.message : String(txError);
        console.error(
          `[ClaimExecutor] Failed for agentId=${agentId}: ${msg}`,
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ClaimExecutor] Fatal error: ${message}`);
  } finally {
    isRunning = false;
  }
};

export const startClaimExecutor = (): void => {
  console.log(`[ClaimExecutor] Started (interval: ${CLAIM_EXECUTOR_INTERVAL_MS}ms)`);
  setInterval(executeClaims, CLAIM_EXECUTOR_INTERVAL_MS);
};
