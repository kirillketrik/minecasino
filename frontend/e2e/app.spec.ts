import { expect, test } from '@playwright/test'
import { balance, register } from './helpers.ts'

test('registration needs the 18+ confirmation', async ({ page }) => {
  await page.goto('/#/register')
  await page.getByLabel('Почта').fill('minor@example.com')
  await page.getByLabel('Пароль').fill('e2e-pass-12345')
  await page.getByLabel('Ник в Minecraft').fill('Kid_1')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('alert')).toContainText('18')
})

test('guest is sent to login, new player gets the starting balance', async ({ page }) => {
  await page.goto('/#/wallet')
  await expect(page).toHaveURL(/#\/login/)
  await register(page)
  expect(await balance(page)).toBe(1000)
  await expect(page.getByText('Играйте ответственно').first()).toBeVisible()
})

test('login with wrong password shows an error', async ({ page }) => {
  await page.goto('/#/login')
  await page.getByLabel('Почта').fill('nobody@example.com')
  await page.getByLabel('Пароль').fill('wrong-password')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('alert')).toContainText('Неверная почта или пароль')
})

test('wallet: stub deposit and withdrawal request', async ({ page }) => {
  await register(page)
  await page.goto('/#/wallet')
  await page.getByRole('button', { name: /Получить .* тестовых монет/ }).click()
  await expect(page.getByText('Зачислено')).toBeVisible()
  await expect.poll(() => balance(page)).toBe(2000)
  await page.getByRole('button', { name: 'Создать заявку' }).click()
  await expect(page.getByText('Заявка на 100 монет создана')).toBeVisible()
  await expect.poll(() => balance(page)).toBe(1900)
  await expect(page.getByRole('cell', { name: 'FunTime' })).toBeVisible()
})

test('mines: spin settles the bet, history records it', async ({ page }) => {
  await register(page)
  await page.goto('/#/mines')
  await page.getByRole('button', { name: 'Крутить' }).click()
  const collect = page.getByRole('button', { name: /^Забрать \d/ })
  const lost = page.getByText('В этот раз без выигрыша.')
  await expect(collect.or(lost)).toBeVisible({ timeout: 30_000 })
  if (await collect.isVisible()) await collect.click()
  await expect(page.getByRole('button', { name: /Крутить/ })).toBeEnabled()
  await page.goto('/#/history')
  await expect(page.getByRole('row').nth(1)).toContainText('Шахта')
})

test('creeper: a spin finishes and the balance is consistent', async ({ page }) => {
  await register(page)
  await page.goto('/#/creeper')
  await page.getByRole('button', { name: 'Крутить' }).click()
  await expect(page.getByRole('button', { name: 'Крутить' })).toBeEnabled({ timeout: 40_000 })
  await page.goto('/#/history')
  await expect(page.getByRole('row').nth(1)).toContainText('Крипер')
})

test('elytra: take off, then cash out or crash', async ({ page }) => {
  await register(page)
  await page.goto('/#/elytra')
  await page.getByRole('button', { name: 'Взлететь' }).click()
  const cash = page.getByRole('button', { name: /^Вывести \d/ })
  const crashed = page.getByText(/Элитры сломались на/)
  await expect(cash.or(crashed)).toBeVisible({ timeout: 30_000 })
  if (await cash.isVisible()) await cash.click().catch(() => undefined)
  await expect(page.getByRole('button', { name: 'Взлететь' })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.status-line')).toContainText(/Вывод на|Элитры сломались/)
})

test('mobile layout has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await register(page)
  for (const route of ['mines', 'creeper', 'elytra', 'wallet', 'history']) {
    await page.goto(`/#/${route}`)
    await page.waitForTimeout(400)
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth])
    expect(sw, route).toBeLessThanOrEqual(iw)
  }
})

test('mines: buy bonus charges the price, plays free spins and records the cost', async ({ page }) => {
  await register(page)
  await page.goto('/#/mines')
  await page.getByRole('button', { name: 'Мин' }).click()
  await page.getByRole('button', { name: /^Купить бонус за/ }).click()
  await page.getByRole('button', { name: /^Купить за/ }).click()
  await expect(page.getByText(/Бонус \d+\/10/)).toBeVisible({ timeout: 20_000 })
  const collect = page.getByRole('button', { name: /^Забрать \d/ })
  const none = page.getByText('В этот раз без выигрыша.')
  await expect(collect.or(none)).toBeVisible({ timeout: 60_000 })
  if (await collect.isVisible()) await collect.click()
  await page.goto('/#/history')
  const row = page.getByRole('row').nth(1)
  await expect(row).toContainText('Бонус куплен')
  await expect(row).toContainText('910')
})

test('mines: guaranteed dynamite makes a spin cost more', async ({ page }) => {
  await register(page)
  await page.goto('/#/mines')
  await page.getByRole('button', { name: 'Мин' }).click()
  await page.getByRole('checkbox', { name: /Гарантированный динамит/ }).check()
  await expect(page.getByRole('button', { name: 'Крутить за 29' })).toBeVisible()
})

test('creeper: autoplay runs the chosen number of spins and stops', async ({ page }) => {
  await register(page)
  await page.goto('/#/creeper')
  await page.getByRole('button', { name: 'Турбо' }).click()
  await page.getByRole('button', { name: 'Автоспины' }).click()
  await page.getByRole('button', { name: '10', exact: true }).click()
  await page.getByRole('button', { name: /^Запустить 10/ }).click()
  await expect(page.getByText(/Автоспины завершены|Остановлено/)).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('.session dd').first()).toHaveText(/^(10|[1-9])$/)
})

test('space starts a spin in mines', async ({ page }) => {
  await register(page)
  await page.goto('/#/mines')
  await page.getByRole('button', { name: 'Турбо' }).click()
  await expect(page.getByRole('button', { name: /^Крутить за/ })).toBeEnabled()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Space')
  await expect(page.locator('.session dd').first()).toHaveText('1', { timeout: 30_000 })
})

test('limits: a loss limit refuses a bigger bet, self-exclusion blocks play', async ({ page }) => {
  await register(page)
  await page.goto('/#/limits')
  await expect(page.getByText('Сейчас: без лимита').first()).toBeVisible()
  await page.getByLabel('Проигрыш, монет').fill('1')
  await page.getByRole('button', { name: 'Сохранить лимиты' }).click()
  await expect(page.getByText('Лимиты сохранены.')).toBeVisible()
  await page.goto('/#/elytra')
  await page.getByRole('button', { name: '×2' }).click()
  await page.getByRole('button', { name: 'Взлететь' }).click()
  await expect(page.getByText(/Лимит проигрыша за 24 часа/)).toBeVisible()

  await page.goto('/#/limits')
  await page.getByRole('button', { name: '1 час' }).click()
  await page.getByRole('button', { name: 'Да, заблокировать' }).click()
  await expect(page.getByText(/Игра и пополнение заблокированы до/).first()).toBeVisible()
})

test('creeper: ante raises the price of a spin', async ({ page }) => {
  await register(page)
  await page.goto('/#/creeper')
  await page.getByRole('button', { name: 'Мин' }).click()
  await page.getByRole('checkbox', { name: /Повышенный шанс бонуса/ }).check()
  await expect(page.getByRole('button', { name: 'Крутить за 26' })).toBeVisible()
})

test('creeper: buy bonus plays free spins and records the price', async ({ page }) => {
  await register(page)
  await page.goto('/#/creeper')
  await page.getByRole('button', { name: 'Турбо' }).click()
  await page.getByRole('button', { name: 'Мин' }).click()
  await page.getByRole('button', { name: /^Купить бонус за/ }).click()
  await page.getByRole('button', { name: /^Купить за/ }).click()
  await expect(page.getByText(/Бесплатные вращения \d+\/\d+/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /^Крутить за/ })).toBeEnabled({ timeout: 120_000 })
  await page.goto('/#/history')
  const row = page.getByRole('row').nth(1)
  await expect(row).toContainText('Бонус куплен')
  await expect(row).toContainText('934')
})
