import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { posix } from 'node:path';
import { Octokit } from '@octokit/rest';
import { forEachSerialP } from 'omnibelt';
import { createVexDocument } from '../src/csaf.js';
import { createGithubVexRepo } from '../src/github.js';
import '../src/process-handlers.js';

const getInput = (name) => process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`]?.trim() ?? '';

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

const meetsMinSeverity = (severity, minSeverity) => {
  const sevIdx = SEVERITY_ORDER.indexOf(severity?.toUpperCase() ?? 'UNKNOWN');
  const minIdx = SEVERITY_ORDER.indexOf(minSeverity?.toUpperCase() ?? 'HIGH');
  return sevIdx !== -1 && minIdx !== -1 && sevIdx <= minIdx;
};

const parseCvssVector = (cvssObj) => {
  const v3 = cvssObj?.nvd?.V3Vector ?? cvssObj?.redhat?.V3Vector ?? null;
  const score = cvssObj?.nvd?.V3Score ?? cvssObj?.redhat?.V3Score ?? null;
  if (!v3 || score == null) { return null; }
  const parts = Object.fromEntries(v3.split('/').slice(1).map((p) => p.split(':')));
  const avMap = { N: 'NETWORK', A: 'ADJACENT', L: 'LOCAL', P: 'PHYSICAL' };
  const acMap = { L: 'LOW', H: 'HIGH' };
  const prMap = { N: 'NONE', L: 'LOW', H: 'HIGH' };
  const uiMap = { N: 'NONE', R: 'REQUIRED' };
  return {
    score,
    attackVector: avMap[parts.AV] ?? parts.AV,
    attackComplexity: acMap[parts.AC] ?? parts.AC,
    privilegesRequired: prMap[parts.PR] ?? parts.PR,
    userInteraction: uiMap[parts.UI] ?? parts.UI
  };
};

const parseTrivyResults = (trivyOutput) => {
  const cveMap = new Map();
  for (const result of trivyOutput.Results ?? []) {
    for (const vuln of result.Vulnerabilities ?? []) {
      const cveId = vuln.VulnerabilityID;
      if (!cveId?.startsWith('CVE-')) { continue; }
      const existing = cveMap.get(cveId) ?? {
        severity: vuln.Severity ?? 'UNKNOWN',
        cvss: parseCvssVector(vuln.CVSS),
        packages: [],
        referenceUrl: vuln.References?.find((r) => r.includes('nvd.nist.gov')) ?? vuln.References?.[0] ?? null
      };
      existing.packages.push({
        name: vuln.PkgName,
        affected: vuln.PkgVersion,
        fixed: vuln.FixedVersion || null,
        type: result.Type
      });
      cveMap.set(cveId, existing);
    }
  }
  return cveMap;
};

const trivyScan = (args, env) => {
  execSync(`trivy ${args} --format json --scanners vuln --no-progress --quiet`, { stdio: ['ignore', 'ignore', 'inherit'], env });
};

const run = async () => {
  const githubToken = getInput('github_token');
  const vexRepoInput = getInput('vex_repo');
  const issuesRepoInput = getInput('issues_repo') || process.env.GITHUB_REPOSITORY;
  const vexRepoDir = getInput('vex_repo_dir') || '';
  const minSeverity = getInput('min_severity') || 'HIGH';

  const [repoOwner, repoName] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
  const [vexOwner, vexRepo] = vexRepoInput.split('/');
  const [issuesOwner, issuesRepo] = issuesRepoInput.split('/');

  let packageName = getInput('package_name');
  if (!packageName) {
    const workspace = process.env.GITHUB_WORKSPACE ?? '/github/workspace';
    const pkgJson = JSON.parse(readFileSync(`${workspace}/package.json`, 'utf-8'));
    packageName = pkgJson.name;
  }

  console.log(`Package: ${packageName}, repo: ${repoOwner}/${repoName}`);

  const ghRepo = createGithubVexRepo(githubToken);
  const octokit = new Octokit({ auth: githubToken });

  // Detect latest two tags and default branch in parallel
  const [{ data: tags }, { data: repoData }] = await Promise.all([
    octokit.rest.repos.listTags({ owner: repoOwner, repo: repoName, per_page: 2 }),
    octokit.rest.repos.get({ owner: repoOwner, repo: repoName })
  ]);
  if (!tags.length) { throw new Error('No tags found in repository'); }
  const latestTag = tags[0];
  const previousTag = tags[1] ?? null;
  const fixedInBranchLabel = `fixed-in-${repoData.default_branch}`;

  console.log(`Latest tag: ${latestTag.name}${previousTag ? `, previous: ${previousTag.name}` : ''}, default branch: ${repoData.default_branch}`);
  const joinVexPath = (...parts) => posix.join(...parts).replace(/^\//, '');
  const currentVexPath = joinVexPath(vexRepoDir || '.', packageName, `${latestTag.name}.csaf.json`);
  const prevVexPath = previousTag ? joinVexPath(vexRepoDir || '.', packageName, `${previousTag.name}.csaf.json`) : null;
  const currentProductId = `${packageName}:${latestTag.name}`;
  const previousProductId = previousTag ? `${packageName}:${previousTag.name}` : null;

  // Read current tag's VEX (may exist from a prior scheduled run)
  const currentVexResult = await ghRepo.readVexFile({ owner: vexOwner, repo: vexRepo, path: currentVexPath });
  const currentDoc = currentVexResult?.doc ?? null;
  const currentSha = currentVexResult?.sha ?? null;

  const vexDoc = currentDoc
    ? createVexDocument(currentDoc)
    : createVexDocument({ title: `${packageName} ${latestTag.name} VEX`, id: `${packageName}-${latestTag.name}` });

  // Read previous tag's VEX for carry-forward
  const prevVexResult = prevVexPath ? await ghRepo.readVexFile({ owner: vexOwner, repo: vexRepo, path: prevVexPath }) : null;
  const prevDoc = prevVexResult?.doc ?? null;
  const prevVexDoc = prevDoc ? createVexDocument(prevDoc) : null;

  // Snapshot previous version's CVE statuses
  const previousStatusMap = new Map();
  if (prevVexDoc && prevDoc && previousProductId) {
    for (const vuln of prevDoc.vulnerabilities ?? []) {
      const status = prevVexDoc.getCveProductStatus(vuln.cve, previousProductId);
      if (!status) { continue; }
      const justification = prevVexDoc.getCveJustification(vuln.cve, previousProductId);
      previousStatusMap.set(vuln.cve, { status, justification });
    }
  }

  // Trivy scan the tagged version, suppressing already-assessed CVEs using the current VEX if it exists
  const trivyEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
  const repoUrl = `https://github.com/${repoOwner}/${repoName}`;
  let vexFlag = '';
  if (currentDoc) {
    writeFileSync('/tmp/current-vex.json', JSON.stringify(currentDoc));
    vexFlag = '--vex /tmp/current-vex.json';
  }
  trivyScan(`repo --tag ${latestTag.name} ${repoUrl} ${vexFlag} --output /tmp/trivy-tag.json`, trivyEnv);

  const trivyTagOutput = JSON.parse(readFileSync('/tmp/trivy-tag.json', 'utf-8'));
  const trivyResults = parseTrivyResults(trivyTagOutput);

  console.log(`Trivy found ${trivyResults.size} unique CVEs at ${latestTag.name}`);

  // Update CSAF product
  const semver = latestTag.name.replace(/^v/, '');
  vexDoc.upsertProduct({
    name: packageName,
    productId: currentProductId,
    productName: `${packageName} ${latestTag.name}`,
    purl: `pkg:npm/${packageName}@${semver}`
  });

  // Apply carry-forward and update statuses
  for (const [cveId] of trivyResults) {
    const existingStatus = vexDoc.getCveProductStatus(cveId, currentProductId);

    if (existingStatus !== null) {
      if (existingStatus === 'under_investigation') {
        // Still present, still being triaged — remove from previousStatusMap to avoid false "fixed"
        previousStatusMap.delete(cveId);
      }
      // non-null and not under_investigation = human-set status, leave it alone
      continue;
    }

    // New CVE for this product version — carry forward from previous if possible
    const prevSnapshot = previousStatusMap.get(cveId);
    let newStatus = 'under_investigation';
    let justification = null;

    if (prevSnapshot?.status === 'known_not_affected') {
      newStatus = 'known_not_affected';
      justification = prevSnapshot.justification;
    } else if (prevSnapshot?.status === 'known_affected') {
      newStatus = 'known_affected';
      justification = prevSnapshot.justification;
    }

    vexDoc.updateVulnerabilityStatus(cveId, currentProductId, newStatus, justification);
  }

  // CVEs from previous version no longer detected by Trivy → fixed in this version
  for (const [cveId, prevSnapshot] of previousStatusMap) {
    if (!['under_investigation', 'known_affected'].includes(prevSnapshot.status)) { continue; }
    if (trivyResults.has(cveId)) { continue; }

    const existingStatus = vexDoc.getCveProductStatus(cveId, currentProductId);
    if (existingStatus === null || existingStatus === 'under_investigation') {
      vexDoc.updateVulnerabilityStatus(cveId, currentProductId, 'fixed');
    }
  }

  vexDoc.incrementVersion();

  // DEBUG: write to tmp instead of committing to vex_repo
  writeFileSync('/tmp/vex-output.json', JSON.stringify(vexDoc.toJson(), null, 2));
  console.log('VEX written to /tmp/vex-output.json');

  /* const commitMsg = currentDoc
    ? `chore: update VEX for ${packageName}@${latestTag.name}`
    : `chore: create VEX for ${packageName}@${latestTag.name}`;

  await ghRepo.writeVexFile({
    owner: vexOwner,
    repo: vexRepo,
    path: currentVexPath,
    doc: vexDoc.toJson(),
    sha: currentSha,
    message: commitMsg
  });

  console.log(`VEX written: ${currentVexPath}`); */

  /* // Manage issues
  await ghRepo.ensureLabel({ owner: issuesOwner, repo: issuesRepo, name: 'vex-pending' });
  await ghRepo.ensureLabel({ owner: issuesOwner, repo: issuesRepo, name: 'vex-reflected' });
  await ghRepo.ensureLabel({ owner: issuesOwner, repo: issuesRepo, name: fixedInBranchLabel, color: 'e4e669' });

  const openIssues = await ghRepo.getOpenVexCveIssuesMap({ owner: issuesOwner, repo: issuesRepo });

  const updatedDoc = vexDoc.toJson();

  await forEachSerialP(updatedDoc.vulnerabilities, async (vuln) => {
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
          productIds: [],
          fixedProductIds: [previousProductId ?? currentProductId]
        });
      }
    }
  });

  // Check if CVEs are fixed in the default branch (HEAD)
  trivyScan(`repo ${repoUrl} --output /tmp/trivy-head.json`, trivyEnv);

  const trivyHeadOutput = JSON.parse(readFileSync('/tmp/trivy-head.json', 'utf-8'));
  const headCveIds = new Set([...parseTrivyResults(trivyHeadOutput).keys()]);

  // Re-fetch open issues since some may have been closed above
  const remainingOpenIssues = await ghRepo.getOpenVexCveIssuesMap({ owner: issuesOwner, repo: issuesRepo });

  await forEachSerialP([...remainingOpenIssues.entries()], async ([cveId, issue]) => {
    const isFixedInHead = !headCveIds.has(cveId);
    const hasLabel = issue.labels?.some((l) => l.name === fixedInBranchLabel);

    if (isFixedInHead && !hasLabel) {
      await ghRepo.addLabels({ owner: issuesOwner, repo: issuesRepo, issueNumber: issue.number, labels: [fixedInBranchLabel] });
    } else if (!isFixedInHead && hasLabel) {
      await ghRepo.removeLabel({ owner: issuesOwner, repo: issuesRepo, issueNumber: issue.number, name: fixedInBranchLabel });
    }
  }); */

  console.log('Done.');
};

run();
