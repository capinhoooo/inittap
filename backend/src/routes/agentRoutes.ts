import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { copyVaultReadonly } from '../lib/evm/contracts.ts';
import { checksumAddress } from '../utils/evmUtils.ts';
import { handleError, handleNotFoundError, handleServerError } from '../utils/errorHandler.ts';

// ============================================
// Allowed Sort Fields
// ============================================

const ALLOWED_SORT_FIELDS = ['wins', 'totalTrades', 'totalPnL'] as const;
type SortField = (typeof ALLOWED_SORT_FIELDS)[number];

function isAllowedSortField(value: string): value is SortField {
  return ALLOWED_SORT_FIELDS.includes(value as SortField);
}

// ============================================
// BigInt Serialization
// ============================================

function serializeAgent(agent: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(agent)) {
    if (typeof value === 'bigint') {
      result[key] = value.toString();
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? serializeCopyTrade(item as Record<string, unknown>)
          : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function serializeCopyTrade(trade: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(trade)) {
    result[key] = typeof value === 'bigint' ? value.toString() : value;
  }
  return result;
}

// ============================================
// Routes
// ============================================

export const agentRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * GET /agents
   * List agents with optional filtering and sorting.
   * Query: active (optional bool), sortBy (default 'wins'), limit (default 20, max 100), offset (default 0)
   */
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as {
        active?: string;
        sortBy?: string;
        limit?: string;
        offset?: string;
      };

      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);
      const sortBy = query.sortBy && isAllowedSortField(query.sortBy) ? query.sortBy : 'wins';

      const where: Record<string, unknown> = {};
      if (query.active === 'true') {
        where.isActive = true;
      } else if (query.active === 'false') {
        where.isActive = false;
      }

      const [agents, total] = await Promise.all([
        prismaQuery.agent.findMany({
          where,
          orderBy: { [sortBy]: 'desc' },
          take: limit,
          skip: offset,
        }),
        prismaQuery.agent.count({ where }),
      ]);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          agents: agents.map(serializeAgent),
          total,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /agents/:agentId
   * Get a single agent with recent copy trades.
   */
  app.get('/:agentId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId } = request.params as { agentId: string };

      const parsedId = Number(agentId);
      if (!Number.isFinite(parsedId) || parsedId < 1 || !Number.isInteger(parsedId)) {
        return handleError(reply, 400, 'agentId must be a positive integer', 'INVALID_PARAM');
      }

      const agent = await prismaQuery.agent.findUnique({
        where: { id: parsedId },
        include: {
          copyTrades: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
        },
      });

      if (!agent) {
        return handleNotFoundError(reply, 'Agent');
      }

      const { copyTrades, ...agentData } = agent;

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          agent: serializeAgent(agentData as unknown as Record<string, unknown>),
          recentTrades: copyTrades.map((t) => serializeCopyTrade(t as unknown as Record<string, unknown>)),
          followers: agent.subscriberCount,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /agents/:agentId/trades
   * Paginated copy trade history for an agent.
   * Query: limit (default 20, max 100), offset (default 0)
   */
  app.get('/:agentId/trades', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId } = request.params as { agentId: string };
      const query = request.query as { limit?: string; offset?: string };

      const parsedId = Number(agentId);
      if (!Number.isFinite(parsedId) || parsedId < 1 || !Number.isInteger(parsedId)) {
        return handleError(reply, 400, 'agentId must be a positive integer', 'INVALID_PARAM');
      }

      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      // Verify agent exists
      const agent = await prismaQuery.agent.findUnique({
        where: { id: parsedId },
        select: { id: true },
      });

      if (!agent) {
        return handleNotFoundError(reply, 'Agent');
      }

      const where = { agentId: parsedId };

      const [trades, total] = await Promise.all([
        prismaQuery.copyTrade.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prismaQuery.copyTrade.count({ where }),
      ]);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          trades: trades.map((t) => serializeCopyTrade(t as unknown as Record<string, unknown>)),
          total,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /agents/:agentId/followers
   * Read follower data from the CopyVault contract on-chain.
   * Returns follower addresses and their deposit amounts.
   */
  app.get('/:agentId/followers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId } = request.params as { agentId: string };

      const parsedId = Number(agentId);
      if (!Number.isFinite(parsedId) || parsedId < 1 || !Number.isInteger(parsedId)) {
        return handleError(reply, 400, 'agentId must be a positive integer', 'INVALID_PARAM');
      }

      let followerAddresses: string[];
      try {
        followerAddresses = await copyVaultReadonly.getFollowers(parsedId);
      } catch (contractError) {
        const msg = contractError instanceof Error ? contractError.message : String(contractError);
        console.error(`[AgentRoutes] Failed to read followers for agentId=${parsedId}: ${msg}`);
        return handleError(
          reply,
          404,
          'Agent not found on-chain or contract call failed',
          'CONTRACT_READ_FAILED',
        );
      }

      // Cap the number of on-chain calls per request
      const MAX_FOLLOWERS_PER_REQUEST = 100;
      const cappedAddresses = followerAddresses.slice(0, MAX_FOLLOWERS_PER_REQUEST);

      // Read deposit amount for each follower in parallel
      const followers = await Promise.all(
        cappedAddresses.map(async (addr: string) => {
          const checksummed = checksumAddress(addr);
          let deposit = '0';
          try {
            const depositBigInt: bigint = await copyVaultReadonly.deposits(parsedId, checksummed);
            deposit = depositBigInt.toString();
          } catch (depError) {
            const msg = depError instanceof Error ? depError.message : String(depError);
            console.error(`[AgentRoutes] Failed to read deposit for ${checksummed} on agentId=${parsedId}: ${msg}`);
          }
          return { address: checksummed, deposit };
        }),
      );

      return reply.code(200).send({
        success: true,
        error: null,
        data: { followers, totalFollowers: followerAddresses.length },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
