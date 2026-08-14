import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { generateCsvReport, generateReportOutput } from './qtiReporter';

const ASSESSMENT_TEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-test identifier="assessment-test" title="Assessment Test" xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
  <qti-test-part identifier="part-1" navigation-mode="linear" submission-mode="individual">
    <qti-assessment-section identifier="section-1" title="Section 1" visible="true">
      <qti-assessment-item-ref identifier="item-1" href="item-1.qti.xml" />
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>
`;

const ITEM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item identifier="item-1" title="Item 1" adaptive="false" time-dependent="false" xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>CHOICE_1</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-item-body>
    <p>What is <strong>1 + 1</strong>? <span class="answer" data-slot="a" aria-label="answer">A</span></p>
    <pre><code>const answer = <span style="display:inline-block;min-width:4em;border:1px solid #000;">A</span>;</code></pre>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
      <qti-simple-choice identifier="CHOICE_1">2 <em>(correct)</em></qti-simple-choice>
    </qti-choice-interaction>
    <qti-rubric-block view="scorer">
      <p>[1] Select the correct sum</p>
    </qti-rubric-block>
  </qti-item-body>
  <qti-modal-feedback outcome-identifier="FEEDBACK" identifier="EXPLANATION" show-hide="show">
    <qti-content-body><p>Because <strong>1 + 1 = 2</strong>. <em>Check the code.</em></p></qti-content-body>
  </qti-modal-feedback>
</qti-assessment-item>
`;

const makeResultXml = (sourcedId: string, candidateName: string, score: number) => `<?xml version="1.0" encoding="UTF-8"?>
<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0">
  <context sourcedId="${sourcedId}">
    <sessionIdentifier sourceID="candidateId" identifier="${sourcedId}" />
    <sessionIdentifier sourceID="candidateName" identifier="${candidateName}" />
    <sessionIdentifier sourceID="materialTitle" identifier="Sample Test" />
  </context>
  <testResult identifier="assessment-test" datestamp="2026-01-25T12:00:00+09:00">
    <outcomeVariable identifier="SCORE" baseType="float" cardinality="single">
      <value>${score}</value>
    </outcomeVariable>
  </testResult>
  <itemResult identifier="item-1" datestamp="2026-01-25T12:00:00+09:00" sessionStatus="final">
    <outcomeVariable identifier="SCORE" baseType="float" cardinality="single">
      <value>${score}</value>
    </outcomeVariable>
    <outcomeVariable identifier="RUBRIC_1_MET" baseType="boolean" cardinality="single">
      <value>true</value>
    </outcomeVariable>
  </itemResult>
</assessmentResult>
`;

describe('generateCsvReport', () => {
  it('aggregates CSV rows for multiple results', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-reporter-test-'));
    try {
      const assessmentDir = path.join(root, 'assessment');
      const resultsDir = path.join(root, 'results');
      fs.mkdirSync(assessmentDir, { recursive: true });
      fs.mkdirSync(resultsDir, { recursive: true });

      const assessmentTestPath = path.join(assessmentDir, 'assessment-test.qti.xml');
      fs.writeFileSync(assessmentTestPath, ASSESSMENT_TEST_XML, 'utf-8');
      fs.writeFileSync(path.join(assessmentDir, 'item-1.qti.xml'), ITEM_XML, 'utf-8');

      const resultPathA = path.join(resultsDir, 'result-a.xml');
      const resultPathB = path.join(resultsDir, 'result-b.xml');
      fs.writeFileSync(resultPathA, makeResultXml('user-0001', 'Alice', 1), 'utf-8');
      fs.writeFileSync(resultPathB, makeResultXml('user-0002', 'Bob', 1), 'utf-8');

      const csv = await generateCsvReport({
        assessmentTestPath,
        assessmentResultPaths: [resultPathA, resultPathB],
      });
      const normalized = csv.replace(/^\uFEFF/, '').trim();
      const lines = normalized.split(/\r?\n/);

      expect(lines[0]).toContain('candidate_number');
      expect(lines).toHaveLength(3);
      expect(normalized).toContain('Alice');
      expect(normalized).toContain('Bob');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('generates canonical presentation HTML through the pinned reporter', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-reporter-canonical-'));
    try {
      const assessmentDir = path.join(root, 'assessment');
      const resultsDir = path.join(root, 'results');
      fs.mkdirSync(assessmentDir, { recursive: true });
      fs.mkdirSync(resultsDir, { recursive: true });
      const assessmentTestPath = path.join(assessmentDir, 'assessment-test.qti.xml');
      const resultPath = path.join(resultsDir, 'result.xml');
      fs.writeFileSync(assessmentTestPath, ASSESSMENT_TEST_XML, 'utf-8');
      fs.writeFileSync(path.join(assessmentDir, 'item-1.qti.xml'), ITEM_XML, 'utf-8');
      fs.writeFileSync(resultPath, makeResultXml('user-0001', 'Alice', 1), 'utf-8');

      const output = await generateReportOutput({
        assessmentTestPath,
        assessmentResultPaths: [resultPath],
      });
      try {
        const htmlName = fs
          .readdirSync(output.outputDir, { recursive: true })
          .find((name) => String(name).endsWith('.html'));
        expect(htmlName).toBeDefined();
        const html = fs.readFileSync(path.join(output.outputDir, String(htmlName)), 'utf-8');
        expect(html).toContain('data-slot="a"');
        expect(html).toContain('<pre data-code-lang="plain" class="code-block hljs"><code');
        expect(html).toContain('min-width:4em');
        expect(html).toContain('Select the correct sum');
        expect(html).toContain('<em>(correct)</em>');
        expect(html).toContain('<em>Check the code.</em>');
      } finally {
        await output.cleanup();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails when qti-reporter cli is missing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-reporter-build-'));
    const prevCwd = process.cwd();
    try {
      const moduleRoot = path.join(root, 'node_modules', 'qti-reporter');
      fs.mkdirSync(moduleRoot, { recursive: true });
      const pkg = {
        name: 'qti-reporter',
        version: '0.0.0',
        type: 'module',
      };
      fs.writeFileSync(path.join(moduleRoot, 'package.json'), JSON.stringify(pkg, null, 2), 'utf-8');

      const assessmentDir = path.join(root, 'assessment');
      const resultsDir = path.join(root, 'results');
      fs.mkdirSync(assessmentDir, { recursive: true });
      fs.mkdirSync(resultsDir, { recursive: true });
      const assessmentTestPath = path.join(assessmentDir, 'assessment-test.qti.xml');
      fs.writeFileSync(assessmentTestPath, ASSESSMENT_TEST_XML, 'utf-8');
      fs.writeFileSync(path.join(assessmentDir, 'item-1.qti.xml'), ITEM_XML, 'utf-8');
      const resultPath = path.join(resultsDir, 'result.xml');
      fs.writeFileSync(resultPath, makeResultXml('user-0003', 'Chris', 1), 'utf-8');

      process.chdir(root);
      await expect(
        generateCsvReport({
          assessmentTestPath,
          assessmentResultPaths: [resultPath],
        })
      ).rejects.toThrow('qti-reporter の CLI が見つかりません');
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('invokes qti-reporter cli to generate csv', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-reporter-cli-'));
    const prevCwd = process.cwd();
    try {
      const moduleRoot = path.join(root, 'node_modules', 'qti-reporter');
      const distRoot = path.join(moduleRoot, 'dist');
      fs.mkdirSync(distRoot, { recursive: true });
      fs.writeFileSync(
        path.join(moduleRoot, 'package.json'),
        JSON.stringify({ name: 'qti-reporter', version: '0.0.0', type: 'module' }, null, 2),
        'utf-8'
      );
      const cliScript = `import fs from 'node:fs';
import path from 'node:path';
const argv = process.argv.slice(2);
const getArg = (name) => {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : null;
};
const outDir = getArg('--out-dir') ?? 'out';
fs.mkdirSync(outDir, { recursive: true });
const csvPath = path.join(outDir, 'report.csv');
fs.writeFileSync(csvPath, 'header\\nrow', 'utf-8');
`;
      fs.writeFileSync(path.join(distRoot, 'cli.js'), cliScript, 'utf-8');

      const assessmentDir = path.join(root, 'assessment');
      const resultsDir = path.join(root, 'results');
      fs.mkdirSync(assessmentDir, { recursive: true });
      fs.mkdirSync(resultsDir, { recursive: true });
      const assessmentTestPath = path.join(assessmentDir, 'assessment-test.qti.xml');
      fs.writeFileSync(assessmentTestPath, ASSESSMENT_TEST_XML, 'utf-8');
      fs.writeFileSync(path.join(assessmentDir, 'item-1.qti.xml'), ITEM_XML, 'utf-8');
      const resultPath = path.join(resultsDir, 'result.xml');
      fs.writeFileSync(resultPath, makeResultXml('user-0004', 'Drew', 1), 'utf-8');

      process.chdir(root);
      const csv = await generateCsvReport({
        assessmentTestPath,
        assessmentResultPaths: [resultPath],
      });
      expect(csv).toContain('header');
      expect(csv).toContain('row');
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
