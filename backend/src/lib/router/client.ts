/**
 * Typed client for the Initia Router API (powered by Skip Protocol).
 * Base URL: https://router-api.initiation-2.initia.xyz
 *
 * No authentication required. All POST endpoints expect JSON bodies.
 * Error responses come in two forms:
 *   - Validation errors (400): { message, error, statusCode }
 *   - Service errors: { error_message, source: "SkipService" }
 */

const ROUTER_API = 'https://router-api.initiation-2.initia.xyz';

/** Default request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 15_000;

// ------------------------------------------------------------------ helpers

class RouterApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody: string;

  constructor(statusCode: number, responseBody: string) {
    super(`Router API responded with ${statusCode}: ${responseBody}`);
    this.name = 'RouterApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

async function routerPost<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${ROUTER_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      throw new RouterApiError(res.status, text);
    }

    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function routerGet<T = Record<string, unknown>>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let url = `${ROUTER_API}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }

    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();

    if (!res.ok) {
      throw new RouterApiError(res.status, text);
    }

    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ public

/**
 * Compute optimal cross-chain transfer route.
 * POST /v2/fungible/route
 */
export async function computeRoute(params: {
  amount_in: string;
  source_asset_chain_id: string;
  source_asset_denom: string;
  dest_asset_chain_id: string;
  dest_asset_denom: string;
  allow_unsafe?: boolean;
}): Promise<Record<string, unknown>> {
  return routerPost('/v2/fungible/route', params);
}

/**
 * Generate signable transaction messages from a route.
 * POST /v2/fungible/msgs
 */
export async function generateMessages(params: {
  amount_in: string;
  amount_out: string;
  source_asset_chain_id: string;
  source_asset_denom: string;
  dest_asset_chain_id: string;
  dest_asset_denom: string;
  address_list: string[];
  operations: unknown[];
  slippage_tolerance_percent: string;
}): Promise<Record<string, unknown>> {
  return routerPost('/v2/fungible/msgs', params as unknown as Record<string, unknown>);
}

/**
 * Register a transaction for cross-chain tracking.
 * POST /v2/tx/track
 */
export async function trackTransaction(params: {
  tx_hash: string;
  chain_id: string;
}): Promise<Record<string, unknown>> {
  return routerPost('/v2/tx/track', params);
}

/**
 * Get cross-chain transfer status.
 * GET /v2/tx/status?tx_hash=...&chain_id=...
 */
export async function getTransactionStatus(
  txHash: string,
  chainId: string,
): Promise<Record<string, unknown>> {
  return routerGet('/v2/tx/status', { tx_hash: txHash, chain_id: chainId });
}

/**
 * Get supported assets for given chains.
 * GET /v2/fungible/assets?chain_ids=...
 *
 * The upstream API expects chain_ids as a comma-separated string.
 */
export async function getSupportedAssets(
  chainIds: string[],
): Promise<Record<string, unknown>> {
  return routerGet('/v2/fungible/assets', { chain_ids: chainIds.join(',') });
}

/**
 * Get supported chains info.
 * GET /v2/info/chains
 */
export async function getSupportedChains(): Promise<Record<string, unknown>> {
  return routerGet('/v2/info/chains');
}

/**
 * Get OP hook data required when route has required_op_hook: true.
 * POST /op-hook
 */
export async function getOpHook(params: {
  source_address: string;
  source_asset_chain_id: string;
  source_asset_denom: string;
  dest_address: string;
  dest_asset_chain_id: string;
  dest_asset_denom: string;
}): Promise<Record<string, unknown>> {
  return routerPost<Record<string, unknown>>('/op-hook', params);
}

export { RouterApiError };
