import { describe, it, expect, vi } from 'vitest'

import {
  TRANSITIONS,
  canTransition,
  isStatus,
  type Status,
} from '../src/workflow/states'
import {
  applyTransition,
  IllegalTransitionError,
  CHANNEL_CONTENTS_SLUG,
  type TransitionLogEntry,
} from '../src/workflow/transition'

describe('states.canTransition', () => {
  it('允许合法流转 draft → in_review', () => {
    expect(canTransition('draft', 'in_review')).toBe(true)
  })

  it('允许 in_review → approved（通过）与 in_review → draft（打回）', () => {
    expect(canTransition('in_review', 'approved')).toBe(true)
    expect(canTransition('in_review', 'draft')).toBe(true)
  })

  it('允许 approved → published（官方发布）、ready_to_publish（人工发布包）与 in_review（退回重审）', () => {
    expect(canTransition('approved', 'published')).toBe(true)
    expect(canTransition('approved', 'ready_to_publish')).toBe(true)
    expect(canTransition('approved', 'in_review')).toBe(true)
  })

  it('允许 ready_to_publish → published（人工确认已发）与 ready_to_publish → in_review（退回重审）', () => {
    expect(canTransition('ready_to_publish', 'published')).toBe(true)
    expect(canTransition('ready_to_publish', 'in_review')).toBe(true)
  })

  it('拒绝非法流转 draft → published', () => {
    expect(canTransition('draft', 'published')).toBe(false)
  })

  it('拒绝跳过审核 draft → approved', () => {
    expect(canTransition('draft', 'approved')).toBe(false)
  })

  it('published 为终态，不可再流转到任何状态', () => {
    expect(TRANSITIONS.published).toEqual([])
    expect(canTransition('published', 'draft')).toBe(false)
    expect(canTransition('published', 'in_review')).toBe(false)
  })

  it('拒绝 self-loop（同状态不算合法流转）', () => {
    expect(canTransition('draft', 'draft')).toBe(false)
    expect(canTransition('in_review', 'in_review')).toBe(false)
  })
})

describe('states.isStatus', () => {
  it('识别合法状态值', () => {
    expect(isStatus('draft')).toBe(true)
    expect(isStatus('ready_to_publish')).toBe(true)
    expect(isStatus('published')).toBe(true)
  })

  it('拒绝非法/非字符串值', () => {
    expect(isStatus('archived')).toBe(false)
    expect(isStatus('')).toBe(false)
    expect(isStatus(undefined)).toBe(false)
    expect(isStatus(42)).toBe(false)
  })
})

/** 构造一个最小 mock payload：findByID 返回给定文档，update 记录调用。 */
function makeMockPayload(doc: Record<string, unknown>) {
  return {
    findByID: vi.fn().mockResolvedValue(doc),
    update: vi.fn().mockResolvedValue({ ...doc }),
  }
}

describe('transition.applyTransition', () => {
  it('合法流转：用正确的 slug/id 取文档并写回新 status', async () => {
    const payload = makeMockPayload({ id: 'cc1', status: 'draft' as Status })

    await applyTransition(payload, 'cc1', 'in_review', 'user-7')

    expect(payload.findByID).toHaveBeenCalledWith({
      collection: CHANNEL_CONTENTS_SLUG,
      id: 'cc1',
    })
    expect(payload.update).toHaveBeenCalledTimes(1)
    const updateArg = payload.update.mock.calls[0][0]
    expect(updateArg.collection).toBe(CHANNEL_CONTENTS_SLUG)
    expect(updateArg.id).toBe('cc1')
    expect(updateArg.data.status).toBe('in_review')
  })

  it('合法流转写入审计记录（操作人 / from→to / 时间）', async () => {
    const payload = makeMockPayload({ id: 'cc1', status: 'draft' as Status })

    await applyTransition(payload, 'cc1', 'in_review', 42)

    const log = payload.update.mock.calls[0][0].data
      .transitionLog as TransitionLogEntry[]
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ from: 'draft', to: 'in_review', user: 42 })
    expect(typeof log[0].at).toBe('string')
    // 没传 reason 时不应带 reason 字段
    expect(log[0].reason).toBeUndefined()
  })

  it('追加到既有 transitionLog 之后，不覆盖历史', async () => {
    const prior: TransitionLogEntry = {
      from: 'draft',
      to: 'in_review',
      user: 'u1',
      at: '2026-05-01T00:00:00.000Z',
    }
    const payload = makeMockPayload({
      id: 'cc1',
      status: 'in_review' as Status,
      transitionLog: [prior],
    })

    await applyTransition(payload, 'cc1', 'approved', 'u2')

    const log = payload.update.mock.calls[0][0].data
      .transitionLog as TransitionLogEntry[]
    expect(log).toHaveLength(2)
    expect(log[0]).toEqual(prior)
    expect(log[1]).toMatchObject({ from: 'in_review', to: 'approved', user: 'u2' })
  })

  it('打回 in_review → draft 带 reason，记录到审计', async () => {
    const payload = makeMockPayload({ id: 'cc1', status: 'in_review' as Status })

    await applyTransition(payload, 'cc1', 'draft', 'reviewer-1', '标题超字数，请删减')

    const data = payload.update.mock.calls[0][0].data
    expect(data.status).toBe('draft')
    const log = data.transitionLog as TransitionLogEntry[]
    expect(log[0]).toMatchObject({
      from: 'in_review',
      to: 'draft',
      user: 'reviewer-1',
      reason: '标题超字数，请删减',
    })
  })

  it('非法流转 draft → published：抛 IllegalTransitionError 且不写库', async () => {
    const payload = makeMockPayload({ id: 'cc1', status: 'draft' as Status })

    await expect(
      applyTransition(payload, 'cc1', 'published', 'user-7'),
    ).rejects.toBeInstanceOf(IllegalTransitionError)
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('目标状态非法值：抛错且不查库/写库', async () => {
    const payload = makeMockPayload({ id: 'cc1', status: 'draft' as Status })

    await expect(
      // @ts-expect-error 故意传非法状态以测运行时防御
      applyTransition(payload, 'cc1', 'archived', 'user-7'),
    ).rejects.toThrow(/未知的目标状态/)
    expect(payload.findByID).not.toHaveBeenCalled()
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('文档不存在：抛错且不写库', async () => {
    const payload = {
      findByID: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    }

    await expect(
      applyTransition(payload, 'missing', 'in_review', 'user-7'),
    ).rejects.toThrow(/不存在/)
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('当前状态为脏数据：抛错且不写库', async () => {
    const payload = makeMockPayload({ id: 'cc1', status: 'weird' })

    await expect(
      applyTransition(payload, 'cc1', 'in_review', 'user-7'),
    ).rejects.toThrow(/当前状态非法/)
    expect(payload.update).not.toHaveBeenCalled()
  })
})
