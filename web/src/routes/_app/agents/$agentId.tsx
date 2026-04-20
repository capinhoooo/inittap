import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { MsgCall } from '@initia/initia.proto/minievm/evm/v1/tx'
import { useEffect, useState } from 'react'
import { IconBack, IconExternalLink } from '@initia/icons-react'
import { encodeFunctionData, parseEther } from 'viem'
import { fromBaseUnit, truncate } from '@initia/utils'
import type { Agent, AgentTrade } from '@/lib/api'
import { getAgent, getAgentTrades } from '@/lib/api'
import { cnm } from '@/utils/style'
import { formatUiNumber } from '@/utils/format'
import { addressUrl, txUrl } from '@/utils/scan'
import { EASE_OUT_CUBIC } from '@/config/animation'
import { useWalletReady } from '@/providers/WalletReadyContext'
import { config } from '@/config'

export const Route = createFileRoute('/_app/agents/$agentId')({
  component: AgentDetailPage,
})

const COPY_VAULT_ADDRESS = config.contracts.copyVault

const COPY_VAULT_ABI = [
  {
    name: 'deposit',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'withdraw',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const AGENT_REGISTRY_SUB_ABI = [
  {
    name: 'subscribe',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'unsubscribe',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const MIN_DEPOSIT = 0.5
const MIN_SUBSCRIBE = 0.5

type DepositTxState =
  | { phase: 'idle' }
  | { phase: 'input' }
  | { phase: 'submitting' }
  | { phase: 'success'; txHash: string }
  | { phase: 'error'; message: string }

type WithdrawTxState =
  | { phase: 'idle' }
  | { phase: 'input' }
  | { phase: 'submitting' }
  | { phase: 'success'; txHash: string }
  | { phase: 'error'; message: string }

type SubscribeTxState =
  | { phase: 'idle' }
  | { phase: 'input' }
  | { phase: 'submitting' }
  | { phase: 'success'; txHash: string }
  | { phase: 'error'; message: string }

type UnsubscribeTxState =
  | { phase: 'idle' }
  | { phase: 'confirm' }
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

// Outer shell: SSR-safe, only renders wallet-aware content after hydration
function CopyTradeActions({ agentId }: { agentId: number }) {
  const walletReady = useWalletReady()
  if (!walletReady) {
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="h-10 w-32 bg-white/5 rounded-lg animate-pulse" />
      </div>
    )
  }
  return <CopyTradeActionsConnected agentId={agentId} />
}

function CopyTradeActionsConnected({ agentId }: { agentId: number }) {
  const { isConnected, openConnect, requestTxBlock, initiaAddress } =
    useInterwovenKit()

  const [depositState, setDepositState] = useState<DepositTxState>({
    phase: 'idle',
  })
  const [depositAmount, setDepositAmount] = useState(String(MIN_DEPOSIT))
  const [depositError, setDepositError] = useState<string | null>(null)

  const [withdrawState, setWithdrawState] = useState<WithdrawTxState>({
    phase: 'idle',
  })
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawError, setWithdrawError] = useState<string | null>(null)

  // Reset deposit form when it closes
  useEffect(() => {
    if (depositState.phase === 'idle') {
      setDepositAmount(String(MIN_DEPOSIT))
      setDepositError(null)
    }
  }, [depositState.phase])

  // Reset withdraw form when it closes
  useEffect(() => {
    if (withdrawState.phase === 'idle') {
      setWithdrawAmount('')
      setWithdrawError(null)
    }
  }, [withdrawState.phase])

  if (!isConnected) {
    return (
      <button
        onClick={openConnect}
        className="bg-white text-[#1f2228] font-mono text-[13px] uppercase tracking-[0.08em] px-5 py-2.5 rounded-lg hover:bg-white/90 transition-colors duration-200"
      >
        Connect Wallet
      </button>
    )
  }

  async function handleDeposit() {
    const val = parseFloat(depositAmount)
    if (!depositAmount || isNaN(val) || depositAmount.includes('e')) {
      setDepositError('Enter a valid number')
      return
    }
    if (val < MIN_DEPOSIT) {
      setDepositError(`Minimum deposit is ${MIN_DEPOSIT} INIT`)
      return
    }
    if (!initiaAddress) {
      setDepositError('Wallet not connected')
      return
    }
    setDepositError(null)

    const calldata = encodeFunctionData({
      abi: COPY_VAULT_ABI,
      functionName: 'deposit',
      args: [BigInt(agentId)],
    })

    const msg = {
      typeUrl: '/minievm.evm.v1.MsgCall',
      value: MsgCall.fromPartial({
        sender: initiaAddress,
        contractAddr: COPY_VAULT_ADDRESS,
        input: calldata.slice(2),
        value: parseEther(depositAmount).toString(),
        accessList: [],
        authList: [],
      }),
    }

    setDepositState({ phase: 'submitting' })
    try {
      const result = await requestTxBlock({
        messages: [msg],
        chainId: 'evm-1',
        gasAdjustment: 1.3,
      })
      setDepositState({ phase: 'success', txHash: result.transactionHash })
    } catch (err) {
      setDepositState({ phase: 'error', message: parseTxError(err) })
    }
  }

  async function handleWithdraw() {
    const val = parseFloat(withdrawAmount)
    if (!withdrawAmount || isNaN(val) || val <= 0) {
      setWithdrawError('Enter a valid amount')
      return
    }
    if (!initiaAddress) {
      setWithdrawError('Wallet not connected')
      return
    }
    setWithdrawError(null)

    const calldata = encodeFunctionData({
      abi: COPY_VAULT_ABI,
      functionName: 'withdraw',
      args: [BigInt(agentId), parseEther(withdrawAmount)],
    })

    const msg = {
      typeUrl: '/minievm.evm.v1.MsgCall',
      value: MsgCall.fromPartial({
        sender: initiaAddress,
        contractAddr: COPY_VAULT_ADDRESS,
        input: calldata.slice(2),
        value: '0',
        accessList: [],
        authList: [],
      }),
    }

    setWithdrawState({ phase: 'submitting' })
    try {
      const result = await requestTxBlock({
        messages: [msg],
        chainId: 'evm-1',
        gasAdjustment: 1.3,
      })
      setWithdrawState({ phase: 'success', txHash: result.transactionHash })
    } catch (err) {
      setWithdrawState({ phase: 'error', message: parseTxError(err) })
    }
  }

  const isDepositSubmitting = depositState.phase === 'submitting'
  const isWithdrawSubmitting = withdrawState.phase === 'submitting'

  return (
    <div className="flex flex-col items-end gap-2">
      {/* Deposit button / inline form */}
      <div className="flex flex-col items-end gap-2">
        {depositState.phase === 'idle' && (
          <div className="flex items-center gap-2">
            {/* Withdraw trigger sits next to Copy Trade */}
            {withdrawState.phase === 'idle' && (
              <button
                onClick={() => setWithdrawState({ phase: 'input' })}
                className="font-mono text-[12px] uppercase tracking-[0.06em] text-white/30 hover:text-white/60 transition-colors duration-200"
              >
                Withdraw
              </button>
            )}
            <motion.button
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.1 }}
              onClick={() => setDepositState({ phase: 'input' })}
              className="bg-white text-[#1f2228] font-mono text-[13px] uppercase tracking-[0.08em] px-5 py-2.5 rounded-lg hover:bg-white/90 transition-colors duration-200"
            >
              Copy Trade
            </motion.button>
          </div>
        )}

        {/* Deposit input form */}
        <AnimatePresence>
          {(depositState.phase === 'input' ||
            depositState.phase === 'submitting' ||
            depositState.phase === 'error') && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: EASE_OUT_CUBIC }}
              className="bg-white/5 border border-white/10 rounded-xl p-4 w-72"
            >
              <p className="font-sans text-[12px] text-white/50 mb-3 tracking-[-0.01em]">
                Deposit to copy this agent's trades
              </p>
              <div className="mb-3">
                <label className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 block mb-1.5">
                  Amount (INIT)
                </label>
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => {
                    setDepositError(null)
                    setDepositAmount(e.target.value)
                  }}
                  disabled={isDepositSubmitting}
                  min={MIN_DEPOSIT}
                  step="0.1"
                  placeholder={String(MIN_DEPOSIT)}
                  className={cnm(
                    'w-full bg-white/5 border rounded-lg px-3 py-2 font-mono text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-white/10 transition-colors duration-200 disabled:opacity-50',
                    depositError
                      ? 'border-[#EF4444]/50'
                      : 'border-white/10 focus:border-white/20',
                  )}
                />
                {depositError && (
                  <p className="font-sans text-[12px] text-[#EF4444] mt-1.5">
                    {depositError}
                  </p>
                )}
                <p className="font-sans text-[11px] text-white/25 mt-1">
                  Min {MIN_DEPOSIT} INIT
                </p>
              </div>

              {depositState.phase === 'error' && (
                <div className="mb-3 px-3 py-2 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg">
                  <p className="font-sans text-[12px] text-[#EF4444]">
                    {depositState.message}
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setDepositState({ phase: 'idle' })}
                  disabled={isDepositSubmitting}
                  className="flex-1 bg-transparent text-white/50 border border-white/10 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:text-white hover:border-white/20 transition-colors duration-200 disabled:opacity-40"
                >
                  Cancel
                </button>
                <motion.button
                  whileTap={isDepositSubmitting ? {} : { scale: 0.97 }}
                  transition={{ duration: 0.1 }}
                  onClick={handleDeposit}
                  disabled={isDepositSubmitting}
                  className="flex-1 bg-white text-[#1f2228] font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:bg-white/90 transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isDepositSubmitting
                    ? 'Confirming...'
                    : depositState.phase === 'error'
                      ? 'Retry'
                      : 'Confirm'}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Deposit success */}
        <AnimatePresence>
          {depositState.phase === 'success' && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: EASE_OUT_CUBIC }}
              className="bg-[#22C55E]/10 border border-[#22C55E]/20 rounded-xl p-4 w-72"
            >
              <p className="font-sans text-[13px] text-[#22C55E] mb-1">
                Deposit confirmed
              </p>
              <a
                href={txUrl(depositState.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[11px] text-[#22C55E]/60 hover:text-[#22C55E] transition-colors duration-200"
              >
                {depositState.txHash.slice(0, 10)}...
                {depositState.txHash.slice(-6)}
                <IconExternalLink size={10} />
              </a>
              <div className="mt-3">
                <button
                  onClick={() => setDepositState({ phase: 'idle' })}
                  className="w-full bg-white/5 border border-white/10 text-white/60 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:text-white hover:bg-white/8 transition-colors duration-200"
                >
                  Done
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Withdraw inline form */}
      <AnimatePresence>
        {(withdrawState.phase === 'input' ||
          withdrawState.phase === 'submitting' ||
          withdrawState.phase === 'error') && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: EASE_OUT_CUBIC }}
            className="bg-white/5 border border-white/10 rounded-xl p-4 w-72"
          >
            <p className="font-sans text-[12px] text-white/50 mb-3 tracking-[-0.01em]">
              Withdraw your deposited INIT
            </p>
            <div className="mb-3">
              <label className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 block mb-1.5">
                Amount (INIT)
              </label>
              <input
                type="number"
                value={withdrawAmount}
                onChange={(e) => {
                  setWithdrawError(null)
                  setWithdrawAmount(e.target.value)
                }}
                disabled={isWithdrawSubmitting}
                min="0"
                step="0.1"
                placeholder="0.0"
                className={cnm(
                  'w-full bg-white/5 border rounded-lg px-3 py-2 font-mono text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-white/10 transition-colors duration-200 disabled:opacity-50',
                  withdrawError
                    ? 'border-[#EF4444]/50'
                    : 'border-white/10 focus:border-white/20',
                )}
              />
              {withdrawError && (
                <p className="font-sans text-[12px] text-[#EF4444] mt-1.5">
                  {withdrawError}
                </p>
              )}
            </div>

            {withdrawState.phase === 'error' && (
              <div className="mb-3 px-3 py-2 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg">
                <p className="font-sans text-[12px] text-[#EF4444]">
                  {withdrawState.message}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setWithdrawState({ phase: 'idle' })}
                disabled={isWithdrawSubmitting}
                className="flex-1 bg-transparent text-white/50 border border-white/10 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:text-white hover:border-white/20 transition-colors duration-200 disabled:opacity-40"
              >
                Cancel
              </button>
              <motion.button
                whileTap={isWithdrawSubmitting ? {} : { scale: 0.97 }}
                transition={{ duration: 0.1 }}
                onClick={handleWithdraw}
                disabled={isWithdrawSubmitting}
                className="flex-1 bg-white/10 text-white border border-white/10 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:bg-white/15 transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isWithdrawSubmitting
                  ? 'Confirming...'
                  : withdrawState.phase === 'error'
                    ? 'Retry'
                    : 'Confirm'}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Withdraw success */}
      <AnimatePresence>
        {withdrawState.phase === 'success' && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: EASE_OUT_CUBIC }}
            className="bg-[#22C55E]/10 border border-[#22C55E]/20 rounded-xl p-4 w-72"
          >
            <p className="font-sans text-[13px] text-[#22C55E] mb-1">
              Withdrawal confirmed
            </p>
            <a
              href={txUrl(withdrawState.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-[#22C55E]/60 hover:text-[#22C55E] transition-colors duration-200"
            >
              {withdrawState.txHash.slice(0, 10)}...
              {withdrawState.txHash.slice(-6)}
              <IconExternalLink size={10} />
            </a>
            <div className="mt-3">
              <button
                onClick={() => setWithdrawState({ phase: 'idle' })}
                className="w-full bg-white/5 border border-white/10 text-white/60 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:text-white hover:bg-white/8 transition-colors duration-200"
              >
                Done
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// SSR-safe shell for SubscriptionActions
function SubscriptionActions({ agentId }: { agentId: number }) {
  const walletReady = useWalletReady()
  if (!walletReady) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-9 w-28 bg-white/5 rounded-lg animate-pulse" />
        <div className="h-9 w-24 bg-white/5 rounded-lg animate-pulse" />
      </div>
    )
  }
  return <SubscriptionActionsConnected agentId={agentId} />
}

function SubscriptionActionsConnected({ agentId }: { agentId: number }) {
  const { isConnected, openConnect, requestTxBlock, initiaAddress } =
    useInterwovenKit()

  const [subState, setSubState] = useState<SubscribeTxState>({ phase: 'idle' })
  const [subAmount, setSubAmount] = useState(String(MIN_SUBSCRIBE))
  const [subError, setSubError] = useState<string | null>(null)

  const [unsubState, setUnsubState] = useState<UnsubscribeTxState>({
    phase: 'idle',
  })

  useEffect(() => {
    if (subState.phase === 'idle') {
      setSubAmount(String(MIN_SUBSCRIBE))
      setSubError(null)
    }
  }, [subState.phase])

  if (!isConnected) {
    return (
      <button
        onClick={openConnect}
        className="bg-white/8 border border-white/15 text-white font-mono text-[12px] uppercase tracking-[0.06em] px-4 py-2 rounded-lg hover:bg-white/12 transition-colors duration-200"
      >
        Connect to Subscribe
      </button>
    )
  }

  async function handleSubscribe() {
    const val = parseFloat(subAmount)
    if (!subAmount || isNaN(val) || subAmount.includes('e')) {
      setSubError('Enter a valid number')
      return
    }
    if (val < MIN_SUBSCRIBE) {
      setSubError(`Minimum is ${MIN_SUBSCRIBE} INIT`)
      return
    }
    if (!initiaAddress) {
      setSubError('Wallet not connected')
      return
    }
    setSubError(null)

    const calldata = encodeFunctionData({
      abi: AGENT_REGISTRY_SUB_ABI,
      functionName: 'subscribe',
      args: [BigInt(agentId)],
    })

    const msg = {
      typeUrl: '/minievm.evm.v1.MsgCall',
      value: MsgCall.fromPartial({
        sender: initiaAddress,
        contractAddr: config.contracts.agentRegistry,
        input: calldata.slice(2),
        value: parseEther(subAmount).toString(),
        accessList: [],
        authList: [],
      }),
    }

    setSubState({ phase: 'submitting' })
    try {
      const result = await requestTxBlock({
        messages: [msg],
        chainId: 'evm-1',
        gasAdjustment: 1.3,
      })
      setSubState({ phase: 'success', txHash: result.transactionHash })
    } catch (err) {
      setSubState({ phase: 'error', message: parseTxError(err) })
    }
  }

  async function handleUnsubscribe() {
    if (!initiaAddress) return

    const calldata = encodeFunctionData({
      abi: AGENT_REGISTRY_SUB_ABI,
      functionName: 'unsubscribe',
      args: [BigInt(agentId)],
    })

    const msg = {
      typeUrl: '/minievm.evm.v1.MsgCall',
      value: MsgCall.fromPartial({
        sender: initiaAddress,
        contractAddr: config.contracts.agentRegistry,
        input: calldata.slice(2),
        value: '0',
        accessList: [],
        authList: [],
      }),
    }

    setUnsubState({ phase: 'submitting' })
    try {
      const result = await requestTxBlock({
        messages: [msg],
        chainId: 'evm-1',
        gasAdjustment: 1.3,
      })
      setUnsubState({ phase: 'success', txHash: result.transactionHash })
    } catch (err) {
      setUnsubState({ phase: 'error', message: parseTxError(err) })
    }
  }

  const isSubSubmitting = subState.phase === 'submitting'
  const isUnsubSubmitting = unsubState.phase === 'submitting'

  return (
    <div className="flex flex-col gap-3">
      {subState.phase === 'idle' && unsubState.phase === 'idle' && (
        <div className="flex items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.1 }}
            onClick={() => setSubState({ phase: 'input' })}
            className="bg-white/8 border border-white/15 text-white font-mono text-[12px] uppercase tracking-[0.06em] px-4 py-2 rounded-lg hover:bg-white/12 hover:border-white/25 transition-colors duration-200"
          >
            Subscribe
          </motion.button>
          <button
            onClick={() => setUnsubState({ phase: 'confirm' })}
            className="font-mono text-[12px] uppercase tracking-[0.06em] text-white/30 hover:text-white/60 transition-colors duration-200"
          >
            Unsubscribe
          </button>
        </div>
      )}

      {/* Subscribe input form */}
      <AnimatePresence>
        {(subState.phase === 'input' ||
          subState.phase === 'submitting' ||
          subState.phase === 'error') && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: EASE_OUT_CUBIC }}
            className="bg-white/5 border border-white/10 rounded-xl p-4 w-72"
          >
            <p className="font-sans text-[12px] text-white/50 mb-3 tracking-[-0.01em]">
              Subscribe to receive trade signals from this agent
            </p>
            <div className="mb-3">
              <label className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 block mb-1.5">
                Amount (INIT)
              </label>
              <input
                type="number"
                value={subAmount}
                onChange={(e) => {
                  setSubError(null)
                  setSubAmount(e.target.value)
                }}
                disabled={isSubSubmitting}
                min={MIN_SUBSCRIBE}
                step="0.1"
                placeholder={String(MIN_SUBSCRIBE)}
                className={cnm(
                  'w-full bg-white/5 border rounded-lg px-3 py-2 font-mono text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-white/10 transition-colors duration-200 disabled:opacity-50',
                  subError
                    ? 'border-[#EF4444]/50'
                    : 'border-white/10 focus:border-white/20',
                )}
              />
              {subError && (
                <p className="font-sans text-[12px] text-[#EF4444] mt-1.5">
                  {subError}
                </p>
              )}
              <p className="font-sans text-[11px] text-white/25 mt-1">
                Min {MIN_SUBSCRIBE} INIT
              </p>
            </div>

            {subState.phase === 'error' && (
              <div className="mb-3 px-3 py-2 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg">
                <p className="font-sans text-[12px] text-[#EF4444]">
                  {subState.message}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setSubState({ phase: 'idle' })}
                disabled={isSubSubmitting}
                className="flex-1 bg-transparent text-white/50 border border-white/10 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:text-white hover:border-white/20 transition-colors duration-200 disabled:opacity-40"
              >
                Cancel
              </button>
              <motion.button
                whileTap={isSubSubmitting ? {} : { scale: 0.97 }}
                transition={{ duration: 0.1 }}
                onClick={handleSubscribe}
                disabled={isSubSubmitting}
                className="flex-1 bg-white/10 text-white border border-white/10 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:bg-white/15 transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubSubmitting
                  ? 'Confirming...'
                  : subState.phase === 'error'
                    ? 'Retry'
                    : 'Confirm'}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Subscribe success */}
      <AnimatePresence>
        {subState.phase === 'success' && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: EASE_OUT_CUBIC }}
            className="bg-[#22C55E]/10 border border-[#22C55E]/20 rounded-xl p-4 w-72"
          >
            <p className="font-sans text-[13px] text-[#22C55E] mb-1">
              Subscribed
            </p>
            <a
              href={txUrl(subState.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-[#22C55E]/60 hover:text-[#22C55E] transition-colors duration-200"
            >
              {subState.txHash.slice(0, 10)}...{subState.txHash.slice(-6)}
              <IconExternalLink size={10} />
            </a>
            <div className="mt-3">
              <button
                onClick={() => setSubState({ phase: 'idle' })}
                className="w-full bg-white/5 border border-white/10 text-white/60 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:text-white hover:bg-white/8 transition-colors duration-200"
              >
                Done
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Unsubscribe confirm panel */}
      <AnimatePresence>
        {(unsubState.phase === 'confirm' ||
          unsubState.phase === 'submitting' ||
          unsubState.phase === 'error') && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: EASE_OUT_CUBIC }}
            className="bg-white/5 border border-white/10 rounded-xl p-4 w-72"
          >
            <p className="font-sans text-[12px] text-white/50 mb-4 tracking-[-0.01em]">
              Cancel your subscription. Any remaining balance will be refunded.
            </p>

            {unsubState.phase === 'error' && (
              <div className="mb-3 px-3 py-2 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg">
                <p className="font-sans text-[12px] text-[#EF4444]">
                  {unsubState.message}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setUnsubState({ phase: 'idle' })}
                disabled={isUnsubSubmitting}
                className="flex-1 bg-transparent text-white/50 border border-white/10 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:text-white hover:border-white/20 transition-colors duration-200 disabled:opacity-40"
              >
                Cancel
              </button>
              <motion.button
                whileTap={isUnsubSubmitting ? {} : { scale: 0.97 }}
                transition={{ duration: 0.1 }}
                onClick={handleUnsubscribe}
                disabled={isUnsubSubmitting}
                className="flex-1 bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/25 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:bg-[#EF4444]/25 transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isUnsubSubmitting
                  ? 'Confirming...'
                  : unsubState.phase === 'error'
                    ? 'Retry'
                    : 'Unsubscribe'}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Unsubscribe success */}
      <AnimatePresence>
        {unsubState.phase === 'success' && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: EASE_OUT_CUBIC }}
            className="bg-[#22C55E]/10 border border-[#22C55E]/20 rounded-xl p-4 w-72"
          >
            <p className="font-sans text-[13px] text-[#22C55E] mb-1">
              Unsubscribed
            </p>
            <a
              href={txUrl(unsubState.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-[#22C55E]/60 hover:text-[#22C55E] transition-colors duration-200"
            >
              {unsubState.txHash.slice(0, 10)}...{unsubState.txHash.slice(-6)}
              <IconExternalLink size={10} />
            </a>
            <div className="mt-3">
              <button
                onClick={() => setUnsubState({ phase: 'idle' })}
                className="w-full bg-white/5 border border-white/10 text-white/60 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:text-white hover:bg-white/8 transition-colors duration-200"
              >
                Done
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AgentTradeRow({ trade }: { trade: AgentTrade }) {
  const isBull = trade.isBull
  const amount = parseFloat(
    fromBaseUnit(trade.totalBetAmount, { decimals: 18 }),
  )
  const tradeTxUrl = txUrl(trade.txHash)

  return (
    <div className="flex items-center px-4 py-3 border-t border-white/6 hover:bg-white/3 transition-colors duration-150 gap-3">
      <div className="w-16 shrink-0">
        <span
          className={cnm(
            'font-mono text-[11px] uppercase tracking-[0.04em] px-2 py-0.5 rounded border',
            isBull
              ? 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/20'
              : 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/20',
          )}
        >
          {isBull ? '▲ Bull' : '▼ Bear'}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <span className="font-mono text-[12px] text-white/60">
          {trade.pairId}
        </span>
        <span className="font-mono text-[11px] text-white/30 ml-2">
          #{trade.epoch}
        </span>
      </div>
      <div className="w-24 text-right hidden sm:block">
        <span className="font-mono text-[13px] text-white tabular-nums">
          {formatUiNumber(amount, 'INIT')}
        </span>
      </div>
      <div className="w-16 text-right hidden md:block">
        <span className="font-mono text-[12px] text-white/50 tabular-nums">
          {trade.followerCount}
        </span>
      </div>
      <div className="w-20 text-right">
        {trade.claimed ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.04em] bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/20 px-1.5 py-0.5 rounded">
            Claimed
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[0.04em] bg-white/5 text-white/30 border border-white/10 px-1.5 py-0.5 rounded">
            Pending
          </span>
        )}
      </div>
      <div className="w-6 shrink-0 flex justify-center">
        {trade.txHash && tradeTxUrl !== '#' && (
          <a
            href={tradeTxUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/20 hover:text-white/60 transition-colors"
          >
            <IconExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  )
}

function AgentDetailPage() {
  const { agentId } = Route.useParams()
  const id = parseInt(agentId, 10)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => getAgent(id),
    staleTime: 30_000,
    enabled: !isNaN(id),
  })

  const { data: tradesData, isLoading: tradesLoading } = useQuery({
    queryKey: ['agent', id, 'trades'],
    queryFn: () => getAgentTrades(id, { limit: 10 }),
    staleTime: 30_000,
    enabled: !isNaN(id),
  })

  const agent = data?.agent
  const scanUrl = agent ? addressUrl(agent.agentWallet) : '#'

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#1f2228]">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
          <div className="animate-pulse">
            <div className="h-6 bg-white/5 rounded w-32 mb-8" />
            <div className="h-12 bg-white/5 rounded w-64 mb-4" />
            <div className="grid grid-cols-4 gap-4 mt-8">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 bg-white/5 rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (isError || !agent) {
    return (
      <div className="min-h-screen bg-[#1f2228] flex items-center justify-center">
        <div className="text-center">
          <p className="font-mono text-[28px] text-white/20 mb-4">404</p>
          <p className="font-sans text-[15px] text-white/40 mb-6">
            Agent not found
          </p>
          <Link
            to="/agents"
            className="font-mono text-[13px] uppercase tracking-[0.08em] text-white/50 hover:text-white transition-colors"
          >
            Back to Agents
          </Link>
        </div>
      </div>
    )
  }

  const wr = winRate(agent)
  const pnlVal = parseFloat(fromBaseUnit(agent.totalPnL, { decimals: 18 }))
  const pnlPositive = pnlVal >= 0

  return (
    <div className="min-h-screen bg-[#1f2228]">
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
        {/* Back */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="mb-6"
        >
          <Link
            to="/agents"
            className="inline-flex items-center gap-2 font-sans text-[13px] text-white/40 hover:text-white transition-colors duration-200"
          >
            <IconBack size={14} />
            All Agents
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT_CUBIC }}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-white/8 border border-white/10 flex items-center justify-center">
                <span className="font-mono text-[18px] text-white/60">
                  {String(agent.id).padStart(2, '0')}
                </span>
              </div>
              <div>
                <h1 className="font-mono text-[28px] font-light tracking-[-0.03em] text-white mb-1">
                  Agent #{agent.id}
                </h1>
                <div className="flex items-center gap-3">
                  <a
                    href={scanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[13px] text-white/40 hover:text-white/70 transition-colors flex items-center gap-1"
                  >
                    {truncate(agent.agentWallet, [6, 4])}
                    <IconExternalLink size={11} />
                  </a>
                  {agent.isActive ? (
                    <span className="flex items-center gap-1.5 bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/20 px-2 py-0.5 rounded-md font-mono text-[11px] uppercase">
                      <span className="w-1 h-1 rounded-full bg-[#22C55E] animate-live-pulse" />
                      Active
                    </span>
                  ) : (
                    <span className="bg-white/5 text-white/40 border border-white/10 px-2 py-0.5 rounded-md font-mono text-[11px] uppercase">
                      Inactive
                    </span>
                  )}
                </div>
              </div>
            </div>

            <CopyTradeActions agentId={agent.id} />
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              {
                label: 'Win Rate',
                value: `${wr.toFixed(1)}%`,
                colored: true,
                positive: wr >= 50,
              },
              {
                label: 'Total PnL',
                value: `${pnlPositive ? '+' : ''}${formatUiNumber(pnlVal, 'INIT', { humanize: true, humanizeThreshold: 1000 })}`,
                colored: true,
                positive: pnlPositive,
              },
              {
                label: 'Total Trades',
                value: String(agent.totalTrades),
                colored: false,
                positive: true,
              },
              {
                label: 'Subscribers',
                value: String(agent.subscriberCount),
                colored: false,
                positive: true,
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-white/3 border border-white/10 rounded-xl p-4"
              >
                <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-1">
                  {stat.label}
                </p>
                <p
                  className={cnm(
                    'font-mono text-[22px] tracking-[-0.02em] tabular-nums',
                    stat.colored
                      ? stat.positive
                        ? 'text-[#22C55E]'
                        : 'text-[#EF4444]'
                      : 'text-white',
                  )}
                >
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          {/* Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div className="bg-white/3 border border-white/10 rounded-xl p-5">
              <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-3">
                Agent Info
              </p>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="font-sans text-[13px] text-white/40">
                    Performance Fee
                  </span>
                  <span className="font-mono text-[13px] text-white">
                    {(agent.performanceFeeBps / 100).toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-sans text-[13px] text-white/40">
                    Creator
                  </span>
                  <a
                    href={addressUrl(agent.creator)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[13px] text-white/60 hover:text-white transition-colors flex items-center gap-1"
                  >
                    {truncate(agent.creator, [6, 4])}
                    <IconExternalLink size={10} />
                  </a>
                </div>
                <div className="flex justify-between">
                  <span className="font-sans text-[13px] text-white/40">
                    Registered
                  </span>
                  <span className="font-mono text-[13px] text-white/60">
                    {new Date(agent.registrationTime).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-sans text-[13px] text-white/40">
                    Wins
                  </span>
                  <span className="font-mono text-[13px] text-white">
                    {agent.wins} / {agent.totalTrades}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white/3 border border-white/10 rounded-xl p-5">
              <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-3">
                Strategy
              </p>
              {agent.strategyURI ? (
                <p className="font-sans text-[13px] text-white/60 leading-[1.6] tracking-[-0.01em]">
                  {agent.strategyURI}
                </p>
              ) : (
                <p className="font-sans text-[13px] text-white/25">
                  No strategy description
                </p>
              )}
              {agent.shareTokenAddress && (
                <div className="mt-4 pt-4 border-t border-white/6">
                  <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-1">
                    Share Token
                  </p>
                  <a
                    href={addressUrl(agent.shareTokenAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[12px] text-white/40 hover:text-white/70 transition-colors flex items-center gap-1"
                  >
                    {truncate(agent.shareTokenAddress, [6, 4])}
                    <IconExternalLink size={10} />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Subscription */}
          <div className="bg-white/3 border border-white/10 rounded-xl p-5 mb-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-1">
                  Subscription
                </p>
                <p className="font-sans text-[13px] text-white/50 tracking-[-0.01em]">
                  Subscribe to receive trade signals. Unsubscribing refunds your
                  remaining balance.
                </p>
              </div>
              <SubscriptionActions agentId={agent.id} />
            </div>
          </div>

          {/* Recent trades */}
          <div className="bg-white/3 border border-white/10 rounded-xl overflow-hidden">
            <div className="bg-white/5 px-4 py-3 flex items-center justify-between">
              <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/50 font-medium">
                Recent Trades
              </p>
              {tradesData && (
                <span className="font-mono text-[11px] text-white/30">
                  {tradesData.total} total
                </span>
              )}
            </div>

            {/* Table header */}
            <div className="flex items-center px-4 py-2.5 gap-3 border-t border-white/6">
              <div className="w-16 shrink-0">
                <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/25 font-medium">
                  Dir
                </span>
              </div>
              <div className="flex-1">
                <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/25 font-medium">
                  Pair / Epoch
                </span>
              </div>
              <div className="w-24 text-right hidden sm:block">
                <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/25 font-medium">
                  Amount
                </span>
              </div>
              <div className="w-16 text-right hidden md:block">
                <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/25 font-medium">
                  Followers
                </span>
              </div>
              <div className="w-20 text-right">
                <span className="font-sans text-[10px] uppercase tracking-[0.05em] text-white/25 font-medium">
                  Status
                </span>
              </div>
              <div className="w-6 shrink-0" />
            </div>

            {tradesLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center px-4 py-3 border-t border-white/6 gap-3 animate-pulse"
                >
                  <div className="w-16 h-5 bg-white/5 rounded" />
                  <div className="flex-1 h-4 bg-white/5 rounded" />
                  <div className="w-24 h-4 bg-white/5 rounded hidden sm:block" />
                  <div className="w-20 h-4 bg-white/5 rounded" />
                </div>
              ))
            ) : tradesData?.trades.length ? (
              tradesData.trades.map((trade) => (
                <AgentTradeRow key={trade.id} trade={trade} />
              ))
            ) : (
              <div className="px-4 py-10 text-center">
                <p className="font-sans text-[13px] text-white/30">
                  No trades yet
                </p>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
