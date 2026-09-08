import { getSettings } from '../store/settingsStore'
import { formatCurrency } from './format'

export function formatMoney(value: number) {
  return formatCurrency(value, getSettings().currency)
}
