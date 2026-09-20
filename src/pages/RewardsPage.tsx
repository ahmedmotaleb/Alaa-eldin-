import { useEffect, useState } from 'react'
import { useAuth } from '../store/AuthContext'
import { useToast } from '../store/ToastContext'
import { getSettings } from '../store/settingsStore'
import { api, type ApiLoyaltySummary, type ApiLoyaltySourceType } from '../utils/api'
import { formatMoney } from '../utils/money'
import { formatNumber, formatDate } from '../utils/format'
import { ar } from '../i18n/ar'

const SOURCE_LABEL: Record<ApiLoyaltySourceType, string> = {
  order_delivered: ar.rewards.sourceOrderDelivered,
  referral_bonus: ar.rewards.sourceReferralBonus,
  manual_adjustment: ar.rewards.sourceManualAdjustment,
  redeemed: ar.rewards.sourceRedeemed,
  redemption_reversal: ar.rewards.sourceRedemptionReversal,
  earned_reversal: ar.rewards.sourceEarnedReversal,
  expired: ar.rewards.sourceExpired
}

export function RewardsPage() {
  const { user, loading: authLoading } = useAuth()
  const flash = useToast()
  const [summary, setSummary] = useState<ApiLoyaltySummary | null>(null)
  const settings = getSettings()

  useEffect(() => {
    if (!user) return
    api.getLoyalty().then(setSummary).catch(() => {})
  }, [user])

  if (authLoading) return null
  if (!user) return <div className="empty-card">{ar.rewards.loginRequired}</div>
  if (!summary) return null

  const perPointEgp = settings.loyaltyPointsPerEgp > 0 ? Math.round(1 / settings.loyaltyPointsPerEgp) : null
  // نفس رابط التسجيل اللي بيقرأ ?ref= بالفعل (RegisterPage) — بيستخدم دومين التطبيق العام
  // نفسه، ومفيش أي معرّف داخلي للمستخدم مكشوف في الرابط، بس كود الإحالة العام.
  const referralLink = `${window.location.origin}/register?ref=${summary.referralCode}`

  async function shareReferral() {
    if (navigator.share) {
      try {
        await navigator.share({ title: ar.rewards.referralTitle, url: referralLink })
      } catch {
        // المستخدم لغى المشاركة
      }
      return
    }
    try {
      await navigator.clipboard.writeText(referralLink)
      flash(ar.rewards.linkCopied)
    } catch {
      // الحافظة مش متاحة — لا شيء إضافي ممكن نعمله
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(summary!.referralCode)
      flash(ar.rewards.linkCopied)
    } catch {
      // الحافظة مش متاحة
    }
  }

  return (
    <div className="rewards-page">
      <div className="rewards-balance-card">
        <div className="rewards-balance-number">{formatNumber(summary.balance)}</div>
        <div className="rewards-balance-label">{ar.rewards.pointsBalance(formatNumber(summary.balance))}</div>
        {settings.loyaltyEnabled && (
          <div className="rewards-earn-note">{ar.rewards.pointsBalanceEgp(formatMoney(summary.balance * settings.loyaltyPointValueEgp))}</div>
        )}
        {perPointEgp !== null && (
          <div className="rewards-earn-note">{ar.rewards.earnRateNote(`${formatNumber(perPointEgp)} ${settings.currency}`)}</div>
        )}
      </div>

      {settings.loyaltyEnabled && (
        <div className="rewards-referral-card">
          <h2>{ar.rewards.redemptionRulesTitle}</h2>
          <ul className="rewards-rules-list">
            <li>{ar.rewards.redemptionPointValueNote(formatMoney(settings.loyaltyPointValueEgp))}</li>
            {settings.loyaltyMinRedeemPoints > 0 && (
              <li>{ar.rewards.redemptionMinPointsNote(formatNumber(settings.loyaltyMinRedeemPoints))}</li>
            )}
            <li>{ar.rewards.redemptionMaxPercentNote(formatNumber(settings.loyaltyMaxRedemptionPercent))}</li>
            {settings.loyaltyMinOrderForRedemption > 0 && (
              <li>{ar.rewards.redemptionMinOrderNote(formatMoney(settings.loyaltyMinOrderForRedemption))}</li>
            )}
          </ul>
        </div>
      )}

      {settings.loyaltyExpiryEnabled && summary.upcomingExpiry.length > 0 && (
        <div className="rewards-referral-card">
          <h2>{ar.rewards.expiryTitle}</h2>
          <ul className="rewards-rules-list">
            {summary.upcomingExpiry.map((entry, i) => (
              <li key={i}>{ar.rewards.expiryNote(formatNumber(entry.points), formatDate(entry.expiresAt))}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="rewards-referral-card">
        <h2>{ar.rewards.referralTitle}</h2>
        <p>{ar.rewards.referralNote}</p>
        <div className="rewards-referral-code">{summary.referralCode}</div>
        <div className="rewards-referral-actions">
          <button className="secondary-button" onClick={copyCode}>{ar.rewards.copyCode}</button>
          <button className="primary-button" onClick={shareReferral}>{ar.rewards.shareLink}</button>
        </div>
        <div className="rewards-referral-stats">
          <span>{ar.rewards.referralPending(formatNumber(summary.referralStats.pending))}</span>
          <span>{ar.rewards.referralQualified(formatNumber(summary.referralStats.qualified))}</span>
          <span>{ar.rewards.referralRewarded(formatNumber(summary.referralStats.rewarded))}</span>
        </div>
      </div>

      <div className="rewards-ledger-card">
        <h2>{ar.rewards.ledgerTitle}</h2>
        {summary.ledger.length === 0 && <p className="rewards-ledger-empty">{ar.rewards.noLedgerEntries}</p>}
        {summary.ledger.map(entry => (
          <div className="rewards-ledger-row" key={entry.id}>
            <div>
              <div className="rewards-ledger-source">{SOURCE_LABEL[entry.sourceType]}</div>
              <div className="rewards-ledger-date">{formatDate(entry.createdAt)}</div>
            </div>
            <div className={`rewards-ledger-points ${entry.pointsChange < 0 ? 'negative' : 'positive'}`}>
              {entry.pointsChange > 0 ? '+' : ''}{formatNumber(entry.pointsChange)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
