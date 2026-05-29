import type { CollectionConfig } from 'payload'

// 选题/内容母体（Post）。一个 Post 承载一个创作主题，
// 再由 ChannelContents 派生出各平台（公众号/小红书/...）的渠道稿。
// 这里只放与平台无关的共享信息：主题、标签、归属、共享素材、备注。
export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'topic',
      type: 'text',
      // 选题/栏目归类，便于聚合检索。
    },
    {
      name: 'tags',
      type: 'array',
      // 自由标签；用 array+子字段而非 select hasMany，方便后续扩展标签结构。
      fields: [
        {
          name: 'tag',
          type: 'text',
        },
      ],
    },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      // 选题负责人。
    },
    {
      name: 'sharedAssets',
      type: 'relationship',
      relationTo: 'media',
      hasMany: true,
      // 跨渠道复用的素材（图/音/视频）。
    },
    {
      name: 'notes',
      type: 'textarea',
      // 内部备注/创作思路。
    },
  ],
}
