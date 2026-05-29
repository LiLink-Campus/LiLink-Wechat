# LiLink 内容中台 · 第一期（公众号闭环）

自部署的多平台内容发布中台。**第一期**实现：多用户协作 + 媒体库 + 公众号排版 + 公众号官方 API 建草稿发布。
设计与规划见 `../docs/superpowers/specs/2026-05-29-lilink-content-platform-design.md` 与 `../docs/superpowers/plans/2026-05-29-phase1-wechat-content-platform.md`。

## 技术栈

Next.js 16 + Payload 3.85（内嵌于 Next，自带后台与媒体库）+ PostgreSQL + TypeScript(ESM)。
排版复用仓库根 `skill/scripts/render.py`（已拷至 `scripts/render.py`）。测试 Vitest，部署 Docker Compose。

## 本地开发

```bash
# 1. 起一个 Postgres（容器，映射宿主 5433 避免与本机 5432 冲突）
docker run -d --name lilink-pg \
  -e POSTGRES_USER=lilink -e POSTGRES_PASSWORD=lilink -e POSTGRES_DB=lilink \
  -p 5433:5432 postgres:16

# 2. 配置环境变量
cp .env.example .env
#   - DATABASE_URI=postgres://lilink:lilink@localhost:5433/lilink
#   - PAYLOAD_SECRET=$(openssl rand -hex 32)
#   - WX_APP_ID / WX_APP_SECRET（公众号发布联调时填）

# 3. 启动（首次会自动建表），访问 http://localhost:3000/admin 创建首个运营账号
npm run dev
```

> 改动 collection 后重跑 `npx payload generate:types` 刷新类型；
> 管理面板自定义组件映射由 `npx payload generate:importmap` 生成。

## 内容模型

- **Posts（选题）**：一个创作单元，含选题名/主题/标签/负责人/共享媒体。
- **ChannelContents（渠道稿）**：选题在某平台的具体稿件 + 独立状态机。第一期实现 `wechat`，预留 xiaohongshu/x/douyin/bilibili。
- **Media（媒体库）**：图/音/视频上传（upload collection，生产接云对象存储）。
- **Users（运营）**：第一期"三人全能"，靠状态流转协作。

## 协作工作流

渠道稿状态机：`draft → in_review → approved → published`（`in_review → draft` 打回）。
- 流转走 `POST /api/channel-contents/:id/transition`（body `{to, reason?}`）。
- `status`/`publishResult`/`transitionLog` 有字段级 access 保护，只能经 endpoint 流转，不能直接改。
- 后台列表按 status 分列即为协作队列。

## 公众号发布链路

`POST /api/channel-contents/:id/publish`（需 `approved` 状态）：
封面图 → `material/add_material` 得 thumb_media_id；正文图 → `media/uploadimg` 换微信 URL 并替换 markdown；
`render.py`（`--no-embed-images`）渲染内联 HTML → `draft/add` 建草稿 → 回填 `publishResult` 并置 `published`。
**第一期止于建草稿，群发由人在公众号后台点**（最稳、防误发）。幂等：已建草稿不重复建。

## 部署（Docker Compose）

```bash
cd docker
docker compose up -d --build   # app(3000) + postgres(宿主 5434)
```
容器内 `DATABASE_URI=postgres://lilink:lilink@postgres:5432/lilink`。**VPS 固定公网 IP 需加入公众号后台 API 白名单**（微信要求）。

## 测试

```bash
npx vitest run        # 单元测试（需 DB 的集成测试在无 DATABASE_URI 时自动跳过）
npx tsc --noEmit      # 类型检查
```

## 第一期已知限制（经 codex 三轮 review 确认，按当前威胁模型可接受，后续期强化）

适用威胁模型：**自部署 + 小团队（3 人互信运营）+ 图片源为自有公网云对象存储**。

- **媒体需公网 https URL**：发布时正文图/封面只接受 `http(s)` 绝对 URL（已挡本地文件读取 LFI、直连内网 IP 的 SSRF）。故媒体库应使用云对象存储（OSS/COS/R2，绝对 https url），或为 Payload 配置 `serverURL` 使 `media.url` 为绝对地址；否则封面取不到、发布会因缺 thumb_media_id 失败。
- **SSRF 仅按 IP/主机名拦截，不防 DNS 重绑定**：`isBlockedHost` 拦截环回/私有/链路本地/唯一本地/通配/IPv4-mapped/纯数字主机名，但不做 DNS 解析，无法防"域名解析到内网 IP"。生产如需更强隔离，建议在网络层限制出站或改用域名 allowlist。
- **发布并发为乐观双检、非原子锁**：第一期低并发足够；高并发下完整防重复建草稿需 DB 事务/条件 CAS（后续）。
- **超大图片**：按 Content-Length 预检 + 下载后 byteLength 兜底（10MB 上限）；无长度声明的响应仍会先完整载入再拦截（流式累积留后续）。

## 后续期（仅占位，各自单独 spec）

二期小红书（卡片排版 + Playwright 常驻 worker + 半自动）、三期抖音/B站视频（ffmpeg 转码）、未来 X 等（实现 Renderer+Publisher 接口即接入）。
