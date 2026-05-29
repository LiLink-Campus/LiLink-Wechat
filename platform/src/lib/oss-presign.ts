// 私有 OSS 桶的媒体直链签名。
//
// 桶保持私有（不公共读），媒体 url 用「直链 presigned URL」——带签名 query 的 OSS 直链
// (https://bucket.endpoint/key?X-Amz-Signature=...)，无重定向。这样：
//   - 发布时我们服务器 fetch 原图（client redirect:'error' + SSRF 防护）能直接拿到；
//   - 微信侧若直接 fetch 也能拿到。
// presigned 是纯本地签名计算（不发网络请求），每次 read 实时生成 fresh URL。
//
// 时效 1 小时：发布是秒级（取 url → 立即上传微信换 mmbiz/永久素材），预览/后台每次加载
// 都重新签名，足够；源图签名过期也不影响已发布内容（微信已存自己的副本）。

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// 仅当配了 S3_BUCKET 才启用（否则走本地磁盘，dev 兜底）。
export const ossPresignEnabled = Boolean(process.env.S3_BUCKET)

let client: S3Client | null = null

function getClient(): S3Client | null {
  if (!ossPresignEnabled) return null
  if (!client) {
    client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
      // OSS 用 virtual-hosted（bucket.endpoint），不要 path-style。
      forcePathStyle: false,
    })
  }
  return client
}

// 给对象 key 生成 1 小时有效的直链 presigned GET URL；OSS 未配置或出错返回 null（调用方保留原值）。
export async function presignKey(key: string): Promise<string | null> {
  const c = getClient()
  if (!c || !key) return null
  try {
    return await getSignedUrl(c, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), {
      expiresIn: 3600,
    })
  } catch (err) {
    // 签名失败不抛（保留原值避免阻断读取），但要留痕——否则 media.url 会是私有桶下无法访问的
    // path-style url，问题拖到发布时才暴露且无迹可查（codex review Medium）。
    console.error(`[oss-presign] presignKey 失败 key=${key}：${err instanceof Error ? err.message : err}`)
    return null
  }
}
