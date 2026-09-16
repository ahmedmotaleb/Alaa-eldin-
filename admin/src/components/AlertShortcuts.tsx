import { useNavigate } from 'react-router-dom'
import type { Alert } from '../utils/api'
import { ALERT_SEVERITY_TINT, ALERT_SEVERITY_ICON } from '../utils/alertPresentation'

// اختصارات سريعة للحاجات اللي محتاجة انتباه الآن — بيانات حية من alertsService (نفس مصدر
// مركز التنبيهات بالظبط، بدون أي استعلام مكرر)، بس معروضة كبطاقات قابلة للنقر مباشرة من
// الرئيسية بدل ما الأدمن يضطر يفتح مركز التنبيهات الأول عشان يشوف فيه إيه.
export function AlertShortcuts({ alerts }: { alerts: Alert[] }) {
  const navigate = useNavigate()
  if (alerts.length === 0) return null

  return (
    <div className="admin-alert-shortcuts">
      {alerts.map(alert => {
        const tint = ALERT_SEVERITY_TINT[alert.severity]
        return (
          <button key={alert.category} className="admin-alert-shortcut" onClick={() => navigate(alert.link)}>
            <span className="admin-alert-shortcut-icon" style={{ background: tint.bg }}>{ALERT_SEVERITY_ICON[alert.severity]}</span>
            <span className="admin-alert-shortcut-body">
              <span className="admin-alert-shortcut-count" style={{ color: tint.fg }}>{alert.count}</span>
              <span className="admin-alert-shortcut-label">{alert.label}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
