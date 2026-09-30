import { useEffect } from 'react'
import { setPageMeta } from '../utils/pageMeta'

// رابط أحدث إصدار — بيتغيّر بس لما إصدار جديد يتنشر (راجع
// server/docs/ANDROID_DIRECT_APK_RELEASE.md لخطوات النشر الكاملة). التنزيل مباشر من
// GitHub Releases، مش من Google Play — التطبيق ده TWA (Trusted Web Activity) بيفتح نفس
// متجر علاء الدين الحقيقي بملء الشاشة، مش نسخة منفصلة أو مكررة من المتجر.
const CURRENT_VERSION = '1.0.0'
const APK_FILENAME = `alaa-eldin-v${CURRENT_VERSION}.apk`
const DOWNLOAD_URL = `https://github.com/ahmedmotaleb/Alaa-eldin-/releases/download/android-v${CURRENT_VERSION}/${APK_FILENAME}`

function trackApkDownload() {
  // حدث تتبّع بسيط جداً (بدون أي بيانات حساسة) بيستخدم نفس البنية التحتية للّوج
  // المُهيكل الموجودة بالفعل — مفيش مزوّد تحليلات جديد اتضاف لأجل ده.
  try {
    void fetch('/api/analytics/apk-download', { method: 'POST', credentials: 'include' })
  } catch {
    // تتبع اختياري بحت — فشله ما يمنعش التنزيل نفسه
  }
}

export function DownloadPage() {
  useEffect(() => {
    setPageMeta({
      title: 'تحميل تطبيق علاء الدين للأندرويد',
      description: 'حمّل تطبيق سوبر ماركت علاء الدين لأجهزة أندرويد مباشرة — بدون Google Play',
      path: '/download'
    })
  }, [])

  return (
    <div className="page-content download-page">
      <div className="download-hero">
        <img src="/images/icon-192.png" alt="علاء الدين" className="download-app-icon" />
        <h1>تطبيق علاء الدين للأندرويد</h1>
        <p className="download-subtitle">
          نفس متجر علاء الدين اللي بتستخدمه دلوقتي — بس كتطبيق مستقل على شاشتك الرئيسية،
          بيفتح بملء الشاشة من غير شريط المتصفح.
        </p>
      </div>

      <div className="download-card">
        <div className="download-version-row">
          <span>الإصدار الحالي</span>
          <strong>{CURRENT_VERSION}</strong>
        </div>
        <a
          href={DOWNLOAD_URL}
          onClick={trackApkDownload}
          className="primary-button download-button"
          download
        >
          تحميل تطبيق علاء الدين للأندرويد
        </a>
        <p className="download-hint">ملف APK — للتثبيت المباشر على أجهزة أندرويد</p>
      </div>

      <div className="download-steps">
        <h2>خطوات التثبيت</h2>
        <ol>
          <li>اضغط تحميل التطبيق</li>
          <li>افتح ملف APK بعد التحميل</li>
          <li>لو أندرويد طلب السماح بالتثبيت من Chrome، فعّل السماح</li>
          <li>اضغط تثبيت</li>
          <li>افتح تطبيق علاء الدين</li>
        </ol>
      </div>

      <div className="download-warning">
        <strong>⚠️ تنبيه أمني</strong>
        <p>
          حمّل التطبيق فقط من هذه الصفحة الرسمية على موقع علاء الدين. لا تقم بتحميل أو مشاركة
          ملف APK من أي موقع آخر غير معروف.
        </p>
      </div>

      <div className="download-alt">
        <h2>أو ثبّت التطبيق من المتصفح مباشرة</h2>
        <p>
          يمكنك أيضاً تثبيت علاء الدين كتطبيق ويب مباشرة من Chrome بدون تحميل أي ملف —
          افتح قائمة المتصفح واختر "إضافة إلى الشاشة الرئيسية" أو "تثبيت التطبيق".
        </p>
      </div>
    </div>
  )
}
