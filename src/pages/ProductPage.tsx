import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ProductArt } from '../components/ProductArt'
import { ProductGallery } from '../components/ProductGallery'
import { FavoriteButton } from '../components/FavoriteButton'
import { StickyActionBar } from '../components/StickyActionBar'
import { useCart } from '../store/CartContext'
import { useToast } from '../store/ToastContext'
import { setPageTitle } from '../store/pageTitleStore'
import { setPageMeta, setProductJsonLd, clearProductJsonLd } from '../utils/pageMeta'
import { getSettings } from '../store/settingsStore'
import { api, type ApiProductDetail } from '../utils/api'
import { formatMoney } from '../utils/money'
import { recordProductView } from '../utils/recentlyViewed'
import { ProductGrid } from '../components/ProductGrid'
import { ar } from '../i18n/ar'

export function ProductPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { items, addItem } = useCart()
  const flash = useToast()
  const [product, setProduct] = useState<ApiProductDetail | null | undefined>(undefined)
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(undefined)

  // صفحة المنتج بتجيب تفاصيله (وصف، معرض صور، بدائل، منتجات مشابهة) من GET /api/products/:slug
  // مباشرة — من غير ما تحتاج الكتالوج كامل محمّل مقدماً.
  useEffect(() => {
    if (!slug) return
    let cancelled = false
    setProduct(undefined)
    api.getProduct(slug)
      .then(({ product }) => { if (!cancelled) setProduct(product) })
      .catch(() => { if (!cancelled) setProduct(null) })
    return () => { cancelled = true }
  }, [slug])

  useEffect(() => {
    setPageTitle(product?.name ?? '')
    return () => setPageTitle('')
  }, [product?.name])

  useEffect(() => {
    if (product) recordProductView(product.id)
  }, [product?.id])

  // كل منتج جديد يبدأ بدون اختيار متغير محفوظ من صفحة سابقة — الاختيار الافتراضي (أول متغير
  // متاح) بيتحسب في الأسفل بدل ما ننتظر تشغيل useEffect، عشان ما يظهرش وميض "غير متوفر" لحظي.
  useEffect(() => {
    setSelectedVariantId(undefined)
  }, [slug])

  useEffect(() => {
    if (!product || !slug) return
    const primaryImage = product.gallery.find(img => img.isPrimary) ?? product.gallery[0]
    setPageMeta({
      title: `${product.name} - ${getSettings().name}`,
      description: product.description || product.name,
      path: `/product/${slug}`,
      image: primaryImage?.url,
      type: 'product'
    })
    setProductJsonLd({
      name: product.name,
      description: product.description || product.name,
      image: primaryImage?.url,
      brand: product.brand,
      price: product.price,
      currency: 'EGP',
      available: product.available,
      path: `/product/${slug}`
    })
    return () => clearProductJsonLd()
  }, [product, slug])

  if (product === null) return <Navigate to="/" replace />
  if (product === undefined) return null

  const hasVariants = product.variants.length > 0
  const activeVariantId = selectedVariantId ?? (hasVariants ? product.variants[0].id : undefined)
  const selectedVariant = product.variants.find(v => v.id === activeVariantId)
  const variantOutOfStock = hasVariants && selectedVariant !== undefined && selectedVariant.stock <= 0
  const effectiveAvailable = product.available && (!hasVariants || (selectedVariant !== undefined && !variantOutOfStock))
  const effectivePrice = selectedVariant ? selectedVariant.price : product.price
  const quantity = items.find(item => item.productId === product.id && item.variantId === activeVariantId)?.quantity ?? 0
  const primaryImage = product.gallery.find(img => img.isPrimary) ?? product.gallery[0]
  const artProduct = {
    id: product.id,
    slug: product.slug,
    categoryId: product.categoryId,
    name: product.name,
    price: product.price,
    oldPrice: product.oldPrice,
    unit: product.unit,
    available: product.available,
    stockState: product.stockState,
    emoji: product.emoji,
    primaryImage: primaryImage?.url,
    primaryImageAlt: primaryImage?.altText
  }

  function addOne() {
    if (!effectiveAvailable) return
    addItem(product!.id, 1, activeVariantId)
    flash(ar.common.addedToCart)
  }

  return (
    <div className="product-page">
      {product.gallery.length > 0 ? (
        <ProductGallery images={product.gallery} productName={product.name} />
      ) : (
        <ProductArt product={artProduct} height={250} fontSize={120} priority />
      )}

      <div className="product-detail-sheet">
        <div className="product-detail-head">
          <div className="product-detail-title-row">
            <h1>{product.name}</h1>
            <FavoriteButton productId={product.id} className="product-detail-favorite" />
          </div>
          <span className={`stock-badge ${effectiveAvailable ? (!hasVariants && product.stockState === 'low_stock' ? 'low-stock' : 'available') : 'unavailable'}`}>
            {!product.available
              ? ar.product.unavailable
              : hasVariants
                ? (variantOutOfStock ? ar.product.variantOutOfStock : ar.product.available)
                : (product.stockState === 'low_stock'
                  ? (typeof product.lowStockRemaining === 'number' ? ar.product.lowStockRemaining(product.lowStockRemaining) : ar.product.lowStock)
                  : ar.product.available)}
          </span>
        </div>
        <div className="product-detail-meta">{ar.product.pricePerUnit(product.unit, product.categoryName)}</div>

        <div className="product-detail-price">
          <span>{formatMoney(effectivePrice)}</span>
          {!selectedVariant && product.oldPrice && <s>{formatMoney(product.oldPrice)}</s>}
        </div>

        {hasVariants && (
          <div className="product-detail-variants" role="radiogroup" aria-label={ar.product.chooseOption}>
            {product.variants.map(variant => (
              <button
                key={variant.id}
                type="button"
                role="radio"
                aria-checked={variant.id === activeVariantId}
                className={`variant-chip ${variant.id === activeVariantId ? 'selected' : ''} ${variant.stock <= 0 ? 'out-of-stock' : ''}`}
                onClick={() => setSelectedVariantId(variant.id)}
              >
                {variant.name}
                {variant.stock <= 0 && <span className="variant-chip-note"> ({ar.product.variantOutOfStock})</span>}
              </button>
            ))}
          </div>
        )}

        <div className="product-detail-description">{product.description}</div>

        <div className="product-detail-tiles">
          <div><div className="tile-icon">🚚</div><div>{ar.product.deliveryToday}</div></div>
          <div><div className="tile-icon">🔄</div><div>{ar.product.exchange24h}</div></div>
          <div><div className="tile-icon">✅</div><div>{ar.product.checkBeforeDelivery}</div></div>
        </div>

        {product.alternatives.length > 0 && (
          <div>
            <h2 className="related-title">{ar.product.similarAlternatives}</h2>
            <div className="related-rail">
              {product.alternatives.map(p => (
                <button key={p.id} className="related-card" onClick={() => navigate(`/product/${p.slug}`)}>
                  <span className="related-card-art">
                    {p.primaryImage ? <img src={p.primaryImage} alt="" loading="lazy" /> : <span className="related-card-emoji">{p.emoji}</span>}
                  </span>
                  <span className="related-card-body">
                    <span className="related-card-name">{p.name}</span>
                    <span className="related-card-price">{formatMoney(p.price)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {product.similarProducts.length > 0 && (
          <div>
            <h2 className="related-title">{ar.product.similarProducts}</h2>
            <div className="related-rail">
              {product.similarProducts.map(p => (
                <button key={p.id} className="related-card" onClick={() => navigate(`/product/${p.slug}`)}>
                  <ProductArt product={p} height={80} fontSize={36} showBadge={false} showUnavailable={false} />
                  <span className="related-card-body">
                    <span className="related-card-name">{p.name}</span>
                    <span className="related-card-price">{formatMoney(p.price)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {product.frequentlyBoughtTogether.length > 0 && (
          <div>
            <h2 className="related-title">{ar.product.frequentlyBoughtTogether}</h2>
            <ProductGrid products={product.frequentlyBoughtTogether} layout="rail" />
          </div>
        )}
      </div>

      <StickyActionBar
        label={effectiveAvailable ? (quantity > 0 ? ar.product.updateCart : ar.product.addToCart) : ar.product.unavailable}
        meta={effectiveAvailable ? formatMoney(effectivePrice * Math.max(1, quantity)) : undefined}
        onClick={addOne}
        disabled={!effectiveAvailable}
      />
    </div>
  )
}
