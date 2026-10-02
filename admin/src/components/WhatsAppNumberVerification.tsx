import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../utils/api'
import { isValidEgyptianMobile } from '../utils/phone'

// بس للعرض — مش التحقق الفعلي (ده دايماً في السيرفر). نفس شكل maskPhone في السيرفر
// (server/src/logger.ts): أول 3 أرقام + تعتيم + آخر 4 أرقام.
function maskPhone(phone: string): string {
  if (phone.length < 7) return '*'.repeat(phone.length)
  return `${phone.slice(0, 3)}${'*'.repeat(phone.length - 7)}${phone.slice(-4)}`
}

const RESEND_COOLDOWN_SECONDS = 60

interface Props {
  currentNumber: string
  onChanged: (newNumber: string) => void
}

type Step = 'closed' | 'enter-phone' | 'enter-code'

export function WhatsAppNumberVerification({ currentNumber, onChanged }: Props) {
  const [step, setStep] = useState<Step>('closed')
  const [newPhone, setNewPhone] = useState('')
  const [code, setCode] = useState('')
  const [verificationId, setVerificationId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current) }, [])

  function startCooldown(seconds: number) {
    if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    setCooldown(seconds)
    cooldownTimer.current = setInterval(() => {
      setCooldown(current => {
        if (current <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current)
          return 0
        }
        return current - 1
      })
    }, 1000)
  }

  function openModal() {
    setNewPhone('')
    setCode('')
    setVerificationId('')
    setError('')
    setNotice('')
    setStep('enter-phone')
  }

  // إغلاق (X/الخلفية) أو تحديث الصفحة — أبداً ما بيفعّل الرقم الجديد؛ بس بيصفّر حالة
  // الواجهة المحلية، من غير ما يلغي التحقق فعلياً على السيرفر (ده بس لزرار "إلغاء" الصريح).
  function closeModal() {
    setStep('closed')
  }

  async function submitPhone() {
    setError('')
    const trimmed = newPhone.trim()
    if (!isValidEgyptianMobile(trimmed)) {
      setError('أدخل رقم واتساب مصري صحيح مكون من 11 رقم ويبدأ بـ 010 أو 011 أو 012 أو 015')
      return
    }
    setSending(true)
    try {
      const { verificationId: id } = await api.requestWhatsAppNumberVerification(trimmed)
      setVerificationId(id)
      setStep('enter-code')
      setNotice('تم إرسال كود التأكيد على واتساب')
      startCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'invalid_phone') setError('أدخل رقم واتساب مصري صحيح مكون من 11 رقم ويبدأ بـ 010 أو 011 أو 012 أو 015')
        else if (err.code === 'whatsapp_verification_not_configured') setError('تعذر إرسال كود التأكيد عبر واتساب لأن خدمة التحقق غير مفعلة.')
        else if (err.code === 'resend_cooldown') setError('انتظر قليلاً قبل طلب كود جديد')
        else setError('تعذر إرسال كود التأكيد، حاول مرة أخرى')
      } else {
        setError('تعذر إرسال كود التأكيد، حاول مرة أخرى')
      }
    } finally {
      setSending(false)
    }
  }

  async function resendCode() {
    if (cooldown > 0 || sending) return
    setError('')
    setNotice('')
    setSending(true)
    try {
      const { verificationId: id } = await api.requestWhatsAppNumberVerification(newPhone.trim())
      setVerificationId(id)
      setNotice('تم إرسال كود التأكيد على واتساب')
      startCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'resend_cooldown') setError('انتظر قليلاً قبل طلب كود جديد')
      else setError('تعذر إرسال كود التأكيد، حاول مرة أخرى')
    } finally {
      setSending(false)
    }
  }

  async function submitCode() {
    setError('')
    if (!/^\d{6}$/.test(code)) {
      setError('كود التأكيد غير صحيح')
      return
    }
    setVerifying(true)
    try {
      const { settings } = await api.verifyWhatsAppNumberCode(verificationId, code)
      onChanged(settings.whatsappNumber)
      setStep('closed')
      setNotice('تم تأكيد الرقم وتغييره بنجاح')
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'invalid_verification_code') setError('كود التأكيد غير صحيح')
        else if (err.code === 'verification_code_expired') setError('انتهت صلاحية الكود، اطلب كوداً جديداً')
        else if (err.code === 'verification_attempts_exceeded') setError('تم تجاوز عدد المحاولات المسموح')
        else setError('تعذر التحقق من الكود، اطلب كوداً جديداً')
      } else {
        setError('تعذر الاتصال بالسيرفر')
      }
    } finally {
      setVerifying(false)
    }
  }

  async function cancelVerification() {
    if (verificationId) {
      try { await api.cancelWhatsAppNumberVerification(verificationId) } catch { /* أفضل-جهد — الإغلاق بيحصل برضه */ }
    }
    setStep('closed')
  }

  return (
    <div className="admin-form-card">
      <div>
        <div className="admin-form-card-title">رقم واتساب خدمة العملاء</div>
        <div className="admin-form-card-sub">الرقم اللي بتوصل عليه طلبات العملاء — تغييره محتاج تأكيد بكود عبر واتساب</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 16 }}>{maskPhone(currentNumber)}</span>
        <span className="admin-form-chip active" style={{ pointerEvents: 'none' }}>✓ رقم مؤكد</span>
        <button type="button" className="admin-form-save" style={{ marginInlineStart: 'auto' }} onClick={openModal}>تغيير الرقم</button>
      </div>

      {notice && step === 'closed' && <div className="admin-form-success">{notice}</div>}

      {step !== 'closed' && (
        <div className="admin-drawer-overlay" onClick={closeModal}>
          <div className="admin-drawer" role="dialog" aria-modal="true" aria-label="تغيير رقم واتساب خدمة العملاء" onClick={e => e.stopPropagation()}>
            <div className="admin-drawer-head">
              <div className="admin-drawer-title">تغيير رقم واتساب خدمة العملاء</div>
              <button className="admin-drawer-close" onClick={closeModal} aria-label="إغلاق">×</button>
            </div>

            {step === 'enter-phone' && (
              <div className="admin-form-card">
                <label>رقم واتساب الجديد
                  <input
                    value={newPhone}
                    onChange={e => setNewPhone(e.target.value)}
                    placeholder="01012345678"
                    inputMode="numeric"
                    maxLength={11}
                    autoFocus
                  />
                  <span className="admin-form-help">بالصيغة المحلية المصرية فقط — مثال: 01012345678 (بدون +20)</span>
                </label>
                {error && <div className="admin-form-error">{error}</div>}
                <button className="admin-form-save" disabled={sending} onClick={submitPhone}>
                  {sending ? 'جارِ الإرسال...' : 'إرسال كود التأكيد'}
                </button>
              </div>
            )}

            {step === 'enter-code' && (
              <div className="admin-form-card">
                <div>أرسلنا كود تأكيد إلى</div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{maskPhone(newPhone.trim())}</div>
                <label>كود التأكيد
                  <input
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="123456"
                    autoFocus
                  />
                </label>
                {notice && <div className="admin-form-success">{notice}</div>}
                {error && <div className="admin-form-error">{error}</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="admin-form-save" disabled={verifying} onClick={submitCode}>
                    {verifying ? 'جارِ التأكيد...' : 'تأكيد الرقم'}
                  </button>
                  <button type="button" className="admin-form-chip" disabled={cooldown > 0 || sending} onClick={resendCode}>
                    {cooldown > 0 ? `يمكنك إعادة إرسال الكود بعد ${cooldown} ثانية` : (sending ? 'جارِ الإرسال...' : 'إعادة إرسال الكود')}
                  </button>
                  <button type="button" className="admin-form-chip" onClick={cancelVerification}>إلغاء</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
