// اختبار وحدة (unit) على التحقق من magic bytes الحقيقية للملف — بيتأكد إن ملف متنكر بامتداد/
// mimetype صورة مزيّف (زي سكريبت أو ملف تنفيذي) بيترفض حتى لو الـ mimetype المُعلن كان صورة.
// المنطق ده مشترك بين رفع صور المنتجات/البنرات/الأقسام ومرفقات تذاكر الدعم.
import { describe, expect, it } from 'vitest'
import { isRealImage, isHeicOrHeif } from './imageValidation.js'

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const WEBP_BYTES = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')])
const FAKE_SCRIPT = Buffer.from('#!/bin/bash\necho hello world\n')
// صندوق ISO-BMFF "ftyp" حقيقي بـ brand "heic" — نفس الشكل اللي بيبعته أندرويد/آيفون فعلاً.
const HEIC_BYTES = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp'), Buffer.from('heic'), Buffer.from([0, 0, 0, 0])])

describe('isRealImage', () => {
  it('accepts a real JPEG signature', () => {
    expect(isRealImage(JPEG_BYTES, 'image/jpeg')).toBe(true)
  })

  it('accepts a real PNG signature', () => {
    expect(isRealImage(PNG_BYTES, 'image/png')).toBe(true)
  })

  it('accepts a real WebP signature', () => {
    expect(isRealImage(WEBP_BYTES, 'image/webp')).toBe(true)
  })

  it('rejects a non-image file spoofed as image/jpeg', () => {
    expect(isRealImage(FAKE_SCRIPT, 'image/jpeg')).toBe(false)
  })

  it('rejects a non-image file spoofed as image/png', () => {
    expect(isRealImage(FAKE_SCRIPT, 'image/png')).toBe(false)
  })

  it('rejects a PNG file spoofed as image/jpeg mimetype', () => {
    expect(isRealImage(PNG_BYTES, 'image/jpeg')).toBe(false)
  })

  it('rejects an unsupported mimetype entirely', () => {
    expect(isRealImage(JPEG_BYTES, 'application/octet-stream')).toBe(false)
  })

  it('rejects a buffer too small to contain a valid signature', () => {
    expect(isRealImage(Buffer.from([0xff]), 'image/jpeg')).toBe(false)
  })

  // 'image/jpg' مرادف غير قياسي بيبعته بعض متصفحات أندرويد لملفات JPEG حقيقية — لازم يتقبل
  // بنفس magic bytes JPEG العادية، مش يترفض لمجرد اختلاف النص عن 'image/jpeg'.
  it('accepts a real JPEG signature with the non-standard "image/jpg" mimetype alias', () => {
    expect(isRealImage(JPEG_BYTES, 'image/jpg')).toBe(true)
  })

  it('still rejects a fake file spoofed as "image/jpg"', () => {
    expect(isRealImage(FAKE_SCRIPT, 'image/jpg')).toBe(false)
  })
})

describe('isHeicOrHeif', () => {
  it('detects a real HEIC file by its ISO-BMFF ftyp box, regardless of declared mimetype', () => {
    expect(isHeicOrHeif(HEIC_BYTES, 'application/octet-stream')).toBe(true)
  })

  it('detects HEIC by the declared mimetype even without inspecting magic bytes', () => {
    expect(isHeicOrHeif(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'image/heic')).toBe(true)
  })

  it('does not misclassify a real JPEG as HEIC', () => {
    expect(isHeicOrHeif(JPEG_BYTES, 'image/jpeg')).toBe(false)
  })

  it('does not misclassify a real PNG as HEIC', () => {
    expect(isHeicOrHeif(PNG_BYTES, 'image/png')).toBe(false)
  })

  it('rejects a buffer too small to contain a ftyp box', () => {
    expect(isHeicOrHeif(Buffer.from([0xff]), 'application/octet-stream')).toBe(false)
  })
})
