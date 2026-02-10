import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  getWorkspaceDir,
  sanitizeFileName,
  sanitizeRelativePath,
} from "@/lib/workspace";
import { buildContentDisposition } from "@/lib/httpHeaders";

export const runtime = "nodejs";

const resolveFilePath = (id: string, kind: string, safeRelPath: string) => {
  const baseDir = getWorkspaceDir(id);
  if (kind === "assessment")
    return path.join(baseDir, "assessment", safeRelPath);
  if (kind === "items") return path.join(baseDir, "items", safeRelPath);
  if (kind === "results") return path.join(baseDir, "results", safeRelPath);
  return null;
};

const resolveContentType = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv") return "text/csv; charset=utf-8";
  if (ext === ".xml") return "application/xml; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind");
    const name = searchParams.get("name");
    if (!kind || !name) {
      return NextResponse.json(
        { error: "kind と name が必要です" },
        { status: 400 }
      );
    }

    let safeRelPath: string;
    try {
      safeRelPath = sanitizeRelativePath(name);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "name が不正です" },
        { status: 400 }
      );
    }

    const filePath = resolveFilePath(id, kind, safeRelPath);
    if (!filePath || !fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: "ファイルが見つかりません" },
        { status: 404 }
      );
    }

    const buffer = await fs.promises.readFile(filePath);
    const content = new Uint8Array(buffer);
    const contentType = resolveContentType(filePath);
    const fallbackName = sanitizeFileName(path.basename(safeRelPath));
    return new NextResponse(content, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": buildContentDisposition(
          path.basename(safeRelPath),
          fallbackName
        ),
      },
    });
  } catch (error) {
    console.error("ファイル取得エラー:", error);
    return NextResponse.json(
      { error: "ファイルの取得に失敗しました" },
      { status: 500 }
    );
  }
}
