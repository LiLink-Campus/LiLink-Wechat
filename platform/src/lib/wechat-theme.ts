// wechat-theme.ts —— 「微光玫瑰·克制版」设计令牌（TS 单一真源）
//
// 精确移植自 scripts/render.py 顶部的设计令牌与 STYLE 字典，作为公众号转换层
// （renderers/lexical-to-wechat.ts）与编辑器主题的共同令牌来源。
//
// 【硬约束 · 见 design §3.3】这里的每条样式串只用「内联白名单」属性：
//   color / font-size / font-weight / font-style / font-family / line-height /
//   letter-spacing / text-align / text-decoration / margin / padding /
//   background / background-color / border(-*) / border-radius / width /
//   max-width / height / display:block|inline-block / box-shadow / opacity /
//   pointer-events:none。
// 绝不含黑名单：position / float / display:flex|grid / gap / 伪类伪元素 /
//   @media / animation / transition / var() / calc() / list-style（符号靠转换层
//   写成 <li> 文本前缀）。所有颜色已是字面 hex/rgba，无 var()/calc()。

// ---------- 字体族 ----------
// 正文无衬线；标题宋体衬线。与 render.py 完全一致。
export const SANS =
  "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
export const SERIF = "'Songti SC','STSong','SimSun',Georgia,serif"

// ---------- 颜色令牌（字面值，禁 var()） ----------
export const ROSE = '#c2706c' // 强调色：小节号 / 链接 / 提示左线 / CTA
export const ROSE_HOVER = '#b3635f' // 悬停（仅编辑器外观用，公众号产物不依赖）
export const INK = '#4a4340' // 正文（暖灰，非纯黑，护眼）
export const INK_STRONG = '#342d2b' // 标题 / 加粗
export const MUTED = '#8a7f7a' // 声明 / 次要
export const CAP = '#a89a95' // 题注
export const FILL = '#fdf6f5' // 提示卡极淡底
export const RULE = '#ece2e0' // 分隔线
export const CALL = '#6a5b58' // 提示卡文字
export const IMG_BORDER = '#f0eae9' // 图片描边

// 行内码用到的两个独立色值（render.py 里写死，未抽成令牌，这里显式列出便于复用）。
const CODE_BG = '#f6efee'
const CODE_FG = '#b3635f'

/**
 * 语义元素 → 内联样式串映射。
 *
 * 命名与 render.py 的 STYLE 字典一一对应，并新增转换层 / 编辑器需要的：
 * root（根容器基线）、figure / figcaption（图片包裹与题注）、cta（文末胶囊，
 * pointer-events:none）。
 *
 * 说明：
 * - `li` 不含 list-style —— 列表符号由转换层写成 `<li>` 内文本前缀（`• ` / `1. `）。
 * - `cap` 既用于「独占题注段」也用于 `figcaption`；这里 figcaption 单列一份，
 *   语义更清晰（render.py 用 <p> 当题注，转换层改用 <figure><figcaption>）。
 * - 所有数值均为字面值；无 calc()/var()。
 */
export const STYLE = {
  // 根容器：放整体字体 / 字号 / 行距 / 正文色基线（design §3.2 最外层根 section）。
  root: `margin:0;padding:0;font-family:${SANS};font-size:16px;line-height:1.9;color:${INK};text-align:start`,

  // 正文段落。必须内联 line-height（公众号会改写默认行距）。
  p: `margin:0 0 1.15em;font-size:16px;line-height:1.9;letter-spacing:.02em;color:${INK};text-align:start`,
  // 次要 / 声明段。
  muted: `margin:0 0 1.15em;font-size:14px;line-height:1.85;color:${MUTED};text-align:start`,

  // 文章主标题（h1，居中宋体大字）。
  title: `margin:0 0 .3em;text-align:center;font-size:25px;font-weight:700;color:${INK_STRONG};line-height:1.4;font-family:${SERIF}`,
  // 章节标题（h2）。前缀「一、/1.」由转换层染玫瑰。
  chapter: `margin:2.6em 0 .9em;font-size:21px;font-weight:700;color:${INK_STRONG};line-height:1.45;font-family:${SERIF}`,
  // 步骤标题（h3）。前缀「第一步 / 方式一 / 数字」由转换层染玫瑰。
  step: `margin:1.9em 0 .7em;font-size:16.5px;font-weight:600;color:${INK_STRONG};line-height:1.5`,
  // 眉标（h4，小号玫瑰）。
  eyebrow: `margin:1.6em 0 .6em;font-size:13.5px;font-weight:700;color:${ROSE};letter-spacing:.05em`,

  // 列表容器。靠 padding-left 缩进；符号是 li 文本前缀，绝不用 list-style。
  ul: 'margin:.8em 0 1.15em;padding-left:1.35em',
  ol: 'margin:.8em 0 1.15em;padding-left:1.5em',
  // 列表项。无 list-style。
  li: `margin:.45em 0;font-size:15.5px;line-height:1.85;letter-spacing:.02em;color:${INK}`,

  // 图片（带题注时下外边距归 0，让题注紧贴）。
  img: `display:block;max-width:100%;height:auto;margin:1.4em auto;border-radius:8px;border:1px solid ${IMG_BORDER}`,
  imgCapped: `display:block;max-width:100%;height:auto;margin:1.4em auto 0;border-radius:8px;border:1px solid ${IMG_BORDER}`,
  // figure 包裹：仅做外边距归零，避免浏览器默认 figure margin 干扰内联节奏。
  figure: 'margin:0;padding:0',
  // 题注（figcaption）/ 独占题注段。
  cap: `margin:.6em 0 1.4em;text-align:center;font-size:12.5px;color:${CAP}`,

  // 提示卡（引用 quote 渲染成此）：玫瑰左线 + 极淡底。
  callout: `margin:1.4em 0;padding:13px 16px;border-left:2px solid ${ROSE};background:${FILL};border-radius:0 6px 6px 0;font-size:15px;line-height:1.85;color:${CALL}`,
  // 提示卡内部段落：清掉默认 margin，继承提示卡字号 / 行距 / 颜色。
  calloutP: `margin:0;font-size:15px;line-height:1.85;letter-spacing:.02em;color:${CALL}`,

  // 分隔线（render.py 用 <p> 模拟，转换层改用真 <hr>，样式等价）。
  hr: `margin:2.6em auto;width:30px;border:none;border-top:1px solid ${RULE};height:0;line-height:0;font-size:0`,

  // 行内码。
  code: `font-family:Consolas,Monaco,monospace;font-size:90%;background:${CODE_BG};padding:2px 5px;border-radius:4px;color:${CODE_FG}`,
  // 加粗。
  strong: `font-weight:600;color:${INK_STRONG}`,
  // 斜体。
  em: `font-style:italic;color:${CALL}`,
  // 链接（正文外链在公众号 App 内不可点，仅作视觉；真正跳转走「阅读原文」）。
  a: `color:${ROSE};text-decoration:none;border-bottom:1px solid rgba(194,112,108,.35)`,

  // 文末 CTA 胶囊外层段（居中）。
  ctaWrap: 'margin:1.2em 0 .2em;text-align:center',
  // 文末 CTA 胶囊本体。pointer-events:none —— 视觉引导，不可点（白名单允许）。
  cta: `display:inline-block;background:${ROSE};color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:11px 28px;border-radius:999px;pointer-events:none`,
} as const

// 语义键的字面量联合类型，便于转换层做 key 收窄 / 防写错。
export type StyleKey = keyof typeof STYLE
