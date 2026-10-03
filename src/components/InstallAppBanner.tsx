import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useCart } from '../store/CartContext'
import { isInstallPromptSnoozed, markAppInstalled, snoozeInstallPrompt } from '../utils/installPromptDismissal'
import { ar } from '../i18n/ar'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// نفس قوائم الصفحات المحظورة في PromoModal — مفيش بوب-أب تسويقي وقت تدفّق حرج (دفع/تسجيل
// دخول) أو صفحة فيها تركيز كامل على مهمة واحدة أصلاً.
const BLOCKED_PREFIXES = ['/checkout', '/login', '/register', '/forgot-password', '/reset-password', '/confirmation/', '/track/']

function isBlockedPath(pathname: string): boolean {
  if (pathname.endsWith('/receipt')) return true
  return BLOCKED_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix))
}

// نفس منطق hasFullWidthStickyBar في WhatsAppFloatingButton — بانر التثبيت بيحتل نفس مكان
// sticky-cart-bar (bottom: 70px)، فبيختفي خالص لو في شريط سلة شغال بدل ما يتكدّس عليه.
function hasBrowseCartBar(pathname: string): boolean {
  if (pathname === '/' || pathname === '/categories' || pathname === '/search' || pathname === '/offers' || pathname === '/best-sellers') return true
  return pathname.startsWith('/category/')
}

function hasFullWidthStickyBar(pathname: string, totalQuantity: number): boolean {
  if (pathname === '/cart' || pathname.startsWith('/product/')) return true
  return totalQuantity > 0 && hasBrowseCartBar(pathname)
}

function isStandaloneDisplay(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

// مكوّن واحد ثابت لكل التطبيق — مُركّب مرة واحدة في Layout.tsx. تحميل مرة لإنه بيستمع
// لـ beforeinstallprompt بمجرد تحميل الصفحة (الحدث ده مابيتكررش لو فوّتناه).
export function InstallAppBanner() {
  const { pathname } = useLocation()
  const { totalQuantity } = useCart()
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [iosVisible, setIosVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (isStandaloneDisplay() || isInstallPromptSnoozed()) return

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    function onAppInstalled() {
      markAppInstalled()
      setDeferredPrompt(null)
      setIosVisible(false)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    // Safari على iOS مفيش فيه beforeinstallprompt خالص ولا أي API برمجي لفتح شاشة التثبيت
    // — بنعرض تعليمات "إضافة للشاشة الرئيسية" عن طريق زرار المشاركة بدل زرار تثبيت فعلي.
    if (isIos()) setIosVisible(true)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const visible = (!!deferredPrompt || iosVisible) && !dismissed && !isBlockedPath(pathname) && !hasFullWidthStickyBar(pathname, totalQuantity)
  if (!visible) return null

  function close() {
    snoozeInstallPrompt()
    setDismissed(true)
  }

  async function onInstallClick() {
    if (!deferredPrompt) return
    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'dismissed') snoozeInstallPrompt()
    } finally {
      setDeferredPrompt(null)
      setDismissed(true)
    }
  }

  const showInstallCta = !!deferredPrompt

  return (
    <div className="install-app-banner" role="region" aria-label={ar.installPrompt.title}>
      <img src="/images/icon-192.png" alt="" className="install-app-banner-icon" />
      <div className="install-app-banner-text">
        <div className="install-app-banner-title">{ar.installPrompt.title}</div>
        <div className="install-app-banner-note">{showInstallCta ? ar.installPrompt.note : ar.installPrompt.iosNote}</div>
      </div>
      {showInstallCta && (
        <button type="button" className="install-app-banner-cta" onClick={onInstallClick}>{ar.installPrompt.installCta}</button>
      )}
      <button type="button" className="install-app-banner-close" onClick={close} aria-label={ar.promo.closeAriaLabel}>✕</button>
    </div>
  )
}
