import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { useState } from 'react'
import { useInterwovenKit, useUsernameQuery } from '@initia/interwovenkit-react'
import { IconExternalLink } from '@initia/icons-react'
import { InitiaAddress, fromBaseUnit, truncate } from '@initia/utils'
import type { LeaderboardEntry, UserRank } from '@/lib/api'
import { getLeaderboard, getUserRank } from '@/lib/api'
import AnimateComponent from '@/components/elements/AnimateComponent'
import ClientOnly from '@/components/elements/ClientOnly'
import { useWalletReady } from '@/providers/WalletReadyContext'
import { cnm } from '@/utils/style'
import { formatUiNumber } from '@/utils/format'
import { addressUrl } from '@/utils/scan'
import { EASE_OUT_CUBIC } from '@/config/animation'

export const Route = createFileRoute('/_app/leaderboard')({
  component: LeaderboardPage,
})

type SortBy = 'totalWins' | 'totalBetVolume' | 'netPnL'

function TruncatedAddress({ address }: { address: string }) {
  return <>{truncate(address, [6, 4])}</>
}

function UsernameDisplayConnected({ address }: { address: string }) {
  const { data: username } = useUsernameQuery(address)
  return <>{username ? username : truncate(address, [6, 4])}</>
}

function UsernameDisplay({ address }: { address: string }) {
  const walletReady = useWalletReady()
  if (!walletReady) return <TruncatedAddress address={address} />
  return <UsernameDisplayConnected address={address} />
}

const SORT_OPTIONS: Array<{ key: SortBy; label: string }> = [
  { key: 'totalWins', label: 'Wins' },
  { key: 'totalBetVolume', label: 'Volume' },
  { key: 'netPnL', label: 'PnL' },
]

function winRatePct(entry: LeaderboardEntry): number {
  if (entry.totalBets === 0) return 0
  return (entry.totalWins / entry.totalBets) * 100
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="font-mono text-[13px] text-white font-medium">1</span>
    )
  if (rank === 2)
    return (
      <span className="font-mono text-[13px] text-white font-medium">2</span>
    )
  if (rank === 3)
    return (
      <span className="font-mono text-[13px] text-white font-medium">3</span>
    )
  return <span className="font-mono text-[13px] text-white/40">{rank}</span>
}

function LeaderboardRow({
  entry,
  rank,
  isCurrentUser,
}: {
  entry: LeaderboardEntry
  rank: number
  isCurrentUser: boolean
}) {
  const wr = winRatePct(entry)
  const pnlVal = parseFloat(fromBaseUnit(entry.netPnL, { decimals: 18 }))
  const volumeVal = parseFloat(
    fromBaseUnit(entry.totalBetVolume, { decimals: 18 }),
  )
  const scanUrl = addressUrl(entry.walletAddress)

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT_CUBIC, delay: rank * 0.03 }}
      className={cnm(
        'flex items-center px-4 py-3.5 border-t border-white/6 hover:bg-white/3 transition-colors duration-150 gap-4',
        isCurrentUser && 'bg-[#3B82F6]/5 border-l-2 border-l-[#3B82F6]/40',
      )}
    >
      {/* Rank */}
      <div className="w-8 text-center shrink-0">
        <RankBadge rank={rank} />
      </div>

      {/* Address */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <a
            href={scanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[13px] text-white hover:text-white/70 transition-colors flex items-center gap-1 truncate"
          >
            <UsernameDisplay address={entry.walletAddress} />
            <IconExternalLink size={10} className="shrink-0" />
          </a>
          {isCurrentUser && (
            <span className="font-mono text-[10px] uppercase tracking-[0.05em] bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/20 px-1.5 py-0.5 rounded shrink-0">
              You
            </span>
          )}
        </div>
        {entry.currentStreak > 0 && (
          <p className="font-mono text-[11px] text-[#F59E0B] mt-0.5">
            🔥 {entry.currentStreak}x streak
          </p>
        )}
      </div>

      {/* Win Rate */}
      <div className="w-20 text-right hidden sm:block">
        <span
          className={cnm(
            'font-mono text-[13px] tabular-nums',
            wr > 60
              ? 'text-[#22C55E]'
              : wr < 40
                ? 'text-[#EF4444]'
                : 'text-white/70',
          )}
        >
          {wr.toFixed(0)}%
        </span>
      </div>

      {/* Bets */}
      <div className="w-16 text-right hidden md:block">
        <span className="font-mono text-[13px] text-white/50 tabular-nums">
          {entry.totalBets}
        </span>
      </div>

      {/* Volume */}
      <div className="w-28 text-right hidden lg:block">
        <span className="font-mono text-[13px] text-white/70 tabular-nums">
          {formatUiNumber(volumeVal, 'INIT', {
            humanize: true,
            humanizeThreshold: 1000,
          })}
        </span>
      </div>

      {/* PnL */}
      <div className="w-28 text-right">
        <span
          className={cnm(
            'font-mono text-[13px] tabular-nums',
            pnlVal > 0
              ? 'text-[#22C55E]'
              : pnlVal < 0
                ? 'text-[#EF4444]'
                : 'text-white/40',
          )}
        >
          {pnlVal > 0 ? '+' : ''}
          {formatUiNumber(pnlVal, 'INIT', {
            humanize: true,
            humanizeThreshold: 1000,
          })}
        </span>
      </div>
    </motion.div>
  )
}

function LeaderboardTable({
  entries,
  isLoading,
  sortBy,
}: {
  entries: Array<LeaderboardEntry> | undefined
  isLoading: boolean
  sortBy: SortBy
}) {
  const walletReady = useWalletReady()
  // Only call useInterwovenKit when wallet providers are available
  return walletReady ? (
    <LeaderboardTableConnected
      entries={entries}
      isLoading={isLoading}
      sortBy={sortBy}
    />
  ) : (
    <LeaderboardTableBase
      entries={entries}
      isLoading={isLoading}
      sortBy={sortBy}
      isCurrentUser={() => false}
      userRankData={undefined}
    />
  )
}

function LeaderboardTableConnected({
  entries,
  isLoading,
  sortBy,
}: {
  entries: Array<LeaderboardEntry> | undefined
  isLoading: boolean
  sortBy: SortBy
}) {
  const { isConnected, address } = useInterwovenKit()

  const { data: userRankData } = useQuery({
    queryKey: ['leaderboard', 'user-rank', address],
    queryFn: () => getUserRank(address),
    enabled: isConnected && Boolean(address),
    staleTime: 30_000,
    retry: false,
  })

  return (
    <LeaderboardTableBase
      entries={entries}
      isLoading={isLoading}
      sortBy={sortBy}
      isCurrentUser={(addr) =>
        isConnected && InitiaAddress.equals(address, addr)
      }
      userRankData={isConnected ? userRankData : undefined}
    />
  )
}

function LeaderboardTableBase({
  entries,
  isLoading,
  sortBy: _sortBy,
  isCurrentUser,
  userRankData,
}: {
  entries: Array<LeaderboardEntry> | undefined
  isLoading: boolean
  sortBy: SortBy
  isCurrentUser: (addr: string) => boolean
  userRankData: UserRank | undefined
}) {
  const rankStats = userRankData?.stats
  const rankWr =
    rankStats && rankStats.totalBets > 0
      ? ((rankStats.totalWins / rankStats.totalBets) * 100).toFixed(0)
      : '0'
  const rankPnl = rankStats
    ? parseFloat(fromBaseUnit(rankStats.netPnL, { decimals: 18 }))
    : 0

  return (
    <>
      {userRankData && rankStats && (
        <div className="flex items-center px-4 py-3 border-t border-white/6 gap-4 bg-[#3B82F6]/5 border-l-2 border-l-[#3B82F6]/40">
          <span className="font-mono text-[12px] text-[#3B82F6] tabular-nums">
            Your Rank: #{userRankData.rank ?? '—'}
          </span>
          <span className="font-mono text-[12px] text-white/50 tabular-nums">
            Win Rate: {rankWr}%
          </span>
          <span
            className={cnm(
              'font-mono text-[12px] tabular-nums',
              rankPnl > 0
                ? 'text-[#22C55E]'
                : rankPnl < 0
                  ? 'text-[#EF4444]'
                  : 'text-white/40',
            )}
          >
            PnL: {rankPnl > 0 ? '+' : ''}
            {formatUiNumber(rankPnl, 'INIT', {
              humanize: true,
              humanizeThreshold: 1000,
            })}
          </span>
        </div>
      )}
      {isLoading ? (
        Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center px-4 py-3.5 border-t border-white/6 gap-4 animate-pulse"
          >
            <div className="w-8 h-4 bg-white/5 rounded" />
            <div className="flex-1 h-4 bg-white/5 rounded" />
            <div className="w-20 h-4 bg-white/5 rounded hidden sm:block" />
            <div className="w-16 h-4 bg-white/5 rounded hidden md:block" />
            <div className="w-28 h-4 bg-white/5 rounded hidden lg:block" />
            <div className="w-28 h-4 bg-white/5 rounded" />
          </div>
        ))
      ) : entries?.length ? (
        entries.map((entry, i) => (
          <LeaderboardRow
            key={entry.id || entry.walletAddress}
            entry={entry}
            rank={i + 1}
            isCurrentUser={isCurrentUser(entry.walletAddress)}
          />
        ))
      ) : (
        <div className="px-4 py-12 text-center">
          <p className="font-sans text-[15px] text-white/30">No traders yet</p>
        </div>
      )}
    </>
  )
}

function LeaderboardPage() {
  const [sortBy, setSortBy] = useState<SortBy>('totalWins')

  const { data: entries, isLoading } = useQuery({
    queryKey: ['leaderboard', sortBy],
    queryFn: () => getLeaderboard({ sortBy, limit: 100 }),
    staleTime: 30_000,
    retry: false,
  })

  return (
    <div className="min-h-screen bg-[#1f2228]">
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <AnimateComponent entry="fadeInUp">
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="font-mono text-[28px] font-light tracking-[-0.03em] text-white mb-1">
                Leaderboard
              </h1>
              <p className="font-sans text-[13px] text-white/40 tracking-[-0.01em]">
                Top traders on Initia. Updated every 30 seconds.
              </p>
            </div>

            {/* Sort options */}
            <div className="flex gap-2">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setSortBy(opt.key)}
                  className={cnm(
                    'px-3 py-1.5 rounded-lg font-mono text-[12px] uppercase tracking-[0.05em] border transition-colors duration-200',
                    sortBy === opt.key
                      ? 'bg-white/8 border-white/20 text-white'
                      : 'bg-white/3 border-white/10 text-white/40 hover:text-white hover:bg-white/5',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </AnimateComponent>

        <div className="bg-white/3 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="flex items-center px-4 py-3 bg-white/5 gap-4">
            <div className="w-8 text-center">
              <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium">
                #
              </span>
            </div>
            <div className="flex-1">
              <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium">
                Trader
              </span>
            </div>
            <div className="w-20 text-right hidden sm:block">
              <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium">
                Win %
              </span>
            </div>
            <div className="w-16 text-right hidden md:block">
              <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium">
                Bets
              </span>
            </div>
            <div className="w-28 text-right hidden lg:block">
              <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium">
                Volume
              </span>
            </div>
            <div className="w-28 text-right">
              <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium">
                Net PnL
              </span>
            </div>
          </div>

          <ClientOnly
            fallback={
              <>
                {Array.from({ length: 10 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center px-4 py-3.5 border-t border-white/6 gap-4 animate-pulse"
                  >
                    <div className="w-8 h-4 bg-white/5 rounded" />
                    <div className="flex-1 h-4 bg-white/5 rounded" />
                    <div className="w-28 h-4 bg-white/5 rounded" />
                  </div>
                ))}
              </>
            }
          >
            <LeaderboardTable
              entries={entries}
              isLoading={isLoading}
              sortBy={sortBy}
            />
          </ClientOnly>
        </div>
      </div>
    </div>
  )
}
