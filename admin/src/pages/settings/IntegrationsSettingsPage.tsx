import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, ApiError, type IntegrationsStatus } from '../../utils/api'
import type { LayoutContext } from '../../components/AdminLayout'

function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span className={`admin-form-chip ${configured ? 'active' : ''}`} style={{ pointerEvents: 'none' }}>
      {configured ? 'متصل' : 'غير مُعد'}
    </span>
  )
}

export function IntegrationsSettingsPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [status, setStatus] = useState<IntegrationsStatus | null>(null)
  const [error, setError] = useState('')
  const [destination, setDestination] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'الإعدادات', title: 'التكاملات' })
  }, [setHeader])

  function load() {
    api.getIntegrationsStatus().then(setStatus).catch(() => setError('تعذر تحميل حالة التكاملات'))
  }

  useEffect(load, [])

  async function testWhatsApp() {
    if (!destination.trim()) { setTestResult('أدخل رقم موبايل مصري صحيح لإرسال رسالة الاختبار عليه'); return }
    setTesting(true)
    setTestResult('')
    try {
      const result = await api.testWhatsAppConnection(destination.trim())
      if (result.ok && result.sent) setTestResult('تم إرسال رسالة الاختبار بنجاح')
      else if (result.ok && !result.sent) setTestResult(`فشل الإرسال: ${result.error ?? 'غير معروف'}`)
      else setTestResult(result.reason === 'invalid_number' ? 'رقم الموبايل غير صحيح' : 'واتساب غير مُعد على السيرفر')
    } catch (err) {
      setTestResult(err instanceof ApiError && err.code === 'invalid_destination' ? 'رقم الموبايل غير صحيح' : 'تعذر تنفيذ الاختبار')
    } finally {
      setTesting(false)
    }
  }

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!status) return null

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">واتساب (WhatsApp Business Cloud API)</div>
          <div className="admin-form-card-sub">الإرسال الفعلي من لوحة التحكم — الزر اليدوي (wa.me) يفضل شغال دايماً بغض النظر عن الحالة هنا</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>الحالة:</span><StatusBadge configured={status.whatsapp.configured} />
        </div>
        {status.whatsapp.configured && (
          <>
            <label>رقم لاختبار الاتصال (اختياري — بيتبعتله رسالة اختبار فعلية)
              <input value={destination} onChange={e => setDestination(e.target.value)} placeholder="01xxxxxxxxx" inputMode="numeric" />
            </label>
            <button className="admin-form-save" disabled={testing} onClick={testWhatsApp}>
              {testing ? 'جاري الإرسال...' : 'اختبار الاتصال'}
            </button>
            {testResult && <div className="admin-form-help">{testResult}</div>}
          </>
        )}
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">إشعارات المتصفح (Web Push)</div>
          <div className="admin-form-card-sub">تسجيل مفاتيح VAPID على السيرفر — بدون أي مزوّد خارجي</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>الحالة:</span><StatusBadge configured={status.push.configured} />
        </div>
        <div className="admin-form-help">عدد الاشتراكات المسجّلة حالياً: {status.push.subscriptionCount}</div>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">البريد الإلكتروني (Resend)</div>
          <div className="admin-form-card-sub">مستخدم فقط لإرسال روابط استعادة كلمة المرور</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>الحالة:</span><StatusBadge configured={status.email.configured} />
        </div>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">تخزين الصور (Cloudinary)</div>
          <div className="admin-form-card-sub">مستخدم لرفع صور المنتجات</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>الحالة:</span><StatusBadge configured={status.cloudinary.configured} />
        </div>
      </div>
    </div>
  )
}
