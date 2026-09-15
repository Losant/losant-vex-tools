import '../src/process-handlers.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { forEachSerialP, difference } from 'omnibelt';
import { createVexDocument } from '../src/csaf.js';
import { createGithubVexRepo, parseIssueMetadata } from '../src/github.js';

const execFileAsync = promisify(execFile);

const TIMEOUT_MINUTES  = Number(process.env.INPUT_TIMEOUT_MINUTES) || 360;
const LOOKBACK_MS      = (TIMEOUT_MINUTES + 1) * 60 * 1000;
const VEX_REPO         = process.env.INPUT_VEX_REPO;
const GCP_PROJECT      = process.env.INPUT_GCP_PROJECT;
const CLOUD_RUN_JOB    = process.env.INPUT_CLOUD_RUN_JOB;
const CLOUD_RUN_REGION = process.env.INPUT_CLOUD_RUN_REGION;

if (!VEX_REPO) { throw new Error('INPUT_VEX_REPO (vex_repo action input) is required'); }
const [VEX_OWNER, VEX_REPO_NAME] = VEX_REPO.split('/');
if (!VEX_OWNER || !VEX_REPO_NAME) { throw new Error('INPUT_VEX_REPO must be in "owner/repo" format'); }
if (!process.env.GITHUB_REPOSITORY) { throw new Error('GITHUB_REPOSITORY env var is required'); }
const [ISSUES_OWNER, ISSUES_REPO_NAME] = process.env.GITHUB_REPOSITORY.split('/');

const issuesGhRepo = createGithubVexRepo(process.env.GITHUB_TOKEN);
const vexGhRepo = createGithubVexRepo(process.env.VEX_GITHUB_TOKEN || process.env.GITHUB_TOKEN);

const run = async () => {
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

  const issues = await issuesGhRepo.getClosedVexPendingIssues({ owner: ISSUES_OWNER, repo: ISSUES_REPO_NAME, since });

  if (issues.length === 0) {
    console.log('No unprocessed closed VEX issues found.');
    return;
  }
  console.log(`Found ${issues.length} issue(s) to process.`);

  // Group assessments by VEX path so each file is written once per run.
  // An issue can span multiple VEX paths (e.g., platform + edge); assessments
  // are routed to the correct file based on which path owns each product ID.
  const byVexPath = new Map();
  // Track which vexPaths each issue number spans so we can confirm all writes succeeded.
  const issueToVexPaths = new Map();

  await forEachSerialP(async (issue) => {
    const meta = parseIssueMetadata(issue);
    if (!meta) { return; }
    const allProductIds = Object.values(meta.paths).flat();
    if (!allProductIds.length) { return; }
    const { assessments, errors } = await issuesGhRepo.getAssessmentComments({
      owner: ISSUES_OWNER, repo: ISSUES_REPO_NAME, issueNumber: issue.number, allProductIds
    });

    const missing = difference(allProductIds, assessments.map((a) => a.productId));
    if (missing.length > 0) {
      if (errors.length > 0) {
        const { error, body } = errors[0];
        await issuesGhRepo.reopenWithComment({
          owner: ISSUES_OWNER,
          repo: ISSUES_REPO_NAME,
          issueNumber: issue.number,
          body: `A VEX comment could not be processed due to a formatting error.\n\n**Error:** ${error}\n\n**Comment:**\n\`\`\`\n${body}\n\`\`\``
        });
      } else {
        await issuesGhRepo.reopenWithComment({
          owner: ISSUES_OWNER,
          repo: ISSUES_REPO_NAME,
          issueNumber: issue.number,
          body: `This issue was closed before all affected products were assessed. Please add assessments for the following and close again:\n\n${missing.map((id) => `- \`${id}\``).join('\n')}`
        });
      }
      return;
    }
    if (!assessments.length) { return; }

    // Build a reverse map so each productId resolves to its vexPath.
    const productToPath = {};
    for (const [vp, pids] of Object.entries(meta.paths)) {
      for (const pid of pids) { productToPath[pid] = vp; }
    }

    // Route each assessment to its owning vexPath.
    for (const assessment of assessments) {
      const vp = productToPath[assessment.productId];
      if (!vp) { continue; }
      if (!byVexPath.has(vp)) { byVexPath.set(vp, []); }
      byVexPath.get(vp).push({ issue, cveId: meta.cveId, assessment });
      if (!issueToVexPaths.has(issue.number)) { issueToVexPaths.set(issue.number, new Set()); }
      issueToVexPaths.get(issue.number).add(vp);
    }
  }, issues);

  if (byVexPath.size === 0) {
    console.log('No assessable issues found.');
    return;
  }

  // Write one VEX file per path; track which paths actually succeeded.
  const successfulVexPaths = new Set();
  await forEachSerialP(async (vexPath) => {
    const entries = byVexPath.get(vexPath);
    const existing = await vexGhRepo.readVexFile({ owner: VEX_OWNER, repo: VEX_REPO_NAME, path: vexPath });
    if (!existing) {
      console.warn(`VEX file not found: ${vexPath}, skipping.`);
      return;
    }

    const { doc: rawDoc, sha } = existing;
    const vexDoc = createVexDocument(rawDoc);

    // Collect unique (issue, cveId) pairs so we can build commit messages.
    const issueCvePairs = new Map();
    for (const { issue, cveId, assessment } of entries) {
      const key = `${issue.number}:${cveId}`;
      if (!issueCvePairs.has(key)) { issueCvePairs.set(key, { issue, cveId }); }
      vexDoc.updateVulnerabilityStatus(cveId, assessment.productId, assessment.status, {
        justification: assessment.justification,
        label: assessment.label,
        remediationCategory: assessment.remediationCategory,
        remediationDetails: assessment.remediationDetails
      });
    }

    vexDoc.incrementVersion();

    const uniqueEntries = [...issueCvePairs.values()];
    await vexGhRepo.writeVexFile({
      owner: VEX_OWNER,
      repo: VEX_REPO_NAME,
      path: vexPath,
      doc: vexDoc.toJson(),
      sha,
      message: `vex: assess updates for ${uniqueEntries.length} CVE(s) from ${uniqueEntries.map((e) => `#${e.issue.number}`).join(', ')}`
    });
    successfulVexPaths.add(vexPath);
    console.log(`Updated ${vexPath}: ${uniqueEntries.length} CVE(s) assessed`);
  }, [...byVexPath.keys()]);

  // Only mark issues as reflected if every one of their vexPaths was successfully written.
  const processedIssues = issues.filter((i) => {
    const paths = issueToVexPaths.get(i.number);
    return paths && [...paths].every((vp) => successfulVexPaths.has(vp));
  });

  if (!processedIssues.length) { return; }
  await issuesGhRepo.ensureLabel({ owner: ISSUES_OWNER, repo: ISSUES_REPO_NAME, name: 'vex-reflected' });
  await forEachSerialP(async (issue) => {
    await issuesGhRepo.markIssueAsReflected({ owner: ISSUES_OWNER, repo: ISSUES_REPO_NAME, issue });
    console.log(`  Labeled #${issue.number} as vex-reflected, removed vex-pending`);
  }, processedIssues);

  if (!CLOUD_RUN_JOB || !CLOUD_RUN_REGION || !GCP_PROJECT) {
    return console.warn('CLOUD_RUN_JOB, CLOUD_RUN_REGION, or GCP_PROJECT not set, skipping Cloud Run Job trigger.');
  }
  const vexPathList = [...successfulVexPaths].join(',');
  await execFileAsync('gcloud', [
    'run', 'jobs', 'execute', CLOUD_RUN_JOB,
    '--region', CLOUD_RUN_REGION,
    `--update-env-vars=^:^LOAD_ONLY=true:VEX_PATH=${vexPathList}`,
    '--project', GCP_PROJECT,
    '--async'
  ]);
  console.log(`Triggered ${CLOUD_RUN_JOB} with LOAD_ONLY=true`);
};

try {
  await run();
  process.exit(0);
} catch (err) {
  console.error('VEX update failed:', err);
  process.exit(1);
}
