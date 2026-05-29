# OSS 媒体存储 + 公众号发布 IP 联调（2026-05-30）

记录第一期公众号闭环里「媒体库接云对象存储」这一块的落地与真机联调。承接
`2026-05-29-phase1-wechat-content-platform.md` 与 `2026-05-29-visual-editing-cms-design.md`（§3 公众号格式兼容）。

## 目标

公众号封面 / 正文图的**源图必须公网可达**：发布时中台服务器要先 fetch 源图、再上传给微信
（封面进永久素材换 `thumb_media_id`，正文图换 `mmbiz.qpic.cn` URL）。本地磁盘存储给出的相对
URL 传不上微信，所以媒体库接阿里云 OSS。

## 架构决策：私有桶 + presigned 直链

- bucket `lilink-content` 保持**私有**（不公共读）。该桶还禁用了对象级 ACL —— `PutObject` 带
  `public-read` 会被拒（`Put public object acl is not allowed`）。
- `media.url` 由 Media 的 `afterRead` hook 改写成**直链 presigned URL**
  （`https://bucket.endpoint/key?X-Amz-Signature=...`，无重定向，1 小时有效，每次读实时生成）。
- **为何要直链、而非 storage-s3 自带的签名下载（Payload 路由 302 跳转）**：发布链路是服务器
  fetch 源图，`src/wechat/client.ts` 的 `fetchImageBuffer` 用 `redirect:'error'`（SSRF 防护），
  不能有 3xx 跳转，所以 `media.url` 必须是直链。
- **为何短 TTL 够**：发布是秒级（取 url → 立即上传微信，微信存自己的副本）；预览 / 后台每次读都
  重新签名；源图签名过期不影响已发布内容。用户确认的判断「流媒体上传到平台就不会失效」正是此
  方案成立的依据。

## storage-s3 配置要点（`platform/src/payload.config.ts`）

- Payload 3.85（v3）→ 放 `plugins`（v4 才改成放 `storage`）。
- `region` 用**地域名** `ap-southeast-1`（**不带** `oss-` 前缀）；`endpoint` 带 `oss-`：
  `https://oss-ap-southeast-1.aliyuncs.com`；`forcePathStyle:false`（OSS 只支持 virtual-hosted，
  path-style 会被拒）。
- **不设 `acl`**（桶私有 + 禁用对象 ACL，靠 presigned 读）。
- storage-s3 默认生成的 url 是 path-style（私有桶下不可直接访问），由 `afterRead` presign 覆盖。

## RAM 授权（联调踩的坑）

RAM 子账号**默认无任何 OSS 权限**。未授权时报错具有迷惑性，看起来像配置/区域错，实则是没授权：

| 操作 | 报错 |
|------|------|
| ListBuckets | `You are forbidden to oss:ListBuckets` |
| ListObjects | `The bucket you access does not belong to you` |
| PutObject | `You have no right to access this object because of bucket acl` |

修复：给 RAM 用户授 `lilink-content` 的最小权限（`oss:GetObject/PutObject/DeleteObject/
ListObjects/AbortMultipartUpload/ListParts/GetObjectMeta`，见 `.env.example` 注释）。

## force-ipv4（`platform/src/wechat/force-ipv4.ts`）

确保连微信走 **IPv4 出口**（`dns.setDefaultResultOrder('ipv4first')` + undici dispatcher
`connect:{family:4, autoSelectFamily:false}`；注意 global fetch 底层是 undici，不读 `net` 的全局
默认，必须在 dispatcher 层设）。token/client `import` 它即进程级全局生效。若走 IPv6，出口会是
IPv6 地址，绝不可能在 IPv4 白名单里。

## 公众号 IP 白名单 + `::ffff:` 辨析（重要，曾反复误判）

- 取 `access_token` 需调用方公网 IP 在公众号后台 IP 白名单内，否则报 `40164`。
- 40164 报文形如 `invalid ip 1.2.3.4 ipv6 ::ffff:1.2.3.4`。**`::ffff:` 只是 IPv4-mapped 的表示
  形式（微信服务器端 dual-stack socket 所致），微信实际按 IPv4（`1.2.3.4`）比对——`::ffff:` 不是
  问题。** （曾误以为是它导致不匹配、反复在强制 IPv4 上绕路；证伪依据：命中白名单的 IP 那次
  `::ffff:` 同样在却成功了，而换上各种强制 IPv4 手段后报文里 `::ffff:` 依旧存在。）
- **真正的根因**：联调沙箱的出口 IP 在一个池里**按分钟级窗口跳变**（实测见过
  `183.255.73.34 / 37 / 38` 与 `221.11.202.36 / 37`）。窗口内稳定（连跑 12 次同一 IP），但跨窗口
  会变最后一位；手动加白名单永远追不上，再叠加白名单保存生效的延迟与窗口错位。
- **生产解法**：部署到**固定公网 IP** 的 VPS，把那一个固定 IP 加进白名单，即永久稳定。

## 验证状态

- 端到端实测：上传 → 私有 OSS；presigned 直链 fetch 200、字节与原图一致；wechat client
  成功 fetch OSS presigned 图并上传微信；出口命中白名单那次**完整进过草稿箱**
  （封面永久素材 + 正文图 mmbiz URL + 建草稿成功）。
- codex review：**SHIP-WITH-FIXES**（无 Blocker）；High（注释误导）+ Medium（错误信息泄露
  presigned URL、presign 静默吞错、脚本 exit code）均已修。
- `tsc --noEmit` clean；`vitest` 97 passed / 6 skipped。

## 联调脚本（`platform/scripts/`）

- `oss-test.ts`：OSS 连通 / 读写权限 / virtual-host vs path-style URL 形态诊断。
- `oss-media-test.ts`：上传 → presigned → fetch 直链可读 端到端。
- `oss-publish-test.ts`：OSS 真图 → 微信封面/正文图 → 草稿 全链路。
- `wx-ip-probe.ts`：连跑多次取 token，统计当前出口 IP 分布（判断是否命中白名单）。

## 上线检查清单

- [ ] 部署到固定公网 IP 的 VPS，把该 IP 加入公众号「设置与开发 → 基本配置 → IP 白名单」。
- [ ] 轮换 `WX_APP_SECRET` 与 OSS AccessKey（联调期间在对话中出现过）。
- [ ] RAM AccessKey 收敛到最小权限（仅 `lilink-content`）。
- [ ] 生产 `.env` 配齐 `S3_*` 与 `WX_*`。

相关记忆：见 `lilink-wechat-publish-gotchas`。
