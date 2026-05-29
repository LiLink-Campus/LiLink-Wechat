import type { CollectionConfig } from 'payload'

// 运营账号。第一期"三人全能"：统一 operator 角色，预留 admin。
// 权限矩阵不做，协作靠渠道稿状态流转（见 workflow/）。
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    useAsTitle: 'email',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
    },
    {
      name: 'role',
      type: 'select',
      defaultValue: 'operator',
      options: [
        { label: '运营', value: 'operator' },
        { label: '管理员', value: 'admin' },
      ],
    },
  ],
}
