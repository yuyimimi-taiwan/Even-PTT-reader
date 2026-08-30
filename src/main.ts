import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { RebuildPageContainer } from '@evenrealities/even_hub_sdk'

type Reply = { mark: string; author: string; time: string }
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
const TITLE_WIDTH = 25
const TIME_WIDTH = 5

let articles: Article[] = []
let selected = 0
let topRow = 0
let marqueeOffset = 0
let page: 'list' | 'article' = 'list'
let activeArticle: Article | undefined
let articleTextPage = 0
let replyTextPage = 0
let olderPageUrl: string | undefined
let newerPageUrl: string | undefined
let isLoadingPage = false

const bridge = await waitForEvenAppBridge()

const listScreen = new TextContainerProperty({
  xPosition: 8, yPosition: 8, width: 560, height: 272,
  borderWidth: 0, borderColor: 0, paddingLength: 0,
  containerID: 1, containerName: 'board', content: '正在讀取 Baseball…',
  isEventCapture: 1,
})

const started = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [listScreen] }),
)
if (started !== 0) console.error('Unable to create PTT board page:', started)

function proxied(url: string): string {
  return `${PROXY}?${encodeURIComponent(url)}`
}

async function getHtml(url: string): Promise<string> {
  const response = await fetch(proxied(url))
  if (!response.ok) throw new Error(`PTT request failed: ${response.status}`)
  return response.text()
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

function textPage(text: string, pageNumber: number, size: number): { content: string; total: number } {
  const total = Math.max(1, Math.ceil(text.length / size))
  const current = Math.max(0, Math.min(total - 1, pageNumber))
  return {
    content: text.slice(current * size, (current + 1) * size) || '(沒有內容)',
    total,
  }
}

function displayLikes(value: string): string {
  const raw = value.trim()
  if (raw === '爆') return '爆'
  const count = Number.parseInt(raw, 10)
  if (Number.isFinite(count) && count > 99) return '爆'
  return raw || '0'
}

function renderRow(article: Article, index: number): string {
  const active = index === selected
  const title = active ? marquee(article.title, TITLE_WIDTH) : clip(article.title, TITLE_WIDTH)
  const likes = displayLikes(article.likes).slice(0, LIKE_WIDTH).padStart(LIKE_WIDTH)
  const time = article.time.trim().slice(-TIME_WIDTH).padStart(TIME_WIDTH)
  // 固定每欄的空間：最左游標、三格推文數，日期永遠貼齊最右。
  return `${active ? '>' : ' '} ${likes} ${title.padEnd(TITLE_WIDTH)} ${time}`
}

function renderList(message?: string): void {
  if (message) {
    void bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: 1, containerName: 'board', content: message,
    }))
    return
  }

  const rows = Array.from({ length: ROWS }, (_, row) => {
    const article = articles[topRow + row]
    return article ? renderRow(article, topRow + row) : ''
  })

  void bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 1,
    containerName: 'board',
    content: [
      `Baseball ${newerPageUrl ? '' : '最新 '} ${selected + 1}/${articles.length}`,      '   推數  文章標題                     時間',
      ...rows,
      '',
      '上/下滑選文章 · 按一下閱讀 · 雙擊離開',
    ].join('\n'),
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

async function openArticle(): Promise<void> {
  const article = articles[selected]
  if (!article) return

  try {
    renderList('正在開啟文章…')
    const loaded = parseArticle(
      article,
      await getHtml(`https://www.ptt.cc${article.path}`),
    )
    articles[selected] = loaded
    activeArticle = loaded
    articleTextPage = 0
    replyTextPage = 0
    page = 'article'
    const result = await renderArticle(loaded)
    if (result !== 0) throw new Error(`閱讀頁顯示失敗：${result}`)
  } catch (error) {
    console.error(error)
    page = 'list'
    activeArticle = undefined
    const detail = error instanceof Error ? error.message : '未知錯誤'
    renderList(`讀取文章失敗\n${clip(detail, 28)}\n\n按一下重試`)
  }
}

async function renderArticle(article: Article): Promise<number> {
  // Even 的單一文字框有長度限制；把本文與推文分頁，避免長文令閱讀頁無法開啟。
  const bodyPage = textPage(article.body || '(沒有可顯示的本文)', articleTextPage, 650)
  const replySource = (article.replies || [])
    .map((reply) => `${reply.mark}｜${reply.author}｜${reply.time}`)
    .join('\n') || '(沒有推文)'
  const repliesPage = textPage(replySource, replyTextPage, 520)

  const title = new TextContainerProperty({
    xPosition: 8, yPosition: 6, width: 560, height: 30,
    borderWidth: 0, borderColor: 0, paddingLength: 0,
    containerID: 2, containerName: 'title', content: clip(article.title, 38),
    textColor: 4, isEventCapture: 0,
  })

  const body = new TextContainerProperty({
    xPosition: 8, yPosition: 40, width: 560, height: 124,
    borderWidth: 1, borderColor: 8, paddingLength: 6,
    containerID: 3, containerName: 'article',
    content: `本文 ${articleTextPage + 1}/${bodyPage.total}\n${bodyPage.content}`,
    textColor: 3, isEventCapture: 1,
  })

  const replies = new TextContainerProperty({
    xPosition: 8, yPosition: 172, width: 560, height: 108,
    borderWidth: 1, borderColor: 8, paddingLength: 6,
    containerID: 4, containerName: 'replies',
    content: `推文 ${replyTextPage + 1}/${repliesPage.total}\n${repliesPage.content}`,
    textColor: 2, isEventCapture: 0,
  })

  return bridge.rebuildPageContainer({
    containerTotalNum: 3,
    textObject: [title, body, replies],
  } as RebuildPageContainer)
}

async function moveArticlePage(step: number): Promise<void> {
  if (!activeArticle) return
  const bodyLength = (activeArticle.body || '').length
  const replyLength = (activeArticle.replies || [])
    .map((reply) => `${reply.mark}｜${reply.author}｜${reply.time}`)
    .join('\n').length
  const nextBody = Math.max(0, Math.min(Math.max(0, Math.ceil(bodyLength / 650) - 1), articleTextPage + step))
  const nextReplies = Math.max(0, Math.min(Math.max(0, Math.ceil(replyLength / 520) - 1), replyTextPage + step))
  if (nextBody === articleTextPage && nextReplies === replyTextPage) return
  articleTextPage = nextBody
  replyTextPage = nextReplies
  await renderArticle(activeArticle)
}

async function returnToList(): Promise<void> {
  page = 'list'
  activeArticle = undefined
  marqueeOffset = 0
  await bridge.rebuildPageContainer({
    containerTotalNum: 1,
    textObject: [listScreen],
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

bridge.onEvenHubEvent((event) => {
  const input = event.textEvent
  if (!input) return

  if (page === 'article') {
    if (input.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      void returnToList()
    } else if (input.eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      void moveArticlePage(-1)
    } else if (input.eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      void moveArticlePage(1)
    }
    return
  }

  switch (input.eventType) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      void moveCursor(-1)
      break
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      void moveCursor(1)
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
    renderList()
  }
}, 300)

void loadBoard()
