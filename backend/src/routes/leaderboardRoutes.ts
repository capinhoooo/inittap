import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { checksumAddress } from '../utils/evmUtils.ts';
import { handleError, handleNotFoundError, handleServerError } from '../utils/errorHandler.ts';

// Allowed sort fields for the leaderboard
const ALLOWED_SORT_FIELDS = ['totalWins', 'totalBetVolume', 'maxStreak', 'netPnL'] as const;
type SortField = (typeof ALLOWED_SORT_FIELDS)[number];

function isAllowedSortField(value: string): value is SortField {
  return ALLOWED_SORT_FIELDS.includes(value as SortField);
}

export const leaderboardRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * GET /leaderboard/top
   * Returns the top users sorted by a specified stat.
   * Query: sortBy (default 'totalWins'), limit (default 50, max 100)
   */
  app.get('/top', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { sortBy?: string; limit?: string };

      const sortBy = query.sortBy && isAllowedSortField(query.sortBy) ? query.sortBy : 'totalWins';
      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);

      const leaderboard = await prismaQuery.userStats.findMany({
        orderBy: { [sortBy]: 'desc' },
        take: limit,
      });

      return reply.code(200).send({
        success: true,
        error: null,
        data: { leaderboard },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /leaderboard/user/:address
   * Returns the stats and rank for a specific user.
   */
  app.get('/user/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };

      if (!address || typeof address !== 'string') {
        return handleError(reply, 400, 'Address is required', 'INVALID_PARAM');
      }

      let checksummed: string;
      try {
        checksummed = checksumAddress(address);
      } catch {
        return handleError(reply, 400, 'Invalid wallet address', 'INVALID_ADDRESS');
      }

      const stats = await prismaQuery.userStats.findUnique({
        where: { walletAddress: checksummed },
      });

      if (!stats) {
        return handleNotFoundError(reply, 'User stats');
      }

      // Calculate rank by counting users with more totalWins
      const rank = await prismaQuery.userStats.count({
        where: {
          totalWins: { gt: stats.totalWins },
        },
      });

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          rank: rank + 1, // 1-indexed rank
          stats,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
