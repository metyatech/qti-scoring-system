// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CandidateResourceError,
  extractZipSafelyForTest,
  getCandidateResourceSummaries,
  getFileManagerCommand,
  openCandidateResource,
  readVerifiedArchiveForTest,
  renameWithRetryForTest,
  resolveZipEntryDestinationForTest,
  validateCandidateResourceDefinitionForTest,
  validateZipEntryPathForTest
} from "@/lib/candidateResources";

const spawned = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: (...args: unknown[]) => spawned(...args) };
});

type Fixture = {
  root: string;
  indexPath: string;
  assessmentDir: string;
  workspaceDir: string;
  sourcePath: string;
  targetPath: string;
};

const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");

const makeZip = async (files: Record<string, string>): Promise<Buffer> => {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(files)) zip.file(name, value);
  return await zip.generateAsync({ type: "nodebuffer" });
};

const setup = async (withResource = true): Promise<Fixture> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qti-candidate-resource-"));
  const assessmentRel = "courses/example/exams/final";
  const assessmentDir = path.join(root, assessmentRel);
  const workspaceRel = `${assessmentRel}/result/scoring-workspace`;
  const workspaceDir = path.join(root, workspaceRel);
  const sourcePath = path.join(assessmentDir, "result", "submissions", "student.zip");
  const targetPath = path.join(assessmentDir, "result", "temp", "student", "extracted");
  const archive = await makeZip({ "answer.txt": "first" });
  await mkdir(path.join(workspaceDir, "results"), { recursive: true });
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(path.join(workspaceDir, "workspace.json"), JSON.stringify({
    id: "exam-1",
    name: "Exam",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    itemFiles: [],
    assessmentTestFile: "assessment-test.qti.xml",
    resultFiles: ["assessmentResult-1.xml"],
    itemCount: 0,
    resultCount: 1
  }));
  await writeFile(path.join(workspaceDir, "results", "assessmentResult-1.xml"), "<result />");
  await writeFile(sourcePath, archive);
  const resource = {
    id: "submission",
    label: "提出物を開く",
    type: "folder",
    path: `${assessmentRel}/result/temp/student/extracted`,
    prepare: {
      type: "extract-zip",
      sourcePath: `${assessmentRel}/result/submissions/student.zip`,
      sourceSha256: sha256(archive)
    }
  };
  await writeFile(
    path.join(root, ".course-assessment-index.json"),
    JSON.stringify({ workspaces: [{
      id: "exam-1",
      assessmentDir: assessmentRel,
      workspaceDir: workspaceRel,
      name: "Exam",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...(withResource ? { candidateResources: { "assessmentResult-1.xml": [resource] } } : {})
    }] })
  );
  const indexPath = path.join(root, ".course-assessment-index.json");
  process.env.QTI_SCORING_SYSTEM_REPO_ROOT = root;
  process.env.QTI_SCORING_SYSTEM_WORKSPACE_INDEX = indexPath;
  return { root, indexPath, assessmentDir, workspaceDir, sourcePath, targetPath };
};

afterEach(async () => {
  delete process.env.QTI_SCORING_SYSTEM_REPO_ROOT;
  delete process.env.QTI_SCORING_SYSTEM_WORKSPACE_INDEX;
  spawned.mockReset();
});

describe("candidate resource resolver", () => {
  it("returns UI-only summaries and rejects unsafe definitions", async () => {
    await setup();
    await mkdir(path.join((process.env.QTI_SCORING_SYSTEM_REPO_ROOT as string), "courses/example/exams/final"), { recursive: true });
    await expect(getCandidateResourceSummaries("exam-1", "assessmentResult-1.xml")).resolves.toEqual([
      { id: "submission", label: "提出物を開く", type: "folder" }
    ]);
    expect(JSON.stringify(await getCandidateResourceSummaries("exam-1", "assessmentResult-1.xml"))).not.toContain("sourcePath");
    expect(() => validateCandidateResourceDefinitionForTest({
      id: "submission",
      label: "提出物",
      type: "folder",
      path: "../outside"
    })).toThrow(CandidateResourceError);
    expect(() => validateCandidateResourceDefinitionForTest({
      id: "submission",
      label: "提出物",
      type: "folder",
      path: "C:/outside"
    })).toThrow(CandidateResourceError);
  });

  it("opens a missing folder by extracting it and writes a marker", async () => {
    const fixture = await setup();
    spawned.mockImplementation((...args: unknown[]) => {
      void args;
      const child = { once: (event: string, callback: () => void) => { if (event === "spawn") callback(); return child; }, unref: vi.fn() };
      return child;
    });
    await openCandidateResource("exam-1", "assessmentResult-1.xml", "submission");
    expect(await readFile(path.join(fixture.targetPath, "answer.txt"), "utf8")).toBe("first");
    expect(JSON.parse(await readFile(`${fixture.targetPath}.course-assessment-resource.json`, "utf8"))).toMatchObject({
      schemaVersion: 1,
      prepareType: "extract-zip"
    });
    expect(spawned).toHaveBeenCalledTimes(1);
  });

  it("uses a matching marker without reading the ZIP again", async () => {
    const fixture = await setup();
    await mkdir(fixture.targetPath, { recursive: true });
    await writeFile(path.join(fixture.targetPath, "answer.txt"), "cached");
    const index = JSON.parse(await readFile(fixture.indexPath, "utf8")) as { workspaces: Array<{ candidateResources: Record<string, Array<{ prepare: { sourceSha256: string } }>> }> };
    const hash = index.workspaces[0].candidateResources["assessmentResult-1.xml"][0].prepare.sourceSha256;
    await writeFile(`${fixture.targetPath}.course-assessment-resource.json`, JSON.stringify({ schemaVersion: 1, prepareType: "extract-zip", sourceSha256: hash }));
    await rm(fixture.sourcePath);
    spawned.mockImplementation((...args: unknown[]) => {
      void args;
      const child = { once: (event: string, callback: () => void) => { if (event === "spawn") callback(); return child; }, unref: vi.fn() };
      return child;
    });
    await openCandidateResource("exam-1", "assessmentResult-1.xml", "submission");
    expect(await readFile(path.join(fixture.targetPath, "answer.txt"), "utf8")).toBe("cached");
  });

  it("keeps the old target when the source hash changes", async () => {
    const fixture = await setup();
    await mkdir(fixture.targetPath, { recursive: true });
    await writeFile(path.join(fixture.targetPath, "answer.txt"), "old");
    await writeFile(fixture.sourcePath, await makeZip({ "answer.txt": "changed" }));
    await expect(openCandidateResource("exam-1", "assessmentResult-1.xml", "submission")).rejects.toMatchObject({ code: "conflict" });
    expect(await readFile(path.join(fixture.targetPath, "answer.txt"), "utf8")).toBe("old");
  });

  it("rejects unknown result files and resources", async () => {
    await setup();
    await expect(getCandidateResourceSummaries("exam-1", "missing.xml")).rejects.toMatchObject({ code: "not-found" });
    await expect(openCandidateResource("exam-1", "assessmentResult-1.xml", "other")).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("candidate ZIP safety", () => {
  const setCentralUncompressedSize = (archive: Buffer, size: number, occurrence = 0): Buffer => {
    const patched = Buffer.from(archive);
    const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    let offset = -signature.length;
    for (let index = 0; index <= occurrence; index += 1) {
      offset = patched.indexOf(signature, offset + signature.length);
      if (offset < 0) throw new Error("central directory entry not found");
    }
    patched.writeUInt32LE(size, offset + 24);
    return patched;
  };

  it("rejects traversal, absolute, drive, duplicate, symlink, collision, and size-invalid entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qti-zip-safety-"));
    try {
      expect(() => validateZipEntryPathForTest("../escape.txt")).toThrow(CandidateResourceError);
      expect(() => validateZipEntryPathForTest("/escape.txt")).toThrow(CandidateResourceError);
      expect(() => validateZipEntryPathForTest("C:/escape.txt")).toThrow(CandidateResourceError);
      expect(() => validateZipEntryPathForTest("foo/C:/escape.txt")).toThrow(CandidateResourceError);
      expect(() => validateZipEntryPathForTest("foo/D:escape.txt")).toThrow(CandidateResourceError);
      const duplicate = new JSZip();
      duplicate.file("A.txt", "a");
      duplicate.file("a.txt", "b");
      await expect(extractZipSafelyForTest(await duplicate.generateAsync({ type: "nodebuffer" }), root)).rejects.toMatchObject({ code: "unsafe" });
      const collision = new JSZip();
      collision.file("folder", "file");
      collision.file("folder/child.txt", "child");
      await expect(extractZipSafelyForTest(await collision.generateAsync({ type: "nodebuffer" }), root)).rejects.toMatchObject({ code: "unsafe" });
      const symlink = new JSZip();
      symlink.file("link", "target");
      const symlinkArchive = await symlink.generateAsync({ type: "nodebuffer" });
      const centralHeaderOffset = symlinkArchive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      symlinkArchive.writeUInt32LE(0xa1ff0000, centralHeaderOffset + 38);
      await expect(extractZipSafelyForTest(symlinkArchive, root)).rejects.toMatchObject({ code: "unsafe" });
      const oversizedEntry = new JSZip();
      oversizedEntry.file("small.txt", "small");
      await expect(extractZipSafelyForTest(
        setCentralUncompressedSize(await oversizedEntry.generateAsync({ type: "nodebuffer" }), 256 * 1024 * 1024 + 1),
        root
      )).rejects.toMatchObject({ code: "unsafe" });
      const oversizedTotal = new JSZip();
      for (let index = 0; index < 5; index += 1) oversizedTotal.file(`file-${index}.txt`, "small");
      let oversizedTotalArchive = await oversizedTotal.generateAsync({ type: "nodebuffer" });
      for (let index = 0; index < 5; index += 1) {
        oversizedTotalArchive = setCentralUncompressedSize(oversizedTotalArchive, 256 * 1024 * 1024, index);
      }
      await expect(extractZipSafelyForTest(oversizedTotalArchive, root)).rejects.toMatchObject({ code: "unsafe" });
      const tooManyEntries = new JSZip();
      for (let index = 0; index < 10_001; index += 1) tooManyEntries.file(`file-${index}.txt`, "x");
      await expect(extractZipSafelyForTest(await tooManyEntries.generateAsync({ type: "nodebuffer" }), root)).rejects.toMatchObject({ code: "unsafe" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("checks the final ZIP destination containment", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qti-zip-destination-"));
    try {
      expect(resolveZipEntryDestinationForTest(root, "nested/file.txt")).toBe(path.join(root, "nested", "file.txt"));
      expect(() => resolveZipEntryDestinationForTest(root, "../escape.txt")).toThrow(CandidateResourceError);
      expect(() => resolveZipEntryDestinationForTest(root, "")).toThrow(CandidateResourceError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an oversized raw ZIP before reading it", async () => {
    const readFile = vi.fn(async () => Buffer.from("must not be read"));
    const stat = vi.fn(async () => ({ isFile: () => true, size: 256 * 1024 * 1024 + 1 }));
    await expect(readVerifiedArchiveForTest(
      "ignored.zip",
      "0".repeat(64),
      { stat, readFile }
    )).rejects.toMatchObject({ code: "unsafe" });
    expect(stat).toHaveBeenCalledOnce();
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("candidate resource rename retry", () => {
  const transientCodes = ["EPERM", "EBUSY", "EACCES"] as const;

  it.each(transientCodes)("retries transient %s on Windows", async (code) => {
    let attempts = 0;
    const sleepCalls: number[] = [];
    await renameWithRetryForTest(
      "staging",
      "target",
      "win32",
      async () => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error("transient rename failure") as NodeJS.ErrnoException;
          error.code = code;
          throw error;
        }
      },
      async (milliseconds) => {
        sleepCalls.push(milliseconds);
      }
    );
    expect(attempts).toBe(3);
    expect(sleepCalls).toEqual([50, 100]);
  });

  it("throws permanent errors without sleeping", async () => {
    let attempts = 0;
    const sleep = vi.fn(async () => undefined);
    await expect(renameWithRetryForTest(
      "staging",
      "target",
      "win32",
      async () => {
        attempts += 1;
        const error = new Error("missing rename source") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
      sleep
    )).rejects.toMatchObject({ code: "ENOENT" });
    expect(attempts).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry transient errors outside Windows", async () => {
    let attempts = 0;
    const sleep = vi.fn(async () => undefined);
    await expect(renameWithRetryForTest(
      "staging",
      "target",
      "linux",
      async () => {
        attempts += 1;
        const error = new Error("sharing violation") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      },
      sleep
    )).rejects.toMatchObject({ code: "EPERM" });
    expect(attempts).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("throws after exhausting all Windows retry attempts", async () => {
    let attempts = 0;
    const sleepCalls: number[] = [];
    await expect(renameWithRetryForTest(
      "staging",
      "target",
      "win32",
      async () => {
        attempts += 1;
        const error = new Error("persistent sharing violation") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      },
      async (milliseconds) => {
        sleepCalls.push(milliseconds);
      }
    )).rejects.toMatchObject({ code: "EPERM" });
    expect(attempts).toBe(15);
    expect(sleepCalls).toHaveLength(14);
    expect(sleepCalls.at(-1)).toBe(1000);
  });
});

describe("file manager commands", () => {
  it.each([
    ["win32", "explorer.exe"],
    ["darwin", "open"],
    ["linux", "xdg-open"]
  ] as const)("uses an argument array on %s", (platform, command) => {
    expect(getFileManagerCommand(platform, "C:/folder")).toEqual({ command, args: ["C:/folder"] });
  });
});
