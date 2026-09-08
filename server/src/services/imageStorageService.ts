// طبقة تجريد فوق مزوّد تخزين خارجي دائم للصور. الهدف: أي كود تاني في السيرفر (endpoint
// الرفع، حذف صورة) يتعامل مع uploadImage/deleteImage فقط، من غير ما يعرف تفاصيل Cloudinary
// نفسها — لو اتغيّر المزوّد يوماً، التغيير محصور في الملف ده بس.
import { v2 as cloudinary } from 'cloudinary'
import crypto from 'node:crypto'

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET
const FOLDER = process.env.CLOUDINARY_FOLDER ?? 'alaa-eldin/products'

export const imageStorageConfigured = !!(CLOUD_NAME && API_KEY && API_SECRET)

if (imageStorageConfigured) {
  cloudinary.config({ cloud_name: CLOUD_NAME, api_key: API_KEY, api_secret: API_SECRET, secure: true })
}

export interface UploadedImage {
  url: string
  storageKey: string
}

// اسم الملف الأصلي اللي بيبعته المستخدم متجاهل تماماً كمصدر لمسار التخزين — asset id
// بيتولّد هنا في السيرفر عشان نمنع أي path traversal أو تعارض أسماء.
export async function uploadImage(buffer: Buffer): Promise<UploadedImage> {
  if (!imageStorageConfigured) {
    throw new Error('image_storage_not_configured')
  }
  const publicId = crypto.randomBytes(16).toString('hex')
  const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: FOLDER,
        public_id: publicId,
        resource_type: 'image',
        format: 'webp',
        overwrite: false
      },
      (err, res) => {
        if (err || !res) reject(err ?? new Error('upload_failed'))
        else resolve(res as { secure_url: string; public_id: string })
      }
    )
    stream.end(buffer)
  })
  return { url: result.secure_url, storageKey: result.public_id }
}

export async function deleteImage(storageKey: string): Promise<void> {
  if (!imageStorageConfigured || !storageKey) return
  await cloudinary.uploader.destroy(storageKey, { resource_type: 'image' })
}
