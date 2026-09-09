import type { Product } from '../types/models'
import { useCatalog } from '../store/CatalogContext'
import { transformImage, type ImageSize } from '../utils/image'
import { ar } from '../i18n/ar'

export function discountPercent(product: Product) {
  if (!product.oldPrice) return 0
  return Math.round((1 - product.price / product.oldPrice) * 100)
}

// حجم التحويل المطلوب من Cloudinary بيتحدد حسب المساحة الفعلية المعروضة — مفيش داعي
// نحمّل صورة detail (1000px) لكارت صغير في شبكة المنتجات.
function sizeForHeight(height: number): ImageSize {
  if (height <= 100) return 'thumbnail'
  if (height <= 200) return 'card'
  return 'detail'
}

export function ProductArt({
  product,
  height,
  width = '100%',
  fontSize,
  radius = 0,
  showBadge = true,
  showUnavailable = true,
  priority = false
}: {
  product: Product
  height: number
  width?: number | string
  fontSize: number
  radius?: number
  showBadge?: boolean
  showUnavailable?: boolean
  // الصورة الأولى الظاهرة فوق الشاشة مباشرة (زي صورة صفحة تفاصيل المنتج) — بتتحمّل
  // فوراً (eager) بأولوية عالية، بدل lazy، عشان تظهر أسرع من غير أي تأخير.
  priority?: boolean
}) {
  const { categories } = useCatalog()
  const tint = categories.find(c => c.id === product.categoryId)?.tint ?? '#F1F4F2'
  const discount = discountPercent(product)
  const numericHeight = typeof height === 'number' ? height : 100
  const imageUrl = transformImage(product.primaryImage, sizeForHeight(numericHeight))
  return (
    <div
      className="product-art"
      style={{ height, width, flex: typeof width === 'number' ? 'none' : undefined, fontSize, background: imageUrl ? '#fff' : tint, borderRadius: radius, position: 'relative', overflow: 'hidden' }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={product.primaryImageAlt || `صورة منتج ${product.name}`}
          loading={priority ? 'eager' : 'lazy'}
          // @ts-expect-error fetchpriority مش لسه في تعريفات React، لكنه attribute حقيقي مدعوم
          fetchpriority={priority ? 'high' : undefined}
          width={numericHeight}
          height={numericHeight}
          style={{ width: '100%', height: '100%', objectFit: 'contain', aspectRatio: '1 / 1' }}
        />
      ) : (
        product.emoji || '🛍️'
      )}
      {showBadge && discount > 0 && <span className="discount-badge">−{discount}%</span>}
      {showBadge && product.available && product.stockState === 'low_stock' && (
        <span className="low-stock-chip">{typeof product.lowStockRemaining === 'number' ? ar.product.lowStockRemaining(product.lowStockRemaining) : ar.product.lowStock}</span>
      )}
      {showUnavailable && !product.available && <span className="unavailable-overlay">{ar.product.unavailableNow}</span>}
    </div>
  )
}
