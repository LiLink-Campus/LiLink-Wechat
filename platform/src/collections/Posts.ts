import type { CollectionConfig } from 'payload'

// 选题：一个创作主题（内容母体），下可派生各平台渠道稿。只放与平台无关的共享信息。
export const Posts: CollectionConfig = {
  slug: 'posts',
  labels: { singular: '选题', plural: '选题' },
  admin: {
    group: '内容',
    description: '一个创作单元（一个题材）。在这里定主题、负责人、共享素材，再去「渠道稿」为各平台成稿。',
    useAsTitle: 'title',
    defaultColumns: ['title', 'topic', 'owner', 'updatedAt'],
  },
  fields: [
    {
      name: 'title',
      label: '选题名',
      type: 'text',
      required: true,
    },
    {
      name: 'topic',
      label: '主题 / 栏目',
      type: 'text',
      admin: { description: '选题归类，便于聚合检索。' },
    },
    {
      name: 'tags',
      label: '标签',
      type: 'array',
      admin: { description: '自由标签，可加多个。' },
      fields: [
        {
          name: 'tag',
          label: '标签',
          type: 'text',
        },
      ],
    },
    {
      name: 'owner',
      label: '负责人',
      type: 'relationship',
      relationTo: 'users',
    },
    {
      name: 'sharedAssets',
      label: '共享素材',
      type: 'relationship',
      relationTo: 'media',
      hasMany: true,
      admin: { description: '跨渠道复用的图 / 音 / 视频。' },
    },
    {
      name: 'notes',
      label: '备注',
      type: 'textarea',
      admin: { description: '内部备注 / 创作思路。' },
    },
  ],
}
