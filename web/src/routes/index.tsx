import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { useInterwovenKit } from '@initia/interwovenkit-react'

import { fromBaseUnit } from '@initia/utils'
import { getPlatformStats, getPrices } from '@/lib/api'
import AnimateComponent from '@/components/elements/AnimateComponent'
import Navbar from '@/components/Navbar'
import { useWalletReady } from '@/providers/WalletReadyContext'
import { formatUiNumber } from '@/utils/format'
import { EASE_OUT_QUINT } from '@/config/animation'

export const Route = createFileRoute('/')({ component: LandingPage })

function formatOraclePrice(raw: string, decimals: number): string {
  const val = parseFloat(raw) / 10 ** decimals
  if (val >= 1000) {
    return val.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }
  if (val >= 1) return val.toFixed(2)
  return val.toFixed(4)
}

const FEATURES = [
  {
    title: 'Slinky Oracle',
    desc: "Real-time prices from Initia's native Slinky oracle. Tamper-proof, on-chain, instant.",
  },
  {
    title: 'AI Agents',
    desc: 'Copy top-performing AI trading agents. Subscribe and let algorithms trade for you.',
  },
  {
    title: 'AutoSign',
    desc: 'Bet without wallet popups. InterwovenKit AutoSign keeps you in the flow.',
  },
  {
    title: 'Cross-chain',
    desc: 'Bridge assets from any Initia chain. One interface, many layers.',
  },
]

// Safe wrapper: only renders wallet-connected CTA when provider is ready
function HeroCTA() {
  const walletReady = useWalletReady()
  if (!walletReady) {
    return (
      <div className="flex items-center gap-4">
        <div className="w-36 h-11 bg-white/10 rounded-lg" />
        <div className="w-28 h-11 bg-white/5 border border-white/10 rounded-lg" />
      </div>
    )
  }
  return <HeroCTAConnected />
}

function HeroCTAConnected() {
  const { isConnected, openConnect } = useInterwovenKit()

  if (isConnected) {
    return (
      <div className="flex items-center gap-4 flex-wrap">
        <Link
          to="/trade"
          className="bg-white text-[#1f2228] font-mono text-[13px] uppercase tracking-[0.08em] px-6 py-3 rounded-lg hover:bg-white/90 transition-colors duration-200"
        >
          Start Trading
        </Link>
        <Link
          to="/agents"
          className="bg-transparent text-white border border-white/20 font-mono text-[13px] uppercase tracking-[0.08em] px-6 py-3 rounded-lg hover:bg-white/5 hover:border-white/30 transition-colors duration-200"
        >
          View Agents
        </Link>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <motion.button
        onClick={openConnect}
        whileTap={{ scale: 0.97 }}
        transition={{ duration: 0.1 }}
        className="bg-white text-[#1f2228] font-mono text-[13px] uppercase tracking-[0.08em] px-6 py-3 rounded-lg hover:bg-white/90 transition-colors duration-200"
      >
        Connect Wallet
      </motion.button>
      <Link
        to="/agents"
        className="bg-transparent text-white border border-white/20 font-mono text-[13px] uppercase tracking-[0.08em] px-6 py-3 rounded-lg hover:bg-white/5 hover:border-white/30 transition-colors duration-200"
      >
        View Agents
      </Link>
    </div>
  )
}

function BridgeButton() {
  const walletReady = useWalletReady()
  if (!walletReady)
    return <div className="w-28 h-9 bg-white/5 rounded-lg shrink-0" />
  return <BridgeButtonConnected />
}

function BridgeButtonConnected() {
  const { isConnected, openBridge, openConnect } = useInterwovenKit()

  if (isConnected) {
    return (
      <motion.button
        onClick={() => openBridge()}
        whileTap={{ scale: 0.97 }}
        transition={{ duration: 0.1 }}
        className="bg-transparent text-white border border-white/20 font-mono text-[13px] uppercase tracking-[0.08em] px-5 py-2.5 rounded-lg hover:bg-white/5 hover:border-white/30 transition-colors duration-200 shrink-0"
      >
        Open Bridge
      </motion.button>
    )
  }

  return (
    <motion.button
      onClick={openConnect}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.1 }}
      className="bg-transparent text-white border border-white/20 font-mono text-[13px] uppercase tracking-[0.08em] px-5 py-2.5 rounded-lg hover:bg-white/5 hover:border-white/30 transition-colors duration-200 shrink-0"
    >
      Connect to Bridge
    </motion.button>
  )
}

function BottomCTA() {
  const walletReady = useWalletReady()
  if (!walletReady)
    return <div className="w-48 h-11 bg-white/10 rounded-lg mx-auto" />
  return <BottomCTAConnected />
}

function BottomCTAConnected() {
  const { isConnected, openConnect } = useInterwovenKit()

  if (isConnected) {
    return (
      <Link
        to="/trade"
        className="inline-block bg-white text-[#1f2228] font-mono text-[13px] uppercase tracking-[0.08em] px-8 py-3 rounded-lg hover:bg-white/90 transition-colors duration-200"
      >
        Open Trading Dashboard
      </Link>
    )
  }

  return (
    <motion.button
      onClick={openConnect}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.1 }}
      className="bg-white text-[#1f2228] font-mono text-[13px] uppercase tracking-[0.08em] px-8 py-3 rounded-lg hover:bg-white/90 transition-colors duration-200"
    >
      Connect Wallet
    </motion.button>
  )
}

function LandingPage() {
  const { data: stats } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: getPlatformStats,
    staleTime: 30_000,
    retry: false,
  })

  const { data: prices } = useQuery({
    queryKey: ['prices'],
    queryFn: getPrices,
    refetchInterval: 5000,
    staleTime: 3000,
    retry: false,
  })

  const btcPrice = prices?.find((p) => p.id === 'BTC/USD')
  const ethPrice = prices?.find((p) => p.id === 'ETH/USD')
  const solPrice = prices?.find((p) => p.id === 'SOL/USD')

  return (
    <div className="min-h-screen bg-[#1f2228]">
      <Navbar />

      {/* Hero */}
      <section className="pt-28 pb-20 px-4 md:px-6 max-w-7xl mx-auto">
        <div className="max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE_OUT_QUINT }}
          >
            <div className="flex items-center gap-2 mb-8">
              <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-live-pulse" />
              <span className="font-sans text-[12px] uppercase tracking-[0.08em] text-white/40 font-medium">
                Live on Initia Testnet
              </span>
            </div>

            <h1 className="font-mono text-[56px] md:text-[72px] font-light leading-[1.05] tracking-[-0.04em] text-white mb-6">
              Tap to predict.
              <br />
              Win on Initia.
            </h1>

            <p className="font-sans text-[17px] tracking-[-0.01em] text-white/50 leading-[1.6] mb-10 max-w-xl">
              Price prediction trading powered by Slinky oracle. Bull or Bear —
              tap your call, watch the market decide.
            </p>

            <HeroCTA />
          </motion.div>
        </div>

        {/* Live price display */}
        {prices && prices.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="mt-16 flex flex-wrap gap-4"
          >
            {btcPrice && (
              <div className="bg-white/3 border border-white/10 rounded-xl px-5 py-4">
                <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-1">
                  BTC / USD
                </p>
                <p className="font-mono text-[28px] tracking-[-0.02em] text-white tabular-nums">
                  ${formatOraclePrice(btcPrice.price, btcPrice.decimals)}
                </p>
              </div>
            )}
            {ethPrice && (
              <div className="bg-white/3 border border-white/10 rounded-xl px-5 py-4">
                <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-1">
                  ETH / USD
                </p>
                <p className="font-mono text-[28px] tracking-[-0.02em] text-white tabular-nums">
                  ${formatOraclePrice(ethPrice.price, ethPrice.decimals)}
                </p>
              </div>
            )}
            {solPrice && (
              <div className="bg-white/3 border border-white/10 rounded-xl px-5 py-4">
                <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-1">
                  SOL / USD
                </p>
                <p className="font-mono text-[28px] tracking-[-0.02em] text-white tabular-nums">
                  ${formatOraclePrice(solPrice.price, solPrice.decimals)}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </section>

      {/* Stats bar */}
      <section className="border-y border-white/6 bg-[#191b20]">
        <div className="max-w-7xl mx-auto py-6 px-4 md:px-6 grid grid-cols-2 md:grid-cols-3 gap-6 md:gap-8">
          <StatItem
            label="Total Bets"
            value={
              stats
                ? formatUiNumber(stats.totalBets, '', {
                    humanize: true,
                    humanizeThreshold: 1000,
                  })
                : '—'
            }
          />
          <StatItem
            label="Total Volume"
            value={
              stats
                ? `$${formatUiNumber(parseFloat(fromBaseUnit(stats.totalVolume, { decimals: 18 })), '', { humanize: true, humanizeThreshold: 1000 })}`
                : '—'
            }
          />
          <StatItem
            label="Active Pairs"
            value={stats ? String(stats.activePairs.length) : '—'}
          />
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4 md:px-6 max-w-7xl mx-auto">
        <AnimateComponent onScroll entry="fadeInUp">
          <h2 className="font-sans text-2xl font-semibold tracking-[-0.02em] text-white mb-3">
            Built on Initia
          </h2>
          <p className="font-sans text-[15px] tracking-[-0.01em] text-white/50 mb-10">
            Native features, not afterthoughts.
          </p>
        </AnimateComponent>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((feature, i) => (
            <AnimateComponent
              key={feature.title}
              onScroll
              entry="fadeInUp"
              delay={i * 80}
            >
              <div className="bg-white/3 rounded-xl p-5 transition-colors duration-200 h-full">
                <h3 className="font-sans text-[15px] font-semibold tracking-[-0.01em] text-white mb-2">
                  {feature.title}
                </h3>
                <p className="font-sans text-[13px] tracking-[-0.01em] text-white/50 leading-[1.6]">
                  {feature.desc}
                </p>
              </div>
            </AnimateComponent>
          ))}
        </div>
      </section>

      {/* Bridge CTA */}
      <section className="py-12 px-4 md:px-6 max-w-7xl mx-auto">
        <AnimateComponent onScroll entry="fadeInUp">
          <div className="bg-white/3 rounded-xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div>
                <p className="font-sans text-[15px] font-semibold tracking-[-0.01em] text-white mb-0.5">
                  Bridge assets from any chain
                </p>
                <p className="font-sans text-[13px] text-white/40 tracking-[-0.01em]">
                  Powered by the Interwoven Bridge. Deposit INIT and start
                  trading in seconds.
                </p>
              </div>
            </div>
            <BridgeButton />
          </div>
        </AnimateComponent>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 md:px-6 max-w-7xl mx-auto">
        <AnimateComponent onScroll entry="fadeInUp">
          <div className="bg-white/3 rounded-2xl p-10 md:p-14 text-center">
            <h2 className="font-mono text-[36px] md:text-[48px] font-light tracking-[-0.03em] text-white mb-4">
              Ready to tap?
            </h2>
            <p className="font-sans text-[15px] tracking-[-0.01em] text-white/50 mb-8 max-w-md mx-auto">
              Connect your Initia wallet and place your first prediction in
              under 30 seconds.
            </p>
            <BottomCTA />
          </div>
        </AnimateComponent>
      </section>

      <footer className="border-t border-white/6 py-8 px-4 md:px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <img src="/assets/inittap-logo.svg" alt="INITTAP" className="h-16" />
          <p className="font-sans text-[13px] text-white/30 tracking-[-0.01em]">
            Tap to predict. Win on Initia.
          </p>
          <div className="flex items-center gap-4">
            <a
              href="https://twitter.com/inittap"
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans text-[12px] text-white/30 hover:text-white/70 transition-colors duration-200"
            >
              Twitter
            </a>
            <a
              href="https://scan.testnet.initia.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans text-[12px] text-white/30 hover:text-white/70 transition-colors duration-200"
            >
              Explorer
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-1">
        {label}
      </p>
      <p className="font-mono text-[24px] tracking-[-0.02em] text-white tabular-nums">
        {value}
      </p>
    </div>
  )
}
