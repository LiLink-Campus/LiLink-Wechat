// 渠道稿状态流转的执行逻辑：校验合法性 + 写新状态 + 记录审计信息。
// 被 T5 publisher（发布成功后置 published）与 T6 transition endpoint（人工流转/打回）复用，
// 接口签名须保持稳定。

import { canTransition, isStatus, type Status } from './states'

/** 操作 channel-contents 的集合 slug，集中定义避免散落字符串。 */
export const CHANNEL_CONTENTS_SLUG = 'channel-contents'

/**
 * 一条状态流转的审计记录，追加进渠道稿的 transitionLog 数组字段。
 * （T1 的 ChannelContents 需提供该 array 字段；字段缺失也不会让流转失败，
 *  Payload 会忽略未知字段——但为保留审计请按 registerNotes 添加该字段。）
 */
export interface TransitionLogEntry {
  /** 原状态 */
  from: Status
  /** 目标状态 */
  to: Status
  /** 操作人（users 集合的 id） */
  user: string | number
  /** ISO 时间戳 */
  at: string
  /** 可选原因，打回（in_review→draft）时通常必填以说明问题 */
  reason?: string
}

/** 非法流转时抛出的错误，携带 from/to 便于 endpoint 透出给前端。 */
export class IllegalTransitionError extends Error {
  readonly from: Status
  readonly to: Status
  constructor(from: Status, to: Status) {
    super(`非法状态流转：${from} → ${to}`)
    this.name = 'IllegalTransitionError'
    this.from = from
    this.to = to
  }
}

/**
 * 执行一次状态流转。
 *
 * 逻辑：
 *  1. payload.findByID 取当前渠道稿的 status；
 *  2. canTransition 校验，非法则抛 IllegalTransitionError（不写库）；
 *  3. payload.update 写新 status，并把本次流转的审计信息（操作人 / 时间 /
 *     from→to / 可选 reason）追加到 transitionLog 数组。
 *
 * @param payload  Payload 实例（local API）。用 any 以避免对生成类型的硬依赖，
 *                 便于测试用 mock 注入。
 * @param id       渠道稿 id。
 * @param to       目标状态。
 * @param userId   操作人 users id（写入审计）。
 * @param reason   可选原因（打回时建议填写）。
 */
export async function applyTransition(
  payload: any,
  id: string | number,
  to: Status,
  userId: string | number,
  reason?: string,
): Promise<void> {
  // 入参防御：目标状态必须是已知合法状态值
  if (!isStatus(to)) {
    throw new Error(`未知的目标状态：${String(to)}`)
  }

  // 1. 取当前渠道稿
  const current = await payload.findByID({
    collection: CHANNEL_CONTENTS_SLUG,
    id,
  })
  if (!current) {
    throw new Error(`渠道稿不存在：${String(id)}`)
  }

  const from = current.status as Status
  if (!isStatus(from)) {
    // 当前状态异常（数据脏）——直接拒绝，避免从未知态乱跳
    throw new Error(`渠道稿当前状态非法：${String(from)}`)
  }

  // 2. 合法性校验
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to)
  }

  // 3. 组装审计记录并追加到既有 transitionLog 之后
  const entry: TransitionLogEntry = {
    from,
    to,
    user: userId,
    at: new Date().toISOString(),
    ...(reason !== undefined && reason !== '' ? { reason } : {}),
  }
  const prevLog: TransitionLogEntry[] = Array.isArray(current.transitionLog)
    ? current.transitionLog
    : []

  // 并发覆写的轻量乐观防护（非原子）：
  //   本函数是「读(findByID)-改-写(update)」结构，两次操作之间若有并发流转穿插，
  //   后写者会用基于旧 transitionLog 拼出的数组覆盖前写者的状态与审计，导致审计丢条
  //   或状态被回退。第一期 3 人低并发，这里不引入 DB 事务，只做最佳努力的二次校验：
  //   update 前再读一次，确认 status 仍是我们这次决策所基于的 from；若已被并发流转改动，
  //   则放弃本次写入并报错（交由上层重试或人工处理），避免基于陈旧快照盲写覆盖。
  //   权衡：这只缩小竞态窗口、并不能根除——第二次读与下面 update 之间仍有微小窗口；
  //   完整原子性（DB 事务 / 基于 status 的条件 CAS 更新）留后续任务。
  const recheck = await payload.findByID({
    collection: CHANNEL_CONTENTS_SLUG,
    id,
  })
  if (recheck && recheck.status !== from) {
    throw new Error(
      `状态流转并发冲突：期望当前为 ${from}，实际为 ${String(recheck.status)}（请重试）`,
    )
  }

  // 写新状态 + 追加审计。status 为保证字段；transitionLog 若集合未定义会被忽略。
  await payload.update({
    collection: CHANNEL_CONTENTS_SLUG,
    id,
    data: {
      status: to,
      transitionLog: [...prevLog, entry],
    },
  })
}
