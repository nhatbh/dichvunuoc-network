/**
 * Authentication E2E Tests
 *
 * Targets default template settings: VITE_AUTH_MODE=mock in dev (see src/shared/config/env.ts).
 * For Keycloak E2E, use a dedicated project with env + IdP (see docs/auth-keycloak.md).
 */

import { test, expect } from '@playwright/test'
import { loginAsMockDemoUser } from './helpers/mock-login'

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('should display home page', async ({ page }) => {
    await expect(page).toHaveTitle(/Frontend Sample/i)
    await expect(page.getByRole('heading', { level: 1, name: /Frontend Sample/i })).toBeVisible()
  })

  test('should navigate to login page', async ({ page }) => {
    await page.getByRole('link', { name: /^Login$/i }).click()
    await expect(page).toHaveURL(/\/login/)
  })

  test('should keep empty fields invalid on submit attempt (HTML5 validation)', async ({
    page,
  }) => {
    await page.goto('/login')

    const email = page.getByPlaceholder('Email address')
    const password = page.getByPlaceholder('Password')
    await page.getByRole('button', { name: /sign in/i }).click()

    await expect(email).toHaveJSProperty('validity.valueMissing', true)
    await expect(password).toHaveJSProperty('validity.valueMissing', true)
  })

  test('should login with mock demo credentials', async ({ page }) => {
    await loginAsMockDemoUser(page)
    // After login, user should be on the home page
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})

test.describe('Registration Flow', () => {
  test('should navigate to registration page from login', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: /create a new account/i }).click()
    await expect(page).toHaveURL(/\/register/)
  })

  test('should show client validation on invalid registration', async ({ page }) => {
    await page.goto('/register')

    await page.getByPlaceholder('Your name').fill('Test User')
    const email = page.getByPlaceholder('Email address')
    await email.fill('invalid-email')
    await page.getByPlaceholder('Password (min. 8 characters)').fill('password12')
    await page.getByPlaceholder('Confirm password').fill('password12')
    await page.getByRole('button', { name: /sign up/i }).click()

    await expect(email).toHaveJSProperty('validity.typeMismatch', true)
  })
})

test.describe('Accessibility', () => {
  test('should expose document title', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Frontend Sample/i)
  })

  test('should focus email field from placeholder', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('Email address').focus()
    await expect(page.getByPlaceholder('Email address')).toBeFocused()
  })
})
