import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type AdminUser } from '../utils/api'

interface AuthContextValue {
  user: AdminUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<AdminUser | { requiresTwoFactor: true, pendingToken: string }>
  verifyTwoFactorLogin: (pendingToken: string, code: string) => Promise<AdminUser>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.me()
      .then(({ user }) => setUser(user.isAdmin ? user : null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  async function login(email: string, password: string) {
    const result = await api.login({ email, password })
    if ('requiresTwoFactor' in result) return result
    if (!result.user.isAdmin) throw new Error('not_admin')
    setUser(result.user)
    return result.user
  }

  async function verifyTwoFactorLogin(pendingToken: string, code: string) {
    const { user } = await api.verifyTwoFactorLogin({ pendingToken, code })
    if (!user.isAdmin) throw new Error('not_admin')
    setUser(user)
    return user
  }

  async function logout() {
    await api.logout()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyTwoFactorLogin, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider is missing')
  return value
}
