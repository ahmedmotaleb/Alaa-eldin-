import type { CapacitorConfig } from '@capacitor/cli'

// الأندرويد بيحمّل نسخة Vite المبنية محلياً (dist) جوه التطبيق نفسه — مفيش أي server.url
// بيوجّه لموقع Railway هنا؛ كل نداءات API/الصور بتفضل تتصل بالباك إند الحقيقي أونلاين عن
// طريق src/utils/apiBase.ts. ده بالظبط عكس "تطبيق بيغلف موقع" — الواجهة نفسها متضمّنة
// في الـ APK، والبيانات بس اللي بتيجي أونلاين.
const config: CapacitorConfig = {
  appId: 'com.alaaeldin.supermarket',
  appName: 'علاء الدين',
  webDir: 'dist',
  android: {
    // لا نسمح بحركة HTTP غير مشفّرة في بناء الإنتاج — الباك إند دايماً HTTPS.
    allowMixedContent: false
  }
}

export default config
