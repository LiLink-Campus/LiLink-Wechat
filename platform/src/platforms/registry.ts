// Platform registry for LiLink publishing.
//
// The publish URLs and supported content shapes are intentionally data-only.
// They were checked against gitcoffee-os/postbot v1.1.20 and kept here as a
// small local contract instead of copying PostBot's browser-extension code.

export type PlatformCode = 'wechat' | 'weixin_channels' | 'xiaohongshu' | 'douyin' | 'x' | 'bilibili'

export type PublishMode = 'article' | 'image_note' | 'video'

export type PublishAutomation = 'official_api' | 'manual_browser' | 'future'

export interface PlatformSpec {
  code: PlatformCode
  label: string
  postbotCode?: string
  automation: PublishAutomation
  modes: PublishMode[]
  defaultMode: PublishMode
  publishUrls: Partial<Record<PublishMode, string>>
  limits: {
    titleMax: number
    bodyMax?: number
    tagsMax?: number
  }
  requiredAssets: Partial<Record<PublishMode, string[]>>
  notes: string[]
}

export const MANUAL_PLATFORM_CODES = ['weixin_channels', 'xiaohongshu', 'douyin'] as const

export type ManualPlatformCode = (typeof MANUAL_PLATFORM_CODES)[number]

export const PLATFORM_SPECS: Record<PlatformCode, PlatformSpec> = {
  wechat: {
    code: 'wechat',
    label: '微信公众号',
    postbotCode: 'weixin',
    automation: 'official_api',
    modes: ['article'],
    defaultMode: 'article',
    publishUrls: {
      article: 'https://mp.weixin.qq.com/',
    },
    limits: {
      titleMax: 64,
    },
    requiredAssets: {
      article: ['coverImage'],
    },
    notes: ['走公众号官方 API 建草稿；正文图需先上传为 mmbiz URL。'],
  },
  weixin_channels: {
    code: 'weixin_channels',
    label: '视频号',
    postbotCode: 'weixin_channels',
    automation: 'manual_browser',
    modes: ['image_note', 'video'],
    defaultMode: 'image_note',
    publishUrls: {
      image_note: 'https://channels.weixin.qq.com/platform/post/finderNewLifeCreate',
      video: 'https://channels.weixin.qq.com/platform/post/create',
    },
    limits: {
      titleMax: 16,
      bodyMax: 1000,
    },
    requiredAssets: {
      image_note: ['socialImages'],
      video: ['videoFile'],
    },
    notes: ['复用浏览器登录态发布；目前生成可人工复核的发布包，不自动点击最终发布。'],
  },
  xiaohongshu: {
    code: 'xiaohongshu',
    label: '小红书',
    postbotCode: 'xiaohongshu',
    automation: 'manual_browser',
    modes: ['image_note', 'video'],
    defaultMode: 'image_note',
    publishUrls: {
      image_note: 'https://creator.xiaohongshu.com/publish/publish?from=menu',
      video: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video',
    },
    limits: {
      titleMax: 20,
      bodyMax: 1000,
      tagsMax: 10,
    },
    requiredAssets: {
      image_note: ['socialImages'],
      video: ['videoFile', 'verticalCover'],
    },
    notes: ['无稳定开放发布 API；采用半自动/人工兜底，避免高频批量发布。'],
  },
  douyin: {
    code: 'douyin',
    label: '抖音',
    postbotCode: 'douyin',
    automation: 'manual_browser',
    modes: ['image_note', 'video'],
    defaultMode: 'video',
    publishUrls: {
      image_note: 'https://creator.douyin.com/creator-micro/content/upload?default-tab=3',
      video: 'https://creator.douyin.com/creator-micro/content/upload?enter_from=dou_web',
    },
    limits: {
      titleMax: 30,
      bodyMax: 1000,
      tagsMax: 10,
    },
    requiredAssets: {
      image_note: ['socialImages'],
      video: ['videoFile'],
    },
    notes: ['先准备标题、描述、封面与视频资产；由运营在创作者后台确认后发布。'],
  },
  x: {
    code: 'x',
    label: 'X',
    automation: 'future',
    modes: ['article'],
    defaultMode: 'article',
    publishUrls: {},
    limits: { titleMax: 120, bodyMax: 280 },
    requiredAssets: {},
    notes: ['预留平台，当前未接入发布链路。'],
  },
  bilibili: {
    code: 'bilibili',
    label: '哔哩哔哩',
    automation: 'future',
    modes: ['video'],
    defaultMode: 'video',
    publishUrls: {
      video: 'https://member.bilibili.com/platform/upload/video/frame',
    },
    limits: { titleMax: 80, bodyMax: 2000 },
    requiredAssets: { video: ['videoFile'] },
    notes: ['预留平台，当前未接入发布链路。'],
  },
}

export function isPlatformCode(value: unknown): value is PlatformCode {
  return typeof value === 'string' && value in PLATFORM_SPECS
}

export function isManualPlatform(value: unknown): value is ManualPlatformCode {
  return (
    typeof value === 'string' &&
    (MANUAL_PLATFORM_CODES as readonly string[]).includes(value)
  )
}

export function getPlatformSpec(platform: PlatformCode): PlatformSpec {
  return PLATFORM_SPECS[platform]
}

export function modeForPlatform(platform: PlatformCode, mode: unknown): PublishMode {
  const spec = getPlatformSpec(platform)
  if (typeof mode === 'string' && spec.modes.includes(mode as PublishMode)) {
    return mode as PublishMode
  }
  return spec.defaultMode
}

export function publishUrlFor(platform: PlatformCode, mode: PublishMode): string {
  return getPlatformSpec(platform).publishUrls[mode] ?? ''
}
