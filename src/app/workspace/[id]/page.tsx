"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QtiWorkspace } from "@/types/qti";
import { rewriteHtmlImageSources } from "@/utils/assetUrl";
import { applyResponsesToPromptHtml } from "@/utils/qtiBlankResponses";
import ExplanationPanel from "@/components/ExplanationPanel";
import ReportDownloadButton from "@/components/ReportDownloadButton";
import AutoResizeTextarea from "@/components/AutoResizeTextarea";
import EdgeScrollCandidateNavigator from "@/components/EdgeScrollCandidateNavigator";
import ItemCandidateCard from "@/components/ItemCandidateCard";
import RubricScoringControl from "@/components/RubricScoringControl";
import {
  QtiItem,
  QtiItemResult,
  QtiResult,
  parseAssessmentTestXml,
  parseQtiItemXml,
  parseQtiResultsXml,
  remapResultToAssessmentItems,
} from "@/utils/qtiParsing";
import { formatResponse } from "@/utils/formatResponse";
import { getEffectiveRubricOutcomes, getItemMaxScore, getItemScore } from "@/utils/scoring";
import { computeOptimisticItemResultScore } from "@/utils/optimisticScore";
import { buildCriteriaUpdate, updateItemComment } from "@/utils/resultUpdates";
import { makeCommentKey, makeCriterionKey } from "@/utils/workspaceKeys";
import {
  buildWorkspaceUrlSearch,
  parseWorkspaceUrlState,
  resolveWorkspaceUrlState,
} from "@/utils/workspaceUrlState";
import { useHighlightCodeBlocks } from "@/hooks/useHighlightCodeBlocks";
import { useCommentAutoSave } from "@/hooks/useCommentAutoSave";
import CommentSaveStatusIndicator from "@/components/CommentSaveStatusIndicator";

const fetchFileText = async (workspaceId: string, kind: string, name: string) => {
  const res = await fetch(`/api/workspaces/${workspaceId}/files?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`);
  if (!res.ok) {
    throw new Error(`ファイル取得に失敗: ${name}`);
  }
  return await res.text();
};

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<QtiWorkspace | null>(null);
  const [items, setItems] = useState<QtiItem[]>([]);
  const [results, setResults] = useState<QtiResult[]>([]);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"candidate" | "item">("item");
  const [currentResultIndex, setCurrentResultIndex] = useState(0);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [showBasicInfo, setShowBasicInfo] = useState(false);
  const [loopMessage, setLoopMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showItemPreview, setShowItemPreview] = useState(false);
  const [criterionSaveStatusByKey, setCriterionSaveStatusByKey] =
    useState<Record<string, "saving" | "saved">>({});
  const criterionSaveStatusTimersRef = useRef<Record<string, number>>({});

  const highlightDeps = useMemo(
    () => [viewMode, currentResultIndex, currentItemIndex, showItemPreview, items.length],
    [viewMode, currentResultIndex, currentItemIndex, showItemPreview, items.length]
  );

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const wsRes = await fetch(`/api/workspaces/${id}`);
        const wsJson = await wsRes.json();
        if (!wsRes.ok || !wsJson.success) {
          throw new Error(wsJson.error || "ワークスペースの読み込みに失敗しました");
        }
        const ws: QtiWorkspace = wsJson.workspace;
        setWorkspace(ws);
        if (!ws.assessmentTestFile) {
          throw new Error('assessment-test が見つかりません');
        }

        const assessmentTestXml = await fetchFileText(ws.id, "assessment", ws.assessmentTestFile);
        const itemRefs = parseAssessmentTestXml(assessmentTestXml);
        if (ws.itemFiles.length !== itemRefs.length) {
          throw new Error("assessmentTest と設問ファイル数が一致しません");
        }

        const itemTexts = await Promise.all(
          ws.itemFiles.map((name) => fetchFileText(ws.id, "assessment", name))
        );
        const parsedItems = itemTexts.map((xml, index) => {
          const item = parseQtiItemXml(xml);
          const expectedIdentifier = itemRefs[index]?.identifier;
          if (expectedIdentifier && item.identifier !== expectedIdentifier) {
            throw new Error(`assessmentTest と item identifier が一致しません: ${expectedIdentifier}`);
          }
          return item;
        });
        const itemsWithResolvedAssets = parsedItems.map((item, index) => {
          const baseFilePath = ws.itemFiles[index];
          const promptHtml = rewriteHtmlImageSources(item.promptHtml, ws.id, baseFilePath);
          const candidateExplanationHtml = item.candidateExplanationHtml
            ? rewriteHtmlImageSources(item.candidateExplanationHtml, ws.id, baseFilePath)
            : null;
          return {
            ...item,
            promptHtml,
            candidateExplanationHtml,
          };
        });
        setItems(itemsWithResolvedAssets);

        const resultTexts = await Promise.all(
          ws.resultFiles.map((name) => fetchFileText(ws.id, "results", name))
        );
        const parsedResults = resultTexts.map((xml, index) => parseQtiResultsXml(xml, ws.resultFiles[index]));

        const mappedResults = parsedResults.map((result) => {
          const remapped = remapResultToAssessmentItems(result, itemRefs);
          if (remapped.missingResultIdentifiers.length > 0) {
            throw new Error(
              `assessmentTest に対応しない結果IDがあります (${result.fileName}): ${remapped.missingResultIdentifiers.join(", ")}`
            );
          }
          if (remapped.duplicateItemIdentifiers.length > 0) {
            throw new Error(
              `同じ設問に複数の結果が割り当てられています (${result.fileName}): ${remapped.duplicateItemIdentifiers.join(", ")}`
            );
          }
          return { ...result, itemResults: remapped.mappedItemResults };
        });
        setResults(mappedResults);

        // Restore view / candidate / item / details panel state from the URL
        // query, if any. Stale keys fall back to index 0 instead of throwing.
        const parsedUrlState =
          typeof window === "undefined"
            ? {}
            : parseWorkspaceUrlState(window.location.search);
        const restoredState = resolveWorkspaceUrlState(
          parsedUrlState,
          mappedResults,
          itemsWithResolvedAssets
        );
        setViewMode(restoredState.viewMode);
        setCurrentResultIndex(restoredState.currentResultIndex);
        setCurrentItemIndex(restoredState.currentItemIndex);
        setShowBasicInfo(restoredState.showBasicInfo);
      } catch (err) {
        setError(err instanceof Error ? err.message : "ワークスペースの読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  useHighlightCodeBlocks(pageRef, highlightDeps, !loading);

  useEffect(() => {
    if (results.length === 0) return;
    setCurrentResultIndex((prev) => Math.min(prev, results.length - 1));
  }, [results.length]);

  useEffect(() => {
    if (items.length === 0) return;
    setCurrentItemIndex((prev) => Math.min(prev, items.length - 1));
  }, [items.length]);

  useEffect(() => {
    if (viewMode !== "item") {
      setShowItemPreview(false);
    }
  }, [viewMode]);

  useEffect(() => {
    if (!showItemPreview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowItemPreview(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showItemPreview]);

  const currentResult = results[currentResultIndex];
  const currentItem = items[currentItemIndex];

  // Reflect the active UI state into the URL query so the same view survives
  // a reload. We deliberately avoid `router.push` / `router.replace` here:
  // this is a UI state mirror, not a Next.js navigation, and we do not want
  // to grow the browser history when the user clicks "次へ".
  useEffect(() => {
    if (loading) return;
    if (!currentResult || !currentItem) return;
    if (typeof window === "undefined") return;

    const search = buildWorkspaceUrlSearch({
      viewMode,
      resultFile: currentResult.fileName,
      itemId: currentItem.identifier,
      showBasicInfo,
    });

    const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (currentUrl !== nextUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [
    loading,
    viewMode,
    currentResult,
    currentItem,
    showBasicInfo,
  ]);

  const totalMaxScore = useMemo(() => items.reduce((sum, item) => sum + getItemMaxScore(item), 0), [items]);

  const currentScore = useMemo(() => {
    if (!currentResult) return 0;
    return items.reduce((sum, item) => {
      const itemResult = currentResult.itemResults[item.identifier];
      const score = getItemScore(item, itemResult);
      return sum + (score ?? 0);
    }, 0);
  }, [currentResult, items]);

  const showLoop = (message: string) => {
    setLoopMessage(message);
    setTimeout(() => setLoopMessage(null), 2000);
  };

  const startCriterionSaveFeedback = (key: string) => {
    const existing = criterionSaveStatusTimersRef.current[key];
    if (existing) {
      window.clearTimeout(existing);
      delete criterionSaveStatusTimersRef.current[key];
    }
    setCriterionSaveStatusByKey((prev) => ({ ...prev, [key]: "saving" }));
  };

  const finishCriterionSaveFeedback = (key: string, status: "saved" | "idle") => {
    setCriterionSaveStatusByKey((prev) => {
      const next = { ...prev };
      if (status === "idle") {
        delete next[key];
      } else {
        next[key] = status;
      }
      return next;
    });
    if (status === "saved") {
      const timer = window.setTimeout(() => {
        setCriterionSaveStatusByKey((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        delete criterionSaveStatusTimersRef.current[key];
      }, 2000);
      criterionSaveStatusTimersRef.current[key] = timer;
    }
  };

  useEffect(() => {
    const timers = criterionSaveStatusTimersRef.current;
    return () => {
      Object.values(timers).forEach((timer) => {
        window.clearTimeout(timer);
      });
    };
  }, []);

  const nextCandidate = () => {
    if (!results.length) return;
    const nextIndex = (currentResultIndex + 1) % results.length;
    if (currentResultIndex === results.length - 1) {
      showLoop("最後から最初の受講者に戻りました");
    }
    setCurrentResultIndex(nextIndex);
  };

  const prevCandidate = () => {
    if (!results.length) return;
    const prevIndex = (currentResultIndex - 1 + results.length) % results.length;
    if (currentResultIndex === 0) {
      showLoop("最初から最後の受講者に移動しました");
    }
    setCurrentResultIndex(prevIndex);
  };

  const nextItem = () => {
    if (!items.length) return;
    const nextIndex = (currentItemIndex + 1) % items.length;
    if (currentItemIndex === items.length - 1) {
      showLoop("最後から最初の設問に戻りました");
    }
    setCurrentItemIndex(nextIndex);
  };

  const prevItem = () => {
    if (!items.length) return;
    const prevIndex = (currentItemIndex - 1 + items.length) % items.length;
    if (currentItemIndex === 0) {
      showLoop("最初から最後の設問に移動しました");
    }
    setCurrentItemIndex(prevIndex);
  };

  // Navigation helpers used by the item-view scroll gate. Unlike
  // `nextCandidate`/`prevCandidate` (used by the "受講者ごと" buttons),
  // these never wrap around — the scroll gate surfaces a boundary message
  // when at the first/last candidate.
  const nextItemViewCandidate = () => {
    if (!results.length) return;
    setCurrentResultIndex((prev) => Math.min(results.length - 1, prev + 1));
  };

  const prevItemViewCandidate = () => {
    if (!results.length) return;
    setCurrentResultIndex((prev) => Math.max(0, prev - 1));
  };

  const updateCriteria = async (
    resultFile: string,
    itemId: string,
    criterionIndex: number,
    value: boolean
  ) => {
    const item = items.find((i) => i.identifier === itemId);
    if (!item || item.rubric.length === 0) return;
    const currentResult = results.find((r) => r.fileName === resultFile);
    const currentOutcomes = currentResult?.itemResults[itemId]?.rubricOutcomes ?? {};
    const criteria = buildCriteriaUpdate(item.rubric, currentOutcomes, criterionIndex, value);
    const res = await fetch(`/api/workspaces/${id}/results`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resultFile,
        items: [{ identifier: itemId, criteria }],
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "採点結果の更新に失敗しました");
    }
    const body = (await res.json().catch(() => null)) as
      | {
          items?: Array<{
            identifier: string;
            rubricOutcomes: Record<number, boolean>;
            score: number | null;
            comment: string | null;
          }>;
        }
      | null;
    return body;
  };

  /**
   * Persist a single comment to the results XML. This is the ONLY operation
   * that counts as "saved" for autosave purposes. It intentionally does not
   * reconcile from the server response: while a save is in flight the user may
   * have typed further, and re-applying the server echo would clobber the newer
   * on-screen value. The optimistic value is already applied via
   * `applyLocalComment`, and a failed save must never roll back that value.
   */
  const persistCommentToServer = useCallback(
    async (resultFile: string, itemId: string, comment: string) => {
      const res = await fetch(`/api/workspaces/${id}/results`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resultFile,
          items: [{ identifier: itemId, comment }],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "コメントの更新に失敗しました");
      }
    },
    [id]
  );

  const applyLocalComment = useCallback(
    (resultFile: string, itemId: string, comment: string) => {
      setResults((prev) => updateItemComment(prev, resultFile, itemId, comment));
    },
    []
  );

  const {
    commentSaveStatusByKey,
    hasUnsettledCommentSaves,
    scheduleCommentSave,
    flushCommentSave,
  } = useCommentAutoSave({
    persistComment: persistCommentToServer,
    applyLocalComment,
  });

  /**
   * Replace the optimistic local state for a single result file with the
   * server-confirmed values. Apply-to-qti-results may have rejected the
   * criteria for auto-scored items (e.g. choice) and kept the previous
   * rubric outcomes; this is the only place we trust to mirror that into
   * the React state.
   */
  const reconcileResultsFromServer = (
    resultFile: string,
    items: Array<{
      identifier: string;
      rubricOutcomes: Record<number, boolean>;
      score: number | null;
      comment: string | null;
    }>
  ) => {
    setResults((prev) =>
      prev.map((res) => {
        if (res.fileName !== resultFile) return res;
        const nextItemResults: Record<string, QtiItemResult> = { ...res.itemResults };
        for (const updated of items) {
          const existing = nextItemResults[updated.identifier] ?? {
            resultIdentifier: updated.identifier,
            response: null,
            rubricOutcomes: {},
          };
          nextItemResults[updated.identifier] = {
            ...existing,
            rubricOutcomes: { ...updated.rubricOutcomes },
            score: updated.score ?? undefined,
            comment: updated.comment ?? undefined,
          };
        }
        return { ...res, itemResults: nextItemResults };
      })
    );
  };

  const updateRubricOutcome = async (
    resultFile: string,
    itemId: string,
    criterionIndex: number,
    value: boolean
  ) => {
    const prevResults = results;
    setSaving(true);
    setError(null);
    const saveKey = makeCriterionKey(resultFile, itemId, criterionIndex);
    startCriterionSaveFeedback(saveKey);
    let nextRubricOutcomes: Record<number, boolean> = {};
    setResults((prev) =>
      prev.map((res) => {
        if (res.fileName !== resultFile) return res;
        const itemResult = res.itemResults[itemId] || {
          resultIdentifier: itemId,
          response: null,
          rubricOutcomes: {},
        };
        nextRubricOutcomes = { ...itemResult.rubricOutcomes, [criterionIndex]: value };
        const item = items.find((i) => i.identifier === itemId);
        const score = item
          ? computeOptimisticItemResultScore(item, itemResult, nextRubricOutcomes) ?? undefined
          : itemResult.score;
        return {
          ...res,
          itemResults: {
            ...res.itemResults,
            [itemId]: { ...itemResult, rubricOutcomes: nextRubricOutcomes, score },
          },
        };
      })
    );

    try {
      const response = await updateCriteria(resultFile, itemId, criterionIndex, value);
      if (response?.items && response.items.length > 0) {
        reconcileResultsFromServer(resultFile, response.items);
      }
      finishCriterionSaveFeedback(saveKey, "saved");
    } catch (err) {
      setResults(prevResults);
      setError(err instanceof Error ? err.message : "採点結果の更新に失敗しました");
      finishCriterionSaveFeedback(saveKey, "idle");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCriterion = async (itemId: string, criterionIndex: number, value: boolean) => {
    if (!currentResult) return;
    await updateRubricOutcome(currentResult.fileName, itemId, criterionIndex, value);
  };

  const handleCommentBlur = (resultFile: string, itemId: string, comment: string) => {
    flushCommentSave(resultFile, itemId, comment);
  };

  const handleCommentChange = (resultFile: string, itemId: string, comment: string) => {
    scheduleCommentSave(resultFile, itemId, comment);
  };

  const handleReportError = (message: string) => {
    if (!message) {
      setError(null);
      return;
    }
    setError(message);
  };

  const handleExportWorkspace = () => {
    if (!workspace) return;
    window.location.href = `/api/workspaces/${workspace.id}/export`;
  };

  /**
   * Internal-navigation guard for the in-app "ワークスペース一覧に戻る" button.
   * `beforeunload` only fires for tab close / external navigation, not for
   * client-side `router.push`, so we mirror the guard for in-app transitions
   * by asking the user to confirm while any comment save is still unsettled.
   */
  const handleBackToWorkspaceList = () => {
    if (hasUnsettledCommentSaves) {
      const ok = window.confirm(
        "コメントを保存中です。保存が完了する前に移動すると、未保存の入力が失われる可能性があります。移動しますか？"
      );
      if (!ok) return;
    }
    router.push("/");
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">読み込み中...</div>;
  }

  if (!workspace) {
    return <div className="p-8 text-center text-gray-500">ワークスペースが見つかりません</div>;
  }
  if (!currentResult && error) {
    return <div className="p-8 text-center text-red-600">{error}</div>;
  }
  if (!currentResult) {
    return <div className="p-8 text-center text-gray-500">結果データがありません</div>;
  }
  if (!currentItem) {
    return <div className="p-8 text-center text-gray-500">設問データがありません</div>;
  }

  return (
    <div ref={pageRef} className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <header className="text-center mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">QTI 3.0 採点システム</h1>
          <p className="text-gray-600">ワークスペース: {workspace.name}</p>
        </header>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="flex flex-wrap justify-center items-center gap-3 mb-6">
          <button
            onClick={handleBackToWorkspaceList}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
          >
            ワークスペース一覧に戻る
          </button>
          <button
            onClick={handleExportWorkspace}
            className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900 transition-colors"
          >
            このワークスペースをエクスポート
          </button>
          <ReportDownloadButton
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            onError={handleReportError}
          />
          {(saving || hasUnsettledCommentSaves) && <span className="sr-only">更新中...</span>}
        </div>

        <div className="sticky top-0 bg-white border rounded-lg shadow-sm p-4 mb-6 z-10">
          {loopMessage && (
            <div className="mb-3 p-2 bg-yellow-100 border border-yellow-300 rounded-md text-yellow-800 text-sm text-center">
              {loopMessage}
            </div>
          )}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4 flex-wrap">
              {viewMode === "candidate" ? (
                <>
                  <div className="text-xl font-bold text-gray-800">
                    {currentResult.candidateName}
                  </div>
                  <div className="text-sm text-gray-500">
                    {currentResultIndex + 1} / {results.length}
                  </div>
                  {totalMaxScore > 0 ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">
                        合計: <span className="text-blue-600">{currentScore}</span> / {totalMaxScore}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">採点基準がありません</span>
                  )}
                </>
              ) : (
                <>
                  <div className="text-xl font-bold text-gray-800">
                    問{currentItemIndex + 1}: {currentItem.title}
                  </div>
                  <div className="text-sm text-gray-500">
                    {currentItemIndex + 1} / {items.length}
                  </div>
                  {currentItem.rubric.length > 0 ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">
                        配点: <span className="text-blue-600">{getItemMaxScore(currentItem)}</span>
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">採点基準がありません</span>
                  )}
                </>
              )}
              <button
                onClick={() => setShowBasicInfo(!showBasicInfo)}
                className="text-sm text-blue-600 hover:text-blue-800 underline"
              >
                {showBasicInfo ? "詳細を隠す" : "詳細を表示"}
              </button>
            </div>
            <div className="flex gap-2">
              <div className="flex rounded-md border border-gray-200 overflow-hidden">
                <button
                  onClick={() => setViewMode("item")}
                  className={`px-3 py-2 text-sm ${viewMode === "item" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                >
                  設問ごと
                </button>
                <button
                  onClick={() => setViewMode("candidate")}
                  className={`px-3 py-2 text-sm ${viewMode === "candidate" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                >
                  受講者ごと
                </button>
              </div>
              {viewMode === "candidate" ? (
                <>
                  <button
                    onClick={prevCandidate}
                    disabled={results.length <= 1}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    ← 前
                  </button>
                  <button
                    onClick={nextCandidate}
                    disabled={results.length <= 1}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    次 →
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={prevItem}
                    disabled={items.length <= 1}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    ← 前
                  </button>
                  <button
                    onClick={nextItem}
                    disabled={items.length <= 1}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    次 →
                  </button>
                </>
              )}
            </div>
          </div>
          {showBasicInfo && (
            <>
              {viewMode === "candidate" ? (
                <div className="mt-4 pt-4 border-t border-gray-200 text-sm grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <span className="text-gray-500">sourcedId:</span> {currentResult.sourcedId || "未設定"}
                  </div>
                  <div>
                    <span className="text-gray-500">result file:</span> {currentResult.fileName}
                  </div>
                  <div>
                    <span className="text-gray-500">items:</span> {items.length}
                  </div>
                </div>
              ) : (
                <div className="mt-4 pt-4 border-t border-gray-200 text-sm grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <span className="text-gray-500">identifier:</span> {currentItem.identifier}
                  </div>
                  <div>
                    <span className="text-gray-500">rubric:</span> {currentItem.rubric.length}
                  </div>
                  <div>
                    <span className="text-gray-500">candidates:</span> {results.length}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {viewMode === "candidate" ? (
          <div className="space-y-6">
            {items.map((item, index) => {
              const itemResult = currentResult.itemResults[item.identifier];
              const responseText = formatResponse(item, itemResult);
              const displayPromptHtml =
                item.type === "cloze"
                  ? applyResponsesToPromptHtml(item.promptHtml, itemResult?.response)
                  : item.promptHtml;
              const rubric = item.rubric;
              const comment = itemResult?.comment ?? "";
              const commentKey = makeCommentKey(currentResult.fileName, item.identifier);
              const commentStatus = commentSaveStatusByKey[commentKey];
              return (
                <div key={item.identifier} className="bg-white border rounded-lg p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="bg-blue-600 text-white text-sm font-bold px-3 py-1 rounded-md">
                      問{index + 1}
                    </span>
                    <h2 className="text-lg font-semibold text-gray-800">{item.title}</h2>
                  </div>
                  <div
                    className="prose max-w-none qti-prompt"
                    dangerouslySetInnerHTML={{ __html: displayPromptHtml }}
                  />
                  {item.type !== "cloze" && (
                    <div className="mt-4 bg-gray-50 rounded-lg p-4 border-l-4 border-blue-500 text-sm text-gray-800 whitespace-pre-wrap">
                      {responseText}
                    </div>
                  )}

                  {item.candidateExplanationHtml && (
                    <ExplanationPanel html={item.candidateExplanationHtml} />
                  )}

                  {rubric.length > 0 && (
                    <div className="mt-5 border-t pt-4">
                      <div className="text-xs text-gray-500 mb-2">採点基準</div>
                      <div className="space-y-2">
                        {rubric.map((criterion) => {
                          const value = getEffectiveRubricOutcomes(item, itemResult)[criterion.index];
                          const criterionKey = makeCriterionKey(
                            currentResult.fileName,
                            item.identifier,
                            criterion.index
                          );
                          const criterionStatus = criterionSaveStatusByKey[criterionKey];
                          return (
                            <RubricScoringControl
                              key={criterion.index}
                              item={item}
                              criterion={criterion}
                              value={value}
                              saveStatus={criterionStatus}
                              saveStatusTestId={`save-status-${currentResult.fileName}-${item.identifier}-criterion-${criterion.index}`}
                              onChange={(next) => handleToggleCriterion(item.identifier, criterion.index, next)}
                            />
                          );
                        })}
                      </div>
                      <div className="mt-3">
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-xs font-medium text-gray-600">コメント</label>
                          <CommentSaveStatusIndicator
                            status={commentStatus}
                            testId={`save-status-${currentResult.fileName}-${item.identifier}-comment`}
                          />
                        </div>
                        <AutoResizeTextarea
                          className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          rows={2}
                          value={comment}
                          onChange={(value) => handleCommentChange(currentResult.fileName, item.identifier, value)}
                          onBlur={(value) => handleCommentBlur(currentResult.fileName, item.identifier, value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-white border rounded-lg p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <span className="bg-blue-600 text-white text-sm font-bold px-3 py-1 rounded-md">
                  問{currentItemIndex + 1}
                </span>
                <h2 className="text-lg font-semibold text-gray-800">{currentItem.title}</h2>
              </div>
              <div
                className="prose max-w-none qti-prompt"
                dangerouslySetInnerHTML={{ __html: currentItem.promptHtml }}
              />
              {currentItem.candidateExplanationHtml && (
                <ExplanationPanel html={currentItem.candidateExplanationHtml} />
              )}
            </div>

            <div className="space-y-4">
              <div
                className="text-xs text-gray-500"
                data-testid="item-result-progress"
                aria-live="polite"
              >
                受講者 {currentResultIndex + 1} / {results.length}
              </div>
              <EdgeScrollCandidateNavigator
                currentIndex={currentResultIndex}
                totalCount={results.length}
                resetKey={`${currentItem.identifier}:${currentResult.fileName}`}
                onNavigatePrevious={prevItemViewCandidate}
                onNavigateNext={nextItemViewCandidate}
              >
                <ItemCandidateCard
                  item={currentItem}
                  result={currentResult}
                  resultIndex={currentResultIndex}
                  resultCount={results.length}
                  criterionSaveStatusByKey={criterionSaveStatusByKey}
                  commentSaveStatusByKey={commentSaveStatusByKey}
                  onToggleCriterion={updateRubricOutcome}
                  onCommentChange={handleCommentChange}
                  onCommentBlur={handleCommentBlur}
                />
              </EdgeScrollCandidateNavigator>
            </div>
          </div>
        )}
        {viewMode === "item" && (
          <>
            <button
              type="button"
              onClick={() => setShowItemPreview(true)}
              className="fixed bottom-6 right-6 bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg hover:bg-blue-700 transition-colors"
            >
              設問を開く
            </button>
            {showItemPreview && (
              <div
                className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
                onClick={() => setShowItemPreview(false)}
                data-testid="item-preview-overlay"
              >
                <div
                  className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-800">設問プレビュー</h2>
                    <button
                      type="button"
                      onClick={() => setShowItemPreview(false)}
                      className="text-sm text-gray-600 hover:text-gray-800"
                    >
                      閉じる
                    </button>
                  </div>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="bg-blue-600 text-white text-sm font-bold px-3 py-1 rounded-md">
                      問{currentItemIndex + 1}
                    </span>
                    <h3 className="text-base font-semibold text-gray-800">{currentItem.title}</h3>
                  </div>
                  <div
                    className="prose max-w-none qti-prompt"
                    data-testid="item-preview-body"
                    dangerouslySetInnerHTML={{ __html: currentItem.promptHtml }}
                  />
                  {currentItem.candidateExplanationHtml && (
                    <ExplanationPanel html={currentItem.candidateExplanationHtml} />
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
