import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { getAddress } from 'ethers';
import { prismaQuery } from '../lib/prisma.ts';
import { tapPredictorReadonly } from '../lib/evm/contracts.ts';
import { handleServerError } from '../utils/errorHandler.ts';

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function serializeBridgeEvent(event: Record<string, unknown>) {
  return {
    ...event,
    callbackId: event.callbackId != null ? String(event.callbackId) : null,
    blockNumber: String(event.blockNumber),
  };
}

export const bridgeRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * GET /bridge/history/:address
   * Returns paginated bridge event history for an address.
   */
  app.get('/history/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };

      if (!address || !EVM_ADDRESS_RE.test(address)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_ADDRESS', message: 'Invalid EVM address format.' },
          data: null,
        });
      }

      const checksummed = getAddress(address);

      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      const [events, total] = await Promise.all([
        prismaQuery.bridgeEvent.findMany({
          where: { userAddress: checksummed },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prismaQuery.bridgeEvent.count({
          where: { userAddress: checksummed },
        }),
      ]);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          events: events.map((e) => serializeBridgeEvent(e as unknown as Record<string, unknown>)),
          total,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /bridge/refund/:address
   * Returns pending refund amount for an address from the TapPredictor contract.
   */
  app.get('/refund/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };

      if (!address || !EVM_ADDRESS_RE.test(address)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_ADDRESS', message: 'Invalid EVM address format.' },
          data: null,
        });
      }

      const checksummed = getAddress(address);
      const pendingRefund = await tapPredictorReadonly.pendingRefunds(checksummed) as bigint;
      const pendingRefundStr = String(pendingRefund);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          address: checksummed,
          pendingRefund: pendingRefundStr,
          hasPendingRefund: pendingRefund > 0n,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /bridge/stats
   * Returns aggregate bridge statistics.
   */
  app.get('/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [totalBridges, volumeResult, eventTypeCounts] = await Promise.all([
        prismaQuery.bridgeEvent.count(),
        prismaQuery.$queryRaw<{ total_volume: string | null }[]>`
          SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0)::TEXT as total_volume
          FROM "BridgeEvent"
        `,
        prismaQuery.bridgeEvent.groupBy({
          by: ['eventType'],
          _count: true,
        }),
      ]);

      const totalVolume = volumeResult[0]?.total_volume ?? '0';

      const countsByType: Record<string, number> = {};
      for (const entry of eventTypeCounts) {
        countsByType[entry.eventType] = entry._count;
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          totalBridges,
          totalVolume,
          totalRefunds: (countsByType['RefundAccrued'] ?? 0) + (countsByType['RefundClaimed'] ?? 0),
          totalCallbacks: (countsByType['CallbackRegistered'] ?? 0) + (countsByType['CallbackSuccess'] ?? 0) + (countsByType['CallbackFailed'] ?? 0),
          countsByType,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
