import { useEffect } from 'react'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { defineChain } from 'viem'
import {
  InterwovenKitProvider,
  TESTNET,
  initiaPrivyWalletConnector,
  injectStyles,
} from '@initia/interwovenkit-react'
import interwovenKitStyles from '@initia/interwovenkit-react/styles.js'
import { WalletReadyProvider } from './WalletReadyContext'
import { config as appConfig } from '@/config'

const minievm = defineChain({
  id: appConfig.chain.id,
  name: appConfig.chain.name,
  nativeCurrency: appConfig.chain.nativeCurrency,
  rpcUrls: {
    default: { http: [appConfig.chain.rpcUrl] },
  },
})

const wagmiConfig = createConfig({
  connectors: [initiaPrivyWalletConnector],
  chains: [minievm],
  transports: { [minievm.id]: http() },
  ssr: true,
})

export default function WalletProviders({
  children,
}: {
  children: React.ReactNode
}) {
  useEffect(() => {
    injectStyles(interwovenKitStyles)
  }, [])

  return (
    <WagmiProvider config={wagmiConfig}>
      <InterwovenKitProvider
        {...TESTNET}
        enableAutoSign={{ 'evm-1': ['/minievm.evm.v1.MsgCall'] }}
        autoSignFeePolicy={{
          'evm-1': {
            gasMultiplier: 1.3,
            allowedFeeDenoms: ['evm/2eE7007DF876084d4C74685e90bB7f4cd7c86e22'],
          },
        }}
      >
        <WalletReadyProvider>{children}</WalletReadyProvider>
      </InterwovenKitProvider>
    </WagmiProvider>
  )
}
