/* THIS FILE WAS GENERATED AUTOMATICALLY BY PAYLOAD. */
/* DO NOT MODIFY IT BECAUSE IT COULD BE REWRITTEN AT ANY TIME. */
import type { ServerFunctionClient } from 'payload'

import config from '@payload-config'
import { handleServerFunctions, RootLayout } from '@payloadcms/next/layouts'
import React from 'react'

import { importMap } from './admin/importMap.js'
// Payload admin 样式。@payloadcms/ui 经 node_modules 解析到 dist，RootLayout 的 SCSS
// 编译链不会自动注入，必须在此显式 import，否则 admin 退化成裸 HTML。
// @payloadcms/next/css（其 ./css 导出 → dist/prod/styles.css）是完整 admin 样式，且为
// @payloadcms/ui/styles.css 的超集（含 UI 组件 + admin 应用布局，如 template-minimal 登录
// 居中容器），故只需这一份；custom.scss 放最后用于覆盖。
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
