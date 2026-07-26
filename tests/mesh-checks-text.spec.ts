import { test, expect } from '@playwright/test'

test('runs STL fixture suite and matches expected diagnostics', async ({ page }) => {
  await page.goto('/mesh-checks-text?autorun=1')

  await expect(page.getByTestId('suite-summary')).toContainText('Fixtures: 11')

  await expect(page.getByTestId('suite-summary')).toContainText('Completed: 11', { timeout: 8 * 60 * 1000 })
  await expect(page.getByTestId('run-error')).toHaveCount(0)

  await expect(page.getByTestId('suite-summary')).toContainText('ERROR: 0')

  await expect(page.getByTestId('result-row-high_cylinder')).toContainText('PASS')
  await expect(page.getByTestId('result-row-high_cube')).toContainText('PASS')
  await expect(page.getByTestId('result-row-test_noise')).toContainText('FAIL')

  const rows = page.locator('[data-testid^="result-row-"]')
  await expect(rows).toHaveCount(11)
})
