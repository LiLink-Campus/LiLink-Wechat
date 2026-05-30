// 演示 seed：demo 运营账号 + 一个选题 + 一条带 Lexical 正文的公众号渠道稿。
// 跑法：cd platform && npx payload run scripts/seed-demo.ts
// 用完可在后台删除，或重建 DB。
import config from '@payload-config'
import { getPayload } from 'payload'

const payload = await getPayload({ config })

// 文本叶子工厂（Lexical SerializedTextNode 必填字段齐全）。
const t = (text: string, format = 0) => ({
  type: 'text', text, format, detail: 0, mode: 'normal', style: '', version: 1,
})
const para = (children: unknown[]) => ({
  type: 'paragraph', version: 1, direction: 'ltr', format: '', indent: 0, children,
})

// 一份示例正文：验证 标题(前缀染玫瑰) / 段落 / 引用(提示卡) / 列表(文本前缀)。
const body = {
  root: {
    type: 'root', version: 1, direction: 'ltr', format: '', indent: 0,
    children: [
      { type: 'heading', tag: 'h2', version: 1, direction: 'ltr', format: '', indent: 0, children: [t('一、开篇')] },
      para([t('这是一段正文，用来验证「微光玫瑰」排版：暖灰正文、舒展行距。')]),
      para([t('支持 '), t('加粗', 1), t(' 与行内强调。')]),
      { type: 'heading', tag: 'h3', version: 1, direction: 'ltr', format: '', indent: 0, children: [t('第一步 准备')] },
      { type: 'quote', version: 1, direction: 'ltr', format: '', indent: 0, children: [t('一个小建议：保持克制，少即是多。')] },
      {
        type: 'list', tag: 'ul', listType: 'bullet', start: 1, version: 1, direction: 'ltr', format: '', indent: 0,
        children: [
          { type: 'listitem', value: 1, version: 1, direction: 'ltr', format: '', indent: 0, children: [t('列表项一')] },
          { type: 'listitem', value: 2, version: 1, direction: 'ltr', format: '', indent: 0, children: [t('列表项二')] },
        ],
      },
    ],
  },
}

// 1) demo 账号
const email = 'demo@lilink.top'
const u = await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1 })
if (u.docs.length === 0) {
  await payload.create({ collection: 'users', data: { email, password: 'demo12345', name: '演示账号', role: 'admin' } })
  console.log('CREATED user', email)
} else { console.log('user exists', email) }

// 2) 选题
const p = await payload.find({ collection: 'posts', where: { title: { equals: '演示选题' } }, limit: 1 })
const post = p.docs[0] ?? (await payload.create({ collection: 'posts', data: { title: '演示选题', topic: 'LiLink' } }))
console.log('post id', post.id)

// 3) 渠道稿（公众号，带 Lexical 正文）
const c = await payload.find({ collection: 'channel-contents', where: { wxTitle: { equals: '演示文章' } }, limit: 1 })
if (c.docs.length === 0) {
  const cc = await payload.create({
    collection: 'channel-contents',
    data: {
      post: post.id, platform: 'wechat', wxTitle: '演示文章', wxAuthor: '李林',
      wxDigest: '验证可视化编辑与微光玫瑰预览', sourceUrl: 'https://lilink.top',
      body: body as never,
      renderConfig: { ctaUrl: 'https://lilink.top', ctaText: '去 LiLink 看看 →' },
    } as never,
  })
  console.log('CREATED channel-content id', cc.id)
} else { console.log('channel-content exists id', c.docs[0].id) }

process.exit(0)
