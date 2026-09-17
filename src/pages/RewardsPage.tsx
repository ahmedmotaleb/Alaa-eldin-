import { useEffect, useState } from 'react'
import { useAuth } from '../store/AuthContext'
import { useToast } from '../store/ToastContext'
import { getSettings } from '../store/settingsStore'
import { api, type ApiLoyaltySummary } from '../utils/api'
import { formatNumber, formatDate } from '../utils/format'
import { ar } from '../i18n/ar'

const SOURCE_LABEL: Record<ApiLoyaltySummary['ledger'][number]['sourceType'], string> = {
  order_delivered: ar.rewards.sourceOrderDelivered,
  referral_bonus: ar.rewards.sourceReferralBonus,
  manual_adjustment: ar.rewards.sourceManualAdjustment
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
        {perPointEgp !== null && (
          <div className="rewards-earn-note">{ar.rewards.earnRateNote(`${formatNumber(perPointEgp)} ${settings.currency}`)}</div>
        )}
      </div>

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
