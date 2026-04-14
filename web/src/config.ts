interface AppConfig {
  appName: string
  appDescription: string
  apiUrl: string
  links: {
    twitter: string
    github: string
    telegram: string
    discord: string
    docs: string
    buy: string
  }
  contracts: {
    tapPredictor: string
    copyVault: string
    tapToken: string
    agentRegistry: string
    vipScore: string
    connectOracle: string
  }
  chain: {
    id: number
    name: string
    rpcUrl: string
    nativeCurrency: { name: string; symbol: string; decimals: number }
  }
  betting: {
    minBetWei: string
    maxBetWei: string
    minBetInit: number
    maxBetInit: number
  }
  features: {
    darkMode: boolean
    smoothScroll: boolean
  }
}

export const config: AppConfig = {
  appName: 'INITTAP',
  appDescription: 'Tap to predict. Win on Initia.',

  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:3700',

  links: {
    twitter: 'https://twitter.com/inittap',
    github: '',
    telegram: '',
    discord: '',
    docs: '',
    buy: '',
  },

  contracts: {
    tapPredictor: '0x615a71c4fc146182A6501E45997D361609829F84',
    copyVault: '0x29238F71b552a5bcC772d830B867B67D37E0af5C',
    tapToken: '0xE935dbf15c2418be20Ad0be81A3a2203934d8B3e',
    agentRegistry: '0x3582d890fe61189B012Be63f550d54cf6dE1F9DC',
    vipScore: '0x02dd9E4b05Dd4a67A073EE9746192afE1FA30906',
    connectOracle: '0x031ECb63480983FD216D17BB6e1d393f3816b72F',
  },

  chain: {
    id: 2124225178762456,
    name: 'Initia MiniEVM',
    rpcUrl: 'https://jsonrpc-evm-1.anvil.asia-southeast.initia.xyz',
    nativeCurrency: { name: 'GAS', symbol: 'GAS', decimals: 18 },
  },

  betting: {
    minBetWei: '100000000000000000',
    maxBetWei: '100000000000000000000',
    minBetInit: 0.1,
    maxBetInit: 100,
  },

  features: {
    darkMode: true,
    smoothScroll: true,
  },
}

export type Config = AppConfig
