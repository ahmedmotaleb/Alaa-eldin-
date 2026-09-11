import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { OfflineBanner } from './components/OfflineBanner'
import { AndroidBackButton } from './components/AndroidBackButton'
import { AuthProvider } from './store/AuthContext'
import { CartProvider } from './store/CartContext'
import { CatalogProvider, useCatalog } from './store/CatalogContext'
import { FavoritesProvider } from './store/FavoritesContext'
import { ToastProvider } from './store/ToastContext'
import { ar } from './i18n/ar'

// كل صفحة بتتحمّل كـ chunk منفصل (lazy) بدل ما تتحمّل كلها مقدماً ضمن الحزمة الرئيسية —
// أول تحميل للتطبيق (أو أي مسار) بيجيب بس كود الصفحة المطلوبة فعلاً، مش كل الصفحات التانية
// اللي المستخدم ممكن ميزورهاش أصلاً في نفس الجلسة.
const AccountPage = lazy(() => import('./pages/AccountPage').then(m => ({ default: m.AccountPage })))
const AddressesPage = lazy(() => import('./pages/AddressesPage').then(m => ({ default: m.AddressesPage })))
const FavoritesPage = lazy(() => import('./pages/FavoritesPage').then(m => ({ default: m.FavoritesPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })))
const BestSellersPage = lazy(() => import('./pages/BestSellersPage').then(m => ({ default: m.BestSellersPage })))
const CartPage = lazy(() => import('./pages/CartPage').then(m => ({ default: m.CartPage })))
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then(m => ({ default: m.CategoriesPage })))
const CategoryPage = lazy(() => import('./pages/CategoryPage').then(m => ({ default: m.CategoryPage })))
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then(m => ({ default: m.CheckoutPage })))
const ConfirmationPage = lazy(() => import('./pages/ConfirmationPage').then(m => ({ default: m.ConfirmationPage })))
const ContentPage = lazy(() => import('./pages/ContentPage').then(m => ({ default: m.ContentPage })))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })))
const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })))
const OffersPage = lazy(() => import('./pages/OffersPage').then(m => ({ default: m.OffersPage })))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then(m => ({ default: m.OnboardingPage })))
const OrdersPage = lazy(() => import('./pages/OrdersPage').then(m => ({ default: m.OrdersPage })))
const ProductPage = lazy(() => import('./pages/ProductPage').then(m => ({ default: m.ProductPage })))
const RegisterPage = lazy(() => import('./pages/RegisterPage').then(m => ({ default: m.RegisterPage })))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })))
const SearchPage = lazy(() => import('./pages/SearchPage').then(m => ({ default: m.SearchPage })))
const TrackingPage = lazy(() => import('./pages/TrackingPage').then(m => ({ default: m.TrackingPage })))

function RouteLoader() {
  return (
    <div className="catalog-gate">
      <div className="catalog-gate-note">{ar.common.loading}</div>
    </div>
  )
}

function CatalogGate({ children }: { children: ReactNode }) {
  const { loading, error } = useCatalog()

  if (error) {
    return (
      <div className="catalog-gate">
        <div className="catalog-gate-note">{error}</div>
        <button className="primary-button" onClick={() => window.location.reload()}>{ar.network.retry}</button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="catalog-gate">
        <div className="catalog-gate-note">{ar.common.loading}</div>
      </div>
    )
  }

  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CatalogProvider>
          <CartProvider>
            <FavoritesProvider>
              <ToastProvider>
                <AndroidBackButton />
                <OfflineBanner />
                <CatalogGate>
                  <Suspense fallback={<RouteLoader />}>
                    <Routes>
                      <Route path="/onboarding" element={<OnboardingPage />} />
                      <Route element={<Layout />}>
                        <Route path="/" element={<HomePage />} />
                        <Route path="/categories" element={<CategoriesPage />} />
                        <Route path="/category/:categoryId" element={<CategoryPage />} />
                        <Route path="/offers" element={<OffersPage />} />
                        <Route path="/best-sellers" element={<BestSellersPage />} />
                        <Route path="/product/:slug" element={<ProductPage />} />
                        <Route path="/search" element={<SearchPage />} />
                        <Route path="/cart" element={<CartPage />} />
                        <Route path="/checkout" element={<CheckoutPage />} />
                        <Route path="/confirmation/:orderNumber" element={<ConfirmationPage />} />
                        <Route path="/track/:orderNumber" element={<TrackingPage />} />
                        <Route path="/orders" element={<OrdersPage />} />
                        <Route path="/account" element={<AccountPage />} />
                        <Route path="/account/addresses" element={<AddressesPage />} />
                        <Route path="/account/favorites" element={<FavoritesPage />} />
                        <Route path="/account/profile" element={<ProfilePage />} />
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/register" element={<RegisterPage />} />
                        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                        <Route path="/reset-password" element={<ResetPasswordPage />} />
                        <Route path="/refund-exchange-policy" element={<ContentPage slug="refund-exchange-policy" />} />
                        <Route path="*" element={<NotFoundPage />} />
                      </Route>
                    </Routes>
                  </Suspense>
                </CatalogGate>
              </ToastProvider>
            </FavoritesProvider>
          </CartProvider>
        </CatalogProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
