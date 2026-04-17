import { Link, useRouterState } from '@tanstack/react-router'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { IconClose, IconMenu, IconVoltage } from '@initia/icons-react'
import { truncate } from '@initia/utils'
import { cnm } from '@/utils/style'
import { useAuth } from '@/hooks/useAuth'
import { EASE_OUT_CUBIC } from '@/config/animation'
import ClientOnly from '@/components/elements/ClientOnly'
import { useWalletReady } from '@/providers/WalletReadyContext'

const NAV_LINKS = [
  { to: '/trade', label: 'Trade' },
  { to: '/agents', label: 'Agents' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/explorer', label: 'Explorer' },
]

// Wrapper: only renders WalletButtonConnected when wallet providers are ready
function WalletButtonInner() {
  const walletReady = useWalletReady()
  if (!walletReady) {
    return <div className="w-24 h-9 bg-white/5 rounded-lg" />
  }
  return <WalletButtonConnected />
}

// Safe: only renders when InterwovenKitProvider is mounted
function WalletButtonConnected() {
  const { isConnected, openConnect, openWallet, address, username, autoSign } =
    useInterwovenKit()
  const { token } = useAuth()

  // Check AutoSign status using the cosmos chain ID "evm-1"
  const autoSignEnabled =
    autoSign.isEnabledByChain['evm-1'] ??
    Object.values(autoSign.isEnabledByChain).some(Boolean)

  if (isConnected) {
    return (
      <div className="flex items-center gap-2">
        {/* AutoSign indicator */}
        <div
          title={
            autoSignEnabled
              ? `AutoSign enabled${autoSign.expiredAtByChain['evm-1'] ? ` · Expires ${new Date(autoSign.expiredAtByChain['evm-1']).toLocaleTimeString()}` : ''}`
              : 'AutoSign inactive'
          }
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 cursor-default"
        >
          <div
            className={`w-1.5 h-1.5 rounded-full ${autoSignEnabled ? 'bg-[#22C55E] animate-live-pulse' : 'bg-white/20'}`}
          />
        </div>

        <button
          onClick={openWallet}
          className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 font-mono text-[13px] text-white hover:bg-white/8 hover:border-white/20 transition-colors duration-200"
        >
          {token && (
            <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-live-pulse" />
          )}
          {username || (address ? truncate(address, [6, 4]) : 'Wallet')}
        </button>
      </div>
    )
  }

  return (
    <motion.button
      onClick={openConnect}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.1 }}
      className="bg-white text-[#1f2228] font-mono text-[13px] uppercase tracking-[0.08em] px-5 py-1.5 rounded-lg hover:bg-white/90 active:bg-white/80 transition-colors duration-200"
    >
      Connect
    </motion.button>
  )
}

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  return (
    <>
      <header className="fixed top-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-3xl z-50">
        <div className="flex items-center justify-between h-14 px-4 md:px-5 bg-[#1f2228]/80 backdrop-blur-xl border border-white/8 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.45)]">
          <Link
            to="/"
            className="hover:opacity-80 transition-opacity duration-200"
          >
            <img src="/assets/inittap-logo.svg" alt="INITTAP" className="h-7" />
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cnm(
                  'font-sans text-[13px] tracking-[-0.01em] transition-colors duration-200',
                  currentPath === link.to ||
                    currentPath.startsWith(link.to + '/')
                    ? 'text-white'
                    : 'text-white/50 hover:text-white',
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <ClientOnly
              fallback={<div className="w-24 h-9 bg-white/5 rounded-lg" />}
            >
              <WalletButtonInner />
            </ClientOnly>

            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="md:hidden p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-colors duration-200"
              aria-label="Toggle menu"
            >
              {mobileOpen ? <IconClose size={18} /> : <IconMenu size={18} />}
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: EASE_OUT_CUBIC }}
            className="fixed top-[4.75rem] left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-3xl z-40 bg-[#1f2228]/95 backdrop-blur-xl border border-white/8 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.45)] md:hidden"
          >
            <nav className="flex flex-col px-4 py-4 gap-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setMobileOpen(false)}
                  className={cnm(
                    'font-sans text-[15px] tracking-[-0.01em] px-3 py-3 rounded-lg transition-colors duration-200',
                    currentPath === link.to ||
                      currentPath.startsWith(link.to + '/')
                      ? 'text-white bg-white/5'
                      : 'text-white/50 hover:text-white hover:bg-white/3',
                  )}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                to="/profile"
                onClick={() => setMobileOpen(false)}
                className={cnm(
                  'font-sans text-[15px] tracking-[-0.01em] px-3 py-3 rounded-lg transition-colors duration-200 flex items-center gap-2',
                  currentPath === '/profile'
                    ? 'text-white bg-white/5'
                    : 'text-white/50 hover:text-white hover:bg-white/3',
                )}
              >
                <IconVoltage size={14} />
                Profile
              </Link>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
