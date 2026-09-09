#!/usr/bin/env node
// بوابة وقت البناء لنسخة الأندرويد: بتتأكد إن VITE_API_BASE_URL موجود وصالح **قبل** ما
// Vite يبني أي حاجة. من غيرها كان ممكن يطلع APK كامل ومتوقّع، بس مكسور بالكامل: الواجهة
// جوه الـ APK محمّلة من ملفات محلية، فأي مسار نسبي زي "/api" بيروح على أصل الـ WebView
// (https://localhost) اللي مفيهوش سيرفر — يعني تطبيق بيفتح ومفيش أي حاجة بتشتغل فيه.
//
// نفس الفحص موجود كمان وقت التشغيل في src/utils/api.ts، بس ده الوحيد اللي بيمنع إنتاج
// نسخة للتوزيع أصلاً.
import { readFileSync, existsSync } from 'node:fs'

// Vite بيقرأ .env لوحده وقت البناء، فبنقرأه هنا بنفس المنطق عشان الفحص يشوف نفس القيمة
// اللي هتتحقن فعلاً (متغيّر البيئة له الأولوية زي Vite بالظبط).
function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const fromFile = { ...readEnvFile('.env.production'), ...readEnvFile('.env') }
const raw = (process.env.VITE_API_BASE_URL ?? fromFile.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')

function fail(message) {
  // في GitHub Actions بنطلع annotation رسمية كمان — النص العربي لوحده بيتعرض بشكل مبعثر
  // في لوج الـ Actions (اتجاه RTL)، والـ annotation بتظهر واضحة فوق في ملخّص الـ run.
  if (process.env.GITHUB_ACTIONS) {
    console.log(
      '::error title=Invalid native API origin::' +
      'VITE_API_BASE_URL is missing or invalid. ' +
      'Set it as a repository variable (Settings > Secrets and variables > Actions > Variables) ' +
      'to a full HTTPS origin with no trailing /api, e.g. https://alaa-eldin-production.up.railway.app'
    )
  }
  console.error('\n❌ بناء الأندرويد متوقف: رابط الـ API غير صالح.')
  console.error(`   ${message}`)
  console.error('\n   المطلوب: VITE_API_BASE_URL برابط HTTPS كامل بدون /api في آخره، مثال:')
  console.error('   VITE_API_BASE_URL=https://alaa-eldin-production.up.railway.app')
  console.error('   (حطه في .env أو كمتغيّر بيئة). راجع ANDROID_BUILD.md.\n')
  process.exit(1)
}

if (!raw) fail('VITE_API_BASE_URL مش متعرّف أصلاً.')

let parsed
try {
  parsed = new URL(raw)
} catch {
  fail(`القيمة مش رابط صالح: ${raw}`)
}

if (parsed.protocol !== 'https:') fail(`الرابط لازم يكون HTTPS، القيمة الحالية: ${raw}`)
if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
  fail(`الرابط مينفعش يكون localhost في نسخة للتوزيع: ${raw}`)
}
if (raw.endsWith('/api')) {
  fail(`شيل /api من آخر الرابط — الكود بيضيفها لوحده. القيمة الحالية: ${raw}`)
}

console.log(`✅ رابط API لنسخة الأندرويد: ${raw}`)
