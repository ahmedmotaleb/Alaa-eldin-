import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getSettings } from '../store/settingsStore'
import { useAuth } from '../store/AuthContext'
import { toWhatsAppInternational } from '../utils/phone'
import { api, type ApiProduct } from '../utils/api'
import { ProductGrid } from '../components/ProductGrid'
import { Section } from '../components/Section'
import { ar } from '../i18n/ar'

const ACCOUNT_ROWS = [
  { icon: '👤', label: ar.account.editProfile, path: '/account/profile' },
  { icon: '📍', label: ar.account.savedAddresses, path: '/account/addresses' },
  { icon: '❤️', label: ar.account.favorites, path: '/account/favorites' },
  { icon: '↺', label: ar.account.returnPolicy, path: '/refund-exchange-policy' },
  { icon: '⚙️', label: ar.account.settingsAndNotifications, path: undefined }
]

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map(p => p[0]).join(' ') || '؟'
}

export function AccountPage() {
  const navigate = useNavigate()
  const { user, loading, logout } = useAuth()
  const [frequentlyPurchased, setFrequentlyPurchased] = useState<ApiProduct[]>([])

  useEffect(() => {
    if (!user) return
    api.listFrequentlyPurchased().then(({ products }) => setFrequentlyPurchased(products)).catch(() => {})
  }, [user])

  if (loading) return null

  if (!user) {
    return (
      <div className="account-guest-card">
        <h2>{ar.account.guestTitle}</h2>
        <p>{ar.account.guestNote}</p>
        <div className="account-guest-actions">
          <Link className="secondary-button" to="/register">{ar.auth.registerCta}</Link>
          <Link className="primary-button" to="/login">{ar.auth.loginCta}</Link>
        </div>
      </div>
    )
  }

  async function handleLogout() {
    await logout()
    navigate('/')
  }

  return (
    <div className="account-page">
      <div className="profile-card">
        <div className="profile-avatar">{initials(user.fullName)}</div>
        <div className="profile-info">
          <div className="profile-name">{user.fullName}</div>
          <div className="profile-meta">{user.email} · {ar.account.memberSince(new Date(user.createdAt).getFullYear())}</div>
        </div>
      </div>

      <div className="account-rows">
        <a className="account-row" href={`https://wa.me/${toWhatsAppInternational(getSettings().whatsappNumber)}`} target="_blank" rel="noreferrer">
          <span className="account-row-icon">💬</span>
          <span className="account-row-label">{ar.account.contactWhatsapp}</span>
          <span className="account-row-chevron">‹</span>
        </a>
        {ACCOUNT_ROWS.map(row => (
          <button className="account-row" key={row.label} onClick={row.path ? () => navigate(row.path!) : undefined}>
            <span className="account-row-icon">{row.icon}</span>
            <span className="account-row-label">{row.label}</span>
            <span className="account-row-chevron">‹</span>
          </button>
        ))}
        <button className="account-row" onClick={handleLogout}>
          <span className="account-row-icon">🚪</span>
          <span className="account-row-label">{ar.account.logout}</span>
          <span className="account-row-chevron">‹</span>
        </button>
      </div>

      {frequentlyPurchased.length > 0 && (
        <Section title={ar.account.frequentlyPurchasedTitle}>
          <ProductGrid products={frequentlyPurchased} layout="rail" />
        </Section>
      )}
    </div>
  )
}
