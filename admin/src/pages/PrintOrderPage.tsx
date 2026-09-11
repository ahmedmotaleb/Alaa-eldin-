import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, type AdminOrder } from '../utils/api'
import { formatMoney } from '../utils/money'
import { formatDateTime } from '../utils/format'
import { ORDER_STATUS_LABEL } from '../orderStatus'

// صفحة طباعة مستقلة تماماً (بره AdminLayout) — من غير أي شريط جانبي أو تنقل إدارة، عشان
// المطبوع يفضل نظيف (رقم الطلب، العميل، الأصناف، الإجمالي..إلخ) من غير حاجة زيادة.
export function PrintOrderPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState<AdminOrder | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    api.getOrder(id)
      .then(({ order }) => setOrder(order))
      .catch(err => {
        if (err instanceof ApiError && err.status === 401) { navigate('/login', { replace: true }); return }
        setError('تعذر تحميل الطلب')
      })
  }, [id, navigate])

  if (error) return <div style={{ padding: 20, fontFamily: 'system-ui' }}>{error}</div>
  if (!order) return null

  return (
    <div className="print-order-page" dir="rtl" lang="ar">
      <button className="print-order-button" onClick={() => window.print()}>🖨️ طباعة</button>

      <div className="print-order-sheet">
        <div className="print-order-head">
          <div className="print-order-brand">علاء الدين</div>
          <div className="print-order-number">طلب {order.orderNumber}</div>
        </div>

        <div className="print-order-meta">
          <div><strong>الحالة:</strong> {ORDER_STATUS_LABEL[order.status]}</div>
          <div><strong>التاريخ:</strong> {formatDateTime(order.createdAt)}</div>
          <div><strong>ميعاد التوصيل:</strong> {order.deliverySlot}</div>
          {order.riderName && <div><strong>المندوب:</strong> {order.riderName}</div>}
        </div>

        <div className="print-order-customer">
          <div><strong>الاسم:</strong> {order.customer.fullName}</div>
          <div><strong>الهاتف:</strong> {order.customer.mobile}</div>
          <div><strong>المحافظة:</strong> {order.customer.governorate}</div>
          <div><strong>العنوان:</strong> {order.customer.address}</div>
        </div>

        <table className="print-order-table">
          <thead>
            <tr>
              <th>الصنف</th>
              <th>الكمية</th>
              <th>الوحدة</th>
              <th>السعر</th>
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map(item => (
              <tr key={item.productId}>
                <td>{item.name}</td>
                <td>{item.quantity}</td>
                <td>{item.unit}</td>
                <td>{formatMoney(item.unitPrice)}</td>
                <td>{formatMoney(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="print-order-totals">
          <div><span>الإجمالي الفرعي</span><span>{formatMoney(order.subtotal)}</span></div>
          {order.discountCode && <div><span>خصم ({order.discountCode})</span><span>-{formatMoney(order.discountAmount)}</span></div>}
          <div><span>التوصيل</span><span>{order.deliveryFee ? formatMoney(order.deliveryFee) : 'مجاني'}</span></div>
          <div className="print-order-total-line"><span>الإجمالي</span><span>{formatMoney(order.total)}</span></div>
          <div><span>طريقة الدفع</span><span>{order.paymentMethod === 'COD' ? 'الدفع عند الاستلام' : order.paymentMethod}</span></div>
        </div>
      </div>
    </div>
  )
}
