import path from 'path'
import { fileURLToPath } from 'url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Posts } from './collections/Posts'
import { ChannelContents } from './collections/ChannelContents'
import { publishEndpoint } from './endpoints/publish'
import { transitionEndpoint } from './endpoints/transition'
import { inlineHtmlEndpoint } from './endpoints/inlineHtml'
import { zh } from '@payloadcms/translations/languages/zh'
import { s3Storage } from '@payloadcms/storage-s3'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// LiLink 内容中台 — Payload 配置。
// 第一期 collections（Media / Posts / ChannelContents）由后续任务补全并注册到下方数组。
export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  // 数组顺序即仪表板分组顺序：内容（选题/渠道稿）→ 资源（媒体库）→ 系统（运营账号），
  // 把最常用的「内容」放最前。
  collections: [
    Posts,
    // 渠道稿挂上发布 / 状态流转两个自定义 endpoint（在汇聚点注入，保持 ChannelContents 纯数据）。
    {
      ...ChannelContents,
      endpoints: [
        ...(Array.isArray(ChannelContents.endpoints) ? ChannelContents.endpoints : []),
        transitionEndpoint,
        publishEndpoint,
        inlineHtmlEndpoint,
      ],
    },
    Media,
    Users,
  ],
  editor: lexicalEditor({}),
  // admin 后台界面语言：中文（Welcome/Email/Create 等内置文案与日期等本地化）。
  i18n: {
    supportedLanguages: { zh },
    fallbackLanguage: 'zh',
  },
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI || '',
    },
  }),
  sharp,
  // 媒体存储接阿里云 OSS（S3 兼容）。仅当配置了 S3_BUCKET 时启用；否则用本地磁盘（dev 兜底）。
  plugins: [
    ...(process.env.S3_BUCKET
      ? [
          s3Storage({
            collections: { media: true },
            bucket: process.env.S3_BUCKET,
            // 不设对象级 ACL：该 bucket 是【私有桶】且禁用了 object ACL（PutObject 带 public-read 会被拒）。
            // 图片不靠公共读暴露，而是由 Media 的 afterRead hook 生成「直链 presigned URL」按需访问
            // （见 src/lib/oss-presign.ts）——桶保持私有更安全。切勿改成公共读或加 acl:'public-read'。
            config: {
              endpoint: process.env.S3_ENDPOINT,
              region: process.env.S3_REGION,
              credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
              },
              // OSS 用 virtual-hosted（bucket.endpoint），不要 path-style。
              forcePathStyle: false,
            },
            // 注：storage-s3 默认生成的 media.url 是 path-style（${endpoint}/${bucket}/${key}），
            // 私有桶下不可直接访问；实际 media.url 由 Media 的 afterRead hook 覆盖为直链 presigned
            // URL（https://bucket.endpoint/key?X-Amz-Signature=...），见 src/lib/oss-presign.ts。
          }),
        ]
      : []),
  ],
})
