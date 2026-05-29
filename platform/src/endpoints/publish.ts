// 发布 endpoint —— 把一条渠道稿推送到目标平台（第一期：微信公众号建草稿）。
//
// 挂载方式：作为 channel-contents 集合的自定义 endpoint，
//   path '/:id/publish'、method 'post' → 实际路由 POST /api/channel-contents/:id/publish。
//
// 逻辑：
//   1. 鉴权：必须是已登录运营（req.user），否则 403。
//   2. 取渠道稿（req.payload.findByID）。不存在 → 404。
//   3. 幂等：若 publishResult.stage === 'draft_created'，说明已建过草稿，
//      直接回包既有结果、不再调微信（避免重复建草稿、重复占用素材）。
//   4. 状态校验：只有处于 approved 的稿子能发布（状态机 approved→published）。
//      非法则 409，并且不调用微信。
//   5. 取凭据：process.env.WX_APP_ID / WX_APP_SECRET，缺失 → 500。
//   6. 调 publishers[platform].publish 真正发布。
//   7. 成功：payload.update 回填 publishResult（wxDraftMediaId / stage / publishedAt），
//      并经状态机把 status 置 published（applyTransition，写审计）。
//   8. 失败：把错误信息写进 publishResult.lastError，返回 500。

import { publishers, type PublisherPlatform } from '../publishers'
import { applyTransition, CHANNEL_CONTENTS_SLUG } from '../workflow/transition'
import { canTransition, isStatus, type Status } from '../workflow/states'

// publishers 注册表里已支持的平台集合，用于运行时校验 platform 字段。
function isSupportedPlatform(p: unknown): p is PublisherPlatform {
  return typeof p === 'string' && p in publishers
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

    // 3. 幂等：已建草稿则直接回包，不重发
    if (cc.publishResult?.stage === 'draft_created') {
      return Response.json({
        ok: true,
        idempotent: true,
        stage: 'draft_created',
        draftMediaId: cc.publishResult?.wxDraftMediaId ?? null,
      })
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

    try {
      // 6. 真正发布
      const result = await publishers[platform].publish({
        channelContent: cc,
        wechat: { appId, appSecret },
      })

      // 7a. 回填发布结果（清空上次 lastError）
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

      // 7b. 经状态机置 published（写审计；操作人取当前登录用户）
      await applyTransition(payload, id, 'published', user.id)

      return Response.json({
        ok: true,
        stage: result.stage,
        draftMediaId: result.draftMediaId,
      })
    } catch (err) {
      // 8. 失败：记录 lastError，返回 500。状态不前移，保持可重试。
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
    }
  },
}
