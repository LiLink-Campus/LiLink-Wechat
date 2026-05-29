import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ===== 模块 mock（vi.mock 被 vitest 提升到文件顶端，先于下面的 import 生效）=====
// mock 微信 token：getAccessToken 固定返回 'TKN'，并记录调用以验链路起点。
vi.mock('../src/wechat/token', () => ({
  getAccessToken: vi.fn(async () => 'TKN'),
  clearTokenCache: vi.fn(),
}))

// mock 微信 client：三个上传/草稿函数都返回可预期的假值，便于断言链路与替换。
vi.mock('../src/wechat/client', () => ({
  addPermanentImage: vi.fn(async () => ({ mediaId: 'THUMB_MID', url: 'https://mmbiz.qpic.cn/cover.jpg' })),
  // 正文图：按入参 src 返回一个可区分的微信 URL，便于断言"哪张图换成了哪个 URL"。
  uploadContentImage: vi.fn(async (_token: string, file: unknown) => ({
    url: `https://mmbiz.qpic.cn/uploaded/${encodeURIComponent(String(file))}.jpg`,
  })),
  addDraft: vi.fn(async () => ({ mediaId: 'DRAFT_MID' })),
}))

// mock 渲染器注册表：renderers.wechat.render 记录入参并回固定 HTML。
// 用 vi.hoisted 定义 renderMock —— vi.mock 工厂被提升到文件顶端，普通 top-level 变量
// 在工厂运行时尚未初始化（报 Cannot access before initialization）；hoisted 块同被提升故可用。
const { renderMock } = vi.hoisted(() => ({
  renderMock: vi.fn(async () => ({ html: '<p>rendered</p>', warnings: [] as string[] })),
}))
vi.mock('../src/renderers', () => ({
  renderers: {
    wechat: { platform: 'wechat', render: renderMock },
  },
}))

// mock 之后再 import 被测对象与（被 mock 的）依赖，拿到的是 mock 实例。
import { WechatPublisher } from '../src/publishers/wechat'
import { publishers } from '../src/publishers'
import { getAccessToken } from '../src/wechat/token'
import { addPermanentImage, uploadContentImage, addDraft } from '../src/wechat/client'
import { publishEndpoint } from '../src/endpoints/publish'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// 一份典型渠道稿：含封面 + 正文两张图（其中一张重复出现，用于验去重只传一次）。
function makeChannelContent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cc1',
    platform: 'wechat',
    status: 'approved',
    wxTitle: '标题',
    wxAuthor: '李林',
    wxDigest: '摘要',
    sourceUrl: 'https://lilink.top',
    coverImage: { id: 'm1', url: 'https://cdn.local/cover.png' },
    bodyMarkdown: '开头\n\n![图一](pic1.png)\n\n中间\n\n![图二](https://ex.com/pic2.png)\n\n再次出现图一 ![又是图一](pic1.png)\n\n结尾',
    renderConfig: { ctaUrl: 'https://lilink.top', noCta: false },
    ...overrides,
  }
}

describe('WechatPublisher.publish 链路', () => {
  it('按 token→封面→正文图→渲染→建草稿 的顺序串起整链', async () => {
    const cc = makeChannelContent()
    const result = await new WechatPublisher().publish({
      channelContent: cc,
      wechat: { appId: 'APPID', appSecret: 'SECRET' },
    })

    // 返回值符合 PublishResult 约定。
    expect(result).toEqual({ draftMediaId: 'DRAFT_MID', stage: 'draft_created' })

    // 链路起点：用注入的凭据取 token。
    expect(getAccessToken).toHaveBeenCalledWith('APPID', 'SECRET')

    // 封面：用 token + 解析出的封面 URL 上传永久素材。
    expect(addPermanentImage).toHaveBeenCalledTimes(1)
    expect(addPermanentImage).toHaveBeenCalledWith('TKN', 'https://cdn.local/cover.png')

    // 正文图：两张不同图各传一次（pic1.png 重复出现只上传一次）。
    expect(uploadContentImage).toHaveBeenCalledTimes(2)
    const uploadedSrcs = (uploadContentImage as any).mock.calls.map((c: unknown[]) => c[1])
    expect(uploadedSrcs).toEqual(['pic1.png', 'https://ex.com/pic2.png'])
    // 都带上了 token。
    for (const c of (uploadContentImage as any).mock.calls) {
      expect(c[0]).toBe('TKN')
    }

    // 调用先后：token 在最前；addDraft 在最后。
    const tokenOrder = (getAccessToken as any).mock.invocationCallOrder[0]
    const coverOrder = (addPermanentImage as any).mock.invocationCallOrder[0]
    const firstUploadOrder = (uploadContentImage as any).mock.invocationCallOrder[0]
    const renderOrder = renderMock.mock.invocationCallOrder[0]
    const draftOrder = (addDraft as any).mock.invocationCallOrder[0]
    expect(tokenOrder).toBeLessThan(coverOrder)
    expect(coverOrder).toBeLessThan(firstUploadOrder)
    expect(firstUploadOrder).toBeLessThan(renderOrder)
    expect(renderOrder).toBeLessThan(draftOrder)
  })

  it('把正文 Markdown 里的图片 src 替换成微信 URL，再以 embedImages:false 渲染', async () => {
    const cc = makeChannelContent()
    await new WechatPublisher().publish({
      channelContent: cc,
      wechat: { appId: 'APPID', appSecret: 'SECRET' },
    })

    // 渲染只被调一次，且 embedImages 必须为 false（正文图已是微信 URL，禁止再内联）。
    expect(renderMock).toHaveBeenCalledTimes(1)
    const renderArg = renderMock.mock.calls[0][0] as {
      markdown: string
      embedImages?: boolean
      config?: unknown
    }
    expect(renderArg.embedImages).toBe(false)
    // renderConfig 透传。
    expect(renderArg.config).toEqual(cc.renderConfig)

    // 替换后的 Markdown：原 src 不再出现，替换为 uploadContentImage 返回的微信 URL。
    const md = renderArg.markdown
    const wxUrl1 = `https://mmbiz.qpic.cn/uploaded/${encodeURIComponent('pic1.png')}.jpg`
    const wxUrl2 = `https://mmbiz.qpic.cn/uploaded/${encodeURIComponent('https://ex.com/pic2.png')}.jpg`
    expect(md).toContain(wxUrl1)
    expect(md).toContain(wxUrl2)
    // 原始相对路径已被替换掉（不再以 ](pic1.png) 形式出现）。
    expect(md).not.toContain('](pic1.png)')
    expect(md).not.toContain('](https://ex.com/pic2.png)')
    // 重复出现的图一两处都替换成同一个微信 URL。
    const occurrences = md.split(wxUrl1).length - 1
    expect(occurrences).toBe(2)
  })

  it('组装 DraftArticle：content=渲染HTML，thumb_media_id=封面mediaId，带 title/author/digest/source_url', async () => {
    const cc = makeChannelContent()
    await new WechatPublisher().publish({
      channelContent: cc,
      wechat: { appId: 'APPID', appSecret: 'SECRET' },
    })

    expect(addDraft).toHaveBeenCalledTimes(1)
    const [tokenArg, article] = (addDraft as any).mock.calls[0]
    expect(tokenArg).toBe('TKN')
    expect(article).toMatchObject({
      title: '标题',
      author: '李林',
      digest: '摘要',
      content: '<p>rendered</p>',
      thumb_media_id: 'THUMB_MID',
      content_source_url: 'https://lilink.top',
    })
  })

  it('无封面图时跳过 addPermanentImage，thumb_media_id 为空串', async () => {
    const cc = makeChannelContent({ coverImage: null })
    await new WechatPublisher().publish({
      channelContent: cc,
      wechat: { appId: 'APPID', appSecret: 'SECRET' },
    })

    expect(addPermanentImage).not.toHaveBeenCalled()
    const article = (addDraft as any).mock.calls[0][1]
    expect(article.thumb_media_id).toBe('')
  })

  it('封面字段为已 populate 的 Media 文档时，取其 url 上传', async () => {
    const cc = makeChannelContent({ coverImage: { id: 'm9', url: 'https://cdn.local/x.png', filename: 'x.png' } })
    await new WechatPublisher().publish({
      channelContent: cc,
      wechat: { appId: 'APPID', appSecret: 'SECRET' },
    })
    expect(addPermanentImage).toHaveBeenCalledWith('TKN', 'https://cdn.local/x.png')
  })

  it('正文无图片时不调 uploadContentImage，直接渲染原文', async () => {
    const cc = makeChannelContent({ bodyMarkdown: '只有文字，没有图片。' })
    await new WechatPublisher().publish({
      channelContent: cc,
      wechat: { appId: 'APPID', appSecret: 'SECRET' },
    })
    expect(uploadContentImage).not.toHaveBeenCalled()
    const renderArg = renderMock.mock.calls[0][0] as { markdown: string }
    expect(renderArg.markdown).toBe('只有文字，没有图片。')
  })

  it('publishers 注册表暴露 wechat 实例', () => {
    expect(publishers.wechat).toBeInstanceOf(WechatPublisher)
    expect(publishers.wechat.platform).toBe('wechat')
  })
})

// ===== endpoint 层：幂等拦截 / 鉴权 / 状态校验 / 成功回填 =====

// 构造一个最小 mock payload：findByID 返回给定文档，update 记录调用。
function makeMockPayload(doc: Record<string, unknown> | null) {
  return {
    findByID: vi.fn().mockResolvedValue(doc),
    update: vi.fn().mockResolvedValue(doc ?? {}),
  }
}

// 构造一个 endpoint req：带 payload / user / routeParams。
function makeReq(opts: {
  doc: Record<string, unknown> | null
  user?: unknown
  id?: string
  payload?: ReturnType<typeof makeMockPayload>
}) {
  const payload = opts.payload ?? makeMockPayload(opts.doc)
  return {
    payload,
    user: opts.user === undefined ? { id: 'user-1' } : opts.user,
    routeParams: { id: opts.id ?? 'cc1' },
  }
}

describe('publishEndpoint 幂等与守卫', () => {
  beforeEach(() => {
    vi.stubEnv('WX_APP_ID', 'APPID')
    vi.stubEnv('WX_APP_SECRET', 'SECRET')
  })

  it('幂等：publishResult.stage 已是 draft_created 时直接回包，不调微信、不写库', async () => {
    const doc = makeChannelContent({
      publishResult: { stage: 'draft_created', wxDraftMediaId: 'OLD_MID' },
    })
    const req = makeReq({ doc })

    const res = await publishEndpoint.handler(req as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, idempotent: true, stage: 'draft_created', draftMediaId: 'OLD_MID' })
    // 关键：幂等拦截后绝不再调 addDraft（也不调链路其它部分）。
    expect(addDraft).not.toHaveBeenCalled()
    expect(getAccessToken).not.toHaveBeenCalled()
    expect((req.payload.update as any)).not.toHaveBeenCalled()
  })

  it('未登录：返回 403，不查库', async () => {
    const req = makeReq({ doc: makeChannelContent(), user: null })
    const res = await publishEndpoint.handler(req as any)
    expect(res.status).toBe(403)
    expect((req.payload.findByID as any)).not.toHaveBeenCalled()
  })

  it('渠道稿不存在：返回 404', async () => {
    const req = makeReq({ doc: null })
    const res = await publishEndpoint.handler(req as any)
    expect(res.status).toBe(404)
  })

  it('状态非 approved（如 draft）：返回 409，不调微信', async () => {
    const doc = makeChannelContent({ status: 'draft' })
    const req = makeReq({ doc })
    const res = await publishEndpoint.handler(req as any)
    expect(res.status).toBe(409)
    expect(addDraft).not.toHaveBeenCalled()
  })

  it('缺少微信凭据：返回 500，不调微信', async () => {
    vi.stubEnv('WX_APP_ID', '')
    vi.stubEnv('WX_APP_SECRET', '')
    const req = makeReq({ doc: makeChannelContent() })
    const res = await publishEndpoint.handler(req as any)
    expect(res.status).toBe(500)
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('成功路径：发布后回填 publishResult 并把 status 经状态机置 published', async () => {
    const doc = makeChannelContent({ status: 'approved' })
    const payload = makeMockPayload(doc)
    const req = makeReq({ doc, payload })

    const res = await publishEndpoint.handler(req as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, stage: 'draft_created', draftMediaId: 'DRAFT_MID' })

    // 真正发布链路被触发。
    expect(addDraft).toHaveBeenCalledTimes(1)

    // update 至少两次：一次回填 publishResult，一次（由 applyTransition 触发）写 status。
    const updateCalls = (payload.update as any).mock.calls.map((c: any[]) => c[0])
    const resultWrite = updateCalls.find((d: any) => d?.data?.publishResult?.stage === 'draft_created')
    expect(resultWrite).toBeTruthy()
    expect(resultWrite.data.publishResult.wxDraftMediaId).toBe('DRAFT_MID')
    expect(typeof resultWrite.data.publishResult.publishedAt).toBe('string')

    const statusWrite = updateCalls.find((d: any) => d?.data?.status === 'published')
    expect(statusWrite).toBeTruthy()
  })

  it('发布失败：把错误写进 publishResult.lastError 并返回 500', async () => {
    // 让 addDraft 抛错模拟微信侧失败。
    ;(addDraft as any).mockRejectedValueOnce(new Error('新建草稿失败：标题超长'))
    const doc = makeChannelContent({ status: 'approved' })
    const payload = makeMockPayload(doc)
    const req = makeReq({ doc, payload })

    const res = await publishEndpoint.handler(req as any)
    expect(res.status).toBe(500)

    const updateCalls = (payload.update as any).mock.calls.map((c: any[]) => c[0])
    const errWrite = updateCalls.find((d: any) => d?.data?.publishResult?.lastError)
    expect(errWrite).toBeTruthy()
    expect(errWrite.data.publishResult.lastError).toContain('标题超长')
    // 失败时不应把 status 置 published。
    const statusWrite = updateCalls.find((d: any) => d?.data?.status === 'published')
    expect(statusWrite).toBeFalsy()
  })
})
