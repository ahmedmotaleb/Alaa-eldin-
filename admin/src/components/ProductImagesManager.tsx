import { useEffect, useRef, useState } from 'react'
import { api, ApiError, type AdminProductImage } from '../utils/api'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE_BYTES = 5 * 1024 * 1024

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
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('نوع الملف غير مدعوم — استخدم JPEG أو PNG أو WebP')
      return
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError('حجم الصورة أكبر من الحد المسموح (5 ميجابايت)')
      return
    }
    setUploading(true)
    try {
      const { image } = await api.uploadProductImage(productId, file)
      setImages(current => [...current, image].sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || a.sortOrder - b.sortOrder))
    } catch (err) {
      if (err instanceof ApiError && err.code === 'image_storage_not_configured') {
        setError('تخزين الصور غير مُفعّل حالياً على السيرفر — تواصل مع الدعم الفني')
      } else {
        setError('تعذر رفع الصورة، حاول مرة أخرى')
      }
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
        {uploading ? 'جارِ الرفع...' : 'إضافة صور'}
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
