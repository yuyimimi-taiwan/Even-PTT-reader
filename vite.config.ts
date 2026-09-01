import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/sim': {
        target: 'http://127.0.0.1:9898',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/sim/, ''),
      },
    },
  },
})
