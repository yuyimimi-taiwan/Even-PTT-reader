import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'

const bridge = await waitForEvenAppBridge()

const reader = new TextContainerProperty({
  xPosition: 12,
  yPosition: 12,
  width: 552,
  height: 264,
  borderWidth: 0,
  borderColor: 0,
  paddingLength: 0,
  containerID: 1,
  containerName: 'reader',
  content: 'Even PTT Reader\n\n開發環境已就緒\n\n點一下開始',
  isEventCapture: 1,
})

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [reader],
  }),
)

if (result !== 0) {
  console.error('Unable to create reader page:', result)
}

bridge.onEvenHubEvent((event) => {
  const textEvent = event.textEvent
  if (!textEvent || textEvent.containerID !== 1) return

  if (
    textEvent.eventType === OsEventTypeList.CLICK_EVENT ||
    textEvent.eventType === undefined
  ) {
    bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 1,
        containerName: 'reader',
        content: 'Even PTT Reader\n\n下一步：設計文章列表\n\n雙擊可離開',
      }),
    )
  }

  if (textEvent.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    bridge.shutDownPageContainer(1)
  }
})
