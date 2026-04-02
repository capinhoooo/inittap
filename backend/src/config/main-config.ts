/**
 * Centralized configuration for the application
 * All commonly used environment variables should be defined here
 */

// Validate required environment variables on startup
const requiredEnvVars: string[] = [
  'DATABASE_URL',
  'JWT_SECRET',
  'EVM_RPC_URL',
  'OPERATOR_PRIVATE_KEY',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`FATAL: Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Production-only required variables
if (process.env.NODE_ENV === 'production') {
  const prodRequiredVars = [
    'TAPPREDICTOR_ADDRESS',
    'AGENTREGISTRY_ADDRESS',
    'COPYVAULT_ADDRESS',
    'CONNECT_ORACLE_ADDRESS',
    'TAPTOKEN_ADDRESS',
    'VIPSCORE_ADDRESS',
    'CORS_ORIGIN',
  ];
  for (const envVar of prodRequiredVars) {
    if (!process.env[envVar]) {
      console.error(`FATAL: Missing required production environment variable: ${envVar}`);
      process.exit(1);
    }
  }
}

// App Configuration
export const APP_PORT: number = Number(process.env.APP_PORT) || 3700;
export const NODE_ENV: string = process.env.NODE_ENV || 'development';
export const IS_DEV: boolean = NODE_ENV === 'development';
export const IS_PROD: boolean = NODE_ENV === 'production';

// Database
export const DATABASE_URL: string = process.env.DATABASE_URL as string;

// Authentication
export const JWT_SECRET: string = process.env.JWT_SECRET as string;
if (JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be at least 32 characters for security');
  process.exit(1);
}
export const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || '24h';

// Error Log Configuration
export const ERROR_LOG_MAX_RECORDS: number = 10000;
export const ERROR_LOG_CLEANUP_INTERVAL: string = '0 * * * *'; // Every hour

// ============================================
// EVM / Chain
// ============================================
export const EVM_RPC_URL: string = process.env.EVM_RPC_URL as string;
export const CHAIN_ID: number = Number(process.env.CHAIN_ID) || 2124225178762456;
export const OPERATOR_PRIVATE_KEY: string = process.env.OPERATOR_PRIVATE_KEY as string;

// Contract Addresses (defaults from deployments/evm-1.json)
export const TAPPREDICTOR_ADDRESS: string =
  process.env.TAPPREDICTOR_ADDRESS || '0x790080F8232a7b82321459e1BaAf8100665d9485';
export const AGENTREGISTRY_ADDRESS: string =
  process.env.AGENTREGISTRY_ADDRESS || '0x3582d890fe61189B012Be63f550d54cf6dE1F9DC';
export const COPYVAULT_ADDRESS: string =
  process.env.COPYVAULT_ADDRESS || '0x29238F71b552a5bcC772d830B867B67D37E0af5C';
export const CONNECT_ORACLE_ADDRESS: string =
  process.env.CONNECT_ORACLE_ADDRESS || '0x031ECb63480983FD216D17BB6e1d393f3816b72F';

// Worker Intervals (milliseconds)
export const ROUND_KEEPER_INTERVAL_MS: number = 2000;
export const EVENT_INDEXER_INTERVAL_MS: number = 3000;
export const ORACLE_CACHE_INTERVAL_MS: number = 5000;
export const COPY_TRADE_INTERVAL_MS: number = 5000;
export const CLAIM_EXECUTOR_INTERVAL_MS: number = 10000;
export const EVENT_INDEXER_BATCH_SIZE: number = 500;

// Round Config (mirrors contract)
export const ROUND_INTERVAL_SECONDS: number = 180;
export const ROUND_BUFFER_SECONDS: number = 120;

// Active Pairs
export const ACTIVE_PAIRS: string[] = ['BTC/USD', 'ETH/USD', 'SOL/USD'];

// Cosmos REST API
export const COSMOS_REST_URL: string = process.env.COSMOS_REST_URL || 'https://rest-evm-1.anvil.asia-southeast.initia.xyz';

// Token info
export const TAPTOKEN_ADDRESS: string = process.env.TAPTOKEN_ADDRESS || '0xE935dbf15c2418be20Ad0be81A3a2203934d8B3e';
export const TAPTOKEN_DENOM: string = 'evm/E935dbf15c2418be20Ad0be81A3a2203934d8B3e';

// VIP Score (deployed and wired to Predictor + Vault)
export const VIPSCORE_ADDRESS: string = process.env.VIPSCORE_ADDRESS || '0x02dd9E4b05Dd4a67A073EE9746192afE1FA30906';

// CORS
export const CORS_ORIGIN: string[] = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:3200', 'http://localhost:5173'];

// Freeze immutable config arrays
Object.freeze(ACTIVE_PAIRS);

// Export all as default object for convenience
export default {
  APP_PORT,
  NODE_ENV,
  IS_DEV,
  IS_PROD,
  DATABASE_URL,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  ERROR_LOG_MAX_RECORDS,
  ERROR_LOG_CLEANUP_INTERVAL,
  EVM_RPC_URL,
  CHAIN_ID,
  OPERATOR_PRIVATE_KEY,
  TAPPREDICTOR_ADDRESS,
  AGENTREGISTRY_ADDRESS,
  COPYVAULT_ADDRESS,
  CONNECT_ORACLE_ADDRESS,
  ROUND_KEEPER_INTERVAL_MS,
  EVENT_INDEXER_INTERVAL_MS,
  ORACLE_CACHE_INTERVAL_MS,
  COPY_TRADE_INTERVAL_MS,
  CLAIM_EXECUTOR_INTERVAL_MS,
  EVENT_INDEXER_BATCH_SIZE,
  ROUND_INTERVAL_SECONDS,
  ROUND_BUFFER_SECONDS,
  ACTIVE_PAIRS,
  COSMOS_REST_URL,
  TAPTOKEN_ADDRESS,
  TAPTOKEN_DENOM,
  VIPSCORE_ADDRESS,
  CORS_ORIGIN,
};
