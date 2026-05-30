import { describe, it, expect } from 'vitest'
import {
  canCreateUser,
  canUpdateUser,
  canDeleteUser,
  canUpdateRole,
} from '../src/collections/Users'

// Users 集合访问控制的纯逻辑单元测试（不依赖 DB）。
// 信任边界：第一期三人协作，但「能改同事账号/角色」不应等于「业务协作权」。
// 防越权：任意登录运营不得改他人账号或自我提权为 admin。

const admin = { id: 1, role: 'admin' }
const operator = { id: 2, role: 'operator' }

describe('Users access：create（仅 admin；首用户走 registerFirstUser 不经此）', () => {
  it('admin 可建账号', () => {
    expect(canCreateUser({ req: { user: admin } })).toBe(true)
  })
  it('operator 不可建账号', () => {
    expect(canCreateUser({ req: { user: operator } })).toBe(false)
  })
  it('未登录不可建账号（绝不开放公开注册——首用户由 Payload registerFirstUser 端点处理）', () => {
    expect(canCreateUser({ req: { user: null } })).toBe(false)
    expect(canCreateUser({ req: {} })).toBe(false)
  })
})

describe('Users access：update（admin 或本人）', () => {
  it('admin 可改任意账号', () => {
    expect(canUpdateUser({ req: { user: admin }, id: 999 })).toBe(true)
  })
  it('本人可改自己（id 类型不一致也认：number user.id vs string url id）', () => {
    // Payload 里 user.id 可能是 number，endpoint 传入的 id 是 string —— 必须 String 比较，
    // 否则严格 === 会误拒本人改自己的 profile。
    expect(canUpdateUser({ req: { user: operator }, id: '2' })).toBe(true)
    expect(canUpdateUser({ req: { user: operator }, id: 2 })).toBe(true)
  })
  it('operator 不可改他人', () => {
    expect(canUpdateUser({ req: { user: operator }, id: 999 })).toBe(false)
  })
  it('未登录不可改', () => {
    expect(canUpdateUser({ req: { user: null }, id: 2 })).toBe(false)
  })
})

describe('Users access：delete（仅 admin）', () => {
  it('admin 可删', () => {
    expect(canDeleteUser({ req: { user: admin } })).toBe(true)
  })
  it('operator 不可删', () => {
    expect(canDeleteUser({ req: { user: operator } })).toBe(false)
  })
})

describe('Users access：role 字段 update（仅 admin，防自我提权）', () => {
  it('admin 可改 role', () => {
    expect(canUpdateRole({ req: { user: admin } })).toBe(true)
  })
  it('operator 不可改 role（防自我提权为 admin）', () => {
    expect(canUpdateRole({ req: { user: operator } })).toBe(false)
  })
  it('未登录不可改 role', () => {
    expect(canUpdateRole({ req: { user: null } })).toBe(false)
  })
})
