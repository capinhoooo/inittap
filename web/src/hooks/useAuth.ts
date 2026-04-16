import { useCallback, useEffect, useState } from 'react'
import { useSignMessage } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { getNonce, verifySignature } from '@/lib/api'

const STORAGE_KEY = 'inittap_jwt'

function isValidJwt(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    for (const part of parts) {
      atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    }
    return true
  } catch {
    return false
  }
}

function readToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const token = localStorage.getItem(STORAGE_KEY)
    if (token && isValidJwt(token)) return token
    return null
  } catch {
    return null
  }
}

function writeToken(token: string) {
  try {
    localStorage.setItem(STORAGE_KEY, token)
  } catch {}
}

function clearToken() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

export function useAuth() {
  const [token, setToken] = useState<string | null>(null)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { signMessageAsync } = useSignMessage()
  const queryClient = useQueryClient()

  useEffect(() => {
    const stored = readToken()
    setToken(stored)
  }, [])

  const authenticate = useCallback(
    async (hexAddress: string) => {
      setIsAuthenticating(true)
      setError(null)
      try {
        const nonce = await getNonce(hexAddress)
        const signature = await signMessageAsync({ message: nonce })
        const result = await verifySignature(hexAddress, signature)
        writeToken(result.token)
        setToken(result.token)
        await queryClient.invalidateQueries({ queryKey: ['user'] })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Authentication failed'
        setError(msg)
        throw err
      } finally {
        setIsAuthenticating(false)
      }
    },
    [signMessageAsync, queryClient],
  )

  const logout = useCallback(() => {
    clearToken()
    setToken(null)
    queryClient.invalidateQueries({ queryKey: ['user'] })
  }, [queryClient])

  return { token, isAuthenticating, error, authenticate, logout }
}
