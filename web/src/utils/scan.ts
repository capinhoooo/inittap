const SCAN_BASE = 'https://scan.testnet.initia.xyz/evm-1'

export function txUrl(hash: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return '#'
  return `${SCAN_BASE}/txs/${hash}`
}

export function addressUrl(addr: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return '#'
  return `${SCAN_BASE}/accounts/${addr}`
}

export function contractUrl(addr: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return '#'
  return `${SCAN_BASE}/evm-contracts/${addr}`
}
