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
