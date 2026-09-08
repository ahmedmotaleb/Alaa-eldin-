import { defineConfig } from 'vitest/config'

// اختبارات التكامل بتتصل بقاعدة بيانات اختبار منفصلة (مش قاعدة التطوير المحلية ولا الإنتاج) —
// DATABASE_URL هنا بيتجاوز أي قيمة تانية وقت تشغيل الاختبارات فقط.
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/alaa_eldin_test'
    }
  }
})
