import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useRequireAdmin } from '../hooks/useRequireAdmin'

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
  const [header, setHeader] = useState<HeaderConfig>({ crumb: '', title: '' })

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
            <button className="admin-bell" aria-label="الإشعارات">🔔</button>
          </div>
        </header>
        <div className="admin-content">
          <Outlet context={{ setHeader } satisfies LayoutContext} />
        </div>
      </main>
    </div>
  )
}
