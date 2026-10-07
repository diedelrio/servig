import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, refreshSession, setAccessToken, type User } from './api'

type Ctx = {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  can: (permission: string) => boolean
}
const AuthCtx = createContext<Ctx>(null!)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Al cargar, intenta recuperar la sesión con la cookie de refresh.
  useEffect(() => {
    refreshSession().then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const r = await api.post('/auth/login', { email, password })
    setAccessToken(r.data.accessToken)
    setUser(r.data.user)
  }
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {})
    setAccessToken(null)
    setUser(null)
  }
  // Solo para mostrar u ocultar UI; la autorización real la hace el backend.
  const can = (permission: string) => !!user?.permissions.includes(permission)
  return <AuthCtx.Provider value={{ user, loading, login, logout, can }}>{children}</AuthCtx.Provider>
}
