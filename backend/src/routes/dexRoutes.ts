import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { getDexSwapSimulation, getDexSpotPrice, getDexPairs, getDexPoolInfo } from '../lib/cosmos/client.ts';
import { handleServerError } from '../utils/errorHandler.ts';

export const dexRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * GET /dex/simulate
   * Simulate a swap on InitiaDEX (L1).
   * Query: pair_denom (required), offer_denom (required), offer_amount (required)
   */
  app.get('/simulate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { pair_denom, offer_denom, offer_amount } = request.query as {
        pair_denom?: string;
        offer_denom?: string;
        offer_amount?: string;
      };

      if (!pair_denom || !offer_denom || !offer_amount) {
        return reply.code(400).send({
          success: false,
          error: { code: 'MISSING_PARAMS', message: 'pair_denom, offer_denom, and offer_amount are required.' },
          data: null,
        });
      }

      if (!/^\d+$/.test(offer_amount)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_AMOUNT', message: 'offer_amount must be a numeric string (u64).' },
          data: null,
        });
      }

      const result = await getDexSwapSimulation(pair_denom, offer_denom, offer_amount);

      if (!result) {
        return reply.code(404).send({
          success: false,
          error: { code: 'SIMULATION_FAILED', message: 'Swap simulation failed. Check pair and denom parameters.' },
          data: null,
        });
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          pairDenom: pair_denom,
          offerDenom: offer_denom,
          offerAmount: offer_amount,
          estimatedOutput: result.amountOut,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /dex/spot-price
   * Get spot price for a pair on InitiaDEX (L1).
   * Query: pair_denom (required), base_denom (required)
   */
  app.get('/spot-price', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { pair_denom, base_denom } = request.query as {
        pair_denom?: string;
        base_denom?: string;
      };

      if (!pair_denom || !base_denom) {
        return reply.code(400).send({
          success: false,
          error: { code: 'MISSING_PARAMS', message: 'pair_denom and base_denom are required.' },
          data: null,
        });
      }

      const price = await getDexSpotPrice(pair_denom, base_denom);

      if (price === null) {
        return reply.code(404).send({
          success: false,
          error: { code: 'PRICE_NOT_FOUND', message: 'Could not retrieve spot price for the given pair.' },
          data: null,
        });
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          pairDenom: pair_denom,
          baseDenom: base_denom,
          spotPrice: price,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /dex/pairs
   * Get all available DEX pairs on InitiaDEX (L1).
   * Query: limit (optional, default 100, max 255)
   */
  app.get('/pairs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { limit } = request.query as { limit?: string };
      const parsedLimit = limit ? Math.min(Math.max(parseInt(limit, 10) || 100, 1), 255) : 100;

      const pairs = await getDexPairs(parsedLimit);

      if (pairs === null) {
        return reply.code(502).send({
          success: false,
          error: { code: 'DEX_UNAVAILABLE', message: 'Could not retrieve DEX pairs from L1.' },
          data: null,
        });
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: { pairs, count: pairs.length },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /dex/pool
   * Get pool info (liquidity) for a pair on InitiaDEX (L1).
   * Query: pair_denom (required)
   */
  app.get('/pool', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { pair_denom } = request.query as { pair_denom?: string };

      if (!pair_denom) {
        return reply.code(400).send({
          success: false,
          error: { code: 'MISSING_PARAMS', message: 'pair_denom is required.' },
          data: null,
        });
      }

      const pool = await getDexPoolInfo(pair_denom);

      if (pool === null) {
        return reply.code(404).send({
          success: false,
          error: { code: 'POOL_NOT_FOUND', message: 'Could not retrieve pool info for the given pair.' },
          data: null,
        });
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: { pairDenom: pair_denom, pool },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
