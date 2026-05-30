import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import config from '@payload-config'

// 首用户 bootstrap 提权的集成测试（需真实 Postgres）。
//
// 背景（codex review High）：Users.create 收敛为 admin-only，但 Payload registerFirstUser 在
// 「库中无任何用户」时允许未登录建首账号、role 默认 operator。若不提权，首次安装后将无 admin
// 能再建账号 → 账号管理锁死。Users 的 beforeChange hook 对「第一个用户」强制 role=admin。
//
// ⚠️ 该行为只在 users 表为空时可验证。CI 用全新空库 → 真测；本地共享库若已有用户 → 运行时
//    软跳过（不删真实数据）。
const hasDb = Boolean(process.env.DATABASE_URI)

describe.skipIf(!hasDb)('Users 首用户 bootstrap 提权（需 DB）', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config })
  })

  afterAll(async () => {
    await payload?.db?.destroy?.()
  })

  it('库中无用户时，创建的首个用户被强制为 admin（即便未显式传 role）', async () => {
    const { totalDocs } = await payload.count({ collection: 'users' })
    if (totalDocs > 0) {
      // 本地库已有用户，无法重现「首用户」场景；不删真实数据。CI 空库会真正验证此行为。
      console.warn('[users-bootstrap] users 表非空，跳过首用户提权验证（CI 空库会真测）')
      return
    }
    const u = await payload.create({
      collection: 'users',
      // 不传 role：defaultValue 是 operator；bootstrap hook 应把首用户强制提为 admin。
      data: { email: 'bootstrap-first@lilink.top', password: 'bootstrap12345' } as never,
    })
    expect(u.role).toBe('admin')

    // 第二个用户不再被提权（库中已有用户）：默认仍是 operator。
    const second = await payload.create({
      collection: 'users',
      data: { email: 'bootstrap-second@lilink.top', password: 'bootstrap12345' } as never,
    })
    expect(second.role).toBe('operator')
  })
})
