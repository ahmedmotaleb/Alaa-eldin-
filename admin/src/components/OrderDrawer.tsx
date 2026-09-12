import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, type AdminOrder, type AdminOrderStatus, type AdminOrderNote, type AdminRider, type PickedStatus, type WhatsAppTemplate } from '../utils/api'
import { formatMoney } from '../utils/money'
import { formatDateTime } from '../utils/format'
import { toWhatsAppInternational } from '../utils/phone'
import { ALLOWED_NEXT_STATUSES, ORDER_STATUS_COLOR, ORDER_STATUS_LABEL } from '../orderStatus'

const PICKED_STATUS_LABEL: Record<PickedStatus, string> = {
  pending: 'لسه', picked: 'تم', substituted: 'استبدال', unavailable: 'غير متوفر'
}
const PICKED_STATUS_TINT: Record<PickedStatus, { bg: string, fg: string }> = {
  pending: { bg: '#F1F4F2', fg: '#68746B' },
  picked: { bg: '#EAF8EF', fg: '#12813C' },
  substituted: { bg: '#FFF3E3', fg: '#B4740E' },
  unavailable: { bg: '#FFF0EF', fg: '#B42318' }
}

export function OrderDrawer({
  order,
  onClose,
  onSetStatus,
  riders,
  onSetRider
}: {
  order: AdminOrder
  onClose: () => void
  onSetStatus: (status: AdminOrderStatus) => void
  riders?: AdminRider[]
  onSetRider?: (riderId: string | null) => void
}) {
  const navigate = useNavigate()
  const [bg, fg] = ORDER_STATUS_COLOR[order.status]
  const [waConfigured, setWaConfigured] = useState(false)
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState('')
  const [notes, setNotes] = useState<AdminOrderNote[]>([])
  const [newNote, setNewNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)

  useEffect(() => {
    api.getWhatsAppStatus().then(({ configured }) => setWaConfigured(configured)).catch(() => setWaConfigured(false))
    api.listWhatsAppTemplates().then(({ templates }) => setTemplates(templates.filter(t => t.active))).catch(() => {})
  }, [])

  function loadNotes() {
    api.listOrderNotes(order.id).then(({ notes }) => setNotes(notes)).catch(() => {})
  }

  useEffect(loadNotes, [order.id])

  async function submitNote() {
    if (!newNote.trim()) return
    setAddingNote(true)
    try {
      await api.addOrderNote(order.id, newNote)
      setNewNote('')
      loadNotes()
    } catch {
      window.alert('تعذر إضافة الملاحظة')
    } finally {
      setAddingNote(false)
    }
  }

  function openWhatsApp() {
    const text = `مرحباً ${order.customer.fullName}، بخصوص طلبك ${order.orderNumber} من علاء الدين.`
    window.open(`https://wa.me/${toWhatsAppInternational(order.customer.mobile)}?text=${encodeURIComponent(text)}`, '_blank')
  }

  async function sendTemplate() {
    if (!selectedTemplateId) return
    setSending(true)
    setSendResult('')
    try {
      await api.sendWhatsAppMessage(order.id, { templateId: selectedTemplateId })
      setSendResult('تم إرسال الرسالة بنجاح')
    } catch (err) {
      setSendResult(err instanceof ApiError && err.code === 'whatsapp_not_configured'
        ? 'الإرسال الفعلي غير مفعّل — راجع إعدادات واتساب'
        : 'تعذر إرسال الرسالة')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="admin-drawer-overlay" onClick={onClose}>
      <div className="admin-drawer" onClick={e => e.stopPropagation()}>
        <div className="admin-drawer-head">
          <div>
            <div className="admin-drawer-title">{order.orderNumber}</div>
            <div className="admin-drawer-sub">{formatDateTime(order.createdAt)}</div>
          </div>
          <div className="admin-drawer-head-actions">
            <span className="admin-pill" style={{ background: bg, color: fg }}>{ORDER_STATUS_LABEL[order.status]}</span>
            <button className="admin-drawer-close" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="admin-drawer-card">
          <div className="admin-drawer-info-row"><span className="admin-drawer-info-icon">👤</span><span>{order.customer.fullName} ({order.accountEmail ?? 'طلب زائر بدون حساب'})</span></div>
          <div className="admin-drawer-info-row"><span className="admin-drawer-info-icon">📞</span><span>{order.customer.mobile}</span></div>
          <div className="admin-drawer-info-row"><span className="admin-drawer-info-icon">🗺️</span><span>{order.customer.governorate}</span></div>
          <div className="admin-drawer-info-row"><span className="admin-drawer-info-icon">📍</span><span>{order.customer.address}</span></div>
          <div className="admin-drawer-info-row"><span className="admin-drawer-info-icon">💵</span><span>{order.paymentMethod === 'COD' ? 'الدفع عند الاستلام' : order.paymentMethod}</span></div>
          {order.deliveryInstructions && (
            <div className="admin-drawer-info-row"><span className="admin-drawer-info-icon">📝</span><span>{order.deliveryInstructions}</span></div>
          )}
        </div>

        <div className="admin-drawer-card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="admin-category-card-btn" onClick={openWhatsApp}>💬 واتساب العميل</button>
          <button className="admin-category-card-btn" onClick={() => navigate(`/orders/${order.id}/picking`)}>📋 تجهيز الطلب</button>
          <button className="admin-category-card-btn" onClick={() => window.open(`/admin/orders/${order.id}/print`, '_blank')}>🖨️ طباعة</button>
        </div>

        {templates.length > 0 && (
          <div className="admin-drawer-card">
            <div className="admin-drawer-card-title">إرسال قالب واتساب فعلي</div>
            {!waConfigured && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: '#8A948C', marginBottom: 8 }}>
                الإرسال الفعلي غير مفعّل حالياً على السيرفر — الزر هيرجع خطأ لحد ما يتضبط WHATSAPP_ACCESS_TOKEN.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={selectedTemplateId}
                onChange={e => setSelectedTemplateId(e.target.value)}
                style={{ border: '1px solid #dce4de', borderRadius: 11, padding: '8px 10px', fontWeight: 600, fontSize: 13, outline: 'none', background: '#fbfcfb', color: '#17221a' }}
              >
                <option value="">اختر قالب...</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className="admin-category-card-btn" disabled={!selectedTemplateId || sending} onClick={sendTemplate}>
                {sending ? 'جارٍ الإرسال...' : 'إرسال'}
              </button>
            </div>
            {sendResult && <div style={{ fontSize: 12, marginTop: 6, color: '#4C5B51' }}>{sendResult}</div>}
          </div>
        )}

        <div className="admin-drawer-card">
          <div className="admin-drawer-card-title">المنتجات</div>
          {order.items.map(item => {
            const tint = PICKED_STATUS_TINT[item.pickedStatus]
            return (
              <div className="admin-drawer-line" key={item.productId}>
                <span style={{ color: '#4C5B51', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {item.name} × {item.quantity}
                  {item.pickedStatus !== 'pending' && (
                    <span className="admin-pill" style={{ background: tint.bg, color: tint.fg, fontSize: 10 }}>{PICKED_STATUS_LABEL[item.pickedStatus]}</span>
                  )}
                </span>
                <span>{formatMoney(item.lineTotal)}</span>
              </div>
            )
          })}
        </div>

        <div className="admin-drawer-card">
          <div className="admin-drawer-line"><span style={{ color: '#68746B' }}>الإجمالي الفرعي</span><span>{formatMoney(order.subtotal)}</span></div>
          {order.discountCode && (
            <div className="admin-drawer-line"><span style={{ color: '#68746B' }}>خصم ({order.discountCode})</span><span style={{ color: '#B42318' }}>-{formatMoney(order.discountAmount)}</span></div>
          )}
          <div className="admin-drawer-line"><span style={{ color: '#68746B' }}>التوصيل</span><span>{order.deliveryFee ? formatMoney(order.deliveryFee) : 'مجاني'}</span></div>
          <div className="admin-drawer-total-line" style={{ fontWeight: 900, fontSize: 15 }}><span>الإجمالي</span><span style={{ color: '#12813C' }}>{formatMoney(order.total)}</span></div>
        </div>

        {riders && onSetRider && (
          <div className="admin-drawer-card">
            <div className="admin-drawer-card-title">المندوب المسؤول عن التوصيل</div>
            <select
              value={order.riderId ?? ''}
              onChange={e => onSetRider(e.target.value || null)}
              style={{ border: '1px solid #dce4de', borderRadius: 11, padding: '10px 12px', fontWeight: 600, fontSize: 13, outline: 'none', background: '#fbfcfb', color: '#17221a', width: '100%' }}
            >
              <option value="">بدون مندوب</option>
              {riders.filter(r => r.active || r.id === order.riderId).map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            {order.settlementId && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: '#8A948C', marginTop: 8 }}>
                كاش هذا الطلب سبق تسويته مع المندوب — تغيير المندوب هنا لا يلغي التسوية السابقة.
              </div>
            )}
          </div>
        )}

        <div className="admin-drawer-card">
          <div className="admin-drawer-card-title">تحديث حالة الطلب</div>
          {ALLOWED_NEXT_STATUSES[order.status].length > 0 ? (
            <div className="admin-drawer-actions-grid">
              {ALLOWED_NEXT_STATUSES[order.status].map(status => (
                <button
                  key={status}
                  className="admin-drawer-status-btn"
                  onClick={() => onSetStatus(status)}
                >
                  {ORDER_STATUS_LABEL[status]}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, fontWeight: 600, color: '#8A948C' }}>
              الطلب في حالة نهائية ({ORDER_STATUS_LABEL[order.status]}) — مفيش إجراء إضافي متاح.
            </div>
          )}
        </div>

        <div className="admin-drawer-card">
          <div className="admin-drawer-card-title">ملاحظات داخلية (مش مرئية للعميل)</div>
          {notes.map(n => (
            <div key={n.id} className="admin-drawer-line" style={{ display: 'block', padding: '8px 0' }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{n.note}</div>
              <div style={{ fontSize: 10.5, color: '#8A948C', marginTop: 2 }}>{n.createdByName ?? 'مستخدم محذوف'} — {formatDateTime(n.createdAt)}</div>
            </div>
          ))}
          {notes.length === 0 && <div style={{ fontSize: 12, color: '#8A948C' }}>مفيش ملاحظات بعد</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              type="text"
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="أضف ملاحظة..."
              style={{ flex: 1, border: '1px solid #dce4de', borderRadius: 11, padding: '8px 10px', fontWeight: 600, fontSize: 12.5, outline: 'none', background: '#fbfcfb', color: '#17221a' }}
            />
            <button className="admin-category-card-btn" disabled={!newNote.trim() || addingNote} onClick={submitNote}>إضافة</button>
          </div>
        </div>
      </div>
    </div>
  )
}
