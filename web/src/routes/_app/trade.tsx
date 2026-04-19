import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { MsgCall } from '@initia/initia.proto/minievm/evm/v1/tx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconClock } from '@initia/icons-react'
import { encodeFunctionData, keccak256, parseEther, toBytes } from 'viem'
import type { OraclePrice, Round } from '@/lib/api'
import { getClaimable, getCurrentRound, getPrices } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { cnm } from '@/utils/style'
import { EASE_OUT_CUBIC } from '@/config/animation'
import { useWalletReady } from '@/providers/WalletReadyContext'
import { config } from '@/config'

export const Route = createFileRoute('/_app/trade')({ component: TradePage })

// ─── Constants ────────────────────────────────────────────────────────────────

const PAIRS = [
  { id: 'BTC/USD', label: 'BTC', step: 25 },
  { id: 'ETH/USD', label: 'ETH', step: 0.25 },
  { id: 'SOL/USD', label: 'SOL', step: 0.05 },
]

const GRID_ROWS = 13
const GRID_COLS = 15
const GRID_COLS_MOBILE = 8
const HALF_ROWS = 6
const ROUND_DURATION = 180 // seconds (matches contract intervalSeconds)

// Color tokens
const BG = '#1f2228'
const GRID_LINE = 'rgba(255,255,255,0.06)'
const ACCENT = 'rgba(255,255,255,0.40)'
const ACCENT_DIM = 'rgba(255,255,255,0.20)'
const CHART_LINE = '#ffffff'
const CHART_GLOW = 'rgba(255,255,255,0.4)'
const GREEN = '#22C55E'
const RED = '#EF4444'
const AMBER = '#F59E0B'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PricePoint {
  price: number
  timestamp: number
}

type TapState = 'idle' | 'sending' | 'success' | 'error'

// Per-cell visual state for the new time-column model
type CellVisualState =
  | 'idle' // future column, not interacted
  | 'hovered' // hovered, future column
  | 'target' // user's selected bet cell
  | 'approaching' // chart line is in adjacent or same column
  | 'hit' // chart line passed through this cell's row at this column
  | 'missed' // chart line passed this column but not this row
  | 'passed' // past column, no interaction
  | 'sending' // tx in flight
  | 'success' // just confirmed
  | 'error' // tx failed

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatPrice(priceStr: string, decimals: number = 8): string {
  const val = parseFloat(priceStr) / 10 ** decimals
  if (isNaN(val)) return '\u2014'
  if (val >= 1000) {
    return val.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }
  if (val >= 1) return val.toFixed(2)
  return val.toFixed(4)
}

function formatPriceLevel(val: number, pairId: string): string {
  if (val >= 1000) {
    return val.toLocaleString('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })
  }
  const step = PAIRS.find((p) => p.id === pairId)?.step ?? 1
  const decs = step < 1 ? (String(step).split('.')[1]?.length ?? 1) : 1
  return val.toFixed(decs)
}

function getPairStep(pairId: string): number {
  return PAIRS.find((p) => p.id === pairId)?.step ?? 1
}

function weiToInit(wei: string): number {
  const val = parseFloat(wei)
  if (isNaN(val) || val === 0) return 0
  return val / 1e18
}

function fmtInit(val: number): string {
  if (val === 0) return '0'
  if (val >= 1000) return `${(val / 1000).toFixed(1)}K`
  if (val >= 1) return val.toFixed(2)
  return val.toFixed(4)
}

function getPoolMultipliers(round: Round | undefined): {
  bull: number
  bear: number
  totalInit: number
  bullInit: number
  bearInit: number
} {
  const DEFAULT_MULT = 2
  if (!round)
    return {
      bull: DEFAULT_MULT,
      bear: DEFAULT_MULT,
      totalInit: 0,
      bullInit: 0,
      bearInit: 0,
    }
  const totalInit = weiToInit(round.totalAmount)
  const bullInit = weiToInit(round.bullAmount)
  const bearInit = weiToInit(round.bearAmount)

  if (totalInit === 0)
    return {
      bull: DEFAULT_MULT,
      bear: DEFAULT_MULT,
      totalInit: 0,
      bullInit: 0,
      bearInit: 0,
    }

  return {
    bull: bullInit > 0 ? totalInit / bullInit : DEFAULT_MULT,
    bear: bearInit > 0 ? totalInit / bearInit : DEFAULT_MULT,
    totalInit,
    bullInit,
    bearInit,
  }
}

function fmtMult(val: number): string {
  if (val <= 0) return 'N/A'
  if (val >= 100) return `${Math.round(val)}`
  if (val >= 10) return `${val.toFixed(0)}`
  return `${val.toFixed(1)}`
}

function getPairHash(pairId: string): `0x${string}` {
  return keccak256(toBytes(pairId))
}

// Format relative time label for a column midpoint
function fmtColTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `+${m}:${String(s).padStart(2, '0')}`
}

// ─── TX / ABI ─────────────────────────────────────────────────────────────────

const TAP_PREDICTOR = config.contracts.tapPredictor

const TAP_PREDICTOR_ABI = [
  {
    name: 'betBull',
    type: 'function',
    inputs: [
      { name: 'pairHash', type: 'bytes32' },
      { name: 'epoch', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'betBear',
    type: 'function',
    inputs: [
      { name: 'pairHash', type: 'bytes32' },
      { name: 'epoch', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'claim',
    type: 'function',
    inputs: [
      { name: 'pairHashes', type: 'bytes32[]' },
      { name: 'epochs', type: 'uint256[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

// ─── useCountdown ─────────────────────────────────────────────────────────────

function useCountdown(targetTimestamp: string | null): {
  display: string
  urgent: boolean
  critical: boolean
  remaining: number
  progress: number
} {
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    if (!targetTimestamp) return
    const update = () => {
      const now = Math.floor(Date.now() / 1000)
      const target = Number(targetTimestamp)
      setRemaining(Math.max(0, target - now))
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [targetTimestamp])

  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60
  const display = `${mins}:${String(secs).padStart(2, '0')}`
  const urgent = remaining > 0 && remaining <= 30
  const critical = remaining > 0 && remaining <= 10
  const elapsed = ROUND_DURATION - remaining
  const progress = Math.min(1, Math.max(0, elapsed / ROUND_DURATION))

  return { display, urgent, critical, remaining, progress }
}

// ─── useRoundClock ────────────────────────────────────────────────────────────
// Ticks every second and returns the current column index based on round time

function useRoundClock(
  roundStartTs: number,
  cols: number,
): {
  currentCol: number
  elapsed: number
  colProgress: number // 0..1 progress within the current column
} {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  const elapsed = Math.max(0, now - roundStartTs)
  const colDuration = ROUND_DURATION / cols
  const colRaw = elapsed / colDuration
  const currentCol = Math.min(cols - 1, Math.floor(colRaw))
  const colProgress = Math.min(1, colRaw - Math.floor(colRaw))

  return { currentCol, elapsed, colProgress }
}

// ─── EuphoriaCell ─────────────────────────────────────────────────────────────

function EuphoriaCell({
  multiplier,
  isCurrentRow,
  isAbove,
  visualState,
  onTap,
  onMouseEnter,
  onMouseLeave,
  disabled,
  betAmount,
}: {
  multiplier: string
  isCurrentRow: boolean
  isAbove: boolean
  visualState: CellVisualState
  distance: number
  onTap: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  disabled: boolean
  betAmount: number
}) {
  const accentColor = isAbove ? GREEN : RED

  const bg = (() => {
    switch (visualState) {
      case 'hovered':
        return isAbove ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'
      case 'target':
        return 'rgba(251,191,36,0.85)'
      case 'approaching':
        return 'rgba(251,191,36,0.95)'
      case 'hit':
        return 'rgba(34,197,94,0.80)'
      case 'missed':
        return 'rgba(239,68,68,0.50)'
      case 'passed':
        return isAbove ? 'rgba(34,197,94,0.02)' : 'rgba(239,68,68,0.02)'
      case 'sending':
        return isAbove ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)'
      case 'success':
        return 'rgba(251,191,36,0.85)'
      case 'error':
        return 'rgba(239,68,68,0.12)'
      default:
        return isCurrentRow
          ? 'rgba(255,255,255,0.06)'
          : isAbove
            ? 'rgba(34,197,94,0.04)'
            : 'rgba(239,68,68,0.04)'
    }
  })()

  const border = (() => {
    switch (visualState) {
      case 'hovered':
        return accentColor
      case 'target':
        return '#FBBF24'
      case 'approaching':
        return '#FBBF24'
      case 'hit':
        return '#22C55E'
      case 'missed':
        return '#EF4444'
      case 'passed':
        return isAbove ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)'
      case 'sending':
        return isAbove ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'
      case 'success':
        return '#FBBF24'
      case 'error':
        return 'rgba(239,68,68,0.35)'
      default:
        return isCurrentRow
          ? 'rgba(255,255,255,0.18)'
          : isAbove
            ? 'rgba(34,197,94,0.12)'
            : 'rgba(239,68,68,0.12)'
    }
  })()

  const opacity =
    visualState === 'missed'
      ? 1
      : visualState === 'passed'
        ? 0.5
        : visualState === 'sending'
          ? 0.55
          : 1

  const boxShadow = (() => {
    if (visualState === 'hit')
      return '0 0 12px rgba(34,197,94,0.70), 0 0 24px rgba(34,197,94,0.35)'
    if (visualState === 'target')
      return '0 0 10px rgba(251,191,36,0.60), 0 0 20px rgba(251,191,36,0.30)'
    if (visualState === 'approaching')
      return '0 0 12px rgba(251,191,36,0.70), 0 0 24px rgba(251,191,36,0.35)'
    if (visualState === 'success')
      return '0 0 10px rgba(251,191,36,0.60), 0 0 20px rgba(251,191,36,0.30)'
    if (visualState === 'missed')
      return '0 0 8px rgba(239,68,68,0.50), 0 0 16px rgba(239,68,68,0.25)'
    return 'none'
  })()

  const isPinnedState =
    visualState === 'target' ||
    visualState === 'approaching' ||
    visualState === 'hit' ||
    visualState === 'missed' ||
    visualState === 'success'

  const textColor = (() => {
    if (isPinnedState) return '#FFFFFF'
    if (visualState === 'hovered') return accentColor
    if (visualState === 'error') return RED
    if (visualState === 'passed')
      return isAbove ? 'rgba(34,197,94,0.30)' : 'rgba(239,68,68,0.30)'
    return isAbove ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)'
  })()

  const betLabel = `$${betAmount}`

  const labelText = (() => {
    if (visualState === 'sending') return '···'
    if (visualState === 'error') return '\u2715'
    if (visualState === 'hit') return `\u2713 ${betLabel}`
    if (visualState === 'missed') return `\u2715 ${betLabel}`
    if (visualState === 'success') return betLabel
    if (visualState === 'target' || visualState === 'approaching')
      return betLabel
    return multiplier
  })()

  const isActive =
    !disabled &&
    visualState !== 'passed' &&
    visualState !== 'missed' &&
    visualState !== 'hit' &&
    visualState !== 'sending' &&
    visualState !== 'success'

  return (
    <button
      onClick={isActive ? onTap : undefined}
      onMouseEnter={isActive ? onMouseEnter : undefined}
      onMouseLeave={isActive ? onMouseLeave : undefined}
      disabled={!isActive}
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 2,
        opacity,
        boxShadow,
        transition: 'background 0.12s, border-color 0.12s, opacity 0.12s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%',
        cursor: isActive ? 'pointer' : 'default',
        userSelect: 'none',
        padding: 0,
      }}
      className={cnm(
        'select-none',
        visualState === 'target' && 'animate-pulse',
      )}
      aria-label={
        isCurrentRow
          ? 'Current price row'
          : isAbove
            ? `Bet UP ${multiplier}`
            : `Bet DOWN ${multiplier}`
      }
    >
      <span
        style={{
          color: textColor,
          fontFamily: 'monospace',
          fontSize: isPinnedState ? '11px' : '10px',
          fontWeight: isPinnedState || visualState === 'hovered' ? 700 : 500,
          letterSpacing: '0.02em',
          lineHeight: 1,
          transition: 'color 0.10s',
        }}
      >
        {labelText}
      </span>
    </button>
  )
}

// ─── EuphoriaGridView ─────────────────────────────────────────────────────────

function EuphoriaGridView({
  roundPriceHistory,
  currentPrice,
  decimals,
  pairId,
  round,
  tapStates,
  pinnedCells,
  onCellTap,
  bettingDisabled,
  userPosition,
  roundResultFlash,
  flashUserPosition,
  betAmount,
}: {
  roundPriceHistory: Array<PricePoint>
  currentPrice: OraclePrice | undefined
  decimals: number
  pairId: string
  round: Round | undefined
  tapStates: Record<string, TapState>
  pinnedCells: Array<{ row: number; col: number; price: number }>
  onCellTap: (row: number, col: number, isAbove: boolean, price: number) => void
  bettingDisabled: boolean
  userPosition: 'Bull' | 'Bear' | null
  roundResultFlash: 'BULL_WON' | 'BEAR_WON' | 'DRAW' | null
  flashUserPosition: 'Bull' | 'Bear' | null
  betAmount: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const [hoveredCell, setHoveredCell] = useState<{
    row: number
    col: number
  } | null>(null)

  // Map from column index to the raw price value recorded when the chart swept through it.
  // Converted to row index at render time so hits stay correct as the live price drifts.
  // Ref to avoid triggering re-renders on every column tick.
  const colHitRowsRef = useRef<Map<number, number>>(new Map())

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0]
      setContainerSize({
        w: entry.contentRect.width,
        h: entry.contentRect.height,
      })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const { w, h } = containerSize
  const cols = w > 0 && w < 640 ? GRID_COLS_MOBILE : GRID_COLS
  const rowH = h > 0 ? h / GRID_ROWS : 40

  const decimalDivisor = 10 ** decimals
  const rawCurrentPrice = currentPrice
    ? parseFloat(currentPrice.price) / decimalDivisor
    : null

  const step = getPairStep(pairId)
  const topPrice =
    rawCurrentPrice !== null ? rawCurrentPrice + HALF_ROWS * step : null
  const bottomPrice =
    rawCurrentPrice !== null ? rawCurrentPrice - HALF_ROWS * step : null

  // Round timing
  const roundStartTs = round ? Number(round.startTimestamp) : 0
  const colDuration = ROUND_DURATION / cols
  const { currentCol, elapsed } = useRoundClock(roundStartTs, cols)

  // Clear hit map when the round changes
  useEffect(() => {
    colHitRowsRef.current = new Map()
  }, [roundStartTs])

  // Record the raw price value for each column as the chart sweeps through it.
  // At render time we convert from price value to row index relative to the current
  // grid anchor, so past hits remain correctly positioned even as the live price drifts.
  useEffect(() => {
    if (rawCurrentPrice === null) return
    colHitRowsRef.current.set(currentCol, rawCurrentPrice)
  }, [currentCol, rawCurrentPrice])

  // Chart line grows from left: only show points within [roundStartTs, now]
  // X is mapped by timestamp, Y by price
  function priceToY(price: number): number {
    if (topPrice === null || bottomPrice === null || h === 0) return h / 2
    const range = topPrice - bottomPrice || 1
    return ((topPrice - price) / range) * h
  }

  function timestampToX(ts: number): number {
    if (w === 0 || roundStartTs === 0) return 0
    const t = Math.max(0, ts - roundStartTs)
    return Math.min(w, (t / ROUND_DURATION) * w)
  }

  // Build SVG path from round-scoped price history
  let pathD = ''
  let areaPathD = ''
  let dotX = 0
  let dotY = h / 2

  const validPoints = roundPriceHistory.filter(
    (pt) => pt.timestamp >= roundStartTs && pt.price > 0,
  )

  if (validPoints.length >= 2 && topPrice !== null && bottomPrice !== null) {
    const pts = validPoints.map((pt) => ({
      x: timestampToX(pt.timestamp),
      y: priceToY(pt.price / decimalDivisor),
    }))

    pathD = `M ${pts[0].x} ${pts[0].y}`
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]
      const curr = pts[i]
      const cpx = (prev.x + curr.x) / 2
      pathD += ` Q ${cpx} ${prev.y} ${curr.x} ${curr.y}`
    }

    areaPathD = pathD + ` L ${pts[pts.length - 1].x} ${h} L ${pts[0].x} ${h} Z`

    const last = pts[pts.length - 1]
    dotX = last.x
    dotY = last.y
  } else if (rawCurrentPrice !== null && roundStartTs > 0) {
    // Show dot at current time position
    dotX = timestampToX(Math.floor(Date.now() / 1000))
    dotY = priceToY(rawCurrentPrice)
  } else if (rawCurrentPrice !== null) {
    dotY = priceToY(rawCurrentPrice)
    dotX = 0
  }

  // Passed-time X boundary: how far the chart has swept
  const passedX =
    roundStartTs > 0
      ? Math.min(w, (Math.min(elapsed, ROUND_DURATION) / ROUND_DURATION) * w)
      : 0

  // Current column highlight X range
  const currentColX0 = (currentCol / cols) * w
  const currentColX1 = ((currentCol + 1) / cols) * w

  const pool = getPoolMultipliers(round)
  const bullMultStr = fmtMult(pool.bull)
  const bearMultStr = fmtMult(pool.bear)

  const lockTarget =
    round?.status === 'LIVE' ? round.lockTimestamp : round?.closeTimestamp
  const {
    display: countdown,
    urgent,
    critical,
    progress,
  } = useCountdown(
    round?.status === 'ENDED' || round?.status === 'CANCELLED'
      ? null
      : (lockTarget ?? null),
  )

  const timerColor = critical ? RED : urgent ? AMBER : GREEN

  const priceDisplay = currentPrice
    ? `$${formatPrice(currentPrice.price, decimals)}`
    : null

  // The Y center for the current price row
  const currentRowY = HALF_ROWS * rowH

  function getRowMeta(rowIndex: number) {
    const isCurrentRow = rowIndex === HALF_ROWS
    const isAbove = rowIndex <= HALF_ROWS // center row counts as bull (price stays = bull wins)
    const rowDistance = Math.abs(rowIndex - HALF_ROWS) // 0 = center, 1 = adjacent, 4 = farthest
    const priceLevel =
      rawCurrentPrice !== null
        ? rawCurrentPrice + (HALF_ROWS - rowIndex) * step
        : null
    return { isCurrentRow, isAbove, rowDistance, priceLevel }
  }

  // Determine per-cell visual state
  function getCellVisualState(rowIndex: number, col: number): CellVisualState {
    const cellKey = `${rowIndex}-${col}`
    const tapState = tapStates[cellKey] ?? 'idle'

    if (tapState === 'sending') return 'sending'
    if (tapState === 'error') return 'error'

    const isPinned = pinnedCells.some(
      (c) => c.row === rowIndex && c.col === col,
    )

    // Column is in the past if currentCol > col
    const isPastCol = col < currentCol
    const isCurrentColCell = col === currentCol

    if (isPinned) {
      if (isPastCol) {
        const hitPrice = colHitRowsRef.current.get(col)
        const pinnedCell = pinnedCells.find(
          (c) => c.row === rowIndex && c.col === col,
        )
        if (hitPrice !== undefined && pinnedCell !== undefined) {
          if (Math.abs(hitPrice - pinnedCell.price) <= step / 2) return 'hit'
        }
        return 'missed'
      }
      // Pinned cell stays visible for the entire round as the user's bet indicator.
      // Approaching state gives extra feedback when the chart sweeps through this column.
      if (isCurrentColCell || col === currentCol + 1) return 'approaching'
      return 'target'
    }

    if (isPastCol) return 'passed'

    // Future: check if hovered
    if (
      hoveredCell !== null &&
      hoveredCell.row === rowIndex &&
      hoveredCell.col === col
    )
      return 'hovered'

    return 'idle'
  }

  // Is the chart dot in any pinned row?
  const isPriceInPinnedRow = pinnedCells.some(
    (c) => dotY >= c.row * rowH && dotY < (c.row + 1) * rowH,
  )

  // Time labels for columns (midpoint of each column relative to round start)
  function colMidpointLabel(col: number): string {
    const midSec = (col + 0.5) * colDuration
    return fmtColTime(midSec)
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{ background: BG, minHeight: 360 }}
    >
      {w > 0 && h > 0 && (
        <>
          {/* ── SVG layer ── */}
          <svg
            className="absolute inset-0 pointer-events-none"
            width={w}
            height={h}
            aria-hidden="true"
          >
            <defs>
              <filter
                id="chartGlow"
                x="-20%"
                y="-20%"
                width="140%"
                height="140%"
              >
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              <filter id="hitGlow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              <linearGradient id="upZoneGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(34,197,94,0.08)" />
                <stop offset="100%" stopColor="rgba(34,197,94,0.03)" />
              </linearGradient>

              <linearGradient id="downZoneGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(239,68,68,0.03)" />
                <stop offset="100%" stopColor="rgba(239,68,68,0.08)" />
              </linearGradient>

              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0.00)" />
              </linearGradient>

              <linearGradient id="passedOverlay" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(15,17,21,0.35)" />
                <stop offset="100%" stopColor="rgba(15,17,21,0.20)" />
              </linearGradient>
            </defs>

            {/* 1. Zone gradient backgrounds - meet at center of price row */}
            <rect
              x={0}
              y={0}
              width={w}
              height={currentRowY + rowH / 2}
              fill="url(#upZoneGrad)"
            />
            <rect
              x={0}
              y={currentRowY + rowH / 2}
              width={w}
              height={h - currentRowY - rowH / 2}
              fill="url(#downZoneGrad)"
            />

            {/* Current price indicator line */}
            <line
              x1={0}
              y1={currentRowY + rowH / 2}
              x2={w}
              y2={currentRowY + rowH / 2}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={1}
              strokeDasharray="4,4"
            />

            {/* 2. Horizontal grid lines */}
            {Array.from({ length: GRID_ROWS + 1 }).map((_, i) => (
              <line
                key={`h-${i}`}
                x1={0}
                y1={i * rowH}
                x2={w}
                y2={i * rowH}
                stroke={GRID_LINE}
                strokeWidth={1}
              />
            ))}

            {/* Vertical grid lines */}
            {Array.from({ length: cols + 1 }).map((_, i) => (
              <line
                key={`v-${i}`}
                x1={(i / cols) * w}
                y1={0}
                x2={(i / cols) * w}
                y2={h}
                stroke={GRID_LINE}
                strokeWidth={1}
              />
            ))}

            {/* 3. Grid intersection dots */}
            {Array.from({ length: GRID_ROWS + 1 }).map((_r, row) =>
              Array.from({ length: cols + 1 }).map((_c, col) => (
                <circle
                  key={`dot-${row}-${col}`}
                  cx={(col / cols) * w}
                  cy={row * rowH}
                  r={1.5}
                  fill={ACCENT}
                  opacity={0.3}
                />
              )),
            )}

            {/* 4. UP / DOWN watermark text */}
            <text
              x={w / 2}
              y={(HALF_ROWS * rowH) / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fill={GREEN}
              opacity={0.06}
              fontSize={48}
              fontWeight={900}
              fontFamily="monospace"
            >
              UP
            </text>
            <text
              x={w / 2}
              y={HALF_ROWS * rowH + (h - HALF_ROWS * rowH) / 2 + rowH / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fill={RED}
              opacity={0.06}
              fontSize={48}
              fontWeight={900}
              fontFamily="monospace"
            >
              DOWN
            </text>

            {/* 5. Passed-time dim overlay (covers columns that have already elapsed) */}
            {passedX > 0 && (
              <rect
                x={0}
                y={0}
                width={passedX}
                height={h}
                fill="url(#passedOverlay)"
              />
            )}

            {/* 6. Current column highlight (subtle vertical glow strip) */}
            {round && round.status === 'LIVE' && (
              <rect
                x={currentColX0}
                y={0}
                width={currentColX1 - currentColX0}
                height={h}
                fill="rgba(255,255,255,0.025)"
              />
            )}

            {/* 7. Chart area fill */}
            {areaPathD && (
              <path d={areaPathD} fill="url(#areaFill)" opacity={0.4} />
            )}

            {/* 8. Chart line with glow */}
            {pathD && (
              <path
                d={pathD}
                fill="none"
                stroke={CHART_LINE}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#chartGlow)"
              />
            )}

            {/* 9. Current price dashed horizontal line */}
            {rawCurrentPrice !== null && (
              <line
                x1={0}
                y1={dotY}
                x2={w}
                y2={dotY}
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            )}

            {/* 10. Target cell connector (dashed line from chart dot to nearest upcoming pinned cell) */}
            {(() => {
              const upcomingPinned = pinnedCells
                .filter((c) => c.col >= currentCol)
                .sort((a, b) => a.col - b.col)
              if (
                upcomingPinned.length === 0 ||
                isPriceInPinnedRow ||
                validPoints.length === 0
              )
                return null
              const nextPinned = upcomingPinned[0]
              return (
                <line
                  x1={dotX}
                  y1={dotY}
                  x2={((nextPinned.col + 0.5) / cols) * w}
                  y2={nextPinned.row * rowH + rowH / 2}
                  stroke={userPosition === 'Bull' ? GREEN : RED}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  opacity={0.25}
                />
              )
            })()}

            {/* Pinned row highlight stripes when chart is in those rows */}
            {isPriceInPinnedRow &&
              pinnedCells
                .filter(
                  (c) => dotY >= c.row * rowH && dotY < (c.row + 1) * rowH,
                )
                .map((c) => (
                  <rect
                    key={`pinrow-${c.row}-${c.col}`}
                    x={0}
                    y={c.row * rowH}
                    width={w}
                    height={rowH}
                    fill={
                      userPosition === 'Bull'
                        ? 'rgba(34,197,94,0.10)'
                        : 'rgba(239,68,68,0.10)'
                    }
                  />
                ))}

            {/* 11. Chart dot with pulsing ring */}
            {(pathD || (rawCurrentPrice !== null && roundStartTs > 0)) && (
              <>
                <circle
                  cx={dotX}
                  cy={dotY}
                  r={isPriceInPinnedRow ? 6 : 4}
                  fill={
                    isPriceInPinnedRow
                      ? userPosition === 'Bull'
                        ? GREEN
                        : RED
                      : CHART_LINE
                  }
                  filter="url(#chartGlow)"
                />
                <circle
                  cx={dotX}
                  cy={dotY}
                  r={isPriceInPinnedRow ? 10 : 7}
                  fill="none"
                  stroke={
                    isPriceInPinnedRow
                      ? userPosition === 'Bull'
                        ? GREEN
                        : RED
                      : 'rgba(255,255,255,0.25)'
                  }
                  strokeWidth={1.5}
                  opacity={0.5}
                  className="animate-ping"
                />
              </>
            )}

            {/* 12. Hit effect: expanding ring when chart line hits target cell */}
            {isPriceInPinnedRow && (pathD || rawCurrentPrice !== null) && (
              <>
                <circle
                  cx={dotX}
                  cy={dotY}
                  r={14}
                  fill="none"
                  stroke={userPosition === 'Bull' ? GREEN : RED}
                  strokeWidth={2}
                  opacity={0.5}
                  className="animate-ping"
                  filter="url(#hitGlow)"
                />
                <circle
                  cx={dotX}
                  cy={dotY}
                  r={20}
                  fill="none"
                  stroke={userPosition === 'Bull' ? GREEN : RED}
                  strokeWidth={1}
                  opacity={0.3}
                  className="animate-ping"
                />
              </>
            )}

            {/* Top progress line */}
            {round && round.status === 'LIVE' && (
              <rect
                x={0}
                y={0}
                width={passedX}
                height={2}
                fill={timerColor}
                opacity={0.6}
              />
            )}
          </svg>

          {/* ── Price labels on right edge ── */}
          <div
            className="absolute right-0 top-0 h-full pointer-events-none flex flex-col z-10"
            style={{ paddingBottom: 16 }}
          >
            {Array.from({ length: GRID_ROWS }).map((_r, rowIndex) => {
              const { priceLevel, isCurrentRow } = getRowMeta(rowIndex)
              return (
                <div
                  key={rowIndex}
                  style={{ height: rowH }}
                  className="flex items-center pr-1.5"
                >
                  {priceLevel !== null && (
                    <span
                      style={{
                        color: isCurrentRow
                          ? 'rgba(255,255,255,0.55)'
                          : ACCENT_DIM,
                        fontFamily: 'monospace',
                        fontSize: '9px',
                        fontWeight: isCurrentRow ? 600 : 400,
                        background: isCurrentRow
                          ? 'rgba(255,255,255,0.08)'
                          : 'transparent',
                        padding: isCurrentRow ? '1px 3px' : '0',
                        borderRadius: isCurrentRow ? 2 : 0,
                      }}
                    >
                      ${formatPriceLevel(priceLevel, pairId)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Time labels on bottom edge ── */}
          <div
            className="absolute bottom-0 left-0 right-0 pointer-events-none z-10 flex"
            style={{ height: 16 }}
          >
            {Array.from({ length: cols }).map((_c, col) => {
              // Show every 3rd label to avoid crowding at 15 columns
              const showLabel = col % 3 === 0
              return (
                <div
                  key={col}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {showLabel && (
                    <span
                      style={{
                        color:
                          col === currentCol
                            ? 'rgba(255,255,255,0.40)'
                            : col < currentCol
                              ? 'rgba(255,255,255,0.12)'
                              : 'rgba(255,255,255,0.20)',
                        fontFamily: 'monospace',
                        fontSize: '8px',
                      }}
                    >
                      {colMidpointLabel(col)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Tappable grid cells ── */}
          <div
            className="absolute inset-0"
            style={{ paddingBottom: 16, paddingRight: 52 }}
          >
            {Array.from({ length: GRID_ROWS }).map((_r, rowIndex) => {
              const { isCurrentRow, isAbove, rowDistance } =
                getRowMeta(rowIndex)
              const multiplier = isAbove ? bullMultStr : bearMultStr

              return (
                <div
                  key={rowIndex}
                  style={{
                    height: rowH,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${cols}, 1fr)`,
                    gap: '1px',
                    padding: '1px',
                  }}
                >
                  {Array.from({ length: cols }).map((_c, col) => {
                    const visualState = getCellVisualState(rowIndex, col)

                    // Disable if: no round, not connected, opposite zone locked,
                    // must be at least 2 columns ahead of chart line to tap,
                    // or cell is already sending
                    const isNotAheadAndNotPinned =
                      col <= currentCol + 1 &&
                      !pinnedCells.some(
                        (c) => c.row === rowIndex && c.col === col,
                      )
                    const isCellSending =
                      (tapStates[`${rowIndex}-${col}`] ?? 'idle') === 'sending'

                    const isCellDisabled =
                      bettingDisabled || isNotAheadAndNotPinned || isCellSending

                    return (
                      <EuphoriaCell
                        key={`${rowIndex}-${col}`}
                        multiplier={multiplier}
                        isCurrentRow={isCurrentRow}
                        isAbove={isAbove}
                        visualState={visualState}
                        distance={rowDistance}
                        onTap={() => {
                          const pinnedPrice =
                            rawCurrentPrice !== null
                              ? rawCurrentPrice + (HALF_ROWS - rowIndex) * step
                              : 0
                          onCellTap(rowIndex, col, isAbove, pinnedPrice)
                        }}
                        onMouseEnter={() =>
                          setHoveredCell({ row: rowIndex, col })
                        }
                        onMouseLeave={() => setHoveredCell(null)}
                        disabled={isCellDisabled}
                        betAmount={betAmount}
                      />
                    )
                  })}
                </div>
              )
            })}

            {/* ── Hover tooltip ── */}
            {hoveredCell &&
              !bettingDisabled &&
              (() => {
                const { isAbove, priceLevel, isCurrentRow } = getRowMeta(
                  hoveredCell.row,
                )
                if (isCurrentRow) return null
                const mult = isAbove ? bullMultStr : bearMultStr
                const tooltipY = hoveredCell.row * rowH
                const tooltipX = ((hoveredCell.col + 0.5) / cols) * w
                const accentColor = isAbove ? GREEN : RED
                const showBelow = tooltipY < rowH * 1.5
                const colLabel = colMidpointLabel(hoveredCell.col)
                return (
                  <div
                    className="absolute pointer-events-none z-20"
                    style={{
                      left: Math.min(Math.max(tooltipX - 60, 4), w - 124),
                      top: showBelow ? tooltipY + rowH + 4 : tooltipY - 68,
                      width: 120,
                    }}
                  >
                    <div
                      style={{
                        background: 'rgba(15,17,21,0.92)',
                        border: `1px solid ${accentColor}`,
                        borderRadius: 6,
                        padding: '5px 8px',
                        backdropFilter: 'blur(8px)',
                      }}
                    >
                      <div
                        style={{
                          color: accentColor,
                          fontFamily: 'monospace',
                          fontSize: '10px',
                          fontWeight: 700,
                          marginBottom: 2,
                        }}
                      >
                        {isAbove ? '\u25B2 UP' : '\u25BC DOWN'}
                      </div>
                      {priceLevel !== null && (
                        <div
                          style={{
                            color: '#ffffff',
                            fontFamily: 'monospace',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                        >
                          ${formatPriceLevel(priceLevel, pairId)}
                        </div>
                      )}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginTop: 2,
                        }}
                      >
                        <span
                          style={{
                            color: accentColor,
                            fontFamily: 'monospace',
                            fontSize: '11px',
                            fontWeight: 700,
                          }}
                        >
                          {mult}
                        </span>
                        <span
                          style={{
                            color: 'rgba(255,255,255,0.35)',
                            fontFamily: 'monospace',
                            fontSize: '10px',
                          }}
                        >
                          {colLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })()}
          </div>

          {/* ── Top-left: price display ── */}
          <div className="absolute top-3 left-3 pointer-events-none z-10">
            {priceDisplay ? (
              <span
                style={{
                  color: '#ffffff',
                  fontFamily: 'monospace',
                  fontSize: '22px',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  textShadow: `0 0 20px ${CHART_GLOW}`,
                }}
              >
                {priceDisplay}
              </span>
            ) : (
              <div
                className="h-6 w-28 rounded animate-pulse"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              />
            )}
          </div>

          {/* ── Centered timer ── */}
          {round &&
            round.status !== 'ENDED' &&
            round.status !== 'CANCELLED' && (
              <div
                className="absolute top-3 left-1/2 pointer-events-none z-10 flex flex-col items-center gap-1"
                style={{ transform: 'translateX(-50%)' }}
              >
                <div
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: `1px solid rgba(255,255,255,0.10)`,
                  }}
                >
                  <IconClock size={11} color={timerColor} />
                  <span
                    style={{
                      color: timerColor,
                      fontFamily: 'monospace',
                      fontSize: '16px',
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      minWidth: 40,
                      textAlign: 'center',
                    }}
                  >
                    {countdown}
                  </span>
                </div>
                <div
                  style={{
                    width: 80,
                    height: 3,
                    borderRadius: 2,
                    background: 'rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${progress * 100}%`,
                      background: timerColor,
                      borderRadius: 2,
                      transition: 'width 1s linear, background 0.5s',
                    }}
                  />
                </div>
                <span
                  style={{
                    color: ACCENT_DIM,
                    fontFamily: 'monospace',
                    fontSize: '10px',
                  }}
                >
                  Epoch #{round.epoch}
                </span>
              </div>
            )}

          {/* ── Pool info bar (top-right) ── */}
          <div className="absolute top-3 right-3 pointer-events-none z-10 flex flex-col items-end gap-1.5">
            {pool.totalInit > 0 && (
              <>
                <div className="flex items-center gap-2">
                  <span
                    style={{
                      color: 'rgba(255,255,255,0.25)',
                      fontFamily: 'monospace',
                      fontSize: '10px',
                    }}
                  >
                    {fmtInit(pool.bullInit)} INIT
                  </span>
                  <span
                    style={{
                      color: GREEN,
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    {'\u25B2'} {bullMultStr}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    style={{
                      color: 'rgba(255,255,255,0.25)',
                      fontFamily: 'monospace',
                      fontSize: '10px',
                    }}
                  >
                    {fmtInit(pool.bearInit)} INIT
                  </span>
                  <span
                    style={{
                      color: RED,
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    {'\u25BC'} {bearMultStr}
                  </span>
                </div>
                <span
                  style={{
                    color: 'rgba(255,255,255,0.12)',
                    fontFamily: 'monospace',
                    fontSize: '9px',
                  }}
                >
                  {fmtInit(pool.totalInit)} INIT pool
                </span>
              </>
            )}
            {pool.totalInit === 0 && round && (
              <span
                style={{
                  color: 'rgba(255,255,255,0.2)',
                  fontFamily: 'monospace',
                  fontSize: '10px',
                }}
              >
                No bets yet
              </span>
            )}
          </div>

          {/* ── User position indicator on the current price row ── */}
          {userPosition && (
            <div
              className="absolute left-0 right-0 z-10 flex items-center justify-center pointer-events-none"
              style={{ top: currentRowY, height: rowH }}
            >
              <div
                className="flex items-center gap-2 px-4 py-1 rounded-full"
                style={{
                  background:
                    userPosition === 'Bull'
                      ? 'rgba(34,197,94,0.16)'
                      : 'rgba(239,68,68,0.16)',
                  border: `1px solid ${userPosition === 'Bull' ? 'rgba(34,197,94,0.40)' : 'rgba(239,68,68,0.40)'}`,
                  backdropFilter: 'blur(6px)',
                }}
              >
                <span
                  style={{
                    color: userPosition === 'Bull' ? GREEN : RED,
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  YOUR BET:{' '}
                  {userPosition === 'Bull' ? '\u25B2 UP' : '\u25BC DOWN'}
                </span>
              </div>
            </div>
          )}

          {/* ── Round result flash overlay ── */}
          <AnimatePresence>
            {roundResultFlash &&
              (() => {
                const userWon =
                  flashUserPosition !== null &&
                  ((flashUserPosition === 'Bull' &&
                    roundResultFlash === 'BULL_WON') ||
                    (flashUserPosition === 'Bear' &&
                      roundResultFlash === 'BEAR_WON'))
                const userLost =
                  flashUserPosition !== null &&
                  roundResultFlash !== 'DRAW' &&
                  !userWon

                const resultColor =
                  roundResultFlash === 'BULL_WON'
                    ? GREEN
                    : roundResultFlash === 'BEAR_WON'
                      ? RED
                      : ACCENT

                const resultLabel =
                  roundResultFlash === 'BULL_WON'
                    ? '\u25B2 UP WON'
                    : roundResultFlash === 'BEAR_WON'
                      ? '\u25BC DOWN WON'
                      : 'DRAW'

                return (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.04 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
                    style={{
                      background: 'rgba(15,17,21,0.65)',
                      backdropFilter: 'blur(2px)',
                    }}
                  >
                    <div
                      style={{
                        background:
                          roundResultFlash === 'BULL_WON'
                            ? 'rgba(34,197,94,0.12)'
                            : roundResultFlash === 'BEAR_WON'
                              ? 'rgba(239,68,68,0.12)'
                              : 'rgba(255,255,255,0.06)',
                        border: `1px solid ${
                          roundResultFlash === 'BULL_WON'
                            ? 'rgba(34,197,94,0.35)'
                            : roundResultFlash === 'BEAR_WON'
                              ? 'rgba(239,68,68,0.35)'
                              : 'rgba(255,255,255,0.15)'
                        }`,
                        borderRadius: 16,
                        padding: '20px 40px',
                        textAlign: 'center',
                      }}
                    >
                      <div
                        style={{
                          color: resultColor,
                          fontFamily: 'monospace',
                          fontSize: '28px',
                          fontWeight: 900,
                          letterSpacing: '0.04em',
                        }}
                      >
                        {resultLabel}
                      </div>
                      {flashUserPosition !== null && (
                        <div
                          style={{
                            color: userWon
                              ? GREEN
                              : userLost
                                ? RED
                                : ACCENT_DIM,
                            fontFamily: 'monospace',
                            fontSize: '13px',
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            marginTop: 8,
                            textTransform: 'uppercase',
                          }}
                        >
                          {userWon
                            ? 'You won'
                            : userLost
                              ? 'You lost'
                              : 'No payout'}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )
              })()}
          </AnimatePresence>

          {/* ── Collecting data placeholder ── */}
          {validPoints.length < 2 && roundStartTs > 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span
                style={{
                  color: ACCENT_DIM,
                  fontFamily: 'monospace',
                  fontSize: '11px',
                }}
              >
                Collecting data...
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── AutoSignModal ────────────────────────────────────────────────────────────

function AutoSignModal({
  onEnable,
  onSkip,
  enabling,
  error,
}: {
  onEnable: () => void
  onSkip: () => void
  enabling: boolean
  error: string | null
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-40 flex items-center justify-center"
      style={{
        background: 'rgba(10,12,16,0.85)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.96 }}
        transition={{ duration: 0.25, ease: EASE_OUT_CUBIC }}
        style={{
          background: 'rgba(25,28,34,0.95)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
          padding: '32px 28px',
          maxWidth: 360,
          width: '90%',
          textAlign: 'center',
        }}
      >
        <h3
          style={{
            color: '#ffffff',
            fontFamily: 'monospace',
            fontSize: '16px',
            fontWeight: 700,
            letterSpacing: '0.02em',
            margin: '0 0 8px',
          }}
        >
          Enable Instant Mode
        </h3>

        <p
          style={{
            color: 'rgba(255,255,255,0.45)',
            fontFamily: 'monospace',
            fontSize: '12px',
            lineHeight: 1.5,
            margin: '0 0 6px',
          }}
        >
          Tap to trade without wallet popups. One-time setup creates a session
          key for seamless gameplay.
        </p>

        <div
          style={{
            display: 'flex',
            gap: 6,
            justifyContent: 'center',
            marginBottom: 20,
          }}
        >
          {['No popups', 'Instant bets', 'Session-based'].map((tag) => (
            <span
              key={tag}
              style={{
                color: GREEN,
                fontFamily: 'monospace',
                fontSize: '9px',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '3px 8px',
                borderRadius: 4,
                background: 'rgba(34,197,94,0.08)',
                border: '1px solid rgba(34,197,94,0.15)',
              }}
            >
              {tag}
            </span>
          ))}
        </div>

        {error && (
          <div
            style={{
              color: RED,
              fontFamily: 'monospace',
              fontSize: '11px',
              marginBottom: 12,
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.15)',
            }}
          >
            {error}
          </div>
        )}

        <button
          onClick={onEnable}
          disabled={enabling}
          className="w-full py-3 rounded-lg font-mono text-[13px] uppercase tracking-[0.08em] transition-all duration-200 disabled:opacity-50"
          style={{
            background: enabling
              ? 'rgba(34,197,94,0.10)'
              : 'rgba(34,197,94,0.15)',
            border: '1px solid rgba(34,197,94,0.40)',
            color: GREEN,
            cursor: enabling ? 'default' : 'pointer',
            fontWeight: 700,
          }}
        >
          {enabling ? 'Setting up...' : 'Enable Instant Mode'}
        </button>

        <button
          onClick={onSkip}
          disabled={enabling}
          className="mt-3 w-full py-2 font-mono text-[11px] transition-colors duration-150"
          style={{
            color: 'rgba(255,255,255,0.25)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Skip for now
        </button>
      </motion.div>
    </motion.div>
  )
}

// ─── EuphoriaGridConnected ─────────────────────────────────────────────────────

function EuphoriaGridConnected({
  roundPriceHistory,
  currentPrice,
  decimals,
  pairId,
  round,
  previousRound,
}: {
  roundPriceHistory: Array<PricePoint>
  currentPrice: OraclePrice | undefined
  decimals: number
  pairId: string
  round: Round | undefined
  previousRound: Round | null | undefined
}) {
  const { isConnected, requestTxBlock, initiaAddress, autoSign } =
    useInterwovenKit()
  const autoSignEnabled = autoSign.isEnabledByChain['evm-1'] ?? false

  const [autoSignDismissed, setAutoSignDismissed] = useState(false)
  const [autoSignEnabling, setAutoSignEnabling] = useState(false)
  const [autoSignError, setAutoSignError] = useState<string | null>(null)
  const [autoSignSuccess, setAutoSignSuccess] = useState(false)

  const [tapStates, setTapStates] = useState<Record<string, TapState>>({})
  const [betError, setBetError] = useState<string | null>(null)
  const [pinnedCells, setPinnedCells] = useState<
    Array<{ row: number; col: number; price: number }>
  >([])
  const [userPosition, setUserPosition] = useState<'Bull' | 'Bear' | null>(null)
  const betAmount = config.betting.minBetInit
  const [roundResultFlash, setRoundResultFlash] = useState<
    'BULL_WON' | 'BEAR_WON' | 'DRAW' | null
  >(null)
  // Snapshot of userPosition at the moment the round ended, used for win/loss display
  const [flashUserPosition, setFlashUserPosition] = useState<
    'Bull' | 'Bear' | null
  >(null)

  const lastEpochRef = useRef<number | null>(null)
  const prevRoundEpochRef = useRef<number | null>(null)

  const bettingDisabled = !isConnected || !round || round.status !== 'LIVE'

  const showAutoSignBanner =
    isConnected && !autoSignEnabled && !autoSignDismissed && !autoSignSuccess

  // Clear state on epoch change
  useEffect(() => {
    const epoch = round?.epoch ?? null
    if (epoch !== null && epoch !== lastEpochRef.current) {
      lastEpochRef.current = epoch
      setPinnedCells([])
      setTapStates({})
      setUserPosition(null)
    }
  }, [round?.epoch])

  // Track user position from bets — only update when we have a confirmed bet,
  // never clear mid-round so the indicator persists. Epoch change effect clears it.
  useEffect(() => {
    if (!round?.bets || !initiaAddress) return
    const cosmosAddr = initiaAddress.toLowerCase()
    const userBet = round.bets.find(
      (b) => b.userAddress.toLowerCase() === cosmosAddr,
    )
    if (userBet) setUserPosition(userBet.position)
  }, [round, initiaAddress])

  // Show round result flash when previous round changes
  useEffect(() => {
    if (!previousRound || previousRound.status !== 'ENDED') return
    const epoch = previousRound.epoch
    if (epoch === prevRoundEpochRef.current) return
    prevRoundEpochRef.current = epoch

    // Snapshot the user's position for win/loss display
    setFlashUserPosition(userPosition)

    // If prices are missing (indexer lag), show a pending result and update
    // when they arrive. We still show the overlay immediately.
    if (!previousRound.lockPrice || !previousRound.closePrice) {
      setRoundResultFlash(null) // will be set once prices arrive via the next effect
      return
    }

    const lock = parseFloat(previousRound.lockPrice)
    const close = parseFloat(previousRound.closePrice)
    if (lock === 0) return

    const result: 'BULL_WON' | 'BEAR_WON' | 'DRAW' =
      close > lock ? 'BULL_WON' : close < lock ? 'BEAR_WON' : 'DRAW'
    setRoundResultFlash(result)
    setTimeout(() => setRoundResultFlash(null), 5000)
  }, [previousRound, userPosition])

  // Fallback: if prices arrive late, update the flash result
  useEffect(() => {
    if (!previousRound || previousRound.status !== 'ENDED') return
    if (previousRound.epoch !== prevRoundEpochRef.current) return
    if (!previousRound.lockPrice || !previousRound.closePrice) return
    if (roundResultFlash !== null) return // already set

    const lock = parseFloat(previousRound.lockPrice)
    const close = parseFloat(previousRound.closePrice)
    if (lock === 0) return

    const result: 'BULL_WON' | 'BEAR_WON' | 'DRAW' =
      close > lock ? 'BULL_WON' : close < lock ? 'BEAR_WON' : 'DRAW'
    setRoundResultFlash(result)
    setTimeout(() => setRoundResultFlash(null), 5000)
  }, [previousRound, roundResultFlash])

  // Auto-dismiss success banner
  useEffect(() => {
    if (!autoSignSuccess) return
    const id = setTimeout(() => {
      setAutoSignSuccess(false)
      setAutoSignDismissed(true)
    }, 2000)
    return () => clearTimeout(id)
  }, [autoSignSuccess])

  async function handleEnableAutoSign() {
    setAutoSignEnabling(true)
    setAutoSignError(null)

    // Clean up any partial state from a previous failed enable attempt.
    // If auto-sign shows as already enabled, disable it first so the
    // subsequent enable starts from a clean slate.
    if (autoSign.isEnabledByChain['evm-1']) {
      try {
        await autoSign.disable('evm-1')
      } catch {
        // If disable fails (e.g. grant not found), continue with enable
      }
    }

    // Retry with exponential backoff. The testnet RPC is load-balanced
    // across multiple nodes that can lag behind by 1-2 blocks, causing
    // the ABCI account query to return a stale sequence number.
    const MAX_RETRIES = 4
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await autoSign.enable('evm-1')
        setAutoSignSuccess(true)
        setAutoSignEnabling(false)
        return
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to enable'
        const isSequenceMismatch = msg.includes('account sequence mismatch')

        if (isSequenceMismatch && attempt < MAX_RETRIES - 1) {
          // Exponential backoff: 3s, 6s, 12s. Gives load-balanced nodes
          // time to sync to the same block height.
          const delay = 3000 * Math.pow(2, attempt)
          await new Promise((r) => setTimeout(r, delay))
          continue
        }

        setAutoSignError(
          isSequenceMismatch
            ? 'Sequence sync issue, please try again in a few seconds'
            : msg,
        )
      }
    }

    setAutoSignEnabling(false)
  }

  const placeBet = useCallback(
    async (rowIndex: number, col: number, isAbove: boolean, price: number) => {
      if (!isConnected || !initiaAddress || !round) return
      const cellKey = `${rowIndex}-${col}`
      setPinnedCells((prev) => [...prev, { row: rowIndex, col, price }])
      setTapStates((prev) => ({ ...prev, [cellKey]: 'sending' }))

      try {
        const fn = isAbove ? 'betBull' : 'betBear'
        const pairHash = getPairHash(pairId)
        console.log('[PlaceBet] Sending:', {
          fn,
          pairId,
          pairHash,
          epoch: round.epoch,
          roundStatus: round.status,
          sender: initiaAddress,
          contract: TAP_PREDICTOR,
          betInit: config.betting.minBetInit,
          autoSign: autoSign.isEnabledByChain['evm-1'] ?? false,
        })
        const calldata = encodeFunctionData({
          abi: TAP_PREDICTOR_ABI,
          functionName: fn,
          args: [pairHash, BigInt(round.epoch)],
        })
        const amountWei = parseEther(String(config.betting.minBetInit))

        const messages = [
          {
            typeUrl: '/minievm.evm.v1.MsgCall',
            value: MsgCall.fromPartial({
              sender: initiaAddress,
              contractAddr: TAP_PREDICTOR,
              input: calldata,
              value: amountWei.toString(),
              accessList: [],
              authList: [],
            }),
          },
        ]

        // Use requestTxBlock for both auto-sign and manual paths.
        // When auto-sign is active, the SDK auto-approves via the ghost wallet.
        // When it's not, the user gets the manual approval drawer.
        // The SDK handles gas estimation, fee computation, and sequence tracking.
        await requestTxBlock({
          messages,
          chainId: 'evm-1',
          gasAdjustment: 1.3,
        })

        setUserPosition(isAbove ? 'Bull' : 'Bear')
        setTapStates((prev) => ({ ...prev, [cellKey]: 'success' }))
        // Keep success state for the full round — cleared on epoch change
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error('[PlaceBet] TX failed:', errMsg, err)
        console.error('[PlaceBet] Context:', {
          pairId,
          epoch: round.epoch,
          roundStatus: round.status,
          isAbove,
          initiaAddress,
          autoSignEnabled: autoSign.isEnabledByChain['evm-1'],
        })
        // Show error on the UI so it's visible without console
        const shortErr =
          errMsg.length > 120 ? errMsg.slice(0, 120) + '...' : errMsg
        setBetError(shortErr)
        setTapStates((prev) => ({ ...prev, [cellKey]: 'error' }))
        setTimeout(() => {
          setTapStates((prev) => ({ ...prev, [cellKey]: 'idle' }))
          setPinnedCells((prev) =>
            prev.filter((c) => !(c.row === rowIndex && c.col === col)),
          )
          setBetError(null)
        }, 8000)
      }
    },
    [isConnected, initiaAddress, round, pairId, requestTxBlock, autoSign],
  )

  return (
    <div className="relative w-full flex-1 min-h-0 flex flex-col">
      {/* Bet error banner */}
      {betError && (
        <div
          className="absolute top-2 left-2 right-2 z-50 bg-red-900/90 border border-red-500 rounded-lg px-4 py-3 text-sm text-white font-mono shadow-lg backdrop-blur-sm"
          style={{ wordBreak: 'break-all' }}
        >
          <div className="font-bold text-red-300 mb-1">Bet failed:</div>
          {betError}
        </div>
      )}
      <div className="flex-1 min-h-0 relative">
        <EuphoriaGridView
          roundPriceHistory={roundPriceHistory}
          currentPrice={currentPrice}
          decimals={decimals}
          pairId={pairId}
          round={round}
          tapStates={tapStates}
          pinnedCells={pinnedCells}
          onCellTap={placeBet}
          bettingDisabled={bettingDisabled}
          userPosition={userPosition}
          roundResultFlash={roundResultFlash}
          flashUserPosition={flashUserPosition}
          betAmount={betAmount}
        />

        {/* Auto-sign modal overlay */}
        <AnimatePresence>
          {showAutoSignBanner && (
            <AutoSignModal
              onEnable={handleEnableAutoSign}
              onSkip={() => setAutoSignDismissed(true)}
              enabling={autoSignEnabling}
              error={autoSignError}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── EuphoriaGrid ─────────────────────────────────────────────────────────────

function EuphoriaGrid({
  roundPriceHistory,
  currentPrice,
  decimals,
  pairId,
  round,
  previousRound,
}: {
  roundPriceHistory: Array<PricePoint>
  currentPrice: OraclePrice | undefined
  decimals: number
  pairId: string
  round: Round | undefined
  previousRound: Round | null | undefined
}) {
  const walletReady = useWalletReady()

  if (!walletReady) {
    return (
      <div
        className="flex-1 min-h-0 animate-pulse"
        style={{ background: BG, border: `1px solid ${GRID_LINE}` }}
      />
    )
  }

  return (
    <EuphoriaGridConnected
      roundPriceHistory={roundPriceHistory}
      currentPrice={currentPrice}
      decimals={decimals}
      pairId={pairId}
      round={round}
      previousRound={previousRound}
    />
  )
}

// ─── ConnectPrompt ────────────────────────────────────────────────────────────

function ConnectPrompt() {
  const walletReady = useWalletReady()
  if (!walletReady) return null
  return <ConnectPromptInner />
}

function ConnectPromptInner() {
  const { isConnected, openConnect } = useInterwovenKit()
  const { token } = useAuth()

  if (isConnected && token) return null

  if (!isConnected) {
    return (
      <button
        onClick={openConnect}
        className="px-3 py-1.5 rounded-lg font-mono text-[11px] uppercase tracking-[0.08em] transition-colors duration-200"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: `1px solid rgba(255,255,255,0.15)`,
          color: ACCENT,
        }}
      >
        Connect
      </button>
    )
  }

  return null
}

// ─── ClaimBar ─────────────────────────────────────────────────────────────────

function ClaimBar({ pairId }: { pairId: string }) {
  const walletReady = useWalletReady()
  if (!walletReady) return null
  return <ClaimBarInner pairId={pairId} />
}

function ClaimBarInner({ pairId: _pairId }: { pairId: string }) {
  const { isConnected, requestTxBlock, initiaAddress } = useInterwovenKit()
  const { token } = useAuth()
  const [claiming, setClaiming] = useState(false)
  const [claimResult, setClaimResult] = useState<'success' | 'error' | null>(
    null,
  )

  const { data: claimableData, refetch } = useQuery({
    queryKey: ['claimable', token],
    queryFn: () =>
      token ? getClaimable(token) : Promise.resolve({ claimable: [] }),
    enabled: !!token && isConnected,
    refetchInterval: 10_000,
    staleTime: 5_000,
  })

  const claimable = claimableData?.claimable ?? []

  if (!isConnected || !token || claimable.length === 0) return null

  const totalClaimable = claimable.reduce(
    (sum, c) => sum + weiToInit(c.amount),
    0,
  )

  async function handleClaim() {
    if (!initiaAddress || claiming) return
    setClaiming(true)
    setClaimResult(null)

    try {
      const pairHashes = claimable.map((c) => getPairHash(c.pairName))
      const epochs = claimable.map((c) => BigInt(c.epoch))

      const calldata = encodeFunctionData({
        abi: TAP_PREDICTOR_ABI,
        functionName: 'claim',
        args: [pairHashes, epochs],
      })

      await requestTxBlock({
        messages: [
          {
            typeUrl: '/minievm.evm.v1.MsgCall',
            value: MsgCall.fromPartial({
              sender: initiaAddress,
              contractAddr: TAP_PREDICTOR,
              input: calldata,
              value: '0',
              accessList: [],
              authList: [],
            }),
          },
        ],
        chainId: 'evm-1',
        gasAdjustment: 1.3,
      })

      setClaimResult('success')
      refetch()
      setTimeout(() => setClaimResult(null), 3000)
    } catch {
      setClaimResult('error')
      setTimeout(() => setClaimResult(null), 3000)
    } finally {
      setClaiming(false)
    }
  }

  return (
    <div
      className="flex items-center justify-between px-4 py-2 flex-shrink-0"
      style={{
        borderTop: `1px solid ${GRID_LINE}`,
        background: 'rgba(34,197,94,0.04)',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          style={{
            color: GREEN,
            fontFamily: 'monospace',
            fontSize: '11px',
            fontWeight: 600,
          }}
        >
          {fmtInit(totalClaimable)} INIT claimable
        </span>
        <span
          style={{
            color: 'rgba(255,255,255,0.2)',
            fontFamily: 'monospace',
            fontSize: '10px',
          }}
        >
          ({claimable.length} round{claimable.length !== 1 ? 's' : ''})
        </span>
      </div>
      <button
        onClick={handleClaim}
        disabled={claiming}
        className="px-4 py-1.5 rounded-lg font-mono text-[11px] uppercase tracking-[0.08em] transition-all duration-200 disabled:opacity-50"
        style={{
          background:
            claimResult === 'success'
              ? 'rgba(34,197,94,0.2)'
              : claimResult === 'error'
                ? 'rgba(239,68,68,0.15)'
                : 'rgba(34,197,94,0.12)',
          border: `1px solid ${
            claimResult === 'success'
              ? 'rgba(34,197,94,0.5)'
              : claimResult === 'error'
                ? 'rgba(239,68,68,0.3)'
                : 'rgba(34,197,94,0.3)'
          }`,
          color: claimResult === 'error' ? RED : GREEN,
        }}
      >
        {claiming
          ? 'Claiming...'
          : claimResult === 'success'
            ? 'Claimed!'
            : claimResult === 'error'
              ? 'Failed'
              : 'Claim All'}
      </button>
    </div>
  )
}

// ─── BridgeBanner ─────────────────────────────────────────────────────────────

function BridgeBanner() {
  const walletReady = useWalletReady()
  if (!walletReady) return null
  return <BridgeBannerInner />
}

function BridgeBannerInner() {
  const { isConnected, openBridge, openConnect } = useInterwovenKit()

  return (
    <div
      className="flex items-center justify-between px-4 py-2 flex-shrink-0"
      style={{
        borderTop: `1px solid ${GRID_LINE}`,
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          style={{
            color: ACCENT,
            fontFamily: 'monospace',
            fontSize: '11px',
            fontWeight: 600,
          }}
        >
          Bridge assets from any chain
        </span>
        <span
          style={{
            color: 'rgba(255,255,255,0.25)',
            fontFamily: 'monospace',
            fontSize: '10px',
          }}
        >
          Powered by Interwoven Bridge
        </span>
      </div>
      <button
        onClick={() => (isConnected ? openBridge() : openConnect())}
        className="px-4 py-1.5 rounded-lg font-mono text-[11px] uppercase tracking-[0.08em] transition-all duration-200"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.15)',
          color: ACCENT,
        }}
      >
        {isConnected ? 'Open Bridge' : 'Connect Wallet'}
      </button>
    </div>
  )
}

// ─── TradePage ────────────────────────────────────────────────────────────────

function TradePage() {
  const [selectedPair, setSelectedPair] = useState(PAIRS[0].id)
  const [roundPriceHistory, setRoundPriceHistory] = useState<Array<PricePoint>>(
    [],
  )
  const lastPriceRef = useRef<string | null>(null)
  const lastEpochForHistoryRef = useRef<number | null>(null)

  const { data: prices } = useQuery({
    queryKey: ['prices'],
    queryFn: getPrices,
    refetchInterval: 5000,
    staleTime: 3000,
    retry: false,
  })

  const selectedPairHash = getPairHash(selectedPair)

  const { data: currentRoundData } = useQuery({
    queryKey: ['round', 'current', selectedPair],
    queryFn: () => getCurrentRound(selectedPairHash),
    refetchInterval: 3000,
    staleTime: 2000,
    retry: false,
  })

  const currentPrice = prices?.find((p) => p.id === selectedPair)
  const pairDecimals = currentPrice?.decimals ?? 8
  const round = currentRoundData?.round
  const previousRound = currentRoundData?.previousRound

  // Clear price history on pair switch
  useEffect(() => {
    setRoundPriceHistory([])
    lastPriceRef.current = null
    lastEpochForHistoryRef.current = null
  }, [selectedPair])

  // Clear price history when epoch changes (new round = fresh chart)
  useEffect(() => {
    const epoch = round?.epoch ?? null
    if (epoch !== null && epoch !== lastEpochForHistoryRef.current) {
      lastEpochForHistoryRef.current = epoch
      setRoundPriceHistory([])
      lastPriceRef.current = null
    }
  }, [round?.epoch])

  // Accumulate round-scoped price points
  useEffect(() => {
    if (!currentPrice) return
    if (currentPrice.price === lastPriceRef.current) return
    lastPriceRef.current = currentPrice.price

    const raw = parseFloat(currentPrice.price)
    if (isNaN(raw)) return

    const now = Math.floor(Date.now() / 1000)
    const roundStartTs = round ? Number(round.startTimestamp) : 0

    // Only record points that are within the current round's time window
    if (roundStartTs > 0 && now < roundStartTs) return

    setRoundPriceHistory((prev) => {
      if (prev.length === 0 && roundStartTs > 0) {
        // Anchor chart to left edge: synthetic point at round start
        return [
          { price: raw, timestamp: roundStartTs },
          { price: raw, timestamp: now },
        ]
      }
      // Keep at most 120 points (5s polling * 120 = 10min, well above round duration)
      const next = [...prev, { price: raw, timestamp: now }]
      return next.length > 120 ? next.slice(next.length - 120) : next
    })
  }, [currentPrice, round])

  const betAmount = config.betting.minBetInit

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        background: BG,
        height: 'calc(100vh - 112px)',
      }}
    >
      {/* Top bar */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: EASE_OUT_CUBIC }}
        className="flex items-center justify-between px-4 py-2 flex-shrink-0"
        style={{ borderBottom: `1px solid ${GRID_LINE}` }}
      >
        <div className="flex gap-1">
          {PAIRS.map((pair) => (
            <button
              key={pair.id}
              onClick={() => setSelectedPair(pair.id)}
              className="px-3 py-1 rounded-md font-mono text-[12px] transition-colors duration-150"
              style={{
                background:
                  selectedPair === pair.id
                    ? 'rgba(255,255,255,0.08)'
                    : 'transparent',
                border: `1px solid ${
                  selectedPair === pair.id
                    ? 'rgba(255,255,255,0.20)'
                    : 'transparent'
                }`,
                color:
                  selectedPair === pair.id ? ACCENT : 'rgba(255,255,255,0.35)',
              }}
            >
              {pair.label}
              <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10 }}>
                /USD
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div
            className="px-2.5 py-1 rounded-full font-mono text-[11px]"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid rgba(255,255,255,0.10)`,
              color: ACCENT_DIM,
            }}
          >
            {betAmount} INIT / tap
          </div>
          <ConnectPrompt />
        </div>
      </motion.div>

      {/* Main grid area */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: EASE_OUT_CUBIC, delay: 0.05 }}
        className="flex-1 min-h-0 flex flex-col"
      >
        <EuphoriaGrid
          roundPriceHistory={roundPriceHistory}
          currentPrice={currentPrice}
          decimals={pairDecimals}
          pairId={selectedPair}
          round={round}
          previousRound={previousRound}
        />
      </motion.div>

      {/* Claim bar */}
      <ClaimBar pairId={selectedPair} />

      {/* Bridge banner */}
      <BridgeBanner />
    </div>
  )
}
