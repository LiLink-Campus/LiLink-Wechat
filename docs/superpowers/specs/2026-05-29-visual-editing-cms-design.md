# LiLink 中台 · 可视化编辑增强 — 设计文档（修订版：所见即所得 + 公众号格式兼容）

- **状态**：设计定稿（已含公众号格式调研结论），进入实现
- **日期**：2026-05-29
- **关系**：第一期（`2026-05-29-lilink-content-platform-design.md`）的核心交互增强。把内容输入从手写 Markdown 升级为**可视化所见即所得编辑**，把排版 skill 内化进平台，并把"公众号保存不掉格式"作为头号硬约束。

---

## 1. 背景与方向

诉求：**别人能直接上手的可视化中台**——运营在网页里像公众号编辑器/Notion 那样打字、插图、排版（不碰 Markdown、不开文件夹），编辑 → 保存 → 提交审核 → 发布全在 UI。排版 skill（微光玫瑰）内化进平台。**且必须"和公众号一样所见即所得"——预览/编辑看到的样式，保存到公众号后不能掉。**

用户痛点（必须解决）：以往"预览正常，一保存格式全掉"。根因见 §3.1。

## 2. 决策记录

| 决策点 | 选择 | 说明 |
|---|---|---|
| 编辑体验 | **所见即所得（B 方案）** | Lexical 富文本编辑器，编辑区套微光玫瑰样式（编辑即接近最终）；预览渲染**与发布完全相同的内联 HTML**，做到"预览=公众号最终效果"。 |
| **公众号格式兼容** | **头号硬约束** | 转换层产物必须全内联 + 白名单 CSS + section/p 结构（见 §3），保证 `draft/add` 与复制粘贴两条通道都不掉格式。 |
| 排版 skill | **内化为转换层** | `render.py` 令牌 → `wechat-theme.ts`(TS 真源) + `lexical-to-wechat.ts`(转换)。 |
| 旧文章导入 | 这期不做 | 旧文可在新编辑器重排。 |
| 平台范围 | 只做公众号 | 小红书归二期。 |

---

## 3. 公众号格式兼容（头号硬规范 · 基于调研，转换层必须严格遵守）

### 3.1 "格式掉"的根因
公众号正文渲染**不解析 `<style>` 标签、不支持外部/页面级 CSS、删除 `id`**；**只有元素 `style=""` 内联样式生效**。预览时 `<style>`+class 在、好看；内容进公众号后 `<style>` 被丢、class 失义 → 样式归零。**解决之道：把"预览=最终"的保证从"靠 `<style>`"改成"靠内联"。**

### 3.2 标签规范（产物只用这些）
- 块容器：**`<section>`**（**永不用 `<div>`**——div 会被转换，行为不确定）
- 段落：**`<p>`**（每段必须内联 `line-height` 与 `letter-spacing`，否则保存后行距被改写）
- 标题：`<h1>`–`<h6>`（**必须自己内联** font-size/weight/margin，公众号不给默认样式）
- 行内：`<span>`/`<strong>`/`<em>`/`<u>`/`<a>`/`<code>`
- 列表：`<ul>`/`<ol>`/`<li>`，**符号写成 `<li>` 内文本前缀**（`• ` / `1. `，代码维护计数），**绝不依赖 `list-style`**（公众号常丢 marker）
- 图片：`<figure><img/><figcaption>题注</figcaption></figure>`；img 显式 `width` + `max-width:100%`（否则 iOS 可能不显示）
- 引用：`<blockquote>`（内部 `<p>` 也要内联）
- 表格：`<section style="overflow:auto;...">` 包 `<table>`
- 分隔线：`<hr>`（带 `border-top` + `height:0` 兜底）
- 最外层包一个根 `<section>`（放整体字号/字体/行距/底色基线）；每个内容块各包一个 `<section>`

### 3.3 内联 CSS 名单
**白名单（可用）**：`color` `font-size` `font-weight` `font-style` `font-family` `line-height` `letter-spacing` `text-align` `text-decoration` `text-indent` `margin(-*)` `padding(-*)` `background-color` `background`(linear-gradient 谨慎) `border(-*)` `border-radius` `width` `max-width` `height` `min-height` `display:block|inline-block` `vertical-align` `box-shadow`(图上) `opacity`(图上) `pointer-events:none`。

**黑名单（禁止，会掉/被删）**：`position` `float` `display:flex/grid` `gap` 伪类伪元素 `::before/::after/:hover` `@media` `@keyframes/animation/transition` `var(--x)` `calc()`（**转换层必须算成字面值**）负 margin、`%`作通用长度（宽度用 `max-width:100%` 例外）、`list-style` 做符号。

### 3.4 图片 / 链接处理
- **API（draft/add）通道**：正文图**必须先上传微信换 `mmbiz` 域名 URL**，外链/base64 会被过滤。content < 2 万字符；HTML 属性用**单引号**或转义（裸双引号会报错）。
- **复制粘贴通道**：可用 base64 内联图（微信自动转存）。
- 正文 `<a>` 在 App 内不可点（平台策略）；真正跳转放"阅读原文"(`source_url`)。文末按钮仅视觉引导。

### 3.5 发布两通道（都不掉格式，共用同一份内联 HTML）
1. **draft/add API**（自动）：图片换微信 URL → 内联 HTML 填 content → 建草稿。
2. **"复制到公众号"按钮**（人工）：用**双格式剪贴板**（`text/html` + `text/plain`）复制同一份内联 HTML，运营粘进公众号编辑器即可（解决"粘过去变纯文本/掉格式"）。
> 一份内联 HTML 两用，无需两套逻辑。

---

## 4. 设计

### 4.1 数据流
```
编辑页：Lexical 富文本（编辑区套微光玫瑰样式，所见即所得）
          │ 存 Lexical JSON（body 字段）
          ├─[预览] → lexical→公众号内联HTML（与发布同一份）→ 新标签看最终效果
          ├─[提交审核] → 状态流转
          └─[发布] → 内联HTML → ①draft/add(图换微信URL) 或 ②复制到公众号(双剪贴板)
```

### 4.2 内容字段改造（ChannelContents）
`bodyMarkdown`(textarea) → **`body`(Lexical richText)**。其余字段不变。本地无生产数据，直接重建。

### 4.3 `src/lib/wechat-theme.ts`（设计令牌单一真源）
把 `render.py` 的颜色/字体/各元素样式移植成 TS，**只含 §3.3 白名单属性**，无 `var()`/`calc()`（直接字面值）。导出每个语义元素（根容器/段落/章节标题/步骤/眉标/列表/列表项/图片/题注/提示卡/分隔线/行内码/加粗/斜体/链接/CTA）的内联样式串。

### 4.4 `src/renderers/lexical-to-wechat.ts`（转换层）
`Lexical JSON → 公众号内联 HTML`，严格按 §3：
- 用 `@payloadcms/richtext-lexical` 的 `convertLexicalToHTML` + 自定义 HTMLConverters，逐节点产出 **section/p + 内联 white-list 样式**。
- 列表用文本前缀；图片用 figure/figcaption；引用→提示卡；标题前缀染玫瑰（沿用 skill 约定）；文末追加 CTA。
- 输出**绝不含** `<style>`/class/`<div>`/黑名单 CSS。
- 提供 `renderToInlineHtml(lexicalJSON, opts)` 给预览、发布、复制三处共用。

### 4.5 编辑器微光玫瑰主题
给 ChannelContents 的 `body` 字段配置 Lexical 编辑器（标题 H2/H3/H4、加粗、斜体、列表、引用、链接、上传图片工具）；用一份 admin CSS（scoped 到编辑器容器）让编辑区视觉接近微光玫瑰（暖灰正文/玫瑰强调/宋体标题）。**注意：编辑器外观靠 class CSS（仅编辑时所见）；最终公众号产物靠 §4.4 内联 HTML——两者同令牌、视觉一致，但输出永远走内联。**

### 4.6 一键预览（预览=最终）
- `admin.preview` 配置预览 URL；新增 `src/app/(app)/preview/channel-contents/[id]/page.tsx`：取 body → `renderToInlineHtml` → 返回整页（**就是发布会用的同一份内联 HTML**）。登录态校验。
- 编辑页"预览"按钮开新标签即见公众号最终效果（因为用的就是最终 HTML，所以预览=所得）。

### 4.7 发布链路（WechatPublisher）
输入改 `body`(Lexical)→`renderToInlineHtml`；正文图取自 Lexical upload 节点（媒体库）→ 逐张 `uploadimg` 换微信 URL 替换进 HTML；封面/token/草稿/幂等/状态流转不变。额外提供"复制到公众号"按钮（§3.5 通道 2）。

### 4.8 Lexical → 公众号 元素映射
| Lexical | 输出（§3 规范） | skill 约定 |
|---|---|---|
| heading h2 | `<section>` 包章节标题（宋体大字，内联） | `一、`/`1.` 前缀染玫瑰 |
| heading h3 | 步骤标题（内联） | `第一步`/`方式一`/数字前缀染玫瑰 |
| heading h4 | 眉标（小号玫瑰，内联） | — |
| paragraph | `<p>`（暖灰 16px/1.9 + letter-spacing） | — |
| bold/italic/code/link | strong/em/code/a（内联白名单） | — |
| list | `<ul>/<ol><li>`，**符号文本前缀** | — |
| quote | blockquote→**提示卡**（玫瑰左线+淡底，内联） | `**建议：**`染玫瑰 |
| upload image | `<figure><img width 内联/><figcaption>alt</figcaption></figure>` | 文件名式 alt 不配题注 |
| 文末 | CTA 胶囊（内联，pointer-events:none） | renderConfig |

## 5. 范围（YAGNI）
**做**：公众号富文本所见即所得编辑、微光玫瑰转换层（严守 §3）、预览(=最终)、发布(API+复制双通道)、测试。
**不做**：实时 iframe Live Preview、旧 Markdown 导入、小红书、编辑器外观像素级还原（§4.5 做到视觉接近即可）。

## 6. 文件结构（增量）
```
src/lib/wechat-theme.ts                  # 新增：白名单内联样式令牌(TS 真源)
src/renderers/lexical-to-wechat.ts       # 新增：Lexical→公众号内联HTML（renderToInlineHtml）
src/renderers/wechat.ts                  # 改：WechatRenderer 调 lexical-to-wechat
src/collections/ChannelContents.ts       # 改：bodyMarkdown→body(richText) + 编辑器配置/preview
src/publishers/wechat.ts                 # 改：取 body(Lexical)→内联HTML；正文图取自 upload 节点
src/app/(app)/preview/channel-contents/[id]/page.tsx   # 新增：预览页(=最终HTML)
src/components/CopyToWechat.tsx (或 admin UI)           # 新增：复制到公众号(双剪贴板)
tests/lexical-to-wechat.test.ts          # 新增：格式兼容快照(无style/class/div、全内联、无黑名单、列表前缀)
（publisher.test.ts 改：body 改 Lexical 输入）
scripts/render.py                        # 保留：旧 markdown 导入备用
```

## 7. 测试策略
- **格式兼容测试（关键）**：转换层输出断言——**不含 `<style>`/`class=`/`<div`/`id=`**；不含黑名单 CSS（position/flex/float/var(/calc(/::）；所有可见块带内联 style；列表项含文本前缀(`• `/`1. `)；图片是 figure+width；最外层是根 section。
- 元素映射快照：标题前缀染玫瑰、引用→提示卡、alt→题注、文末 CTA。
- `publisher.test.ts`：Lexical body → 发布链路（转换→图替换→草稿）不变。
- 预览页：登录可访问/未登录拒绝；产物 = 发布 HTML。
- Playwright：编辑→预览→（测试号）发布/复制 走查；iOS+安卓微信肉眼验（上线前）。

## 8. 调研来源（已存档结论于 §3）
微信官方 draft/add 文档与开发者社区"content 样式乱/格式丢失"帖、doocs/md 源码（juice 内联 / section / var·calc 求值 / 列表文本前缀 / figure / 双剪贴板）、腾讯云样式内联化攻略等。核心：**全内联 + 白名单 + section/p + 列表前缀 + 图走微信URL + 双剪贴板**。
