# LiLink 中台 · 可视化编辑增强 — 设计文档（第一期增强）

- **状态**：设计已定稿，待实现
- **日期**：2026-05-29
- **关系**：是 `2026-05-29-lilink-content-platform-design.md`（第一期）的**核心交互增强**，不改其架构，只把"内容输入方式"从手写 Markdown 升级为可视化富文本编辑，并把排版 skill 内化进平台。

---

## 1. 背景与方向调整

第一期把内容做成 `bodyMarkdown` 文本框——运营要手写/粘贴 Markdown，对非技术运营不友好。真实诉求是：**一个别人能直接上手的可视化中台**——运营在网页里像用公众号编辑器/Notion 那样打字、插图、排版（不碰 Markdown、不开文件夹），保存 → 提交审核 → 发布，全链路在 UI 完成；**排版 skill（微光玫瑰）内化进平台**，运营编辑、平台自动套样式出稿。

## 2. 本轮决策记录

| 决策点 | 选择 | 说明 |
|---|---|---|
| 编辑体验 | **富文本编辑 + 一键预览**（A 方案） | Lexical 富文本编辑（通用清爽外观），点"预览"看微光玫瑰公众号最终效果；编辑与样式分离，最快交付可用中台。（备选 B：编辑器实时即微光玫瑰外观——成本高，预留后续） |
| 旧文章导入 | **这期不做** | 先做编辑/预览/发布闭环；`articles/md/` 旧文可在新编辑器重排，或后续做导入工具 |
| 平台范围 | **只做公众号** | 小红书形态完全不同（卡片图+浏览器自动化），按原计划归二期 |

## 3. 设计

### 3.1 数据流

```
编辑页：Lexical 富文本编辑器（打字 / 标题 / 加粗 / 列表 / 引用 / 插图）
          │ 存为 Payload Lexical JSON（body 字段）
          ├─[预览] → lexical→微光玫瑰HTML → 新标签查看公众号真实效果
          ├─[提交审核] → 状态流转（草稿 → 待审核 → 已批准）
          └─[发布] → body(Lexical) → 微光玫瑰HTML
                    → 正文图/封面上传微信素材 → draft/add 建草稿
```

### 3.2 内容字段改造（ChannelContents）

- `bodyMarkdown`(textarea) → **`body`(Lexical richText 字段)**，运营可视化编辑。
- 其余字段（wxTitle/wxAuthor/wxDigest/coverImage/sourceUrl/renderConfig/status/...）保留不变。
- 迁移：本地开发数据可重建；`bodyMarkdown` 字段删除（无生产数据需迁移）。

### 3.3 微光玫瑰转换层（内化 skill 的核心）

两个新文件，把 `render.py` 的排版能力搬进 TS：

- **`src/lib/wechat-theme.ts`** — 设计令牌单一真源。把 `render.py` 的颜色/字体/各元素内联样式（ROSE `#c2706c`、INK `#4a4340`、SERIF 宋体、p/title/chapter/step/eyebrow/ul/li/img/cap/callout/hr/code/strong/em/a）移植成 TS 常量与样式表。
- **`src/renderers/lexical-to-wechat.ts`** — `Lexical JSON → 微光玫瑰内联样式 HTML`。基于 `@payloadcms/richtext-lexical` 的 `convertLexicalToHTML` + 自定义 HTMLConverters，逐节点套 `wechat-theme` 内联样式。

替代 `render.py` 在发布链路的角色（`WechatRenderer` 改调本转换层）。

### 3.4 Lexical → 微光玫瑰 元素映射表

| Lexical 节点 | 微光玫瑰输出 | 沿用的 skill 约定 |
|---|---|---|
| heading h2 | chapter（衬线大标题） | 自动识别 `一、`/`1.` 前缀染玫瑰 |
| heading h3 | step（步骤标题） | 识别 `第一步`/`方式一`/数字 前缀染玫瑰 |
| heading h4 | eyebrow（小号玫瑰眉标） | — |
| paragraph | p（暖灰正文 16px/1.9） | — |
| bold / italic / inline code | strong / em / code（玫瑰底码） | — |
| link | a（玫瑰下划线） | — |
| unordered/ordered list | ul/ol + li（玫瑰留白列表） | — |
| quote(blockquote) | **callout 提示卡**（玫瑰左线+淡底） | `**一个小建议：**` 开头染玫瑰 |
| upload(image) | 居中圆角图 + **alt 自动变题注** | 文件名式 alt 不配题注 |
| 文末 | 自动追加 **CTA 胶囊按钮** | 沿用 `renderConfig`（ctaUrl/ctaText/noCta） |

> 标题层级映射：Lexical 工具栏的 H2/H3/H4 对应章节/步骤/眉标。编辑页给运营简短提示（用 H2 作大节、H3 作步骤）。

### 3.5 一键预览

- 用 Payload `admin.preview`：为 ChannelContents 配置预览 URL `/preview/channel-contents/:id`。
- 新增路由 `src/app/(app)/preview/channel-contents/[id]/page.tsx`：服务端取该渠道稿 → 调转换层渲染微光玫瑰整页 HTML → 返回。
- 编辑页自动出现"预览"按钮，点击开新标签即见公众号真实效果。
- 预览鉴权：仅登录运营可访问（校验 Payload session）。

### 3.6 发布链路改造（WechatPublisher）

- 输入从 `bodyMarkdown` 改为 `body`(Lexical)。
- 正文图片：来自 Lexical 的 upload 节点（指向媒体库 Media），发布时逐张 `media/uploadimg` 换微信 URL，替换进转换后的 HTML（比之前解析 markdown 图片更规范、来源可信）。
- 封面/access_token/草稿（add_material/draft/add）、幂等、状态流转等逻辑**全部不变**。

## 4. 范围（YAGNI）

**做**：公众号渠道稿的富文本编辑、微光玫瑰转换层、一键预览、发布链路改造、对应测试。
**不做**：实时 iframe Live Preview（用开新标签的静态预览）；编辑器外观深度定制成微光玫瑰（B 方案，后续）；旧 Markdown 导入；小红书；多语言编辑。

## 5. 文件结构（增量）

```
src/
  lib/wechat-theme.ts            # 新增：微光玫瑰设计令牌(TS 真源)
  renderers/
    lexical-to-wechat.ts         # 新增：Lexical→微光玫瑰HTML 转换
    wechat.ts                    # 改：WechatRenderer 改调 lexical-to-wechat（保留 render.py 兼容/导入备用）
  collections/ChannelContents.ts # 改：bodyMarkdown → body(richText)
  publishers/wechat.ts           # 改：取 body(Lexical) 经转换层；正文图取自 upload 节点
  app/(app)/preview/channel-contents/[id]/page.tsx  # 新增：预览页
  endpoints/ 或 admin 预览配置    # ChannelContents.admin.preview
tests/
  lexical-to-wechat.test.ts      # 新增：转换层映射快照测试
  （publisher.test.ts 改：body 改 Lexical 输入）
scripts/render.py                # 保留：旧 markdown 导入备用，不在发布主链路
```

## 6. 测试策略

- `lexical-to-wechat.test.ts`：给定 Lexical JSON（含标题/段落/列表/引用/图片/链接），断言输出含对应微光玫瑰内联样式、前缀染玫瑰、引用→提示卡、alt→题注、文末 CTA。
- `publisher.test.ts`：改为 Lexical body 输入，验证发布链路（转换→图片替换→草稿）不变。
- 预览页：登录态可访问、未登录拒绝；渲染含微光玫瑰样式。
- Playwright：编辑→预览→（测试号）发布的人工/半自动走查。

## 7. 兼容与回滚

- `render.py` 与 `wechat-theme.ts` 是同一套设计令牌的两份实现；以 `wechat-theme.ts` 为发布主链路真源，`render.py` 仅留作 CLI/导入备用。后续可让 `render.py` 也从令牌生成，避免双源漂移（本期不做）。
