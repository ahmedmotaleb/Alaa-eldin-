import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, ApiError, type AdminCategory, type AdminProductInput } from '../../utils/api'
import { ProductImagesManager } from '../../components/ProductImagesManager'
import { PendingProductImages, type StagedProductImage } from '../../components/PendingProductImages'
import { ProductAlternativesManager } from '../../components/ProductAlternativesManager'
import { ProductVariantsManager } from '../../components/ProductVariantsManager'
import { ProductPriceHistory } from '../../components/ProductPriceHistory'
import { BarcodeCameraView } from '../../components/BarcodeScannerInput'
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner'
import { setPendingUploadOutcome, takePendingUploadOutcome } from '../../utils/pendingProductUploads'
import type { LayoutContext } from '../../components/AdminLayout'

const UNITS = ['قطعة', 'عبوة', 'كرتونة', 'كجم', 'جرام', 'لتر', 'مل', 'زجاجة']

// رسائل خطأ محددة حسب كود الخطأ الراجع من السيرفر — بدل رسالة عامة واحدة تخفي أي حقل
// فعلياً الغلط فيه. كود مش موجود هنا (خطأ غير متوقع) بيرجع للرسالة العامة كـ fallback.
const SAVE_ERROR_MESSAGES: Record<string, string> = {
  invalid_category: 'اختر تصنيف صحيح للمنتج',
  invalid_name: 'اسم المنتج مطلوب',
  invalid_description: 'الوصف غير صالح',
  invalid_price: 'سعر البيع لازم يكون رقم أكبر من صفر',
  invalid_cost: 'تكلفة المنتج لازم تكون رقم صفر أو أكبر',
  invalid_unit: 'اختر وحدة صحيحة للمنتج',
  invalid_emoji: 'الإيموجي غير صالح',
  invalid_available: 'حالة العرض غير صالحة',
  invalid_stock: 'الكمية المتاحة لازم تكون رقم صفر أو أكبر',
  invalid_alert_threshold: 'حد تنبيه المخزون لازم يكون رقم صفر أو أكبر',
  category_not_found: 'التصنيف المختار غير موجود، اختر تصنيف تاني',
  product_not_found: 'المنتج غير موجود، ربما تم حذفه',
  barcode_already_used: 'هذا الباركود مستخدم بالفعل'
}

const emptyForm: AdminProductInput = {
  id: '', slug: '', categoryId: '', name: '', description: '', price: 0, oldPrice: undefined,
  cost: 0, unit: 'عبوة', emoji: '📦', available: true, bestseller: false, offer: false,
  stock: 0, alertThreshold: 10, barcode: '', brand: '', tracksExpiry: false, defaultShelfLifeDays: null, sku: null
}

export function ProductFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const location = useLocation()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [categories, setCategories] = useState<AdminCategory[]>([])
  // لو جاي من صفحة "مسح الباركود" بعد باركود غير مسجّل ("إضافة منتج جديد بهذا الباركود")،
  // الباركود بيتوصّل عبر router state (navigate state)، مش query param — عشان ميتسجّلش في
  // الـ history/الرابط نفسه. بيتطبّق بس لمنتج جديد (مش تعديل منتج موجود).
  const [form, setForm] = useState<AdminProductInput>(() => {
    const prefillBarcode = !isEdit && (location.state as { prefillBarcode?: unknown } | null)?.prefillBarcode
    return typeof prefillBarcode === 'string' && prefillBarcode ? { ...emptyForm, barcode: prefillBarcode } : emptyForm
  })
  const [loading, setLoading] = useState(isEdit)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [expirySaving, setExpirySaving] = useState(false)
  const [expirySuccess, setExpirySuccess] = useState('')
  const [skuInput, setSkuInput] = useState('')
  const [skuSaving, setSkuSaving] = useState(false)
  const [skuSuccess, setSkuSuccess] = useState('')
  const [stagedImages, setStagedImages] = useState<StagedProductImage[]>([])
  const stagedImagesRef = useRef(stagedImages)
  stagedImagesRef.current = stagedImages
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteNotice, setDeleteNotice] = useState('')
  const oldPriceInputRef = useRef<HTMLInputElement>(null)
  const barcodeInputRef = useRef<HTMLInputElement>(null)
  const [scanConfirmation, setScanConfirmation] = useState('')
  const [barcodeDuplicate, setBarcodeDuplicate] = useState<{ id: string, label: string } | null>(null)
  // صور فشل رفعها بعد إنشاء منتج جديد — بتتحمّل هنا من pendingProductUploads بعد التنقّل
  // لصفحة التعديل (راجع save()). منفصلة عن stagedImages لأن دي للمنتج الجديد قبل الحفظ،
  // وده "رفع متبقٍّ" لمنتج موجود بالفعل.
  const [retryImages, setRetryImages] = useState<StagedProductImage[]>([])
  const retryImagesRef = useRef(retryImages)
  retryImagesRef.current = retryImages
  const [retryBusy, setRetryBusy] = useState(false)
  const [imagesRefreshKey, setImagesRefreshKey] = useState(0)
  const [imagesUploadedSuccess, setImagesUploadedSuccess] = useState(false)

  // نفس هوك المسح بالكاميرا المستخدم في BarcodeScanPage بالظبط (BarcodeDetector/ZXing، تبديل
  // كاميرا، فلاش، تبريد) — هنا بس بيحدّث form.barcode مباشرة، أبداً مفيش بحث عن منتج تلقائي
  // وقت المسح جوه نموذج المنتج نفسه (ده المنتج اللي الأدمن بيضيفه/يعدّله دلوقتي، مش بحث).
  const scanner = useBarcodeScanner({
    onDetected: value => {
      set('barcode', value)
      setScanConfirmation(value)
      checkBarcodeDuplicate(value)
    }
  })

  useEffect(() => {
    setHeader({ crumb: 'المنتجات', title: isEdit ? 'تعديل منتج' : 'إضافة منتج' })
  }, [setHeader, isEdit])

  useEffect(() => {
    api.listCategories().then(({ categories }) => {
      setCategories(categories)
      setForm(current => current.categoryId ? current : { ...current, categoryId: categories[0]?.id ?? '' })
    })
  }, [])

  useEffect(() => {
    if (!id) return
    api.getProduct(id)
      .then(({ product }) => { setForm(product); setSkuInput(product.sku ?? '') })
      .catch(() => setError('تعذر تحميل بيانات المنتج'))
      .finally(() => setLoading(false))

    // لو جاي من صفحة "إضافة منتج" فوراً بعد إنشائه — صور فشل رفعها (لو في) محمولة هنا، أو
    // علامة نجاح كامل (راجع save() وPendingUploadOutcome). القراءة بتمسح القيمة فوراً.
    const outcome = takePendingUploadOutcome(id)
    if (outcome) {
      if (outcome.failed.length > 0) {
        setRetryImages(outcome.failed)
      } else if (outcome.hadImages) {
        setImagesUploadedSuccess(true)
      }
      setSuccess('تم حفظ المنتج')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // معاينات الصور المختارة قبل الحفظ عبارة عن blob URLs محلية — لازم تتحرر (revoke) لما
  // الصفحة تتسكّر، وإلا هتفضل محتجزة في الذاكرة (الملاحة داخل SPA مش بتعمل reload كامل).
  useEffect(() => {
    return () => { stagedImagesRef.current.forEach(img => URL.revokeObjectURL(img.previewUrl)) }
  }, [])

  function set<K extends keyof AdminProductInput>(key: K, value: AdminProductInput[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  // بعد باركود مسحوح أو مكتوب يدوياً — تطابق تام مع باركود منتج تاني أو متغيّر تابع لمنتج
  // تاني (findProductByBarcode بالفعل بيدوّر في الاتنين، راجع productSkuService.ts). لو
  // المنتج اللي رجع هو نفس المنتج اللي بنعدّله دلوقتي (باركوده الحالي نفسه ملمسوش)، ده مش
  // تكرار فعلي. أي خطأ شبكة هنا بيتجاهل بهدوء — الفحص ده مساعد، مش شرط لإتمام الحفظ.
  async function checkBarcodeDuplicate(rawValue: string) {
    const value = rawValue.trim()
    if (!value) { setBarcodeDuplicate(null); return }
    try {
      const { product: found } = await api.findProductByBarcode(value)
      if (found.id === id) { setBarcodeDuplicate(null); return }
      setBarcodeDuplicate({ id: found.id, label: found.variant ? `${found.name} (المتغيّر: ${found.variant.name})` : found.name })
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setBarcodeDuplicate(null)
    }
  }

  // رفع صور منتج جديد بعد إنشائه بنجاح — خطوة واحدة فقط، من غير أي حلقة إعادة محاولة داخلية؛
  // أي فشل بيُحمل (pendingProductUploads) للتنقّل الفوري لصفحة التعديل، فإعادة المحاولة
  // الفعلية بتحصل هناك (retryFailedImages) على منتج موجود بالفعل، لا أبداً عن طريق إنشاء
  // منتج تاني. بيرجع الصور اللي فشلت بس (الناجحة بترفع URLها تلقائياً).
  async function uploadImagesAfterCreate(productId: string, images: StagedProductImage[]): Promise<StagedProductImage[]> {
    const failed: StagedProductImage[] = []
    for (const staged of images) {
      try {
        await api.uploadProductImage(productId, staged.file)
        URL.revokeObjectURL(staged.previewUrl)
      } catch {
        failed.push(staged)
      }
    }
    return failed
  }

  // إعادة محاولة الصور اللي فشل رفعها (منتج موجود بالفعل، إما إحنا لسه عليه من إنشاء جديد،
  // أو من فتح صفحة تعديل فيها رفع متبقٍّ). بعد نجاح الكل — refreshKey بيتغيّر عشان
  // ProductImagesManager يجيب القائمة تاني من السيرفر فوراً (listProductImages حقيقي، مش
  // افتراض محلي)، تأكيداً إن الصورة بقت موجودة فعلاً.
  async function retryFailedImages() {
    if (!id || retryImages.length === 0) return
    setRetryBusy(true)
    try {
      const stillFailing = await uploadImagesAfterCreate(id, retryImagesRef.current)
      setRetryImages(stillFailing)
      if (stillFailing.length === 0) {
        setImagesRefreshKey(k => k + 1)
        setImagesUploadedSuccess(true)
      }
    } finally {
      setRetryBusy(false)
    }
  }

  async function save() {
    setError('')
    setSuccess('')
    setImagesUploadedSuccess(false)
    // باركود متطابق مع منتج (أو متغيّر) تاني — ممنوع الحفظ أصلاً، مش بس تحذير. الفحص
    // الحقيقي/النهائي على السيرفر برضه (barcode_already_used أسفل)، ده بس منع استباقي
    // بيوفّر رحلة شبكة كاملة لحالة واضحة أصلاً.
    if (barcodeDuplicate) {
      setError('هذا الباركود مستخدم بالفعل — غيّر الباركود قبل الحفظ')
      return
    }
    setSaving(true)
    try {
      // offer عمود GENERATED من السيرفر (oldPrice > price، راجع productService.ts) — السيرفر
      // بيتجاهل أي قيمة offer متبعتة هنا، مش محتاجين نحسبها أو نرسلها.
      const payload: AdminProductInput = { ...form }
      if (isEdit && id) {
        const { product } = await api.updateProduct(id, payload)
        setForm(product)
        setSuccess('تم حفظ التعديلات')
      } else {
        const { product } = await api.createProduct(payload)
        const images = stagedImagesRef.current
        const failed = await uploadImagesAfterCreate(product.id, images)
        setStagedImages([])
        setPendingUploadOutcome(product.id, { failed, hadImages: images.length > 0 })
        // التنقّل لصفحة التعديل بيحصل دايماً هنا — نجح رفع الصور أو فشل، المنتج أصلاً
        // محفوظ بالفعل ومينفعش يضيع؛ حالة الصور (نجاح/فشل مع إعادة محاولة) بتُعرض هناك.
        navigate(`/products/edit/${product.id}`, { replace: true })
        return
      }
    } catch (err) {
      if (err instanceof ApiError && SAVE_ERROR_MESSAGES[err.code]) setError(SAVE_ERROR_MESSAGES[err.code])
      else setError('تعذر حفظ المنتج، تحقق من البيانات وحاول مرة أخرى')
    } finally {
      setSaving(false)
    }
  }

  async function saveExpirySettings() {
    if (!id) return
    setExpirySuccess('')
    setExpirySaving(true)
    try {
      const { product } = await api.setProductExpirySettings(id, {
        tracksExpiry: form.tracksExpiry,
        defaultShelfLifeDays: form.defaultShelfLifeDays
      })
      setForm(current => ({ ...current, tracksExpiry: product.tracksExpiry, defaultShelfLifeDays: product.defaultShelfLifeDays }))
      setExpirySuccess('تم حفظ إعداد الصلاحية')
    } catch {
      window.alert('تعذر حفظ إعداد الصلاحية')
    } finally {
      setExpirySaving(false)
    }
  }

  async function saveSku() {
    if (!id) return
    setSkuSuccess('')
    setSkuSaving(true)
    try {
      const result = await api.setProductSku(id, skuInput.trim() || null)
      setSkuInput(result.sku ?? '')
      setForm(current => ({ ...current, sku: result.sku }))
      setSkuSuccess('تم حفظ SKU')
    } catch (err) {
      window.alert(err instanceof ApiError && err.code === 'sku_taken' ? 'هذا الـ SKU مستخدم بالفعل لمنتج آخر' : 'تعذر حفظ SKU')
    } finally {
      setSkuSaving(false)
    }
  }

  async function generateSku() {
    if (!id) return
    setSkuSuccess('')
    setSkuSaving(true)
    try {
      const result = await api.generateProductSku(id)
      setSkuInput(result.sku ?? '')
      setForm(current => ({ ...current, sku: result.sku }))
      setSkuSuccess('تم توليد SKU تلقائياً')
    } catch {
      window.alert('تعذر توليد SKU — قد يكون للمنتج SKU بالفعل')
    } finally {
      setSkuSaving(false)
    }
  }

  // حذف ناعم (soft delete) بس — الصف فاضل في قاعدة البيانات، بيختفي من الكتالوج والبحث بس
  // (راجع productService.softDeleteProduct). الاستعادة بترجّعه للقايمة العادية لكن بتفضل
  // "مخفي" (available=0) لحد ما الأدمن يظهره بنفسه صراحةً من زر "معروض" فوق.
  async function deleteProduct() {
    if (!id) return
    if (!window.confirm('سيتم حذف هذا المنتج. هذا إجراء قابل للتراجع (يمكن استعادته لاحقاً من قائمة "عرض المحذوفة")، لكنه سيختفي فوراً من الكتالوج ولن يظهر للعملاء.')) return
    setDeleteBusy(true)
    try {
      await api.deleteProduct(id)
      navigate('/products')
    } catch {
      window.alert('تعذر حذف المنتج')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function restoreProduct() {
    if (!id) return
    setDeleteBusy(true)
    try {
      const { product } = await api.restoreProduct(id)
      setForm(product)
      setDeleteNotice('تم استعادة المنتج — لا يزال مخفياً عن العملاء، أظهره من "حالة المنتج" أعلاه لو حابب')
    } catch {
      window.alert('تعذر استعادة المنتج')
    } finally {
      setDeleteBusy(false)
    }
  }

  if (loading) return null

  return (
    <div className="admin-form-grid">
      {isEdit && id && retryImages.length > 0 && (
        <div className="admin-form-card">
          <div className="admin-form-error">
            {retryImages.length === 1 ? 'تم حفظ المنتج، لكن لم يتم رفع الصورة' : `تم حفظ المنتج، لكن لم يتم رفع ${retryImages.length} صور`}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {retryImages.map(img => (
              <img key={img.previewUrl} src={img.previewUrl} alt="" style={{ width: 80, height: 80, objectFit: 'contain', borderRadius: 8, border: '1px solid #dce4de', background: '#fff' }} />
            ))}
          </div>
          <button type="button" className="admin-form-save" disabled={retryBusy} onClick={retryFailedImages}>
            {retryBusy ? 'جارِ رفع الصورة...' : 'إعادة رفع الصورة'}
          </button>
        </div>
      )}
      {isEdit && imagesUploadedSuccess && retryImages.length === 0 && (
        <div className="admin-form-success">تم رفع الصور بنجاح</div>
      )}
      {isEdit && id && <ProductImagesManager productId={id} refreshKey={imagesRefreshKey} />}
      {!isEdit && <PendingProductImages staged={stagedImages} onChange={setStagedImages} />}
      {isEdit && id && <ProductAlternativesManager productId={id} />}
      {isEdit && id && <ProductVariantsManager productId={id} />}
      {isEdit && id && <ProductPriceHistory productId={id} />}

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">البيانات الأساسية</div>
          <div className="admin-form-card-sub">الاسم والوصف والتصنيف</div>
        </div>
        <label>اسم المنتج
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="مثال: زيت عباد الشمس 1 لتر" />
        </label>
        <label>الوصف
          <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder="وصف مختصر يظهر في صفحة المنتج" />
        </label>
        <label>القسم
          <span className="admin-form-chips">
            {categories.map(c => (
              <button key={c.id} type="button" className={`admin-form-chip ${form.categoryId === c.id ? 'active' : ''}`} onClick={() => set('categoryId', c.id)}>
                {c.emoji} {c.name}
              </button>
            ))}
          </span>
        </label>
        <label>العلامة التجارية
          <input value={form.brand} onChange={e => set('brand', e.target.value)} placeholder="مثال: كريستال" />
        </label>
        <label>الإيموجي المعروض للمنتج (اختياري)
          <input value={form.emoji} onChange={e => set('emoji', e.target.value)} placeholder="🫒" />
          <span className="admin-form-help">يُستخدم بديل مؤقت لو المنتج لسه من غير صورة حقيقية — لو فيه صورة مرفوعة، هي اللي بتظهر أولاً دايماً</span>
        </label>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">السعر والتكلفة</div>
          <div className="admin-form-card-sub">الهامش يُحسب تلقائياً</div>
        </div>
        <div className="admin-row-2">
          <label>سعر البيع (ج.م)
            <input type="number" value={form.price} onChange={e => set('price', Number(e.target.value))} />
          </label>
          <label>السعر قبل الخصم (ج.م)
            <input
              ref={oldPriceInputRef} type="number" value={form.oldPrice ?? ''}
              onChange={e => set('oldPrice', e.target.value ? Number(e.target.value) : undefined)} placeholder="اختياري"
            />
          </label>
        </div>
        {/* offer عمود GENERATED من السيرفر (oldPrice > price) — هنا بس عرض حالة حيّة من
            نفس القيمتين، مفيش checkbox مستقل ممكن يتعارض مع السعرين. */}
        {form.oldPrice && form.oldPrice > form.price ? (
          <div className="admin-form-success">✅ هذا المنتج ظاهر في عروض اليوم</div>
        ) : (
          <div className="admin-form-help" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>هذا المنتج غير موجود في عروض اليوم</span>
            <button type="button" className="admin-form-chip" onClick={() => oldPriceInputRef.current?.focus()}>إضافة إلى العروض</button>
          </div>
        )}
        <label>تكلفة المنتج (ج.م)
          <input type="number" value={form.cost} onChange={e => set('cost', Number(e.target.value))} />
          <span className="admin-form-help">الهامش الحالي: {form.price ? Math.round(((form.price - form.cost) / form.price) * 100) : 0}%</span>
        </label>
        <label>الوحدة
          <span className="admin-form-chips">
            {UNITS.map(u => (
              <button key={u} type="button" className={`admin-form-chip ${form.unit === u ? 'active' : ''}`} onClick={() => set('unit', u)}>{u}</button>
            ))}
          </span>
        </label>
        <label>حالة المنتج
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.available ? 'active' : ''}`} onClick={() => set('available', true)}>معروض</button>
            <button type="button" className={`admin-form-chip ${!form.available ? 'active' : ''}`} onClick={() => set('available', false)}>مخفي</button>
          </span>
        </label>
        <label>الأكثر مبيعاً
          <span className="admin-form-chips">
            <button type="button" className={`admin-form-chip ${form.bestseller ? 'active' : ''}`} onClick={() => set('bestseller', true)}>نعم</button>
            <button type="button" className={`admin-form-chip ${!form.bestseller ? 'active' : ''}`} onClick={() => set('bestseller', false)}>لا</button>
          </span>
        </label>
      </div>

      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">المخزون والتعريف</div>
          <div className="admin-form-card-sub">التتبع والتنبيهات</div>
        </div>
        <label>الباركود (اختياري)
          <input
            ref={barcodeInputRef}
            value={form.barcode}
            onChange={e => { set('barcode', e.target.value); setScanConfirmation(''); setBarcodeDuplicate(null) }}
            onBlur={() => checkBarcodeDuplicate(form.barcode)}
            onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
            placeholder="اتركه فارغاً لو المنتج من غير باركود"
          />
        </label>
        <span className="admin-form-chips">
          <button
            type="button" className="admin-form-chip"
            disabled={scanner.cameraState === 'starting'}
            onClick={() => scanner.startCameraScan()}
          >
            📷 مسح بالكاميرا
          </button>
          <button
            type="button" className="admin-form-chip"
            onClick={() => { barcodeInputRef.current?.focus(); barcodeInputRef.current?.select() }}
          >
            🔎 استخدام قارئ الباركود
          </button>
        </span>

        <BarcodeCameraView scanner={scanner} hint="ضع الباركود داخل الإطار" />

        {scanConfirmation && <div className="admin-form-success">تم مسح الباركود: {scanConfirmation}</div>}
        {barcodeDuplicate && (
          <div className="admin-form-error">
            هذا الباركود مستخدم بالفعل — {barcodeDuplicate.label}
            <button
              type="button" className="admin-form-chip" style={{ marginInlineStart: 8 }}
              onClick={() => navigate(`/products/edit/${barcodeDuplicate.id}`)}
            >
              عرض المنتج
            </button>
          </div>
        )}
        <div className="admin-row-2">
          <label>الكمية المتاحة
            <input type="number" value={form.stock} onChange={e => set('stock', Number(e.target.value))} />
          </label>
          <label>حد تنبيه المخزون
            <input type="number" value={form.alertThreshold} onChange={e => set('alertThreshold', Number(e.target.value))} />
            <span className="admin-form-help">يظهر تنبيه لما يقل المخزون عن هذا الرقم</span>
          </label>
        </div>

        {error && <div className="admin-form-error">{error}</div>}
        {success && <div className="admin-form-success">{success}</div>}
        <button className="admin-form-save" disabled={saving} onClick={save}>{isEdit ? 'حفظ التعديلات' : 'حفظ ونشر المنتج'}</button>
      </div>

      {isEdit && (
        <div className="admin-form-card">
          <div>
            <div className="admin-form-card-title">SKU</div>
            <div className="admin-form-card-sub">رمز داخلي لإدارة المخزون — مختلف عن الباركود</div>
          </div>
          <label>SKU
            <input value={skuInput} onChange={e => setSkuInput(e.target.value)} placeholder="اتركه فارغاً لحذف الـ SKU" />
          </label>
          <span className="admin-form-chips">
            <button type="button" className="admin-form-chip" disabled={skuSaving} onClick={saveSku}>حفظ</button>
            <button type="button" className="admin-form-chip" disabled={skuSaving || !!form.sku} onClick={generateSku}>توليد تلقائي</button>
          </span>
          {skuSuccess && <div className="admin-form-success">{skuSuccess}</div>}
        </div>
      )}

      {isEdit && (
        <div className="admin-form-card">
          <div>
            <div className="admin-form-card-title">إعداد الصلاحية</div>
            <div className="admin-form-card-sub">لو مفعّل، استلام البضاعة هيطلب تاريخ صلاحية لهذا المنتج</div>
          </div>
          <label>تتبع الصلاحية
            <span className="admin-form-chips">
              <button type="button" className={`admin-form-chip ${form.tracksExpiry ? 'active' : ''}`} onClick={() => set('tracksExpiry', true)}>مفعّل</button>
              <button type="button" className={`admin-form-chip ${!form.tracksExpiry ? 'active' : ''}`} onClick={() => set('tracksExpiry', false)}>معطّل</button>
            </span>
          </label>
          <label>مدة الصلاحية الافتراضية (بالأيام، اختياري)
            <input
              type="number" min={1} value={form.defaultShelfLifeDays ?? ''}
              onChange={e => set('defaultShelfLifeDays', e.target.value ? Number(e.target.value) : null)}
              placeholder="مثال: 180"
            />
          </label>
          {expirySuccess && <div className="admin-form-success">{expirySuccess}</div>}
          <button className="admin-form-save" disabled={expirySaving} onClick={saveExpirySettings}>حفظ إعداد الصلاحية</button>
        </div>
      )}

      {isEdit && (
        <div className="admin-form-card">
          <div>
            <div className="admin-form-card-title">{form.deleted ? 'المنتج محذوف' : 'حذف المنتج'}</div>
            <div className="admin-form-card-sub">
              {form.deleted
                ? 'هذا المنتج محذوف حالياً ومخفي تماماً عن العملاء والكتالوج'
                : 'حذف آمن (قابل للتراجع) — المنتج يختفي من الكتالوج فوراً لكن بياناته وسجله التاريخي (الطلبات والمخزون) يبقى محفوظاً'}
            </div>
          </div>
          {deleteNotice && <div className="admin-form-success">{deleteNotice}</div>}
          {form.deleted
            ? <button className="admin-form-chip" disabled={deleteBusy} onClick={restoreProduct}>استعادة المنتج</button>
            : <button className="admin-form-chip" style={{ background: '#FFECEC', color: '#B42318' }} disabled={deleteBusy} onClick={deleteProduct}>حذف المنتج</button>}
        </div>
      )}
    </div>
  )
}
