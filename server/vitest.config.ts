import { defineConfig } from 'vitest/config'
import { BaseSequencer, type TestSpecification } from 'vitest/node'

// اختبارات التكامل بتتشارك في نفس قاعدة بيانات الاختبار الحقيقية، وبعض الملفات بتعمل DELETE
// شامل (بدون WHERE) على جداول زي products/categories/users في beforeEach/afterAll بتاعها —
// افتراض ضمني إن الملف ده هو الوحيد اللي بيلمس الجدول ده في نفس اللحظة. fileParallelism: false
// (تحت) بيمنع تشغيل ملفين فعلياً في نفس اللحظة، لكن ده لوحده مش كافي: الـ sequencer الافتراضي
// لـ Vitest (BaseSequencer.sort) بيرتّب ترتيب تشغيل الملفات بناءً على cache نتائج آخر تشغيلة
// (يشغّل الفاشل الأول، والأطول مدة الأول) — يعني ترتيب تشغيل الملفات بيتغيّر من تشغيلة
// للتانية حسب مين فشل قبل كده، فأي تصادم مفتاح خارجي بين ملفين بيتصادفوا يبقوا جنب بعض في
// الترتيب الجديد بيظهر عشوائياً حسب تاريخ التشغيلات السابقة، مش بسبب كود جديد اتغيّر. الحل:
// ثبّت ترتيب الملفات نفسه (أبجدي حسب المسار) بدل الاعتماد على heuristics الأداء/الفشل —
// كده الترتيب بيفضل ثابت 100% بين كل تشغيلة وتانية، ومفيش تصادم "عشوائي" يظهر ويختفي.
class StableSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId))
  }
}

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
    sequence: {
      sequencer: StableSequencer
    },
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/alaa_eldin_test'
    }
  }
})
