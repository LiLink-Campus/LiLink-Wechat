// 临时演示脚本：创建一个 demo 运营账号，用于登录后台截图/演示。
// 跑法：cd platform && npx payload run scripts/seed-demo.ts
// 用完可在后台删除该账号，或重置 DB。
import config from '@payload-config'
import { getPayload } from 'payload'

const payload = await getPayload({ config })
const email = 'demo@lilink.top'

const existing = await payload.find({
  collection: 'users',
  where: { email: { equals: email } },
  limit: 1,
})

if (existing.docs.length === 0) {
  await payload.create({
    collection: 'users',
    data: { email, password: 'demo12345', name: '演示账号', role: 'admin' },
  })
  console.log('CREATED demo user:', email)
} else {
  console.log('demo user already exists:', email)
}

process.exit(0)
