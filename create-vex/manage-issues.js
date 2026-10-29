import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { forEachSerialP } from 'omnibelt';
import { parseIssueMetadata } from '../src/github.js';
import { meetsMinSeverity, parseTrivyResults } from './trivy.js';

const trivyScan = (args, env) => {
  execFileSync('trivy', [...args, '--format', 'json', '--scanners', 'vuln', '--no-progress', '--quiet'], { stdio: ['ignore', 'ignore', 'inherit'], env });
};

// Every trivy invocation goes through io.trivyScan — tests stub this one
export const io = { trivyScan };

export const manageIssues = async (ghRepo, vexDoc, trivyResults, repoUrl, trivyEnv, {
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
        const issue = await ghRepo.openVexIssue(issueArgs);
        openIssues.set(cveId, issue);
      } else {
        const updated = await ghRepo.updateVexIssue({ ...issueArgs, issue: existingIssue });
        if (!updated) {
          openIssues.delete(cveId);
          return;
        }
      }
    }

    if (fixed.includes(currentProductId)) {
      const existingIssue = openIssues.get(cveId);
      if (existingIssue) {
        const updated = await ghRepo.updateVexIssue({
          owner: issuesOwner,
          repo: issuesRepo,
          issue: existingIssue,
          cveId,
          vexPath: currentVexPath,
          oldVexPath,
          productIds: [],
          fixedProductIds: [currentProductId]
        });
        if (!updated) {
          openIssues.delete(cveId);
          return;
        }
      }
    }
  }, updatedDoc.vulnerabilities);

  // Check if CVEs are fixed in the default branch (HEAD)
  io.trivyScan(['repo', '--branch', defaultBranch, repoUrl, '--output', '/tmp/trivy-head.json'], trivyEnv);
  const trivyHeadOutput = JSON.parse(readFileSync('/tmp/trivy-head.json', 'utf-8'));
  const headCveIds = new Set([...parseTrivyResults(trivyHeadOutput).keys()]);

  await forEachSerialP(async ([cveId, issue]) => {
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
  }, [...openIssues.entries()]);
};
