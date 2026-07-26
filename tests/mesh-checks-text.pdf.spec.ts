import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

test('exports mesh checks results as PDF', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'PDF export requires Chromium')

  await page.goto('/mesh-checks-text?autorun=1')

  await expect(page.getByTestId('suite-summary')).toContainText('Completed: 11', {
    timeout: 8 * 60 * 1000,
  })

  const artifactDir = path.join(process.cwd(), 'playwright-artifacts')
  await mkdir(artifactDir, { recursive: true })

  const pdfPath = path.join(artifactDir, 'mesh-checks-results.pdf')

  await page.emulateMedia({ media: 'screen' })
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '10mm',
      right: '10mm',
      bottom: '10mm',
      left: '10mm',
    },
  })

  await expect(page.getByTestId('results-table')).toBeVisible()
})
