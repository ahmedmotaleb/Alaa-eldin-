import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminOrder, type AdminProduct, type PickedStatus } from '../utils/api'
import { ALLOWED_NEXT_STATUSES, ORDER_STATUS_LABEL } from '../orderStatus'
import type { LayoutContext } from '../components/AdminLayout'

const SUBSTITUTION_PREFERENCE_LABEL: Record<AdminOrder['substitutionPreference'], string> = {
  replace_similar: 'اعتماد تلقائي (العميل اختار "استبدال بمنتج مشابه")',
  contact_me: 'يحتاج موافقة العميل (اختار "اتصل بي الأول")',
  remove_item: 'العميل يفضّل حذف الصنف — لا تقترح بديل'
}

const STATUS_LABEL: Record<PickedStatus, string> = {
  pending: 'لسه', picked: 'تم التجهيز', substituted: 'استبدال', unavailable: 'غير متوفر'
}
const STATUS_TINT: Record<PickedStatus, { bg: string, fg: string }> = {
  pending: { bg: '#F1F4F2', fg: '#68746B' },
  picked: { bg: '#EAF8EF', fg: '#12813C' },
  substituted: { bg: '#FFF3E3', fg: '#B4740E' },
  unavailable: { bg: '#FFF0EF', fg: '#B42318' }
}

// وضع تجهيز الطلب لفريق المخزن — حالة كل صنف بتتسجّل فعلياً على السيرفر (مش محلية بس في
// المتصفح زي ما كانت قبل كده)، عشان تفضل موجودة لو حصل refresh، وعشان تبقى أساس "الإيصال
// الحقيقي" اللي بيشوفه العميل لو حصل استبدال أو نقص فعلي.
export function PickingViewPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [order, setOrder] = useState<AdminOrder | null>(null)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(false)
  const [savingItemId, setSavingItemId] = useState<number | null>(null)
  const [substitutingItemId, setSubstitutingItemId] = useState<number | null>(null)
  const [substitutionSearch, setSubstitutionSearch] = useState('')
  const [substitutionResults, setSubstitutionResults] = useState<AdminProduct[]>([])
  const [substitutionQuantity, setSubstitutionQuantity] = useState(1)
  const [substitutionSaving, setSubstitutionSaving] = useState(false)
  const [substitutionError, setSubstitutionError] = useState('')

  function load() {
    if (!id) return
    api.getOrder(id)
      .then(({ order }) => setOrder(order))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل الطلب' : 'حدث خطأ، حاول مرة أخرى'))
  }

  useEffect(load, [id])

  useEffect(() => {
    setHeader({ crumb: 'الطلبات', title: order ? `تجهيز الطلب ${order.orderNumber}` : 'تجهيز الطلب' })
  }, [order, setHeader])

  useEffect(() => {
    if (substitutingItemId === null || !substitutionSearch.trim()) {
      setSubstitutionResults([])
      return
    }
    let cancelled = false
    const timeout = setTimeout(() => {
      api.listProducts({ search: substitutionSearch.trim(), limit: 8 })
        .then(({ products }) => { if (!cancelled) setSubstitutionResults(products) })
        .catch(() => {})
    }, 250)
    return () => { cancelled = true; clearTimeout(timeout) }
  }, [substitutionSearch, substitutingItemId])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!order) return null

  const allResolved = order.items.length > 0 && order.items.every(item => item.pickedStatus !== 'pending')
  const nextStatus = ALLOWED_NEXT_STATUSES[order.status].includes('ready_for_delivery') ? 'ready_for_delivery' : null

  async function setStatus(itemId: number, status: PickedStatus) {
    if (!id) return
    let note = ''
    if (status === 'unavailable') {
      note = window.prompt('سبب عدم التوفر (اختياري)') ?? ''
    }
    setSavingItemId(itemId)
    try {
      await api.setOrderItemPickedStatus(id, itemId, status, note)
      load()
    } catch {
      window.alert('تعذر تحديث حالة الصنف — حاول تاني')
    } finally {
      setSavingItemId(null)
    }
  }

  function openSubstitutionPicker(itemId: number, currentQuantity: number) {
    setSubstitutingItemId(itemId)
    setSubstitutionSearch('')
    setSubstitutionResults([])
    setSubstitutionQuantity(currentQuantity)
    setSubstitutionError('')
  }

  async function confirmSubstitution(replacementProductId: string) {
    if (!id || substitutingItemId === null) return
    setSubstitutionSaving(true)
    setSubstitutionError('')
    try {
      const { status } = await api.proposeSubstitution(id, substitutingItemId, replacementProductId, substitutionQuantity)
      setSubstitutingItemId(null)
      window.alert(status === 'approved' ? 'تم تطبيق البديل مباشرة (تفضيل العميل: استبدال تلقائي).' : 'تم إرسال اقتراح البديل — بانتظار موافقة العميل.')
      load()
    } catch (err) {
      setSubstitutionError(err instanceof ApiError ? 'تعذر اقتراح البديل: ' + err.code : 'حدث خطأ، حاول مرة أخرى')
    } finally {
      setSubstitutionSaving(false)
    }
  }

  async function markReady() {
    if (!nextStatus || !order || !id) return
    setUpdating(true)
    try {
      await api.updateOrderStatus(id, nextStatus)
      navigate('/orders/all')
    } catch {
      window.alert('تعذر تحديث حالة الطلب — حاول تاني')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="admin-table-card">
      <div className="admin-table-tools">
        <div style={{ fontWeight: 800, fontSize: 13.5 }}>{order.customer.fullName} — {order.customer.governorate}</div>
        <div style={{ color: '#68746B', fontWeight: 600, fontSize: 12.5 }}>{order.items.length} صنف</div>
      </div>
      {order.deliveryInstructions && (
        <div style={{ margin: '0 14px 10px', padding: '10px 12px', background: '#EAF2FF', borderRadius: 10, fontSize: 12.5, fontWeight: 700, color: '#1D5BBF' }}>
          📝 تعليمات التوصيل: {order.deliveryInstructions}
        </div>
      )}
      <div style={{ margin: '0 14px 10px', padding: '10px 12px', background: '#F3EEFB', borderRadius: 10, fontSize: 12.5, fontWeight: 700, color: '#5B3EA6' }}>
        🔄 تفضيل الاستبدال: {SUBSTITUTION_PREFERENCE_LABEL[order.substitutionPreference]}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14 }}>
        {order.items.map(item => {
          const tint = STATUS_TINT[item.pickedStatus]
          const saving = savingItemId === item.id
          const canProposeSubstitution = item.pickedStatus === 'pending' && item.substitutionStatus === 'none' && order.substitutionPreference !== 'remove_item'
          return (
            <div key={item.id} style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="admin-table-row" style={{ gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 800, fontSize: 13.5 }}>{item.name}</span>
                  <span style={{ fontWeight: 600, fontSize: 12, color: '#68746B' }}>{item.quantity} × {item.unit}</span>
                  {item.pickedNote && <span style={{ fontWeight: 600, fontSize: 11.5, color: '#8A948C' }}>{item.pickedNote}</span>}
                  {item.substitutionStatus === 'proposed' && (
                    <span style={{ fontWeight: 700, fontSize: 11.5, color: '#B4740E' }}>
                      بديل مقترح: {item.replacementName} × {item.replacementQuantity} — بانتظار موافقة العميل
                    </span>
                  )}
                  {item.substitutionStatus === 'approved' && (
                    <span style={{ fontWeight: 700, fontSize: 11.5, color: '#12813C' }}>
                      اتستبدل بـ: {item.replacementName} × {item.replacementQuantity}
                    </span>
                  )}
                </span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <span className="admin-pill" style={{ background: tint.bg, color: tint.fg }}>{STATUS_LABEL[item.pickedStatus]}</span>
                  <button className="admin-form-chip" disabled={saving} onClick={() => setStatus(item.id, 'picked')}>تم</button>
                  {canProposeSubstitution && (
                    <button className="admin-form-chip" disabled={saving} onClick={() => openSubstitutionPicker(item.id, item.quantity)}>استبدال</button>
                  )}
                  <button className="admin-form-chip" disabled={saving} onClick={() => setStatus(item.id, 'unavailable')}>غير متوفر</button>
                </div>
              </div>
              {substitutingItemId === item.id && (
                <div style={{ margin: '6px 0 10px', padding: 12, background: '#FAFBFA', border: '1px solid #E3E8E4', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      autoFocus
                      placeholder="دوّر على منتج بديل بالاسم..."
                      value={substitutionSearch}
                      onChange={e => setSubstitutionSearch(e.target.value)}
                      style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #dce4de', fontSize: 12.5 }}
                    />
                    <input
                      type="number"
                      min={1}
                      value={substitutionQuantity}
                      onChange={e => setSubstitutionQuantity(Math.max(1, Number(e.target.value) || 1))}
                      style={{ width: 60, padding: '8px 10px', borderRadius: 8, border: '1px solid #dce4de', fontSize: 12.5 }}
                    />
                    <button className="admin-form-chip" onClick={() => setSubstitutingItemId(null)}>إلغاء</button>
                  </div>
                  {substitutionError && <div style={{ color: '#B42318', fontWeight: 700, fontSize: 12 }}>{substitutionError}</div>}
                  {substitutionResults.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {substitutionResults.map(p => (
                        <button
                          key={p.id}
                          disabled={substitutionSaving || !p.available}
                          onClick={() => confirmSubstitution(p.id)}
                          style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 8, border: '1px solid #dce4de', background: p.available ? '#fff' : '#F1F4F2', fontSize: 12.5, fontWeight: 700, opacity: p.available ? 1 : 0.6 }}
                        >
                          <span>{p.name}{!p.available && ' (غير متاح)'}</span>
                          <span>{p.stock} في المخزون</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="admin-table-footer">
        <span>{order.items.filter(i => i.pickedStatus !== 'pending').length} / {order.items.length} اتجهزوا</span>
        {nextStatus ? (
          <button className="admin-action-button" disabled={!allResolved || updating} onClick={markReady}>
            نقل لحالة "{ORDER_STATUS_LABEL[nextStatus]}"
          </button>
        ) : (
          <span style={{ color: '#8A948C', fontWeight: 600, fontSize: 12.5 }}>حالة الطلب الحالية ({ORDER_STATUS_LABEL[order.status]}) ما بتسمحش بالانتقال ده</span>
        )}
      </div>
    </div>
  )
}
