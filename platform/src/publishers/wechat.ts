// WechatPublisher —— 微信公众号发布器。
//
// 把一篇渠道稿（Markdown + 封面 + 正文图）真正推到微信草稿箱。链路（与任务约定一致）：
//   ① getAccessToken：取（带进程内缓存的）access_token。
//   ② 封面：若有 coverImage，addPermanentImage 上传为永久素材，得 thumb_media_id。
//   ③ 正文图：遍历 bodyMarkdown 里 ![](src) 的每个图片，uploadContentImage 换成微信
//      域名 URL，并把 Markdown 里对应 src 替换为微信 URL（同一 src 只上传一次）。
//   ④ 渲染：renderers.wechat.render({ markdown: 替换后, embedImages:false, config })。
//      embedImages 必须为 false —— 正文图已是微信 URL，不能再被 base64 内联。
//   ⑤ 组装 DraftArticle（content=html, thumb_media_id, title/author/digest/source_url）。
//   ⑥ addDraft：建草稿，得 media_id。
//   ⑦ 返回 { draftMediaId, stage:'draft_created' }。
//
// 注意：本文件不读 process.env，凭据由 PublishInput.wechat 注入（endpoint 负责从环境变量取）。

import { renderers } from '../renderers'
import { getAccessToken } from '../wechat/token'
import {
  addDraft,
  addPermanentImage,
  uploadContentImage,
  type DraftArticle,
} from '../wechat/client'
import type { Publisher, PublishInput, PublishResult } from './types'

// Markdown 图片语法 ![alt](src "可选title") 的匹配。
// - 捕获组 1：alt 文本；捕获组 2：括号内的整体（src + 可选 title）。
// 用全局匹配遍历所有图片；src 的进一步切分（剥离 title / 尖括号）在 extractSrc 里做。
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g

// 从 Markdown 图片括号内容里取出纯 src。
// 形如 (path "title") / (<path> "title") / (path) 都能正确取到 path。
function extractSrc(inside: string): string {
  let s = inside.trim()
  // 去掉行内 title 部分： src 后跟空白再跟引号包裹的标题。
  const titleMatch = s.match(/^(\S+)\s+["'(].*$/)
  if (titleMatch) {
    s = titleMatch[1]
  }
  // 去掉尖括号包裹： <path> → path。
  if (s.startsWith('<') && s.endsWith('>')) {
    s = s.slice(1, -1)
  }
  return s.trim()
}

// 判断某个 src 是否需要上传到微信。
// - data: 内联图：跳过（已是内联数据，无法/无需上传）。
// - 其余（本地相对/绝对路径、http(s) URL）：都尝试上传。
//   uploadContentImage 自身支持 Buffer / 本地路径 / URL 三种入参，这里把 src 原样交给它。
function shouldUpload(src: string): boolean {
  return !src.startsWith('data:')
}

// 把一个 media 关系字段解析成 addPermanentImage 能接受的入参（URL 或本地路径字符串）。
// - 已 populate 的 Media 文档：优先取 url（上传后微信侧/本地可访问的地址），退而取 filename。
// - 直接是字符串（未 populate，仅 id；或调用方已传好 URL/路径）：原样返回。
// 解析不出可用来源时返回 undefined，调用方据此跳过封面（不阻断整篇发布）。
function resolveCoverSource(coverImage: unknown): string | undefined {
  if (!coverImage) return undefined
  if (typeof coverImage === 'string') return coverImage
  if (typeof coverImage === 'object') {
    const obj = coverImage as Record<string, unknown>
    if (typeof obj.url === 'string' && obj.url) return obj.url
    if (typeof obj.filename === 'string' && obj.filename) return obj.filename
  }
  return undefined
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

    // ③ 正文图：遍历 Markdown 所有图片，逐个上传换 URL，并在正文里替换对应 src。
    //    用 Map 缓存「原 src → 微信 URL」，同一张图重复出现只上传一次。
    const bodyMarkdown: string = typeof cc?.bodyMarkdown === 'string' ? cc.bodyMarkdown : ''
    const srcToWxUrl = new Map<string, string>()

    // 先收集去重后的待上传 src（保持首次出现顺序，便于测试断言上传次序）。
    const pendingSrcs: string[] = []
    for (const match of bodyMarkdown.matchAll(MD_IMAGE_RE)) {
      const src = extractSrc(match[2])
      if (src && shouldUpload(src) && !srcToWxUrl.has(src) && !pendingSrcs.includes(src)) {
        pendingSrcs.push(src)
      }
    }
    // 顺序上传（而非并发）：微信上传接口有频率限制，顺序更稳；规模小不必并发。
    for (const src of pendingSrcs) {
      const { url } = await uploadContentImage(token, src)
      srcToWxUrl.set(src, url)
    }

    // 在 Markdown 里把每个原 src 替换成微信 URL。重新跑一遍正则做替换，
    // 只替换括号内的 src 部分，保留 alt / title 原样。
    const replacedMarkdown = srcToWxUrl.size
      ? bodyMarkdown.replace(MD_IMAGE_RE, (whole, alt: string, inside: string) => {
          const src = extractSrc(inside)
          const wxUrl = srcToWxUrl.get(src)
          if (!wxUrl) return whole
          // 用微信 URL 重建为最简单的 ![alt](wxUrl) 形态（title 在公众号正文中无意义）。
          return `![${alt}](${wxUrl})`
        })
      : bodyMarkdown

    // ④ 渲染成微信 HTML。embedImages 强制 false：正文图已是微信 URL，禁止再内联。
    const { html } = await renderers.wechat.render({
      markdown: replacedMarkdown,
      embedImages: false,
      config: cc?.renderConfig,
    })

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
