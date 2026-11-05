import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { createOpenPageApi } from './server/api'

/**
 * Serves /api/llm and /api/generate from the same process as the app, under both
 * `vite dev` and `vite preview`, so the provider key stays on the server.
 */
function openPageApiPlugin(): Plugin {
  return {
    name: 'openpage-api',
    configureServer(server) {
      server.middlewares.use(createOpenPageApi())
    },
    configurePreviewServer(server) {
      server.middlewares.use(createOpenPageApi())
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), openPageApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
