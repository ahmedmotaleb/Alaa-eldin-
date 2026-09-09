import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'
import { useFavorites } from '../store/FavoritesContext'
import { useToast } from '../store/ToastContext'
import { ar } from '../i18n/ar'

export function FavoriteButton({ productId, className = '' }: { productId: string, className?: string }) {
  const { user } = useAuth()
  const { isFavorite, toggleFavorite } = useFavorites()
  const flash = useToast()
  const navigate = useNavigate()
  const active = isFavorite(productId)

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!user) {
      flash(ar.favorites.loginRequired)
      navigate('/login')
      return
    }
    const next = !active
    toggleFavorite(productId)
    flash(next ? ar.favorites.addedToast : ar.favorites.removedToast)
  }

  return (
    <button
      type="button"
      className={`favorite-button ${active ? 'active' : ''} ${className}`}
      onClick={handleClick}
      aria-label={ar.account.favorites}
      aria-pressed={active}
    >
      {active ? '♥' : '♡'}
    </button>
  )
}
