/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  // رابط الباك إند المطلق (HTTPS) — لازم فقط لبناء تطبيق الأندرويد (Capacitor)، راجع
  // src/utils/api.ts. الويب دايماً بيستخدم مسار نسبي (/api) على نفس الأصل ومحتاجش القيمة دي.
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
