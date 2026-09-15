import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { sleep, difference } from 'omnibelt';

export const parseIssueMetadata = (issue) => {
  const titleMatch = issue.title.match(/^\[VEX\] (CVE-[\d-]+)/);
  if (!titleMatch) { return null; }
  const metaMatch = issue.body?.match(/<!-- VEX_META\n([\s\S]+?)\r?\n-->/);
  if (!metaMatch) { return null; }
  try {
    const { paths, packages, referenceUrl, pkgFileLocation } = JSON.parse(metaMatch[1]);
    return { cveId: titleMatch[1], paths: paths ?? {}, packages: packages ?? [], referenceUrl: referenceUrl ?? null, pkgFileLocation: pkgFileLocation ?? null };
  } catch {
    return null;
  }
};

export const parseVexComment = (body) => {
  const productMatch = body?.match(/^PRODUCT:\s*(.+)$/m);
  const statusMatch = body?.match(/^VEX:\s*(NOT_AFFECTED|FIXED|AFFECTED|UNDER_INVESTIGATION)\s*[-–]\s*(.+)$/im);
  if (!productMatch || !statusMatch) { return null; }
  const statusMap = {
    NOT_AFFECTED: 'known_not_affected',
    FIXED: 'fixed',
    AFFECTED: 'known_affected',
    UNDER_INVESTIGATION: 'under_investigation'
  };
  const labelMatch = body.match(/^LABEL:\s*(.+)$/m);
  const remediationMatch = body.match(/^REMEDIATION:\s*(mitigation|no_fix_planned|none_available|vendor_fix|workaround)\s*[-–]\s*(.+)$/im);
  return {
    productIds: productMatch[1].split(',').map((s) => s.trim()).filter(Boolean),
    status: statusMap[statusMatch[1].toUpperCase()],
    justification: statusMatch[2].trim(),
    label: labelMatch?.[1].trim() ?? null,
    remediationCategory: remediationMatch?.[1].toLowerCase() ?? null,
    remediationDetails: remediationMatch?.[2].trim() ?? null
  };
};

const VALID_LABELS = new Set([
  'component_not_present',
  'vulnerable_code_not_present',
  'vulnerable_code_not_in_execute_path',
  'vulnerable_code_cannot_be_controlled_by_adversary',
  'inline_mitigations_already_exist'
]);


export const validateVexComment = (body) => {
  if (!body) { return null; }
  const looksLikeVex = (/^PRODUCT:/m).test(body) || (/^VEX:/im).test(body);
  if (!looksLikeVex) { return null; }

  const parsed = parseVexComment(body);
  if (!parsed) {
    if (!(/^PRODUCT:/m).test(body)) {
      return { error: 'Missing `PRODUCT:` line.' };
    }
    const vexLine = body.match(/^VEX:\s*(.+)$/im)?.[1];
    if (vexLine) {
      const validStatusMatch = vexLine.match(/^(NOT_AFFECTED|FIXED|AFFECTED|UNDER_INVESTIGATION)/i);
      if (validStatusMatch) {
        return { error: `Missing justification after \`VEX: ${validStatusMatch[1].toUpperCase()}\`. Use \`VEX: ${validStatusMatch[1].toUpperCase()} - <justification>\`.` };
      }
      const badStatus = vexLine.split(/[\s-–]/)[0];
      return { error: `Invalid VEX status \`${badStatus}\`. Valid assessment statuses are \`NOT_AFFECTED\`, \`FIXED\`, \`AFFECTED\`.` };
    }
    return { error: 'Could not parse VEX comment. Ensure it has a `PRODUCT:` line and a `VEX: <STATUS> - <justification>` line.' };
  }

  if (parsed.status === 'under_investigation') {
    return { error: '`UNDER_INVESTIGATION` is the initial status and cannot be set via comment. Use `NOT_AFFECTED`, `FIXED`, or `AFFECTED`.' };
  }

  if (parsed.label !== null && !VALID_LABELS.has(parsed.label)) {
    return { error: `Invalid LABEL \`${parsed.label}\`. Valid labels: ${[...VALID_LABELS].map((l) => `\`${l}\``).join(', ')}.` };
  }

  if ((/^REMEDIATION:/im).test(body) && !parsed.remediationCategory) {
    const badCategory = body.match(/^REMEDIATION:\s*(\S+)/im)?.[1];
    return { error: `Invalid REMEDIATION category \`${badCategory}\`. Valid categories: \`mitigation\`, \`no_fix_planned\`, \`none_available\`, \`vendor_fix\`, \`workaround\`.` };
  }

  return parsed;
};

/**
 * Formats a one-line CVSS summary for display in a GitHub issue body.
 * @param {{ score: number, attackVector: string, attackComplexity: string, privilegesRequired: string, userInteraction: string } | null} cvss
 */
export const formatCvssLine = (cvss) => {
  if (!cvss?.score) { return ''; }
  const pr = cvss.privilegesRequired === 'NONE' ? 'No auth' : `${cvss.privilegesRequired} auth`;
  const ui = cvss.userInteraction === 'NONE' ? 'No user interaction' : 'User interaction required';
  return `CVSS ${cvss.score} · ${cvss.attackVector} · ${cvss.attackComplexity} complexity · ${pr} · ${ui}\n\n`;
};

/**
 * Renders the full GitHub issue body for a VEX triage issue.
 * @param {{ cveId: string, paths: object, severity: string, referenceUrl: string|null, packages?: Array, cvss?: object|null, pkgFileLocation?: string|null }} opts
 */
export const buildVexIssueBody = ({
  cveId, paths, severity, referenceUrl, packages = [], cvss = null, pkgFileLocation = null
}) => {
  const url = referenceUrl ?? `https://nvd.nist.gov/vuln/detail/${cveId}`;
  const urlLabel = url.includes('nvd.nist.gov') ? 'View on NVD →' : 'View advisory →';
  const allProductIds = Object.values(paths).flat();
  const imageTable = allProductIds
    .map((id) => `| \`${id.split('/').pop().split('@')[0]}\` | \`${id}\` |`)
    .join('\n');
  const packageSection = packages.length
    ? `\n## Affected packages\n\n| Package | Type | Affected version | Fixed in |\n|---|---|---|---|\n${packages.map(({ name, affected, fixed, type }) => `| \`${name}\` | ${type ?? '—'} | \`${affected}\` | ${fixed ? `\`${fixed}\`` : 'None'} |`).join('\n')}\n`
    : '';
  const pkgFileLocationLine = pkgFileLocation ? `**Installed at:** \`${pkgFileLocation}\`\n\n` : '';
  return `## ${cveId} — ${severity}

**[${urlLabel}](${url})**

${pkgFileLocationLine}${formatCvssLine(cvss)}${packageSection}
## Affected images

| Image | Product ID |
|---|---|
${imageTable}

## How to assess

Add one or more comments with assessments, then close the issue. Each comment must have exactly one \`PRODUCT:\` and one \`VEX:\` line. The VEX document will be updated automatically.

For \`NOT_AFFECTED\` — include a machine-readable \`LABEL:\`:
\`\`\`
PRODUCT: <product ID>, <product ID>, ...
VEX: NOT_AFFECTED - <justification>
LABEL: <label>
\`\`\`

| Label | Meaning |
|---|---|
| \`component_not_present\` | The vulnerable component is not included in the product |
| \`vulnerable_code_not_present\` | The vulnerable code is absent from this build |
| \`vulnerable_code_not_in_execute_path\` | Vulnerable code exists but is never executed |
| \`vulnerable_code_cannot_be_controlled_by_adversary\` | Attacker cannot reach the vulnerable code path |
| \`inline_mitigations_already_exist\` | Built-in mitigations prevent exploitation |

For \`FIXED\` — include a \`REMEDIATION:\` line:
\`\`\`
PRODUCT: <product ID>, <product ID>, ...
VEX: FIXED - <justification>
REMEDIATION: <category> - <details>
\`\`\`

| Category | Meaning |
|---|---|
| \`vendor_fix\` | An official fix has been released |
| \`workaround\` | A workaround exists but no fix yet |
| \`mitigation\` | A mitigation reduces the risk |
| \`none_available\` | No fix or workaround is currently available |
| \`no_fix_planned\` | The vendor does not intend to fix this |

For \`AFFECTED\` — include a \`REMEDIATION:\` line with the recommended action:
\`\`\`
PRODUCT: <product ID>, <product ID>, ...
VEX: AFFECTED - <impact description>
REMEDIATION: <category> - <details>
\`\`\`

Use the same remediation categories as for \`FIXED\` above.

All images in this issue are currently \`UNDER_INVESTIGATION\`. Valid assessment statuses: \`NOT_AFFECTED\`, \`FIXED\`, \`AFFECTED\`

<!-- VEX_META
${JSON.stringify({ paths, packages, referenceUrl: url, pkgFileLocation })}
-->`;
};

export const createGithubVexRepo = (token) => {
  const octokit = token
    ? new Octokit({ auth: token })
    : new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: process.env.GH_APP_ID,
        privateKey: process.env.GH_PRIVATE_KEY,
        installationId: process.env.GH_INSTALLATION_ID
      }
    });

  const readVexFile = async ({ owner, repo, path }) => {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path });
      const doc = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
      return { doc, sha: data.sha };
    } catch (err) {
      if (err.status === 404) { return null; }
      throw err;
    }
  };

  const writeVexFile = async ({
    owner, repo, path, doc, sha, message
  }) => {
    const content = Buffer.from(JSON.stringify(doc, null, 2)).toString('base64');
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content,
      ...(sha ? { sha } : {})
    });
  };

  const getClosedVexPendingIssues = async ({ owner, repo, since }, issues = [], page = 1) => {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/issues', {
      owner, repo, state: 'closed', labels: 'vex-pending', since, per_page: 100, page
    });
    issues.push(...data);
    if (data.length < 100) { return issues; }
    await sleep(1000);
    return getClosedVexPendingIssues({ owner, repo, since }, issues, page + 1);
  };

  const getOpenVexCveIssuesMap = async ({ owner, repo }, map = new Map(), page = 1) => {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/issues', {
      owner, repo, state: 'open', labels: 'vex-pending', per_page: 100, page
    });
    for (const issue of data) {
      const match = issue.title.match(/^\[VEX\] (CVE-[\d-]+)/);
      if (match) { map.set(match[1], issue); }
    }
    if (data.length < 100) { return map; }
    await sleep(1000);
    return getOpenVexCveIssuesMap({ owner, repo }, map, page + 1);
  };

  const openVexIssue = async ({
    owner, repo, cveId, vexPath, productIds, severity, referenceUrl, packages, cvss, pkgFileLocation
  }) => {
    const { data } = await octokit.issues.create({
      owner,
      repo,
      title: packages?.length ? `[VEX] ${cveId} - ${packages[0].name}` : `[VEX] ${cveId}`,
      body: buildVexIssueBody({
        cveId, paths: { [vexPath]: productIds }, severity, referenceUrl, packages, cvss, pkgFileLocation
      }),
      labels: ['vex-pending']
    });
    return data;
  };

  const removeLabel = async ({ owner, repo, issueNumber, name }) => {
    try {
      await octokit.issues.removeLabel({ owner, repo, issue_number: issueNumber, name });
    } catch (err) {
      if (err.status !== 404) { throw err; }
    }
  };

  const markIssueAsReflected = async ({ owner, repo, issue }) => {
    await octokit.issues.addLabels({ owner, repo, issue_number: issue.number, labels: ['vex-reflected'] });
    await removeLabel({ owner, repo, issueNumber: issue.number, name: 'vex-pending' });
  };

  const ensureLabel = async ({ owner, repo, name, color = '0075ca' }) => {
    try {
      await octokit.issues.createLabel({ owner, repo, name, color });
    } catch (err) {
      if (err.status !== 422) { throw err; }
    }
  };

  const closeVexIssue = async ({ owner, repo, issue }) => {
    await ensureLabel({ owner, repo, name: 'vex-reflected' });
    await markIssueAsReflected({ owner, repo, issue });
    await octokit.issues.update({ owner, repo, issue_number: issue.number, state: 'closed' });
  };

  const updateVexIssue = async ({
    owner, repo, issue, cveId, vexPath, oldVexPath, productIds, fixedProductIds = [], severity: overrideSeverity, referenceUrl, packages = [], cvss = null, pkgFileLocation = null, force = false
  }) => {
    const meta = parseIssueMetadata(issue);
    const paths = meta?.paths ? { ...meta.paths } : {};
    const existingPackages = meta?.packages ?? [];
    const existingReferenceUrl = meta?.referenceUrl ?? null;
    const existingPkgFileLocation = meta?.pkgFileLocation ?? null;
    const resolvedReferenceUrl = referenceUrl ?? existingReferenceUrl ?? `https://nvd.nist.gov/vuln/detail/${cveId}`;
    const resolvedPkgFileLocation = pkgFileLocation ?? existingPkgFileLocation;

    // Remove the previous version's path entry when rolling over to a new version.
    let removedOldPath = false;
    if (oldVexPath && oldVexPath !== vexPath && paths[oldVexPath] !== undefined) {
      delete paths[oldVexPath];
      removedOldPath = true;
    }
    let productsChanged = false;
    if (!paths[vexPath] || fixedProductIds.length > 0 || difference(productIds, paths[vexPath]).length > 0 || difference(paths[vexPath], productIds).length > 0) {
      productsChanged = true;
      if (productIds.length > 0) {
        paths[vexPath] = productIds;
      } else {
        delete paths[vexPath];
      }
    }

    const severityMatch = issue.body?.match(/^## CVE-[\d-]+ — (.+)$/m);
    const currentSeverity = severityMatch?.[1] ?? 'UNKNOWN';
    const severity = overrideSeverity ?? currentSeverity;

    const pkgKey = (p) => `${p.name}@${p.affected}@${p.fixed ?? ''}`;
    const sortPkgs = (pkgs) => [...pkgs].sort((a, b) => pkgKey(a).localeCompare(pkgKey(b)));
    const packagesChanged = JSON.stringify(sortPkgs(packages)) !== JSON.stringify(sortPkgs(existingPackages));
    const referenceUrlChanged = resolvedReferenceUrl !== existingReferenceUrl;
    const pkgFileLocationChanged = resolvedPkgFileLocation !== existingPkgFileLocation;

    const hasChanges = removedOldPath || productsChanged || packagesChanged || referenceUrlChanged || pkgFileLocationChanged || severity !== currentSeverity;
    if (!hasChanges && !force) { return; }

    if (fixedProductIds.length) {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: `The following products have been marked as **fixed**:\n${fixedProductIds.map((id) => `- \`${id}\``).join('\n')}`
      });
    }

    if (Object.keys(paths).length === 0) {
      await closeVexIssue({ owner, repo, issue });
      return;
    }

    await octokit.issues.update({
      owner,
      repo,
      issue_number: issue.number,
      body: buildVexIssueBody({
        cveId, paths, severity, referenceUrl: resolvedReferenceUrl, packages, cvss, pkgFileLocation: resolvedPkgFileLocation
      })
    });
  };

  const getAssessmentComments = async ({ owner, repo, issueNumber }, state = { assessments: new Map(), errors: [] }, page = 1) => {
    const { data: comments } = await octokit.issues.listComments({
      owner, repo, issue_number: issueNumber, per_page: 100, page
    });
    for (const comment of comments) {
      const result = validateVexComment(comment.body);
      if (!result) { continue; }
      if (result.error) {
        state.errors.push({ error: result.error, body: comment.body, url: comment.html_url });
        continue;
      }
      for (const productId of result.productIds) {
        state.assessments.set(productId, {
          productId,
          status: result.status,
          justification: result.justification,
          label: result.label,
          remediationCategory: result.remediationCategory,
          remediationDetails: result.remediationDetails
        });
      }
    }
    if (comments.length < 100) { return { assessments: [...state.assessments.values()], errors: state.errors }; }
    await sleep(1000);
    // lord help us if we have more than 100 comments on a single issue, but let's handle it anyway.
    return getAssessmentComments({ owner, repo, issueNumber }, state, page + 1);
  };

  const addLabels = async ({ owner, repo, issueNumber, labels }) => {
    await octokit.issues.addLabels({ owner, repo, issue_number: issueNumber, labels });
  };

  const reopenWithComment = async ({ owner, repo, issueNumber, body }) => {
    await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    await octokit.issues.update({ owner, repo, issue_number: issueNumber, state: 'open' });
  };

  return {
    readVexFile,
    writeVexFile,
    getClosedVexPendingIssues,
    getOpenVexCveIssuesMap,
    openVexIssue,
    updateVexIssue,
    closeVexIssue,
    getAssessmentComments,
    ensureLabel,
    addLabels,
    removeLabel,
    reopenWithComment,
    markIssueAsReflected
  };
};
