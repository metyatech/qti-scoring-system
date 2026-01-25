'use client';

import { useState } from 'react';

interface QtiUploadProps {
  onWorkspaceCreated: (workspaceId: string) => void;
}

const acceptXml = '.xml,application/xml,text/xml';
const acceptCsv = '.csv,text/csv,application/vnd.ms-excel';

export default function QtiUpload({ onWorkspaceCreated }: QtiUploadProps) {
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceDescription, setWorkspaceDescription] = useState('');
  const [itemFiles, setItemFiles] = useState<File[]>([]);
  const [resultFiles, setResultFiles] = useState<File[]>([]);
  const [mappingFile, setMappingFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!workspaceName.trim()) {
      setError('ワークスペース名を入力してください');
      return;
    }
    if (itemFiles.length === 0) {
      setError('QTI item XML を1つ以上選択してください');
      return;
    }
    if (resultFiles.length === 0) {
      setError('QTI Results Reporting XML を1つ以上選択してください');
      return;
    }
    if (!mappingFile) {
      setError('マッピングCSVを選択してください');
      return;
    }

    setIsLoading(true);
    try {
      const form = new FormData();
      form.append('name', workspaceName.trim());
      if (workspaceDescription.trim()) {
        form.append('description', workspaceDescription.trim());
      }
      itemFiles.forEach(file => form.append('items', file));
      resultFiles.forEach(file => form.append('results', file));
      form.append('mapping', mappingFile);

      const response = await fetch('/api/workspaces', {
        method: 'POST',
        body: form,
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'ワークスペースの作成に失敗しました');
      }
      onWorkspaceCreated(result.workspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ワークスペースの作成に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6">
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          QTI 3.0 ワークスペースを作成
        </h2>

        <div className="space-y-4">
          <div>
            <label htmlFor="workspaceName" className="block text-sm font-medium text-gray-700 mb-1">
              ワークスペース名 *
            </label>
            <input
              type="text"
              id="workspaceName"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="ワークスペース名を入力"
              disabled={isLoading}
            />
          </div>

          <div>
            <label htmlFor="workspaceDescription" className="block text-sm font-medium text-gray-700 mb-1">
              説明（任意）
            </label>
            <textarea
              id="workspaceDescription"
              value={workspaceDescription}
              onChange={(e) => setWorkspaceDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="ワークスペースの説明を入力"
              disabled={isLoading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              QTI item XML（複数可） *
            </label>
            <input
              type="file"
              accept={acceptXml}
              multiple
              onChange={(e) => setItemFiles(Array.from(e.target.files || []))}
              disabled={isLoading}
              className="block w-full text-sm text-gray-700"
            />
            <div className="text-xs text-gray-500 mt-1">選択中: {itemFiles.length}件</div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              QTI Results Reporting XML（複数可） *
            </label>
            <input
              type="file"
              accept={acceptXml}
              multiple
              onChange={(e) => setResultFiles(Array.from(e.target.files || []))}
              disabled={isLoading}
              className="block w-full text-sm text-gray-700"
            />
            <div className="text-xs text-gray-500 mt-1">選択中: {resultFiles.length}件</div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              マッピングCSV（resultItemIdentifier,itemIdentifier） *
            </label>
            <input
              type="file"
              accept={acceptCsv}
              onChange={(e) => setMappingFile(e.target.files?.[0] ?? null)}
              disabled={isLoading}
              className="block w-full text-sm text-gray-700"
            />
            <div className="text-xs text-gray-500 mt-1">
              {mappingFile ? `選択中: ${mappingFile.name}` : '未選択'}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-red-700 font-medium">エラー</div>
            <div className="text-red-600 text-sm mt-1 whitespace-pre-line">{error}</div>
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSubmit}
            disabled={isLoading}
            className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? '作成中...' : 'ワークスペースを作成'}
          </button>
          <button
            onClick={() => {
              setWorkspaceName('');
              setWorkspaceDescription('');
              setItemFiles([]);
              setResultFiles([]);
              setMappingFile(null);
              setError(null);
            }}
            disabled={isLoading}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            リセット
          </button>
        </div>
      </div>
    </div>
  );
}
