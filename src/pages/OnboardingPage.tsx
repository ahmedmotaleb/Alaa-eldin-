import { useNavigate } from 'react-router-dom'
import { markOnboarded } from '../utils/onboarding'
import { ar } from '../i18n/ar'

export function OnboardingPage() {
  const navigate = useNavigate()

  function enter() {
    markOnboarded()
    navigate('/', { replace: true })
  }

  return (
    <div className="onboarding-page">
      <div className="onboarding-blob onboarding-blob-a" />
      <div className="onboarding-blob onboarding-blob-b" />
      <div className="onboarding-hero">
        <div className="onboarding-logo">
          <img src="/images/logo.png" alt="علاء الدين" />
        </div>
        <div className="onboarding-copy">
          <h1>{ar.onboarding.title}</h1>
          <p>{ar.onboarding.subtitle}</p>
        </div>
      </div>
      <div className="onboarding-actions">
        <div className="onboarding-features">
          <div className="onboarding-feature"><span>🚚</span>{ar.onboarding.deliveryFeature}</div>
          <div className="onboarding-feature"><span>💵</span>{ar.onboarding.codFeature}</div>
          <div className="onboarding-feature"><span>🥬</span>{ar.onboarding.freshFeature}</div>
        </div>
        <button className="onboarding-primary" onClick={enter}>{ar.onboarding.start}</button>
        <button className="onboarding-skip" onClick={enter}>{ar.onboarding.skip}</button>
      </div>
    </div>
  )
}
