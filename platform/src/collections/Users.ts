import type { CollectionConfig } from 'payload'

// 运营账号。第一期「三人全能」：统一 operator 角色，靠渠道稿状态流转协作。
export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: '运营账号', plural: '运营账号' },
  auth: true,
  admin: {
    group: '系统',
    description: '团队运营成员账号。第一期三人全能、权限不细分，靠「渠道稿」的状态流转来协作。',
    useAsTitle: 'email',
    defaultColumns: ['name', 'email', 'role'],
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
      options: [
        { label: '运营', value: 'operator' },
        { label: '管理员', value: 'admin' },
      ],
    },
  ],
}
