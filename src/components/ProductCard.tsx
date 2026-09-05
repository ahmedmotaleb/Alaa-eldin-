import { useNavigate } from 'react-router-dom'
import type { Product } from '../types/models'
import { formatMoney } from '../utils/money'
import { useCart } from '../store/CartContext'

export function ProductCard({ product }: { product: Product }) {
  const navigate = useNavigate()
  const { addItem } = useCart()

  return (
    <article className="product-card">
      <button className="product-image-button" onClick={() => navigate(`/product/${product.slug}`)}>
        <img src={product.image} alt={product.name} className="product-image" />
        {product.offer && <span className="badge">عرض</span>}
      </button>
      <div className="product-card-body">
        <button className="product-title" onClick={() => navigate(`/product/${product.slug}`)}>
          {product.name}
        </button>
        <span className="product-unit">لكل {product.unit}</span>
        <div className="price-row">
          <strong>{formatMoney(product.price)}</strong>
          {product.oldPrice && <del>{formatMoney(product.oldPrice)}</del>}
        </div>
        <button
          className="primary-button small"
          disabled={!product.available}
          onClick={() => addItem(product.id)}
        >
          {product.available ? 'أضف للسلة' : 'غير متوفر'}
        </button>
      </div>
    </article>
  )
}
