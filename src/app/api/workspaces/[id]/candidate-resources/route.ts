import { NextRequest, NextResponse } from "next/server";
import {
  CandidateResourceError,
  getCandidateResourceSummaries,
  openCandidateResource
} from "@/lib/candidateResources";
import { getWorkspaceMode } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const errorResponse = (error: unknown): NextResponse => {
  if (error instanceof CandidateResourceError) {
    const status =
      error.code === "not-found"
        ? 404
        : error.code === "conflict"
          ? 409
          : error.code === "open"
            ? 500
            : 422;
    const message =
      error.code === "not-found"
        ? "提出物が見つかりません"
        : error.code === "conflict"
          ? "提出 ZIP が更新されています。もう一度お試しください"
          : error.code === "open"
            ? "ファイルマネージャーを起動できませんでした"
            : "提出物を安全に処理できませんでした";
    return NextResponse.json({ error: message }, { status });
  }
  console.error("candidate resource API error:", error);
  return NextResponse.json({ error: "candidate resource の処理に失敗しました" }, { status: 500 });
};

const getResultFile = (request: NextRequest): string | null => {
  const value = request.nextUrl.searchParams.get("resultFile");
  return value === null || value.trim() === "" ? null : value;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const resultFile = getResultFile(request);
    if (resultFile === null) return NextResponse.json({ error: "resultFile が必要です" }, { status: 400 });
    const resources = await getCandidateResourceSummaries(id, resultFile);
    return NextResponse.json({ success: true, resources });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (getWorkspaceMode() === "legacy") {
      return NextResponse.json({ error: "candidate resource は利用できません" }, { status: 404 });
    }
    const body = (await request.json()) as unknown;
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !["resultFile", "resourceId"].includes(key))
    ) {
      return NextResponse.json({ error: "resultFile と resourceId だけを指定してください" }, { status: 400 });
    }
    const record = body as Record<string, unknown>;
    if (typeof record.resultFile !== "string" || typeof record.resourceId !== "string") {
      return NextResponse.json({ error: "resultFile と resourceId が必要です" }, { status: 400 });
    }
    const { id } = await params;
    await openCandidateResource(id, record.resultFile, record.resourceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
