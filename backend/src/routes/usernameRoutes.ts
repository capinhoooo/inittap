import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { getAddress } from 'ethers';
import { resolveUsername, resolveAddressToUsername, evmToCosmosAddress, cosmosToEvmAddress } from '../lib/cosmos/client.ts';
import { handleServerError } from '../utils/errorHandler.ts';

// Validation patterns
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const COSMOS_ADDRESS_RE = /^init1[a-z0-9]{38}$/;
// Usernames: alphanumeric + underscores, reasonable length
const USERNAME_RE = /^[a-zA-Z0-9_]{1,64}$/;

export const usernameRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * GET /usernames/resolve/:username
   * Resolve an Initia username to EVM + cosmos addresses.
   */
  app.get('/resolve/:username', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { username } = request.params as { username: string };

      if (!username || !USERNAME_RE.test(username)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_USERNAME', message: 'Invalid username format. Expected 1-64 alphanumeric characters or underscores.' },
          data: null,
        });
      }

      const moveAddress = await resolveUsername(username);

      if (!moveAddress) {
        return reply.code(200).send({
          success: true,
          error: null,
          data: { username, found: false },
        });
      }

      // The Move module returns a 20-byte hex address; checksum it for EVM
      let evmAddress: string;
      try {
        evmAddress = getAddress(moveAddress);
      } catch {
        evmAddress = moveAddress;
      }

      const cosmosAddress = evmToCosmosAddress(evmAddress);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          username,
          address: evmAddress,
          cosmosAddress,
          found: true,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /usernames/lookup/:address
   * Look up the Initia username for an EVM address.
   */
  app.get('/lookup/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };

      if (!address || !EVM_ADDRESS_RE.test(address)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_ADDRESS', message: 'Invalid EVM address format. Expected 0x followed by 40 hex characters.' },
          data: null,
        });
      }

      const username = await resolveAddressToUsername(address);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          address: getAddress(address),
          username,
          found: username !== null,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /usernames/lookup/cosmos/:cosmosAddress
   * Look up the Initia username for a cosmos bech32 address.
   */
  app.get('/lookup/cosmos/:cosmosAddress', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { cosmosAddress } = request.params as { cosmosAddress: string };

      if (!cosmosAddress || !COSMOS_ADDRESS_RE.test(cosmosAddress)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_ADDRESS', message: 'Invalid cosmos address format. Expected bech32 address with init1 prefix.' },
          data: null,
        });
      }

      const username = await resolveAddressToUsername(cosmosAddress);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          cosmosAddress,
          username,
          found: username !== null,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
