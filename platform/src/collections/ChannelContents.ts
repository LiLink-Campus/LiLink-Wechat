import type { CollectionConfig } from 'payload'
import {
  lexicalEditor,
  HeadingFeature,
  BoldFeature,
  ItalicFeature,
  UnorderedListFeature,
  OrderedListFeature,
  BlockquoteFeature,
  LinkFeature,
  UploadFeature,
  FixedToolbarFeature,
  InlineToolbarFeature,
  ParagraphFeature,
} from '@payloadcms/richtext-lexical'

// 渠道稿（ChannelContent）：一个选题在某个平台上的具体可发布内容 + 流转状态。
// 第一期重点是公众号（wechat），公众号专属字段通过 admin.condition 仅在 platform==='wechat' 时显示。
// status / renderedHtmlPreview / publishResult / transitionLog 由发布流水线写入，对运营只读，
// 且加字段级 access 拒绝经 API 直接改（只能走 transition/publish endpoint）。
export const ChannelContents: CollectionConfig = {
  slug: 'channel-contents',
  labels: { singular: '渠道稿', plural: '渠道稿' },
  admin: {
    group: '内容',
    description:
      '选题在某平台的具体稿件 + 发布状态。第一期做公众号：写正文、选封面、排版预览，走「草稿→待审核→已批准→已发布」。',
    useAsTitle: 'wxTitle',
    defaultColumns: ['post', 'platform', 'status', 'assignee', 'updatedAt'],
    // 一键预览：开新标签到预览页（取 body→渲染成「与发布完全相同」的公众号内联 HTML）。
    // 签名为 (doc, { req }) => string | null；doc 含本条 id。
    preview: (doc) => `/preview/channel-contents/${doc?.id}`,
  },
  fields: [
    {
      name: 'post',
      label: '所属选题',
      type: 'relationship',
      relationTo: 'posts',
      required: true,
      admin: { description: '这篇稿子属于哪个选题。' },
    },
    {
      name: 'platform',
      label: '发布平台',
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
      admin: { description: '选平台后会显示该平台专属字段（第一期仅公众号可用）。' },
    },

    // ===== 公众号专属字段（仅 platform === 'wechat' 时显示）=====
    {
      name: 'wxTitle',
      label: '公众号标题',
      type: 'text',
      admin: {
        condition: (data) => data?.platform === 'wechat',
      },
    },
    {
      name: 'wxAuthor',
      label: '作者',
      type: 'text',
      admin: {
        condition: (data) => data?.platform === 'wechat',
      },
    },
    {
      name: 'wxDigest',
      label: '摘要',
      type: 'textarea',
      admin: {
        condition: (data) => data?.platform === 'wechat',
        description: '公众号摘要；留空时微信会自动从正文截取。',
      },
    },
    {
      name: 'body',
      label: '正文',
      type: 'richText',
      admin: {
        condition: (data) => data?.platform === 'wechat',
        description: '可视化编辑，平台自动套微光玫瑰样式',
      },
      // 公众号正文编辑器：所见即所得。启用标题(H2/H3/H4)、加粗、斜体、有序/无序列表、
      // 引用、链接、上传图片（指向 media 集合）、段落，以及固定/浮动工具条。
      // 发布时由转换层把这份 Lexical JSON 渲染成全内联的公众号 HTML（见设计文档 §4.4）。
      editor: lexicalEditor({
        features: () => [
          ParagraphFeature(),
          HeadingFeature({ enabledHeadingSizes: ['h2', 'h3', 'h4'] }),
          BoldFeature(),
          ItalicFeature(),
          UnorderedListFeature(),
          OrderedListFeature(),
          BlockquoteFeature(),
          LinkFeature(),
          UploadFeature({ enabledCollections: ['media'] }),
          FixedToolbarFeature(),
          InlineToolbarFeature(),
        ],
      }),
    },
    {
      // 「复制到公众号」按钮：取与发布同一份内联 HTML，写入双格式剪贴板，
      // 运营粘进公众号编辑器即可，不掉格式（设计 §3.5 通道二）。
      name: 'copyToWechat',
      type: 'ui',
      admin: {
        condition: (data) => data?.platform === 'wechat',
        disableListColumn: true,
        components: { Field: '/components/CopyToWechat#CopyToWechat' },
      },
    },
    {
      name: 'coverImage',
      label: '封面图',
      type: 'relationship',
      relationTo: 'media',
      admin: {
        condition: (data) => data?.platform === 'wechat',
        description: '从媒体库选一张图作公众号封面（建议用云存储的图，详见 README）。',
      },
    },
    {
      name: 'sourceUrl',
      label: '阅读原文链接',
      type: 'text',
      defaultValue: 'https://lilink.top',
      admin: {
        condition: (data) => data?.platform === 'wechat',
        description: '公众号「阅读原文」跳转地址，发布时自动写入。',
      },
    },
    {
      name: 'renderConfig',
      label: '排版配置',
      type: 'group',
      admin: {
        condition: (data) => data?.platform === 'wechat',
      },
      fields: [
        {
          name: 'ctaUrl',
          label: '文末按钮链接',
          type: 'text',
        },
        {
          name: 'ctaText',
          label: '文末按钮文案',
          type: 'text',
        },
        {
          name: 'noCta',
          label: '不加文末按钮',
          type: 'checkbox',
        },
      ],
    },

    // ===== 流转 / 流水线状态（与平台无关）=====
    {
      name: 'status',
      label: '状态',
      type: 'select',
      defaultValue: 'draft',
      // 渠道稿状态机：草稿→待审→已批→已发布。由流转动作写入，后台只读。
      // 字段级 access 拒绝一切经访问控制的写入（admin.readOnly 只挡 UI，挡不住 API）；
      // 仅 transition/publish endpoint 内部 payload.update(Local API 默认 overrideAccess) 能改。
      admin: { readOnly: true, description: '只能通过「提交/审核/发布」动作流转，不能直接改。' },
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
      label: '当前处理人',
      type: 'relationship',
      relationTo: 'users',
    },
    {
      name: 'renderedHtmlPreview',
      label: '排版预览（HTML）',
      type: 'textarea',
      admin: { readOnly: true, description: '排版脚本产出的公众号 HTML，只读。' },
    },
    {
      name: 'publishResult',
      label: '发布结果',
      type: 'group',
      admin: { readOnly: true, description: '发布流水线回填，全部只读。' },
      access: { update: () => false },
      fields: [
        {
          name: 'wxDraftMediaId',
          label: '微信草稿 ID',
          type: 'text',
        },
        {
          name: 'publishedAt',
          label: '发布时间',
          type: 'date',
        },
        {
          name: 'lastError',
          label: '最近错误',
          type: 'text',
        },
        {
          name: 'stage',
          label: '阶段',
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
      label: '流转记录',
      type: 'json',
      // 状态流转审计：每次流转由 applyTransition 追加一条 {from,to,user,at,reason?}。
      // 用 json 以兼容任意 entry 结构（user id 可能是 number），后台只读。
      admin: { readOnly: true, description: '状态流转审计记录（系统自动写入）。' },
      access: { update: () => false },
    },
  ],
}
