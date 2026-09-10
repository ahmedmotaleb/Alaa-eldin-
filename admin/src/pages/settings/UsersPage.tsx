import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type AdminUser } from '../../utils/api'
import { useAuth } from '../../store/AuthContext'
import { formatDate } from '../../utils/format'
import { useDebouncedValue } from '../../utils/useDebouncedValue'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '2fr 1fr .9fr 1.3fr'
const LIMIT = 20

function rolePill(u: AdminUser) {
  if (!u.isAdmin) return { label: 'عميل', bg: '#F1F4F2', fg: '#68746B' }
  if (u.role === 'admin') return { label: 'مدير كامل', bg: '#EAF8EF', fg: '#12813C' }
  return { label: 'مدير تشغيلي', bg: '#EAF2FF', fg: '#1D4ED8' }
}

export function UsersPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [statsUsers, setStatsUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState('')
  const debouncedQuery = useDebouncedValue(query)

  // الإحصائيات بتتحسب من كل المستخدمين (بدون ترقيم) عشان تفضل صحيحة بغض النظر عن الصفحة
  // الحالية أو البحث المطبّق على الجدول.
  function loadStats() {
    api.listUsers().then(({ users }) => setStatsUsers(users)).catch(() => {})
  }

  function loadPage() {
    api.listUsers({ page, limit: LIMIT, search: debouncedQuery.trim() || undefined })
      .then(({ users, totalPages, total }) => {
        setUsers(users)
        setTotalPages(totalPages ?? 1)
        setTotal(total ?? users.length)
      })
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل المستخدمين' : 'حدث خطأ، حاول مرة أخرى'))
  }

  useEffect(() => { loadStats() }, [])
  useEffect(() => { setPage(1) }, [debouncedQuery])
  useEffect(() => { loadPage() }, [page, debouncedQuery])

  useEffect(() => {
    setHeader({ crumb: 'الإعدادات', title: 'المستخدمون والصلاحيات' })
  }, [setHeader])

  async function toggleAdmin(u: AdminUser) {
    const makingAdmin = !u.isAdmin
    const confirmMsg = makingAdmin
      ? `هل تريد منح "${u.fullName}" صلاحية الدخول للوحة التحكم؟ هيدخل بدور "مدير تشغيلي" مبدئياً.`
      : `هل تريد إلغاء صلاحية الدخول للوحة التحكم عن "${u.fullName}"؟`
    if (!window.confirm(confirmMsg)) return

    setBusyId(u.id)
    try {
      const { user: updated } = await api.setUserAdmin(u.id, makingAdmin)
      setUsers(current => current?.map(x => x.id === updated.id ? updated : x) ?? current)
      loadStats()
    } catch {
      loadPage()
    } finally {
      setBusyId('')
    }
  }

  async function toggleRole(u: AdminUser) {
    const promoting = u.role !== 'admin'
    const confirmMsg = promoting
      ? `هل تريد ترقية "${u.fullName}" لمدير كامل الصلاحيات؟ هيقدر يدير المستخدمين والتسويات والمصروفات.`
      : `هل تريد إرجاع "${u.fullName}" لمدير تشغيلي (بدون صلاحيات الإدارة الكاملة)؟`
    if (!window.confirm(confirmMsg)) return

    setBusyId(u.id)
    try {
      const { user: updated } = await api.setUserRole(u.id, promoting ? 'admin' : 'staff')
      setUsers(current => current?.map(x => x.id === updated.id ? updated : x) ?? current)
      loadStats()
    } catch {
      loadPage()
    } finally {
      setBusyId('')
    }
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!users) return null

  const adminCount = statsUsers.filter(u => u.isAdmin).length
  const fullAdminCount = statsUsers.filter(u => u.isAdmin && u.role === 'admin').length

  return (
    <>
      <StatsGrid stats={[
        { label: 'عدد المستخدمين', value: String(statsUsers.length), note: 'كل الحسابات', icon: '👥', tint: '#EAF2FF' },
        { label: 'مستخدمو لوحة التحكم', value: String(adminCount), note: 'دخول للوحة التحكم', icon: '🛡️', tint: '#EAF8EF' },
        { label: 'مديرون كاملون', value: String(fullAdminCount), note: 'صلاحية كاملة', icon: '👑', tint: '#FFF3E3' },
        { label: 'عملاء عاديون', value: String(statsUsers.length - adminCount), note: 'بدون صلاحيات إدارية', icon: '🙋', tint: '#F1F4F2', noteColor: '#68746B' }
      ]} />

      <div className="admin-table-card">
        <div className="admin-table-tools">
          <div className="admin-search">
            <span style={{ color: '#8A948C', fontSize: 13 }}>🔎</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث بالاسم أو البريد..." />
          </div>
        </div>
        <div className="admin-table-scroll">
          <div style={{ minWidth: 640 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
              <div>المستخدم</div><div>تاريخ التسجيل</div><div>الصلاحية</div><div>إجراء</div>
            </div>
            {users.map(u => {
              const isSelf = u.id === currentUser?.id
              const pill = rolePill(u)
              return (
                <div key={u.id} className="admin-table-row" style={{ gridTemplateColumns: COLS }}>
                  <div className="admin-cell-product">
                    <span style={{ minWidth: 0 }}>
                      <span className="admin-cell-product-text">{u.fullName}{isSelf ? ' (أنت)' : ''}</span>
                      <span className="admin-cell-product-sub">{u.email}</span>
                    </span>
                  </div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{formatDate(u.createdAt)}</div>
                  <div>
                    <span className="admin-pill" style={{ background: pill.bg, color: pill.fg }}>{pill.label}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      className="admin-category-card-btn"
                      disabled={busyId === u.id || (isSelf && u.isAdmin)}
                      title={isSelf && u.isAdmin ? 'لا يمكنك إلغاء صلاحيتك الخاصة' : undefined}
                      onClick={() => toggleAdmin(u)}
                    >
                      {u.isAdmin ? 'إلغاء صلاحية اللوحة' : 'دخول للوحة التحكم'}
                    </button>
                    {u.isAdmin && (
                      <button
                        className="admin-category-card-btn"
                        disabled={busyId === u.id || (isSelf && u.role === 'admin')}
                        title={isSelf && u.role === 'admin' ? 'لا يمكنك تخفيض دورك الخاص' : undefined}
                        onClick={() => toggleRole(u)}
                      >
                        {u.role === 'admin' ? 'إرجاع لمدير تشغيلي' : 'ترقية لمدير كامل'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            {users.length === 0 && <div className="admin-table-empty">مفيش بيانات في هذا العرض</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{total} مستخدم</span>
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
