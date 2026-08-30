"use client";

import { useEffect, useState } from "react";

type CandidateResourceSummary = {
  id: string;
  label: string;
  type: "folder";
};

type CandidateResourceButtonsProps = {
  workspaceId: string;
  resultFile: string;
};

export default function CandidateResourceButtons({
  workspaceId,
  resultFile
}: CandidateResourceButtonsProps) {
  const [resources, setResources] = useState<CandidateResourceSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setResources([]);
    setError(null);
    setOpeningId(null);
    void fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/candidate-resources?resultFile=${encodeURIComponent(resultFile)}`,
      { signal: controller.signal }
    )
      .then(async (response) => {
        const payload = (await response.json()) as { resources?: CandidateResourceSummary[]; error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(payload.error || "提出物情報の取得に失敗しました");
        setResources(Array.isArray(payload.resources) ? payload.resources : []);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        if (cause instanceof Error) setError(cause.message);
        else setError("提出物情報の取得に失敗しました");
      });
    return () => controller.abort();
  }, [workspaceId, resultFile]);

  const openResource = async (resourceId: string) => {
    setOpeningId(resourceId);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/candidate-resources`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resultFile, resourceId })
        }
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "提出物を開けませんでした");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "提出物を開けませんでした");
    } finally {
      setOpeningId(null);
    }
  };

  if (resources.length === 0 && error === null) return null;

  return (
    <div className="flex items-center gap-2" data-testid="candidate-resource-buttons">
      {resources.map((resource) => (
        <button
          key={resource.id}
          type="button"
          disabled={openingId !== null}
          onClick={() => void openResource(resource.id)}
          className="px-3 py-2 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
        >
          {openingId === resource.id ? "準備中..." : resource.label}
        </button>
      ))}
      {error !== null && (
        <span className="text-sm text-red-700" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
