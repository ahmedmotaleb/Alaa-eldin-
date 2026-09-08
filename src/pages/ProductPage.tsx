import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ProductArt } from '../components/ProductArt'
import { StickyActionBar } from '../components/StickyActionBar'
import { useCatalog } from '../store/CatalogContext'
import { useCart } from '../store/CartContext'
import { useToast } from '../store/ToastContext'
import { api, type ApiAlternativeProduct } from '../utils/api'
import { formatMoney } from '../utils/money'
import { ar } from '../i18n/ar'

export function ProductPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { products, categories } = useCatalog()
  const product = products.find(p => p.slug === slug)
  const { items, addItem } = useCart()
  const flash = useToast()
  const [alternatives, setAlternatives] = useState<ApiAlternativeProduct[]>([])

  const similar = useMemo(
    () => products.filter(p => p.categoryId === product?.categoryId && p.id !== product?.id).slice(0, 6),
    [product]
  )

  // بدائل مشابهة مُدارة يدوياً من الإدارة — اقتراح فقط، مفيش أي استبدال تلقائي للمنتج
  // الحالي؛ العميل هو اللي بيقرر يفتح البديل أو لأ.
  useEffect(() => {
    if (!product) return
    let cancelled = false
    api.getAlternatives(product.id)
      .then(({ alternatives }) => { if (!cancelled) setAlternatives(alternatives) })
      .catch(() => { if (!cancelled) setAlternatives([]) })
    return () => { cancelled = true }
  }, [product])

  if (!product) return <Navigate to="/" replace />

  const quantity = items.find(item => item.productId === product.id)?.quantity ?? 0
  const categoryName = categories.find(c => c.id === product.categoryId)?.name ?? ''

  function addOne() {
    if (!product!.available) return
    addItem(product!.id)
    flash(ar.common.addedToCart)
  }

  return (
    <div className="product-page">
      <ProductArt product={product} height={250} fontSize={120} />

      <div className="product-detail-sheet">
        <div className="product-detail-head">
          <h1>{product.name}</h1>
          <span className={`stock-badge ${product.available ? 'available' : 'unavailable'}`}>
            {product.available ? ar.product.available : ar.product.unavailable}
          </span>
        </div>
        <div className="product-detail-meta">{ar.product.pricePerUnit(product.unit, categoryName)}</div>

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

        {alternatives.length > 0 && (
          <div>
            <h2 className="related-title">{ar.product.similarAlternatives}</h2>
            <div className="related-rail">
              {alternatives.map(p => (
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

        {similar.length > 0 && (
          <div>
            <h2 className="related-title">{ar.product.similarProducts}</h2>
            <div className="related-rail">
              {similar.map(p => (
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
