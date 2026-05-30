import type { CollectionConfig } from 'payload'

// 访问控制纯逻辑（抽成可单测的纯函数；access 回调与 hook 都委托给它们）。
//
// 信任边界：第一期「三人全能」指业务协作权（写稿/流转），不应等于「能改同事账号或自我提权」。
// 任意登录运营被钓鱼/泄露后，不得借 Users 集合默认 access（Payload 默认 Boolean(user) 即任意
// 登录用户可写）去改他人 role 提权或改他人邮箱接管账号。

// 操作上下文里我们关心的最小形状：当前登录用户（可能为空）。role 兼容 Payload 生成的
// User.role 类型（'admin' | 'operator' | null | undefined），故显式允许 null。
type AccessUser = { id?: string | number; role?: string | null } | null | undefined
type AccessArgs = { req: { user?: AccessUser }; id?: string | number }

function isAdmin(user: AccessUser): boolean {
  return Boolean(user) && user!.role === 'admin'
}

/** 建账号：仅 admin。首个账号由 Payload 内置 registerFirstUser 端点创建（先验「无任何用户」
 *  再 overrideAccess 建首用户），不走本 access —— 故 admin-only 不会造成 bootstrap 死锁，
 *  且绝不开放公开注册。 */
export function canCreateUser({ req: { user } }: AccessArgs): boolean {
  return isAdmin(user)
}

/** 改账号：admin 可改任意；本人可改自己。id 用 String 比较 —— user.id 可能是 number，
 *  endpoint 传入的 id 可能是 string，严格 === 会误拒本人。 */
export function canUpdateUser({ req: { user }, id }: AccessArgs): boolean {
  if (isAdmin(user)) return true
  if (!user || user.id === undefined || id === undefined) return false
  return String(user.id) === String(id)
}

/** 删账号：仅 admin。 */
export function canDeleteUser({ req: { user } }: AccessArgs): boolean {
  return isAdmin(user)
}

/** 改 role 字段：仅 admin（防 operator 自我提权为 admin）。 */
export function canUpdateRole({ req: { user } }: AccessArgs): boolean {
  return isAdmin(user)
}

// 运营账号。第一期「三人全能」：业务协作权全员相同，但账号/角色管理收敛到 admin。
export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: '运营账号', plural: '运营账号' },
  auth: true,
  access: {
    // 账号管理（建/改他人/删）收敛到 admin；本人可改自己的资料。
    // 纯函数用宽松入参类型，这里适配 Payload 的 Access 签名（user 为具体 User 类型）。
    create: (args) => canCreateUser(args as unknown as AccessArgs),
    update: (args) => canUpdateUser(args as unknown as AccessArgs),
    delete: (args) => canDeleteUser(args as unknown as AccessArgs),
  },
  admin: {
    group: '系统',
    description: '团队运营成员账号。第一期三人全能、业务权限不细分；账号与角色管理限管理员。',
    useAsTitle: 'email',
    defaultColumns: ['name', 'email', 'role'],
  },
  hooks: {
    // 防自我提权兜底：即便 canUpdateUser 放行了「本人改自己」，本人也不得把自己的 role
    // 改成 admin（或改动 role）。字段级 access 已挡常规写路径，这里再加 hook 双保险——
    // 非 admin 提交了与原值不同的 role 一律拒绝。
    beforeValidate: [
      ({ data, req, originalDoc, operation }) => {
        if (operation !== 'create' && operation !== 'update') return data
        if (!data || data.role === undefined) return data
        // 未登录能走到这里只可能是首用户 create（registerFirstUser，overrideAccess）；其余未登录
        // 写已被 collection access 挡下。首用户角色由下方 beforeChange 的 bootstrap 提权统一处理，
        // 这里不拦，避免误伤首次安装。
        if (!req.user) return data
        if (isAdmin(req.user as AccessUser)) return data
        const prevRole = originalDoc?.role ?? 'operator'
        if (data.role !== prevRole) {
          throw new Error('无权修改账号角色：仅管理员可变更 role')
        }
        return data
      },
    ],
    beforeChange: [
      // 首用户 bootstrap 提权（codex review High）：Payload registerFirstUser 在「库中无任何用户」
      // 时允许未登录创建首账号（绕过 create access），但其 role 默认 operator；而本集合 create 已
      // 收敛为 admin-only —— 若首用户非 admin，此后将无任何 admin 能再建账号，账号管理彻底锁死。
      // 故创建「第一个用户」时强制 role=admin。库中已有用户后该分支不再触发（不影响后续建号）。
      async ({ data, req, operation }) => {
        if (operation === 'create') {
          const { totalDocs } = await req.payload.count({ collection: 'users', req })
          if (totalDocs === 0) {
            return { ...data, role: 'admin' }
          }
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'name',
      label: '姓名',
      type: 'text',
    },
    {
      name: 'role',
      label: '角色',
      type: 'select',
      defaultValue: 'operator',
      // 角色变更仅 admin（防自我提权）。admin.readOnly 只挡 UI、挡不住 API，故用字段级 access。
      access: {
        update: (args) => canUpdateRole(args as unknown as AccessArgs),
      },
      options: [
        { label: '运营', value: 'operator' },
        { label: '管理员', value: 'admin' },
      ],
    },
  ],
}
