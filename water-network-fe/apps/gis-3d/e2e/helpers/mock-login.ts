import { type Page } from '@playwright/test'

/** Dev mock credentials — see `src/shared/lib/mock-auth.ts` */
export const MOCK_DEMO_EMAIL = 'demo@example.com'
export const MOCK_DEMO_PASSWORD = 'password123'

export async function loginAsMockDemoUser(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByPlaceholder('Email address').fill(MOCK_DEMO_EMAIL)
  await page.getByPlaceholder('Password').fill(MOCK_DEMO_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  // Wait for redirect after login (defaults to /)
  await page.waitForURL('**/')

}
