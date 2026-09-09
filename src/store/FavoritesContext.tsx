import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { api } from '../utils/api'

// المفضلة مبنية على قاعدة البيانات للعميل المسجّل بس (أولوية الثبات عبر الأجهزة) — الزائر
// (من غير تسجيل دخول) بيتوجّه لصفحة الدخول لو حاول يضيف حاجة للمفضلة، من غير أي تخزين محلي.
interface FavoritesContextValue {
  favoriteIds: Set<string>
  isFavorite: (productId: string) => boolean
  toggleFavorite: (productId: string) => Promise<void>
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null)

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!user) {
      setFavoriteIds(new Set())
      return
    }
    api.listFavorites().then(({ favorites }) => setFavoriteIds(new Set(favorites.map(p => p.id)))).catch(() => {})
  }, [user])

  function isFavorite(productId: string) {
    return favoriteIds.has(productId)
  }

  async function toggleFavorite(productId: string) {
    if (!user) return
    const wasFavorite = favoriteIds.has(productId)
    setFavoriteIds(current => {
      const next = new Set(current)
      if (wasFavorite) next.delete(productId)
      else next.add(productId)
      return next
    })
    try {
      if (wasFavorite) await api.removeFavorite(productId)
      else await api.addFavorite(productId)
    } catch {
      // فشل الطلب — نرجّع الحالة القديمة تاني (مفيش تفاؤل بيانات غلط دايم).
      setFavoriteIds(current => {
        const next = new Set(current)
        if (wasFavorite) next.add(productId)
        else next.delete(productId)
        return next
      })
    }
  }

  return (
    <FavoritesContext.Provider value={{ favoriteIds, isFavorite, toggleFavorite }}>
      {children}
    </FavoritesContext.Provider>
  )
}

export function useFavorites() {
  const value = useContext(FavoritesContext)
  if (!value) throw new Error('FavoritesProvider is missing')
  return value
}
