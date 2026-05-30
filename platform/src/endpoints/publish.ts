// 发布 endpoint —— 把一条渠道稿推送到目标平台（第一期：微信公众号建草稿）。
//
// 挂载方式：作为 channel-contents 集合的自定义 endpoint，
//   path '/:id/publish'、method 'post' → 实际路由 POST /api/channel-contents/:id/publish。
//
// 逻辑：
//   1. 鉴权：必须是已登录运营（req.user），否则 403。
//   2. 取渠道稿（req.payload.findByID）。不存在 → 404。
//   3. 幂等（三态一致才直接回包）：仅当 stage==='draft_created' 且 wxDraftMediaId 存在
//      且 status==='published' 三者一致时，才认为「彻底发完」，直接回包既有结果、
//      不再调微信。若 stage 已是 'draft_created' 但 status 还没到 published（说明上次
//      建完草稿后回填/状态流转局部失败了），**绝不重复建草稿**（会重复占用素材、
//      产生重复图文），而是走「幂等修复」：补做到 published 的状态流转（若状态机允许）
//      后返回成功。
//   4. 状态校验：只有处于 approved 的稿子能发布（状态机 approved→published）。
//      非法则 409，并且不调用微信。
//   5. 取凭据：process.env.WX_APP_ID / WX_APP_SECRET，缺失 → 500。
//   6. 调微信前轻量并发自检：再 findByID 二次确认 stage 仍不是 draft_created（也防御性
//      地排除 publishing），命中则说明已有并发请求建过草稿，转入幂等路径，不重复建。
//   7. 调 publishers[platform].publish 真正发布。
//   8. 成功：payload.update 回填 publishResult（wxDraftMediaId / stage / publishedAt），
//      并经状态机把 status 置 published（applyTransition，写审计）。
//   9. 失败：把错误信息写进 publishResult.lastError，返回 500。

import { randomUUID } from 'node:crypto'
import { publishers, type PublisherPlatform } from '../publishers'
import { applyTransition, CHANNEL_CONTENTS_SLUG } from '../workflow/transition'
import { canTransition, isStatus, type Status } from '../workflow/states'
import { acquirePublishLock, releasePublishLock } from './publishLock'

// publishers 注册表里已支持的平台集合，用于运行时校验 platform 字段。
function isSupportedPlatform(p: unknown): p is PublisherPlatform {
  return typeof p === 'string' && p in publishers
}

// 「草稿已建/正在建」的 stage 取值集合 —— 命中其一即说明微信侧已动过手，
// 绝不能再调一次 publish（会重复占用素材、产生重复图文）。
// 第一期 publishResult.stage 类型只有 'draft_created'；'publishing' 是为后续中间态
// 预留的防御性匹配（新增该取值需改 ChannelContents，归别的任务，这里不引入）。
const DRAFT_TOUCHED_STAGES = ['draft_created', 'publishing']
function isDraftTouched(stage: unknown): boolean {
  return typeof stage === 'string' && DRAFT_TOUCHED_STAGES.includes(stage)
}

// 幂等回包：草稿已建（无论是否已推到 published），统一回这个形状，标记 idempotent。
function idempotentResponse(draftMediaId: unknown): Response {
  return Response.json({
    ok: true,
    idempotent: true,
    stage: 'draft_created',
    draftMediaId: draftMediaId ?? null,
  })
}

// 自定义 endpoint 配置对象。导出后由 payload.config.ts 挂到 ChannelContents.endpoints。
// 用宽松类型（不强依赖 Payload 的 Endpoint 类型）以避免跨任务阶段的类型耦合；
// 形状与 Payload 3.x collection endpoint 约定一致（path/method/handler(req)=>Response）。
export const publishEndpoint = {
  path: '/:id/publish',
  method: 'post' as const,
  handler: async (req: any): Promise<Response> => {
    const { payload, user } = req

    // 1. 鉴权
    if (!user) {
      return Response.json({ error: '未登录或会话失效' }, { status: 403 })
    }

    const id = req.routeParams?.id
    if (!id) {
      return Response.json({ error: '缺少渠道稿 id' }, { status: 400 })
    }

    // 2. 取渠道稿
    const cc = await payload.findByID({ collection: CHANNEL_CONTENTS_SLUG, id })
    if (!cc) {
      return Response.json({ error: `渠道稿不存在：${String(id)}` }, { status: 404 })
    }

    // 3. 幂等 / 局部失败修复：草稿一旦建过（stage 命中 draft_created），就绝不重建。
    //    - 三态一致（stage=draft_created + wxDraftMediaId 存在 + status=published）：
    //      彻底发完，直接幂等回包。
    //    - stage=draft_created 但 status 未到 published：上次建完草稿后回填/流转
    //      局部失败。**不重复建草稿**，只补做到 published 的状态流转（若状态机允许），
    //      再幂等返回成功（修复路径）。
    if (isDraftTouched(cc.publishResult?.stage)) {
      const existingMediaId = cc.publishResult?.wxDraftMediaId
      const ccStatus = cc.status

      // 三态一致：直接幂等回包。
      if (ccStatus === 'published' && existingMediaId) {
        return idempotentResponse(existingMediaId)
      }

      // 局部失败修复：草稿已建但状态没走完，补做状态流转（仅当状态机允许）。
      // 注意：这里有意不再调微信、不再写 publishResult.stage —— 草稿已存在。
      if (isStatus(ccStatus) && canTransition(ccStatus, 'published')) {
        await applyTransition(payload, id, 'published', user.id)
      }
      return idempotentResponse(existingMediaId)
    }

    // 平台校验：必须是注册表里支持的平台
    const platform = cc.platform
    if (!isSupportedPlatform(platform)) {
      return Response.json(
        { error: `暂不支持的发布平台：${String(platform)}` },
        { status: 400 },
      )
    }

    // 4. 状态校验：只有 approved 能发布（提前拦截，避免建了草稿却卡在状态机）
    const current = cc.status as Status
    if (!isStatus(current) || !canTransition(current, 'published')) {
      return Response.json(
        {
          error: `当前状态不可发布：${String(current)}（需先经审核进入 approved）`,
          from: current,
          to: 'published',
        },
        { status: 409 },
      )
    }

    // 5. 取微信凭据
    const appId = process.env.WX_APP_ID
    const appSecret = process.env.WX_APP_SECRET
    if (!appId || !appSecret) {
      return Response.json(
        { error: '服务端未配置微信凭据（WX_APP_ID / WX_APP_SECRET）' },
        { status: 500 },
      )
    }

    // 6. 原子抢锁（真正的并发保护）：基于 Postgres 单条条件 UPDATE 的 CAS，
    //    仅当 status=approved 且 stage 仍 none 且（未锁/锁过期）才置锁成功。
    //    并发的多个 publish 请求里只有一个能抢到锁，其余转幂等/409，不重复建草稿。
    //    （取代旧的「乐观双检」——那只缩小窗口、非原子，双击/重试仍会双发。）
    const lockToken = randomUUID()
    let gotLock = false
    try {
      gotLock = await acquirePublishLock(payload, id, lockToken)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return Response.json({ error: `发布失败（并发锁不可用）：${message}` }, { status: 500 })
    }

    if (!gotLock) {
      // 没抢到锁：可能已被并发请求建过草稿（重读看 stage），或正被并发持锁、或状态已变。
      const fresh = await payload.findByID({ collection: CHANNEL_CONTENTS_SLUG, id })
      // 已建过草稿 → 幂等修复路径（绝不重复建）。
      if (isDraftTouched(fresh?.publishResult?.stage)) {
        const freshMediaId = fresh?.publishResult?.wxDraftMediaId
        if (
          fresh?.status !== 'published' &&
          isStatus(fresh?.status) &&
          canTransition(fresh.status, 'published')
        ) {
          await applyTransition(payload, id, 'published', user.id)
        }
        return idempotentResponse(freshMediaId)
      }
      // 否则：正被并发请求发布中，或状态已变。让调用方稍后刷新重试，不调微信。
      return Response.json(
        {
          error: `稿件正在发布中或状态已变更，请稍后刷新重试：${String(fresh?.status)}`,
          from: fresh?.status,
          to: 'published',
        },
        { status: 409 },
      )
    }

    // 抢到锁。自此任何返回路径都必须经 finally 释放锁（仅清本请求令牌的锁）。
    try {
      // 6'. 抢锁后重读最新快照：首读(cc)→抢锁之间可能被改（如 platform）。基于 fresh 发布。
      //     status/stage 已由锁的 WHERE 条件原子保证（approved + none），这里再校验 platform。
      const fresh = await payload.findByID({ collection: CHANNEL_CONTENTS_SLUG, id })
      if (!isSupportedPlatform(fresh?.platform) || fresh.platform !== platform) {
        return Response.json(
          { error: `发布平台已变更或不受支持：${String(fresh?.platform)}` },
          { status: 409 },
        )
      }

      // 7. 真正发布。onDraftCreated 在草稿建成的瞬间把 draftMediaId + stage 落库——
      //    使「草稿已建」状态可恢复：即便随后回填/状态流转失败或进程崩溃，重试也能凭
      //    已落库的 stage=draft_created 走幂等修复，绝不重复建草稿（review #2）。
      const result = await publishers[platform].publish({
        channelContent: fresh,
        wechat: { appId, appSecret },
        onDraftCreated: async (draftMediaId) => {
          await payload.update({
            collection: CHANNEL_CONTENTS_SLUG,
            id,
            data: { publishResult: { wxDraftMediaId: draftMediaId, stage: 'draft_created' } },
          })
        },
      })

      // 8a. 回填完整发布结果（publishedAt；清空上次 lastError）。stage 已由 onDraftCreated 置。
      await payload.update({
        collection: CHANNEL_CONTENTS_SLUG,
        id,
        data: {
          publishResult: {
            wxDraftMediaId: result.draftMediaId,
            stage: result.stage,
            publishedAt: new Date().toISOString(),
            lastError: null,
          },
        },
      })

      // 8b. 经状态机置 published（写审计；操作人取当前登录用户）
      await applyTransition(payload, id, 'published', user.id)

      return Response.json({
        ok: true,
        stage: result.stage,
        draftMediaId: result.draftMediaId,
      })
    } catch (err) {
      // 9. 失败：记录 lastError，返回 500。状态不前移，保持可重试。
      const message = err instanceof Error ? err.message : String(err)
      try {
        await payload.update({
          collection: CHANNEL_CONTENTS_SLUG,
          id,
          data: {
            publishResult: {
              lastError: message,
            },
          },
        })
      } catch {
        // 回填 lastError 本身失败不应淹没原始错误，吞掉即可。
      }
      return Response.json({ error: `发布失败：${message}` }, { status: 500 })
    } finally {
      // 释放锁（仅清本请求令牌的锁，防误清他人新锁）。成功时 stage 已是 draft_created，
      // 锁释放后重试会走幂等修复；失败时 stage 仍 none，锁释放后可被重新抢占重试。
      await releasePublishLock(payload, id, lockToken)
    }
  },
}
