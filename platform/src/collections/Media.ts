import type { CollectionConfig } from 'payload'

// 媒体库：图片 / 音频 / 视频素材。第一期主要用于公众号封面图与正文配图。
// upload:true 让 Payload 接管文件存储；width/height/duration 由上传探测/后续 hook 写入，只读。
export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: '媒体', plural: '媒体库' },
  upload: true,
  admin: {
    group: '资源',
    description: '图片 / 音频 / 视频素材，供选题与渠道稿引用（第一期以图片为主）。',
    useAsTitle: 'alt',
    defaultColumns: ['alt', 'type', 'updatedAt'],
  },
  fields: [
    {
      name: 'type',
      label: '类型',
      type: 'select',
      required: true,
      defaultValue: 'image',
      options: [
        { label: '图片', value: 'image' },
        { label: '音频', value: 'audio' },
        { label: '视频', value: 'video' },
      ],
    },
    {
      name: 'alt',
      label: '图片说明',
      type: 'text',
      admin: { description: '替代文本（无障碍 / SEO），同时作为后台标题；建议填有意义的描述。' },
    },
    {
      name: 'caption',
      label: '题注',
      type: 'text',
      admin: { description: '配图下方的说明文字。' },
    },
    {
      name: 'credit',
      label: '来源 / 版权',
      type: 'text',
    },
    {
      name: 'width',
      label: '宽度(px)',
      type: 'number',
      admin: { readOnly: true },
    },
    {
      name: 'height',
      label: '高度(px)',
      type: 'number',
      admin: { readOnly: true },
    },
    {
      name: 'duration',
      label: '时长(秒)',
      type: 'number',
      admin: { readOnly: true, description: '音视频时长，由上传后处理写入。' },
    },
  ],
}
