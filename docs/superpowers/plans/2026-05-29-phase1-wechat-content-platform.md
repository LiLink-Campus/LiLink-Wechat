# 第一期：公众号闭环内容中台 — 实现计划

> **For agentic workers:** 本计划由 dynamic workflow 多子代理执行 + codex 详细 review 迭代。任务标注**并行分组与依赖**，给出**接口契约 + 关键骨架 + 验收标准**。实现子代理须用 context7 MCP 查 Payload 3.x 最新 API 校准写法。

**Goal:** 3 人运营团队能在自部署后台完成"建选题 → 写公众号稿（含媒体）→ 排版预览 → 协作审核 → 一键建公众号草稿"的完整闭环。

**Architecture:** Next.js(App Router) + Payload 3.x 单体应用，内容模型为「选题 Post + 渠道稿 ChannelContent」两层；渲染层(Renderer)/发布层(Publisher)各定义统一接口 + registry，第一期实现 wechat 插件；排版复用 Python `render.py` 子进程；微信走官方 `draft/add` 链路。Docker(Node+Python)+Postgres 一体部署。

**Tech Stack:** Next.js, Payload 3.x, PostgreSQL, TypeScript, @payloadcms/db-postgres, @payloadcms/storage-s3, sharp, Python3(render.py), Vitest, Docker Compose。

---

## 文件结构

```
app/                         # create-payload-app 生成的 Next.js+Payload 入口（(payload) 路由组）
src/
  payload.config.ts          # 汇聚点：注册 collections / db / storage / plugins【串行集成，勿并行改】
  collections/
    Users.ts                 # auth；role: operator|admin
    Media.ts                 # upload；type image|audio|video；alt/caption/credit
    Posts.ts                 # 选题：title/topic/tags/owner/sharedAssets/notes
    ChannelContents.ts       # 渠道稿：post/platform/wx字段组/status/assignee/publishResult
  workflow/
    states.ts                # 状态机：常量 + 合法流转表 + 校验函数
    transition.ts            # 流转执行（写 status + 审计字段）
  renderers/
    types.ts                 # Renderer 接口 + RenderInput/RenderResult
    wechat.ts                # WechatRenderer：封装 render.py 子进程
    index.ts                 # registry：{ wechat: WechatRenderer }
  publishers/
    types.ts                 # Publisher 接口 + PublishInput/PublishResult
    wechat.ts                # WechatPublisher：uploadimg→add_material→render→draft/add
    index.ts                 # registry：{ wechat: WechatPublisher }
  wechat/
    token.ts                 # access_token 获取+缓存(2h)
    client.ts                # uploadimg / add_material / draft.add 封装 + 错误透出
    errors.ts                # 微信 errcode→人话映射
  lib/
    runRenderPy.ts           # 子进程调用 render.py 的通用封装
  endpoints/
    publish.ts               # Payload custom endpoint：触发渠道稿发布（幂等）
    transition.ts            # Payload custom endpoint：状态流转
scripts/render.py            # 复用：从 skill/scripts/render.py 拷入（保持可独立运行）
docker/
  Dockerfile                 # node:22 + python3 运行时
  docker-compose.yml         # app + postgres
.env.example
tests/
  renderer.test.ts  publisher.test.ts  workflow.test.ts  wechat-client.test.ts
  e2e/publish-flow.spec.ts
```

---

## 执行编排（workflow 用）

- **Phase 0（串行打底，主循环做）**：T0 脚手架——项目能 `next dev` 起来、Payload admin 可访问、Postgres 连上。
- **Phase 1（并行）**：T1 collections、T2 renderer、T3 wechat client、T4 workflow 状态机、T7 docker。彼此改不相交文件。
- **Phase 2（依赖前序）**：T5 publisher（依赖 T2,T3）、T6 endpoints+队列视图（依赖 T1,T4）。
- **Phase 3（集成，串行）**：T8 汇总注册到 payload.config、装依赖、起服务自检。
- **Phase 4**：codex 详细 review 每模块 → 迭代修复 → 测试。

---

## Task 0：脚手架打底（串行，基线）

**Files:** 整个 `app/` + `package.json` + `src/payload.config.ts` 雏形

- 用 `npx create-payload-app@latest` 选 **blank 模板 + PostgreSQL**，或手动建 Next.js 后加 Payload。生成在仓库内（与现有 `articles/`、`skill/` 并存）。
- 配置 `.env`：`DATABASE_URI`(postgres)、`PAYLOAD_SECRET`。
- **验收**：`pnpm dev`/`npm run dev` 启动，浏览器 `/admin` 出 Payload 登录/初始化页；Postgres 表创建成功。Docker 起一个 postgres 供本地用。

## Task 1：内容模型 collections（并行）

**Files:** `src/collections/{Users,Media,Posts,ChannelContents}.ts`

**接口契约/关键点：**
- `Users`：Payload auth collection；字段 `name`、`role`(select: operator|admin, 默认 operator)。
- `Media`：`upload: true`；字段 `type`(select image|audio|video)、`alt`、`caption`、`credit`、`width/height/duration`(number, admin readOnly)。
- `Posts`：`title`(text, required)、`topic`(text)、`tags`(array of text)、`owner`(relationship→users)、`sharedAssets`(relationship→media, hasMany)、`notes`(textarea)。
- `ChannelContents`：
  - `post`(relationship→posts, required)
  - `platform`(select: wechat|xiaohongshu|x|douyin|bilibili, 默认 wechat)
  - 公众号字段组（`admin.condition: platform==='wechat'`）：`wxTitle`(text)、`wxAuthor`(text)、`wxDigest`(textarea)、`bodyMarkdown`(textarea/code)、`coverImage`(relationship→media)、`sourceUrl`(text, 默认 https://lilink.top)、`renderConfig`(group: ctaUrl/ctaText/noCta)
  - `status`(select: draft|in_review|approved|published, 默认 draft, admin readOnly — 仅经流转 endpoint 改)
  - `assignee`(relationship→users)
  - `renderedHtmlPreview`(textarea, readOnly)
  - `publishResult`(group: wxDraftMediaId/publishedAt/lastError/stage[none|draft_created|mass_sent])
- **验收**：四个 collection 注册后 admin 能 CRUD；ChannelContents 的 wechat 字段按 platform 条件显隐。**测试**：Payload local API 建一条 Post + ChannelContent 成功。

## Task 2：Renderer 接口 + WechatRenderer（并行）

**Files:** `src/renderers/{types,wechat,index}.ts`、`src/lib/runRenderPy.ts`、`scripts/render.py`(拷贝)

**接口契约：**
```ts
// types.ts
export interface RenderInput { markdown: string; assets?: {src:string; wechatUrl?:string}[]; config?: {ctaUrl?:string; ctaText?:string; noCta?:boolean}; embedImages?: boolean }
export interface RenderResult { html: string; warnings: string[] }
export interface Renderer { platform: string; render(input: RenderInput): Promise<RenderResult> }
```
- `lib/runRenderPy.ts`：用 `child_process.execFile('python3', ['scripts/render.py', mdPath, ...opts])` 写临时 md（用 `$CLAUDE_JOB_DIR/tmp` 或 os.tmpdir）、读输出 html、清理。支持 `--no-embed-images`、`--cta-url`、`--cta-text`、`--no-cta`、`-o`。
- `wechat.ts`：`WechatRenderer` 实现 Renderer，platform='wechat'，调 runRenderPy。`embedImages=false` 时传 `--no-embed-images`。
- `index.ts`：`export const renderers = { wechat: new WechatRenderer() }`。
- **验收/测试**：`renderer.test.ts` 用 `skill/examples/sample.md` 内容 render，断言输出含内联 style、含 CTA；`--no-embed-images` 时不含 `data:image`。

## Task 3：微信 API 客户端（并行）

**Files:** `src/wechat/{token,client,errors}.ts`

**接口契约：**
```ts
// token.ts
export async function getAccessToken(appId:string, appSecret:string): Promise<string> // 缓存2h，过期刷新
// client.ts
export async function uploadContentImage(token:string, file:Buffer|string): Promise<{url:string}>        // media/uploadimg
export async function addPermanentImage(token:string, file:Buffer|string): Promise<{mediaId:string; url:string}> // material/add_material type=image → thumb_media_id
export async function addDraft(token:string, article:DraftArticle): Promise<{mediaId:string}>             // draft/add
export interface DraftArticle { title:string; author?:string; digest?:string; content:string; thumb_media_id:string; content_source_url?:string; need_open_comment?:number }
// errors.ts
export function explainWxError(errcode:number): string  // 40001 token失效 / 40164 IP白名单 / 45009 频率 等
```
- 所有调用检查返回 `errcode`，非 0 抛带 `explainWxError` 的错误。
- **验收/测试**：`wechat-client.test.ts` 用 mock fetch 测 token 缓存、各接口请求构造、errcode 抛错路径。

## Task 4：工作流状态机（并行）

**Files:** `src/workflow/{states,transition}.ts`

**接口契约：**
```ts
// states.ts
export type Status='draft'|'in_review'|'approved'|'published'
export const TRANSITIONS: Record<Status, Status[]> = {
  draft:['in_review'], in_review:['approved','draft'], approved:['published','in_review'], published:[]
}
export function canTransition(from:Status,to:Status):boolean
// transition.ts
export async function applyTransition(payload, id:string, to:Status, userId:string, reason?:string): Promise<void> // 校验+写status+审计
```
- **验收/测试**：`workflow.test.ts` 测合法流转通过、非法（draft→published）拒绝、打回(in_review→draft)记录 reason。

## Task 5：Publisher 接口 + WechatPublisher（依赖 T2,T3）

**Files:** `src/publishers/{types,wechat,index}.ts`、`src/endpoints/publish.ts`

**接口契约：**
```ts
export interface PublishInput { channelContent: any; wechat:{appId:string;appSecret:string} }
export interface PublishResult { draftMediaId:string; stage:'draft_created' }
export interface Publisher { platform:string; publish(input:PublishInput):Promise<PublishResult> }
```
- `WechatPublisher.publish` 链路：① 取 token ② 封面图 `addPermanentImage`→thumb_media_id ③ 正文图逐张 `uploadContentImage`→微信URL，替换 markdown 中 src ④ `WechatRenderer.render({embedImages:false})`→html ⑤ 组装 DraftArticle(content_source_url=sourceUrl) ⑥ `addDraft`→mediaId ⑦ 返回。
- `endpoints/publish.ts`：Payload custom endpoint `POST /api/channel-contents/:id/publish`；**幂等**：若 `publishResult.stage==='draft_created'` 直接返回不重发；成功后写回 `publishResult` 并经状态机置 published。
- **验收/测试**：`publisher.test.ts` mock wechat client + renderer，验证链路顺序、图片 src 替换、幂等拦截。

## Task 6：状态流转 endpoint + 队列视图（依赖 T1,T4）

**Files:** `src/endpoints/transition.ts`、ChannelContents admin 列表配置（按 status 分组/过滤）

- `transition.ts`：`POST /api/channel-contents/:id/transition` body `{to, reason?}`，调 `applyTransition`。
- 队列视图：第一期用 Payload admin 列表 `defaultColumns`(platform/status/assignee/post) + status 过滤预设；够用即可，不够再做自定义 React 视图。
- **验收**：admin 列表能按状态筛；调 transition endpoint 改状态生效。

## Task 7：Docker 一体化（并行）

**Files:** `docker/Dockerfile`、`docker/docker-compose.yml`、`.env.example`

- `Dockerfile`：基于 `node:22-bookworm`（含 apt 装 python3），`npm ci && npm run build`，`CMD npm start`。
- `docker-compose.yml`：`app`(build, ports 3000, env_file) + `postgres:16`(volume)。
- `.env.example`：`DATABASE_URI/PAYLOAD_SECRET/WX_APP_ID/WX_APP_SECRET/S3_*`。
- **验收**：`docker compose build` 成功；compose up 后 `/admin` 可访问（联调留待有凭据时）。

## Task 8：集成 + 自检（串行）

- 把 T1/T2/T3/T5/T6 的 collections、storage-s3、endpoints 注册进 `src/payload.config.ts`；装齐依赖（@payloadcms/storage-s3, sharp 等）。
- `npm run build` 通过、`npm run dev` 起服务、TypeScript 无错。
- 跑 Vitest 全绿；E2E（有测试号时）跑发布流。

---

## Self-Review（对照 spec 5.x）

- 5.2 内容模型 → T1 ✅　5.3 工作流 → T4+T6 ✅　5.4 渲染 → T2 ✅　5.5 发布链路 → T3+T5 ✅　5.6 媒体库 → T1(Media)+T8(storage-s3) ✅　5.7 错误处理 → T3(errors)+T5(幂等) ✅　5.8 测试 → 各 task 测试 + T8 E2E ✅
- 类型一致性：Renderer/Publisher/Status 接口在 types/states 中单一定义，后续引用一致。
- 无占位：脚手架型步骤给命令+验收（框架产物由子代理基于真实脚手架实现，codex 校准），非 TODO。
