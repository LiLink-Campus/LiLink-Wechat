---
name: lilink-formatter
description: Render a LiLink / relationship-topic article (Markdown) into a copyable, inline-styled HTML page in the warm "微光玫瑰·克制版" reading theme, ready to paste into a WeChat 公众号. Use whenever the user wants to 排版 / 格式化 / 生成可复制 HTML for a LiLink or relationship article (情感关系、校园社交、LiLink 攻略/介绍/投稿), turn a relationship .md into a WeChat-paste page, or asks for "LiLink 排版 / relationship 排版 / 微光玫瑰". This is the relationship counterpart to the cool tech 苹果蓝 formatter — use it for relationship content, and do NOT use it for tech / thought / finance articles.
---

# lilink-formatter

把一篇写好的 relationship / LiLink Markdown，渲染成「微光玫瑰·克制版」的**可复制 HTML**（全元素内联样式 + 图片 base64 内联，适配公众号粘贴）。

**分工**：这个 skill 只管**排版**（`.md` → 可复制 HTML）。"怎么写"一篇 LiLink 文（温柔第一人称、写孤独与靠近的口吻）是另一件事，归写作风格指引管，不在这里。

## 何时用 / 不用

- **用**：relationship topic 的文章要做成公众号可粘贴稿；用户说"LiLink 排版""relationship 排版""微光玫瑰""把这篇情感/校园社交文做成可复制 HTML"。
- **不用**：tech / thought / finance 文章——那些是冷峻的苹果蓝科技风，走各自的排版路径，别把这套暖色套上去。

## 快速开始

```bash
python3 scripts/render.py 路径/文章.md
```

在同目录生成 `文章.html`。浏览器打开它 → 右上角「📋 复制到公众号」（或全选 `Ctrl+C`）→ 公众号正文粘贴。

**关键现实**：公众号正文里的外链点不动（这是公众号限制，不是 bug）。所以文末按钮只是**视觉引导**；真正能跳转的 lilink.top，要靠把文章的「**阅读原文**」设成那个链接。生成页顶部的工具条也写了这句提醒。

**图片随文一起进公众号**：脚本默认把每张本地图片读成 base64 `data:` URI 内联进 HTML——所以复制到公众号时，图片会**跟着文字一起粘进去**（公众号编辑器会把内联图自动上传到素材库），不必再一张张手动重传，本地预览也不依赖 `assets/` 目录。代价是 `.html` 体积变大（十几张截图可达数 MB），属正常。网络图（`http(s)://`）保持原样不内联；要关掉内联用 `--no-embed-images`。

## 这套排版为什么这样（微光玫瑰·克制版）

relationship 要的是**温度**，不是科技感。温暖和护眼应当来自**色温、衬线、留白**本身：暖灰正文（非纯黑，减轻眼睛疲劳）、玫瑰强调色只在小节号/链接/提示/CTA 上轻点、衬线小节标题、舒展的行距与留白。

**刻意不用**徽章、卡片盒子、顶部路线图那类"组件件"——它们会让文章显得像 AI 排版模板，破坏这条线要的亲密、安静。少即是多，这是反复确认过的方向。

## 排版约定（顺着这些写，脚本就产出好结果）

脚本按约定把 Markdown 映射到样式，写文时遵循即可：

- **标题层级 = 逻辑层级**。用到的最浅一层标题 → **章节**（衬线大标题，前缀 `一、`/`1.` 染玫瑰）；下一层 → **步骤**（前缀 `第一步`/`方式一`/数字 染玫瑰）；再深一层 → **小眉标**（小号玫瑰字）。用 `##/###/####` 或 `###/####/#####` 都行，脚本按相对深浅判断，不在乎你从几级井号起步。
- **图片题注**。`![编辑名片](x.png)` 的 alt 会变成图下居中题注；像 `image-20260527...`、`ChatGPT Image ...` 这种文件名式 alt 不配题注（当纯插图）。攻略类截图建议写**有意义的 alt**，读者好定位。
- **提示卡**。把"小建议 / 提醒 / 策略"写成 `> 引用块`，渲染成玫瑰左线 + 极淡底的提示卡。块内开头写 `**一个小建议：**` 会得到玫瑰色强调。
- **文末 CTA**。脚本自动在结尾追加一颗胶囊按钮（默认 → lilink.top）。
- **行内**支持 `**加粗**`、`*斜体*`、`[文字](链接)`、`` `代码` ``。

## 脚本选项

| 选项 | 作用 |
| --- | --- |
| `-o 输出.html` | 自定义输出路径（默认同目录同名 `.html`） |
| `--cta-url URL` | 文末按钮链接（默认 `https://lilink.top`） |
| `--cta-text "文案"` | 按钮文案（默认 `去 LiLink 看看 →`） |
| `--no-cta` | 不加文末按钮（非 LiLink 的 relationship 文可用） |
| `--no-embed-images` | 不把图片转 base64 内联（默认内联便于随文粘入公众号；想要小体积或全用网络图时关掉） |

`examples/sample.md` 是一篇演示全部约定的样例，`python3 scripts/render.py examples/sample.md` 跑一遍就能看到效果。

## 可移植性

`render.py` 纯 Python3 标准库、**零依赖、路径无关**——跟着 LiLink 内容搬到任何仓库或机器都能直接跑。所有设计令牌集中在脚本顶部的 `STYLE` 字典和颜色常量里，要微调配色（玫瑰深浅、正文灰度、留白）改那一处即可。
