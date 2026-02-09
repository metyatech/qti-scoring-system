'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { QtiWorkspace } from '@/types/qti'
import { rewriteHtmlImageSources } from '@/utils/assetUrl'
import { applyResponsesToPromptHtml } from '@/utils/qtiBlankResponses'
import ExplanationPanel from '@/components/ExplanationPanel'
import ReportDownloadButton from '@/components/ReportDownloadButton'
import AutoResizeTextarea from '@/components/AutoResizeTextarea'
import {
  QtiItem,
  QtiResult,
  parseAssessmentTestXml,
  parseQtiItemXml,
  parseQtiResultsXml,
  remapResultToAssessmentItems,
} from '@/utils/qtiParsing'
import { getItemMaxScore, getItemScore, getRubricScore } from '@/utils/scoring'
import { buildCriteriaUpdate, updateItemComment } from '@/utils/resultUpdates'
import { useHighlightCodeBlocks } from '@/hooks/useHighlightCodeBlocks'
import { useIncrementalList } from '@/hooks/useIncrementalList'

const fetchFileText = async (workspaceId: string, kind: string, name: string) => {
  const res = await fetch(
    `/api/workspaces/${workspaceId}/files?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`,
  )
  if (!res.ok) {
    throw new Error(`ファイル取得に失敗: ${name}`)
  }
  return await res.text()
}

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [workspace, setWorkspace] = useState<QtiWorkspace | null>(null)
  const [items, setItems] = useState<QtiItem[]>([])
  const [results, setResults] = useState<QtiResult[]>([])
  const pageRef = useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'candidate' | 'item'>('item')
  const [currentResultIndex, setCurrentResultIndex] = useState(0)
  const [currentItemIndex, setCurrentItemIndex] = useState(0)
  const [showBasicInfo, setShowBasicInfo] = useState(false)
  const [loopMessage, setLoopMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showItemPreview, setShowItemPreview] = useState(false)
  const [saveStatusByKey, setSaveStatusByKey] = useState<Record<string, 'saving' | 'saved'>>({})
  const saveStatusTimersRef = useRef<Record<string, number>>({})

  const highlightDeps = useMemo(
    () => [viewMode, currentResultIndex, currentItemIndex, showItemPreview, items.length],
    [viewMode, currentResultIndex, currentItemIndex, showItemPreview, items.length],
  )
  const resultListKey = `${viewMode}:${currentItemIndex}`
  const { visibleItems: visibleResults, isComplete: isResultListComplete } = useIncrementalList(
    results,
    { batchSize: 10, delayMs: 16, resetKey: resultListKey },
  )

  useEffect(() => {
    if (!id) return
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const wsRes = await fetch(`/api/workspaces/${id}`)
        const wsJson = await wsRes.json()
        if (!wsRes.ok || !wsJson.success) {
          throw new Error(wsJson.error || 'ワークスペースの読み込みに失敗しました')
        }
        const ws: QtiWorkspace = wsJson.workspace
        setWorkspace(ws)
        if (!ws.assessmentTestFile) {
          throw new Error('assessment-test が見つかりません')
        }

        const assessmentTestXml = await fetchFileText(ws.id, 'assessment', ws.assessmentTestFile)
        const itemRefs = parseAssessmentTestXml(assessmentTestXml)
        if (ws.itemFiles.length !== itemRefs.length) {
          throw new Error('assessmentTest と設問ファイル数が一致しません')
        }

        const itemTexts = await Promise.all(
          ws.itemFiles.map((name) => fetchFileText(ws.id, 'assessment', name)),
        )
        const parsedItems = itemTexts.map((xml, index) => {
          const item = parseQtiItemXml(xml)
          const expectedIdentifier = itemRefs[index]?.identifier
          if (expectedIdentifier && item.identifier !== expectedIdentifier) {
            throw new Error(
              `assessmentTest と item identifier が一致しません: ${expectedIdentifier}`,
            )
          }
          return item
        })
        const itemsWithResolvedAssets = parsedItems.map((item, index) => {
          const baseFilePath = ws.itemFiles[index]
          const promptHtml = rewriteHtmlImageSources(item.promptHtml, ws.id, baseFilePath)
          const candidateExplanationHtml = item.candidateExplanationHtml
            ? rewriteHtmlImageSources(item.candidateExplanationHtml, ws.id, baseFilePath)
            : null
          return {
            ...item,
            promptHtml,
            candidateExplanationHtml,
          }
        })
        setItems(itemsWithResolvedAssets)

        const resultTexts = await Promise.all(
          ws.resultFiles.map((name) => fetchFileText(ws.id, 'results', name)),
        )
        const parsedResults = resultTexts.map((xml, index) =>
          parseQtiResultsXml(xml, ws.resultFiles[index]),
        )

        const mappedResults = parsedResults.map((result) => {
          const remapped = remapResultToAssessmentItems(result, itemRefs)
          if (remapped.missingResultIdentifiers.length > 0) {
            throw new Error(
              `assessmentTest に対応しない結果IDがあります (${result.fileName}): ${remapped.missingResultIdentifiers.join(', ')}`,
            )
          }
          if (remapped.duplicateItemIdentifiers.length > 0) {
            throw new Error(
              `同じ設問に複数の結果が割り当てられています (${result.fileName}): ${remapped.duplicateItemIdentifiers.join(', ')}`,
            )
          }
          return { ...result, itemResults: remapped.mappedItemResults }
        })
        setResults(mappedResults)
        setCurrentResultIndex(0)
        setCurrentItemIndex(0)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'ワークスペースの読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  useHighlightCodeBlocks(pageRef, highlightDeps, !loading)

  useEffect(() => {
    if (results.length === 0) return
    setCurrentResultIndex((prev) => Math.min(prev, results.length - 1))
  }, [results.length])

  useEffect(() => {
    if (items.length === 0) return
    setCurrentItemIndex((prev) => Math.min(prev, items.length - 1))
  }, [items.length])

  useEffect(() => {
    if (viewMode !== 'item') {
      setShowItemPreview(false)
    }
  }, [viewMode])

  useEffect(() => {
    if (!showItemPreview) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowItemPreview(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showItemPreview])

  const currentResult = results[currentResultIndex]
  const currentItem = items[currentItemIndex]

  const totalMaxScore = useMemo(
    () => items.reduce((sum, item) => sum + getItemMaxScore(item), 0),
    [items],
  )

  const currentScore = useMemo(() => {
    if (!currentResult) return 0
    return items.reduce((sum, item) => {
      const itemResult = currentResult.itemResults[item.identifier]
      const score = getItemScore(item, itemResult)
      return sum + (score ?? 0)
    }, 0)
  }, [currentResult, items])

  const showLoop = (message: string) => {
    setLoopMessage(message)
    setTimeout(() => setLoopMessage(null), 2000)
  }

  const makeCommentKey = (resultFile: string, itemId: string) => `${resultFile}::${itemId}::comment`
  const makeCriterionKey = (resultFile: string, itemId: string, criterionIndex: number) =>
    `${resultFile}::${itemId}::criterion::${criterionIndex}`

  const startSaveFeedback = (key: string) => {
    const existing = saveStatusTimersRef.current[key]
    if (existing) {
      window.clearTimeout(existing)
      delete saveStatusTimersRef.current[key]
    }
    setSaveStatusByKey((prev) => ({ ...prev, [key]: 'saving' }))
  }

  const finishSaveFeedback = (key: string, status: 'saved' | 'idle') => {
    setSaveStatusByKey((prev) => {
      const next = { ...prev }
      if (status === 'idle') {
        delete next[key]
      } else {
        next[key] = status
      }
      return next
    })
    if (status === 'saved') {
      const timer = window.setTimeout(() => {
        setSaveStatusByKey((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
        delete saveStatusTimersRef.current[key]
      }, 2000)
      saveStatusTimersRef.current[key] = timer
    }
  }

  useEffect(() => {
    return () => {
      Object.values(saveStatusTimersRef.current).forEach((timer) => window.clearTimeout(timer))
      saveStatusTimersRef.current = {}
    }
  }, [])

  const nextCandidate = () => {
    if (!results.length) return
    const nextIndex = (currentResultIndex + 1) % results.length
    if (currentResultIndex === results.length - 1) {
      showLoop('最後から最初の受講者に戻りました')
    }
    setCurrentResultIndex(nextIndex)
  }

  const prevCandidate = () => {
    if (!results.length) return
    const prevIndex = (currentResultIndex - 1 + results.length) % results.length
    if (currentResultIndex === 0) {
      showLoop('最初から最後の受講者に移動しました')
    }
    setCurrentResultIndex(prevIndex)
  }

  const nextItem = () => {
    if (!items.length) return
    const nextIndex = (currentItemIndex + 1) % items.length
    if (currentItemIndex === items.length - 1) {
      showLoop('最後から最初の設問に戻りました')
    }
    setCurrentItemIndex(nextIndex)
  }

  const prevItem = () => {
    if (!items.length) return
    const prevIndex = (currentItemIndex - 1 + items.length) % items.length
    if (currentItemIndex === 0) {
      showLoop('最初から最後の設問に移動しました')
    }
    setCurrentItemIndex(prevIndex)
  }

  const formatResponse = (item: QtiItem, itemResult?: QtiResult['itemResults'][string]) => {
    if (!itemResult || itemResult.response === null || itemResult.response === undefined) {
      return '（回答なし）'
    }
    if (Array.isArray(itemResult.response)) {
      return itemResult.response.join(' / ')
    }
    if (item.type === 'choice') {
      const choice = item.choices.find((c) => c.identifier === itemResult.response)
      return choice ? `${choice.text} (${itemResult.response})` : String(itemResult.response)
    }
    return String(itemResult.response)
  }

  const updateCriteria = async (
    resultFile: string,
    itemId: string,
    criterionIndex: number,
    value: boolean,
  ) => {
    const item = items.find((i) => i.identifier === itemId)
    if (!item || item.rubric.length === 0) return
    const criteria = buildCriteriaUpdate(item.rubric, criterionIndex, value)
    await fetch(`/api/workspaces/${id}/results`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resultFile,
        items: [{ identifier: itemId, criteria }],
      }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || '採点結果の更新に失敗しました')
      }
    })
  }

  const updateComment = async (resultFile: string, itemId: string, comment: string) => {
    await fetch(`/api/workspaces/${id}/results`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resultFile,
        items: [{ identifier: itemId, comment }],
      }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'コメントの更新に失敗しました')
      }
    })
  }

  const updateRubricOutcome = async (
    resultFile: string,
    itemId: string,
    criterionIndex: number,
    value: boolean,
  ) => {
    const prevResults = results
    setSaving(true)
    setError(null)
    const saveKey = makeCriterionKey(resultFile, itemId, criterionIndex)
    startSaveFeedback(saveKey)
    let nextRubricOutcomes: Record<number, boolean> = {}
    setResults((prev) =>
      prev.map((res) => {
        if (res.fileName !== resultFile) return res
        const itemResult = res.itemResults[itemId] || {
          resultIdentifier: itemId,
          response: null,
          rubricOutcomes: {},
        }
        nextRubricOutcomes = { ...itemResult.rubricOutcomes, [criterionIndex]: value }
        const item = items.find((i) => i.identifier === itemId)
        const score = item ? getRubricScore(item, nextRubricOutcomes) : itemResult.score
        return {
          ...res,
          itemResults: {
            ...res.itemResults,
            [itemId]: { ...itemResult, rubricOutcomes: nextRubricOutcomes, score },
          },
        }
      }),
    )

    try {
      await updateCriteria(resultFile, itemId, criterionIndex, value)
      finishSaveFeedback(saveKey, 'saved')
    } catch (err) {
      setResults(prevResults)
      setError(err instanceof Error ? err.message : '採点結果の更新に失敗しました')
      finishSaveFeedback(saveKey, 'idle')
    } finally {
      setSaving(false)
    }
  }

  const updateResultComment = async (resultFile: string, itemId: string, comment: string) => {
    const prevResults = results
    setSaving(true)
    setError(null)
    const saveKey = makeCommentKey(resultFile, itemId)
    startSaveFeedback(saveKey)
    setResults((prev) => updateItemComment(prev, resultFile, itemId, comment))

    try {
      await updateComment(resultFile, itemId, comment)
      finishSaveFeedback(saveKey, 'saved')
    } catch (err) {
      setResults(prevResults)
      setError(err instanceof Error ? err.message : 'コメントの更新に失敗しました')
      finishSaveFeedback(saveKey, 'idle')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleCriterion = async (itemId: string, criterionIndex: number, value: boolean) => {
    if (!currentResult) return
    await updateRubricOutcome(currentResult.fileName, itemId, criterionIndex, value)
  }

  const handleCommentBlur = async (itemId: string, comment: string) => {
    if (!currentResult) return
    await updateResultComment(currentResult.fileName, itemId, comment)
  }

  const handleCommentChange = (resultFile: string, itemId: string, comment: string) => {
    setResults((prev) => updateItemComment(prev, resultFile, itemId, comment))
  }

  const handleReportError = (message: string) => {
    if (!message) {
      setError(null)
      return
    }
    setError(message)
  }

  const handleExportWorkspace = () => {
    if (!workspace) return
    window.location.href = `/api/workspaces/${workspace.id}/export`
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-500">読み込み中...</div>
  }

  if (!workspace) {
    return <div className="p-8 text-center text-gray-500">ワークスペースが見つかりません</div>
  }
  if (!currentResult && error) {
    return <div className="p-8 text-center text-red-600">{error}</div>
  }
  if (!currentResult) {
    return <div className="p-8 text-center text-gray-500">結果データがありません</div>
  }
  if (!currentItem) {
    return <div className="p-8 text-center text-gray-500">設問データがありません</div>
  }

  return (
    <div ref={pageRef} className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <header className="mb-6 text-center">
          <h1 className="mb-2 text-3xl font-bold text-gray-800">QTI 3.0 採点システム</h1>
          <p className="text-gray-600">ワークスペース: {workspace.name}</p>
        </header>

        {error && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => router.push('/')}
            className="rounded bg-gray-600 px-4 py-2 text-white transition-colors hover:bg-gray-700"
          >
            ワークスペース一覧に戻る
          </button>
          <button
            onClick={handleExportWorkspace}
            className="rounded bg-gray-800 px-4 py-2 text-white transition-colors hover:bg-gray-900"
          >
            このワークスペースをエクスポート
          </button>
          <ReportDownloadButton
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            onError={handleReportError}
          />
          {saving && <span className="sr-only">更新中...</span>}
        </div>

        <div className="sticky top-0 z-10 mb-6 rounded-lg border bg-white p-4 shadow-sm">
          {loopMessage && (
            <div className="mb-3 rounded-md border border-yellow-300 bg-yellow-100 p-2 text-center text-sm text-yellow-800">
              {loopMessage}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              {viewMode === 'candidate' ? (
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
                        合計: <span className="text-blue-600">{currentScore}</span> /{' '}
                        {totalMaxScore}
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
                className="text-sm text-blue-600 underline hover:text-blue-800"
              >
                {showBasicInfo ? '詳細を隠す' : '詳細を表示'}
              </button>
            </div>
            <div className="flex gap-2">
              <div className="flex overflow-hidden rounded-md border border-gray-200">
                <button
                  onClick={() => setViewMode('item')}
                  className={`px-3 py-2 text-sm ${viewMode === 'item' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  設問ごと
                </button>
                <button
                  onClick={() => setViewMode('candidate')}
                  className={`px-3 py-2 text-sm ${viewMode === 'candidate' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  受講者ごと
                </button>
              </div>
              {viewMode === 'candidate' ? (
                <>
                  <button
                    onClick={prevCandidate}
                    disabled={results.length <= 1}
                    className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    ← 前
                  </button>
                  <button
                    onClick={nextCandidate}
                    disabled={results.length <= 1}
                    className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    次 →
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={prevItem}
                    disabled={items.length <= 1}
                    className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    ← 前
                  </button>
                  <button
                    onClick={nextItem}
                    disabled={items.length <= 1}
                    className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    次 →
                  </button>
                </>
              )}
            </div>
          </div>
          {showBasicInfo && (
            <>
              {viewMode === 'candidate' ? (
                <div className="mt-4 grid grid-cols-2 gap-4 border-t border-gray-200 pt-4 text-sm md:grid-cols-3">
                  <div>
                    <span className="text-gray-500">sourcedId:</span>{' '}
                    {currentResult.sourcedId || '未設定'}
                  </div>
                  <div>
                    <span className="text-gray-500">result file:</span> {currentResult.fileName}
                  </div>
                  <div>
                    <span className="text-gray-500">items:</span> {items.length}
                  </div>
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-4 border-t border-gray-200 pt-4 text-sm md:grid-cols-3">
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

        {viewMode === 'candidate' ? (
          <div className="space-y-6">
            {items.map((item, index) => {
              const itemResult = currentResult.itemResults[item.identifier]
              const responseText = formatResponse(item, itemResult)
              const displayPromptHtml =
                item.type === 'cloze'
                  ? applyResponsesToPromptHtml(item.promptHtml, itemResult?.response)
                  : item.promptHtml
              const rubric = item.rubric
              const comment = itemResult?.comment ?? ''
              const commentKey = makeCommentKey(currentResult.fileName, item.identifier)
              const commentStatus = saveStatusByKey[commentKey]
              return (
                <div key={item.identifier} className="rounded-lg border bg-white p-6 shadow-sm">
                  <div className="mb-3 flex items-center gap-3">
                    <span className="rounded-md bg-blue-600 px-3 py-1 text-sm font-bold text-white">
                      問{index + 1}
                    </span>
                    <h2 className="text-lg font-semibold text-gray-800">{item.title}</h2>
                  </div>
                  <div
                    className="prose qti-prompt max-w-none"
                    dangerouslySetInnerHTML={{ __html: displayPromptHtml }}
                  />
                  {item.type !== 'cloze' && (
                    <div className="mt-4 rounded-lg border-l-4 border-blue-500 bg-gray-50 p-4 text-sm whitespace-pre-wrap text-gray-800">
                      {responseText}
                    </div>
                  )}

                  {item.candidateExplanationHtml && (
                    <ExplanationPanel html={item.candidateExplanationHtml} />
                  )}

                  {rubric.length > 0 && (
                    <div className="mt-5 border-t pt-4">
                      <div className="mb-2 text-xs text-gray-500">採点基準</div>
                      <div className="space-y-2">
                        {rubric.map((criterion) => {
                          const value = itemResult?.rubricOutcomes[criterion.index]
                          const criterionKey = makeCriterionKey(
                            currentResult.fileName,
                            item.identifier,
                            criterion.index,
                          )
                          const criterionStatus = saveStatusByKey[criterionKey]
                          return (
                            <div key={criterion.index} className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleCriterion(item.identifier, criterion.index, true)
                                }
                                className={`rounded border px-2 py-1 text-xs ${value === true ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 bg-white text-gray-600'}`}
                              >
                                〇
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleCriterion(item.identifier, criterion.index, false)
                                }
                                className={`rounded border px-2 py-1 text-xs ${value === false ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300 bg-white text-gray-600'}`}
                              >
                                ×
                              </button>
                              <span className="text-xs text-gray-700">
                                [{criterion.points}] {criterion.text}
                              </span>
                              {criterionStatus && (
                                <span
                                  className={`text-xs ${criterionStatus === 'saving' ? 'text-gray-500' : 'text-green-600'}`}
                                  data-testid={`save-status-${currentResult.fileName}-${item.identifier}-criterion-${criterion.index}`}
                                  aria-live="polite"
                                >
                                  {criterionStatus === 'saving' ? '保存中...' : '保存しました'}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between">
                          <label className="block text-xs font-medium text-gray-600">
                            コメント
                          </label>
                          {commentStatus && (
                            <span
                              className={`text-xs ${commentStatus === 'saving' ? 'text-gray-500' : 'text-green-600'}`}
                              data-testid={`save-status-${currentResult.fileName}-${item.identifier}-comment`}
                              aria-live="polite"
                            >
                              {commentStatus === 'saving' ? '保存中...' : '保存しました'}
                            </span>
                          )}
                        </div>
                        <AutoResizeTextarea
                          className="w-full rounded border px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          rows={2}
                          value={comment}
                          onChange={(value) =>
                            handleCommentChange(currentResult.fileName, item.identifier, value)
                          }
                          onBlur={(value) => handleCommentBlur(item.identifier, value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-lg border bg-white p-6 shadow-sm">
              <div className="mb-3 flex items-center gap-3">
                <span className="rounded-md bg-blue-600 px-3 py-1 text-sm font-bold text-white">
                  問{currentItemIndex + 1}
                </span>
                <h2 className="text-lg font-semibold text-gray-800">{currentItem.title}</h2>
              </div>
              <div
                className="prose qti-prompt max-w-none"
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
                受講者: {visibleResults.length} / {results.length}
                {!isResultListComplete && ' (読み込み中...)'}
              </div>
              {visibleResults.map((result) => {
                const itemResult = result.itemResults[currentItem.identifier]
                const responseText = formatResponse(currentItem, itemResult)
                const comment = itemResult?.comment ?? ''
                const itemScore = getItemScore(currentItem, itemResult)
                const commentKey = makeCommentKey(result.fileName, currentItem.identifier)
                const commentStatus = saveStatusByKey[commentKey]
                return (
                  <div key={result.fileName} className="rounded-lg border bg-white p-6 shadow-sm">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-base font-semibold text-gray-800">
                        {result.candidateName}
                      </div>
                      {currentItem.rubric.length > 0 && (
                        <span className="text-sm text-gray-600">
                          得点: <span className="text-blue-600">{itemScore ?? 0}</span> /{' '}
                          {getItemMaxScore(currentItem)}
                        </span>
                      )}
                    </div>
                    <div className="rounded-lg border-l-4 border-blue-500 bg-gray-50 p-4 text-sm whitespace-pre-wrap text-gray-800">
                      {responseText}
                    </div>

                    {currentItem.rubric.length > 0 && (
                      <div className="mt-5 border-t pt-4">
                        <div className="mb-2 text-xs text-gray-500">採点基準</div>
                        <div className="space-y-2">
                          {currentItem.rubric.map((criterion) => {
                            const value = itemResult?.rubricOutcomes[criterion.index]
                            const criterionKey = makeCriterionKey(
                              result.fileName,
                              currentItem.identifier,
                              criterion.index,
                            )
                            const criterionStatus = saveStatusByKey[criterionKey]
                            return (
                              <div key={criterion.index} className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateRubricOutcome(
                                      result.fileName,
                                      currentItem.identifier,
                                      criterion.index,
                                      true,
                                    )
                                  }
                                  className={`rounded border px-2 py-1 text-xs ${value === true ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 bg-white text-gray-600'}`}
                                >
                                  〇
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateRubricOutcome(
                                      result.fileName,
                                      currentItem.identifier,
                                      criterion.index,
                                      false,
                                    )
                                  }
                                  className={`rounded border px-2 py-1 text-xs ${value === false ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300 bg-white text-gray-600'}`}
                                >
                                  ×
                                </button>
                                <span className="text-xs text-gray-700">
                                  [{criterion.points}] {criterion.text}
                                </span>
                                {criterionStatus && (
                                  <span
                                    className={`text-xs ${criterionStatus === 'saving' ? 'text-gray-500' : 'text-green-600'}`}
                                    data-testid={`save-status-${result.fileName}-${currentItem.identifier}-criterion-${criterion.index}`}
                                    aria-live="polite"
                                  >
                                    {criterionStatus === 'saving' ? '保存中...' : '保存しました'}
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                        <div className="mt-3">
                          <div className="mb-1 flex items-center justify-between">
                            <label className="block text-xs font-medium text-gray-600">
                              コメント
                            </label>
                            {commentStatus && (
                              <span
                                className={`text-xs ${commentStatus === 'saving' ? 'text-gray-500' : 'text-green-600'}`}
                                data-testid={`save-status-${result.fileName}-${currentItem.identifier}-comment`}
                                aria-live="polite"
                              >
                                {commentStatus === 'saving' ? '保存中...' : '保存しました'}
                              </span>
                            )}
                          </div>
                          <AutoResizeTextarea
                            className="w-full rounded border px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            rows={2}
                            value={comment}
                            onChange={(value) =>
                              handleCommentChange(result.fileName, currentItem.identifier, value)
                            }
                            onBlur={(value) =>
                              updateResultComment(result.fileName, currentItem.identifier, value)
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {viewMode === 'item' && (
          <>
            <button
              type="button"
              onClick={() => setShowItemPreview(true)}
              className="fixed right-6 bottom-6 rounded-full bg-blue-600 px-4 py-2 text-white shadow-lg transition-colors hover:bg-blue-700"
            >
              設問を開く
            </button>
            {showItemPreview && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                onClick={() => setShowItemPreview(false)}
                data-testid="item-preview-overlay"
              >
                <div
                  className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-800">設問プレビュー</h2>
                    <button
                      type="button"
                      onClick={() => setShowItemPreview(false)}
                      className="text-sm text-gray-600 hover:text-gray-800"
                    >
                      閉じる
                    </button>
                  </div>
                  <div className="mb-3 flex items-center gap-3">
                    <span className="rounded-md bg-blue-600 px-3 py-1 text-sm font-bold text-white">
                      問{currentItemIndex + 1}
                    </span>
                    <h3 className="text-base font-semibold text-gray-800">{currentItem.title}</h3>
                  </div>
                  <div
                    className="prose qti-prompt max-w-none"
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
  )
}
