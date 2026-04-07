import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { handleNotFoundError, handleServerError } from '../utils/errorHandler.ts';
import { getOracleTickers } from '../lib/cosmos/client.ts';

// ============================================
// BigInt Serialization
// ============================================

// Oracle decimal precision per pair (from on-chain oracle config)
const ORACLE_DECIMALS: Record<string, number> = {
  'BTC/USD': 5,
  'ETH/USD': 6,
  'SOL/USD': 8,
  'INIT/USD': 8,
  'TIA/USD': 8,
  'ATOM/USD': 8,
};

function serializeOraclePrice(price: Record<string, unknown>) {
  const pairId = price.id as string;
  const decimals = ORACLE_DECIMALS[pairId] ?? 8;
  return {
    ...price,
    nonce: String(price.nonce),
    height: String(price.height),
    timestamp: String(price.timestamp),
    decimals,
  };
}

export const priceRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * GET /prices
   * Returns all cached oracle prices.
   */
  app.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const prices = await prismaQuery.oraclePrice.findMany();

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          prices: prices.map(serializeOraclePrice),
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /prices/:pair
   * Returns a single oracle price by pair name.
   * The pair param uses dash format (e.g. "BTC-USD") and is converted to slash format ("BTC/USD") for DB lookup.
   */
  app.get('/:pair', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { pair } = request.params as { pair: string };

      if (!pair || typeof pair !== 'string') {
        return handleNotFoundError(reply, 'Price');
      }

      // Convert "BTC-USD" to "BTC/USD" for DB lookup
      const pairName = pair.replace('-', '/');

      const price = await prismaQuery.oraclePrice.findUnique({
        where: { id: pairName },
      });

      if (!price) {
        return handleNotFoundError(reply, `Price for ${pairName}`);
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: serializeOraclePrice(price),
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /prices/oracle/all-tickers
   * Returns all 16 available Slinky oracle pairs from Cosmos REST.
   */
  app.get('/oracle/all-tickers', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tickers = await getOracleTickers();

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          tickers,
          total: tickers.length,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
