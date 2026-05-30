import { describe, expect, it } from 'vitest'

import { PLATFORM_SPECS, publishUrlFor } from '../src/platforms/registry'
import { buildSocialPackage } from '../src/renderers/social-package'
import { ManualPublisher } from '../src/publishers/manual'

function media(url: string, mimeType = 'image/png') {
  return {
    id: url,
    url,
    filename: url.split('/').pop(),
    mimeType,
    alt: '素材',
  }
}

describe('platform registry', () => {
  it('登记视频号、小红书、抖音的发布入口和人工发布策略', () => {
    expect(PLATFORM_SPECS.weixin_channels.automation).toBe('manual_browser')
    expect(PLATFORM_SPECS.xiaohongshu.modes).toContain('image_note')
    expect(PLATFORM_SPECS.douyin.defaultMode).toBe('video')
    expect(publishUrlFor('xiaohongshu', 'video')).toContain('target=video')
  })
})

describe('buildSocialPackage', () => {
  it('把小红书图文渠道稿渲染成可人工发布的标题、正文、标签、资产和清单', () => {
    const pkg = buildSocialPackage({
      platform: 'xiaohongshu',
      contentMode: 'image_note',
      socialTitle: 'LiLink 本周相遇指南',
      socialDescription: '这周想重新练习一次自然的相遇。',
      socialTags: [{ tag: 'LiLink攻略' }, { tag: '#校园生活' }],
      socialImages: [media('https://cdn.lilink.top/a.png')],
      sourceUrl: 'https://lilink.top',
      post: { title: '选题', tags: [{ tag: '校园社交' }] },
    })

    expect(pkg.platform).toBe('xiaohongshu')
    expect(pkg.mode).toBe('image_note')
    expect(pkg.publishUrl).toContain('creator.xiaohongshu.com')
    expect(pkg.title).toBe('LiLink 本周相遇指南')
    expect(pkg.caption).toContain('这周想重新练习一次自然的相遇。')
    expect(pkg.hashtags).toContain('#LiLink攻略')
    expect(pkg.hashtags).toContain('#校园生活')
    expect(pkg.assets).toEqual([
      expect.objectContaining({ role: 'image', url: 'https://cdn.lilink.top/a.png' }),
    ])
    expect(pkg.checklist.join('\n')).toContain('人工点击发布')
    expect(pkg.warnings).toEqual([])
  })

  it('按平台标题长度截断并给出 warning', () => {
    const pkg = buildSocialPackage({
      platform: 'douyin',
      contentMode: 'video',
      socialTitle: '这是一个明显超过抖音三十字限制的超长标题需要被安全截断请继续压缩',
      socialDescription: '短视频描述',
      videoFile: media('https://cdn.lilink.top/v.mp4', 'video/mp4'),
    })

    expect(pkg.title.length).toBeLessThanOrEqual(30)
    expect(pkg.warnings.some((w) => w.message.includes('标题 超过 30 字'))).toBe(true)
  })

  it('缺少必需素材时给出 error，供人工发布器阻断', () => {
    const pkg = buildSocialPackage({
      platform: 'weixin_channels',
      contentMode: 'video',
      socialTitle: '视频号视频',
      socialDescription: '缺少视频文件',
    })

    expect(pkg.warnings).toContainEqual(
      expect.objectContaining({ level: 'error', message: expect.stringContaining('缺少视频素材') }),
    )
  })
})

describe('ManualPublisher', () => {
  it('为人工平台返回 manual_ready，并要求状态流转到 ready_to_publish', async () => {
    const result = await new ManualPublisher('xiaohongshu').publish({
      channelContent: {
        platform: 'xiaohongshu',
        contentMode: 'image_note',
        socialTitle: 'LiLink 小红书笔记',
        socialDescription: '正文',
        socialImages: [media('https://cdn.lilink.top/xhs.png')],
      },
    })

    expect(result.stage).toBe('manual_ready')
    expect(result.statusAfterPublish).toBe('ready_to_publish')
    expect(result.manualPackage?.platform).toBe('xiaohongshu')
  })

  it('缺少必需素材时抛错，不生成可发布结果', async () => {
    await expect(
      new ManualPublisher('douyin').publish({
        channelContent: {
          platform: 'douyin',
          contentMode: 'video',
          socialTitle: '缺少视频',
        },
      }),
    ).rejects.toThrow(/缺少视频素材/)
  })
})
