import { useEffect, useState } from 'react'
import { ProductGrid } from './ProductGrid'
import { Section } from './Section'
import { api, type ApiProduct } from '../utils/api'
import { getRecentlyViewedIds, pruneRecentlyViewed } from '../utils/recentlyViewed'
import { ar } from '../i18n/ar'

// قسم "شوهد مؤخراً" — بيشتغل للزائر وللعميل المسجّل بنفس الطريقة (القايمة محلية بالكامل).
// السعر/التوفر بيتحقق منه دايماً من السيرفر وقت العرض (مش قيمة مخزّنة قديمة)، وأي منتج
// اتحذف فعلياً بيتشال تلقائياً من القايمة المحلية بعد الاستيثاق.
export function RecentlyViewedSection() {
  const [products, setProducts] = useState<ApiProduct[]>([])

  useEffect(() => {
    const ids = getRecentlyViewedIds()
    if (ids.length === 0) return
    let cancelled = false
    api.resolveProducts(ids).then(({ products: resolved }) => {
      if (cancelled) return
      pruneRecentlyViewed(new Set(resolved.map(p => p.id)))
      const byId = new Map(resolved.map(p => [p.id, p]))
      const ordered = ids.map(id => byId.get(id)).filter((p): p is ApiProduct => !!p)
      setProducts(ordered)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (products.length === 0) return null

  return (
    <Section title={ar.home.recentlyViewedTitle}>
      <ProductGrid products={products} layout="rail" />
    </Section>
  )
}
