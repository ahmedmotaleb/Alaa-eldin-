import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminProduct, type AdminPurchaseOrder, type ReplenishmentSuggestion } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '40px 1.3fr .8fr .8fr .8fr .8fr .8fr 1fr .9fr'
const TARGET_DAYS_OPTIONS = [7, 14, 30]

export function ReplenishmentPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [targetDays, setTargetDays] = useState(14)
  const [suggestions, setSuggestions] = useState<ReplenishmentSuggestion[] | null>(null)
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [draftOrders, setDraftOrders] = useState<AdminPurchaseOrder[]>([])
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [targetDraftBySupplier, setTargetDraftBySupplier] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [creating, setCreating] = useState<string | null>(null)
  const [success, setSuccess] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'المشتريات', title: 'اقتراحات الشراء' })
  }, [setHeader])

  useEffect(() => {
    api.listProducts().then(({ products }) => setProducts(products)).catch(() => {})
    loadDraftOrders()
  }, [])

  function loadDraftOrders() {
    api.listPurchaseOrders({ status: 'draft' }).then(({ orders }) => setDraftOrders(orders)).catch(() => {})
  }

  useEffect(() => {
    api.getReplenishmentSuggestions(targetDays)
      .then(({ suggestions }) => setSuggestions(suggestions.filter(s => s.suggestedReorderQty > 0)))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل الاقتراحات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [targetDays])

  const costByProduct = useMemo(() => new Map(products.map(p => [p.id, p.cost])), [products])

  function quantityFor(row: ReplenishmentSuggestion) {
    return qtyOverrides[row.productId] ?? row.suggestedReorderQty
  }

  // تجميع الأصناف المُختارة حسب المورد المفضّل — كل مجموعة بتاخد قرار مستقل (أمر جديد، أو
  // إضافة لمسودة موجودة لنفس المورد)، عشان صنفين لموردين مختلفين ميتحطوش في نفس أمر الشراء.
  const groupsBySupplier = useMemo(() => {
    if (!suggestions) return new Map<string, { supplierName: string, rows: ReplenishmentSuggestion[] }>()
    const groups = new Map<string, { supplierName: string, rows: ReplenishmentSuggestion[] }>()
    for (const row of suggestions) {
      if (!selected[row.productId] || !row.preferredSupplierId) continue
      const g = groups.get(row.preferredSupplierId) ?? { supplierName: row.preferredSupplierName ?? '', rows: [] }
      g.rows.push(row)
      groups.set(row.preferredSupplierId, g)
    }
    return groups
  }, [suggestions, selected])

  async function createNewOrderForSupplier(supplierId: string, rows: ReplenishmentSuggestion[]) {
    setError('')
    setCreating(supplierId)
    try {
      const { order } = await api.createPurchaseOrder({
        supplierId,
        notes: 'أُنشئ تلقائياً من اقتراحات الشراء',
        items: rows.map(r => ({ productId: r.productId, orderedQty: quantityFor(r), unitCost: r.lastReceivedCost ?? costByProduct.get(r.productId) ?? 0 }))
      })
      navigate(`/purchasing/orders/edit/${order.id}`)
    } catch {
      setError('تعذر إنشاء أمر الشراء')
    } finally {
      setCreating(null)
    }
  }

  async function mergeIntoDraft(supplierId: string, draftId: string, rows: ReplenishmentSuggestion[]) {
    setError('')
    setCreating(supplierId)
    try {
      await api.mergeRecommendationsIntoDraftPO(draftId, {
        supplierId,
        items: rows.map(r => ({ productId: r.productId, additionalQty: quantityFor(r), unitCost: r.lastReceivedCost ?? costByProduct.get(r.productId) ?? 0 }))
      })
      setSuccess('تمت الإضافة إلى مسودة أمر الشراء')
      navigate(`/purchasing/orders/edit/${draftId}`)
    } catch (err) {
      setError(err instanceof ApiError ? 'تعذر الدمج مع مسودة أمر الشراء' : 'حدث خطأ، حاول مرة أخرى')
    } finally {
      setCreating(null)
    }
  }

  if (error && !suggestions) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!suggestions) return null

  return (
    <div className="admin-table-card">
      <div className="admin-table-tools" style={{ justifyContent: 'space-between' }}>
        <span className="admin-form-chips">
          {TARGET_DAYS_OPTIONS.map(d => (
            <button key={d} type="button" className={`admin-form-chip ${targetDays === d ? 'active' : ''}`} onClick={() => setTargetDays(d)}>
              تغطية {d} يوم
            </button>
          ))}
        </span>
      </div>

      {error && <div className="admin-form-error" style={{ margin: '0 16px' }}>{error}</div>}
      {success && <div className="admin-form-success" style={{ margin: '0 16px' }}>{success}</div>}

      <div className="admin-table-scroll">
        <div style={{ minWidth: 980 }}>
          <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
            <div></div><div>المنتج</div><div>المخزون الحالي</div><div>مبيعات/يوم</div><div>أيام التغطية</div>
            <div>في الطريق</div><div>آخر تكلفة استلام</div><div>المورد المفضّل</div><div>الكمية المقترحة</div>
          </div>
          {suggestions.map(row => (
            <div key={row.productId} className="admin-table-row" style={{ gridTemplateColumns: COLS }}>
              <div>
                <input
                  type="checkbox"
                  disabled={!row.preferredSupplierId}
                  checked={!!selected[row.productId]}
                  onChange={e => setSelected(current => ({ ...current, [row.productId]: e.target.checked }))}
                />
              </div>
              <div className="admin-cell-plain" style={{ fontWeight: 700 }}>{row.productName}</div>
              <div className="admin-cell-plain">{row.currentStock}</div>
              <div className="admin-cell-plain" style={{ color: '#68746B' }}>{row.avgDailySales7d}</div>
              <div className="admin-cell-plain" style={{ color: '#68746B' }}>{row.daysOfCover ?? '—'}</div>
              <div className="admin-cell-plain" style={{ color: '#68746B' }}>{row.incomingQty > 0 ? row.incomingQty : '—'}</div>
              <div className="admin-cell-plain" style={{ color: '#68746B' }}>{row.lastReceivedCost != null ? row.lastReceivedCost.toFixed(2) : '—'}</div>
              <div className="admin-cell-plain" style={{ color: '#68746B' }}>{row.preferredSupplierName ?? 'بدون مورد مفضّل'}</div>
              <div>
                <input
                  type="number" min={0} value={quantityFor(row)}
                  onChange={e => setQtyOverrides(current => ({ ...current, [row.productId]: Number(e.target.value) }))}
                  style={{ width: 80 }}
                />
              </div>
            </div>
          ))}
          {suggestions.length === 0 && <div className="admin-table-empty">مفيش منتجات محتاجة إعادة طلب حالياً بهذه التغطية</div>}
        </div>
      </div>

      {groupsBySupplier.size > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderTop: '1px solid #e5e9e6' }}>
          {Array.from(groupsBySupplier.entries()).map(([supplierId, group]) => {
            const compatibleDrafts = draftOrders.filter(o => o.supplierId === supplierId)
            const chosenDraftId = targetDraftBySupplier[supplierId] ?? ''
            return (
              <div key={supplierId} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <strong style={{ minWidth: 140 }}>{group.supplierName}</strong>
                <span style={{ color: '#68746B', fontSize: 12.5 }}>{group.rows.length} صنف مُختار</span>
                <button
                  className="admin-form-save"
                  disabled={creating === supplierId}
                  onClick={() => createNewOrderForSupplier(supplierId, group.rows)}
                >
                  إنشاء أمر شراء جديد
                </button>
                {compatibleDrafts.length > 0 && (
                  <>
                    <select
                      value={chosenDraftId}
                      onChange={e => setTargetDraftBySupplier(current => ({ ...current, [supplierId]: e.target.value }))}
                    >
                      <option value="">اختر مسودة موجودة</option>
                      {compatibleDrafts.map(o => (
                        <option key={o.id} value={o.id}>{o.poNumber}</option>
                      ))}
                    </select>
                    <button
                      className="admin-form-save"
                      disabled={!chosenDraftId || creating === supplierId}
                      onClick={() => mergeIntoDraft(supplierId, chosenDraftId, group.rows)}
                    >
                      إضافة إلى أمر شراء مسودة موجود
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
