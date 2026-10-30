import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// The 3D map engine is a dynamic import, so the browser normally only discovers it
// after the app bundle has downloaded and run. Preloading it from index.html starts
// both downloads at once, which is the biggest win for time-to-map on phones.
function preloadMapEngine(): Plugin {
  return {
    name: 'preload-map-engine',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const tags = []
        for (const f of Object.values(ctx.bundle ?? {})) {
          if (!/HazardMap3D-/.test(f.fileName)) continue
          const href = '/meta-maps/' + f.fileName
          if (f.fileName.endsWith('.js')) tags.push({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: '', href }, injectTo: 'head' as const })
          else if (f.fileName.endsWith('.css')) tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'style', href }, injectTo: 'head' as const })
        }
        return tags
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), preloadMapEngine()],
  base: '/meta-maps/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        // stable vendor chunk: the app shell re-downloads without re-fetching React
        manualChunks: id => (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) ? 'react' : undefined,
      },
    },
  },
})
