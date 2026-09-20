import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminReferralRow, type AdminReferralStatus } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import { formatDate } from '../../utils/format'
import type { LayoutContext } from '../../components/AdminLayout'

const STATUS_LABEL: Record<AdminReferralStatus, string> = {
  pending: 'معلّقة', qualified: 'مؤهّلة', rewarded: 'مكافأة'
}
const STATUS_TINT: Record<AdminReferralStatus, { bg: string, fg: string }> = {
  pending: { bg: '#FFF3E3', fg: '#B4740E' },
  qualified: { bg: '#EAF2FF', fg: '#1D5BBF' },
  rewarded: { bg: '#EAF8EF', fg: '#12813C' }
}

export function ReferralDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [referral, setReferral] = useState<AdminReferralRow | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'الإحالات', title: 'تفاصيل الإحالة' })
  }, [setHeader])

  useEffect(() => {
    if (!id) return
    api.getReferral(Number(id))
      .then(({ referral }) => setReferral(referral))
      .catch(err => setError(err instanceof ApiError && err.status === 404 ? 'الإحالة غير موجودة' : 'تعذر تحميل بيانات الإحالة'))
  }, [id])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!referral) return null

  const tint = STATUS_TINT[referral.status]

  return (
    <>
      <div className="admin-form-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
          <div>
            <div className="admin-form-card-title">كود الإحالة: {referral.referralCode}</div>
            <div className="admin-form-card-sub">مسجّل في {formatDate(referral.createdAt)}</div>
          </div>
          <span className="admin-pill" style={{ background: tint.bg, color: tint.fg }}>{STATUS_LABEL[referral.status]}</span>
        </div>
      </div>

      <div className="admin-form-grid">
        <div className="admin-form-card">
          <div className="admin-form-card-title">المُحيل</div>
          <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{referral.referrerName}</div>
          <button className="admin-form-chip" style={{ width: 'fit-content' }} onClick={() => navigate(`/customers/${referral.referrerUserId}`)}>عرض ملف العميل</button>
        </div>
        <div className="admin-form-card">
          <div className="admin-form-card-title">العميل المُحال</div>
          <div className="admin-cell-plain" style={{ fontWeight: 800 }}>{referral.referredName}</div>
          <button className="admin-form-chip" style={{ width: 'fit-content' }} onClick={() => navigate(`/customers/${referral.referredUserId}`)}>عرض ملف العميل</button>
        </div>
      </div>

      <div className="admin-form-card" style={{ marginTop: 16 }}>
        <div className="admin-form-card-title">شرط التأهيل والطلب المؤهِّل</div>
        {referral.qualifyingOrderId ? (
          <>
            <div className="admin-cell-plain">رقم الطلب: <strong>{referral.qualifyingOrderNumber}</strong></div>
            <div className="admin-cell-plain">قيمة الطلب: <strong>{referral.qualifyingOrderValue != null ? formatMoney(referral.qualifyingOrderValue) : '—'}</strong></div>
            <button className="admin-form-chip" style={{ width: 'fit-content' }} onClick={() => navigate(`/orders/${referral.qualifyingOrderId}`)}>عرض الطلب</button>
          </>
        ) : (
          <div className="admin-cell-plain" style={{ color: '#68746B' }}>لم يقم العميل المُحال بأي طلب مؤهِّل (تم تسليمه) بعد</div>
        )}
      </div>

      <div className="admin-form-card" style={{ marginTop: 16 }}>
        <div className="admin-form-card-title">حركات المكافأة</div>
        {referral.status === 'rewarded' ? (
          <>
            <div className="admin-cell-plain">مكافأة المُحيل: <strong style={{ color: '#12813C' }}>{referral.referrerRewardPoints ?? 0}+ نقطة</strong></div>
            <div className="admin-cell-plain">مكافأة العميل المُحال: <strong style={{ color: '#12813C' }}>{referral.referredRewardPoints != null ? `+${referral.referredRewardPoints} نقطة` : 'لا يوجد'}</strong></div>
            <div className="admin-cell-plain" style={{ color: '#68746B' }}>تاريخ المكافأة: {referral.rewardedAt ? formatDate(referral.rewardedAt) : '—'}</div>
            <div className="admin-form-help">حركات النقاط مسجّلة في سجل نقاط الولاء (loyalty_ledger) لكل من الطرفين على حدة</div>
          </>
        ) : (
          <div className="admin-cell-plain" style={{ color: '#68746B' }}>لم يتم صرف أي مكافأة بعد لهذه الإحالة</div>
        )}
      </div>
    </>
  )
}
