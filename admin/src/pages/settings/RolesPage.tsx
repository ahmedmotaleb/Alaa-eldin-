import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminRole } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

// نفس تسميات الصلاحيات المستخدمة في الباك-إند (permissionService.ts) — عرض بس، مفيش
// تعديل هنا؛ تعيين دور لمستخدم بيتم من صفحة "المستخدمون والصلاحيات".
const PERMISSION_LABEL: Record<string, string> = {
  'orders.view': 'عرض الطلبات',
  'orders.update_status': 'تحديث حالة الطلب',
  'orders.cancel': 'إلغاء الطلبات',
  'orders.print': 'طباعة الطلبات',
  'products.view': 'عرض المنتجات',
  'products.create': 'إضافة منتجات',
  'products.edit': 'تعديل المنتجات',
  'products.cost_view': 'عرض تكلفة المنتجات',
  'inventory.view': 'عرض المخزون',
  'inventory.adjust': 'تعديل/شطب المخزون',
  'inventory.receive': 'استلام مخزون',
  'purchases.view': 'عرض المشتريات',
  'purchases.create': 'إنشاء أوامر شراء',
  'purchases.receive': 'استلام أوامر الشراء',
  'customers.view': 'عرض العملاء',
  'discounts.manage': 'إدارة الخصومات',
  'analytics.view': 'عرض التحليلات',
  'wallet.view': 'عرض المحفظة',
  'wallet.manage': 'إدارة المحفظة',
  'delivery.manage': 'إدارة التوصيل',
  'marketing.manage': 'إدارة التسويق',
  'settings.manage': 'إدارة الإعدادات',
  'users.manage': 'إدارة المستخدمين',
  'audit.view': 'عرض سجل النشاط',
  'returns.manage': 'إدارة المرتجعات'
}

export function RolesPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [roles, setRoles] = useState<AdminRole[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'الإعدادات', title: 'الأدوار والصلاحيات' })
  }, [setHeader])

  useEffect(() => {
    api.listRoles()
      .then(({ roles }) => setRoles(roles))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل الأدوار' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!roles) return null

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
      {roles.map(role => (
        <div key={role.id} className="admin-table-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: 15 }}>{role.name}</strong>
            {role.isSystem && (
              <span className="admin-pill" style={{ background: '#F1F4F2', color: '#68746B' }}>دور أساسي</span>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {role.permissions.length === 0 && (
              <span style={{ color: '#8A948C', fontSize: 13 }}>بدون صلاحيات</span>
            )}
            {role.permissions.map(p => (
              <span key={p} className="admin-pill" style={{ background: '#EAF2FF', color: '#1D4ED8', fontSize: 12 }}>
                {PERMISSION_LABEL[p] ?? p}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
