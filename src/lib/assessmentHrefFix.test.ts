import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withResolvedAssessmentHrefs } from '@/lib/assessmentHrefFix';

describe('withResolvedAssessmentHrefs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-href-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes original path when all hrefs resolve literally', async () => {
    const itemFile = path.join(tmpDir, 'item.qti.xml');
    fs.writeFileSync(itemFile, '<item/>');
    const xml = `<test><qti-assessment-item-ref href="item.qti.xml"/></test>`;
    const assessmentPath = path.join(tmpDir, 'test.xml');
    fs.writeFileSync(assessmentPath, xml);

    let receivedPath: string | undefined;
    await withResolvedAssessmentHrefs(assessmentPath, async (p) => {
      receivedPath = p;
    });

    expect(receivedPath).toBe(assessmentPath);
  });

  it('creates a temp file with corrected href when item is in a subdirectory', async () => {
    const itemsDir = path.join(tmpDir, 'items');
    fs.mkdirSync(itemsDir);
    const itemFile = path.join(itemsDir, 'item.qti.xml');
    fs.writeFileSync(itemFile, '<item/>');

    // href points to bare filename (no items/ prefix) — won't resolve literally
    const xml = `<test><qti-assessment-item-ref href="item.qti.xml"/></test>`;
    const assessmentPath = path.join(tmpDir, 'test.xml');
    fs.writeFileSync(assessmentPath, xml);

    let receivedPath: string | undefined;
    let correctedXml: string | undefined;
    await withResolvedAssessmentHrefs(assessmentPath, async (p) => {
      receivedPath = p;
      // Read inside callback before temp file is cleaned up
      correctedXml = fs.readFileSync(p, 'utf-8');
    });

    // Should have been given a different (temp) path
    expect(receivedPath).not.toBe(assessmentPath);
    // Temp path should contain the absolute path to the item
    const absoluteItem = itemFile.split(path.sep).join('/');
    expect(correctedXml).toContain(absoluteItem);
  });

  it('cleans up temp file after callback', async () => {
    const itemsDir = path.join(tmpDir, 'items');
    fs.mkdirSync(itemsDir);
    fs.writeFileSync(path.join(itemsDir, 'item.qti.xml'), '<item/>');
    const xml = `<test><qti-assessment-item-ref href="item.qti.xml"/></test>`;
    const assessmentPath = path.join(tmpDir, 'test.xml');
    fs.writeFileSync(assessmentPath, xml);

    let tempPath: string | undefined;
    await withResolvedAssessmentHrefs(assessmentPath, async (p) => {
      tempPath = p;
    });

    expect(tempPath).toBeDefined();
    expect(fs.existsSync(tempPath!)).toBe(false);
  });

  it('handles multiple hrefs, correcting only the unresolvable ones', async () => {
    // item1 is directly in tmpDir (literal href resolves)
    fs.writeFileSync(path.join(tmpDir, 'item1.qti.xml'), '<item/>');
    // item2 is in a subdirectory (literal href does not resolve)
    const subDir = path.join(tmpDir, 'sub');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'item2.qti.xml'), '<item/>');

    const xml = [
      '<test>',
      '<qti-assessment-item-ref href="item1.qti.xml"/>',
      '<qti-assessment-item-ref href="item2.qti.xml"/>',
      '</test>',
    ].join('');
    const assessmentPath = path.join(tmpDir, 'test.xml');
    fs.writeFileSync(assessmentPath, xml);

    let receivedXml: string | undefined;
    await withResolvedAssessmentHrefs(assessmentPath, async (p) => {
      // Read inside callback so temp file still exists
      receivedXml = fs.readFileSync(p, 'utf-8');
    });

    // item2 href corrected to absolute path
    const absItem2 = path.join(subDir, 'item2.qti.xml').split(path.sep).join('/');
    expect(receivedXml).toContain(absItem2);
  });
});
