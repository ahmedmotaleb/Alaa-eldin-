import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type ScannedBarcodeProduct } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import { SafeImage } from '../../components/SafeImage'
import { BarcodeCameraView } from '../../components/BarcodeScannerInput'
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner'
import type { LayoutContext } from '../../components/AdminLayout'

// حد زمني بين أحرف قارئ باركود فيزيائي حقيقي (أسرع بكتير من كتابة إنسان عادي) — لو الفرق
// بين ضغطتين أكبر من ده، نعتبرها كتابة طبيعية جديدة ونصفّر البفر بدل ما نخلطها بمسح سابق.
const SCANNER_KEY_GAP_MS = 60
const MIN_SCANNER_BUFFER_LENGTH = 4

export function BarcodeScanPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [code, setCode] = useState('')
  const [product, setProduct] = useState<ScannedBarcodeProduct | null>(null)
  const [error, setError] = useState('')
  const [notFoundBarcode, setNotFoundBarcode] = useState('')
  const [restockQty, setRestockQty] = useState(1)
  const [adjustQty, setAdjustQty] = useState(0)
  const [actionMessage, setActionMessage] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  // بفر لوحة مفاتيح قارئ باركود فيزيائي شغّال حتى لو مفيش عنصر عنده focus فعلياً (راجع
  // handleGlobalKeyDown) — مختلف تماماً عن onKeyDown المحلي بتاع input الباركود العادي.
  const scannerBufferRef = useRef('')
  const scannerLastKeyAtRef = useRef(0)

  const scanner = useBarcodeScanner({ onDetected: value => { setCode(value); lookup(value) } })

  useEffect(() => {
    setHeader({ crumb: 'المخزون', title: 'مسح الباركود' })
  }, [setHeader])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function lookup(rawCode: string) {
    const value = rawCode.trim()
    if (!value) return
    setError('')
    setActionMessage('')
    setNotFoundBarcode('')
    try {
      const { product } = await api.findProductByBarcode(value)
      setProduct(product)
      setRestockQty(1)
      setAdjustQty(0)
    } catch (err) {
      setProduct(null)
      if (err instanceof ApiError && err.status === 404) {
        setNotFoundBarcode(value)
        setError('الباركود غير مسجل')
      } else {
        setError('تعذر البحث، حاول مرة أخرى')
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    lookup(code)
  }

  // قارئ الباركود الفيزيائي (USB/Bluetooth) بيتصرف كلوحة مفاتيح عادية بيكتب الرقم وبعدين
  // Enter — مفيش أي API خاص مطلوب، مجرد input عادي دايماً في التركيز.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      lookup(code)
    }
  }

  // دعم قارئ الباركود الفيزيائي حتى لو التركيز مش على input الباركود نفسه (مثلاً لو الأدمن
  // كان بص على نتيجة منتج سابق وبعدين مسح تاني من غير ما يضغط على الحقل تاني). بيتجاهل
  // تماماً أي وقت يكون فيه input/textarea/select تاني (غير input الباركود نفسه) هو الـ focus
  // الحالي — عشان ميقطعش كتابة عادية في حقول زيادة/تسوية المخزون.
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      const active = document.activeElement
      if (active === inputRef.current) return // input الباركود نفسه بيعالج ده لوحده فعلاً
      const tag = active?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active as HTMLElement | null)?.isContentEditable) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const now = Date.now()
      const gap = now - scannerLastKeyAtRef.current
      scannerLastKeyAtRef.current = now

      if (e.key === 'Enter') {
        const buffered = scannerBufferRef.current
        scannerBufferRef.current = ''
        if (buffered.length >= MIN_SCANNER_BUFFER_LENGTH && gap <= SCANNER_KEY_GAP_MS) {
          e.preventDefault()
          setCode(buffered)
          lookup(buffered)
        }
        return
      }
      if (e.key.length !== 1) return // مفاتيح تحكم (Shift, Tab, Arrow...) بتتجاهل
      scannerBufferRef.current = gap <= SCANNER_KEY_GAP_MS ? scannerBufferRef.current + e.key : e.key
    }
    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function scanAnotherProduct() {
    setProduct(null)
    setError('')
    setNotFoundBarcode('')
    setCode('')
    inputRef.current?.focus()
    scanner.startCameraScan()
  }

  function goToCreateProductWithBarcode() {
    navigate('/products/add', { state: { prefillBarcode: notFoundBarcode } })
  }

  // بيحدّث مخزون "الجزء" اللي فعلياً اتعدّل بس — المتغيّر لو كان هو المتغيّر الممسوح، وإلا
  // المنتج الأساسي. أبداً ما بيلمسش stock المنتج الأساسي لو كان المتغيّر هو المقصود، حتى لو
  // الرد رجع بنجاح — فصل واضح بين الاتنين يمنع تضارب أرصدة.
  function applyNewStock(current: ScannedBarcodeProduct, newStock: number): ScannedBarcodeProduct {
    return current.variant ? { ...current, variant: { ...current.variant, stock: newStock } } : { ...current, stock: newStock }
  }

  function stockActionErrorMessage(err: unknown): string {
    if (err instanceof ApiError && err.code === 'variant_not_found') {
      return 'هذا المتغير لم يعد موجودًا — امسح الباركود مرة أخرى'
    }
    return err instanceof ApiError && err.code === 'insufficient_stock' ? 'الكمية المطلوبة أكبر من المخزون المتاح' : 'تعذر تحديث المخزون'
  }

  async function doRestock() {
    if (!product || !Number.isFinite(restockQty) || restockQty <= 0) return
    try {
      const { newStock } = await api.createStockMovement({
        productId: product.id,
        variantId: product.variant?.id ?? undefined,
        type: 'restock',
        quantityChange: restockQty,
        note: 'إضافة سريعة عبر مسح الباركود'
      })
      setProduct(current => current && applyNewStock(current, newStock))
      setActionMessage('تم زيادة المخزون')
    } catch (err) {
      window.alert(stockActionErrorMessage(err))
    }
  }

  async function doAdjust() {
    if (!product || !Number.isFinite(adjustQty) || adjustQty === 0) return
    try {
      const { newStock } = await api.createStockMovement({
        productId: product.id,
        variantId: product.variant?.id ?? undefined,
        type: 'adjustment',
        quantityChange: adjustQty,
        note: 'تسوية سريعة عبر مسح الباركود'
      })
      setProduct(current => current && applyNewStock(current, newStock))
      setActionMessage('تم تسجيل التسوية')
    } catch (err) {
      window.alert(stockActionErrorMessage(err))
    }
  }

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">مسح الباركود</div>
          <div className="admin-form-card-sub">استخدم قارئ باركود فيزيائي (USB/Bluetooth)، أو اكتب الرقم يدوياً، أو صوّر بالكاميرا</div>
        </div>
        <form onSubmit={handleSubmit}>
          <label>رقم الباركود
            <input
              ref={inputRef}
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="امسح أو اكتب الباركود هنا..."
              autoFocus
            />
          </label>
          <button type="submit" className="admin-form-chip" style={{ marginTop: 6 }}>بحث</button>
        </form>

        {(scanner.cameraState === 'idle' || scanner.cameraState === 'starting') && (
          <button type="button" className="barcode-scan-camera-btn" disabled={scanner.cameraState === 'starting'} onClick={() => scanner.startCameraScan()}>
            {scanner.cameraState === 'starting' ? 'جارِ تشغيل الكاميرا...' : '📷 فتح الكاميرا ومسح الباركود'}
          </button>
        )}

        <BarcodeCameraView scanner={scanner} hint="ضع الباركود داخل الإطار" />

        {error && (
          <div className="admin-form-error">
            {error}
            {notFoundBarcode && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <button type="button" className="admin-form-chip" onClick={goToCreateProductWithBarcode}>إضافة منتج جديد بهذا الباركود</button>
                <button type="button" className="admin-form-chip" onClick={scanAnotherProduct}>مسح مرة أخرى</button>
              </div>
            )}
          </div>
        )}
      </div>

      {product && (
        <div className="admin-form-card">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 10, overflow: 'hidden', background: '#fff', border: '1px solid #dce4de', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 28 }}>
              <SafeImage sources={[product.primaryImage]} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} fallback={product.emoji} />
            </div>
            <div>
              <div className="admin-form-card-title">المنتج: {product.name}</div>
              {product.variant && <div className="admin-form-card-sub">المتغير: <strong>{product.variant.name}</strong></div>}
              <div className="admin-form-card-sub">
                الباركود: {product.variant ? product.variant.barcode : product.barcode}
                {(product.variant ? product.variant.sku : product.sku) ? ` — SKU: ${product.variant ? product.variant.sku : product.sku}` : ''}
              </div>
            </div>
          </div>

          <div className="admin-form-help">
            الوحدة: <strong>{product.unit}</strong> — الحالة: <strong>{(product.variant ? product.variant.available : product.available) ? 'معروض' : 'غير معروض'}</strong>
          </div>
          <div className="admin-form-help">
            {product.variant ? 'مخزون المتغير الحالي' : 'المخزون الحالي'}: <strong>{product.variant ? product.variant.stock : product.stock}</strong> — السعر: <strong>{formatMoney(product.variant ? product.variant.price : product.price)}</strong>
          </div>

          <span className="admin-form-chips">
            <button type="button" className="admin-form-chip" onClick={() => navigate(`/products/edit/${product.id}`)}>عرض المنتج</button>
            <button type="button" className="admin-form-chip" onClick={() => navigate(`/products/moves?productId=${product.id}`)}>عرض الحركات</button>
            <button type="button" className="admin-form-chip" onClick={() => navigate('/purchasing/receiving')}>استلام بضاعة</button>
          </span>

          <label>{product.variant ? `إضافة لمخزون ${product.variant.name}` : 'زيادة مخزون سريعة'}
            <span style={{ display: 'flex', gap: 8 }}>
              <input type="number" min={1} value={restockQty} onChange={e => setRestockQty(Number(e.target.value))} style={{ width: 100 }} />
              <button type="button" className="admin-form-chip" onClick={doRestock}>إضافة</button>
            </span>
          </label>

          <label>{product.variant ? `تسوية مخزون ${product.variant.name} (+/-)` : 'تسوية مخزون (+/-)'}
            <span style={{ display: 'flex', gap: 8 }}>
              <input type="number" value={adjustQty} onChange={e => setAdjustQty(Number(e.target.value))} style={{ width: 100 }} />
              <button type="button" className="admin-form-chip" onClick={doAdjust}>تسجيل</button>
            </span>
          </label>

          {actionMessage && <div className="admin-form-success">{actionMessage}</div>}

          <button type="button" className="admin-form-chip" onClick={scanAnotherProduct}>مسح منتج آخر</button>
        </div>
      )}
    </div>
  )
}
