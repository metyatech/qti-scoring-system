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
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold text-gray-800">
            新しいワークスペースを作成
          </h1>
          <button
            onClick={() => router.push("/")}
            className="text-blue-600 underline hover:text-blue-800"
          >
            ← ワークスペース一覧に戻る
          </button>
        </div>

        <QtiUpload onWorkspaceCreated={handleWorkspaceCreated} />
      </div>
    </div>
  );
}
