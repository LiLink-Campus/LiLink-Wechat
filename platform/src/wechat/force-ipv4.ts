// 强制微信 API 连接走纯 IPv4 出口。
//
// 微信公众号 IP 白名单是 IPv4 列表，按 IP 比对调用方出口地址。若 Node 走 IPv6（双栈 Happy
// Eyeballs 可能选中 IPv6 链路），出口就是 IPv6 地址——绝不可能落在 IPv4 白名单里，必然 40164。
// 所以这里把 DNS 解析设为 IPv4 优先，并在连接层锁定 family=4 + 关闭自动选族，确保出口是 IPv4，
// 能与后台白名单里的固定 IPv4 比对。
//
// 注：微信 40164 报文里的 "ipv6 ::ffff:1.2.3.4" 只是 IPv4-mapped 表示，微信仍按 IPv4（1.2.3.4）
// 比对——所以联调环境里反复失败的主因是【出口 IP 跳变】（多出口 NAT），而非 IPv4/IPv6；生产
// 部署到固定公网 IP 的 VPS（该 IP 加进白名单）后即稳定。
//
// 实现注意：global fetch 底层是 undici，它不读 net 的全局 autoSelectFamily 默认值，所以必须在
// undici 的 dispatcher 层设置（仅 dns.setDefaultResultOrder + net.setDefaultAutoSelectFamily 无效）。
// 副作用模块：被 import 即在本进程全局生效（覆盖脚本与 server endpoint 两种发布路径）。
// 对 OSS(走 aws-sdk 自带 http handler)/Postgres 等无害——其 IPv4 均可达。
import dns from 'node:dns'
import { Agent, setGlobalDispatcher } from 'undici'

dns.setDefaultResultOrder('ipv4first')
setGlobalDispatcher(new Agent({ connect: { family: 4, autoSelectFamily: false } }))
