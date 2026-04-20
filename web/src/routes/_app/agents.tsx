import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { IconExternalLink } from '@initia/icons-react'
import { encodeFunctionData, parseEther } from 'viem'
import { fromBaseUnit, truncate } from '@initia/utils'
import { MsgCall } from '@initia/initia.proto/minievm/evm/v1/tx'
import type { Agent } from '@/lib/api'
import { getAgents } from '@/lib/api'
import AnimateComponent from '@/components/elements/AnimateComponent'
import { cnm } from '@/utils/style'
import { formatUiNumber } from '@/utils/format'
import { addressUrl, txUrl } from '@/utils/scan'
import { EASE_OUT_CUBIC } from '@/config/animation'
import { useWalletReady } from '@/providers/WalletReadyContext'
import { config } from '@/config'

export const Route = createFileRoute('/_app/agents')({ component: AgentsPage })

const AGENT_REGISTRY_ABI = [
  {
    name: 'registerAgent',
    type: 'function',
    inputs: [
      { name: 'agentWallet', type: 'address' },
      { name: 'strategyURI', type: 'string' },
      { name: 'performanceFeeBps', type: 'uint16' },
    ],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'payable',
  },
] as const

type RegisterState =
  | { phase: 'idle' }
  | { phase: 'input' }
  | { phase: 'submitting' }
  | { phase: 'success'; txHash: string }
  | { phase: 'error'; message: string }

function parseTxError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('user rejected') || msg.includes('rejected'))
    return 'Transaction rejected'
  if (msg.includes('insufficient funds')) return 'Insufficient INIT balance'
  if (msg.includes('execution reverted'))
    return 'Transaction reverted by contract'
  return 'Transaction failed. Please try again.'
}

function winRate(agent: Agent): number {
  if (agent.totalTrades === 0) return 0
  return (agent.wins / agent.totalTrades) * 100
}

function pnlDisplay(pnl: string): { text: string; positive: boolean } {
  const val = parseFloat(fromBaseUnit(pnl, { decimals: 18 }))
  const positive = val >= 0
  const text = `${positive ? '+' : ''}${formatUiNumber(val, 'INIT', { humanize: true, humanizeThreshold: 1000 })}`
  return { text, positive }
}

// SSR-safe shell for register button
function RegisterAgentButton() {
  const walletReady = useWalletReady()
  if (!walletReady) {
    return <div className="h-9 w-36 bg-white/5 rounded-lg animate-pulse" />
  }
  return <RegisterAgentButtonConnected />
}

function RegisterAgentButtonConnected() {
  const { isConnected, openConnect, requestTxBlock, initiaAddress } =
    useInterwovenKit()
  const queryClient = useQueryClient()

  const [state, setState] = useState<RegisterState>({ phase: 'idle' })
  const [agentWallet, setAgentWallet] = useState('')
  const [strategyURI, setStrategyURI] = useState('')
  const [feePercent, setFeePercent] = useState('5')

  const [walletError, setWalletError] = useState<string | null>(null)
  const [feeError, setFeeError] = useState<string | null>(null)

  function resetForm() {
    setAgentWallet('')
    setStrategyURI('')
    setFeePercent('5')
    setWalletError(null)
    setFeeError(null)
  }

  function handleCancel() {
    setState({ phase: 'idle' })
    resetForm()
  }

  async function handleRegister() {
    let valid = true

    if (!agentWallet.match(/^0x[0-9a-fA-F]{40}$/)) {
      setWalletError('Enter a valid 0x address')
      valid = false
    } else {
      setWalletError(null)
    }

    const feeVal = parseFloat(feePercent)
    if (!feePercent || isNaN(feeVal) || feeVal < 0 || feeVal > 20) {
      setFeeError('Enter a fee between 0 and 20')
      valid = false
    } else {
      setFeeError(null)
    }

    if (!valid) return
    if (!initiaAddress) return

    const feeBps = Math.round(feeVal * 100)

    const calldata = encodeFunctionData({
      abi: AGENT_REGISTRY_ABI,
      functionName: 'registerAgent',
      args: [agentWallet as `0x${string}`, strategyURI, feeBps],
    })

    const msg = {
      typeUrl: '/minievm.evm.v1.MsgCall',
      value: MsgCall.fromPartial({
        sender: initiaAddress,
        contractAddr: config.contracts.agentRegistry,
        input: calldata.slice(2),
        value: parseEther('1').toString(),
        accessList: [],
        authList: [],
      }),
    }

    setState({ phase: 'submitting' })
    try {
      const result = await requestTxBlock({
        messages: [msg],
        chainId: 'evm-1',
        gasAdjustment: 1.3,
      })
      setState({ phase: 'success', txHash: result.transactionHash })
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      resetForm()
    } catch (err) {
      setState({ phase: 'error', message: parseTxError(err) })
    }
  }

  if (!isConnected) {
    return (
      <button
        onClick={openConnect}
        className="bg-white/8 border border-white/15 text-white font-mono text-[12px] uppercase tracking-[0.06em] px-4 py-2 rounded-lg hover:bg-white/12 transition-colors duration-200"
      >
        Register Agent
      </button>
    )
  }

  const isSubmitting = state.phase === 'submitting'
  const modalOpen =
    state.phase === 'input' ||
    state.phase === 'submitting' ||
    state.phase === 'error' ||
    state.phase === 'success'

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.97 }}
        transition={{ duration: 0.1 }}
        onClick={() => setState({ phase: 'input' })}
        className="bg-white/8 border border-white/15 text-white font-mono text-[12px] uppercase tracking-[0.06em] px-4 py-2 rounded-lg hover:bg-white/12 hover:border-white/25 transition-colors duration-200"
      >
        Register Agent
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {modalOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT_CUBIC }}
              style={{
                background: 'rgba(10,12,16,0.85)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
              }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              onClick={isSubmitting ? undefined : handleCancel}
            >
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.97 }}
                transition={{ duration: 0.22, ease: EASE_OUT_CUBIC }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md"
              >
                {state.phase === 'success' ? (
                  <div className="bg-[#1f2228] border border-white/10 rounded-xl p-5">
                    <p className="font-sans text-[13px] text-[#22C55E] mb-1">
                      Agent registered
                    </p>
                    <a
                      href={txUrl(state.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-[#22C55E]/60 hover:text-[#22C55E] transition-colors duration-200"
                    >
                      {state.txHash.slice(0, 10)}...{state.txHash.slice(-6)}
                      <IconExternalLink size={10} />
                    </a>
                    <div className="mt-3">
                      <button
                        onClick={() => setState({ phase: 'idle' })}
                        className="w-full bg-white/5 border border-white/10 text-white/60 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:text-white hover:bg-white/8 transition-colors duration-200"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#1f2228] border border-white/10 rounded-xl p-5">
                    <p className="font-sans text-[13px] text-white/60 mb-4 tracking-[-0.01em]">
                      Register a new trading agent. A 1 INIT registration fee is
                      required.
                    </p>

                    <div className="space-y-3 mb-4">
                      <div>
                        <label className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 block mb-1.5">
                          Agent Wallet Address
                        </label>
                        <input
                          type="text"
                          value={agentWallet}
                          onChange={(e) => {
                            setWalletError(null)
                            setAgentWallet(e.target.value.trim())
                          }}
                          disabled={isSubmitting}
                          placeholder="0x..."
                          className={cnm(
                            'w-full bg-white/5 border rounded-lg px-3 py-2 font-mono text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-white/10 transition-colors duration-200 disabled:opacity-50',
                            walletError
                              ? 'border-[#EF4444]/50'
                              : 'border-white/10 focus:border-white/20',
                          )}
                        />
                        {walletError && (
                          <p className="font-sans text-[12px] text-[#EF4444] mt-1.5">
                            {walletError}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 block mb-1.5">
                          Strategy Description
                        </label>
                        <input
                          type="text"
                          value={strategyURI}
                          onChange={(e) => setStrategyURI(e.target.value)}
                          disabled={isSubmitting}
                          placeholder="Describe the trading strategy..."
                          className="w-full bg-white/5 border border-white/10 focus:border-white/20 rounded-lg px-3 py-2 font-mono text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-white/10 transition-colors duration-200 disabled:opacity-50"
                        />
                      </div>

                      <div>
                        <label className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 block mb-1.5">
                          Performance Fee (%)
                        </label>
                        <input
                          type="number"
                          value={feePercent}
                          onChange={(e) => {
                            setFeeError(null)
                            setFeePercent(e.target.value)
                          }}
                          disabled={isSubmitting}
                          min="0"
                          max="20"
                          step="0.5"
                          placeholder="5"
                          className={cnm(
                            'w-full bg-white/5 border rounded-lg px-3 py-2 font-mono text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-white/10 transition-colors duration-200 disabled:opacity-50',
                            feeError
                              ? 'border-[#EF4444]/50'
                              : 'border-white/10 focus:border-white/20',
                          )}
                        />
                        {feeError && (
                          <p className="font-sans text-[12px] text-[#EF4444] mt-1.5">
                            {feeError}
                          </p>
                        )}
                        <p className="font-sans text-[11px] text-white/25 mt-1">
                          Max 20%. Stored as basis points.
                        </p>
                      </div>
                    </div>

                    {state.phase === 'error' && (
                      <div className="mb-3 px-3 py-2 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg">
                        <p className="font-sans text-[12px] text-[#EF4444]">
                          {state.message}
                        </p>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={handleCancel}
                        disabled={isSubmitting}
                        className="flex-1 bg-transparent text-white/50 border border-white/10 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:text-white hover:border-white/20 transition-colors duration-200 disabled:opacity-40"
                      >
                        Cancel
                      </button>
                      <motion.button
                        whileTap={isSubmitting ? {} : { scale: 0.97 }}
                        transition={{ duration: 0.1 }}
                        onClick={handleRegister}
                        disabled={isSubmitting}
                        className="flex-1 bg-white text-[#1f2228] font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:bg-white/90 transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isSubmitting
                          ? 'Submitting...'
                          : state.phase === 'error'
                            ? 'Retry'
                            : 'Submit (1 INIT)'}
                      </motion.button>
                    </div>
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}

function AgentCard({ agent }: { agent: Agent }) {
  const wr = winRate(agent)
  const pnl = pnlDisplay(agent.totalPnL)
  const scanUrl = addressUrl(agent.agentWallet)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT_CUBIC }}
      className="bg-white/3 border border-white/10 rounded-xl p-5 hover:border-white/20 transition-colors duration-200 flex flex-col"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/8 border border-white/10 flex items-center justify-center">
            <span className="font-mono text-[13px] text-white/60">
              {String(agent.id).padStart(2, '0')}
            </span>
          </div>
          <div>
            <p className="font-sans text-[15px] font-semibold tracking-[-0.01em] text-white">
              Agent #{agent.id}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <a
                href={scanUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] text-white/30 hover:text-white/60 transition-colors flex items-center gap-1"
              >
                {truncate(agent.agentWallet, [6, 4])}
                <IconExternalLink size={9} />
              </a>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {agent.isActive ? (
            <span className="flex items-center gap-1.5 bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/20 px-2 py-0.5 rounded-md font-mono text-[11px] uppercase tracking-[0.04em]">
              <span className="w-1 h-1 rounded-full bg-[#22C55E] animate-live-pulse" />
              Live
            </span>
          ) : (
            <span className="bg-white/5 text-white/40 border border-white/10 px-2 py-0.5 rounded-md font-mono text-[11px] uppercase tracking-[0.04em]">
              Inactive
            </span>
          )}
        </div>
      </div>

      {/* Strategy URI */}
      {agent.strategyURI && (
        <p className="font-sans text-[13px] text-white/40 tracking-[-0.01em] mb-4 line-clamp-2 leading-[1.5]">
          {agent.strategyURI.length > 80
            ? agent.strategyURI.slice(0, 80) + '...'
            : agent.strategyURI}
        </p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <p className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium mb-0.5">
            Win Rate
          </p>
          <p
            className={cnm(
              'font-mono text-[15px] tabular-nums',
              wr > 60
                ? 'text-[#22C55E]'
                : wr < 40
                  ? 'text-[#EF4444]'
                  : 'text-white',
            )}
          >
            {wr.toFixed(0)}%
          </p>
        </div>
        <div>
          <p className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium mb-0.5">
            Total PnL
          </p>
          <p
            className={cnm(
              'font-mono text-[13px] tabular-nums',
              pnl.positive ? 'text-[#22C55E]' : 'text-[#EF4444]',
            )}
          >
            {pnl.text}
          </p>
        </div>
        <div>
          <p className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium mb-0.5">
            Trades
          </p>
          <p className="font-mono text-[15px] text-white tabular-nums">
            {agent.totalTrades}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4 pt-3 border-t border-white/6">
        <div>
          <p className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium mb-0.5">
            Subscribers
          </p>
          <p className="font-mono text-[13px] text-white">
            {agent.subscriberCount}
          </p>
        </div>
        <div className="text-right">
          <p className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/30 font-medium mb-0.5">
            Fee
          </p>
          <p className="font-mono text-[13px] text-white">
            {(agent.performanceFeeBps / 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-auto">
        <Link
          to="/agents/$agentId"
          params={{ agentId: String(agent.id) }}
          className="flex-1 text-center bg-transparent text-white border border-white/20 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:bg-white/5 hover:border-white/30 transition-colors duration-200"
        >
          Details
        </Link>
        <Link
          to="/agents/$agentId"
          params={{ agentId: String(agent.id) }}
          className="flex-1 text-center bg-white text-[#1f2228] font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:bg-white/90 transition-colors duration-200"
        >
          Copy Trade
        </Link>
      </div>
    </motion.div>
  )
}

function AgentsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => getAgents({ limit: 20 }),
    staleTime: 30_000,
  })

  return (
    <div className="min-h-screen bg-[#1f2228]">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
        <AnimateComponent entry="fadeInUp">
          <div className="flex items-start justify-between mb-8 gap-4">
            <div>
              <h1 className="font-mono text-[28px] font-light tracking-[-0.03em] text-white mb-1">
                AI Agents
              </h1>
              <p className="font-sans text-[13px] text-white/40 tracking-[-0.01em]">
                Autonomous trading agents on Initia. Subscribe to copy their
                trades.
              </p>
            </div>
            <RegisterAgentButton />
          </div>
        </AnimateComponent>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white/3 rounded-xl p-5 animate-pulse">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-white/5" />
                  <div className="flex-1">
                    <div className="h-4 bg-white/5 rounded mb-1" />
                    <div className="h-3 bg-white/5 rounded w-2/3" />
                  </div>
                </div>
                <div className="h-16 bg-white/5 rounded mb-4" />
                <div className="h-8 bg-white/5 rounded" />
              </div>
            ))}
          </div>
        ) : data?.agents.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        ) : (
          <div className="bg-white/3 rounded-xl p-12 text-center">
            <p className="font-sans text-[15px] text-white/40 tracking-[-0.01em] mb-2">
              No agents registered yet
            </p>
            <p className="font-sans text-[13px] text-white/25 tracking-[-0.01em]">
              Be the first to deploy a trading agent on Initia.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
