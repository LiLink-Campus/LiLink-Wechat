import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
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

// file 入参的三种形态：内存 Buffer / 本地文件路径 / 远程 URL。
// 用 string 同时承载「本地路径」和「URL」，靠是否以 http(s):// 开头区分。
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

/**
 * 把多形态的 file 入参统一成 { blob, filename }，供 FormData 使用。
 * - Buffer：直接包成 Blob，文件名兜底为 image.jpg（微信靠 type=image 而非扩展名判断）。
 * - URL（http/https 开头）：先 fetch 成 ArrayBuffer，文件名取 URL 路径末段。
 * - 本地路径：读盘成 Buffer，文件名取路径末段。
 */
async function toBlobPart(file: WxFileInput): Promise<{ blob: Blob; filename: string }> {
  if (Buffer.isBuffer(file)) {
    // Buffer 的底层是 ArrayBuffer，包成 Uint8Array 再给 Blob，类型在 @types/node 下可接受。
    return { blob: new Blob([new Uint8Array(file)]), filename: 'image.jpg' }
  }

  if (/^https?:\/\//i.test(file)) {
    const res = await fetch(file)
    if (!res.ok) {
      throw new Error(`下载图片失败：${file}（HTTP ${res.status}）`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    // 去掉 URL query/hash，取路径末段作文件名；取不到就兜底。
    const pathname = new URL(file).pathname
    const name = basename(pathname) || 'image.jpg'
    return { blob: new Blob([new Uint8Array(buf)]), filename: name }
  }

  // 视为本地文件路径。
  const buf = await readFile(file)
  return { blob: new Blob([new Uint8Array(buf)]), filename: basename(file) || 'image.jpg' }
}

/**
 * 上传图文消息内的图片（正文图）。
 * 不占用永久素材额度，仅返回可内嵌正文的微信域名 URL。
 * @param token access_token
 * @param file Buffer / 本地路径 / 图片 URL
 */
export async function uploadContentImage(token: string, file: WxFileInput): Promise<{ url: string }> {
  const { blob, filename } = await toBlobPart(file)
  const form = new FormData()
  // 字段名固定为 media。
  form.append('media', blob, filename)

  const url = new URL('https://api.weixin.qq.com/cgi-bin/media/uploadimg')
  url.searchParams.set('access_token', token)

  const res = await fetch(url, { method: 'POST', body: form })
  const data = (await res.json()) as WxUploadImgResponse

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
 * @param file Buffer / 本地路径 / 图片 URL
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

  const res = await fetch(url, { method: 'POST', body: form })
  const data = (await res.json()) as WxAddMaterialResponse

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

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 微信对中文不接受被 ASCII 转义？实际接受 UTF-8 JSON，这里正常 stringify 即可。
    body: JSON.stringify({ articles: [article] }),
  })
  const data = (await res.json()) as WxAddDraftResponse

  if (data.errcode) {
    throw new Error(`新建草稿失败：${explainWxError(data.errcode)}（errmsg: ${data.errmsg ?? ''}）`)
  }
  if (!data.media_id) {
    throw new Error('新建草稿失败：响应缺少 media_id')
  }
  return { mediaId: data.media_id }
}
