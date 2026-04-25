import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import HeroUIProvider from '../providers/HeroUIProvider'
import LenisSmoothScrollProvider from '../providers/LenisSmoothScrollProvider'
import InitiaProvider from '../providers/InitiaProvider'
import ErrorPage from '../components/ErrorPage'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  errorComponent: ({ error, reset }) => (
    <ErrorPage error={error} reset={reset} />
  ),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'INITTAP | Tap Trading on Initia' },
      {
        name: 'description',
        content:
          'Tap to predict. Win on Initia. Price prediction trading powered by Slinky oracle.',
      },
      { name: 'theme-color', content: '#1f2228' },
      {
        httpEquiv: 'Content-Security-Policy',
        content:
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://assets.initia.xyz; style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://assets.initia.xyz; connect-src 'self' http://localhost:* https: wss:; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com https://assets.initia.xyz;",
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/assets/inittap-logo.svg' },
    ],
  }),

  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-[#1f2228] text-white antialiased">
        <InitiaProvider>
          <HeroUIProvider>
            <LenisSmoothScrollProvider />
            {children}
            <TanStackDevtools
              config={{ position: 'bottom-right' }}
              plugins={[
                {
                  name: 'Tanstack Router',
                  render: <TanStackRouterDevtoolsPanel />,
                },
                TanStackQueryDevtools,
              ]}
            />
          </HeroUIProvider>
        </InitiaProvider>
        <Scripts />
      </body>
    </html>
  )
}
