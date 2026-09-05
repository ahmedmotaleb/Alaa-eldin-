import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useCart } from '../store/CartContext'
import { STORE_CONFIG } from '../config/store'

export function Layout() {
  const { totalQuantity } = useCart()
  const navigate = useNavigate()

  return (
    <div className="app-shell">
      <header className="top-header">
        <button className="brand-button" onClick={() => navigate('/')} aria-label="العودة للرئيسية">
          <span className="brand-mark">ع</span>
          <span>{STORE_CONFIG.name}</span>
        </button>
        <button className="header-cart" onClick={() => navigate('/cart')} aria-label="فتح السلة">
          <span>🛒</span>
          {totalQuantity > 0 && <span className="cart-count">{totalQuantity}</span>}
        </button>
      </header>

      <main className="page-content">
        <Outlet />
      </main>

      <a
        className="floating-whatsapp"
        href={`https://wa.me/${STORE_CONFIG.whatsappNumber}`}
        target="_blank"
        rel="noreferrer"
        aria-label="تواصل معنا على واتساب"
      >
        ☎
      </a>

      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        <NavLink to="/" end><span>⌂</span><small>الرئيسية</small></NavLink>
        <NavLink to="/categories"><span>▦</span><small>الأقسام</small></NavLink>
        <NavLink to="/cart"><span>🛒</span><small>السلة</small></NavLink>
        <NavLink to="/account"><span>◉</span><small>حسابي</small></NavLink>
      </nav>
    </div>
  )
}
