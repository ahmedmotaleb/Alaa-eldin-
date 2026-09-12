import { describe, expect, it } from 'vitest'
import { toCsv, parseCsv, csvRecords, encodeCsvField } from './csv.js'

describe('encodeCsvField', () => {
  it('leaves plain values unquoted', () => {
    expect(encodeCsvField('hello')).toBe('hello')
    expect(encodeCsvField(42)).toBe('42')
    expect(encodeCsvField(null)).toBe('')
    expect(encodeCsvField(undefined)).toBe('')
  })

  it('quotes and escapes fields containing commas, quotes, or newlines', () => {
    expect(encodeCsvField('a,b')).toBe('"a,b"')
    expect(encodeCsvField('a"b')).toBe('"a""b"')
    expect(encodeCsvField('a\nb')).toBe('"a\nb"')
  })
})

describe('toCsv + parseCsv round trip', () => {
  it('round-trips plain data', () => {
    const csv = toCsv(['id', 'name'], [['1', 'Apple'], ['2', 'Banana']])
    const parsed = parseCsv(csv)
    expect(parsed.headers).toEqual(['id', 'name'])
    expect(parsed.rows).toEqual([['1', 'Apple'], ['2', 'Banana']])
  })

  it('round-trips fields with commas, quotes, and Arabic text', () => {
    const csv = toCsv(['name', 'note'], [
      ['أرز, بسمتي', 'ملاحظة بـ"اقتباس"'],
      ['شاي', 'بدون ملاحظات']
    ])
    const parsed = parseCsv(csv)
    expect(parsed.rows[0]).toEqual(['أرز, بسمتي', 'ملاحظة بـ"اقتباس"'])
    expect(parsed.rows[1]).toEqual(['شاي', 'بدون ملاحظات'])
  })

  it('handles a field containing a newline', () => {
    const csv = toCsv(['a'], [['line1\nline2']])
    const parsed = parseCsv(csv)
    expect(parsed.rows).toEqual([['line1\nline2']])
  })

  it('parses CRLF line endings the same as LF', () => {
    const csv = 'id,name\r\n1,Apple\r\n2,Banana\r\n'
    const parsed = parseCsv(csv)
    expect(parsed.headers).toEqual(['id', 'name'])
    expect(parsed.rows).toEqual([['1', 'Apple'], ['2', 'Banana']])
  })

  it('ignores a trailing blank line', () => {
    const csv = 'id,name\n1,Apple\n'
    const parsed = parseCsv(csv)
    expect(parsed.rows).toEqual([['1', 'Apple']])
  })
})

describe('csvRecords', () => {
  it('maps rows to objects keyed by header', () => {
    const parsed = parseCsv('sku,counted\nSKU1,10\nSKU2,5')
    expect(csvRecords(parsed)).toEqual([
      { sku: 'SKU1', counted: '10' },
      { sku: 'SKU2', counted: '5' }
    ])
  })

  it('fills missing trailing columns with empty string', () => {
    const parsed = parseCsv('sku,counted\nSKU1')
    expect(csvRecords(parsed)).toEqual([{ sku: 'SKU1', counted: '' }])
  })
})
