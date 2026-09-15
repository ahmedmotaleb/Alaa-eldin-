import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from './db.js'
import {
  createSession, destroySession, deriveDeviceName, sessionIdFromToken,
  listUserSessions, deleteUserSession, deleteOtherUserSessions
} from './auth.js'

const USER_ID = 'test-user-sessions-1'
const OTHER_USER_ID = 'test-user-sessions-2'

async function resetFixtures() {
  await pool.query('DELETE FROM sessions WHERE user_id = ANY($1::text[])', [[USER_ID, OTHER_USER_ID]])
  await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[USER_ID, OTHER_USER_ID]])
  for (const id of [USER_ID, OTHER_USER_ID]) {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $2, 'x', 'عميل اختبار', now())`,
      [id, `${id}@test.local`]
    )
  }
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

describe('deriveDeviceName', () => {
  it('returns a fallback for a missing user agent', () => {
    expect(deriveDeviceName(undefined)).toBe('جهاز غير معروف')
  })

  it('identifies Chrome on Android', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    expect(deriveDeviceName(ua)).toBe('Chrome على أندرويد')
  })

  it('identifies Safari on iPhone', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    expect(deriveDeviceName(ua)).toBe('Safari على iPhone')
  })

  it('identifies Chrome on Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    expect(deriveDeviceName(ua)).toBe('Chrome على ويندوز')
  })
})

describe('sessionIdFromToken', () => {
  it('matches the id the database computes via the generated column', async () => {
    const { token } = await createSession(USER_ID, { userAgent: 'test-agent', ip: '1.2.3.4' })
    const [session] = await listUserSessions(USER_ID)
    expect(session.id).toBe(sessionIdFromToken(token))
  })

  it('is deterministic for the same token', () => {
    expect(sessionIdFromToken('abc')).toBe(sessionIdFromToken('abc'))
  })

  it('differs for different tokens', () => {
    expect(sessionIdFromToken('abc')).not.toBe(sessionIdFromToken('def'))
  })
})

describe('createSession / listUserSessions', () => {
  it('persists device metadata and marks last_seen_at at creation time', async () => {
    await createSession(USER_ID, { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0', ip: '10.0.0.1' })
    const [session] = await listUserSessions(USER_ID)
    expect(session.deviceName).toBe('Chrome على ويندوز')
    expect(session.userAgent).toContain('Chrome')
    expect(session.lastSeenAt).not.toBeNull()
    expect(session.createdAt).not.toBeNull()
  })

  it('lists only sessions belonging to the given user', async () => {
    await createSession(USER_ID)
    await createSession(OTHER_USER_ID)
    const sessions = await listUserSessions(USER_ID)
    expect(sessions).toHaveLength(1)
  })

  it('orders sessions by most recent activity first', async () => {
    const { token: olderToken } = await createSession(USER_ID)
    await pool.query("UPDATE sessions SET created_at = now() - interval '1 hour', last_seen_at = now() - interval '1 hour' WHERE token = $1", [olderToken])
    await createSession(USER_ID)
    const sessions = await listUserSessions(USER_ID)
    expect(sessions).toHaveLength(2)
    expect(sessions[0].id).not.toBe(sessionIdFromToken(olderToken))
  })

  it('excludes an expired session', async () => {
    const { token } = await createSession(USER_ID)
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 day' WHERE token = $1", [token])
    const sessions = await listUserSessions(USER_ID)
    expect(sessions).toHaveLength(0)
  })
})

describe('deleteUserSession', () => {
  it('deletes a session owned by the user and returns true', async () => {
    const { token } = await createSession(USER_ID)
    const id = sessionIdFromToken(token)
    const deleted = await deleteUserSession(USER_ID, id)
    expect(deleted).toBe(true)
    expect(await listUserSessions(USER_ID)).toHaveLength(0)
  })

  it('refuses to delete a session belonging to a different user', async () => {
    const { token } = await createSession(OTHER_USER_ID)
    const id = sessionIdFromToken(token)
    const deleted = await deleteUserSession(USER_ID, id)
    expect(deleted).toBe(false)
    expect(await listUserSessions(OTHER_USER_ID)).toHaveLength(1)
  })

  it('returns false for an unknown session id', async () => {
    const deleted = await deleteUserSession(USER_ID, 'not-a-real-id')
    expect(deleted).toBe(false)
  })
})

describe('deleteOtherUserSessions', () => {
  it('removes every session except the current one', async () => {
    const { token: current } = await createSession(USER_ID)
    await createSession(USER_ID)
    await createSession(USER_ID)
    const revoked = await deleteOtherUserSessions(USER_ID, sessionIdFromToken(current))
    expect(revoked).toBe(2)
    const remaining = await listUserSessions(USER_ID)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(sessionIdFromToken(current))
  })

  it('does not touch another user\'s sessions', async () => {
    const { token: current } = await createSession(USER_ID)
    await createSession(OTHER_USER_ID)
    await deleteOtherUserSessions(USER_ID, sessionIdFromToken(current))
    expect(await listUserSessions(OTHER_USER_ID)).toHaveLength(1)
  })
})

describe('destroySession', () => {
  it('still removes a session by its raw token (used by logout)', async () => {
    const { token } = await createSession(USER_ID)
    await destroySession(token)
    expect(await listUserSessions(USER_ID)).toHaveLength(0)
  })
})
