import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { tapPredictorReadonly } from '../lib/evm/contracts.ts';
import { provider } from '../lib/evm/provider.ts';
import { authMiddleware } from '../middlewares/authMiddleware.ts';
import { handleError, handleServerError } from '../utils/errorHandler.ts';
import { evmToCosmosAddress, resolveAddressToUsername } from '../lib/cosmos/client.ts';

// ============================================
// BigInt Serialization Helpers
// ============================================

function serializeBet(bet: Record<string, unknown>) {
  return {
    ...bet,
    blockNumber: String(bet.blockNumber),
    round: bet.round ? serializeRound(bet.round as Record<string, unknown>) : undefined,
  };
}

function serializeRound(round: Record<string, unknown>) {
  return {
    ...round,
    startTimestamp: String(round.startTimestamp),
    lockTimestamp: String(round.lockTimestamp),
    closeTimestamp: String(round.closeTimestamp),
    lockOracleNonce: round.lockOracleNonce != null ? String(round.lockOracleNonce) : null,
    closeOracleNonce: round.closeOracleNonce != null ? String(round.closeOracleNonce) : null,
  };
}

function serializeClaim(claim: Record<string, unknown>) {
  return {
    ...claim,
    blockNumber: String(claim.blockNumber),
  };
}

// Default stats for users without a UserStats record
const DEFAULT_USER_STATS = {
  totalBets: 0,
  totalWins: 0,
  currentStreak: 0,
  maxStreak: 0,
  totalBetVolume: '0',
  totalWinnings: '0',
  netPnL: '0',
  tapTokensMinted: '0',
};

export const userRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * GET /user/profile
   * Returns the authenticated user's profile and stats.
   */
  app.get('/profile', { preHandler: [authMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const walletAddress = request.user!.walletAddress;
      const cosmosAddress = evmToCosmosAddress(walletAddress);

      let initBalance = '0';
      try {
        const balance = await provider.getBalance(walletAddress);
        initBalance = balance.toString();
      } catch {
        // RPC may be slow, don't fail the profile request
      }

      let username: string | null = null;
      try {
        username = await resolveAddressToUsername(walletAddress);
      } catch {
        // L1 may be unreachable, don't fail the profile request
      }

      const stats = await prismaQuery.userStats.findUnique({
        where: { walletAddress },
      });

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          user: {
            id: request.user!.id,
            walletAddress: request.user!.walletAddress,
            cosmosAddress,
            username,
            initBalance,
            lastSignIn: request.user!.lastSignIn,
            createdAt: request.user!.createdAt,
          },
          stats: stats ?? { ...DEFAULT_USER_STATS, walletAddress },
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /user/bets
   * Paginated list of the authenticated user's bets.
   * Query: pairId (optional), limit (default 20, max 100), offset (default 0)
   */
  app.get('/bets', { preHandler: [authMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const walletAddress = request.user!.walletAddress;
      const query = request.query as { pairId?: string; limit?: string; offset?: string };

      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      const where: Record<string, unknown> = { userAddress: walletAddress };
      if (query.pairId && typeof query.pairId === 'string') {
        where.pairId = query.pairId;
      }

      const [bets, total] = await Promise.all([
        prismaQuery.bet.findMany({
          where,
          include: { round: true },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prismaQuery.bet.count({ where }),
      ]);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          bets: bets.map(serializeBet),
          total,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /user/claimable
   * Returns all unclaimed winning bets for the authenticated user.
   * Verifies claimability on-chain via the TapPredictor contract.
   */
  app.get('/claimable', { preHandler: [authMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const walletAddress = request.user!.walletAddress;

      // Find unclaimed bets where the round has ended
      const unclaimedBets = await prismaQuery.bet.findMany({
        where: {
          userAddress: walletAddress,
          claimed: false,
          round: {
            status: 'ENDED',
          },
        },
        include: {
          round: {
            include: { pair: true },
          },
        },
        take: 50, // Cap on-chain verification calls
        orderBy: { createdAt: 'desc' },
      });

      // Verify each bet on-chain in parallel
      const claimableResults = await Promise.allSettled(
        unclaimedBets.map(async (bet) => {
          try {
            const isClaimable: boolean = await tapPredictorReadonly.claimable(
              bet.pairId,
              bet.epoch,
              walletAddress
            );
            if (isClaimable) {
              return {
                pairId: bet.pairId,
                pairName: bet.round.pair.name,
                epoch: bet.epoch,
                position: bet.position,
                amount: bet.amount,
              };
            }
            return null;
          } catch {
            // If on-chain call fails, skip this bet
            return null;
          }
        })
      );

      const claimable: Array<{
        pairId: string;
        pairName: string;
        epoch: number;
        position: string;
        amount: string;
      }> = [];

      for (const result of claimableResults) {
        if (result.status === 'fulfilled' && result.value != null) {
          claimable.push(result.value);
        }
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: { claimable },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /user/history
   * Unified history of bets and claims for the authenticated user.
   * Query: limit (default 20, max 100), offset (default 0)
   */
  app.get('/history', { preHandler: [authMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const walletAddress = request.user!.walletAddress;
      const query = request.query as { limit?: string; offset?: string };

      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      const [bets, claims, totalBets, totalClaims] = await Promise.all([
        prismaQuery.bet.findMany({
          where: { userAddress: walletAddress },
          include: { round: { include: { pair: true } } },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prismaQuery.claim.findMany({
          where: { userAddress: walletAddress },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prismaQuery.bet.count({ where: { userAddress: walletAddress } }),
        prismaQuery.claim.count({ where: { userAddress: walletAddress } }),
      ]);

      // Merge and sort by createdAt descending
      type HistoryEntry = { type: 'bet' | 'claim'; createdAt: Date; [key: string]: unknown };

      const betEntries: HistoryEntry[] = bets.map((bet) => ({
        type: 'bet' as const,
        createdAt: bet.createdAt,
        ...serializeBet(bet),
      }));

      const claimEntries: HistoryEntry[] = claims.map((claim) => ({
        type: 'claim' as const,
        createdAt: claim.createdAt,
        ...serializeClaim(claim),
      }));

      const history = [...betEntries, ...claimEntries]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          history,
          total: totalBets + totalClaims,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
