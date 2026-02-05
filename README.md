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

## Requirements and Configuration
- No required environment variables are documented.

## Release and Deploy

### Build
To build the application for production:

```bash
npm run build
```

### Deploy
The application can be deployed to any platform that supports Next.js, such as Vercel, Netlify, or a custom server.

For a custom server:
1. Build the application.
2. Start the production server:

```bash
npm run start
```
