import type { Product } from '../types/models'
import { useCart } from '../store/CartContext'
import { useToast } from '../store/ToastContext'
import { ar } from '../i18n/ar'

export function AddControl({ product, size = 'md' }: { product: Product, size?: 'sm' | 'md' }) {
  const { items, addItem, setQuantity } = useCart()
  const flash = useToast()
  const quantity = items.find(item => item.productId === product.id)?.quantity ?? 0

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
