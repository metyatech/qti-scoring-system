import React, { useMemo, useState } from "react";
import { createSingleFlight } from "@/utils/asyncSingleFlight";

type ReportDownloadButtonProps = {
  workspaceId: string;
  workspaceName: string;
  onError?: (message: string) => void;
};

export default function ReportDownloadButton({
  workspaceId,
  workspaceName,
  onError,
}: ReportDownloadButtonProps) {
  const [downloading, setDownloading] = useState(false);
  const singleFlight = useMemo(() => createSingleFlight<void>(), []);

  const handleDownload = async () => {
    await singleFlight(async () => {
      onError?.("");
      setDownloading(true);
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/report/zip`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "レポートの生成に失敗しました");
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${workspaceName} report.zip`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "レポートの生成に失敗しました");
      } finally {
        setDownloading(false);
      }
    });
  };

  return (
    <button
      onClick={handleDownload}
      className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      disabled={downloading}
    >
      {downloading ? "レポート生成中..." : "結果レポートをダウンロード"}
    </button>
  );
}
