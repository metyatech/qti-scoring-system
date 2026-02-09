import { expect, test } from '@playwright/test'
import { withWorkspace, waitForResultsUpdate } from './utils/workspace'

test('criteria update request omits criterionText payload', async ({ page }) => {
  await withWorkspace(page, 'E2E Criteria Update', async (workspaceId) => {
    await page.goto(`/workspace/${workspaceId}`)

    const requestPromise = page.waitForRequest(
      (request) =>
        request.method() === 'PUT' &&
        request.url().includes(`/api/workspaces/${workspaceId}/results`),
    )
    const responsePromise = waitForResultsUpdate(page)

    await page.getByRole('button', { name: '〇' }).first().click()

    const request = await requestPromise
    const response = await responsePromise
    expect(response.ok()).toBe(true)

    const payload = request.postDataJSON() as {
      items?: Array<{ criteria?: Array<Record<string, unknown>> }>
    }
    expect(payload.items?.length).toBe(1)
    const criteria = payload.items?.[0].criteria ?? []
    expect(criteria).toHaveLength(2)
    for (const entry of criteria) {
      expect(Object.prototype.hasOwnProperty.call(entry, 'criterionText')).toBe(false)
    }
  })
})
