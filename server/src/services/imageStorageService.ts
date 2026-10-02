// طبقة تجريد فوق مزوّد تخزين خارجي دائم للصور. الهدف: أي كود تاني في السيرفر (endpoint
// الرفع، حذف صورة) يتعامل مع uploadImage/deleteImage فقط، من غير ما يعرف تفاصيل Cloudinary
// نفسها — لو اتغيّر المزوّد يوماً، التغيير محصور في الملف ده بس.
import { v2 as cloudinary } from 'cloudinary'
import crypto from 'node:crypto'

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET
const FOLDER = process.env.CLOUDINARY_FOLDER ?? 'alaa-eldin/products'
const SUPPORT_FOLDER = process.env.CLOUDINARY_SUPPORT_FOLDER ?? 'alaa-eldin/support-attachments'

export const imageStorageConfigured = !!(CLOUD_NAME && API_KEY && API_SECRET)

if (imageStorageConfigured) {
  cloudinary.config({ cloud_name: CLOUD_NAME, api_key: API_KEY, api_secret: API_SECRET, secure: true })
}

export interface UploadedImage {
  url: string
  storageKey: string
}

// غلاف آمن حول فشل رفع فعلي لـ Cloudinary — بيحافظ على http_code/message الحقيقيين (بدون أي
// بيانات اعتماد) عشان مسار الراوت يقدر يسجّل تشخيص حقيقي (raise section 3) من غير ما يحتاج
// يلمس تفاصيل مزوّد التخزين مباشرة.
export class CloudinaryUploadError extends Error {
  readonly status?: number
  readonly cloudinaryMessage?: string
  constructor(status?: number, cloudinaryMessage?: string) {
    super('cloudinary_upload_failed')
    this.name = 'CloudinaryUploadError'
    this.status = status
    this.cloudinaryMessage = cloudinaryMessage
  }
}

export type ImageStorageConnectionStatus = 'connected' | 'credentials_invalid' | 'not_configured' | 'provider_unreachable'

// فحص اتصال حقيقي (مش بس "المتغيرات موجودة") — بينادي Cloudinary API نفسه (ping مُوثّق بمفتاح
// API، مش طلب عام) للتأكد إن الـ cloud name/api key/api secret فعلاً صحيحين ومقبولين من
// المزوّد. مفيش أي قيمة سر بترجع هنا أبداً — بس حالة نصية آمنة.
export async function checkImageStorageConnection(): Promise<ImageStorageConnectionStatus> {
  if (!imageStorageConfigured) return 'not_configured'
  try {
    await cloudinary.api.ping()
    return 'connected'
  } catch (err) {
    const httpCode = (err as { http_code?: number } | undefined)?.http_code
    if (httpCode === 401 || httpCode === 403) return 'credentials_invalid'
    return 'provider_unreachable'
  }
}

// اسم الملف الأصلي اللي بيبعته المستخدم متجاهل تماماً كمصدر لمسار التخزين — asset id
// بيتولّد هنا في السيرفر عشان نمنع أي path traversal أو تعارض أسماء. `folder` اختياري —
// مرفقات تذاكر الدعم بتتخزن في مجلد منفصل عن صور المنتجات، بنفس البنية التحتية بالظبط.
export async function uploadImage(buffer: Buffer, folder: string = FOLDER): Promise<UploadedImage> {
  if (!imageStorageConfigured) {
    throw new Error('image_storage_not_configured')
  }
  const publicId = crypto.randomBytes(16).toString('hex')
  const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: 'image',
        format: 'webp',
        overwrite: false
      },
      (err, res) => {
        if (err || !res) {
          const httpCode = (err as { http_code?: number } | undefined)?.http_code
          const message = (err as { message?: string } | undefined)?.message
          reject(new CloudinaryUploadError(httpCode, message))
        }
        else resolve(res as { secure_url: string; public_id: string })
      }
    )
    stream.end(buffer)
  })
  return { url: result.secure_url, storageKey: result.public_id }
}

export const SUPPORT_ATTACHMENTS_FOLDER = SUPPORT_FOLDER

export async function deleteImage(storageKey: string): Promise<void> {
  if (!imageStorageConfigured || !storageKey) return
  await cloudinary.uploader.destroy(storageKey, { resource_type: 'image' })
}
