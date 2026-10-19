import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const bffDevTarget = process.env.VITE_BFF_DEV_TARGET || 'http://localhost:8080'
const zordon = process.env.VITE_ZORDON_MODE === 'true'

const cspNoncePlaceholder = () => ({
  name: 'becoartes-csp-nonce-placeholder',
  transformIndexHtml: {
    order: 'post' as const,
    handler: (html: string) => (zordon ? html.replace(/<script(?![^>]*type="module")[^>]*>[\s\S]*?<\/script>/g, '').replace(/<meta name="google-adsense-account"[^>]*>/g, '').replace(/<link rel="manifest"[^>]*>/g, '').replace(/<title>[\s\S]*?<\/title>/, '<title>Zordon PDV</title>') : html).replace(
      /<script(?![^>]*\bnonce=)/g,
      '<script nonce="__CSP_NONCE__"',
    ),
  },
})

// https://vite.dev/config/
export default defineConfig({
  base: zordon ? '/os/pdv/assets/' : '/',
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
      '/menu-image': { target: bffDevTarget, changeOrigin: true },
      '/api': {
        target: bffDevTarget,
        changeOrigin: true,
      },
    },
  },
})
