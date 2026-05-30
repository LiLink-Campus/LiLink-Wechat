// 发布器注册表 —— 调用方（publish endpoint）按 platform 取发布器，不直接 new 具体类。
//
// 微信走官方 API；视频号 / 小红书 / 抖音先注册人工发布包 Publisher。
// 后续接新平台：实现一个 Publisher，在这里加一行注册即可，调用方无感。

import { WechatPublisher } from './wechat'
import { ManualPublisher } from './manual'
import type { Publisher } from './types'

// 平台标识 → 发布器实例。键即各 Publisher 的 platform 字段。
export const publishers = {
  wechat: new WechatPublisher(),
  weixin_channels: new ManualPublisher('weixin_channels'),
  xiaohongshu: new ManualPublisher('xiaohongshu'),
  douyin: new ManualPublisher('douyin'),
} satisfies Record<string, Publisher>

// 已注册平台的字面量联合类型（'wechat' | ...），方便调用处做类型收窄。
export type PublisherPlatform = keyof typeof publishers

// 重导出类型与具体实现，外部从一个入口拿全。
export type { Publisher, PublishInput, PublishResult } from './types'
export { WechatPublisher } from './wechat'
export { ManualPublisher } from './manual'
