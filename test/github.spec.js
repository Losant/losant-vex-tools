import 'should';
import { parseVexComment, parseIssueMetadata, formatCvssLine, buildVexIssueBody } from '../src/github.js';

describe('parseVexComment', () => {
  it('parses a valid single-product comment', () => {
    const body = 'PRODUCT: us-docker.pkg.dev/p/l/api:v1\nVEX: NOT_AFFECTED - not reachable';
    const result = parseVexComment(body);
    result.productIds.should.deepEqual(['us-docker.pkg.dev/p/l/api:v1']);
    result.status.should.equal('known_not_affected');
    result.justification.should.equal('not reachable');
  });

  it('parses multiple product IDs separated by commas', () => {
    const body = 'PRODUCT: prod:v1, prod:v2, prod:v3\nVEX: FIXED - patched';
    const result = parseVexComment(body);
    result.productIds.should.deepEqual(['prod:v1', 'prod:v2', 'prod:v3']);
  });

  it('trims whitespace from product IDs', () => {
    const body = 'PRODUCT:  prod:v1 ,  prod:v2 \nVEX: FIXED - patched';
    parseVexComment(body).productIds.should.deepEqual(['prod:v1', 'prod:v2']);
  });

  it('is case-insensitive for the VEX status', () => {
    const body = 'PRODUCT: prod:v1\nVEX: not_affected - reason';
    parseVexComment(body).status.should.equal('known_not_affected');
  });

  it('accepts an em-dash separator between status and justification', () => {
    const body = 'PRODUCT: prod:v1\nVEX: NOT_AFFECTED – not reachable';
    const result = parseVexComment(body);
    result.status.should.equal('known_not_affected');
    result.justification.should.equal('not reachable');
  });

  it('maps all valid statuses correctly', () => {
    const cases = [
      ['NOT_AFFECTED', 'known_not_affected'],
      ['FIXED', 'fixed'],
      ['AFFECTED', 'known_affected'],
      ['UNDER_INVESTIGATION', 'under_investigation']
    ];
    for (const [input, expected] of cases) {
      const body = `PRODUCT: prod:v1\nVEX: ${input} - reason`;
      parseVexComment(body).status.should.equal(expected);
    }
  });

  it('returns null when PRODUCT line is missing', () => {
    const body = 'VEX: NOT_AFFECTED - reason';
    (parseVexComment(body) === null).should.be.true();
  });

  it('captures the full justification when it contains a hyphen', () => {
    const body = 'PRODUCT: prod:v1\nVEX: NOT_AFFECTED - not reachable - in this config';
    parseVexComment(body).justification.should.equal('not reachable - in this config');
  });

  it('returns null when VEX line is missing', () => {
    const body = 'PRODUCT: prod:v1';
    (parseVexComment(body) === null).should.be.true();
  });

  it('returns null for an unrecognised status', () => {
    const body = 'PRODUCT: prod:v1\nVEX: UNKNOWN - reason';
    (parseVexComment(body) === null).should.be.true();
  });

  it('returns null for a null or undefined body', () => {
    (parseVexComment(null) === null).should.be.true();
    (parseVexComment(undefined) === null).should.be.true();
  });

  it('works when PRODUCT and VEX lines appear mid-comment', () => {
    const body = 'Some context here.\n\nPRODUCT: prod:v1\nVEX: FIXED - patched\n\nExtra notes.';
    const result = parseVexComment(body);
    result.productIds.should.deepEqual(['prod:v1']);
    result.status.should.equal('fixed');
  });

  it('filters out empty strings from trailing commas', () => {
    const body = 'PRODUCT: prod:v1,\nVEX: FIXED - patched';
    parseVexComment(body).productIds.should.deepEqual(['prod:v1']);
  });
});

describe('parseIssueMetadata', () => {
  const makeIssue = (title, body) => ({ title, body });

  const makeBody = (paths) => `Some description.

<!-- VEX_META
${JSON.stringify({ paths })}
-->`;

  it('parses a single-path VEX issue', () => {
    const paths = {
      'platform/v1.0.0.csaf.json': [
        'us-docker.pkg.dev/p/l/api:v1',
        'us-docker.pkg.dev/p/l/worker:v1'
      ]
    };
    const result = parseIssueMetadata(makeIssue('[VEX] CVE-2024-1234', makeBody(paths)));
    result.cveId.should.equal('CVE-2024-1234');
    result.paths.should.deepEqual(paths);
  });

  it('parses a title that includes the affected package name', () => {
    const paths = { 'platform/v1.0.0.csaf.json': ['us-docker.pkg.dev/p/l/api:v1'] };
    const result = parseIssueMetadata(makeIssue('[VEX] CVE-2024-1234 - libssl3', makeBody(paths)));
    result.cveId.should.equal('CVE-2024-1234');
    result.paths.should.deepEqual(paths);
  });

  it('parses a multi-path VEX issue (platform + edge)', () => {
    const paths = {
      'platform/v1.37.0.csaf.json': ['us-docker.pkg.dev/p/l/api:v1.37.0'],
      'gateway-edge-agent/2.4.1-alpine.csaf.json': ['us-docker.pkg.dev/p/l/losant-edge:2.4.1-alpine']
    };
    const result = parseIssueMetadata(makeIssue('[VEX] CVE-2024-5678 - musl', makeBody(paths)));
    result.cveId.should.equal('CVE-2024-5678');
    result.paths.should.deepEqual(paths);
  });

  it('returns null for a non-VEX title', () => {
    (parseIssueMetadata(makeIssue('Regular issue', makeBody({}))) === null).should.be.true();
  });

  it('returns null when VEX_META block is missing', () => {
    (parseIssueMetadata(makeIssue('[VEX] CVE-2024-1234', 'No meta block here.')) === null).should.be.true();
  });

  it('returns null for a null body', () => {
    (parseIssueMetadata(makeIssue('[VEX] CVE-2024-1234', null)) === null).should.be.true();
  });

  it('returns null when VEX_META contains invalid JSON', () => {
    const body = '<!-- VEX_META\nnot json\n-->';
    (parseIssueMetadata(makeIssue('[VEX] CVE-2024-1234', body)) === null).should.be.true();
  });

  it('returns an empty paths object when paths is omitted from the JSON', () => {
    const body = '<!-- VEX_META\n{}\n-->';
    const result = parseIssueMetadata(makeIssue('[VEX] CVE-2024-5678', body));
    result.paths.should.deepEqual({});
  });

  it('extracts cveId from various CVE formats', () => {
    const body = makeBody({ 'p/v1.csaf.json': ['x:v1'] });
    parseIssueMetadata(makeIssue('[VEX] CVE-2024-12345', body)).cveId.should.equal('CVE-2024-12345');
  });
});

describe('formatCvssLine', () => {
  const fullCvss = { score: 7.5, attackVector: 'NETWORK', attackComplexity: 'LOW', privilegesRequired: 'NONE', userInteraction: 'NONE' };

  it('returns empty string when cvss is null', () => {
    formatCvssLine(null).should.equal('');
  });

  it('returns empty string when score is absent', () => {
    formatCvssLine({ attackVector: 'NETWORK' }).should.equal('');
  });

  it('includes the score and attack vector', () => {
    const line = formatCvssLine(fullCvss);
    line.should.containEql('CVSS 7.5');
    line.should.containEql('NETWORK');
    line.should.containEql('LOW complexity');
  });

  it('renders NONE privilegesRequired as "No auth"', () => {
    formatCvssLine(fullCvss).should.containEql('No auth');
  });

  it('renders non-NONE privilegesRequired with the value', () => {
    formatCvssLine({ ...fullCvss, privilegesRequired: 'LOW' }).should.containEql('LOW auth');
  });

  it('renders NONE userInteraction as "No user interaction"', () => {
    formatCvssLine(fullCvss).should.containEql('No user interaction');
  });

  it('renders non-NONE userInteraction as "User interaction required"', () => {
    formatCvssLine({ ...fullCvss, userInteraction: 'REQUIRED' }).should.containEql('User interaction required');
  });

  it('ends with two newlines so the next section is separated by a blank line', () => {
    formatCvssLine(fullCvss).should.endWith('\n\n');
  });
});

describe('buildVexIssueBody', () => {
  const paths = { 'platform/v1.0.0.csaf.json': ['us-docker.pkg.dev/p/l/api:v1.0.0'] };
  const cvss = { score: 7.5, attackVector: 'NETWORK', attackComplexity: 'LOW', privilegesRequired: 'NONE', userInteraction: 'NONE' };

  it('renders the CVE heading with severity using an em-dash', () => {
    const body = buildVexIssueBody({ cveId: 'CVE-2024-1234', paths, severity: 'HIGH', referenceUrl: null });
    body.should.containEql('## CVE-2024-1234 — HIGH');
  });

  it('defaults referenceUrl to NVD when null', () => {
    const body = buildVexIssueBody({ cveId: 'CVE-2024-1234', paths, severity: 'HIGH', referenceUrl: null });
    body.should.containEql('nvd.nist.gov/vuln/detail/CVE-2024-1234');
    body.should.containEql('View on NVD');
  });

  it('uses "View advisory" label for non-NVD URLs', () => {
    const body = buildVexIssueBody({ cveId: 'CVE-2024-1234', paths, severity: 'HIGH', referenceUrl: 'https://github.com/advisories/GHSA-xxxx' });
    body.should.containEql('View advisory');
  });

  it('renders CVSS summary line when cvss is provided', () => {
    const body = buildVexIssueBody({ cveId: 'CVE-2024-1234', paths, severity: 'HIGH', referenceUrl: null, cvss });
    body.should.containEql('CVSS 7.5');
    body.should.containEql('NETWORK');
    body.should.containEql('No auth');
  });

  it('omits CVSS line when cvss is null', () => {
    const body = buildVexIssueBody({ cveId: 'CVE-2024-1234', paths, severity: 'HIGH', referenceUrl: null, cvss: null });
    body.should.not.containEql('CVSS');
  });

  it('renders the packages table with Type column when packages are provided', () => {
    const packages = [{ name: 'js-yaml', affected: '3.15.1', fixed: '3.15.2', type: 'NPM' }];
    const body = buildVexIssueBody({ cveId: 'CVE-2024-1234', paths, severity: 'HIGH', referenceUrl: null, packages });
    body.should.containEql('## Affected packages');
    body.should.containEql('| Package | Type | Affected version | Fixed in |');
    body.should.containEql('| `js-yaml` | NPM | `3.15.1` | `3.15.2` |');
  });

  it('renders — for a package with null type', () => {
    const packages = [{ name: 'openssl', affected: '3.0.0', fixed: null, type: null }];
    const body = buildVexIssueBody({ cveId: 'CVE-2024-1234', paths, severity: 'HIGH', referenceUrl: null, packages });
    body.should.containEql('| — |');
  });

  it('renders None in the Fixed column for unfixed packages', () => {
    const packages = [{ name: 'openssl', affected: '3.0.0', fixed: null, type: 'OS' }];
    const body = buildVexIssueBody({ cveId: 'CVE-2024-1234', paths, severity: 'HIGH', referenceUrl: null, packages });
    body.should.containEql('| None |');
  });

  it('omits the packages section when packages is empty', () => {
    const body = buildVexIssueBody({ cveId: 'CVE-2024-1234', paths, severity: 'HIGH', referenceUrl: null, packages: [] });
    body.should.not.containEql('## Affected packages');
  });

  it('renders product IDs in the affected images table', () => {
    const body = buildVexIssueBody({ cveId: 'CVE-2024-1234', paths, severity: 'HIGH', referenceUrl: null });
    body.should.containEql('us-docker.pkg.dev/p/l/api:v1.0.0');
  });

  it('embeds VEX_META with paths, packages, and referenceUrl', () => {
    const url = 'https://nvd.nist.gov/vuln/detail/CVE-2024-1234';
    const body = buildVexIssueBody({ cveId: 'CVE-2024-1234', paths, severity: 'HIGH', referenceUrl: url });
    const metaMatch = body.match(/<!-- VEX_META\n([\s\S]+?)\n-->/);
    metaMatch.should.not.be.null();
    const meta = JSON.parse(metaMatch[1]);
    meta.paths.should.deepEqual(paths);
    meta.referenceUrl.should.equal(url);
  });

  it('embeds packages including type in VEX_META', () => {
    const packages = [{ name: 'js-yaml', affected: '3.15.1', fixed: '3.15.2', type: 'NPM' }];
    const body = buildVexIssueBody({ cveId: 'CVE-2024-1234', paths, severity: 'HIGH', referenceUrl: null, packages });
    const metaMatch = body.match(/<!-- VEX_META\n([\s\S]+?)\n-->/);
    const meta = JSON.parse(metaMatch[1]);
    meta.packages[0].type.should.equal('NPM');
  });
});
