import { useEffect, useRef, useState } from 'react'
import type { ProductGalleryImage } from '../types/models'
import { transformImage } from '../utils/image'
import { SafeImage } from './SafeImage'
import { ar } from '../i18n/ar'

// معرض صور منتج حقيقي: سحب أفقي (scroll-snap أصلي، بدون مكتبة) على الموبايل، شرائط
// صور مصغّرة تحت للتنقل المباشر، مؤشر الصورة النشطة، ولمسة على الصورة الرئيسية بتفتحها
// أكبر (lightbox) بيدعم التكبير الأصلي (pinch-zoom) من غير أي كود لمس مخصص. الصورة
// الأساسية بتتحمّل أول حاجة (priority)، والباقي بيتحمّل lazy.
// بيُستخدم بس لما فيه صورة واحدة على الأقل — لو مفيش صور خالص، ProductPage بيرجع
// لعرض ProductArt (الإيموجي بخلفية ملوّنة حسب القسم) زي ما كان بالظبط.
export function ProductGallery({ images, productName, fallbackEmoji }: { images: ProductGalleryImage[], productName: string, fallbackEmoji?: string }) {
  const [active, setActive] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  // صور فشلت تحميلها فعلياً (بعد محاولتين: محوّلة + أصلية) — بتتشال من المعرض الظاهر
  // تماماً (مش بس تتخفى بصرياً) عشان النقط والصور المصغّرة تفضل متوافقة مع العدد الحقيقي
  // الظاهر. لو كل الصور فشلت، المعرض بيعرض placeholder واحد بدل carousel فاضي.
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
  const trackRef = useRef<HTMLDivElement>(null)

  const sortedAll = [...images].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder)
  const sorted = sortedAll.filter(img => !failedIds.has(img.id))

  function markFailed(id: string) {
    setFailedIds(current => (current.has(id) ? current : new Set(current).add(id)))
  }

  useEffect(() => {
    if (sorted.length > 0 && active >= sorted.length) setActive(sorted.length - 1)
  }, [sorted.length, active])

  useEffect(() => {
    if (!lightboxOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxOpen(false)
      if (e.key === 'ArrowLeft') setActive(a => Math.min(sorted.length - 1, a + 1))
      if (e.key === 'ArrowRight') setActive(a => Math.max(0, a - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxOpen, sorted.length])

  function scrollToIndex(index: number) {
    setActive(index)
    const track = trackRef.current
    if (!track) return
    const slide = track.children[index] as HTMLElement | undefined
    slide?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  function onTrackScroll() {
    const track = trackRef.current
    if (!track) return
    const trackCenter = track.scrollLeft + track.clientWidth / 2
    let closest = 0
    let closestDistance = Infinity
    Array.from(track.children).forEach((child, i) => {
      const el = child as HTMLElement
      const center = el.offsetLeft + el.offsetWidth / 2
      const distance = Math.abs(center - trackCenter)
      if (distance < closestDistance) {
        closestDistance = distance
        closest = i
      }
    })
    setActive(closest)
  }

  // كل صور المعرض فشلت تحميلها فعلياً (بعد محاولتين لكل واحدة) — بدل carousel فاضي، نعرض
  // placeholder واحد بنفس ارتفاع الشريحة بالظبط (مفيش قفزة تخطيط).
  if (sorted.length === 0) {
    return (
      <div className="product-gallery">
        <div className="product-gallery-slide product-gallery-fallback">
          <span>{fallbackEmoji || '🛍️'}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="product-gallery">
      <div className="product-gallery-track" ref={trackRef} onScroll={onTrackScroll}>
        {sorted.map((img, i) => (
          <button
            key={img.id}
            className="product-gallery-slide"
            onClick={() => setLightboxOpen(true)}
            aria-label={ar.product.viewImageLarger}
          >
            <SafeImage
              sources={[transformImage(img.url, 'detail'), img.url]}
              alt={img.altText || productName}
              loading={i === 0 ? 'eager' : 'lazy'}
              // @ts-expect-error fetchpriority غير مدعوم رسمياً في تعريفات React لسه، لكنه attribute حقيقي مدعوم في المتصفحات
              fetchpriority={i === 0 ? 'high' : undefined}
              width={1000}
              height={1000}
              onAllFailed={() => markFailed(img.id)}
            />
          </button>
        ))}
      </div>

      {sorted.length > 1 && (
        <>
          <div className="product-gallery-dots">
            {sorted.map((img, i) => (
              <button
                key={img.id}
                className={`product-gallery-dot ${i === active ? 'active' : ''}`}
                onClick={() => scrollToIndex(i)}
                aria-label={`${ar.product.imageNumber(i + 1)}`}
              />
            ))}
          </div>
          <div className="product-gallery-thumbs">
            {sorted.map((img, i) => (
              <button
                key={img.id}
                className={`product-gallery-thumb ${i === active ? 'active' : ''}`}
                onClick={() => scrollToIndex(i)}
              >
                <SafeImage
                  sources={[transformImage(img.url, 'thumbnail'), img.url]}
                  alt=""
                  loading="lazy"
                  width={64}
                  height={64}
                  onAllFailed={() => markFailed(img.id)}
                />
              </button>
            ))}
          </div>
        </>
      )}

      {lightboxOpen && (
        <div className="product-gallery-lightbox" onClick={() => setLightboxOpen(false)} role="dialog" aria-modal="true">
          <button className="product-gallery-lightbox-close" onClick={() => setLightboxOpen(false)} aria-label={ar.common.close}>×</button>
          <div className="product-gallery-lightbox-scroll" onClick={e => e.stopPropagation()}>
            <SafeImage
              sources={[transformImage(sorted[active]?.url, 'detail'), sorted[active]?.url]}
              alt={sorted[active]?.altText || productName}
              onAllFailed={() => { const id = sorted[active]?.id; if (id) markFailed(id) }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
