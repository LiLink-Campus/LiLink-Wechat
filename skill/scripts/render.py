#!/usr/bin/env python3
"""
lilink-formatter · render.py

把一篇 LiLink / relationship 的 Markdown 文章，渲染成「微光玫瑰·克制版」
可复制 HTML（全元素内联样式，适配公众号粘贴），输出到同目录的 .html。

纯标准库实现，零依赖、路径无关 —— 跟着 LiLink 内容搬到哪都能跑。

用法:
    python3 render.py 文章.md
    python3 render.py 文章.md -o 输出.html
    python3 render.py 文章.md --cta-url https://lilink.top --cta-text "去 LiLink 看看 →"
    python3 render.py 文章.md --no-cta

排版约定（让脚本产出更好）见 ../SKILL.md。
"""
import argparse
import html
import os
import re
import sys

# ---------- 微光玫瑰·克制版 设计令牌（唯一真源） ----------
SANS = "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
SERIF = "'Songti SC','STSong','SimSun',Georgia,serif"
ROSE = "#c2706c"      # 强调色：只点在小节号/链接/提示左线/CTA
ROSE_HOVER = "#b3635f"
INK = "#4a4340"       # 正文（暖灰，非纯黑，护眼）
INK_STRONG = "#342d2b"  # 标题/加粗
MUTED = "#8a7f7a"     # 声明/次要
CAP = "#a89a95"       # 题注
FILL = "#fdf6f5"      # 提示卡极淡底
RULE = "#ece2e0"      # 分隔线
CALL = "#6a5b58"      # 提示卡文字
IMG_BORDER = "#f0eae9"

STYLE = {
    "p": f"margin:0 0 1.15em;font-size:16px;line-height:1.9;color:{INK};text-align:start",
    "muted": f"margin:0 0 1.15em;font-size:14px;line-height:1.85;color:{MUTED};text-align:start",
    "title": f"margin:0 0 .3em;text-align:center;font-size:25px;font-weight:700;color:{INK_STRONG};line-height:1.4;font-family:{SERIF}",
    "chapter": f"margin:2.6em 0 .9em;font-size:21px;font-weight:700;color:{INK_STRONG};line-height:1.45;font-family:{SERIF}",
    "step": f"margin:1.9em 0 .7em;font-size:16.5px;font-weight:600;color:{INK_STRONG};line-height:1.5",
    "eyebrow": f"margin:1.6em 0 .6em;font-size:13.5px;font-weight:700;color:{ROSE};letter-spacing:.05em",
    "ul": "margin:.8em 0 1.15em;padding-left:1.35em",
    "ol": "margin:.8em 0 1.15em;padding-left:1.5em",
    "li": f"margin:.45em 0;font-size:15.5px;line-height:1.85;color:{INK}",
    "img": f"display:block;max-width:100%;height:auto;margin:1.4em auto;border-radius:8px;border:1px solid {IMG_BORDER}",
    "img_capped": f"display:block;max-width:100%;height:auto;margin:1.4em auto 0;border-radius:8px;border:1px solid {IMG_BORDER}",
    "cap": f"margin:.6em 0 1.4em;text-align:center;font-size:12.5px;color:{CAP}",
    "callout": f"margin:1.4em 0;padding:13px 16px;border-left:2px solid {ROSE};background:{FILL};border-radius:0 6px 6px 0;font-size:15px;line-height:1.85;color:{CALL}",
    "hr": f"margin:2.6em auto;width:30px;border:none;border-top:1px solid {RULE};height:0;line-height:0;font-size:0",
    "code": "font-family:Consolas,Monaco,monospace;font-size:90%;background:#f6efee;padding:2px 5px;border-radius:4px;color:#b3635f",
    "strong": f"font-weight:600;color:{INK_STRONG}",
    "em": f"font-style:italic;color:{CALL}",
    "a": f"color:{ROSE};text-decoration:none;border-bottom:1px solid rgba(194,112,108,.35)",
}

# 章节序号（顶层标题，染玫瑰色的前缀）
RE_CHAPTER_LEAD = re.compile(r"^([一二三四五六七八九十百]+[、.]|[0-9]+[、.])")
# 步骤前缀（第N步 / 方式N / N.）
RE_STEP_LEAD = re.compile(r"^(第[一二三四五六七八九十0-9]+步|方式[一二三四五六七八九十0-9]+|[0-9]+[、.])")
# 文件名式 alt（不配题注）
RE_FILENAME_ALT = re.compile(r"(?i)^\s*$|^image[-_ ]?\d|chatgpt image|\.(png|jpe?g|webp|gif)\s*$")


def esc(text):
    return html.escape(text, quote=False)


def inline(text):
    """行内格式：`code` / **bold** / *italic* / [text](url)。先转义再替换标记。"""
    t = esc(text)
    t = re.sub(r"`([^`]+)`", lambda m: f'<code style="{STYLE["code"]}">{m.group(1)}</code>', t)
    t = re.sub(r"\*\*(.+?)\*\*", lambda m: f'<strong style="{STYLE["strong"]}">{m.group(1)}</strong>', t)
    t = re.sub(r"(?<!\*)\*([^*\n]+?)\*(?!\*)", lambda m: f'<em style="{STYLE["em"]}">{m.group(1)}</em>', t)
    t = re.sub(r"\[(.+?)\]\((.+?)\)",
               lambda m: f'<a href="{m.group(2)}" style="{STYLE["a"]}">{m.group(1)}</a>', t)
    return t


def color_lead(text, pattern):
    """把标题前缀（一、/第一步/方式一/数字）染成玫瑰色，其余正常行内处理。"""
    m = pattern.match(text)
    if m:
        lead = esc(m.group(0))
        rest = inline(text[m.end():])
        return f'<span style="color:{ROSE}">{lead}</span>{rest}'
    return inline(text)


def split_frontmatter(src):
    """剥离 YAML frontmatter，返回 (title, body)。"""
    title = ""
    if src.startswith("---"):
        end = src.find("\n---", 3)
        if end != -1:
            fm = src[3:end]
            nl = src.find("\n", end + 1)
            body = src[nl + 1:] if nl != -1 else ""
            m = re.search(r"^title:\s*(.+)$", fm, re.MULTILINE)
            if m:
                title = m.group(1).strip().strip("\"'")
            return title, body
    return title, src


def render_blocks(lines, role_map):
    """逐块渲染 Markdown 行 → 内联样式 HTML 片段列表。"""
    out = []
    i, n = 0, len(lines)

    def img_html(alt, src):
        capped = not RE_FILENAME_ALT.search(alt or "")
        style = STYLE["img_capped"] if capped else STYLE["img"]
        parts = [f'<img src="{src}" alt="{esc(alt)}" style="{style}">']
        if capped:
            parts.append(f'<p style="{STYLE["cap"]}">{esc(alt)}</p>')
        return "".join(parts)

    while i < n:
        line = lines[i]
        stripped = line.strip()

        # 空行
        if not stripped:
            i += 1
            continue

        # 标题
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            level = len(m.group(1))
            text = m.group(2).strip()
            if level == 1:
                out.append(f'<h1 style="{STYLE["title"]}">{inline(text)}</h1>')
            else:
                role = role_map.get(level, "eyebrow")
                if role == "chapter":
                    out.append(f'<h2 style="{STYLE["chapter"]}">{color_lead(text, RE_CHAPTER_LEAD)}</h2>')
                elif role == "step":
                    out.append(f'<h3 style="{STYLE["step"]}">{color_lead(text, RE_STEP_LEAD)}</h3>')
                else:
                    out.append(f'<p style="{STYLE["eyebrow"]}">{inline(text)}</p>')
            i += 1
            continue

        # 分隔线
        if re.match(r"^(-{3,}|\*{3,}|_{3,})$", stripped):
            out.append(f'<p style="{STYLE["hr"]}">&nbsp;</p>')
            i += 1
            continue

        # 独占一行的图片
        m = re.match(r"^!\[(.*?)\]\((.*?)\)\s*$", stripped)
        if m:
            out.append(img_html(m.group(1), m.group(2)))
            i += 1
            continue

        # 引用块 → 提示卡
        if stripped.startswith(">"):
            buf = []
            while i < n and lines[i].strip().startswith(">"):
                buf.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            text = " ".join(s.strip() for s in buf if s.strip())
            out.append(f'<p style="{STYLE["callout"]}">{inline(text)}</p>')
            continue

        # 无序列表
        if re.match(r"^[-*+]\s+", stripped):
            items = []
            while i < n and re.match(r"^[-*+]\s+", lines[i].strip()):
                items.append(re.sub(r"^[-*+]\s+", "", lines[i].strip()))
                i += 1
            lis = "".join(f'<li style="{STYLE["li"]}">{inline(it)}</li>' for it in items)
            out.append(f'<ul style="{STYLE["ul"]}">{lis}</ul>')
            continue

        # 有序列表
        if re.match(r"^\d+[.)]\s+", stripped):
            items = []
            while i < n and re.match(r"^\d+[.)]\s+", lines[i].strip()):
                items.append(re.sub(r"^\d+[.)]\s+", "", lines[i].strip()))
                i += 1
            lis = "".join(f'<li style="{STYLE["li"]}">{inline(it)}</li>' for it in items)
            out.append(f'<ol style="{STYLE["ol"]}">{lis}</ol>')
            continue

        # 段落（连续非空、非特殊行）
        para = []
        while i < n and lines[i].strip() and not re.match(r"^(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|!\[.*?\]\(.*?\)\s*$|-{3,}$|\*{3,}$|_{3,}$)", lines[i].strip()):
            para.append(lines[i].strip())
            i += 1
        text = " ".join(para)
        out.append(f'<p style="{STYLE["p"]}">{inline(text)}</p>')

    return out


def build_role_map(lines):
    """根据用到的标题层级，把最浅一层→chapter，下一层→step，再深→eyebrow。"""
    levels = sorted({len(m.group(1)) for ln in lines
                     for m in [re.match(r"^(#{1,6})\s+", ln)] if m and len(m.group(1)) >= 2})
    roles = ["chapter", "step", "eyebrow", "eyebrow", "eyebrow"]
    return {lvl: roles[min(idx, len(roles) - 1)] for idx, lvl in enumerate(levels)}


PAGE = """<!DOCTYPE html>
<!-- 由 lilink-formatter 生成的「可复制」排版稿 · 主题：微光玫瑰（relationship 专用·克制版） -->
<!-- 用法：浏览器打开 → 点右上角「复制到公众号」→ 公众号正文粘贴。正文外链不可点，记得把文章「阅读原文」设成 {cta_domain}。 -->
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · 可复制排版</title>
<style>
  body {{ margin:0; padding:70px 16px 80px; background:#e9e7e2;
    font-family:{sans}; }}
  .toolbar {{ position:fixed; top:0; left:0; right:0; height:52px; background:rgba(255,255,255,.94);
    backdrop-filter:blur(6px); border-bottom:1px solid #e0d8d5; display:flex; align-items:center;
    justify-content:space-between; padding:0 18px; z-index:50; }}
  .toolbar .hint {{ font-size:12.5px; color:{muted}; line-height:1.4; }}
  .toolbar .hint b {{ color:{rose}; }}
  #copybtn {{ border:none; background:{rose}; color:#fff; font-size:13.5px; font-weight:600;
    padding:9px 18px; border-radius:999px; cursor:pointer; white-space:nowrap; }}
  #copybtn:hover {{ background:{rose_hover}; }}
  .card {{ max-width:700px; margin:0 auto; background:#fff; border-radius:14px;
    box-shadow:0 6px 28px rgba(60,45,45,.12); padding:46px 42px 40px; }}
  @media (max-width:640px) {{ .card {{ padding:32px 22px 30px; }} .toolbar .hint {{ display:none; }} }}
</style>
</head>
<body>
  <div class="toolbar">
    <div class="hint">微光玫瑰排版 · 粘进公众号正文后，把<b>「阅读原文」</b>设成 {cta_domain}（正文外链不可点）</div>
    <button id="copybtn" onclick="copyArticle()">📋 复制到公众号</button>
  </div>
  <div class="card">
    <div id="article">
{article}
    </div>
  </div>
<script>
  function copyArticle() {{
    var art = document.getElementById('article');
    var sel = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(art);
    sel.removeAllRanges();
    sel.addRange(range);
    var ok = false;
    try {{ ok = document.execCommand('copy'); }} catch (e) {{ ok = false; }}
    sel.removeAllRanges();
    var btn = document.getElementById('copybtn');
    btn.textContent = ok ? '已复制 ✓ 去公众号粘贴' : '复制失败，请手动全选';
    setTimeout(function () {{ btn.textContent = '📋 复制到公众号'; }}, 2400);
  }}
</script>
</body>
</html>
"""


def cta_block(url, text):
    domain = re.sub(r"^https?://", "", url).rstrip("/")
    return (
        f'<p style="{STYLE["hr"]}">&nbsp;</p>'
        f'<p style="margin:.4em 0 .6em;text-align:center">'
        f'<a href="{url}" style="display:inline-block;background:{ROSE};color:#fff;text-decoration:none;'
        f'font-size:15px;font-weight:500;padding:11px 28px;border-radius:999px">{esc(text)}</a></p>'
        f'<p style="margin:.7em 0 0;text-align:center;font-size:12px;color:{CAP};letter-spacing:.04em">{esc(domain)}</p>'
    )


def render(src, cta_url, cta_text, no_cta):
    title, body = split_frontmatter(src)
    lines = body.replace("\r\n", "\n").split("\n")
    role_map = build_role_map(lines)
    blocks = render_blocks(lines, role_map)
    if not no_cta:
        blocks.append(cta_block(cta_url, cta_text))
    article = "\n".join("      " + b for b in blocks)
    domain = re.sub(r"^https?://", "", cta_url).rstrip("/") if not no_cta else "lilink.top"
    return PAGE.format(
        title=esc(title or "LiLink"), sans=SANS, muted=MUTED, rose=ROSE,
        rose_hover=ROSE_HOVER, cta_domain=domain, article=article,
    )


def main():
    ap = argparse.ArgumentParser(description="把 relationship/LiLink 文章渲染成微光玫瑰可复制 HTML")
    ap.add_argument("markdown", help="输入的 .md 文章路径")
    ap.add_argument("-o", "--output", help="输出 .html 路径（默认同目录同名）")
    ap.add_argument("--cta-url", default="https://lilink.top", help="文末 CTA 链接（默认 https://lilink.top）")
    ap.add_argument("--cta-text", default="去 LiLink 看看 →", help="文末 CTA 文案")
    ap.add_argument("--no-cta", action="store_true", help="不追加文末 CTA")
    args = ap.parse_args()

    if not os.path.isfile(args.markdown):
        sys.exit(f"找不到文件: {args.markdown}")
    with open(args.markdown, encoding="utf-8") as f:
        src = f.read()

    out_path = args.output or os.path.splitext(args.markdown)[0] + ".html"
    htmlout = render(src, args.cta_url, args.cta_text, args.no_cta)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(htmlout)
    print(f"已生成: {out_path}")


if __name__ == "__main__":
    main()
