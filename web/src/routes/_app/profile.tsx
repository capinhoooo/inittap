import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { useInterwovenKit, usePortfolio } from '@initia/interwovenkit-react'
import { MsgCall } from '@initia/initia.proto/minievm/evm/v1/tx'
import { useState } from 'react'
import {
  IconBridge,
  IconChains,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconVoltage,
} from '@initia/icons-react'
import { fromBaseUnit, truncate } from '@initia/utils'
import { encodeFunctionData, keccak256, toBytes } from 'viem'
import type { Bet } from '@/lib/api'
import {
  getClaimable,
  getPendingRefund,
  getTokenBalance,
  getUserBets,
  getUserProfile,
  getVipScore,
} from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import AnimateComponent from '@/components/elements/AnimateComponent'
import { useWalletReady } from '@/providers/WalletReadyContext'
import { cnm } from '@/utils/style'
import { formatUiNumber } from '@/utils/format'
import { EASE_OUT_CUBIC } from '@/config/animation'
import { addressUrl, txUrl } from '@/utils/scan'
import { config } from '@/config'

export const Route = createFileRoute('/_app/profile')({
  component: ProfilePageWrapper,
})

function ProfilePageWrapper() {
  const walletReady = useWalletReady()

  if (!walletReady) {
    return (
      <div className="min-h-screen bg-[#1f2228] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
      </div>
    )
  }

  return <ProfilePage />
}

function useCopyToClipboard() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (text: string, key: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(key)
        setTimeout(() => setCopied(null), 2000)
      })
      .catch(() => {})
  }
  return { copied, copy }
}

function BetRow({ bet }: { bet: Bet }) {
  const isBull = bet.position === 'Bull'
  const amount = parseFloat(fromBaseUnit(bet.amount, { decimals: 18 }))
  const betTxUrl = txUrl(bet.txHash)

  return (
    <div className="flex items-center px-4 py-3 border-t border-white/6 hover:bg-white/3 transition-colors duration-150 gap-3">
      <span
        className={cnm(
          'font-mono text-[11px] uppercase tracking-[0.04em] px-2 py-0.5 rounded border shrink-0',
          isBull
            ? 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/20'
            : 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/20',
        )}
      >
        {isBull ? '▲ Up' : '▼ Down'}
      </span>
      <span className="font-sans text-[12px] text-white/40 shrink-0">
        {bet.pairId}
      </span>
      <span className="font-mono text-[13px] text-white/60 tabular-nums shrink-0">
        Epoch #{bet.epoch}
      </span>
      <span className="font-mono text-[13px] text-white tabular-nums ml-auto">
        {formatUiNumber(amount, 'INIT')}
      </span>
      {bet.claimed && (
        <span className="font-mono text-[10px] uppercase tracking-[0.04em] bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/20 px-1.5 py-0.5 rounded">
          Claimed
        </span>
      )}
      {bet.txHash && betTxUrl !== '#' && (
        <a
          href={betTxUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/20 hover:text-white/60 transition-colors shrink-0"
        >
          <IconExternalLink size={12} />
        </a>
      )}
    </div>
  )
}

// Portfolio section — calls usePortfolio at component level (rules-of-hooks safe)
function PortfolioSection() {
  const { isLoading, totalValue, assetGroups } = usePortfolio()

  // Skip when empty and not loading
  if (!isLoading && totalValue === 0 && assetGroups.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT_CUBIC, delay: 0.15 }}
      className="bg-white/3 border border-white/10 rounded-xl p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <IconChains size={13} className="text-white/30" />
        <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium">
          Portfolio
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-7 bg-white/5 rounded w-32 mb-3" />
          <div className="h-4 bg-white/5 rounded w-full" />
          <div className="h-4 bg-white/5 rounded w-3/4" />
        </div>
      ) : (
        <>
          <div className="mb-4">
            <p className="font-sans text-[11px] text-white/30 mb-1">
              Total Value
            </p>
            <p className="font-mono text-[22px] tracking-[-0.02em] text-white tabular-nums">
              $
              {totalValue.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
          {assetGroups.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-white/6">
              {assetGroups.slice(0, 5).map((group) => {
                const qty = group.assets.reduce(
                  (acc, a) => acc + parseFloat(a.quantity || '0'),
                  0,
                )
                const val = group.assets.reduce(
                  (acc, a) => acc + (a.value ?? 0),
                  0,
                )
                return (
                  <div
                    key={group.symbol}
                    className="flex items-center justify-between"
                  >
                    <span className="font-mono text-[13px] text-white/60">
                      {group.symbol}
                    </span>
                    <div className="text-right">
                      <span className="font-mono text-[13px] text-white tabular-nums">
                        {qty.toFixed(4)}
                      </span>
                      {val > 0 && (
                        <span className="font-mono text-[11px] text-white/30 ml-2 tabular-nums">
                          ${val.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </motion.div>
  )
}

function VipStageLabel(stage: number): string {
  if (stage === 0) return 'None'
  return `VIP ${stage}`
}

const CLAIM_ABI = [
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

const CLAIM_REFUND_ABI = [
  {
    name: 'claimRefund',
    type: 'function',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

type ClaimTxState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'success'; txHash: string }
  | { phase: 'error'; message: string }

function ProfilePage() {
  const {
    isConnected,
    openConnect,
    openDeposit,
    openWithdraw,
    address,
    initiaAddress,
    username,
    autoSign,
    requestTxBlock,
  } = useInterwovenKit()
  const { token, logout } = useAuth()
  const { copied, copy } = useCopyToClipboard()
  const queryClient = useQueryClient()
  const [autoSignLoading, setAutoSignLoading] = useState(false)
  const [claimTxState, setClaimTxState] = useState<ClaimTxState>({
    phase: 'idle',
  })
  const [refundTxState, setRefundTxState] = useState<ClaimTxState>({
    phase: 'idle',
  })

  const [betsPage, setBetsPage] = useState(0)
  const PAGE_SIZE = 10

  // Check AutoSign via cosmos chain ID "evm-1"
  const autoSignEnabled =
    autoSign.isEnabledByChain['evm-1'] ??
    Object.values(autoSign.isEnabledByChain).some(Boolean)

  const { data: profileData, isLoading: profileLoading } = useQuery({
    queryKey: ['user', 'profile', token],
    queryFn: () => getUserProfile(token!),
    enabled: Boolean(token),
    staleTime: 30_000,
  })

  const { data: betsData, isLoading: betsLoading } = useQuery({
    queryKey: ['user', 'bets', token, betsPage],
    queryFn: () =>
      getUserBets(token!, { limit: PAGE_SIZE, offset: betsPage * PAGE_SIZE }),
    enabled: Boolean(token),
    staleTime: 15_000,
  })

  const { data: claimableData } = useQuery({
    queryKey: ['user', 'claimable', token],
    queryFn: () => getClaimable(token!),
    enabled: Boolean(token),
    staleTime: 10_000,
  })

  const { data: vipData } = useQuery({
    queryKey: ['vip', address],
    queryFn: () => getVipScore(address),
    enabled: Boolean(address),
    staleTime: 60_000,
    retry: false,
  })

  const { data: tapBalance } = useQuery({
    queryKey: ['tap-balance', address],
    queryFn: () => getTokenBalance(address),
    enabled: Boolean(address),
    staleTime: 30_000,
    retry: false,
  })

  const { data: refundData } = useQuery({
    queryKey: ['bridge', 'refund', address],
    queryFn: () => getPendingRefund(address),
    enabled: Boolean(address),
    staleTime: 30_000,
    retry: false,
  })

  const user = profileData?.user
  const stats = profileData?.stats
  const vipStage = vipData ? parseInt(vipData.stage, 10) : 0
  const vipScore = vipData ? vipData.score : null
  const tapAmt = tapBalance
    ? parseFloat(fromBaseUnit(tapBalance.evmBalance, { decimals: 18 })) +
      parseFloat(fromBaseUnit(tapBalance.cosmosBalance, { decimals: 18 }))
    : null

  const initBalanceFloat = user?.initBalance
    ? parseFloat(fromBaseUnit(user.initBalance, { decimals: 18 }))
    : null
  const isLowBalance = initBalanceFloat !== null && initBalanceFloat < 1

  async function handleClaim() {
    const items = claimableData?.claimable
    if (!items || items.length === 0 || !initiaAddress) return
    setClaimTxState({ phase: 'submitting' })
    try {
      const pairHashes = items.map((item) => keccak256(toBytes(item.pairId)))
      const epochs = items.map((item) => BigInt(item.epoch))
      const calldata = encodeFunctionData({
        abi: CLAIM_ABI,
        functionName: 'claim',
        args: [pairHashes, epochs],
      })
      const msg = {
        typeUrl: '/minievm.evm.v1.MsgCall',
        value: MsgCall.fromPartial({
          sender: initiaAddress,
          contractAddr: config.contracts.tapPredictor,
          input: calldata.slice(2),
          value: '0',
          accessList: [],
          authList: [],
        }),
      }
      const result = await requestTxBlock({
        messages: [msg],
        chainId: 'evm-1',
        gasAdjustment: 1.3,
      })
      setClaimTxState({ phase: 'success', txHash: result.transactionHash })
      await queryClient.invalidateQueries({ queryKey: ['user', 'claimable'] })
      await queryClient.invalidateQueries({ queryKey: ['user', 'profile'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const friendly =
        msg.includes('user rejected') || msg.includes('rejected')
          ? 'Transaction rejected'
          : msg.includes('execution reverted')
            ? 'Transaction reverted by contract'
            : 'Claim failed. Please try again.'
      setClaimTxState({ phase: 'error', message: friendly })
    }
  }

  async function handleClaimRefund() {
    if (!initiaAddress) return
    setRefundTxState({ phase: 'submitting' })
    try {
      const calldata = encodeFunctionData({
        abi: CLAIM_REFUND_ABI,
        functionName: 'claimRefund',
        args: [],
      })
      const msg = {
        typeUrl: '/minievm.evm.v1.MsgCall',
        value: MsgCall.fromPartial({
          sender: initiaAddress,
          contractAddr: config.contracts.tapPredictor,
          input: calldata.slice(2),
          value: '0',
          accessList: [],
          authList: [],
        }),
      }
      const result = await requestTxBlock({
        messages: [msg],
        chainId: 'evm-1',
        gasAdjustment: 1.3,
      })
      setRefundTxState({ phase: 'success', txHash: result.transactionHash })
      await queryClient.invalidateQueries({ queryKey: ['bridge', 'refund'] })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const friendly =
        errMsg.includes('user rejected') || errMsg.includes('rejected')
          ? 'Transaction rejected'
          : errMsg.includes('execution reverted')
            ? 'Transaction reverted by contract'
            : 'Refund claim failed. Please try again.'
      setRefundTxState({ phase: 'error', message: friendly })
    }
  }

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-[#1f2228] flex items-center justify-center">
        <div className="text-center max-w-sm px-4">
          <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-6">
            <IconVoltage size={24} color="rgba(255,255,255,0.3)" />
          </div>
          <h2 className="font-mono text-[22px] font-light tracking-[-0.03em] text-white mb-3">
            Connect Wallet
          </h2>
          <p className="font-sans text-[14px] text-white/40 tracking-[-0.01em] mb-6 leading-[1.6]">
            Connect your Initia wallet to view your profile, track bets, and
            claim rewards.
          </p>
          <motion.button
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.1 }}
            onClick={openConnect}
            className="bg-white text-[#1f2228] font-mono text-[13px] uppercase tracking-[0.08em] px-6 py-3 rounded-lg hover:bg-white/90 transition-colors duration-200"
          >
            Connect Wallet
          </motion.button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#1f2228]">
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <AnimateComponent entry="fadeInUp">
          <h1 className="font-mono text-[28px] font-light tracking-[-0.03em] text-white mb-8">
            Profile
          </h1>
        </AnimateComponent>

        {/* R13: Low balance bridge prompt */}
        {isLowBalance && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE_OUT_CUBIC }}
            className="bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded-xl p-4 mb-6 flex items-center justify-between gap-4"
          >
            <div>
              <p className="font-sans text-[13px] text-[#F59E0B] font-medium">
                Low INIT Balance
              </p>
              <p className="font-sans text-[12px] text-white/40 mt-0.5">
                Bridge funds to start trading on INITTAP
              </p>
            </div>
            <button
              onClick={() =>
                openDeposit({
                  denoms: ['evm/2eE7007DF876084d4C74685e90bB7f4cd7c86e22'],
                  chainId: 'evm-1',
                })
              }
              className="shrink-0 bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/20 font-mono text-[12px] uppercase tracking-[0.06em] px-4 py-2 rounded-lg hover:bg-[#F59E0B]/25 transition-colors duration-200"
            >
              Bridge Now
            </button>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Identity */}
          <div className="space-y-4">
            {/* Address card */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT_CUBIC }}
              className="bg-white/3 border border-white/10 rounded-xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium">
                  Wallet
                </p>
                {vipStage > 0 && vipData && (
                  <span className="font-mono text-[11px] uppercase tracking-[0.05em] bg-white/5 border border-white/20 text-white px-2 py-0.5 rounded-md">
                    {VipStageLabel(vipStage)}
                  </span>
                )}
              </div>

              {/* .init username */}
              {username && (
                <div className="mb-3 pb-3 border-b border-white/6">
                  <p className="font-sans text-[11px] text-white/30 mb-1">
                    Username
                  </p>
                  <p className="font-mono text-[15px] text-white tracking-[-0.01em]">
                    {username}
                  </p>
                </div>
              )}

              {/* EVM address */}
              <div className="mb-3">
                <p className="font-sans text-[11px] text-white/30 mb-1">
                  EVM Address
                </p>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-[13px] text-white flex-1 truncate">
                    {address ? truncate(address, [8, 6]) : '—'}
                  </p>
                  {address && (
                    <button
                      onClick={() => copy(address, 'evm')}
                      className="text-white/30 hover:text-white transition-colors"
                    >
                      {copied === 'evm' ? (
                        <IconCheck size={12} className="text-[#22C55E]" />
                      ) : (
                        <IconCopy size={12} />
                      )}
                    </button>
                  )}
                  {address && addressUrl(address) !== '#' && (
                    <a
                      href={addressUrl(address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/30 hover:text-white transition-colors"
                    >
                      <IconExternalLink size={12} />
                    </a>
                  )}
                </div>
              </div>

              {/* Initia bech32 address */}
              {initiaAddress && (
                <div className="mb-3">
                  <p className="font-sans text-[11px] text-white/30 mb-1">
                    Initia Address
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-[11px] text-white/60 flex-1 truncate">
                      {truncate(initiaAddress, [10, 6])}
                    </p>
                    <button
                      onClick={() => copy(initiaAddress, 'initia')}
                      className="text-white/30 hover:text-white transition-colors"
                    >
                      {copied === 'initia' ? (
                        <IconCheck size={12} className="text-[#22C55E]" />
                      ) : (
                        <IconCopy size={12} />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Balances */}
              <div className="pt-3 border-t border-white/6 space-y-2">
                {user?.initBalance && (
                  <div className="flex items-center justify-between">
                    <p className="font-sans text-[11px] text-white/30">
                      INIT Balance
                    </p>
                    <p className="font-mono text-[15px] tracking-[-0.02em] text-white tabular-nums">
                      {formatUiNumber(
                        parseFloat(
                          fromBaseUnit(user.initBalance, { decimals: 18 }),
                        ),
                        'INIT',
                      )}
                    </p>
                  </div>
                )}
                {tapAmt !== null && (
                  <div className="flex items-center justify-between">
                    <p className="font-sans text-[11px] text-white/30">
                      TAP Balance
                    </p>
                    <p className="font-mono text-[15px] tracking-[-0.02em] text-white tabular-nums">
                      {formatUiNumber(tapAmt, 'TAP')}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>

            {/* VIP Score card */}
            {vipData && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.3,
                  ease: EASE_OUT_CUBIC,
                  delay: 0.04,
                }}
                className="bg-white/3 border border-white/10 rounded-xl p-5"
              >
                <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-3">
                  Initia VIP
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="font-sans text-[11px] text-white/30 mb-1">
                      Score
                    </p>
                    <p className="font-mono text-[22px] tracking-[-0.02em] text-white tabular-nums">
                      {vipScore ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="font-sans text-[11px] text-white/30 mb-1">
                      Stage
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {vipStage > 0 ? (
                        <span className="font-mono text-[13px] uppercase tracking-[0.05em] bg-white/5 border border-white/20 text-white px-2.5 py-1 rounded-md">
                          {VipStageLabel(vipStage)}
                        </span>
                      ) : (
                        <span className="font-mono text-[13px] text-white/30">
                          None
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* AutoSign status card */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT_CUBIC, delay: 0.06 }}
              className="bg-white/3 border border-white/10 rounded-xl p-5"
            >
              <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-3">
                AutoSign
              </p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <IconVoltage
                    size={14}
                    color={
                      autoSignEnabled ? '#22C55E' : 'rgba(255,255,255,0.2)'
                    }
                  />
                  <span className="font-sans text-[13px] text-white/60">
                    {autoSignEnabled ? 'Enabled' : 'Inactive'}
                  </span>
                </div>
                <span
                  className={cnm(
                    'font-mono text-[11px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-md border',
                    autoSignEnabled
                      ? 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/20'
                      : 'bg-white/5 text-white/30 border-white/10',
                  )}
                >
                  {autoSignEnabled ? 'Auto-Sign On' : 'Auto-Sign Off'}
                </span>
              </div>
              {autoSignEnabled && (
                <p className="font-sans text-[11px] text-white/30 mt-2 leading-[1.5]">
                  Transactions auto-approve on Initia. No wallet popups during
                  trading.
                </p>
              )}
              {autoSign.expiredAtByChain['evm-1'] && (
                <div className="mt-2 pt-2 border-t border-white/6">
                  <div className="flex items-center justify-between">
                    <span className="font-sans text-[11px] text-white/30">
                      Expires
                    </span>
                    <span className="font-mono text-[11px] text-white/50 tabular-nums">
                      {new Date(
                        autoSign.expiredAtByChain['evm-1'],
                      ).toLocaleString()}
                    </span>
                  </div>
                </div>
              )}
              {autoSign.granteeByChain['evm-1'] && (
                <div className="mt-1">
                  <div className="flex items-center justify-between">
                    <span className="font-sans text-[11px] text-white/30">
                      Grantee
                    </span>
                    <span className="font-mono text-[11px] text-white/40 truncate max-w-[180px]">
                      {truncate(autoSign.granteeByChain['evm-1'], [8, 6])}
                    </span>
                  </div>
                </div>
              )}
              <button
                disabled={autoSignLoading}
                onClick={async () => {
                  setAutoSignLoading(true)
                  try {
                    if (autoSignEnabled) {
                      await autoSign.disable('evm-1')
                    } else {
                      // Retry with exponential backoff for sequence mismatch
                      // caused by load-balanced RPC nodes returning stale state
                      const MAX_RETRIES = 4
                      let lastErr: unknown
                      for (let i = 0; i < MAX_RETRIES; i++) {
                        try {
                          await autoSign.enable('evm-1')
                          lastErr = null
                          break
                        } catch (err) {
                          lastErr = err
                          const msg = err instanceof Error ? err.message : ''
                          if (
                            msg.includes('account sequence mismatch') &&
                            i < MAX_RETRIES - 1
                          ) {
                            await new Promise((r) =>
                              setTimeout(r, 3000 * Math.pow(2, i)),
                            )
                            continue
                          }
                          throw err
                        }
                      }
                      if (lastErr) throw lastErr
                    }
                  } catch (err) {
                    console.error('AutoSign toggle failed:', err)
                  } finally {
                    setAutoSignLoading(false)
                  }
                }}
                className={cnm(
                  'mt-3 w-full font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg border transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed',
                  autoSignEnabled
                    ? 'bg-white/5 text-white/40 border-white/10 hover:text-white hover:bg-white/8'
                    : 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/20 hover:bg-[#22C55E]/25',
                )}
              >
                {autoSignLoading
                  ? 'Updating...'
                  : autoSignEnabled
                    ? 'Disable AutoSign'
                    : 'Enable AutoSign'}
              </button>
            </motion.div>

            {/* Bridge */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT_CUBIC, delay: 0.08 }}
              className="bg-white/3 border border-white/10 rounded-xl p-5"
            >
              <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-3">
                Interwoven Bridge
              </p>
              <p className="font-sans text-[12px] text-white/40 tracking-[-0.01em] mb-4 leading-[1.5]">
                Move assets across Initia chains.
              </p>
              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  transition={{ duration: 0.1 }}
                  onClick={() => {
                    try {
                      openDeposit({
                        denoms: [
                          'evm/2eE7007DF876084d4C74685e90bB7f4cd7c86e22',
                        ],
                        chainId: 'evm-1',
                      })
                    } catch {
                      // fallback handled by InterwovenKit
                    }
                  }}
                  className="flex-1 flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-white font-mono text-[12px] uppercase tracking-[0.06em] py-2.5 rounded-lg hover:bg-white/8 hover:border-white/20 transition-colors duration-200"
                >
                  <IconBridge size={13} />
                  Deposit
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  transition={{ duration: 0.1 }}
                  onClick={() => {
                    try {
                      openWithdraw({
                        denoms: [
                          'evm/2eE7007DF876084d4C74685e90bB7f4cd7c86e22',
                        ],
                        chainId: 'evm-1',
                      })
                    } catch {
                      // fallback handled by InterwovenKit
                    }
                  }}
                  className="flex-1 flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-white font-mono text-[12px] uppercase tracking-[0.06em] py-2.5 rounded-lg hover:bg-white/8 hover:border-white/20 transition-colors duration-200"
                >
                  <IconBridge size={13} />
                  Withdraw
                </motion.button>
              </div>
            </motion.div>

            {/* Cross-chain Portfolio */}
            <PortfolioSection />

            {/* Session */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT_CUBIC, delay: 0.1 }}
              className="bg-white/3 border border-white/10 rounded-xl p-5"
            >
              <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-3">
                Session
              </p>
              <div className="flex items-center justify-between mb-3">
                <span className="font-sans text-[13px] text-white/60">
                  Auth Status
                </span>
                {token ? (
                  <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em] bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/20 px-2 py-0.5 rounded-md">
                    <span className="w-1 h-1 rounded-full bg-[#22C55E]" />
                    Active
                  </span>
                ) : (
                  <span className="font-mono text-[11px] uppercase tracking-[0.04em] bg-white/5 text-white/40 border border-white/10 px-2 py-0.5 rounded-md">
                    Inactive
                  </span>
                )}
              </div>
              {token && (
                <button
                  onClick={logout}
                  className="w-full bg-transparent text-white/40 border border-white/10 font-mono text-[12px] uppercase tracking-[0.06em] py-2 rounded-lg hover:text-white hover:bg-white/5 transition-colors duration-200"
                >
                  Sign Out
                </button>
              )}
            </motion.div>
          </div>

          {/* Right: Stats + Bets */}
          <div className="lg:col-span-2 space-y-6">
            {/* Stats */}
            {profileLoading ? (
              <div className="bg-white/3 border border-white/10 rounded-xl p-5 animate-pulse">
                <div className="grid grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-14 bg-white/5 rounded-lg" />
                  ))}
                </div>
              </div>
            ) : stats ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE_OUT_CUBIC }}
                className="bg-white/3 border border-white/10 rounded-xl p-5"
              >
                <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-4">
                  Statistics
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {[
                    { label: 'Total Bets', value: String(stats.totalBets) },
                    {
                      label: 'Wins',
                      value: String(stats.totalWins),
                      pos: true,
                    },
                    {
                      label: 'Win Rate',
                      value: `${stats.totalBets > 0 ? ((stats.totalWins / stats.totalBets) * 100).toFixed(0) : 0}%`,
                    },
                    { label: 'Streak', value: `${stats.currentStreak}x` },
                    {
                      label: 'Volume',
                      value: formatUiNumber(
                        parseFloat(
                          fromBaseUnit(stats.totalBetVolume, { decimals: 18 }),
                        ),
                        'INIT',
                        { humanize: true, humanizeThreshold: 1000 },
                      ),
                    },
                    {
                      label: 'Net PnL',
                      value: `${parseFloat(stats.netPnL) >= 0 ? '+' : ''}${formatUiNumber(parseFloat(fromBaseUnit(stats.netPnL, { decimals: 18 })), 'INIT', { humanize: true, humanizeThreshold: 1000 })}`,
                      pnl: true,
                      pnlPos: parseFloat(stats.netPnL) >= 0,
                    },
                  ].map((stat) => (
                    <div key={stat.label}>
                      <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/30 font-medium mb-1">
                        {stat.label}
                      </p>
                      <p
                        className={cnm(
                          'font-mono text-[20px] tracking-[-0.02em] tabular-nums',
                          stat.pnl
                            ? stat.pnlPos
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
              </motion.div>
            ) : null}

            {/* Claimable rewards */}
            {claimableData?.claimable && claimableData.claimable.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.3,
                  ease: EASE_OUT_CUBIC,
                  delay: 0.05,
                }}
                className="bg-[#22C55E]/5 border border-[#22C55E]/15 rounded-xl p-5"
              >
                <div className="flex items-center justify-between mb-4">
                  <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-[#22C55E]/70 font-medium">
                    Claimable Rewards
                  </p>
                  <span className="font-mono text-[11px] bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/20 px-2 py-0.5 rounded-md">
                    {claimableData.claimable.length} rounds
                  </span>
                </div>
                <div className="space-y-2 mb-4">
                  {claimableData.claimable.slice(0, 3).map((item) => (
                    <div
                      key={`${item.pairId}-${item.epoch}`}
                      className="flex items-center justify-between"
                    >
                      <span className="font-sans text-[13px] text-white/60">
                        {item.pairName} · Epoch #{item.epoch}
                      </span>
                      <span className="font-mono text-[13px] text-[#22C55E] tabular-nums">
                        +
                        {formatUiNumber(
                          parseFloat(
                            fromBaseUnit(item.amount, { decimals: 18 }),
                          ),
                          'INIT',
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {/* Claim tx feedback */}
                {claimTxState.phase === 'success' && (
                  <div className="mb-3 px-3 py-2.5 bg-[#22C55E]/10 border border-[#22C55E]/20 rounded-lg flex items-center justify-between gap-3">
                    <p className="font-sans text-[13px] text-[#22C55E]">
                      Claimed successfully
                    </p>
                    {txUrl(claimTxState.txHash) !== '#' && (
                      <a
                        href={txUrl(claimTxState.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 font-mono text-[12px] text-[#22C55E]/70 hover:text-[#22C55E] transition-colors shrink-0"
                      >
                        View tx
                        <IconExternalLink size={11} />
                      </a>
                    )}
                  </div>
                )}
                {claimTxState.phase === 'error' && (
                  <div className="mb-3 px-3 py-2.5 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg">
                    <p className="font-sans text-[13px] text-[#EF4444]">
                      {claimTxState.message}
                    </p>
                  </div>
                )}

                <motion.button
                  whileTap={
                    claimTxState.phase === 'submitting' ? {} : { scale: 0.97 }
                  }
                  transition={{ duration: 0.1 }}
                  onClick={handleClaim}
                  disabled={claimTxState.phase === 'submitting'}
                  className="w-full bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/20 font-mono text-[13px] uppercase tracking-[0.08em] py-2.5 rounded-lg hover:bg-[#22C55E]/25 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {claimTxState.phase === 'submitting'
                    ? 'Claiming...'
                    : 'Claim All'}
                </motion.button>
              </motion.div>
            )}

            {/* Bridge refund banner */}
            {refundData?.hasPendingRefund && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.3,
                  ease: EASE_OUT_CUBIC,
                  delay: 0.06,
                }}
                className="bg-[#F59E0B]/5 border border-[#F59E0B]/15 rounded-xl p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-[#F59E0B]/70 font-medium">
                    Pending Bridge Refund
                  </p>
                </div>
                <p className="font-sans text-[13px] text-white/60 mb-4">
                  You have a pending bridge refund of{' '}
                  <span className="font-mono text-[#F59E0B]">
                    {formatUiNumber(
                      parseFloat(
                        fromBaseUnit(refundData.pendingRefund, {
                          decimals: 18,
                        }),
                      ),
                      'INIT',
                    )}
                  </span>
                </p>
                {refundTxState.phase === 'success' && (
                  <div className="mb-3 px-3 py-2.5 bg-[#22C55E]/10 border border-[#22C55E]/20 rounded-lg flex items-center justify-between gap-3">
                    <p className="font-sans text-[13px] text-[#22C55E]">
                      Refund claimed
                    </p>
                    {txUrl(refundTxState.txHash) !== '#' && (
                      <a
                        href={txUrl(refundTxState.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 font-mono text-[12px] text-[#22C55E]/70 hover:text-[#22C55E] transition-colors shrink-0"
                      >
                        View tx
                        <IconExternalLink size={11} />
                      </a>
                    )}
                  </div>
                )}
                {refundTxState.phase === 'error' && (
                  <div className="mb-3 px-3 py-2.5 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg">
                    <p className="font-sans text-[13px] text-[#EF4444]">
                      {refundTxState.message}
                    </p>
                  </div>
                )}
                <motion.button
                  whileTap={
                    refundTxState.phase === 'submitting' ? {} : { scale: 0.97 }
                  }
                  transition={{ duration: 0.1 }}
                  onClick={handleClaimRefund}
                  disabled={
                    refundTxState.phase === 'submitting' ||
                    refundTxState.phase === 'success'
                  }
                  className="w-full bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/20 font-mono text-[13px] uppercase tracking-[0.08em] py-2.5 rounded-lg hover:bg-[#F59E0B]/25 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {refundTxState.phase === 'submitting'
                    ? 'Claiming...'
                    : refundTxState.phase === 'success'
                      ? 'Claimed'
                      : 'Claim Refund'}
                </motion.button>
              </motion.div>
            )}

            {/* Bet history */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT_CUBIC, delay: 0.1 }}
              className="bg-white/3 border border-white/10 rounded-xl overflow-hidden"
            >
              <div className="bg-white/5 px-4 py-3 flex items-center justify-between">
                <p className="font-sans text-[11px] uppercase tracking-[0.05em] text-white/50 font-medium">
                  Bet History
                </p>
                {betsData && (
                  <span className="font-mono text-[11px] text-white/30">
                    {betsData.total} total
                  </span>
                )}
              </div>

              {betsLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center px-4 py-3 border-t border-white/6 gap-3 animate-pulse"
                  >
                    <div className="w-16 h-5 bg-white/5 rounded" />
                    <div className="flex-1 h-4 bg-white/5 rounded" />
                    <div className="w-20 h-4 bg-white/5 rounded" />
                  </div>
                ))
              ) : betsData?.bets.length ? (
                <>
                  {betsData.bets.map((bet) => (
                    <BetRow key={bet.id} bet={bet} />
                  ))}
                  {betsData.total > PAGE_SIZE && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-white/6">
                      <button
                        onClick={() => setBetsPage((p) => Math.max(0, p - 1))}
                        disabled={betsPage === 0}
                        className="font-mono text-[12px] uppercase tracking-[0.06em] text-white/40 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      >
                        ← Prev
                      </button>
                      <span className="font-mono text-[12px] text-white/30">
                        {betsPage + 1} / {Math.ceil(betsData.total / PAGE_SIZE)}
                      </span>
                      <button
                        onClick={() => setBetsPage((p) => p + 1)}
                        disabled={(betsPage + 1) * PAGE_SIZE >= betsData.total}
                        className="font-mono text-[12px] uppercase tracking-[0.06em] text-white/40 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="px-4 py-10 text-center">
                  <p className="font-sans text-[13px] text-white/30 mb-2">
                    No bets yet
                  </p>
                  <Link
                    to="/trade"
                    className="font-mono text-[12px] uppercase tracking-[0.06em] text-white/40 hover:text-white transition-colors"
                  >
                    Start Trading →
                  </Link>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  )
}
