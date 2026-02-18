'use client';

import { useState, type InputHTMLAttributes } from 'react';

interface QtiUploadProps {
  onWorkspaceCreated: (workspaceId: string) => void;
}

const acceptXml = '.xml,application/xml,text/xml';
const directoryInputProps = {
  webkitdirectory: '',
  directory: '',
} as unknown as InputHTMLAttributes<HTMLInputElement>;

export default function QtiUpload({ onWorkspaceCreated }: QtiUploadProps) {
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceDescription, setWorkspaceDescription] = useState('');
  const [assessmentFiles, setAssessmentFiles] = useState<File[]>([]);
  const [resultFiles, setResultFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getRelativePath = (file: File) =>
    (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

  const assessmentTestCount = assessmentFiles.reduce((count, file) => {
    return getRelativePath(file).endsWith('assessment-test.qti.xml') ? count + 1 : count;
  }, 0);

  const handleSubmit = async () => {
    setError(null);
    if (!workspaceName.trim()) {
      setError('ワークスペース名を入力してください');
      return;
    }
    if (assessmentFiles.length === 0) {
      setError('assessment-test を含むフォルダを選択してください');
      return;
    }
    if (resultFiles.length === 0) {
      setError('QTI Results Reporting XML を1つ以上選択してください');
      return;
    }
    if (assessmentTestCount !== 1) {
      setError('assessment-test.qti.xml を1つだけ含むフォルダを選択してください');
      return;
    }

    setIsLoading(true);
    try {
      const form = new FormData();
      form.append('name', workspaceName.trim());
      if (workspaceDescription.trim()) {
        form.append('description', workspaceDescription.trim());
      }
      assessmentFiles.forEach((file) => {
        const relativePath = getRelativePath(file) || file.name;
        form.append('assessmentFiles', file, relativePath);
      });
      resultFiles.forEach(file => form.append('results', file));

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
              QTI assessment-test を含むフォルダ *
            </label>
            <input
              type="file"
              accept={acceptXml}
              multiple
              {...directoryInputProps}
              onChange={(e) => setAssessmentFiles(Array.from(e.target.files || []))}
              disabled={isLoading}
              title="assessment-test.qti.xml と設問 XML が入っているフォルダを選択してください"
              className="block w-full text-sm text-gray-700"
            />
            <div className="text-xs text-gray-500 mt-1">
              選択中: {assessmentFiles.length}件 / assessment-test:{' '}
              {assessmentTestCount === 1 ? '検出済み' : assessmentTestCount === 0 ? '未検出' : '複数検出'}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              assessment-test.qti.xml と設問 XML を含む出力フォルダを選択してください。
            </div>
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
              title="採点対象となる解答結果（Results Reporting）の XML ファイルを選択してください（複数選択可）"
              className="block w-full text-sm text-gray-700"
            />
            <div className="text-xs text-gray-500 mt-1">選択中: {resultFiles.length}件</div>
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
            title="入力されたデータをもとにワークスペースを作成し、初期化処理を実行します"
            className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? '作成中...' : 'ワークスペースを作成'}
          </button>
          <button
            onClick={() => {
              setWorkspaceName('');
              setWorkspaceDescription('');
              setAssessmentFiles([]);
              setResultFiles([]);
              setError(null);
            }}
            disabled={isLoading}
            title="入力をすべてクリアします"
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            リセット
          </button>
        </div>
      </div>
    </div>
  );
}
