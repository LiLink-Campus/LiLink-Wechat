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
  // 正文图：按入参（原图 URL）返回一个可区分的微信 URL，便于断言"哪张图换成了哪个 URL"。
  uploadContentImage: vi.fn(async (_token: string, file: unknown) => ({
    url: `https://mmbiz.qpic.cn/uploaded/${encodeURIComponent(String(file))}.jpg`,
  })),
  addDraft: vi.fn(async () => ({ mediaId: 'DRAFT_MID' })),
}))

// mock lexical-to-wechat 的 renderToInlineHtml：
// 用 vi.hoisted 定义 renderMock —— vi.mock 工厂被提升到文件顶端，普通 top-level 变量
// 在工厂运行时尚未初始化（报 Cannot access before initialization）；hoisted 块同被提升故可用。
// 行为：遍历传入 Lexical body 的 upload 节点，按 doc.url 产出 <img src="原url" /> —— 这样
// 发布器随后用「原url→微信url」映射做 HTML src 替换的逻辑才能被真实验证。
const { renderMock } = vi.hoisted(() => ({
  renderMock: vi.fn(
    (
      data: unknown,
      opts?: { ctaUrl?: string; ctaText?: string; noCta?: boolean; imageUrlMap?: Map<string, string> },
    ): string => {
      const imgs: string[] = []
      const root = (data as { root?: { children?: unknown } } | null | undefined)?.root
      const walk = (nodes: unknown): void => {
        if (!Array.isArray(nodes)) return
        for (const raw of nodes) {
          if (!raw || typeof raw !== 'object') continue
          const node = raw as Record<string, unknown>
          if (node.type === 'upload') {
            const doc = node.value as { url?: string; mimeType?: string } | undefined
            // 非图片(如 pdf)：真实转换层降级为 <a>、不产 <img>；这里跳过，避免误判 badImg。
            if (doc?.url && !(doc.mimeType && !doc.mimeType.startsWith('image'))) {
              // 模拟真实转换层：有 imageUrlMap 则输出映射后的微信 URL（与 publisher 实际行为一致）。
              const finalUrl = opts?.imageUrlMap?.get(doc.url) ?? doc.url
              imgs.push(`<img src="${finalUrl}" alt="" />`)
            }
            continue
          }
          if (Array.isArray(node.children)) walk(node.children)
        }
      }
      walk(root?.children)
      return `<section><p>rendered</p>${imgs.join('')}</section>`
    },
  ),
}))
vi.mock('../src/renderers/lexical-to-wechat', () => ({
  renderToInlineHtml: renderMock,
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

// 文本叶子节点工厂。
const text = (t: string) => ({
  type: 'text',
  text: t,
  format: 0,
  detail: 0,
  mode: 'normal',
  style: '',
  version: 1,
})

// 上传图片节点工厂（value 为已 populate 的 media 文档，含 url）。
const uploadImage = (url: string, alt = '配图') => ({
  type: 'upload',
  relationTo: 'media',
  version: 1,
  format: '',
  fields: { alt },
  value: {
    id: url,
    url,
    alt,
    width: 900,
    height: 600,
    mimeType: 'image/png',
    filename: 'x.png',
  },
})

// 构造一份典型 Lexical 正文 body：含两张不同正文图，其中图一重复出现一次（验去重只传一次），
// 并夹一个非图片(附件)的 upload 节点（验只上传 image/* 正文图）。
function makeBody() {
  return {
    root: {
      type: 'root',
      direction: 'ltr',
      format: '',
      indent: 0,
      version: 1,
      children: [
        { type: 'paragraph', direction: 'ltr', format: '', indent: 0, version: 1, children: [text('开头')] },
        uploadImage('https://cdn.local/pic1.png', '图一'),
        { type: 'paragraph', direction: 'ltr', format: '', indent: 0, version: 1, children: [text('中间')] },
        uploadImage('https://ex.com/pic2.png', '图二'),
        // 非图片资源：不应被上传为正文图。
        {
          type: 'upload',
          relationTo: 'media',
          version: 1,
          format: '',
          fields: {},
          value: { id: 'f1', url: 'https://cdn.local/doc.pdf', mimeType: 'application/pdf', filename: 'doc.pdf' },
        },
        // 图一再次出现（嵌在 list/listitem 内，验证递归遍历也能命中、且去重）。
        {
          type: 'list',
          tag: 'ul',
          listType: 'bullet',
          start: 1,
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1,
          children: [
            {
              type: 'listitem',
              value: 1,
              direction: 'ltr',
              format: '',
              indent: 0,
              version: 1,
              children: [uploadImage('https://cdn.local/pic1.png', '又是图一')],
            },
          ],
        },
        { type: 'paragraph', direction: 'ltr', format: '', indent: 0, version: 1, children: [text('结尾')] },
      ],
    },
  }
}

// 一份典型渠道稿：含封面 + Lexical 正文 body。
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
    body: makeBody(),
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

    // 正文图：两张不同图各传一次（pic1.png 重复出现只上传一次；pdf 非图片不传）。
    expect(uploadContentImage).toHaveBeenCalledTimes(2)
    const uploadedSrcs = (uploadContentImage as any).mock.calls.map((c: unknown[]) => c[1])
    expect(uploadedSrcs).toEqual(['https://cdn.local/pic1.png', 'https://ex.com/pic2.png'])
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

  it('以 Lexical body 调 renderToInlineHtml（透传 renderConfig），再把 HTML 里图片 src 换成微信 URL', async () => {
    const cc = makeChannelContent()
    await new WechatPublisher().publish({
      channelContent: cc,
      wechat: { appId: 'APPID', appSecret: 'SECRET' },
    })

    // 渲染只被调一次，且第一参是 Lexical body 本身。
    expect(renderMock).toHaveBeenCalledTimes(1)
    const [bodyArg, optsArg] = renderMock.mock.calls[0]
    expect(bodyArg).toBe(cc.body)
    // renderConfig 经摊平透传（ctaUrl / noCta）。
    expect(optsArg).toMatchObject({ ctaUrl: 'https://lilink.top', noCta: false })

    // 建草稿用的 content：原图 src 全部替换成微信 URL，且原 URL 不再出现。
    const article = (addDraft as any).mock.calls[0][1]
    const wxUrl1 = `https://mmbiz.qpic.cn/uploaded/${encodeURIComponent('https://cdn.local/pic1.png')}.jpg`
    const wxUrl2 = `https://mmbiz.qpic.cn/uploaded/${encodeURIComponent('https://ex.com/pic2.png')}.jpg`
    expect(article.content).toContain(`src="${wxUrl1}"`)
    expect(article.content).toContain(`src="${wxUrl2}"`)
    expect(article.content).not.toContain('src="https://cdn.local/pic1.png"')
    expect(article.content).not.toContain('src="https://ex.com/pic2.png"')
    // 重复出现的图一两处都替换成同一个微信 URL（mock 为每个 upload 节点各产一个 img，
    // 图一出现两次 → 两个 img → 都换成 wxUrl1）。
    const occurrences = article.content.split(`src="${wxUrl1}"`).length - 1
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
      thumb_media_id: 'THUMB_MID',
      content_source_url: 'https://lilink.top',
    })
    // content 是渲染产物（含 rendered 标记 + 替换后的图片）。
    expect(article.content).toContain('rendered')
  })

  it('无封面图时 preflight 报错（公众号草稿必须有封面），不建草稿', async () => {
    const cc = makeChannelContent({ coverImage: null })
    await expect(
      new WechatPublisher().publish({
        channelContent: cc,
        wechat: { appId: 'APPID', appSecret: 'SECRET' },
      }),
    ).rejects.toThrow(/封面/)
    expect(addPermanentImage).not.toHaveBeenCalled()
    expect(addDraft).not.toHaveBeenCalled()
  })

  it('封面字段为已 populate 的 Media 文档时，取其 url 上传', async () => {
    const cc = makeChannelContent({ coverImage: { id: 'm9', url: 'https://cdn.local/x.png', filename: 'x.png' } })
    await new WechatPublisher().publish({
      channelContent: cc,
      wechat: { appId: 'APPID', appSecret: 'SECRET' },
    })
    expect(addPermanentImage).toHaveBeenCalledWith('TKN', 'https://cdn.local/x.png')
  })

  it('正文无图片时不调 uploadContentImage，直接以 body 渲染', async () => {
    const emptyBody = {
      root: {
        type: 'root',
        direction: 'ltr',
        format: '',
        indent: 0,
        version: 1,
        children: [
          { type: 'paragraph', direction: 'ltr', format: '', indent: 0, version: 1, children: [text('只有文字，没有图片。')] },
        ],
      },
    }
    const cc = makeChannelContent({ body: emptyBody })
    await new WechatPublisher().publish({
      channelContent: cc,
      wechat: { appId: 'APPID', appSecret: 'SECRET' },
    })
    expect(uploadContentImage).not.toHaveBeenCalled()
    // 仍以该 body 调了渲染。
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(renderMock.mock.calls[0][0]).toBe(emptyBody)
  })

  it('body 为空 / 缺失时不崩，按空 body 渲染、不传图', async () => {
    const cc = makeChannelContent({ body: null })
    const result = await new WechatPublisher().publish({
      channelContent: cc,
      wechat: { appId: 'APPID', appSecret: 'SECRET' },
    })
    expect(result.stage).toBe('draft_created')
    expect(uploadContentImage).not.toHaveBeenCalled()
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(renderMock.mock.calls[0][0]).toBeNull()
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

  it('幂等（三态一致）：status=published + stage=draft_created + 有 mediaId 时直接回包，不调微信、不写库', async () => {
    const doc = makeChannelContent({
      status: 'published',
      publishResult: { stage: 'draft_created', wxDraftMediaId: 'OLD_MID' },
    })
    const req = makeReq({ doc })

    const res = await publishEndpoint.handler(req as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, idempotent: true, stage: 'draft_created', draftMediaId: 'OLD_MID' })
    // 三态一致＝彻底发完，幂等拦截后绝不再调微信、不写库。
    expect(addDraft).not.toHaveBeenCalled()
    expect(getAccessToken).not.toHaveBeenCalled()
    expect((req.payload.update as any)).not.toHaveBeenCalled()
  })

  it('局部失败修复：stage=draft_created 但 status 未到 published 时，不重复建草稿，只补状态流转', async () => {
    // 上次建完草稿后回填/流转中断，状态停在 approved + draft_created。
    const doc = makeChannelContent({
      status: 'approved',
      publishResult: { stage: 'draft_created', wxDraftMediaId: 'OLD_MID' },
    })
    const payload = makeMockPayload(doc)
    const req = makeReq({ doc, payload })

    const res = await publishEndpoint.handler(req as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, idempotent: true, draftMediaId: 'OLD_MID' })
    // 关键：绝不重复建草稿、不重新取 token。
    expect(addDraft).not.toHaveBeenCalled()
    expect(getAccessToken).not.toHaveBeenCalled()
    // 但补做了到 published 的状态流转（applyTransition → payload.update 写 status）。
    const statusWrite = (payload.update as any).mock.calls
      .map((c: any[]) => c[0])
      .find((d: any) => d?.data?.status === 'published')
    expect(statusWrite).toBeTruthy()
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
