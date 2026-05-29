# LiLink 内容发布系统 — 设计文档（Spec）

- **状态**：第一期设计已定稿，进入实现
- **日期**：2026-05-29
- **范围**：多平台内容发布中台；本文档覆盖整体蓝图 + 第一期（公众号闭环）详细设计
- **说明**：本文档**完整保留**从产品规划到第一期设计的全部记录（决策日志、开源调研、架构蓝图、详细设计），作为项目根本依据与实现参照。

---

## 0. 文档结构

- **Part A — 规划记录**：项目愿景、决策日志、开源方案调研（保存性质，记录"为什么这么定"）
- **Part B — 设计规格**：整体架构蓝图、第一期详细设计、技术栈与部署（实现依据）

---

# Part A — 规划记录

## 1. 项目愿景与诉求

做一个**完整的 LiLink 内容发布系统**，不局限于微信：

1. 管理**公众号文章**和**小红书帖子**，包含**排版系统**和**一键发布**功能。
2. 管理系统能上传**音频、图片、视频**等流媒体。
3. 未来可拓展到**抖音、B站**等视频形式，以及 **X(Twitter)** 等其它社交媒体。
4. 团队当前有 **3 人做运营**，需要**草稿 → 检查 → 发布**的团队协作队列。

核心价值主张：**一个平台无关的内容中台**，把"内容生产 / 排版 / 媒体资产 / 协作"沉淀为稳定资产，各发布平台只是最外层可插拔的适配器——平台风控波动（尤其小红书）被隔离在最外层，核心资产永远稳定。

## 2. 规划决策记录（Brainstorming Log）

按 brainstorming 流程逐项确认，记录如下（含选项与最终选择）：

| # | 决策点 | 选择 | 理由 |
|---|---|---|---|
| 1 | **产品形态** | **自部署内容中台** | 带 Web 后台，统一管各平台内容草稿 + 媒体库（图/音/视频），内置排版预览和发布。最贴合"管理系统 + 上传媒体"诉求。（备选：轻量个人工具 / 对外 SaaS，均不合适） |
| 2 | **技术基座** | **Next.js + Payload** | Payload CMS(MIT) 内嵌 Next.js，自带后台和媒体库，配 Postgres。生态最新、媒体能力强、零 license 顾虑。（备选：Strapi / Python 自研） |
| 3 | **第一期范围** | **公众号闭环优先** | 中台骨架 + 媒体库 + 公众号（复用现有微光玫瑰排版 + 官方 API 发布）。合规、复用现有资产、最快跑通完整链路。后扩展为含**多用户协作工作流**。 |
| 4 | **公众号现状** | **已认证，有 API 权限** | 能拿 access_token 调 `draft/add`。→ 第一期做"自动建草稿"半自动发布。 |
| 5 | **部署拓扑** | **Docker 一体化（VPS）** | Payload+Postgres+排版+未来 worker 全 `docker compose` 在一台 VPS。排版直接复用 Python `render.py`；未来加小红书常驻 Playwright worker 天然融入；不受 serverless 限制；**固定 IP 正好满足微信 API 白名单**。（备选：Vercel+Neon / 混合） |
| 6 | **协作角色** | **三人全能 + 状态流转** | 3 人都能写/审/发，不设权限差异，靠"草稿→检查→发布"状态流转协作。发布等外部动作给 UI 二次确认防误发。（备选：三角色可兼任 / 严格分离） |
| 7 | **可扩展性** | **Renderer / Publisher 插件化** | 渲染层、发布层各定义统一接口，每平台一个模块注册进 registry。**接入 X = 写一个 Renderer + 一个 Publisher + 注册，核心不动**。内容模型平台无关。 |
| 8 | **内容模型** | **"选题 + 渠道稿"两层** | 一个选题(Post)下挂多个平台渠道稿(ChannelContent)，各平台单独成稿（可互相复制做起点），共享选题元数据和媒体库。状态机挂在渠道稿层面（各平台发布进度独立）。 |

## 3. 开源方案调研结论（2026-05 核实）

### 3.1 多平台一键发布

| 项目 | 公众号+小红书 | 机制 | 维护 | License | 结论 |
|---|---|---|---|---|---|
| [MultiPost](https://github.com/leaperone/MultiPost-Extension) | ✅ 都支持，30+ 平台 | 浏览器扩展，往各平台官方编辑器**注入填充**（借已登录会话，不抓 cookie/不调 API） | 活跃 | Apache-2.0 | **最值得借鉴**；很可能是用户记忆中"公众号+小红书一键发布"的那个仓库 |
| [Wechatsync](https://github.com/wechatsync/Wechatsync) | ❌ 无小红书 | 借登录态调各平台官方 API | 活跃, 5.6k⭐ | GPL-3.0 | 老牌但偏图文博客 |
| [ArtiPub](https://github.com/crawlab-team/artipub) | ❌ | 老版 Puppeteer 模拟登录 | 断更 4 年后 2025 重写 | BSD | **勿用** |

### 3.2 排版编辑器
- [doocs/md](https://github.com/doocs/md)（12.7k⭐, **WTFPL** 零法务负担）：公众号 Markdown 排版最佳参照——**内联样式 HTML**（公众号会剥离 `<style>`，必须内联）+ 多图床 + Docker 自部署。与我们已有的 `lilink-formatter` 思路一致。

### 3.3 内容管理后端（CMS）
- **[Payload](https://github.com/payloadcms/payload)**（42.7k⭐, **MIT**, Next.js 原生）：媒体库强、字段级 hooks/权限、PG/Mongo、可 Docker/Vercel 部署。**选定**。
- [Strapi](https://github.com/strapi/strapi)（生态最大，核心 MIT，`ee/` 企业版非 MIT）、[Directus](https://github.com/directus/directus)（MSCL 有商用门槛）、[Ghost](https://github.com/TryGhost/Ghost)（定位博客/邮件，**不选**）。

### 3.4 小红书方案 + 合规风险（二期相关）
- [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)（13.9k⭐, Go, 浏览器自动化 + 扫码登录态，支持发布）：二期发布执行器首选。
- [ReaJason/xhs](https://github.com/ReaJason/xhs)（MIT, Python, 协议逆向 + 签名）：适合只读数据，发布维护成本高。
- ⚠️ **合规**：小红书**无开放发布 API**，所有方案本质违反平台规则、有封号风险；2025 新规专打"AI 批量内容/站外导流"。→ 二期当高风险渠道，**半自动 + 人工兜底**，一机一号一 IP、控频、内容去同质化、禁站外导流。

### 3.5 媒体存储
- ⚠️ **MinIO 社区版 2026-02 已归档停止维护**，勿再默认使用。
- 用**云对象存储**（S3 / 阿里云 OSS / 腾讯云 COS / Cloudflare R2）；图片处理 `sharp`，音视频 `ffmpeg`（三期）。

### 3.6 公众号官方 API（合规，第一期核心）
- `draft/add`（建草稿）：需 access_token；正文图片**必须是微信域名 URL**。
- 正文配图：`media/uploadimg`（不占素材库限制，返回可在正文用的 URL）。
- 封面图：`material/add_material`（永久素材，返回 `thumb_media_id`，`draft/add` 需要）。
- `content_source_url`（"阅读原文"）字段可程序化设为 `lilink.top`。
- 调用方 IP 需在公众号后台白名单 → **VPS 固定 IP 满足**。

---

# Part B — 设计规格

## 4. 整体架构蓝图

### 4.1 全景图

```
                  ┌────────────────────────────────────────────────┐
                  │        LiLink 内容中台  (Payload + Next.js)      │
   ┌─────┐        │  ┌──────────────────────────────────────────┐  │
   │运营×3│─后台─▶│  │ 协作工作流：草稿→检查→发布 队列 + 角色权限   │  │
   │作者  │        │  └──────────────────────────────────────────┘  │
   │审核  │        │  ┌──────────┐          ┌────────────────────┐  │
   │发布  │        │  │ 内容模型  │◀────────▶│   媒体资产库         │  │
   └─────┘        │  │ 选题+渠道稿│          │  图/音/视频 → 云存储  │  │
                  │  └────┬─────┘          └────────────────────┘  │
                  │  ┌────▼──────────────────────┐  ◀── 插件注册表  │
                  │  │ 渲染层 Renderer（可插拔）   │   新增平台 =      │
                  │  │ 公众号│小红书│X│视频│…      │   实现接口+注册   │
                  │  └────┬──────────────────────┘   核心不动        │
                  │  ┌────▼──────────────────────┐                  │
                  │  │ 发布层 Publisher（可插拔）  │                  │
                  │  └─┬────────┬────────┬────────┘                  │
                  └────┼────────┼────────┼──────────────────────────┘
                  公众号API   小红书    X / 抖音 / B站
                  (一期)     worker(二期)  (未来，实现接口即接入)
```

### 4.2 核心抽象：内容 → 渲染 → 发布 流水线

- **内容（平台无关）**：选题 + 各平台渠道稿 + 共享媒体资产。
- **渲染 Renderer（可插拔）**：把渠道稿适配成目标平台形态（公众号 → 内联样式 HTML；小红书 → 卡片图；X → 短文/线程）。统一接口 + registry。
- **发布 Publisher（可插拔）**：把渲染产物投递到目标平台（公众号 → 官方 API；小红书 → 浏览器自动化 worker；X → API）。统一接口 + registry。

**可扩展性硬保证**：新增平台 = 实现 `Renderer` + `Publisher` 两个接口 + 在 registry 注册，**不动核心内容模型与工作流**。

### 4.3 三期路线

| 期 | 内容 | 关键新增能力 | 风险 |
|---|---|---|---|
| **一期（本 spec）** | 中台骨架 + 媒体库 + 公众号闭环 + 多用户协作工作流 | Payload 内容模型、媒体库→云存储、复用 render.py 排版、微信官方 API 发布、状态机+队列、账号体系 | 低（全合规） |
| 二期 | 小红书 | 卡片式排版 Renderer、Playwright 常驻 worker、扫码登录态、半自动发布 | 中（封号，半自动+人工兜底） |
| 三期 | 抖音 / B站视频 | 音视频转码(ffmpeg)、视频发布适配器 | 视平台而定 |
| 未来 | X 等 | 实现 Renderer+Publisher 接口即接入 | — |

**每期各走一遍 spec → 计划 → 实现。** 二三期仅在蓝图占位，本 spec 不展开。

---

## 5. 第一期详细设计

### 5.1 范围与目标

**目标**：3 人运营团队能在自部署后台里，完成"建选题 → 写公众号稿（含媒体）→ 排版预览 → 协作审核 → 一键建公众号草稿"的完整闭环。

**包含**：
- 多用户账号体系（Payload auth，三人同权限）
- 内容模型：选题(Post) + 渠道稿(ChannelContent)，第一期实现公众号渠道稿
- 媒体资产库：上传图/音/视频到云对象存储（第一期图片为主）
- 排版渲染：Renderer 接口 + 复用 `render.py` 的公众号渲染器
- 发布：Publisher 接口 + `WechatPublisher`（官方 `draft/add` 链路）
- 协作工作流：渠道稿状态机 + 队列视图
- 错误处理、测试

**不包含（YAGNI，见 5.9）**：小红书、视频转码、X、定时发布、复杂权限矩阵、对外多租户。

### 5.2 内容模型（选题 + 渠道稿）

Payload Collections：

**`users`**（Payload auth 内建扩展）
- `name`、`email`、`role`（第一期统一 `operator`，预留 `admin`）

**`media`**（Payload upload collection，接 S3 storage adapter）
- 文件 → 云对象存储
- `type`：`image | audio | video`
- `alt`（图片题注，喂排版）、`caption`、`credit`（来源）
- `width/height/duration`（元数据）
- 反向关联：被哪些渠道稿引用

**`posts`**（选题 / 创作单元）
- `title`（内部选题名）、`topic`、`tags[]`
- `owner`（relationship → users）
- `sharedAssets`（relationship → media，多选，选题级共享素材）
- `notes`（选题备注）
- `channels`（join → channelContents，一个选题下的各平台渠道稿）

**`channelContents`**（渠道稿，挂在选题下）
- `post`（relationship → posts）
- `platform`：`wechat`（第一期）| 预留 `xiaohongshu | x | douyin | bilibili`
- **公众号字段组**（platform=wechat 时）：
  - `wxTitle`（公众号标题）、`wxAuthor`、`wxDigest`（摘要）
  - `bodyMarkdown`（正文 Markdown，喂 render.py）
  - `coverImage`（relationship → media，封面图）
  - `sourceUrl`（阅读原文，默认 `https://lilink.top`）
  - `renderConfig`（主题/CTA 等，对应 render.py 选项）
- `status`：状态机（见 5.3）
- `assignee`（relationship → users，当前处理人）
- `renderedHtmlPreview`（渲染产物缓存，用于预览）
- `publishResult`（group）：`wxDraftMediaId`、`publishedAt`、`lastError`、`stage`（`none|draft_created|mass_sent`）

> **设计要点**：公众号字段用 Payload 的条件字段（`admin.condition` 按 `platform` 显隐），为未来平台的不同字段结构留位。第一期只实现 wechat 分支。

### 5.3 协作工作流（状态机 + 队列 + 角色）

**状态机**（挂在 `channelContents.status`）：

```
  draft ──提交──▶ in_review ──通过──▶ approved ──发布──▶ published
   ▲                  │
   └──── 打回 ◀────────┘ (changes_requested → 回 draft)
```

- 状态值：`draft | in_review | approved | published`；打回用 `in_review → draft` 流转并记录原因。
- **三人全能**：无硬权限隔离，任意运营可推进任一状态；状态转换通过自定义 Payload endpoint/UI 动作触发，记录操作人和时间（用 Payload versions + 审计字段）。
- **发布动作二次确认**：`approved → published`（实际触发微信 API）在 UI 上需二次确认，防误发；幂等保护见 5.7。

**协作队列视图**：后台一个看板/列表，按 `status` 分列——「待写(draft) / 待审(in_review) / 待发(approved) / 已发(published)」，每条显示平台、负责人、选题。第一期用 Payload admin 列表 + 状态分组/过滤实现（必要时自定义 admin 视图组件）。

### 5.4 排版渲染（Renderer 接口 + 复用 render.py）

**Renderer 接口**（TS）：
```ts
interface Renderer {
  platform: string;
  render(input: RenderInput): Promise<RenderResult>;
}
// RenderInput: { markdown, title, assets[], config }
// RenderResult: { html?, images?, warnings[] }
```

**`WechatRenderer`**：通过子进程调用 `skill/scripts/render.py`（容器内带 Python3）。
- **预览模式**：base64 内联（现有默认），后台实时预览 / 人工粘贴兜底。
- **发布模式**：`--no-embed-images`，图片 src 已被中台替换为微信 URL（见 5.5），render.py 输出内联样式 HTML 作为 `draft/add` 的 content。
- `render.py` 本就支持 `--no-embed-images` 且对网络图不内联，**几乎零改动**；改动主要是中台侧的子进程封装与图片编排。

**Renderer Registry**：`renderers/index.ts` 注册 `{ wechat: WechatRenderer }`，按 `platform` 取用。

### 5.5 公众号发布链路（WechatPublisher）

**Publisher 接口**（TS）：
```ts
interface Publisher {
  platform: string;
  publish(input: PublishInput): Promise<PublishResult>;
}
```

**`WechatPublisher` 链路**：

```
 approved 渠道稿
   ├─ 正文配图 ──media/uploadimg──▶ 微信图片URL ─┐
   ├─ 封面图   ──material/add_material──▶ thumb_media_id ─┤
   └─ markdown ──(把图 src 换微信URL)──▶ WechatRenderer ──▶ 正文HTML
                                                            │
        组装 article{ title, author, digest, content,      │
        thumb_media_id, content_source_url = lilink.top }◀──┘
                          │
                     draft/add ──▶ 草稿 media_id ──▶ 写回渠道稿(stage=draft_created)
                          │
            人工在公众号后台点「群发」(第一期到此为止，最稳) ／ 预留 freepublish 全自动
```

- **access_token 管理**：缓存复用（2h 有效），过期自动刷新；集中在 `wechat/token.ts`。
- **第一期止于"建草稿"**：群发由人在公众号后台点（最稳、防误发）；`freepublish/submit` 全自动留接口、不默认开。

### 5.6 媒体库

- Payload `media` upload collection + **`@payloadcms/storage-s3`** adapter 接云对象存储（S3 兼容：OSS/COS/R2 均可）。
- 第一期**图片为主**（公众号用图）；音频/视频**能上传能存储、不转码**（转码留三期）。
- 图片可选 `sharp` 压缩/生成尺寸。
- 本地开发可用 Docker 起一个 S3 兼容服务或直接配云存储；配置通过环境变量。

### 5.7 错误处理

- **微信错误透出**：`errcode/errmsg`（违规词、超字数 2万、token 过期 40001、IP 不在白名单 40164）原样展示到后台，附人话解释。
- **图片上传失败**：可重试，标记是哪张失败，不阻塞整体（记录部分失败）。
- **发布幂等**：以渠道稿 `publishResult.stage` 为准，已 `draft_created` 的重复点击拦截，**绝不重复建草稿**；用乐观锁/状态校验。
- **状态区分**：`draft_created`（草稿已建）vs `mass_sent`（已群发），UI 清晰显示。

### 5.8 测试策略

- **render.py**：用 `skill/examples/sample.md` 做渲染快照测试（保证排版不回归）。
- **微信 API**：单元测试 **mock** 微信接口（token/uploadimg/add_material/draft）；集成测试用**测试公众号**（沙箱）。
- **状态机**：单元测试合法/非法流转。
- **媒体上传**：mock 云存储 + 微信素材。
- **E2E**：跑通"建选题 → 写公众号稿 → 审核 → 发布到草稿箱"一条线（对测试号）。
- 框架：Vitest（单元）+ Playwright（E2E，复用其能力）。

### 5.9 不做什么（YAGNI）

- ❌ 小红书 / 视频 / X（二期及以后）
- ❌ 音视频转码（三期）
- ❌ 定时发布、自动群发（留接口不默认开）
- ❌ 复杂 RBAC 权限矩阵（三人全能）
- ❌ 对外多租户 / SaaS 化
- ❌ AI 写作（排版与写作分离，写作另归写作风格指引）

---

## 6. 技术栈与项目结构

**技术栈**：Next.js (App Router) + Payload 3.x + PostgreSQL + TypeScript；`@payloadcms/storage-s3` 媒体存储；`sharp` 图片处理；Python3 `render.py`（排版子进程）；Vitest + Playwright 测试；Docker + docker compose 部署。

**目录结构（建议）**：
```
app/                      # Next.js + Payload 应用
  (payload)/              # Payload admin 与 API 路由
  (app)/                  # 自定义前端页面（队列视图等，按需）
src/
  collections/            # Users, Media, Posts, ChannelContents
  renderers/              # Renderer 接口 + WechatRenderer + registry
  publishers/             # Publisher 接口 + WechatPublisher + registry
  wechat/                 # 微信 API 客户端：token, uploadimg, material, draft
  workflow/               # 状态机定义与流转校验
  lib/                    # 子进程封装(render.py)、错误类型、工具
payload.config.ts
scripts/render.py         # 复用现有排版脚本（从 skill/scripts 引入或符号链接）
docker/
  Dockerfile              # Node + Python3 运行时
  docker-compose.yml      # app + postgres (+ 可选 s3)
tests/
docs/superpowers/specs/   # 本文档所在
docs/superpowers/plans/   # 实现计划
```

> 现有仓库的 `articles/`、`skill/`（含 `render.py` 与写作风格指引）保留；新系统作为仓库内的一个应用承载，复用 `render.py`。

## 7. 部署（Docker 一体化）

- `docker compose`：`app`（Next.js+Payload，运行时含 Node + Python3）+ `postgres`。
- 媒体走云对象存储（环境变量配置 endpoint/bucket/key）。
- 微信凭据（appId/secret）、数据库、存储均通过环境变量注入；`.env.example` 提供模板。
- VPS 固定 IP 加入公众号后台 API 白名单。

## 8. 开放问题 / 后续

- 云对象存储具体选型（OSS/COS/R2）——部署时按用户资源定，代码用 S3 兼容接口不锁定。
- 公众号 appId/secret、测试号——实现完成后由用户提供以做真机联调。
- 队列视图：先用 Payload admin 原生能力，若不够再做自定义 React 视图。

---

*本文档随项目演进持续更新；二、三期将各自新增 spec。*
