# lilink-formatter

一个自包含的 agent **skill**：把 LiLink / relationship 主题的 Markdown 文章，渲染成「微光玫瑰·克制版」的可复制 HTML（全元素内联样式），可直接粘进微信公众号正文。

它是冷峻"苹果蓝科技风"排版的 **relationship 对位** —— 暖色、温柔、护眼，专给情感关系 / 校园社交 / LiLink 这条线用。

## 结构

```
lilink-formatter/
├── SKILL.md            # skill 本体：何时用 + 怎么用 + 排版约定
├── scripts/
│   └── render.py       # 零依赖 Python 渲染器
└── examples/
    └── sample.md       # 演示全部排版约定的样例文章
```

## 用法

```bash
python3 scripts/render.py 你的文章.md
```

在同目录生成 `你的文章.html`。浏览器打开 → 点右上角「复制到公众号」→ 公众号正文粘贴 → 把文章「阅读原文」设成 CTA 链接（默认 lilink.top，因为公众号正文外链不可点）。

## 设计

温暖与护眼来自**色温、衬线、留白**：暖灰正文（非纯黑）、玫瑰强调色只点在小节号/链接/提示/CTA、衬线小节标题、大留白。刻意不用徽章、卡片盒子、路线图那类组件——避免 AI 模板味，保住亲密与安静。

设计令牌集中在 `scripts/render.py` 顶部，便于整体调色。
