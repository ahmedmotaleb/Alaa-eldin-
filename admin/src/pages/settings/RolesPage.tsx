import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, ApiError, type AdminRole } from '../../utils/api'
import { RoleFormDrawer, PERMISSION_LABEL } from '../../components/RoleFormDrawer'
import type { LayoutContext } from '../../components/AdminLayout'

export function RolesPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [roles, setRoles] = useState<AdminRole[] | null>(null)
  const [error, setError] = useState('')
  const [formRole, setFormRole] = useState<AdminRole | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'الإعدادات', title: 'الأدوار والصلاحيات' })
  }, [setHeader])

  function load() {
    api.listRoles()
      .then(({ roles }) => setRoles(roles))
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل الأدوار' : 'حدث خطأ، حاول مرة أخرى'))
  }

  useEffect(load, [])

  function openCreate() {
    setFormRole(null)
    setShowForm(true)
  }

  function openEdit(role: AdminRole) {
    setFormRole(role)
    setShowForm(true)
  }

  function handleSaved(role: AdminRole) {
    setShowForm(false)
    setRoles(current => {
      if (!current) return current
      const exists = current.some(r => r.id === role.id)
      return exists ? current.map(r => r.id === role.id ? role : r) : [...current, role]
    })
  }

  async function deleteRole(role: AdminRole) {
    if (!window.confirm(`هل تريد حذف دور "${role.name}"؟ هذا الإجراء لا يمكن التراجع عنه.`)) return
    setBusyId(role.id)
    try {
      await api.deleteRole(role.id)
      setRoles(current => current?.filter(r => r.id !== role.id) ?? current)
    } catch (err) {
      const msg = err instanceof ApiError && err.code === 'role_in_use'
        ? 'لا يمكن حذف دور معيَّن لمستخدم واحد على الأقل — غيّر دور المستخدمين دول الأول'
        : err instanceof ApiError && err.code === 'cannot_delete_system_role'
          ? 'لا يمكن حذف دور أساسي من أدوار النظام'
          : 'تعذر حذف الدور، حاول مرة أخرى'
      window.alert(msg)
    } finally {
      setBusyId('')
    }
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!roles) return null

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="admin-form-save" style={{ whiteSpace: 'nowrap' }} onClick={openCreate}>+ إضافة دور</button>
      </div>

      <div className="admin-form-grid">
        {roles.map(role => (
          <div key={role.id} className="admin-table-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
              <strong style={{ fontSize: 15 }}>{role.name}</strong>
              {role.isSystem && (
                <span className="admin-pill" style={{ background: '#F1F4F2', color: '#68746B', whiteSpace: 'nowrap' }}>دور أساسي</span>
              )}
            </div>
            {role.description && (
              <div style={{ fontSize: 12.5, color: '#68746B', marginBottom: 10 }}>{role.description}</div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {role.permissions.length === 0 && (
                <span style={{ color: '#8A948C', fontSize: 13 }}>بدون صلاحيات</span>
              )}
              {role.permissions.map(p => (
                <span key={p} className="admin-pill" style={{ background: '#EAF2FF', color: '#1D4ED8', fontSize: 12 }}>
                  {PERMISSION_LABEL[p] ?? p}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="admin-category-card-btn" onClick={() => openEdit(role)}>تعديل</button>
              <button
                className="admin-category-card-btn"
                disabled={role.isSystem || busyId === role.id}
                title={role.isSystem ? 'لا يمكن حذف دور أساسي من أدوار النظام' : undefined}
                onClick={() => deleteRole(role)}
              >
                حذف
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm && <RoleFormDrawer role={formRole} onClose={() => setShowForm(false)} onSaved={handleSaved} />}
    </>
  )
}
