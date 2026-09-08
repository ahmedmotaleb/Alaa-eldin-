import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './components/AdminLayout'
import { AuthProvider } from './store/AuthContext'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { OrdersPage } from './pages/OrdersPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { ProductsListPage } from './pages/products/ProductsListPage'
import { ProductFormPage } from './pages/products/ProductFormPage'
import { CategoriesPage } from './pages/products/CategoriesPage'
import { InventoryPage } from './pages/products/InventoryPage'
import { StockMovesPage } from './pages/products/StockMovesPage'
import { CustomersListPage } from './pages/customers/CustomersListPage'
import { CustomerDetailPage } from './pages/customers/CustomerDetailPage'
import { SegmentsPage } from './pages/customers/SegmentsPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { WalletPage } from './pages/WalletPage'
import { DiscountsListPage } from './pages/discounts/DiscountsListPage'
import { DiscountFormPage } from './pages/discounts/DiscountFormPage'
import { UsersPage } from './pages/settings/UsersPage'
import { StoreSettingsPage } from './pages/settings/StoreSettingsPage'
import { DeliverySettingsPage } from './pages/settings/DeliverySettingsPage'
import { PaymentSettingsPage } from './pages/settings/PaymentSettingsPage'
import { AuditLogPage } from './pages/settings/AuditLogPage'
import { BannersListPage } from './pages/marketing/BannersListPage'
import { BannerFormPage } from './pages/marketing/BannerFormPage'
import { HomeSectionsPage } from './pages/marketing/HomeSectionsPage'

export default function App() {
  return (
    <BrowserRouter basename="/admin">
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AdminLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/orders" element={<Navigate to="/orders/all" replace />} />
            <Route path="/orders/:tab" element={<OrdersPage />} />
            <Route path="/products" element={<Navigate to="/products/all" replace />} />
            <Route path="/products/all" element={<ProductsListPage />} />
            <Route path="/products/add" element={<ProductFormPage />} />
            <Route path="/products/edit/:id" element={<ProductFormPage />} />
            <Route path="/products/cats" element={<CategoriesPage />} />
            <Route path="/products/inv" element={<InventoryPage />} />
            <Route path="/products/moves" element={<StockMovesPage />} />
            <Route path="/customers" element={<Navigate to="/customers/all" replace />} />
            <Route path="/customers/all" element={<CustomersListPage />} />
            <Route path="/customers/segments" element={<SegmentsPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
            <Route path="/analytics" element={<Navigate to="/analytics/overview" replace />} />
            <Route path="/analytics/:tab" element={<AnalyticsPage />} />
            <Route path="/wallet" element={<Navigate to="/wallet/overview" replace />} />
            <Route path="/wallet/overview" element={<WalletPage tab="overview" />} />
            <Route path="/wallet/txns" element={<WalletPage tab="txns" />} />
            <Route path="/wallet/collect" element={<WalletPage tab="collect" />} />
            <Route path="/wallet/expenses" element={<WalletPage tab="expenses" />} />
            <Route path="/wallet/settle" element={<WalletPage tab="settle" />} />
            <Route path="/discounts" element={<Navigate to="/discounts/all" replace />} />
            <Route path="/discounts/all" element={<DiscountsListPage />} />
            <Route path="/discounts/new" element={<DiscountFormPage />} />
            <Route path="/discounts/edit/:code" element={<DiscountFormPage />} />
            <Route path="/settings/users" element={<UsersPage />} />
            <Route path="/settings/store" element={<StoreSettingsPage />} />
            <Route path="/settings/delivery" element={<DeliverySettingsPage />} />
            <Route path="/settings/payment" element={<PaymentSettingsPage />} />
            <Route path="/settings/audit" element={<AuditLogPage />} />
            <Route path="/marketing/home" element={<HomeSectionsPage />} />
            <Route path="/marketing/banners" element={<BannersListPage />} />
            <Route path="/marketing/banners/add" element={<BannerFormPage />} />
            <Route path="/marketing/banners/edit/:id" element={<BannerFormPage />} />
            <Route path="/:group" element={<PlaceholderPage />} />
            <Route path="/:group/:sub" element={<PlaceholderPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
