import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { SafeImage } from '../../components/SafeImage'
import { api, ApiError, type AdminCategory, type AdminProduct } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '2fr 1fr .8fr .8fr .7fr .7fr .8fr 1.3fr'
const LIMIT = 20

// صفحة "عروض المنتجات" — مختلفة تماماً عن "العروض الترويجية" (Buy X Get Y / باقات بسعر
// ثابت) اللي بتدير مستوى السلة؛ هنا بس خصومات مستوى المنتج الفردي (oldPrice > price).
// القايمة هنا بتعتمد بالكامل على offer عمود GENERATED من السيرفر (راجع migration 0073) —
// مفيش أي منتج ممكن يظهر هنا من غير خصم حقيقي فعلي، وده بالضبط الهدف من الصفحة دي.
export function ProductOffersPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [products, setProducts] = useState<AdminProduct[] | null>(null)
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: 'عروض المنتجات' })
  }, [setHeader])

  useEffect(() => {
    api.listCategories().then(({ categories }) => setCategories(categories)).catch(() => {})
  }, [])

  function reload() {
    api.listProducts({ page, limit: LIMIT, offerOnly: true })
      .then(({ products, totalPages, total }) => {
        setProducts(products)
        setTotalPages(totalPages ?? 1)
        setTotal(total ?? products.length)
      })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل العروض' : 'حدث خطأ، حاول مرة أخرى'))
  }

  useEffect(reload, [page])

  async function endOffer(product: AdminProduct) {
    if (!window.confirm(`إنهاء عرض "${product.name}"؟\n\nسيظل المنتج موجودًا في المتجر بسعره الحالي، لكن لن يظهر في صفحة العروض.`)) return
    setBusyId(product.id)
    setNotice('')
    try {
      await api.endProductOffer(product.id)
      setNotice(`تم إنهاء عرض "${product.name}"`)
      reload()
    } catch {
      window.alert('تعذر إنهاء العرض')
    } finally {
      setBusyId('')
    }
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!products) return null

  return (
    <div className="admin-table-card">
      {notice && <div className="admin-form-success" style={{ margin: '12px 16px 0' }}>{notice}</div>}

      {products.length === 0 ? (
        <div className="admin-placeholder-card">
          <div className="admin-placeholder-note">مفيش منتجات عليها خصم حاليًا</div>
          <button className="admin-form-chip" style={{ marginTop: 10 }} onClick={() => navigate('/products')}>اختيار منتج لعمل عرض</button>
        </div>
      ) : (
        <>
          <div className="admin-table-scroll">
            <div style={{ minWidth: 900 }}>
              <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
                <div>المنتج</div><div>القسم</div><div>السعر الحالي</div><div>السعر قبل الخصم</div><div>نسبة الخصم</div><div>المخزون</div><div>الحالة</div><div>الإجراءات</div>
              </div>
              {products.map(p => {
                const categoryName = categories.find(c => c.id === p.categoryId)?.name ?? ''
                const discountPercent = p.oldPrice && p.oldPrice > p.price ? Math.round(((p.oldPrice - p.price) / p.oldPrice) * 100) : 0
                return (
                  <div key={p.id} className="admin-table-row" style={{ gridTemplateColumns: COLS }}>
                    <div className="admin-cell-product">
                      <span className="admin-cell-product-icon" style={{ background: p.primaryImage ? '#fff' : categories.find(c => c.id === p.categoryId)?.tint, overflow: 'hidden' }}>
                        <SafeImage sources={[p.primaryImage]} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} fallback={p.emoji} />
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="admin-cell-product-text">{p.name}</span>
                        <span className="admin-cell-product-sub">{p.id}</span>
                      </span>
                    </div>
                    <div className="admin-cell-plain" style={{ color: '#68746B' }}>{categoryName}</div>
                    <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{formatMoney(p.price)}</div>
                    <div className="admin-cell-plain" style={{ color: '#68746B', textDecoration: 'line-through' }}>{formatMoney(p.oldPrice ?? 0)}</div>
                    <div className="admin-cell-plain" style={{ fontWeight: 800, color: '#B42318' }}>{discountPercent}%</div>
                    <div className="admin-cell-plain">{p.stock} {p.unit}</div>
                    <div><span className="admin-pill" style={{ background: p.available ? '#EAF8EF' : '#F1F4F2', color: p.available ? '#12813C' : '#68746B' }}>{p.available ? 'معروض' : 'مخفي'}</span></div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="admin-form-chip" onClick={() => navigate(`/products/edit/${p.id}`)}>تعديل العرض</button>
                      <button className="admin-form-chip" style={{ background: '#FFECEC', color: '#B42318' }} disabled={busyId === p.id} onClick={() => endOffer(p)}>إنهاء العرض</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="admin-table-footer">
            <span>{total} منتج عليه عرض</span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>صفحة {page} من {totalPages}</span>
              <button className="admin-form-chip" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>السابق</button>
              <button className="admin-form-chip" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>التالي</button>
            </span>
          </div>
        </>
      )}
    </div>
  )
}
