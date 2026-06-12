# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The rubric-scoring control on the workspace page now branches on question
  type so it no longer shows misleading 〇 / × buttons for auto-scored items.
  `qti-choice-interaction` items render a read-only "自動採点結果" badge with
  an "編集不可" hint; `qti-text-entry-interaction` (cloze) items render a
  one-way "正答に変更" action that locks to a static message once the
  criterion is `true`; descriptive items keep the original 〇 / × toggle.
  The control is now a single shared component used by both the candidate and
  item views.
- `PUT /api/workspaces/:id/results` now returns the saved state of the
  affected items (`items[]` with `rubricOutcomes`, `score`, `comment`) plus
  the recomputed `testScore`, parsed from the file the server actually
  persisted. The frontend replaces its optimistic local state with the
  server-confirmed values once the response is in hand, so a saved
  "保存しました" status no longer fires when apply-to-qti-results rejected
  the request (e.g. auto-scored criteria) and kept the previous values.
## [0.1.0] - 2026-02-23

### Added

- Initial project setup with Next.js
- QTI scoring and assessment result processing
- Integration with qti-xml-core, qti-html-renderer, qti-reporter, and apply-to-qti-results
- CI workflow with GitHub Actions
- Linting with ESLint and Prettier formatting
- End-to-end tests with Playwright
- Unit tests with Vitest
- Automated accessibility contrast checks

[Unreleased]: https://github.com/metyatech/qti-scoring-system/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/metyatech/qti-scoring-system/releases/tag/v0.1.0
