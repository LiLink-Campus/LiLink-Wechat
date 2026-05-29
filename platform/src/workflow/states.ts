// 协作工作流状态机定义（平台无关，挂在 channel-contents.status 上）。
// 状态流转：draft ──提交──▶ in_review ──通过──▶ approved ──发布──▶ published
//                ▲              │              │
//                └── 打回 ◀─────┘     退回重审 ◀┘  (in_review→draft 为打回，记 reason)
//
// 本文件只放「纯逻辑」：状态枚举、合法流转表、校验函数。无任何 I/O 依赖，
// 方便被 T5 publisher、T6 transition endpoint 与单元测试直接复用。接口须保持稳定。

/** 渠道稿的协作状态。 */
export type Status = 'draft' | 'in_review' | 'approved' | 'published'

/**
 * 合法流转表：键为「当前状态」，值为「可直接转入的目标状态」列表。
 * - draft      → in_review                （提交送审）
 * - in_review  → approved | draft          （通过 / 打回，打回时带 reason）
 * - approved   → published | in_review     （发布 / 退回重审）
 * - published  → （终态，不可再流转）
 */
export const TRANSITIONS: Record<Status, Status[]> = {
  draft: ['in_review'],
  in_review: ['approved', 'draft'],
  approved: ['published', 'in_review'],
  published: [],
}

/** 全部合法状态值（运行时校验入参用，TS 的 Status 类型在运行时不存在）。 */
export const STATUSES: Status[] = ['draft', 'in_review', 'approved', 'published']

/** 运行时判断一个任意值是否为合法 Status。 */
export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as string[]).includes(value)
}

/**
 * 判断从 from 到 to 是否为一次合法流转。
 * 仅当 from 是已知状态、且 to 在其允许的目标列表中时返回 true。
 * 注意：同状态 self-loop（如 draft→draft）不在任何允许列表中，故为非法。
 */
export function canTransition(from: Status, to: Status): boolean {
  const allowed = TRANSITIONS[from]
  if (!allowed) return false
  return allowed.includes(to)
}
