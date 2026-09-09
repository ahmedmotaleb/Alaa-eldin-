import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useCart } from '../store/CartContext'
import { useCatalog } from '../store/CatalogContext'
import { usePageTitle } from '../store/pageTitleStore'
import { ar } from '../i18n/ar'

function useSubTitle() {
  const location = useLocation()
  const { categoryId } = useParams()
  const { categories } = useCatalog()
  const productPageTitle = usePageTitle()
  const { pathname } = location
  const t = ar.nav.subTitles

  if (pathname === '/categories') return t.categories
  if (pathname.startsWith('/category/')) return categories.find(c => c.id === categoryId)?.name ?? t.genericCategory
  if (pathname === '/offers') return ar.home.todaysOffersTitle
  if (pathname === '/best-sellers') return ar.home.bestSellersTitle
  if (pathname.startsWith('/product/')) return productPageTitle || t.product
  if (pathname === '/search') return t.search
  if (pathname === '/cart') return t.cart
  if (pathname === '/checkout') return t.checkout
  if (pathname.startsWith('/confirmation/')) return t.confirmation
  if (pathname.startsWith('/track/')) return t.tracking
  if (pathname === '/orders') return t.orders
  if (pathname === '/account') return t.account
  if (pathname === '/login') return ar.auth.loginTitle
  if (pathname === '/register') return ar.auth.registerTitle
  return ''
}

export function Layout() {
  const { totalQuantity } = useCart()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const subTitle = useSubTitle()

  const isHome = pathname === '/'
  const hideHeaderCart = pathname === '/cart' || pathname === '/checkout' || pathname.startsWith('/confirmation/')
  const hideNav = pathname === '/checkout' || pathname.startsWith('/confirmation/')

  const navItems = [
    { key: 'home', to: '/', end: true, icon: '🏠', label: ar.nav.home },
    { key: 'categories', to: '/categories', end: false, icon: '🗂️', label: ar.nav.categories },
    { key: 'orders', to: '/orders', end: false, icon: '📦', label: ar.nav.orders },
    { key: 'cart', to: '/cart', end: false, icon: '🛒', label: ar.nav.cart },
    { key: 'account', to: '/account', end: false, icon: '👤', label: ar.nav.account }
  ]

  return (
    <div className="app-shell">
      {isHome ? (
        <header className="home-header">
          <div className="home-header-row">
            <div className="home-header-address">
              <img src="/images/logo.png" alt="" className="home-header-logo" onError={e => (e.currentTarget.style.display = 'none')} />
              <div>
                <div className="home-header-address-label">{ar.home.deliverTo}</div>
                <div className="home-header-address-value">{ar.home.deliveryAddress}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="#16A34A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
              </div>
            </div>
            <button className="header-cart" onClick={() => navigate('/cart')} aria-label={ar.common.openCart}>
              <span>🛒</span>
              {totalQuantity > 0 && <span className="cart-count">{totalQuantity}</span>}
            </button>
          </div>
          <button className="home-search-trigger" onClick={() => navigate('/search')}>
            <span>⌕</span>
            {ar.home.searchPlaceholder}
          </button>
        </header>
      ) : (
        <header className="sub-header">
          <button className="back-button" onClick={() => navigate(-1)} aria-label={ar.common.back}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 5l7 7-7 7" stroke="#17351F" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="sub-header-title">{subTitle}</div>
          {!hideHeaderCart && (
            <button className="header-cart small" onClick={() => navigate('/cart')} aria-label={ar.common.openCart}>
              <span>🛒</span>
              {totalQuantity > 0 && <span className="cart-count">{totalQuantity}</span>}
            </button>
          )}
        </header>
      )}

      <main className="page-content">
        <Outlet />
      </main>

      {!hideNav && (
        <nav className="bottom-nav" aria-label={ar.nav.mainNavLabel}>
          {navItems.map(item => (
            <NavLink key={item.key} to={item.to} end={item.end}>
              <span className="bottom-nav-icon">
                {item.icon}
                {item.key === 'cart' && totalQuantity > 0 && <span className="bottom-nav-badge">{totalQuantity}</span>}
              </span>
              <small>{item.label}</small>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}
