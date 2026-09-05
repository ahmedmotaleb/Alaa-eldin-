import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { STORE_CONFIG } from '../config/store'
import type { Order } from '../types/models'
import { formatMoney } from '../utils/money'
import { buildWhatsAppOrderMessage, buildWhatsAppUrl } from '../utils/order'

export function ConfirmationPage() {
  const navigate = useNavigate()
  const { orderId } = useParams()

  const order = useMemo(() => {
    try {
      const raw = localStorage.getItem('alaa-eldin-last-order')
      return raw ? JSON.parse(raw) as Order : null
    } catch {
      return null
    }
  }, [])

  if (!order || order.id !== orderId) {
    return <div className="empty-card">تعذر العثور على تفاصيل الطلب.</div>
  }

  return (
    <section className="confirmation-page">
      <div className="success-icon">✓</div>
      <h1>تم تجهيز طلبك للإرسال</h1>
      <p>رقم الطلب: <strong>{order.id}</strong></p>

      <div className="invoice-card">
        <h2>ملخص الفاتورة</h2>
        {order.items.map(item => (
          <div className="invoice-line" key={item.productId}>
            <span>{item.name} × {item.quantity}</span>
            <strong>{formatMoney(item.lineTotal)}</strong>
          </div>
        ))}
        <hr />
        <div className="invoice-line"><span>الإجمالي الفرعي</span><strong>{formatMoney(order.subtotal)}</strong></div>
        <div className="invoice-line"><span>التوصيل</span><strong>{order.deliveryFee ? formatMoney(order.deliveryFee) : 'مجاني'}</strong></div>
        <div className="invoice-line invoice-total"><span>الإجمالي</span><strong>{formatMoney(order.total)}</strong></div>
      </div>

      <details className="message-preview">
        <summary>عرض نص الطلب المرسل</summary>
        <pre>{buildWhatsAppOrderMessage(order)}</pre>
      </details>

      <div className="stack-actions">
        <a className="primary-button link-button" href={buildWhatsAppUrl(order)} target="_blank" rel="noreferrer">
          تواصل معنا على واتساب
        </a>
        <button className="secondary-button" onClick={() => navigate('/')}>متابعة التسوق</button>
      </div>

      <p className="muted-note">سيتم الدفع عند الاستلام. رقم واتساب الحالي في المشروع قيمة تجريبية ويجب استبداله قبل النشر.</p>
    </section>
  )
}
