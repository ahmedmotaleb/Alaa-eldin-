import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { detectBarcodeFormat, JSBARCODE_FORMAT } from '../utils/barcodeFormat'

interface BarcodeGraphicProps {
  value: string
  showHumanReadableCode: boolean
}

// مسؤولة عن رسم الباركود بس — بتكتشف الصيغة (EAN-13/EAN-8/Code128) وترسمها بالمكتبة الجاهزة
// (jsbarcode)، وأبداً ما بتغيّرش قيمة الباركود نفسها ولا تحاول "تصلّحها". لو الباركود شكله
// EAN بس الـ checksum غلط، بيترسم كـ Code128 (بيقبل أي نص) مع تحذير مرئي واضح — أفضل بكتير
// من رمي استثناء جوه مكتبة الرسم أو التظاهر بإنه EAN صحيح وهو مش كده.
export function BarcodeGraphic({ value, showHumanReadableCode }: BarcodeGraphicProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const detection = detectBarcodeFormat(value)
  const isSuspiciousEan = detection.format !== 'code128' && !detection.checksumValid
  const renderFormat = isSuspiciousEan ? 'code128' : detection.format

  useEffect(() => {
    if (!svgRef.current || !value) return
    try {
      JsBarcode(svgRef.current, value, {
        format: JSBARCODE_FORMAT[renderFormat],
        displayValue: showHumanReadableCode,
        margin: 4,
        height: 50,
        fontSize: 13,
        font: 'system-ui'
      })
    } catch {
      // قيمة مش قابلة للترميز بالصيغة دي (نادر جداً) — نسيب الـ svg فاضي بدل ما نكسر الصفحة كلها.
    }
  }, [value, renderFormat, showHumanReadableCode])

  return (
    <div className="barcode-graphic">
      <svg ref={svgRef} />
      {isSuspiciousEan && (
        <div className="barcode-graphic-warning">⚠️ باركود EAN غير صالح (checksum خطأ) — يُعرض كـ Code128</div>
      )}
    </div>
  )
}
