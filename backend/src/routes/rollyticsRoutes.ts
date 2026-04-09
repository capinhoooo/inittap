import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import {
  getRollyticsStatus,
  getRollyticsAccountTxs,
  getRollyticsRichList,
  getRollyticsAvgBlockTime,
  getRollyticsBlocks,
  getRollyticsBlockByHeight,
  getRollyticsTxByHash,
  getRollyticsTxsByHeight,
  getRollyticsEvmTxs,
  getRollyticsEvmTxsByAccount,
  getRollyticsEvmTxByHash,
  getRollyticsEvmTxsByHeight,
} from '../lib/cosmos/client.ts';
import { handleServerError } from '../utils/errorHandler.ts';

// EVM address: 0x + 40 hex chars
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// Block height: positive integer
const BLOCK_HEIGHT_RE = /^\d+$/;

// Cosmos tx hash: 64 hex chars (no 0x prefix)
const TX_HASH_RE = /^[0-9a-fA-F]{64}$/;

export const rollyticsRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * GET /rollytics/status
   * Returns Rollytics indexer status (chain_id, height, version).
   */
  app.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = await getRollyticsStatus();

      return reply.code(200).send({
        success: true,
        error: null,
        data: status,
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /rollytics/txs/:account
   * Get paginated transactions for an account.
   * Query: limit (default 20, max 100), offset (default 0)
   */
  app.get('/txs/:account', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { account } = request.params as { account: string };

      if (!account || !EVM_ADDRESS_RE.test(account)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_ADDRESS', message: 'Invalid EVM address format. Expected 0x followed by 40 hex characters.' },
          data: null,
        });
      }

      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      const result = await getRollyticsAccountTxs(account, limit, offset);

      return reply.code(200).send({
        success: true,
        error: null,
        data: result,
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /rollytics/richlist/:denom
   * Get token holder rankings for a denom.
   * Query: limit (default 50, max 100)
   */
  app.get('/richlist/:denom', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { denom } = request.params as { denom: string };

      if (!denom || denom.length === 0 || denom.length > 256) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_DENOM', message: 'Invalid denom parameter.' },
          data: null,
        });
      }

      const query = request.query as { limit?: string };
      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);

      const result = await getRollyticsRichList(denom, limit);

      return reply.code(200).send({
        success: true,
        error: null,
        data: result,
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /rollytics/block-time
   * Get average block time from the Rollytics indexer.
   */
  app.get('/block-time', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await getRollyticsAvgBlockTime();

      return reply.code(200).send({
        success: true,
        error: null,
        data: result,
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /rollytics/blocks
   * Get paginated recent blocks with proposer info, gas usage, tx count.
   * Query: limit (default 20, max 100), offset (default 0)
   */
  app.get('/blocks', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      const result = await getRollyticsBlocks(limit, offset);

      return reply.code(200).send({
        success: true,
        error: null,
        data: result,
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /rollytics/blocks/:height
   * Get a single block by height.
   * Param: height (must be a positive integer string)
   */
  app.get('/blocks/:height', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { height } = request.params as { height: string };

      if (!height || !BLOCK_HEIGHT_RE.test(height) || Number(height) <= 0) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_HEIGHT', message: 'Invalid block height. Expected a positive integer.' },
          data: null,
        });
      }

      const result = await getRollyticsBlockByHeight(height);

      return reply.code(200).send({
        success: true,
        error: null,
        data: result,
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /rollytics/tx/:txHash
   * Get a single transaction by hash.
   * Param: txHash (64 hex chars, no 0x prefix)
   */
  app.get('/tx/:txHash', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { txHash } = request.params as { txHash: string };

      if (!txHash || !TX_HASH_RE.test(txHash)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_TX_HASH', message: 'Invalid transaction hash. Expected 64 hex characters without 0x prefix.' },
          data: null,
        });
      }

      const result = await getRollyticsTxByHash(txHash);

      return reply.code(200).send({
        success: true,
        error: null,
        data: result,
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /rollytics/txs-by-height/:height
   * Get transactions at a specific block height.
   * Param: height (must be a positive integer string)
   * Query: limit (default 20, max 100), offset (default 0)
   */
  app.get('/txs-by-height/:height', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { height } = request.params as { height: string };

      if (!height || !BLOCK_HEIGHT_RE.test(height) || Number(height) <= 0) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_HEIGHT', message: 'Invalid block height. Expected a positive integer.' },
          data: null,
        });
      }

      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      const result = await getRollyticsTxsByHeight(height, limit, offset);

      return reply.code(200).send({
        success: true,
        error: null,
        data: result,
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /rollytics/evm-txs
   * Paginated EVM transaction receipts.
   * Query: limit (default 20, max 100), offset (default 0)
   */
  app.get('/evm-txs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      const result = await getRollyticsEvmTxs(limit, offset);

      return reply.code(200).send({ success: true, error: null, data: result });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /rollytics/evm-txs/account/:account
   * EVM transactions for a specific account.
   * Query: limit, offset, is_signer (boolean, default false)
   */
  app.get('/evm-txs/account/:account', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { account } = request.params as { account: string };

      if (!account || !EVM_ADDRESS_RE.test(account)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_ADDRESS', message: 'Invalid EVM address format. Expected 0x followed by 40 hex characters.' },
          data: null,
        });
      }

      const query = request.query as { limit?: string; offset?: string; is_signer?: string };
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);
      const isSigner = query.is_signer === 'true';

      const result = await getRollyticsEvmTxsByAccount(account, limit, offset, isSigner);

      return reply.code(200).send({ success: true, error: null, data: result });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /rollytics/evm-tx/:txHash
   * Single EVM transaction receipt by hash.
   */
  app.get('/evm-tx/:txHash', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { txHash } = request.params as { txHash: string };

      if (!txHash || !TX_HASH_RE.test(txHash)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_TX_HASH', message: 'Invalid transaction hash. Expected 64 hex characters.' },
          data: null,
        });
      }

      const result = await getRollyticsEvmTxByHash(txHash);

      return reply.code(200).send({ success: true, error: null, data: result });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /rollytics/evm-txs-by-height/:height
   * EVM transactions at a specific block height.
   * Query: limit, offset
   */
  app.get('/evm-txs-by-height/:height', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { height } = request.params as { height: string };

      if (!height || !BLOCK_HEIGHT_RE.test(height) || Number(height) <= 0) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_HEIGHT', message: 'Invalid block height. Must be a positive integer.' },
          data: null,
        });
      }

      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      const result = await getRollyticsEvmTxsByHeight(height, limit, offset);

      return reply.code(200).send({ success: true, error: null, data: result });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
