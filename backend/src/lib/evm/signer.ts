import { Wallet, NonceManager } from 'ethers';
import { OPERATOR_PRIVATE_KEY } from '../../config/main-config.ts';
import { provider } from './provider.ts';

/**
 * Operator wallet used for round-keeping and copy-trade execution.
 * Wrapped with NonceManager to prevent nonce collisions when multiple
 * workers send transactions concurrently (ADR-005).
 */
const baseWallet = new Wallet(OPERATOR_PRIVATE_KEY, provider);
export const operatorWallet = new NonceManager(baseWallet);
