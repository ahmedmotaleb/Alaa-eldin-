import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react'

interface SafeImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  // روابط مرتّبة بالأولوية — عادةً [الرابط المحوّل من Cloudinary, الرابط الأصلي غير المحوّل].
  // بيتجرّب كل رابط مرة واحدة بالترتيب؛ أي تكرار أو قيمة فاضية بيتجاهل تلقائياً، فالحد الأقصى
  // الفعلي للمحاولات هو عدد الروابط الفريدة الموجودة فعلاً (عادةً 2).
  sources: Array<string | undefined>
  // بيظهر بدل الـ <img> تماماً بمجرد ما كل المحاولات تفشل — أبداً مفيش أيقونة صورة مكسورة
  // من المتصفح، والـ alt text مابيظهرش معاها كنص عادي في الواجهة.
  fallback?: ReactNode
  // بينادَى مرة واحدة بس لما كل المحاولات تفشل فعلاً (مش لما مفيش صورة من الأساس أصلاً —
  // ده مش خطأ، راجع "منتج من غير صورة عمداً" مش حالة فشل).
  onAllFailed?: () => void
}

// مكوّن صورة آمن عام — state machine محدّد: "المحوّلة ← الأصلية ← fallback"، بدون أي حلقة
// onError لا نهائية (كل رابط بيتجرّب مرة واحدة بالظبط). بيُستخدم لأي صورة منتج/بانر/قسم في
// المتجر بدل <img> مباشرة، عشان العميل أبداً ميشوفش أيقونة الصورة المكسورة من المتصفح.
export function SafeImage({ sources, fallback = null, onAllFailed, alt, ...imgProps }: SafeImageProps) {
  const uniqueSources = [...new Set(sources.filter((s): s is string => !!s))]
  const [attempt, setAttempt] = useState(0)

  // لو الرابط الأساسي اتغيّر فعلياً (منتج/بانر مختلف اتعرض في نفس المكان)، لازم نرجّع
  // نجرّب من الأول بدل ما نفضل عالقين على حالة فشل قديمة تخص صورة تانية خالص.
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
