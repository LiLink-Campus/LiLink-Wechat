// 发布器（Publisher）抽象层类型定义。
//
// 设计意图：渲染器（renderers/）负责把稿件 Markdown 渲染成各平台 HTML，
// 发布器则负责把渲染产物 + 资产真正推送到目标平台（上传素材、建草稿/发布）。
// 第一期只有微信公众号（wechat），接口按"多平台"留口子：后续接小红书 / X 等
// 只需再实现一个 Publisher，调用方（publish endpoint）按 platform 检索，无感扩展。

// 一次发布的输入。
// - channelContent：完整的渠道稿文档（channel-contents 一条记录）。用 any 是因为
//   Payload 生成的类型在跨任务阶段未必稳定，发布器只读取其中已知字段：
//   wxTitle / wxAuthor / wxDigest / bodyMarkdown / coverImage / sourceUrl / renderConfig。
// - wechat：微信凭据（公众号 AppID / AppSecret）。由 endpoint 从环境变量注入，
//   不直接依赖 process.env，便于测试与多公众号扩展。
export interface PublishInput {
  channelContent: any
  wechat: { appId: string; appSecret: string }
}

// 一次发布的产物。
// - draftMediaId：微信草稿箱里新建图文的 media_id（由 draft/add 返回）。
// - stage：发布阶段。第一期只做到"建草稿"（draft_created），不直接群发，
//   群发由人工在公众号后台确认或后续任务（mass_sent）推进。
export interface PublishResult {
  draftMediaId: string
  stage: 'draft_created'
}

// 发布器接口。每个目标平台实现一个。
// - platform：平台标识（如 'wechat'），用于在 publishers 注册表里检索。
// - publish：执行发布，异步（涉及多次远端调用：取 token / 传图 / 建草稿）。
export interface Publisher {
  platform: string
  publish(input: PublishInput): Promise<PublishResult>
}
