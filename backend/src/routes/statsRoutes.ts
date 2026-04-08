import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { handleServerError } from '../utils/errorHandler.ts';
import { tapTokenReadonly, tapPredictorReadonly, vipScoreReadonly } from '../lib/evm/contracts.ts';
import { VIPSCORE_ADDRESS, TAPPREDICTOR_ADDRESS, AGENTREGISTRY_ADDRESS, COPYVAULT_ADDRESS, TAPTOKEN_ADDRESS, CONNECT_ORACLE_ADDRESS } from '../config/main-config.ts';

export const statsRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * GET /stats/platform
   * Returns aggregate platform statistics.
   */
  app.get('/platform', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Run all aggregate queries in parallel
      const [
        totalRounds,
        totalBets,
        totalUsers,
        totalAgents,
        activePairs,
        currentEpochs,
        volumeResult,
        tapTotalSupply,
      ] = await Promise.all([
        // Total rounds
        prismaQuery.round.count(),

        // Total bets
        prismaQuery.bet.count(),

        // Total users who have placed at least one bet
        prismaQuery.bet.groupBy({
          by: ['userAddress'],
          _count: true,
        }),

        // Total agents
        prismaQuery.agent.count(),

        // Active pair names
        prismaQuery.pair.findMany({
          where: { active: true },
          select: { id: true, name: true },
        }),

        // Current max epoch per active pair
        prismaQuery.round.groupBy({
          by: ['pairId'],
          _max: { epoch: true },
          where: {
            pair: { active: true },
          },
        }),

        // Total volume: sum all bet amounts
        // Bet.amount is stored as string (wei), so we use raw SQL for aggregation
        prismaQuery.$queryRaw<{ total_volume: string | null }[]>`
          SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0)::TEXT as total_volume
          FROM "Bet"
        `,

        // TAP token total supply from EVM contract
        tapTokenReadonly.totalSupply().catch(() => 0n) as Promise<bigint>,
      ]);

      // Build currentEpochs map: pairName -> maxEpoch
      const pairNameMap = new Map(activePairs.map((p) => [p.id, p.name]));
      const epochsByPair: Record<string, number | null> = {};
      for (const entry of currentEpochs) {
        const pairName = pairNameMap.get(entry.pairId);
        if (pairName) {
          epochsByPair[pairName] = entry._max.epoch;
        }
      }

      const totalVolume = volumeResult[0]?.total_volume ?? '0';

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          stats: {
            totalRounds,
            totalBets,
            totalVolume,
            totalUsers: totalUsers.length,
            totalAgents,
            activePairs: activePairs.map((p) => p.name),
            currentEpochs: epochsByPair,
            tapTokenTotalSupply: String(tapTotalSupply),
            vipEnabled: !!vipScoreReadonly,
            vipScoreAddress: VIPSCORE_ADDRESS || null,
            oraclePairsAvailable: 16,
          },
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /stats/config
   * Returns on-chain contract configuration from TapPredictor.
   */
  app.get('/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [
        intervalSeconds,
        bufferSeconds,
        minBetAmount,
        maxBetAmount,
        treasuryFee,
        vipHookEnabled,
        vipStage,
        feeDenom,
      ] = await Promise.all([
        tapPredictorReadonly.intervalSeconds() as Promise<bigint>,
        tapPredictorReadonly.bufferSeconds() as Promise<bigint>,
        tapPredictorReadonly.minBetAmount() as Promise<bigint>,
        tapPredictorReadonly.maxBetAmount() as Promise<bigint>,
        tapPredictorReadonly.treasuryFee() as Promise<bigint>,
        tapPredictorReadonly.vipHookEnabled() as Promise<boolean>,
        tapPredictorReadonly.vipStage() as Promise<bigint>,
        tapPredictorReadonly.feeDenom() as Promise<string>,
      ]);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          intervalSeconds: String(intervalSeconds),
          bufferSeconds: String(bufferSeconds),
          minBetAmount: String(minBetAmount),
          maxBetAmount: String(maxBetAmount),
          treasuryFee: String(treasuryFee),
          vipHookEnabled,
          vipStage: String(vipStage),
          feeDenom,
          contracts: {
            tapPredictor: TAPPREDICTOR_ADDRESS,
            tapToken: TAPTOKEN_ADDRESS,
            agentRegistry: AGENTREGISTRY_ADDRESS,
            copyVault: COPYVAULT_ADDRESS,
            connectOracle: CONNECT_ORACLE_ADDRESS,
          },
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
