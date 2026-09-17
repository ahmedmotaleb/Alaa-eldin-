import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import {
  api, ApiError,
  type AdminCategory, type StockPreviewRow, type StockPreviewSummary, type ApplyResult,
  type StockAdjustmentOperation, type ManualStockReason, type StockConfirmRowInput
} from '../../utils/api'
import { formatQuantity } from '../../utils/format'
import type { LayoutContext } from '../../components/AdminLayout'

const TEMPLATE_VERSION = '1'

const STATUS_LABEL: Record<StockPreviewRow['status'], string> = {
  ready: 'جاهز', no_change: 'بدون تغيير', warning: 'تحذير', error: 'خطأ'
}
const STATUS_COLOR: Record<StockPreviewRow['status'], string> = {
  ready: '#16A34A', no_change: '#8A948C', warning: '#B45309', error: '#B42318'
}
const REASON_LABEL: Record<ManualStockReason, string> = {
  restock: 'إعادة تخزين', return: 'مرتجع', damage: 'تلف', loss: 'فقد', adjustment: 'تسوية جرد'
}
const REASONS = Object.keys(REASON_LABEL) as ManualStockReason[]

const ADJUSTMENT_LABEL: Record<StockAdjustmentOperation, string> = {
  set_to: 'تحديد كمية ثابتة', increase_by: 'زيادة بكمية ثابتة', decrease_by: 'خفض بكمية ثابتة'
}

function rowToRecord(row: StockPreviewRow): Record<string, string | undefined> {
  return {
    template_version: TEMPLATE_VERSION,
    product_id: row.productId,
    variant_id: row.variantId ?? '',
    new_stock: String(row.newStock),
    reason: row.reason ?? ''
  }
}

function SummaryBar({ summary }: { summary: StockPreviewSummary }) {
  return (
    <div style={{ padding: '0 16px 12px', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
      <span>الإجمالي: {summary.totalRows}</span>
      <span style={{ color: '#16A34A' }}>جاهز: {summary.ready}</span>
      <span style={{ color: '#B45309' }}>تحذير: {summary.warnings}</span>
      <span style={{ color: '#B42318' }}>خطأ: {summary.errors}</span>
      <span style={{ color: '#8A948C' }}>بدون تغيير: {summary.noChange}</span>
      <span>زيادة: {summary.increases} · نقص: {summary.decreases}</span>
    </div>
  )
}

function ResultBanner({ result, onDownloadReport }: { result: ApplyResult, onDownloadReport: () => void }) {
  return (
    <div className="admin-form-success" style={{ margin: '0 16px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span>تم تحديث {result.updated} صف — تخطي {result.skipped} — فشل {result.failed}</span>
      <button className="admin-form-chip" onClick={onDownloadReport}>تنزيل تقرير النتيجة</button>
    </div>
  )
}

export function BulkStockPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [filterCategoryId, setFilterCategoryId] = useState('')
  const [filterSearch, setFilterSearch] = useState('')
  const [templateError, setTemplateError] = useState('')

  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<StockPreviewRow[] | null>(null)
  const [summary, setSummary] = useState<StockPreviewSummary | null>(null)
  const [selected, setSelected] = useState<Record<number, boolean>>({})
  const [previewLoading, setPreviewLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)
  const [error, setError] = useState('')

  const [adjScope, setAdjScope] = useState<'selected' | 'category' | 'catalog'>('selected')
  const [adjCategoryId, setAdjCategoryId] = useState('')
  const [adjOperation, setAdjOperation] = useState<StockAdjustmentOperation>('increase_by')
  const [adjValue, setAdjValue] = useState(0)
  const [adjReason, setAdjReason] = useState<ManualStockReason>('restock')
  const [adjRows, setAdjRows] = useState<StockPreviewRow[] | null>(null)
  const [adjSummary, setAdjSummary] = useState<StockPreviewSummary | null>(null)
  const [adjSelected, setAdjSelected] = useState<Record<string, boolean>>({})
  const [adjPreviewLoading, setAdjPreviewLoading] = useState(false)
  const [adjConfirming, setAdjConfirming] = useState(false)
  const [adjResult, setAdjResult] = useState<ApplyResult | null>(null)
  const [adjError, setAdjError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: 'تحديث المخزون بالجملة' })
  }, [setHeader])

  useEffect(() => {
    api.listCategories().then(({ categories }) => setCategories(categories)).catch(() => {})
  }, [])

  async function downloadTemplate() {
    setTemplateError('')
    try {
      await api.downloadBulkStockTemplate({ categoryId: filterCategoryId || undefined, search: filterSearch.trim() || undefined })
    } catch {
      setTemplateError('تعذر تنزيل القالب')
    }
  }

  async function handleFile(file: File) {
    setFileName(file.name)
    setError('')
    setResult(null)
    setPreviewLoading(true)
    try {
      const { rows, summary } = await api.previewBulkStockCsv(file)
      setRows(rows)
      setSummary(summary)
      const initial: Record<number, boolean> = {}
      for (const row of rows) if (row.status === 'ready' || row.status === 'warning') initial[row.rowNumber] = true
      setSelected(initial)
    } catch (err) {
      setError(err instanceof ApiError ? 'تعذر قراءة الملف أو معاينته' : 'حدث خطأ، حاول مرة أخرى')
      setRows(null)
      setSummary(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  function selectAll(value: boolean) {
    if (!rows) return
    const next: Record<number, boolean> = {}
    if (value) for (const row of rows) if (row.status === 'ready' || row.status === 'warning') next[row.rowNumber] = true
    setSelected(next)
  }

  const selectedCount = rows ? rows.filter(r => selected[r.rowNumber]).length : 0

  async function confirmCsvUpdate() {
    if (!rows) return
    const chosen = rows.filter(r => selected[r.rowNumber])
    if (chosen.length === 0) { setError('اختر صف واحد صالح على الأقل'); return }
    if (!window.confirm(`سيتم تحديث مخزون ${chosen.length} صف فعلياً على قاعدة البيانات. هل تريد المتابعة؟`)) return

    setConfirming(true)
    setError('')
    try {
      const payload: StockConfirmRowInput[] = chosen.map(r => ({ rowNumber: r.rowNumber, record: rowToRecord(r) }))
      const applyResult = await api.confirmBulkStock(payload)
      setResult(applyResult)
      setRows(null)
      setSummary(null)
      setFileName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch {
      setError('تعذر تنفيذ التحديث')
    } finally {
      setConfirming(false)
    }
  }

  async function downloadCsvReport() {
    if (!result) return
    try {
      await api.downloadBulkStockResultReport(result.rows)
    } catch {
      setError('تعذر تنزيل تقرير النتيجة')
    }
  }

  async function previewAdjustmentRows() {
    setAdjError('')
    setAdjResult(null)
    if (adjValue <= 0 || !Number.isInteger(adjValue)) { setAdjError('القيمة يجب أن تكون رقم صحيح أكبر من صفر'); return }

    const scope = adjScope === 'selected'
      ? { productIds: rows ? [...new Set(rows.filter(r => selected[r.rowNumber]).map(r => r.productId))] : [] }
      : adjScope === 'category'
        ? { categoryId: adjCategoryId || undefined }
        : { allCatalog: true }

    if (adjScope === 'selected' && (!scope.productIds || scope.productIds.length === 0)) {
      setAdjError('اختر منتجات من جدول المعاينة أعلاه أولاً (ارفع ملف وحدد صفوف)')
      return
    }
    if (adjScope === 'category' && !scope.categoryId) { setAdjError('اختر قسم'); return }

    setAdjPreviewLoading(true)
    try {
      const { rows: previewRows, summary } = await api.previewBulkStockAdjustment({ scope, operation: adjOperation, value: adjValue, reason: adjReason })
      setAdjRows(previewRows)
      setAdjSummary(summary)
      const initial: Record<string, boolean> = {}
      for (const row of previewRows) if (row.status === 'ready' || row.status === 'warning') initial[row.productId] = true
      setAdjSelected(initial)
    } catch {
      setAdjError('تعذر تحضير المعاينة')
    } finally {
      setAdjPreviewLoading(false)
    }
  }

  async function confirmAdjustmentUpdate() {
    if (!adjRows) return
    const selectedProductIds = adjRows.filter(r => adjSelected[r.productId]).map(r => r.productId)
    if (selectedProductIds.length === 0) { setAdjError('اختر منتج واحد على الأقل'); return }
    if (!window.confirm(`سيتم تعديل مخزون ${selectedProductIds.length} منتج فعلياً على قاعدة البيانات. هل تريد المتابعة؟`)) return

    const scope = adjScope === 'selected'
      ? { productIds: selectedProductIds }
      : adjScope === 'category'
        ? { categoryId: adjCategoryId || undefined }
        : { allCatalog: true }

    setAdjConfirming(true)
    setAdjError('')
    try {
      const applyResult = await api.confirmBulkStockAdjustment({ scope, operation: adjOperation, value: adjValue, reason: adjReason }, selectedProductIds)
      setAdjResult(applyResult)
      setAdjRows(null)
      setAdjSummary(null)
    } catch {
      setAdjError('تعذر تنفيذ التعديل')
    } finally {
      setAdjConfirming(false)
    }
  }

  async function downloadAdjustmentReport() {
    if (!adjResult) return
    try {
      await api.downloadBulkStockResultReport(adjResult.rows)
    } catch {
      setAdjError('تعذر تنزيل تقرير النتيجة')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="admin-table-card">
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="admin-form-card-title">تنزيل قالب المخزون</div>
          <p className="admin-form-help">
            عدّل بس عمود new_stock (الكمية النهائية المطلوبة) وreason (سبب التعديل) — اترك new_stock فاضي للإبقاء على المخزون الحالي.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={filterCategoryId} onChange={e => setFilterCategoryId(e.target.value)}>
              <option value="">كل الأقسام</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input placeholder="بحث بالاسم/SKU/الباركود" value={filterSearch} onChange={e => setFilterSearch(e.target.value)} style={{ width: 180 }} />
            <button className="admin-form-save" onClick={downloadTemplate}>تنزيل القالب</button>
          </div>
          {templateError && <div className="admin-form-error">{templateError}</div>}
        </div>
      </div>

      <div className="admin-table-card">
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="admin-form-card-title">رفع ملف بعد التعديل</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="admin-form-chip" onClick={() => fileInputRef.current?.click()} disabled={previewLoading}>
              {previewLoading ? 'جاري القراءة...' : 'اختر ملف CSV'}
            </button>
            <input
              ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            {fileName && <span className="admin-form-help">{fileName}</span>}
          </div>
          {error && <div className="admin-form-error">{error}</div>}
        </div>

        {result && <ResultBanner result={result} onDownloadReport={downloadCsvReport} />}

        {rows && summary && (
          <>
            <SummaryBar summary={summary} />
            <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="admin-form-chip" onClick={() => selectAll(true)}>تحديد الكل</button>
              <button className="admin-form-chip" onClick={() => selectAll(false)}>إلغاء تحديد الكل</button>
              <button className="admin-form-save" disabled={confirming || selectedCount === 0} onClick={confirmCsvUpdate}>
                {confirming ? 'جاري التنفيذ...' : `تأكيد تحديث ${selectedCount} صف`}
              </button>
            </div>
            <div className="admin-table-scroll">
              <div style={{ minWidth: 1000 }}>
                <div className="admin-table-head" style={{ gridTemplateColumns: '40px .5fr 1.6fr .8fr .8fr .9fr .9fr 2fr' }}>
                  <div></div><div>الصف</div><div>الاسم / SKU</div><div>الحالي</div><div>الجديد</div>
                  <div>الفرق</div><div>الحالة</div><div>ملاحظات</div>
                </div>
                {rows.map(row => (
                  <div key={row.rowNumber} className="admin-table-row" style={{ gridTemplateColumns: '40px .5fr 1.6fr .8fr .8fr .9fr .9fr 2fr' }}>
                    <div>
                      <input
                        type="checkbox"
                        disabled={row.status === 'error' || row.status === 'no_change'}
                        checked={!!selected[row.rowNumber]}
                        onChange={e => setSelected(cur => ({ ...cur, [row.rowNumber]: e.target.checked }))}
                      />
                    </div>
                    <div className="admin-cell-plain">{row.rowNumber}</div>
                    <div className="admin-cell-plain">
                      <div style={{ fontWeight: 700 }}>{row.productName}{row.variantName ? ` — ${row.variantName}` : ''}</div>
                      <div style={{ fontSize: 12, color: '#8A948C' }}>{row.sku ?? row.barcode ?? ''}</div>
                    </div>
                    <div className="admin-cell-plain">{formatQuantity(row.currentStock)}</div>
                    <div className="admin-cell-plain" style={{ fontWeight: row.quantityChange !== 0 ? 700 : 400 }}>{formatQuantity(row.newStock)}</div>
                    <div className="admin-cell-plain">{row.quantityChange > 0 ? `+${formatQuantity(row.quantityChange)}` : formatQuantity(row.quantityChange)}</div>
                    <div className="admin-cell-plain" style={{ fontWeight: 700, color: STATUS_COLOR[row.status] }}>{STATUS_LABEL[row.status]}</div>
                    <div className="admin-cell-plain" style={{ fontSize: 12.5, color: '#68746B' }}>{[...row.errors, ...row.warnings].join(' — ')}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="admin-table-card">
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="admin-form-card-title">تعديل سريع (كمية ثابتة)</div>
          <p className="admin-form-help">تعديل جماعي على نطاق منتجات — بدون متغيرات في هذا الإصدار. لازم معاينة قبل أي تنفيذ فعلي.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className={`admin-form-chip ${adjScope === 'selected' ? 'active' : ''}`} onClick={() => setAdjScope('selected')}>المنتجات المحددة أعلاه</button>
            <button className={`admin-form-chip ${adjScope === 'category' ? 'active' : ''}`} onClick={() => setAdjScope('category')}>قسم كامل</button>
            <button className={`admin-form-chip ${adjScope === 'catalog' ? 'active' : ''}`} onClick={() => setAdjScope('catalog')}>كل الكتالوج</button>
          </div>
          {adjScope === 'category' && (
            <select value={adjCategoryId} onChange={e => setAdjCategoryId(e.target.value)}>
              <option value="">اختر قسم</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={adjOperation} onChange={e => setAdjOperation(e.target.value as StockAdjustmentOperation)}>
              {(Object.keys(ADJUSTMENT_LABEL) as StockAdjustmentOperation[]).map(op => <option key={op} value={op}>{ADJUSTMENT_LABEL[op]}</option>)}
            </select>
            <input type="number" min={0} step={1} value={adjValue} onChange={e => setAdjValue(Math.round(Number(e.target.value)))} style={{ width: 100 }} />
            <select value={adjReason} onChange={e => setAdjReason(e.target.value as ManualStockReason)}>
              {REASONS.map(r => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </select>
            <button className="admin-form-chip" disabled={adjPreviewLoading} onClick={previewAdjustmentRows}>
              {adjPreviewLoading ? 'جاري التحضير...' : 'معاينة'}
            </button>
          </div>
          {adjError && <div className="admin-form-error">{adjError}</div>}
        </div>

        {adjResult && <ResultBanner result={adjResult} onDownloadReport={downloadAdjustmentReport} />}

        {adjRows && adjSummary && (
          <>
            <SummaryBar summary={adjSummary} />
            <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="admin-form-save" disabled={adjConfirming || Object.values(adjSelected).every(v => !v)} onClick={confirmAdjustmentUpdate}>
                {adjConfirming ? 'جاري التنفيذ...' : 'تأكيد التعديل'}
              </button>
            </div>
            <div className="admin-table-scroll">
              <div style={{ minWidth: 900 }}>
                <div className="admin-table-head" style={{ gridTemplateColumns: '40px 1.6fr .8fr .8fr .9fr' }}>
                  <div></div><div>المنتج</div><div>الحالي</div><div>الجديد</div><div>الحالة</div>
                </div>
                {adjRows.map(row => (
                  <div key={row.productId} className="admin-table-row" style={{ gridTemplateColumns: '40px 1.6fr .8fr .8fr .9fr' }}>
                    <div>
                      <input
                        type="checkbox"
                        disabled={row.status === 'error' || row.status === 'no_change'}
                        checked={!!adjSelected[row.productId]}
                        onChange={e => setAdjSelected(cur => ({ ...cur, [row.productId]: e.target.checked }))}
                      />
                    </div>
                    <div className="admin-cell-plain">{row.productName}</div>
                    <div className="admin-cell-plain">{formatQuantity(row.currentStock)}</div>
                    <div className="admin-cell-plain">{formatQuantity(row.newStock)}</div>
                    <div className="admin-cell-plain" style={{ fontWeight: 700, color: STATUS_COLOR[row.status] }}>{STATUS_LABEL[row.status]}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <button className="admin-form-chip" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/products/bulk-operations')}>
        عرض سجل العمليات الجماعية والتراجع عنها ←
      </button>
    </div>
  )
}
