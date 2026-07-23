import { expect, test, type Page, type Route } from '@playwright/test'

// 用一个极小的假音频响应拦截 /mimo-tts，避免 E2E 消耗真实 MiMo 额度
const FAKE_MP3_BASE64 = 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMA=='
const SILENT_WAV_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='

async function mockMiMo(route: Route) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      choices: [{ message: { audio: { data: FAKE_MP3_BASE64 } } }],
    }),
  })
}

test.describe('Pronunciation source priority', () => {
  test.beforeEach(async ({ page }) => {
    test.slow()
    await page.route('/mimo-tts/**', mockMiMo)
    await page.route('https://dict.youdao.com/dictvoice?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        body: Buffer.from(SILENT_WAV_BASE64, 'base64'),
      })
    })
    await page.goto('/')
    const closeTip = page.getByLabel('关闭提示')
    if (await closeTip.isVisible()) await closeTip.click()
  })

  test('有道成功时不请求 MiMo', async ({ page }) => {
    let mimoRequestCount = 0
    const youdaoRequests: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/mimo-tts')) mimoRequestCount += 1
      if (req.url().startsWith('https://dict.youdao.com/dictvoice?')) youdaoRequests.push(req.url())
    })

    await page.getByRole('button', { name: '播放发音' }).dispatchEvent('click')
    await expect.poll(() => youdaoRequests.some((url) => url.includes('audio=cancel'))).toBe(true)
    await page.waitForTimeout(300)
    expect(mimoRequestCount).toBe(0)
  })

  test('有道失败后才请求 MiMo', async ({ page }) => {
    await page.unroute('https://dict.youdao.com/dictvoice?**')
    await page.route('https://dict.youdao.com/dictvoice?**', (route) => route.abort('failed'))

    let mimoRequestCount = 0
    page.on('request', (request) => {
      if (request.url().includes('/mimo-tts')) mimoRequestCount += 1
    })

    await page.getByRole('button', { name: '播放发音' }).dispatchEvent('click')
    await expect.poll(() => mimoRequestCount).toBe(1)
  })
})
