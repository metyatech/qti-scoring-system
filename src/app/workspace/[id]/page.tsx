"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QtiWorkspace } from "@/types/qti";
import { highlightCodeBlocks } from "@/utils/highlight";
import { rewriteHtmlImageSources } from "@/utils/assetUrl";
import { applyResponsesToPromptHtml } from "@/utils/qtiBlankResponses";
import ExplanationPanel from "@/components/ExplanationPanel";
import ReportDownloadButton from "@/components/ReportDownloadButton";
import AutoResizeTextarea from "@/components/AutoResizeTextarea";
import {
  QtiItem,
  QtiResult,
  parseAssessmentTestXml,
  parseQtiItemXml,
  parseQtiResultsXml,
  remapResultToAssessmentItems,
} from "@/utils/qtiParsing";
import { getItemMaxScore, getItemScore, getRubricScore } from "@/utils/scoring";
import { updateItemComment } from "@/utils/resultUpdates";

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
        setCurrentResultIndex(0);
        setCurrentItemIndex(0);
      } catch (err) {
        setError(err instanceof Error ? err.message : "ワークスペースの読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  useEffect(() => {
    if (loading || !pageRef.current) return;
    const root = pageRef.current;
    const runHighlight = () => highlightCodeBlocks(root);

    runHighlight();

    const observer = new MutationObserver(() => {
      runHighlight();
    });
    observer.observe(root, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [loading]);

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

  const formatResponse = (item: QtiItem, itemResult?: QtiResult["itemResults"][string]) => {
    if (!itemResult || itemResult.response === null || itemResult.response === undefined) {
      return "（回答なし）";
    }
    if (Array.isArray(itemResult.response)) {
      return itemResult.response.join(" / ");
    }
    if (item.type === "choice") {
      const choice = item.choices.find((c) => c.identifier === itemResult.response);
      return choice ? `${choice.text} (${itemResult.response})` : String(itemResult.response);
    }
    return String(itemResult.response);
  };

  const updateCriteria = async (
    resultFile: string,
    itemId: string,
    rubricOutcomes: Record<number, boolean>
  ) => {
    const item = items.find((i) => i.identifier === itemId);
    if (!item || item.rubric.length === 0) return;
    const criteria = item.rubric.map((c) => ({
      met: rubricOutcomes[c.index] ?? false,
      criterionText: c.text,
    }));
    await fetch(`/api/workspaces/${id}/results`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resultFile,
        items: [{ identifier: itemId, criteria }],
      }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "採点結果の更新に失敗しました");
      }
    });
  };

  const updateComment = async (resultFile: string, itemId: string, comment: string) => {
    await fetch(`/api/workspaces/${id}/results`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resultFile,
        items: [{ identifier: itemId, comment }],
      }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "コメントの更新に失敗しました");
      }
    });
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
        const score = item ? getRubricScore(item, nextRubricOutcomes) : itemResult.score;
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
      await updateCriteria(resultFile, itemId, nextRubricOutcomes);
    } catch (err) {
      setResults(prevResults);
      setError(err instanceof Error ? err.message : "採点結果の更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const updateResultComment = async (resultFile: string, itemId: string, comment: string) => {
    const prevResults = results;
    setSaving(true);
    setError(null);
    setResults((prev) => updateItemComment(prev, resultFile, itemId, comment));

    try {
      await updateComment(resultFile, itemId, comment);
    } catch (err) {
      setResults(prevResults);
      setError(err instanceof Error ? err.message : "コメントの更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCriterion = async (itemId: string, criterionIndex: number, value: boolean) => {
    if (!currentResult) return;
    await updateRubricOutcome(currentResult.fileName, itemId, criterionIndex, value);
  };

  const handleCommentBlur = async (itemId: string, comment: string) => {
    if (!currentResult) return;
    await updateResultComment(currentResult.fileName, itemId, comment);
  };

  const handleCommentChange = (resultFile: string, itemId: string, comment: string) => {
    setResults((prev) => updateItemComment(prev, resultFile, itemId, comment));
  };

  const handleReportError = (message: string) => {
    if (!message) {
      setError(null);
      return;
    }
    setError(message);
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
            onClick={() => router.push("/")}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
          >
            ワークスペース一覧に戻る
          </button>
          <ReportDownloadButton
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            onError={handleReportError}
          />
          {saving && <span className="text-sm text-gray-500">更新中...</span>}
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
                          const value = itemResult?.rubricOutcomes[criterion.index];
                          return (
                            <div key={criterion.index} className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleToggleCriterion(item.identifier, criterion.index, true)}
                                className={`px-2 py-1 rounded text-xs border ${value === true ? "bg-green-600 text-white border-green-600" : "bg-white text-gray-600 border-gray-300"}`}
                              >
                                〇
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleCriterion(item.identifier, criterion.index, false)}
                                className={`px-2 py-1 rounded text-xs border ${value === false ? "bg-red-600 text-white border-red-600" : "bg-white text-gray-600 border-gray-300"}`}
                              >
                                ×
                              </button>
                              <span className="text-xs text-gray-700">
                                [{criterion.points}] {criterion.text}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-3">
                        <label className="block text-xs font-medium text-gray-600 mb-1">コメント</label>
                        <AutoResizeTextarea
                          className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          rows={2}
                          value={comment}
                          onChange={(value) => handleCommentChange(currentResult.fileName, item.identifier, value)}
                          onBlur={(value) => handleCommentBlur(item.identifier, value)}
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
              {results.map((result) => {
                const itemResult = result.itemResults[currentItem.identifier];
                const responseText = formatResponse(currentItem, itemResult);
                const comment = itemResult?.comment ?? "";
                const itemScore = getItemScore(currentItem, itemResult);
                return (
                  <div key={result.fileName} className="bg-white border rounded-lg p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                      <div className="text-base font-semibold text-gray-800">{result.candidateName}</div>
                      {currentItem.rubric.length > 0 && (
                        <span className="text-sm text-gray-600">
                          得点: <span className="text-blue-600">{itemScore ?? 0}</span> / {getItemMaxScore(currentItem)}
                        </span>
                      )}
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4 border-l-4 border-blue-500 text-sm text-gray-800 whitespace-pre-wrap">
                      {responseText}
                    </div>

                    {currentItem.rubric.length > 0 && (
                      <div className="mt-5 border-t pt-4">
                        <div className="text-xs text-gray-500 mb-2">採点基準</div>
                        <div className="space-y-2">
                          {currentItem.rubric.map((criterion) => {
                            const value = itemResult?.rubricOutcomes[criterion.index];
                            return (
                              <div key={criterion.index} className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateRubricOutcome(result.fileName, currentItem.identifier, criterion.index, true)
                                  }
                                  className={`px-2 py-1 rounded text-xs border ${value === true ? "bg-green-600 text-white border-green-600" : "bg-white text-gray-600 border-gray-300"}`}
                                >
                                  〇
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateRubricOutcome(result.fileName, currentItem.identifier, criterion.index, false)
                                  }
                                  className={`px-2 py-1 rounded text-xs border ${value === false ? "bg-red-600 text-white border-red-600" : "bg-white text-gray-600 border-gray-300"}`}
                                >
                                  ×
                                </button>
                                <span className="text-xs text-gray-700">
                                  [{criterion.points}] {criterion.text}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-3">
                          <label className="block text-xs font-medium text-gray-600 mb-1">コメント</label>
                          <AutoResizeTextarea
                            className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            rows={2}
                            value={comment}
                            onChange={(value) => handleCommentChange(result.fileName, currentItem.identifier, value)}
                            onBlur={(value) => updateResultComment(result.fileName, currentItem.identifier, value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
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
