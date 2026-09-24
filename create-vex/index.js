import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { forEachSerialP } from 'omnibelt';
import { createVexDocument } from '../src/csaf.js';
import { createGithubVexRepo, parseIssueMetadata } from '../src/github.js';
import { meetsMinSeverity, parseTrivyResults, updateVexDocWithTrivyFindings } from './trivy.js';
import '../src/process-handlers.js';

const getInput = (name) => process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`]?.trim() ?? '';

const trivyScan = (args, env) => {
  execFileSync('trivy', [...args, '--format', 'json', '--scanners', 'vuln', '--no-progress', '--quiet'], { stdio: ['ignore', 'ignore', 'inherit'], env });
};

const joinVexPath = (...parts) => posix.join(...parts).replace(/^\//, '');

const detectPurlType = () => {
  const ws = process.env.GITHUB_WORKSPACE ?? '.';
  if (existsSync(`${ws}/package.json`)) { return 'npm'; }
  if (existsSync(`${ws}/pyproject.toml`) || existsSync(`${ws}/setup.py`)) { return 'pypi'; }
  if (existsSync(`${ws}/Gemfile.lock`) || existsSync(`${ws}/Gemfile`)) { return 'gem'; }
  return null;
};

const buildPurl = (type, name, version) => `pkg:${type.toLowerCase()}/${name}@${version}`;

const manageIssues = async (ghRepo, vexDoc, trivyResults, repoUrl, trivyEnv, {
  issuesOwner, issuesRepo, fixedInBranchLabel, currentVexPath, oldVexPath, currentProductId, defaultBranch, minSeverity
}) => {
  await ghRepo.ensureLabel({ owner: issuesOwner, repo: issuesRepo, name: 'vex-pending' });
  await ghRepo.ensureLabel({ owner: issuesOwner, repo: issuesRepo, name: 'vex-reflected' });
  await ghRepo.ensureLabel({ owner: issuesOwner, repo: issuesRepo, name: fixedInBranchLabel, color: 'e4e669' });

  const openIssues = await ghRepo.getOpenVexCveIssuesMap({ owner: issuesOwner, repo: issuesRepo });
  const updatedDoc = vexDoc.toJson();
  await forEachSerialP(async (vuln) => {
    const { cve: cveId, product_status: ps } = vuln;
    const underInvestigation = ps?.under_investigation ?? [];
    const fixed = ps?.fixed ?? [];
    if (underInvestigation.includes(currentProductId)) {
      const finding = trivyResults.get(cveId);
      if (!finding || !meetsMinSeverity(finding.severity, minSeverity)) { return; }

      const existingIssue = openIssues.get(cveId);
      const issueArgs = {
        owner: issuesOwner,
        repo: issuesRepo,
        cveId,
        vexPath: currentVexPath,
        oldVexPath,
        productIds: [currentProductId],
        severity: finding.severity,
        referenceUrl: finding.referenceUrl,
        packages: finding.packages,
        cvss: finding.cvss
      };

      if (!existingIssue) {
        await ghRepo.openVexIssue(issueArgs);
      } else {
        await ghRepo.updateVexIssue({ ...issueArgs, issue: existingIssue });
      }
    }

    if (fixed.includes(currentProductId)) {
      const existingIssue = openIssues.get(cveId);
      if (existingIssue) {
        await ghRepo.updateVexIssue({
          owner: issuesOwner,
          repo: issuesRepo,
          issue: existingIssue,
          cveId,
          vexPath: currentVexPath,
          oldVexPath,
          productIds: [],
          fixedProductIds: [currentProductId]
        });
      }
    }
  }, updatedDoc.vulnerabilities);

  // Check if CVEs are fixed in the default branch (HEAD)
  trivyScan(['repo', '--branch', defaultBranch, repoUrl, '--output', '/tmp/trivy-head.json'], trivyEnv);
  const trivyHeadOutput = JSON.parse(readFileSync('/tmp/trivy-head.json', 'utf-8'));
  const headCveIds = new Set([...parseTrivyResults(trivyHeadOutput).keys()]);

  // Re-fetch open issues since some may have been closed above
  const remainingOpenIssues = await ghRepo.getOpenVexCveIssuesMap({ owner: issuesOwner, repo: issuesRepo });

  await forEachSerialP([...remainingOpenIssues.entries()], async ([cveId, issue]) => {
    const issuePaths = Object.keys(parseIssueMetadata(issue)?.paths ?? {});
    const isRelevant = issuePaths.includes(currentVexPath) || (oldVexPath && issuePaths.includes(oldVexPath));
    if (!isRelevant) { return; }

    const isFixedInHead = !headCveIds.has(cveId);
    const hasLabel = issue.labels?.some((l) => l.name === fixedInBranchLabel);

    if (isFixedInHead && !hasLabel) {
      await ghRepo.addLabels({ owner: issuesOwner, repo: issuesRepo, issueNumber: issue.number, labels: [fixedInBranchLabel] });
    } else if (!isFixedInHead && hasLabel) {
      await ghRepo.removeLabel({ owner: issuesOwner, repo: issuesRepo, issueNumber: issue.number, name: fixedInBranchLabel });
    }
  });
};

const run = async () => {
  const [repoOwner, repoName] = (process.env.GITHUB_REPOSITORY ?? '').split('/');

  const vexRepoInput = getInput('vex_repo') || process.env.GITHUB_REPOSITORY;
  const vexRepoDir = getInput('vex_repo_dir');
  const minSeverity = getInput('min_severity') || 'HIGH';
  // DISABLE_ISSUES: presence of the env var (any value, including "false") disables issues.
  const disableIssues = getInput('disable_issues') === 'true' || !!process.env.DISABLE_ISSUES;

  const [vexOwner, vexRepo] = vexRepoInput.split('/');

  const packageName = getInput('package_name') || repoName;
  const purlType = getInput('purl_type') || detectPurlType();
  if (!purlType) { throw new Error('Could not detect package type. Set the purl_type input (e.g. npm, pypi, gem, cargo, golang).'); }

  console.log(`Package: ${packageName}, repo: ${repoOwner}/${repoName}`);

  const ghRepo = createGithubVexRepo(process.env.GITHUB_TOKEN);
  const vexGhRepo = createGithubVexRepo(process.env.VEX_GITHUB_TOKEN || process.env.GITHUB_TOKEN);

  // Detect latest two tags and default branch in parallel
  const { tags, repoData } = await ghRepo.getRepoDetails(repoOwner, repoName);
  if (!tags.length) { throw new Error('No tags found in repository'); }
  const latestTag = tags[0];
  const previousTag = tags[1] ?? null;
  const fixedInBranchLabel = `fixed-in-${repoData.default_branch}`;

  console.log(`Latest tag: ${latestTag.name}${previousTag ? `, previous: ${previousTag.name}` : ''}, default branch: ${repoData.default_branch}`);
  const currentVexPath = joinVexPath(vexRepoDir || '.', packageName, `${latestTag.name}.csaf.json`);
  const prevVexPath = previousTag ? joinVexPath(vexRepoDir || '.', packageName, `${previousTag.name}.csaf.json`) : null;
  const currentProductId = `${packageName}:${latestTag.name}`;
  const previousProductId = previousTag ? `${packageName}:${previousTag.name}` : null;

  // Read current tag's VEX (may exist from a prior scheduled run)
  const currentVexResult = await vexGhRepo.readVexFile({ owner: vexOwner, repo: vexRepo, path: currentVexPath });
  const currentDoc = currentVexResult?.doc ?? null;
  const currentSha = currentVexResult?.sha ?? null;

  const vexDoc = createVexDocument(currentDoc || { title: `${packageName} ${latestTag.name} VEX`, id: `${packageName}-${latestTag.name}` });

  // Read previous tag's VEX for carry-forward
  const prevVexResult = prevVexPath ? await vexGhRepo.readVexFile({ owner: vexOwner, repo: vexRepo, path: prevVexPath }) : null;
  const prevDoc = prevVexResult?.doc ?? null;
  const prevVexDoc = prevDoc ? createVexDocument(prevDoc) : null;

  // Snapshot previous version's CVE statuses
  const previousStatusMap = new Map();
  if (prevVexDoc && prevDoc && previousProductId) {
    for (const vuln of prevDoc.vulnerabilities ?? []) {
      const status = prevVexDoc.getCveProductStatus(vuln.cve, previousProductId);
      if (!status) { continue; }
      const snapshot = prevVexDoc.getCveProductSnapshot(vuln.cve, previousProductId);
      previousStatusMap.set(vuln.cve, {
        status,
        ...snapshot
      });
    }
  }

  // Trivy scan the tagged version, suppressing already-assessed CVEs using the current VEX if it exists
  // GITHUB_TOKEN is intentionally excluded — this action only supports public repositories.
  const trivyEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
  const repoUrl = `https://github.com/${repoOwner}/${repoName}`;
  const vexArgs = currentDoc ? ['--vex', '/tmp/current-vex.json'] : [];
  if (currentDoc) {
    writeFileSync('/tmp/current-vex.json', JSON.stringify(currentDoc));
  }
  trivyScan(['repo', '--tag', latestTag.name, repoUrl, ...vexArgs, '--output', '/tmp/trivy-tag.json'], trivyEnv);

  const trivyTagOutput = JSON.parse(readFileSync('/tmp/trivy-tag.json', 'utf-8'));
  const trivyResults = parseTrivyResults(trivyTagOutput);

  console.log(`Trivy found ${trivyResults.size} unique CVEs at ${latestTag.name}`);

  // Update CSAF product
  const semver = latestTag.name.replace(/^v/, '');
  vexDoc.upsertProduct({
    name: packageName,
    productId: currentProductId,
    productName: `${packageName} ${latestTag.name}`,
    purl: buildPurl(purlType, packageName, semver)
  });

  updateVexDocWithTrivyFindings(vexDoc, trivyResults, previousStatusMap, currentProductId);

  vexDoc.incrementVersion();

  // DEBUG: write to tmp instead of committing to vex_repo
  if (process.env.DEBUG) {
    writeFileSync('/tmp/vex-output.json', JSON.stringify(vexDoc.toJson(), null, 2));
    console.log('VEX written to /tmp/vex-output.json');
    return;
  }

  const commitMsg = currentDoc
    ? `chore: update VEX for ${packageName}@${latestTag.name}`
    : `chore: create VEX for ${packageName}@${latestTag.name}`;

  await vexGhRepo.writeVexFile({
    owner: vexOwner,
    repo: vexRepo,
    path: currentVexPath,
    doc: vexDoc.toJson(),
    sha: currentSha,
    message: commitMsg
  });

  console.log(`VEX written: ${currentVexPath}`);

  // Manage issues
  if (!disableIssues) {
    await manageIssues(ghRepo, vexDoc, trivyResults, repoUrl, trivyEnv, {
      issuesOwner: repoOwner, issuesRepo: repoName, fixedInBranchLabel, currentVexPath, oldVexPath: prevVexPath, currentProductId, defaultBranch: repoData.default_branch, minSeverity
    });
  }

  console.log('Done.');
};

run();
