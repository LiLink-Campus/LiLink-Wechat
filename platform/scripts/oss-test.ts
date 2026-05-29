// OSS 分步诊断：定位是 RAM 权限问题还是 bucket ACL/公共访问设置问题。
// 跑法：cd platform && set -a; source .env; set +a; npx tsx scripts/oss-test.ts
import { ListBucketsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const bucket = process.env.S3_BUCKET!
const endpoint = process.env.S3_ENDPOINT!
const host = endpoint.replace(/^https?:\/\//, '')
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

const client = new S3Client({
  endpoint,
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: false,
})

// 调试：打印 SDK 实际请求的 host/path，判断 SDK 用的是 virtual-host 还是 path-style。
client.middlewareStack.add(
  (next: any) => async (args: any) => {
    const req = args.request as { hostname?: string; path?: string }
    console.log(`   → SDK 实际请求 host=${req.hostname} path=${req.path}`)
    return next(args)
  },
  { step: 'finalizeRequest', name: 'logReq' },
)

const key = 'oss-test/probe.txt'

async function main() {
  // ⓪ 账号级：列出该 AccessKey 账号下所有 bucket（跨 region），确认 lilink-content 是否属于本账号。
  try {
    const r = await client.send(new ListBucketsCommand({}))
    const names = (r.Buckets ?? []).map((b) => b.Name)
    console.log(`⓪ ListBuckets ✓  本账号 bucket（共 ${names.length}）：${names.join(', ') || '(空)'}`)
    console.log(`   lilink-content 属于本账号：${names.includes(bucket) ? '是 ✓' : '否 ✗（不在本账号名下！）'}`)
  } catch (e) {
    console.log(`⓪ ListBuckets ✗  ${msg(e)}`)
  }

  // ① 读权限（List）
  try {
    const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }))
    console.log(`① ListObjects ✓  RAM 读权限 OK（对象数约 ${r.KeyCount ?? 0}）`)
  } catch (e) {
    console.log(`① ListObjects ✗  ${msg(e)}`)
  }

  // ② 写权限（PutObject，无 object ACL）
  let put = false
  try {
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'hello-lilink', ContentType: 'text/plain' }),
    )
    console.log('② PutObject ✓  RAM 写权限 OK')
    put = true
  } catch (e) {
    console.log(`② PutObject ✗  ${msg(e)}`)
  }

  // ③ 公网匿名访问（bucket 公共读才会 200；私有则 403）
  if (put) {
    for (const [name, url] of [
      ['virtual-host', `https://${bucket}.${host}/${key}`],
      ['path-style', `${endpoint}/${bucket}/${key}`],
    ] as const) {
      try {
        const r = await fetch(url, { redirect: 'manual' })
        const loc = r.status >= 300 && r.status < 400 ? ` → 重定向 ${r.headers.get('location')}` : ''
        console.log(`③ ${name}  ${url}\n     公网访问 status ${r.status}${loc}`)
      } catch (e) {
        console.log(`③ ${name}  fetch 出错 ${msg(e)}`)
      }
    }
  }
  process.exit(0)
}

main()
