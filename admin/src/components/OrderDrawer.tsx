import { useNavigate } from 'react-router-dom'
import type { AdminOrder, AdminOrderStatus, AdminRider } from '../utils/api'
import { formatMoney } from '../utils/money'
import { formatDateTime } from '../utils/format'
import { toWhatsAppInternational } from '../utils/phone'
import { ALLOWED_NEXT_STATUSES, ORDER_STATUS_COLOR, ORDER_STATUS_LABEL } from '../orderStatus'

export function OrderDrawer({
  order,
  onClose,
  onSetStatus,
  riders,
  onSetRider
}: {
  order: AdminOrder
  onClose: () => void
  onSetStatus: (status: AdminOrderStatus) => void
  riders?: AdminRider[]
  onSetRider?: (riderId: string | null) => void
}) {
  const navigate = useNavigate()
  const [bg, fg] = ORDER_STATUS_COLOR[order.status]

  function openWhatsApp() {
    const text = `مرحباً ${order.customer.fullName}، بخصوص طلبك ${order.orderNumber} من علاء الدين.`
    window.open(`https://wa.me/${toWhatsAppInternational(order.customer.mobile)}?text=${encodeURIComponent(text)}`, '_blank')
  }

  return (
    <div className="admin-drawer-overlay" onClick={onClose}>
      <div className="admin-drawer" onClick={e => e.stopPropagation()}>
        <div className="admin-drawer-head">
          <div>
            <div className="admin-drawer-title">{order.orderNumber}</div>
            <div className="admin-drawer-sub">{formatDateTime(order.createdAt)}</div>
          </div>
          <div className="admin-drawer-head-actions">
            <span className="admin-pill" style={{ background: bg, color: fg }}>{ORDER_STATUS_LABEL[order.status]}</span>
            <button className="admin-drawer-close" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="admin-drawer-card">
          <div className="admin-drawer-info-row"><span className="admin-drawer-info-icon">👤</span><span>{order.customer.fullName} ({order.accountEmail ?? 'طلب زائر بدون حساب'})</span></div>
          <div className="admin-drawer-info-row"><span className="admin-drawer-info-icon">📞</span><span>{order.customer.mobile}</span></div>
          <div className="admin-drawer-info-row"><span className="admin-drawer-info-icon">🗺️</span><span>{order.customer.governorate}</span></div>
          <div className="admin-drawer-info-row"><span className="admin-drawer-info-icon">📍</span><span>{order.customer.address}</span></div>
          <div className="admin-drawer-info-row"><span className="admin-drawer-info-icon">💵</span><span>{order.paymentMethod === 'COD' ? 'الدفع عند الاستلام' : order.paymentMethod}</span></div>
        </div>

        <div className="admin-drawer-card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="admin-category-card-btn" onClick={openWhatsApp}>💬 واتساب العميل</button>
          <button className="admin-category-card-btn" onClick={() => navigate(`/orders/${order.id}/picking`)}>📋 تجهيز الطلب</button>
          <button className="admin-category-card-btn" onClick={() => window.open(`/admin/orders/${order.id}/print`, '_blank')}>🖨️ طباعة</button>
        </div>

        <div className="admin-drawer-card">
          <div className="admin-drawer-card-title">المنتجات</div>
          {order.items.map(item => (
            <div className="admin-drawer-line" key={item.productId}>
              <span style={{ color: '#4C5B51' }}>{item.name} × {item.quantity}</span>
              <span>{formatMoney(item.lineTotal)}</span>
            </div>
          ))}
        </div>

        <div className="admin-drawer-card">
          <div className="admin-drawer-line"><span style={{ color: '#68746B' }}>الإجمالي الفرعي</span><span>{formatMoney(order.subtotal)}</span></div>
          {order.discountCode && (
            <div className="admin-drawer-line"><span style={{ color: '#68746B' }}>خصم ({order.discountCode})</span><span style={{ color: '#B42318' }}>-{formatMoney(order.discountAmount)}</span></div>
          )}
          <div className="admin-drawer-line"><span style={{ color: '#68746B' }}>التوصيل</span><span>{order.deliveryFee ? formatMoney(order.deliveryFee) : 'مجاني'}</span></div>
          <div className="admin-drawer-total-line" style={{ fontWeight: 900, fontSize: 15 }}><span>الإجمالي</span><span style={{ color: '#12813C' }}>{formatMoney(order.total)}</span></div>
        </div>

        {riders && onSetRider && (
          <div className="admin-drawer-card">
            <div className="admin-drawer-card-title">المندوب المسؤول عن التوصيل</div>
            <select
              value={order.riderId ?? ''}
              onChange={e => onSetRider(e.target.value || null)}
              style={{ border: '1px solid #dce4de', borderRadius: 11, padding: '10px 12px', fontWeight: 600, fontSize: 13, outline: 'none', background: '#fbfcfb', color: '#17221a', width: '100%' }}
            >
              <option value="">بدون مندوب</option>
              {riders.filter(r => r.active || r.id === order.riderId).map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            {order.settlementId && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: '#8A948C', marginTop: 8 }}>
                كاش هذا الطلب سبق تسويته مع المندوب — تغيير المندوب هنا لا يلغي التسوية السابقة.
              </div>
            )}
          </div>
        )}

        <div className="admin-drawer-card">
          <div className="admin-drawer-card-title">تحديث حالة الطلب</div>
          {ALLOWED_NEXT_STATUSES[order.status].length > 0 ? (
            <div className="admin-drawer-actions-grid">
              {ALLOWED_NEXT_STATUSES[order.status].map(status => (
                <button
                  key={status}
                  className="admin-drawer-status-btn"
                  onClick={() => onSetStatus(status)}
                >
                  {ORDER_STATUS_LABEL[status]}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, fontWeight: 600, color: '#8A948C' }}>
              الطلب في حالة نهائية ({ORDER_STATUS_LABEL[order.status]}) — مفيش إجراء إضافي متاح.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
