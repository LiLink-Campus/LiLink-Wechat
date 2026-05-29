// OSS 真图 → 公众号草稿 全链路联调。
// 经 Payload 上传图进私有 OSS 桶 → 拿 presigned 直链 → 用 wechat client fetch 该直链并上传
// （封面永久素材 + 正文图）→ 建草稿。验证关键新点：client 的 redirect:'error' + SSRF 防护能
// fetch OSS presigned 图。成功后公众号「草稿箱」可见「LiLink OSS 真图联调」。
//
// 跑法：cd platform && set -a; source .env; set +a; npx tsx scripts/oss-publish-test.ts
// 前置：WX 凭据 + 调用方公网 IP 在公众号 IP 白名单；S3_* 已配。
import config from '@payload-config'
import { getPayload } from 'payload'
import { getAccessToken } from '../src/wechat/token'
import { addDraft, addPermanentImage, uploadContentImage } from '../src/wechat/client'
import sharp from 'sharp'

const appId = process.env.WX_APP_ID
const secret = process.env.WX_APP_SECRET
if (!appId || !secret) {
  console.error('缺少 WX_APP_ID / WX_APP_SECRET，请先 source .env')
  process.exit(1)
}

const payload = await getPayload({ config })
// 微信素材接口会拒收异常/极小图（1x1 报 40113 unsupported file type）；用 sharp 生成一张
// 正常尺寸的玫瑰色 JPG（400x300，微光玫瑰主色），与真实封面尺寸接近，微信可接受。
const jpg = await sharp({
  create: { width: 400, height: 300, channels: 3, background: { r: 194, g: 112, b: 108 } },
})
  .jpeg()
  .toBuffer()

let coverId: string | number | undefined
let failed = false
try {
  console.log('① 上传图进私有 OSS 桶 …')
  const cover = await payload.create({
    collection: 'media',
    data: { type: 'image', alt: 'OSS 真图联调' },
    file: { data: jpg, name: 'oss-publish-probe.jpg', mimetype: 'image/jpeg', size: jpg.length },
  })
  coverId = cover.id
  const ossUrl = cover.url as string
  console.log(`   ✓ OSS presigned 直链：${ossUrl.slice(0, 90)}…`)

  console.log('② 取 access_token …')
  const token = await getAccessToken(appId, secret)
  console.log('   ✓ token OK（凭据 + IP 白名单 OK）')

  console.log('③ 封面 → 永久素材（client fetch OSS presigned 图 → 上传微信）…')
  const { mediaId: thumb } = await addPermanentImage(token, ossUrl)
  console.log(`   ✓ thumb_media_id = ${thumb}`)

  console.log('④ 正文图 → 微信 URL（client fetch OSS presigned 图 → 上传微信）…')
  const { url: wxImg } = await uploadContentImage(token, ossUrl)
  console.log(`   ✓ 正文图 mmbiz URL = ${wxImg}`)

  console.log('⑤ 建草稿 …')
  const content =
    `<section style="font-size:16px;line-height:1.9;color:#4a4340">` +
    `<p style="margin:0 0 1.15em;letter-spacing:.02em">OSS 真图联调：封面与正文图均来自私有 OSS 桶的 presigned 直链，由中台服务器 fetch 后上传微信。</p>` +
    `<figure style="margin:0;padding:0"><img src="${wxImg}" alt="OSS 测试图" style="display:block;max-width:100%;border-radius:8px" /></figure>` +
    `</section>`
  const { mediaId } = await addDraft(token, {
    title: 'LiLink OSS 真图联调',
    author: 'LiLink',
    digest: 'OSS presigned 图 → 微信封面/正文图 → 草稿',
    content,
    thumb_media_id: thumb,
    content_source_url: 'https://lilink.top',
  })
  console.log(`   ✓ 草稿 media_id = ${mediaId}`)
  console.log('\n全链路 ✅：私有 OSS presigned 图 → client fetch → 微信封面/正文图 → 草稿')
  console.log('去公众号后台「草稿箱」查看「LiLink OSS 真图联调」（可删）。')
} catch (e) {
  failed = true
  console.error('\n✗ 联调失败：', e instanceof Error ? e.message : e)
} finally {
  if (coverId !== undefined) {
    await payload.delete({ collection: 'media', id: coverId }).catch(() => {})
    console.log('（已清理 OSS 测试图，草稿保留）')
  }
  process.exit(failed ? 1 : 0)
}
