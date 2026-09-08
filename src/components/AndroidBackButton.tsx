import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { App } from '@capacitor/app'
import { isNative } from '../utils/platform'
import { useToast } from '../store/ToastContext'
import { ar } from '../i18n/ar'

const EXIT_CONFIRM_WINDOW_MS = 2000

// زر الرجوع الفيزيائي في الأندرويد — لو المستخدم جوه أي صفحة غير الرئيسية، بيرجعه للخلف
// زي زر رجوع المتصفح العادي. لو هو على الشاشة الرئيسية بالظبط، أول ضغطة بتورّي تلميح
// "اضغط مرة أخرى للخروج" بدل ما تقفل التطبيق فجأة بالغلط؛ ضغطة تانية خلال ثانيتين بتخرج فعلاً.
export function AndroidBackButton() {
  const navigate = useNavigate()
  const location = useLocation()
  const flash = useToast()
  const lastBackAt = useRef(0)

  useEffect(() => {
    if (!isNative()) return

    const listenerPromise = App.addListener('backButton', () => {
      if (location.pathname !== '/') {
        navigate(-1)
        return
      }

      const now = Date.now()
      if (now - lastBackAt.current < EXIT_CONFIRM_WINDOW_MS) {
        App.exitApp()
        return
      }
      lastBackAt.current = now
      flash(ar.common.pressBackAgainToExit)
    })

    return () => {
      listenerPromise.then(listener => listener.remove())
    }
  }, [location.pathname, navigate, flash])

  return null
}
