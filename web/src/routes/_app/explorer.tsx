import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { useState } from 'react'
import {
  IconArrowUpRight,
  IconExternalLink,
  IconSearch,
} from '@initia/icons-react'
import { TESTNET } from '@initia/interwovenkit-react'
import { fromBaseUnit } from '@initia/utils'
import {
  getChainInfo,
  getLiveRounds,
  getPlatformStats,
  getRoundHistory,
} from '@/lib/api'
import AnimateComponent from '@/components/elements/AnimateComponent'
import { cnm } from '@/utils/style'
import { formatUiNumber } from '@/utils/format'

export const Route = createFileRoute('/_app/explorer')({
  component: ExplorerPage,
})

// keccak256(utf8(pairName)) -> human-readable name
const PAIR_HASH_MAP: Record<string, string> = {
  '0xe194e6e781bbc476635a2247fb9f3df6284d96acc6ca78efc94a1f7295ef1c92':
    'BTC/USD',
  '0x80bd2a51717df3071d2dc331c9d88cf9f749242589888ac913ba7c2b9c7ea990':
    'ETH/USD',
  '0x27625e3b809151b8ef13c1c0a68dafb60d909f6bee2eaf35295e9074f3fd5dd4':
    'SOL/USD',
}

function resolvePairName(pairId: string, pairName?: string): string {
  if (pairName) return pairName
  const mapped = PAIR_HASH_MAP[pairId.toLowerCase()]
  if (mapped) return mapped
  // If it looks like a hex hash, shorten it
  if (pairId.startsWith('0x') && pairId.length > 10) {
    return `${pairId.slice(0, 6)}...${pairId.slice(-4)}`
  }
  return pairId
}

const INITIA_SCAN = 'https://scan.testnet.initia.xyz/evm-1'

const ECOSYSTEM_LINKS = [
  { label: 'Initia Scan', href: INITIA_SCAN },
  { label: 'Initia Testnet', href: 'https://scan.testnet.initia.xyz' },
  { label: 'Initia Docs', href: 'https://docs.initia.xyz' },
  ...(TESTNET.glyphUrl
    ? [{ label: 'Glyph NFTs', href: TESTNET.glyphUrl }]
    : []),
  ...(TESTNET.dexUrl ? [{ label: 'Initia DEX', href: TESTNET.dexUrl }] : []),
  ...(TESTNET.vipUrl ? [{ label: 'VIP Dashboard', href: TESTNET.vipUrl }] : []),
]

function ExplorerPage() {
  const [searchQuery, setSearchQuery] = useState('')

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: getPlatformStats,
    refetchInterval: 15_000,
    staleTime: 10_000,
  })

  const { data: liveRounds } = useQuery({
    queryKey: ['rounds', 'live'],
    queryFn: getLiveRounds,
    refetchInterval: 5000,
    staleTime: 3000,
  })

  const { data: historyData } = useQuery({
    queryKey: ['rounds', 'history', 'all'],
    queryFn: () => getRoundHistory({ limit: 20 }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const { data: chainInfo } = useQuery({
    queryKey: ['chain-info'],
    queryFn: getChainInfo,
    staleTime: 60_000,
    retry: false,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return
    const q = searchQuery.trim()
    if (q.startsWith('0x') && q.length === 66) {
      window.open(`${INITIA_SCAN}/txs/${q}`, '_blank', 'noopener,noreferrer')
    } else if (q.startsWith('0x') && q.length === 42) {
      window.open(
        `${INITIA_SCAN}/accounts/${q}`,
        '_blank',
        'noopener,noreferrer',
      )
    } else {
      window.open(`${INITIA_SCAN}/txs/${q}`, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div className="min-h-screen bg-[#1f2228]">
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <AnimateComponent entry="fadeInUp">
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <h1 className="font-mono text-[28px] font-light tracking-[-0.03em] text-white">
                Explorer
              </h1>
              <a
                href={INITIA_SCAN}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/20 hover:text-white/60 transition-colors"
              >
                <IconArrowUpRight size={18} />
              </a>
            </div>
            <p className="font-sans text-[13px] text-white/40 tracking-[-0.01em]">
              INITTAP on-chain data · Powered by Rollytics indexer on Initia
              MiniEVM
            </p>
          </div>
        </AnimateComponent>

        {/* Search */}
        <AnimateComponent onScroll entry="fadeInUp">
          <form onSubmit={handleSearch} className="mb-8">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <IconSearch
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by tx hash or address (0x...)"
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-4 py-3 font-mono text-[13px] text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-[#3B82F6]/30 transition-colors duration-200"
                />
              </div>
              <motion.button
                type="submit"
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.1 }}
                className="bg-white text-[#1f2228] font-mono text-[13px] uppercase tracking-[0.08em] px-5 py-3 rounded-lg hover:bg-white/90 transition-colors duration-200 flex items-center gap-2"
              >
                Search
                <IconExternalLink size={13} />
              </motion.button>
            </div>
            <p className="font-sans text-[11px] text-white/25 mt-2 tracking-[-0.01em]">
              Opens in Initia Scan explorer
            </p>
          </form>
        </AnimateComponent>

        {/* Platform stats */}
        <AnimateComponent onScroll entry="fadeInUp" className="mb-8">
          <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-4">
            Platform Stats
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {statsLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white/3 border border-white/10 rounded-xl p-4 animate-pulse"
                >
                  <div className="h-3 bg-white/5 rounded w-20 mb-2" />
                  <div className="h-7 bg-white/5 rounded w-24" />
                </div>
              ))
            ) : stats ? (
              <>
                <StatCard
                  label="Total Bets"
                  value={formatUiNumber(stats.totalBets, '', {
                    humanize: true,
                    humanizeThreshold: 1000,
                  })}
                />
                <StatCard
                  label="Total Volume"
                  value={`$${formatUiNumber(parseFloat(fromBaseUnit(stats.totalVolume, { decimals: 18 })), '', { humanize: true, humanizeThreshold: 1000 })}`}
                />
                <StatCard
                  label="Active Pairs"
                  value={String(stats.activePairs.length)}
                />
              </>
            ) : null}
          </div>
        </AnimateComponent>

        {/* Chain info */}
        {chainInfo && (
          <AnimateComponent onScroll entry="fadeInUp" className="mb-8">
            <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-4">
              Chain
            </p>
            <div className="bg-white/3 border border-white/10 rounded-xl p-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
                <div>
                  <p className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium mb-1">
                    Network
                  </p>
                  <p className="font-mono text-[13px] text-white">
                    {chainInfo.nodeInfo.default_node_info.network}
                  </p>
                </div>
                <div>
                  <p className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium mb-1">
                    Chain ID
                  </p>
                  <p className="font-mono text-[13px] text-white tabular-nums">
                    {chainInfo.chainId}
                  </p>
                </div>
                <div>
                  <p className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium mb-1">
                    Node
                  </p>
                  <p className="font-mono text-[13px] text-white truncate">
                    {chainInfo.nodeInfo.default_node_info.moniker}
                  </p>
                </div>
                {chainInfo.nodeInfo.application_version && (
                  <div>
                    <p className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium mb-1">
                      App Version
                    </p>
                    <p className="font-mono text-[13px] text-white">
                      {chainInfo.nodeInfo.application_version.version}
                    </p>
                  </div>
                )}
                <div>
                  <p className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium mb-1">
                    Network Name
                  </p>
                  <p className="font-mono text-[13px] text-white/70 truncate">
                    {chainInfo.networkName}
                  </p>
                </div>
              </div>
            </div>
          </AnimateComponent>
        )}

        {/* Live rounds */}
        {liveRounds && liveRounds.length > 0 && (
          <AnimateComponent onScroll entry="fadeInUp" className="mb-8">
            <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-4">
              Live Rounds
            </p>
            <div className="bg-white/3 border border-white/10 rounded-xl overflow-hidden">
              <div className="flex items-center px-4 py-3 bg-white/5 gap-4">
                <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium w-20">
                  Pair
                </span>
                <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium w-16">
                  Epoch
                </span>
                <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium flex-1">
                  Status
                </span>
                <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium w-28 text-right">
                  Pool Size
                </span>
              </div>
              {liveRounds.map((round, i) => (
                <motion.div
                  key={round.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, delay: i * 0.05 }}
                  className="flex items-center px-4 py-3 border-t border-white/6 hover:bg-white/3 transition-colors duration-150 gap-4"
                >
                  <span className="font-sans text-[13px] text-white/70 w-20 truncate shrink-0">
                    {resolvePairName(round.pairId, round.pair?.name)}
                  </span>
                  <span className="font-mono text-[13px] text-white/50 w-16 shrink-0">
                    #{round.epoch}
                  </span>
                  <div className="flex-1">
                    <span
                      className={cnm(
                        'font-mono text-[11px] uppercase tracking-[0.04em] px-2 py-0.5 rounded border',
                        round.status === 'LIVE'
                          ? 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/20'
                          : round.status === 'LOCKED'
                            ? 'bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/20'
                            : 'bg-white/5 text-white/40 border-white/10',
                      )}
                    >
                      {round.status}
                    </span>
                  </div>
                  <span className="font-mono text-[13px] text-white/60 tabular-nums w-28 text-right">
                    {formatUiNumber(
                      parseFloat(
                        fromBaseUnit(round.totalAmount, { decimals: 18 }),
                      ),
                      'INIT',
                      { humanize: true },
                    )}
                  </span>
                </motion.div>
              ))}
            </div>
          </AnimateComponent>
        )}

        {/* Recent rounds */}
        <AnimateComponent onScroll entry="fadeInUp">
          <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-4">
            Recent Rounds
          </p>
          <div className="bg-white/3 rounded-xl overflow-hidden">
            <div className="flex items-center px-4 py-3 bg-white/5 gap-4">
              <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium w-20">
                Pair
              </span>
              <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium w-16">
                Epoch
              </span>
              <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium w-20">
                Status
              </span>
              <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium flex-1 text-right hidden sm:block">
                Lock Price
              </span>
              <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium w-24 text-right hidden md:block">
                Close Price
              </span>
              <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium w-20 text-right">
                Result
              </span>
            </div>
            {historyData?.rounds.map((round, i) => {
              const isUp =
                round.lockPrice && round.closePrice
                  ? parseFloat(round.closePrice) >= parseFloat(round.lockPrice)
                  : null
              return (
                <motion.div
                  key={round.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, delay: i * 0.02 }}
                  className="flex items-center px-4 py-3 border-t border-white/6 hover:bg-white/3 transition-colors duration-150 gap-4"
                >
                  <span className="font-sans text-[13px] text-white/70 w-20 truncate shrink-0">
                    {resolvePairName(round.pairId, round.pair?.name)}
                  </span>
                  <span className="font-mono text-[13px] text-white/50 w-16 shrink-0">
                    #{round.epoch}
                  </span>
                  <div className="w-20 shrink-0">
                    <span
                      className={cnm(
                        'font-mono text-[11px] uppercase tracking-[0.04em] px-2 py-0.5 rounded border',
                        round.status === 'LIVE'
                          ? 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/20'
                          : round.status === 'LOCKED'
                            ? 'bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/20'
                            : round.status === 'ENDED'
                              ? 'bg-white/5 text-white/40 border-white/10'
                              : 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/20',
                      )}
                    >
                      {round.status}
                    </span>
                  </div>
                  <span className="font-mono text-[13px] text-white/60 tabular-nums flex-1 text-right hidden sm:block">
                    {round.lockPrice
                      ? `$${(parseFloat(round.lockPrice) / 1e8).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : '—'}
                  </span>
                  <span className="font-mono text-[13px] text-white/60 tabular-nums w-24 text-right hidden md:block">
                    {round.closePrice
                      ? `$${(parseFloat(round.closePrice) / 1e8).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : '—'}
                  </span>
                  <div className="w-20 text-right">
                    {isUp !== null ? (
                      <span
                        className={cnm(
                          'font-mono text-[12px]',
                          isUp ? 'text-[#22C55E]' : 'text-[#EF4444]',
                        )}
                      >
                        {isUp ? '▲ BULL' : '▼ BEAR'}
                      </span>
                    ) : (
                      <span className="font-mono text-[12px] text-white/20">
                        —
                      </span>
                    )}
                  </div>
                </motion.div>
              )
            })}
            {!historyData?.rounds.length && (
              <div className="px-4 py-10 text-center">
                <p className="font-sans text-[13px] text-white/25">
                  No rounds found
                </p>
              </div>
            )}
          </div>
        </AnimateComponent>

        {/* Ecosystem links */}
        <div className="mt-8">
          <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-3">
            Initia Ecosystem
          </p>
          <div className="flex flex-wrap gap-3">
            {ECOSYSTEM_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.06em] text-white/30 hover:text-white/70 transition-colors duration-200 border border-white/10 px-3 py-1.5 rounded-lg hover:border-white/20"
              >
                {link.label}
                <IconExternalLink size={10} />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/3 border border-white/10 rounded-xl p-4">
      <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-1">
        {label}
      </p>
      <p className="font-mono text-[22px] tracking-[-0.02em] text-white tabular-nums">
        {value}
      </p>
    </div>
  )
}
