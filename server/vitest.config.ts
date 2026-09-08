import { defineConfig } from 'vitest/config'

// اختبارات التكامل بتتصل بقاعدة بيانات اختبار منفصلة (مش قاعدة التطوير المحلية ولا الإنتاج) —
// DATABASE_URL هنا بيتجاوز أي قيمة تانية وقت تشغيل الاختبارات فقط.
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    // ملفات الاختبار بتشترك في نفس قاعدة بيانات الاختبار الحقيقية، وبعض الملفات بتعمل
    // DELETE شامل (بدون WHERE) على جداول زي products/categories في beforeEach بتاعها —
    // تشغيل الملفات بالتوازي كان بيسبب تعارض/تضارب مفاتيح خارجية عشوائي بين ملفين بيشتغلوا
    // على نفس الجداول في نفس اللحظة. تشغيل الملفات بالتتابع (مش بالتوازي) بيحل المشكلة
    // نهائياً وبثبات، وأبطأ شوية بس مش تأخير مؤثر لحجم test suite الحالي.
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/alaa_eldin_test'
    }
  }
})
