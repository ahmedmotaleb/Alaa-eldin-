import { useNavigate } from 'react-router-dom'
import { QuantityCounter } from '../components/QuantityCounter'
import { STORE_CONFIG } from '../config/store'
import { useCart } from '../store/CartContext'
import { formatMoney } from '../utils/money'

export function CartPage() {
  const navigate = useNavigate()
  const { detailedItems, subtotal, deliveryFee, total, setQuantity, removeItem } = useCart()

  const freeProgress = Math.min(100, (subtotal / STORE_CONFIG.freeShippingThreshold) * 100)
  const remainingForFree = Math.max(0, STORE_CONFIG.freeShippingThreshold - subtotal)
  const belowMinimum = subtotal > 0 && subtotal < STORE_CONFIG.minimumOrder

  if (!detailedItems.length) {
    return (
      <section>
        <div className="page-title"><h1>السلة</h1></div>
        <div className="empty-card">
          <div className="empty-icon">🛒</div>
          <h2>السلة فارغة</h2>
          <p>أضف المنتجات التي تحتاجها ثم ارجع لإتمام الطلب.</p>
          <button className="primary-button" onClick={() => navigate('/')}>ابدأ التسوق</button>
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="page-title"><h1>السلة</h1></div>

      {belowMinimum && (
        <div className="alert warning">
          الحد الأدنى للطلب {formatMoney(STORE_CONFIG.minimumOrder)}.
          أضف منتجات بقيمة {formatMoney(STORE_CONFIG.minimumOrder - subtotal)} لإتمام الطلب.
        </div>
      )}

      <div className="shipping-progress-card">
        <div className="shipping-copy">
          {remainingForFree > 0
            ? <>متبقي <strong>{formatMoney(remainingForFree)}</strong> للحصول على توصيل مجاني.</>
            : <strong>تهانينا، التوصيل مجاني لطلبك.</strong>}
        </div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${freeProgress}%` }} /></div>
      </div>

      <div className="cart-list">
        {detailedItems.map(item => (
          <article className="cart-item" key={item.productId}>
            <img src={item.product.image} alt={item.product.name} />
            <div className="cart-item-content">
              <strong>{item.product.name}</strong>
              <span>{formatMoney(item.product.price)} / {item.product.unit}</span>
              <QuantityCounter value={item.quantity} onChange={value => setQuantity(item.productId, value)} />
            </div>
            <button className="delete-button" onClick={() => removeItem(item.productId)} aria-label={`حذف ${item.product.name}`}>
              حذف
            </button>
          </article>
        ))}
      </div>

      <div className="summary-card">
        <div><span>الإجمالي الفرعي</span><strong>{formatMoney(subtotal)}</strong></div>
        <div><span>التوصيل</span><strong>{deliveryFee === 0 ? 'مجاني' : formatMoney(deliveryFee)}</strong></div>
        <div className="summary-total"><span>الإجمالي</span><strong>{formatMoney(total)}</strong></div>
      </div>

      <button
        className="primary-button sticky-checkout"
        disabled={subtotal < STORE_CONFIG.minimumOrder}
        onClick={() => navigate('/checkout')}
      >
        إتمام الطلب
      </button>
    </section>
  )
}
