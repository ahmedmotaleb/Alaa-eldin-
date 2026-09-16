import { useRef, useState } from 'react'
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE_BYTES } from './ProductImagesManager'

export interface StagedProductImage {
  file: File
  previewUrl: string
}

interface Props {
  staged: StagedProductImage[]
  onChange: (next: StagedProductImage[]) => void
}

// نسخة "قبل الحفظ" من مدير صور المنتج — بتُستخدم في صفحة "إضافة منتج" بس، لما المنتج لسه
// معندوش id حقيقي فمفيش رفع فعلي ممكن (الرفع محتاج productId موجود بالفعل في القاعدة).
// الصور هنا بتتخزن محلياً كـ File objects عادية وبتتعرض كمعاينة بس (URL.createObjectURL)،
// وبيتم رفعها فعلياً بعد نجاح إنشاء المنتج مباشرة (راجع ProductFormPage.save()) — أول صورة
// في الترتيب هي اللي هتبقى الرئيسية.
export function PendingProductImages({ staged, onChange }: Props) {
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function addFile(file: File) {
    setError('')
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError('نوع الملف غير مدعوم — استخدم JPEG أو PNG أو WebP')
      return
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setError('حجم الصورة أكبر من الحد المسموح (5 ميجابايت)')
      return
    }
    onChange([...staged, { file, previewUrl: URL.createObjectURL(file) }])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function remove(index: number) {
    URL.revokeObjectURL(staged[index].previewUrl)
    onChange(staged.filter((_, i) => i !== index))
  }

  return (
    <div className="admin-form-card">
      <div>
        <div className="admin-form-card-title">صور المنتج</div>
        <div className="admin-form-card-sub">هترفع فعلياً بعد حفظ المنتج مباشرة — أول صورة هتبقى الرئيسية</div>
      </div>

      {error && <div className="admin-form-error">{error}</div>}

      {staged.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {staged.map((img, index) => (
            <div key={img.previewUrl} style={{ width: 140, border: '1px solid #dce4de', borderRadius: 11, padding: 8, background: '#fbfcfb' }}>
              <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                <img src={img.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                {index === 0 && (
                  <span style={{ position: 'absolute', top: 6, insetInlineStart: 6, background: '#16A34A', color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999 }}>
                    رئيسية
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(index)}
                style={{ fontSize: 10, fontWeight: 700, border: 'none', background: '#FFECEC', color: '#B42318', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', marginTop: 6, width: '100%' }}
              >
                إزالة
              </button>
            </div>
          ))}
        </div>
      )}

      <label className="admin-form-chip" style={{ display: 'inline-flex', width: 'fit-content', cursor: 'pointer' }}>
        إضافة صور
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={e => { const file = e.target.files?.[0]; if (file) addFile(file) }}
          style={{ display: 'none' }}
        />
      </label>
    </div>
  )
}
