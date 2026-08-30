import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'

type Article = {
  likes: string
  title: string
  time: string
}

// Baseball board snapshot. Live PTTWeb loading will replace this source next.
const articles: Article[] = [
  { likes: '9', title: '[新聞] 永田颯太郎用台語「兄弟」相稱 李超投打對決首球就嚇到', time: '27m' },
  { likes: '29', title: '[LIVE] CPBL例行賽#299 富邦 VS 中信兄弟 @洲際', time: '37m' },
  { likes: '33', title: '[新聞] 守備遇球僮妨礙 道威聖籲別責怪：我知道這有多難', time: '54m' },
  { likes: '7', title: '[新聞] 艾速特、黃子鵬連兩天壓制味全 葉君璋拿山本由伸比喻', time: '1h' },
  { likes: '34', title: '[新聞] OCC-陳晨威赴亞運正值爭冠關鍵期 曾豪駒', time: '1h' },
  { likes: '11', title: '[新聞] 中職》張肇元首度投入二軍實戰 本季強勢復出有譜？', time: '1h' },
  { likes: '398', title: '[LIVE] CPBL例行賽#300 統一 VS 樂天 @大巨蛋', time: '1h' },
  { likes: '455', title: '[LIVE] CPBL例行賽#298 台鋼 VS 味全 @天母', time: '1h' },
  { likes: '30', title: '[LIVE] CPBL二軍 #225 台鋼 vs 富邦 @嘉義市', time: '1h' },
  { likes: '98', title: 'Re: [新聞] 高虹安市府稱挖出大祕寶 不起訴書揭竟是「這1物」', time: '1h' },
  { likes: '76', title: '[新聞] 遭台鋼取消演出 陳曉東首發聲「存好心說好話」', time: '1h' },
  { likes: '216', title: '[LIVE] NPB 樂天vs西武 林安可先發／栗山巧引退', time: '2h' },
]

const ROWS = 6
const TITLE_WIDTH = 25
let selected = 0
let topRow = 0
let marqueeOffset = 0

const bridge = await waitForEvenAppBridge()

const screen = new TextContainerProperty({
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
    textObject: [screen],
  }),
)

if (started !== 0) {
  console.error('Unable to create PTT board page:', started)
}

function clip(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text
}

function marquee(text: string, width: number): string {
  if (text.length <= width) return text
  const loop = `${text}     `
  const doubled = loop + loop
  return doubled.slice(marqueeOffset % loop.length, (marqueeOffset % loop.length) + width)
}

function renderRow(article: Article, index: number): string {
  const active = index === selected
  const cursor = active ? '>' : ' '
  const title = active
    ? marquee(article.title, TITLE_WIDTH)
    : clip(article.title, TITLE_WIDTH)

  return `${cursor}${article.likes.padStart(3)} ${title.padEnd(TITLE_WIDTH)} ${article.time.padStart(3)}`
}

function render(): void {
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
        '上/下滑選文章 · 雙擊離開',
      ].join('\\n'),
    }),
  )
}

function moveCursor(step: number): void {
  const next = Math.max(0, Math.min(articles.length - 1, selected + step))
  if (next === selected) return

  selected = next
  marqueeOffset = 0

  if (selected < topRow) topRow = selected
  if (selected >= topRow + ROWS) topRow = selected - ROWS + 1
  render()
}

bridge.onEvenHubEvent((event) => {
  const textEvent = event.textEvent
  if (!textEvent || textEvent.containerID !== 1) return

  switch (textEvent.eventType) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      moveCursor(-1)
      break
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      moveCursor(1)
      break
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      bridge.shutDownPageContainer(1)
      break
  }
})

setInterval(() => {
  const title = articles[selected].title
  if (title.length > TITLE_WIDTH) {
    marqueeOffset += 1
    render()
  }
}, 300)

render()
