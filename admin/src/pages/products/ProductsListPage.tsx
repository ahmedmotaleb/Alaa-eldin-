import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type AdminCategory, type AdminProduct } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import { useDebouncedValue } from '../../utils/useDebouncedValue'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '2fr 1fr .8fr .8fr .7fr .9fr .8fr'
const LIMIT = 20

export function ProductsListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [products, setProducts] = useState<AdminProduct[] | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [statsProducts, setStatsProducts] = useState<AdminProduct[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState('الكل')
  const debouncedQuery = useDebouncedValue(query)

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: 'جميع المنتجات', action: { label: 'إضافة منتج', onClick: () => navigate('/products/add') } })
  }, [setHeader, navigate])

  // إحصائيات الكتالوج بتتحسب من كل المنتجات (بدون ترقيم) عشان تفضل صحيحة بغض النظر
  // عن الصفحة الحالية أو البحث/الفلتر المطبّق على الجدول.
  useEffect(() => {
    Promise.all([api.listProducts(), api.listCategories()])
      .then(([p, c]) => { setStatsProducts(p.products); setCategories(c.categories) })
      .catch(() => {})
  }, [])

  useEffect(() => { setPage(1) }, [debouncedQuery, chip])

  useEffect(() => {
    const categoryId = chip === 'الكل' ? undefined : categories.find(c => c.name === chip)?.id
    api.listProducts({ page, limit: LIMIT, search: debouncedQuery.trim() || undefined, categoryId })
      .then(({ products, totalPages, total }) => {
        setProducts(products)
        setTotalPages(totalPages ?? 1)
        setTotal(total ?? products.length)
      })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل المنتجات' : 'حدث خطأ، حاول مرة أخرى'))
  }, [page, debouncedQuery, chip, categories])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!products) return null

  const lowStock = statsProducts.filter(p => p.stock <= p.alertThreshold).length
  const avgMargin = statsProducts.length ? statsProducts.reduce((a, p) => a + (p.price - p.cost) / p.price, 0) / statsProducts.length : 0

  return (
    <>
      <StatsGrid stats={[
        { label: 'عدد المنتجات', value: String(statsProducts.length), note: 'في الكتالوج', icon: '📦', tint: '#EAF2FF' },
        { label: 'منتجات معروضة', value: String(statsProducts.filter(p => p.available).length), note: 'ظاهرة للعملاء', icon: '✅', tint: '#EAF8EF' },
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
            {products.map(p => {
              const margin = (p.price - p.cost) / p.price
              const low = p.stock <= p.alertThreshold
              const categoryName = categories.find(c => c.id === p.categoryId)?.name ?? ''
              return (
                <div key={p.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/products/edit/${p.id}`)}>
                  <div className="admin-cell-product">
                    <span className="admin-cell-product-icon" style={{ background: p.primaryImage ? '#fff' : categories.find(c => c.id === p.categoryId)?.tint, overflow: 'hidden' }}>
                      {p.primaryImage ? <img src={p.primaryImage} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : p.emoji}
                    </span>
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
            {products.length === 0 && <div className="admin-table-empty">مفيش بيانات في هذا العرض</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{total} منتج</span>
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
