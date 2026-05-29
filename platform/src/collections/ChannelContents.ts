import type { CollectionConfig } from 'payload'

// 渠道稿（ChannelContent）：一个 Post 在某个平台上的具体可发布内容 + 流转状态。
// 第一期重点是公众号（wechat），公众号专属字段通过 admin.condition 仅在 platform==='wechat' 时显示。
// status / renderedHtmlPreview / publishResult 等由发布流水线（workflow）写入，对运营只读。
export const ChannelContents: CollectionConfig = {
  slug: 'channel-contents',
  admin: {
    useAsTitle: 'wxTitle',
    defaultColumns: ['post', 'platform', 'status', 'assignee', 'updatedAt'],
  },
  fields: [
    {
      name: 'post',
      type: 'relationship',
      relationTo: 'posts',
      required: true,
      // 所属选题母体。
    },
    {
      name: 'platform',
      type: 'select',
      required: true,
      defaultValue: 'wechat',
      options: [
        { label: '微信公众号', value: 'wechat' },
        { label: '小红书', value: 'xiaohongshu' },
        { label: 'X', value: 'x' },
        { label: '抖音', value: 'douyin' },
        { label: '哔哩哔哩', value: 'bilibili' },
      ],
    },

    // ===== 公众号专属字段（仅 platform === 'wechat' 时显示）=====
    {
      name: 'wxTitle',
      type: 'text',
      admin: {
        condition: (data) => data?.platform === 'wechat',
      },
    },
    {
      name: 'wxAuthor',
      type: 'text',
      admin: {
        condition: (data) => data?.platform === 'wechat',
      },
    },
    {
      name: 'wxDigest',
      type: 'textarea',
      // 公众号摘要。
      admin: {
        condition: (data) => data?.platform === 'wechat',
      },
    },
    {
      name: 'bodyMarkdown',
      type: 'textarea',
      // 正文（Markdown），交给排版脚本渲染成微信 HTML。
      admin: {
        condition: (data) => data?.platform === 'wechat',
      },
    },
    {
      name: 'coverImage',
      type: 'relationship',
      relationTo: 'media',
      // 公众号封面图。
      admin: {
        condition: (data) => data?.platform === 'wechat',
      },
    },
    {
      name: 'sourceUrl',
      type: 'text',
      defaultValue: 'https://lilink.top',
      // 原文链接（阅读原文）。
      admin: {
        condition: (data) => data?.platform === 'wechat',
      },
    },
    {
      name: 'renderConfig',
      type: 'group',
      // 排版/收尾按钮配置，传给渲染脚本。
      admin: {
        condition: (data) => data?.platform === 'wechat',
      },
      fields: [
        {
          name: 'ctaUrl',
          type: 'text',
        },
        {
          name: 'ctaText',
          type: 'text',
        },
        {
          name: 'noCta',
          type: 'checkbox',
          // 勾选则不渲染文末按钮。
        },
      ],
    },

    // ===== 流转 / 流水线状态（与平台无关）=====
    {
      name: 'status',
      type: 'select',
      defaultValue: 'draft',
      // 渠道稿状态机：草稿→待审→已批→已发布。由流转动作写入，后台只读。
      // 字段级 access 拒绝一切经访问控制的写入（admin.readOnly 只挡 UI，挡不住 API）；
      // 仅 transition/publish endpoint 内部 payload.update(Local API 默认 overrideAccess) 能改。
      admin: { readOnly: true },
      access: { update: () => false },
      options: [
        { label: '草稿', value: 'draft' },
        { label: '待审核', value: 'in_review' },
        { label: '已批准', value: 'approved' },
        { label: '已发布', value: 'published' },
      ],
    },
    {
      name: 'assignee',
      type: 'relationship',
      relationTo: 'users',
      // 当前处理人。
    },
    {
      name: 'renderedHtmlPreview',
      type: 'textarea',
      // 排版脚本产出的微信 HTML 预览，只读。
      admin: { readOnly: true },
    },
    {
      name: 'publishResult',
      type: 'group',
      // 发布结果回填（草稿 mediaId、发布时间、最近错误、阶段），全部由流水线写入。
      admin: { readOnly: true },
      access: { update: () => false },
      fields: [
        {
          name: 'wxDraftMediaId',
          type: 'text',
        },
        {
          name: 'publishedAt',
          type: 'date',
        },
        {
          name: 'lastError',
          type: 'text',
        },
        {
          name: 'stage',
          type: 'select',
          defaultValue: 'none',
          options: [
            { label: '未开始', value: 'none' },
            { label: '已建草稿', value: 'draft_created' },
            { label: '已群发', value: 'mass_sent' },
          ],
        },
      ],
    },
    {
      name: 'transitionLog',
      type: 'json',
      // 状态流转审计：每次流转由 applyTransition 追加一条 {from,to,user,at,reason?}。
      // 用 json 以兼容任意 entry 结构（user id 可能是 number），后台只读。
      admin: { readOnly: true },
      access: { update: () => false },
    },
  ],
}
