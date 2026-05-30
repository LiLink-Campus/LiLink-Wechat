import './force-ipv4'
import { explainWxError } from './errors'

// 微信 access_token 接口返回结构。
interface WxTokenResponse {
  access_token?: string
  expires_in?: number
  errcode?: number
  errmsg?: string
}

// 内存缓存：以 appId 为 key 缓存 token 及其绝对过期时间（毫秒时间戳）。
// 同一进程内多次取同一公众号的 token 走缓存，避免触发 45009 超频。
// 注意：这是进程内缓存，多实例部署时各自维护，第一期单实例够用。
interface CachedToken {
  token: string
  // 绝对过期时间戳（ms）。已扣掉提前刷新窗口，到点即视为过期。
  expiresAt: number
}

const tokenCache = new Map<string, CachedToken>()

// 微信返回的 expires_in 通常是 7200s。提前 60s 刷新，避免边界时刻拿到刚好失效的 token。
const REFRESH_AHEAD_MS = 60 * 1000

/**
 * 获取公众号 access_token，带进程内缓存。
 * - 命中未过期缓存：直接返回，不发请求。
 * - 未命中 / 已过期：请求微信，写入缓存（过期时间 = now + expires_in*1000 - 60s）。
 * @param appId 公众号 AppID
 * @param secret 公众号 AppSecret
 */
export async function getAccessToken(appId: string, secret: string): Promise<string> {
  const cached = tokenCache.get(appId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token
  }

  const url = new URL('https://api.weixin.qq.com/cgi-bin/token')
  url.searchParams.set('grant_type', 'client_credential')
  url.searchParams.set('appid', appId)
  url.searchParams.set('secret', secret)

  // 显式超时：token 接口无响应时不无限挂起（与三个内容接口一致，见 client.ts wxFetch）。
  // 30s 远小于发布锁 TTL（10min），不会因取 token 慢触发锁误判。
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30_000)
  let res: Response
  try {
    res = await fetch(url, { method: 'GET', signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
  const data = (await res.json()) as WxTokenResponse

  // 取 token 失败时 errcode 非 0（如 40013 appid 错、40125 secret 错、40164 IP 白名单）。
  if (data.errcode) {
    throw new Error(`获取 access_token 失败：${explainWxError(data.errcode)}（errmsg: ${data.errmsg ?? ''}）`)
  }
  if (!data.access_token || !data.expires_in) {
    throw new Error('获取 access_token 失败：响应缺少 access_token 或 expires_in')
  }

  const expiresAt = Date.now() + data.expires_in * 1000 - REFRESH_AHEAD_MS
  tokenCache.set(appId, { token: data.access_token, expiresAt })
  return data.access_token
}

/**
 * 清空 token 缓存。主要给测试用，也可在确认 token 失效（如收到 40001）后手动调用强制刷新。
 * 不传 appId 清全部，传则只清该公众号。
 */
export function clearTokenCache(appId?: string): void {
  if (appId) tokenCache.delete(appId)
  else tokenCache.clear()
}
