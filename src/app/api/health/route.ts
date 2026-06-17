import { NextResponse } from 'next/server';
import { normaliseForHash, sha256Prefixed } from './path-hash';

/**
 * Identity contract version exposed via `/api/health`.
 *
 * The `course-exams` grading workflow reads this constant (or its numeric
 * value) before reusing a running qti-scoring-system process. Bump the
 * literal when the response schema changes in a breaking way; minor
 * additions should not require a bump.
 */
export const QTI_SCORING_SYSTEM_HEALTH_API_VERSION = 1 as const;

const SERVICE_NAME = 'qti-scoring-system';
const ENV_INSTANCE_ID = 'QTI_SCORING_SYSTEM_INSTANCE_ID';
const ENV_REPO_ROOT = 'QTI_SCORING_SYSTEM_REPO_ROOT';
const ENV_WORKSPACE_INDEX = 'QTI_SCORING_SYSTEM_WORKSPACE_INDEX';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
} as const;

/**
 * Runtime identity / liveness endpoint.
 *
 * Returns the same JSON shape whether or not the process is fully
 * configured; `configured` is `false` when any required env var is missing.
 * Always responds 200 so that liveness probes do not need to know about
 * the configuration state — callers decide reusability from the body.
 */
export async function GET() {
  const instanceId = process.env[ENV_INSTANCE_ID] ?? '';
  const repoRoot = process.env[ENV_REPO_ROOT] ?? '';
  const workspaceIndex = process.env[ENV_WORKSPACE_INDEX] ?? '';

  const configured =
    instanceId.length > 0 && repoRoot.length > 0 && workspaceIndex.length > 0;

  // Per spec: each hash is computed from its own env var; the hash for a
  // missing/empty env var is the empty string. `configured` is the AND of
  // all three env vars being non-empty.
  const repoRootHash =
    repoRoot.length > 0
      ? sha256Prefixed(normaliseForHash(repoRoot, process.platform))
      : '';
  const workspaceIndexHash =
    workspaceIndex.length > 0
      ? sha256Prefixed(normaliseForHash(workspaceIndex, process.platform))
      : '';

  const body = {
    service: SERVICE_NAME,
    apiVersion: QTI_SCORING_SYSTEM_HEALTH_API_VERSION,
    configured,
    pid: process.pid,
    instanceId,
    repoRootHash,
    workspaceIndexHash,
  };

  return NextResponse.json(body, { headers: NO_CACHE_HEADERS });
}
