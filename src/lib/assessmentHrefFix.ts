import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Scans a directory tree and builds a map of filename -> full path for all files.
 * Files with duplicate basenames are excluded (ambiguous resolution).
 */
const buildBasenameMap = (dir: string): Map<string, string> => {
  const result = new Map<string, string>();
  const duplicates = new Set<string>();

  const walk = (current: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const base = entry.name;
        if (result.has(base)) {
          duplicates.add(base);
          result.delete(base);
        } else if (!duplicates.has(base)) {
          result.set(base, fullPath);
        }
      }
    }
  };

  walk(dir);
  return result;
};

/**
 * Calls callback with an assessment test path where all qti-assessment-item-ref hrefs
 * resolve to actual files. If hrefs need correction (basename fallback), a temp file
 * is written with absolute hrefs and cleaned up after the callback.
 */
export const withResolvedAssessmentHrefs = async (
  assessmentTestPath: string,
  callback: (resolvedPath: string) => Promise<void>
): Promise<void> => {
  const assessmentDir = path.dirname(assessmentTestPath);
  const xml = await fs.promises.readFile(assessmentTestPath, 'utf-8');

  const hrefPattern = /(<qti-assessment-item-ref[^>]*?\shref=")([^"]+)(")/g;
  const basenameMap = buildBasenameMap(assessmentDir);

  let corrected = false;
  const correctedXml = xml.replace(hrefPattern, (_match, before, href, after) => {
    const literalPath = path.resolve(assessmentDir, href);
    if (fs.existsSync(literalPath)) {
      return `${before}${href}${after}`;
    }
    const basename = path.basename(href);
    const actualFullPath = basenameMap.get(basename);
    if (!actualFullPath) {
      return `${before}${href}${after}`;
    }
    // Use absolute path so the temp file works from any directory
    const absoluteHref = actualFullPath.split(path.sep).join('/');
    corrected = true;
    return `${before}${absoluteHref}${after}`;
  });

  if (!corrected) {
    await callback(assessmentTestPath);
    return;
  }

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qti-assessment-'));
  const tmpPath = path.join(tmpDir, path.basename(assessmentTestPath));
  try {
    await fs.promises.writeFile(tmpPath, correctedXml, 'utf-8');
    await callback(tmpPath);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
};
