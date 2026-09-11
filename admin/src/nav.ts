export interface NavChild {
  id: string
  label: string
  // مقصور على دور 'admin' الكامل بس (راجع server/src/auth.ts) — مخفي عن 'staff' التشغيلي.
  adminOnly?: boolean
}

export interface NavGroup {
  id: string
  label: string
  icon: string
  children: NavChild[]
}

export const NAV: NavGroup[] = [
  { id: 'home', label: 'الرئيسية', icon: '🏠', children: [] },
  {
    id: 'orders', label: 'الطلبات', icon: '🧾', children: [
      { id: 'all', label: 'جميع الطلبات' },
      { id: 'new', label: 'الجديدة' },
      { id: 'prep', label: 'جاري التجهيز' },
      { id: 'ready', label: 'جاهزة للتوصيل' },
      { id: 'out', label: 'خرجت للتوصيل' },
      { id: 'done', label: 'مكتملة' },
      { id: 'cancel', label: 'ملغاة' }
    ]
  },
  {
    id: 'products', label: 'المنتجات', icon: '📦', children: [
      { id: 'all', label: 'جميع المنتجات' },
      { id: 'add', label: 'إضافة منتج' },
      { id: 'cats', label: 'الأقسام' },
      { id: 'inv', label: 'المخزون' },
      { id: 'expiry', label: 'الصلاحية' },
      { id: 'moves', label: 'تحويلات المخزون' }
    ]
  },
  {
    id: 'purchasing', label: 'المشتريات', icon: '🚚', children: [
      { id: 'suppliers', label: 'الموردين' },
      { id: 'orders', label: 'أوامر الشراء' },
      { id: 'receiving', label: 'استلام بضاعة' }
    ]
  },
  {
    id: 'customers', label: 'العملاء', icon: '👥', children: [
      { id: 'all', label: 'جميع العملاء' },
      { id: 'segments', label: 'شرائح العملاء' }
    ]
  },
  {
    id: 'discounts', label: 'الخصومات', icon: '🏷️', children: [
      { id: 'all', label: 'جميع الخصومات' },
      { id: 'new', label: 'إنشاء خصم' }
    ]
  },
  {
    id: 'analytics', label: 'التحليلات', icon: '📈', children: [
      { id: 'overview', label: 'نظرة عامة' },
      { id: 'sales', label: 'المبيعات' },
      { id: 'products', label: 'المنتجات' },
      { id: 'customers', label: 'العملاء' },
      { id: 'orders', label: 'الطلبات' },
      { id: 'regions', label: 'المناطق' }
    ]
  },
  {
    id: 'wallet', label: 'المحفظة', icon: '💰', children: [
      { id: 'overview', label: 'نظرة عامة' },
      { id: 'txns', label: 'الحركات المالية' },
      { id: 'collect', label: 'التحصيلات' },
      { id: 'expenses', label: 'المصروفات', adminOnly: true },
      { id: 'settle', label: 'التسويات', adminOnly: true }
    ]
  },
  {
    id: 'marketing', label: 'التسويق', icon: '📣', children: [
      { id: 'home', label: 'الصفحة الرئيسية' },
      { id: 'banners', label: 'البنرات' },
      { id: 'whatsapp', label: 'واتساب' }
    ]
  },
  { id: 'pages', label: 'الصفحات', icon: '📄', children: [] },
  {
    id: 'settings', label: 'الإعدادات', icon: '⚙️', children: [
      { id: 'store', label: 'المتجر' },
      { id: 'delivery', label: 'التوصيل' },
      { id: 'payment', label: 'الدفع' },
      { id: 'users', label: 'المستخدمون والصلاحيات', adminOnly: true },
      { id: 'audit', label: 'سجل النشاط', adminOnly: true }
    ]
  }
]

// خريطة تبويبات الطلبات -> حالة الطلب الفعلية في قاعدة البيانات.
export const ORDER_TAB_STATUS: Record<string, string | null> = {
  new: 'placed',
  prep: 'preparing',
  ready: 'ready_for_delivery',
  out: 'out_for_delivery',
  done: 'delivered',
  cancel: 'cancelled'
}
