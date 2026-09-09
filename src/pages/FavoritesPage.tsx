import { useEffect, useState } from 'react'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { useFavorites } from '../store/FavoritesContext'
import { ProductGrid } from '../components/ProductGrid'
import { api, ApiError, type ApiProduct } from '../utils/api'
import { ar } from '../i18n/ar'

export function FavoritesPage() {
  const { user, loading: authLoading } = useRequireAuth()
  const { isFavorite } = useFavorites()
  const [favorites, setFavorites] = useState<ApiProduct[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    api.listFavorites()
      .then(({ favorites }) => setFavorites(favorites))
      .catch(err => setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic))
  }, [user])

  if (!user && !authLoading) return null
  if (error) return <div className="empty-card">{error}</div>
  if (!favorites) return null

  // بيتفلتر حسب حالة المفضلة الحية من الـ context عشان أي منتج يتشال من المفضلة
  // (زي زر القلب في نفس الشبكة) يختفي فوراً من غير ما نحتاج نعيد تحميل الصفحة.
  const visibleFavorites = favorites.filter(p => isFavorite(p.id))

  if (visibleFavorites.length === 0) {
    return (
      <div className="empty-card">
        <div className="empty-icon">🤍</div>
        <h2>{ar.favorites.emptyTitle}</h2>
        <p>{ar.favorites.emptyNote}</p>
      </div>
    )
  }

  return (
    <div className="favorites-page">
      <ProductGrid products={visibleFavorites} />
    </div>
  )
}
