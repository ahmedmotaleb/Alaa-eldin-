import { useNavigate } from 'react-router-dom'
import type { Product } from '../types/models'
import { ProductArt } from './ProductArt'
import { AddControl } from './AddControl'
import { formatMoney } from '../utils/money'

export function ProductGridCard({ product, layout = 'grid' }: { product: Product, layout?: 'grid' | 'rail' }) {
  const navigate = useNavigate()
  const open = () => navigate(`/product/${product.slug}`)

  return (
    <article className={`product-grid-card ${layout}`}>
      <button className="product-art-button" onClick={open}>
        <ProductArt product={product} height={112} fontSize={50} />
      </button>
      <div className="product-grid-card-body">
        <button className="product-grid-card-title" onClick={open}>{product.name}</button>
        <span className="product-grid-card-unit">{product.unit}</span>
        <div className="product-grid-card-footer">
          <div className="product-grid-card-price">
            <span className="price">{formatMoney(product.price)}</span>
            {product.oldPrice && <s>{formatMoney(product.oldPrice)}</s>}
          </div>
          <AddControl product={product} />
        </div>
      </div>
    </article>
  )
}
