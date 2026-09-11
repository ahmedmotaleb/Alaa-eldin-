import { useEffect, useState } from 'react'
import { ProductGrid } from './ProductGrid'
import { Section } from './Section'
import { useCart } from '../store/CartContext'
import { api } from '../utils/api'
import type { Product } from '../types/models'
import { ar } from '../i18n/ar'

const UPSELL_LIMIT = 6

// اقتراحات "أكمل طلبك" — استراتيجية بسيطة عن قصد (بدون محرك توصيات): منتجات متاحة من نفس
// قسم أول صنف في السلة، مرتبة بالأكثر طلباً، من غير أي صنف موجود في السلة أصلاً. التحميل
// غير حاجب (lazy) عشان محتوى السلة الأساسي يتعرض فوراً من غير انتظار الاقتراحات.
export function CartUpsell() {
  const { detailedItems } = useCart()
  const [suggestions, setSuggestions] = useState<Product[]>([])
  const categoryId = detailedItems[0]?.product.categoryId

  useEffect(() => {
    if (!categoryId) {
      setSuggestions([])
      return
    }
    let cancelled = false
    const cartIds = new Set(detailedItems.map(i => i.productId))
    api.listProducts({ category: categoryId, sort: 'popular', available: true, limit: UPSELL_LIMIT + cartIds.size })
      .then(({ products }) => {
        if (cancelled) return
        setSuggestions(products.filter(p => !cartIds.has(p.id)).slice(0, UPSELL_LIMIT))
      })
      .catch(() => { if (!cancelled) setSuggestions([]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId])

  if (suggestions.length === 0) return null

  return (
    <Section title={ar.cart.completeYourOrder}>
      <ProductGrid products={suggestions} layout="rail" />
    </Section>
  )
}
