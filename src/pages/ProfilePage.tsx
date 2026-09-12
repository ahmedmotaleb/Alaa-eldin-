import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { useAuth } from '../store/AuthContext'
import { isValidEgyptianMobile } from '../utils/phone'
import { ar } from '../i18n/ar'
import { api, type NotificationPreferences } from '../utils/api'
import { subscribeToPush, unsubscribeFromPush, getPushSubscriptionStatus } from '../utils/push'

export function ProfilePage() {
  const { user, loading: authLoading } = useRequireAuth()
  const { updateProfile } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [mobile, setMobile] = useState('')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [pushStatus, setPushStatus] = useState<'subscribed' | 'not_subscribed' | 'unsupported'>('not_subscribed')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)

  useEffect(() => {
    if (user) {
      setFullName(user.fullName)
      setMobile(user.mobile ?? '')
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    getPushSubscriptionStatus().then(setPushStatus)
    api.getNotificationPreferences().then(({ preferences }) => setPreferences(preferences)).catch(() => {})
  }, [user])

  async function togglePush() {
    setPushBusy(true)
    setPushError('')
    if (pushStatus === 'subscribed') {
      await unsubscribeFromPush()
      setPushStatus('not_subscribed')
    } else {
      const result = await subscribeToPush()
      if (result.ok) {
        setPushStatus('subscribed')
      } else {
        setPushError(
          result.reason === 'unsupported' ? ar.notifications.unsupported
          : result.reason === 'not_configured' ? ar.notifications.notConfigured
          : result.reason === 'permission_denied' ? ar.notifications.permissionDenied
          : ar.notifications.genericError
        )
      }
    }
    setPushBusy(false)
  }

  async function updatePreference(key: keyof NotificationPreferences, value: boolean) {
    if (!preferences) return
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    try {
      await api.setNotificationPreferences(next)
    } catch {
      setPreferences(preferences)
    }
  }

  if (!user && !authLoading) return null
  if (!user) return null

  const nameValid = fullName.trim().length >= 2 && fullName.trim().length <= 100
  const mobileValid = !mobile.trim() || isValidEgyptianMobile(mobile.trim())
  const nameError = touched && !nameValid ? ar.profile.nameError : ''
  const mobileError = touched && !mobileValid ? ar.profile.mobileError : ''

  async function save() {
    setTouched(true)
    setError('')
    setSuccess('')
    if (!nameValid || !mobileValid) return
    setSaving(true)
    try {
      await updateProfile({ fullName: fullName.trim(), mobile: mobile.trim() })
      setSuccess(ar.profile.saved)
    } catch {
      setError(ar.profile.saveError)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="form-card">
      <label>{ar.profile.fullNameLabel}
        <input value={fullName} onChange={e => setFullName(e.target.value)} maxLength={100} aria-invalid={!!nameError} />
      </label>
      {nameError && <div className="field-error">{nameError}</div>}
      <label>{ar.profile.mobileLabel}
        <input value={mobile} onChange={e => setMobile(e.target.value)} placeholder={ar.profile.mobilePlaceholder} inputMode="numeric" autoComplete="tel" aria-invalid={!!mobileError} />
      </label>
      {mobileError && <div className="field-error">{mobileError}</div>}
      <label>{ar.profile.emailLabel}
        <input value={user.email} disabled />
        <span className="admin-form-help">{ar.profile.emailNote}</span>
      </label>

      {error && <div className="admin-form-error">{error}</div>}
      {success && <div className="admin-form-success">{success}</div>}
      <button className="primary-button" disabled={saving} onClick={save}>{ar.profile.save}</button>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e9e6' }}>
        <strong style={{ display: 'block', marginBottom: 10 }}>{ar.notifications.title}</strong>
        {pushStatus === 'unsupported' ? (
          <div className="admin-form-help">{ar.notifications.unsupported}</div>
        ) : (
          <>
            <button className="secondary-button" disabled={pushBusy} onClick={togglePush}>
              {pushStatus === 'subscribed' ? ar.notifications.disableButton : ar.notifications.enableButton}
            </button>
            {pushStatus === 'subscribed' && <div className="admin-form-help" style={{ marginTop: 6 }}>{ar.notifications.enabledNote}</div>}
            {pushError && <div className="admin-form-error" style={{ marginTop: 6 }}>{pushError}</div>}
          </>
        )}

        {preferences && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={preferences.orderUpdates} onChange={e => updatePreference('orderUpdates', e.target.checked)} />
              {ar.notifications.orderUpdatesLabel}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={preferences.promotions} onChange={e => updatePreference('promotions', e.target.checked)} />
              {ar.notifications.promotionsLabel}
            </label>
          </div>
        )}
      </div>

      <button className="secondary-button" onClick={() => navigate('/account')} style={{ marginTop: 8 }}>{ar.common.back}</button>
    </div>
  )
}
