import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminCategory, type CycleCountSummary, type CycleCountStatus } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '1.4fr 1fr 1fr 1fr 1fr'

const STATUS_LABEL: Record<CycleCountStatus, string> = { draft: 'جاري', completed: 'مكتمل', cancelled: 'ملغي' }
const STATUS_TINT: Record<CycleCountStatus, { bg: string, fg: string }> = {
  draft: { bg: '#FFF3E3', fg: '#B4740E' },
  completed: { bg: '#EAF8EF', fg: '#12813C' },
  cancelled: { bg: '#FFF0EF', fg: '#B42318' }
}

export function CycleCountsListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [cycleCounts, setCycleCounts] = useState<CycleCountSummary[] | null>(null)
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [error, setError] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [categoryId, setCategoryId] = useState('')
  const [note, setNote] = useState('')
  const [creating, setCreating] = useState(false)

  function load() {
    api.listCycleCounts()
      .then(({ cycleCounts }) => setCycleCounts(cycleCounts))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل عمليات الجرد' : 'حدث خطأ، حاول مرة أخرى'))
  }

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: 'الجرد الدوري', action: { label: 'جرد جديد', onClick: () => setShowNew(true) } })
  }, [setHeader])

  useEffect(load, [])
  useEffect(() => { api.listCategories().then(({ categories }) => setCategories(categories)).catch(() => {}) }, [])

  async function createCycleCount() {
    setCreating(true)
    try {
      const { id } = await api.createCycleCount({ categoryId: categoryId || null, note })
      navigate(`/products/cyclecounts/${id}`)
    } catch {
      setError('تعذر إنشاء الجرد، حاول مرة أخرى')
    } finally {
      setCreating(false)
    }
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!cycleCounts) return null

  return (
    <>
      {showNew && (
        <div className="admin-form-card" style={{ marginBottom: 16 }}>
          <div className="admin-form-card-title">جرد جديد</div>
          <label>القسم (اختياري — اتركه فارغاً لجرد كل المنتجات)
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">كل المنتجات</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>ملاحظة (اختياري)
            <input type="text" value={note} onChange={e => setNote(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="admin-form-save" disabled={creating} onClick={createCycleCount}>إنشاء</button>
            <button className="admin-form-chip" onClick={() => setShowNew(false)}>إلغاء</button>
          </div>
        </div>
      )}

      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <div style={{ minWidth: 640 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
              <div>القسم / الملاحظة</div><div>الحالة</div><div>عدد الأصناف</div><div>المعدود</div><div>تاريخ الإنشاء</div>
            </div>
            {cycleCounts.map(cc => {
              const tint = STATUS_TINT[cc.status]
              return (
                <div key={cc.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/products/cyclecounts/${cc.id}`)}>
                  <div className="admin-cell-plain" style={{ fontWeight: 900 }}>{cc.categoryName ?? 'كل المنتجات'}{cc.note && <span style={{ display: 'block', fontWeight: 400, color: '#8A948C', fontSize: 12 }}>{cc.note}</span>}</div>
                  <div><span className="admin-pill" style={{ background: tint.bg, color: tint.fg }}>{STATUS_LABEL[cc.status]}</span></div>
                  <div className="admin-cell-plain">{cc.itemCount}</div>
                  <div className="admin-cell-plain">{cc.countedCount} / {cc.itemCount}{cc.varianceCount > 0 && <span style={{ color: '#B42318', marginRight: 6 }}>({cc.varianceCount} فرق)</span>}</div>
                  <div className="admin-cell-plain" style={{ color: '#8A948C', fontSize: 12 }}>{cc.createdAt.slice(0, 10)}</div>
                </div>
              )
            })}
            {cycleCounts.length === 0 && <div className="admin-table-empty">مفيش عمليات جرد بعد</div>}
          </div>
        </div>
      </div>
    </>
  )
}
