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
})
