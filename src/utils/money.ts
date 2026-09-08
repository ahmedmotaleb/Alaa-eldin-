import { getSettings } from '../store/settingsStore'

export function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('ar-EG')} ${getSettings().currency}`
}
