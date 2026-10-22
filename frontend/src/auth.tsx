import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, session } from './api.ts'
import type { User } from './api.ts'

type AuthState = {
  user: User | null
  loading: boolean
  /** Replace the displayed balance without a round trip (used while a round is being revealed). */
  setBalance: (balance: number) => void
  signIn: (token: string) => Promise<void>
  signOut: () => void
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(() => session.get() !== null)

  const refresh = useCallback(async () => {
    if (!session.get()) {
      setUser(null)
      return
    }
    try {
      setUser(await api<User>('/auth/me'))
    } catch {
      session.clear()
      setUser(null)
    }
  }, [])

  useEffect(() => {
    void refresh().finally(() => setLoading(false))
  }, [refresh])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      refresh,
      setBalance: (balance) => setUser((u) => (u ? { ...u, balance } : u)),
      signIn: async (token) => {
        session.set(token)
        await refresh()
      },
      signOut: () => {
        session.clear()
        setUser(null)
      },
    }),
    [user, loading, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
