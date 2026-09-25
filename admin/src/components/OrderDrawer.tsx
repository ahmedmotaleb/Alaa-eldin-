import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, type AdminOrder, type AdminOrderStatus, type AdminOrderNote, type AdminOrderLoyaltyLedgerRow, type AdminRider, type PickedStatus, type WhatsAppTemplate, type WhatsAppMessage, type WhatsAppOrderConfirmationConfigStatus, type WhatsAppNotificationDeliveryStatus } from '../utils/api'
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
  const [waOrderConfirmation, setWaOrderConfirmation] = useState<WhatsAppOrderConfirmationConfigStatus | null>(null)
  const [confirmationStatus, setConfirmationStatus] = useState<WhatsAppNotificationDeliveryStatus | null>(null)
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState('')
  const [waMessages, setWaMessages] = useState<WhatsAppMessage[]>([])
  const [resending, setResending] = useState(false)
  const [notes, setNotes] = useState<AdminOrderNote[]>([])
  const [newNote, setNewNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [loyaltyLedgerForOrder, setLoyaltyLedgerForOrder] = useState<AdminOrderLoyaltyLedgerRow[]>([])

  useEffect(() => {
    api.getWhatsAppStatus().then(({ configured, orderConfirmation }) => {
      setWaConfigured(configured)
      setWaOrderConfirmation(orderConfirmation)
    }).catch(() => { setWaConfigured(false); setWaOrderConfirmation(null) })
    api.listWhatsAppTemplates().then(({ templates }) => setTemplates(templates.filter(t => t.active))).catch(() => {})
  }, [])

  function loadWaMessages() {
    api.listWhatsAppMessages(order.id).then(({ messages }) => setWaMessages(messages)).catch(() => {})
  }

  function loadConfirmationStatus() {
    api.getWhatsAppConfirmationStatus(order.id).then(({ status }) => setConfirmationStatus(status)).catch(() => setConfirmationStatus(null))
  }

  useEffect(loadWaMessages, [order.id])
  useEffect(loadConfirmationStatus, [order.id])

  // آخر رسالة قالب فعلية اتبعتت لتأكيد الطلب (تلقائية أو يدوية) — للعرض في سجل الرسائل بس؛
  // حالة "الملكية" المعتمدة (pending/sent/failed + عدد المحاولات) بتيجي من confirmationStatus
  // فوق (نظام الملكية الذرّي)، مش من قراءة أحدث صف في السجل ده.
  const lastConfirmationMessage = waMessages.find(m => m.notificationType === 'order_confirmation')
  const confirmationReady = !!(waOrderConfirmation?.apiConfigured && waOrderConfirmation?.templateConfigured)

  async function resendConfirmation() {
    if (!window.confirm('إعادة إرسال تأكيد الطلب عبر واتساب للعميل؟ (ده هيبعت رسالة جديدة فعلياً حتى لو اتبعت تأكيد قبل كده)')) return
    setResending(true)
    try {
      await api.resendWhatsAppConfirmation(order.id)
      loadWaMessages()
      loadConfirmationStatus()
    } catch {
      window.alert('تعذرت إعادة الإرسال')
    } finally {
      setResending(false)
    }
  }

  function loadNotes() {
    api.listOrderNotes(order.id).then(({ notes }) => setNotes(notes)).catch(() => {})
  }

  useEffect(loadNotes, [order.id])

  useEffect(() => {
    api.getOrder(order.id).then(({ loyaltyLedgerForOrder }) => setLoyaltyLedgerForOrder(loyaltyLedgerForOrder)).catch(() => setLoyaltyLedgerForOrder([]))
  }, [order.id])

  const pointsEarned = loyaltyLedgerForOrder.find(e => e.sourceType === 'order_delivered')?.pointsChange ?? 0
  const pointsEarnedReversed = loyaltyLedgerForOrder.find(e => e.sourceType === 'earned_reversal')?.pointsChange ?? 0
  const pointsRedemptionRestored = loyaltyLedgerForOrder.find(e => e.sourceType === 'redemption_reversal')?.pointsChange ?? 0

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
      loadWaMessages()
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

        <div className="admin-drawer-card">
          <div className="admin-drawer-card-title">تأكيد واتساب</div>
          {!waConfigured && <div style={{ fontSize: 12.5, color: '#8A948C' }}>غير مفعّل — لازم تضبط اتصال واتساب أولاً</div>}
          {waConfigured && !waOrderConfirmation?.templateConfigured && (
            <div style={{ fontSize: 12.5, color: '#B4740E', fontWeight: 600 }}>
              غير جاهز — قالب تأكيد الطلب المعتمد من Meta لسه مش مضبوط في إعدادات السيرفر
              (راجع WHATSAPP_ORDER_CONFIRMATION_TEMPLATE.md)
            </div>
          )}
          {confirmationReady && !confirmationStatus && <div style={{ fontSize: 12.5, color: '#8A948C' }}>في الانتظار</div>}
          {confirmationReady && confirmationStatus?.status === 'pending' && (
            <div style={{ fontSize: 12.5, color: '#B4740E', fontWeight: 600 }}>
              قيد الإرسال... (محاولة {confirmationStatus.attemptCount})
            </div>
          )}
          {confirmationReady && confirmationStatus?.status === 'sent' && (
            <div style={{ fontSize: 12.5, color: '#12813C', fontWeight: 600 }}>
              تم قبول الرسالة من واتساب — {formatDateTime(confirmationStatus.sentAt ?? confirmationStatus.updatedAt)}
              <div style={{ fontSize: 11, fontWeight: 500, color: '#8A948C', marginTop: 2 }}>
                (ده تأكيد إرسال من مزوّد واتساب، مش تأكيد استلام فعلي على هاتف العميل)
              </div>
            </div>
          )}
          {confirmationReady && confirmationStatus?.status === 'failed' && confirmationStatus.failureClass === 'unknown' && (
            <div style={{ fontSize: 12.5, color: '#B4740E', fontWeight: 600 }}>
              حالة الإرسال غير مؤكدة (بعد {confirmationStatus.attemptCount} محاولة)
              <div style={{ fontSize: 11, fontWeight: 500, color: '#8A948C', marginTop: 2 }}>
                تعذر التأكد من وصول الرسالة لواتساب — ممكن تكون فعلاً اتبعتت. الإرسال التلقائي
                مش هيعيد المحاولة تلقائياً (تجنباً لتكرار الرسالة)؛ لو حابب تتأكد، استخدم
                "إعادة إرسال يدوي" تحت.
              </div>
            </div>
          )}
          {confirmationReady && confirmationStatus?.status === 'failed' && confirmationStatus.failureClass !== 'unknown' && (
            <div style={{ fontSize: 12.5, color: '#B42318', fontWeight: 600 }}>
              فشل الإرسال (بعد {confirmationStatus.attemptCount} محاولة) — {confirmationStatus.lastError ?? 'خطأ غير معروف'}
            </div>
          )}
          {lastConfirmationMessage && (
            <div style={{ fontSize: 11, color: '#8A948C', marginTop: 6 }}>
              آخر محاولة فعلية: {formatDateTime(lastConfirmationMessage.createdAt)}
              {lastConfirmationMessage.status === 'failed' ? ' (فشلت)' : ' (اتقبلت)'}
            </div>
          )}
          {/* هذا يعكس حدث webhook حقيقي من واتساب (تسليم/قراءة فعلية على الجهاز) — مختلف
              تماماً عن "اتقبلت" فوق (قبول Meta API بس). null يعني لسه مفيش حدث وصل. */}
          {lastConfirmationMessage?.deliveryStatus && (
            <div style={{
              fontSize: 11.5, fontWeight: 600, marginTop: 4,
              color: lastConfirmationMessage.deliveryStatus === 'read' ? '#12813C'
                : lastConfirmationMessage.deliveryStatus === 'delivered' ? '#12813C'
                : lastConfirmationMessage.deliveryStatus === 'failed' ? '#B42318' : '#8A948C'
            }}>
              {lastConfirmationMessage.deliveryStatus === 'read' && '✓✓ قُرئت فعلياً على الجهاز'}
              {lastConfirmationMessage.deliveryStatus === 'delivered' && '✓✓ وصلت فعلياً للجهاز'}
              {lastConfirmationMessage.deliveryStatus === 'sent' && '✓ اتبعتت من المزوّد (لسه مفيش تأكيد وصول)'}
              {lastConfirmationMessage.deliveryStatus === 'failed' && '✗ فشل التسليم فعلياً'}
              {lastConfirmationMessage.deliveryStatusUpdatedAt && ` — ${formatDateTime(lastConfirmationMessage.deliveryStatusUpdatedAt)}`}
            </div>
          )}
          {confirmationReady && (
            <button className="admin-category-card-btn" disabled={resending} onClick={resendConfirmation} style={{ marginTop: 8 }}>
              {resending ? 'جارٍ الإرسال...' : '🔁 إعادة إرسال تأكيد واتساب'}
            </button>
          )}
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
          {order.loyaltyPointsRedeemed > 0 && (
            <div className="admin-drawer-line"><span style={{ color: '#68746B' }}>خصم النقاط ({order.loyaltyPointsRedeemed} نقطة)</span><span style={{ color: '#B42318' }}>-{formatMoney(order.loyaltyDiscountAmount)}</span></div>
          )}
          <div className="admin-drawer-line"><span style={{ color: '#68746B' }}>التوصيل</span><span>{order.deliveryFee ? formatMoney(order.deliveryFee) : 'مجاني'}</span></div>
          <div className="admin-drawer-total-line" style={{ fontWeight: 900, fontSize: 15 }}><span>الإجمالي</span><span style={{ color: '#12813C' }}>{formatMoney(order.total)}</span></div>
        </div>

        {(order.loyaltyPointsRedeemed > 0 || pointsEarned !== 0 || pointsEarnedReversed !== 0 || pointsRedemptionRestored !== 0) && (
          <div className="admin-drawer-card">
            <div className="admin-drawer-card-title">نقاط الولاء</div>
            {order.loyaltyPointsRedeemed > 0 && (
              <div className="admin-drawer-line"><span style={{ color: '#68746B' }}>نقاط مستخدمة في هذا الطلب</span><span style={{ fontWeight: 800, color: '#B42318' }}>-{order.loyaltyPointsRedeemed}</span></div>
            )}
            {pointsEarned !== 0 && (
              <div className="admin-drawer-line"><span style={{ color: '#68746B' }}>نقاط مكتسبة من هذا الطلب</span><span style={{ fontWeight: 800, color: '#12813C' }}>+{pointsEarned}</span></div>
            )}
            {pointsRedemptionRestored !== 0 && (
              <div className="admin-drawer-line"><span style={{ color: '#68746B' }}>نقاط استخدام مُستردة (بعد إلغاء/إرجاع)</span><span style={{ fontWeight: 800, color: '#12813C' }}>+{pointsRedemptionRestored}</span></div>
            )}
            {pointsEarnedReversed !== 0 && (
              <div className="admin-drawer-line"><span style={{ color: '#68746B' }}>نقاط اكتساب مُلغاة (بعد إلغاء/إرجاع)</span><span style={{ fontWeight: 800, color: '#B42318' }}>{pointsEarnedReversed}</span></div>
            )}
          </div>
        )}

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
