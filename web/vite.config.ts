import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  plugins: [
    devtools(),
    nitro({
      preset: 'netlify',
    }),
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  ssr: {
    // Exclude wallet/chain packages from SSR - they use browser APIs and
    // have ESM import issues in Node.js SSR context
    external: [
      '@initia/interwovenkit-react',
      '@initia/initia.proto',
      'wagmi',
      'viem',
    ],
    noExternal: [],
  },
})

export default config
