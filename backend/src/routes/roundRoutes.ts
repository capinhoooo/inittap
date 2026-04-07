import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { handleError, handleNotFoundError, handleServerError } from '../utils/errorHandler.ts';

// ============================================
// BigInt Serialization Helpers
// ============================================

function serializeRound(round: Record<string, unknown>) {
  return {
    ...round,
    startTimestamp: String(round.startTimestamp),
    lockTimestamp: String(round.lockTimestamp),
    closeTimestamp: String(round.closeTimestamp),
    lockOracleNonce: round.lockOracleNonce != null ? String(round.lockOracleNonce) : null,
    closeOracleNonce: round.closeOracleNonce != null ? String(round.closeOracleNonce) : null,
    bets: Array.isArray(round.bets) ? (round.bets as Record<string, unknown>[]).map(serializeBet) : undefined,
    pair: round.pair !== undefined ? round.pair : undefined,
  };
}

function serializeBet(bet: Record<string, unknown>) {
  return {
    ...bet,
    blockNumber: String(bet.blockNumber),
  };
}

export const roundRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * GET /rounds/live
   * Returns all LIVE and LOCKED rounds with pair info.
   */
  app.get('/live', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rounds = await prismaQuery.round.findMany({
        where: {
          status: { in: ['LIVE', 'LOCKED'] },
        },
        include: { pair: true },
        orderBy: { epoch: 'desc' },
      });

      return reply.code(200).send({
        success: true,
        error: null,
        data: { rounds: rounds.map(serializeRound) },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /rounds/history
   * Paginated history of ended/cancelled rounds.
   * Query: pairId (optional), limit (default 20, max 100), offset (default 0)
   */
  app.get('/history', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { pairId?: string; limit?: string; offset?: string };

      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      const where: Record<string, unknown> = {
        status: { in: ['ENDED', 'CANCELLED'] },
      };

      if (query.pairId && typeof query.pairId === 'string') {
        where.pairId = query.pairId;
      }

      const [rounds, total] = await Promise.all([
        prismaQuery.round.findMany({
          where,
          include: { pair: true },
          orderBy: { epoch: 'desc' },
          take: limit,
          skip: offset,
        }),
        prismaQuery.round.count({ where }),
      ]);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          rounds: rounds.map(serializeRound),
          total,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /rounds/:pairId/current
   * Get the current LIVE or LOCKED round for a pair, plus the previous round.
   */
  app.get('/:pairId/current', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { pairId } = request.params as { pairId: string };

      if (!pairId || typeof pairId !== 'string') {
        return handleError(reply, 400, 'pairId is required', 'INVALID_PARAM');
      }

      const currentRound = await prismaQuery.round.findFirst({
        where: {
          pairId,
          status: { in: ['LIVE', 'LOCKED'] },
        },
        include: { pair: true },
        orderBy: { epoch: 'desc' },
      });

      if (!currentRound) {
        return handleNotFoundError(reply, 'Current round');
      }

      // Fetch previous round (epoch - 1)
      const previousRound = await prismaQuery.round.findUnique({
        where: {
          pairId_epoch: {
            pairId,
            epoch: currentRound.epoch - 1,
          },
        },
        include: { pair: true },
      });

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          round: serializeRound(currentRound),
          previousRound: previousRound ? serializeRound(previousRound) : null,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /rounds/:pairId/:epoch
   * Get a single round by pairId + epoch, including all bets.
   */
  app.get('/:pairId/:epoch', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = request.params as { pairId: string; epoch: string };

      if (!params.pairId || typeof params.pairId !== 'string') {
        return handleError(reply, 400, 'pairId is required', 'INVALID_PARAM');
      }

      const epoch = Number(params.epoch);
      if (!Number.isFinite(epoch) || epoch < 0) {
        return handleError(reply, 400, 'epoch must be a non-negative integer', 'INVALID_PARAM');
      }

      const round = await prismaQuery.round.findUnique({
        where: {
          pairId_epoch: {
            pairId: params.pairId,
            epoch,
          },
        },
        include: {
          pair: true,
          bets: true,
        },
      });

      if (!round) {
        return handleNotFoundError(reply, 'Round');
      }

      const serialized = serializeRound(round);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          round: serialized,
          bets: serialized.bets ?? [],
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
