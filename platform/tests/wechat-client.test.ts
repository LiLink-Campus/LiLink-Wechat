import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken, clearTokenCache } from '../src/wechat/token'
import {
  addDraft,
  addPermanentImage,
  uploadContentImage,
  type DraftArticle,
} from '../src/wechat/client'
import { explainWxError } from '../src/wechat/errors'

// 构造一个返回指定 JSON 的 fetch mock 响应。
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response
}

// 每个用例独立：清掉 token 进程内缓存 + 重置 mock。
beforeEach(() => {
  clearTokenCache()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('getAccessToken', () => {
  it('正确构造 token 请求 URL（grant_type/appid/secret）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: 'TKN', expires_in: 7200 }))
    vi.stubGlobal('fetch', fetchMock)

    const token = await getAccessToken('APPID', 'SECRET')
    expect(token).toBe('TKN')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]))
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://api.weixin.qq.com/cgi-bin/token')
    expect(calledUrl.searchParams.get('grant_type')).toBe('client_credential')
    expect(calledUrl.searchParams.get('appid')).toBe('APPID')
    expect(calledUrl.searchParams.get('secret')).toBe('SECRET')
  })

  it('缓存命中：同一 appId 第二次取 token 不再发请求', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: 'TKN', expires_in: 7200 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await getAccessToken('APPID', 'SECRET')
    const second = await getAccessToken('APPID', 'SECRET')

    expect(first).toBe('TKN')
    expect(second).toBe('TKN')
    // 关键：只发了一次网络请求，第二次走缓存。
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('不同 appId 各自缓存，互不命中', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'TKN_A', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'TKN_B', expires_in: 7200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await getAccessToken('APP_A', 'S_A')).toBe('TKN_A')
    expect(await getAccessToken('APP_B', 'S_B')).toBe('TKN_B')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('提前 60s 过期：超过 expires_in-60s 后重新请求', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'OLD', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'NEW', expires_in: 7200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await getAccessToken('APPID', 'SECRET')).toBe('OLD')

    // 推进到 7140s（= 7200 - 60）之前一点，仍命中缓存。
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z').getTime() + (7200 - 61) * 1000)
    expect(await getAccessToken('APPID', 'SECRET')).toBe('OLD')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 推进到超过 7140s，缓存视为过期，重新请求拿到 NEW。
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z').getTime() + (7200 - 59) * 1000)
    expect(await getAccessToken('APPID', 'SECRET')).toBe('NEW')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('errcode 非 0 抛错（如 40013 appid 不合法）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ errcode: 40013, errmsg: 'invalid appid' })))
    await expect(getAccessToken('BAD', 'SECRET')).rejects.toThrow(/40013/)
  })

  it('响应缺少 access_token 时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ expires_in: 7200 })))
    await expect(getAccessToken('APPID', 'SECRET')).rejects.toThrow(/缺少 access_token/)
  })
})

describe('uploadContentImage', () => {
  it('正确构造 uploadimg 请求（URL/access_token/POST/media 字段）并返回 url', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ url: 'https://mmbiz.qpic.cn/x.jpg' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadContentImage('TKN', Buffer.from('fakeimg'))
    expect(result).toEqual({ url: 'https://mmbiz.qpic.cn/x.jpg' })

    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [URL | string, RequestInit]
    const u = new URL(String(calledUrl))
    expect(u.origin + u.pathname).toBe('https://api.weixin.qq.com/cgi-bin/media/uploadimg')
    expect(u.searchParams.get('access_token')).toBe('TKN')
    expect(init.method).toBe('POST')
    // body 是 FormData，且带 media 字段。
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).has('media')).toBe(true)
  })

  it('errcode 非 0 抛错（41005 缺少媒体数据）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ errcode: 41005, errmsg: 'empty media data' })))
    await expect(uploadContentImage('TKN', Buffer.from('x'))).rejects.toThrow(/41005/)
  })

  it('响应缺少 url 时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(uploadContentImage('TKN', Buffer.from('x'))).rejects.toThrow(/缺少 url/)
  })

  it('file 为 URL 时先 fetch 下载再上传（两次 fetch）', async () => {
    const fetchMock = vi
      .fn()
      // 第一次：下载远程图片。
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        // client 现在会校验下载响应的 Content-Type 必须是 image/*，mock 需带上。
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as unknown as Response)
      // 第二次：上传到微信。
      .mockResolvedValueOnce(jsonResponse({ url: 'https://mmbiz.qpic.cn/y.jpg' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadContentImage('TKN', 'https://example.com/cover.png?a=1')
    expect(result.url).toBe('https://mmbiz.qpic.cn/y.jpg')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // 第一次 fetch 的是原图 URL。
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('https://example.com/cover.png?a=1')
    // 第二次 fetch 的是微信上传端点。
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toContain('media/uploadimg')
  })

  it('SSRF 防护：拒绝内网/环回/保留地址的图片源，且不发起任何请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const blocked = [
      'http://127.0.0.1/a.png',
      'http://10.0.0.5/a.png',
      'http://192.168.1.1/a.png',
      'http://169.254.169.254/latest/meta-data', // 云元数据端点
      'http://localhost/a.png',
      'http://2130706433/a.png', // 十进制整数 IP
      'http://[::1]/a.png',
      'http://[fe90::1]/a.png', // fe80::/10 整段（不止 fe80::）
      'http://[fd12::1]/a.png', // fc00::/7 唯一本地
      'http://[::ffff:127.0.0.1]/a.png', // IPv4-mapped IPv6
    ]
    for (const url of blocked) {
      await expect(uploadContentImage('TKN', url)).rejects.toThrow(/内网|环回|拒绝/)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('SSRF 防护：拒绝 IPv6 内嵌 IPv4 / NAT64 绕过（高位全 0 的嵌入式 IPv4 不得放行）', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const blocked = [
      'http://[::127.0.0.1]/a.png', // IPv4-compatible IPv6 → 环回（归一为 [::7f00:1]）
      'http://[::10.0.0.1]/a.png', // IPv4-compatible → 私网 10/8
      'http://[::192.168.1.1]/a.png', // IPv4-compatible → 私网 192.168/16
      'http://[64:ff9b::7f00:1]/a.png', // NAT64（RFC 6052）→ 内嵌 127.0.0.1（十六进制段写法）
      'http://[64:ff9b::127.0.0.1]/a.png', // NAT64 → 内嵌 127.0.0.1（点分写法）
      'http://[::ffff:7f00:1]/a.png', // IPv4-mapped 的十六进制段写法 → 127.0.0.1
    ]
    for (const url of blocked) {
      await expect(uploadContentImage('TKN', url)).rejects.toThrow(/内网|环回|拒绝/)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('不误拦合法公网 IPv6（低 32 位恰好像内网 IPv4，但非 mapped/compatible/NAT64 前缀）', async () => {
    // 回归：embeddedIPv4 不能对任意 IPv6 都抽末两段 hex——否则公网 IPv6 末尾恰为 :7f00:1
    //（=127.0.0.1）会被误判内嵌环回而拒发。只有 ::/96、::ffff:0:0/96、64:ff9b::/96 前缀
    // 才是真正内嵌 IPv4 的写法。
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as unknown as Response)
      .mockResolvedValueOnce(jsonResponse({ url: 'https://mmbiz.qpic.cn/ip6.jpg' }))
    vi.stubGlobal('fetch', fetchMock)

    // 2001:db8:: 文档示例段（公网可路由形态），低位 7f00:1 看起来像 127.0.0.1，但高位非全 0、
    // 非 ::ffff:、非 64:ff9b: —— 不是内嵌 IPv4，应放行。
    const result = await uploadContentImage('TKN', 'http://[2001:db8::7f00:1]/pic.png')
    expect(result.url).toBe('https://mmbiz.qpic.cn/ip6.jpg')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('放行合法公网域名（fc/fd 开头域名如 fcdn.* 不被 IPv6 规则误拦）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as unknown as Response)
      .mockResolvedValueOnce(jsonResponse({ url: 'https://mmbiz.qpic.cn/z.jpg' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadContentImage('TKN', 'https://fcdn.example.com/pic.png')
    expect(result.url).toBe('https://mmbiz.qpic.cn/z.jpg')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('addPermanentImage', () => {
  it('正确构造 add_material 请求（type=image 在 query）并返回 mediaId/url', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ media_id: 'MID', url: 'https://mmbiz.qpic.cn/cover.jpg' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await addPermanentImage('TKN', Buffer.from('cover'))
    expect(result).toEqual({ mediaId: 'MID', url: 'https://mmbiz.qpic.cn/cover.jpg' })

    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [URL | string, RequestInit]
    const u = new URL(String(calledUrl))
    expect(u.origin + u.pathname).toBe('https://api.weixin.qq.com/cgi-bin/material/add_material')
    expect(u.searchParams.get('access_token')).toBe('TKN')
    expect(u.searchParams.get('type')).toBe('image')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).has('media')).toBe(true)
  })

  it('errcode 非 0 抛错（40004 媒体类型不合法）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ errcode: 40004, errmsg: 'invalid media type' })))
    await expect(addPermanentImage('TKN', Buffer.from('x'))).rejects.toThrow(/40004/)
  })

  it('响应缺少 media_id 时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ url: 'https://x' })))
    await expect(addPermanentImage('TKN', Buffer.from('x'))).rejects.toThrow(/缺少 media_id/)
  })
})

describe('addDraft', () => {
  const article: DraftArticle = {
    title: '测试标题',
    author: '李林',
    digest: '摘要',
    content: '<p>正文</p>',
    thumb_media_id: 'MID',
    content_source_url: 'https://example.com',
    need_open_comment: 1,
  }

  it('正确构造 draft/add 请求（JSON body 包成 articles 数组）并返回 mediaId', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ media_id: 'DRAFT_MID' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await addDraft('TKN', article)
    expect(result).toEqual({ mediaId: 'DRAFT_MID' })

    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [URL | string, RequestInit]
    const u = new URL(String(calledUrl))
    expect(u.origin + u.pathname).toBe('https://api.weixin.qq.com/cgi-bin/draft/add')
    expect(u.searchParams.get('access_token')).toBe('TKN')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')

    // body 是 JSON 字符串，articles[0] 等于传入的 article。
    const parsed = JSON.parse(String(init.body))
    expect(Array.isArray(parsed.articles)).toBe(true)
    expect(parsed.articles).toHaveLength(1)
    expect(parsed.articles[0]).toEqual(article)
  })

  it('errcode 非 0 抛错（45003 标题超长）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ errcode: 45003, errmsg: 'title too long' })))
    await expect(addDraft('TKN', article)).rejects.toThrow(/45003/)
  })

  it('响应缺少 media_id 时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(addDraft('TKN', article)).rejects.toThrow(/缺少 media_id/)
  })
})

describe('explainWxError', () => {
  it('覆盖常见码并带码号', () => {
    expect(explainWxError(40001)).toContain('40001')
    expect(explainWxError(40164)).toContain('白名单')
    expect(explainWxError(45009)).toContain('频率')
    expect(explainWxError(45003)).toContain('标题')
    expect(explainWxError(53404)).toContain('限制')
  })

  it('未知码返回带原始码的通用提示', () => {
    const msg = explainWxError(99999)
    expect(msg).toContain('99999')
    expect(msg).toContain('未知错误码')
  })
})
