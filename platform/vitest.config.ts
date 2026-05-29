import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// vite-tsconfig-paths 让 vitest 解析 tsconfig 的路径别名（@payload-config → src/payload.config.ts、@/* → src/*）。
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 集成测试（需 DB）已用 describe.skipIf(!process.env.DATABASE_URI) 自行跳过。
  },
})
