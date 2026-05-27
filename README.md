# LiLink-Wechat

LiLink 公众号的全部内容 + 排版工具，一套打包。

## 结构

- `articles/md/` — 文章源码（Markdown）
- `articles/html/` — 可复制排版稿（微光玫瑰主题，直接粘进公众号）
- `articles/assets/` — 图片（`md/` 与 `html/` 均以 `../assets/` 引用）
- `skill/` — `lilink-formatter` 排版 skill：把一篇 `.md` 渲染成可复制 HTML

## 出一篇公众号

```bash
# 1. 在 articles/md/ 写/改文章（写作口吻见 skill/references/写作风格.md）
# 2. 渲染成可复制排版稿
python3 skill/scripts/render.py articles/md/某篇.md -o articles/html/某篇.html
# 3. 浏览器打开 articles/html/某篇.html → 「复制到公众号」→ 粘进正文
#    → 把文章「阅读原文」设成 lilink.top（正文外链不可点）
```

排版主题为「微光玫瑰·克制版」：暖灰正文 + 玫瑰强调 + 衬线标题 + 大留白，温暖护眼、不堆模板件。详见 `skill/SKILL.md`。
