// 渠道稿状态流转的 HTTP 入口（Payload custom endpoint）。
// 挂在 channel-contents 集合下，对接 T4 的 applyTransition 纯逻辑：
//   POST /api/channel-contents/:id/transition   body: { to: Status, reason?: string }
//
// 设计取舍：
//  - 任务要求 body 只含 { to, reason? }，故渠道稿 id 必须走路径参数（:id），
//    用 req.routeParams.id 读取。这样既满足「挂 channel-contents / 动作名 transition」，
//    又不把 id 塞进 body。
//  - 操作人取登录用户 req.user.id 作为审计主体；未登录直接 401 拒绝。
//  - applyTransition 对非法流转抛 IllegalTransitionError，这里捕获并转 400 + 错误信息；
//    其它入参/数据异常（未知状态、渠道稿不存在等）同样转 400 透出 message。
//
// 注：本文件只 export endpoint 对象，由 payload.config.ts 把它并入
//     ChannelContents.endpoints（见 registerNotes），不直接改 ChannelContents.ts。

import type { Endpoint, PayloadRequest } from 'payload'

import { applyTransition, IllegalTransitionError } from '../workflow/transition'
import { isStatus, type Status } from '../workflow/states'

/** 请求体形状：目标状态 + 可选原因（打回时建议填写）。 */
interface TransitionBody {
  to?: unknown
  reason?: unknown
}

/**
 * 读取请求体。custom endpoint 不会自动填充 req.data，需要手动解析。
 * 解析失败（空 body / 非 JSON）返回空对象，交由后续字段校验给出 400。
 */
async function readBody(req: PayloadRequest): Promise<TransitionBody> {
  try {
    const parsed = await req.json?.()
    return (parsed ?? {}) as TransitionBody
  } catch {
    return {}
  }
}

/**
 * 状态流转 endpoint。
 * 路径 /:id/transition —— 集合根 path 由配置侧拼成 /api/channel-contents/:id/transition。
 */
export const transitionEndpoint: Endpoint = {
  path: '/:id/transition',
  method: 'post',
  handler: async (req) => {
    // 1. 鉴权：必须是登录用户，取其 id 作为操作人写入审计。
    const user = req.user
    if (!user) {
      return Response.json({ error: '未登录' }, { status: 401 })
    }

    // 2. 渠道稿 id 来自路径参数。
    const id = req.routeParams?.id as string | undefined
    if (id === undefined || id === null || id === '') {
      return Response.json({ error: '缺少渠道稿 id' }, { status: 400 })
    }

    // 3. 解析并校验 body。to 必须是合法 Status。
    const body = await readBody(req)
    if (!isStatus(body.to)) {
      return Response.json(
        { error: `非法的目标状态：${String(body.to)}` },
        { status: 400 },
      )
    }
    const to: Status = body.to
    const reason =
      typeof body.reason === 'string' && body.reason !== '' ? body.reason : undefined

    // 4. 执行流转。非法流转 / 数据异常统一转 400 透出 message。
    try {
      await applyTransition(req.payload, id, to, user.id, reason)
    } catch (err) {
      if (err instanceof IllegalTransitionError) {
        return Response.json(
          { error: err.message, from: err.from, to: err.to },
          { status: 400 },
        )
      }
      const message = err instanceof Error ? err.message : '状态流转失败'
      return Response.json({ error: message }, { status: 400 })
    }

    // 5. 成功：返回更新后的 status（前端据此刷新协作队列）。
    return Response.json({ id, status: to })
  },
}
