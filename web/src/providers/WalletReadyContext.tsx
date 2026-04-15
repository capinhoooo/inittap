import { createContext, useContext } from 'react'
import { useAccount } from 'wagmi'

const WalletReadyContext = createContext(false)

export function useWalletReady(): boolean {
  return useContext(WalletReadyContext)
}

export function WalletReadyProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const { status } = useAccount()
  const ready = status === 'connected' || status === 'disconnected'

  return (
    <WalletReadyContext.Provider value={ready}>
      {children}
    </WalletReadyContext.Provider>
  )
}
