import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getSettings } from '../store/settingsStore'
import { useAuth } from '../store/AuthContext'
import { toWhatsAppInternational } from '../utils/phone'
import { api, type ApiProduct } from '../utils/api'
import { ProductGrid } from '../components/ProductGrid'
import { Section } from '../components/Section'
import { ar } from '../i18n/ar'

interface AccountRow {
  icon: string
  label: string
  subtitle: string
  path?: string
  external?: string
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map(p => p[0]).join(' ') || '؟'
}

export function AccountPage() {
  const navigate = useNavigate()
  const { user, loading, logout } = useAuth()
  const [frequentlyPurchased, setFrequentlyPurchased] = useState<ApiProduct[]>([])
  const [rewardsBalance, setRewardsBalance] = useState<number | null>(null)

  useEffect(() => {
    if (!user) return
    api.listFrequentlyPurchased().then(({ products }) => setFrequentlyPurchased(products)).catch(() => {})
    // limit=1 لأننا محتاجين بس الرصيد الإجمالي هنا، مش سجل الحركات الكامل — طلب واحد خفيف
    // لنفس الـ endpoint اللي صفحة المكافآت بتستخدمه، مش نظام جديد.
    api.getLoyalty(1, 1).then(summary => setRewardsBalance(summary.balance)).catch(() => {})
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

  const whatsappHref = `https://wa.me/${toWhatsAppInternational(getSettings().whatsappNumber)}`

  const groups: { title: string, rows: AccountRow[] }[] = [
    {
      title: ar.account.groupAccount,
      rows: [
        { icon: '👤', label: ar.account.editProfile, subtitle: ar.account.subtitleEditProfile, path: '/account/profile' },
        { icon: '📍', label: ar.account.savedAddresses, subtitle: ar.account.subtitleAddresses, path: '/account/addresses' },
        { icon: '🔒', label: ar.account.security, subtitle: ar.account.subtitleSecurity, path: '/account/security' }
      ]
    },
    {
      title: ar.account.groupShopping,
      rows: [
        { icon: '📦', label: ar.nav.orders, subtitle: ar.account.subtitleOrders, path: '/orders' },
        { icon: '❤️', label: ar.account.favorites, subtitle: ar.account.subtitleFavorites, path: '/account/favorites' },
        { icon: '📝', label: ar.account.shoppingLists, subtitle: ar.account.subtitleShoppingLists, path: '/account/shopping-lists' },
        { icon: '🎁', label: ar.account.rewards, subtitle: ar.account.subtitleRewards, path: '/account/rewards' }
      ]
    },
    {
      title: ar.account.groupHelp,
      rows: [
        { icon: '🎧', label: ar.account.supportTickets, subtitle: ar.account.subtitleSupport, path: '/account/support' },
        { icon: '💬', label: ar.account.contactWhatsapp, subtitle: ar.account.subtitleWhatsapp, external: whatsappHref },
        { icon: '↺', label: ar.account.returnPolicy, subtitle: ar.account.subtitleReturnPolicy, path: '/refund-exchange-policy' }
      ]
    },
    {
      title: ar.account.groupApp,
      rows: [
        { icon: '📱', label: ar.account.downloadApp, subtitle: ar.account.subtitleDownloadApp, path: '/download' },
        { icon: '⚙️', label: ar.account.settingsAndNotifications, subtitle: ar.account.subtitleSettings, path: undefined }
      ]
    }
  ]

  return (
    <div className="account-page">
      <div className="profile-header-card">
        <div className="profile-avatar">{initials(user.fullName)}</div>
        <div className="profile-info">
          <div className="profile-name">{user.fullName}</div>
          <div className="profile-meta">{user.email} · {ar.account.memberSince(new Date(user.createdAt).getFullYear())}</div>
          {rewardsBalance !== null && (
            <Link to="/account/rewards" className="profile-rewards-chip">
              🎁 {ar.account.rewardsBalanceLabel(String(rewardsBalance))}
            </Link>
          )}
        </div>
        <a className="profile-support-shortcut" href={whatsappHref} target="_blank" rel="noreferrer" aria-label={ar.account.contactWhatsapp}>
          💬
        </a>
      </div>

      {groups.map(group => (
        <div className="account-group" key={group.title}>
          <div className="account-section-title">{group.title}</div>
          <div className="account-rows">
            {group.rows.map(row => (
              row.external ? (
                <a className="account-row" key={row.label} href={row.external} target="_blank" rel="noreferrer">
                  <span className="account-row-icon">{row.icon}</span>
                  <span className="account-row-body">
                    <span className="account-row-label">{row.label}</span>
                    <span className="account-row-subtitle">{row.subtitle}</span>
                  </span>
                  <span className="account-row-chevron">‹</span>
                </a>
              ) : (
                <button className="account-row" key={row.label} onClick={row.path ? () => navigate(row.path!) : undefined}>
                  <span className="account-row-icon">{row.icon}</span>
                  <span className="account-row-body">
                    <span className="account-row-label">{row.label}</span>
                    <span className="account-row-subtitle">{row.subtitle}</span>
                  </span>
                  <span className="account-row-chevron">‹</span>
                </button>
              )
            ))}
          </div>
        </div>
      ))}

      <div className="account-rows">
        <button className="account-row" onClick={handleLogout}>
          <span className="account-row-icon">🚪</span>
          <span className="account-row-body">
            <span className="account-row-label">{ar.account.logout}</span>
          </span>
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
