# 多平台发布链路基础设施 Spec

- 日期：2026-05-31
- 基线：PR #1 `worktree-lilink-phase1` 的公众号内容中台
- 参考：`gitcoffee-os/postbot` v1.1.20 的平台拆分方式（platform meta / publisher registry / content type）
- 范围：公众号、视频号、小红书、抖音

## 1. 参考结论

PostBot 对 LiLink 最有价值的不是具体 DOM 自动填充代码，而是三个结构：

1. 平台元信息集中登记：平台名、发布入口、内容类型、排序和启用状态。
2. 内容类型与发布器分离：article / moment / video 各自走对应 publisher。
3. 浏览器登录态发布：对没有稳定开放 API 的平台，复用本地浏览器登录态，而不是保存账号密码。

LiLink 已经有公众号官方 API 闭环，因此这次不推翻 PR #1，只在其上补一层“平台登记表 + 人工发布包 + 状态机扩展”。后续 Playwright worker 可以消费同一个发布包继续自动化。

## 2. 架构决策

### 2.1 平台分层

| 平台 | 自动化级别 | 当前链路 | 成功后状态 |
| --- | --- | --- | --- |
| 微信公众号 | official_api | `draft/add` 建草稿 | `published`（表示中台发布动作完成，草稿已建） |
| 视频号 | manual_browser | 生成发布包，运营在网页端确认 | `ready_to_publish` |
| 小红书 | manual_browser | 生成发布包，运营在网页端确认 | `ready_to_publish` |
| 抖音 | manual_browser | 生成发布包，运营在网页端确认 | `ready_to_publish` |

`ready_to_publish` 是新增状态：它表示“中台已经准备好可发布材料，但第三方平台最终点击还没完成”。运营在平台后台发出后，再手动流转为 `published`。

### 2.2 新增模块

- `src/platforms/registry.ts`
  - 单一平台登记表：平台 code、PostBot code、发布入口、内容形态、标题/正文限制、必需素材。
- `src/renderers/social-package.ts`
  - 把渠道稿渲染成确定性的人工发布包：标题、正文、话题、素材、发布入口、检查清单、warnings。
- `src/publishers/manual.ts`
  - 视频号/小红书/抖音共用发布器；不碰第三方账号，只校验并回填 `manualPackage`。
- `ChannelContents`
  - 新增视频号平台选项。
  - 新增三平台共用字段：内容形态、平台标题、平台正文、平台话题、图文图片、视频文件、横封面、竖封面。
  - 新增 `publishResult.manualPackage` 与 `stage=manual_ready`。

### 2.3 状态机

```
draft -> in_review -> approved -> published
                         |
                         v
                 ready_to_publish -> published
                         |
                         v
                     in_review
```

- 公众号：`approved -> published`
- 视频号/小红书/抖音：`approved -> ready_to_publish -> published`
- `ready_to_publish -> in_review` 用于人工发布前发现标题、素材、导流风险等问题。

## 3. 发布包契约

人工发布包结构：

```ts
interface SocialPublishPackage {
  platform: 'weixin_channels' | 'xiaohongshu' | 'douyin'
  platformLabel: string
  mode: 'image_note' | 'video'
  publishUrl: string
  title: string
  caption: string
  hashtags: string[]
  assets: Array<{ role: string; url?: string; filename?: string; mimeType?: string }>
  checklist: string[]
  warnings: Array<{ level: 'warning' | 'error'; message: string }>
}
```

`warning` 不阻断，`error` 阻断。例如：

- 标题超长：截断并 warning。
- 图文无图片：error。
- 视频无视频文件：error。
- 媒体关系未展开 URL：warning，提示检查 Payload depth / OSS 直链。

## 4. 后续自动化路线

1. 先用 `manualPackage` 让运营手动发布，稳定内容字段与审核流程。
2. 给每个平台加 Playwright worker，输入就是 `manualPackage`。
3. worker 只负责打开发布入口、填标题/正文、上传素材、停在“最终发布前确认”。
4. 只有在平台稳定且风控允许时，再考虑自动点击最终发布。

## 5. 验收口径

无第三方 key 时可验：

- TypeScript 通过。
- 发布包渲染测试通过。
- 微信原有 publisher 测试通过。
- 人工平台 endpoint 测试通过：无微信凭据也能生成 `manual_ready`，状态只到 `ready_to_publish`。
- 公众号链路回归测试通过：仍要求微信凭据，仍建草稿，仍幂等。

有账号/key 后再验：

- 公众号：`approved -> publish` 后公众号后台出现草稿。
- 视频号/小红书/抖音：发布包字段可直接复制，素材 URL 可访问，运营能按 checklist 完成发布并流转为 `published`。
