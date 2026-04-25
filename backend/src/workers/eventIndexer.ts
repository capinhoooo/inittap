import { Interface, type Log, type LogDescription } from 'ethers';
import {
  EVENT_INDEXER_INTERVAL_MS,
  EVENT_INDEXER_BATCH_SIZE,
  TAPPREDICTOR_ADDRESS,
  AGENTREGISTRY_ADDRESS,
  COPYVAULT_ADDRESS,
  ROUND_BUFFER_SECONDS,
} from '../config/main-config.ts';
import { provider } from '../lib/evm/provider.ts';
import { tapPredictorReadonly, agentRegistry } from '../lib/evm/contracts.ts';
import { prismaQuery } from '../lib/prisma.ts';
import { checksumAddress, resolvePairName } from '../utils/evmUtils.ts';

import TapPredictorABI from '../lib/evm/abi/TapPredictor.json';
import AgentRegistryABI from '../lib/evm/abi/AgentRegistry.json';
import CopyVaultABI from '../lib/evm/abi/CopyVault.json';

// ============================================
// Interfaces for parsing
// ============================================

const tapPredictorInterface = new Interface(TapPredictorABI);
const agentRegistryInterface = new Interface(AgentRegistryABI);
const copyVaultInterface = new Interface(CopyVaultABI);

// ============================================
// Types
// ============================================

// Prisma transaction client type
type PrismaTx = Parameters<Parameters<typeof prismaQuery.$transaction>[0]>[0];

interface ParsedEvent {
  log: Log;
  parsed: LogDescription;
  contractName: 'TapPredictor' | 'AgentRegistry' | 'CopyVault';
}

// ============================================
// State
// ============================================

let isRunning = false;
let lastSweepTime = 0;
const SWEEP_INTERVAL_MS = 60_000;

// ============================================
// Helpers
// ============================================

function identifyContract(address: string): ParsedEvent['contractName'] | null {
  const lower = address.toLowerCase();
  if (lower === TAPPREDICTOR_ADDRESS.toLowerCase()) return 'TapPredictor';
  if (lower === AGENTREGISTRY_ADDRESS.toLowerCase()) return 'AgentRegistry';
  if (lower === COPYVAULT_ADDRESS.toLowerCase()) return 'CopyVault';
  return null;
}

function parseLog(log: Log, contractName: ParsedEvent['contractName']): LogDescription | null {
  try {
    switch (contractName) {
      case 'TapPredictor':
        return tapPredictorInterface.parseLog({ topics: log.topics as string[], data: log.data });
      case 'AgentRegistry':
        return agentRegistryInterface.parseLog({ topics: log.topics as string[], data: log.data });
      case 'CopyVault':
        return copyVaultInterface.parseLog({ topics: log.topics as string[], data: log.data });
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Add two wei amounts stored as strings. Handles BigInt arithmetic safely.
 */
function addWei(current: string, addition: bigint): string {
  return (BigInt(current) + addition).toString();
}

// ============================================
// Event Handlers
// ============================================

async function handleTapPredictorEvent(
  tx: PrismaTx,
  parsed: LogDescription,
  log: Log,
): Promise<void> {
  const eventName = parsed.name;

  switch (eventName) {
    case 'StartRound': {
      const pairId = parsed.args[0] as string; // bytes32
      const epoch = Number(parsed.args[1] as bigint);

      // Read round data from chain to get timestamps
      const roundData = await tapPredictorReadonly.rounds(pairId, BigInt(epoch));

      // Ensure Pair record exists
      await tx.pair.upsert({
        where: { id: pairId },
        create: { id: pairId, name: resolvePairName(pairId), active: true },
        update: {},
      });

      await tx.round.upsert({
        where: { pairId_epoch: { pairId, epoch } },
        create: {
          pairId,
          epoch,
          startTimestamp: BigInt(roundData.startTimestamp),
          lockTimestamp: BigInt(roundData.lockTimestamp),
          closeTimestamp: BigInt(roundData.closeTimestamp),
          status: 'LIVE',
        },
        update: {
          startTimestamp: BigInt(roundData.startTimestamp),
          lockTimestamp: BigInt(roundData.lockTimestamp),
          closeTimestamp: BigInt(roundData.closeTimestamp),
          status: 'LIVE',
        },
      });
      break;
    }

    case 'LockRound': {
      const pairId = parsed.args[0] as string;
      const epoch = Number(parsed.args[1] as bigint);
      const price = (parsed.args[2] as bigint).toString();

      await tx.round.update({
        where: { pairId_epoch: { pairId, epoch } },
        data: {
          lockPrice: price,
          status: 'LOCKED',
        },
      });
      break;
    }

    case 'EndRound': {
      const pairId = parsed.args[0] as string;
      const epoch = Number(parsed.args[1] as bigint);
      const price = (parsed.args[2] as bigint).toString();

      await tx.round.update({
        where: { pairId_epoch: { pairId, epoch } },
        data: {
          closePrice: price,
          oracleCalled: true,
          status: 'ENDED',
        },
      });
      break;
    }

    case 'RewardsCalculated': {
      const pairId = parsed.args[0] as string;
      const epoch = Number(parsed.args[1] as bigint);
      const rewardBaseCalAmount = (parsed.args[2] as bigint).toString();
      const rewardAmount = (parsed.args[3] as bigint).toString();

      await tx.round.update({
        where: { pairId_epoch: { pairId, epoch } },
        data: {
          rewardBaseCalAmount,
          rewardAmount,
        },
      });
      break;
    }

    case 'BetBull':
    case 'BetBear': {
      const pairId = parsed.args[0] as string;
      const sender = checksumAddress(parsed.args[1] as string);
      const epoch = Number(parsed.args[2] as bigint);
      const amount = parsed.args[3] as bigint;
      const position = eventName === 'BetBull' ? 'Bull' : 'Bear';
      const isCopyTrade = sender.toLowerCase() === COPYVAULT_ADDRESS.toLowerCase();

      // Ensure User record exists (FK target for Bet.userAddress -> User.walletAddress)
      await tx.user.upsert({
        where: { walletAddress: sender },
        create: { walletAddress: sender },
        update: {},
      });

      // Update UserStats
      const existingStats = await tx.userStats.findUnique({
        where: { walletAddress: sender },
      });
      const prevVolume = existingStats?.totalBetVolume ?? '0';
      const prevBets = existingStats?.totalBets ?? 0;

      await tx.userStats.upsert({
        where: { walletAddress: sender },
        create: {
          id: sender,
          walletAddress: sender,
          totalBets: 1,
          totalBetVolume: amount.toString(),
        },
        update: {
          totalBets: prevBets + 1,
          totalBetVolume: addWei(prevVolume, amount),
        },
      });

      await tx.bet.upsert({
        where: { pairId_epoch_userAddress: { pairId, epoch, userAddress: sender } },
        create: {
          pairId,
          epoch,
          userAddress: sender,
          position,
          amount: amount.toString(),
          isCopyTrade,
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
        update: {
          position,
          amount: amount.toString(),
          isCopyTrade,
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
      });

      // Update Round amounts
      const existingRound = await tx.round.findUnique({
        where: { pairId_epoch: { pairId, epoch } },
      });
      if (existingRound) {
        const updateData: Record<string, string> = {
          totalAmount: addWei(existingRound.totalAmount, amount),
        };
        if (position === 'Bull') {
          updateData.bullAmount = addWei(existingRound.bullAmount, amount);
        } else {
          updateData.bearAmount = addWei(existingRound.bearAmount, amount);
        }
        await tx.round.update({
          where: { pairId_epoch: { pairId, epoch } },
          data: updateData,
        });
      }
      break;
    }

    case 'Claim': {
      const sender = checksumAddress(parsed.args[0] as string);
      const epoch = Number(parsed.args[1] as bigint);
      const amount = parsed.args[2] as bigint;

      // Claim event does NOT include pairId. Use empty string for MVP.
      await tx.claim.upsert({
        where: { pairId_epoch_userAddress: { pairId: '', epoch, userAddress: sender } },
        create: {
          userAddress: sender,
          pairId: '',
          epoch,
          amount: amount.toString(),
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
        update: {
          amount: amount.toString(),
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
      });

      // Update UserStats totalWinnings
      const claimStats = await tx.userStats.findUnique({
        where: { walletAddress: sender },
      });
      const prevWinnings = claimStats?.totalWinnings ?? '0';

      await tx.userStats.upsert({
        where: { walletAddress: sender },
        create: {
          id: sender,
          walletAddress: sender,
          totalWinnings: amount.toString(),
        },
        update: {
          totalWinnings: addWei(prevWinnings, amount),
        },
      });
      break;
    }

    case 'TapMinted': {
      const user = checksumAddress(parsed.args[0] as string);
      const tapAmount = parsed.args[1] as bigint;

      const mintStats = await tx.userStats.findUnique({
        where: { walletAddress: user },
      });
      const prevMinted = mintStats?.tapTokensMinted ?? '0';

      await tx.userStats.upsert({
        where: { walletAddress: user },
        create: {
          id: user,
          walletAddress: user,
          tapTokensMinted: tapAmount.toString(),
        },
        update: {
          tapTokensMinted: addWei(prevMinted, tapAmount),
        },
      });
      break;
    }

    case 'StreakUpdate': {
      const user = checksumAddress(parsed.args[0] as string);
      const streak = Number(parsed.args[1] as bigint);

      const streakStats = await tx.userStats.findUnique({
        where: { walletAddress: user },
      });
      const prevMaxStreak = streakStats?.maxStreak ?? 0;

      await tx.userStats.upsert({
        where: { walletAddress: user },
        create: {
          id: user,
          walletAddress: user,
          currentStreak: streak,
          maxStreak: streak,
        },
        update: {
          currentStreak: streak,
          maxStreak: Math.max(prevMaxStreak, streak),
        },
      });
      break;
    }

    case 'BridgeToL1': {
      const user = checksumAddress(parsed.args[0] as string);
      const amount = (parsed.args[1] as bigint).toString();
      const receiver = parsed.args[2] as string;

      await tx.bridgeEvent.create({
        data: {
          userAddress: user,
          amount,
          receiver,
          eventType: 'BridgeToL1',
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
      });
      console.log(`[EventIndexer] BridgeToL1: ${user} bridged ${amount} wei to ${receiver}`);
      break;
    }

    case 'BridgeToL1ViaWrapper': {
      const user = checksumAddress(parsed.args[0] as string);
      const amount = (parsed.args[1] as bigint).toString();
      const receiver = parsed.args[2] as string;

      await tx.bridgeEvent.create({
        data: {
          userAddress: user,
          amount,
          receiver,
          eventType: 'BridgeViaWrapper',
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
      });
      console.log(`[EventIndexer] BridgeViaWrapper: ${user} bridged ${amount} wei to ${receiver}`);
      break;
    }

    case 'BridgeCallbackRegistered': {
      const callbackId = parsed.args[0] as bigint;
      const user = checksumAddress(parsed.args[1] as string);
      const amount = (parsed.args[2] as bigint).toString();

      await tx.bridgeEvent.create({
        data: {
          userAddress: user,
          callbackId: BigInt(callbackId),
          amount,
          eventType: 'CallbackRegistered',
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
      });
      break;
    }

    case 'BridgeCallbackReceived': {
      const callbackId = parsed.args[0] as bigint;
      const success = parsed.args[1] as boolean;

      // Find the matching CallbackRegistered event and update
      const existing = await tx.bridgeEvent.findFirst({
        where: { callbackId: BigInt(callbackId), eventType: 'CallbackRegistered' },
      });

      await tx.bridgeEvent.create({
        data: {
          userAddress: existing?.userAddress ?? '',
          callbackId: BigInt(callbackId),
          amount: existing?.amount ?? '0',
          eventType: success ? 'CallbackSuccess' : 'CallbackFailed',
          success,
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
      });
      console.log(`[EventIndexer] BridgeCallback ${callbackId}: success=${success}`);
      break;
    }

    case 'BridgeFailureRefunded': {
      const callbackId = parsed.args[0] as bigint;
      const user = checksumAddress(parsed.args[1] as string);
      const amount = (parsed.args[2] as bigint).toString();

      await tx.bridgeEvent.create({
        data: {
          userAddress: user,
          callbackId: BigInt(callbackId),
          amount,
          eventType: 'RefundAccrued',
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
      });
      break;
    }

    case 'RefundAccrued': {
      const user = checksumAddress(parsed.args[0] as string);
      const amount = (parsed.args[1] as bigint).toString();

      await tx.bridgeEvent.create({
        data: {
          userAddress: user,
          amount,
          eventType: 'RefundAccrued',
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
      });
      break;
    }

    case 'RefundClaimed': {
      const user = checksumAddress(parsed.args[0] as string);
      const amount = (parsed.args[1] as bigint).toString();

      await tx.bridgeEvent.create({
        data: {
          userAddress: user,
          amount,
          eventType: 'RefundClaimed',
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
      });
      console.log(`[EventIndexer] RefundClaimed: ${user} claimed ${amount} wei`);
      break;
    }

    case 'VipScoreIncreaseFailed': {
      const user = checksumAddress(parsed.args[0] as string);
      const stage = Number(parsed.args[1] as bigint);
      const amount = Number(parsed.args[2] as bigint);
      const reason = parsed.args[3] as string;
      console.warn(`[EventIndexer] VipScore increase failed for ${user}: stage=${stage} amount=${amount} reason=${reason}`);
      break;
    }

    case 'BridgeViaWrapperDustRounded': {
      const user = checksumAddress(parsed.args[0] as string);
      const totalReward = (parsed.args[1] as bigint).toString();
      const bridgeable = (parsed.args[2] as bigint).toString();
      const dust = (parsed.args[3] as bigint).toString();
      console.log(`[EventIndexer] BridgeDustRounded: ${user} total=${totalReward} bridgeable=${bridgeable} dust=${dust}`);
      break;
    }

    default:
      // Unhandled TapPredictor event, skip silently
      break;
  }
}

async function handleAgentRegistryEvent(
  tx: PrismaTx,
  parsed: LogDescription,
  log: Log,
): Promise<void> {
  const eventName = parsed.name;

  switch (eventName) {
    case 'AgentRegistered': {
      const agentId = Number(parsed.args[0] as bigint);
      const creator = checksumAddress(parsed.args[1] as string);
      const agentWallet = checksumAddress(parsed.args[2] as string);
      const strategyURI = parsed.args[3] as string;

      // Read additional data from contract
      let performanceFeeBps = 0;
      let registrationTime = BigInt(0);
      try {
        const agentData = await agentRegistry.getAgent(BigInt(agentId));
        performanceFeeBps = Number(agentData.performanceFeeBps);
        registrationTime = BigInt(agentData.registrationTime);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[EventIndexer] Failed to read agent data for agentId=${agentId}: ${msg}`);
      }

      await tx.agent.upsert({
        where: { id: agentId },
        create: {
          id: agentId,
          creator,
          agentWallet,
          strategyURI,
          performanceFeeBps,
          registrationTime,
          registrationTxHash: log.transactionHash,
        },
        update: {
          creator,
          agentWallet,
          strategyURI,
          performanceFeeBps,
          registrationTime,
          registrationTxHash: log.transactionHash,
        },
      });
      break;
    }

    case 'AgentDeactivated': {
      const agentId = Number(parsed.args[0] as bigint);

      await tx.agent.update({
        where: { id: agentId },
        data: { isActive: false },
      });
      break;
    }

    case 'TradeRecorded': {
      const agentId = Number(parsed.args[0] as bigint);
      const won = parsed.args[1] as boolean;
      const pnl = parsed.args[2] as bigint;

      const existingAgent = await tx.agent.findUnique({
        where: { id: agentId },
      });

      if (existingAgent) {
        await tx.agent.update({
          where: { id: agentId },
          data: {
            totalTrades: existingAgent.totalTrades + 1,
            wins: won ? existingAgent.wins + 1 : existingAgent.wins,
            totalPnL: (BigInt(existingAgent.totalPnL) + pnl).toString(),
          },
        });
      }
      break;
    }

    case 'Subscribed': {
      const agentId = Number(parsed.args[0] as bigint);
      const subscriber = checksumAddress(parsed.args[1] as string);
      const amount = (parsed.args[2] as bigint).toString();

      const subAgent = await tx.agent.findUnique({ where: { id: agentId } });
      if (subAgent) {
        await tx.agent.update({
          where: { id: agentId },
          data: { subscriberCount: subAgent.subscriberCount + 1 },
        });
      }

      await tx.vaultDeposit.create({
        data: {
          agentId,
          follower: subscriber,
          amount,
          action: 'Deposit',
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
      });
      break;
    }

    case 'Unsubscribed': {
      const agentId = Number(parsed.args[0] as bigint);
      const subscriber = checksumAddress(parsed.args[1] as string);
      const refundAmount = (parsed.args[2] as bigint).toString();

      const unsubAgent = await tx.agent.findUnique({ where: { id: agentId } });
      if (unsubAgent && unsubAgent.subscriberCount > 0) {
        await tx.agent.update({
          where: { id: agentId },
          data: { subscriberCount: unsubAgent.subscriberCount - 1 },
        });
      }

      await tx.vaultDeposit.create({
        data: {
          agentId,
          follower: subscriber,
          amount: refundAmount,
          action: 'Withdraw',
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
      });
      break;
    }

    case 'AgentShareTokenCreated': {
      const agentId = Number(parsed.args[0] as bigint);
      const token = checksumAddress(parsed.args[1] as string);

      await tx.agent.update({
        where: { id: agentId },
        data: { shareTokenAddress: token },
      });
      break;
    }

    default:
      break;
  }
}

async function handleCopyVaultEvent(
  tx: PrismaTx,
  parsed: LogDescription,
  log: Log,
): Promise<void> {
  const eventName = parsed.name;

  switch (eventName) {
    case 'Deposited': {
      const agentId = Number(parsed.args[0] as bigint);
      const follower = checksumAddress(parsed.args[1] as string);
      const amount = (parsed.args[2] as bigint).toString();

      await tx.vaultDeposit.create({
        data: {
          agentId,
          follower,
          amount,
          action: 'Deposit',
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
      });
      break;
    }

    case 'Withdrawn': {
      const agentId = Number(parsed.args[0] as bigint);
      const follower = checksumAddress(parsed.args[1] as string);
      const amount = (parsed.args[2] as bigint).toString();

      await tx.vaultDeposit.create({
        data: {
          agentId,
          follower,
          amount,
          action: 'Withdraw',
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
      });
      break;
    }

    case 'CopyTradeExecuted': {
      const agentId = Number(parsed.args[0] as bigint);
      const pairHash = parsed.args[1] as string;
      const epoch = Number(parsed.args[2] as bigint);
      const isBull = parsed.args[3] as boolean;
      const totalBetAmount = (parsed.args[4] as bigint).toString();
      const followerCount = Number(parsed.args[5] as bigint);

      await tx.copyTrade.upsert({
        where: { agentId_pairId_epoch: { agentId, pairId: pairHash, epoch } },
        create: {
          agentId,
          pairId: pairHash,
          epoch,
          isBull,
          totalBetAmount,
          followerCount,
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
        update: {
          isBull,
          totalBetAmount,
          followerCount,
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
        },
      });
      break;
    }

    case 'RewardsDistributed': {
      const agentId = Number(parsed.args[0] as bigint);
      const pairHash = parsed.args[1] as string;
      const epoch = Number(parsed.args[2] as bigint);
      const totalClaimed = (parsed.args[3] as bigint).toString();
      const totalFees = (parsed.args[4] as bigint).toString();

      await tx.copyTrade.update({
        where: { agentId_pairId_epoch: { agentId, pairId: pairHash, epoch } },
        data: {
          claimed: true,
          totalClaimed,
          totalFees,
        },
      });
      break;
    }

    default:
      break;
  }
}

// ============================================
// Stale Round Sweep
// ============================================

async function sweepStaleRounds(): Promise<void> {
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const cutoff = nowSeconds - BigInt(ROUND_BUFFER_SECONDS);

  const staleRounds = await prismaQuery.round.findMany({
    where: {
      status: { in: ['LIVE', 'LOCKED'] },
      closeTimestamp: { lt: cutoff },
    },
    select: { id: true, pairId: true, epoch: true },
  });

  if (staleRounds.length > 0) {
    await prismaQuery.round.updateMany({
      where: {
        id: { in: staleRounds.map((r) => r.id) },
      },
      data: { status: 'CANCELLED' },
    });
    console.log(`[EventIndexer] Swept ${staleRounds.length} stale rounds to CANCELLED`);
  }
}

// ============================================
// Main Indexer Logic
// ============================================

const indexEvents = async (): Promise<void> => {
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    // Stale round sweep (every 60s)
    const now = Date.now();
    if (now - lastSweepTime >= SWEEP_INTERVAL_MS) {
      lastSweepTime = now;
      try {
        await sweepStaleRounds();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[EventIndexer] Stale round sweep failed: ${msg}`);
      }
    }

    // Get or create cursor
    const CONTRACT_DEPLOY_BLOCK = BigInt(17173000);
    const cursor = await prismaQuery.indexerCursor.upsert({
      where: { id: 'main' },
      create: { id: 'main', lastBlockNumber: CONTRACT_DEPLOY_BLOCK },
      update: {},
    });

    // If cursor is behind contract deployment, fast-forward
    let lastBlockNumber = cursor.lastBlockNumber < CONTRACT_DEPLOY_BLOCK
      ? CONTRACT_DEPLOY_BLOCK
      : cursor.lastBlockNumber;
    const currentBlock = BigInt(await provider.getBlockNumber());

    if (lastBlockNumber >= currentBlock) {
      return; // Already caught up
    }

    // Process in batches
    const batchSize = BigInt(EVENT_INDEXER_BATCH_SIZE);
    const contractAddresses = [TAPPREDICTOR_ADDRESS, AGENTREGISTRY_ADDRESS, COPYVAULT_ADDRESS];

    while (lastBlockNumber < currentBlock) {
      const fromBlock = lastBlockNumber + 1n;
      const toBlock = fromBlock + batchSize - 1n < currentBlock
        ? fromBlock + batchSize - 1n
        : currentBlock;

      // Fetch logs for all 3 contracts in a single RPC call
      const logs = await provider.getLogs({
        address: contractAddresses,
        fromBlock: Number(fromBlock),
        toBlock: Number(toBlock),
      });

      if (logs.length > 0) {
        // Parse all logs first, skip unparseable ones
        const parsedEvents: ParsedEvent[] = [];
        for (const log of logs) {
          const contractName = identifyContract(log.address);
          if (!contractName) continue;

          const parsed = parseLog(log, contractName);
          if (!parsed) continue;

          parsedEvents.push({ log, parsed, contractName });
        }

        // Execute all DB writes in a single transaction per batch
        if (parsedEvents.length > 0) {
          await prismaQuery.$transaction(async (tx) => {
            for (const event of parsedEvents) {
              try {
                switch (event.contractName) {
                  case 'TapPredictor':
                    await handleTapPredictorEvent(tx, event.parsed, event.log);
                    break;
                  case 'AgentRegistry':
                    await handleAgentRegistryEvent(tx, event.parsed, event.log);
                    break;
                  case 'CopyVault':
                    await handleCopyVaultEvent(tx, event.parsed, event.log);
                    break;
                }
              } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                console.error(
                  `[EventIndexer] Error handling ${event.contractName}.${event.parsed.name} at block ${event.log.blockNumber}: ${msg}`,
                );
                // Rethrow to roll back the entire batch transaction.
                // The next tick will retry from the same lastBlockNumber.
                throw error;
              }
            }

            // Update cursor within the same transaction
            await tx.indexerCursor.update({
              where: { id: 'main' },
              data: { lastBlockNumber: toBlock },
            });
          }, { timeout: 30000 });
        } else {
          // No parseable events, just advance the cursor
          await prismaQuery.indexerCursor.update({
            where: { id: 'main' },
            data: { lastBlockNumber: toBlock },
          });
        }

        console.log(
          `[EventIndexer] Processed blocks ${fromBlock}-${toBlock} (${parsedEvents.length} events)`,
        );
      } else {
        // No logs in range, advance cursor
        await prismaQuery.indexerCursor.update({
          where: { id: 'main' },
          data: { lastBlockNumber: toBlock },
        });
      }

      lastBlockNumber = toBlock;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[EventIndexer] Error: ${message}`);
  } finally {
    isRunning = false;
  }
};

export const startEventIndexerWorker = (): void => {
  console.log(`[EventIndexer] Worker started (interval: ${EVENT_INDEXER_INTERVAL_MS}ms)`);
  setInterval(indexEvents, EVENT_INDEXER_INTERVAL_MS);
  indexEvents();
};
