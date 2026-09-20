import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import {
  api, ApiError, type AdminCustomer, type AdminCustomerOrder,
  type LoyaltyLedgerEntry, type LoyaltySourceType, type ReferralStats
} from '../../utils/api'
import { formatMoney } from '../../utils/money'
import { formatDate } from '../../utils/format'
import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL } from '../../orderStatus'
import type { LayoutContext } from '../../components/AdminLayout'

const COLS = '1.2fr 1fr 1fr 1fr'
const LEDGER_COLS = '1fr 0.8fr 1.6fr 0.8fr'

const SOURCE_LABEL: Record<LoyaltySourceType, string> = {
  order_delivered: 'اكتساب من طلب',
  referral_bonus: 'مكافأة إحالة',
  manual_adjustment: 'تعديل يدوي',
  redeemed: 'استخدام نقاط',
  redemption_reversal: 'استرجاع بعد إلغاء',
  earned_reversal: 'إلغاء نقاط مكتسبة',
  expired: 'انتهاء صلاحية'
}

export function CustomerDetailPage() {
  const { id } = useParams()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [customer, setCustomer] = useState<AdminCustomer | null>(null)
  const [orders, setOrders] = useState<AdminCustomerOrder[]>([])
  const [loyaltyBalance, setLoyaltyBalance] = useState(0)
  const [loyaltyLedger, setLoyaltyLedger] = useState<LoyaltyLedgerEntry[]>([])
  const [referralStats, setReferralStats] = useState<ReferralStats>({ pending: 0, qualified: 0, rewarded: 0 })
  const [error, setError] = useState('')

  const [adjustPoints, setAdjustPoints] = useState('')
  const [adjustNote, setAdjustNote] = useState('')
  const [adjustExpiryPolicy, setAdjustExpiryPolicy] = useState<'default' | 'never'>('default')
  const [adjustError, setAdjustError] = useState('')
  const [adjustSaving, setAdjustSaving] = useState(false)

  useEffect(() => {
    setHeader({ crumb: 'العملاء', title: 'ملف العميل' })
  }, [setHeader])

  function loadCustomer() {
    if (!id) return
    api.getCustomer(id)
      .then(({ customer, orders, loyaltyBalance, loyaltyLedger, referralStats }) => {
        setCustomer(customer); setOrders(orders)
        setLoyaltyBalance(loyaltyBalance); setLoyaltyLedger(loyaltyLedger); setReferralStats(referralStats)
      })
      .catch(err => setError(err instanceof ApiError && err.status === 404 ? 'العميل غير موجود' : 'تعذر تحميل بيانات العميل'))
  }

  useEffect(loadCustomer, [id])

  const adjustPointsNum = Math.round(Number(adjustPoints))
  const adjustValid = adjustPoints.trim() !== '' && Number.isInteger(adjustPointsNum) && adjustPointsNum !== 0 && adjustNote.trim() !== ''
  const resultingBalance = loyaltyBalance + (Number.isFinite(adjustPointsNum) ? adjustPointsNum : 0)

  async function submitAdjustment() {
    if (!id || !adjustValid) return
    setAdjustError('')
    if (resultingBalance < 0) {
      setAdjustError('لا يمكن أن يصبح الرصيد سالباً')
      return
    }
    setAdjustSaving(true)
    try {
      await api.adjustCustomerLoyalty(id, { points: adjustPointsNum, note: adjustNote.trim(), expiryPolicy: adjustExpiryPolicy })
      setAdjustPoints(''); setAdjustNote(''); setAdjustExpiryPolicy('default')
      loadCustomer()
    } catch (err) {
      setAdjustError(err instanceof ApiError && err.code === 'resulting_balance_negative'
        ? 'لا يمكن أن يصبح الرصيد سالباً'
        : 'تعذر تنفيذ التعديل')
    } finally {
      setAdjustSaving(false)
    }
  }

  useEffect(() => {
    if (customer) setHeader({ crumb: 'العملاء', title: customer.fullName })
  }, [customer, setHeader])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!customer) return null

  return (
    <>
      <div className="admin-form-card" style={{ marginBottom: 16 }}>
        <div className="admin-form-card-title">{customer.fullName}</div>
        <div className="admin-form-card-sub">{customer.email}{customer.lastMobile ? ` · ${customer.lastMobile}` : ''}</div>
        <div className="admin-cell-plain" style={{ color: '#68746B' }}>
          عضو منذ {formatDate(customer.createdAt)}
        </div>
      </div>

      <StatsGrid stats={[
        { label: 'عدد الطلبات', value: String(customer.orderCount), note: 'منذ التسجيل', icon: '🧾', tint: '#EAF2FF' },
        { label: 'إجمالي الإنفاق', value: formatMoney(customer.totalSpent), note: 'كل الطلبات', icon: '💰', tint: '#EAF8EF' },
        { label: 'متوسط الطلب', value: formatMoney(customer.orderCount ? customer.totalSpent / customer.orderCount : 0), note: 'لكل طلب', icon: '🛒', tint: '#FFF3E3' }
      ]} />

      <div className="admin-table-card">
        <div className="admin-table-scroll">
          <div style={{ minWidth: 560 }}>
            <div className="admin-table-head" style={{ gridTemplateColumns: COLS }}>
              <div>رقم الطلب</div><div>التاريخ</div><div>الإجمالي</div><div>الحالة</div>
            </div>
            {orders.map(o => {
              const [bg, fg] = ORDER_STATUS_COLOR[o.status]
              return (
                <div key={o.id} className="admin-table-row" style={{ gridTemplateColumns: COLS }}>
                  <div className="admin-cell-plain" style={{ fontWeight: 900 }}>{o.id}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{formatDate(o.createdAt)}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 800, color: '#12813C' }}>{formatMoney(o.total)}</div>
                  <div><span className="admin-pill" style={{ background: bg, color: fg }}>{ORDER_STATUS_LABEL[o.status]}</span></div>
                </div>
              )
            })}
            {orders.length === 0 && <div className="admin-table-empty">لا يوجد طلبات لهذا العميل بعد</div>}
          </div>
        </div>
        <div className="admin-table-footer">
          <span>{orders.length} طلب</span>
          <span>سجل طلبات العميل الكامل</span>
        </div>
      </div>

      <StatsGrid stats={[
        { label: 'رصيد نقاط الولاء', value: String(loyaltyBalance), note: 'نقطة', icon: '⭐', tint: '#FFF3E3' },
        { label: 'إحالات معلّقة', value: String(referralStats.pending), note: 'قيد التأهيل', icon: '⏳', tint: '#EAF2FF' },
        { label: 'إحالات مكافأة', value: String(referralStats.rewarded), note: `+ ${referralStats.qualified} مؤهّلة`, icon: '🎁', tint: '#EAF8EF' }
      ]} />

      <div className="admin-form-grid" style={{ marginTop: 16 }}>
        <div className="admin-table-card">
          <div className="admin-table-scroll">
            <div style={{ minWidth: 560 }}>
              <div className="admin-table-head" style={{ gridTemplateColumns: LEDGER_COLS }}>
                <div>النوع</div><div>النقاط</div><div>ملاحظة</div><div>التاريخ</div>
              </div>
              {loyaltyLedger.map(entry => (
                <div key={entry.id} className="admin-table-row" style={{ gridTemplateColumns: LEDGER_COLS }}>
                  <div className="admin-cell-plain">{SOURCE_LABEL[entry.sourceType]}</div>
                  <div className="admin-cell-plain" style={{ fontWeight: 800, color: entry.pointsChange < 0 ? '#B3261E' : '#12813C' }}>
                    {entry.pointsChange > 0 ? `+${entry.pointsChange}` : entry.pointsChange}
                  </div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{entry.note}</div>
                  <div className="admin-cell-plain" style={{ color: '#68746B' }}>{formatDate(entry.createdAt)}</div>
                </div>
              ))}
              {loyaltyLedger.length === 0 && <div className="admin-table-empty">لا يوجد سجل نقاط لهذا العميل بعد</div>}
            </div>
          </div>
          <div className="admin-table-footer">
            <span>آخر {loyaltyLedger.length} حركة</span>
            <span>سجل نقاط الولاء</span>
          </div>
        </div>

        <div className="admin-form-card">
          <div>
            <div className="admin-form-card-title">تعديل يدوي لرصيد النقاط</div>
            <div className="admin-form-card-sub">الرصيد الحالي: {loyaltyBalance} نقطة — السبب إلزامي ولا يمكن أن يصبح الرصيد الناتج سالباً</div>
          </div>
          <label>عدد النقاط (موجب للإضافة، سالب للخصم)
            <input type="number" step={1} value={adjustPoints} onChange={e => setAdjustPoints(e.target.value)} placeholder="مثال: 100 أو -50" />
          </label>
          <label>السبب
            <input value={adjustNote} onChange={e => setAdjustNote(e.target.value)} placeholder="سبب التعديل (إلزامي)" />
          </label>
          {adjustPointsNum > 0 && (
            <label>سياسة انتهاء الصلاحية لهذه النقاط
              <span className="admin-form-chips">
                <button type="button" className={`admin-form-chip ${adjustExpiryPolicy === 'default' ? 'active' : ''}`} onClick={() => setAdjustExpiryPolicy('default')}>تتبع سياسة انتهاء النقاط</button>
                <button type="button" className={`admin-form-chip ${adjustExpiryPolicy === 'never' ? 'active' : ''}`} onClick={() => setAdjustExpiryPolicy('never')}>لا تنتهي</button>
              </span>
            </label>
          )}
          {adjustValid && (
            <div className="admin-cell-plain" style={{ color: '#68746B' }}>
              الرصيد بعد التعديل: <strong style={{ color: resultingBalance < 0 ? '#B3261E' : '#12813C' }}>{resultingBalance}</strong> نقطة
            </div>
          )}
          {adjustError && <div className="admin-form-error">{adjustError}</div>}
          <button className="admin-form-save" disabled={!adjustValid || adjustSaving} onClick={submitAdjustment}>تنفيذ التعديل</button>
        </div>
      </div>
    </>
  )
}
