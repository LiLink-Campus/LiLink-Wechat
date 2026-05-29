// lexical-to-wechat.test.ts —— 公众号格式兼容快照（命脉测试）。
//
// 核心断言（design §3 / §7）：转换层产物必须
//   不含：<style / class= / <div / id= / position: / display:flex / list-style /
//        var( / calc( / ::before
//   含：内联 style="、根 <section> 与 <p>、列表项文本前缀（• / 1.）、
//      <figure>+<figcaption>、章节前缀染玫瑰（ROSE 色）、文末 CTA。

import { describe, expect, it } from 'vitest'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'

import { renderToInlineHtml } from '../src/renderers/lexical-to-wechat'
import { ROSE, STYLE } from '../src/lib/wechat-theme'

// 文本叶子节点工厂（format 位掩码：1=bold,2=italic,16=code）。
const text = (t: string, format = 0) => ({
  type: 'text',
  text: t,
  format,
  detail: 0,
  mode: 'normal',
  style: '',
  version: 1,
})

// 构造一篇覆盖各元素的 Lexical 状态。
function buildState(): SerializedEditorState {
  return {
    root: {
      type: 'root',
      direction: 'ltr',
      format: '',
      indent: 0,
      version: 1,
      children: [
        // 章节标题（h2），前缀「一、」应染玫瑰
        {
          type: 'heading',
          tag: 'h2',
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1,
          children: [text('一、如何开始')],
        },
        // 步骤标题（h3），前缀「第一步」应染玫瑰
        {
          type: 'heading',
          tag: 'h3',
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1,
          children: [text('第一步 注册账号')],
        },
        // 段落：普通文本 + 加粗 + 行内码 + 外链
        {
          type: 'paragraph',
          direction: 'ltr',
          format: '',
          indent: 0,
          textFormat: 0,
          version: 1,
          children: [
            text('这是正文，'),
            text('重点', 1),
            text(' 与 '),
            text('code', 16),
            {
              type: 'link',
              direction: 'ltr',
              format: '',
              indent: 0,
              version: 1,
              fields: { url: 'https://lilink.top', linkType: 'custom', newTab: true },
              children: [text('外链')],
            },
          ],
        },
        // 无序列表
        {
          type: 'list',
          tag: 'ul',
          listType: 'bullet',
          start: 1,
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1,
          children: [
            {
              type: 'listitem',
              value: 1,
              direction: 'ltr',
              format: '',
              indent: 0,
              version: 1,
              children: [text('无序项一')],
            },
            {
              type: 'listitem',
              value: 2,
              direction: 'ltr',
              format: '',
              indent: 0,
              version: 1,
              children: [text('无序项二')],
            },
          ],
        },
        // 有序列表（start 从 1）
        {
          type: 'list',
          tag: 'ol',
          listType: 'number',
          start: 1,
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1,
          children: [
            {
              type: 'listitem',
              value: 1,
              direction: 'ltr',
              format: '',
              indent: 0,
              version: 1,
              children: [text('有序项一')],
            },
            {
              type: 'listitem',
              value: 2,
              direction: 'ltr',
              format: '',
              indent: 0,
              version: 1,
              children: [text('有序项二')],
            },
          ],
        },
        // 引用 → 提示卡
        {
          type: 'quote',
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1,
          children: [text('建议：先看完再动手。')],
        },
        // 图片（真实 alt → 配题注）
        {
          type: 'upload',
          relationTo: 'media',
          version: 1,
          format: '',
          fields: { alt: '一张说明配图' },
          value: {
            id: 'm1',
            url: 'https://mmbiz.qpic.cn/x.png',
            alt: '一张说明配图',
            width: 900,
            height: 600,
            mimeType: 'image/png',
            filename: 'x.png',
          },
        } as unknown as SerializedEditorState['root']['children'][number],
        // 图片（文件名式 alt → 不配题注）
        {
          type: 'upload',
          relationTo: 'media',
          version: 1,
          format: '',
          fields: { alt: 'image-2.png' },
          value: {
            id: 'm2',
            url: 'https://mmbiz.qpic.cn/y.png',
            alt: 'image-2.png',
            width: 800,
            height: 500,
            mimeType: 'image/png',
            filename: 'image-2.png',
          },
        } as unknown as SerializedEditorState['root']['children'][number],
      ],
    },
  } as unknown as SerializedEditorState
}

describe('renderToInlineHtml —— 公众号格式兼容硬规范', () => {
  const html = renderToInlineHtml(buildState(), {
    ctaUrl: 'https://lilink.top',
    ctaText: '去 LiLink 看看 →',
  })

  // ---- 黑名单：绝不出现 ----
  it('不含 <style> 标签', () => {
    expect(html).not.toContain('<style')
  })
  it('不含 class= 属性', () => {
    expect(html).not.toContain('class=')
  })
  it('不含 <div', () => {
    expect(html).not.toContain('<div')
  })
  it('不含 id= 属性', () => {
    expect(html).not.toMatch(/\sid=/)
  })
  it('不含黑名单 CSS：position / display:flex / float / gap', () => {
    expect(html).not.toContain('position:')
    expect(html).not.toContain('display:flex')
    expect(html).not.toContain('float:')
    expect(html).not.toContain('gap:')
  })
  it('不含 list-style（符号靠文本前缀）', () => {
    expect(html).not.toContain('list-style')
  })
  it('不含 var() / calc()（已求成字面值）', () => {
    expect(html).not.toContain('var(')
    expect(html).not.toContain('calc(')
  })
  it('不含伪元素 ::before / ::after', () => {
    expect(html).not.toContain('::before')
    expect(html).not.toContain('::after')
  })

  // ---- 白名单：必须出现 ----
  it('含内联 style="', () => {
    expect(html).toContain('style="')
  })
  it('最外层是根 <section>，且带根样式', () => {
    expect(html.startsWith(`<section style="${STYLE.root}">`)).toBe(true)
    expect(html.endsWith('</section>')).toBe(true)
  })
  it('块用 <section>、段用 <p>', () => {
    expect(html).toContain('<section')
    expect(html).toContain('<p style="')
  })
  it('无序列表项含「• 」文本前缀', () => {
    expect(html).toContain('<li')
    expect(html).toContain('• 无序项一')
  })
  it('有序列表项含递增「1. / 2. 」文本前缀', () => {
    expect(html).toContain('1. 有序项一')
    expect(html).toContain('2. 有序项二')
  })
  it('图片用 <figure> + <img width 内联 + max-width:100%>', () => {
    expect(html).toContain('<figure')
    expect(html).toContain('<img')
    expect(html).toContain('width="900"')
    expect(html).toContain('max-width:100%')
  })
  it('真实 alt 的图片配 <figcaption> 题注；文件名式 alt 不配', () => {
    expect(html).toContain('<figcaption')
    expect(html).toContain('一张说明配图')
    // 文件名式 alt 不应作为题注文本出现在 figcaption 里
    expect(html).not.toContain(`<figcaption style="${STYLE.cap}">image-2.png</figcaption>`)
  })
  it('章节标题前缀染玫瑰（ROSE 色 span 包裹「一、」）', () => {
    expect(html).toContain(`<span style="color:${ROSE}">一、</span>`)
  })
  it('步骤标题前缀染玫瑰（「第一步」）', () => {
    expect(html).toContain(`<span style="color:${ROSE}">第一步</span>`)
  })
  it('引用渲染成提示卡（blockquote 玫瑰左线 + 内联 <p>）', () => {
    expect(html).toContain('<blockquote')
    expect(html).toContain(`border-left:2px solid ${ROSE}`)
  })
  it('加粗 / 行内码 / 链接均内联', () => {
    expect(html).toContain(`<strong style="${STYLE.strong}">重点</strong>`)
    expect(html).toContain(`<code style="${STYLE.code}">code</code>`)
    expect(html).toContain('<a href="https://lilink.top" style="')
  })
  it('文末追加 CTA 胶囊（pointer-events:none，文案与链接正确）', () => {
    expect(html).toContain('pointer-events:none')
    expect(html).toContain('去 LiLink 看看 →')
    expect(html).toContain('<hr style="')
  })

  // ---- opts 行为 ----
  it('noCta 时不追加 CTA', () => {
    const noCta = renderToInlineHtml(buildState(), { noCta: true })
    expect(noCta).not.toContain('pointer-events:none')
  })
  it('空 / null 输入返回安全的根 section（仍可带 CTA）', () => {
    const empty = renderToInlineHtml(null, { noCta: true })
    expect(empty).toBe(`<section style="${STYLE.root}"></section>`)
  })
})
