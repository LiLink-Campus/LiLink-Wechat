// OSS 媒体端到端联调：经 Payload local API 上传一张图 → storage-s3 存进私有 OSS 桶 →
// afterRead 把 url 改写成直链 presigned → fetch 验证签名直链可读（私有桶经签名匿名可取）→ 清理。
// 跑法：cd platform && set -a; source .env; set +a; npx tsx scripts/oss-media-test.ts
import config from '@payload-config'
import { getPayload } from 'payload'

const payload = await getPayload({ config })

// 最小合法 1x1 PNG。
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const created = await payload.create({
  collection: 'media',
  data: { type: 'image', alt: 'OSS 联调测试图' },
  file: { data: png, name: 'oss-probe.png', mimetype: 'image/png', size: png.length },
})
console.log(`① 上传 media  id=${created.id}  filename=${created.filename}`)
console.log(`② afterRead url=${created.url}`)

const url = typeof created.url === 'string' ? created.url : ''
const isPresigned = /oss-ap-southeast-1\.aliyuncs\.com\/.*[?&]X-Amz-Signature=/.test(url)
console.log(`   是 presigned 直链：${isPresigned ? '是 ✓' : '否 ✗'}`)

if (url) {
  const r = await fetch(url, { redirect: 'manual' })
  const redir = r.status >= 300 && r.status < 400 ? `  （重定向到 ${r.headers.get('location')}！）` : ''
  console.log(`③ fetch presigned 直链  status=${r.status}${redir}`)
  if (r.status === 200) {
    const buf = Buffer.from(await r.arrayBuffer())
    console.log(`   取回字节数=${buf.length}（原图 ${png.length}）${buf.length === png.length ? ' ✓ 一致' : ''}`)
  }
}

await payload.delete({ collection: 'media', id: created.id })
console.log('④ 已清理测试 media（OSS 对象 + db 记录）')
process.exit(0)
