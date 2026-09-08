import type { ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { OfflineBanner } from './components/OfflineBanner'
import { AuthProvider } from './store/AuthContext'
import { CartProvider } from './store/CartContext'
import { CatalogProvider, useCatalog } from './store/CatalogContext'
import { ToastProvider } from './store/ToastContext'
import { AccountPage } from './pages/AccountPage'
import { BestSellersPage } from './pages/BestSellersPage'
import { CartPage } from './pages/CartPage'
import { CategoriesPage } from './pages/CategoriesPage'
import { CategoryPage } from './pages/CategoryPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { ConfirmationPage } from './pages/ConfirmationPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { OffersPage } from './pages/OffersPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { OrdersPage } from './pages/OrdersPage'
import { ProductPage } from './pages/ProductPage'
import { RegisterPage } from './pages/RegisterPage'
import { SearchPage } from './pages/SearchPage'
import { TrackingPage } from './pages/TrackingPage'
import { ar } from './i18n/ar'

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
            <ToastProvider>
              <OfflineBanner />
              <CatalogGate>
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
                    <Route path="/confirmation/:orderId" element={<ConfirmationPage />} />
                    <Route path="/track/:orderId" element={<TrackingPage />} />
                    <Route path="/orders" element={<OrdersPage />} />
                    <Route path="/account" element={<AccountPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Routes>
              </CatalogGate>
            </ToastProvider>
          </CartProvider>
        </CatalogProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
