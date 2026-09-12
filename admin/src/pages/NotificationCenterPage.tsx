import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type Alert, type AlertSeverity } from '../utils/api'
import type { LayoutContext } from '../components/AdminLayout'

const SEVERITY_TINT: Record<AlertSeverity, { bg: string, fg: string }> = {
  info: { bg: '#EAF2FF', fg: '#1D5BBF' },
  warning: { bg: '#FFF3E3', fg: '#B4740E' },
  critical: { bg: '#FFF0EF', fg: '#B42318' }
}

const SEVERITY_ICON: Record<AlertSeverity, string> = { info: 'ℹ️', warning: '⚠️', critical: '🔴' }

export function NotificationCenterPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [alerts, setAlerts] = useState<Alert[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'مركز التنبيهات', title: 'التنبيهات' })
  }, [setHeader])

  useEffect(() => {
    api.getAlerts()
      .then(({ alerts }) => setAlerts(alerts))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل التنبيهات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!alerts) return null

  if (alerts.length === 0) {
    return <div className="admin-placeholder-card"><div className="admin-placeholder-note">مفيش تنبيهات دلوقتي — كل حاجة تمام 🎉</div></div>
  }

  return (
    <div className="admin-table-card">
      <div className="admin-table-scroll">
        <div style={{ minWidth: 480 }}>
          {alerts.map(alert => {
            const tint = SEVERITY_TINT[alert.severity]
            return (
              <div
                key={alert.category}
                className="admin-table-row clickable"
                style={{ gridTemplateColumns: '40px 1fr auto', alignItems: 'center' }}
                onClick={() => navigate(alert.link)}
              >
                <div style={{ fontSize: 18 }}>{SEVERITY_ICON[alert.severity]}</div>
                <div className="admin-cell-plain" style={{ fontWeight: 700 }}>{alert.label}</div>
                <div><span className="admin-pill" style={{ background: tint.bg, color: tint.fg }}>{alert.count}</span></div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
