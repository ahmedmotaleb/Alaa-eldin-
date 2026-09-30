import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, ApiError, type BackupStatus, type BackupToken, type BackupAttempt } from '../../utils/api'
import { formatDateTime } from '../../utils/format'
import type { LayoutContext } from '../../components/AdminLayout'

const STALE_BACKUP_HOURS = 36
const TOKEN_COLS = '1.2fr 1fr 1fr 0.7fr 0.8fr'
const ATTEMPT_COLS = '1.1fr 0.8fr 1fr 0.8fr 0.8fr 1fr'

function timeAgoIsStale(iso: string | null): boolean {
  if (!iso) return true
  return Date.now() - new Date(iso).getTime() > STALE_BACKUP_HOURS * 60 * 60 * 1000
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} بايت`
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(1)} MB`
}

export function BackupSettingsPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [tokens, setTokens] = useState<BackupToken[] | null>(null)
  const [attempts, setAttempts] = useState<BackupAttempt[] | null>(null)
  const [error, setError] = useState('')

  const [downloadPassword, setDownloadPassword] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [downloadOk, setDownloadOk] = useState('')

  const [tokenName, setTokenName] = useState('')
  const [tokenPassword, setTokenPassword] = useState('')
  const [creatingToken, setCreatingToken] = useState(false)
  const [tokenError, setTokenError] = useState('')
  const [justCreatedToken, setJustCreatedToken] = useState<string | null>(null)

  useEffect(() => {
    setHeader({ crumb: 'الإعدادات', title: 'النسخ الاحتياطي' })
  }, [setHeader])

  function load() {
    Promise.all([api.getBackupStatus(), api.listBackupTokens(), api.listBackupAttempts()])
      .then(([s, t, a]) => { setStatus(s); setTokens(t.tokens); setAttempts(a.attempts) })
      .catch(() => setError('تعذر تحميل بيانات النسخ الاحتياطي'))
  }

  useEffect(load, [])

  async function downloadNow() {
    if (!downloadPassword) { setDownloadError('أدخل كلمة السر'); return }
    setDownloading(true)
    setDownloadError('')
    setDownloadOk('')
    try {
      const { sha256 } = await api.downloadBackupNow(downloadPassword)
      setDownloadPassword('')
      setDownloadOk(sha256 ? `تم التنزيل — SHA-256: ${sha256}` : 'تم التنزيل')
      load()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_password') setDownloadError('كلمة السر غير صحيحة')
      else if (err instanceof ApiError && err.code === 'backup_already_in_progress') setDownloadError('في نسخة احتياطية شغّالة بالفعل الآن — حاول بعد شوية')
      else if (err instanceof ApiError && err.code === 'rate_limited') setDownloadError('تجاوزت الحد المسموح (5 كل ساعة) — حاول لاحقاً')
      else if (err instanceof ApiError && err.code === 'pg_dump_version_too_old') setDownloadError('إصدار pg_dump في الخادم أقدم من إصدار قاعدة البيانات — راجع الفريق التقني')
      else setDownloadError('تعذر إنشاء النسخة الاحتياطية')
    } finally {
      setDownloading(false)
    }
  }

  async function createToken() {
    if (!tokenName.trim() || !tokenPassword) { setTokenError('أدخل اسم ظاهر وكلمة السر'); return }
    setCreatingToken(true)
    setTokenError('')
    try {
      const { token } = await api.createBackupToken(tokenName.trim(), tokenPassword)
      setJustCreatedToken(token)
      setTokenName('')
      setTokenPassword('')
      load()
    } catch (err) {
      setTokenError(err instanceof ApiError && err.code === 'invalid_password' ? 'كلمة السر غير صحيحة' : 'تعذر إنشاء التوكن')
    } finally {
      setCreatingToken(false)
    }
  }

  async function revokeToken(id: string) {
    if (!confirm('إلغاء هذا التوكن؟ أي سكريبت بيستخدمه هيتوقف فوراً.')) return
    await api.revokeBackupToken(id).catch(() => {})
    load()
  }

  function copyToken() {
    if (justCreatedToken) navigator.clipboard?.writeText(justCreatedToken).catch(() => {})
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!status || !tokens || !attempts) return null

  const stale = timeAgoIsStale(status.lastSuccessfulBackupAt)

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">حالة النسخ الاحتياطي</div>
          <div className="admin-form-card-sub">
            الخادم: pg_dump {status.pgDumpMajor ?? '—'} · قاعدة البيانات: PostgreSQL {status.serverMajor ?? '—'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>آخر نسخة ناجحة:</span>
          <strong style={{ color: stale ? '#B42318' : undefined }}>
            {status.lastSuccessfulBackupAt ? formatDateTime(status.lastSuccessfulBackupAt) : 'لا يوجد أبداً'}
          </strong>
        </div>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">تنزيل نسخة احتياطية الآن</div>
          <div className="admin-form-card-sub">يتطلب كتابة كلمة سر حسابك مرة أخرى للتأكيد</div>
        </div>
        <label>كلمة السر
          <input type="password" value={downloadPassword} onChange={e => setDownloadPassword(e.target.value)} />
        </label>
        <button className="admin-form-save" disabled={downloading} onClick={downloadNow}>
          {downloading ? 'جارِ إنشاء النسخة...' : 'تنزيل نسخة احتياطية الآن'}
        </button>
        {downloadError && <div className="admin-form-error">{downloadError}</div>}
        {downloadOk && <div className="admin-form-success">{downloadOk}</div>}
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">توكنات النسخ الاحتياطي (للسكريبت على جهازك)</div>
          <div className="admin-form-card-sub">توكن منفصل تماماً عن تسجيل الدخول العادي — يُستخدم فقط لتنزيل نسخة احتياطية آلياً</div>
        </div>
        {justCreatedToken && (
          <div className="admin-form-help" style={{ background: '#FFF8E5', border: '1px solid #f3df9c', borderRadius: 10, padding: 12 }}>
            <strong>⚠️ هذا التوكن لن يظهر مرة أخرى أبداً — انسخه الآن واحفظه في مكان آمن:</strong>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{justCreatedToken}</code>
              <button type="button" className="admin-form-chip" onClick={copyToken}>نسخ</button>
            </div>
          </div>
        )}
        <label>اسم ظاهر (مثال: جهاز المكتب)
          <input value={tokenName} onChange={e => setTokenName(e.target.value)} placeholder="backup.ps1 - جهاز المكتب" />
        </label>
        <label>كلمة السر (للتأكيد)
          <input type="password" value={tokenPassword} onChange={e => setTokenPassword(e.target.value)} />
        </label>
        <button className="admin-form-save" disabled={creatingToken} onClick={createToken}>
          {creatingToken ? 'جارِ الإنشاء...' : 'إنشاء توكن جديد'}
        </button>
        {tokenError && <div className="admin-form-error">{tokenError}</div>}
      </div>

      <div className="admin-table-card">
        <div className="admin-table-tools">
          <div style={{ fontWeight: 800, fontSize: 13.5 }}>توكنات النسخ الاحتياطي الحالية</div>
        </div>
        <div className="admin-table-scroll">
          <div style={{ minWidth: 640 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: TOKEN_COLS }}>
              <div>الاسم</div><div>أنشأه</div><div>آخر استخدام</div><div>الحالة</div><div></div>
            </div>
            {tokens.map(t => (
              <div key={t.id} className="admin-table-row" style={{ gridTemplateColumns: TOKEN_COLS }}>
                <div className="admin-cell-plain" style={{ fontWeight: 700 }}>{t.name}</div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{t.createdByEmail ?? '—'}</div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{t.lastUsedAt ? formatDateTime(t.lastUsedAt) : 'لم يُستخدم بعد'}</div>
                <div className="admin-cell-plain">{t.revokedAt ? 'ملغي' : 'فعّال'}</div>
                <div className="admin-cell-plain">
                  {!t.revokedAt && <button type="button" className="admin-form-chip" onClick={() => revokeToken(t.id)}>إلغاء</button>}
                </div>
              </div>
            ))}
            {tokens.length === 0 && <div className="admin-table-empty">لا يوجد توكنات بعد</div>}
          </div>
        </div>
      </div>

      <div className="admin-table-card">
        <div className="admin-table-tools">
          <div style={{ fontWeight: 800, fontSize: 13.5 }}>آخر 20 محاولة</div>
        </div>
        <div className="admin-table-scroll">
          <div style={{ minWidth: 760 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: ATTEMPT_COLS }}>
              <div>الوقت</div><div>الطريقة</div><div>عن طريق</div><div>الحجم</div><div>المدة</div><div>النتيجة</div>
            </div>
            {attempts.map(a => (
              <div key={a.id} className="admin-table-row" style={{ gridTemplateColumns: ATTEMPT_COLS }}>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{formatDateTime(a.createdAt)}</div>
                <div className="admin-cell-plain">{a.actorType === 'session' ? 'المتصفح' : 'توكن'}</div>
                <div className="admin-cell-plain" style={{ color: '#68746B' }}>{a.adminEmail ?? '—'}</div>
                <div className="admin-cell-plain">{formatBytes(a.bytesTransferred)}</div>
                <div className="admin-cell-plain">{a.durationMs !== null ? `${(a.durationMs / 1000).toFixed(1)} ث` : '—'}</div>
                <div className="admin-cell-plain" style={{ color: a.success ? undefined : '#B42318', fontWeight: 700 }}>
                  {a.success ? 'نجحت' : (a.failureReason ?? 'فشلت')}
                </div>
              </div>
            ))}
            {attempts.length === 0 && <div className="admin-table-empty">لا يوجد محاولات بعد</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
