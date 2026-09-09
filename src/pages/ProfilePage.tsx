import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRequireAuth } from '../hooks/useRequireAuth'
import { useAuth } from '../store/AuthContext'
import { isValidEgyptianMobile } from '../utils/phone'
import { ar } from '../i18n/ar'

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

  useEffect(() => {
    if (user) {
      setFullName(user.fullName)
      setMobile(user.mobile ?? '')
    }
  }, [user])

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
      <button className="secondary-button" onClick={() => navigate('/account')} style={{ marginTop: 8 }}>{ar.common.back}</button>
    </div>
  )
}
