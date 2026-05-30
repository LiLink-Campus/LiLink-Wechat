// 发布并发锁 —— 用 Postgres 单条条件 UPDATE 做真正原子的 compare-and-set(CAS)。
//
// 为什么需要：发布会产生不可回滚的外部副作用（上传永久素材占配额、建微信草稿）。
// 两个并发的 publish 请求（运营双击、前端超时重试、反向代理重放）若都通过校验，
// 会各自建一篇草稿 + 各占一张永久素材，造成重复图文且无法去重。
//
// 为什么不用 payload.update({where})：Payload 3.85 的 db-postgres 适配器层对带 where 的
// update 是「先 SELECT 出 id、再逐条 update」（@payloadcms/drizzle 的 updateMany），非原子，
// 两个并发请求的 SELECT 都会命中同一行、各自 update，无法用它判定唯一赢家。
//
// 方案：直接用 payload.db.drizzle 跑单条 `UPDATE ... WHERE ... RETURNING id`。Postgres 对
// 单条 UPDATE 天然加行级写锁并在 READ COMMITTED 下对阻塞者重新求值 WHERE（EvalPlanQual），
// 故只有一个请求能让条件成立并改值，RETURNING 的行数即「是否抢到锁」。
//
// 锁语义：在 publishResult 上加 lockedAt（软锁时间戳）+ lockToken（持有者令牌）。
//   - 抢锁：仅当 status=approved 且 stage 仍是初始(none/空) 且（未锁 或 锁已过期 TTL）时，
//     才把 lockedAt 置 now、lockToken 置本次令牌。能改到行（RETURNING 1 行）即赢家。
//   - 释放：只清「lockToken = 自己令牌」的锁，避免慢请求超时被他人抢走后误清新锁。
//   - 崩溃自愈：进程在持锁中途崩溃来不及释放，锁会在 TTL 后过期、被后续请求重新抢占。
//
// 残留窗口（已知限制，第一期可接受）：若进程恰好在「微信 addDraft 成功返回」与
//   「onDraftCreated 把 stage 写成 draft_created」这两步之间崩溃，则草稿已建但 stage 仍是
//   none；锁经 TTL 过期后，后续请求会重新抢到并再建一篇草稿。此窗口极小（仅一次 await 之间），
//   且远好于修复前「双击/重试必重复」；彻底根除需把「建草稿」与「落库」纳入同一事务或两阶段
//   提交，留待后续。详见 publish.ts onDraftCreated 注释。
//
// 列名（已对真实 schema 实测确认）：表 channel_contents；
//   publish_result_locked_at / publish_result_lock_token / publish_result_stage / status。
// id 为整数主键，故 SQL 里以 Number(id) 传参（URL 来的 id 是字符串，PG int 列不接受 text）。

import { sql } from '@payloadcms/db-postgres'

// 发布软锁默认有效期：10 分钟。远大于一次正常发布耗时（秒级，且 client 各 fetch 都有更短超时），
// 故正常请求不会触发 TTL 误判；只有崩溃/卡死遗留的锁会在此后被判定过期可重抢。
export const PUBLISH_LOCK_TTL_MS = 10 * 60 * 1000

// 从 payload 取 drizzle 实例；不可用时抛错（宁可发布失败也不要静默退回非原子路径）。
function getDrizzle(payload: any): any {
  const db = payload?.db?.drizzle
  if (!db || typeof db.execute !== 'function') {
    throw new Error('发布并发锁不可用：payload.db.drizzle 缺失（仅支持 Postgres 适配器）')
  }
  return db
}

// db.execute 在不同驱动下可能返回 rows 数组或 { rows } 对象，统一取出数组。
function rowsOf(res: any): any[] {
  if (Array.isArray(res)) return res
  if (res && Array.isArray(res.rows)) return res.rows
  return []
}

/**
 * 尝试原子抢占某条渠道稿的发布锁。
 * @returns true=本请求抢到锁（唯一赢家，可继续发布）；false=未抢到（已被并发持有/状态不符）。
 */
export async function acquirePublishLock(
  payload: any,
  id: string | number,
  lockToken: string,
  ttlMs: number = PUBLISH_LOCK_TTL_MS,
): Promise<boolean> {
  const db = getDrizzle(payload)
  const numId = Number(id)
  if (!Number.isInteger(numId)) {
    throw new Error(`发布并发锁：非法渠道稿 id：${String(id)}`)
  }
  const ttlSeconds = Math.floor(ttlMs / 1000)
  // 条件：status 仍为 approved、stage 仍是初始(none/空)、且（未锁 或 锁已过期）。
  const res = await db.execute(sql`
    UPDATE channel_contents
    SET publish_result_locked_at = now(),
        publish_result_lock_token = ${lockToken}
    WHERE id = ${numId}
      AND status = 'approved'
      AND (publish_result_stage IS NULL OR publish_result_stage = 'none')
      AND (
        publish_result_locked_at IS NULL
        OR publish_result_locked_at < now() - make_interval(secs => ${ttlSeconds})
      )
    RETURNING id
  `)
  return rowsOf(res).length > 0
}

/**
 * 释放发布锁（仅当锁令牌与本请求一致才清，防误清他人新锁）。
 * 释放失败不抛（释放是尽力而为；崩溃遗留的锁由 TTL 兜底）。
 */
export async function releasePublishLock(
  payload: any,
  id: string | number,
  lockToken: string,
): Promise<void> {
  try {
    const db = getDrizzle(payload)
    const numId = Number(id)
    if (!Number.isInteger(numId)) return
    await db.execute(sql`
      UPDATE channel_contents
      SET publish_result_locked_at = NULL,
          publish_result_lock_token = NULL
      WHERE id = ${numId}
        AND publish_result_lock_token = ${lockToken}
    `)
  } catch {
    // 释放失败不应淹没主流程结果；遗留锁会在 TTL 后过期。
  }
}
