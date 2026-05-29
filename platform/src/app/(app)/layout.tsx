import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// (app) 路由组的根 layout —— 提供 <html>/<body>。
//
// 重要：根 src/app 下【不】放 layout.tsx/page.tsx，让 (payload) 与 (app) 各自成为
// 独立的 root 路由组，各自渲染一份 <html>/<body>。否则若 src/app/layout.tsx 也渲染
// <html>，会与 Payload (payload)/layout.tsx 的 RootLayout 产生嵌套 <html>，破坏 admin
// 样式（退化成裸 HTML）。这是 Payload 官方 blank 模板的标准结构。
export const metadata: Metadata = {
  title: 'LiLink 内容中台',
  description: 'LiLink 多平台内容发布中台',
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
