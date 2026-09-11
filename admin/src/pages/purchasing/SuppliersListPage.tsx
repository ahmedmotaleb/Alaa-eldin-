import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminSupplier } from '../../utils/api'
import { useDebouncedValue } from '../../utils/useDebouncedValue'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '1.3fr 1fr 1fr 1fr .7fr'

export function SuppliersListPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [suppliers, setSuppliers] = useState<AdminSupplier[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query)

  useEffect(() => {
    setHeader({ crumb: 'المشتريات', title: 'الموردين', action: { label: 'إضافة مورد', onClick: () => navigate('/purchasing/suppliers/new') } })
  }, [setHeader, navigate])

  useEffect(() => {
    api.listSuppliers({ search: debouncedQuery.trim() || undefined })
      .then(({ suppliers }) => setSuppliers(suppliers))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل الموردين' : 'حدث خطأ، حاول مرة أخرى'))
  }, [debouncedQuery])

  async function toggleActive(supplier: AdminSupplier, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      const { supplier: updated } = await api.setSupplierActive(supplier.id, !supplier.active)
      setSuppliers(current => current?.map(s => s.id === updated.id ? updated : s) ?? null)
    } catch {
      window.alert('تعذر تحديث حالة المورد')
    }
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!suppliers) return null

  return (
    <div className="admin-table-card">
      <div className="admin-table-tools">
        <div className="admin-search">
          <span style={{ color: '#8A948C', fontSize: 13 }}>🔎</span>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث بالاسم أو رقم الموبايل..." />
        </div>
      </div>
      <div className="admin-table-scroll">
        <div style={{ minWidth: 720 }}>
          <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
            <div>الاسم</div><div>مسؤول التواصل</div><div>الموبايل</div><div>البريد</div><div>الحالة</div>
          </div>
          {suppliers.map(s => (
            <div key={s.id} className="admin-table-row clickable" style={{ gridTemplateColumns: COLS }} onClick={() => navigate(`/purchasing/suppliers/edit/${s.id}`)}>
              <div className="admin-cell-plain" style={{ fontWeight: 900 }}>{s.name}</div>
              <div className="admin-cell-plain" style={{ color: '#68746B' }}>{s.contactPerson || '—'}</div>
              <div className="admin-cell-plain" style={{ color: '#68746B' }}>{s.mobile || '—'}</div>
              <div className="admin-cell-plain" style={{ color: '#68746B' }}>{s.email || '—'}</div>
              <div>
                <button
                  className="admin-pill"
                  style={{ background: s.active ? '#EAF8EF' : '#FFF0EF', color: s.active ? '#12813C' : '#B42318', border: 'none', cursor: 'pointer' }}
                  onClick={e => toggleActive(s, e)}
                >
                  {s.active ? 'مفعّل' : 'معطّل'}
                </button>
              </div>
            </div>
          ))}
          {suppliers.length === 0 && <div className="admin-table-empty">مفيش موردين بعد</div>}
        </div>
      </div>
    </div>
  )
}
