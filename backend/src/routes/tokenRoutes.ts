import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { getAddress } from 'ethers';
import { TAPTOKEN_ADDRESS, TAPTOKEN_DENOM } from '../config/main-config.ts';
import { tapTokenReadonly } from '../lib/evm/contracts.ts';
import { evmToCosmosAddress, getTokenSupply, getCosmosDenomBalance, erc20ToDenom, denomToErc20 } from '../lib/cosmos/client.ts';
import { handleServerError } from '../utils/errorHandler.ts';

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const tokenRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * GET /token/info
   * Returns TAP token metadata read from the on-chain contract.
   */
  app.get('/info', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [name, symbol, totalSupply, minter, cosmosLocked] = await Promise.all([
        tapTokenReadonly.name() as Promise<string>,
        tapTokenReadonly.symbol() as Promise<string>,
        tapTokenReadonly.totalSupply() as Promise<bigint>,
        tapTokenReadonly.minter() as Promise<string>,
        tapTokenReadonly.cosmosLocked() as Promise<bigint>,
      ]);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          name,
          symbol,
          totalSupply: String(totalSupply),
          minter,
          cosmosLocked: String(cosmosLocked),
          address: TAPTOKEN_ADDRESS,
          cosmosDenom: TAPTOKEN_DENOM,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /token/supply
   * Returns both EVM and Cosmos bank supply for TAP token.
   */
  app.get('/supply', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [evmSupplyRaw, cosmosSupply] = await Promise.all([
        tapTokenReadonly.totalSupply() as Promise<bigint>,
        getTokenSupply(TAPTOKEN_DENOM),
      ]);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          evmSupply: String(evmSupplyRaw),
          cosmosSupply,
          denom: TAPTOKEN_DENOM,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /token/balance/:address
   * Returns TAP token balance for an address on both EVM and Cosmos sides.
   */
  app.get('/balance/:address', async (request: FastifyRequest, reply: FastifyReply) => {
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
      const cosmosAddress = evmToCosmosAddress(checksummed);

      const [evmBalanceRaw, cosmosBalance] = await Promise.all([
        tapTokenReadonly.balanceOf(checksummed) as Promise<bigint>,
        getCosmosDenomBalance(cosmosAddress, TAPTOKEN_DENOM),
      ]);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          evmBalance: String(evmBalanceRaw),
          cosmosBalance,
          address: checksummed,
          cosmosAddress,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /token/resolve/denom/:denom
   * Resolves a Cosmos denom to its ERC20 contract address on MiniEVM.
   */
  app.get('/resolve/denom/:denom', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { denom } = request.params as { denom: string };

      if (!denom) {
        return reply.code(400).send({
          success: false,
          error: { code: 'MISSING_DENOM', message: 'denom parameter is required.' },
          data: null,
        });
      }

      const address = await denomToErc20(denom);

      if (!address) {
        return reply.code(404).send({
          success: false,
          error: { code: 'DENOM_NOT_FOUND', message: 'No ERC20 contract found for this denom.' },
          data: null,
        });
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: { denom, erc20Address: address },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /token/resolve/address/:address
   * Resolves an ERC20 contract address to its Cosmos denom on MiniEVM.
   */
  app.get('/resolve/address/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };

      if (!address || !EVM_ADDRESS_RE.test(address)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_ADDRESS', message: 'Invalid EVM address format.' },
          data: null,
        });
      }

      const denom = await erc20ToDenom(address);

      if (!denom) {
        return reply.code(404).send({
          success: false,
          error: { code: 'ADDRESS_NOT_FOUND', message: 'No Cosmos denom found for this ERC20 address.' },
          data: null,
        });
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: { erc20Address: address, denom },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
