'use client'

// 「复制到公众号」按钮（Payload admin 自定义 UI 组件，client）。
//
// 设计依据 §3.5 通道 2「复制到公众号」：用**双格式剪贴板**把那份全内联 HTML 同时以
// text/html + text/plain 写进剪贴板，运营在公众号编辑器里直接粘贴即得带格式正文
// （解决「粘过去变纯文本/掉格式」）。
//
// 取 HTML 的方式：转换需在服务端（renderToInlineHtml 用到 Node），故点击时 fetch
// 集合 endpoint  GET /api/channel-contents/:id/inline-html  拿回 { html }，这份与
// 预览/发布完全相同。组件本身不做任何转换。
//
// 挂载：作为 channel-contents 的 ui 字段 admin.components.Field（见 registerNotes），
// id 由 useDocumentInfo() 提供，serverURL/api 前缀由 useConfig() 提供。
//
// 兼容：优先 navigator.clipboard.write([ClipboardItem])（需 HTTPS / localhost，
// 且多数情况下需用户手势——按钮点击即满足）；不支持时降级 execCommand('copy')
// 走一个临时 contentEditable 节点（也能带 HTML 格式）。

import { useCallback, useState } from 'react'
import { Button, useConfig, useDocumentInfo } from '@payloadcms/ui'

// 提示语在组件内自管（toast 在不同 @payloadcms/ui 小版本导出形态略有差异，
// 用本地内联状态显示更稳，也不引额外依赖）。
type Feedback = { kind: 'idle' | 'ok' | 'error'; msg: string }

const IDLE: Feedback = { kind: 'idle', msg: '' }

// 用 ClipboardItem 写双格式剪贴板。成功返回 true。
async function writeRichClipboard(html: string): Promise<boolean> {
  // 运行环境与 API 能力检测：navigator.clipboard.write + ClipboardItem 均需存在。
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.write !== 'function' ||
    typeof ClipboardItem === 'undefined'
  ) {
    return false
  }
  try {
    const htmlBlob = new Blob([html], { type: 'text/html' })
    const textBlob = new Blob([html], { type: 'text/plain' })
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob }),
    ])
    return true
  } catch {
    return false
  }
}

// 降级：用 contentEditable + document.execCommand('copy') 复制富文本。
// 选中一段含 HTML 的隐藏节点再 copy，多数浏览器会把 HTML 一并放进剪贴板。
function writeClipboardFallback(html: string): boolean {
  if (typeof document === 'undefined') return false
  const holder = document.createElement('div')
  holder.setAttribute('contenteditable', 'true')
  holder.innerHTML = html
  // 移出可视区域，避免闪烁/布局跳动；不能 display:none（否则选区为空）。
  holder.style.position = 'fixed'
  holder.style.left = '-99999px'
  holder.style.top = '0'
  holder.style.opacity = '0'
  holder.style.pointerEvents = 'none'
  document.body.appendChild(holder)
  try {
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(holder)
    selection?.removeAllRanges()
    selection?.addRange(range)
    const ok = document.execCommand('copy')
    selection?.removeAllRanges()
    return ok
  } catch {
    return false
  } finally {
    document.body.removeChild(holder)
  }
}

export const CopyToWechat = () => {
  const { id } = useDocumentInfo()
  const {
    config: {
      serverURL,
      routes: { api },
    },
  } = useConfig()

  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(IDLE)

  const handleClick = useCallback(async () => {
    if (!id || busy) return
    setBusy(true)
    setFeedback(IDLE)
    try {
      // 取与预览/发布完全相同的那份全内联 HTML。
      const apiPrefix = api ?? '/api'
      const res = await fetch(`${serverURL ?? ''}${apiPrefix}/channel-contents/${id}/inline-html`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!res.ok) {
        let serverMsg = ''
        try {
          serverMsg = (await res.json())?.error ?? ''
        } catch {
          /* 忽略非 JSON 错误体 */
        }
        throw new Error(serverMsg || `取内联 HTML 失败（${res.status}）`)
      }
      const { html } = (await res.json()) as { html?: string }
      if (!html) throw new Error('内联 HTML 为空')

      // 双格式剪贴板，失败再降级 execCommand。
      const ok = (await writeRichClipboard(html)) || writeClipboardFallback(html)
      if (!ok) throw new Error('浏览器拒绝了剪贴板写入，请改用预览页手动复制')

      setFeedback({ kind: 'ok', msg: '已复制，去公众号粘贴' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '复制失败'
      setFeedback({ kind: 'error', msg })
    } finally {
      setBusy(false)
    }
  }, [id, busy, serverURL, api])

  // 创建表单（尚无 id）时不渲染——没有可复制的稿子。
  if (!id) return null

  return (
    <div style={{ marginBottom: '1rem' }}>
      <Button buttonStyle="secondary" onClick={handleClick} disabled={busy}>
        {busy ? '复制中…' : '复制到公众号'}
      </Button>
      {feedback.kind !== 'idle' && (
        <span
          role="status"
          style={{
            marginLeft: '0.75rem',
            fontSize: '0.85rem',
            color: feedback.kind === 'ok' ? '#1a7f37' : '#c2410c',
          }}
        >
          {feedback.msg}
        </span>
      )}
    </div>
  )
}

// 默认导出：方便用 '#default' 或具名两种 importMap 写法都能挂载。
export default CopyToWechat
