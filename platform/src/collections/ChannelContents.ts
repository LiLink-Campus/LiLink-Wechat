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

const MANUAL_PUBLISH_PLATFORMS = ['weixin_channels', 'xiaohongshu', 'douyin']
const isManualPublishPlatform = (data?: Record<string, unknown>) =>
  MANUAL_PUBLISH_PLATFORMS.includes(String(data?.platform ?? ''))

// 渠道稿（ChannelContent）：一个选题在某个平台上的具体可发布内容 + 流转状态。
// 公众号（wechat）字段与人工平台（视频号/小红书/抖音）字段通过 admin.condition 分开显示。
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
        { label: '视频号', value: 'weixin_channels' },
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

    // ===== 视频号 / 小红书 / 抖音共用字段（生成人工发布包）=====
    {
      name: 'contentMode',
      label: '内容形态',
      type: 'select',
      defaultValue: 'image_note',
      options: [
        { label: '图文/笔记', value: 'image_note' },
        { label: '视频', value: 'video' },
      ],
      admin: {
        condition: isManualPublishPlatform,
        description: '视频号、小红书、抖音先生成人工发布包；后续浏览器自动化也复用这些字段。',
      },
    },
    {
      name: 'socialTitle',
      label: '平台标题',
      type: 'text',
      admin: {
        condition: isManualPublishPlatform,
        description: '按目标平台限制截断并预警：视频号 16 字，小红书 20 字，抖音 30 字。',
      },
    },
    {
      name: 'socialDescription',
      label: '平台正文/描述',
      type: 'textarea',
      admin: {
        condition: isManualPublishPlatform,
        description: '发布包会拼接正文、话题标签和 LiLink 链接；最终发布前请人工检查语气与导流风险。',
      },
    },
    {
      name: 'socialTags',
      label: '平台话题',
      type: 'array',
      admin: {
        condition: isManualPublishPlatform,
        description: '不用带 #，系统会生成 #话题；会自动补 LiLink / 校园社交。',
      },
      fields: [
        {
          name: 'tag',
          label: '话题',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'socialImages',
      label: '图文图片',
      type: 'relationship',
      relationTo: 'media',
      hasMany: true,
      admin: {
        condition: isManualPublishPlatform,
        description: '图文/笔记模式至少选择一张；顺序即发布包里的上传顺序。',
      },
    },
    {
      name: 'videoFile',
      label: '视频文件',
      type: 'relationship',
      relationTo: 'media',
      admin: {
        condition: isManualPublishPlatform,
        description: '视频模式必填；建议媒体库接云存储，确保发布包能拿到可访问 URL。',
      },
    },
    {
      name: 'horizontalCover',
      label: '横封面',
      type: 'relationship',
      relationTo: 'media',
      admin: {
        condition: isManualPublishPlatform,
        description: '视频号/抖音等平台可能需要横封面，发布包会列出供人工上传。',
      },
    },
    {
      name: 'verticalCover',
      label: '竖封面',
      type: 'relationship',
      relationTo: 'media',
      admin: {
        condition: isManualPublishPlatform,
        description: '小红书/抖音视频常用竖封面，建议准备 3:4 或平台推荐比例。',
      },
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
        { label: '待人工发布', value: 'ready_to_publish' },
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
            { label: '人工发布包已准备', value: 'manual_ready' },
            { label: '已群发', value: 'mass_sent' },
          ],
        },
        {
          name: 'manualPackage',
          label: '人工发布包',
          type: 'json',
        },
        {
          // 发布并发软锁时间戳：发布开始时置 now，结束/失败时由持有者清空。
          // 配合 lockToken 实现原子 CAS 抢锁（见 endpoints/publishLock.ts），防并发重复建草稿。
          // 崩溃遗留的锁会在 TTL（默认 10min）后被判定过期、可被后续请求重抢。
          name: 'lockedAt',
          label: '发布锁时间',
          type: 'date',
        },
        {
          // 发布锁持有者令牌（每次发布生成的随机 UUID）。释放锁时仅清「令牌一致」的锁，
          // 避免慢请求超时被他人抢走后又误清掉新持有者的锁。
          name: 'lockToken',
          label: '发布锁令牌',
          type: 'text',
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
