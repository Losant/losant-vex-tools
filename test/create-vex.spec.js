import 'should';
import { createVexDocument } from '../src/csaf.js';
import { meetsMinSeverity, parseCvssVector, parseTrivyResults, updateVexDocWithTrivyFindings } from '../create-vex/trivy.js';

const PRODUCT_ID = 'my-pkg:v1.1.0';

const makeDoc = (existing = null) => createVexDocument(existing ?? { title: 'Test VEX', id: 'test-vex' });

const makeVuln = (overrides = {}) => ({
  VulnerabilityID: 'CVE-2021-1234',
  Severity: 'HIGH',
  PkgName: 'lodash',
  PkgVersion: '4.17.20',
  FixedVersion: '4.17.21',
  PrimaryURL: 'https://nvd.nist.gov/vuln/detail/CVE-2021-1234',
  References: ['https://nvd.nist.gov/vuln/detail/CVE-2021-1234'],
  CVSS: {
    nvd: {
      V3Vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      V3Score: 9.8
    }
  },
  ...overrides
});

const trivyOutput = (vulns = [makeVuln()], type = 'npm') => ({
  Results: [{ Type: type, Vulnerabilities: vulns }]
});

describe('meetsMinSeverity', () => {
  it('returns true when severity equals minSeverity', () => {
    meetsMinSeverity('HIGH', 'HIGH').should.be.true();
  });

  it('returns true when severity is above minSeverity', () => {
    meetsMinSeverity('CRITICAL', 'HIGH').should.be.true();
  });

  it('returns false when severity is below minSeverity', () => {
    meetsMinSeverity('LOW', 'HIGH').should.be.false();
  });

  it('returns false for UNKNOWN severity', () => {
    meetsMinSeverity('UNKNOWN', 'HIGH').should.be.false();
  });

  it('handles case-insensitive inputs', () => {
    meetsMinSeverity('critical', 'high').should.be.true();
  });
});

describe('parseCvssVector', () => {
  it('parses NVD V3 vector correctly', () => {
    const result = parseCvssVector({
      nvd: { V3Vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', V3Score: 9.8 }
    });
    result.should.deepEqual({
      score: 9.8,
      attackVector: 'NETWORK',
      attackComplexity: 'LOW',
      privilegesRequired: 'NONE',
      userInteraction: 'NONE'
    });
  });

  it('falls back to redhat vector when nvd is absent', () => {
    const result = parseCvssVector({
      redhat: { V3Vector: 'CVSS:3.1/AV:L/AC:H/PR:L/UI:R/S:U/C:H/I:H/A:H', V3Score: 6.3 }
    });
    result.score.should.equal(6.3);
    result.attackVector.should.equal('LOCAL');
    result.privilegesRequired.should.equal('LOW');
    result.userInteraction.should.equal('REQUIRED');
  });

  it('returns null when no CVSS data is present', () => {
    (parseCvssVector(null) === null).should.be.true();
    (parseCvssVector({}) === null).should.be.true();
  });

  it('returns null when score is missing', () => {
    (parseCvssVector({ nvd: { V3Vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' } }) === null).should.be.true();
  });
});

describe('parseTrivyResults', () => {
  it('parses a single vulnerability', () => {
    const result = parseTrivyResults(trivyOutput());
    result.size.should.equal(1);
    const cve = result.get('CVE-2021-1234');
    cve.severity.should.equal('HIGH');
    cve.packages.should.have.length(1);
    cve.packages[0].should.deepEqual({ name: 'lodash', affected: '4.17.20', fixed: '4.17.21', type: 'npm' });
    cve.referenceUrl.should.equal('https://nvd.nist.gov/vuln/detail/CVE-2021-1234');
  });

  it('prefers NVD reference URL over others', () => {
    const vuln = makeVuln({ References: ['https://example.com/advisory', 'https://nvd.nist.gov/vuln/detail/CVE-2021-1234'] });
    const result = parseTrivyResults(trivyOutput([vuln]));
    result.get('CVE-2021-1234').referenceUrl.should.equal('https://nvd.nist.gov/vuln/detail/CVE-2021-1234');
  });

  it('falls back to PrimaryURL when no references', () => {
    const vuln = makeVuln({ References: [], PrimaryURL: 'https://example.com/primary' });
    const result = parseTrivyResults(trivyOutput([vuln]));
    result.get('CVE-2021-1234').referenceUrl.should.equal('https://example.com/primary');
  });

  it('deduplicates the same CVE across multiple packages', () => {
    const vulns = [
      makeVuln({ PkgName: 'lodash', PkgVersion: '4.17.20' }),
      makeVuln({ PkgName: 'lodash-es', PkgVersion: '4.17.20' })
    ];
    const result = parseTrivyResults(trivyOutput(vulns));
    result.size.should.equal(1);
    result.get('CVE-2021-1234').packages.should.have.length(2);
  });

  it('skips non-CVE vulnerability IDs', () => {
    const vuln = makeVuln({ VulnerabilityID: 'GHSA-1234-5678-abcd' });
    const result = parseTrivyResults(trivyOutput([vuln]));
    result.size.should.equal(0);
  });

  it('returns empty map for empty output', () => {
    parseTrivyResults({}).size.should.equal(0);
    parseTrivyResults({ Results: [] }).size.should.equal(0);
  });

  it('handles result with no vulnerabilities array', () => {
    const result = parseTrivyResults({ Results: [{ Type: 'npm' }] });
    result.size.should.equal(0);
  });
});

describe('updateVexDocWithTrivyFindings', () => {
  const setup = () => {
    const doc = makeDoc();
    doc.upsertProduct({ name: 'my-pkg', productId: PRODUCT_ID, productName: 'my-pkg v1.1.0', purl: 'pkg:npm/my-pkg@1.1.0' });
    return doc;
  };

  it('sets under_investigation for a new CVE with no previous status', () => {
    const doc = setup();
    const trivyResults = parseTrivyResults(trivyOutput());
    updateVexDocWithTrivyFindings(doc, trivyResults, new Map(), PRODUCT_ID);
    doc.getCveProductStatus('CVE-2021-1234', PRODUCT_ID).should.equal('under_investigation');
  });

  it('carries forward known_not_affected from previous version', () => {
    const doc = setup();
    const trivyResults = parseTrivyResults(trivyOutput());
    const prevMap = new Map([['CVE-2021-1234', { status: 'known_not_affected', justification: 'code_not_reachable', label: 'test label' }]]);
    updateVexDocWithTrivyFindings(doc, trivyResults, prevMap, PRODUCT_ID);
    doc.getCveProductStatus('CVE-2021-1234', PRODUCT_ID).should.equal('known_not_affected');
  });

  it('carries forward known_affected from previous version', () => {
    const doc = setup();
    const trivyResults = parseTrivyResults(trivyOutput());
    const prevMap = new Map([['CVE-2021-1234', { status: 'known_affected', justification: 'https://example.com', remediationCategory: 'workaround', remediationDetails: 'disable X' }]]);
    updateVexDocWithTrivyFindings(doc, trivyResults, prevMap, PRODUCT_ID);
    doc.getCveProductStatus('CVE-2021-1234', PRODUCT_ID).should.equal('known_affected');
  });

  it('does not overwrite an existing status already in the vex doc', () => {
    const doc = setup();
    doc.updateVulnerabilityStatus('CVE-2021-1234', PRODUCT_ID, 'known_not_affected', { justification: 'code_not_reachable' });
    const trivyResults = parseTrivyResults(trivyOutput());
    updateVexDocWithTrivyFindings(doc, trivyResults, new Map(), PRODUCT_ID);
    doc.getCveProductStatus('CVE-2021-1234', PRODUCT_ID).should.equal('known_not_affected');
  });

  it('marks CVEs from previous version not in trivy results as fixed', () => {
    const doc = setup();
    const trivyResults = new Map();
    const prevMap = new Map([['CVE-2021-9999', { status: 'under_investigation' }]]);
    updateVexDocWithTrivyFindings(doc, trivyResults, prevMap, PRODUCT_ID);
    doc.getCveProductStatus('CVE-2021-9999', PRODUCT_ID).should.equal('fixed');
  });

  it('does not mark known_not_affected previous CVEs as fixed when absent from trivy', () => {
    const doc = setup();
    const trivyResults = new Map();
    const prevMap = new Map([['CVE-2021-9999', { status: 'known_not_affected' }]]);
    updateVexDocWithTrivyFindings(doc, trivyResults, prevMap, PRODUCT_ID);
    (doc.getCveProductStatus('CVE-2021-9999', PRODUCT_ID) === null).should.be.true();
  });
});
