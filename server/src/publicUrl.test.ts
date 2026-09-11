import { afterEach, describe, expect, it } from 'vitest'
import { publicOrigin } from './publicUrl.js'

const ORIGINAL = process.env.PUBLIC_APP_URL

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PUBLIC_APP_URL
  else process.env.PUBLIC_APP_URL = ORIGINAL
})

describe('publicOrigin', () => {
  it('strips a trailing slash', () => {
    process.env.PUBLIC_APP_URL = 'https://alaaeldin.example/'
    expect(publicOrigin()).toBe('https://alaaeldin.example')
  })

  it('strips multiple trailing slashes', () => {
    process.env.PUBLIC_APP_URL = 'https://alaaeldin.example//'
    expect(publicOrigin()).toBe('https://alaaeldin.example')
  })

  it('leaves an already-clean origin untouched', () => {
    process.env.PUBLIC_APP_URL = 'https://alaaeldin.example'
    expect(publicOrigin()).toBe('https://alaaeldin.example')
  })

  it('falls back to a default when unset', () => {
    delete process.env.PUBLIC_APP_URL
    expect(publicOrigin()).toBe('http://localhost:5173')
  })
})
