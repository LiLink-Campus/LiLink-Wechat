// 渲染器注册表 —— 调用方按平台标识取渲染器，不直接 new 具体类。
//
// 微信有正式 HTML renderer；人工平台的发布包 renderer 从本入口重导出，供 publisher 复用。
// 后续接新平台：实现一个 Renderer，在这里加一行注册即可，调用方无感。

import { WechatRenderer } from './wechat'
import type { Renderer } from './types'

// 平台标识 → 渲染器实例。键即各 Renderer 的 platform 字段。
export const renderers = {
  wechat: new WechatRenderer(),
} satisfies Record<string, Renderer>

// 已注册平台的字面量联合类型（'wechat' | ...），方便调用处做类型收窄。
export type RendererPlatform = keyof typeof renderers

// 重导出类型与具体实现，外部从一个入口拿全。
export type { Renderer, RenderInput, RenderResult, RenderConfig, Asset } from './types'
export { WechatRenderer } from './wechat'
export { buildSocialPackage } from './social-package'
export type { SocialPublishPackage, SocialAsset, PackageWarning } from './social-package'
