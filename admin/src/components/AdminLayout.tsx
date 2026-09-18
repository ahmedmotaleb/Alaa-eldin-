import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
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
  const location = useLocation()
  const [header, setHeader] = useState<HeaderConfig>({ crumb: '', title: '' })
  const [alertsCount, setAlertsCount] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)

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

  // أي تنقل لصفحة تانية (سواء من الشريط الجانبي أو أي رابط تاني) لازم يقفل الـ drawer على
  // الموبايل تلقائياً — احتياط إضافي فوق onNavigate بتاع Sidebar نفسه.
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  // قفل تمرير الصفحة اللي وراء الـ drawer وهو مفتوح، وإرجاعه لطبيعته لما يتقفل أو الصفحة تتغير.
  useEffect(() => {
    if (!drawerOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [drawerOpen])

  // زر Escape بيقفل الـ drawer، بس وهو مفتوح فعلاً.
  useEffect(() => {
    if (!drawerOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  if (loading || !user) return null

  return (
    <div className="admin-shell">
      <Sidebar open={drawerOpen} onNavigate={() => setDrawerOpen(false)} />
      {drawerOpen && <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} />}
      <main className="admin-main">
        <header className="admin-header">
          <button
            type="button"
            className="admin-menu-button"
            aria-label={drawerOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={drawerOpen}
            aria-controls="admin-sidebar"
            onClick={() => setDrawerOpen(current => !current)}
          >
            ☰
          </button>
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
