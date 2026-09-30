import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, type ApiBanner } from '../utils/api'
import { transformImage } from '../utils/image'
import { isPromoBannerDismissed, markPromoBannerDismissed } from '../utils/promoDismissal'
import { ar } from '../i18n/ar'

// شاشات ما ينفعش يظهر فيها بوب-أب تسويقي — إما تدفّق حرج (دفع/تسجيل دخول) أو صفحة فيها
// تركيز كامل على مهمة واحدة أصلاً (تأكيد/تتبع/إيصال).
const BLOCKED_PREFIXES = ['/checkout', '/login', '/register', '/forgot-password', '/reset-password', '/confirmation/', '/track/']

function isBlockedPath(pathname: string): boolean {
  if (pathname.endsWith('/receipt')) return true
  return BLOCKED_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix))
}

// بوب-أب تسويقي عام — بيستخدم نفس نظام البانرات الموجود (placement='popup') بدل محرك حملات
// منفصل. بيظهر مرة واحدة بس لكل حملة (معرّف البانر) لكل جهاز، ومش وقت أي تدفّق حرج.
export function PromoModal() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [banner, setBanner] = useState<ApiBanner | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<Element | null>(null)

  useEffect(() => {
    api.listBanners()
      .then(({ banners }) => {
        const popup = banners.find(b => b.placement === 'popup')
        if (popup && !isPromoBannerDismissed(popup.id)) setBanner(popup)
      })
      .catch(() => {})
  }, [])

  const visible = !!banner && !dismissed && !isBlockedPath(pathname)

  useEffect(() => {
    if (!visible) return
    previouslyFocused.current = document.activeElement
    closeButtonRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  function close() {
    if (banner) markPromoBannerDismissed(banner.id)
    setDismissed(true)
  }

  function onCtaClick() {
    if (!banner) return
    markPromoBannerDismissed(banner.id)
    setDismissed(true)
    navigate(banner.link)
  }

  if (!visible || !banner) return null

  return (
    <div className="promo-modal-backdrop" onClick={close}>
      <div
        className="promo-modal"
        role="dialog"
        aria-modal="true"
        aria-label={banner.title}
        onClick={e => e.stopPropagation()}
      >
        <button ref={closeButtonRef} type="button" className="promo-modal-close" onClick={close} aria-label={ar.promo.closeAriaLabel}>
          ✕
        </button>
        {banner.imageUrl ? (
          <img className="promo-modal-image" src={transformImage(banner.imageUrl, 'card')} alt={banner.altText || banner.title} />
        ) : banner.emoji ? (
          <div className="promo-modal-emoji">{banner.emoji}</div>
        ) : null}
        {banner.kicker && <div className="promo-modal-kicker">{banner.kicker}</div>}
        <div className="promo-modal-title">{banner.title}</div>
        {banner.note && <div className="promo-modal-note">{banner.note}</div>}
        <button type="button" className="promo-modal-cta" onClick={onCtaClick}>{banner.ctaLabel}</button>
      </div>
    </div>
  )
}
