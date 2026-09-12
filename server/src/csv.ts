// أداة CSV صغيرة ومكتفية ذاتياً (مش مكتبة خارجية) — بتدعم الحالات الحقيقية اللي هتقابلنا:
// حقول فيها فاصلة أو علامات اقتباس أو أسطر جديدة (زي أسماء منتجات عربية فيها فاصلة)، مطابقة
// لصيغة RFC4180 القياسية. مفيش داعي لمكتبة كاملة لسيناريو بالبساطة دي.

export function encodeCsvField(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(encodeCsvField).join(',')]
  for (const row of rows) {
    lines.push(row.map(encodeCsvField).join(','))
  }
  return lines.join('\r\n')
}

// بيرجع صفوف كـ arrays من النصوص الخام (بدون أي تحويل نوع) — المنادي هو اللي يفسّر الأعمدة.
// الصف الأول مفروض يبقى الهيدر؛ الدالة بترجعه منفصل عن باقي الصفوف.
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0
  const normalized = text.replace(/\r\n/g, '\n')

  function pushField() {
    row.push(field)
    field = ''
  }
  function pushRow() {
    pushField()
    rows.push(row)
    row = []
  }

  while (i < normalized.length) {
    const ch = normalized[i]
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      pushField()
      i++
      continue
    }
    if (ch === '\n') {
      pushRow()
      i++
      continue
    }
    field += ch
    i++
  }
  // آخر صف من غير سطر جديد في الآخر
  if (field.length > 0 || row.length > 0) pushRow()

  const nonEmptyRows = rows.filter(r => !(r.length === 1 && r[0] === ''))
  const [headers, ...dataRows] = nonEmptyRows
  return { headers: headers ?? [], rows: dataRows }
}

// بيحوّل صفوف parseCsv لمصفوفة كائنات باستخدام الهيدر كمفاتيح — بيتجاهل صفوف أقصر/أطول من
// الهيدر بدل ما يرمي استثناء (بيانات مُصدَّرة يدوياً وممكن يكون فيها أخطاء بسيطة).
export function csvRecords(parsed: { headers: string[]; rows: string[][] }): Record<string, string>[] {
  return parsed.rows.map(row => {
    const record: Record<string, string> = {}
    parsed.headers.forEach((header, idx) => {
      record[header] = row[idx] ?? ''
    })
    return record
  })
}
