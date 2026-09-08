import pg from 'pg'

const { Pool } = pg

// عمود NUMERIC/DECIMAL (OID 1700) بيرجعه الـ driver كـ string افتراضياً عشان يحافظ على الدقة
// (float64 عادي ممكن يفقد دقة أرقام NUMERIC كبيرة جداً). أعمدة الفلوس عندنا NUMERIC(12,2) —
// مدى وصلاحية محدودين تماماً، فتحويلها لـ float64 هنا آمن 100% ومفيش أي فقدان دقة حقيقي،
// وبيخلي باقي الكود (typeof x === 'number', جمع/طرح عادي) يشتغل زي ما هو من غير أي تغيير.
pg.types.setTypeParser(1700, (value: string) => value === null ? null : parseFloat(value))

// TIMESTAMPTZ (OID 1184): برضو بنرجّعه كـ string (ISO 8601 زي new Date().toISOString() بالظبط)
// بدل الـ JS Date object الافتراضي، عشان كل الكود الحالي (تسلسل JSON، new Date(row.field)،
// مقارنات نصية) يفضل يشتغل بالظبط زي ما كان قبل ما الأعمدة دي كانت TEXT.
pg.types.setTypeParser(1184, (value: string) => value === null ? null : new Date(value).toISOString())

// DATE (OID 1082): الافتراضي في node-pg بيرجعه كـ JS Date object. أعمدة زي discounts.expires_at
// وexpenses.expense_date بيتعامل معاها الكود الحالي كسلسلة نصية خام "YYYY-MM-DD" (فيه أماكن
// بتعمل .slice(0, 10) عليها مباشرة) — فبنسيبها زي ما هي من غير أي تحويل، مطابقة تماماً
// لصيغة النص اللي كانت متخزنة كـ TEXT قبل كده.
pg.types.setTypeParser(1082, (value: string) => value)

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/alaa_eldin'
})

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
