// WechatRenderer —— 微信公众号渲染器。
//
// 第一期直接复用 render.py（"微光玫瑰·克制版"）产出可粘进公众号正文的全内联样式 HTML。
// 这里只做 RenderInput → runRenderPy 选项的映射，排版细节全在 Python 脚本里。

import { runRenderPy } from '../lib/runRenderPy'
import type { Renderer, RenderInput, RenderResult } from './types'

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
