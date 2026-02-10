"use client";

import { useState, useEffect, useRef } from "react";
import { QtiWorkspaceSummary } from "@/types/qti";

interface WorkspaceSelectorProps {
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateNew: () => void;
}

export default function WorkspaceSelector({
  onSelectWorkspace,
  onCreateNew,
}: WorkspaceSelectorProps) {
  const [workspaces, setWorkspaces] = useState<QtiWorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(
    new Set()
  );
  const [editingWorkspace, setEditingWorkspace] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "" });
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/workspaces");
      const data = await response.json();

      if (data.success) {
        setWorkspaces(data.workspaces);
      } else {
        setError("ワークスペースの読み込みに失敗しました");
      }
    } catch (error) {
      console.error("ワークスペース読み込みエラー:", error);
      setError("ワークスペースの読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWorkspace = async (
    workspaceId: string,
    workspaceName: string
  ) => {
    if (
      !confirm(`ワークスペース「${workspaceName}」を削除してもよろしいですか？`)
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        // ワークスペース一覧を再読み込み
        loadWorkspaces();
      } else {
        setError("ワークスペースの削除に失敗しました");
      }
    } catch (error) {
      console.error("ワークスペース削除エラー:", error);
      setError("ワークスペースの削除に失敗しました");
    }
  };

  const toggleWorkspaceDetails = (workspaceId: string) => {
    setExpandedWorkspaces((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(workspaceId)) {
        newSet.delete(workspaceId);
      } else {
        newSet.add(workspaceId);
      }
      return newSet;
    });
  };

  const startEditWorkspace = (workspace: QtiWorkspaceSummary) => {
    setEditingWorkspace(workspace.id);
    setEditForm({
      name: workspace.name,
      description: workspace.description || "",
    });
  };

  const cancelEdit = () => {
    setEditingWorkspace(null);
    setEditForm({ name: "", description: "" });
  };

  const saveEdit = async () => {
    if (!editingWorkspace || !editForm.name.trim()) {
      setError("ワークスペース名は必須です");
      return;
    }

    try {
      const response = await fetch(`/api/workspaces/${editingWorkspace}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editForm.name.trim(),
          description: editForm.description.trim() || undefined,
        }),
      });

      if (response.ok) {
        cancelEdit();
        loadWorkspaces(); // ワークスペース一覧を再読み込み
      } else {
        const result = await response.json();
        setError(result.error || "ワークスペースの更新に失敗しました");
      }
    } catch (error) {
      console.error("ワークスペース更新エラー:", error);
      setError("ワークスペースの更新に失敗しました");
    }
  };

  const handleImport = async () => {
    if (!importFile) {
      setError("インポートするZIPファイルを選択してください");
      return;
    }

    setImporting(true);
    setImportSuccess(null);
    try {
      const runImport = async (mode: "reject" | "overwrite") => {
        const form = new FormData();
        form.append("archive", importFile);
        form.append("mode", mode);
        return await fetch("/api/workspaces/import", {
          method: "POST",
          body: form,
        });
      };

      const response = await runImport("reject");

      if (response.ok) {
        const result = await response.json();
        setImportSuccess(`インポート完了: ${result.importedCount ?? 0}件`);
        setImportFile(null);
        if (importInputRef.current) {
          importInputRef.current.value = "";
        }
        loadWorkspaces();
        return;
      }

      if (response.status === 409) {
        const result = await response.json().catch(() => ({}));
        const shouldOverwrite = confirm(
          result.error || "同じIDのワークスペースが存在します。上書きしますか？"
        );
        if (!shouldOverwrite) {
          return;
        }
        const overwriteResponse = await runImport("overwrite");
        if (overwriteResponse.ok) {
          const overwriteResult = await overwriteResponse.json();
          setImportSuccess(
            `インポート完了: ${overwriteResult.importedCount ?? 0}件`
          );
          setImportFile(null);
          if (importInputRef.current) {
            importInputRef.current.value = "";
          }
          loadWorkspaces();
          return;
        }
        const overwriteError = await overwriteResponse.json().catch(() => ({}));
        setError(
          overwriteError.error || "ワークスペースのインポートに失敗しました"
        );
        return;
      }

      const result = await response.json().catch(() => ({}));
      setError(result.error || "ワークスペースのインポートに失敗しました");
    } catch (error) {
      console.error("ワークスペースインポートエラー:", error);
      setError("ワークスペースのインポートに失敗しました");
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-96 items-center justify-center">
        <div className="text-lg">ワークスペースを読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold text-gray-900">
          QTI 3.0 採点システム
        </h1>
        <p className="text-gray-600">
          ワークスペースを選択するか、新しいワークスペースを作成してください（QTI
          3.0 item / Results Reporting 対応）
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-red-800">{error}</div>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-sm text-red-600 underline"
          >
            閉じる
          </button>
        </div>
      )}

      <div className="mb-8">
        <button
          onClick={onCreateNew}
          className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700"
        >
          新しいワークスペースを作成
        </button>
      </div>

      <div className="mb-10 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          ワークスペースのインポート
        </h2>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-[260px] flex-1">
            <label
              htmlFor="workspaceImportFile"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              エクスポートZIPをインポート
            </label>
            <input
              id="workspaceImportFile"
              type="file"
              accept=".zip"
              ref={importInputRef}
              onChange={(event) =>
                setImportFile(event.target.files?.[0] ?? null)
              }
              className="block w-full text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-gray-700 hover:file:bg-gray-200"
            />
            <button
              onClick={handleImport}
              disabled={importing}
              className="mt-2 rounded bg-green-600 px-4 py-2 text-white transition-colors hover:bg-green-700 disabled:bg-green-400"
            >
              {importing ? "インポート中..." : "インポート実行"}
            </button>
            <p className="mt-1 text-xs text-gray-500">
              同じIDのワークスペースがある場合は上書きするか確認します
            </p>
            {importSuccess && (
              <div className="mt-2 text-sm text-green-700">{importSuccess}</div>
            )}
          </div>
        </div>
      </div>

      {workspaces.length > 0 && (
        <div>
          <h2 className="mb-4 text-xl font-semibold text-gray-900">
            既存のワークスペース
          </h2>
          <div className="grid gap-4">
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                className="rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-300"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    {editingWorkspace === workspace.id ? (
                      // 編集モード
                      <div className="space-y-3">
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            ワークスペース名 *
                          </label>
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) =>
                              setEditForm((prev) => ({
                                ...prev,
                                name: e.target.value,
                              }))
                            }
                            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            説明（任意）
                          </label>
                          <textarea
                            value={editForm.description}
                            onChange={(e) =>
                              setEditForm((prev) => ({
                                ...prev,
                                description: e.target.value,
                              }))
                            }
                            rows={2}
                            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={saveEdit}
                            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
                          >
                            保存
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded bg-gray-500 px-3 py-1 text-sm text-white hover:bg-gray-600"
                          >
                            キャンセル
                          </button>
                        </div>
                      </div>
                    ) : (
                      // 表示モード
                      <>
                        <div className="mb-2 flex items-center gap-2">
                          <h3 className="text-lg font-medium text-gray-900">
                            {workspace.name}
                          </h3>
                          <button
                            onClick={() => toggleWorkspaceDetails(workspace.id)}
                            className="text-sm text-gray-400 hover:text-gray-600"
                            title="詳細を表示/非表示"
                          >
                            {expandedWorkspaces.has(workspace.id) ? "▼" : "▶"}
                          </button>
                        </div>
                        {workspace.description && (
                          <p className="mb-2 text-gray-600">
                            {workspace.description}
                          </p>
                        )}
                        {expandedWorkspaces.has(workspace.id) && (
                          <div className="mt-2 rounded bg-gray-50 p-3 text-sm text-gray-500">
                            <div className="grid grid-cols-2 gap-2">
                              <span>🧩 Items: {workspace.itemCount}件</span>
                              <span>📄 Results: {workspace.resultCount}件</span>
                              <span>
                                📅 作成日:{" "}
                                {new Date(
                                  workspace.createdAt
                                ).toLocaleDateString("ja-JP")}
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {editingWorkspace !== workspace.id && (
                    <div className="ml-4 flex gap-2">
                      <button
                        onClick={() => onSelectWorkspace(workspace.id)}
                        className="rounded bg-green-600 px-4 py-2 text-white transition-colors hover:bg-green-700"
                      >
                        開く
                      </button>
                      <button
                        onClick={() => startEditWorkspace(workspace)}
                        className="rounded bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
                      >
                        編集
                      </button>
                      <button
                        onClick={() =>
                          handleDeleteWorkspace(workspace.id, workspace.name)
                        }
                        className="rounded bg-red-600 px-4 py-2 text-white transition-colors hover:bg-red-700"
                      >
                        削除
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {workspaces.length === 0 && !loading && (
        <div className="py-12 text-center">
          <div className="mb-4 text-gray-500">
            まだワークスペースがありません
          </div>
          <div className="text-sm text-gray-400">
            「新しいワークスペースを作成」ボタンから始めてください
          </div>
        </div>
      )}
    </div>
  );
}
