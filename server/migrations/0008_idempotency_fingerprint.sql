-- بصمة الطلب (hash لمحتوى الطلب الأساسي: الأصناف/الكميات/رقم الموبايل/كود الخصم...إلخ)
-- محفوظة جنب idempotency_key. لو نفس المفتاح اتبعت تاني بمحتوى مختلف فعلياً (مش مجرد إعادة
-- إرسال نفس الطلب بعد timeout)، بنرفض بـ idempotency_conflict بدل ما نرجّع طلب قديم لا يعبّر
-- عن الطلب الجديد الفعلي.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
