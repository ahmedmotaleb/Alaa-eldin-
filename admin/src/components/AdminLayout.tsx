import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useRequireAdmin } from '../hooks/useRequireAdmin'
import { api } from '../utils/api'

// بولينج بسيط كل دقيقة — مفيش WebSocket أو أي بنية تحتية real-time تانية في المشروع أصلاً،
// فمفيش داعي نضيف واحدة لمجرد عداد التنبيهات. دقيقة كافية لسياق لوحة تحكم إدارية.
const ALERTS_POLL_MS = 60000

export interface HeaderConfig {
  crumb: string
  title: string
  action?: { label: string, onClick: () => void }
}

export interface LayoutContext {
  setHeader: (header: HeaderConfig) => void
}

export function AdminLayout() {
  const { user, loading } = useRequireAdmin()
  const navigate = useNavigate()
  const [header, setHeader] = useState<HeaderConfig>({ crumb: '', title: '' })
  const [alertsCount, setAlertsCount] = useState(0)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    function poll() {
      api.getAlerts().then(({ count }) => { if (!cancelled) setAlertsCount(count) }).catch(() => {})
    }
    poll()
    const interval = setInterval(poll, ALERTS_POLL_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [user])

  if (loading || !user) return null

  return (
    <div className="admin-shell">
      <Sidebar />
      <main className="admin-main">
        <header className="admin-header">
          <div style={{ minWidth: 0 }}>
            <div className="admin-crumb">{header.crumb}</div>
            <div className="admin-title">{header.title}</div>
          </div>
          <div className="admin-header-spacer" />
          <div className="admin-header-actions">
            {header.action && (
              <button className="admin-action-button" onClick={header.action.onClick}>{header.action.label}</button>
            )}
            <button className="admin-bell" aria-label="الإشعارات" onClick={() => navigate('/notifications')} style={{ position: 'relative' }}>
              🔔
              {alertsCount > 0 && <span className="admin-bell-badge">{alertsCount > 99 ? '99+' : alertsCount}</span>}
            </button>
          </div>
        </header>
        <div className="admin-content">
          <Outlet context={{ setHeader } satisfies LayoutContext} />
        </div>
      </main>
    </div>
  )
}
