// WechatPublisher —— 微信公众号发布器。
//
// 把一篇渠道稿（Lexical 正文 body + 封面 + 正文图）真正推到微信草稿箱。链路（与设计 §4.7 一致）：
//   ① getAccessToken：取（带进程内缓存的）access_token。
//   ② 封面：若有 coverImage，addPermanentImage 上传为永久素材，得 thumb_media_id。
//   ③ 正文图：遍历 Lexical body 里的 upload(image) 节点，取其已 populate 的 doc.url →
//      uploadContentImage 换成微信域名 URL；用「原图 URL → 微信 URL」映射，同一 URL 只上传一次。
//   ④ 渲染：renderToInlineHtml(body) 得公众号全内联 HTML（与预览/复制共用同一份）。
//      然后用 ③ 的映射把 HTML 里 <img src="原url"> 替换成微信 URL —— 因为正文图必须走
//      mmbiz 域名（design §3.4：外链/base64 会被 draft/add 过滤）。
//   ⑤ 组装 DraftArticle（content=html, thumb_media_id, title/author/digest/source_url）。
//   ⑥ addDraft：建草稿，得 media_id。
//   ⑦ 返回 { draftMediaId, stage:'draft_created' }。
//
// 注意：本文件不读 process.env，凭据由 PublishInput.wechat 注入（endpoint 负责从环境变量取）。
// 历史变更：正文输入从 bodyMarkdown（Markdown）改为 body（Lexical JSON），渲染从
// renderers.wechat.render 改为直接调 lexical-to-wechat 的 renderToInlineHtml；封面/token/
// 草稿/幂等/状态流转全部不变（幂等与状态流转在 endpoint 层，本文件本就不涉及）。

import { renderToInlineHtml } from '../renderers/lexical-to-wechat'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { getAccessToken } from '../wechat/token'
import {
  addDraft,
  addPermanentImage,
  uploadContentImage,
  type DraftArticle,
} from '../wechat/client'
import type { Publisher, PublishInput, PublishResult } from './types'

// 判断某个 url 是否需要上传到微信正文图。只上传 http(s) URL（合法图片来自公网云对象存储）：
// - data: 内联图、本地相对/绝对路径：跳过（client 已不再读本地文件，防 LFI）。
// - 已是微信域名(mmbiz.qpic.cn)的图：跳过（此前已上传过，避免重复）。
function shouldUpload(src: string): boolean {
  if (!/^https?:\/\//i.test(src)) return false
  // 严格 host 前缀：只把 mmbiz.qpic.cn 这一精确域名视为"已是微信图"，避免
  // evil-mmbiz.qpic.cn / evil.com/mmbiz.qpic.cn 这类子串欺骗（codex review High）。
  if (/^https?:\/\/mmbiz\.qpic\.cn\//i.test(src)) return false
  return true
}

// 把 media 关系字段解析成 addPermanentImage 能接受的封面 URL。
// 安全约束：只接受 http(s) 绝对 URL（client 已不再读本地文件/相对路径）。
// - 已 populate 的 Media 文档：取其 url，且必须是 http(s)（媒体走云对象存储时即为公网 https）。
// - 字符串：仅当是 http(s) URL 才用。
// 取不到可用 http(s) 来源时返回 undefined，调用方跳过封面（不阻断整篇发布）。
// 注意：若媒体库用本地磁盘且 url 为相对路径，这里取不到封面——第一期媒体应走云对象存储
// (绝对 https url)，或为 Payload 配置 serverURL 使 media.url 为绝对地址。
function resolveCoverSource(coverImage: unknown): string | undefined {
  if (!coverImage) return undefined
  if (typeof coverImage === 'string') {
    return /^https?:\/\//i.test(coverImage) ? coverImage : undefined
  }
  if (typeof coverImage === 'object') {
    const obj = coverImage as Record<string, unknown>
    if (typeof obj.url === 'string' && /^https?:\/\//i.test(obj.url)) return obj.url
  }
  return undefined
}

// 从一个 Lexical upload 节点里取出图片 doc.url（与 lexical-to-wechat 的 renderUpload 同源：
// value 必须是已 populate 的文档对象，含 url；非图片(mimeType 非 image/*)不视为正文图）。
// 取不到 / 非图片返回 undefined。
function uploadNodeImageUrl(node: Record<string, unknown>): string | undefined {
  const doc = node.value
  if (!doc || typeof doc !== 'object') return undefined
  const d = doc as { url?: string; mimeType?: string }
  if (typeof d.url !== 'string' || !d.url) return undefined
  // 非图片资源（如附件）不走正文图上传——renderUpload 会把它降级成文件名链接。
  if (typeof d.mimeType === 'string' && !d.mimeType.startsWith('image')) return undefined
  return d.url
}

// 递归遍历 Lexical 节点树，收集所有 upload(image) 节点的原图 URL（去重、保持首次出现顺序）。
// 顺序稳定便于测试断言上传次序，也与 renderToInlineHtml 的深度优先遍历一致。
function collectImageUrls(data: SerializedEditorState | null | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const root = (data as { root?: { children?: unknown } } | null | undefined)?.root
  const stackInit = Array.isArray(root?.children) ? (root!.children as unknown[]) : []

  // 显式栈做深度优先（保持 children 自然顺序：先压栈尾、后压栈头以保证出栈即原序）。
  const walk = (nodes: unknown[]): void => {
    for (const raw of nodes) {
      if (!raw || typeof raw !== 'object') continue
      const node = raw as Record<string, unknown>
      if (node.type === 'upload') {
        const url = uploadNodeImageUrl(node)
        if (url && shouldUpload(url) && !seen.has(url)) {
          seen.add(url)
          out.push(url)
        }
        // upload 节点无 children，无需下钻。
        continue
      }
      if (Array.isArray(node.children)) {
        walk(node.children as unknown[])
      }
    }
  }
  walk(stackInit)
  return out
}

export class WechatPublisher implements Publisher {
  // 平台标识，供 publishers 注册表检索。
  readonly platform = 'wechat'

  async publish(input: PublishInput): Promise<PublishResult> {
    const { channelContent: cc, wechat } = input

    // ① 取 access_token（带缓存）。
    const token = await getAccessToken(wechat.appId, wechat.appSecret)

    // ② 封面图 → 永久素材 thumb_media_id（无封面则留空，建草稿时微信要求有封面，
    //    但这里不强校验，把约束交给微信侧报错以暴露问题；多数稿子都会配封面）。
    let thumbMediaId = ''
    const coverSource = resolveCoverSource(cc?.coverImage)
    if (coverSource) {
      const { mediaId } = await addPermanentImage(token, coverSource)
      thumbMediaId = mediaId
    }
    // 发布前 preflight：公众号草稿必须有封面（thumb_media_id），否则 draft/add 会失败。
    // 提前明确报错，而不是发出空封面让微信侧报错（codex review High）。
    if (!thumbMediaId) {
      throw new Error('公众号草稿需要封面图，请先在渠道稿里选择「封面图」后再发布')
    }

    // ③ 正文图：遍历 Lexical body 收集 upload(image) 节点的原图 URL，逐个上传换微信 URL。
    //    用 Map 缓存「原图 URL → 微信 URL」，同一张图重复出现只上传一次。
    const body = (cc?.body ?? null) as SerializedEditorState | null
    const imageUrls = collectImageUrls(body)
    const urlMap = new Map<string, string>()
    // 顺序上传（而非并发）：微信上传接口有频率限制，顺序更稳；规模小不必并发。
    for (const src of imageUrls) {
      const { url } = await uploadContentImage(token, src)
      urlMap.set(src, url)
    }

    // ④ 渲染成公众号全内联 HTML（与预览/复制共用同一份产物）。renderToInlineHtml 按
    //    upload 节点已 populate 的 doc.url 原样输出图片 src；随后用 ③ 的映射把这些原 URL
    //    替换成微信 mmbiz URL（design §3.4：正文图必须走微信域名，外链/base64 会被过滤）。
    const renderConfig = (cc?.renderConfig ?? undefined) as
      | { ctaUrl?: string; ctaText?: string; noCta?: boolean }
      | undefined
    const html = renderToInlineHtml(body, {
      ctaUrl: renderConfig?.ctaUrl,
      ctaText: renderConfig?.ctaText,
      noCta: renderConfig?.noCta,
      // 渲染时直接输出微信 URL，杜绝"渲染后字符串替换"因 & → &amp; 转义不命中而残留外链。
      imageUrlMap: urlMap,
    })
    // 发布前 preflight：正文图必须都是微信域名。若仍有非 mmbiz 的 <img src>，说明该图
    // 未成功上传/换 URL（相对路径/base64/上传失败）——draft/add 会过滤掉它导致掉图，
    // 这里提前阻止并明确报错（codex review High）。
    const badImg = /<img\b[^>]*\bsrc="(?!https:\/\/mmbiz\.qpic\.cn\/)[^">]*"/i.exec(html)
    if (badImg) {
      throw new Error(
        `正文有图片未成功转为微信图片（会被公众号过滤导致掉图），已阻止发布：${badImg[0].slice(0, 100)}`,
      )
    }

    // ⑤ 组装单篇草稿。title 兜底空串避免 undefined 进 JSON；author/digest/source_url
    //    为可选字段，缺省不传（微信会自行处理摘要/署名）。
    const article: DraftArticle = {
      title: typeof cc?.wxTitle === 'string' ? cc.wxTitle : '',
      content: html,
      thumb_media_id: thumbMediaId,
    }
    if (typeof cc?.wxAuthor === 'string' && cc.wxAuthor) article.author = cc.wxAuthor
    if (typeof cc?.wxDigest === 'string' && cc.wxDigest) article.digest = cc.wxDigest
    if (typeof cc?.sourceUrl === 'string' && cc.sourceUrl) article.content_source_url = cc.sourceUrl

    // ⑥ 建草稿。
    const { mediaId } = await addDraft(token, article)

    // ⑦ 返回草稿结果。
    return { draftMediaId: mediaId, stage: 'draft_created' }
  }
}
