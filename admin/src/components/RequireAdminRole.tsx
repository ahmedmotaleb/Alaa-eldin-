import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'

// حماية على مستوى الراوت لصفحات مقصورة على دور 'admin' الكامل (إدارة المستخدمين، سجل
// النشاط، المصروفات، التسويات) — بتمنع وصول مدير 'staff' التشغيلي عن طريق كتابة الرابط
// مباشرة حتى لو مخفي من القائمة الجانبية. السيرفر نفسه بيرفض هذه الطلبات بـ 403 أصلاً؛
// الحماية هنا بس لتجربة استخدام أنضف (تحويل فوري بدل شاشة خطأ).
export function RequireAdminRole({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && user && user.role !== 'admin') navigate('/', { replace: true })
  }, [loading, user, navigate])

  if (loading || !user || user.role !== 'admin') return null
  return <>{children}</>
}
