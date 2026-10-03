import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError, type ScannedBarcodeProduct } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import { SafeImage } from '../../components/SafeImage'
import type { LayoutContext } from '../../components/AdminLayout'
import type { IScannerControls } from '@zxing/browser'

// Chrome/Edge بيدعموا BarcodeDetector الأصلي؛ متصفحات تانية (Safari, Firefox) لأ. مفيش
// استثناء هنا — لو مش موجود، بنستخدم @zxing/browser كـ fallback كامل بنفس تجربة المستخدم
// بالظبط (راجع startCameraScan)، مش شاشة "غير مدعوم".
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>
    }
  }
}

type CameraState =
  | 'idle' | 'starting' | 'scanning'
  | 'permission-denied' | 'no-camera' | 'camera-in-use' | 'insecure-context' | 'error'

// كولداون قصير بعد كل مسح ناجح — يمنع نفس الباركود (أو أي باركود) من يتسجّل أكتر من مرة
// خلال نفس الثانية ونص (إطارات فيديو متتالية بترجع نفس القراءة قبل ما الكاميرا تتوقف فعلياً).
const SCAN_COOLDOWN_MS = 1500
// حد زمني بين أحرف قارئ باركود فيزيائي حقيقي (أسرع بكتير من كتابة إنسان عادي) — لو الفرق
// بين ضغطتين أكبر من ده، نعتبرها كتابة طبيعية جديدة ونصفّر البفر بدل ما نخلطها بمسح سابق.
const SCANNER_KEY_GAP_MS = 60
const MIN_SCANNER_BUFFER_LENGTH = 4

interface ZxingModule {
  BrowserMultiFormatReader: typeof import('@zxing/browser').BrowserMultiFormatReader
  BarcodeFormat: typeof import('@zxing/library').BarcodeFormat
  DecodeHintType: typeof import('@zxing/library').DecodeHintType
}

// تحميل lazy لمكتبة ZXing — ما بتتحمّلش إلا فعلياً وقت الحاجة ليها (أول ما نحتاج fallback عن
// BarcodeDetector الأصلي). بما إن الصفحة دي نفسها بالفعل route-level lazy في App.tsx، المكتبة
// هتدخل في نفس chunk الصفحة، مش في الحزمة الأساسية لأي حال.
let zxingModulePromise: Promise<ZxingModule> | null = null
function loadZxing(): Promise<ZxingModule> {
  if (!zxingModulePromise) {
    zxingModulePromise = Promise.all([import('@zxing/browser'), import('@zxing/library')]).then(([browser, library]) => ({
      BrowserMultiFormatReader: browser.BrowserMultiFormatReader,
      BarcodeFormat: library.BarcodeFormat,
      DecodeHintType: library.DecodeHintType
    }))
  }
  return zxingModulePromise
}

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
  const [cameraState, setCameraState] = useState<CameraState>('idle')
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [currentDeviceIndex, setCurrentDeviceIndex] = useState(0)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const zxingControlsRef = useRef<IScannerControls | null>(null)
  const lastScanRef = useRef<{ value: string, at: number } | null>(null)
  // بفر لوحة مفاتيح قارئ باركود فيزيائي شغّال حتى لو مفيش عنصر عنده focus فعلياً (راجع
  // handleGlobalKeyDown) — مختلف تماماً عن onKeyDown المحلي بتاع input الباركود العادي.
  const scannerBufferRef = useRef('')
  const scannerLastKeyAtRef = useRef(0)

  useEffect(() => {
    setHeader({ crumb: 'المخزون', title: 'مسح الباركود' })
  }, [setHeader])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const stopCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    zxingControlsRef.current?.stop()
    zxingControlsRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setTorchSupported(false)
    setTorchOn(false)
    setCameraState(current => (current === 'scanning' || current === 'starting' ? 'idle' : current))
  }, [])

  // تنضيف إجباري: إيقاف الكاميرا عند مغادرة الصفحة، إغلاق الكومبوننت، أو اختفاء التبويب —
  // أبداً مفيش لمبة كاميرا شغّالة بعد ما الأدمن يسيب الصفحة.
  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) stopCamera()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [stopCamera])

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

  function onBarcodeDetected(value: string) {
    const now = Date.now()
    if (lastScanRef.current && lastScanRef.current.value === value && now - lastScanRef.current.at < SCAN_COOLDOWN_MS) return
    lastScanRef.current = { value, at: now }
    stopCamera()
    if (navigator.vibrate) navigator.vibrate(120)
    playBeep()
    setCode(value)
    lookup(value)
  }

  // نغمة تأكيد قصيرة (Web Audio API، من غير ملف صوت) — اختيارية تماماً، أي فشل (مثلاً
  // AudioContext مش مدعوم أو تفاعل المستخدم غير كافٍ) بيتجاهل بهدوء من غير ما يأثّر على
  // باقي تدفّق المسح.
  function playBeep() {
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return
      const ctx = new AudioContextClass()
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = 1400
      gain.gain.value = 0.12
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start()
      oscillator.stop(ctx.currentTime + 0.12)
      oscillator.onended = () => ctx.close()
    } catch {
      // صوت اختياري بالكامل — أي فشل هنا ما ينفعش يوقف أو يأثّر على نتيجة المسح.
    }
  }

  function checkTorchSupport(stream: MediaStream) {
    const track = stream.getVideoTracks()[0]
    const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined
    setTorchSupported(!!capabilities?.torch)
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] })
      setTorchOn(current => !current)
    } catch {
      // بعض المتصفحات بترجع torch في الـ capabilities لكن فعلياً بترفض تطبيقها — أفضل-جهد.
    }
  }

  // إذن الكاميرا بيتطلب بس لما المستخدم يضغط "فتح الكاميرا ومسح الباركود" صراحة — مش تلقائي
  // عند فتح الصفحة. BarcodeDetector الأصلي بيتستخدم لو موجود، وإلا ZXing (lazy-loaded) —
  // تجربة المستخدم (الكاميرا، الإطار، الاهتزاز، التبريد) نفس واحدة في الحالتين.
  async function startCameraScan(deviceId?: string) {
    if (!window.isSecureContext) { setCameraState('insecure-context'); return }
    if (!navigator.mediaDevices?.getUserMedia) { setCameraState('error'); return }

    setCameraState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }
      })
      streamRef.current = stream
      checkTorchSupport(stream)
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraState('scanning')

      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setVideoDevices(devices.filter(d => d.kind === 'videoinput'))
      } catch {
        // تعداد الأجهزة فشل — مش حرج، زرار "تغيير الكاميرا" هيفضل مخفي بس (videoDevices.length <= 1)
      }

      if (window.BarcodeDetector) {
        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] })
        const tick = async () => {
          if (!videoRef.current || !streamRef.current) return
          try {
            const results = await detector.detect(videoRef.current)
            if (results[0]?.rawValue) { onBarcodeDetected(results[0].rawValue); return }
          } catch {
            // إطار مش قابل للتحليل — نجرب تاني الإطار الجاي، من غير ما نوقف المسح.
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      } else {
        const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = await loadZxing()
        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128
        ])
        const reader = new BrowserMultiFormatReader(hints)
        if (!videoRef.current || !streamRef.current) return
        const controls = await reader.decodeFromStream(stream, videoRef.current, (result) => {
          if (result) onBarcodeDetected(result.getText())
        })
        zxingControlsRef.current = controls
      }
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') setCameraState('permission-denied')
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setCameraState('no-camera')
      else if (name === 'NotReadableError' || name === 'TrackStartError') setCameraState('camera-in-use')
      else setCameraState('error')
      stopCamera()
    }
  }

  async function switchCamera() {
    if (videoDevices.length < 2) return
    const nextIndex = (currentDeviceIndex + 1) % videoDevices.length
    setCurrentDeviceIndex(nextIndex)
    stopCamera()
    await startCameraScan(videoDevices[nextIndex].deviceId)
  }

  function scanAnotherProduct() {
    setProduct(null)
    setError('')
    setNotFoundBarcode('')
    setCode('')
    inputRef.current?.focus()
    startCameraScan()
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

  const cameraErrorMessage: Record<string, string> = {
    'permission-denied': 'تم رفض إذن الكاميرا',
    'no-camera': 'لم يتم العثور على كاميرا',
    'camera-in-use': 'الكاميرا مستخدمة بواسطة تطبيق آخر',
    'insecure-context': 'الكاميرا تحتاج اتصال HTTPS آمن',
    error: 'تعذر تشغيل الكاميرا'
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

        {(cameraState === 'permission-denied' || cameraState === 'no-camera' || cameraState === 'camera-in-use' || cameraState === 'insecure-context' || cameraState === 'error') && (
          <>
            <div className="admin-form-error">{cameraErrorMessage[cameraState]}</div>
            {cameraState !== 'insecure-context' && (
              <button type="button" className="admin-form-chip" onClick={() => startCameraScan()}>إعادة المحاولة</button>
            )}
          </>
        )}

        {(cameraState === 'idle' || cameraState === 'starting') && (
          <button type="button" className="barcode-scan-camera-btn" disabled={cameraState === 'starting'} onClick={() => startCameraScan()}>
            {cameraState === 'starting' ? 'جارِ تشغيل الكاميرا...' : '📷 فتح الكاميرا ومسح الباركود'}
          </button>
        )}

        {cameraState === 'scanning' && (
          <div className="barcode-scan-camera-wrap">
            <video ref={videoRef} muted playsInline className="barcode-scan-video" />
            <div className="barcode-scan-overlay">
              <div className="barcode-scan-frame" />
              <div className="barcode-scan-hint">ضع الباركود داخل الإطار</div>
            </div>
            <div className="barcode-scan-controls">
              <button type="button" className="admin-form-chip" onClick={stopCamera}>إيقاف الكاميرا</button>
              {videoDevices.length > 1 && (
                <button type="button" className="admin-form-chip" onClick={switchCamera}>تغيير الكاميرا</button>
              )}
              {torchSupported && (
                <button type="button" className="admin-form-chip" onClick={toggleTorch}>{torchOn ? 'إيقاف الفلاش' : 'تشغيل الفلاش'}</button>
              )}
            </div>
          </div>
        )}

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
