const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

export const meetsMinSeverity = (severity, minSeverity) => {
  const sevIdx = SEVERITY_ORDER.indexOf(severity?.toUpperCase() ?? 'UNKNOWN');
  const minIdx = SEVERITY_ORDER.indexOf(minSeverity?.toUpperCase() ?? 'HIGH');
  return sevIdx !== -1 && minIdx !== -1 && sevIdx <= minIdx;
};

const AV_MAP = { N: 'NETWORK', A: 'ADJACENT', L: 'LOCAL', P: 'PHYSICAL' };
const AC_MAP = { L: 'LOW', H: 'HIGH' };
const PR_MAP = { N: 'NONE', L: 'LOW', H: 'HIGH' };
const UI_MAP = { N: 'NONE', R: 'REQUIRED' };
export const parseCvssVector = (cvssObj) => {
  const v3 = cvssObj?.nvd?.V3Vector ?? cvssObj?.redhat?.V3Vector ?? null;
  const score = cvssObj?.nvd?.V3Score ?? cvssObj?.redhat?.V3Score ?? null;
  if (!v3 || score === null) { return null; }
  const parts = Object.fromEntries(v3.split('/').slice(1).map((p) => p.split(':')));
  return {
    score,
    attackVector: AV_MAP[parts.AV] ?? parts.AV,
    attackComplexity: AC_MAP[parts.AC] ?? parts.AC,
    privilegesRequired: PR_MAP[parts.PR] ?? parts.PR,
    userInteraction: UI_MAP[parts.UI] ?? parts.UI
  };
};

export const parseTrivyResults = (trivyOutput) => {
  const cveMap = new Map();
  for (const result of trivyOutput.Results ?? []) {
    for (const vuln of result.Vulnerabilities ?? []) {
      const cveId = vuln.VulnerabilityID;
      if (!cveId?.startsWith('CVE-')) { continue; }
      const existing = cveMap.get(cveId) ?? {
        severity: vuln.Severity ?? 'UNKNOWN',
        cvss: parseCvssVector(vuln.CVSS),
        packages: [],
        referenceUrl: vuln.References?.find((r) => r.includes('nvd.nist.gov')) ?? vuln.References?.[0] ?? vuln.PrimaryURL ?? null
      };
      const isDuplicate = existing.packages.some(
        (p) => p.name === vuln.PkgName && p.affected === vuln.PkgVersion && p.type === result.Type
      );
      if (!isDuplicate) {
        existing.packages.push({
          name: vuln.PkgName,
          affected: vuln.PkgVersion,
          fixed: vuln.FixedVersion || null,
          type: result.Type
        });
      }
      cveMap.set(cveId, existing);
    }
  }
  return cveMap;
};

export const updateVexDocWithTrivyFindings = (vexDoc, trivyResults, previousStatusMap, currentProductId) => {
  for (const [cveId, trivyVuln] of trivyResults) {
    const existingStatus = vexDoc.getCveProductStatus(cveId, currentProductId);

    if (existingStatus !== null) {
      previousStatusMap.delete(cveId);
      continue;
    }

    const prevSnapshot = previousStatusMap.get(cveId);
    let newStatus = 'under_investigation';
    const vulnerabilityInfo = {};

    if (prevSnapshot?.status === 'known_not_affected') {
      newStatus = 'known_not_affected';
      vulnerabilityInfo.justification = prevSnapshot.justification;
      vulnerabilityInfo.label = prevSnapshot.label;
    } else if (prevSnapshot?.status === 'known_affected') {
      newStatus = 'known_affected';
      vulnerabilityInfo.justification = prevSnapshot.justification;
      vulnerabilityInfo.remediationCategory = prevSnapshot.remediationCategory;
      vulnerabilityInfo.remediationDetails = prevSnapshot.remediationDetails;
    } else if (!prevSnapshot?.status || prevSnapshot?.status === 'under_investigation') {
      vulnerabilityInfo.justification = prevSnapshot?.justification || trivyVuln.referenceUrl || `https://nvd.nist.gov/vuln/detail/${cveId}`;
    }

    vexDoc.updateVulnerabilityStatus(cveId, currentProductId, newStatus, vulnerabilityInfo);
    previousStatusMap.delete(cveId);
  }

  // CVEs from previous version no longer detected by Trivy → fixed in this version
  for (const [cveId, prevSnapshot] of previousStatusMap) {
    if (!['under_investigation', 'known_affected'].includes(prevSnapshot.status)) { continue; }

    const existingStatus = vexDoc.getCveProductStatus(cveId, currentProductId);
    if (existingStatus === null || existingStatus === 'under_investigation') {
      vexDoc.updateVulnerabilityStatus(cveId, currentProductId, 'fixed', { remediationCategory: 'vendor_fix', remediationDetails: 'no longer reporting' });
    }
  }
};
