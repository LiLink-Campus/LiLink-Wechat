// Manual social publishing package renderer.
//
// 视频号 / 小红书 / 抖音 have fragile or unavailable public publishing APIs.
// This renderer turns a ChannelContent into a deterministic handoff package:
// title, caption, hashtags, asset URLs, publish URL, warnings, and checklist.
// A future Playwright worker can consume this same package without changing the
// content model.

import {
  getPlatformSpec,
  isManualPlatform,
  modeForPlatform,
  publishUrlFor,
  type ManualPlatformCode,
  type PublishMode,
} from '../platforms/registry'

export type SocialAssetRole = 'image' | 'video' | 'horizontal_cover' | 'vertical_cover'

export interface SocialAsset {
  role: SocialAssetRole
  id?: string | number
  url?: string
  filename?: string
  mimeType?: string
  alt?: string
}

export interface PackageWarning {
  level: 'warning' | 'error'
  message: string
}

export interface SocialPublishPackage {
  platform: ManualPlatformCode
  platformLabel: string
  mode: PublishMode
  publishUrl: string
  title: string
  caption: string
  hashtags: string[]
  assets: SocialAsset[]
  checklist: string[]
  warnings: PackageWarning[]
}

type AnyRecord = Record<string, unknown>

function asRecord(value: unknown): AnyRecord | undefined {
  return value && typeof value === 'object' ? (value as AnyRecord) : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stripHash(tag: string): string {
  return tag.replace(/^#+/, '').trim()
}

function normalizeTag(tag: string): string {
  return stripHash(tag).replace(/\s+/g, '')
}

function compactStrings(values: Array<string | undefined>): string[] {
  return values.map((v) => (v ?? '').trim()).filter(Boolean)
}

function postTitle(post: unknown): string {
  const p = asRecord(post)
  return p ? stringValue(p.title) : ''
}

function postTags(post: unknown): string[] {
  const p = asRecord(post)
  const tags = p?.tags
  if (!Array.isArray(tags)) return []
  return tags
    .map((item) => {
      if (typeof item === 'string') return item
      const obj = asRecord(item)
      return stringValue(obj?.tag)
    })
    .filter(Boolean)
}

function socialTags(cc: AnyRecord): string[] {
  const raw = cc.socialTags
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (typeof item === 'string') return item
      const obj = asRecord(item)
      return stringValue(obj?.tag)
    })
    .filter(Boolean)
}

function hashtagsFor(cc: AnyRecord): string[] {
  const tags = [
    ...socialTags(cc),
    ...postTags(cc.post),
    'LiLink',
    '校园社交',
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags) {
    const normalized = normalizeTag(tag)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(`#${normalized}`)
  }
  return out
}

function truncateWithWarning(
  value: string,
  max: number,
  warnings: PackageWarning[],
  fieldName: string,
): string {
  if (value.length <= max) return value
  warnings.push({
    level: 'warning',
    message: `${fieldName} 超过 ${max} 字，发布包已按平台限制截断；建议人工改成更自然的标题。`,
  })
  return value.slice(0, max)
}

function plainSocialText(cc: AnyRecord): string {
  return compactStrings([
    stringValue(cc.socialDescription),
    stringValue(cc.wxDigest),
    stringValue(cc.excerpt),
  ])[0] ?? ''
}

function mediaAsset(value: unknown, role: SocialAssetRole): SocialAsset | undefined {
  if (!value) return undefined
  if (typeof value === 'string' || typeof value === 'number') {
    return { role, id: value }
  }
  const obj = asRecord(value)
  if (!obj) return undefined
  return {
    role,
    id:
      typeof obj.id === 'string' || typeof obj.id === 'number'
        ? obj.id
        : undefined,
    url: stringValue(obj.url) || undefined,
    filename: stringValue(obj.filename) || undefined,
    mimeType: stringValue(obj.mimeType) || undefined,
    alt: stringValue(obj.alt) || undefined,
  }
}

function mediaAssets(value: unknown, role: SocialAssetRole): SocialAsset[] {
  if (!Array.isArray(value)) {
    const one = mediaAsset(value, role)
    return one ? [one] : []
  }
  return value
    .map((item) => mediaAsset(item, role))
    .filter((item): item is SocialAsset => Boolean(item))
}

function validateAssets(
  mode: PublishMode,
  assets: SocialAsset[],
  warnings: PackageWarning[],
): void {
  const hasImage = assets.some((asset) => asset.role === 'image')
  const hasVideo = assets.some((asset) => asset.role === 'video')
  const missingUrl = assets.filter((asset) => !asset.url)

  if (mode === 'image_note' && !hasImage) {
    warnings.push({
      level: 'error',
      message: '图文发布包缺少图片素材：请在「图文图片」里至少选择一张媒体库图片。',
    })
  }

  if (mode === 'video' && !hasVideo) {
    warnings.push({
      level: 'error',
      message: '视频发布包缺少视频素材：请在「视频文件」里选择一个媒体库视频。',
    })
  }

  if (missingUrl.length > 0) {
    warnings.push({
      level: 'warning',
      message: '部分媒体关系尚未展开为可访问 URL；发布前请确认 Payload 查询 depth 或媒体库直链配置。',
    })
  }
}

function checklistFor(platformLabel: string, mode: PublishMode): string[] {
  const assetStep =
    mode === 'video'
      ? '上传视频文件，并按需设置横封面/竖封面。'
      : '按顺序上传图文图片，确认首图承担封面功能。'
  return [
    `打开 ${platformLabel} 发布入口。`,
    '确认浏览器已登录正确账号，且没有切到个人小号。',
    assetStep,
    '复制发布包标题、正文和话题标签。',
    '检查平台预览：标题未截断、图片顺序正确、没有站外强导流风险。',
    '人工点击发布或暂存草稿，并回到中台把状态流转为「已发布」。',
  ]
}

export function buildSocialPackage(channelContent: unknown): SocialPublishPackage {
  const cc = asRecord(channelContent)
  if (!cc || !isManualPlatform(cc.platform)) {
    throw new Error(`暂不支持生成该平台的人工发布包：${String(cc?.platform)}`)
  }

  const platform = cc.platform
  const spec = getPlatformSpec(platform)
  const mode = modeForPlatform(platform, cc.contentMode)
  const warnings: PackageWarning[] = []

  const rawTitle =
    stringValue(cc.socialTitle) ||
    stringValue(cc.wxTitle) ||
    postTitle(cc.post) ||
    spec.label
  const title = truncateWithWarning(rawTitle, spec.limits.titleMax, warnings, '标题')

  const hashtags = hashtagsFor(cc).slice(0, spec.limits.tagsMax ?? 20)
  const body = truncateWithWarning(
    plainSocialText(cc),
    spec.limits.bodyMax ?? 2000,
    warnings,
    '正文',
  )
  const sourceUrl = stringValue(cc.sourceUrl) || 'https://lilink.top'
  const caption = compactStrings([
    body,
    hashtags.join(' '),
    sourceUrl ? `LiLink: ${sourceUrl}` : undefined,
  ]).join('\n\n')

  const assets: SocialAsset[] = [
    ...mediaAssets(cc.socialImages, 'image'),
    ...mediaAssets(cc.videoFile, 'video'),
    ...mediaAssets(cc.horizontalCover, 'horizontal_cover'),
    ...mediaAssets(cc.verticalCover, 'vertical_cover'),
  ]
  validateAssets(mode, assets, warnings)

  return {
    platform,
    platformLabel: spec.label,
    mode,
    publishUrl: publishUrlFor(platform, mode),
    title,
    caption,
    hashtags,
    assets,
    checklist: checklistFor(spec.label, mode),
    warnings,
  }
}
