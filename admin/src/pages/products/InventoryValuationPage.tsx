import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { StatsGrid } from '../../components/StatsGrid'
import { api, ApiError, type InventoryValuationSummary } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import type { LayoutContext } from '../../components/AdminLayout'

export function InventoryValuationPage() {
  const { setHeader } = useOutletContext<LayoutContext>()
  const [valuation, setValuation] = useState<InventoryValuationSummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setHeader({ crumb: 'المخزون', title: 'قيمة المخزون' })
  }, [setHeader])

  useEffect(() => {
    api.getInventoryValuation()
      .then(setValuation)
      .catch(err => setError(err instanceof ApiError ? 'تعذر تحميل تقييم المخزون' : 'حدث خطأ، حاول مرة أخرى'))
  }, [])

  if (error) return <div className="admin-placeholder-card"><div className="admin-placeholder-note">{error}</div></div>
  if (!valuation) return null

  return (
    <>
      <StatsGrid stats={[
        { label: 'الكمية القابلة للبيع', value: String(valuation.totalSellableQty), note: 'كل الكتالوج', icon: '📦', tint: '#EAF2FF' },
        { label: 'قيمة المخزون (بالتكلفة)', value: formatMoney(valuation.inventoryCostValue), note: 'أساس التقييم: أحدث تكلفة', icon: '💰', tint: '#EAF8EF' },
        { label: 'قيمة منتهية الصلاحية', value: formatMoney(valuation.expiredValue), note: 'دفعات منتهية لسه في المخزون', icon: '⛔', tint: '#FFF0EF', noteColor: '#B42318' },
        { label: 'قيمة تحت حد التنبيه', value: formatMoney(valuation.lowStockValue), note: 'منتجات قاربت على النفاد', icon: '⚠️', tint: '#FFF3E3', noteColor: '#B45309' }
      ]} />
      <div className="admin-placeholder-card">
        <div className="admin-placeholder-note">
          أساس التقييم المستخدم هو "أحدث تكلفة" (latest cost) — تكلفة المنتج بتتحدّث تلقائياً بآخر تكلفة استلام فعلية.
          هذا تقدير تشغيلي لصحة المخزون، وليس تقييماً محاسبياً معتمداً (متوسط التكلفة المرجّح غير مُستخدم هنا حالياً).
        </div>
      </div>
    </>
  )
}
