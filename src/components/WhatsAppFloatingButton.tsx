import { useLocation } from 'react-router-dom'
import { useCart } from '../store/CartContext'
import { getSettings } from '../store/settingsStore'
import { toWhatsAppInternational } from '../utils/phone'
import { ar } from '../i18n/ar'

// نفس قوائم الصفحات المستخدمة في StickyCartBar/StickyActionBar (sticky-cart-bar.tsx و
// product/cart pages) — الزرار العائم محتاج يعرف لو في شريط سفلي عريض آخر شغال على نفس
// الصفحة عشان يرفع نفسه فوقه، مش بس فوق الناف بار. لو الصفحتين دول اتغيّروا لاحقاً لازم
// التحديث هنا يتزامن معاهم.
function hasBrowseCartBar(pathname: string): boolean {
  if (pathname === '/' || pathname === '/categories' || pathname === '/search' || pathname === '/offers' || pathname === '/best-sellers') return true
  return pathname.startsWith('/category/')
}

function hasFullWidthStickyBar(pathname: string, totalQuantity: number): boolean {
  if (pathname === '/cart' || pathname.startsWith('/product/')) return true
  return totalQuantity > 0 && hasBrowseCartBar(pathname)
}

// نفس صفحات hideNav في Layout.tsx — الدفع/التأكيد/الإيصال شاشات معاملة مُركّزة بدون أي
// تحكمات سفلية ثانوية (الناف بار نفسه مخفي فيها)، فالزرار العائم مخفي فيها بنفس المنطق.
function isHiddenPath(pathname: string): boolean {
  return pathname === '/checkout' || pathname.startsWith('/confirmation/') || pathname.endsWith('/receipt')
}

// أيقونة واتساب الرسمية كـ SVG inline — عمداً، مش عبر أي مكتبة أيقونات أو CDN خارجي، عشان
// تفضل شغالة حتى أوفلاين (PWA) ومفيش أي اعتماد على تحميل شبكة خارجي ممكن يفشل.
function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 448 512" width="28" height="28" aria-hidden="true" focusable="false">
      <path
        fill="#fff"
        d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 110.8L2 480l117.7-30.9c32 17.5 68.1 26.7 104.9 26.7h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-68.9-156.7zM223.9 438.9c-32.7 0-64.7-8.8-92.5-25.4l-6.6-3.9-69.8 18.3 18.6-68-4.3-7c-18.3-29.1-27.9-62.7-27.9-97.2 0-100.7 81.9-182.6 182.7-182.6 48.8 0 94.7 19 129.1 53.5 34.5 34.5 53.5 80.3 53.4 129.1 0 100.8-83.1 182.6-182.7 182.6zm101.4-136.8c-5.6-2.8-33-16.3-38.1-18.2-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.4 18.2-17.7 22-3.3 3.7-6.6 4.2-12.2 1.4-32.9-16.5-54.5-29.5-76.1-66.9-5.7-9.8 5.7-9.1 16.4-30.3 1.8-3.7 .9-6.9-.8-9.7-1.9-2.8-13.3-32-18.2-43.8-4.9-11.5-9.9-9.9-13.6-10.1-3.5-.2-7.5-.2-11.5-.2-4 0-10.4 1.5-15.9 7.1-5.6 5.6-21.2 20.8-21.2 50.7 0 29.9 21.7 58.8 24.7 62.9 3 4.1 41.6 63.5 102.1 86.5 50.6 19.1 61 15.3 72 14.3 11-1 33-13.6 37.6-26.8 4.6-13.1 4.6-24.3 3.3-26.9-1.3-2.5-5.6-4-11.2-6.8z"
      />
    </svg>
  )
}

// زرار عائم ثابت واحد لكل التطبيق — مُركّب مرة واحدة بس في Layout.tsx (قشرة التطبيق
// الرئيسية للعميل)، فبيظهر في كل صفحات العميل تلقائياً بدون أي تكرار تركيب لكل صفحة.
// لوحة التحكم (admin/) تطبيق Vite مستقل تماماً عن هذا الملف، فمينفعش يظهر فيها أصلاً.
export function WhatsAppFloatingButton() {
  const { pathname } = useLocation()
  const { totalQuantity } = useCart()

  if (isHiddenPath(pathname)) return null

  const whatsappNumber = getSettings().whatsappNumber
  if (!whatsappNumber) return null

  const href = `https://wa.me/${toWhatsAppInternational(whatsappNumber)}`
  const raised = hasFullWidthStickyBar(pathname, totalQuantity)

  return (
    <a
      className={`whatsapp-float-btn${raised ? ' raised' : ''}`}
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={ar.account.contactWhatsapp}
    >
      <WhatsAppGlyph />
    </a>
  )
}
