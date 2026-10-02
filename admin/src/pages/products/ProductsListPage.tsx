import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { SafeImage } from '../../components/SafeImage'
import { api, ApiError, type AdminCategory, type AdminProduct } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import { useDebouncedValue } from '../../utils/useDebouncedValue'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '36px 2fr 1fr .8fr .8fr .7fr .9fr .8fr'
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
  const [csvNotice, setCsvNotice] = useState('')
  const importInputRef = useRef<HTMLInputElement>(null)
  const debouncedQuery = useDebouncedValue(query)

  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [bulkBrand, setBulkBrand] = useState('')
  const [bulkError, setBulkError] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

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
  useEffect(() => { setSelected({}) }, [page, debouncedQuery, chip])

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

  async function exportCsv() {
    try {
      await api.exportProductsCsv()
    } catch {
      setCsvNotice('تعذر تصدير الملف')
    }
  }

  async function importCsv(file: File) {
    try {
      const result = await api.importProductsCsv(file)
      setCsvNotice(`تم تحديث ${result.updated} منتج${result.skipped.length ? ` — ${result.skipped.length} صف اتجاهل` : ''}`)
      api.listProducts({ page, limit: LIMIT, search: debouncedQuery.trim() || undefined }).then(({ products }) => setProducts(products)).catch(() => {})
    } catch {
      setCsvNotice('تعذر استيراد الملف')
    } finally {
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  function toggleRow(id: string, checked: boolean) {
    setSelected(current => ({ ...current, [id]: checked }))
  }

  function toggleAllOnPage(checked: boolean) {
    if (!products) return
    const next: Record<string, boolean> = {}
    if (checked) for (const p of products) next[p.id] = true
    setSelected(next)
  }

  async function applyBulkAction(action: 'set_available' | 'set_unavailable' | 'set_category' | 'set_brand') {
    const productIds = Object.keys(selected).filter(id => selected[id])
    if (productIds.length === 0) return

    const confirmMessage =
      action === 'set_available' ? `سيتم إظهار ${productIds.length} منتج للعملاء. هل تريد المتابعة؟`
      : action === 'set_unavailable' ? `سيتم إخفاء ${productIds.length} منتج عن العملاء. هل تريد المتابعة؟`
      : action === 'set_category' ? `سيتم نقل ${productIds.length} منتج إلى هذا القسم. هل تريد المتابعة؟`
      : `سيتم تعيين "${bulkBrand.trim()}" كعلامة تجارية لـ ${productIds.length} منتج. هل تريد المتابعة؟`
    if (!window.confirm(confirmMessage)) return

    setBulkError('')
    setBulkBusy(true)
    try {
      const result = await api.bulkUpdateProducts({
        productIds, action,
        categoryId: action === 'set_category' ? bulkCategoryId : undefined,
        brand: action === 'set_brand' ? bulkBrand.trim() : undefined
      })
      if (result.failed.length > 0) {
        setBulkError(`تم تحديث ${result.updated} وفشل ${result.failed.length} (${result.failed.map(f => f.reason).join('، ')})`)
      }
      setSelected({})
      const categoryId = chip === 'الكل' ? undefined : categories.find(c => c.name === chip)?.id
      const refreshed = await api.listProducts({ page, limit: LIMIT, search: debouncedQuery.trim() || undefined, categoryId })
      setProducts(refreshed.products)
    } catch {
      setBulkError('تعذر تنفيذ الإجراء الجماعي')
    } finally {
      setBulkBusy(false)
    }
  }

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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="admin-form-chip" onClick={exportCsv}>تصدير CSV</button>
            <button className="admin-form-chip" onClick={() => importInputRef.current?.click()}>استيراد CSV (تحديث فقط)</button>
            <input ref={importInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) importCsv(f) }} />
            <button className="admin-form-chip" onClick={() => navigate('/products/import')}>استيراد متقدّم (إنشاء + تحديث)</button>
            <button className="admin-form-chip" onClick={() => navigate('/products/bulk-pricing')}>تحديث الأسعار بالجملة</button>
            <button className="admin-form-chip" onClick={() => navigate('/products/bulk-stock')}>تحديث المخزون بالجملة</button>
            <button className="admin-form-chip" onClick={() => navigate('/products/bulk-cost')}>تحديث التكلفة بالجملة</button>
            <button className="admin-form-chip" onClick={() => navigate('/products/bulk-operations')}>العمليات الجماعية</button>
          </div>
        </div>
        {csvNotice && <div className="admin-form-success" style={{ margin: '0 16px' }}>{csvNotice}</div>}

        {Object.values(selected).some(Boolean) && (
          <div className="admin-bulk-select-bar" style={{ margin: '0 16px 12px', padding: 12, background: '#EAF2FF', borderRadius: 8, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong>تم تحديد {Object.values(selected).filter(Boolean).length} منتج</strong>
            <button className="admin-form-chip" disabled={bulkBusy} onClick={() => applyBulkAction('set_available')}>إظهار المحدد</button>
            <button className="admin-form-chip" disabled={bulkBusy} onClick={() => applyBulkAction('set_unavailable')}>إخفاء المحدد</button>
            <select value={bulkCategoryId} onChange={e => setBulkCategoryId(e.target.value)}>
              <option value="">نقل إلى قسم...</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="admin-form-chip" disabled={bulkBusy || !bulkCategoryId} onClick={() => applyBulkAction('set_category')}>تطبيق نقل القسم</button>
            <input placeholder="علامة تجارية جديدة" value={bulkBrand} onChange={e => setBulkBrand(e.target.value)} style={{ width: 160 }} />
            <button className="admin-form-chip" disabled={bulkBusy || !bulkBrand.trim()} onClick={() => applyBulkAction('set_brand')}>تطبيق العلامة التجارية</button>
            <button className="admin-form-chip" disabled={bulkBusy} onClick={() => setSelected({})}>إلغاء التحديد</button>
          </div>
        )}
        {bulkError && <div className="admin-form-error" style={{ margin: '0 16px 12px' }}>{bulkError}</div>}

        <div className="admin-table-scroll">
          <div style={{ minWidth: 900 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
              <div>
                <input
                  type="checkbox"
                  checked={products.length > 0 && products.every(p => selected[p.id])}
                  onChange={e => toggleAllOnPage(e.target.checked)}
                  aria-label="تحديد كل المنتجات في هذه الصفحة"
                />
              </div>
              <div>المنتج</div><div>القسم</div><div>سعر البيع</div><div>التكلفة</div><div>الهامش</div><div>المخزون</div><div>الحالة</div>
            </div>
            {products.map(p => {
              const margin = (p.price - p.cost) / p.price
              const low = p.stock <= p.alertThreshold
              const categoryName = categories.find(c => c.id === p.categoryId)?.name ?? ''
              return (
                <div key={p.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/products/edit/${p.id}`)}>
                  <div onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={!!selected[p.id]}
                      onChange={e => toggleRow(p.id, e.target.checked)}
                      aria-label={`تحديد ${p.name}`}
                    />
                  </div>
                  <div className="admin-cell-product">
                    <span className="admin-cell-product-icon" style={{ background: p.primaryImage ? '#fff' : categories.find(c => c.id === p.categoryId)?.tint, overflow: 'hidden' }}>
                      <SafeImage sources={[p.primaryImage]} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} fallback={p.emoji} />
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
