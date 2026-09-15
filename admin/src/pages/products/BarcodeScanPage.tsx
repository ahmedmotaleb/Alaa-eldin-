import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError } from '../../utils/api'
import { formatMoney } from '../../utils/money'
import type { LayoutContext } from '../../components/AdminLayout'

interface ScannedProduct {
  id: string
  name: string
  barcode: string
  sku: string | null
  stock: number
  price: number
  emoji: string
}

// Chrome/Edge على الموبايل والديسكتوب بيدعموا BarcodeDetector أصلاً — متصفحات تانية (Safari,
// Firefox) لأ. الميزة اختيارية بالكامل: أي متصفح مش بيدعمها يفضل شغال عادي بالإدخال اليدوي/قارئ الباركود.
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>
    }
  }
}

export function BarcodeScanPage() {
  const navigate = useNavigate()
  const { setHeader } = useOutletContext<LayoutContext>()
  const [code, setCode] = useState('')
  const [product, setProduct] = useState<ScannedProduct | null>(null)
  const [error, setError] = useState('')
  const [restockQty, setRestockQty] = useState(1)
  const [adjustQty, setAdjustQty] = useState(0)
  const [actionMessage, setActionMessage] = useState('')
  // حالات صريحة لقدرة الكاميرا بدل ما نكتفي بـ true/false عام: 'checking' لحد ما نتأكد من
  // دعم المتصفح، 'unsupported' (المتصفح مالوش BarcodeDetector خالص)، 'ready' (مدعوم، لسه
  // ما اتطلبش إذن)، 'permission-denied' (المستخدم رفض إذن الكاميرا صراحة)، 'unavailable'
  // (مفيش كاميرا فعلياً على الجهاز أو تعذّر الوصول لسبب تاني)، 'scanning' (شغالة دلوقتي).
  // الإدخال اليدوي متاح دايماً بغض النظر عن الحالة دي.
  const [cameraCapability, setCameraCapability] = useState<'checking' | 'unsupported' | 'ready' | 'permission-denied' | 'unavailable' | 'scanning'>('checking')
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    setHeader({ crumb: 'المخزون', title: 'مسح الباركود' })
  }, [setHeader])

  useEffect(() => {
    setCameraCapability(typeof window !== 'undefined' && 'BarcodeDetector' in window ? 'ready' : 'unsupported')
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    return () => stopCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function lookup(rawCode: string) {
    const value = rawCode.trim()
    if (!value) return
    setError('')
    setActionMessage('')
    try {
      const { product } = await api.findProductByBarcode(value)
      setProduct(product)
      setRestockQty(1)
      setAdjustQty(0)
    } catch (err) {
      setProduct(null)
      setError(err instanceof ApiError && err.status === 404 ? 'مفيش منتج بهذا الباركود' : 'تعذر البحث، حاول مرة أخرى')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    lookup(code)
  }

  // قارئ الباركود الفيزيائي (hardware scanner) بيتصرف كلوحة مفاتيح عادية بيكتب الرقم
  // وبعدين Enter — مفيش أي API خاص مطلوب، مجرد input عادي دايماً في التركيز.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      lookup(code)
    }
  }

  function stopCamera() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCameraCapability(current => (current === 'scanning' ? 'ready' : current))
  }

  // إذن الكاميرا بيتطلب بس لما المستخدم يضغط "ابدأ المسح بالكاميرا" صراحة — مش تلقائي عند فتح
  // الصفحة. لو رفض قبل كده (NotAllowedError)، بنعرض حالة "رفض الإذن" واضحة وما بنطلبش تاني
  // تلقائي — طلب إذن جديد لازم يكون بإجراء صريح تاني من المستخدم نفسه (زي إعادة الضغط على
  // الزرار)، مش تلقائي بمجرد إعادة تحميل الصفحة.
  async function startCameraScan() {
    if (!window.BarcodeDetector) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraCapability('scanning')
      const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] })
      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return
        try {
          const results = await detector.detect(videoRef.current)
          if (results[0]?.rawValue) {
            const value = results[0].rawValue
            stopCamera()
            setCode(value)
            lookup(value)
            return
          }
        } catch {
          // إطار مش قابل للتحليل — نجرب تاني الإطار الجاي، من غير ما نوقف المسح.
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      setCameraCapability(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? 'permission-denied' : 'unavailable')
      stopCamera()
    }
  }

  async function doRestock() {
    if (!product || restockQty <= 0) return
    try {
      const { newStock } = await api.createStockMovement({ productId: product.id, type: 'restock', quantityChange: restockQty, note: 'إضافة سريعة عبر مسح الباركود' })
      setProduct({ ...product, stock: newStock })
      setActionMessage('تم زيادة المخزون')
    } catch {
      window.alert('تعذر تحديث المخزون')
    }
  }

  async function doAdjust() {
    if (!product || adjustQty === 0) return
    try {
      const { newStock } = await api.createStockMovement({ productId: product.id, type: 'adjustment', quantityChange: adjustQty, note: 'تسوية سريعة عبر مسح الباركود' })
      setProduct({ ...product, stock: newStock })
      setActionMessage('تم تسجيل التسوية')
    } catch {
      window.alert('تعذر تسجيل التسوية')
    }
  }

  return (
    <div className="admin-form-grid">
      <div className="admin-form-card">
        <div>
          <div className="admin-form-card-title">مسح الباركود</div>
          <div className="admin-form-card-sub">استخدم قارئ باركود فيزيائي، أو اكتب الرقم يدوياً، أو صوّر بالكاميرا</div>
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
        </form>

        {cameraCapability === 'unsupported' && (
          <div className="admin-form-help">المسح بالكاميرا غير مدعوم في هذا المتصفح — استخدم الإدخال اليدوي أو قارئ باركود فيزيائي.</div>
        )}
        {cameraCapability === 'permission-denied' && (
          <>
            <div className="admin-form-error">تم رفض إذن الكاميرا — فعّله يدوياً من إعدادات الموقع في المتصفح لو حبيت تستخدم المسح بالكاميرا، أو استمر بالإدخال اليدوي.</div>
            <button type="button" className="admin-form-chip" onClick={startCameraScan}>إعادة المحاولة</button>
          </>
        )}
        {cameraCapability === 'unavailable' && (
          <>
            <div className="admin-form-error">تعذر الوصول للكاميرا — تأكد إن الجهاز فيه كاميرا شغالة، أو استخدم الإدخال اليدوي.</div>
            <button type="button" className="admin-form-chip" onClick={startCameraScan}>إعادة المحاولة</button>
          </>
        )}
        {(cameraCapability === 'ready' || cameraCapability === 'scanning') && (
          <>
            {cameraCapability === 'ready'
              ? <button type="button" className="admin-form-chip" onClick={startCameraScan}>ابدأ المسح بالكاميرا</button>
              : <button type="button" className="admin-form-chip" onClick={stopCamera}>إيقاف الكاميرا</button>}
            {cameraCapability === 'scanning' && <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 8, marginTop: 8 }} />}
          </>
        )}

        {error && <div className="admin-form-error">{error}</div>}
      </div>

      {product && (
        <div className="admin-form-card">
          <div>
            <div className="admin-form-card-title">{product.emoji} {product.name}</div>
            <div className="admin-form-card-sub">الباركود: {product.barcode}{product.sku ? ` — SKU: ${product.sku}` : ''}</div>
          </div>
          <div className="admin-form-help">المخزون الحالي: <strong>{product.stock}</strong> — السعر: <strong>{formatMoney(product.price)}</strong></div>

          <span className="admin-form-chips">
            <button type="button" className="admin-form-chip" onClick={() => navigate(`/products/edit/${product.id}`)}>عرض المنتج</button>
            <button type="button" className="admin-form-chip" onClick={() => navigate(`/products/moves?productId=${product.id}`)}>عرض الحركات</button>
            <button type="button" className="admin-form-chip" onClick={() => navigate('/purchasing/receiving')}>استلام بضاعة</button>
          </span>

          <label>زيادة مخزون سريعة
            <span style={{ display: 'flex', gap: 8 }}>
              <input type="number" min={1} value={restockQty} onChange={e => setRestockQty(Number(e.target.value))} style={{ width: 100 }} />
              <button type="button" className="admin-form-chip" onClick={doRestock}>إضافة</button>
            </span>
          </label>

          <label>تسوية مخزون (+/-)
            <span style={{ display: 'flex', gap: 8 }}>
              <input type="number" value={adjustQty} onChange={e => setAdjustQty(Number(e.target.value))} style={{ width: 100 }} />
              <button type="button" className="admin-form-chip" onClick={doAdjust}>تسجيل</button>
            </span>
          </label>

          {actionMessage && <div className="admin-form-success">{actionMessage}</div>}
        </div>
      )}
    </div>
  )
}
