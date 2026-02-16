"use client";

import { useRouter } from "next/navigation";
import QtiUpload from "@/components/QtiUpload";

export default function NewWorkspacePage() {
  const router = useRouter();

  const handleWorkspaceCreated = (workspaceId: string) => {
    router.push(`/workspace/${workspaceId}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            新しいワークスペースを作成
          </h1>
          <button
            onClick={() => router.push("/")}
            className="text-blue-600 hover:text-blue-800 underline"
          >
            ← ワークスペース一覧に戻る
          </button>
        </div>

        <QtiUpload onWorkspaceCreated={handleWorkspaceCreated} />
      </div>
    </div>
  );
}
