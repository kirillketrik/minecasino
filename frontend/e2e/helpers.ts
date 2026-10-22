import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

let counter = 0

export async function register(page: Page) {
  const email = `e2e${Date.now()}${counter++}@example.com`
  await page.goto('/#/register')
  await page.getByLabel('Почта').fill(email)
  await page.getByLabel('Пароль').fill('e2e-pass-12345')
  await page.getByLabel('Ник в Minecraft').fill('E2E_Steve')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { name: 'Игры' })).toBeVisible()
  return email
}

export const balance = async (page: Page) =>
  Number((await page.locator('.balance-value').innerText()).replace(/\D/g, ''))
