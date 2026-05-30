// 探测联调环境的微信出口 IP 池：连续多次取 token（失败的 errmsg 含出口 IP），统计分布、
// 看能否命中白名单。用来判断「靠加白名单撞中」是否现实，还是只能等生产固定 IP。
// 跑法：cd platform && set -a; source .env; set +a; npx tsx scripts/wx-ip-probe.ts
import { clearTokenCache, getAccessToken } from '../src/wechat/token' // import 即触发 force-ipv4

const appId = process.env.WX_APP_ID
const secret = process.env.WX_APP_SECRET
if (!appId || !secret) {
  console.error('缺少 WX 凭据，请先 source .env')
  process.exit(1)
}

const N = 12
const seen = new Map<string, number>()
let ok = false

for (let i = 0; i < N; i++) {
  clearTokenCache(appId) // 失败本就不缓存；成功会缓存，清掉以便每次都真发请求
  try {
    await getAccessToken(appId, secret)
    console.log(`第 ${i + 1} 次：✓ token 成功（出口命中白名单）`)
    ok = true
    break
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const ip = /invalid ip ([\d.]+)/.exec(msg)?.[1] ?? '(非IP错误: ' + msg.slice(0, 40) + ')'
    seen.set(ip, (seen.get(ip) ?? 0) + 1)
    console.log(`第 ${i + 1} 次：✗ 出口 ${ip}`)
  }
}

console.log('\n出口 IP 分布：')
for (const [ip, n] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${ip} × ${n}`)
}
console.log(
  ok
    ? '\n→ 有出口命中白名单，说明「加全观测到的 IP + 多跑撞中」可行。'
    : `\n→ ${N} 次都没命中白名单。不同出口数=${seen.size}，池越大越说明只能靠生产固定 IP 解决。`,
)
process.exit(0)
