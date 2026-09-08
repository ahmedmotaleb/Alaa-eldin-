import type { Product } from '../types/models'
import { ProductGridCard } from './ProductGridCard'
import { ar } from '../i18n/ar'

export function ProductGrid({ products, layout = 'grid' }: { products: Product[], layout?: 'grid' | 'rail' }) {
  if (!products.length) return <div className="empty-card">{ar.common.noProducts}</div>
  return (
    <div className={layout === 'rail' ? 'product-rail' : 'product-grid'}>
      {products.map(p => <ProductGridCard key={p.id} product={p} layout={layout} />)}
    </div>
  )
}
