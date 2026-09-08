import type { Product } from '../types/models'
import { useCatalog } from '../store/CatalogContext'
import { ar } from '../i18n/ar'

export function discountPercent(product: Product) {
  if (!product.oldPrice) return 0
  return Math.round((1 - product.price / product.oldPrice) * 100)
}

export function ProductArt({
  product,
  height,
  width = '100%',
  fontSize,
  radius = 0,
  showBadge = true,
  showUnavailable = true
}: {
  product: Product
  height: number
  width?: number | string
  fontSize: number
  radius?: number
  showBadge?: boolean
  showUnavailable?: boolean
}) {
  const { categories } = useCatalog()
  const tint = categories.find(c => c.id === product.categoryId)?.tint ?? '#F1F4F2'
  const discount = discountPercent(product)
  return (
    <div
      className="product-art"
      style={{ height, width, flex: typeof width === 'number' ? 'none' : undefined, fontSize, background: product.primaryImage ? '#fff' : tint, borderRadius: radius, position: 'relative', overflow: 'hidden' }}
    >
      {product.primaryImage ? (
        <img
          src={product.primaryImage}
          alt={product.primaryImageAlt || `صورة منتج ${product.name}`}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'contain', aspectRatio: '1 / 1' }}
        />
      ) : (
        product.emoji
      )}
      {showBadge && discount > 0 && <span className="discount-badge">−{discount}%</span>}
      {showUnavailable && !product.available && <span className="unavailable-overlay">{ar.product.unavailableNow}</span>}
    </div>
  )
}
