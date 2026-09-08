import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type AdminCategory, type AdminProduct } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '2fr .9fr .8fr .9fr .9fr 1fr'

export function InventoryPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [products, setProducts] = useState<AdminProduct[] | null>(null)
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState('الكل')

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: 'المخزون' })
  }, [setHeader])

  useEffect(() => {
    Promise.all([api.listProducts(), api.listCategories()])
      .then(([p, c]) => { setProducts(p.products); setCategories(c.categories) })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل بيانات المخزون' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  const filtered = useMemo(() => {
    if (!products) return []
    const q = query.trim()
    return products
      .filter(p => !q || p.name.includes(q) || p.id.includes(q))
      .filter(p => chip === 'الكل' || categories.find(c => c.id === p.categoryId)?.name === chip)
      .slice()
      .sort((a, b) => (a.stock / Math.max(1, a.alertThreshold)) - (b.stock / Math.max(1, b.alertThreshold)))
  }, [products, categories, query, chip])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!products) return null

  return (
    <>
      <StatsGrid stats={[
        { label: 'قيمة المخزون بالتكلفة', value: formatMoney(products.reduce((a, p) => a + p.cost * p.stock, 0)), note: 'إجمالي الكتالوج', icon: '🏬', tint: '#EAF2FF' },
        { label: 'قيمة المخزون بالبيع', value: formatMoney(products.reduce((a, p) => a + p.price * p.stock, 0)), note: 'لو تم بيعه بالكامل', icon: '💰', tint: '#EAF8EF' },
        { label: 'تحت حد التنبيه', value: String(products.filter(p => p.stock <= p.alertThreshold && p.stock > 0).length), note: 'يحتاج إعادة طلب', icon: '⚠️', tint: '#FFF3E3', noteColor: '#B45309' },
        { label: 'نفد المخزون', value: String(products.filter(p => p.stock === 0).length), note: 'غير متاح للبيع', icon: '⛔', tint: '#FFECEC', noteColor: '#B42318' }
      ]} />

      <div className="admin-table-card">
        <div className="admin-table-tools">
          <div className="admin-search">
            <span style={{ color: '#8A948C', fontSize: 13 }}>🔎</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث عن منتج..." />
          </div>
          <div className="admin-chips">
            {['الكل', ...categories.map(c => c.name)].map(label => (
              <button key={label} className={`admin-chip ${chip === label ? 'active' : ''}`} onClick={() => setChip(label)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="admin-table-scroll">
          <div style={{ minWidth: 820 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
              <div>المنتج</div><div>المخزون</div><div>حد التنبيه</div><div>قيمة التكلفة</div><div>الوحدة</div><div>الحالة</div>
            </div>
            {filtered.map(p => {
              const status = p.stock === 0 ? { label: 'نفد', bg: '#FFF0EF', fg: '#B42318' }
                : p.stock <= p.alertThreshold ? { label: 'منخفض', bg: '#FFF3E3', fg: '#B45309' }
                : { label: 'متاح', bg: '#EAF8EF', fg: '#12813C' }
              return (
                <div key={p.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/products/edit/${p.id}`)}>
                  <div className="admin-cell-product">
                    <span className="admin-cell-product-icon" style={{ background: categories.find(c => c.id === p.categoryId)?.tint }}>{p.emoji}</span>
                    <span className="admin-cell-product-text">{p.name}</span>
                  </div>
                  <div className="admin-cell-plain" style={{ fontWeight: 800, color: p.stock <= p.alertThreshold ? '#B42318' : '#3B4A40' }}>{p.stock}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{p.alertThreshold}</div>
                  <div className="admin-cell-plain">{formatMoney(p.cost * p.stock)}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{p.unit}</div>
                  <div><span className="admin-pill" style={{ background: status.bg, color: status.fg }}>{status.label}</span></div>
                </div>
              )
            })}
            {filtered.length === 0 && <div className="admin-table-empty">مفيش بيانات في هذا العرض</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{filtered.length} منتج</span>
          <span>مرتب حسب الأقرب لحد التنبيه</span>
        </div>
      </div>
    </>
  )
}
