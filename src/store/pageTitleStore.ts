import { useSyncExternalStore } from 'react'

// عنوان صفحة تفاصيل المنتج بيتحدد بعد ما بيانات المنتج توصل من GET /api/products/:slug —
// الهيدر (Layout) ما بيحملش الكتالوج كامل عشان يعرف اسم المنتج، فبيقرأ القيمة دي بدل كده.
let title = ''
const listeners = new Set<() => void>()

export function setPageTitle(value: string) {
  title = value
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return title
}

export function usePageTitle() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
