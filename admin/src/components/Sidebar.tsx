import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { NAV } from '../nav'
import { useAuth } from '../store/AuthContext'

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()
  const activeGroup = location.pathname.split('/')[1] || 'home'
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ [activeGroup]: true })

  function toggle(groupId: string) {
    setOpenGroups(current => ({ ...current, [groupId]: !current[groupId] }))
  }

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="" />
        <div>
          <div className="sidebar-brand-name">علاء الدين</div>
          <div className="sidebar-brand-sub">لوحة تحكم المتجر</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV.map(group => {
          // أقسام 'admin' الكامل بس (زي إدارة المستخدمين وسجل النشاط والمصروفات والتسويات)
          // مخفية عن مدير 'staff' التشغيلي هنا — السيرفر برضه بيرفضها بـ 403 لو حد وصل
          // لرابطها مباشرة، فده مجرد تحسين لتجربة الاستخدام مش خط الدفاع الوحيد.
          const visibleChildren = group.children.filter(c => !c.adminOnly || user?.role === 'admin')
          if (group.children.length > 0 && visibleChildren.length === 0) return null

          const isActiveGroup = activeGroup === group.id
          const isOpen = openGroups[group.id] ?? isActiveGroup
          return (
            <div className="sidebar-group" key={group.id}>
              <button
                className={`sidebar-group-btn ${isActiveGroup && group.children.length === 0 ? 'active' : ''}`}
                onClick={() => visibleChildren.length ? toggle(group.id) : navigate(group.id === 'home' ? '/' : `/${group.id}`)}
              >
                <span className="sidebar-group-icon">{group.icon}</span>
                <span className="sidebar-group-label">{group.label}</span>
                {visibleChildren.length > 0 && <span className="sidebar-group-caret">{isOpen ? '▾' : '◂'}</span>}
              </button>
              {visibleChildren.length > 0 && isOpen && (
                <div className="sidebar-children">
                  {visibleChildren.map(child => {
                    const path = `/${group.id}/${child.id}`
                    const isActive = location.pathname === path
                    return (
                      <button
                        key={child.id}
                        className={`sidebar-child ${isActive ? 'active' : ''}`}
                        onClick={() => navigate(path)}
                      >
                        <span>{child.label}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="sidebar-account">
        <div className="sidebar-account-avatar">{(user?.fullName ?? '؟').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join(' ')}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="sidebar-account-name">{user?.fullName}</div>
          <div className="sidebar-account-role">{user?.role === 'admin' ? 'مدير كامل' : 'مدير تشغيلي'}</div>
        </div>
      </div>
      <button className="sidebar-logout" onClick={handleLogout}>تسجيل الخروج</button>
    </aside>
  )
}
