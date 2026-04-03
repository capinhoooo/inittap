import { keccak256, toUtf8Bytes, formatEther, getAddress, formatUnits } from 'ethers';

/**
 * Compute the keccak256 hash of a pair name (e.g. "BTC/USD").
 * Returns the full bytes32 hex string, matching the on-chain pairHash.
 */
export function computePairHash(pairName: string): string {
  return keccak256(toUtf8Bytes(pairName));
}

/**
 * Convert a wei value (as string) to ether for display.
 */
export function weiToEther(wei: string): string {
  return formatEther(BigInt(wei));
}

/**
 * Format a raw oracle price (uint256) to a human-readable decimal string.
 * The oracle returns prices with a specific number of decimals (typically 8).
 */
export function formatOraclePrice(rawPrice: bigint, decimals: number): string {
  return formatUnits(rawPrice, decimals);
}

/**
 * Return the EIP-55 checksummed version of an address.
 * Throws if the input is not a valid address.
 */
export function checksumAddress(address: string): string {
  return getAddress(address);
}

/**
 * Resolve a pairHash back to a human-readable pair name.
 * Falls back to the raw hash if no match is found.
 */
const PAIR_HASH_MAP: Record<string, string> = (() => {
  const pairs = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'INIT/USD', 'TIA/USD', 'ATOM/USD'];
  const map: Record<string, string> = {};
  for (const name of pairs) {
    map[keccak256(toUtf8Bytes(name))] = name;
  }
  return map;
})();

export function resolvePairName(pairHash: string): string {
  return PAIR_HASH_MAP[pairHash] ?? pairHash;
}
