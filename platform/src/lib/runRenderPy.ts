// runRenderPy —— Node 侧调用 platform/scripts/render.py 的桥接层。
//
// render.py 是纯标准库、零依赖的排版脚本（"微光玫瑰·克制版"），第一期复用它来产出
// 微信可复制 HTML，避免在 TS 里重写一套等价排版逻辑。这里负责：
//   1. 把入参 markdown 落到临时 .md（用 os.tmpdir + 随机名，避免并发碰撞）；
//   2. 用 execFile 调 python3 render.py，输出到临时 .html；
//   3. 读回 HTML、收集 stderr 里的告警，最后清理临时文件（finally 保证）。
//
// 注意（重要）：render.py 解析 Markdown 里相对图片路径时，base_dir = 临时 .md 所在目录，
// 即 os.tmpdir()。所以若要让本地图片被 base64 内联，资产 src 需为绝对路径，或相对
// 临时目录可解析。远程 http(s) 图与已是 data: 的图原样保留，不受影响。

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 调用 render.py 的选项（从 Renderer 层映射下来的扁平形态）。
export interface RunRenderPyOptions {
  // 是否把本地图片内联成 data URI。显式 false → 传 --no-embed-images；
  // 其余（true / undefined）走 render.py 默认（内联）。
  embedImages?: boolean
  // 文末 CTA 配置。
  ctaUrl?: string
  ctaText?: string
  noCta?: boolean
}

// 调用结果：渲染出的 HTML，以及 render.py 写到 stderr 的告警行。
export interface RunRenderPyResult {
  html: string
  warnings: string[]
}

// render.py 的绝对路径。注意：不能用 import.meta.url —— Next/Turbopack 打包后它不是
// file:// URL，fileURLToPath 会抛 ERR_INVALID_ARG_TYPE。改用进程 cwd（dev 与 next start
// 的 cwd 都是 platform 根，scripts/ 在其下），并允许用 RENDER_PY_PATH 环境变量覆盖。
const RENDER_PY = process.env.RENDER_PY_PATH || join(process.cwd(), 'scripts', 'render.py')

// 用 execFile 包一层 Promise：成功 resolve {stderr}，失败 reject 带上 stderr 便于排错。
// 注意不能用顶层 promisify(execFile) —— 我们要在 render.py 退出码非 0 时把 stderr 带进错误信息。
function execFileAsync(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        // 把 stderr 拼进 message，渲染失败时能直接看到 Python 的报错。
        const detail = stderr ? `\n${stderr}` : ''
        reject(new Error(`render.py 执行失败: ${error.message}${detail}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

// 从 render.py 的 stderr 文本里提取告警行。
// render.py 用 "⚠ ..." 前缀打印非致命告警（如图片未找到）。这里按行过滤出非空行，
// 既保留 ⚠ 告警，也兜住其它意外的 stderr 输出。
function parseWarnings(stderr: string): string[] {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

// 调 render.py 渲染一段 Markdown，返回 HTML 与告警。
// 临时 .md / .html 全部建在一个一次性临时目录里，结束后整目录删除。
export async function runRenderPy(
  markdown: string,
  options: RunRenderPyOptions = {},
): Promise<RunRenderPyResult> {
  // 每次调用建一个独立临时目录，天然避免并发同名冲突；目录名随机由 mkdtemp 负责。
  const dir = await mkdtemp(join(tmpdir(), 'lilink-render-'))
  const mdPath = join(dir, 'input.md')
  const htmlPath = join(dir, 'output.html')

  try {
    await writeFile(mdPath, markdown, 'utf8')

    // 组装 render.py 参数：位置参数 markdown + -o 输出路径 + 选项映射。
    const args: string[] = [RENDER_PY, mdPath, '-o', htmlPath]

    // embedImages 显式为 false 时关闭内联；true / 未传都用脚本默认（内联），不加 flag。
    if (options.embedImages === false) {
      args.push('--no-embed-images')
    }
    // CTA 选项：noCta 优先；否则按需透传 url / text。
    if (options.noCta) {
      args.push('--no-cta')
    } else {
      if (options.ctaUrl !== undefined) {
        args.push('--cta-url', options.ctaUrl)
      }
      if (options.ctaText !== undefined) {
        args.push('--cta-text', options.ctaText)
      }
    }

    const { stderr } = await execFileAsync('python3', args)
    const html = await readFile(htmlPath, 'utf8')

    return { html, warnings: parseWarnings(stderr) }
  } finally {
    // 无论成功失败都清理整个临时目录（含 .md / .html）。
    // recursive 删目录，force 让"已不存在"不报错。
    await rm(dir, { recursive: true, force: true })
  }
}
