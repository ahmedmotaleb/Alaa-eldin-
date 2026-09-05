import { STORE_CONFIG } from '../config/store'

export function formatMoney(value: number) {
  return `${value.toFixed(2)} ${STORE_CONFIG.currency}`
}
