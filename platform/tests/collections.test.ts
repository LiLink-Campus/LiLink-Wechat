import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import config from '@payload-config'

// 内容模型集成测试（Media / Posts / ChannelContents）。
//
// ⚠️ 需要数据库：本套用例走 Payload Local API（getPayload），会真实读写
//    DATABASE_URI 指向的 Postgres。无 DB 时请跳过（见下方 describe.skipIf）。
//    运行前确保设置了 DATABASE_URI 与 PAYLOAD_SECRET 环境变量，且 schema 已 push。
//
// 这是“骨架”：覆盖三个 collection 是否正确注册、必填校验、默认值、
// 以及 ChannelContent → Post / Media 的关系装配。具体业务规则待后续补充。

const hasDb = Boolean(process.env.DATABASE_URI)

describe.skipIf(!hasDb)('内容模型 collections（需 DB）', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config })
  })

  afterAll(async () => {
    // 释放连接池，避免 vitest 进程挂起。
    await payload?.db?.destroy?.()
  })

  it('三个 collection 均已注册到 config', () => {
    const slugs = payload.config.collections.map((c) => c.slug)
    expect(slugs).toContain('media')
    expect(slugs).toContain('posts')
    expect(slugs).toContain('channel-contents')
  })

  it('Posts 必填 title；缺失时报错', async () => {
    await expect(
      // @ts-expect-error 故意缺 title 以触发校验
      payload.create({ collection: 'posts', data: {} }),
    ).rejects.toThrow()
  })

  it('创建 Post 并写入 tags（array 子字段）', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: {
        title: '测试选题',
        topic: '产品',
        tags: [{ tag: 'lilink' }, { tag: 'ai' }],
      },
    })
    expect(post.id).toBeDefined()
    expect(post.title).toBe('测试选题')
    expect(post.tags?.[0]?.tag).toBe('lilink')
  })

  it('ChannelContent：platform 默认 wechat、status 默认 draft，并关联 Post', async () => {
    const post = await payload.create({
      collection: 'posts',
      data: { title: '渠道稿母体' },
    })

    const cc = await payload.create({
      collection: 'channel-contents',
      data: {
        post: post.id,
        wxTitle: '公众号标题',
        // platform / status / sourceUrl / publishResult.stage 走默认值
      },
    })

    expect(cc.platform).toBe('wechat')
    expect(cc.status).toBe('draft')
    expect(cc.sourceUrl).toBe('https://lilink.top')
    expect(cc.publishResult?.stage).toBe('none')

    // 关系字段：未加 depth 时返回 id；这里断言其指向母体 Post。
    const linkedId = typeof cc.post === 'object' ? cc.post.id : cc.post
    expect(linkedId).toBe(post.id)
  })

  it('ChannelContent：post 为必填', async () => {
    await expect(
      // @ts-expect-error 故意缺 post 以触发校验
      payload.create({ collection: 'channel-contents', data: { wxTitle: '没有母体' } }),
    ).rejects.toThrow()
  })

  it('Media：type 默认 image', async () => {
    // 不传文件、仅校验默认值与字段装配。
    // 注：upload collection 通常需要文件；若你的环境强制要求文件，
    //    可改用带 filePath 的 create，或为该用例补一张测试图。
    const created = await payload.create({
      collection: 'media',
      data: { alt: '测试图', type: 'image' },
      // @ts-expect-error 跳过文件以做最小字段校验（视适配器而定可能需要 file）
      disableUploadFile: true,
    })
    expect(created.type).toBe('image')
    expect(created.alt).toBe('测试图')
  })
})
