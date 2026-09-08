import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type ApiUser } from '../utils/api'

interface AuthContextValue {
  user: ApiUser | null
  loading: boolean
  register: (email: string, password: string, fullName: string) => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  async function register(email: string, password: string, fullName: string) {
    const { user } = await api.register({ email, password, fullName })
    setUser(user)
  }

  async function login(email: string, password: string) {
    const { user } = await api.login({ email, password })
    setUser(user)
  }

  async function logout() {
    await api.logout()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider is missing')
  return value
}
