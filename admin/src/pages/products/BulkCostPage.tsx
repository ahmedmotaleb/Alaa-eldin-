import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import {
  api, ApiError,
  type AdminCategory, type CostPreviewRow, type CostPreviewSummary, type ApplyResult, type CostConfirmRowInput
} from '../../utils/api'
import { formatCurrency } from '../../utils/format'
import type { LayoutContext } from '../../components/AdminLayout'

const TEMPLATE_VERSION = '1'

const STATUS_LABEL: Record<CostPreviewRow['status'], string> = {
  ready: 'جاهز', no_change: 'بدون تغيير', warning: 'تحذير', error: 'خطأ'
}
const STATUS_COLOR: Record<CostPreviewRow['status'], string> = {
  ready: '#16A34A', no_change: '#8A948C', warning: '#B45309', error: '#B42318'
}

function rowToRecord(row: CostPreviewRow): Record<string, string | undefined> {
  return {
    template_version: TEMPLATE_VERSION,
    product_id: row.productId,
    variant_id: row.variantId ?? '',
    new_cost: String(row.newCost)
  }
}

export function BulkCostPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [filterCategoryId, setFilterCategoryId] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterSearch, setFilterSearch] = useState('')
  const [templateError, setTemplateError] = useState('')

  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<CostPreviewRow[] | null>(null)
  const [summary, setSummary] = useState<CostPreviewSummary | null>(null)
  const [selected, setSelected] = useState<Record<number, boolean>>({})
  const [previewLoading, setPreviewLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: 'تحديث التكلفة بالجملة' })
  }, [setHeader])

  useEffect(() => {
    api.listCategories().then(({ categories }) => setCategories(categories)).catch(() => {})
  }, [])

  async function downloadTemplate() {
    setTemplateError('')
    try {
      await api.downloadBulkCostTemplate({
        categoryId: filterCategoryId || undefined, brand: filterBrand.trim() || undefined, search: filterSearch.trim() || undefined
      })
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
      const { rows, summary } = await api.previewBulkCostCsv(file)
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
    if (!window.confirm(`سيتم تحديث تكلفة ${chosen.length} صف فعلياً على قاعدة البيانات. هل تريد المتابعة؟`)) return

    setConfirming(true)
    setError('')
    try {
      const payload: CostConfirmRowInput[] = chosen.map(r => ({ rowNumber: r.rowNumber, record: rowToRecord(r) }))
      const applyResult = await api.confirmBulkCost(payload)
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
      await api.downloadBulkCostResultReport(result.rows)
    } catch {
      setError('تعذر تنزيل تقرير النتيجة')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="admin-table-card">
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="admin-form-card-title">تنزيل قالب التكلفة</div>
          <p className="admin-form-help">
            أداة مستقلة لتحديث تكلفة الشراء فقط (بدون لمس سعر البيع للعميل) — عدّل بس عمود new_cost، واترك السعر كما هو.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={filterCategoryId} onChange={e => setFilterCategoryId(e.target.value)}>
              <option value="">كل الأقسام</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input placeholder="علامة تجارية" value={filterBrand} onChange={e => setFilterBrand(e.target.value)} style={{ width: 140 }} />
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

        {result && (
          <div className="admin-form-success" style={{ margin: '0 16px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>تم تحديث {result.updated} صف — تخطي {result.skipped} — فشل {result.failed}</span>
            <button className="admin-form-chip" onClick={downloadCsvReport}>تنزيل تقرير النتيجة</button>
          </div>
        )}

        {rows && summary && (
          <>
            <div style={{ padding: '0 16px 12px', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <span>الإجمالي: {summary.totalRows}</span>
              <span style={{ color: '#16A34A' }}>جاهز: {summary.ready}</span>
              <span style={{ color: '#B45309' }}>تحذير: {summary.warnings}</span>
              <span style={{ color: '#B42318' }}>خطأ: {summary.errors}</span>
              <span style={{ color: '#8A948C' }}>بدون تغيير: {summary.noChange}</span>
              <span>زيادة: {summary.increases} · خفض: {summary.decreases}</span>
            </div>
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
                  <div></div><div>الصف</div><div>الاسم / SKU</div><div>سعر البيع</div><div>التكلفة الحالية</div>
                  <div>التكلفة الجديدة</div><div>الحالة</div><div>ملاحظات</div>
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
                    <div className="admin-cell-plain">{formatCurrency(row.currentPrice)}</div>
                    <div className="admin-cell-plain">{formatCurrency(row.currentCost)}</div>
                    <div className="admin-cell-plain" style={{ fontWeight: row.costChanged ? 700 : 400 }}>{formatCurrency(row.newCost)}</div>
                    <div className="admin-cell-plain" style={{ fontWeight: 700, color: STATUS_COLOR[row.status] }}>{STATUS_LABEL[row.status]}</div>
                    <div className="admin-cell-plain" style={{ fontSize: 12.5, color: '#68746B' }}>{[...row.errors, ...row.warnings].join(' — ')}</div>
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
