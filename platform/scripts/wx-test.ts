// 微信公众号发布链路·真机联调脚本（直接用 wechat client，不依赖 Payload/DB）。
//
// 跑法（在 platform 目录）：
//   set -a; source .env; set +a
//   npx tsx scripts/wx-test.ts
//
// 验证全链路：取 token → 封面永久素材 → 正文图 → 建草稿。成功后去公众号后台
// 「草稿箱」可看到标题「LiLink 联调测试」的草稿（可直接删）。
//
// 前置：① .env 配好 WX_APP_ID/WX_APP_SECRET；② 调用方公网 IP 已加入公众号后台 IP 白名单。
// 测试图：默认用一张公网直链图（无重定向、image content-type；我们的 client 出于 SSRF 防护
//   用 redirect:'error'，所以测试图必须是直链）。可用 WX_TEST_IMG 环境变量覆盖。
import { getAccessToken } from '../src/wechat/token'
import { addPermanentImage, uploadContentImage, addDraft } from '../src/wechat/client'

const appId = process.env.WX_APP_ID
const secret = process.env.WX_APP_SECRET
if (!appId || !secret) {
  console.error('缺少 WX_APP_ID / WX_APP_SECRET，请先 source .env')
  process.exit(1)
}
const TEST_IMG =
  process.env.WX_TEST_IMG || 'https://upload.wikimedia.org/wikipedia/commons/3/3a/Cat03.jpg'

async function main() {
  console.log('① 取 access_token …')
  const token = await getAccessToken(appId!, secret!)
  console.log('   ✓ token 拿到（凭据 + IP 白名单 OK）')

  console.log('② 上传封面永久素材 …', TEST_IMG)
  const { mediaId: thumb } = await addPermanentImage(token, TEST_IMG)
  console.log('   ✓ thumb_media_id =', thumb)

  console.log('③ 上传正文图 …')
  const { url: wxImg } = await uploadContentImage(token, TEST_IMG)
  console.log('   ✓ 正文图微信 URL =', wxImg)

  console.log('④ 建草稿 …')
  const content =
    `<section style="font-size:16px;line-height:1.9;color:#4a4340">` +
    `<p style="margin:0 0 1.15em;letter-spacing:.02em">这是 LiLink 中台的真机联调测试正文。</p>` +
    `<figure style="margin:0;padding:0"><img src="${wxImg}" alt="测试图" style="display:block;max-width:100%;border-radius:8px" /></figure>` +
    `</section>`
  const { mediaId } = await addDraft(token, {
    title: 'LiLink 联调测试',
    author: 'LiLink',
    digest: '真机联调验证',
    content,
    thumb_media_id: thumb,
    content_source_url: 'https://lilink.top',
  })
  console.log('   ✓ 草稿 media_id =', mediaId)
  console.log('\n全链路打通 ✅ 去公众号后台「草稿箱」查看「LiLink 联调测试」（可删）。')
  process.exit(0)
}

main().catch((e) => {
  console.error('\n✗ 联调失败：', e instanceof Error ? e.message : e)
  process.exit(1)
})
