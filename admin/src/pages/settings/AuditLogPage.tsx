import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminAuditLog } from '../../utils/api'
import { formatDateTime } from '../../utils/format'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '1.1fr 1fr 1fr 1.4fr 1fr'

const ACTION_LABEL: Record<string, string> = {
  supplier_created: 'إنشاء مورد',
  supplier_updated: 'تعديل مورد',
  supplier_activated: 'تفعيل مورد',
  supplier_deactivated: 'تعطيل مورد',
  supplier_product_linked: 'ربط منتج بمورد',
  supplier_product_unlinked: 'إلغاء ربط منتج بمورد',
  purchase_order_created: 'إنشاء أمر شراء',
  purchase_order_updated: 'تعديل أمر شراء',
  purchase_order_submitted: 'إرسال أمر شراء للمورد',
  purchase_order_cancelled: 'إلغاء أمر شراء',
  goods_receipt_created: 'استلام بضاعة',
  product_expiry_settings_updated: 'تعديل إعداد صلاحية منتج',
  product_created: 'إنشاء منتج',
  product_updated: 'تعديل منتج',
  product_archived: 'أرشفة منتج',
  product_image_added: 'إضافة صورة منتج',
  product_image_removed: 'حذف صورة منتج',
  primary_image_changed: 'تغيير الصورة الرئيسية',
  order_cancelled: 'إلغاء طلب',
  banner_image_updated: 'تحديث صورة بانر',
  banner_image_removed: 'حذف صورة بانر',
  category_image_updated: 'تحديث صورة قسم',
  category_image_removed: 'حذف صورة قسم',
  delivery_zone_updated: 'تعديل منطقة توصيل',
  delivery_slot_created: 'إنشاء ميعاد توصيل',
  delivery_slot_updated: 'تعديل ميعاد توصيل',
  product_alternative_added: 'إضافة بديل منتج',
  product_alternative_removed: 'حذف بديل منتج',
  user_admin_granted: 'منح صلاحية لوحة التحكم',
  user_admin_revoked: 'سحب صلاحية لوحة التحكم',
  user_role_changed: 'تغيير دور مستخدم',
  store_settings_updated: 'تعديل إعدادات المتجر'
}

export function AuditLogPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [logs, setLogs] = useState<AdminAuditLog[] | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'الإعدادات', title: 'سجل النشاط' })
  }, [setHeader])

  useEffect(() => {
    setLogs(null)
    api.listAuditLogs(page, 20)
      .then(({ logs, totalPages }) => { setLogs(logs); setTotalPages(totalPages) })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل سجل النشاط' : 'حدث خطأ، حاول مرة أخرى'))
  }, [page])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!logs) return null

  return (
    <div className="admin-table-card">
      <div className="admin-table-tools">
        <div style={{ fontWeight: 800, fontSize: 13.5 }}>سجل إجراءات فريق الإدارة</div>
        <div style={{ color: '#68746B', fontWeight: 600, fontSize: 12.5 }}>للقراءة فقط — لا يمكن تعديله أو حذفه</div>
      </div>
      <div className="admin-table-scroll">
        <div style={{ minWidth: 860 }}>
          <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
            <div>الوقت</div><div>المسؤول</div><div>الإجراء</div><div>العنصر</div><div>المعرّف</div>
          </div>
          {logs.map(log => (
            <div key={log.id} className="admin-table-row" style={{ gridTemplateColumns: COLS }}>
              <div className="admin-cell-plain" style={{ color: '#68746B' }}>{formatDateTime(log.createdAt)}</div>
              <div className="admin-cell-plain">{log.adminEmail ?? '—'}</div>
              <div className="admin-cell-plain" style={{ fontWeight: 700 }}>{ACTION_LABEL[log.action] ?? log.action}</div>
              <div className="admin-cell-plain" style={{ color: '#68746B' }}>{log.entityType}</div>
              <div className="admin-cell-plain" style={{ color: '#8A948C', fontSize: 12 }}>{log.entityId || '—'}</div>
            </div>
          ))}
          {logs.length === 0 && <div className="admin-table-empty">لا يوجد نشاط مسجّل بعد</div>}
        </div>
      </div>
      <div className="admin-table-footer">
        <span>صفحة {page} من {totalPages}</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button className="admin-form-chip" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>السابق</button>
          <button className="admin-form-chip" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>التالي</button>
        </span>
      </div>
    </div>
  )
}
