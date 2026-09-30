import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

// شكل موحّد لحالة "مفيش بيانات" عبر السلة/الطلبات/المفضلة/قوائم التسوق/تذاكر الدعم/نتائج
// البحث — نفس الـ CSS الموجود بالفعل (.empty-card/.empty-icon)، بس بشكل مُعاد استخدامه بدل
// تكرار نفس الـ JSX في كل صفحة على حدة.
interface EmptyStateProps {
  icon: string
  title: string
  note?: string
  cta?: { label: string, to?: string, onClick?: () => void }
  children?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, note, cta, children, className }: EmptyStateProps) {
  return (
    <div className={className ? `empty-card ${className}` : 'empty-card'}>
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      {note && <p>{note}</p>}
      {children}
      {cta && (cta.to
        ? <Link className="primary-button" to={cta.to}>{cta.label}</Link>
        : <button className="primary-button" onClick={cta.onClick}>{cta.label}</button>
      )}
    </div>
  )
}
