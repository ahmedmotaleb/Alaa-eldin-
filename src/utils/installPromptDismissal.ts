const DISMISSED_AT_KEY = 'alaa-eldin-install-prompt-dismissed-at'
const INSTALLED_KEY = 'alaa-eldin-install-prompt-installed'
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000

export function isInstallPromptSnoozed(): boolean {
  try {
    if (localStorage.getItem(INSTALLED_KEY) === '1') return true
    const dismissedAt = Number(localStorage.getItem(DISMISSED_AT_KEY))
    return Number.isFinite(dismissedAt) && dismissedAt > 0 && Date.now() - dismissedAt < SNOOZE_MS
  } catch {
    return false
  }
}

export function snoozeInstallPrompt() {
  try {
    localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()))
  } catch {
    // مساحة التخزين مش متاحة، تجاهل — أسوأ حالة البانر يظهر تاني، مش خطأ حرج
  }
}

export function markAppInstalled() {
  try {
    localStorage.setItem(INSTALLED_KEY, '1')
  } catch {
    // تجاهل لنفس السبب أعلاه
  }
}
