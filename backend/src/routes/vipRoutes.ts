import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { getAddress } from 'ethers';
import { VIPSCORE_ADDRESS } from '../config/main-config.ts';
import { vipScoreReadonly, tapPredictorReadonly } from '../lib/evm/contracts.ts';
import { handleServerError } from '../utils/errorHandler.ts';

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const vipRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * GET /vip/status
   * Returns whether VipScore contract is deployed and its current stage.
   */
  app.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!vipScoreReadonly) {
        return reply.code(200).send({
          success: true,
          error: null,
          data: { enabled: false, message: 'VipScore contract not yet deployed' },
        });
      }

      const currentStage = await vipScoreReadonly.initStage() as bigint;

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          enabled: true,
          address: VIPSCORE_ADDRESS,
          currentStage: String(currentStage),
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /vip/score/:address
   * Returns the VIP score for a given address at the current stage.
   */
  app.get('/score/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };

      if (!address || !EVM_ADDRESS_RE.test(address)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_ADDRESS', message: 'Invalid EVM address format.' },
          data: null,
        });
      }

      if (!vipScoreReadonly) {
        return reply.code(200).send({
          success: true,
          error: null,
          data: { score: '0', message: 'VipScore not deployed' },
        });
      }

      const checksummed = getAddress(address);
      const stage = await tapPredictorReadonly.vipStage() as bigint;
      const result = await vipScoreReadonly.scores(stage, checksummed) as { isIndexed: boolean; amount: bigint };

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          address: checksummed,
          stage: String(stage),
          score: String(result.amount),
          isIndexed: result.isIndexed,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /vip/leaderboard
   * Returns paginated VIP score leaderboard for the current stage.
   */
  app.get('/leaderboard', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!vipScoreReadonly) {
        return reply.code(200).send({
          success: true,
          error: null,
          data: { leaderboard: [], stage: '0' },
        });
      }

      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      const stage = await tapPredictorReadonly.vipStage() as bigint;
      const entries = await vipScoreReadonly.getScores(stage, offset, limit) as Array<{ addr: string; amount: bigint; index: bigint }>;

      const leaderboard = entries.map((entry) => ({
        address: entry.addr,
        score: String(entry.amount),
        index: String(entry.index),
      }));

      return reply.code(200).send({
        success: true,
        error: null,
        data: { leaderboard, stage: String(stage) },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /vip/config
   * Returns VIP-related configuration from the TapPredictor contract.
   */
  app.get('/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [vipHookEnabled, vipStage, vipScoreAddress] = await Promise.all([
        tapPredictorReadonly.vipHookEnabled() as Promise<boolean>,
        tapPredictorReadonly.vipStage() as Promise<bigint>,
        tapPredictorReadonly.vipScore() as Promise<string>,
      ]);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          vipHookEnabled,
          vipStage: String(vipStage),
          vipScoreAddress,
          contractAddress: VIPSCORE_ADDRESS,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
