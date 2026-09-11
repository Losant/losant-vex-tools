# losant-vex-tools

GitHub Actions and libraries for creating and triaging CSAF VEX documents as part of Losant's vulnerability management process.

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
3. Reads assessment comments (lines matching `PRODUCT: …` / `VEX: STATUS - justification`) to build a map of product → status.
4. Reopens any issue that was closed before all of its products were assessed, posting a comment listing the missing product IDs.
5. Groups valid assessments by VEX file path, reads each CSAF file from the VEX repository, applies the assessments, increments the document version, and commits the result.
6. Labels fully processed issues `vex-reflected` and removes `vex-pending`.
7. Optionally triggers the Cloud Run Job with `LOAD_ONLY=true` and the list of updated VEX paths.

### Building the action

The action runs from a compiled bundle at `issue-vex-assertions/dist/index.js`. Rebuild it after any source change:

```sh
pnpm build
```

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
| `upsertProduct({ name, productId, productName, shaRef })` | Adds or replaces a product in the `product_tree`. `productId` is the canonical identifier (e.g. an image reference with digest). |
| `updateVulnerabilityStatus(cveId, productId, status, justification)` | Sets the VEX status for a product within a vulnerability. Moves the product between status buckets and updates the `threats` array. Valid statuses: `known_not_affected`, `known_affected`, `fixed`, `under_investigation`. |
| `incrementVersion()` | Bumps the document version number, updates `current_release_date`, and appends a revision history entry. |
| `getCveProductStatus(cveId, productId)` | Returns the current status string for a product/CVE pair, or `null` if not set. |
| `getProducts()` | Returns all product branch entries from the `product_tree`. |
| `toJson()` | Serializes the document to a plain CSAF 2.0 JSON object ready for storage. |

### Status and threats

`updateVulnerabilityStatus` keeps product IDs exclusive across status buckets — setting a new status automatically removes the product from its previous bucket. For all statuses except `under_investigation`, it also records the justification as an `impact` threat entry. Products with the same justification string are grouped under a single threat.

---

## Library: `src/github.js`

Provides a GitHub VEX repository client and a set of standalone helpers for parsing and building VEX issue content.

### Import

```js
import { createGithubVexRepo, parseVexComment, parseIssueMetadata, buildVexIssueBody, formatCvssLine } from 'losant-vex-tools';
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
| `openVexIssue({ owner, repo, cveId, vexPath, productIds, severity, referenceUrl, packages, cvss })` | Opens a new VEX triage issue with a formatted body and the `vex-pending` label. |
| `updateVexIssue({ owner, repo, issue, cveId, vexPath, productIds, … })` | Updates the body of an existing VEX issue when the product list, severity, packages, or reference URL changes. Closes the issue automatically if all products are removed. |
| `getAssessmentComments({ owner, repo, issueNumber })` | Returns all assessment comments on an issue as `[{ productId, status, justification }]`. Later comments for the same product ID overwrite earlier ones. |
| `markIssueAsReflected({ owner, repo, issue })` | Adds `vex-reflected` and removes `vex-pending` from an issue. |
| `ensureLabel({ owner, repo, name, color })` | Creates a label if it does not already exist. |
| `addLabels({ owner, repo, issueNumber, labels })` | Adds labels to an issue. |
| `removeLabel({ owner, repo, issueNumber, name })` | Removes a label from an issue, ignoring 404 errors. |
| `reopenWithComment({ owner, repo, issueNumber, body })` | Posts a comment and reopens an issue. |

### `parseVexComment(body)`

Parses a VEX assessment comment body. Returns `{ productIds, status, justification }` or `null` if the comment does not contain the expected lines.

Expected format:

```
PRODUCT: <product ID>, <product ID>, ...
VEX: NOT_AFFECTED - <justification text>
```

Valid status values (case-insensitive): `NOT_AFFECTED`, `FIXED`, `AFFECTED`, `UNDER_INVESTIGATION`. The separator between status and justification may be a hyphen or em-dash.

### `parseIssueMetadata(issue)`

Extracts the structured metadata embedded in a VEX issue body by the `<!-- VEX_META … -->` comment block. Returns `{ cveId, paths, packages, referenceUrl }` or `null` if the issue title or body does not match the expected format.

### `buildVexIssueBody(opts)`

Renders the full Markdown body for a VEX triage issue, including the severity heading, CVSS summary line, affected packages table, affected images table, assessment instructions, and the embedded `VEX_META` JSON block.

### `formatCvssLine(cvss)`

Returns a one-line CVSS summary string (e.g. `CVSS 7.5 · NETWORK · LOW complexity · No auth · No user interaction\n\n`) suitable for embedding in an issue body, or an empty string if `cvss` is null or has no score.

---

## Development

```sh
pnpm install
pnpm test
pnpm build   # compiles issue-vex-assertions to dist/
```
