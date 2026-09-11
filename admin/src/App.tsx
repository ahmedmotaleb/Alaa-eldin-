import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './components/AdminLayout'
import { RequireAdminRole } from './components/RequireAdminRole'
import { AuthProvider } from './store/AuthContext'

// كل صفحة بتتحمّل كـ chunk منفصل (lazy) بدل ما تتحمّل كلها مقدماً ضمن الحزمة الرئيسية —
// أول تحميل للوحة التحكم (أو أي قسم فيها) بيجيب بس كود الصفحة المطلوبة فعلاً.
const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })))
const OrdersPage = lazy(() => import('./pages/OrdersPage').then(m => ({ default: m.OrdersPage })))
const PickingViewPage = lazy(() => import('./pages/PickingViewPage').then(m => ({ default: m.PickingViewPage })))
const PrintOrderPage = lazy(() => import('./pages/PrintOrderPage').then(m => ({ default: m.PrintOrderPage })))
const PlaceholderPage = lazy(() => import('./pages/PlaceholderPage').then(m => ({ default: m.PlaceholderPage })))
const ProductsListPage = lazy(() => import('./pages/products/ProductsListPage').then(m => ({ default: m.ProductsListPage })))
const ProductFormPage = lazy(() => import('./pages/products/ProductFormPage').then(m => ({ default: m.ProductFormPage })))
const CategoriesPage = lazy(() => import('./pages/products/CategoriesPage').then(m => ({ default: m.CategoriesPage })))
const InventoryPage = lazy(() => import('./pages/products/InventoryPage').then(m => ({ default: m.InventoryPage })))
const StockMovesPage = lazy(() => import('./pages/products/StockMovesPage').then(m => ({ default: m.StockMovesPage })))
const SuppliersListPage = lazy(() => import('./pages/purchasing/SuppliersListPage').then(m => ({ default: m.SuppliersListPage })))
const SupplierFormPage = lazy(() => import('./pages/purchasing/SupplierFormPage').then(m => ({ default: m.SupplierFormPage })))
const PurchaseOrdersListPage = lazy(() => import('./pages/purchasing/PurchaseOrdersListPage').then(m => ({ default: m.PurchaseOrdersListPage })))
const PurchaseOrderFormPage = lazy(() => import('./pages/purchasing/PurchaseOrderFormPage').then(m => ({ default: m.PurchaseOrderFormPage })))
const GoodsReceivingListPage = lazy(() => import('./pages/purchasing/GoodsReceivingListPage').then(m => ({ default: m.GoodsReceivingListPage })))
const GoodsReceivingFormPage = lazy(() => import('./pages/purchasing/GoodsReceivingFormPage').then(m => ({ default: m.GoodsReceivingFormPage })))
const ExpiryDashboardPage = lazy(() => import('./pages/products/ExpiryDashboardPage').then(m => ({ default: m.ExpiryDashboardPage })))
const CustomersListPage = lazy(() => import('./pages/customers/CustomersListPage').then(m => ({ default: m.CustomersListPage })))
const CustomerDetailPage = lazy(() => import('./pages/customers/CustomerDetailPage').then(m => ({ default: m.CustomerDetailPage })))
const SegmentsPage = lazy(() => import('./pages/customers/SegmentsPage').then(m => ({ default: m.SegmentsPage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })))
const WalletPage = lazy(() => import('./pages/WalletPage').then(m => ({ default: m.WalletPage })))
const DiscountsListPage = lazy(() => import('./pages/discounts/DiscountsListPage').then(m => ({ default: m.DiscountsListPage })))
const DiscountFormPage = lazy(() => import('./pages/discounts/DiscountFormPage').then(m => ({ default: m.DiscountFormPage })))
const UsersPage = lazy(() => import('./pages/settings/UsersPage').then(m => ({ default: m.UsersPage })))
const StoreSettingsPage = lazy(() => import('./pages/settings/StoreSettingsPage').then(m => ({ default: m.StoreSettingsPage })))
const DeliverySettingsPage = lazy(() => import('./pages/settings/DeliverySettingsPage').then(m => ({ default: m.DeliverySettingsPage })))
const PaymentSettingsPage = lazy(() => import('./pages/settings/PaymentSettingsPage').then(m => ({ default: m.PaymentSettingsPage })))
const AuditLogPage = lazy(() => import('./pages/settings/AuditLogPage').then(m => ({ default: m.AuditLogPage })))
const PagesListPage = lazy(() => import('./pages/pages/PagesListPage').then(m => ({ default: m.PagesListPage })))
const PageEditorPage = lazy(() => import('./pages/pages/PageEditorPage').then(m => ({ default: m.PageEditorPage })))
const BannersListPage = lazy(() => import('./pages/marketing/BannersListPage').then(m => ({ default: m.BannersListPage })))
const BannerFormPage = lazy(() => import('./pages/marketing/BannerFormPage').then(m => ({ default: m.BannerFormPage })))
const HomeSectionsPage = lazy(() => import('./pages/marketing/HomeSectionsPage').then(m => ({ default: m.HomeSectionsPage })))

function RouteLoader() {
  return <div className="admin-placeholder-card"><div className="admin-placeholder-note">جاري التحميل...</div></div>
}

export default function App() {
  return (
    <BrowserRouter basename="/admin">
      <AuthProvider>
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/orders/:id/print" element={<PrintOrderPage />} />
            <Route element={<AdminLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/orders" element={<Navigate to="/orders/all" replace />} />
              <Route path="/orders/:tab" element={<OrdersPage />} />
              <Route path="/orders/:id/picking" element={<PickingViewPage />} />
              <Route path="/products" element={<Navigate to="/products/all" replace />} />
              <Route path="/products/all" element={<ProductsListPage />} />
              <Route path="/products/add" element={<ProductFormPage />} />
              <Route path="/products/edit/:id" element={<ProductFormPage />} />
              <Route path="/products/cats" element={<CategoriesPage />} />
              <Route path="/products/inv" element={<InventoryPage />} />
              <Route path="/products/expiry" element={<ExpiryDashboardPage />} />
              <Route path="/products/moves" element={<StockMovesPage />} />
              <Route path="/purchasing" element={<Navigate to="/purchasing/suppliers" replace />} />
              <Route path="/purchasing/suppliers" element={<SuppliersListPage />} />
              <Route path="/purchasing/suppliers/new" element={<SupplierFormPage />} />
              <Route path="/purchasing/suppliers/edit/:id" element={<SupplierFormPage />} />
              <Route path="/purchasing/orders" element={<PurchaseOrdersListPage />} />
              <Route path="/purchasing/orders/new" element={<PurchaseOrderFormPage />} />
              <Route path="/purchasing/orders/edit/:id" element={<PurchaseOrderFormPage />} />
              <Route path="/purchasing/receiving" element={<GoodsReceivingListPage />} />
              <Route path="/purchasing/receiving/:poId" element={<GoodsReceivingFormPage />} />
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
              <Route path="/wallet/expenses" element={<RequireAdminRole><WalletPage tab="expenses" /></RequireAdminRole>} />
              <Route path="/wallet/settle" element={<RequireAdminRole><WalletPage tab="settle" /></RequireAdminRole>} />
              <Route path="/discounts" element={<Navigate to="/discounts/all" replace />} />
              <Route path="/discounts/all" element={<DiscountsListPage />} />
              <Route path="/discounts/new" element={<DiscountFormPage />} />
              <Route path="/discounts/edit/:code" element={<DiscountFormPage />} />
              <Route path="/settings/users" element={<RequireAdminRole><UsersPage /></RequireAdminRole>} />
              <Route path="/settings/store" element={<StoreSettingsPage />} />
              <Route path="/settings/delivery" element={<DeliverySettingsPage />} />
              <Route path="/settings/payment" element={<PaymentSettingsPage />} />
              <Route path="/settings/audit" element={<RequireAdminRole><AuditLogPage /></RequireAdminRole>} />
              <Route path="/pages" element={<PagesListPage />} />
              <Route path="/pages/edit/:id" element={<PageEditorPage />} />
              <Route path="/marketing/home" element={<HomeSectionsPage />} />
              <Route path="/marketing/banners" element={<BannersListPage />} />
              <Route path="/marketing/banners/add" element={<BannerFormPage />} />
              <Route path="/marketing/banners/edit/:id" element={<BannerFormPage />} />
              <Route path="/:group" element={<PlaceholderPage />} />
              <Route path="/:group/:sub" element={<PlaceholderPage />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
