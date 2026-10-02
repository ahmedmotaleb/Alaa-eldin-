import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react'

interface SafeImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  // رابط واحد أو أكثر بالأولوية — عادةً رابط واحد بس هنا (معاينات لوحة التحكم بتعرض الرابط
  // المخزّن مباشرة، من غير تحويل Cloudinary زي المتجر). قيم فاضية بتتجاهل تلقائياً.
  sources: Array<string | undefined>
  // بيظهر بدل الـ <img> تماماً بمجرد ما كل المحاولات تفشل — أبداً مفيش أيقونة صورة مكسورة
  // كبيرة من المتصفح جوه لوحة التحكم.
  fallback?: ReactNode
  onAllFailed?: () => void
}

// نفس مبدأ src/components/SafeImage.tsx في المتجر بالظبط — state machine محدّد (كل رابط
// بيتجرّب مرة واحدة بالترتيب)، بدون أي حلقة onError لا نهائية.
export function SafeImage({ sources, fallback = null, onAllFailed, alt, ...imgProps }: SafeImageProps) {
  const uniqueSources = [...new Set(sources.filter((s): s is string => !!s))]
  const [attempt, setAttempt] = useState(0)

  useEffect(() => { setAttempt(0) }, [uniqueSources[0]])

  const exhausted = uniqueSources.length === 0 || attempt >= uniqueSources.length

  useEffect(() => {
    if (exhausted && uniqueSources.length > 0) onAllFailed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exhausted, uniqueSources[0]])

  if (exhausted) return <>{fallback}</>

  return (
    <img
      {...imgProps}
      src={uniqueSources[attempt]}
      alt={alt}
      onError={() => setAttempt(a => a + 1)}
    />
  )
}
