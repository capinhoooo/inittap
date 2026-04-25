const SCAN_BASE = 'https://scan.testnet.initia.xyz/evm-1'

export function txUrl(hash: string): string {
  // Accept both 0x-prefixed and raw hex (Cosmos SDK format)
  const clean = hash.startsWith('0x') ? hash.slice(2) : hash
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) return '#'
  // Initia scan uses uppercase Cosmos tx hash without 0x prefix
  return `${SCAN_BASE}/txs/${clean.toUpperCase()}`
}

export function addressUrl(addr: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return '#'
  return `${SCAN_BASE}/accounts/${addr}`
}

export function contractUrl(addr: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return '#'
  return `${SCAN_BASE}/evm-contracts/${addr}`
}
