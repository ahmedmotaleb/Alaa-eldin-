import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ProductArt } from '../components/ProductArt'
import { StickyActionBar } from '../components/StickyActionBar'
import { useCart } from '../store/CartContext'
import { useToast } from '../store/ToastContext'
import { setPageTitle } from '../store/pageTitleStore'
import { api, type ApiProductDetail } from '../utils/api'
import { formatMoney } from '../utils/money'
import { ar } from '../i18n/ar'

export function ProductPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { items, addItem } = useCart()
  const flash = useToast()
  const [product, setProduct] = useState<ApiProductDetail | null | undefined>(undefined)

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

  if (product === null) return <Navigate to="/" replace />
  if (product === undefined) return null

  const quantity = items.find(item => item.productId === product.id)?.quantity ?? 0
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
    if (!product!.available) return
    addItem(product!.id)
    flash(ar.common.addedToCart)
  }

  return (
    <div className="product-page">
      <ProductArt product={artProduct} height={250} fontSize={120} />

      <div className="product-detail-sheet">
        <div className="product-detail-head">
          <h1>{product.name}</h1>
          <span className={`stock-badge ${product.available ? (product.stockState === 'low_stock' ? 'low-stock' : 'available') : 'unavailable'}`}>
            {product.available
              ? (product.stockState === 'low_stock'
                ? (typeof product.lowStockRemaining === 'number' ? ar.product.lowStockRemaining(product.lowStockRemaining) : ar.product.lowStock)
                : ar.product.available)
              : ar.product.unavailable}
          </span>
        </div>
        <div className="product-detail-meta">{ar.product.pricePerUnit(product.unit, product.categoryName)}</div>

        <div className="product-detail-price">
          <span>{formatMoney(product.price)}</span>
          {product.oldPrice && <s>{formatMoney(product.oldPrice)}</s>}
        </div>

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
      </div>

      <StickyActionBar
        label={product.available ? (quantity > 0 ? ar.product.updateCart : ar.product.addToCart) : ar.product.unavailable}
        meta={product.available ? formatMoney(product.price * Math.max(1, quantity)) : undefined}
        onClick={addOne}
        disabled={!product.available}
      />
    </div>
  )
}
