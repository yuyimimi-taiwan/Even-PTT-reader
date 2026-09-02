import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { RebuildPageContainer } from '@evenrealities/even_hub_sdk'

type Reply = { mark: string; author: string; time: string; content: string }
type Board = { name: string; url: string }
type Article = {
  likes: string
  title: string
  time: string
  path: string
  body?: string
  replies?: Reply[]
}

type BoardPage = {
  articles: Article[]
  olderUrl?: string
  newerUrl?: string
}

type ReplyPageLayout = {
  left: string
  times: string
}
type ArticleReadingPage =
  | { kind: 'text'; content: string }
  | { kind: 'image'; url: string }

const PROXY = 'https://cloudflare-cors-anywhere.yuyimimi.workers.dev/'
const DEFAULT_BOARDS: Board[] = [{ name: '棒球版', url: 'https://www.ptt.cc/bbs/Baseball/index.html' }]
const BOARD_STORE = 'even-ptt-reader-boards-v1'
const ROWS = 9
const LIKE_WIDTH = 3
// 以中文最寬字形計算，避免任何一列自動換行。
const TITLE_WIDTH = 38
const TIME_WIDTH = 5
// 單一容器上限是 200 × 100；用 2 × 2 容器拼成 400 × 180 大圖。
const IMAGE_WIDTH = 400
const IMAGE_HEIGHT = 180
const IMAGE_TILE_WIDTH = 200
const IMAGE_TILE_HEIGHT = 90
const imageCache = new Map<string, Uint8Array[]>()
const imageSourceCache = new Map<string, Blob>()

let articles: Article[] = []
let selected = 0
let topRow = 0
let marqueeOffset = 0
let page: 'home' | 'list' | 'article' = 'home'
let boards = readBoards()
let boardSelected = 0
let boardTopRow = 0
let currentBoard: Board | undefined
let activeArticle: Article | undefined
let articleTextPage = 0
let replyTextPage = 0
let articleView: 'body' | 'replies' = 'body'
let olderPageUrl: string | undefined
let newerPageUrl: string | undefined
let isLoadingPage = false
let isOpeningArticle = false
let pendingUpScrollTimer: ReturnType<typeof setTimeout> | undefined
let lastListScrollDirection: -1 | 0 | 1 = 0
let lastListScrollAt = 0
let holdScrollTimer: ReturnType<typeof setInterval> | undefined

function readBoards(): Board[] {
  try {
    const value = JSON.parse(localStorage.getItem(BOARD_STORE) || '[]')
    if (Array.isArray(value)) {
      const safe = value.filter((item): item is Board => typeof item?.name === 'string' && typeof item?.url === 'string')
        .map((item) => ({ name: item.name.trim().slice(0, 30), url: item.url.trim() }))
        .filter((item) => item.name && /^https:\/\/www\.ptt\.cc\/bbs\/[A-Za-z0-9_-]+\//.test(item.url))
      if (safe.length) return safe
    }
  } catch { /* 預設 */ }
  return [...DEFAULT_BOARDS]
}
async function saveBoards(next: Board[]): Promise<void> {
  boards = next.length ? next : [...DEFAULT_BOARDS]
  try { localStorage.setItem(BOARD_STORE, JSON.stringify(boards)) } catch { /* 本次仍可用 */ }
  // 瀏覽器 localStorage 在 Even Hub WebView 重開後不一定保留；以 Even App
  // 提供的持久儲存為準，資料會保存於手機上的 Even Hub。
  try { await bridge.setLocalStorage(BOARD_STORE, JSON.stringify(boards)) } catch { /* 開發瀏覽器仍可用 */ }
  void publishBoardsForSimulator()
}

function decodeSharedBoards(value: unknown): Board[] | undefined {
  if (!Array.isArray(value)) return undefined
  const safe = value
    .filter((item): item is Board => typeof item?.name === 'string' && typeof item?.url === 'string')
    .map((item) => ({ name: item.name.trim().slice(0, 30), url: item.url.trim() }))
    .filter((item) => item.name && /^https:\/\/www\.ptt\.cc\/bbs\/[A-Za-z0-9_-]+\//.test(item.url))
  return safe.length ? safe : undefined
}

// Codespaces 的手機瀏覽器與模擬器是不同 WebView；開發時以 Vite 暫存同步。
// 正式安裝時端點不存在，設定則交由 Even App 的持久儲存。
async function publishBoardsForSimulator(): Promise<void> {
  try {
    await fetch('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(boards),
    })
  } catch { /* 非開發環境不需要 */ }
}
async function syncBoardsFromDevelopmentServer(): Promise<void> {
  try {
    const response = await fetch('/api/boards', { cache: 'no-store' })
    if (!response.ok) return
    const next = decodeSharedBoards(await response.json())
    if (!next || JSON.stringify(next) === JSON.stringify(boards)) return
    boards = next
    try { localStorage.setItem(BOARD_STORE, JSON.stringify(boards)) } catch { /* 本次仍可用 */ }
    try { await bridge.setLocalStorage(BOARD_STORE, JSON.stringify(boards)) } catch { /* 僅限開發環境 */ }
    if (page === 'home') renderHome()
  } catch { /* 非開發環境不需要 */ }
}

async function restoreBoardsFromEvenApp(): Promise<void> {
  try {
    const stored = await bridge.getLocalStorage(BOARD_STORE)
    const restored = decodeSharedBoards(JSON.parse(stored || '[]'))
    if (restored) boards = restored
  } catch { /* 第一次使用或舊版 Even Hub 沒有資料時使用預設看板 */ }
}

const bridge = await waitForEvenAppBridge()
await restoreBoardsFromEvenApp()
await syncBoardsFromDevelopmentServer()
void publishBoardsForSimulator()

const listScreen = new TextContainerProperty({
  xPosition: 8, yPosition: 8, width: 560, height: 272,
  borderWidth: 0, borderColor: 0, paddingLength: 0,
  containerID: 1, containerName: 'board', content: '讀取中…',
  isEventCapture: 1,
})
const listTitles = new TextContainerProperty({
  xPosition: 86, yPosition: 8, width: 408, height: 272,
  borderWidth: 0, borderColor: 0, paddingLength: 0,
  containerID: 2, containerName: 'titles', content: '',
  isEventCapture: 0,
})
const listDates = new TextContainerProperty({
  xPosition: 510, yPosition: 8, width: 58, height: 272,
  borderWidth: 0, borderColor: 0, paddingLength: 0,
  containerID: 3, containerName: 'dates', content: '',
  isEventCapture: 0,
})
const listLikesNormal = new TextContainerProperty({
  xPosition: 35, yPosition: 8, width: 50, height: 272,
  borderWidth: 0, borderColor: 0, paddingLength: 0,
  containerID: 4, containerName: 'likes-normal', content: '',
  textColor: 3, isEventCapture: 0,
})
const listLikesDim = new TextContainerProperty({
  xPosition: 35, yPosition: 8, width: 50, height: 272,
  borderWidth: 0, borderColor: 0, paddingLength: 0,
  containerID: 5, containerName: 'likes-dim', content: '',
  textColor: 1, isEventCapture: 0,
})

const homeScreen = new TextContainerProperty({
  xPosition: 8, yPosition: 8, width: 560, height: 272, borderWidth: 0, borderColor: 0, paddingLength: 0,
  containerID: 1, containerName: 'home-cursor', content: '', isEventCapture: 1,
})
const homeNames = new TextContainerProperty({
  xPosition: 40, yPosition: 8, width: 520, height: 272, borderWidth: 0, borderColor: 0, paddingLength: 0,
  containerID: 2, containerName: 'home-names', content: '', isEventCapture: 0,
})
const started = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 2, textObject: [homeScreen, homeNames] }),
)
if (started !== 0) console.error('Unable to create PTT home page:', started)

function renderHome(): void {
  boardSelected = Math.max(0, Math.min(boards.length - 1, boardSelected))
  if (boardSelected < boardTopRow) boardTopRow = boardSelected
  if (boardSelected >= boardTopRow + ROWS) boardTopRow = boardSelected - ROWS + 1
  const visible = Array.from({ length: ROWS }, (_, row) => boards[boardTopRow + row])
  void bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 1, containerName: 'home-cursor',
    content: [' ', ...visible.map((board, row) => board && boardTopRow + row === boardSelected ? '>' : '')].join('\n'),
  }))
  void bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 2, containerName: 'home-names',
    content: ['PTT 看板', ...visible.map((board) => board ? clip(board.name, 26) : '')].join('\n'),
  }))
}
async function showHome(): Promise<void> {
  stopHoldScroll()
  page = 'home'
  activeArticle = undefined
  await bridge.rebuildPageContainer({ containerTotalNum: 2, textObject: [homeScreen, homeNames] } as RebuildPageContainer)
  renderHome()
}
async function openSelectedBoard(): Promise<void> {
  const board = boards[boardSelected]
  if (!board) return
  currentBoard = board
  page = 'list'
  selected = 0
  topRow = 0
  marqueeOffset = 0
  await bridge.rebuildPageContainer({
    containerTotalNum: 5, textObject: [listScreen, listTitles, listDates, listLikesNormal, listLikesDim],
  } as RebuildPageContainer)
  await loadBoard(board.url)
}

function proxied(url: string): string {
  return `${PROXY}?${encodeURIComponent(url)}`
}

async function getHtml(url: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(proxied(url), { signal: controller.signal })
    if (!response.ok) throw new Error(`PTT request failed: ${response.status}`)
    return response.text()
  } finally {
    clearTimeout(timeout)
  }
}

function parseBoard(html: string, url: string): BoardPage {
  const document = new DOMParser().parseFromString(html, 'text/html')

  // PTT 的 HTML 是舊到新排列；反轉後眼鏡上會是最新文章在最上方。
  const articles = Array.from(document.querySelectorAll('.r-ent'))
    .map((row): Article | null => {
      const link = row.querySelector<HTMLAnchorElement>('.title a')
      const path = link?.getAttribute('href')
      if (!link || !path) return null

      return {
        likes: row.querySelector('.nrec')?.textContent?.trim() || '0',
        title: link.textContent?.trim() || '(無標題)',
        time: row.querySelector('.date')?.textContent?.trim() || '',
        path,
      }
    })
    .filter((article): article is Article => article !== null)
    .reverse()

  const pagingLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.btn-group-paging a'))
  const pageLink = (label: string): string | undefined => {
    const link = pagingLinks.find((item) => item.textContent?.includes(label))
    const href = link?.getAttribute('href')
    return href ? new URL(href, url).toString() : undefined
  }

  return {
    articles,
    olderUrl: pageLink('上頁'),
    newerUrl: pageLink('下頁'),
  }
}

function parseArticle(article: Article, html: string): Article {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const content = document.querySelector<HTMLElement>('#main-content')
  if (!content) throw new Error('找不到文章內容')

  const replies = Array.from(content.querySelectorAll<HTMLElement>('.push')).map((push) => {
    const rawTime = push.querySelector('.push-ipdatetime')?.textContent?.trim() || ''
    const time = rawTime.match(/(\d{2}\/\d{2}\s+\d{2}:\d{2})\s*$/)?.[1] || rawTime
    return {
      mark: push.querySelector('.push-tag')?.textContent?.trim() || '→',
      author: push.querySelector('.push-userid')?.textContent?.trim() || '?',
      time,
      content: (push.querySelector('.push-content')?.textContent || '')
        .replace(/^:\s*/, '')
        .trim(),
    }
  })

  const bodyNode = content.cloneNode(true) as HTMLElement
  bodyNode.querySelectorAll('.article-metaline, .article-metaline-right, .push').forEach((node) => node.remove())
  const body = (bodyNode.textContent || '')
    .replace(/\n\s*--\s*[\s\S]*$/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { ...article, body, replies }
}

function clip(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text
}

function characterColumns(char: string): number {
  return char.codePointAt(0)! > 0xff ? 2 : 1
}
function takeColumns(text: string, maxColumns: number): string {
  let output = ''
  let used = 0
  for (const char of text) {
    const width = characterColumns(char)
    if (used + width > maxColumns) break
    output += char
    used += width
  }
  return output
}
function marquee(text: string, width: number): string {
  if (textColumns(text) <= width) return text
  const loop = Array.from(`${text}     `)
  const start = marqueeOffset % loop.length
  let output = ''
  let used = 0
  for (let index = 0; index < loop.length * 2; index += 1) {
    const char = loop[(start + index) % loop.length]
    const charWidth = characterColumns(char)
    if (used + charWidth > width) break
    output += char
    used += charWidth
  }
  return output
}

function textPages(text: string, maxBytes: number): string[] {
  const encoder = new TextEncoder()
  const pages: string[] = []
  let current = ''
  let currentBytes = 0

  for (const char of text) {
    const bytes = encoder.encode(char).length
    if (current && currentBytes + bytes > maxBytes) {
      pages.push(current)
      current = ''
      currentBytes = 0
    }
    current += char
    currentBytes += bytes
  }
  pages.push(current || '(沒有內容)')
  return pages
}

function articleReadingPages(article: Article): ArticleReadingPage[] {
  const body = article.body || '(沒有可顯示的本文)'
  const imagePattern = /https?:\/\/[^\s<>"']+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s<>"']*)?/gi
  const pages: ArticleReadingPage[] = []
  let cursor = 0

  for (const match of body.matchAll(imagePattern)) {
    const index = match.index ?? 0
    const before = body.slice(cursor, index).trim()
    if (before) {
      for (const content of textPages(before, 700)) pages.push({ kind: 'text', content })
    }
    pages.push({ kind: 'image', url: match[0] })
    cursor = index + match[0].length
  }

  const after = body.slice(cursor).trim()
  if (after) {
    for (const content of textPages(after, 700)) pages.push({ kind: 'text', content })
  }
  return pages.length ? pages : [{ kind: 'text', content: '(沒有可顯示的本文)' }]
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('圖片轉換失敗')), 'image/png')
  })
}

async function imageToEvenPng(url: string): Promise<Uint8Array[]> {
  const cached = imageCache.get(url)
  if (cached) return cached

  let sourceBlob = imageSourceCache.get(url)
  if (!sourceBlob) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    try {
      const response = await fetch(proxied(url), { signal: controller.signal })
      if (!response.ok) throw new Error(`圖片下載失敗：${response.status}`)
      sourceBlob = await response.blob()
      imageSourceCache.set(url, sourceBlob)
    } finally {
      clearTimeout(timeout)
    }
  }
  const sourceUrl = URL.createObjectURL(sourceBlob)

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('這個網址不是可讀取的圖片'))
      element.src = sourceUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = IMAGE_WIDTH
    canvas.height = IMAGE_HEIGHT
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('無法建立圖片畫布')

    context.fillStyle = '#000'
    context.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT)
    const scale = Math.min(IMAGE_WIDTH / image.naturalWidth, IMAGE_HEIGHT / image.naturalHeight)
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const x = Math.floor((IMAGE_WIDTH - width) / 2)
    const y = Math.floor((IMAGE_HEIGHT - height) / 2)
    context.drawImage(image, x, y, width, height)

    const pixels = context.getImageData(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT)
    for (let index = 0; index < pixels.data.length; index += 4) {
      // 保留完整灰階資料，交由 Even SDK 做實機顯示轉換。
      const luminance = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114
      const gray = Math.round(luminance)
      pixels.data[index] = gray
      pixels.data[index + 1] = gray
      pixels.data[index + 2] = gray
      pixels.data[index + 3] = 255
    }
    context.putImageData(pixels, 0, 0)
    const encoded: Uint8Array[] = []
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 2; column += 1) {
        const tile = document.createElement('canvas')
        tile.width = IMAGE_TILE_WIDTH
        tile.height = IMAGE_TILE_HEIGHT
        const tileContext = tile.getContext('2d')
        if (!tileContext) throw new Error('無法切割圖片')
        tileContext.drawImage(
          canvas,
          column * IMAGE_TILE_WIDTH, row * IMAGE_TILE_HEIGHT, IMAGE_TILE_WIDTH, IMAGE_TILE_HEIGHT,
          0, 0, IMAGE_TILE_WIDTH, IMAGE_TILE_HEIGHT,
        )
        encoded.push(new Uint8Array(await (await canvasToBlob(tile)).arrayBuffer()))
      }
    }
    if (imageCache.size >= 8) imageCache.delete(imageCache.keys().next().value!)
    imageCache.set(url, encoded)
    return encoded
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

function textPage(text: string, pageNumber: number, maxBytes: number): { content: string; total: number } {
  const pages = textPages(text, maxBytes)
  const current = Math.max(0, Math.min(pages.length - 1, pageNumber))
  return { content: pages[current], total: pages.length }
}

function displayLikes(value: string): string {
  const raw = value.trim()
  if (raw === '爆') return '爆'
  const count = Number.parseInt(raw, 10)
  if (Number.isFinite(count) && count > 99) return '爆'
  return raw || '0'
}

function listTitle(text: string): string {
  // 依實際欄位寬度截斷：中文全形 2 格、英文半形 1 格。
  return takeColumns(text, TITLE_WIDTH)
}

function renderTitleColumn(): void {
  const titleRows = Array.from({ length: ROWS }, (_, row) => {
    const article = articles[topRow + row]
    if (!article) return ''
    const index = topRow + row
    return index === selected ? marquee(article.title, TITLE_WIDTH) : listTitle(article.title)
  })
  void bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 2,
    containerName: 'titles',
    content: ['Baseball 文章標題', ...titleRows].join('\n'),
  }))
}

function renderList(message?: string): void {
  if (message) {
    void bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: 1, containerName: 'board', content: message,
    }))
    for (const [containerID, containerName] of [[2, 'titles'], [3, 'dates'], [4, 'likes-normal'], [5, 'likes-dim']] as const) {
      void bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID, containerName, content: '' }))
    }
    return
  }

  const rowArticles = Array.from({ length: ROWS }, (_, row) => articles[topRow + row])
  const cursors = rowArticles.map((article, row) => article && topRow + row === selected ? '>' : '')
  const dateRows = rowArticles.map((article) =>
    article ? article.time.trim().slice(-TIME_WIDTH).padStart(TIME_WIDTH) : '',
  )
  const normalLikes = rowArticles.map((article) => {
    const value = article ? displayLikes(article.likes).slice(0, LIKE_WIDTH).padStart(LIKE_WIDTH) : ''
    return value.trimStart().startsWith('-') ? '' : value
  })
  const dimLikes = rowArticles.map((article) => {
    const value = article ? displayLikes(article.likes).slice(0, LIKE_WIDTH).padStart(LIKE_WIDTH) : ''
    return value.trimStart().startsWith('-') ? value : ''
  })

  // 固定為標頭加 9 列；各列的文字已先截斷，避免自動換行。
  void bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 1, containerName: 'board', content: ['', ...cursors].join('\n'),
  }))
  renderTitleColumn()
  void bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 3, containerName: 'dates', content: ['時間', ...dateRows].join('\n'),
  }))
  void bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 4, containerName: 'likes-normal', content: ['推數', ...normalLikes].join('\n'),
  }))
  void bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 5, containerName: 'likes-dim', content: ['', ...dimLikes].join('\n'),
  }))
}

async function loadBoard(url = currentBoard?.url || DEFAULT_BOARDS[0].url, selectAt: 'top' | 'bottom' = 'top'): Promise<void> {
  if (isLoadingPage) return
  isLoadingPage = true

  try {
    renderList(`正在讀取 ${currentBoard?.name || 'PTT'}…`)
    const loaded = parseBoard(await getHtml(url), url)
    if (loaded.articles.length === 0) throw new Error('看板沒有可讀文章')

    // 有些 PTT 首頁在代理回傳時只剩置頂／少數文章；
    // 不足一個眼鏡畫面時，預先接續讀取較舊頁來補滿。
    const combined = [...loaded.articles]
    let nextOlderUrl = loaded.olderUrl
    for (let attempts = 0; combined.length < ROWS && nextOlderUrl && attempts < 3; attempts += 1) {
      const older = parseBoard(await getHtml(nextOlderUrl), nextOlderUrl)
      combined.push(...older.articles)
      nextOlderUrl = older.olderUrl
    }

    articles = combined
    olderPageUrl = nextOlderUrl
    newerPageUrl = loaded.newerUrl
    selected = selectAt === 'bottom' ? articles.length - 1 : 0
    topRow = selectAt === 'bottom' ? Math.max(0, articles.length - ROWS) : 0
    marqueeOffset = 0
    renderList()
  } catch (error) {
    console.error(error)
    renderList('讀取 PTT 失敗\n\n請確認網路與代理服務\n\n按一下重試')
  } finally {
    isLoadingPage = false
  }
}

async function renderArticleLoading(): Promise<void> {
  const loading = new TextContainerProperty({
    xPosition: 8, yPosition: 8, width: 560, height: 272,
    borderWidth: 1, borderColor: 8, paddingLength: 8,
    containerID: 1, containerName: 'loading',
    content: '正在讀取文章…', textColor: 3, isEventCapture: 1,
  })
  const rebuilt = await bridge.rebuildPageContainer({
    containerTotalNum: 1,
    textObject: [loading],
  } as RebuildPageContainer)
  if (!rebuilt) throw new Error('讀取頁配置被 Even 拒絕')
}

async function openArticle(): Promise<void> {
  const article = articles[selected]
  if (!article || isOpeningArticle) return
  isOpeningArticle = true

  try {
    page = 'article'
    await renderArticleLoading()
    const loaded = parseArticle(
      article,
      await getHtml(`https://www.ptt.cc${article.path}`),
    )
    articles[selected] = loaded
    activeArticle = loaded
    articleTextPage = 0
    replyTextPage = 0
    articleView = 'body'
    await renderArticle(loaded)
  } catch (error) {
    console.error(error)
    page = 'list'
    activeArticle = undefined
    const detail = error instanceof Error ? error.message : '未知錯誤'
    await bridge.rebuildPageContainer({
      containerTotalNum: 5,
      textObject: [listScreen, listTitles, listDates, listLikesNormal, listLikesDim],
    } as RebuildPageContainer)
    renderList(`讀取文章失敗\n${clip(detail, 28)}\n\n按一下重試`)
  } finally {
    isOpeningArticle = false
  }
}

function textColumns(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + characterColumns(char), 0)
}

function wrapReplyContent(content: string, maxColumns = 36): string[] {
  const lines: string[] = []
  // 此欄實際可容納約 36 個全／半形欄位（含兩個全形縮排）；不可交給裝置再換行。
  const indent = '　　'
  for (const sourceLine of content.split('\n')) {
    let current = indent
    let used = 4
    for (const char of sourceLine) {
      const width = char.codePointAt(0)! > 0xff ? 2 : 1
      if (used + width > maxColumns && used > 4) {
        lines.push(current)
        current = indent
        used = 4
      }
      current += char
      used += width
    }
    lines.push(current)
  }
  return lines
}

function replyPages(article: Article): ReplyPageLayout[] {
  const pages: ReplyPageLayout[] = []
  let leftLines: string[] = []
  let timeLines: string[] = []
  let bytes = 0
  const encoder = new TextEncoder()

  for (const reply of article.replies || []) {
    const bodyLines = wrapReplyContent(reply.content || '(無內容)')
    const entryLeft = [`${reply.mark}｜${reply.author}`, ...bodyLines]
    const entryTimes = [reply.time.trim().padStart(12), ...bodyLines.map(() => '')]
    const entryBytes = encoder.encode(entryLeft.join('\n')).length

    // 面板可完整顯示 7 行；先判斷整則推文是否放得下，絕不裁掉底部或拆成兩頁。
    if (leftLines.length > 0 && (bytes + entryBytes > 860 || leftLines.length + entryLeft.length > 7)) {
      pages.push({ left: leftLines.join('\n'), times: timeLines.join('\n') })
      leftLines = []
      timeLines = []
      bytes = 0
    }

    leftLines.push(...entryLeft)
    timeLines.push(...entryTimes)
    bytes += entryBytes
  }

  if (leftLines.length > 0) pages.push({ left: leftLines.join('\n'), times: timeLines.join('\n') })
  return pages.length ? pages : [{ left: '(沒有推文)', times: '' }]
}

async function renderArticle(article: Article): Promise<void> {
  const isBody = articleView === 'body'
  const readingPages = articleReadingPages(article)
  const readingPage = readingPages[Math.min(articleTextPage, readingPages.length - 1)]
  const replyLayouts = replyPages(article)
  const replyLayout = replyLayouts[Math.min(replyTextPage, replyLayouts.length - 1)]

  const title = new TextContainerProperty({
    xPosition: 8, yPosition: 6, width: 560, height: 30,
    borderWidth: 0, borderColor: 0, paddingLength: 0,
    containerID: 1, containerName: 'title', content: clip(article.title, 30),
    textColor: 4, isEventCapture: 0,
  })
  const panel = new TextContainerProperty({
    xPosition: 8, yPosition: 40, width: 560, height: 240,
    borderWidth: 1, borderColor: 8, paddingLength: 6,
    containerID: 2, containerName: 'reader',
    content: isBody
      ? readingPage.kind === 'image'
        ? `圖片 · 本文 ${articleTextPage + 1}/${readingPages.length}\n\n讀取中…`
        : `本文 ${articleTextPage + 1}/${readingPages.length}\n${readingPage.content}`
      : `推文 ${replyTextPage + 1}/${replyLayouts.length}`,
    textColor: isBody ? 3 : 2, isEventCapture: 1,
  })

  if (isBody) {
    if (readingPage.kind === 'image') {
      const imageTiles = [
        new ImageContainerProperty({ xPosition: 88, yPosition: 84, width: IMAGE_TILE_WIDTH, height: IMAGE_TILE_HEIGHT, containerID: 3, containerName: 'inline-image-0' }),
        new ImageContainerProperty({ xPosition: 288, yPosition: 84, width: IMAGE_TILE_WIDTH, height: IMAGE_TILE_HEIGHT, containerID: 4, containerName: 'inline-image-1' }),
        new ImageContainerProperty({ xPosition: 88, yPosition: 174, width: IMAGE_TILE_WIDTH, height: IMAGE_TILE_HEIGHT, containerID: 5, containerName: 'inline-image-2' }),
        new ImageContainerProperty({ xPosition: 288, yPosition: 174, width: IMAGE_TILE_WIDTH, height: IMAGE_TILE_HEIGHT, containerID: 6, containerName: 'inline-image-3' }),
      ]
      const rebuilt = await bridge.rebuildPageContainer({
        containerTotalNum: 6, textObject: [title, panel], imageObject: imageTiles,
      } as RebuildPageContainer)
      if (!rebuilt) throw new Error('圖片頁配置被 Even 拒絕')
      try {
        const imageData = await imageToEvenPng(readingPage.url)
        if (page === 'article' && activeArticle === article && articleView === 'body' && articleReadingPages(article)[articleTextPage]?.kind === 'image') {
          for (let index = 0; index < imageData.length; index += 1) {
            await bridge.updateImageRawData(new ImageRawDataUpdate({
              containerID: 3 + index, containerName: `inline-image-${index}`, imageData: imageData[index],
            }))
          }
          await bridge.textContainerUpgrade(new TextContainerUpgrade({
            containerID: 2, containerName: 'reader', content: `圖片 · 本文 ${articleTextPage + 1}/${articleReadingPages(article).length}`,
          }))
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知錯誤'
        await bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 2, containerName: 'reader', content: `圖片無法載入\n${clip(message, 28)}`,
        }))
      }
      return
    }
    const rebuilt = await bridge.rebuildPageContainer({
      containerTotalNum: 2, textObject: [title, panel],
    } as RebuildPageContainer)
    if (!rebuilt) throw new Error('閱讀頁配置被 Even 拒絕')
    return
  }

  // 推文左右兩欄不重疊：左欄是記號／ID／內容，右欄是固定時間欄。
  const replyLeft = new TextContainerProperty({
    xPosition: 16, yPosition: 68, width: 408, height: 204,
    borderWidth: 0, borderColor: 0, paddingLength: 0,
    containerID: 3, containerName: 'reply-left', content: replyLayout.left,
    textColor: 2, isEventCapture: 0,
  })
  const replyTime = new TextContainerProperty({
    xPosition: 438, yPosition: 68, width: 118, height: 204,
    borderWidth: 0, borderColor: 0, paddingLength: 0,
    containerID: 4, containerName: 'reply-time', content: replyLayout.times,
    textColor: 2, isEventCapture: 0,
  })
  const rebuilt = await bridge.rebuildPageContainer({
    containerTotalNum: 4, textObject: [title, panel, replyLeft, replyTime],
  } as RebuildPageContainer)
  if (!rebuilt) throw new Error('閱讀頁配置被 Even 拒絕')
}

async function moveArticlePage(step: number): Promise<void> {
  if (!activeArticle) return
  const last = articleView === 'body'
    ? Math.max(0, articleReadingPages(activeArticle).length - 1)
    : replyPages(activeArticle).length - 1
  const current = articleView === 'body' ? articleTextPage : replyTextPage
  const next = Math.max(0, Math.min(last, current + step))
  if (next === current) return
  if (articleView === 'body') articleTextPage = next
  else replyTextPage = next
  await renderArticle(activeArticle)
}

async function returnToList(): Promise<void> {
  page = 'list'
  activeArticle = undefined
  marqueeOffset = 0
  await bridge.rebuildPageContainer({
    containerTotalNum: 5,
    textObject: [listScreen, listTitles, listDates, listLikesNormal, listLikesDim],
  } as RebuildPageContainer)
  renderList()
}

async function moveCursor(step: number): Promise<void> {
  if (isLoadingPage || articles.length === 0) return

  if (step > 0 && selected === articles.length - 1) {
    // 最新在最上方，因此列表底端的「再往下」就是讀取較舊的上頁。
    if (olderPageUrl) await loadBoard(olderPageUrl, 'top')
    return
  }

  if (step < 0 && selected === 0) {
    // 列表最上端再往上，回到較新的下頁；沒有下頁就代表目前已是最新。
    if (newerPageUrl) await loadBoard(newerPageUrl, 'bottom')
    return
  }

  selected += step
  marqueeOffset = 0
  if (selected < topRow) topRow = selected
  if (selected >= topRow + ROWS) topRow = selected - ROWS + 1
  renderList()
}

function stopHoldScroll(): void {
  if (holdScrollTimer) clearInterval(holdScrollTimer)
  holdScrollTimer = undefined
}

function startHoldScroll(): void {
  if (holdScrollTimer || lastListScrollDirection === 0) return
  if (Date.now() - lastListScrollAt > 3_000) return
  void moveCursor(lastListScrollDirection)
  holdScrollTimer = setInterval(() => void moveCursor(lastListScrollDirection), 180)
}

function handleListScroll(step: -1 | 1): void {
  if (step > 0) {
    if (pendingUpScrollTimer) clearTimeout(pendingUpScrollTimer)
    pendingUpScrollTimer = undefined
    lastListScrollDirection = 1
    lastListScrollAt = Date.now()
    void moveCursor(1)
    return
  }

  // 下滑途中偶發的反向事件延後判定；若後面真的是下滑會被取消。
  if (pendingUpScrollTimer) clearTimeout(pendingUpScrollTimer)
  pendingUpScrollTimer = setTimeout(() => {
    pendingUpScrollTimer = undefined
    lastListScrollDirection = -1
    lastListScrollAt = Date.now()
    void moveCursor(-1)
  }, 220)
}

bridge.onEvenHubEvent((event) => {
  if (page === 'list' && event.sysEvent?.eventType === OsEventTypeList.LONG_PRESS_EVENT) {
    startHoldScroll()
    return
  }
  if (page === 'list' && event.sysEvent?.eventType === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) {
    stopHoldScroll()
    return
  }

  const input = event.textEvent ?? event.listEvent ?? event.sysEvent
  if (!input) return

  if (page === 'home') {
    if (input.eventType === OsEventTypeList.SCROLL_TOP_EVENT && boardSelected > 0) {
      boardSelected -= 1
      renderHome()
    } else if (input.eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT && boardSelected < boards.length - 1) {
      boardSelected += 1
      renderHome()
    } else if (input.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      // 根頁雙擊交給系統顯示離開確認；不在閱讀頁觸發，避免閱讀時誤退。
      void bridge.shutDownPageContainer(1)
    } else if (input.eventType === OsEventTypeList.CLICK_EVENT || input.eventType === undefined) {
      void openSelectedBoard()
    }
    return
  }

  if (page === 'article') {
    if (input.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      void returnToList()
    } else if (
      input.eventType === OsEventTypeList.CLICK_EVENT ||
      input.eventType === undefined
    ) {
      articleView = articleView === 'body' ? 'replies' : 'body'
      if (articleView === 'replies') replyTextPage = 0
      else articleTextPage = 0
      if (activeArticle) void renderArticle(activeArticle)
    } else if (input.eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      void moveArticlePage(-1)
    } else if (input.eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      void moveArticlePage(1)
    }
    return
  }

  switch (input.eventType) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      handleListScroll(-1)
      break
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      handleListScroll(1)
      break
    case OsEventTypeList.CLICK_EVENT:
    case undefined:
      if (articles.length > 0) void openArticle()
      else void loadBoard()
      break
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      void showHome()
      break
    default:
      // 部分韌體將點按回報為未列出的事件類型；在列表上一律視為開啟文章。
      if (articles.length > 0) void openArticle()
      else void loadBoard()
  }
})

setInterval(() => {
  if (page === 'list' && textColumns(articles[selected]?.title || '') > TITLE_WIDTH) {
    marqueeOffset += 1
    renderTitleColumn()
  }
}, 300)
setInterval(() => void syncBoardsFromDevelopmentServer(), 1000)

renderHome()
setupPhoneSettings()

function setupPhoneSettings(): void {
  const root = document.querySelector<HTMLElement>('#settings')
  if (!root) return
  const draw = () => {
    root.replaceChildren()
    const form = document.createElement('form')
    form.className = 'add-board'
    form.innerHTML = '<h2>新增 PTT 看板</h2><input name="name" maxlength="30" required placeholder="顯示名稱，例如：棒球版"><input name="url" required inputmode="url" placeholder="PTT 看板網址，例如 https://www.ptt.cc/bbs/Baseball/index.html"><button>加入看板</button>'
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      const data = new FormData(form)
      const name = String(data.get('name') || '').trim()
      const url = String(data.get('url') || '').trim()
      if (!name || !/^https:\/\/www\.ptt\.cc\/bbs\/[A-Za-z0-9_-]+\//.test(url)) {
        alert('請輸入 PTT 看板網址，例如 https://www.ptt.cc/bbs/Baseball/index.html')
        return
      }
      await saveBoards([...boards, { name, url }])
      boardSelected = boards.length - 1
      if (page === 'home') renderHome()
      draw()
    })
    root.append(form)
    const title = document.createElement('h2')
    title.textContent = '已加入的看板'
    root.append(title)
    const list = document.createElement('div')
    list.className = 'board-settings-list'
    boards.forEach((board, index) => {
      const row = document.createElement('div')
      row.className = 'board-setting-row'
      const info = document.createElement('div')
      const name = document.createElement('strong')
      name.textContent = board.name
      const url = document.createElement('small')
      url.textContent = board.url
      info.append(name, url)
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = '移除'
      remove.addEventListener('click', async () => {
        await saveBoards(boards.filter((_, itemIndex) => itemIndex !== index))
        boardSelected = Math.min(boardSelected, boards.length - 1)
        if (page === 'home') renderHome()
        draw()
      })
      row.append(info, remove)
      list.append(row)
    })
    root.append(list)
  }
  draw()
}
