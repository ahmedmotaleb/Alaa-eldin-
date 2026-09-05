import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ProductGrid } from '../components/ProductGrid'
import { QuantityCounter } from '../components/QuantityCounter'
import { products } from '../data/products'
import { useCart } from '../store/CartContext'
import { formatMoney } from '../utils/money'

export function ProductPage() {
  const { slug } = useParams()
  const product = products.find(p => p.slug === slug)
  const [quantity, setQuantity] = useState(1)
  const { addItem } = useCart()

  const similar = useMemo(
    () => products.filter(p => p.categoryId === product?.categoryId && p.id !== product?.id).slice(0, 4),
    [product]
  )

  if (!product) return <div className="empty-card">المنتج غير موجود.</div>

  return (
    <section>
      <article className="product-detail">
        <div className="detail-image-wrap">
          <img src={product.image} alt={product.name} className="detail-image" />
          {product.offer && <span className="badge detail-badge">عرض</span>}
        </div>

        <div className="detail-content">
          <span className={`stock ${product.available ? 'available' : 'unavailable'}`}>
            {product.available ? 'متوفر' : 'غير متوفر'}
          </span>
          <h1>{product.name}</h1>
          <p>{product.description}</p>
          <div className="detail-price">
            <strong>{formatMoney(product.price)}</strong>
            {product.oldPrice && <del>{formatMoney(product.oldPrice)}</del>}
          </div>
          <div className="detail-meta">الوحدة: {product.unit}</div>

          <div className="detail-action">
            <QuantityCounter value={quantity} onChange={value => setQuantity(Math.max(1, value))} />
            <button
              className="primary-button"
              disabled={!product.available}
              onClick={() => addItem(product.id, quantity)}
            >
              {product.available ? 'أضف للسلة' : 'غير متوفر'}
            </button>
          </div>
        </div>
      </article>

      <div className="page-title"><h2>منتجات مشابهة</h2></div>
      <ProductGrid products={similar} />
    </section>
  )
}
