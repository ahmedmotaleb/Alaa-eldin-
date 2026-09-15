import { describe, expect, it } from 'vitest'
import {
  isValidCalendarDateString, isoWeekdayOf, addCalendarDays, nextCalendarDates,
  parseClosedWeekdays, serializeClosedWeekdays, todayInCairo
} from './cairoDate.js'

describe('isValidCalendarDateString', () => {
  it('accepts a well-formed real calendar date', () => {
    expect(isValidCalendarDateString('2026-09-17')).toBe(true)
  })

  it('rejects a malformed string', () => {
    expect(isValidCalendarDateString('17-09-2026')).toBe(false)
    expect(isValidCalendarDateString('2026/09/17')).toBe(false)
    expect(isValidCalendarDateString('')).toBe(false)
    expect(isValidCalendarDateString(undefined)).toBe(false)
  })

  it('rejects a calendar-invalid date (e.g. Feb 30)', () => {
    expect(isValidCalendarDateString('2026-02-30')).toBe(false)
    expect(isValidCalendarDateString('2026-13-01')).toBe(false)
  })
})

describe('isoWeekdayOf', () => {
  it('returns 4 (Thursday) for 2026-09-17', () => {
    // ثابت من التقويم الفعلي — 2026-09-17 يوم خميس.
    expect(isoWeekdayOf('2026-09-17')).toBe(4)
  })

  it('returns 7 (Sunday) for 2026-09-13', () => {
    expect(isoWeekdayOf('2026-09-13')).toBe(7)
  })

  it('returns 1 (Monday) for 2026-09-14', () => {
    expect(isoWeekdayOf('2026-09-14')).toBe(1)
  })
})

describe('addCalendarDays', () => {
  it('adds days within the same month', () => {
    expect(addCalendarDays('2026-09-17', 3)).toBe('2026-09-20')
  })

  it('rolls over into the next month', () => {
    expect(addCalendarDays('2026-09-29', 3)).toBe('2026-10-02')
  })

  it('supports negative offsets', () => {
    expect(addCalendarDays('2026-09-01', -1)).toBe('2026-08-31')
  })

  it('rolls over into the next year', () => {
    expect(addCalendarDays('2026-12-30', 3)).toBe('2027-01-02')
  })
})

describe('nextCalendarDates', () => {
  it('returns the start date plus the following (count - 1) days, inclusive', () => {
    expect(nextCalendarDates('2026-09-17', 3)).toEqual(['2026-09-17', '2026-09-18', '2026-09-19'])
  })

  it('returns an empty array for a zero or negative count', () => {
    expect(nextCalendarDates('2026-09-17', 0)).toEqual([])
  })
})

describe('parseClosedWeekdays / serializeClosedWeekdays', () => {
  it('round-trips a set of weekdays', () => {
    expect(parseClosedWeekdays('5')).toEqual([5])
    expect(parseClosedWeekdays('1,5,7')).toEqual([1, 5, 7])
    expect(serializeClosedWeekdays([5])).toBe('5')
    expect(serializeClosedWeekdays([7, 1, 5])).toBe('1,5,7')
  })

  it('treats an empty string as no closed days', () => {
    expect(parseClosedWeekdays('')).toEqual([])
  })

  it('ignores out-of-range or malformed values', () => {
    expect(parseClosedWeekdays('0,8,abc,3')).toEqual([3])
    expect(serializeClosedWeekdays([0, 8, 3, 3])).toBe('3')
  })
})

describe('todayInCairo', () => {
  it('returns a well-formed calendar date string', () => {
    expect(isValidCalendarDateString(todayInCairo())).toBe(true)
  })
})
