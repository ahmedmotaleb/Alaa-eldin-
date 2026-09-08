import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type AdminCategory, type AdminProduct } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '2fr 1fr .8fr .8fr .7fr .9fr .8fr'

export function ProductsListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [products, setProducts] = useState<AdminProduct[] | null>(null)
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState('الكل')

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: 'جميع المنتجات', action: { label: 'إضافة منتج', onClick: () => navigate('/products/add') } })
  }, [setHeader, navigate])

  useEffect(() => {
    Promise.all([api.listProducts(), api.listCategories()])
      .then(([p, c]) => { setProducts(p.products); setCategories(c.categories) })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل المنتجات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  const filtered = useMemo(() => {
    if (!products) return []
    const q = query.trim()
    return products
      .filter(p => !q || p.name.includes(q) || p.id.includes(q) || p.barcode.includes(q))
      .filter(p => chip === 'الكل' || categories.find(c => c.id === p.categoryId)?.name === chip)
  }, [products, categories, query, chip])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!products) return null

  const lowStock = products.filter(p => p.stock <= p.alertThreshold).length
  const avgMargin = products.length ? products.reduce((a, p) => a + (p.price - p.cost) / p.price, 0) / products.length : 0

  return (
    <>
      <StatsGrid stats={[
        { label: 'عدد المنتجات', value: String(products.length), note: 'في الكتالوج', icon: '📦', tint: '#EAF2FF' },
        { label: 'منتجات معروضة', value: String(products.filter(p => p.available).length), note: 'ظاهرة للعملاء', icon: '✅', tint: '#EAF8EF' },
        { label: 'منخفضة المخزون', value: String(lowStock), note: 'تحت حد التنبيه', icon: '⚠️', tint: '#FFF3E3', noteColor: '#B45309' },
        { label: 'متوسط الهامش', value: `${Math.round(avgMargin * 100)}%`, note: 'على مستوى الكتالوج', icon: '📈', tint: '#FFECEC' }
      ]} />

      <div className="admin-table-card">
        <div className="admin-table-tools">
          <div className="admin-search">
            <span style={{ color: '#8A948C', fontSize: 13 }}>🔎</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث بالاسم أو SKU أو الباركود..." />
          </div>
          <div className="admin-chips">
            {['الكل', ...categories.map(c => c.name)].map(label => (
              <button key={label} className={`admin-chip ${chip === label ? 'active' : ''}`} onClick={() => setChip(label)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="admin-table-scroll">
          <div style={{ minWidth: 900 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
              <div>المنتج</div><div>القسم</div><div>سعر البيع</div><div>التكلفة</div><div>الهامش</div><div>المخزون</div><div>الحالة</div>
            </div>
            {filtered.map(p => {
              const margin = (p.price - p.cost) / p.price
              const low = p.stock <= p.alertThreshold
              const categoryName = categories.find(c => c.id === p.categoryId)?.name ?? ''
              return (
                <div key={p.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/products/edit/${p.id}`)}>
                  <div className="admin-cell-product">
                    <span className="admin-cell-product-icon" style={{ background: categories.find(c => c.id === p.categoryId)?.tint }}>{p.emoji}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="admin-cell-product-text">{p.name}</span>
                      <span className="admin-cell-product-sub">{p.id} · {p.barcode}</span>
                    </span>
                  </div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{categoryName}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{formatMoney(p.price)}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{formatMoney(p.cost)}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 800, color: margin > .22 ? '#12813C' : '#B45309' }}>{Math.round(margin * 100)}%</div>
                  <div className="admin-cell-plain" style={{ color: low ? '#B42318' : '#3B4A40' }}>{p.stock} {p.unit}</div>
                  <div><span className="admin-pill" style={{ background: p.available ? '#EAF8EF' : '#F1F4F2', color: p.available ? '#12813C' : '#68746B' }}>{p.available ? 'معروض' : 'مخفي'}</span></div>
                </div>
              )
            })}
            {filtered.length === 0 && <div className="admin-table-empty">مفيش بيانات في هذا العرض</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{filtered.length} منتج</span>
          <span>اضغط على أي منتج لتعديله</span>
        </div>
      </div>
    </>
  )
}
