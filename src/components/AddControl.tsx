import { useState } from 'react'
import type { Product } from '../types/models'
import { useCart } from '../store/CartContext'
import { useToast } from '../store/ToastContext'
import { WeightBottomSheet } from './WeightBottomSheet'
import { ar } from '../i18n/ar'

export function AddControl({ product, size = 'md' }: { product: Product, size?: 'sm' | 'md' }) {
  const { items, addItem, setQuantity } = useCart()
  const flash = useToast()
  const [sheetOpen, setSheetOpen] = useState(false)

  // منتج بمتغيرات (وزن/وحدة متعددة): الإضافة السريعة مبتقدرش تحدد وحدة واحدة بمفردها —
  // بتفتح شيت الاختيار بدل ما تضيف افتراض قد يكون غلط. العدّاد هنا بيعرض إجمالي الكمية عبر
  // كل المتغيرات المختارة فعلاً في السلة (مش سطر واحد بعينه).
  if (product.hasVariants) {
    const variantsQuantity = items
      .filter(item => item.productId === product.id && item.variantId !== undefined)
      .reduce((sum, item) => sum + item.quantity, 0)

    if (!product.available) return null

    return (
      <>
        <button
          className={`add-button unit-select ${size}`}
          onClick={() => setSheetOpen(true)}
          aria-label={ar.product.chooseQuantity}
        >
          {variantsQuantity > 0 ? <span className="add-button-badge">{variantsQuantity}</span> : ar.product.chooseQuantity}
        </button>
        {sheetOpen && <WeightBottomSheet product={product} onClose={() => setSheetOpen(false)} />}
      </>
    )
  }

  // الإضافة السريعة من كارت المنتج دايماً بتضيف المنتج الأساسي من غير متغير — لو المنتج له
  // متغيرات مختارة من صفحة التفاصيل، دي بنود منفصلة في السلة ومالهاش تأثير على العداد هنا.
  const quantity = items.find(item => item.productId === product.id && item.variantId === undefined)?.quantity ?? 0

  if (quantity > 0) {
    return (
      <div className={`add-stepper ${size}`}>
        <button onClick={() => setQuantity(product.id, quantity - 1)} aria-label={ar.common.decreaseQty}>−</button>
        <span>{quantity}</span>
        <button onClick={() => setQuantity(product.id, quantity + 1)} aria-label={ar.common.increaseQty}>+</button>
      </div>
    )
  }

  if (!product.available) return null

  return (
    <button
      className={`add-button ${size}`}
      onClick={() => { addItem(product.id); flash(ar.common.addedToCart) }}
      aria-label={ar.common.addProductToCart(product.name)}
    >
      +
    </button>
  )
}
