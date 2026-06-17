import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { GET, QTI_SCORING_SYSTEM_HEALTH_API_VERSION } from '@/app/api/health/route';
import { normaliseForHash, sha256Prefixed } from '@/app/api/health/path-hash';

const ENV_INSTANCE_ID = 'QTI_SCORING_SYSTEM_INSTANCE_ID';
const ENV_REPO_ROOT = 'QTI_SCORING_SYSTEM_REPO_ROOT';
const ENV_WORKSPACE_INDEX = 'QTI_SCORING_SYSTEM_WORKSPACE_INDEX';

const setEnv = (values: Record<string, string | undefined>) => {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const clearHealthEnv = () => {
  delete process.env[ENV_INSTANCE_ID];
  delete process.env[ENV_REPO_ROOT];
  delete process.env[ENV_WORKSPACE_INDEX];
};

const fullEnv = () =>
  setEnv({
    [ENV_INSTANCE_ID]: 'instance-uuid-1234',
    [ENV_REPO_ROOT]: '/repo/sub',
    [ENV_WORKSPACE_INDEX]: '/repo/sub/workspace-index.json',
  });

describe('GET /api/health — response shape', () => {
  beforeEach(() => {
    clearHealthEnv();
  });
  afterEach(() => {
    clearHealthEnv();
  });

  it('exports the API version constant as the literal 1', () => {
    expect(QTI_SCORING_SYSTEM_HEALTH_API_VERSION).toBe(1);
  });

  it('returns configured:true with non-empty identity and matching hashes when all env vars are set', async () => {
    fullEnv();

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      service: 'qti-scoring-system',
      apiVersion: 1,
      configured: true,
      pid: process.pid,
      instanceId: 'instance-uuid-1234',
      repoRootHash: sha256Prefixed(normaliseForHash('/repo/sub', process.platform)),
      workspaceIndexHash: sha256Prefixed(
        normaliseForHash('/repo/sub/workspace-index.json', process.platform)
      ),
    });
    expect(body.instanceId).not.toBe('');
    expect(body.repoRootHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(body.workspaceIndexHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('attaches the cache-disabled response headers', async () => {
    fullEnv();

    const response = await GET();

    expect(response.headers.get('Cache-Control')).toBe(
      'no-store, no-cache, must-revalidate, max-age=0'
    );
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(response.headers.get('Expires')).toBe('0');
  });

  it('returns configured:false and empty identity when QTI_SCORING_SYSTEM_INSTANCE_ID is missing', async () => {
    setEnv({
      [ENV_INSTANCE_ID]: undefined,
      [ENV_REPO_ROOT]: '/repo/sub',
      [ENV_WORKSPACE_INDEX]: '/repo/sub/workspace-index.json',
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.configured).toBe(false);
    expect(body.instanceId).toBe('');
    // Per spec: path hashes are still computed from their own env vars;
    // only the missing instance id is empty.
    expect(body.repoRootHash).toBe(
      sha256Prefixed(normaliseForHash('/repo/sub', process.platform))
    );
    expect(body.workspaceIndexHash).toBe(
      sha256Prefixed(normaliseForHash('/repo/sub/workspace-index.json', process.platform))
    );
  });

  it('returns configured:false and empty repoRootHash when QTI_SCORING_SYSTEM_REPO_ROOT is missing', async () => {
    setEnv({
      [ENV_INSTANCE_ID]: 'instance-uuid-1234',
      [ENV_REPO_ROOT]: undefined,
      [ENV_WORKSPACE_INDEX]: '/repo/sub/workspace-index.json',
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.configured).toBe(false);
    expect(body.repoRootHash).toBe('');
    // Per spec: the workspaceIndex hash is still computed from its own env
    // var (it is independent of repoRoot).
    expect(body.workspaceIndexHash).toBe(
      sha256Prefixed(normaliseForHash('/repo/sub/workspace-index.json', process.platform))
    );
  });

  it('returns configured:false and empty workspaceIndexHash when QTI_SCORING_SYSTEM_WORKSPACE_INDEX is missing', async () => {
    setEnv({
      [ENV_INSTANCE_ID]: 'instance-uuid-1234',
      [ENV_REPO_ROOT]: '/repo/sub',
      [ENV_WORKSPACE_INDEX]: undefined,
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.configured).toBe(false);
    expect(body.workspaceIndexHash).toBe('');
    // repoRootHash is still computed from its own env var.
    expect(body.repoRootHash).toBe(
      sha256Prefixed(normaliseForHash('/repo/sub', process.platform))
    );
  });

  it('treats empty-string env vars the same as missing (configured:false)', async () => {
    setEnv({
      [ENV_INSTANCE_ID]: '',
      [ENV_REPO_ROOT]: '/repo/sub',
      [ENV_WORKSPACE_INDEX]: '/repo/sub/workspace-index.json',
    });

    const response = await GET();
    const body = await response.json();

    expect(body.configured).toBe(false);
    expect(body.instanceId).toBe('');
  });

  it('never echoes the raw repoRoot path string in the response body', async () => {
    const sensitivePath = '/secret/internal/path/that/should/leak/abc123';
    setEnv({
      [ENV_INSTANCE_ID]: 'instance-uuid-1234',
      [ENV_REPO_ROOT]: sensitivePath,
      [ENV_WORKSPACE_INDEX]: '/repo/sub/workspace-index.json',
    });

    const response = await GET();
    const body = await response.json();
    const serialised = JSON.stringify(body);

    expect(serialised).not.toContain(sensitivePath);
    // Also: only the hash (sha256:...) leaves the route — the path itself
    // is never reconstructed from the hash.
    expect(body.repoRootHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('normaliseForHash — platform semantics', () => {
  it('returns a POSIX-style path unchanged on linux', () => {
    expect(normaliseForHash('/repo/sub', 'linux')).toBe('/repo/sub');
  });

  it('resolves `..` segments on POSIX (path.posix.resolve collapses them)', () => {
    // /repo/foo/../bar -> /repo/bar
    expect(normaliseForHash('/repo/foo/../bar', 'linux')).toBe('/repo/bar');
  });

  it('converts Windows backslashes to forward slashes and lowercases on win32', () => {
    // C:\repo\sub -> C:/repo/sub -> /C:/repo/sub (marked absolute) -> c:/repo/sub (lowercased)
    expect(normaliseForHash('C:\\repo\\sub', 'win32')).toBe('/c:/repo/sub');
  });

  it('resolves `..` segments on Windows after drive-letter preservation', () => {
    // C:\repo\foo\..\bar -> C:/repo/foo/../bar -> /C:/repo/foo/../bar -> /C:/repo/bar -> /c:/repo/bar
    expect(normaliseForHash('C:\\repo\\foo\\..\\bar', 'win32')).toBe('/c:/repo/bar');
  });

  it('produces identical hashes for backslash and forward-slash Windows forms', () => {
    // The task spec: "when QTI_SCORING_SYSTEM_REPO_ROOT contains C:\\repo\\sub,
    // the hash equals the hash of c:/repo/sub." Both inputs must yield the
    // same hash on the win32 platform.
    const a = sha256Prefixed(normaliseForHash('C:\\repo\\sub', 'win32'));
    const b = sha256Prefixed(normaliseForHash('c:/repo/sub', 'win32'));
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('produces the same hash for `..`-collapsed and fully-canonical Windows forms', () => {
    // The task spec: "C:\\repo\\foo\\..\\bar (Windows) ... normalise to the
    // same hash as c:/repo/bar." Verify the Windows input collapses to a
    // hash identical to the canonical form on the win32 platform.
    const collapsed = sha256Prefixed(normaliseForHash('C:\\repo\\foo\\..\\bar', 'win32'));
    const canonical = sha256Prefixed(normaliseForHash('c:/repo/bar', 'win32'));
    expect(collapsed).toBe(canonical);
  });

  it('produces the same hash for `..`-collapsed and fully-canonical POSIX forms', () => {
    // The task spec: "/repo/foo/../bar (POSIX) ... normalise to the same
    // hash as /repo/bar." On a POSIX host, both inputs collapse to the
    // same canonical form and therefore the same hash.
    const collapsed = sha256Prefixed(normaliseForHash('/repo/foo/../bar', 'linux'));
    const canonical = sha256Prefixed(normaliseForHash('/repo/bar', 'linux'));
    expect(collapsed).toBe(canonical);
  });
});

describe('sha256Prefixed', () => {
  it('produces sha256: prefix + 64-char lowercase hex digest', () => {
    const input = 'hello world';
    const expected = createHash('sha256').update(input, 'utf8').digest('hex');
    expect(sha256Prefixed(input)).toBe(`sha256:${expected}`);
    expect(sha256Prefixed(input)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
