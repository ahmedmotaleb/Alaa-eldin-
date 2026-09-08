import { useEffect } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { NAV } from '../nav'
import type { LayoutContext } from '../components/AdminLayout'

export function PlaceholderPage({ group: groupProp, sub: subProp }: { group?: string, sub?: string } = {}) {
  const params = useParams()
  const group = groupProp ?? params.group
  const sub = subProp ?? params.sub
  const { setHeader } = useOutletContext<LayoutContext>()

  const navGroup = NAV.find(g => g.id === group)
  const child = navGroup?.children.find(c => c.id === sub)
  const title = child?.label ?? navGroup?.label ?? 'قسم'

  useEffect(() => {
    setHeader({ crumb: navGroup?.label ?? '', title })
  }, [navGroup, title, setHeader])

  return (
    <div className="admin-placeholder-card">
      <div className="admin-placeholder-icon">🚧</div>
      <div className="admin-placeholder-title">هذا القسم قيد الإنشاء</div>
      <div className="admin-placeholder-note">
        {`"${title}" جزء من التصميم المعتمد لكن لم يُبنَ بعد كصفحة حقيقية متصلة بالبيانات — يحتاج أولاً نقل بياناته من ملفات ثابتة إلى قاعدة البيانات، على غرار ما تم مع الطلبات والمنتجات والعملاء والخصومات وتحويلات المخزون.`}
      </div>
    </div>
  )
}
