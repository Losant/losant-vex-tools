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

Checks for updates to a specified Node.js major version (and latest pnpm) and automatically updates repository files. If an upgrade is available, installs the new versions on the runner and runs either a custom upgrade shell script or a built-in generic upgrade across `.node-version`, `package.json` engines, and Dockerfiles, followed by `pnpm install`. Employs progressive fallback and retry logic: if upgrading with pnpm fails, it retries with Node.js only; if that also fails, it updates only `.node-version` so developers are alerted via pull request to review and upgrade manually.

Designed to run on a schedule to keep repositories up to date with the latest runtime and package manager patch/minor releases.

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
        if: steps.upgrade.outputs.new_node_version != ''
        uses: peter-evans/create-pull-request@v6
        with:
          commit-message: "chore(deps): upgrade Node.js to ${{ steps.upgrade.outputs.new_node_version }}"
          title: "chore(deps): upgrade Node.js to ${{ steps.upgrade.outputs.new_node_version }}"
          body: |
            Upgraded Node.js to ${{ steps.upgrade.outputs.new_node_version }}.
            ${{ steps.upgrade.outputs.new_pnpm && format('Upgraded pnpm to {0}.', steps.upgrade.outputs.new_pnpm) || '' }}

            ${{ steps.upgrade.outputs.notes }}
          branch: auto-upgrade-node
```

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `node_major_version` | yes | — | Node.js major version to check for upgrades (e.g. `"24"`). |
| `script_name` | no | empty | Repo-relative path to a custom upgrade shell script (e.g. `scripts/upgrade-node-version.sh`). When provided, the script is called with `NODE_VERSION`, `PNPM_VERSION`, `SKIP_NODE_INSTALL=1`, `SKIP_BUILD=1`, and `COREPACK_ENABLE_STRICT=0`. If omitted, generic upgrade runs instead. |

### Outputs

| Output | Description |
|---|---|
| `current_node` | Node.js version found in `.node-version` before the upgrade. |
| `current_pnpm` | pnpm version found in `package.json` before the upgrade. |
| `new_node_version` | New Node.js version if an upgrade was performed, or empty string if already current. |
| `new_pnpm` | New pnpm version if upgraded, or empty string if unchanged. |
| `notes` | Markdown-formatted warnings or error output from failed attempts; empty on clean success. |

### How it works

1. Reads the current Node.js version from `.node-version` (if present) and the current pnpm version from `package.json` (`packageManager` field).
2. Queries the official Node.js distribution index (`https://nodejs.org/dist/index.json`) for the latest release matching `node_major_version`, and queries the npm registry for the latest `pnpm` release.
3. If Node.js is already at the latest release for the specified major version, the action exits immediately with `new_node_version` set to an empty string.
4. If an upgrade is available:
   - Installs the target Node.js version on the runner via `n` (configured in a temporary prefix directory and added to `PATH`).
   - Installs the target or current `pnpm` version globally via `npm install -g`.
   - Executes the upgrade using either the custom script or the built-in generic upgrade.
5. **Generic upgrade** (when `script_name` is omitted):
   - Updates `.node-version` with the new Node.js version.
   - Searches the repository for `package.json`, `Dockerfile`, and `*.Dockerfile` files (ignoring `node_modules`, `.git`, and `dist`).
   - Updates `engines.node` in `package.json` (preserving any semver range operators such as `^`, `~`, or `>=`) and updates `packageManager` if pnpm is also being upgraded.
   - Replaces `node:<current_version>` and `pnpm@<current_version>` in Dockerfiles with the new versions.
   - Runs `pnpm install --no-frozen-lockfile` to update lockfiles.
6. **Custom script** (when `script_name` is provided):
   - Executes `bash <script_name>` with the following environment variables:
     - `NODE_VERSION`: New Node.js version.
     - `PNPM_VERSION`: New pnpm version (or empty string if on a Node-only attempt).
     - `SKIP_NODE_INSTALL`: `'1'`.
     - `SKIP_BUILD`: `'1'`.
     - `COREPACK_ENABLE_STRICT`: `'0'`.
7. **Progressive retry and fallback**:
   - If pnpm was included in the upgrade and Attempt 1 fails: resets the workspace (`git checkout -- .` and `git clean -fd`), restores the previous global pnpm version, and retries the upgrade with Node.js only (Attempt 2). If Attempt 2 succeeds, `new_pnpm` is set to an empty string and the Attempt 1 failure details are logged in `notes`.
   - If Attempt 2 also fails (or if a Node-only upgrade fails, or if installing Node.js on the runner fails): resets the workspace and updates only `.node-version` so developers are alerted via git diff or pull request to inspect and run the upgrade manually. The failure output from each attempt is captured in `notes`.

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
