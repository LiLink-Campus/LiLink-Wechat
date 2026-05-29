import type { CollectionConfig } from 'payload'
import { ossPresignEnabled, presignKey } from '../lib/oss-presign'

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
  // 私有 OSS 桶：把 media.url（及各缩略图尺寸的 url）改写成直链 presigned URL（带签名的
  // 临时直链，无重定向）。服务器 fetch 原图（client redirect:'error'）与微信 fetch 都能直接
  // 拿到；每次 read 实时生成 fresh URL，1 小时有效（详见 lib/oss-presign）。
  hooks: {
    afterRead: [
      async ({ doc }) => {
        if (!ossPresignEnabled || !doc) return doc
        const d = doc as {
          filename?: unknown
          url?: string
          sizes?: Record<string, { url?: string; filename?: unknown }>
        }
        if (typeof d.filename === 'string' && d.filename) {
          const signed = await presignKey(d.filename)
          if (signed) d.url = signed
        }
        if (d.sizes && typeof d.sizes === 'object') {
          for (const size of Object.values(d.sizes)) {
            if (size && typeof size.filename === 'string' && size.filename) {
              const s = await presignKey(size.filename)
              if (s) size.url = s
            }
          }
        }
        return doc
      },
    ],
  },
}
