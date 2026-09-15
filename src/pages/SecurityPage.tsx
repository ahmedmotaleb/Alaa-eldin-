import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { formatDateTime } from '../utils/format'
import { api, ApiError, type ApiSession } from '../utils/api'
import { ar } from '../i18n/ar'

export function SecurityPage() {
  const { user, loading: authLoading } = useRequireAuth()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<ApiSession[] | null>(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [logoutOthersBusy, setLogoutOthersBusy] = useState(false)
  const [message, setMessage] = useState('')

  function load() {
    api.listSessions()
      .then(({ sessions }) => setSessions(sessions))
      .catch(() => setError(ar.security.loadError))
  }

  useEffect(() => {
    if (!user) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  if (!user && !authLoading) return null
  if (!user) return null

  async function removeSession(session: ApiSession) {
    if (!window.confirm(ar.security.removeConfirm)) return
    setBusyId(session.id)
    setError('')
    try {
      await api.removeSession(session.id)
      if (session.isCurrent) {
        navigate('/login', { replace: true })
        return
      }
      setSessions(current => (current ?? []).filter(s => s.id !== session.id))
    } catch (err) {
      setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic)
    } finally {
      setBusyId(null)
    }
  }

  async function logoutOthers() {
    if (!window.confirm(ar.security.logoutOtherDevicesConfirm)) return
    setLogoutOthersBusy(true)
    setError('')
    setMessage('')
    try {
      const { revoked } = await api.logoutOtherSessions()
      setMessage(ar.security.logoutOtherDevicesSuccess(revoked))
      load()
    } catch (err) {
      setError(err instanceof ApiError ? ar.errors.forCode(err.code) : ar.errors.generic)
    } finally {
      setLogoutOthersBusy(false)
    }
  }

  return (
    <div className="form-card">
      <h2>{ar.security.devicesTitle}</h2>
      <p className="admin-form-help">{ar.security.devicesNote}</p>

      {error && <div className="admin-form-error">{error}</div>}
      {message && <div className="admin-form-success">{message}</div>}

      {sessions === null && !error && <div className="admin-form-help">…</div>}
      {sessions?.length === 0 && <div className="admin-form-help">{ar.security.empty}</div>}

      <div className="device-list">
        {sessions?.map(session => (
          <div className="device-row" key={session.id}>
            <div className="device-row-info">
              <div className="device-row-name">
                {session.deviceName || ar.security.title}
                {session.isCurrent && <span className="device-current-badge">{ar.security.currentDeviceBadge}</span>}
              </div>
              <div className="device-row-meta">
                {session.lastSeenAt && <span>{ar.security.lastActivity(formatDateTime(session.lastSeenAt))}</span>}
                <span>{ar.security.loginDate(formatDateTime(session.createdAt))}</span>
              </div>
            </div>
            <button
              className="secondary-button"
              disabled={busyId === session.id}
              onClick={() => removeSession(session)}
            >
              {session.isCurrent ? ar.security.logoutThisDevice : ar.security.removeButton}
            </button>
          </div>
        ))}
      </div>

      {sessions && sessions.length > 1 && (
        <button className="secondary-button" disabled={logoutOthersBusy} onClick={logoutOthers}>
          {ar.security.logoutOtherDevices}
        </button>
      )}

      <button className="secondary-button" onClick={() => navigate('/account')} style={{ marginTop: 8 }}>{ar.common.back}</button>
    </div>
  )
}
