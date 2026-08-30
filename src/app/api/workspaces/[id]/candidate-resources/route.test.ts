// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/workspaces/[id]/candidate-resources/route";

const fixtures: string[] = [];

const setup = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qti-resource-route-"));
  fixtures.push(root);
  const assessmentRel = "courses/example/exams/final";
  const workspaceRel = `${assessmentRel}/result/scoring-workspace`;
  const workspace = path.join(root, workspaceRel);
  await mkdir(path.join(workspace, "results"), { recursive: true });
  await writeFile(path.join(workspace, "workspace.json"), JSON.stringify({
    id: "exam-1", name: "Exam", createdAt: "now", updatedAt: "now", itemFiles: [],
    assessmentTestFile: "assessment-test.qti.xml", resultFiles: ["result.xml"], itemCount: 0, resultCount: 1
  }));
  await writeFile(path.join(workspace, "results", "result.xml"), "<result />");
  await writeFile(path.join(root, "index.json"), JSON.stringify({ workspaces: [{
    id: "exam-1", assessmentDir: assessmentRel, workspaceDir: workspaceRel, name: "Exam", updatedAt: "now",
    candidateResources: { "result.xml": [{ id: "submission", label: "提出物を開く", type: "folder", path: `${assessmentRel}/result/temp/submission` }] }
  }] }));
  process.env.QTI_SCORING_SYSTEM_REPO_ROOT = root;
  process.env.QTI_SCORING_SYSTEM_WORKSPACE_INDEX = path.join(root, "index.json");
};

afterEach(async () => {
  delete process.env.QTI_SCORING_SYSTEM_REPO_ROOT;
  delete process.env.QTI_SCORING_SYSTEM_WORKSPACE_INDEX;
  for (const fixture of fixtures.splice(0)) await rm(fixture, { recursive: true, force: true });
});

describe("candidate resource routes", () => {
  it("GET returns summaries without paths", async () => {
    await setup();
    const response = await GET(
      new NextRequest("http://localhost/api/workspaces/exam-1/candidate-resources?resultFile=result.xml"),
      { params: Promise.resolve({ id: "exam-1" }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resources).toEqual([{ id: "submission", label: "提出物を開く", type: "folder" }]);
    expect(JSON.stringify(body)).not.toContain("path");
  });

  it("rejects unknown result files and arbitrary path fields", async () => {
    await setup();
    const unknown = await GET(
      new NextRequest("http://localhost/api/workspaces/exam-1/candidate-resources?resultFile=missing.xml"),
      { params: Promise.resolve({ id: "exam-1" }) }
    );
    expect(unknown.status).toBe(404);
    const arbitrary = await POST(
      new NextRequest("http://localhost/api/workspaces/exam-1/candidate-resources", {
        method: "POST",
        body: JSON.stringify({ resultFile: "result.xml", resourceId: "submission", path: "C:/outside" })
      }),
      { params: Promise.resolve({ id: "exam-1" }) }
    );
    expect(arbitrary.status).toBe(400);
  });

  it("rejects malformed JSON bodies with 400", async () => {
    await setup();
    const response = await POST(
      new NextRequest("http://localhost/api/workspaces/exam-1/candidate-resources", {
        method: "POST",
        body: "{"
      }),
      { params: Promise.resolve({ id: "exam-1" }) }
    );
    expect(response.status).toBe(400);
  });
});
