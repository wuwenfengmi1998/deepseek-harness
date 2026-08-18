/**
 * `session.uploadFile` persists one browser file into the attached session's
 * workspace `uploads/` directory: canonical-base64 decode, empty/oversize
 * refusal, name sanitization (no path traversal), exclusive-write collision
 * dedupe, and workspace-relative path answers.
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ApiProxy, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

const sid = (id: string): SessionId => id as SessionId
let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`upload-${String(nextRpc++)}`), payload }
}

async function harness(): Promise<{ ctx: Context; api: ApiProxy; cwd: string }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-upload-test-'))
  return {
    ctx,
    api: createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }),
    cwd,
  }
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

describe('session.uploadFile', () => {
  it('persists bytes under uploads/ and answers the workspace-relative path', async () => {
    const { ctx, api, cwd } = await harness()
    const session = ctx.sessions.create(sid('session-1'), { meta: { cwd } })
    const body = new TextEncoder().encode('{"a":1}')
    const response = await api.sessions.uploadFile(request({
      sessionId: session.id,
      name: 'data.json',
      mediaType: 'application/json',
      data: base64(body),
    }))
    expect(response.result).toMatchObject({
      ok: true,
      value: { name: 'data.json', path: 'uploads/data.json', bytes: body.byteLength },
    })
    const stored = await readFile(join(cwd, 'uploads', 'data.json'))
    expect([...stored]).toEqual([...body])
    await rm(cwd, { recursive: true, force: true })
  })

  it('sanitizes path-traversal names and deduplicates collisions with a numeric suffix', async () => {
    const { ctx, api, cwd } = await harness()
    const session = ctx.sessions.create(sid('session-2'), { meta: { cwd } })
    const evil = await api.sessions.uploadFile(request({
      sessionId: session.id,
      name: '../../evil.txt',
      data: base64(new TextEncoder().encode('x')),
    }))
    expect(evil.result).toMatchObject({ ok: true, value: { name: 'evil.txt', path: 'uploads/evil.txt' } })
    const again = await api.sessions.uploadFile(request({
      sessionId: session.id,
      name: '../../evil.txt',
      data: base64(new TextEncoder().encode('y')),
    }))
    expect(again.result).toMatchObject({ ok: true, value: { name: 'evil.txt', path: 'uploads/evil-1.txt' } })
    expect(await readdir(join(cwd, 'uploads'))).toEqual(['evil-1.txt', 'evil.txt'])
    await rm(cwd, { recursive: true, force: true })
  })

  it('refuses empty payloads, non-canonical base64, and oversized files', async () => {
    const { ctx, api, cwd } = await harness()
    const session = ctx.sessions.create(sid('session-3'), { meta: { cwd } })
    const empty = await api.sessions.uploadFile(request({
      sessionId: session.id,
      name: 'empty.txt',
      data: '',
    }))
    expect(empty.result).toMatchObject({ ok: false, error: { code: 'attachment-error', details: { reason: 'INVALID_FILE_BASE64' } } })
    const canonical = await api.sessions.uploadFile(request({
      sessionId: session.id,
      name: 'junk.txt',
      data: '%%%not-base64%%%',
    }))
    expect(canonical.result).toMatchObject({ ok: false, error: { details: { reason: 'INVALID_FILE_BASE64' } } })
    const big = new Uint8Array(32 * 1024 * 1024 + 1)
    const oversized = await api.sessions.uploadFile(request({
      sessionId: session.id,
      name: 'big.bin',
      data: base64(big),
    }))
    expect(oversized.result).toMatchObject({ ok: false, error: { details: { reason: 'FILE_TOO_LARGE' } } })
    // No successful write ever created the uploads directory.
    await expect(readdir(join(cwd, 'uploads'))).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(cwd, { recursive: true, force: true })
  })

  it('answers session-not-found for unattached sessions and internal for sessions without cwd', async () => {
    const { ctx, api, cwd } = await harness()
    const detached = await api.sessions.uploadFile(request({
      sessionId: 'ghost' as never,
      name: 'a.txt',
      data: base64(new TextEncoder().encode('a')),
    }))
    expect(detached.result).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
    const noCwd = ctx.sessions.create(sid('session-4'))
    const cwdless = await api.sessions.uploadFile(request({
      sessionId: noCwd.id,
      name: 'a.txt',
      data: base64(new TextEncoder().encode('a')),
    }))
    expect(cwdless.result).toMatchObject({ ok: false, error: { code: 'internal' } })
    await rm(cwd, { recursive: true, force: true })
  })
})
