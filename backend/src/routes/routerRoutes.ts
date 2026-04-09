import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import {
  computeRoute,
  generateMessages,
  trackTransaction,
  getTransactionStatus,
  getSupportedAssets,
  getSupportedChains,
  getOpHook,
  RouterApiError,
} from '../lib/router/client.ts';
import { handleServerError } from '../utils/errorHandler.ts';

// -------------------------------------------------------------------------- validation helpers

/** Reject empty strings, undefined, null. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate that all listed keys exist in body as non-empty strings.
 * Returns the list of missing field names, or null if everything is present.
 */
function missingStringFields(
  body: Record<string, unknown> | null | undefined,
  fields: string[],
): string[] | null {
  if (!body) return fields;
  const missing = fields.filter((f) => !isNonEmptyString(body[f]));
  return missing.length > 0 ? missing : null;
}

function sendValidationError(reply: FastifyReply, missingFields: string[]): FastifyReply {
  return reply.code(400).send({
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: `Missing required fields: ${missingFields.join(', ')}`,
    },
    data: null,
  });
}

/**
 * If the upstream Router API returned a structured error, forward its status
 * and body so the client gets useful diagnostics without exposing internals.
 */
function handleRouterError(reply: FastifyReply, error: unknown): FastifyReply | Promise<FastifyReply> {
  if (error instanceof RouterApiError) {
    // Try to parse the upstream JSON for a cleaner response
    let upstreamMessage: string;
    try {
      const parsed = JSON.parse(error.responseBody) as Record<string, unknown>;
      upstreamMessage =
        (parsed.message as string) ||
        (parsed.error_message as string) ||
        error.responseBody;
    } catch {
      upstreamMessage = error.responseBody;
    }

    return reply.code(error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 502).send({
      success: false,
      error: {
        code: 'ROUTER_API_ERROR',
        message: upstreamMessage,
      },
      data: null,
    });
  }

  return handleServerError(reply, error as Error);
}

// -------------------------------------------------------------------------- routes

export const routerRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * POST /router/quote
   * Compute optimal cross-chain transfer route.
   *
   * Body: { amount_in, source_chain_id, source_denom, dest_chain_id, dest_denom }
   */
  app.post('/quote', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      const missing = missingStringFields(body, [
        'amount_in',
        'source_chain_id',
        'source_denom',
        'dest_chain_id',
        'dest_denom',
      ]);
      if (missing) return sendValidationError(reply, missing);

      const { amount_in, source_chain_id, source_denom, dest_chain_id, dest_denom } =
        body as Record<string, string>;

      const route = await computeRoute({
        amount_in,
        source_asset_chain_id: source_chain_id,
        source_asset_denom: source_denom,
        dest_asset_chain_id: dest_chain_id,
        dest_asset_denom: dest_denom,
        allow_unsafe: true,
      });

      return reply.code(200).send({
        success: true,
        error: null,
        data: route,
      });
    } catch (error) {
      return handleRouterError(reply, error);
    }
  });

  /**
   * POST /router/messages
   * Generate signable transaction messages from a route.
   *
   * Body: { amount_in, amount_out, source_chain_id, source_denom, dest_chain_id,
   *         dest_denom, address_list, operations, slippage_tolerance_percent }
   */
  app.post('/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      const missing = missingStringFields(body, [
        'amount_in',
        'amount_out',
        'source_chain_id',
        'source_denom',
        'dest_chain_id',
        'dest_denom',
        'slippage_tolerance_percent',
      ]);
      if (missing) return sendValidationError(reply, missing);

      const b = body as Record<string, unknown>;

      // Validate array fields separately
      if (!Array.isArray(b.address_list) || b.address_list.length === 0) {
        return sendValidationError(reply, ['address_list']);
      }
      if (!Array.isArray(b.operations) || b.operations.length === 0) {
        return sendValidationError(reply, ['operations']);
      }

      const msgs = await generateMessages({
        amount_in: b.amount_in as string,
        amount_out: b.amount_out as string,
        source_asset_chain_id: b.source_chain_id as string,
        source_asset_denom: b.source_denom as string,
        dest_asset_chain_id: b.dest_chain_id as string,
        dest_asset_denom: b.dest_denom as string,
        address_list: b.address_list as string[],
        operations: b.operations as unknown[],
        slippage_tolerance_percent: b.slippage_tolerance_percent as string,
      });

      return reply.code(200).send({
        success: true,
        error: null,
        data: msgs,
      });
    } catch (error) {
      return handleRouterError(reply, error);
    }
  });

  /**
   * POST /router/track
   * Register a transaction for cross-chain tracking.
   *
   * Body: { tx_hash, chain_id }
   */
  app.post('/track', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      const missing = missingStringFields(body, ['tx_hash', 'chain_id']);
      if (missing) return sendValidationError(reply, missing);

      const { tx_hash, chain_id } = body as Record<string, string>;

      const result = await trackTransaction({ tx_hash, chain_id });

      return reply.code(200).send({
        success: true,
        error: null,
        data: result,
      });
    } catch (error) {
      return handleRouterError(reply, error);
    }
  });

  /**
   * GET /router/status/:txHash
   * Get cross-chain transfer status.
   *
   * Query: chain_id (required)
   */
  app.get('/status/:txHash', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { txHash } = request.params as { txHash: string };
      const { chain_id } = request.query as { chain_id?: string };

      if (!isNonEmptyString(txHash)) {
        return sendValidationError(reply, ['txHash']);
      }
      if (!isNonEmptyString(chain_id)) {
        return sendValidationError(reply, ['chain_id']);
      }

      const status = await getTransactionStatus(txHash, chain_id);

      return reply.code(200).send({
        success: true,
        error: null,
        data: status,
      });
    } catch (error) {
      return handleRouterError(reply, error);
    }
  });

  /**
   * GET /router/assets
   * Get supported assets for given chains.
   *
   * Query: chain_ids (comma-separated, e.g. "evm-1,initiation-2")
   */
  app.get('/assets', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { chain_ids } = request.query as { chain_ids?: string };

      if (!isNonEmptyString(chain_ids)) {
        return sendValidationError(reply, ['chain_ids']);
      }

      // Split, trim, and filter empty segments
      const chainIdList = chain_ids
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      if (chainIdList.length === 0) {
        return sendValidationError(reply, ['chain_ids']);
      }

      const assets = await getSupportedAssets(chainIdList);

      return reply.code(200).send({
        success: true,
        error: null,
        data: assets,
      });
    } catch (error) {
      return handleRouterError(reply, error);
    }
  });

  /**
   * GET /router/chains
   * Returns all supported chains from the Router API.
   */
  app.get('/chains', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const chains = await getSupportedChains();

      return reply.code(200).send({
        success: true,
        error: null,
        data: chains,
      });
    } catch (error) {
      return handleRouterError(reply, error);
    }
  });

  /**
   * POST /router/op-hook
   * Get OP hook data needed when route requires op_hook (L1-to-L2 deposits).
   * Required when computeRoute returns required_op_hook: true.
   */
  app.post('/op-hook', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      const missing = missingStringFields(body, [
        'source_address',
        'source_asset_chain_id',
        'source_asset_denom',
        'dest_address',
        'dest_asset_chain_id',
        'dest_asset_denom',
      ]);
      if (missing) {
        return reply.code(400).send({
          success: false,
          error: { code: 'MISSING_FIELDS', message: `Missing required fields: ${missing.join(', ')}` },
          data: null,
        });
      }

      const result = await getOpHook(body as {
        source_address: string;
        source_asset_chain_id: string;
        source_asset_denom: string;
        dest_address: string;
        dest_asset_chain_id: string;
        dest_asset_denom: string;
      });

      return reply.code(200).send({ success: true, error: null, data: result });
    } catch (error) {
      if (error instanceof RouterApiError) {
        const status = error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 502;
        return reply.code(status).send({ success: false, error: { code: 'ROUTER_API_ERROR', message: error.message }, data: null });
      }
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
