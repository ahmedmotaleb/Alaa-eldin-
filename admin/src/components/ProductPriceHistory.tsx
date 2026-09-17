import { useEffect, useState } from 'react'
import { api, type ProductPriceHistoryEntry } from '../utils/api'
import { formatCurrency, formatDateTime } from '../utils/format'

const SOURCE_LABEL: Record<string, string> = {
  manual_edit: 'تعديل يدوي',
  bulk_csv: 'تحديث بالجملة (CSV)',
  bulk_adjustment: 'تعديل سريع بالجملة',
  rollback: 'تراجع عن عملية'
}

export function ProductPriceHistory({ productId }: { productId: string }) {
  const [history, setHistory] = useState<ProductPriceHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getProductPriceHistory(productId)
      .then(({ history }) => setHistory(history))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [productId])

  if (loading) return null
  if (history.length === 0) return null

  return (
    <div className="admin-form-card">
      <div>
        <div className="admin-form-card-title">سجل الأسعار</div>
        <div className="admin-form-card-sub">كل تغيير في السعر أو السعر قبل الخصم، الأحدث أولاً</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 360, overflowY: 'auto' }}>
        {history.map(entry => (
          <div key={entry.id} style={{ borderBottom: '1px solid #EEF1EE', paddingBottom: 8, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700 }}>
                {entry.variantName ? `المتغير: ${entry.variantName}` : 'المنتج الأساسي'}
              </span>
              <span style={{ color: '#68746B' }}>{formatDateTime(entry.createdAt)}</span>
            </div>
            <div style={{ color: '#2A3129' }}>
              السعر: {formatCurrency(entry.oldPrice)} ← {formatCurrency(entry.newPrice)}
              {entry.newOldPrice !== entry.oldOldPrice && (
                <span style={{ color: '#68746B' }}>
                  {' '}· السعر قبل الخصم: {entry.oldOldPrice !== null ? formatCurrency(entry.oldOldPrice) : 'بدون'} ← {entry.newOldPrice !== null ? formatCurrency(entry.newOldPrice) : 'بدون'}
                </span>
              )}
            </div>
            <div style={{ color: '#8A948C' }}>
              {SOURCE_LABEL[entry.source] ?? entry.source}
              {entry.adminName ? ` · ${entry.adminName}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
