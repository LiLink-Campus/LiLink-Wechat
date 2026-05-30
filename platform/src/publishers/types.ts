// 发布器（Publisher）抽象层类型定义。
//
// 设计意图：渲染器（renderers/）负责把稿件 Markdown 渲染成各平台 HTML，
// 发布器则负责把渲染产物 + 资产真正推送到目标平台（上传素材、建草稿/发布）。
// 微信公众号走官方 API；视频号 / 小红书 / 抖音先走人工发布包。后续接浏览器
// worker 或其它平台时，继续实现 Publisher，调用方按 platform 检索即可。

import type { SocialPublishPackage } from '../renderers/social-package'
import type { Status } from '../workflow/states'

// 一次发布的输入。
// - channelContent：完整的渠道稿文档（channel-contents 一条记录）。用 any 是因为
//   Payload 生成的类型在跨任务阶段未必稳定，发布器只读取其中已知字段：
//   wxTitle / wxAuthor / wxDigest / body(Lexical 正文，含 upload 图片节点) /
//   coverImage / sourceUrl / renderConfig。
//   （正文从早期的 bodyMarkdown 升级为 body(Lexical JSON)，见 design §4.2/§4.7。）
// - wechat：微信凭据（公众号 AppID / AppSecret）。只有 wechat 发布器需要；人工发布包
//   平台（视频号/小红书/抖音）不读取凭据。
export interface PublishInput {
  channelContent: any
  wechat?: { appId: string; appSecret: string }
  // 草稿一旦在平台侧建成（拿到 draftMediaId）即回调，让 endpoint 立刻把 id 落库。
  // 目的：草稿建成与「写库」之间若进程崩溃/DB 瞬断，重试能凭已落库的 draftMediaId
  // 走幂等修复、不重复建草稿（见 endpoints/publish.ts 的可恢复设计）。
  // 回调抛错应让整个 publish 失败（走 endpoint 的 catch 释放锁），因为 draftId 未能持久化。
  onDraftCreated?: (draftMediaId: string) => Promise<void>
}

export type PublishStage = 'draft_created' | 'manual_ready'

// 一次发布的产物。
// - draftMediaId：微信草稿箱里新建图文的 media_id（由 draft/add 返回）。
// - stage：发布阶段。draft_created=公众号草稿已建；manual_ready=人工发布包已生成。
// - statusAfterPublish：endpoint 成功后应流转到的协作状态。公众号是 published；
//   人工平台是 ready_to_publish，等运营在平台后台确认发布后再手动流转到 published。
export interface PublishResult {
  draftMediaId?: string
  stage: PublishStage
  statusAfterPublish?: Status
  manualPackage?: SocialPublishPackage
}

// 发布器接口。每个目标平台实现一个。
// - platform：平台标识（如 'wechat'），用于在 publishers 注册表里检索。
// - publish：执行发布，异步（涉及多次远端调用：取 token / 传图 / 建草稿）。
export interface Publisher {
  platform: string
  publish(input: PublishInput): Promise<PublishResult>
}
