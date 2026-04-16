import { config } from '@/config'

const BASE = config.apiUrl

// ============================================
// Types
// ============================================

export interface OraclePrice {
  id: string // "BTC/USD"
  price: string
  decimals: number
  nonce: string
  height: string
  timestamp: string
  updatedAt: string
}

export interface Pair {
  id: string
  name: string
  active: boolean
}

export interface Round {
  id: string
  pairId: string
  epoch: number
  startTimestamp: string
  lockTimestamp: string
  closeTimestamp: string
  lockPrice: string | null
  closePrice: string | null
  lockOracleNonce: string | null
  closeOracleNonce: string | null
  totalAmount: string
  bullAmount: string
  bearAmount: string
  rewardBaseCalAmount: string
  rewardAmount: string
  oracleCalled: boolean
  status: 'LIVE' | 'LOCKED' | 'ENDED' | 'CANCELLED'
  pair?: Pair
  bets?: Array<Bet>
}

export interface Bet {
  id: string
  pairId: string
  epoch: number
  userAddress: string
  position: 'Bull' | 'Bear'
  amount: string
  claimed: boolean
  isCopyTrade: boolean
  txHash: string
  blockNumber: string
  createdAt: string
  round?: Round
}

export interface UserProfile {
  id: string
  walletAddress: string
  cosmosAddress: string
  username: string | null
  initBalance: string
  lastSignIn: string | null
  createdAt: string
}

export interface UserStats {
  walletAddress: string
  totalBets: number
  totalWins: number
  currentStreak: number
  maxStreak: number
  totalBetVolume: string
  totalWinnings: string
  netPnL: string
  tapTokensMinted: string
}

export interface LeaderboardEntry extends UserStats {
  id: string
}

export interface Agent {
  id: number
  creator: string
  agentWallet: string
  strategyURI: string
  performanceFeeBps: number
  subscriberCount: number
  totalPnL: string
  totalTrades: number
  wins: number
  isActive: boolean
  registrationTime: string
  shareTokenAddress: string | null
  registrationTxHash: string
  createdAt: string
  updatedAt: string
}

export interface ClaimableItem {
  pairId: string
  pairName: string
  epoch: number
  position: 'Bull' | 'Bear'
  amount: string
}

export interface PlatformStats {
  totalRounds: number
  totalBets: number
  totalVolume: string
  totalUsers: number
  totalAgents: number
  activePairs: Array<string>
  currentEpochs: Record<string, number | null>
  tapTokenTotalSupply: string
  vipEnabled: boolean
  oraclePairsAvailable: number
}

// ============================================
// Helpers
// ============================================

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

function sanitizeParam(input: string): string {
  return input.replace(/[<>"'&]/g, '')
}

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)

  try {
    const url = new URL(path, BASE)
    const res = await fetch(url.toString(), {
      ...opts,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...opts.headers,
      },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`API ${res.status}: ${body}`)
    }

    const json: unknown = await res.json()
    if (typeof json !== 'object' || json === null || !('success' in json)) {
      throw new Error('Invalid API response structure')
    }

    const typed = json as {
      success: boolean
      error?: { message?: string }
      data: T
    }
    if (!typed.success) {
      throw new Error(typed.error?.message ?? 'Unknown API error')
    }
    return typed.data
  } finally {
    clearTimeout(timer)
  }
}

// ============================================
// Prices
// ============================================

export async function getPrices(): Promise<Array<OraclePrice>> {
  const data = await apiFetch<{ prices: Array<OraclePrice> }>('/prices')
  return data.prices
}

// ============================================
// Rounds
// ============================================

export async function getLiveRounds(): Promise<Array<Round>> {
  const data = await apiFetch<{ rounds: Array<Round> }>('/rounds/live')
  return data.rounds
}

export async function getRoundHistory(params?: {
  pairId?: string
  limit?: number
  offset?: number
}): Promise<{ rounds: Array<Round>; total: number }> {
  const qs = new URLSearchParams()
  if (params?.pairId) qs.set('pairId', params.pairId)
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  const query = qs.toString()
  return apiFetch(`/rounds/history${query ? `?${query}` : ''}`)
}

export async function getCurrentRound(
  pairId: string,
): Promise<{ round: Round; previousRound: Round | null }> {
  return apiFetch<{ round: Round; previousRound: Round | null }>(
    `/rounds/${encodeURIComponent(pairId)}/current`,
  )
}

// ============================================
// Auth
// ============================================

export async function getNonce(walletAddress: string): Promise<string> {
  const data = await apiFetch<{ nonce: string }>('/auth/nonce', {
    method: 'POST',
    body: JSON.stringify({ walletAddress }),
  })
  return data.nonce
}

export async function verifySignature(
  walletAddress: string,
  signature: string,
): Promise<{ token: string; user: { id: string; walletAddress: string } }> {
  return apiFetch('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ walletAddress, signature }),
  })
}

// ============================================
// User
// ============================================

export async function getUserProfile(
  token: string,
): Promise<{ user: UserProfile; stats: UserStats }> {
  return apiFetch('/user/profile', { headers: authHeaders(token) })
}

export async function getUserBets(
  token: string,
  params?: { pairId?: string; limit?: number; offset?: number },
): Promise<{ bets: Array<Bet>; total: number }> {
  const qs = new URLSearchParams()
  if (params?.pairId) qs.set('pairId', params.pairId)
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  const query = qs.toString()
  return apiFetch(`/user/bets${query ? `?${query}` : ''}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
}

export async function getUserHistory(
  token: string,
): Promise<{ history: Array<unknown>; total: number }> {
  return apiFetch('/user/history', { headers: authHeaders(token) })
}

export async function getClaimable(
  token: string,
): Promise<{ claimable: Array<ClaimableItem> }> {
  return apiFetch('/user/claimable', { headers: authHeaders(token) })
}

// ============================================
// Bridge
// ============================================

export async function getPendingRefund(
  address: string,
): Promise<{ pendingRefund: string; hasPendingRefund: boolean }> {
  return apiFetch(`/bridge/refund/${encodeURIComponent(address)}`)
}

// ============================================
// Leaderboard
// ============================================

export interface UserRank {
  stats: UserStats
  rank: number | null
}

export async function getUserRank(address: string): Promise<UserRank> {
  return apiFetch(`/leaderboard/user/${encodeURIComponent(address)}`)
}

export async function getLeaderboard(params?: {
  sortBy?: string
  limit?: number
}): Promise<Array<LeaderboardEntry>> {
  const qs = new URLSearchParams()
  if (params?.sortBy) qs.set('sortBy', params.sortBy)
  if (params?.limit) qs.set('limit', String(params.limit))
  const query = qs.toString()
  const data = await apiFetch<{ leaderboard: Array<LeaderboardEntry> }>(
    `/leaderboard/top${query ? `?${query}` : ''}`,
  )
  return data.leaderboard
}

// ============================================
// Agents
// ============================================

export async function getAgents(params?: {
  active?: boolean
  sortBy?: string
  limit?: number
  offset?: number
}): Promise<{ agents: Array<Agent>; total: number }> {
  const qs = new URLSearchParams()
  if (params?.active !== undefined) qs.set('active', String(params.active))
  if (params?.sortBy) qs.set('sortBy', params.sortBy)
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  const query = qs.toString()
  return apiFetch(`/agents${query ? `?${query}` : ''}`)
}

export async function getAgent(
  agentId: number,
): Promise<{ agent: Agent; recentTrades: Array<unknown>; followers: number }> {
  return apiFetch(`/agents/${agentId}`)
}

export interface AgentTrade {
  id: string
  pairId: string
  epoch: number
  isBull: boolean
  totalBetAmount: string
  followerCount: number
  claimed: boolean
  totalClaimed: string | null
  totalFees: string | null
  txHash: string
  createdAt: string
}

export async function getAgentTrades(
  agentId: number,
  params?: { limit?: number; offset?: number },
): Promise<{ trades: Array<AgentTrade>; total: number }> {
  const qs = new URLSearchParams()
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  const query = qs.toString()
  return apiFetch(`/agents/${agentId}/trades${query ? `?${query}` : ''}`)
}

// ============================================
// Usernames
// ============================================

export async function lookupUsername(address: string): Promise<string | null> {
  try {
    const data = await apiFetch<{ username: string | null }>(
      `/usernames/lookup/${encodeURIComponent(sanitizeParam(address))}`,
    )
    return data.username
  } catch {
    return null
  }
}

export async function resolveUsername(
  username: string,
): Promise<string | null> {
  try {
    const data = await apiFetch<{ address: string | null }>(
      `/usernames/resolve/${encodeURIComponent(sanitizeParam(username))}`,
    )
    return data.address
  } catch {
    return null
  }
}

// ============================================
// Stats
// ============================================

export async function getPlatformStats(): Promise<PlatformStats> {
  const data = await apiFetch<{ stats: PlatformStats }>('/stats/platform')
  return data.stats
}

// ============================================
// VIP
// ============================================

export interface VipInfo {
  address: string
  stage: string
  score: string
  isIndexed: boolean
}

export async function getVipScore(address: string): Promise<VipInfo> {
  return apiFetch(`/vip/score/${encodeURIComponent(address)}`)
}

// ============================================
// Token
// ============================================

export interface TokenInfo {
  name: string
  symbol: string
  totalSupply: string
  minter: string
  cosmosLocked: string
  address: string
  cosmosDenom: string
}

export async function getTokenInfo(): Promise<TokenInfo> {
  return apiFetch('/token/info')
}

export interface TokenBalance {
  evmBalance: string
  cosmosBalance: string
  address: string
  cosmosAddress: string
}

export async function getTokenBalance(address: string): Promise<TokenBalance> {
  return apiFetch(`/token/balance/${encodeURIComponent(address)}`)
}

// ============================================
// Chain
// ============================================

export interface ChainInfo {
  chainId: number
  networkName: string
  cosmosRestUrl: string
  explorerUrl: string
  nodeInfo: {
    default_node_info: {
      network: string
      moniker: string
      version: string
    }
    application_version?: {
      version: string
      app_name: string
    }
  }
}

export async function getChainInfo(): Promise<ChainInfo> {
  return apiFetch('/chain/info')
}
