import {
  CreateStartUpPageContainer,
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

const PROXY = 'https://cloudflare-cors-anywhere.yuyimimi.workers.dev/'
const DEFAULT_BOARDS: Board[] = [{ name: '棒球版', url: 'https://www.ptt.cc/bbs/Baseball/index.html' }]
const BOARD_STORE = 'even-ptt-reader-boards-v1'
const ROWS = 6
const LIKE_WIDTH = 3
// 以中文最寬字形計算，避免任何一列自動換行。
const TITLE_WIDTH = 22
const TIME_WIDTH = 5

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
function saveBoards(next: Board[]): void {
  boards = next.length ? next : [...DEFAULT_BOARDS]
  try { localStorage.setItem(BOARD_STORE, JSON.stringify(boards)) } catch { /* 本次仍可用 */ }
}

const bridge = await waitForEvenAppBridge()

const listScreen = new TextContainerProperty({
  xPosition: 8, yPosition: 8, width: 560, height: 272,
  borderWidth: 0, borderColor: 0, paddingLength: 0,
  containerID: 1, containerName: 'board', content: '讀取中…',
  isEventCapture: 1,
})
const listTitles = new TextContainerProperty({
  xPosition: 86, yPosition: 8, width: 420, height: 272,
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

  const replies = Array.from(content.querySelectorAll<HTMLElement>('.push')).map((push) => ({
    mark: push.querySelector('.push-tag')?.textContent?.trim() || '→',
    author: push.querySelector('.push-userid')?.textContent?.trim() || '?',
    time: push.querySelector('.push-ipdatetime')?.textContent?.trim() || '',
    content: (push.querySelector('.push-content')?.textContent || '')
      .replace(/^:\s*/, '')
      .trim(),
  }))

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

function marquee(text: string, width: number): string {
  if (text.length <= width) return text
  const loop = `${text}     `
  const doubled = loop + loop
  const start = marqueeOffset % loop.length
  return doubled.slice(start, start + width)
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
  // 列表不顯示省略號，以固定字數直接截斷，保留單行排版。
  return text.slice(0, TITLE_WIDTH)
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

  // 所有欄位各 7 行（標頭＋6 列），不再讓捕捉框產生可見捲動條。
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

    articles = loaded.articles
    olderPageUrl = loaded.olderUrl
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
  return Array.from(text).reduce((sum, char) => sum + (char.codePointAt(0)! > 0xff ? 2 : 1), 0)
}

function wrapReplyContent(content: string, maxColumns = 34): string[] {
  const lines: string[] = []
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

    // 每頁只放完整貼文；很長的單則推文仍單獨放一頁，不與下一則混合。
    if (leftLines.length > 0 && (bytes + entryBytes > 590 || leftLines.length + entryLeft.length > 6)) {
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
  const bodyPage = textPage(article.body || '(沒有可顯示的本文)', articleTextPage, 700)
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
      ? `本文 ${articleTextPage + 1}/${bodyPage.total}\n${bodyPage.content}`
      : `推文 ${replyTextPage + 1}/${replyLayouts.length}`,
    textColor: isBody ? 3 : 2, isEventCapture: 1,
  })

  if (isBody) {
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
    ? Math.max(0, textPages(activeArticle.body || '', 700).length - 1)
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
  if (page === 'list' && articles[selected]?.title.length > TITLE_WIDTH) {
    marqueeOffset += 1
    renderTitleColumn()
  }
}, 300)

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
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const data = new FormData(form)
      const name = String(data.get('name') || '').trim()
      const url = String(data.get('url') || '').trim()
      if (!name || !/^https:\/\/www\.ptt\.cc\/bbs\/[A-Za-z0-9_-]+\//.test(url)) {
        alert('請輸入 PTT 看板網址，例如 https://www.ptt.cc/bbs/Baseball/index.html')
        return
      }
      saveBoards([...boards, { name, url }])
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
      remove.addEventListener('click', () => {
        saveBoards(boards.filter((_, itemIndex) => itemIndex !== index))
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
