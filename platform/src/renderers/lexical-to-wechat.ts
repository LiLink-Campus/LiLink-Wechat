// lexical-to-wechat.ts —— Lexical JSON → 公众号「全内联」HTML 转换层。
//
// 这是平台的命脉：预览、draft/add 发布、「复制到公众号」三处共用这一份产物。
// 严格遵守 design §3「公众号格式兼容硬规范」：
//   - 全内联样式（样式取自 wechat-theme.ts 的白名单令牌），绝不输出 <style>/class/id
//   - 块容器一律 <section>，段落一律 <p>（永不用 <div>）
//   - 列表符号写成 <li> 内文本前缀（`• ` / 递增 `1. `），绝不依赖 list-style
//   - 图片用 <figure><img width 内联 max-width:100%/><figcaption>alt</figcaption></figure>
//   - 引用 → 提示卡（玫瑰左线 + 淡底，内部 <p> 也内联）
//   - 颜色 / 尺寸全是字面值，无 var()/calc()
//   - 文末按 opts 追加 CTA 胶囊（pointer-events:none，视觉引导）
//
// 实现策略：**不复用 payload 的 defaultConverters**（其默认产物会带 class=、
// list-style-type、<picture> 等违规结构），而是为每个默认节点类型提供完整的
// 自定义 converter，输出完全可控、纯净。convertLexicalToHTML 以 disableContainer
// 关掉它的 <div> 容器，最外层由本模块自己包根 <section>。

import { convertLexicalToHTML } from '@payloadcms/richtext-lexical/html'
import type {
  HTMLConverters,
  HTMLConvertersFunction,
} from '@payloadcms/richtext-lexical/html'
import type {
  SerializedEditorState,
  SerializedLexicalNode,
} from '@payloadcms/richtext-lexical/lexical'

import { STYLE } from '../lib/wechat-theme'

// 节点的宽松形状：Lexical 序列化节点字段是动态的，统一按「基类型 + 任意键」处理，
// 既能传给 nodesToHTML（SerializedLexicalNode 的子类型，数组协变兼容），又能随意读字段。
type AnyNode = Record<string, unknown> & SerializedLexicalNode
// nodesToHTML 的入参形状（仅取用到的 nodes 字段）。
type NodesToHTML = (args: { nodes: SerializedLexicalNode[] }) => string[]

// ---------- 文本格式位掩码（与 lexical 内核一致，见 NodeFormat） ----------
// 自行内联包裹文本时用，避免依赖 payload 默认 text converter（它不内联样式）。
const IS_BOLD = 1
const IS_ITALIC = 1 << 1 // 2
const IS_STRIKETHROUGH = 1 << 2 // 4
const IS_UNDERLINE = 1 << 3 // 8
const IS_CODE = 1 << 4 // 16

// ---------- 前缀识别正则（精确移植自 render.py） ----------
// 章节序号（顶层标题 h2）：一、 / 1. 等。
const RE_CHAPTER_LEAD = /^([一二三四五六七八九十百]+[、.]|[0-9]+[、.])/
// 步骤前缀（h3）：第N步 / 方式N / N.。
const RE_STEP_LEAD = /^(第[一二三四五六七八九十0-9]+步|方式[一二三四五六七八九十0-9]+|[0-9]+[、.])/
// 文件名式 alt（不配题注）：空 / image-1 / chatgpt image / 以图片扩展名结尾。
const RE_FILENAME_ALT = /(?:^\s*$|^image[-_ ]?\d|chatgpt image|\.(?:png|jpe?g|webp|gif)\s*$)/i

// ---------- 转义 ----------
// 文本节点内容：对应 render.py 的 html.escape(text, quote=False)，只转 & < >。
function escapeText(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
// 属性值：额外转义引号（design §3.4 —— 裸双引号会让 draft/add 报错）。
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
// href 协议白名单：只放行 http(s)/mailto/tel 与锚点/站内路径；其余（javascript:/data: 等）
// 降级为 '#'，防止 javascript: 伪协议存活造成 XSS（codex review High）。
function sanitizeHref(url: string | undefined): string {
  const u = (url ?? '').trim()
  if (!u) return '#'
  if (/^(?:https?:|mailto:|tel:)/i.test(u)) return u
  if (u.startsWith('#') || u.startsWith('/')) return u
  return '#'
}

// 转换选项。
export interface RenderToInlineHtmlOptions {
  /** 文末 CTA 链接。缺省 https://lilink.top。 */
  ctaUrl?: string
  /** 文末 CTA 文案。缺省「去 LiLink 看看 →」。 */
  ctaText?: string
  /** 关闭文末 CTA。 */
  noCta?: boolean
  /**
   * 内部链接（linkType:'internal'）→ href 解析器。发布链路一般用不到（正文外链
   * 在 App 内不可点）；不传则内部链接降级为 '#'。
   */
  internalDocToHref?: (linkNode: unknown) => string
  /**
   * 图片 URL 映射：原图 doc.url → 已上传的微信 mmbiz URL。
   * 发布链路传入（先收集图片上传换 URL 再渲染），renderUpload 直接输出映射后的 URL，
   * 避免"渲染后再字符串替换"因 HTML 转义(& → &amp;)不命中而残留外链（防掉图）。
   * 预览 / 复制不传，按 doc.url 原样输出（云存储 https URL 可直接显示）。
   */
  imageUrlMap?: Map<string, string>
  /** 透传字段，不改变本层行为（保留向后兼容）。 */
  embedImages?: boolean
}

const DEFAULT_CTA_URL = 'https://lilink.top'
const DEFAULT_CTA_TEXT = '去 LiLink 看看 →'

/**
 * 文本节点 → 内联 HTML。按 format 位掩码逐层包裹：
 * code > 其余装饰。删除线 / 下划线降级为 text-decoration（白名单内）。
 * 加粗 / 斜体 / 行内码用主题令牌样式串内联。
 */
function renderText(node: { text?: string; format?: number }): string {
  let html = escapeText(node.text ?? '')
  const fmt = node.format ?? 0
  if (fmt & IS_CODE) {
    html = `<code style="${STYLE.code}">${html}</code>`
  }
  if (fmt & IS_BOLD) {
    html = `<strong style="${STYLE.strong}">${html}</strong>`
  }
  if (fmt & IS_ITALIC) {
    html = `<em style="${STYLE.em}">${html}</em>`
  }
  if (fmt & IS_STRIKETHROUGH) {
    html = `<span style="text-decoration:line-through">${html}</span>`
  }
  if (fmt & IS_UNDERLINE) {
    html = `<span style="text-decoration:underline">${html}</span>`
  }
  return html
}

/**
 * 从一组节点里抽出纯文本（用于标题前缀识别，不含任何标签）。
 * 只下钻 text 与含 children 的内联容器（如 link），够覆盖标题场景。
 */
function plainTextOf(nodes: ReadonlyArray<Record<string, unknown>> | undefined): string {
  if (!nodes?.length) return ''
  let out = ''
  for (const n of nodes) {
    if (n.type === 'text' && typeof n.text === 'string') {
      out += n.text
    } else if (Array.isArray(n.children)) {
      out += plainTextOf(n.children as Array<Record<string, unknown>>)
    }
  }
  return out
}

/**
 * 标题前缀染玫瑰：若纯文本前缀命中 pattern，且渲染出的 inner HTML 正好以该前缀的
 * 转义文本开头（即前缀是裸文本、未被 strong/em 等包裹），就把这段前缀替换成
 * <span color:rose> 包裹版；否则原样返回 inner。稳健不破坏已有行内标记。
 */
function colorLead(inner: string, plain: string, pattern: RegExp): string {
  const m = pattern.exec(plain)
  if (!m) return inner
  const leadEsc = escapeText(m[0])
  if (!inner.startsWith(leadEsc)) return inner
  const rest = inner.slice(leadEsc.length)
  return `<span style="color:${ROSE_INLINE}">${leadEsc}</span>${rest}`
}
// 仅前缀染色用到的玫瑰字面值（避免引入额外样式键）。
const ROSE_INLINE = '#c2706c'

/**
 * 构造公众号专用的 HTMLConverters。每个默认节点类型都被显式覆盖，产物全内联、
 * 无 class/div/list-style。providedStyleTag / providedCSSString 一律忽略
 * （它们可能带 padding-inline-start 等非白名单值），样式只取主题令牌。
 */
const wechatConverters: HTMLConvertersFunction = (): HTMLConverters => {
  const converters: HTMLConverters = {
    // 文本：自定义内联包裹。
    text: ({ node }) => renderText(node as { text?: string; format?: number }),

    // 软换行 / 制表符。
    linebreak: () => '<br />',
    tab: () => ' ',

    // 段落 → <p>。空段跳过（返回空串，convertLexicalNodesToHTML 会过滤掉）。
    paragraph: ({ node, nodesToHTML }) => {
      const children = ((node as AnyNode).children ?? []) as SerializedLexicalNode[]
      const inner = nodesToHTML({ nodes: children }).join('')
      if (!inner.trim()) return ''
      return `<p style="${STYLE.p}">${inner}</p>`
    },

    // 标题：h1→主标题；h2→章节（前缀染玫瑰）；h3→步骤（前缀染玫瑰）；h4~h6→眉标。
    // 每个标题各包一个 <section>（design §3.2：每内容块各包一 section）。
    heading: ({ node, nodesToHTML }) => {
      const h = node as AnyNode
      const children = (h.children ?? []) as SerializedLexicalNode[]
      const inner = nodesToHTML({ nodes: children }).join('')
      const plain = plainTextOf(children as AnyNode[])
      const tag = (h.tag as string | undefined) ?? 'h2'
      if (tag === 'h1') {
        return `<section><h1 style="${STYLE.title}">${inner}</h1></section>`
      }
      if (tag === 'h2') {
        const led = colorLead(inner, plain, RE_CHAPTER_LEAD)
        return `<section><h2 style="${STYLE.chapter}">${led}</h2></section>`
      }
      if (tag === 'h3') {
        const led = colorLead(inner, plain, RE_STEP_LEAD)
        return `<section><h3 style="${STYLE.step}">${led}</h3></section>`
      }
      // h4 / h5 / h6 统一作眉标（小号玫瑰）。
      return `<section><h4 style="${STYLE.eyebrow}">${inner}</h4></section>`
    },

    // 列表容器 → <ul>/<ol>。符号 / 序号由 listitem 写成文本前缀，绝不靠 list-style。
    list: ({ node, nodesToHTML }) => {
      const l = node as AnyNode
      const tag = l.tag === 'ol' ? 'ol' : 'ul'
      const inner = nodesToHTML({ nodes: (l.children ?? []) as SerializedLexicalNode[] }).join('')
      const style = tag === 'ol' ? STYLE.ol : STYLE.ul
      // 列表块外包一个 <section>（design §3.2 每内容块各包一 section）。
      return `<section><${tag} style="${style}">${inner}</${tag}></section>`
    },

    // 列表项 → <li>，文本前缀：无序 `• `；有序 `N. `（N = ol.start + 该项序号）。
    // 嵌套子列表（child.type==='list'）直接渲染在 li 内（子列表自带缩进），
    // 前缀仅加在本项可见内容前。
    listitem: ({ node, nodesToHTML, parent, childIndex }) => {
      const li = node as AnyNode
      const p = parent as AnyNode | undefined
      const isOrdered = p?.tag === 'ol' || p?.listType === 'number'

      // 把直接子节点拆成「行内内容」与「嵌套子列表」两拨。
      const inlineChildren: SerializedLexicalNode[] = []
      const nestedLists: SerializedLexicalNode[] = []
      for (const c of (li.children ?? []) as SerializedLexicalNode[]) {
        if (c.type === 'list') nestedLists.push(c)
        else inlineChildren.push(c)
      }
      const inlineHtml = nodesToHTML({ nodes: inlineChildren }).join('')
      const nestedHtml = nestedLists.length ? nodesToHTML({ nodes: nestedLists }).join('') : ''

      let prefix = '• '
      if (isOrdered) {
        const start = typeof p?.start === 'number' && p.start > 0 ? p.start : 1
        prefix = `${start + childIndex}. `
      }
      return `<li style="${STYLE.li}">${prefix}${inlineHtml}${nestedHtml}</li>`
    },

    // 引用 → 提示卡（<blockquote> 玫瑰左线 + 淡底）。内部内容包一个内联 <p>。
    quote: ({ node, nodesToHTML }) => {
      const q = node as AnyNode
      const inner = nodesToHTML({ nodes: (q.children ?? []) as SerializedLexicalNode[] }).join('')
      // 引用块外包一个 <section>（design §3.2 每内容块各包一 section）。
      return `<section><blockquote style="${STYLE.callout}"><p style="${STYLE.calloutP}">${inner}</p></blockquote></section>`
    },

    // 链接（自定义外链 / 内链）。正文 <a> 在 App 内不可点，仅视觉。
    link: ({ node, nodesToHTML }) => renderLink(node, nodesToHTML, currentOpts),
    // 自动识别链接（autolink）：同样内联渲染。
    autolink: ({ node, nodesToHTML }) => renderLink(node, nodesToHTML, currentOpts),

    // 上传图片 → <figure><img/><figcaption/></figure>；非图片 → 文件名链接。
    upload: ({ node }) => renderUpload(node),

    // 水平分隔线。
    horizontalrule: () => `<hr style="${STYLE.hr}" />`,

    // relationship 节点：公众号无对应呈现，忽略（避免输出占位脏数据）。
    relationship: () => '',

    // 兜底：未知节点不输出（绝不吐 <span>unknown</span> 之类脏标签）。
    unknown: () => '',
  }
  return converters
}

// 当前调用的 opts（renderToInlineHtml 内赋值；供 link converter 读 internalDocToHref）。
// 单次同步调用内有效；convertLexicalToHTML 同步执行，无并发交错风险。
let currentOpts: RenderToInlineHtmlOptions = {}

// 链接渲染：外链用 fields.url；内链走 internalDocToHref，缺省降级 '#'。
function renderLink(
  node: unknown,
  nodesToHTML: NodesToHTML,
  opts: RenderToInlineHtmlOptions,
): string {
  const n = node as AnyNode & {
    fields?: { url?: string; linkType?: string; newTab?: boolean }
  }
  const inner = nodesToHTML({ nodes: (n.children ?? []) as SerializedLexicalNode[] }).join('')
  const fields = n.fields ?? {}
  let href = fields.url ?? ''
  if (fields.linkType === 'internal') {
    href = opts.internalDocToHref ? opts.internalDocToHref(node) : '#'
  }
  const safeHref = escapeAttr(sanitizeHref(href))
  const target = fields.newTab ? ' target="_blank" rel="noopener noreferrer"' : ''
  return `<a href="${safeHref}" style="${STYLE.a}"${target}>${inner}</a>`
}

// 上传节点渲染。value 必须是已 populated 的文档对象。
function renderUpload(node: unknown): string {
  const n = node as {
    value?: unknown
    fields?: { alt?: string }
    relationTo?: string
  }
  const doc = n.value
  if (!doc || typeof doc !== 'object') return ''
  const d = doc as {
    url?: string
    alt?: string
    width?: number
    height?: number
    mimeType?: string
    filename?: string
  }
  const rawUrl = d.url ?? ''
  if (!rawUrl) return ''
  // 发布链路：若调用方传了 imageUrlMap，用映射后的微信 mmbiz URL（渲染即定，
  // 无需事后字符串替换 —— 避开 & → &amp; 转义不命中导致外链残留/掉图）。
  const url = currentOpts.imageUrlMap?.get(rawUrl) ?? rawUrl

  // 非图片资源：降级为文件名链接（极少出现在正文），href 走白名单，外包一个 section。
  if (d.mimeType && !d.mimeType.startsWith('image')) {
    return `<section><a href="${escapeAttr(sanitizeHref(url))}" style="${STYLE.a}">${escapeText(d.filename ?? url)}</a></section>`
  }

  const altRaw = n.fields?.alt ?? d.alt ?? ''
  const capped = !RE_FILENAME_ALT.test(altRaw) // 文件名式 alt 不配题注
  const imgStyle = capped ? STYLE.imgCapped : STYLE.img
  // 显式 width（design §3.2：否则 iOS 可能不显示）；缺失时靠 STYLE.img 的 max-width:100% 兜底。
  const widthAttr = d.width ? ` width="${escapeAttr(String(d.width))}"` : ''
  const img = `<img src="${escapeAttr(url)}" alt="${escapeAttr(altRaw)}"${widthAttr} style="${imgStyle}" />`
  const caption = capped ? `<figcaption style="${STYLE.cap}">${escapeText(altRaw)}</figcaption>` : ''
  // 每个图片块各包一个 <section>（design §3.2 每内容块各包一 section）。
  return `<section><figure style="${STYLE.figure}">${img}${caption}</figure></section>`
}

// 文末 CTA 胶囊（分隔线 + 居中胶囊；pointer-events:none，仅视觉）。
function ctaBlock(url: string, text: string): string {
  return (
    `<hr style="${STYLE.hr}" />` +
    `<section style="${STYLE.ctaWrap}">` +
    `<a href="${escapeAttr(sanitizeHref(url))}" style="${STYLE.cta}">${escapeText(text)}</a>` +
    `</section>`
  )
}

/**
 * renderToInlineHtml —— 把 Lexical 编辑器状态（SerializedEditorState）转成公众号
 * 全内联 HTML 字符串。
 *
 * 产物结构：`<section style=root>...各内容块（均内联）... [CTA]</section>`。
 * 调用方（预览 / 发布 / 复制）拿到的都是同一份；图片 src 由调用方在此前后按需
 * 替换为微信 URL / base64（本层只按 upload 节点 doc.url 输出）。
 *
 * @param data Lexical 序列化状态。容错：传入 null/空/缺 root 时返回空根 section（+可选 CTA）。
 * @param opts 见 RenderToInlineHtmlOptions。
 */
export function renderToInlineHtml(
  data: SerializedEditorState | null | undefined,
  opts: RenderToInlineHtmlOptions = {},
): string {
  currentOpts = opts
  let body = ''
  try {
    if (data && (data as { root?: unknown }).root) {
      body = convertLexicalToHTML({
        data,
        converters: wechatConverters,
        disableContainer: true, // 关掉 payload 的 <div> 容器，自己包根 <section>
        disableIndent: true, // 不输出 padding-inline-start 缩进（非白名单写法）
        disableTextAlign: true, // 对齐由我们的样式令牌控制，不让其注入 text-align
      })
    }
  } finally {
    currentOpts = {}
  }

  let tail = ''
  if (!opts.noCta) {
    tail = ctaBlock(opts.ctaUrl ?? DEFAULT_CTA_URL, opts.ctaText ?? DEFAULT_CTA_TEXT)
  }

  return `<section style="${STYLE.root}">${body}${tail}</section>`
}
