import { useEffect, useState } from 'react'
import { api, type ApiAlternativeProduct } from '../utils/api'
import { useCart } from '../store/CartContext'
import { useToast } from '../store/ToastContext'
import { formatMoney } from '../utils/money'
import { ar } from '../i18n/ar'

// بدائل مشابهة مُدارة يدوياً من الإدارة لمنتج غير متوفر داخل السلة — العميل لازم يختار
// بنفسه ويضيف البديل صراحةً؛ مفيش أي استبدال تلقائي للصنف الأصلي في السلة أبداً.
export function CartItemAlternatives({ productId }: { productId: string }) {
  const { addItem } = useCart()
  const flash = useToast()
  const [alternatives, setAlternatives] = useState<ApiAlternativeProduct[]>([])

  useEffect(() => {
    let cancelled = false
    api.getAlternatives(productId)
      .then(({ alternatives }) => { if (!cancelled) setAlternatives(alternatives.filter(a => a.available)) })
      .catch(() => { if (!cancelled) setAlternatives([]) })
    return () => { cancelled = true }
  }, [productId])

  if (alternatives.length === 0) return null

  return (
    <div className="cart-item-alternatives">
      <span className="cart-item-alternatives-title">{ar.product.similarAlternatives}</span>
      <div className="cart-item-alternatives-rail">
        {alternatives.map(alt => (
          <button
            key={alt.id}
            className="cart-item-alternative-chip"
            onClick={() => { addItem(alt.id); flash(ar.common.addedToCart) }}
          >
            <span className="cart-item-alternative-emoji">
              {alt.primaryImage ? <img src={alt.primaryImage} alt="" loading="lazy" /> : alt.emoji}
            </span>
            <span className="cart-item-alternative-name">{alt.name}</span>
            <span className="cart-item-alternative-price">{formatMoney(alt.price)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
