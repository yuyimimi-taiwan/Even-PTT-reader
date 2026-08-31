import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { RebuildPageContainer } from '@evenrealities/even_hub_sdk'

type Reply = { mark: string; author: string; time: string; content: string }
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

const PROXY = 'https://cloudflare-cors-anywhere.yuyimimi.workers.dev/'
const BOARD_URL = 'https://www.ptt.cc/bbs/Baseball/index.html'
const ROWS = 6
const LIKE_WIDTH = 3
// 以中文最寬字形計算，避免任何一列自動換行。
const TITLE_WIDTH = 20
const TIME_WIDTH = 5

let articles: Article[] = []
let selected = 0
let topRow = 0
let marqueeOffset = 0
let page: 'list' | 'article' = 'list'
let activeArticle: Article | undefined
let articleTextPage = 0
let replyTextPage = 0
let articleView: 'body' | 'replies' = 'body'
let olderPageUrl: string | undefined
let newerPageUrl: string | undefined
let isLoadingPage = false
let isOpeningArticle = false
let pendingScroll: -1 | 1 | undefined
let scrollTimer: ReturnType<typeof setTimeout> | undefined

const bridge = await waitForEvenAppBridge()

const listScreen = new TextContainerProperty({
  xPosition: 8, yPosition: 8, width: 560, height: 272,
  borderWidth: 0, borderColor: 0, paddingLength: 0,
  containerID: 1, containerName: 'board', content: '讀取中…',
  isEventCapture: 1,
})
const listTitles = new TextContainerProperty({
  xPosition: 90, yPosition: 8, width: 412, height: 272,
  borderWidth: 0, borderColor: 0, paddingLength: 0,
  containerID: 2, containerName: 'titles', content: '',
  isEventCapture: 0,
})
const listDates = new TextContainerProperty({
  xPosition: 512, yPosition: 8, width: 56, height: 272,
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

const started = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 5,
    textObject: [listScreen, listTitles, listDates, listLikesNormal, listLikesDim],
  }),
)
if (started !== 0) console.error('Unable to create PTT board page:', started)

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

async function loadBoard(url = BOARD_URL, selectAt: 'top' | 'bottom' = 'top'): Promise<void> {
  if (isLoadingPage) return
  isLoadingPage = true

  try {
    renderList('正在讀取 PTT Baseball…')
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

function replyText(article: Article): string {
  const text = (article.replies || [])
    .map((reply) => [
      `${reply.mark}｜${reply.author}｜${reply.time}`,
      reply.content,
    ].filter(Boolean).join('\n'))
    .join('\n\n')
  return text || '(沒有推文)'
}

async function renderArticle(article: Article): Promise<void> {
  const isBody = articleView === 'body'
  const source = isBody ? (article.body || '(沒有可顯示的本文)') : replyText(article)
  const pageNumber = isBody ? articleTextPage : replyTextPage
  const contentPage = textPage(source, pageNumber, 700)

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
    content: `${isBody ? '本文' : '推文'} ${pageNumber + 1}/${contentPage.total}\n${contentPage.content}`,
    textColor: isBody ? 3 : 2, isEventCapture: 1,
  })
  const rebuilt = await bridge.rebuildPageContainer({
    containerTotalNum: 2,
    textObject: [title, panel],
  } as RebuildPageContainer)
  if (!rebuilt) throw new Error('閱讀頁配置被 Even 拒絕')
}

async function moveArticlePage(step: number): Promise<void> {
  if (!activeArticle) return
  const source = articleView === 'body'
    ? (activeArticle.body || '')
    : replyText(activeArticle)
  const last = Math.max(0, textPages(source, 700).length - 1)
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

function queueCursorMove(step: -1 | 1): void {
  pendingScroll = step
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    const finalStep = pendingScroll
    pendingScroll = undefined
    if (finalStep) void moveCursor(finalStep)
  }, 280)
}

bridge.onEvenHubEvent((event) => {
  const input = event.textEvent ?? event.listEvent ?? event.sysEvent
  if (!input) return

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
      queueCursorMove(-1)
      break
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      queueCursorMove(1)
      break
    case OsEventTypeList.CLICK_EVENT:
    case undefined:
      if (articles.length > 0) void openArticle()
      else void loadBoard()
      break
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      void bridge.shutDownPageContainer(1)
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

void loadBoard()
