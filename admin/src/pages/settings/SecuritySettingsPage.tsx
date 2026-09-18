import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, ApiError, type SecurityStatus, type TwoFactorSetup, type TwoFactorStatus } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

function StatusBadge({ ok, okLabel, notOkLabel }: { ok: boolean, okLabel: string, notOkLabel: string }) {
  return (
    <span style={{ fontWeight: 700, color: ok ? '#16A34A' : '#B45309' }}>
      {ok ? okLabel : notOkLabel}
    </span>
  )
}

export function SecuritySettingsPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [status, setStatus] = useState<TwoFactorStatus | null>(null)
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null)
  const [confirmCode, setConfirmCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [disablePassword, setDisablePassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [security, setSecurity] = useState<SecurityStatus | null>(null)

  useEffect(() => {
    setHeader({ crumb: 'الإعدادات', title: 'الأمان' })
  }, [setHeader])

  useEffect(() => {
    api.getSecurityStatus().then(setSecurity).catch(() => {})
  }, [])

  function loadStatus() {
    api.twoFactorStatus().then(setStatus).catch(() => setError('تعذر تحميل حالة المصادقة الثنائية'))
  }

  useEffect(loadStatus, [])

  async function startSetup() {
    setError('')
    setBusy(true)
    try {
      const result = await api.startTwoFactorSetup()
      setSetup(result)
      setBackupCodes(null)
      setConfirmCode('')
    } catch {
      setError('تعذر بدء إعداد المصادقة الثنائية')
    } finally {
      setBusy(false)
    }
  }

  async function confirmSetup() {
    setError('')
    setBusy(true)
    try {
      const { backupCodes } = await api.confirmTwoFactorSetup(confirmCode)
      setBackupCodes(backupCodes)
      setSetup(null)
      loadStatus()
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'invalid_code' ? 'الكود غير صحيح' : 'تعذر تأكيد الإعداد')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setError('')
    setBusy(true)
    try {
      await api.disableTwoFactor(disablePassword)
      setDisablePassword('')
      setBackupCodes(null)
      loadStatus()
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'invalid_password' ? 'كلمة المرور غير صحيحة' : 'تعذر التعطيل')
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null

  return (
    <div className="admin-form-grid">
      {security && (
        <>
          <div className="admin-form-card">
            <div>
              <div className="admin-form-card-title">HTTPS / SSL</div>
              <div className="admin-form-card-sub">حالة الاتصال الحالي بهذا الطلب فقط</div>
            </div>
            <StatusBadge ok={security.https.detected} okLabel="مفعّل" notOkLabel="يحتاج مراجعة" />
          </div>

          <div className="admin-form-card">
            <div>
              <div className="admin-form-card-title">رؤوس الحماية</div>
              <div className="admin-form-card-sub">إعدادات ثابتة في السيرفر (helmet + CSP)</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>سياسة أمان المحتوى (CSP): <StatusBadge ok={security.headers.contentSecurityPolicy} okLabel="مفعّلة" notOkLabel="غير مفعّلة" /></div>
              <div>HSTS: <StatusBadge ok={security.headers.strictTransportSecurity} okLabel="مفعّل" notOkLabel="غير مفعّل" /></div>
              <div>X-Content-Type-Options: <StatusBadge ok={security.headers.xContentTypeOptions} okLabel="مفعّل" notOkLabel="غير مفعّل" /></div>
              <div>الحماية من Clickjacking (frame-ancestors): <StatusBadge ok={security.headers.frameAncestorsDenied} okLabel="مفعّلة" notOkLabel="غير مفعّلة" /></div>
              <div>Referrer-Policy: <StatusBadge ok={security.headers.referrerPolicy} okLabel="مفعّل" notOkLabel="غير مفعّل" /></div>
            </div>
          </div>
        </>
      )}

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">المصادقة الثنائية (2FA)</div>
          <div className="admin-form-card-sub">طبقة حماية إضافية لحسابك عبر تطبيق مصادقة (Google Authenticator أو مشابه)</div>
        </div>

        {error && <div className="admin-form-error">{error}</div>}

        {backupCodes && (
          <div className="admin-form-help" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <strong>تم تفعيل المصادقة الثنائية. احفظ الأكواد الاحتياطية دي في مكان آمن — مش هتظهر تاني:</strong>
            <div style={{ fontFamily: 'monospace', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {backupCodes.map(code => <span key={code}>{code}</span>)}
            </div>
          </div>
        )}

        {status.enabled && !setup && (
          <>
            <p>المصادقة الثنائية مفعّلة حالياً. الأكواد الاحتياطية المتبقية: {status.remainingBackupCodes}</p>
            <label>كلمة المرور (للتأكيد قبل التعطيل)
              <input type="password" autoComplete="current-password" value={disablePassword} onChange={e => setDisablePassword(e.target.value)} />
            </label>
            <button className="admin-form-save" disabled={busy || !disablePassword} onClick={disable}>تعطيل المصادقة الثنائية</button>
          </>
        )}

        {!status.enabled && !setup && (
          <button className="admin-form-save" disabled={busy} onClick={startSetup}>تفعيل المصادقة الثنائية</button>
        )}

        {setup && (
          <>
            <p>امسح كود QR ده بتطبيق المصادقة، أو أدخل السر يدوياً:</p>
            <img src={setup.qrCodeDataUrl} alt="QR code" style={{ width: 200, height: 200 }} />
            <div style={{ fontFamily: 'monospace' }}>{setup.secret}</div>
            <label>الكود من التطبيق
              <input type="text" inputMode="numeric" autoComplete="one-time-code" value={confirmCode} onChange={e => setConfirmCode(e.target.value.trim())} placeholder="000000" />
            </label>
            <button className="admin-form-save" disabled={busy || !confirmCode} onClick={confirmSetup}>تأكيد وتفعيل</button>
          </>
        )}
      </div>

      {security && (
        <>
          <div className="admin-form-card">
            <div>
              <div className="admin-form-card-title">CAPTCHA</div>
              <div className="admin-form-card-sub">حماية من المحاولات الآلية على النماذج الحساسة</div>
            </div>
            <StatusBadge ok={security.captcha.configured} okLabel="مفعّل" notOkLabel="غير مفعّل" />
          </div>

          <div className="admin-form-card">
            <div>
              <div className="admin-form-card-title">سياسة كلمة المرور</div>
              <div className="admin-form-card-sub">نفس السياسة مطبّقة على حسابات الإدارة والعملاء حالياً</div>
            </div>
            <p>
              الحد الأدنى {security.passwordPolicy.minLength} حرف
              {security.passwordPolicy.requiresLetter && '، حرف واحد على الأقل'}
              {security.passwordPolicy.requiresDigit && '، رقم واحد على الأقل'}
            </p>
          </div>

          <div className="admin-form-card">
            <div>
              <div className="admin-form-card-title">أمان التبعيات</div>
              <div className="admin-form-card-sub">{security.dependencySecurity.note}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
