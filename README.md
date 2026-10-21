# losant-vex-tools

GitHub Actions and libraries for creating and triaging CSAF VEX documents as part of Losant's vulnerability management process.

### Pipeline overview

```
[scheduled / manual]                     [issue closed by human]
      │                                          │
      ▼                                          ▼
 create-vex                            issue-vex-assertions
      │                                          │
      │  Trivy scans latest tag                  │  Reads closed vex-pending issues
      │  Writes CSAF VEX file                    │  Applies assessments to CSAF file
      │  Opens vex-pending issues                │  Labels issues vex-reflected
      │  Labels issues fixed-in-<branch>         │
      ▼                                          ▼
  vex_repo CSAF file              ◄─────  vex_repo CSAF file
```

---

## GitHub Action: `create-vex`

Detects the latest git tag of the calling repository, scans it with [Trivy](https://trivy.dev), and creates or updates a CSAF 2.0 VEX file in a target VEX repository. Opens `vex-pending` issues for new CVEs requiring human assessment. Carries forward existing assessments from the previous tag so already-triaged CVEs do not generate new issues. Also runs a second Trivy scan against the default branch and labels open issues `fixed-in-<default-branch>` when the CVE is no longer present there.

Designed to run on a schedule so newly disclosed CVEs are caught even for already-released tags.

> **Note:** `create-vex` currently supports **public repositories only**. Trivy clones the repository without authentication, so private repositories will result in a clone failure.

### Usage

```yaml
name: Update VEX
on:
  schedule:
    - cron: '0 6 * * 1'   # weekly
  workflow_dispatch:

jobs:
  create-vex:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Losant/losant-vex-tools/create-vex@main
        with:
          vex_repo: Losant/losant-vex
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          VEX_GITHUB_TOKEN: ${{ secrets.VEX_GITHUB_TOKEN }}
```

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `vex_repo` | no | `GITHUB_REPOSITORY` | `owner/repo` where CSAF VEX files are stored. Defaults to the calling repository. |
| `vex_repo_dir` | no | empty | Directory prefix within `vex_repo` for CSAF files. When omitted, files are written at `<package-name>/<tag>.csaf.json`. When set, files are written at `<vex_repo_dir>/<package-name>/<tag>.csaf.json`. |
| `package_name` | no | repository name | Package or product name used in the CSAF file and VEX path. |
| `purl_type` | no | auto-detected | PURL package type for product identification (e.g. `npm`, `pypi`, `gem`, `cargo`, `golang`). Auto-detected from `package.json`, `pyproject.toml`/`setup.py`, or `Gemfile`/`Gemfile.lock` when omitted. Required when auto-detection fails — the action will error if the type cannot be determined, since Trivy needs a valid PURL to match the VEX file on subsequent runs. |
| `min_severity` | no | `HIGH` | Minimum severity to open a `vex-pending` issue: `CRITICAL`, `HIGH`, `MEDIUM`, or `LOW`. All severities are still recorded in the CSAF file regardless of this threshold. |
| `disable_issues` | no | `false` | Set to `true` to skip all issue creation and updates entirely. |

### Environment variables

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | Token with read access to the calling repository and `issues:write` on the calling repository. |
| `VEX_GITHUB_TOKEN` | Token with `contents:write` on `vex_repo`. Falls back to `GITHUB_TOKEN` if not set. |
| `DISABLE_ISSUES` | Set to any non-empty value to disable all issue creation and updates (same effect as `disable_issues: true`). |

### How it works

1. Fetches the latest two git tags and the repository's default branch name via the GitHub API.
2. Reads the existing CSAF file for the latest tag from `vex_repo` (if a previous scheduled run already created it) and the previous tag's CSAF file for carry-forward data.
3. Scans the latest tag with `trivy repo --tag <tag>`.
4. For each CVE found by Trivy, checks the current CSAF file first:
   - If already assessed as `not_affected` or `known_affected` by a human — skips (no override).
   - If already `under_investigation` — keeps that status and removes the CVE from carry-forward tracking.
   - If not yet in the file — carries forward the status from the previous tag's CSAF (`not_affected` or `known_affected` only); otherwise sets `under_investigation`.
5. CVEs that were `under_investigation` or `known_affected` in the previous tag but are absent from the current Trivy scan are marked `fixed`.
6. Writes the updated CSAF file to `vex_repo`.
7. Opens or updates `vex-pending` issues for CVEs that are `under_investigation` and meet the severity threshold. Closes issues for CVEs marked `fixed`.
8. Scans the default branch with `trivy repo` (no `--tag`) and adds or removes the `fixed-in-<default-branch>` label on open issues depending on whether the CVE is still present there.

### CSAF file layout

```
<vex_repo>/
  <package-name>/
    v1.0.0.csaf.json   ← one file per released tag
    v1.1.0.csaf.json

# with vex_repo_dir set:
<vex_repo>/
  <vex_repo_dir>/
    <package-name>/
      v1.0.0.csaf.json
      v1.1.0.csaf.json
```

---

## GitHub Action: `issue-vex-assertions`

Processes recently closed `vex-pending` issues in the calling repository, writes assessments into the appropriate CSAF VEX files in a target VEX repository, and optionally triggers a Cloud Run Job to reload the updated documents into Container Analysis. Successfully processed issues are labeled `vex-reflected` and have `vex-pending` removed.

### Usage

```yaml
- uses: Losant/losant-vex-tools/issue-vex-assertions@main
  with:
    vex_repo: Losant/losant-vex
    gcp_project: my-gcp-project
    cloud_run_job: vex-loader
    cloud_run_region: us-central1
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    VEX_GITHUB_TOKEN: ${{ secrets.VEX_GITHUB_TOKEN }}
```

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `vex_repo` | yes | — | `owner/repo` where CSAF VEX files live. The token must have `contents:write` on this repo. |
| `timeout_minutes` | no | `360` | Expected max runtime. The look-back window for closed issues is `timeout + 1` minute, so reruns within the window will still pick up any issues closed since the last attempt. Match your workflow's `timeout-minutes` to this value. |
| `gcp_project` | no | — | GCP project ID. If omitted (along with `cloud_run_job` and `cloud_run_region`), the Cloud Run Job trigger is skipped. |
| `cloud_run_job` | no | — | Cloud Run Job name to trigger with `LOAD_ONLY=true` after VEX files are updated. |
| `cloud_run_region` | no | — | Cloud Run region where the job is deployed. |

### Environment variables

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | Token with `issues:write` on the calling (issues) repository. |
| `VEX_GITHUB_TOKEN` | Token with `contents:write` on `vex_repo`. Falls back to `GITHUB_TOKEN` if not set. |

### How it works

1. Fetches all issues closed within the look-back window that carry the `vex-pending` label.
2. For each issue, parses the `VEX_META` block embedded in the issue body to extract the CVE ID, VEX file paths, and affected product IDs.
3. Reads the most recent 100 assessment comments newest-to-oldest, validates their format (status, label, remediation category), and builds a map of product → assessment. The newest valid comment for each product wins. Issues with more than 100 comments are not supported.
4. Reopens any issue that has a malformed comment (posting the error and the offending comment), or that was closed before all products were assessed (posting the missing IDs).
5. Groups valid assessments by VEX file path, reads each CSAF file from the VEX repository, applies the assessments, increments the document version, and commits the result.
6. Labels fully processed issues `vex-reflected` and removes `vex-pending`.
7. Optionally triggers the Cloud Run Job with `LOAD_ONLY=true` and the list of updated VEX paths.

### Building the action

The action runs from a compiled bundle at `<action-name>/dist/index.js`. Rebuild all action bundles after any source change:

```sh
pnpm build:actions
```

---

## GitHub Action: `auto-upgrade-node`

Keeps Node.js, pnpm, and dependencies current. Node.js and pnpm are checked and upgraded **independently** — a pnpm bump no longer requires a Node.js bump — across `.node-version`, `package.json` engines, and Dockerfiles, each followed by `pnpm install`. Every run then finishes with a recursive dependency upgrade (`pnpm -r up`), so the action does useful work even when both runtimes are already current.

Employs progressive fallback and retry logic: if upgrading with pnpm fails, it retries with Node.js only; if that also fails, it updates only `.node-version` so developers are alerted via pull request to review and upgrade manually.

Designed to run on a schedule to keep repositories up to date with the latest runtime, package manager, and dependency releases.

### Usage

```yaml
name: Upgrade Node
on:
  schedule:
    - cron: '0 6 * * 1'   # weekly
  workflow_dispatch:

jobs:
  upgrade-node:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Losant/losant-vex-tools/auto-upgrade-node@main
        id: upgrade
        with:
          node_major_version: '24'

      - name: Create Pull Request
        if: steps.upgrade.outputs.has_changes == 'true'
        uses: peter-evans/create-pull-request@v6
        with:
          commit-message: "chore(deps): upgrade dependencies"
          title: >-
            chore(deps):
            ${{ steps.upgrade.outputs.new_node_version && format('upgrade Node.js to {0}', steps.upgrade.outputs.new_node_version)
              || steps.upgrade.outputs.new_pnpm && format('upgrade pnpm to {0}', steps.upgrade.outputs.new_pnpm)
              || 'upgrade dependencies' }}
          body: |
            ${{ steps.upgrade.outputs.new_node_version && format('Upgraded Node.js to {0}.', steps.upgrade.outputs.new_node_version) || '' }}
            ${{ steps.upgrade.outputs.new_pnpm && format('Upgraded pnpm to {0}.', steps.upgrade.outputs.new_pnpm) || '' }}
            Ran `pnpm -r up` to upgrade dependencies.

            ${{ steps.upgrade.outputs.notes }}
          branch: auto-upgrade-node
```

Repositories with more than one pnpm project root, or that want major-version dependency bumps:

```yaml
      - uses: Losant/losant-vex-tools/auto-upgrade-node@main
        id: upgrade
        with:
          node_major_version: '24'
          project_dirs: 'packages/api,tools/cli'
          upgrade_to_latest: 'true'
```

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `node_major_version` | yes | — | Node.js major version to check for upgrades (e.g. `"24"`). |
| `project_dirs` | no | empty | Comma-separated, repo-relative directories, each treated as its own pnpm project root. `pnpm install` and the final `pnpm -r up` run in each of these **in addition to** the repository root. A bad entry (typo, nonexistent directory) is not validated ahead of time — it's left to fail at `pnpm install`, which reports it more clearly than a pre-flight check would. By then, the Node.js/pnpm pin edits earlier in the run may already be checkpointed. A `project_dirs` entry without its own `pnpm-workspace.yaml` runs with `--ignore-workspace`, so it installs/upgrades against its own `package.json` instead of being swept into the repository root's workspace. |
| `upgrade_to_latest` | no | `'false'` | Set to `'true'` to run the final dependency upgrade as `pnpm -r up --latest`, allowing major-version bumps and rewriting `package.json` ranges. Defaults to `pnpm -r up`, which stays within the ranges already declared. |

### Outputs

| Output | Description |
|---|---|
| `current_node` | Node.js version found in `.node-version` before the upgrade. |
| `current_pnpm` | pnpm version found in `package.json` before the upgrade. |
| `new_node_version` | New Node.js version if Node.js was upgraded, or empty string if it was already current. |
| `new_pnpm` | New pnpm version if pnpm was upgraded, or empty string otherwise. Reachable without a Node.js upgrade, since the two are independent. |
| `notes` | Markdown-formatted warnings or error output from failed attempts, including dependency upgrade failures; empty on clean success. |
| `has_changes` | `'true'` when the run left uncommitted changes in the working tree, `'false'` otherwise. **Gate pull request creation on this**, not on `new_node_version` — dependency-only upgrades change files without changing the Node.js version. |

### How it works

1. Reads the current Node.js version from `.node-version` (if present) and the current pnpm version from `package.json` (`packageManager` field). If the working tree is already dirty, it logs a warning, since `has_changes` cannot then distinguish this run's edits from the pre-existing ones.
2. Queries the official Node.js distribution index (`https://nodejs.org/dist/index.json`) for the latest release matching `node_major_version`, and queries the npm registry for the latest `pnpm` release. A pnpm upgrade is only considered when the repository already pins `packageManager`.
3. Applies the upgrades in sequence — Node.js first and on its own, so that a failing install is unambiguously attributable to the Node.js bump rather than to the two changes together:

```
Node upgrade available? ──YES──▶ rewrite node pins → pnpm install
       │                          ├─ fails → reset, keep .node-version only, stop
       │                          └─ ok    → git add -A   (checkpoint)
       ▼
pnpm upgrade available? ──YES──▶ rewrite pnpm pins → pnpm install
       │                          ├─ fails → roll back to checkpoint,
       │                          │          revert global pnpm
       │                          └─ ok    → git add -A   (checkpoint)
       ▼
pnpm -r up  (always runs)
       └─ fails → anything checkpointed?  roll back to it, exit 0
                  nothing upgraded?       reset, exit 1
```

Each upgrade gets its own `pnpm install`. That is deliberately more installs than the minimum — the action runs on a schedule and nothing waits on it, so clean attribution is worth more than the saved minutes.

Rollback is `git checkout -- .` followed by `git clean -fd`, which restores the working tree from the index. Because each successful step is staged with `git add -A`, a later failure reverts only that step: the earlier upgrades and the lockfile they installed with are already in the index, so they survive untouched and never need to be re-applied or reinstalled.

4. **Runner setup**: Node.js is installed via `n` (in a temporary prefix added to `PATH`) **only when Node.js is actually being upgraded**; otherwise the caller's Node.js is used as-is. pnpm is installed globally at the new version when upgrading, or reinstalled at the current version when `n` created a fresh global prefix.
5. **File updates**:
   - Writes `.node-version` with the new Node.js version.
   - Finds the `package.json`, `Dockerfile`, and `*.Dockerfile` files to rewrite by asking `git ls-files`, so only tracked files are touched and ignored directories such as `node_modules` never come up.
   - Updates every `"node": "<version>"` pin in `package.json` — `engines`, `volta`, and so on — preserving any semver range operator (`^`, `~`, `>=`). A major-only range such as `">=24"` is intentionally left alone, since it does not need bumping.
   - Updates `packageManager` and any other `pnpm@<version>` pin in `package.json`, and replaces `node:<current_version>` and `pnpm@<current_version>` in Dockerfiles, along with `NODE_VERSION` / `PNPM_VERSION` build args (`ARG NODE_VERSION=<current_version>` / `ENV PNPM_VERSION=<current_version>`, etc.) for Dockerfiles that pin via `FROM node:${NODE_VERSION}` or `pnpm@${PNPM_VERSION}` instead of a literal tag.
   - Runs `pnpm install --no-frozen-lockfile` in the repository root and each `project_dirs` entry, stopping at the first directory that fails.
6. **Dependency upgrade**: runs `pnpm -r up` (or `pnpm -r up --latest`) in the repository root and each `project_dirs` entry. Unlike install, this runs every directory even if an earlier one fails, since the roots are independent. Failures are reported in `notes`.
   - Either command adds `--ignore-workspace` for a `project_dirs` entry that has no `pnpm-workspace.yaml` of its own, so pnpm treats it as a standalone package instead of walking up to the repository root's workspace and installing/upgrading there instead.
7. **Fallbacks**:
   - If `pnpm install` fails on the Node.js bump, or installing Node.js on the runner fails: resets the workspace (`git reset --hard HEAD` and `git clean -fd`) and updates only `.node-version`, so the upgrade still surfaces in a pull request for manual follow-up. pnpm and the dependency upgrade are **skipped** in this case, since install is known to be broken.
   - If `pnpm install` fails on the pnpm bump: rolls back to the checkpoint and restores the previous global pnpm version. `new_pnpm` is empty and the failure is captured in `notes`; the Node.js upgrade is kept exactly as it installed.
   - If only the final `pnpm -r up` fails: rolls back to the checkpoint, so the churned lockfiles are discarded and every upgrade that installed cleanly is kept. The pull request still opens, with the error in `notes`.
   - The action exits non-zero when the dependency upgrade fails and there is no Node.js or pnpm bump left to open a pull request for.

> Checkpointing uses `git add -A`, so it relies on the repository's `.gitignore`. Anything `pnpm install` generates that is **not** ignored — `node_modules` in a repository that forgot to ignore it — will be staged and end up in the pull request.

> Changes are left **staged** in the index rather than committed — the caller is expected to commit them. `has_changes` is `git status --porcelain` being non-empty, which covers staged and unstaged alike, and `peter-evans/create-pull-request` picks up both. A workflow that inspects the result with plain `git diff` will see nothing, though, and needs `git diff HEAD` instead.

> `git clean -fd` does not remove ignored files, so an existing `node_modules` survives a rollback. This keeps the follow-up installs fast but means they are not fully hermetic. A `project_dirs` entry that is a nested git repository or submodule will not surface in the root `git status`, and so will not be reflected in `has_changes`.

---

## Library: `src/csaf.js`

Provides `createVexDocument`, a factory that creates or hydrates a CSAF 2.0 VEX document and exposes a mutation API over it.

### Import

```js
import { createVexDocument } from 'losant-vex-tools';
// or directly:
import { createVexDocument } from 'losant-vex-tools/csaf';
```

### Creating a new document

```js
const doc = createVexDocument({ title: 'Platform VEX', id: 'platform-v1.37.0' });
```

### Hydrating an existing document

Pass a parsed CSAF JSON object (e.g. read from GitHub) to restore full state:

```js
const doc = createVexDocument(existingCsafJson);
```

### API

| Method | Description |
|---|---|
| `upsertProduct({ name, productId, productName, purl })` | Adds or replaces a product in the `product_tree`. `productId` is the canonical identifier (e.g. an image reference with digest). The product_identification_helper is the purl which should be formatted properly depending on the product type. |
| `updateVulnerabilityStatus(cveId, productId, status, { justification, label, remediationCategory, remediationDetails })` | Sets the VEX status for a product within a vulnerability. Moves the product between status buckets and updates threats, flags, remediations, and notes as appropriate for the status. Valid statuses: `known_not_affected`, `known_affected`, `fixed`, `under_investigation`. |
| `incrementVersion()` | Bumps the document version number, updates `current_release_date`, and appends a revision history entry. |
| `getCveProductStatus(cveId, productId)` | Returns the current status string for a product/CVE pair, or `null` if not set. |
| `getCveProductSnapshot(cveId, productId)` | Returns `{ justification, label, remediationCategory, remediationDetails }` for a product/CVE pair, reading from the internal threats, flags, and remediations maps. All fields are `null` if not set. Returns `null` if the CVE is not present. |
| `getProducts()` | Returns all product branch entries from the `product_tree`. |
| `toJson()` | Serializes the document to a plain CSAF 2.0 JSON object ready for storage. |

### Status, threats, flags, remediations, and notes

`updateVulnerabilityStatus` keeps product IDs exclusive across status buckets — setting a new status automatically removes the product from its previous bucket. Each status writes to a different set of CSAF fields:

| Status | `threats[category=impact]` | `flags` | `remediations` | `notes` |
|---|---|---|---|---|
| `known_not_affected` | ✓ `justification` (human-readable why) | ✓ `label` (machine-readable why) | — | — |
| `known_affected` | ✓ `justification` (impact description) | — | ✓ `remediationCategory` + `remediationDetails` (action statement) | — |
| `fixed` | — | — | ✓ `remediationCategory` + `remediationDetails` | — |
| `under_investigation` | — | — | — | ✓ updates note text with `justification` |

Products with the same justification string are grouped under a single threat entry. Products with the same label are grouped under a single flag entry. Products with the same remediation category and details are grouped under a single remediation entry.

---

## Library: `src/github.js`

Provides a GitHub VEX repository client and a set of standalone helpers for parsing and building VEX issue content.

### Import

```js
import { createGithubVexRepo, parseVexComment, validateVexComment, parseIssueMetadata, buildVexIssueBody, formatCvssLine } from 'losant-vex-tools';
// or directly:
import { createGithubVexRepo } from 'losant-vex-tools/github';
```

### `createGithubVexRepo(token)`

Returns a client for a GitHub repository that stores CSAF VEX files. Pass a Personal Access Token or a GitHub Actions `GITHUB_TOKEN`. If `token` is falsy, the client authenticates as a GitHub App using `GH_APP_ID`, `GH_PRIVATE_KEY`, and `GH_INSTALLATION_ID` from the environment.

```js
const repo = createGithubVexRepo(process.env.GITHUB_TOKEN);
```

**Client methods:**

| Method | Description |
|---|---|
| `readVexFile({ owner, repo, path })` | Reads a CSAF JSON file from the repository. Returns `{ doc, sha }` or `null` if the file does not exist. |
| `writeVexFile({ owner, repo, path, doc, sha, message })` | Creates or updates a CSAF JSON file. Pass `sha` from a prior `readVexFile` call to update an existing file. |
| `getClosedVexPendingIssues({ owner, repo, since })` | Paginates all closed issues labeled `vex-pending` closed since the given ISO timestamp. |
| `getOpenVexCveIssuesMap({ owner, repo })` | Returns a `Map<cveId, issue>` of all open `vex-pending` issues. |
| `openVexIssue({ owner, repo, cveId, vexPath, productIds, severity, referenceUrl, packages, cvss, pkgFileLocation })` | Opens a new VEX triage issue with a formatted body and the `vex-pending` label. |
| `updateVexIssue({ owner, repo, issue, cveId, vexPath, productIds, …, force })` | Updates the body of an existing VEX issue when the product list, severity, packages, CVSS, reference URL, or `pkgFileLocation` changes. Pass `force: true` to rewrite the body even when nothing has changed. Closes the issue automatically if all products are removed. |
| `getAssessmentComments({ owner, repo, issueNumber, allProductIds })` | Returns `{ assessments, errors }`. Reads the most recent 100 comments newest-to-oldest; the first valid assessment for each product wins. Stops processing once all `allProductIds` are covered. Issues with more than 100 comments are not supported. `assessments` is `[{ productId, status, justification, label, remediationCategory, remediationDetails }]`. `errors` is `[{ error, body, url }]` for malformed comments whose product IDs were not covered by a newer valid comment. |
| `markIssueAsReflected({ owner, repo, issue })` | Adds `vex-reflected` and removes `vex-pending` from an issue. |
| `ensureLabel({ owner, repo, name, color })` | Creates a label if it does not already exist. |
| `addLabels({ owner, repo, issueNumber, labels })` | Adds labels to an issue. |
| `removeLabel({ owner, repo, issueNumber, name })` | Removes a label from an issue, ignoring 404 errors. |
| `reopenWithComment({ owner, repo, issueNumber, body })` | Posts a comment and reopens an issue. |

### `validateVexComment(body)`

Validates a comment body as a VEX assessment. Returns:
- `null` — comment has no `PRODUCT:` or `VEX:` lines, or no parseable product IDs; not a VEX comment
- `{ productIds, error: string }` — looks like a VEX comment but has a formatting problem (missing justification, invalid status, `UNDER_INVESTIGATION` used as an assessment, invalid `LABEL:` value, invalid `REMEDIATION:` category); `productIds` is always present so callers can correlate the error to specific products
- parsed object — valid; same shape as `parseVexComment`

### `parseVexComment(body)`

Parses a VEX assessment comment body. Returns `{ productIds, status, justification, label, remediationCategory, remediationDetails }` or `null` if the comment does not contain the expected lines. Does not validate field values — use `validateVexComment` for that.

Expected format:

```
PRODUCT: <product ID>, <product ID>, ...
VEX: NOT_AFFECTED - <justification text>
LABEL: <label>
```

Valid status values (case-insensitive): `NOT_AFFECTED`, `FIXED`, `AFFECTED`, `UNDER_INVESTIGATION`. The separator between status and justification may be a hyphen or em-dash.

### `parseIssueMetadata(issue)`

Extracts the structured metadata embedded in a VEX issue body by the `<!-- VEX_META … -->` comment block. Returns `{ cveId, paths, packages, referenceUrl, pkgFileLocation, cvss }` or `null` if the issue title or body does not match the expected format.

### `buildVexIssueBody(opts)`

Renders the full Markdown body for a VEX triage issue, including the severity heading, optional `pkgFileLocation` line, CVSS summary line, affected packages table, affected images table, assessment instructions with label and remediation reference tables, and the embedded `VEX_META` JSON block.

### `formatCvssLine(cvss)`

Returns a one-line CVSS summary string (e.g. `CVSS 7.5 · NETWORK · LOW complexity · No auth · No user interaction\n\n`) suitable for embedding in an issue body, or an empty string if `cvss` is null or has no score.

---

## Development

```sh
pnpm install
pnpm run setup      # one-time: configures git hooks via husky
pnpm test
pnpm build:actions  # compiles all actions to their dist/ directories
```
