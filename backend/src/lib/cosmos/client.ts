import { COSMOS_REST_URL } from '../../config/main-config.ts';
import { bech32 } from 'bech32';

// ============================================
// Fetch with Timeout
// ============================================

const FETCH_TIMEOUT_MS = 10_000;

function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ============================================
// Initia L1 Username Resolution (Move module)
// ============================================

/** Initia L1 REST for username queries (usernames live on L1, not the rollup) */
const INITIA_L1_REST = 'https://rest.testnet.initia.xyz';

/** Module address that owns the usernames Move module on L1 */
const USERNAME_MODULE_ADDRESS = '0x42cd8467b1c86e59bf319e5664a09b6b5840bb3fac64f5ce690b5041c530565a';

// ============================================
// Rollytics Indexer API (evm-1 rollup)
// ============================================

const ROLLYTICS_API = 'https://rollytics-api-evm-1.anvil.asia-southeast.initia.xyz';

/**
 * Convert an EVM hex address to Initia bech32 cosmos address.
 * Deterministic 1:1 mapping used by Initia MiniEVM.
 */
export function evmToCosmosAddress(evmAddress: string): string {
  const hex = evmAddress.replace('0x', '').toLowerCase();
  const bytes = Buffer.from(hex, 'hex');
  const words = bech32.toWords(bytes);
  return bech32.encode('init', words);
}

/**
 * Convert an Initia bech32 cosmos address to EVM hex address.
 */
export function cosmosToEvmAddress(cosmosAddress: string): string {
  const decoded = bech32.decode(cosmosAddress);
  const bytes = Buffer.from(bech32.fromWords(decoded.words));
  return '0x' + bytes.toString('hex');
}

/**
 * Get token supply via Cosmos bank module.
 */
export async function getTokenSupply(denom: string): Promise<string> {
  const res = await fetchWithTimeout(`${COSMOS_REST_URL}/cosmos/bank/v1beta1/supply/by_denom?denom=${encodeURIComponent(denom)}`);
  if (!res.ok) throw new Error(`Cosmos REST error: ${res.status}`);
  const data = await res.json() as { amount?: { amount?: string } };
  return data.amount?.amount ?? '0';
}

/**
 * Get all balances for a cosmos address.
 */
export async function getCosmosBalances(cosmosAddress: string): Promise<Array<{ denom: string; amount: string }>> {
  const res = await fetchWithTimeout(`${COSMOS_REST_URL}/cosmos/bank/v1beta1/balances/${cosmosAddress}`);
  if (!res.ok) throw new Error(`Cosmos REST error: ${res.status}`);
  const data = await res.json() as { balances?: Array<{ denom: string; amount: string }> };
  return data.balances ?? [];
}

/**
 * Get balance for a specific denom.
 */
export async function getCosmosDenomBalance(cosmosAddress: string, denom: string): Promise<string> {
  const res = await fetchWithTimeout(`${COSMOS_REST_URL}/cosmos/bank/v1beta1/balances/${cosmosAddress}/by_denom?denom=${encodeURIComponent(denom)}`);
  if (!res.ok) throw new Error(`Cosmos REST error: ${res.status}`);
  const data = await res.json() as { balance?: { amount?: string } };
  return data.balance?.amount ?? '0';
}

/**
 * Get all oracle tickers from Slinky via Cosmos REST.
 * Returns 16 pairs: APT, ARB, ATOM, BERA, BNB, BTC, ENA, ETH, NTRN, OSMO, SOL, SUI, TIA, USDC, USDT + TIMESTAMP
 */
export async function getOracleTickers(): Promise<Array<{ pair: string; price: string; blockHeight: string }>> {
  const res = await fetchWithTimeout(`${COSMOS_REST_URL}/connect/oracle/v2/get_all_tickers`);
  if (!res.ok) throw new Error(`Cosmos REST error: ${res.status}`);
  const data = await res.json() as { tickers?: Array<{ currency_pair: { Base: string; Quote: string }; price: string; block_height: string }> };
  return (data.tickers ?? []).map(t => ({
    pair: `${t.currency_pair.Base}/${t.currency_pair.Quote}`,
    price: t.price,
    blockHeight: t.block_height,
  }));
}

/**
 * Get OPInit bridge parameters.
 */
export async function getBridgeParams(): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(`${COSMOS_REST_URL}/opinit/opchild/v1/params`);
  if (!res.ok) throw new Error(`Cosmos REST error: ${res.status}`);
  const data = await res.json() as { params: Record<string, unknown> };
  return data.params;
}

/**
 * Get node/chain info.
 */
export async function getNodeInfo(): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(`${COSMOS_REST_URL}/cosmos/base/tendermint/v1beta1/node_info`);
  if (!res.ok) throw new Error(`Cosmos REST error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}

// ============================================
// BCS Encoding Helpers (for Move view calls)
// ============================================

/**
 * BCS-encode a string: ULEB128 length prefix + UTF-8 bytes, then base64.
 */
function bcsEncodeString(value: string): string {
  const utf8 = Buffer.from(value, 'utf-8');
  const lengthBytes: number[] = [];
  let len = utf8.length;
  while (len > 0x7f) {
    lengthBytes.push((len & 0x7f) | 0x80);
    len >>= 7;
  }
  lengthBytes.push(len);

  const result = Buffer.concat([Buffer.from(lengthBytes), utf8]);
  return result.toString('base64');
}

/**
 * BCS-encode a Move address: 32 bytes (left-padded with zeros), then base64.
 * Accepts 0x-prefixed hex (20-byte EVM) or init1... (bech32) formats.
 */
function bcsEncodeAddress(address: string): string {
  let hex: string;
  if (address.startsWith('0x') || address.startsWith('0X')) {
    hex = address.slice(2).toLowerCase();
  } else if (address.startsWith('init1')) {
    const decoded = bech32.decode(address);
    const bytes = Buffer.from(bech32.fromWords(decoded.words));
    hex = bytes.toString('hex');
  } else {
    hex = address.toLowerCase();
  }

  // Pad to 32 bytes (64 hex chars) for Move address format
  const padded = hex.padStart(64, '0');
  return Buffer.from(padded, 'hex').toString('base64');
}

/**
 * BCS-encode a u64 value: 8 bytes little-endian, then base64.
 */
function bcsEncodeU64(value: number | bigint | string): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf.toString('base64');
}

/**
 * BCS-encode Option::None for Move.
 */
const BCS_OPTION_NONE = 'AA==';

/**
 * BCS-encode Option::Some(string) for Move.
 */
function bcsEncodeOptionString(value: string | null): string {
  if (value === null) return BCS_OPTION_NONE;
  const utf8 = Buffer.from(value, 'utf-8');
  const lengthBytes: number[] = [];
  let len = utf8.length;
  while (len > 0x7f) {
    lengthBytes.push((len & 0x7f) | 0x80);
    len >>= 7;
  }
  lengthBytes.push(len);
  return Buffer.concat([Buffer.from([0x01]), Buffer.from(lengthBytes), utf8]).toString('base64');
}

// ============================================
// Initia Username Resolution
// ============================================

/**
 * Resolve an Initia username to an address via L1 Move view call.
 * Returns the Move address (0x-prefixed hex) or null if not found.
 */
export async function resolveUsername(username: string): Promise<string | null> {
  const res = await fetchWithTimeout(`${INITIA_L1_REST}/initia/move/v1/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: USERNAME_MODULE_ADDRESS,
      module_name: 'usernames',
      function_name: 'get_address_from_name',
      type_args: [],
      args: [bcsEncodeString(username)],
    }),
  });

  if (!res.ok) return null;

  const data = await res.json() as { data?: string };
  if (!data.data) return null;

  // Response format: "\"0x212366f82f0af3ac8782dfa7a203127106ede1cf\""
  const addr = data.data.replace(/"/g, '');
  if (!addr || addr === '0x' || addr === '0x0000000000000000000000000000000000000000') return null;

  return addr;
}

/**
 * Resolve a cosmos/EVM address to an Initia username via L1 Move view call.
 * Returns the username string or null if not found.
 */
export async function resolveAddressToUsername(address: string): Promise<string | null> {
  const encoded = bcsEncodeAddress(address);

  const res = await fetchWithTimeout(`${INITIA_L1_REST}/initia/move/v1/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: USERNAME_MODULE_ADDRESS,
      module_name: 'usernames',
      function_name: 'get_name_from_address',
      type_args: [],
      args: [encoded],
    }),
  });

  if (!res.ok) return null;

  const data = await res.json() as { data?: string };
  if (!data.data) return null;

  // Response format: "\"initia\""
  const name = data.data.replace(/"/g, '');
  if (!name) return null;

  return name;
}

// ============================================
// Rollytics Indexer API
// ============================================

/**
 * Get Rollytics indexer status (chain_id, height, version).
 */
export async function getRollyticsStatus(): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(`${ROLLYTICS_API}/status`);
  if (!res.ok) throw new Error(`Rollytics error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}

/**
 * Get account transactions from Rollytics indexer.
 */
export async function getRollyticsAccountTxs(
  account: string,
  limit: number = 20,
  offset: number = 0,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    'pagination.limit': String(limit),
    'pagination.offset': String(offset),
    'pagination.count_total': 'true',
    'pagination.reverse': 'true',
  });
  const res = await fetchWithTimeout(`${ROLLYTICS_API}/indexer/tx/v1/txs/by_account/${account}?${params}`);
  if (!res.ok) throw new Error(`Rollytics error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}

/**
 * Get token rich list from Rollytics indexer.
 */
export async function getRollyticsRichList(
  denom: string,
  limit: number = 50,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    'pagination.limit': String(limit),
    'pagination.count_total': 'true',
  });
  const res = await fetchWithTimeout(`${ROLLYTICS_API}/indexer/richlist/v1/${encodeURIComponent(denom)}?${params}`);
  if (!res.ok) throw new Error(`Rollytics error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}

/**
 * Get average block time from Rollytics indexer.
 */
export async function getRollyticsAvgBlockTime(): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(`${ROLLYTICS_API}/indexer/block/v1/avg_blocktime`);
  if (!res.ok) throw new Error(`Rollytics error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}

/**
 * Get paginated blocks from Rollytics indexer.
 */
export async function getRollyticsBlocks(
  limit: number = 20,
  offset: number = 0,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    'pagination.limit': String(limit),
    'pagination.offset': String(offset),
    'pagination.count_total': 'true',
    'pagination.reverse': 'true',
  });
  const res = await fetchWithTimeout(`${ROLLYTICS_API}/indexer/block/v1/blocks?${params}`);
  if (!res.ok) throw new Error(`Rollytics error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}

/**
 * Get a single block by height from Rollytics indexer.
 */
export async function getRollyticsBlockByHeight(height: string): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(`${ROLLYTICS_API}/indexer/block/v1/blocks/${height}`);
  if (!res.ok) throw new Error(`Rollytics error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}

/**
 * Get a single transaction by hash from Rollytics indexer.
 */
export async function getRollyticsTxByHash(txHash: string): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(`${ROLLYTICS_API}/indexer/tx/v1/txs/${txHash}`);
  if (!res.ok) throw new Error(`Rollytics error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}

/**
 * Get transactions at a specific block height from Rollytics indexer.
 */
export async function getRollyticsTxsByHeight(
  height: string,
  limit: number = 20,
  offset: number = 0,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    'pagination.limit': String(limit),
    'pagination.offset': String(offset),
    'pagination.count_total': 'true',
  });
  const res = await fetchWithTimeout(`${ROLLYTICS_API}/indexer/tx/v1/txs/by_height/${height}?${params}`);
  if (!res.ok) throw new Error(`Rollytics error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}

// ============================================
// Module Account Detection
// ============================================

/**
 * Check if an address is a Cosmos SDK module account.
 * Uses the Cosmos auth REST endpoint to check account type.
 * Returns the module name if it is a module account, null otherwise.
 */
export async function getModuleAccountInfo(cosmosAddress: string): Promise<{ isModule: boolean; moduleName: string | null; permissions: string[] }> {
  try {
    const res = await fetchWithTimeout(`${COSMOS_REST_URL}/cosmos/auth/v1beta1/accounts/${cosmosAddress}`);
    if (!res.ok) return { isModule: false, moduleName: null, permissions: [] };
    const data = await res.json() as { account?: { '@type'?: string; name?: string; permissions?: string[] } };
    const account = data.account;
    if (account && account['@type'] === '/cosmos.auth.v1beta1.ModuleAccount') {
      return {
        isModule: true,
        moduleName: account.name ?? null,
        permissions: account.permissions ?? [],
      };
    }
    return { isModule: false, moduleName: null, permissions: [] };
  } catch {
    return { isModule: false, moduleName: null, permissions: [] };
  }
}

/**
 * Get all module accounts on the chain.
 */
export async function getAllModuleAccounts(): Promise<Array<{ name: string; address: string; permissions: string[] }>> {
  const res = await fetchWithTimeout(`${COSMOS_REST_URL}/cosmos/auth/v1beta1/module_accounts`);
  if (!res.ok) throw new Error(`Cosmos REST error: ${res.status}`);
  const data = await res.json() as { accounts?: Array<{ '@type'?: string; name?: string; base_account?: { address?: string }; permissions?: string[] }> };
  return (data.accounts ?? [])
    .filter(a => a['@type'] === '/cosmos.auth.v1beta1.ModuleAccount')
    .map(a => ({
      name: a.name ?? '',
      address: a.base_account?.address ?? '',
      permissions: a.permissions ?? [],
    }));
}

// ============================================
// InitiaDEX (L1 DEX via Move view calls)
// ============================================

/**
 * Simulate a swap on InitiaDEX.
 * Calls get_swap_simulation_by_denom view function on L1.
 * @param pairDenom - LP token denom (e.g. "move/2100c45180179ce8a08ca8299cd8eee38324fab1a4a23991632b7abf0bb774dc")
 * @param offerDenom - token to swap from (e.g. "uinit")
 * @param offerAmount - amount in smallest unit (u64)
 */
export async function getDexSwapSimulation(
  pairDenom: string,
  offerDenom: string,
  offerAmount: string,
): Promise<{ amountOut: string } | null> {
  const res = await fetchWithTimeout(`${INITIA_L1_REST}/initia/move/v1/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: '0x1',
      module_name: 'dex',
      function_name: 'get_swap_simulation_by_denom',
      type_args: [],
      args: [
        bcsEncodeString(pairDenom),
        bcsEncodeString(offerDenom),
        bcsEncodeU64(offerAmount),
      ],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as { data?: string };
  if (!data.data) return null;

  try {
    const parsed = JSON.parse(data.data);
    return { amountOut: String(parsed) };
  } catch {
    return null;
  }
}

/**
 * Get spot price from InitiaDEX.
 * Calls get_spot_price_by_denom view function on L1.
 */
export async function getDexSpotPrice(
  pairDenom: string,
  baseDenom: string,
): Promise<string | null> {
  const res = await fetchWithTimeout(`${INITIA_L1_REST}/initia/move/v1/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: '0x1',
      module_name: 'dex',
      function_name: 'get_spot_price_by_denom',
      type_args: [],
      args: [
        bcsEncodeString(pairDenom),
        bcsEncodeString(baseDenom),
      ],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as { data?: string };
  if (!data.data) return null;

  try {
    return JSON.parse(data.data) as string;
  } catch {
    return null;
  }
}

/**
 * Get all DEX pairs from InitiaDEX.
 * Calls get_all_pairs_by_denom view function on L1.
 * @param limit - max pairs to return (u8, max 255)
 */
export async function getDexPairs(limit: number = 100): Promise<unknown[] | null> {
  const bcsLimit = Buffer.from([Math.min(limit, 255)]).toString('base64');

  const res = await fetchWithTimeout(`${INITIA_L1_REST}/initia/move/v1/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: '0x1',
      module_name: 'dex',
      function_name: 'get_all_pairs_by_denom',
      type_args: [],
      args: [BCS_OPTION_NONE, BCS_OPTION_NONE, BCS_OPTION_NONE, bcsLimit],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as { data?: string };
  if (!data.data) return null;

  try {
    return JSON.parse(data.data) as unknown[];
  } catch {
    return null;
  }
}

/**
 * Get pool info (liquidity) from InitiaDEX.
 */
export async function getDexPoolInfo(pairDenom: string): Promise<Record<string, string> | null> {
  const res = await fetchWithTimeout(`${INITIA_L1_REST}/initia/move/v1/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: '0x1',
      module_name: 'dex',
      function_name: 'get_pool_info_by_denom',
      type_args: [],
      args: [bcsEncodeString(pairDenom)],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as { data?: string };
  if (!data.data) return null;

  try {
    return JSON.parse(data.data) as Record<string, string>;
  } catch {
    return null;
  }
}

// ============================================
// MiniEVM Denom-ERC20 Resolution
// ============================================

/**
 * Resolve an ERC20 contract address to its Cosmos denom.
 * Uses MiniEVM REST: GET /minievm/evm/v1/denoms/{contract_address}
 */
export async function erc20ToDenom(contractAddress: string): Promise<string | null> {
  const res = await fetchWithTimeout(`${COSMOS_REST_URL}/minievm/evm/v1/denoms/${contractAddress}`);
  if (!res.ok) return null;
  const data = await res.json() as { denom?: string };
  return data.denom ?? null;
}

/**
 * Resolve a Cosmos denom to its ERC20 contract address.
 * Uses MiniEVM REST: GET /minievm/evm/v1/contracts/by_denom?denom=...
 * Only works for evm/* prefixed denoms.
 */
export async function denomToErc20(denom: string): Promise<string | null> {
  const res = await fetchWithTimeout(`${COSMOS_REST_URL}/minievm/evm/v1/contracts/by_denom?denom=${encodeURIComponent(denom)}`);
  if (!res.ok) return null;
  const data = await res.json() as { address?: string };
  return data.address ?? null;
}

// ============================================
// Rollytics: EVM Transaction Endpoints
// ============================================

/**
 * Get paginated EVM transaction receipts from Rollytics.
 */
export async function getRollyticsEvmTxs(
  limit: number = 20,
  offset: number = 0,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    'pagination.limit': String(limit),
    'pagination.offset': String(offset),
    'pagination.count_total': 'true',
    'pagination.reverse': 'true',
  });
  const res = await fetchWithTimeout(`${ROLLYTICS_API}/indexer/tx/v1/evm-txs?${params}`);
  if (!res.ok) throw new Error(`Rollytics error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}

/**
 * Get EVM transactions for a specific account from Rollytics.
 * IMPORTANT: Uses underscore in URL path (by_account, not by-account).
 */
export async function getRollyticsEvmTxsByAccount(
  account: string,
  limit: number = 20,
  offset: number = 0,
  isSigner: boolean = false,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    'pagination.limit': String(limit),
    'pagination.offset': String(offset),
    'pagination.count_total': 'true',
    'pagination.reverse': 'true',
  });
  if (isSigner) params.set('is_signer', 'true');
  const res = await fetchWithTimeout(`${ROLLYTICS_API}/indexer/tx/v1/evm-txs/by_account/${account}?${params}`);
  if (!res.ok) throw new Error(`Rollytics error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}

/**
 * Get a single EVM transaction receipt by hash from Rollytics.
 * IMPORTANT: Path is /evm-txs/{hash} directly, NOT /evm-txs/by_hash/{hash}.
 */
export async function getRollyticsEvmTxByHash(txHash: string): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(`${ROLLYTICS_API}/indexer/tx/v1/evm-txs/${txHash}`);
  if (!res.ok) throw new Error(`Rollytics error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}

/**
 * Get EVM transactions at a specific block height from Rollytics.
 */
export async function getRollyticsEvmTxsByHeight(
  height: string,
  limit: number = 20,
  offset: number = 0,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    'pagination.limit': String(limit),
    'pagination.offset': String(offset),
    'pagination.count_total': 'true',
  });
  const res = await fetchWithTimeout(`${ROLLYTICS_API}/indexer/tx/v1/evm-txs/by_height/${height}?${params}`);
  if (!res.ok) throw new Error(`Rollytics error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}
