# Changelog

## Unreleased

### Changed

- **`auto-upgrade-node`** — Node.js and pnpm are now checked and upgraded independently; a pnpm bump no longer requires a Node.js bump. Every run finishes with a recursive dependency upgrade (`pnpm -r up`), so the action does useful work even when both runtimes are current.

### Added

- **`auto-upgrade-node`** — `project_dirs` input, a comma-separated list of additional pnpm project roots to install and upgrade in; `upgrade_to_latest` input to run the final upgrade as `pnpm -r up --latest`; and a `has_changes` output that callers should gate pull request creation on instead of `new_node_version`.

### Removed

- **`auto-upgrade-node`** — **Breaking:** the `script_name` input and its custom upgrade shell script contract (`NODE_VERSION`, `PNPM_VERSION`, `SKIP_NODE_INSTALL`, `SKIP_BUILD`). Use `project_dirs` instead, which covers the multi-project-root case the custom scripts existed for.

### Fixed

- **`auto-upgrade-node`** — `package.json` files pinning Node.js in more than one place (for example `engines` and `volta`) are now fully updated rather than only at the first occurrence; range operators no longer gain a stray space (`">=24.1.0"` became `">= 24.2.0"`); `pnpm@<version>` pins outside `packageManager` are no longer silently skipped; Dockerfiles pinning Node or pnpm via a `NODE_VERSION` / `PNPM_VERSION` build arg (`FROM node:${NODE_VERSION}`, `pnpm@${PNPM_VERSION}`) are now rewritten, not just literal `node:<version>` / `pnpm@<version>` pins; and the `has_changes` output no longer relies on a predictable `Date.now()`-based `GITHUB_OUTPUT` delimiter.
- **`auto-upgrade-node`** — **Breaking for workflows using plain `git diff`:** changes the action makes are left **unstaged** when the run finishes. Mid-run `git add -A` checkpoints are an internal rollback mechanism only; previously they left most of a successful run's changes staged, so a calling workflow capturing output with a bare `git diff` (rather than `git diff HEAD`) would only see whatever happened to remain unstaged after the last checkpoint — silently dropping most of the upgrade in multi-root (`project_dirs`) repos.

## v1.0.0 — 2026-09-11

Initial release. Extracted from `losant-platform/losant-security`.

### Added

- **`issue-vex-assertions` GitHub Action** — processes recently closed `vex-pending` issues, updates CSAF VEX documents in a target repository, and optionally triggers a Cloud Run Job to reload VEX into Container Analysis. Labels processed issues `vex-reflected`.
- **`src/csaf.js`** — `createVexDocument` factory for building and hydrating CSAF 2.0 VEX documents: upsert products, update vulnerability status, manage threats, and increment document versions.
- **`src/github.js`** — `createGithubVexRepo` client for GitHub VEX repository operations, plus standalone helpers: `parseIssueMetadata`, `parseVexComment`, `buildVexIssueBody`, and `formatCvssLine`.
- **`src/process-handlers.js`** — global `unhandledRejection` and `uncaughtException` handlers for long-running Action processes.
