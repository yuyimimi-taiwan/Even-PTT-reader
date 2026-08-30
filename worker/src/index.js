const PTTWEB_ORIGIN = 'https://www.pttweb.cc'

function corsHeaders(contentType = 'application/json; charset=utf-8') {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
  }
}

function response(body, status = 200, contentType) {
  return new Response(body, { status, headers: corsHeaders(contentType) })
}

function upstreamRequest(pathname) {
  return fetch(new URL(pathname, PTTWEB_ORIGIN), {
    headers: {
      'User-Agent': 'EvenPTTReader/0.1 (public board reader)',
      Accept: 'text/html,application/xhtml+xml',
    },
  })
}

export default {
  async fetch(request) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return response('', 204)
    if (request.method !== 'GET') {
      return response(JSON.stringify({ error: 'Method not allowed' }), 405)
    }

    if (url.pathname === '/api/baseball') {
      const upstream = await upstreamRequest('/bbs/Baseball/hot/24h')
      return response(await upstream.text(), upstream.status, 'text/html; charset=utf-8')
    }

    if (url.pathname === '/api/article') {
      const path = url.searchParams.get('path') ?? ''
      if (!/^\\/bbs\\/Baseball\\/M\\.\\d+\\.[A-Za-z0-9]+$/.test(path)) {
        return response(JSON.stringify({ error: 'Invalid Baseball article path' }), 400)
      }

      const upstream = await upstreamRequest(path)
      return response(await upstream.text(), upstream.status, 'text/html; charset=utf-8')
    }

    return response(JSON.stringify({
      name: 'Even PTT Reader proxy',
      endpoints: ['/api/baseball', '/api/article?path=/bbs/Baseball/M.<id>'],
    }))
  },
}
