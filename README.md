# QTI 3.0 Scoring System

Web application for scoring QTI 3.0 assessment items and Results Reporting data, with rubric-based scoring and comments.

## Overview
This repository contains the QTI 3.0 scoring system web application.

## Features
- Upload QTI 3.0 assessment-test and Results Reporting XML.
- Navigate responses by candidate with previous/next navigation.
- Score per item with rubric criteria.
- Quick preview per item.
- Save comments in Results Reporting `COMMENT` outcomes.
- Download reports (HTML/CSV/Results XML) as a ZIP.
- Export and import workspaces.

## Tech Stack
- Framework: Next.js 15 (App Router)
- Language: TypeScript
- Styling: Tailwind CSS
- Linting: ESLint

## Setup
1. Install dependencies:

```bash
npm install
```

2. Start the development server:

```bash
npm run dev
```

3. Open http://localhost:3000 in your browser.

## Usage
1. Select the output folder that contains `assessment-test.qti.xml` and one or more Results Reporting XML files.
2. Create a workspace and score per candidate/per item, adding comments as needed.
3. Export the workspace as a ZIP when needed and import it in another environment.

## Workspace Export and Import
- Export: use "Export this workspace" from the workspace screen to save a ZIP.
- Import: choose "Import workspace ZIP", then run the import.
- If a workspace with the same ID exists, the app prompts for overwrite.

## Input Data Formats

### QTI assessment-test.qti.xml
- Root element `qti-assessment-test`.
- Items are referenced via `qti-assessment-item-ref` with `identifier` and `href`.
- Place the assessment-test and item XML in the same output folder and select the folder.

### QTI item XML
- Root element `qti-assessment-item`.
- Rubrics are defined in `qti-rubric-block view="scorer"` with `[<points>] <criterion>` per line.
- Item `identifier` must match the assessment-test `identifier`.
- Images referenced by `qti-img@src` should be included in the same folder structure (resolved as relative paths).

### QTI Results Reporting XML
- Root element `assessmentResult`.
- `itemResult@sequenceIndex` is required and must match the assessment-test item count.

## Rubric UI behaviour

The rubric control branches on the question type derived from the item XML:

- `qti-choice-interaction` items (choice) are auto-scored by
  `apply-to-qti-results`; the GUI shows a read-only "自動採点結果" badge and
  a small "編集不可" hint. There is no clickable 〇 / × toggle. The comment
  textarea is still editable.
- `qti-text-entry-interaction` items (cloze) expose a one-way action: while
  the criterion is `false` (or undefined) the scorer can press "正答に変更"
  to flip it to `true`; once `true` the control switches to a static
  "正答から誤答には変更できません" message and no downgrade button is rendered.
- Everything else (descriptive items) keeps the original 〇 / × toggle.

The same control is shared between the candidate-mode and item-mode views.

## Results PUT endpoint

`PUT /api/workspaces/:id/results` re-parses the saved Results Reporting XML
after persisting the update and returns the ground-truth state so the
frontend can reconcile its optimistic state. The response shape is:

```json
{
  "success": true,
  "items": [
    {
      "identifier": "item-1",
      "rubricOutcomes": { "1": true, "2": false },
      "score": 1,
      "comment": "Optional comment"
    }
  ],
  "testScore": 1
}
```

`testScore` is the whole-test total, not just the updated items. It uses the
authoritative `testResult/SCORE` from the saved file when present, and otherwise
falls back to summing the `SCORE` of every `itemResult`. It is never summed over
only the updated identifiers, so updating one item in a multi-item test still
reports the full test score. If the saved file cannot be parsed, the endpoint
returns a 500 error.

## External Tools
- Results XML updates use `apply-to-qti-results`.
- Report generation uses `qti-reporter`.
- `apply-to-qti-results` is installed via GitHub dependency and referenced from `node_modules`.

## Development Commands
- Build: `npm run build`
- Test: `npm run test`
- Lint: `npm run lint`
- Dev server: `npm run dev`
- E2E: run `npx playwright install chromium` once, then `npm run test:e2e`
- Verify: `npm run verify` (runs lint, test, test:e2e, typecheck, and audit)

## Health and Monitoring
- Health check endpoint: `/api/health` (returns JSON status)

## Accessibility
Automated accessibility checks are performed as part of the E2E test suite using `@axe-core/playwright`.
Run accessibility tests specifically: `npx playwright test e2e/accessibility.spec.ts`

## Requirements and Configuration
- No required environment variables are documented.

## Release and Deploy
Not documented for this repository.
