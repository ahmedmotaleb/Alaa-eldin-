import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type CostBasis, type InventoryValuationSummary } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import type { LayoutContext } from '../../components/AdminLayout'

const BASIS_LABEL: Record<CostBasis, string> = {
  latest_cost: 'آخر تكلفة',
  weighted_average: 'متوسط تكلفة الشراء'
}

export function InventoryValuationPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [costBasis, setCostBasis] = useState<CostBasis>('latest_cost')
  const [valuation, setValuation] = useState<InventoryValuationSummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'المخزون', title: 'قيمة المخزون' })
  }, [setHeader])

  useEffect(() => {
    api.getInventoryValuation(costBasis)
      .then(setValuation)
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل تقييم المخزون' : 'حدث خطأ، حاول مرة أخرى'))
  }, [costBasis])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!valuation) return null

  return (
    <>
      <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8 }}>
        {(['latest_cost', 'weighted_average'] as CostBasis[]).map(basis => (
          <button
            key={basis}
            type="button"
            className={`admin-form-chip ${costBasis === basis ? 'active' : ''}`}
            onClick={() => setCostBasis(basis)}
          >
            {BASIS_LABEL[basis]}
          </button>
        ))}
      </div>
      <StatsGrid stats={[
        { label: 'الكمية القابلة للبيع', value: String(valuation.totalSellableQty), note: 'كل الكتالوج', icon: '📦', tint: '#EAF2FF' },
        { label: 'قيمة المخزون (بالتكلفة)', value: formatMoney(valuation.inventoryCostValue), note: `أساس التقييم: ${BASIS_LABEL[valuation.costBasis]}`, icon: '💰', tint: '#EAF8EF' },
        { label: 'قيمة منتهية الصلاحية', value: formatMoney(valuation.expiredValue), note: 'دفعات منتهية لسه في المخزون', icon: '⛔', tint: '#FFF0EF', noteColor: '#B42318' },
        { label: 'قيمة تحت حد التنبيه', value: formatMoney(valuation.lowStockValue), note: 'منتجات قاربت على النفاد', icon: '⚠️', tint: '#FFF3E3', noteColor: '#B45309' },
        {
          label: 'هامش إجمالي تقديري',
          value: valuation.estimatedGrossMarginPercent !== null ? `${valuation.estimatedGrossMarginPercent}%` : '—',
          note: `لو بيع كل المخزون الحالي بالأسعار الحالية (${formatMoney(valuation.estimatedRevenueAtCurrentPrices)})`,
          icon: '📈', tint: '#F3F0FF'
        }
      ]} />
      <div className="admin-placeholder-card">
        <div className="admin-placeholder-note">
          {valuation.costBasis === 'latest_cost'
            ? 'أساس التقييم المستخدم هو "آخر تكلفة" — تكلفة المنتج بتتحدّث تلقائياً بآخر تكلفة استلام فعلية.'
            : 'أساس التقييم المستخدم هو "متوسط تكلفة الشراء" — متوسط مرجّح لتكلفة الدفعات القابلة للبيع حالياً فعلياً (من سجل الاستلام الفعلي)، مش رقم تقديري.'}
          {' '}هذا تقدير تشغيلي لصحة المخزون وهامش الربح، وليس تقييماً محاسبياً أو ضريبياً معتمداً.
        </div>
      </div>
    </>
  )
}
