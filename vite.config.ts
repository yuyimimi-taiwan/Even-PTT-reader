import { defineConfig, type Plugin } from 'vite'

let sharedBoards = ''

function boardSyncPlugin(): Plugin {
  return {
    name: 'even-ptt-board-sync',
    configureServer(server) {
      server.middlewares.use('/api/boards', (request, response) => {
        if (request.method === 'GET') {
          response.setHeader('Content-Type', 'application/json')
          response.end(sharedBoards || '[]')
          return
        }
        if (request.method === 'POST') {
          let body = ''
          request.on('data', (chunk) => { body += chunk })
          request.on('end', () => {
            try {
              const parsed = JSON.parse(body)
              if (!Array.isArray(parsed)) throw new Error('Expected array')
              sharedBoards = JSON.stringify(parsed)
              response.statusCode = 204
            } catch {
              response.statusCode = 400
            }
            response.end()
          })
          return
        }
        response.statusCode = 405
        response.end()
      })
    },
  }
}

export default defineConfig({
  plugins: [boardSyncPlugin()],
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
