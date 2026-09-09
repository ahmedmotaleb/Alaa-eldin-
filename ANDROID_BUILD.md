# بناء تطبيق أندرويد (Capacitor) — علاء الدين

هذا المستند يشرح إزاي تبني وتشغّل نسخة الأندرويد من نفس تطبيق الويب (PWA) الموجود في
هذا الريبو، من غير ما يتغيّر أي حاجة في الباك إند أو قاعدة البيانات أو لوحة التحكم.

المعمارية باختصار:

```
Android APK  ─┐
               ├─→ نفس Express API (Railway) ─→ نفس PostgreSQL ─→ نفس لوحة التحكم
Web PWA      ─┘
```

الأصول (React/Vite المبنية) بتتحزم محلياً جوه الـ APK نفسه (`webDir: dist`) — الشبكة
مستخدمة بس للـ API والصور، مش لتحميل الواجهة نفسها من موقع Railway (يعني مش مجرد
"غلاف WebView لموقع").

## المتطلبات

- **Node.js 22.12+** — مش 20. Capacitor CLI 8 محتاج Node ‏22+، وVite 7 محتاج 22.12+ تحديداً
  على خط Node 22 (نسخة Node 24 مثبّتة كمان مناسبة). حقل `engines.node` في الثلاث
  `package.json` مضبوط على `>=22.12.0` عشان يطابق ده فعلياً
- **Android Studio** (أحدث إصدار مستقر) — بيجيب معاه Android SDK و command-line tools تلقائياً
- **JDK 21** — نفس إصدار Java المُستخدم في بناء هذا المشروع (`java -version` لازم يورّي 21)
- Android SDK platform يغطي `compileSdk`/`targetSdk` الحاليين (راجع `android/variables.gradle`
  — القيمة الفعلية وقت كتابة هذا الملف: 36) — Android Studio بيحمّلها تلقائياً أول مرة
  تفتح فيها مشروع `android/`

## الإعداد الأول

```bash
npm install
npm run build          # يبني dist/ من التطبيق الأساسي (Vite)
npx cap sync android   # ينسخ dist/ + الإضافات (plugins) لمشروع android/
```

مشروع `android/` نفسه متتبَّع في Git بالفعل (مش محتاج `cap add android` تاني) — الأمر
`npx cap sync android` بيحدّثه بس بأحدث نسخة من الواجهة، ومفيش داعي لأي نسخ يدوي لملفات
`dist/`.

## متغيرات البيئة

القيمة الوحيدة المطلوبة لبناء الأندرويد هي رابط الباك إند المطلق (راجع `.env.example`):

```
VITE_API_BASE_URL=https://alaa-eldin-production.up.railway.app
```

لازم تتحط في ملف `.env` (مش مرفوع لـ Git) قبل `npm run build` — نسخة الويب نفسها
محتاجاش القيمة دي خالص (بتستخدم مسار نسبي `/api` دايماً).

القيمة دي بتتفحص فعلياً وقت البناء (`src/utils/api.ts`): لو ناقصة، أو مش رابط صالح، أو مش
HTTPS، أو بتشاور على `localhost`، البناء بيفشل برسالة واضحة. قبل الفحص ده كان الـ APK
بيتبني عادي وينزّل وهو مكسور بالكامل (كان بيروح على `https://localhost/api` اللي مش موجود)
من غير أي إشارة إن فيه مشكلة.

## أوامر npm الجاهزة

| الأمر | الوظيفة |
|---|---|
| `npm run android:add` | يعمل `cap add android` (مطلوب مرة واحدة بس — المشروع مُنشأ بالفعل) |
| `npm run android:sync` | يبني الويب (`npm run build`) وبعدين `cap sync android` |
| `npm run android:open` | يفتح مشروع `android/` في Android Studio |
| `npm run android:build:debug` | sync كامل + `./gradlew assembleDebug` |
| `npm run android:build:release` | sync كامل + `./gradlew assembleRelease` |

## بناء APK للتجربة (debug)

```bash
npm run android:build:debug
```

المخرج المتوقع (لو نجح البناء):

```
android/app/build/outputs/apk/debug/app-debug.apk
```

## بناء إصدار (release) وتوقيعه

توقيع الإصدار مُجهّز بالفعل في `android/app/build.gradle` ليقرأ القيم من:

1. ملف `android/keystore.properties` (انسخه من `android/keystore.properties.example`
   واملأ القيم — الملف ده متجاهل من Git تلقائياً ولازم يفضل كده)، **أو**
2. متغيرات بيئة: `ANDROID_KEYSTORE_PATH`، `ANDROID_KEYSTORE_PASSWORD`، `ANDROID_KEY_ALIAS`،
   `ANDROID_KEY_PASSWORD`

**المدخلات الأربعة كلها إلزامية** (المسار + كلمة سر الـ keystore + الـ alias + كلمة سر
المفتاح). لو أي واحدة فيهم ناقصة، أو ملف الـ keystore نفسه مش موجود على المسار، أي مهمة
`assembleRelease`/`bundleRelease` بتفشل فوراً برسالة بتقول الناقص بالظبط.

> ده كان عيب حقيقي اتصلّح: الفحص القديم كان بيتأكد من وجود ملف الـ keystore بس، ولو مش
> موجود كان البناء بيكمل **من غير `signingConfig` خالص** وينتج APK غير موقّع بصمت — رغم إن
> التعليق في الكود كان بيدّعي إنه بيفشل بوضوح.

بناء `assembleDebug` **مش متأثر** بالحارس ده إطلاقاً — بيستخدم مفتاح debug الافتراضي، عشان
CI والمطوّرين يقدروا يبنوا نسخة تجربة من غير أي أسرار.

**لا تحفظ ملف الـ keystore ولا كلمة السر في Git أبداً.**

```bash
npm run android:build:release
```

المخرج المتوقع:

```
android/app/build/outputs/apk/release/app-release.apk
```

## رفع رقم الإصدار

قبل أي إصدار جديد، حدّث في `android/app/build.gradle`:

```gradle
versionCode 2          // رقم صحيح متزايد دايماً — Google Play/التوزيع المباشر بيستخدمه للمقارنة
versionName "1.0.1"    // نص حر، semantic versioning (major.minor.patch)
```

## التطوير مع Live Reload (اختياري، للتطوير فقط)

Capacitor بيدعم توجيه الـ WebView لجهاز تطوير محلي بدل الأصول المبنية محلياً — مفيد
للتطوير السريع بس، **ممنوع تسيبه شغال في أي بناء إنتاج** (ده كان بالظبط اللي التعليمات
بتحذّر منه: تحويل الـ APK لمجرد "غلاف موقع"). لو حبيت تستخدمه، ضيف مؤقتاً في
`capacitor.config.ts`:

```ts
server: { url: 'http://<جهاز-التطوير>:5173', cleartext: true }
```

واشيله قبل أي بناء إنتاج فعلي.

## حالة التحقق الفعلية في هذه الجلسة (مهم — اقرأ قبل ما تفترض حاجة اتبنت)

تم فعلياً في هذه الجلسة:
- تثبيت `@capacitor/core` و`@capacitor/android` و`@capacitor/app` و`@capacitor/cli`
- إنشاء `capacitor.config.ts` (appId: `com.alaaeldin.supermarket`, webDir: `dist`)
- توليد مشروع `android/` حقيقي عبر `npx cap add android` (مش ملفات وهمية)
- توليد أيقونة التطبيق الحقيقية (adaptive icon، كل الكثافات) وشاشة splash حقيقية بشعار
  المتجر من الأصول الموجودة بالفعل في `public/images/`
- إزالة تبعية `google-services` غير المستخدمة من `android/build.gradle`
- إعداد توقيع الإصدار (signing) ليقرأ من ملف/متغيرات بيئة، من غير أي كلمة سر مكتوبة بالكود
- `npm run build` + `npx cap sync android` نجحوا فعلياً ونسخوا أصول الويب الحقيقية لمشروع الأندرويد

**ما تم التحقق منه فعلياً في بيئة التنفيذ (تحديث):**
- `./gradlew --version` **نجح**: Gradle 8.14.3 شغّال، وJDK 21 موجود بالكامل مع `javac`
  (‏21.0.10). يعني الـ wrapper نفسه وتوزيعة Gradle بيتحمّلوا عادي.
- `npx cap sync android` نجح وسجّل الإضافات الأصلية فعلياً
  (`@capacitor/app`، `@capacitor/preferences`) في `capacitor.plugins.json`
  و`capacitor.settings.gradle` و`capacitor.build.gradle`.

**اللي لسه متعذّر في هذه البيئة تحديداً (وتم إثباته بالتشغيل الفعلي، مش بالافتراض):**
- `./gradlew assembleDebug` بيفشل عند نقطة واحدة محددة: تحميل Android Gradle Plugin
  (`com.android.tools.build:gradle:8.13.0`) من Google Maven. اتجرّب بالاتصال وبـ `--offline`،
  ونفس النتيجة. السبب إن الـ proxy بتاع البيئة دي بيرفض `dl.google.com` بـ
  `403 CONNECT tunnel failed` (اتأكدنا بـ curl على 3 روابط مختلفة منه: ملفات الـ SDK
  ومستودع Maven). التوزيعة بتاعة Gradle نفسها (`services.gradle.org`) مسموحة، عشان كده
  الـ wrapper اشتغل والـ AGP لأ.
- مفيش Android SDK مثبّت (`ANDROID_HOME` مش متعرّف، و`sdkmanager`/`adb`/`apksigner` مش
  موجودين)، وتثبيته نفسه محتاج نفس الدومين المحجوب.

الخلاصة: **إعداد المشروع نفسه مفيهوش مشكلة معروفة تمنع البناء** — الحاجز الوحيد المتبقي هنا
هو سياسة شبكة البيئة دي. أي جهاز أو CI عادي (زي workflow ‏`.github/workflows/android-build.yml`
المضاف في الريبو) فيه وصول لـ `dl.google.com` المفروض يبني عادي.
- لا يوجد جهاز/محاكي أندرويد حقيقي للاختبار اليدوي (تسجيل دخول، سلة، دفع، زر رجوع، واتساب،
  إلخ) — كل هذه الخطوات محتاجة تتنفّذ يدوياً على جهاز حقيقي أو محاكي بعد أول بناء ناجح.
- لا يوجد ملف keystore حقيقي — بناء release هيفشل برسالة واضحة لحد ما تجهّز واحد
  (راجع قسم "بناء إصدار وتوقيعه" أعلاه؛ بقى بيفشل فعلاً، مش بيطلع unsigned زي الأول).

**لا يوجد أي APK فعلي في هذا الريبو أو تم إنتاجه في هذه الجلسة.** أي بناء لازم يتنفّذ على
جهاز/بيئة فيها اتصال إنترنت كامل وAndroid SDK.
