import { test, expect } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  cleanupTrackedWorkspaces,
  createWorkspace,
  deleteWorkspace,
} from "./utils/workspace";

test.afterEach(async ({ page }) => {
  await cleanupTrackedWorkspaces(page.request);
});

test("workspace export can be imported from the home screen", async ({
  page,
}) => {
  const workspaceId = await createWorkspace(page, "E2E Transfer");
  try {
    await page.goto(`/workspace/${workspaceId}`);
    await expect(
      page.getByRole("button", { name: "このワークスペースをエクスポート" })
    ).toBeVisible();
    const exportResponse = await page.request.get(
      `/api/workspaces/${workspaceId}/export`
    );
    expect(exportResponse.status()).toBe(200);

    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "workspace-export-")
    );
    const zipPath = path.join(tempDir, "workspace-export.zip");
    await fs.promises.writeFile(zipPath, await exportResponse.body());

    await deleteWorkspace(page, workspaceId);
    await page.goto("/");
    await expect(page.getByText("E2E Transfer")).toHaveCount(0);

    await page.getByLabel("エクスポートZIPをインポート").setInputFiles(zipPath);
    const importResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/api/workspaces/import")
    );
    await page.getByRole("button", { name: "インポート実行" }).click();
    expect((await importResponse).status()).toBe(200);

    await expect(
      page.getByRole("heading", { name: "E2E Transfer" }).first()
    ).toBeVisible();

    const response = await page.request.get("/api/workspaces");
    const json = await response.json();
    const importedId = (
      json.workspaces as Array<{ id: string; name: string }>
    ).find((workspace) => workspace.name === "E2E Transfer")?.id;
    if (importedId) {
      await deleteWorkspace(page, importedId);
    }
  } finally {
    await deleteWorkspace(page, workspaceId);
  }
});
