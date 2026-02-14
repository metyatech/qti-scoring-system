import path from "path";
import type { APIRequestContext, Page } from "@playwright/test";

const createdWorkspaceIds = new Set<string>();

export const createWorkspace = async (
  page: Page,
  name: string,
  resultsFiles: string | string[] = "assessmentResult-1.xml",
  assessmentFolder = "assessment"
) => {
  await page.goto("/workspace/new");
  await page.getByLabel("ワークスペース名 *").fill(name);

  const assessmentInput = page.locator('input[type="file"]').nth(0);
  await assessmentInput.setInputFiles(
    path.join(process.cwd(), "e2e", "fixtures", assessmentFolder)
  );

  const resultsInput = page.locator('input[type="file"]').nth(1);
  const resolvedResultsFiles = Array.isArray(resultsFiles)
    ? resultsFiles
    : [resultsFiles];
  await resultsInput.setInputFiles(
    resolvedResultsFiles.map((file) =>
      path.join(process.cwd(), "e2e", "fixtures", "results", file)
    )
  );

  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/workspaces")
  );
  await page.getByRole("button", { name: "ワークスペースを作成" }).click();
  const response = await createResponse;
  if (!response.ok()) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body?.error ?? `workspace create failed: ${response.status()}`
    );
  }
  await page.waitForURL(/\/workspace\/(?!new$).+/);

  const url = new URL(page.url());
  const parts = url.pathname.split("/").filter(Boolean);
  const workspaceId = parts[1];
  if (!workspaceId || workspaceId === "new") {
    throw new Error(`workspaceId not found in url: ${url.toString()}`);
  }
  createdWorkspaceIds.add(workspaceId);
  return workspaceId;
};

export const deleteWorkspace = async (page: Page, workspaceId: string) => {
  await page.request.delete(`/api/workspaces/${workspaceId}`);
};

export const cleanupTrackedWorkspaces = async (request: APIRequestContext) => {
  if (createdWorkspaceIds.size === 0) return;
  const ids = Array.from(createdWorkspaceIds);
  createdWorkspaceIds.clear();
  await Promise.all(ids.map((id) => request.delete(`/api/workspaces/${id}`)));
};

export const withWorkspace = async (
  page: Page,
  name: string,
  run: (workspaceId: string) => Promise<void>,
  resultsFiles?: string | string[],
  assessmentFolder?: string
) => {
  const workspaceId = await createWorkspace(
    page,
    name,
    resultsFiles,
    assessmentFolder
  );
  try {
    await run(workspaceId);
  } finally {
    await deleteWorkspace(page, workspaceId);
  }
};

export const waitForResultsUpdate = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().includes("/api/workspaces/") &&
      response.url().includes("/results")
  );
