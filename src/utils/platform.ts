import { Capacitor } from '@capacitor/core'

// نقطة مركزية واحدة لاكتشاف المنصة — بدل ما ننشر فحوصات Capacitor.getPlatform() في
// عشرات المكونات، أي فرق سلوك بين الويب والأندرويد بيمر من هنا بس.
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

export function isAndroid(): boolean {
  return Capacitor.getPlatform() === 'android'
}

export function isWeb(): boolean {
  return Capacitor.getPlatform() === 'web'
}
