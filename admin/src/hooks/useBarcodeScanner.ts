import { useCallback, useEffect, useRef, useState } from 'react'
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

export type CameraScanState =
  | 'idle' | 'starting' | 'scanning'
  | 'permission-denied' | 'no-camera' | 'camera-in-use' | 'insecure-context' | 'error'

// كولداون قصير بعد كل مسح ناجح — يمنع نفس الباركود (أو أي باركود) من يتسجّل أكتر من مرة
// خلال نفس الثانية ونص (إطارات فيديو متتالية بترجع نفس القراءة قبل ما الكاميرا تتوقف فعلياً).
const SCAN_COOLDOWN_MS = 1500
const DEFAULT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128']

interface ZxingModule {
  BrowserMultiFormatReader: typeof import('@zxing/browser').BrowserMultiFormatReader
  BarcodeFormat: typeof import('@zxing/library').BarcodeFormat
  DecodeHintType: typeof import('@zxing/library').DecodeHintType
}

// تحميل lazy لمكتبة ZXing — ما بتتحمّلش إلا فعلياً وقت الحاجة ليها (أول ما نحتاج fallback عن
// BarcodeDetector الأصلي). موديول واحد مشترك بين كل استخدامات الهوك دي في التطبيق كله (مش
// بس صفحة واحدة) — أي صفحة هي أول من يحتاجها فعلياً هي اللي بتحمّلها.
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

export interface UseBarcodeScannerOptions {
  // بيتنادى مرة واحدة بس لكل مسح فعلي (الكولداون بيمنع التكرار) — الكاميرا بتتوقف تلقائياً
  // قبل النداء ده، فمش محتاج الكولر يستدعي stopCamera بنفسه جوه onDetected.
  onDetected: (value: string) => void
  formats?: string[]
}

export interface BarcodeScannerState {
  cameraState: CameraScanState
  videoRef: React.RefObject<HTMLVideoElement | null>
  videoDevices: MediaDeviceInfo[]
  torchSupported: boolean
  torchOn: boolean
  startCameraScan: (deviceId?: string) => Promise<void>
  stopCamera: () => void
  switchCamera: () => Promise<void>
  toggleTorch: () => Promise<void>
}

// منطق المسح بالكاميرا (BarcodeDetector/ZXing، تبديل كاميرا، فلاش، تبريد، صوت/اهتزاز تأكيد)
// مستخرج هنا كهوك واحد مشترك — صفحة مسح الباركود (BarcodeScanPage) ونموذج المنتج
// (ProductFormPage) الاتنين بيستخدموا نفس الهوك ده بالظبط، مفيش تنفيذ ZXing مكرر في مكانين.
// الهوك ده عمداً ملوش أي علاقة بمنطق البحث عن منتج أو أي business logic تانية — الكولر هو
// اللي يحدد يعمل إيه بالقيمة الممسوحة عبر onDetected.
export function useBarcodeScanner({ onDetected, formats = DEFAULT_FORMATS }: UseBarcodeScannerOptions): BarcodeScannerState {
  const [cameraState, setCameraState] = useState<CameraScanState>('idle')
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [currentDeviceIndex, setCurrentDeviceIndex] = useState(0)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const zxingControlsRef = useRef<IScannerControls | null>(null)
  const lastScanRef = useRef<{ value: string, at: number } | null>(null)
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected

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
  // أبداً مفيش لمبة كاميرا شغّالة بعد ما الأدمن يسيب الصفحة/يقفل النموذج.
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

  function onBarcodeDetected(value: string) {
    const now = Date.now()
    if (lastScanRef.current && lastScanRef.current.value === value && now - lastScanRef.current.at < SCAN_COOLDOWN_MS) return
    lastScanRef.current = { value, at: now }
    stopCamera()
    if (navigator.vibrate) navigator.vibrate(120)
    playBeep()
    onDetectedRef.current(value)
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

  // إذن الكاميرا بيتطلب بس لما المستخدم يضغط زرار الفتح صراحة — مش تلقائي عند تحميل
  // الصفحة/النموذج. BarcodeDetector الأصلي بيتستخدم لو موجود، وإلا ZXing (lazy-loaded).
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
        const detector = new window.BarcodeDetector({ formats })
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
        const formatMap: Record<string, number> = {
          ean_13: BarcodeFormat.EAN_13, ean_8: BarcodeFormat.EAN_8, upc_a: BarcodeFormat.UPC_A,
          upc_e: BarcodeFormat.UPC_E, code_128: BarcodeFormat.CODE_128
        }
        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, formats.map(f => formatMap[f]).filter(f => f !== undefined))
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

  return { cameraState, videoRef, videoDevices, torchSupported, torchOn, startCameraScan, stopCamera, switchCamera, toggleTorch }
}
