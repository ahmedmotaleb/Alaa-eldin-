# syntax=docker/dockerfile:1

# نفس نسخة Node اللي بيستخدمها Railway فعلاً حالياً (Nixpacks/Railpack بيحلّوا ">=22.12.0"
# في package.json لـ Node 24 — راجع لوج البناء الأخير: "setup │ nodejs_24, npm-9_x").
ARG NODE_VERSION=24

# مهم: لازم يتطابق مع إصدار Postgres الفعلي في Railway (Postgres service → image tag، أو
# سطر بداية التشغيل "PostgreSQL X.Y..."). القيمة هنا افتراض مبدئي بس (مطابق للإصدار
# المحلي المتاح وقت كتابة الملف ده) — عدّلها قبل أي بناء حقيقي لو مختلفة.
ARG PG_MAJOR=16

FROM node:${NODE_VERSION}-slim AS base
ARG PG_MAJOR
ENV DEBIAN_FRONTEND=noninteractive

# عميل postgresql من مستودع PGDG الرسمي (مش عميل Debian المدمج) — عميل Debian غالباً أقدم من
# إصدار السيرفر الفعلي، وده بالظبط سبب فشل pg_dump لو استُخدم بدل ده.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg lsb-release \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends "postgresql-client-${PG_MAJOR}" \
    && rm -rf /var/lib/apt/lists/*

# فشل البناء بوضوح لو إصدار pg_dump المُثبّت مش نفس PG_MAJOR المطلوب — بدل ما نكتشف
# اختلاف الإصدار بعد النشر بساعات.
RUN set -e; \
    installed_major=$(pg_dump --version | grep -oE '[0-9]+' | head -n1); \
    if [ "$installed_major" != "${PG_MAJOR}" ]; then \
      echo "ERROR: installed pg_dump major version ($installed_major) does not match PG_MAJOR (${PG_MAJOR})"; \
      exit 1; \
    fi; \
    echo "pg_dump major version confirmed: $installed_major"

WORKDIR /app

# نفس تسلسل البناء الحالي بالظبط على Railway (railway.json buildCommand): جذر المتجر، بعدين
# server، بعدين admin — التلات dist/ لازم يكونوا موجودين لأن Express السيرفر نفسه بيقدّم
# الاتنين التانيين كملفات static وقت التشغيل (راجع app.ts).
COPY package.json package-lock.json ./
RUN npm install
COPY server/package.json server/package-lock.json server/
RUN npm install --prefix server
COPY admin/package.json admin/package-lock.json admin/
RUN npm install --prefix admin

COPY . .
RUN npm run build
RUN npm run build --prefix server
RUN npm run build --prefix admin

# مستخدم عادي (مش root) لتشغيل السيرفر وpg_dump — لو حُطّ Railway Volume على الخدمة دي يوماً،
# لازم تتضاف RAILWAY_RUN_UID=0 كمتغير بيئة عشان الـ volume يتقرأ/يتكتب صح (توثيق Railway
# الرسمي لهذه الحالة)، وده مش مطلوب حالياً لأن الخدمة دي من غير Volume.
RUN useradd --create-home --shell /bin/false appuser && chown -R appuser:appuser /app
USER appuser

ENV NODE_ENV=production

# صيغة shell (مش صيغة exec كـ ["..."])  عمداً — لو أي أمر بدء مستقبلي احتاج يستخدم $PORT أو
# أي متغير بيئة تاني داخل النص نفسه، الـ shell هو اللي بيوسّعه؛ صيغة exec (JSON array) ما
# بتمرّش على shell خالص فمتغيرات زي كده تفضل نص حرفي من غير توسيع. التطبيق الحالي أصلاً
# بيقرأ process.env.PORT مباشرة في كود Node (server/src/index.ts)، مش عن طريق $PORT في نص
# الأمر، فالمصيدة دي مش مؤثرة فعلياً هنا — لكن صيغة shell سيبناها زي ما هي كضمان إضافي لو
# أمر البدء اتغيّر مستقبلاً ليحتوي على متغير فعلي.
CMD npm run start
