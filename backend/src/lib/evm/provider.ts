import { JsonRpcProvider } from 'ethers';
import { EVM_RPC_URL, CHAIN_ID } from '../../config/main-config.ts';

/**
 * Singleton JsonRpcProvider instance for all EVM read operations.
 * No WebSocket, no eth_subscribe. MiniEVM requires polling only.
 */
export const provider = new JsonRpcProvider(EVM_RPC_URL, CHAIN_ID, {
  staticNetwork: true,
  batchMaxCount: 1,
});
