import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type AdminUser } from '../../utils/api'
import { useAuth } from '../../store/AuthContext'
import { formatDate } from '../../utils/format'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '2fr 1fr .8fr 1fr'

export function UsersPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState('')

  function load() {
    api.listUsers()
      .then(({ users }) => setUsers(users))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل المستخدمين' : 'حدث خطأ، حاول مرة أخرى'))
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    setHeader({ crumb: 'الإعدادات', title: 'المستخدمون والصلاحيات' })
  }, [setHeader])

  const filtered = useMemo(() => {
    if (!users) return []
    const q = query.trim()
    if (!q) return users
    return users.filter(u => u.fullName.includes(q) || u.email.includes(q))
  }, [users, query])

  async function toggleAdmin(u: AdminUser) {
    const makingAdmin = !u.isAdmin
    const confirmMsg = makingAdmin
      ? `هل تريد منح "${u.fullName}" صلاحيات مدير؟ هيقدر يشوف كل بيانات المتجر ويعدّل فيها.`
      : `هل تريد إلغاء صلاحيات المدير عن "${u.fullName}"؟`
    if (!window.confirm(confirmMsg)) return

    setBusyId(u.id)
    try {
      const { user: updated } = await api.setUserAdmin(u.id, makingAdmin)
      setUsers(current => current?.map(x => x.id === updated.id ? updated : x) ?? current)
    } catch {
      load()
    } finally {
      setBusyId('')
    }
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!users) return null

  const adminCount = users.filter(u => u.isAdmin).length

  return (
    <>
      <StatsGrid stats={[
        { label: 'عدد المستخدمين', value: String(users.length), note: 'كل الحسابات', icon: '👥', tint: '#EAF2FF' },
        { label: 'المديرون', value: String(adminCount), note: 'صلاحية كاملة', icon: '🛡️', tint: '#EAF8EF' },
        { label: 'عملاء عاديون', value: String(users.length - adminCount), note: 'بدون صلاحيات إدارية', icon: '🙋', tint: '#F1F4F2', noteColor: '#68746B' }
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
            {filtered.map(u => {
              const isSelf = u.id === currentUser?.id
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
                    <span className="admin-pill" style={{ background: u.isAdmin ? '#EAF8EF' : '#F1F4F2', color: u.isAdmin ? '#12813C' : '#68746B' }}>
                      {u.isAdmin ? 'مدير' : 'عميل'}
                    </span>
                  </div>
                  <div>
                    <button
                      className="admin-category-card-btn"
                      disabled={busyId === u.id || (isSelf && u.isAdmin)}
                      title={isSelf && u.isAdmin ? 'لا يمكنك إلغاء صلاحيتك الخاصة' : undefined}
                      onClick={() => toggleAdmin(u)}
                    >
                      {u.isAdmin ? 'إلغاء صلاحية المدير' : 'تعيين كمدير'}
                    </button>
                  </div>
                </div>
              )
            })}
            {filtered.length === 0 && <div className="admin-table-empty">مفيش بيانات في هذا العرض</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{filtered.length} مستخدم</span>
          <span>لازم يكون الحساب مسجَّل بالفعل قبل ترقيته لمدير</span>
        </div>
      </div>
    </>
  )
}
