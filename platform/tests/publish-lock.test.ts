import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import config from '@payload-config'
import {
  acquirePublishLock,
  releasePublishLock,
  PUBLISH_LOCK_TTL_MS,
} from '../src/endpoints/publishLock'

// 发布并发锁的原子性集成测试（需真实 Postgres）。
//
// ⚠️ 需要数据库：走 payload.db.drizzle 跑真实条件 UPDATE，验证「两个并发请求只有一个抢到锁」。
//    无 DATABASE_URI 时跳过。这是 Batch2 并发原子化的核心保证，必须在真实 PG 上验证
//    （mock 测不出原子性，只会假绿）。
const hasDb = Boolean(process.env.DATABASE_URI)

describe.skipIf(!hasDb)('发布并发锁 acquirePublishLock（需 DB）', () => {
  let payload: Payload
  const createdCcIds: number[] = []
  let postId: number

  beforeAll(async () => {
    payload = await getPayload({ config })
    const post = await payload.create({
      collection: 'posts',
      data: { title: '并发锁测试母体' },
    })
    postId = post.id as number
  })

  afterAll(async () => {
    // 清理本测试创建的渠道稿，避免污染本地持久库。
    for (const id of createdCcIds) {
      try {
        await payload.delete({ collection: 'channel-contents', id })
      } catch {
        /* 忽略清理错误 */
      }
    }
    await payload?.db?.destroy?.()
  })

  // 建一条 approved 渠道稿（status 字段有 access.update:()=>false，靠 Local API 默认
  // overrideAccess:true 直接写）。返回其整数 id。
  async function makeApprovedCc(): Promise<number> {
    const cc = await payload.create({
      collection: 'channel-contents',
      data: { post: postId, platform: 'wechat', wxTitle: '锁测试稿' } as never,
    })
    const id = cc.id as number
    createdCcIds.push(id)
    await payload.update({
      collection: 'channel-contents',
      id,
      data: { status: 'approved' } as never,
    })
    return id
  }

  it('两个并发抢锁：恰好一个赢家', async () => {
    const id = await makeApprovedCc()
    const [a, b] = await Promise.all([
      acquirePublishLock(payload, id, 'token-A'),
      acquirePublishLock(payload, id, 'token-B'),
    ])
    // 核心断言：并发下只有一个 true（原子 CAS 生效）。
    expect([a, b].filter(Boolean)).toHaveLength(1)
  })

  it('已持锁时再抢锁失败（stage 仍 none 但锁未过期）', async () => {
    const id = await makeApprovedCc()
    const first = await acquirePublishLock(payload, id, 'token-1')
    const second = await acquirePublishLock(payload, id, 'token-2')
    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  it('锁过期后可被重新抢占（TTL=0 即视为已过期）', async () => {
    const id = await makeApprovedCc()
    const first = await acquirePublishLock(payload, id, 'token-old', PUBLISH_LOCK_TTL_MS)
    expect(first).toBe(true)
    // 用 ttl=0：任何已存在的锁都「早于 now()-0」→ 视为过期，可重抢。
    const reAcquired = await acquirePublishLock(payload, id, 'token-new', 0)
    expect(reAcquired).toBe(true)
  })

  it('释放锁：仅令牌一致者能清，错误令牌不清', async () => {
    const id = await makeApprovedCc()
    await acquirePublishLock(payload, id, 'owner-token')

    // 错误令牌释放：不生效，锁仍在（未过期），他人仍抢不到。
    await releasePublishLock(payload, id, 'wrong-token')
    const stillLocked = await acquirePublishLock(payload, id, 'intruder')
    expect(stillLocked).toBe(false)

    // 正确令牌释放：锁清空，可再次抢到。
    await releasePublishLock(payload, id, 'owner-token')
    const afterRelease = await acquirePublishLock(payload, id, 'next-owner')
    expect(afterRelease).toBe(true)
  })

  it('非 approved 状态抢锁失败（draft 稿不可被锁）', async () => {
    const cc = await payload.create({
      collection: 'channel-contents',
      data: { post: postId, platform: 'wechat', wxTitle: '草稿态' } as never,
    })
    const id = cc.id as number
    createdCcIds.push(id)
    // 默认 status=draft，未转 approved。
    const got = await acquirePublishLock(payload, id, 'tok')
    expect(got).toBe(false)
  })
})
