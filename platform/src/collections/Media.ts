import type { CollectionConfig } from 'payload'

// 共享素材库：图片 / 音频 / 视频。
// 第一期主要用于公众号封面图与正文配图；upload:true 让 Payload 接管文件存储。
// width/height/duration 由上传时探测/后续 hook 写入，对运营只读。
export const Media: CollectionConfig = {
  slug: 'media',
  upload: true,
  admin: {
    // 优先用 alt 作为标题；缺省时 Payload 会回退到文件名。
    useAsTitle: 'alt',
  },
  fields: [
    {
      name: 'type',
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
      type: 'text',
      // 无障碍/SEO 用替代文本，同时充当后台标题。
    },
    {
      name: 'caption',
      type: 'text',
      // 配图说明文字。
    },
    {
      name: 'credit',
      type: 'text',
      // 版权/来源署名。
    },
    {
      name: 'width',
      type: 'number',
      admin: { readOnly: true },
    },
    {
      name: 'height',
      type: 'number',
      admin: { readOnly: true },
    },
    {
      name: 'duration',
      type: 'number',
      // 音视频时长（秒），由上传后处理写入。
      admin: { readOnly: true },
    },
  ],
}
