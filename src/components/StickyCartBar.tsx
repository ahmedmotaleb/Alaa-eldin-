import { useLocation, useNavigate } from 'react-router-dom'
import { useCart } from '../store/CartContext'
import { formatMoney } from '../utils/money'
import { ar } from '../i18n/ar'

// شرائح المحتوى العام (تصفّح) اللي شريط ملخص السلة بيظهر فيها — أي مكان تاني (صفحة منتج،
// السلة، الدفع، الحساب، الطلبات...) عنده بالفعل زرار سفلي خاص بيه أو مش محتاج تذكير بالسلة،
// وإظهار شريط تاني هناك هيكرّر التحكمات السفلية بدل ما يبسّطها.
function isAllowedPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '/categories' || pathname === '/search' || pathname === '/offers' || pathname === '/best-sellers') return true
  return pathname.startsWith('/category/')
}

// شريط ملخص سلة ثابت أسفل الشاشة أثناء التصفح — بيستخدم نفس حساب السلة الحقيقي (بما فيه
// الخصومات/العروض/التوصيل) من غير أي حساب مستقل في الواجهة. مش بيظهر في صفحة تفاصيل
// المنتج عمداً لأنها عندها بالفعل شريط "أضف للسلة" الخاص بيها، وإظهار الاتنين مع بعض
// هيكدّس تحكمات سفلية فوق بعض.
export function StickyCartBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { totalQuantity, total } = useCart()

  if (totalQuantity === 0 || !isAllowedPath(pathname)) return null

  return (
    <div className="sticky-cart-bar">
      <button type="button" onClick={() => navigate('/cart')}>
        <span className="sticky-cart-bar-cta">{ar.cart.viewCart}</span>
        <span className="sticky-cart-bar-total">
          <span className="sticky-cart-bar-total-label">{ar.cart.total}</span>
          <span className="sticky-cart-bar-total-amount">{formatMoney(total)}</span>
        </span>
      </button>
    </div>
  )
}
