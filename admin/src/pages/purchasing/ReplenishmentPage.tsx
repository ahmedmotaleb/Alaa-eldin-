import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminProduct, type ReplenishmentSuggestion } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '40px 1.3fr .8fr .8fr .8fr 1fr .9fr'
const TARGET_DAYS_OPTIONS = [7, 14, 30]

export function ReplenishmentPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [targetDays, setTargetDays] = useState(14)
  const [suggestions, setSuggestions] = useState<ReplenishmentSuggestion[] | null>(null)
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [success, setSuccess] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'المشتريات', title: 'اقتراحات الشراء' })
  }, [setHeader])

  useEffect(() => {
    api.listProducts().then(({ products }) => setProducts(products)).catch(() => {})
  }, [])

  useEffect(() => {
    api.getReplenishmentSuggestions(targetDays)
      .then(({ suggestions }) => setSuggestions(suggestions.filter(s => s.suggestedReorderQty > 0)))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل الاقتراحات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [targetDays])

  const costByProduct = useMemo(() => new Map(products.map(p => [p.id, p.cost])), [products])

  function quantityFor(row: ReplenishmentSuggestion) {
    return qtyOverrides[row.productId] ?? row.suggestedReorderQty
  }

  async function createPurchaseOrders() {
    if (!suggestions) return
    const chosen = suggestions.filter(s => selected[s.productId] && s.preferredSupplierId)
    if (chosen.length === 0) { setError('اختر صنف واحد على الأقل له مورد مفضّل'); return }

    setError('')
    setCreating(true)
    try {
      const bySupplier = new Map<string, ReplenishmentSuggestion[]>()
      for (const row of chosen) {
        const list = bySupplier.get(row.preferredSupplierId!) ?? []
        list.push(row)
        bySupplier.set(row.preferredSupplierId!, list)
      }

      const createdOrders: string[] = []
      for (const [supplierId, rows] of bySupplier) {
        const { order } = await api.createPurchaseOrder({
          supplierId,
          notes: 'أُنشئ تلقائياً من اقتراحات الشراء',
          items: rows.map(r => ({ productId: r.productId, orderedQty: quantityFor(r), unitCost: costByProduct.get(r.productId) ?? 0 }))
        })
        createdOrders.push(order.id)
      }

      setSuccess(`تم إنشاء ${createdOrders.length} أمر شراء`)
      if (createdOrders.length === 1) navigate(`/purchasing/orders/edit/${createdOrders[0]}`)
    } catch {
      setError('تعذر إنشاء أمر الشراء')
    } finally {
      setCreating(false)
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
        <button className="admin-form-save" disabled={creating} onClick={createPurchaseOrders}>إنشاء أمر شراء للمورد</button>
      </div>

      {error && <div className="admin-form-error" style={{ margin: '0 16px' }}>{error}</div>}
      {success && <div className="admin-form-success" style={{ margin: '0 16px' }}>{success}</div>}

      <div className="admin-table-scroll">
        <div style={{ minWidth: 880 }}>
          <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
            <div></div><div>المنتج</div><div>المخزون الحالي</div><div>مبيعات/يوم</div><div>أيام التغطية</div><div>المورد المفضّل</div><div>الكمية المقترحة</div>
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
    </div>
  )
}
