import { test, expect } from '@playwright/test'

test.describe('Dictionary manage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    const closeTip = page.getByLabel('关闭提示')
    if (await closeTip.isVisible()) await closeTip.click()
  })

  test('Homepage default dictionary', async ({ page }) => {
    await expect(await page.getByText('CET-4').isVisible()).toBeTruthy()

    await page.getByText('CET-4').hover()
    await expect(await page.getByText('词典切换').isVisible()).toBeTruthy()
  })

  test('Switch language', async ({ page }) => {
    await page.getByText('CET-4').click()
    await page.waitForURL('**/gallery')

    await expect(await page.getByRole('radio', { name: /^英语$/ }).getAttribute('aria-checked')).toBeTruthy()

    await page.getByRole('radio', { name: /^日语$/ }).click()
    await expect(await page.getByRole('radio', { name: /^日语$/ }).getAttribute('aria-checked')).toBeTruthy()
    await expect(
      await page
        .getByRole('button', { name: /日语常见词/g })
        .first()
        .isVisible(),
    ).toBeTruthy()

    await page.getByRole('radio', { name: /^Code$/ }).click()
    await expect(await page.getByRole('radio', { name: /^Code$/ }).getAttribute('aria-checked')).toBeTruthy()
    await expect(
      await page
        .getByRole('button', { name: /Coder Dict/g })
        .first()
        .isVisible(),
    ).toBeTruthy()
  })

  test('AI 每日词汇按日期显示为章节', async ({ page }) => {
    await page.getByText('CET-4').click()
    await page.waitForURL('**/gallery')

    await page.getByRole('radio', { name: /AI$/ }).click()
    await expect(page.getByRole('radio', { name: /^每日词汇$/ })).toHaveAttribute('aria-checked', 'true')

    await page.getByRole('button', { name: /每日词汇/ }).click()
    const dateHeadings = page.getByRole('heading', { name: /^\d{4}-\d{2}-\d{2}$/ })
    await expect(dateHeadings.first()).toBeVisible()
    expect(await dateHeadings.count()).toBeGreaterThan(1)

    const latestDate = await dateHeadings.last().textContent()
    await dateHeadings.last().click()
    await page.waitForURL((url) => url.pathname === '/')

    await expect(page.getByRole('button', { name: latestDate ?? '' })).toBeVisible()
    await expect(page.getByText('第 1 章')).toHaveCount(0)
  })

  test('Switch category', async ({ page }) => {
    await page.getByText('CET-4').click()
    await page.waitForURL('**/gallery')

    await expect(await page.getByRole('radio', { name: /^大学英语$/ }).getAttribute('aria-checked')).toBeTruthy()

    await page.getByRole('radio', { name: /^考研$/ }).click()
    await expect(await page.getByRole('radio', { name: /^考研$/ }).getAttribute('aria-checked')).toBeTruthy()
    await expect(await page.getByRole('button', { name: /考研/g }).first().isVisible()).toBeTruthy()

    await page.getByRole('radio', { name: /^GRE$/ }).click()
    await expect(await page.getByRole('radio', { name: /^GRE$/ }).getAttribute('aria-checked')).toBeTruthy()
    await expect(await page.getByRole('button', { name: /GRE/g }).first().isVisible()).toBeTruthy()
  })

  test('Switch dictionary', async ({ page }) => {
    await page.getByText('CET-4').click()
    await page.waitForURL('**/gallery')

    await page
      .getByRole('button', { name: /六级巧记速记/g })
      .first()
      .click()
    await page.getByRole('heading', { name: '第 2 章' }).click()

    await page.waitForURL('**/')
    await expect(await page.getByRole('button', { name: '第 2 章' }).first().isVisible()).toBeTruthy()
  })

  test('Close dictionary settings', async ({ page }) => {
    await page.getByText('CET-4').click()
    await page.waitForURL('**/gallery')
    // should use testId
    await page.locator('main > div > svg').first().click()

    await page.waitForURL('**/')
    await expect(await page.getByText('Start').first().isVisible()).toBeTruthy()
  })

  test('Switch dictionary chapter', async ({ page }) => {
    await page.getByText('第 1 章').first().hover()
    await expect(await page.getByText('章节切换').isVisible()).toBeTruthy()

    await page.getByText('第 1 章').click()
    await page.getByRole('option', { name: '第 2 章' }).click()

    await page.getByText('第 2 章').first().hover()
    await expect(await page.getByText('章节切换').isVisible()).toBeTruthy()
  })
})
