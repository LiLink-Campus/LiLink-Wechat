// WechatRenderer —— 微信公众号「Markdown → 内联 HTML」渲染器（基于 render.py）。
//
// 直接复用 render.py（"微光玫瑰·克制版"）把 Markdown 产出可粘进公众号正文的全内联样式 HTML。
// 这里只做 RenderInput → runRenderPy 选项的映射，排版细节全在 Python 脚本里。
//
// @deprecated 实时发布链路（WechatPublisher）已改为以 Lexical body 为正文真源，直接调用
// src/renderers/lexical-to-wechat.ts 的 renderToInlineHtml 产出内联 HTML（与预览/复制共用
// 同一份），不再经本渲染器。本类仅保留给「旧 Markdown 文章导入备用」场景（design §6 文件结构
// 标注 render.py 保留）及其自有测试；新代码请勿在发布路径里使用本类。

import { runRenderPy } from '../lib/runRenderPy'
import type { Renderer, RenderInput, RenderResult } from './types'

/** @deprecated 见文件头注释：发布链路已改用 lexical-to-wechat 的 renderToInlineHtml。 */
export class WechatRenderer implements Renderer {
  // 平台标识，供 renderers 注册表检索。
  readonly platform = 'wechat'

  async render(input: RenderInput): Promise<RenderResult> {
    // 把 RenderInput 的 config / embedImages 摊平成 runRenderPy 的选项。
    // embedImages 直接透传：显式 false 才关内联，true / undefined 用脚本默认。
    const { html, warnings } = await runRenderPy(input.markdown, {
      embedImages: input.embedImages,
      ctaUrl: input.config?.ctaUrl,
      ctaText: input.config?.ctaText,
      noCta: input.config?.noCta,
    })

    return { html, warnings }
  }
}
