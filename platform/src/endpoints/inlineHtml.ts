// 「复制到公众号」用的内联 HTML endpoint（Payload custom endpoint）。
//
// 挂在 channel-contents 集合下：
//   GET /api/channel-contents/:id/inline-html   →  { html: string }
//
// 为什么要有这个 endpoint：
//   转换（renderToInlineHtml）依赖 Node（convertLexicalToHTML），不能在浏览器里跑；
//   而「复制到公众号」按钮是 admin 里的 client 组件。于是让组件 fetch 此接口，由服务端
//   产出**与预览/发布完全相同的那一份全内联 HTML**，组件再写进双格式剪贴板。
//   —— 一份内联 HTML，预览/发布/复制三处共用，无第二套逻辑（设计 §3.5 / §4.4）。
//
// 与 publish/transition endpoint 同构：登录校验 + req.routeParams.id + req.payload。
// 这里是只读取数据，不改任何状态。

import type { Endpoint } from 'payload'

import { renderToInlineHtml } from '../renderers/lexical-to-wechat'

// 集合 slug，与 ChannelContents.slug 一致。
const CHANNEL_CONTENTS_SLUG = 'channel-contents'

// renderConfig 宽松形状（同 ChannelContents.renderConfig group）。
interface RenderConfigShape {
  ctaUrl?: string | null
  ctaText?: string | null
  noCta?: boolean | null
}

// renderConfig → renderToInlineHtml opts；空串/ null 视为未设置走默认。
function toRenderOpts(rc: RenderConfigShape | null | undefined) {
  return {
    ctaUrl: rc?.ctaUrl || undefined,
    ctaText: rc?.ctaText || undefined,
    noCta: rc?.noCta ?? undefined,
  }
}

export const inlineHtmlEndpoint: Endpoint = {
  path: '/:id/inline-html',
  method: 'get',
  handler: async (req) => {
    const { payload, user } = req

    // 1. 鉴权：仅登录运营可取（与预览页一致的访问边界）。
    if (!user) {
      return Response.json({ error: '未登录或会话失效' }, { status: 401 })
    }

    // 2. 渠道稿 id 走路径参数。
    const id = req.routeParams?.id as string | undefined
    if (id === undefined || id === null || id === '') {
      return Response.json({ error: '缺少渠道稿 id' }, { status: 400 })
    }

    // 3. 取渠道稿。depth:2 让 body 内 upload 图片节点 populate 出 media.url，
    //    渲染器才有 <img src> 可输出。按访问控制校验（已是登录用户）。
    let doc: Record<string, unknown> | null = null
    try {
      // 经 unknown 再断言成宽松形状（理由同预览页）：不依赖可能滞后的生成类型，
      // 按运行时实际字段读取 body / renderConfig。
      doc = (await payload.findByID({
        collection: CHANNEL_CONTENTS_SLUG,
        id,
        depth: 2,
        overrideAccess: false,
        user,
      })) as unknown as Record<string, unknown> | null
    } catch {
      doc = null
    }
    if (!doc) {
      return Response.json({ error: `渠道稿不存在：${String(id)}` }, { status: 404 })
    }

    // 4. 渲染成全内联 HTML（与预览/发布同一份）。
    const body = doc.body as Parameters<typeof renderToInlineHtml>[0]
    const renderConfig = doc.renderConfig as RenderConfigShape | undefined
    const html = renderToInlineHtml(body, toRenderOpts(renderConfig))

    return Response.json({ html })
  },
}
