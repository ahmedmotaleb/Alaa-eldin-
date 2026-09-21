import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, type AdminBarcodeSearchProduct } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import { useDebouncedValue } from '../../utils/useDebouncedValue'
import type { LayoutContext } from '../../components/AdminLayout'
import { BarcodeGraphic } from '../../components/BarcodeGraphic'

interface LabelSizePreset {
  label: string
  widthMm: number
  heightMm: number
  isA4: boolean
}

const LABEL_SIZES: Record<string, LabelSizePreset> = {
  '40x30': { label: '40×30 مم', widthMm: 40, heightMm: 30, isA4: false },
  '50x30': { label: '50×30 مم', widthMm: 50, heightMm: 30, isA4: false },
  '50x40': { label: '50×40 مم', widthMm: 50, heightMm: 40, isA4: false },
  a4: { label: 'ورقة A4 (ملصقات متعددة)', widthMm: 63, heightMm: 34, isA4: true }
}

// أقصى عدد ملصقات في الطلب الواحد قبل ما نطلب تأكيد صريح — احتياط ضد ضغطة غلط تطبع آلاف
// الملصقات بالخطأ (مثلاً "= المخزون" على منتج برصيد ضخم).
const CONFIRM_THRESHOLD = 100
const MAX_TOTAL_LABELS = 2000
// شبكة ورقة A4: 3 أعمدة × 8 صفوف (24 ملصق/صفحة) بمقاس خلية ~63×34مم — تقدير عملي معقول
// (مش مُختبر فعلياً على طابعة حقيقية، راجع التقرير النهائي لتفاصيل الحدود المعروفة).
const A4_COLUMNS = 3
const A4_ROWS = 8

interface LabelFields {
  storeName: boolean
  productName: boolean
  variantName: boolean
  price: boolean
  sku: boolean
  humanReadableCode: boolean
}

const DEFAULT_FIELDS: LabelFields = {
  storeName: true, productName: true, variantName: true, price: true, sku: false, humanReadableCode: true
}

interface QueueItem {
  key: string
  targetType: 'product' | 'variant'
  targetId: string
  productName: string
  variantName: string | null
  barcode: string
  sku: string | null
  price: number
  quantity: number
}

export function BarcodeLabelsPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [results, setResults] = useState<AdminBarcodeSearchProduct[]>([])
  const [searching, setSearching] = useState(false)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [labelSize, setLabelSize] = useState<keyof typeof LABEL_SIZES>('50x30')
  const [fields, setFields] = useState<LabelFields>(DEFAULT_FIELDS)
  const [generatingKey, setGeneratingKey] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: 'طباعة الباركود' })
  }, [setHeader])

  useEffect(() => {
    const trimmed = debouncedSearch.trim()
    if (trimmed.length < 2) { setResults([]); return }
    setSearching(true)
    api.searchBarcodeLabels(trimmed)
      .then(({ products }) => setResults(products))
      .catch(() => setResults([]))
      .finally(() => setSearching(false))
  }, [debouncedSearch])

  function addToQueue(item: Omit<QueueItem, 'key' | 'quantity'>, quantity = 1) {
    const key = `${item.targetType}:${item.targetId}`
    setQueue(current => {
      const existing = current.find(q => q.key === key)
      if (existing) {
        return current.map(q => q.key === key ? { ...q, quantity: q.quantity + quantity } : q)
      }
      return [...current, { ...item, key, quantity }]
    })
  }

  function addWithStockQuantity(item: Omit<QueueItem, 'key' | 'quantity'>, stock: number) {
    const quantity = Math.max(1, stock)
    if (quantity > CONFIRM_THRESHOLD) {
      if (!window.confirm(`سيتم إضافة ${quantity} ملصق (بعدد المخزون الحالي) لـ"${item.variantName ?? item.productName}". هل تريد المتابعة؟`)) return
    }
    addToQueue(item, quantity)
  }

  function updateQuantity(key: string, quantity: number) {
    setQueue(current => current.map(q => q.key === key ? { ...q, quantity: Math.max(1, Math.round(quantity) || 1) } : q))
  }

  function removeFromQueue(key: string) {
    setQueue(current => current.filter(q => q.key !== key))
  }

  function moveItem(key: string, direction: -1 | 1) {
    setQueue(current => {
      const index = current.findIndex(q => q.key === key)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function generateBarcode(targetType: 'product' | 'variant', targetId: string) {
    const genKey = `${targetType}:${targetId}`
    setGeneratingKey(genKey)
    setError('')
    try {
      await api.generateBarcode(targetType, targetId)
      const trimmed = debouncedSearch.trim()
      if (trimmed.length >= 2) {
        const { products } = await api.searchBarcodeLabels(trimmed)
        setResults(products)
      }
    } catch {
      setError('تعذر توليد الباركود')
    } finally {
      setGeneratingKey(null)
    }
  }

  const totalLabels = queue.reduce((sum, q) => sum + q.quantity, 0)
  const preset = LABEL_SIZES[labelSize]
  const labelsPerPage = preset.isA4 ? A4_COLUMNS * A4_ROWS : 1
  const totalPages = preset.isA4 ? Math.max(1, Math.ceil(totalLabels / labelsPerPage)) : totalLabels

  function handlePrint() {
    if (totalLabels === 0) return
    if (totalLabels > MAX_TOTAL_LABELS) {
      setError(`الحد الأقصى ${MAX_TOTAL_LABELS} ملصق في الطلبة الواحدة — قسّم الطباعة لدفعات أصغر`)
      return
    }
    if (totalLabels > CONFIRM_THRESHOLD) {
      if (!window.confirm(`سيتم طباعة ${totalLabels} ملصق. هل تريد المتابعة؟`)) return
    }
    window.print()
  }

  return (
    <div className={`barcode-labels-page barcode-page-size-${labelSize}`}>
      <div className="barcode-labels-builder">
        <div className="admin-form-card">
          <label>ابحث بالاسم / الباركود / SKU / القسم / الماركة
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="اكتب حرفين على الأقل..." />
          </label>
          {searching && <div className="barcode-hint">جاري البحث...</div>}
        </div>

        {results.length > 0 && (
          <div className="admin-form-card barcode-search-results">
            {results.map(product => (
              <div key={product.id} className="barcode-search-product">
                <div className="barcode-search-product-head">
                  <span>{product.emoji} {product.name}</span>
                  <span className="barcode-hint">{product.categoryName}{product.brand ? ` · ${product.brand}` : ''}</span>
                </div>

                {product.variants.length === 0 ? (
                  <div className="barcode-search-row">
                    <span>{formatMoney(product.price)}</span>
                    <span className="barcode-search-code">{product.barcode || '—'}</span>
                    {product.barcode ? (
                      <button className="barcode-btn-secondary" onClick={() => addToQueue({
                        targetType: 'product', targetId: product.id, productName: product.name,
                        variantName: null, barcode: product.barcode, sku: product.sku, price: product.price
                      })}>إضافة للطباعة</button>
                    ) : (
                      <button
                        className="barcode-btn-secondary"
                        disabled={generatingKey === `product:${product.id}`}
                        onClick={() => generateBarcode('product', product.id)}
                      >
                        {generatingKey === `product:${product.id}` ? 'جاري التوليد...' : 'إنشاء باركود'}
                      </button>
                    )}
                    <button className="barcode-btn-secondary" onClick={() => addWithStockQuantity({
                      targetType: 'product', targetId: product.id, productName: product.name,
                      variantName: null, barcode: product.barcode, sku: product.sku, price: product.price
                    }, product.stock)} disabled={!product.barcode}>حسب المخزون ({product.stock})</button>
                  </div>
                ) : (
                  product.variants.map(variant => (
                    <div key={variant.id} className="barcode-search-row">
                      <span>{variant.name}</span>
                      <span>{formatMoney(variant.price)}</span>
                      <span className="barcode-search-code">{variant.barcode || '—'}</span>
                      {variant.barcode ? (
                        <button className="barcode-btn-secondary" onClick={() => addToQueue({
                          targetType: 'variant', targetId: variant.id, productName: product.name,
                          variantName: variant.name, barcode: variant.barcode, sku: variant.sku, price: variant.price
                        })}>إضافة للطباعة</button>
                      ) : (
                        <button
                          className="barcode-btn-secondary"
                          disabled={generatingKey === `variant:${variant.id}`}
                          onClick={() => generateBarcode('variant', variant.id)}
                        >
                          {generatingKey === `variant:${variant.id}` ? 'جاري التوليد...' : 'إنشاء باركود'}
                        </button>
                      )}
                      <button className="barcode-btn-secondary" onClick={() => addWithStockQuantity({
                        targetType: 'variant', targetId: variant.id, productName: product.name,
                        variantName: variant.name, barcode: variant.barcode, sku: variant.sku, price: variant.price
                      }, variant.stock)} disabled={!variant.barcode}>حسب المخزون ({variant.stock})</button>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        )}

        <div className="admin-form-card">
          <div className="admin-form-card-title">إعدادات الملصق</div>
          <label>مقاس الملصق
            <select value={labelSize} onChange={e => setLabelSize(e.target.value as keyof typeof LABEL_SIZES)}>
              {Object.entries(LABEL_SIZES).map(([key, p]) => <option key={key} value={key}>{p.label}</option>)}
            </select>
          </label>
          <div className="barcode-fields-toggles">
            <label><input type="checkbox" checked={fields.storeName} onChange={e => setFields(f => ({ ...f, storeName: e.target.checked }))} /> اسم المتجر</label>
            <label><input type="checkbox" checked={fields.productName} onChange={e => setFields(f => ({ ...f, productName: e.target.checked }))} /> اسم المنتج</label>
            <label><input type="checkbox" checked={fields.variantName} onChange={e => setFields(f => ({ ...f, variantName: e.target.checked }))} /> اسم المتغيّر</label>
            <label><input type="checkbox" checked={fields.price} onChange={e => setFields(f => ({ ...f, price: e.target.checked }))} /> السعر</label>
            <label><input type="checkbox" checked={fields.sku} onChange={e => setFields(f => ({ ...f, sku: e.target.checked }))} /> SKU</label>
            <label><input type="checkbox" checked={fields.humanReadableCode} onChange={e => setFields(f => ({ ...f, humanReadableCode: e.target.checked }))} /> الرقم أسفل الباركود</label>
          </div>
        </div>

        <div className="admin-form-card">
          <div className="admin-form-card-title">قائمة الطباعة ({totalLabels} ملصق{preset.isA4 ? ` — ${totalPages} صفحة` : ''})</div>
          {error && <div className="admin-form-error">{error}</div>}
          {queue.length === 0 && <div className="barcode-hint">مفيش ملصقات في القائمة لسه.</div>}
          {queue.map((item, index) => (
            <div key={item.key} className="barcode-queue-row">
              <span className="barcode-queue-name">{item.productName}{item.variantName ? ` — ${item.variantName}` : ''}</span>
              <span className="barcode-search-code">{item.barcode}</span>
              <input
                type="number" min={1} value={item.quantity}
                onChange={e => updateQuantity(item.key, Number(e.target.value))}
                className="barcode-queue-qty"
              />
              <button className="barcode-btn-icon" onClick={() => moveItem(item.key, -1)} disabled={index === 0} aria-label="نقل لأعلى">↑</button>
              <button className="barcode-btn-icon" onClick={() => moveItem(item.key, 1)} disabled={index === queue.length - 1} aria-label="نقل لأسفل">↓</button>
              <button className="barcode-btn-icon" onClick={() => removeFromQueue(item.key)} aria-label="حذف">✕</button>
            </div>
          ))}
          <button className="admin-action-button" onClick={handlePrint} disabled={totalLabels === 0}>معاينة وطباعة</button>
        </div>
      </div>

      <div className={`barcode-print-sheet barcode-print-sheet-${preset.isA4 ? 'a4' : 'single'}`}>
        {queue.flatMap(item => Array.from({ length: item.quantity }, (_, i) => (
          <div
            key={`${item.key}-${i}`}
            className="barcode-label"
            style={{ width: `${preset.widthMm}mm`, height: `${preset.heightMm}mm` }}
          >
            {fields.storeName && <div className="barcode-label-store">علاء الدين</div>}
            {fields.productName && <div className="barcode-label-product">{item.productName}</div>}
            {fields.variantName && item.variantName && <div className="barcode-label-variant">{item.variantName}</div>}
            {fields.price && <div className="barcode-label-price">{formatMoney(item.price)}</div>}
            {fields.sku && item.sku && <div className="barcode-label-sku">SKU: {item.sku}</div>}
            <BarcodeGraphic value={item.barcode} showHumanReadableCode={fields.humanReadableCode} />
          </div>
        )))}
      </div>
    </div>
  )
}
