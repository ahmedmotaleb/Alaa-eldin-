import { useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, ApiError, type ImportRowPreview, type ImportConfirmRow } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

const ACTION_LABEL: Record<ImportRowPreview['action'], string> = {
  create: 'إنشاء جديد',
  update: 'تحديث',
  invalid: 'غير صالح'
}

export function ProductImportPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<ImportRowPreview[] | null>(null)
  const [selected, setSelected] = useState<Record<number, boolean>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ created: number, updated: number, failed: { rowNumber: number, reason: string }[] } | null>(null)

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: 'استيراد متقدّم من CSV' })
  }, [setHeader])

  async function handleFile(file: File) {
    setFileName(file.name)
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const { rows } = await api.previewProductsCsvImport(file)
      setPreview(rows)
      const initialSelection: Record<number, boolean> = {}
      for (const row of rows) if (row.action !== 'invalid') initialSelection[row.rowNumber] = true
      setSelected(initialSelection)
    } catch (err) {
      setError(err instanceof ApiError ? 'تعذر قراءة الملف أو معاينته' : 'حدث خطأ، حاول مرة أخرى')
    } finally {
      setLoading(false)
    }
  }

  async function confirmImport() {
    if (!preview) return
    const chosen = preview.filter(r => r.action !== 'invalid' && selected[r.rowNumber])
    if (chosen.length === 0) { setError('اختر صف واحد صالح على الأقل'); return }

    setImporting(true)
    setError('')
    try {
      const rows: ImportConfirmRow[] = chosen.map(r => ({
        rowNumber: r.rowNumber,
        action: r.action as 'create' | 'update',
        productId: r.productId,
        data: r.data
      }))
      const summary = await api.confirmProductsCsvImport(rows)
      setResult(summary)
      setPreview(null)
      setFileName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch {
      setError('تعذر تنفيذ الاستيراد')
    } finally {
      setImporting(false)
    }
  }

  const creatableCount = preview?.filter(r => r.action === 'create').length ?? 0
  const updatableCount = preview?.filter(r => r.action === 'update').length ?? 0
  const invalidCount = preview?.filter(r => r.action === 'invalid').length ?? 0
  const selectedCount = preview ? preview.filter(r => r.action !== 'invalid' && selected[r.rowNumber]).length : 0

  return (
    <div className="admin-table-card">
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p className="admin-form-help">
          يدعم هذا الاستيراد إنشاء منتجات جديدة فعلاً (وليس بس تحديث الموجود) — كل صف بيتفحص لوحده،
          وتقدر تراجع نتيجة الفحص قبل ما أي حاجة تتنفذ فعلياً على قاعدة البيانات.
          الأعمدة المطلوبة لإنشاء منتج جديد: name, categoryId, slug, unit, price
          (بالإضافة لـ sku/barcode/description/oldPrice/cost/stock/alertThreshold/available/brand الاختيارية).
          صف بيه id أو sku مطابق لمنتج موجود بيتحول تلقائياً لتحديث (نفس حقول الاستيراد السريع الحالي).
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="admin-form-chip" onClick={() => fileInputRef.current?.click()} disabled={loading}>
            {loading ? 'جاري القراءة...' : 'اختر ملف CSV'}
          </button>
          <input
            ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
          {fileName && <span className="admin-form-help">{fileName}</span>}
        </div>

        {error && <div className="admin-form-error">{error}</div>}
        {result && (
          <div className="admin-form-success">
            تم إنشاء {result.created} منتج وتحديث {result.updated} منتج
            {result.failed.length > 0 && ` — فشل ${result.failed.length} صف: ${result.failed.map(f => `صف ${f.rowNumber} (${f.reason})`).join('، ')}`}
          </div>
        )}
      </div>

      {preview && (
        <>
          <div style={{ padding: '0 16px 12px', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>الإجمالي: {preview.length}</span>
            <span style={{ color: '#16A34A' }}>سيُنشأ: {creatableCount}</span>
            <span style={{ color: '#2563EB' }}>سيُحدَّث: {updatableCount}</span>
            <span style={{ color: '#B42318' }}>غير صالح: {invalidCount}</span>
            <button className="admin-form-save" disabled={importing || selectedCount === 0} onClick={confirmImport}>
              {importing ? 'جاري التنفيذ...' : `تأكيد استيراد ${selectedCount} صف`}
            </button>
          </div>
          <div className="admin-table-scroll">
            <div style={{ minWidth: 900 }}>
              <div className="admin-table-head" style={{ gridTemplateColumns: '40px .6fr 1.4fr 2fr' }}>
                <div></div><div>الصف</div><div>الإجراء</div><div>التفاصيل / الأخطاء</div>
              </div>
              {preview.map(row => (
                <div key={row.rowNumber} className="admin-table-row" style={{ gridTemplateColumns: '40px .6fr 1.4fr 2fr' }}>
                  <div>
                    <input
                      type="checkbox"
                      disabled={row.action === 'invalid'}
                      checked={!!selected[row.rowNumber]}
                      onChange={e => setSelected(current => ({ ...current, [row.rowNumber]: e.target.checked }))}
                    />
                  </div>
                  <div className="admin-cell-plain">{row.rowNumber}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 700, color: row.action === 'invalid' ? '#B42318' : row.action === 'create' ? '#16A34A' : '#2563EB' }}>
                    {ACTION_LABEL[row.action]}
                  </div>
                  <div className="admin-cell-plain" style={{ color: '#68746B', fontSize: 12.5 }}>
                    {row.errors.length > 0
                      ? row.errors.join(' — ')
                      : (row.data.name ?? row.productId ?? '') + (row.data.price !== undefined ? ` · ${row.data.price} ج.م` : '')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
