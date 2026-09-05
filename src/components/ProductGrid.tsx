import type { Product } from '../types/models'
import { ProductCard } from './ProductCard'

export function ProductGrid({ products }: { products: Product[] }) {
  if (!products.length) return <div className="empty-card">لا توجد منتجات حالياً.</div>
  return <div className="product-grid">{products.map(p => <ProductCard key={p.id} product={p} />)}</div>
}
