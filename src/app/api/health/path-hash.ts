import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Normalise a filesystem path string for hashing.
 *
 * Pure helper: no filesystem access, no env access, no globals. The platform
 * is passed in by the caller so the same logic is testable on any host. The
 * caller (the `/api/health` route) passes `process.platform`.
 *
 * Steps:
 *   1. Convert backslashes to forward slashes. This must happen BEFORE
 *      `path.posix.resolve` so a Windows input like `C:\repo\foo\..\bar`
 *      is seen as `C:/repo/foo/../bar` and resolved to `C:/repo/bar`
 *      (POSIX resolve treats `C:` as a regular segment, not a drive).
 *   2. Resolve `.` / `..` segments using POSIX semantics. POSIX resolve
 *      is host-independent so the result is the same on every OS — the
 *      same `course-exams` process gets the same hash on its side.
 *   3. On Windows, lowercase the entire string (Windows paths are case-
 *      insensitive).
 *
 * @param input  Raw path string from env (may contain `..` or backslashes).
 * @param platform  `process.platform` value of the running process.
 * @returns  Normalised, platform-stable path string ready for hashing.
 */
export function normaliseForHash(input: string, platform: NodeJS.Platform): string {
  // Backslashes first so Windows absolute paths look like POSIX paths.
  let normalised = input.split('\\').join('/');
  // `path.posix.resolve` treats any path NOT starting with `/` as relative
  // to the current working directory. A Windows drive-letter path like
  // `C:/repo/sub` would otherwise be resolved against the host's CWD,
  // which is unstable. Mark it as absolute by prepending `/` so the drive
  // letter is preserved verbatim (lowercased on win32 below).
  if (/^[A-Za-z]:\//.test(normalised)) {
    normalised = `/${normalised}`;
  }
  // POSIX resolve so the normalisation is host-independent. The two repos
  // (qti-scoring-system and course-exams) must produce identical hashes
  // for identical inputs.
  let resolved = path.posix.resolve(normalised);
  if (platform === 'win32') {
    resolved = resolved.toLowerCase();
  }
  return resolved;
}

/**
 * SHA-256 hash of a normalised path string, prefixed with `sha256:`.
 *
 * Pure helper: no env, no globals. Caller passes the already-normalised
 * string from {@link normaliseForHash}.
 */
export function sha256Prefixed(normalised: string): string {
  const hash = createHash('sha256').update(normalised, 'utf8').digest('hex');
  return `sha256:${hash}`;
}
