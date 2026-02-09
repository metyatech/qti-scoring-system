import { test, expect } from '@playwright/test'
import { withWorkspace } from './utils/workspace'

test('switching view modes and navigation stays responsive', async ({ page }) => {
  await withWorkspace(
    page,
    'E2E Toggle',
    async (workspaceId) => {
      await page.goto(`/workspace/${workspaceId}`)

      await expect(page.getByText('問1: E2E Item A')).toBeVisible()

      await page.getByRole('button', { name: '次 →' }).click()
      await expect(page.getByText('問2: E2E Item B')).toBeVisible()

      await page.getByRole('button', { name: '← 前' }).click()
      await expect(page.getByText('問1: E2E Item A')).toBeVisible()

      await page.getByRole('button', { name: '受講者ごと' }).click()
      await expect(page.getByText('E2E User A')).toBeVisible()

      await page.getByRole('button', { name: '次 →' }).click()
      await expect(page.getByText('E2E User B')).toBeVisible()

      await page.getByRole('button', { name: '← 前' }).click()
      await expect(page.getByText('E2E User A')).toBeVisible()
    },
    ['assessmentResult-multi-1.xml', 'assessmentResult-multi-2.xml'],
    'assessment-multi',
  )
})
