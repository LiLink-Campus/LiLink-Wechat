// 渲染器抽象层类型定义。
//
// 设计意图：内容平台里一篇稿子（Markdown + 资产 + 配置）要渲染成各平台可用的
// 产物。第一期只有微信公众号（wechat），但接口按"多平台"留口子，后续接小红书 /
// 站内页等只需再实现一个 Renderer，不改调用方。

// 单张资产（图片）。
// - src：稿件 Markdown 里引用的原始路径（如 ![](pic.png) 里的 pic.png），
//   用于在渲染时把本地图片内联成 data URI。
// - wechatUrl：上传到微信素材库后回填的 URL（第一期占位，后续打通上传时用）。
export interface Asset {
  src: string
  wechatUrl?: string
}

// 渲染配置：目前只覆盖文末 CTA（号召按钮）。
// - ctaUrl / ctaText：自定义 CTA 链接与文案；不传则用 render.py 内置默认。
// - noCta：完全不追加文末 CTA。
export interface RenderConfig {
  ctaUrl?: string
  ctaText?: string
  noCta?: boolean
}

// 一次渲染的输入。
// - markdown：稿件正文（含可选 YAML frontmatter，render.py 会自行剥离 title）。
// - assets：资产清单（第一期未直接消费，预留给上传 / 校验流程）。
// - config：渲染配置（见 RenderConfig）。
// - embedImages：是否把本地图片转 base64 内联。缺省视为 true（与 render.py 默认一致）；
//   显式传 false 时走 --no-embed-images。
export interface RenderInput {
  markdown: string
  assets?: Asset[]
  config?: RenderConfig
  embedImages?: boolean
}

// 一次渲染的产物。
// - html：可直接粘进目标平台的 HTML（微信场景为全内联样式的"可复制"页）。
// - warnings：非致命告警（如某张本地图片找不到，会缺图但不阻断）。
export interface RenderResult {
  html: string
  warnings: string[]
}

// 渲染器接口。每个目标平台实现一个。
// - platform：平台标识（如 'wechat'），用于在 renderers 注册表里检索。
// - render：执行渲染，异步（底层可能 spawn 子进程 / 调远端）。
export interface Renderer {
  platform: string
  render(input: RenderInput): Promise<RenderResult>
}
