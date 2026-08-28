import fs from 'fs/promises';
import path from 'path';
import {
  getWorkspaceMode,
  readWorkspace,
  resolveWorkspaceDir,
} from '@/lib/workspace';
import {
  parseAssessmentTestXml,
  parseQtiItemXml,
  parseQtiResultsXml,
  remapResultToAssessmentItems,
} from '@/utils/qtiParsing';
import { getEffectiveRubricOutcomes } from '@/utils/scoring';

export type AutoGradingProtectedCriteria = Record<
  string,
  Record<string, number[]>
>;

const isDirectory = async (target: string): Promise<boolean> => {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
};

const readRequiredFile = async (
  filePath: string,
  description: string,
): Promise<string> => {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `${description} を読み込めません: ${filePath} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
};

/**
 * Build cloze criterion protection from the state that existed before AI
 * grading. Index mode uses the immutable submissions snapshot; current
 * scoring-workspace/results files are never used as provenance.
 */
export const getAutoGradingProtectedCriteria = async (
  id: string,
): Promise<AutoGradingProtectedCriteria> => {
  const workspaceDir = await resolveWorkspaceDir(id);
  if (!workspaceDir) {
    throw new Error(`ワークスペースが見つかりません: ${id}`);
  }

  const workspace = await readWorkspace(id);
  if (!workspace) {
    throw new Error(`ワークスペースメタデータが見つかりません: ${id}`);
  }

  const mode = getWorkspaceMode();
  const indexProvenanceDir = path.resolve(workspaceDir, '..', 'submissions', 'results');
  const legacyFallbackDir = path.join(workspaceDir, 'auto-grading-results');
  const provenanceDir = mode === 'index' ? indexProvenanceDir : legacyFallbackDir;

  if (mode === 'legacy' && !(await isDirectory(provenanceDir))) {
    return {};
  }
  if (!(await isDirectory(provenanceDir))) {
    throw new Error(`自動採点 snapshot ディレクトリが見つかりません: ${provenanceDir}`);
  }

  if (!workspace.assessmentTestFile) {
    throw new Error(`assessmentTest が見つかりません: ${id}`);
  }
  const assessmentDir = path.join(workspaceDir, 'assessment');
  const assessmentTestPath = path.join(assessmentDir, workspace.assessmentTestFile);
  const assessmentTestXml = await readRequiredFile(assessmentTestPath, 'assessmentTest');
  const itemRefs = parseAssessmentTestXml(assessmentTestXml);
  if (workspace.itemFiles.length !== itemRefs.length) {
    throw new Error(`assessmentTest と設問ファイル数が一致しません: ${id}`);
  }

  const items = await Promise.all(
    workspace.itemFiles.map(async (itemFile, index) => {
      const itemXml = await readRequiredFile(path.join(assessmentDir, itemFile), '設問');
      const item = parseQtiItemXml(itemXml);
      const expectedIdentifier = itemRefs[index]?.identifier;
      if (expectedIdentifier && item.identifier !== expectedIdentifier) {
        throw new Error(
          `assessmentTest と item identifier が一致しません: ${expectedIdentifier}`,
        );
      }
      return item;
    }),
  );

  const protectedCriteria: AutoGradingProtectedCriteria = {};
  for (const resultFile of workspace.resultFiles) {
    const snapshotPath = path.join(provenanceDir, resultFile);
    const snapshotXml = await readRequiredFile(snapshotPath, '自動採点 snapshot 結果');
    const snapshotResult = parseQtiResultsXml(snapshotXml, resultFile);
    const remapped = remapResultToAssessmentItems(snapshotResult, itemRefs);
    if (remapped.missingResultIdentifiers.length > 0) {
      throw new Error(
        `自動採点 snapshot の結果IDを設問へ対応付けできません (${resultFile}): ${remapped.missingResultIdentifiers.join(', ')}`,
      );
    }
    if (remapped.duplicateItemIdentifiers.length > 0) {
      throw new Error(
        `自動採点 snapshot の結果が同じ設問へ重複しています (${resultFile}): ${remapped.duplicateItemIdentifiers.join(', ')}`,
      );
    }

    const fileProtection: Record<string, number[]> = {};
    for (const item of items) {
      if (item.type !== 'cloze') continue;
      const itemResult = remapped.mappedItemResults[item.identifier];
      if (!itemResult) {
        throw new Error(
          `自動採点 snapshot に設問の結果がありません (${resultFile}): ${item.identifier}`,
        );
      }
      const effectiveOutcomes = getEffectiveRubricOutcomes(item, itemResult);
      const protectedIndexes = item.rubric
        .filter((criterion) => effectiveOutcomes[criterion.index] === true)
        .map((criterion) => criterion.index);
      if (protectedIndexes.length > 0) {
        fileProtection[item.identifier] = protectedIndexes;
      }
    }
    protectedCriteria[resultFile] = fileProtection;
  }

  return protectedCriteria;
};
