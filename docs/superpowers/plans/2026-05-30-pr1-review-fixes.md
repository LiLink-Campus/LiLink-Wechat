# PR #1 Review 修复实现计划

> 承载流程：shipping-with-codex（Claude 实现 / Codex 评审）。本 plan 交 Codex 计划评审后再实现。

**Goal:** 修复 PR #1 双线 review（Claude 5 路 + Codex 独立终审）一致认定的 High/Medium/Low 问题，并补上项目缺失的最小 CI，使发布闭环在并发/重试/部署面下安全可合并。

**背景约束（已核实，影响方案可行性）:**
- Payload 3.85 + db-postgres。`payload.update({where})` 在适配器层是 **select-then-update（非原子）**，`docs.length` 不能用作 CAS 赢家判定（证据：`@payloadcms/drizzle/dist/updateMany.js:19-69`）。
- 真原子途径：`payload.db.drizzle` 跑单条条件 `UPDATE ... WHERE ... RETURNING id`（PG 单条 UPDATE 天然原子）。表 `channel_contents`，group 子字段在父表平铺为列（`publish_result_*`）。
- db-postgres 未显式配 `migrationDir`：dev 默认 push 自动同步 schema；生产需 `payload migrate`。新增字段/枚举值都受此约束 → 必须在 PR 描述里写明生产迁移步骤。
- 现有测试：vitest 97 passed / 6 skipped（6 个是 `collections.test.ts` 的 `describe.skipIf(!hasDb)` DB 集成测试），tsc clean。**无 CI**。
- publish endpoint 目前**没有前端发布按钮**（review 已确认），真实触发是脚本/手动调用 → 主要并发来源是**网络超时重试 / 反代重放**，不是双击。这不降低修复必要性，但影响测试侧重（重试幂等 > 高并发风暴）。

---

## 分批与 Touch surface

按相互独立、可单独验证的 commit 分 6 批。Heavy 核心是 Batch 2，其余为定点修复。

### Batch 1 — SSRF：补全 IPv6 内嵌 IPv4 绕过（High）

**问题（已复现）:** `wechat/client.ts` 的 `isBlockedHost` 放行 `http://[::127.0.0.1]`（IPv4-compatible，归一为 `[::7f00:1]`）与 NAT64 `http://[64:ff9b::7f00:1]`，二者可路由到内网/环回。八进制/十六进制/十进制 IP 经 Node `URL` 归一化已被现有点分判断挡住（非漏洞）。

**Files:**
- Modify: `platform/src/wechat/client.ts`（`isBlockedHost` 的 IPv6 分支）
- Test: `platform/tests/wechat-client.test.ts`（SSRF 黑名单补用例）

**Approach:** 重写 IPv6 判定，不再手写前缀清单。用 `node:net` 的 `isIP()` 确认是 IPv6 字面量后：
1. 提取内嵌 IPv4：匹配末段点分 IPv4（`::ffff:a.b.c.d`、`::a.b.c.d`、`64:ff9b::a.b.c.d`），或末两段十六进制（`::7f00:1`、`64:ff9b::7f00:1` → 还原 `127.0.0.1`），还原成点分后复用既有 IPv4 私网判定。
2. 纯 IPv6：保留现有 `::`/`::1`/`fe80::/10`/`fc00::/7` 判定，并补 NAT64 `64:ff9b::/96`（首段 `0x64` 且第二段 `0xff9b` 即拦）。
3. 任何"高位全 0（`::` 开头）+ 含内嵌 IPv4 段"一律按内嵌 IPv4 还原判，杜绝直接放行。

保持对 `fcdn.com`/`fd-xx.com` 合法域名不误伤（仅对 `net.isIP()>0` 的字面量套 IPv6 规则）。

**Tests（断言被拦 / 不误伤）:**
- 新增被拦（Codex Nit#13：用可直接粘贴的具体样例,不用占位 a.b.c.d）：`http://[::127.0.0.1]/a.jpg`、`http://[64:ff9b::7f00:1]/a.jpg`、`http://[64:ff9b::127.0.0.1]/a.jpg`、`http://[::ffff:7f00:1]/a.jpg`（十六进制写法 mapped）、`http://[::10.0.0.1]/a.jpg`、`http://[::192.168.1.1]/a.jpg`（IPv4-compatible 私网）。
- 回归不误伤：`https://fcdn.example.com`、`https://fd-assets.example.com`、`https://mmbiz.qpic.cn` 仍 resolve。

### Batch 2 — 发布并发原子化 + 草稿可恢复（High，核心，需 Codex 重点评审）

**问题:**
- #1 `publish.ts:140-177` 的 fresh 二次自检只缩小窗口、非原子锁。两个请求（重试/重放）可同时穿过 → 各自 `addPermanentImage` + `addDraft` → 微信草稿箱重复图文 + 重复占用永久素材配额（不可去重）。
- #2 `addDraft` 成功后才在 `publish.ts:180` 首次写库。若其后 `payload.update` 失败/进程崩，`wxDraftMediaId` 丢失，重试看不到它会再建一篇。

**Files:**
- Create: `platform/src/endpoints/publishLock.ts`（acquirePublishLock/releasePublishLock,集中 drizzle 访问 + 运行时 assert）
- Modify: `platform/src/collections/ChannelContents.ts`（publishResult 加 lockedAt + lockToken 字段）
- Modify: `platform/src/endpoints/publish.ts`（原子抢锁 + 抢锁后重读 + 条件释放 + 即时持久化 draftId）
- Modify: `platform/src/publishers/wechat.ts`（`publish` 增加 `onDraftCreated` 回调，建草稿成功即回调）
- Modify: `platform/src/publishers/types.ts`（`PublishInput` 增加可选 `onDraftCreated`）
- Modify: `platform/src/wechat/client.ts`（三个 fetch 加显式超时 < TTL,Codex#3）
- Test: `platform/tests/publisher.test.ts`（单元：抢锁链 mock / 即时持久化 / 条件释放）
- Test: `platform/tests/collections.test.ts`（DB 集成 skipIf(!hasDb)：**真实并发抢锁只一个 winner**）

**Approach（推荐方案：独立 TTL 锁字段 + lockToken + drizzle 原子条件 UPDATE）:**
> Codex 计划评审已修正以下要点（Blocker#1 key 写法、High#3 owner token、Medium#6 重读、#7 条件收窄、Low#12 封装）。

1. **锁字段**：`ChannelContents.publishResult` 加子字段 `lockedAt`（`type:'date'`）和 `lockToken`（`type:'text'`），均 `access.update:()=>false`、admin readOnly。语义=“发布中软锁 + 持有者令牌”，与业务 `stage` 解耦。

2. **封装 `acquirePublishLock()` / `releasePublishLock()`**（新文件 `src/endpoints/publishLock.ts`）：集中 drizzle 访问，运行时 assert `db.drizzle`、表、列存在。**关键（Codex Blocker#1）**：group 子字段的 Drizzle table **column key 是 dot-notation 带引号**（`'publishResult.lockedAt'`），不是 camelCase；实现时先 `Object.keys(table)` 实测确认真实 key 与列名（DB 列 `publish_result_locked_at`）。从 `@payloadcms/db-postgres` 导入 `sql`/helpers，不直接依赖 transitive `drizzle-orm`。

3. **抢锁（原子）**：取凭据后、调微信前，单条条件 UPDATE：
   ```ts
   // 列 key 经 Object.keys 实测确认（dot-notation）；这里示意逻辑
   const lockToken = crypto.randomUUID()
   const now = new Date(); const staleBefore = new Date(now.getTime() - LOCK_TTL_MS)
   const won = await db.update(t).set({ ['publishResult.lockedAt']: now, ['publishResult.lockToken']: lockToken })
     .where(and(
       eq(t.id, id),
       eq(t['status'], 'approved'),
       or(isNull(t['publishResult.lockedAt']), lt(t['publishResult.lockedAt'], staleBefore)),
       or(isNull(t['publishResult.stage']), eq(t['publishResult.stage'], 'none')), // Codex#7: 只收 none，不放行 mass_sent 等
     )).returning({ id: t.id })
   const isWinner = won.length > 0
   ```
   输家：重读 fresh → 走现有“幂等回包 / 局部失败修复 / 409”分支，绝不调微信。
   赢家：**抢锁成功后立即 `findByID` 重读 fresh（Codex#6）**，重新校验 platform/status 再传 publisher，而非用首读 cc。

4. **即时持久化 draftId（#2）**：`WechatPublisher.publish` 在 `addDraft` 成功瞬间 `await onDraftCreated?.(mediaId)` 再返回（Codex Low#10：callback 抛错则整体失败、走 catch 释放锁，draftId 已落库故重试可幂等修复）。endpoint 传入回调写 `publishResult:{ wxDraftMediaId, stage:'draft_created' }`。

5. **释放锁（带 owner 条件，Codex#3）**：成功回填、失败 catch 都用条件 UPDATE `WHERE id=X AND publish_result_lockToken = mine` 清 `lockedAt`/`lockToken`——只有持有者能释放，杜绝慢请求（超 TTL 被他人抢走后）误清新锁。崩溃未释放由 TTL 自愈。

6. **微信请求显式超时 < TTL（Codex#3）**：client.ts 的 addPermanentImage/uploadContentImage/addDraft 的 fetch 加超时（如 30s，已有 fetchImageBuffer 的 10s 模式可复用），确保单次发布远短于 LOCK_TTL（10min），避免正常慢请求触发 TTL 误判。

**Alternatives considered:**
- **复用 `stage` enum 加 `'publishing'` 值（Codex 调查 agent 推荐）**：改动更小，但 (a) 把瞬态锁塞进业务阶段 enum 是语义混用；(b) 崩溃残留 `publishing` 不会自愈，需额外清理逻辑或人工；(c) enum 加值生产迁移成本与加列相当。→ 取 TTL 锁字段，自愈 + 语义干净。**请 Codex 判断这个取舍是否成立，或 `publishing` enum 更适合本项目。**
- **事务 + `pg_advisory_xact_lock`**：把建草稿（外部 HTTP）包进持锁事务，第二请求阻塞等待。否决：外部 IO 期间长占 DB 连接+锁是坏味道。
- **`payload.update({where})` 条件更新**：否决，适配器层非原子（已证）。

**Edge cases & risks:**
- drizzle table key 名（`publishResultLockedAt` / `publishResultStage`）依赖 Payload schema 命名约定 → 集中成常量 + 注释，并在 Batch 6 的 DB 集成测试里真实验证一次。
- `req.payload.db.drizzle` 单元测试需 mock（现有 `makeMockPayload` 要扩展 `db.drizzle.update().set().where().returning()` 链 + `db.tables`）。原子性本身只能靠真实 PG 集成测试断言（归 skipIf(!hasDb)）。
- 锁字段加列 → 生产 `payload migrate`（PR 描述写明）。dev push 自动。
- Out of scope：token.ts 并发刷新去重（Low，低并发可接受，单列说明不修）。

### Batch 3 — 部署暴露面（High: compose；Low: 镜像）

**Files:**
- Modify: `platform/docker/docker-compose.yml`
- Modify: `platform/docker/Dockerfile`
- Modify: `platform/.dockerignore`
- Modify: `platform/.env.example`（补 Postgres 口令变量说明）

**Approach:**
- **compose Postgres（High）**：`ports` 由 `"5434:5432"` 改为 `"127.0.0.1:5434:5432"`（仅回环），并在注释说明生产可整段删除（app 走内网 `postgres:5432` 不需要宿主端口）。`POSTGRES_PASSWORD` 与 `DATABASE_URI` 改为从 env 注入（`${POSTGRES_PASSWORD:?}`），不再硬编码 `lilink/lilink`。`.env.example` 补 `POSTGRES_PASSWORD=replace-with-strong-random`。
- **Dockerfile（Low，Codex#5 修正）**：`.dockerignore` 补 `scripts/*.ts`、`tests/`（排除 seed-demo 等开发脚本）——**但绝不能整目录忽略 `scripts/`**：runner 镜像装 python3 且运行时调 `scripts/render.py`（`runRenderPy` 用 `process.cwd()/scripts/render.py`），整目录忽略会丢 render.py 致发布崩。用 `scripts/*.ts` 只排 TS 脚本、保留 render.py。
- app healthcheck（Low，Codex#9）：compose app 服务加 healthcheck，**用 node 不用 curl**（runner 镜像没装 curl）：`node -e "fetch('http://localhost:3000/admin').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`。
- 镜像 standalone 瘦身（Low）：Payload + Turbopack 下 standalone 有坑 → **本批不动 next.config 的 output**，记为后续优化。

**Tests:** 配置类改动无单测；人工 `docker compose config` 校验（PR 描述记录）。Dockerfile build 不在 CI（Batch6 只 tsc+vitest），plan 不声称"CI build 校验"（Codex#11）。

### Batch 4 — Users 越权（Medium）

**Files:**
- Modify: `platform/src/collections/Users.ts`
- Test: `platform/tests/collections.test.ts`（skipIf(!hasDb) 组补越权用例）或新增纯逻辑 access 函数测试

**Approach（Codex Blocker#2 已修正）:** Users 加 collection `access`：
- `create`: **admin-only**（`({req:{user}}) => user?.role==='admin'`）。首个账号由 Payload 内置 `registerFirstUser` 端点创建——它先查"无任何 user"再 `overrideAccess:true` 建首用户，**不走 collection create access**,故 admin-only **不会**造成 bootstrap 死锁。**不要**用 `!user || ...`（Codex 指出那是永久开放注册）。
- `update`: `({req:{user},id}) => user?.role==='admin' || String(user?.id)===String(id)`（**String 比较**,Codex#8：user.id 可能是 number、URL id 是 string，严格 === 会误拒本人）。
- `delete`: admin-only。
- `role` 字段加 `access.update: ({req:{user}}) => user?.role==='admin'` 防自我提权；并加 beforeChange/beforeValidate 兜底：非 admin 提交 `role:'admin'` 时拒绝（Codex Blocker#2 补充，防字段 access 在某些写路径被绕）。
**Edge case:** seed-demo 建的 demo 账号已是 `role:'admin'`（seed-demo.ts:42 确认），bootstrap 后有 admin 可继续建人。

### Batch 5 — Low 项清理

**Files:**
- Modify: `platform/src/endpoints/publish.ts`（403→401，与 transition/inlineHtml 一致；幂等修复路径清旧 `lastError`）
- Modify: `platform/package.json`（`@aws-sdk/client-s3`、`@aws-sdk/s3-request-presigner` 提为显式 dependencies，版本对齐 storage-s3 传递解析的 `^3.x`）
- Test: `platform/tests/publisher.test.ts`（401 断言更新；修复路径 lastError 清空断言）

**Approach:**
- publish 未登录 `{status:403}` → `401`；同步改 `publisher.test.ts:419-424` 断言。
- 局部失败修复路径（publish.ts:95-98 与 6a）在 `applyTransition` 成功后补一次 `payload.update({ publishResult:{ lastError:null }})`，避免已 published 仍显示旧错误。
- aws-sdk 两包：读 `node_modules/@payloadcms/storage-s3` 实际解析版本，写进 `dependencies`（消除 phantom dep 漂移）。lockfile 重新生成需 `npm install`（WSL 挂载盘用 install 非 ci）。

### Batch 6 — 最小 CI（用户要求）

**Files:**
- Create: `.github/workflows/ci.yml`（仓库根，注意 platform 是子目录）

**Approach（Codex High#4 修正：必须带 PG,否则 Batch2 核心保证假绿）:** GitHub Actions：Node 22 + `cd platform && npm ci && npx tsc --noEmit && npx vitest run`。不跑 `next build`/`lint`。
- **起 `services: postgres:16`**（env `POSTGRES_USER/PASSWORD/DB`），job env 注入 `DATABASE_URI=postgres://...@localhost:5432/...`,使 `skipIf(!hasDb)` 的 DB 集成测试**在 CI 真跑**——这是守护 Batch2 原子抢锁的唯一手段。
- DB 集成测试需 Payload 推 schema：测试 `beforeAll` 用 `getPayload({config})`（dev push 自动建表),或在 CI step 跑 `npx payload migrate`(若有 migration)。实现时确认 `collections.test.ts` 的 hasDb 分支如何初始化 schema。
- 并发原子测试（Batch2 关键用例）：`Promise.all([publish(req1), publish(req2)])` 打同一条 approved 稿,断言**只有一个 winner、publisher.publish/addDraft 只被有效执行一次、最终只有一个 wxDraftMediaId**。这条必须在带 PG 的 CI 里绿。

---

## Verification（全批完成后）
- [ ] `cd platform && npx tsc --noEmit` 干净
- [ ] `cd platform && npx vitest run`：原有 97 全过 + 新增用例过；skip 数不增（除非新增 DB 集成测试，需说明）
- [ ] 新增测试清单：SSRF IPv6（Batch1）、并发抢锁/即时持久化/失败释放（Batch2）、401/lastError清空（Batch5）、Users 越权（Batch4，若入 DB 组则标 skip 条件）
- [ ] CI 在 GitHub 上跑绿（Batch6）
- [ ] PR 描述补：生产 `payload migrate`（新锁字段列）、轮换 Postgres 口令、CI 已加
- [ ] 人工：`docker compose config` 校验 compose 改动合法

## Out of scope（明确排除）
- token.ts 并发刷新去重（Low，单实例低并发可接受）
- next.config `output:'standalone'` 镜像瘦身（有 Payload/Turbopack 坑，单独评估）
- DNS rebinding（已在 client.ts 注释为第一期已知限制）
- Media.afterRead 每读重签的批量优化（第一期规模可忽略）
- 多实例 token/锁共享（Redis，第一期单实例不需要）
