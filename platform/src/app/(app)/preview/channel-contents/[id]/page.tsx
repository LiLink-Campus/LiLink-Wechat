// 渠道稿预览页（服务端组件，App Router）。
//
// 设计依据 §4.6「一键预览（预览=最终）」：取 body(Lexical) → renderToInlineHtml →
// 返回**与发布完全相同的那一份全内联 HTML**。因为预览用的就是最终产物，所以
// 「预览所见」= 「公众号所得」，从根上消除「预览正常、保存掉格式」。
//
// 路由：/preview/channel-contents/[id]
//   - ChannelContents.admin.preview 已指向此地址（见 collections/ChannelContents.ts），
//     编辑页右上「预览」开新标签即落到这里。
//   - 登录态校验：用 Payload Local API 的 payload.auth({ headers }) 读当前会话；
//     未登录 → 跳到 /admin/login（带 redirect 回本页）。
//
// 实现要点：
//   - getPayload({ config }) + findByID 直连数据库取本条渠道稿（depth:2 让 body 里的
//     upload 图片节点 populate 出 media.url，渲染器才能拿到 <img src>）。
//   - renderToInlineHtml 接 renderConfig（文末 CTA 链接/文案/开关），与发布链路同参。
//   - 输出整页：<html><body> 里套一个居中、约手机宽度(390px)的容器，把那份内联 HTML
//     原样塞进去（dangerouslySetInnerHTML）。容器本身的外观样式与产物无关——产物永远
//     是它自己那串全内联 HTML，这里只是给它一个「手机屏」背景做肉眼预览。

import { headers as nextHeaders } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'

// 用 @/ 别名（tsconfig paths: @/* → ./src/*）避免深层相对路径易错。
import { renderToInlineHtml } from '@/renderers/lexical-to-wechat'

export const dynamic = 'force-dynamic'

// renderConfig 的宽松形状（与 ChannelContents.renderConfig group 字段一致）。
interface RenderConfigShape {
  ctaUrl?: string | null
  ctaText?: string | null
  noCta?: boolean | null
}

// 把渠道稿的 renderConfig 归一成 renderToInlineHtml 的 opts。
// 空串/ null 一律视为「未设置」，交由渲染器用默认 CTA。
function toRenderOpts(rc: RenderConfigShape | null | undefined) {
  return {
    ctaUrl: rc?.ctaUrl || undefined,
    ctaText: rc?.ctaText || undefined,
    noCta: rc?.noCta ?? undefined,
  }
}

export default async function ChannelContentPreviewPage({
  params,
}: {
  // Next 16：params 是 Promise，必须 await（见 next docs dynamic-routes）。
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const payload = await getPayload({ config })

  // 登录态校验：用请求头里的会话 cookie 鉴权。未登录跳后台登录页，登录后回到本预览页。
  const headers = await nextHeaders()
  const { user } = await payload.auth({ headers })
  if (!user) {
    redirect(`/admin/login?redirect=${encodeURIComponent(`/preview/channel-contents/${id}`)}`)
  }

  // 取本条渠道稿。depth:2 确保 body 内 upload 节点 populate 出 media 文档（含 url/width）。
  // findByID 默认会按访问控制校验（这里已是登录用户）；取不到 → 404 文案页。
  let doc: Record<string, unknown> | null = null
  try {
    // 经 unknown 再断言成宽松形状：findByID 返回的是生成类型 ChannelContent，
    // 但 body(richText) 字段在 payload-types 重新生成前可能尚未体现（跨任务类型滞后），
    // 故这里不依赖具体生成类型，按运行时实际字段读取。
    doc = (await payload.findByID({
      collection: 'channel-contents',
      id,
      depth: 2,
      overrideAccess: false,
      user,
    })) as unknown as Record<string, unknown> | null
  } catch {
    doc = null
  }

  if (!doc) {
    // 注意：本页在 (app) 路由组内，<html>/<body> 由 (app)/layout.tsx 提供——
    // 这里只返回内容容器，绝不再渲染 <html>/<body>（否则嵌套 <html> 触发 hydration 错乱）。
    return (
      <main style={{ padding: '3rem', textAlign: 'center', color: '#666', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: '1.25rem' }}>找不到这篇渠道稿</h1>
        <p>id：{id}</p>
      </main>
    )
  }

  // 渲染成「与发布完全相同」的公众号全内联 HTML。
  const body = doc.body as Parameters<typeof renderToInlineHtml>[0]
  const renderConfig = doc.renderConfig as RenderConfigShape | undefined
  const html = renderToInlineHtml(body, toRenderOpts(renderConfig))

  const title = (typeof doc.wxTitle === 'string' && doc.wxTitle) || '渠道稿预览'

  // 注意：本页在 (app) 路由组内，<html>/<body> 由 (app)/layout.tsx 提供——这里用一个
  // 全屏 <div> 模拟「手机屏」背景，绝不再渲染 <html>/<body>（否则嵌套触发 hydration 错乱）。
  return (
    <div
      style={{
        // 预览「屏外」的背景仅用于肉眼模拟手机——与产物无关，产物永远全内联。
        background: '#ebeced',
        minHeight: '100vh',
        padding: '24px 0',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, sans-serif',
      }}
    >
      <main
        style={{
          maxWidth: 390,
          margin: '0 auto',
          background: '#ffffff',
          minHeight: 'calc(100vh - 48px)',
          boxShadow: '0 1px 8px rgba(0,0,0,0.08)',
          // 公众号正文区左右各约 20px 留白，贴近真机。
          padding: '20px 16px',
          boxSizing: 'border-box',
        }}
      >
        {/* 标题区仅预览用（公众号标题由后台单独字段管理，不进正文 HTML）。 */}
        <h1
          style={{
            fontSize: 22,
            lineHeight: 1.4,
            fontWeight: 700,
            color: '#1a1a1a',
            margin: '4px 0 16px',
          }}
        >
          {title}
        </h1>
        {/* 这一份就是发布/复制会用的同一串全内联 HTML —— 预览=最终。 */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </main>
    </div>
  )
}
