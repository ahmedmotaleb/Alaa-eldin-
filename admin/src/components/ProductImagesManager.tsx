import { useEffect, useRef, useState } from 'react'
import { api, ApiError, type AdminProductImage } from '../utils/api'

// مُصدّرة عشان PendingProductImages (اختيار صور صفحة "إضافة منتج" قبل ما المنتج يتحفظ
// أصلاً) تستخدم نفس قواعد النوع/الحجم بالظبط، من غير تكرار الأرقام في مكانين.
// 'image/jpg' مُضاف كمرادف لـ JPEG — بعض متصفحات أندرويد بتبعته بدل 'image/jpeg' القياسي.
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = ALLOWED_IMAGE_TYPES
const MAX_SIZE_BYTES = MAX_IMAGE_SIZE_BYTES
const HEIC_HEIF_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']

// بعض متصفحات أندرويد بتسيب mimetype فاضي لملفات HEIC/HEIF — بنعتمد كمان على امتداد الملف
// نفسه كإشارة إضافية (للرسالة بس، التحقق الأمني الحقيقي دايماً على السيرفر بـ magic bytes).
function looksLikeHeic(file: File): boolean {
  if (HEIC_HEIF_TYPES.includes(file.type)) return true
  const name = file.name.toLowerCase()
  return name.endsWith('.heic') || name.endsWith('.heif')
}

// رسائل خطأ محددة حسب كود السيرفر — fallback عام واحد بس لأي كود غير متوقع.
function errorMessageFor(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'image_storage_not_configured': return 'خدمة تخزين الصور غير مفعلة على السيرفر'
      case 'invalid_file': return 'ملف الصورة غير صالح'
      case 'no_file_or_invalid_type': return 'صيغة الصورة غير مدعومة — استخدم JPG أو PNG أو WebP'
      case 'heic_not_supported': return 'صيغة HEIC/HEIF غير مدعومة حالياً — حوّل الصورة إلى JPG من إعدادات الكاميرا ثم أعد المحاولة'
      case 'file_too_large': return 'حجم الصورة أكبر من 5 ميجابايت'
      case 'too_many_files': return 'اختر صورة واحدة فقط في كل مرة'
      case 'malformed_upload': return 'تعذر رفع الصورة، حاول مرة أخرى'
      case 'upload_failed': return 'فشل رفع الصورة إلى خدمة التخزين'
      case 'product_not_found': return 'المنتج غير موجود'
      case 'network_error': return 'تعذر الاتصال بالسيرفر'
    }
    if (err.status === 401) return 'انتهت الجلسة — سجّل الدخول من جديد'
    if (err.status === 403) return 'لا تملك صلاحية رفع صور المنتجات'
    if (err.status === 429) return 'تم رفع صور كثيرة في وقت قصير، حاول بعد دقيقة'
  }
  return 'تعذر رفع الصورة، حاول مرة أخرى'
}

export function ProductImagesManager({ productId }: { productId: string }) {
  const [images, setImages] = useState<AdminProductImage[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.listProductImages(productId)
      .then(({ images }) => setImages(images))
      .catch(() => setError('تعذر تحميل صور المنتج'))
      .finally(() => setLoading(false))
  }, [productId])

  async function handleFile(file: File) {
    setError('')
    if (looksLikeHeic(file)) {
      setError('صيغة HEIC/HEIF غير مدعومة حالياً — حوّل الصورة إلى JPG من إعدادات الكاميرا ثم أعد المحاولة')
      return
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('صيغة الصورة غير مدعومة — استخدم JPG أو PNG أو WebP')
      return
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError('حجم الصورة أكبر من 5 ميجابايت')
      return
    }
    // منع نقرة مزدوجة عرضية وقت الرفع — الـ input بالفعل disabled، وده طبقة أمان إضافية.
    if (uploading) return
    setUploading(true)
    try {
      const { image } = await api.uploadProductImage(productId, file)
      setImages(current => [...current, image].sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || a.sortOrder - b.sortOrder))
    } catch (err) {
      setError(errorMessageFor(err))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function setPrimary(imageId: string) {
    setImages(current => current.map(img => ({ ...img, isPrimary: img.id === imageId })))
    try {
      await api.setPrimaryProductImage(productId, imageId)
    } catch {
      setError('تعذر تعيين الصورة الرئيسية')
    }
  }

  async function updateAlt(imageId: string, altText: string) {
    setImages(current => current.map(img => img.id === imageId ? { ...img, altText } : img))
    try {
      await api.updateProductImageAlt(productId, imageId, altText)
    } catch {
      setError('تعذر حفظ النص البديل')
    }
  }

  async function remove(imageId: string) {
    const previous = images
    setImages(current => current.filter(img => img.id !== imageId))
    try {
      await api.deleteProductImage(productId, imageId)
    } catch {
      setError('تعذر حذف الصورة')
      setImages(previous)
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const next = [...images]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setImages(next)
    try {
      await api.reorderProductImages(productId, next.map(img => img.id))
    } catch {
      setError('تعذر حفظ ترتيب الصور')
    }
  }

  if (loading) return null

  return (
    <div className="admin-form-card">
      <div>
        <div className="admin-form-card-title">صور المنتج</div>
        <div className="admin-form-card-sub">الصورة الرئيسية تظهر أولاً في المتجر — الإيموجي يفضل احتياطي لو مفيش صور</div>
      </div>

      {error && <div className="admin-form-error">{error}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {images.map((img, index) => (
          <div key={img.id} style={{ width: 140, border: '1px solid #dce4de', borderRadius: 11, padding: 8, background: '#fbfcfb' }}>
            <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
              <img src={img.imageUrl} alt={img.altText} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              {img.isPrimary && (
                <span style={{ position: 'absolute', top: 6, insetInlineStart: 6, background: '#16A34A', color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999 }}>
                  رئيسية
                </span>
              )}
            </div>
            <input
              value={img.altText}
              onChange={e => updateAlt(img.id, e.target.value)}
              placeholder="النص البديل"
              aria-label="النص البديل للصورة"
              style={{ width: '100%', marginTop: 6, fontSize: 11, border: '1px solid #dce4de', borderRadius: 7, padding: '4px 6px' }}
            />
            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              {!img.isPrimary && (
                <button type="button" onClick={() => setPrimary(img.id)} style={{ fontSize: 10, fontWeight: 700, border: 'none', background: '#EAF8EF', color: '#12813C', borderRadius: 6, padding: '4px 6px', cursor: 'pointer' }}>
                  تعيين كصورة رئيسية
                </button>
              )}
              <button type="button" aria-label="نقل لأعلى" disabled={index === 0} onClick={() => move(index, -1)} style={{ fontSize: 10, border: 'none', background: '#F1F4F2', borderRadius: 6, padding: '4px 6px', cursor: 'pointer' }}>▲</button>
              <button type="button" aria-label="نقل لأسفل" disabled={index === images.length - 1} onClick={() => move(index, 1)} style={{ fontSize: 10, border: 'none', background: '#F1F4F2', borderRadius: 6, padding: '4px 6px', cursor: 'pointer' }}>▼</button>
              <button type="button" onClick={() => remove(img.id)} style={{ fontSize: 10, fontWeight: 700, border: 'none', background: '#FFECEC', color: '#B42318', borderRadius: 6, padding: '4px 6px', cursor: 'pointer' }}>
                حذف الصورة
              </button>
            </div>
          </div>
        ))}
      </div>

      <label className="admin-form-chip" style={{ display: 'inline-flex', width: 'fit-content', cursor: uploading ? 'wait' : 'pointer' }}>
        {uploading ? 'جارِ رفع الصورة...' : 'إضافة صور'}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={uploading}
          onChange={e => { const file = e.target.files?.[0]; if (file) handleFile(file) }}
          style={{ display: 'none' }}
        />
      </label>
    </div>
  )
}
