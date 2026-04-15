import { Suspense, lazy, useEffect, useState } from 'react'

// Lazily import the actual wallet provider to prevent SSR module loading errors
const WalletProviders = lazy(() => import('./WalletProviders'))

interface InitiaProviderProps {
  children: React.ReactNode
}

export default function InitiaProvider({ children }: InitiaProviderProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <>{children}</>
  }

  return (
    <Suspense fallback={<>{children}</>}>
      <WalletProviders>{children}</WalletProviders>
    </Suspense>
  )
}
