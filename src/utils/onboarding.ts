const ONBOARDING_KEY = 'alaa-eldin-onboarded'

export function hasOnboarded() {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === '1'
  } catch {
    return true
  }
}

export function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDING_KEY, '1')
  } catch {
    // storage unavailable, ignore
  }
}
