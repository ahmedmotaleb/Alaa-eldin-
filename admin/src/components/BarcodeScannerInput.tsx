import type { BarcodeScannerState } from '../hooks/useBarcodeScanner'

const CAMERA_ERROR_MESSAGE: Record<string, string> = {
  'permission-denied': 'تم رفض إذن الكاميرا',
  'no-camera': 'لم يتم العثور على كاميرا',
  'camera-in-use': 'الكاميرا مستخدمة بواسطة تطبيق آخر',
  'insecure-context': 'الكاميرا تحتاج اتصال HTTPS آمن',
  error: 'تعذر تشغيل الكاميرا'
}

interface Props {
  scanner: BarcodeScannerState
  hint?: string
}

// الجزء البصري المشترك لمعاينة الكاميرا (الفيديو + الإطار + أزرار الإيقاف/تبديل الكاميرا/
// الفلاش + رسائل الخطأ) — مُستخدم من BarcodeScanPage وProductFormPage الاتنين، نفس الشكل
// بالظبط. زرار "فتح الكاميرا" نفسه (حالة idle/starting) مش هنا عمداً — كل صفحة نص الزرار
// مختلف فيها حسب السياق، فبيفضل عند الكولر.
export function BarcodeCameraView({ scanner, hint }: Props) {
  const { cameraState, videoRef, videoDevices, torchSupported, torchOn, stopCamera, switchCamera, toggleTorch, startCameraScan } = scanner

  if (cameraState === 'permission-denied' || cameraState === 'no-camera' || cameraState === 'camera-in-use' || cameraState === 'insecure-context' || cameraState === 'error') {
    return (
      <>
        <div className="admin-form-error">{CAMERA_ERROR_MESSAGE[cameraState]}</div>
        {cameraState !== 'insecure-context' && (
          <button type="button" className="admin-form-chip" onClick={() => startCameraScan()}>إعادة المحاولة</button>
        )}
      </>
    )
  }

  if (cameraState !== 'scanning') return null

  return (
    <div className="barcode-scan-camera-wrap">
      <video ref={videoRef} muted playsInline className="barcode-scan-video" />
      <div className="barcode-scan-overlay">
        <div className="barcode-scan-frame" />
        {hint && <div className="barcode-scan-hint">{hint}</div>}
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
  )
}
