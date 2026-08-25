import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const bffDevTarget = process.env.VITE_BFF_DEV_TARGET || 'http://localhost:8080'

const cspNoncePlaceholder = () => ({
  name: 'becoartes-csp-nonce-placeholder',
  transformIndexHtml: {
    order: 'post' as const,
    handler: (html: string) => html.replace(
      /<script(?![^>]*\bnonce=)/g,
      '<script nonce="__CSP_NONCE__"',
    ),
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cspNoncePlaceholder(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          motion: ['framer-motion'],
          icons: ['lucide-react'],
          data: ['zustand', 'zod'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: bffDevTarget,
        changeOrigin: true,
      },
    },
  },
})
