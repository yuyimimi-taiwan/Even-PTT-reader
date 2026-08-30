import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'

type Reply = {
  mark: '推' | '噓' | '→'
  author: string
  time: string
}

type Article = {
  likes: string
  title: string
  time: string
  body: string
  replies: Reply[]
}

const replies: Reply[] = [
  { mark: '→', author: 'charlie01', time: '08/30 16:53' },
  { mark: '推', author: 'WongTakashi', time: '08/30 16:53' },
  { mark: '→', author: 'ash9911911', time: '08/30 16:54' },
  { mark: '→', author: 'terryiory', time: '08/30 16:55' },
  { mark: '推', author: 'littleMad', time: '08/30 16:56' },
  { mark: '推', author: 'hunng5', time: '08/30 17:00' },
]

const articleBody =
  '永田颯太郎與李超在台體大時期建立好交情，\n' +
  '兩人以台語「兄弟」相稱。\n\n' +
  '28日首度在中職一軍投打對決，李超表示\n' +
  '第一球就感到意外，但很享受與好友對決。\n\n' +
  '他也期待永田能適應職棒舞台的不同風格。'

const articles: Article[] = [
  { likes: '9', title: '[新聞] 永田颯太郎用台語「兄弟」相稱 李超投打對決首球就嚇到', time: '27m', body: articleBody, replies },
  { likes: '29', title: '[LIVE] CPBL例行賽#299 富邦 VS 中信兄弟 @洲際', time: '37m', body: '比賽進行中。\n\n此頁為閱讀器原型；後續會接上 PTTWeb\n資料，顯示完整文章與即時推文。', replies },
  { likes: '33', title: '[新聞] 守備遇球僮妨礙 道威聖籲別責怪：我知道這有多難', time: '54m', body: '新聞內容載入區。\n\n目前先完成文章頁的閱讀框與推文框\n版面、返回操作與清單導航。', replies },
  { likes: '7', title: '[新聞] 艾速特、黃子鵬連兩天壓制味全 葉君璋拿山本由伸比喻', time: '1h', body: '文章內容將由 PTTWeb 載入。', replies },
  { likes: '34', title: '[新聞] OCC-陳晨威赴亞運正值爭冠關鍵期 曾豪駒', time: '1h', body: '文章內容將由 PTTWeb 載入。', replies },
  { likes: '11', title: '[新聞] 中職》張肇元首度投入二軍實戰 本季強勢復出有譜？', time: '1h', body: '文章內容將由 PTTWeb 載入。', replies },
  { likes: '398', title: '[LIVE] CPBL例行賽#300 統一 VS 樂天 @大巨蛋', time: '1h', body: '文章內容將由 PTTWeb 載入。', replies },
  { likes: '455', title: '[LIVE] CPBL例行賽#298 台鋼 VS 味全 @天母', time: '1h', body: '文章內容將由 PTTWeb 載入。', replies },
  { likes: '30', title: '[LIVE] CPBL二軍 #225 台鋼 vs 富邦 @嘉義市', time: '1h', body: '文章內容將由 PTTWeb 載入。', replies },
  { likes: '98', title: 'Re: [新聞] 高虹安市府稱挖出大祕寶 不起訴書揭竟是「這1物」', time: '1h', body: '文章內容將由 PTTWeb 載入。', replies },
  { likes: '76', title: '[新聞] 遭台鋼取消演出 陳曉東首發聲「存好心說好話」', time: '1h', body: '文章內容將由 PTTWeb 載入。', replies },
  { likes: '216', title: '[LIVE] NPB 樂天vs西武 林安可先發／栗山巧引退', time: '2h', body: '文章內容將由 PTTWeb 載入。', replies },
]

const ROWS = 6
const TITLE_WIDTH = 25
let selected = 0
let topRow = 0
let marqueeOffset = 0
let page: 'list' | 'article' = 'list'

const bridge = await waitForEvenAppBridge()

function textBox(options: ConstructorParameters<typeof TextContainerProperty>[0]) {
  return new TextContainerProperty(options)
}

const listScreen = textBox({
  xPosition: 8,
  yPosition: 8,
  width: 560,
  height: 272,
  borderWidth: 0,
  borderColor: 0,
  paddingLength: 0,
  containerID: 1,
  containerName: 'board',
  content: '',
  isEventCapture: 1,
})

const started = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [listScreen],
  }),
)

if (started !== 0) console.error('Unable to create PTT board page:', started)

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

function renderRow(article: Article, index: number): string {
  const active = index === selected
  const cursor = active ? '>' : ' '
  const title = active ? marquee(article.title, TITLE_WIDTH) : clip(article.title, TITLE_WIDTH)
  return `${cursor}${article.likes.padStart(3)} ${title.padEnd(TITLE_WIDTH)} ${article.time.padStart(3)}`
}

function renderList(): void {
  const rows: string[] = []
  for (let row = 0; row < ROWS; row += 1) {
    const index = topRow + row
    if (index >= articles.length) break
    rows.push(renderRow(articles[index], index))
  }

  bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 1,
      containerName: 'board',
      content: [
        `Baseball 熱門  ${selected + 1}/${articles.length}`,
        '    推  文章標題                      時間',
        ...rows,
        '',
        '上/下滑選文章 · 按一下閱讀 · 雙擊離開',
      ].join('\\n'),
    }),
  )
}

async function openArticle(): Promise<void> {
  page = 'article'
  const article = articles[selected]

  const title = textBox({
    xPosition: 8,
    yPosition: 6,
    width: 560,
    height: 30,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: 2,
    containerName: 'title',
    content: clip(article.title, 38),
    textColor: 4,
    isEventCapture: 0,
  })

  const body = textBox({
    xPosition: 8,
    yPosition: 40,
    width: 560,
    height: 124,
    borderWidth: 1,
    borderColor: 8,
    paddingLength: 6,
    containerID: 3,
    containerName: 'article',
    content: article.body,
    textColor: 3,
    isEventCapture: 1,
  })

  const commentRows = article.replies
    .map((reply) => `${reply.mark}｜${reply.author}｜${reply.time}`)
    .join('\\n')

  const comments = textBox({
    xPosition: 8,
    yPosition: 172,
    width: 560,
    height: 108,
    borderWidth: 1,
    borderColor: 8,
    paddingLength: 6,
    containerID: 4,
    containerName: 'replies',
    content: commentRows,
    textColor: 2,
    isEventCapture: 0,
  })

  await bridge.rebuildPageContainer(
    {
      containerTotalNum: 3,
      textObject: [title, body, comments],
    } as RebuildPageContainer,
  )
}

async function returnToList(): Promise<void> {
  page = 'list'
  marqueeOffset = 0
  await bridge.rebuildPageContainer(
    {
      containerTotalNum: 1,
      textObject: [listScreen],
    } as RebuildPageContainer,
  )
  renderList()
}

function moveCursor(step: number): void {
  const next = Math.max(0, Math.min(articles.length - 1, selected + step))
  if (next === selected) return

  selected = next
  marqueeOffset = 0
  if (selected < topRow) topRow = selected
  if (selected >= topRow + ROWS) topRow = selected - ROWS + 1
  renderList()
}

bridge.onEvenHubEvent((event) => {
  const textEvent = event.textEvent
  if (!textEvent) return

  if (page === 'article') {
    if (textEvent.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      void returnToList()
    }
    return
  }

  switch (textEvent.eventType) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      moveCursor(-1)
      break
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      moveCursor(1)
      break
    case OsEventTypeList.CLICK_EVENT:
    case undefined:
      void openArticle()
      break
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      void bridge.shutDownPageContainer(1)
      break
  }
})

setInterval(() => {
  if (page === 'list' && articles[selected].title.length > TITLE_WIDTH) {
    marqueeOffset += 1
    renderList()
  }
}, 300)

renderList()
