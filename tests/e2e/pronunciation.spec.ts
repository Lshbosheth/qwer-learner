import { expect, test, type Page, type Route } from '@playwright/test'

// 用一个极小的假音频响应拦截 /mimo-tts，避免 E2E 消耗真实 MiMo 额度
const FAKE_MP3_BASE64 = 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMA=='

async function mockMiMo(route: Route) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      choices: [{ message: { audio: { data: FAKE_MP3_BASE64 } } }],
    }),
  })
}

const pressWord = async (page: Page, word: string) => {
  for (const letter of word.split('')) {
    await page.keyboard.press(letter)
  }
}

const pressWords = async (page: Page, words: string[]) => {
  for (const word of words) {
    await pressWord(page, word)
    await page.waitForTimeout(200)
  }
}

test.describe('Pronunciation (MiMo TTS)', () => {
  test.beforeEach(async ({ page }) => {
    test.slow()
    await page.route('/mimo-tts/**', mockMiMo)
    await page.goto('/')
    await page.getByLabel('关闭提示').click()
  })

  test('AI 每日词表可以进入练习', async ({ page }) => {
    // 打开词典切换，进入 Gallery
    await page.getByText('CET-4').click()
    await page.waitForURL('**/gallery')

    // 切换到 “AI 每日” 语言 Tab
    await page.getByRole('radio', { name: /^AI 每日$/ }).click()

    // 选择最新一天的 AI 每日词表（名称形如 “AI 每日词汇 · 2026-07-23”）
    const aiDict = page.getByRole('button', { name: /AI 每日词汇/ }).first()
    await expect(aiDict).toBeVisible()
    await aiDict.click()

    await page.waitForURL((url) => url.pathname === '/')

    // 进入练习：按任意键开始，首词字母应可见
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    await expect(page.locator('span').first()).toBeVisible()
  })

  test('重复本章节后首词只请求一次 MiMo', async ({ page }) => {
    const requestedWords: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/mimo-tts')) {
        const body = req.postData()
        if (body) {
          try {
            const json = JSON.parse(body)
            const text = json?.messages?.find((m: any) => m.role === 'assistant')?.content
            if (typeof text === 'string') requestedWords.push(text)
          } catch {
            /* ignore */
          }
        }
      }
    })

    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)

    const chapter1 = [
      'cancel',
      'explosive',
      'numerous',
      'govern',
      'analyse',
      'discourage',
      'resemble',
      'remote',
      'salary',
      'pollution',
      'pretend',
      'kettle',
      'wreck',
      'drunk',
      'calculate',
      'persistent',
      'sake',
      'conceal',
      'audience',
      'meanwhile',
    ]

    await pressWords(page, chapter1)

    // 结算页出现后点击 “重复本章节”
    await expect(page.getByText('表现不错！全对了！').or(page.getByText('100%'))).toBeVisible()
    await page.getByRole('button', { name: '重复本章节' }).click()

    // 重复后第一词再次自动朗读；cache 命中，不应再发起新的 MiMo 请求
    await page.waitForTimeout(500)

    const cancelRequests = requestedWords.filter((w) => w === 'cancel')
    expect(cancelRequests.length).toBe(1)
  })
})
