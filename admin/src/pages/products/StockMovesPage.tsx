import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type AdminProduct, type AdminStockMovement, type StockMovementType } from '../../utils/api'
import { formatDateTime } from '../../utils/format'
import { useDebouncedValue } from '../../utils/useDebouncedValue'
import type { LayoutContext } from '../../components/AdminLayout'

const TYPE_LABEL: Record<StockMovementType, string> = {
  restock: 'إضافة مخزون',
  return: 'مرتجع',
  damage: 'تلف',
  loss: 'فقد',
  adjustment: 'تعديل يدوي',
  sale: 'بيع (طلب عميل)',
  cancel_restore: 'استرجاع (إلغاء طلب)'
}

const TYPE_OPTIONS: StockMovementType[] = ['restock', 'return', 'damage', 'loss', 'adjustment']
const INCREASE_TYPES: StockMovementType[] = ['restock', 'return']
const DECREASE_TYPES: StockMovementType[] = ['damage', 'loss']
const LIMIT = 20

export function StockMovesPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [movements, setMovements] = useState<AdminStockMovement[] | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [statsMovements, setStatsMovements] = useState<AdminStockMovement[]>([])
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const debouncedQuery = useDebouncedValue(query)
  const [showCreate, setShowCreate] = useState(false)

  const [productId, setProductId] = useState('')
  const [type, setType] = useState<StockMovementType>('restock')
  const [amount, setAmount] = useState(1)
  const [direction, setDirection] = useState<1 | -1>(1)
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.listProducts().then(({ products }) => {
      setProducts(products)
      setProductId(current => current || products[0]?.id || '')
    }).catch(() => {})
  }, [])

  // الإحصائيات بتتحسب من كل الحركات (بدون ترقيم) عشان تفضل صحيحة بغض النظر عن الصفحة
  // الحالية أو البحث المطبّق على الجدول.
  useEffect(() => {
    api.listStockMovements().then(({ movements }) => setStatsMovements(movements)).catch(() => {})
  }, [refreshKey])

  useEffect(() => { setPage(1) }, [debouncedQuery])

  useEffect(() => {
    api.listStockMovements({ page, limit: LIMIT, search: debouncedQuery.trim() || undefined })
      .then(({ movements, totalPages, total }) => {
        setMovements(movements)
        setTotalPages(totalPages ?? 1)
        setTotal(total ?? movements.length)
      })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل حركات المخزون' : 'حدث خطأ، حاول مرة أخرى'))
  }, [page, debouncedQuery, refreshKey])

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: 'تحويلات المخزون', action: { label: 'تسجيل حركة', onClick: () => setShowCreate(v => !v) } })
  }, [setHeader])

  function quantityChange() {
    if (INCREASE_TYPES.includes(type)) return amount
    if (DECREASE_TYPES.includes(type)) return -amount
    return direction * amount
  }

  async function submit() {
    setFormError('')
    if (!productId || amount <= 0) {
      setFormError('يرجى اختيار منتج وكمية أكبر من صفر')
      return
    }
    setSaving(true)
    try {
      await api.createStockMovement({ productId, type, quantityChange: quantityChange(), note: note.trim() || undefined })
      setAmount(1)
      setNote('')
      setShowCreate(false)
      setPage(1)
      setRefreshKey(k => k + 1)
    } catch (err) {
      setFormError(err instanceof ApiError && err.code === 'insufficient_stock' ? 'الكمية أكبر من المخزون المتاح لهذا المنتج' : 'تعذر تسجيل الحركة')
    } finally {
      setSaving(false)
    }
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!movements) return null

  const totalIn = statsMovements.filter(m => m.quantityChange > 0).reduce((a, m) => a + m.quantityChange, 0)
  const totalOut = statsMovements.filter(m => m.quantityChange < 0).reduce((a, m) => a + Math.abs(m.quantityChange), 0)
  const affectedProducts = new Set(statsMovements.map(m => m.productId)).size

  return (
    <>
      {showCreate && (
        <div className="admin-form-card" style={{ marginBottom: 16 }}>
          <div className="admin-form-card-title">تسجيل حركة مخزون</div>
          <label>المنتج
            <select value={productId} onChange={e => setProductId(e.target.value)}>
              {products.map(p => <option key={p.id} value={p.id}>{p.name} — متاح حالياً: {p.stock}</option>)}
            </select>
          </label>
          <label>نوع الحركة
            <span className="admin-form-chips">
              {TYPE_OPTIONS.map(t => (
                <button key={t} type="button" className={`admin-form-chip ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>{TYPE_LABEL[t]}</button>
              ))}
            </span>
          </label>
          {type === 'adjustment' && (
            <label>الاتجاه
              <span className="admin-form-chips">
                <button type="button" className={`admin-form-chip ${direction === 1 ? 'active' : ''}`} onClick={() => setDirection(1)}>زيادة (+)</button>
                <button type="button" className={`admin-form-chip ${direction === -1 ? 'active' : ''}`} onClick={() => setDirection(-1)}>نقص (-)</button>
              </span>
            </label>
          )}
          <div className="admin-row-2">
            <label>الكمية
              <input type="number" min={1} value={amount} onChange={e => setAmount(Math.max(0, Number(e.target.value)))} />
            </label>
            <label>ملاحظة (اختياري)
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="مثال: توريد من المورد" />
            </label>
          </div>
          {formError && <div className="admin-form-error">{formError}</div>}
          <button className="admin-form-save" disabled={saving} onClick={submit}>حفظ الحركة</button>
        </div>
      )}

      <StatsGrid stats={[
        { label: 'عدد الحركات', value: String(statsMovements.length), note: 'منذ البداية', icon: '📋', tint: '#EAF2FF' },
        { label: 'إجمالي الإضافات', value: `+${totalIn}`, note: 'وحدة مضافة', icon: '📥', tint: '#EAF8EF' },
        { label: 'إجمالي الخصومات', value: `-${totalOut}`, note: 'وحدة مخصومة', icon: '📤', tint: '#FFECEC', noteColor: '#B42318' },
        { label: 'منتجات متأثرة', value: String(affectedProducts), note: 'منتج له حركة واحدة على الأقل', icon: '📦', tint: '#FFF3E3' }
      ]} />

      <div className="admin-table-card">
        <div className="admin-table-tools">
          <div className="admin-search">
            <span style={{ color: '#8A948C', fontSize: 13 }}>🔎</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث باسم المنتج أو الملاحظة..." />
          </div>
        </div>
        <div className="admin-table-scroll">
          <div style={{ minWidth: 780 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: '1fr 2fr 1fr .8fr 1.4fr' }}>
              <div>التاريخ</div><div>المنتج</div><div>النوع</div><div>التغيير</div><div>ملاحظة</div>
            </div>
            {movements.map(m => (
              <div key={m.id} className="admin-table-row" style={{ gridTemplateColumns: '1fr 2fr 1fr .8fr 1.4fr' }}>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{formatDateTime(m.createdAt)}</div>
                <div className="admin-cell-product">
                  <span className="admin-cell-product-icon" style={{ background: '#F1F4F2' }}>{m.productEmoji}</span>
                  <span className="admin-cell-product-text">{m.productName}</span>
                </div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{TYPE_LABEL[m.type]}</div>
                <div className="admin-cell-plain" style={{ fontWeight: 900, color: m.quantityChange > 0 ? '#12813C' : '#B42318' }}>
                  {m.quantityChange > 0 ? `+${m.quantityChange}` : m.quantityChange}
                </div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{m.note || '—'}</div>
              </div>
            ))}
            {movements.length === 0 && <div className="admin-table-empty">لا توجد حركات مخزون بعد</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{total} حركة</span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>صفحة {page} من {totalPages}</span>
            <button className="admin-form-chip" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>السابق</button>
            <button className="admin-form-chip" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>التالي</button>
          </span>
        </div>
      </div>
    </>
  )
}
