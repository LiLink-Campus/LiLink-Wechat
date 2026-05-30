import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'

import { renderers } from '../src/renderers/index'
import { runRenderPy } from '../src/lib/runRenderPy'

// 这些是真实集成测试：会 spawn python3 调 render.py。
// render.py 是纯标准库脚本，环境里有 python3 即可跑（见任务前置：Python 3.12）。

// 最小合法 PNG（1x1），用于验证本地图片 base64 内联。
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

// 在临时目录放一张真实 PNG，返回它的绝对路径 + 清理函数。
// render.py 对绝对路径图片直接读盘内联（os.path.isabs 分支），不依赖 cwd / 稿件目录。
async function withLocalImage(): Promise<{ imgPath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'lilink-test-img-'))
  const imgPath = join(dir, 'pic.png')
  await writeFile(imgPath, PNG_1X1)
  return {
    imgPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

// 含标题 / 图片 / 引用的样例 Markdown。
function sampleMarkdown(imgPath: string): string {
  return [
    '# 关系里的微光',
    '',
    '一段正文，用来验证段落会被包成带内联样式的 <p>。',
    '',
    '> 这是引用块，应被渲染成左侧玫瑰色细线的提示卡。',
    '',
    `![一张本地图片](${imgPath})`,
    '',
  ].join('\n')
}

describe('WechatRenderer (via render.py)', () => {
  it('把含标题/图片/引用的 markdown 渲染成全内联样式 HTML', async () => {
    const { imgPath, cleanup } = await withLocalImage()
    try {
      const result = await renderers.wechat.render({
        markdown: sampleMarkdown(imgPath),
      })

      // 产物形态：html 字符串 + warnings 数组。
      expect(typeof result.html).toBe('string')
      expect(Array.isArray(result.warnings)).toBe(true)

      // 全内联样式：标题 / 段落 / 提示卡 / 图片都带 style="..."。
      expect(result.html).toContain('style="')
      // 标题渲染成 <h1>，正文标题文字应在产物里。
      expect(result.html).toContain('关系里的微光')
      // 引用块 → 提示卡：render.py 用 border-left 玫瑰色细线。
      expect(result.html).toContain('border-left')
      // 图片标签存在。
      expect(result.html).toContain('<img')

      // 默认开启内联：本地图片应被转成 data:image base64。
      expect(result.html).toContain('data:image')
    } finally {
      await cleanup()
    }
  })

  it('embedImages:false 时不内联本地图片（产物不含 data:image）', async () => {
    const { imgPath, cleanup } = await withLocalImage()
    try {
      const result = await renderers.wechat.render({
        markdown: sampleMarkdown(imgPath),
        embedImages: false,
      })

      // 仍是内联样式的合法产物……
      expect(result.html).toContain('style="')
      expect(result.html).toContain('<img')
      // ……但关闭内联后，绝不应出现 base64 的 data:image。
      expect(result.html).not.toContain('data:image')
    } finally {
      await cleanup()
    }
  })

  it('renderers 注册表暴露 wechat，且 platform 标识正确', () => {
    expect(renderers.wechat).toBeDefined()
    expect(renderers.wechat.platform).toBe('wechat')
  })
})

describe('runRenderPy 选项映射', () => {
  it('config.ctaUrl/ctaText 透传给 --cta-url/--cta-text', async () => {
    const { html } = await runRenderPy('# 标题\n\n正文。\n', {
      ctaUrl: 'https://lilink.example',
      ctaText: '走起 →',
    })
    expect(html).toContain('https://lilink.example')
    expect(html).toContain('走起 →')
  })

  it('noCta:true 时不追加文末默认 CTA', async () => {
    const { html } = await runRenderPy('# 标题\n\n正文。\n', { noCta: true })
    // render.py 的默认 CTA 文案，noCta 下应缺席。
    expect(html).not.toContain('去 LiLink 看看')
  })

  it('vitest mock 工具可用（占位，确认 vi 已正确引入）', () => {
    const fn = vi.fn(() => 42)
    expect(fn()).toBe(42)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
