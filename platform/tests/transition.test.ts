import { describe, it, expect, vi, beforeEach } from 'vitest'

// 只 mock applyTransition；IllegalTransitionError 保留真实类，
// 否则 handler 里的 `err instanceof IllegalTransitionError` 判断会失效。
vi.mock('../src/workflow/transition', async () => {
  const actual = await vi.importActual<typeof import('../src/workflow/transition')>(
    '../src/workflow/transition',
  )
  return {
    ...actual,
    applyTransition: vi.fn(),
  }
})

import { transitionEndpoint } from '../src/endpoints/transition'
import { applyTransition, IllegalTransitionError } from '../src/workflow/transition'
import type { Status } from '../src/workflow/states'

const mockedApply = vi.mocked(applyTransition)

/**
 * 构造一个最小可用的 fake PayloadRequest，覆盖 handler 用到的字段：
 * user / routeParams / json() / payload。其余字段不需要，用 as any 收口。
 */
function makeReq(opts: {
  user?: { id: string | number } | null
  id?: string
  body?: unknown
  jsonThrows?: boolean
}) {
  const { user = { id: 'op-1' }, id = 'cc1', body, jsonThrows } = opts
  return {
    user,
    routeParams: id === undefined ? {} : { id },
    payload: { __isPayload: true },
    json: jsonThrows
      ? vi.fn().mockRejectedValue(new Error('bad json'))
      : vi.fn().mockResolvedValue(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

/** 取出 Response 的 status 与解析后的 JSON body。 */
async function readResponse(res: Response): Promise<{ status: number; json: any }> {
  return { status: res.status, json: await res.json() }
}

// handler 在类型上可能为 undefined，测试里断言它存在后再调用。
const handler = transitionEndpoint.handler!

beforeEach(() => {
  mockedApply.mockReset()
})

describe('transitionEndpoint 元信息', () => {
  it('挂在 :id/transition 路径、POST 方法', () => {
    expect(transitionEndpoint.path).toBe('/:id/transition')
    expect(transitionEndpoint.method).toBe('post')
  })
})

describe('transitionEndpoint 合法流转', () => {
  it('用路径 id、body.to、登录用户 id 调 applyTransition，并返回新 status', async () => {
    mockedApply.mockResolvedValue(undefined)
    const req = makeReq({
      user: { id: 'op-7' },
      id: 'cc-42',
      body: { to: 'in_review' as Status },
    })

    const res = await handler(req)
    const { status, json } = await readResponse(res as Response)

    expect(status).toBe(200)
    expect(json).toEqual({ id: 'cc-42', status: 'in_review' })
    // payload 实例、id、目标状态、操作人按序透传；无 reason 时传 undefined
    expect(mockedApply).toHaveBeenCalledTimes(1)
    expect(mockedApply).toHaveBeenCalledWith(
      req.payload,
      'cc-42',
      'in_review',
      'op-7',
      undefined,
    )
  })

  it('打回时把 body.reason 透传给 applyTransition', async () => {
    mockedApply.mockResolvedValue(undefined)
    const req = makeReq({
      user: { id: 9 },
      id: 'cc1',
      body: { to: 'draft' as Status, reason: '标题超字数' },
    })

    const res = await handler(req)
    const { status } = await readResponse(res as Response)

    expect(status).toBe(200)
    expect(mockedApply).toHaveBeenCalledWith(
      req.payload,
      'cc1',
      'draft',
      9,
      '标题超字数',
    )
  })

  it('空字符串 reason 归一化为 undefined（不当作打回理由）', async () => {
    mockedApply.mockResolvedValue(undefined)
    const req = makeReq({ body: { to: 'approved' as Status, reason: '' } })

    await handler(req)

    expect(mockedApply).toHaveBeenCalledWith(
      expect.anything(),
      'cc1',
      'approved',
      'op-1',
      undefined,
    )
  })
})

describe('transitionEndpoint 非法流转', () => {
  it('applyTransition 抛 IllegalTransitionError → 400 + from/to', async () => {
    mockedApply.mockRejectedValue(new IllegalTransitionError('draft', 'published'))
    const req = makeReq({ body: { to: 'published' as Status } })

    const res = await handler(req)
    const { status, json } = await readResponse(res as Response)

    expect(status).toBe(400)
    expect(json.from).toBe('draft')
    expect(json.to).toBe('published')
    expect(json.error).toMatch(/非法状态流转/)
  })

  it('applyTransition 抛普通 Error（如渠道稿不存在）→ 400 + message', async () => {
    mockedApply.mockRejectedValue(new Error('渠道稿不存在：cc1'))
    const req = makeReq({ body: { to: 'in_review' as Status } })

    const res = await handler(req)
    const { status, json } = await readResponse(res as Response)

    expect(status).toBe(400)
    expect(json.error).toBe('渠道稿不存在：cc1')
  })
})

describe('transitionEndpoint 入参校验', () => {
  it('未登录 → 401，且不调 applyTransition', async () => {
    const req = makeReq({ user: null, body: { to: 'in_review' as Status } })

    const res = await handler(req)
    const { status, json } = await readResponse(res as Response)

    expect(status).toBe(401)
    expect(json.error).toMatch(/未登录/)
    expect(mockedApply).not.toHaveBeenCalled()
  })

  it('缺少路径 id → 400，且不调 applyTransition', async () => {
    // 显式构造一个 routeParams 里没有 id 的 req
    const req = makeReq({ body: { to: 'in_review' as Status } })
    req.routeParams = {}

    const res = await handler(req)
    const { status, json } = await readResponse(res as Response)

    expect(status).toBe(400)
    expect(json.error).toMatch(/缺少渠道稿 id/)
    expect(mockedApply).not.toHaveBeenCalled()
  })

  it('body.to 非法状态 → 400，且不调 applyTransition', async () => {
    const req = makeReq({ body: { to: 'archived' } })

    const res = await handler(req)
    const { status, json } = await readResponse(res as Response)

    expect(status).toBe(400)
    expect(json.error).toMatch(/非法的目标状态/)
    expect(mockedApply).not.toHaveBeenCalled()
  })

  it('body 缺失 to 字段 → 400，且不调 applyTransition', async () => {
    const req = makeReq({ body: {} })

    const res = await handler(req)
    const { status } = await readResponse(res as Response)

    expect(status).toBe(400)
    expect(mockedApply).not.toHaveBeenCalled()
  })

  it('body 非法 JSON（json() 抛错）→ 当作空 body → 400', async () => {
    const req = makeReq({ jsonThrows: true })

    const res = await handler(req)
    const { status } = await readResponse(res as Response)

    expect(status).toBe(400)
    expect(mockedApply).not.toHaveBeenCalled()
  })
})
