'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

const WorkspaceSelector = dynamic(() => import('@/components/WorkspaceSelector'), {
  ssr: false,
});

export default function Home() {
  const router = useRouter();

  const handleSelectWorkspace = (workspaceId: string) => {
    router.push(`/workspace/${workspaceId}`);
  };

  const handleCreateNew = () => {
    router.push('/workspace/new');
  };

  return (
    <div
      className="min-h-screen bg-gray-50 py-8"
      data-expected-class="min-h-screen bg-gray-50 py-8"
    >
      <WorkspaceSelector
        onSelectWorkspace={handleSelectWorkspace}
        onCreateNew={handleCreateNew}
      />
    </div>
  );
}
