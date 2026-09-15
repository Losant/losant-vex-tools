# Changelog

## v1.0.0 — 2026-09-11

Initial release. Extracted from `losant-platform/losant-security`.

### Added

- **`issue-vex-assertions` GitHub Action** — processes recently closed `vex-pending` issues, updates CSAF VEX documents in a target repository, and optionally triggers a Cloud Run Job to reload VEX into Container Analysis. Labels processed issues `vex-reflected`.
- **`src/csaf.js`** — `createVexDocument` factory for building and hydrating CSAF 2.0 VEX documents: upsert products, update vulnerability status, manage threats, and increment document versions.
- **`src/github.js`** — `createGithubVexRepo` client for GitHub VEX repository operations, plus standalone helpers: `parseIssueMetadata`, `parseVexComment`, `buildVexIssueBody`, and `formatCvssLine`.
- **`src/process-handlers.js`** — global `unhandledRejection` and `uncaughtException` handlers for long-running Action processes.
