import { test, expect } from '@playwright/test'

test('strict mode: fails if any expected-value mismatch exists', async ({ page }) => {
  await page.goto('/mesh-checks-text?autorun=1')

  await expect(page.getByTestId('suite-summary')).toContainText('Completed: 11', {
    timeout: 8 * 60 * 1000,
  })
  await expect(page.getByTestId('run-error')).toHaveCount(0)
  await expect(page.getByTestId('suite-summary')).toContainText('ERROR: 0')

  await expect(page.getByTestId('expected-mismatch')).toHaveCount(0)
  await expect(page.getByTestId('expected-match')).toBeVisible()

  await expect(page.getByTestId('suite-summary')).toContainText('PASS: 2')
  await expect(page.getByTestId('suite-summary')).toContainText('FAIL: 9')
})
