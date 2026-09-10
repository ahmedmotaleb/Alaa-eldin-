import { useEffect, useState } from 'react'

// بيرجّع نسخة متأخرة من القيمة بعد ما المستخدم يوقف الكتابة لمدة معينة — بيقلل عدد طلبات
// البحث اللي بتتبعت للسيرفر أثناء الكتابة الحية في حقول البحث بلوحة التحكم.
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
