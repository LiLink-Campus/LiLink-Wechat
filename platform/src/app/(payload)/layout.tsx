/* THIS FILE WAS GENERATED AUTOMATICALLY BY PAYLOAD. */
/* DO NOT MODIFY IT BECAUSE IT COULD BE REWRITTEN AT ANY TIME. */
import type { ServerFunctionClient } from 'payload'

import config from '@payload-config'
import { handleServerFunctions, RootLayout } from '@payloadcms/next/layouts'
import React from 'react'

import { importMap } from './admin/importMap.js'
// Payload admin 样式。@payloadcms/ui 经 node_modules 解析到 dist，RootLayout 的 SCSS
// 编译链不会自动注入，必须在此显式 import 两份 dist 样式，否则 admin 退化成裸 HTML：
//   - @payloadcms/ui/styles.css：UI 组件样式（字段、按钮、表单控件等）
//   - @payloadcms/next/css：admin 应用级布局样式（登录/首用户的 template-minimal 居中容器、导航、仪表盘等）
import '@payloadcms/ui/styles.css'
import '@payloadcms/next/css'
import './custom.scss'

type Args = {
  children: React.ReactNode
}

const serverFunction: ServerFunctionClient = async function (args) {
  'use server'
  return handleServerFunctions({
    ...args,
    config,
    importMap,
  })
}

const Layout = ({ children }: Args) => (
  <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
    {children}
  </RootLayout>
)

export default Layout
