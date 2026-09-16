import type { AlertSeverity } from './api'

export const ALERT_SEVERITY_TINT: Record<AlertSeverity, { bg: string, fg: string }> = {
  info: { bg: '#EAF2FF', fg: '#1D5BBF' },
  warning: { bg: '#FFF3E3', fg: '#B4740E' },
  critical: { bg: '#FFF0EF', fg: '#B42318' }
}

export const ALERT_SEVERITY_ICON: Record<AlertSeverity, string> = { info: 'ℹ️', warning: '⚠️', critical: '🔴' }
