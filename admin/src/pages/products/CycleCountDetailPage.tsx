import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type CycleCountDetail } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

export function CycleCountDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [detail, setDetail] = useState<CycleCountDetail | null>(null)
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function load() {
    if (!id) return
    api.getCycleCount(id)
      .then(({ cycleCount }) => {
        setDetail(cycleCount)
        setCounts(Object.fromEntries(cycleCount.items.map(i => [i.productId, i.countedQuantity === null ? '' : String(i.countedQuantity)])))
      })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل الجرد' : 'حدث خطأ، حاول مرة أخرى'))
  }

  useEffect(() => {
    setHeader({ crumb: 'الجرد الدوري', title: 'تفاصيل الجرد' })
  }, [setHeader])

  useEffect(load, [id])

  async function saveCounts() {
    if (!id) return
    setBusy(true)
    setNotice('')
    try {
      const entries = Object.entries(counts).filter(([, v]) => v.trim() !== '').map(([productId, v]) => ({ productId, countedQuantity: Number(v) }))
      await api.recordCycleCountCounts(id, entries)
      setNotice('تم حفظ الكميات المعدودة')
      load()
    } catch {
      setError('تعذر حفظ الكميات')
    } finally {
      setBusy(false)
    }
  }

  async function complete() {
    if (!id) return
    setBusy(true)
    try {
      const { adjustedCount } = await api.completeCycleCount(id)
      setNotice(`تم إكمال الجرد — ${adjustedCount} صنف اتعدّل مخزونه`)
      load()
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'not_draft' ? 'الجرد ده مش قيد التنفيذ' : 'تعذر إكمال الجرد')
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (!id) return
    setBusy(true)
    try {
      await api.cancelCycleCount(id)
      setNotice('تم إلغاء الجرد')
      load()
    } catch {
      setError('تعذر إلغاء الجرد')
    } finally {
      setBusy(false)
    }
  }

  async function exportCsv() {
    if (!id) return
    try {
      await api.exportCycleCountCsv(id)
    } catch {
      setError('تعذر تصدير الملف')
    }
  }

  async function importCsv(file: File) {
    if (!id) return
    setBusy(true)
    try {
      const result = await api.importCycleCountCsv(id, file)
      setNotice(`تم استيراد ${result.updated} صنف${result.unmatched.length ? ` — ${result.unmatched.length} صنف مش متطابق` : ''}`)
      load()
    } catch {
      setError('تعذر استيراد الملف')
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (error && !detail) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!detail) return null

  const isDraft = detail.status === 'draft'

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">{detail.categoryName ?? 'كل المنتجات'}</div>
          <div className="admin-form-card-sub">{detail.note || 'بدون ملاحظة'} — الحالة: {detail.status === 'draft' ? 'جاري' : detail.status === 'completed' ? 'مكتمل' : 'ملغي'}</div>
        </div>

        {notice && <div className="admin-form-success">{notice}</div>}
        {error && <div className="admin-form-error">{error}</div>}

        {isDraft && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="admin-form-chip" onClick={exportCsv}>تصدير ورقة العد (CSV)</button>
            <button className="admin-form-chip" onClick={() => fileInputRef.current?.click()}>استيراد كميات معدودة (CSV)</button>
            <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) importCsv(f) }} />
          </div>
        )}

        <div className="admin-table-card">
          <div className="admin-table-scroll">
            <div style={{ minWidth: 560 }}>
              <div className="admin-table-head" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                <div>المنتج</div><div>مخزون النظام</div><div>الكمية المعدودة</div><div>الفرق</div>
              </div>
              {detail.items.map(item => {
                const variance = item.variance
                return (
                  <div key={item.id} className="admin-table-row" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                    <div className="admin-cell-plain">{item.productName}</div>
                    <div className="admin-cell-plain">{item.systemQuantity}</div>
                    <div>
                      {isDraft ? (
                        <input
                          type="number"
                          value={counts[item.productId] ?? ''}
                          onChange={e => setCounts(c => ({ ...c, [item.productId]: e.target.value }))}
                          style={{ width: 90 }}
                        />
                      ) : (item.countedQuantity ?? '—')}
                    </div>
                    <div className="admin-cell-plain" style={{ color: variance ? (variance > 0 ? '#12813C' : '#B42318') : '#8A948C' }}>
                      {variance === null ? '—' : variance > 0 ? `+${variance}` : variance}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {isDraft && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="admin-form-save" disabled={busy} onClick={saveCounts}>حفظ الكميات</button>
            <button className="admin-form-save" disabled={busy} onClick={complete}>إكمال الجرد وتسوية الفروقات</button>
            <button className="admin-form-chip" disabled={busy} onClick={cancel}>إلغاء الجرد</button>
          </div>
        )}
        <button className="admin-form-chip" onClick={() => navigate('/products/cyclecounts')}>رجوع للقائمة</button>
      </div>
    </div>
  )
}
