import './force-ipv4'
import { basename } from 'node:path'
import { isIP } from 'node:net'
import { explainWxError } from './errors'

// 建草稿时单篇图文的结构。字段对齐微信 draft/add 接口的 article 对象。
// 第一期只发单图文，所以上层每次构造一个 DraftArticle 即可。
export interface DraftArticle {
  // 标题，最长 64 字（超长微信报 45003）。
  title: string
  // 作者（可选）。
  author?: string
  // 摘要（可选）。留空时微信会自动从正文截取。
  digest?: string
  // 正文 HTML。图片需先经 uploadContentImage 换成微信域名 URL 再嵌进来。
  content: string
  // 封面图的永久素材 media_id，由 addPermanentImage 返回。
  thumb_media_id: string
  // 原文链接（可选），即「阅读原文」跳转地址。
  content_source_url?: string
  // 是否打开评论：1 打开，0 不打开（可选）。
  need_open_comment?: number
}

// file 入参形态：内存 Buffer 或 http(s) 图片 URL（字符串）。
// 安全约束：不再支持本地文件路径（曾可被用户可控的 markdown 图片 src 如
// ![](/etc/passwd) 利用读取服务器本地文件）—— 见 toBlobPart。
export type WxFileInput = Buffer | string

// 微信上传/草稿接口的通用响应骨架，各接口在此基础上扩展自己的字段。
interface WxBaseResponse {
  errcode?: number
  errmsg?: string
}

interface WxUploadImgResponse extends WxBaseResponse {
  // uploadimg 只返回 url（正文图，非永久素材，无 media_id）。
  url?: string
}

interface WxAddMaterialResponse extends WxBaseResponse {
  media_id?: string
  url?: string
}

interface WxAddDraftResponse extends WxBaseResponse {
  media_id?: string
}

// 判断一个点分 IPv4 是否落在内网/环回/链路本地/CGNAT/通配保留段。
// 入参须已是规范点分四段（如 '127.0.0.1'）。非法/越界保守判为 true（拒绝）。
function isBlockedIPv4(dotted: string): boolean {
  const p = dotted.split('.').map((n) => Number(n))
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  if (a === 0 || a === 127 || a === 10) return true // 通配 / 环回 / 私有 10/8
  if (a === 169 && b === 254) return true // 链路本地 169.254/16（含云元数据 169.254.169.254）
  if (a === 192 && b === 168) return true // 私有 192.168/16
  if (a === 172 && b >= 16 && b <= 31) return true // 私有 172.16/12
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  return false
}

// 仅这三类前缀才是「内嵌 IPv4」的 IPv6 写法（其低 32 位才代表一个 IPv4 地址）：
//   - IPv4-mapped       ::ffff:a.b.c.d        （URL 归一为 ::ffff:HHHH:HHHH）
//   - IPv4-compatible   ::a.b.c.d（高位全 0） （URL 归一为 ::HHHH:HHHH）—— 旧绕过点
//   - NAT64             64:ff9b::a.b.c.d      （RFC 6052，URL 归一为 64:ff9b::HHHH:HHHH）
// 关键（codex review Medium）：必须先确认前缀属于上述之一，才把末 32 位解析成 IPv4。否则
// 任意公网 IPv6 只要低 32 位形如内网（如 2001:db8::7f00:1 末段 = 127.0.0.1）就会被误拦。
function hasEmbeddedIPv4Prefix(h: string): boolean {
  // ::ffff:* 或 ::（全零高位，compatible，形如 ::X:Y 或 ::a.b.c.d，但排除 ::1 / ::）
  if (h.startsWith('::ffff:')) return true
  if (h.startsWith('64:ff9b:')) return true
  // IPv4-compatible：以 :: 开头且其后还有内容（::X:Y / ::a.b.c.d）。::1、:: 已在调用前单独处理。
  if (h.startsWith('::') && h !== '::') return true
  return false
}

// 把符合内嵌前缀的 IPv6 字面量里的 IPv4 还原成点分字符串；不符合或无法解析返回 undefined。
// 仅在 hasEmbeddedIPv4Prefix(h) 为真时调用才有意义。
function embeddedIPv4(h: string): string | undefined {
  if (!hasEmbeddedIPv4Prefix(h)) return undefined
  // 末段已是点分 IPv4（如 ::ffff:127.0.0.1、64:ff9b::10.0.0.1）。
  const dotted = h.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (dotted) return dotted[1]
  // 末尾两段十六进制（如 ::7f00:1、::ffff:7f00:1、64:ff9b::7f00:1）→ 拼 32 位还原点分。
  const hex = h.match(/:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const hi = parseInt(hex[1], 16)
    const lo = parseInt(hex[2], 16)
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
    }
  }
  return undefined
}

// 拒绝指向内网/环回/链路本地/保留地址的 host，防 SSRF（图片 URL 可由已认证作者控制）。
// 处理 IPv6 字面量方括号、IPv4-mapped / IPv4-compatible / NAT64 内嵌 IPv4、点分 IPv4 各保留段、
// 通配与纯数字主机名。合法图片应来自公网云对象存储(OSS/COS/R2 等公网域名)。
// 注意：不做 DNS 解析，故无法防 DNS 重绑定（域名解析到内网 IP）——第一期可接受，已知限制。
function isBlockedHost(hostnameRaw: string): boolean {
  let h = hostnameRaw.toLowerCase().trim()
  // URL.hostname 对 IPv6 字面量返回带方括号形式（如 [::1]）——剥掉再判。
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)

  if (h === 'localhost' || h.endsWith('.localhost')) return true
  // 纯数字主机名（十进制整数 IP，如 2130706433）：非常规，保守拒绝。
  if (/^\d+$/.test(h)) return true

  // 点分 IPv4：环回/私有/链路本地/CGNAT/通配。
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) {
    return isBlockedIPv4(h)
  }

  // IPv6 字面量才判 IPv6 规则——用 net.isIP 确认，避免把 fcdn.com / fd-xx.com 等合法域名误判。
  if (isIP(h) === 6) {
    if (h === '::' || h === '::1') return true // 通配 / 环回
    // 内嵌 IPv4（mapped / compatible / NAT64）：还原成点分后复用 IPv4 私网判定。
    // 这堵住了高位全 0（:: 开头）的 IPv4-compatible 与 NAT64 绕过——它们曾被直接放行。
    const v4 = embeddedIPv4(h)
    if (v4) return isBlockedIPv4(v4)
    // NAT64 前缀 64:ff9b::/96（即便末段未匹配出 IPv4，也保守拒绝整个 NAT64 段）。
    if (h.startsWith('64:ff9b:')) return true
    // 纯 IPv6：判链路本地 fe80::/10、唯一本地 fc00::/7。
    const first = h.split(':')[0]
    if (first) {
      const vv = parseInt(first, 16)
      if (Number.isFinite(vv)) {
        if ((vv & 0xffc0) === 0xfe80) return true // fe80::/10 链路本地（覆盖 fe80–febf）
        if ((vv & 0xfe00) === 0xfc00) return true // fc00::/7 唯一本地（覆盖 fc00–fdff）
      }
    }
    return false
  }

  return false
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10MB 上限，防超大响应耗内存。
const FETCH_TIMEOUT_MS = 10_000

// 微信 API 调用超时：30s。远小于发布锁 TTL（见 endpoints/publishLock，默认 10min），故正常发布
// 不会因单次接口慢触发锁误判过期；微信侧无响应时也不会无限挂起（abort 抛错→上层释放锁、可重试）。
const WX_API_TIMEOUT_MS = 30_000

// 给微信 API 调用包一层显式超时（AbortController）。三个上传/草稿接口共用，避免微信无响应时
// 请求永久挂起、长时间占住发布锁（codex review High：发布链路 fetch 须有超时且 < 锁 TTL）。
// 关键（codex review Medium）：超时必须同时覆盖 res.json() —— 若只在 fetch() resolve 后即清
// timer，微信「发回 headers 后卡住 body」时 res.json() 仍会无限挂起。故把 body 解析也纳入
// 同一 abort 窗口：解析完再清 timer。
async function wxFetchJson<T>(url: URL, init: RequestInit): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), WX_API_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

// 安全地把图片 URL 取成 Buffer：限协议 + 拦内网 + 禁重定向 + 超时 + 大小上限 + Content-Type 校验。
async function fetchImageBuffer(rawUrl: string): Promise<{ buf: Buffer; filename: string }> {
  const u = new URL(rawUrl)
  // 错误信息只用 origin+pathname，去掉 query —— presigned URL 的 ?X-Amz-Signature=... 不应
  // 写进 publishResult.lastError / HTTP 响应 / 日志（codex review Medium）。
  const safeUrl = u.origin + u.pathname
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`不支持的图片协议：${u.protocol}`)
  }
  if (isBlockedHost(u.hostname)) {
    throw new Error(`拒绝访问内网/环回地址的图片源：${u.hostname}`)
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    // redirect:'error' 防经 3xx 重定向绕过上面的内网拦截。
    const res = await fetch(u, { signal: ctrl.signal, redirect: 'error' })
    if (!res.ok) {
      throw new Error(`下载图片失败：${safeUrl}（HTTP ${res.status}）`)
    }
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.toLowerCase().startsWith('image/')) {
      throw new Error(`图片源 Content-Type 非 image/*：${ct || '(空)'}`)
    }
    // 先按声明的 Content-Length 提前拒绝超大响应，避免完整缓冲后才发现耗内存。
    // 缺失/撒谎时由下面 arrayBuffer 后的 byteLength 兜底。
    const declaredLen = Number(res.headers.get('content-length') ?? '')
    if (Number.isFinite(declaredLen) && declaredLen > MAX_IMAGE_BYTES) {
      throw new Error(`图片过大（Content-Length ${declaredLen} > ${MAX_IMAGE_BYTES}）：${safeUrl}`)
    }
    const ab = await res.arrayBuffer()
    if (ab.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`图片过大（>${MAX_IMAGE_BYTES} 字节）：${safeUrl}`)
    }
    const name = basename(u.pathname) || 'image.jpg'
    return { buf: Buffer.from(ab), filename: name }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 把 file 入参统一成 { blob, filename }，供 FormData 使用。
 * 只接受：内存 Buffer，或 http(s) 图片 URL（经 fetchImageBuffer 安全下载）。
 * **不再支持本地文件路径**——历史上把任意字符串当本地路径 readFile 会被用户可控的
 * markdown 图片 src（如 ![](/etc/passwd)）利用读取服务器本地文件（LFI）。
 */
async function toBlobPart(file: WxFileInput): Promise<{ blob: Blob; filename: string }> {
  if (Buffer.isBuffer(file)) {
    // Buffer 的底层是 ArrayBuffer，包成 Uint8Array 再给 Blob，类型在 @types/node 下可接受。
    return { blob: new Blob([new Uint8Array(file)]), filename: 'image.jpg' }
  }
  if (typeof file === 'string' && /^https?:\/\//i.test(file)) {
    const { buf, filename } = await fetchImageBuffer(file)
    return { blob: new Blob([new Uint8Array(buf)]), filename }
  }
  // 非 Buffer、非 http(s) URL（含本地路径）一律拒绝。
  throw new Error(`不支持的图片来源（仅接受 Buffer 或 http(s) URL）：${String(file)}`)
}

/**
 * 上传图文消息内的图片（正文图）。
 * 不占用永久素材额度，仅返回可内嵌正文的微信域名 URL。
 * @param token access_token
 * @param file Buffer 或 http(s) 图片 URL（不再支持本地路径）
 */
export async function uploadContentImage(token: string, file: WxFileInput): Promise<{ url: string }> {
  const { blob, filename } = await toBlobPart(file)
  const form = new FormData()
  // 字段名固定为 media。
  form.append('media', blob, filename)

  const url = new URL('https://api.weixin.qq.com/cgi-bin/media/uploadimg')
  url.searchParams.set('access_token', token)

  const data = await wxFetchJson<WxUploadImgResponse>(url, { method: 'POST', body: form })

  if (data.errcode) {
    throw new Error(`上传正文图失败：${explainWxError(data.errcode)}（errmsg: ${data.errmsg ?? ''}）`)
  }
  if (!data.url) {
    throw new Error('上传正文图失败：响应缺少 url')
  }
  return { url: data.url }
}

/**
 * 上传永久图片素材（用作封面图）。
 * 占用永久素材额度，返回 media_id（建草稿时填 thumb_media_id）和预览 url。
 * @param token access_token
 * @param file Buffer 或 http(s) 图片 URL（不再支持本地路径）
 */
export async function addPermanentImage(
  token: string,
  file: WxFileInput,
): Promise<{ mediaId: string; url: string }> {
  const { blob, filename } = await toBlobPart(file)
  const form = new FormData()
  form.append('media', blob, filename)

  const url = new URL('https://api.weixin.qq.com/cgi-bin/material/add_material')
  url.searchParams.set('access_token', token)
  // type 走 query，固定 image。
  url.searchParams.set('type', 'image')

  const data = await wxFetchJson<WxAddMaterialResponse>(url, { method: 'POST', body: form })

  if (data.errcode) {
    throw new Error(`上传封面永久素材失败：${explainWxError(data.errcode)}（errmsg: ${data.errmsg ?? ''}）`)
  }
  if (!data.media_id || !data.url) {
    throw new Error('上传封面永久素材失败：响应缺少 media_id 或 url')
  }
  return { mediaId: data.media_id, url: data.url }
}

/**
 * 新建图文草稿。
 * body 为 JSON：{ articles: [article] }。第一期只发单篇，故数组只放一个。
 * 成功返回草稿 media_id，可用于后续发布/群发。
 * @param token access_token
 * @param article 单篇图文内容
 */
export async function addDraft(token: string, article: DraftArticle): Promise<{ mediaId: string }> {
  const url = new URL('https://api.weixin.qq.com/cgi-bin/draft/add')
  url.searchParams.set('access_token', token)

  const data = await wxFetchJson<WxAddDraftResponse>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 微信对中文不接受被 ASCII 转义？实际接受 UTF-8 JSON，这里正常 stringify 即可。
    body: JSON.stringify({ articles: [article] }),
  })

  if (data.errcode) {
    throw new Error(`新建草稿失败：${explainWxError(data.errcode)}（errmsg: ${data.errmsg ?? ''}）`)
  }
  if (!data.media_id) {
    throw new Error('新建草稿失败：响应缺少 media_id')
  }
  return { mediaId: data.media_id }
}
