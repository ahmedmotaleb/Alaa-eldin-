import { useState } from 'react'
import { api, ApiError, type AdminRole } from '../utils/api'

// نفس تسميات الصلاحيات في RolesPage — مكرّرة هنا بقصد (ملف واحد بيعرض، التاني بيعدّل) بدل
// استيراد متقاطع بين الاثنين؛ لو اتضافت صلاحية جديدة في الباك-إند، لازم تتضاف هنا وفي
// RolesPage.tsx مع بعض.
export const PERMISSION_LABEL: Record<string, string> = {
  'orders.view': 'عرض الطلبات',
  'orders.update_status': 'تحديث حالة الطلب',
  'orders.cancel': 'إلغاء الطلبات',
  'orders.print': 'طباعة الطلبات',
  'products.view': 'عرض المنتجات',
  'products.create': 'إضافة منتجات',
  'products.edit': 'تعديل المنتجات',
  'products.delete': 'حذف/استعادة المنتجات',
  'products.cost_view': 'عرض تكلفة المنتجات',
  'products.pricing.bulk_update': 'تحديث الأسعار بالجملة',
  'products.cost.bulk_update': 'تحديث التكلفة بالجملة',
  'products.barcode.view': 'عرض الباركود',
  'products.barcode.generate': 'توليد باركود',
  'products.barcode.print': 'طباعة ملصقات الباركود',
  'inventory.view': 'عرض المخزون',
  'inventory.adjust': 'تعديل/شطب المخزون',
  'inventory.receive': 'استلام مخزون',
  'inventory.import': 'استيراد مخزون (CSV)',
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
  'returns.manage': 'إدارة المرتجعات',
  'integrations.manage': 'إدارة التكاملات',
  'loyalty.view': 'عرض نقاط الولاء',
  'loyalty.adjust': 'تعديل نقاط الولاء يدوياً',
  'loyalty.settings': 'إدارة إعدادات الولاء',
  'referrals.view': 'عرض الإحالات',
  'referrals.manage': 'إدارة الإحالات',
  'support.view': 'عرض تذاكر الدعم',
  'support.reply': 'الرد على تذاكر الدعم',
  'support.assign': 'إسناد تذاكر الدعم',
  'support.manage': 'إدارة إعدادات الدعم',
  'backups.manage': 'إدارة النسخ الاحتياطي'
}

const SECTION_LABEL: Record<string, string> = {
  orders: 'الطلبات', products: 'المنتجات', inventory: 'المخزون', purchases: 'المشتريات',
  customers: 'العملاء', discounts: 'الخصومات', analytics: 'التحليلات', wallet: 'المحفظة',
  delivery: 'التوصيل', marketing: 'التسويق', settings: 'الإعدادات', users: 'المستخدمون',
  audit: 'سجل النشاط', returns: 'المرتجعات', integrations: 'التكاملات', loyalty: 'نقاط الولاء',
  referrals: 'الإحالات', support: 'الدعم الفني', backups: 'النسخ الاحتياطي'
}

export const PERMISSION_SECTIONS: { key: string, label: string, permissions: string[] }[] =
  Object.keys(SECTION_LABEL).map(key => ({
    key,
    label: SECTION_LABEL[key],
    permissions: Object.keys(PERMISSION_LABEL).filter(p => p.startsWith(`${key}.`))
  })).filter(s => s.permissions.length > 0)

export function RoleFormDrawer({
  role,
  onClose,
  onSaved
}: {
  role: AdminRole | null
  onClose: () => void
  onSaved: (role: AdminRole) => void
}) {
  const isEdit = Boolean(role)
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [permissions, setPermissions] = useState<Set<string>>(new Set(role?.permissions ?? []))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function togglePermission(p: string) {
    setPermissions(current => {
      const next = new Set(current)
      if (next.has(p)) next.delete(p); else next.add(p)
      return next
    })
  }

  function toggleSection(sectionPermissions: string[], allChecked: boolean) {
    setPermissions(current => {
      const next = new Set(current)
      for (const p of sectionPermissions) {
        if (allChecked) next.delete(p); else next.add(p)
      }
      return next
    })
  }

  async function submit() {
    setError('')
    if (name.trim().length < 2) { setError('اسم الدور قصير جداً'); return }
    setSubmitting(true)
    try {
      const body = { name: name.trim(), description: description.trim(), permissions: Array.from(permissions) }
      const { role: saved } = isEdit && role ? await api.updateRole(role.id, body) : await api.createRole(body)
      onSaved(saved)
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'role_name_taken'
        ? 'اسم الدور مستخدم بالفعل'
        : 'تعذر حفظ الدور، حاول مرة أخرى')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="admin-drawer-overlay" onClick={onClose}>
      <div className="admin-drawer" onClick={e => e.stopPropagation()}>
        <div className="admin-drawer-head">
          <div className="admin-drawer-title">{isEdit ? 'تعديل الدور' : 'إضافة دور'}</div>
          <button className="admin-drawer-close" onClick={onClose}>×</button>
        </div>

        <div className="admin-form-card">
          <label>اسم الدور *
            <input value={name} onChange={e => setName(e.target.value)} placeholder="مثال: مشرف فرع" />
          </label>
          <label>وصف مختصر
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="مثال: صلاحيات محدودة لمتابعة طلبات فرع واحد" />
          </label>
        </div>

        <div className="admin-form-card">
          <div className="admin-form-card-title">الصلاحيات</div>
          {PERMISSION_SECTIONS.map(section => {
            const allChecked = section.permissions.every(p => permissions.has(p))
            return (
              <div key={section.key} style={{ borderTop: '1px solid #EEF1EE', paddingTop: 10, marginTop: 4 }}>
                <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontWeight: 800 }}>
                  <input type="checkbox" checked={allChecked} onChange={() => toggleSection(section.permissions, allChecked)} style={{ width: 'auto' }} />
                  {section.label}
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6, paddingInlineStart: 24 }}>
                  {section.permissions.map(p => (
                    <label key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 12 }}>
                      <input type="checkbox" checked={permissions.has(p)} onChange={() => togglePermission(p)} style={{ width: 'auto' }} />
                      {PERMISSION_LABEL[p]}
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {error && <div className="admin-form-error">{error}</div>}
        <button className="admin-form-save" disabled={submitting} onClick={submit}>
          {submitting ? 'جارٍ الحفظ...' : isEdit ? 'حفظ التعديلات' : 'إضافة الدور'}
        </button>
      </div>
    </div>
  )
}
