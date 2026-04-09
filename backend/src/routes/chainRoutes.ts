import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { getAddress } from 'ethers';
import { CHAIN_ID, COSMOS_REST_URL } from '../config/main-config.ts';
import { evmToCosmosAddress, cosmosToEvmAddress, getNodeInfo, getBridgeParams, getModuleAccountInfo, getAllModuleAccounts } from '../lib/cosmos/client.ts';
import { tapPredictorReadonly } from '../lib/evm/contracts.ts';
import { handleServerError } from '../utils/errorHandler.ts';

// EVM address regex: 0x followed by 40 hex characters
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// Bech32 init address: init1 followed by 38 alphanumeric chars (lowercase)
const COSMOS_ADDRESS_RE = /^init1[a-z0-9]{38}$/;

export const chainRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /**
   * GET /chain/info
   * Returns chain metadata including node version info.
   */
  app.get('/info', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const nodeInfo = await getNodeInfo();

      let rollyticsStatus: Record<string, unknown> | null = null;
      let avgBlockTime: Record<string, unknown> | null = null;
      try {
        [rollyticsStatus, avgBlockTime] = await Promise.all([
          fetch('https://rollytics-api-evm-1.anvil.asia-southeast.initia.xyz/status').then(r => r.json() as Promise<Record<string, unknown>>),
          fetch('https://rollytics-api-evm-1.anvil.asia-southeast.initia.xyz/indexer/block/v1/avg_blocktime').then(r => r.json() as Promise<Record<string, unknown>>),
        ]);
      } catch {
        // Rollytics may be down, non-critical data
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          chainId: CHAIN_ID,
          networkName: 'Initia evm-1 testnet',
          cosmosRestUrl: COSMOS_REST_URL,
          explorerUrl: 'https://scan.testnet.initia.xyz/evm-1',
          nodeInfo,
          rollyticsIndexer: {
            url: 'https://rollytics-api-evm-1.anvil.asia-southeast.initia.xyz',
            status: rollyticsStatus,
            avgBlockTime,
          },
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /chain/address/:evmAddress
   * Converts an EVM hex address to bech32 cosmos address.
   */
  app.get('/address/:evmAddress', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { evmAddress } = request.params as { evmAddress: string };

      if (!evmAddress || !EVM_ADDRESS_RE.test(evmAddress)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_ADDRESS', message: 'Invalid EVM address format. Expected 0x followed by 40 hex characters.' },
          data: null,
        });
      }

      const checksummed = getAddress(evmAddress);
      const cosmosAddress = evmToCosmosAddress(checksummed);

      return reply.code(200).send({
        success: true,
        error: null,
        data: { evmAddress: checksummed, cosmosAddress },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /chain/address/from-cosmos/:cosmosAddress
   * Converts a bech32 cosmos address to EVM hex address.
   */
  app.get('/address/from-cosmos/:cosmosAddress', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { cosmosAddress } = request.params as { cosmosAddress: string };

      if (!cosmosAddress || !COSMOS_ADDRESS_RE.test(cosmosAddress)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_ADDRESS', message: 'Invalid cosmos address format. Expected bech32 address with init prefix.' },
          data: null,
        });
      }

      const evmAddress = cosmosToEvmAddress(cosmosAddress);

      return reply.code(200).send({
        success: true,
        error: null,
        data: { cosmosAddress, evmAddress },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /chain/bridge-params
   * Returns OPInit bridge parameters.
   */
  app.get('/bridge-params', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = await getBridgeParams();

      return reply.code(200).send({
        success: true,
        error: null,
        data: { params },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /chain/fee-token
   * Returns info about the chain's fee denomination.
   */
  app.get('/fee-token', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [feeDenom, bridgeParams] = await Promise.all([
        tapPredictorReadonly.feeDenom() as Promise<string>,
        getBridgeParams(),
      ]);

      const minGasPrices = (bridgeParams as { min_gas_prices?: Array<{ denom: string; amount: string }> }).min_gas_prices ?? [];
      const feeTokenInfo = minGasPrices.find(p => p.denom === feeDenom) ?? null;

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          feeDenom,
          minGasPrice: feeTokenInfo?.amount ?? 'unknown',
          allGasPrices: minGasPrices,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /chain/module-accounts
   * List all Cosmos SDK module accounts on the chain.
   */
  app.get('/module-accounts', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const modules = await getAllModuleAccounts();

      return reply.code(200).send({
        success: true,
        error: null,
        data: { modules, count: modules.length },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  /**
   * GET /chain/is-module/:address
   * Check if an address is a Cosmos SDK module account.
   * Accepts EVM (0x...) or Cosmos (init1...) address format.
   */
  app.get('/is-module/:address', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { address } = request.params as { address: string };

      if (!address) {
        return reply.code(400).send({
          success: false,
          error: { code: 'MISSING_ADDRESS', message: 'Address parameter is required.' },
          data: null,
        });
      }

      // Convert EVM address to cosmos if needed
      let cosmosAddr = address;
      if (/^0x[0-9a-fA-F]{40}$/.test(address)) {
        cosmosAddr = evmToCosmosAddress(address);
      } else if (!address.startsWith('init1')) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_ADDRESS', message: 'Expected EVM (0x...) or Cosmos (init1...) address.' },
          data: null,
        });
      }

      const result = await getModuleAccountInfo(cosmosAddr);

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          address,
          cosmosAddress: cosmosAddr,
          ...result,
        },
      });
    } catch (error) {
      return handleServerError(reply, error as Error);
    }
  });

  done();
};
