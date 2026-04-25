import { Contract } from 'ethers';
import {
  TAPPREDICTOR_ADDRESS,
  AGENTREGISTRY_ADDRESS,
  COPYVAULT_ADDRESS,
  CONNECT_ORACLE_ADDRESS,
  TAPTOKEN_ADDRESS,
  VIPSCORE_ADDRESS,
} from '../../config/main-config.ts';
import { provider } from './provider.ts';
import { operatorWallet } from './signer.ts';

import TapPredictorABI from './abi/TapPredictor.json';
import AgentRegistryABI from './abi/AgentRegistry.json';
import CopyVaultABI from './abi/CopyVault.json';
import ConnectOracleABI from './abi/ConnectOracle.json';
import TapTokenABI from './abi/TapToken.json';
import VipScoreABI from './abi/VipScore.json';

/**
 * Pre-instantiated contract objects.
 *
 * Contracts connected to operatorWallet can send transactions.
 * Contracts connected to provider are read-only.
 */

// TapPredictor: connected to operatorWallet for round-keeping txs
export const tapPredictor = new Contract(TAPPREDICTOR_ADDRESS, TapPredictorABI, operatorWallet);

// TapPredictor: read-only for queries (rounds, ledger, claimable, etc.)
export const tapPredictorReadonly = new Contract(TAPPREDICTOR_ADDRESS, TapPredictorABI, provider);

// AgentRegistry: read-only from backend (registration happens on-chain via user tx)
export const agentRegistry = new Contract(AGENTREGISTRY_ADDRESS, AgentRegistryABI, provider);

// AgentRegistry: connected to operatorWallet for recordTrade calls
export const agentRegistryWrite = new Contract(AGENTREGISTRY_ADDRESS, AgentRegistryABI, operatorWallet);

// CopyVault: connected to operatorWallet for executor transactions
export const copyVault = new Contract(COPYVAULT_ADDRESS, CopyVaultABI, operatorWallet);

// CopyVault: read-only for queries
export const copyVaultReadonly = new Contract(COPYVAULT_ADDRESS, CopyVaultABI, provider);

// ConnectOracle (Slinky precompile): read-only
export const connectOracle = new Contract(CONNECT_ORACLE_ADDRESS, ConnectOracleABI, provider);

// TapToken: read-only (minting is done by TapPredictor contract)
export const tapTokenReadonly = new Contract(TAPTOKEN_ADDRESS, TapTokenABI, provider);

// VipScore: read-only (score increases are done by TapPredictor/CopyVault contracts)
// May be null if VIPSCORE_ADDRESS is empty (not yet deployed)
export const vipScoreReadonly = VIPSCORE_ADDRESS
  ? new Contract(VIPSCORE_ADDRESS, VipScoreABI, provider)
  : null;
