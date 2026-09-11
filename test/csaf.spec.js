import 'should';
import { createVexDocument } from '../src/csaf.js';

const BASE_OPTIONS = { title: 'Test VEX', id: 'test-vex-1.0.0' };

const makeDoc = (options = BASE_OPTIONS) => createVexDocument(options);

describe('createVexDocument', () => {
  describe('new document', () => {
    it('toJson() produces valid CSAF structure', () => {
      const doc = makeDoc();
      const json = doc.toJson();
      json.should.have.property('document');
      json.document.category.should.equal('csaf_vex');
      json.document.csaf_version.should.equal('2.0');
      json.document.title.should.equal('Test VEX');
      json.document.tracking.id.should.equal('test-vex-1.0.0');
      json.document.tracking.version.should.equal('1');
      json.product_tree.branches.should.be.an.Array().and.have.length(0);
      json.vulnerabilities.should.be.an.Array().and.have.length(0);
    });

    it('sets initial_release_date and current_release_date', () => {
      const before = new Date().toISOString();
      const doc = makeDoc();
      const { tracking } = doc.toJson().document;
      tracking.initial_release_date.should.be.aboveOrEqual(before);
      tracking.current_release_date.should.equal(tracking.initial_release_date);
    });
  });

  describe('hydrating an existing document', () => {
    it('round-trips product_tree and vulnerabilities', () => {
      const original = makeDoc();
      original.upsertProduct({ name: 'us-docker.pkg.dev/p/l/api', productId: 'us-docker.pkg.dev/p/l/api:v1', productName: 'us-docker.pkg.dev/p/l/api:v1', shaRef: 'abc' });
      original.updateVulnerabilityStatus('CVE-2024-1234', 'us-docker.pkg.dev/p/l/api:v1', 'known_not_affected', 'not reachable');
      original.incrementVersion();

      const json = original.toJson();
      const rehydrated = createVexDocument(json);
      rehydrated.toJson().should.deepEqual(json);
    });

    it('preserves notes from existing document', () => {
      const existing = {
        document: {
          category: 'csaf_vex',
          csaf_version: '2.0',
          distribution: { tlp: { label: 'WHITE' } },
          publisher: {},
          title: 'T',
          tracking: {
            id: 'x', status: 'final', version: '2', initial_release_date: '2024-01-01T00:00:00.000Z', current_release_date: '2024-01-02T00:00:00.000Z', revision_history: []
          }
        },
        product_tree: { branches: [] },
        vulnerabilities: [{ cve: 'CVE-2024-9999', product_status: { known_not_affected: ['prod:v1'] }, notes: [{ category: 'general', title: 'CVE-2024-9999', text: 'carried forward' }] }]
      };
      const doc = createVexDocument(existing);
      const json = doc.toJson();
      json.vulnerabilities[0].notes[0].text.should.equal('carried forward');
    });

    it('hydrates threats from existing document', () => {
      const existing = {
        document: {
          category: 'csaf_vex',
          csaf_version: '2.0',
          distribution: { tlp: { label: 'WHITE' } },
          publisher: {},
          title: 'T',
          tracking: {
            id: 'x', status: 'final', version: '1', initial_release_date: '2024-01-01T00:00:00.000Z', current_release_date: '2024-01-01T00:00:00.000Z', revision_history: []
          }
        },
        product_tree: { branches: [] },
        vulnerabilities: [{
          cve: 'CVE-2024-5678',
          product_status: { known_not_affected: ['prod:v1'] },
          threats: [{ category: 'impact', details: 'not reachable', product_ids: ['prod:v1'] }]
        }]
      };
      const doc = createVexDocument(existing);
      const json = doc.toJson();
      json.vulnerabilities[0].threats[0].details.should.equal('not reachable');
      json.vulnerabilities[0].threats[0].product_ids.should.deepEqual(['prod:v1']);
    });
  });

  describe('upsertProduct', () => {
    it('adds a product to the product tree', () => {
      const doc = makeDoc();
      doc.upsertProduct({ name: 'repo/api', productId: 'repo/api:v1', productName: 'repo/api:v1', shaRef: 'abc123' });
      const { branches } = doc.toJson().product_tree;
      branches.should.have.length(1);
      branches[0].product.product_id.should.equal('repo/api:v1');
      branches[0].product.product_identification_helper.hashes[0].file_hashes[0].value.should.equal('abc123');
    });

    it('sets the branch-level name to the bare repo path', () => {
      const doc = makeDoc();
      doc.upsertProduct({ name: 'repo/api', productId: 'repo/api:v1', productName: 'repo/api:v1', shaRef: 'abc123' });
      doc.toJson().product_tree.branches[0].name.should.equal('repo/api');
    });

    it('overwrites an existing product with the same productId', () => {
      const doc = makeDoc();
      doc.upsertProduct({ name: 'repo/api', productId: 'repo/api:v1', productName: 'repo/api:v1', shaRef: 'aaa' });
      doc.upsertProduct({ name: 'repo/api', productId: 'repo/api:v1', productName: 'repo/api:v1', shaRef: 'bbb' });
      const { branches } = doc.toJson().product_tree;
      branches.should.have.length(1);
      branches[0].product.product_identification_helper.hashes[0].file_hashes[0].value.should.equal('bbb');
    });
  });

  describe('updateVulnerabilityStatus', () => {
    it('creates a new vulnerability entry on first call', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', 'https://nvd.nist.gov/vuln/detail/CVE-2024-1111');
      const json = doc.toJson();
      json.vulnerabilities.should.have.length(1);
      json.vulnerabilities[0].cve.should.equal('CVE-2024-1111');
      json.vulnerabilities[0].product_status.under_investigation.should.deepEqual(['prod:v1']);
    });

    it('writes a single note on first creation using the justification', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', 'see NVD');
      const { notes } = doc.toJson().vulnerabilities[0];
      notes.should.have.length(1);
      notes[0].text.should.equal('see NVD');
      notes[0].category.should.equal('general');
    });

    it('falls back to cveId as note text when no justification', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', undefined);
      doc.toJson().vulnerabilities[0].notes[0].text.should.equal('CVE-2024-1111');
    });

    it('does not add a second note on subsequent calls', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', 'first');
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v2', 'known_not_affected', 'second');
      doc.toJson().vulnerabilities[0].notes.should.have.length(1);
    });

    it('moves productId between status buckets correctly', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', 'url');
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', 'not reachable');
      const vuln = doc.toJson().vulnerabilities[0];
      vuln.product_status.should.not.have.property('under_investigation');
      vuln.product_status.known_not_affected.should.deepEqual(['prod:v1']);
    });

    it('creates a threat entry for definitive statuses with justification', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', 'not reachable');
      const vuln = doc.toJson().vulnerabilities[0];
      vuln.threats.should.have.length(1);
      vuln.threats[0].details.should.equal('not reachable');
      vuln.threats[0].product_ids.should.deepEqual(['prod:v1']);
    });

    it('does not create a threat entry for under_investigation', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', 'url');
      const vuln = doc.toJson().vulnerabilities[0];
      vuln.should.not.have.property('threats');
    });

    it('groups multiple products under the same threat when justification matches', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', 'not reachable');
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v2', 'known_not_affected', 'not reachable');
      const vuln = doc.toJson().vulnerabilities[0];
      vuln.threats.should.have.length(1);
      vuln.threats[0].product_ids.should.have.length(2);
    });

    it('removes productId from old threat when status changes', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', 'reason A');
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'fixed', 'reason B');
      const vuln = doc.toJson().vulnerabilities[0];
      vuln.threats.should.have.length(1);
      vuln.threats[0].details.should.equal('reason B');
    });

    it('toJson() omits empty status buckets after a status move', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', 'url');
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', 'not reachable');
      const ps = doc.toJson().vulnerabilities[0].product_status;
      ps.should.not.have.property('under_investigation');
      ps.should.have.property('known_not_affected');
    });
  });

  describe('getCveProductStatus', () => {
    it('returns null before any status is set', () => {
      const doc = makeDoc();
      (doc.getCveProductStatus('CVE-2024-1111', 'prod:v1') === null).should.be.true();
    });

    it('returns null for an unknown CVE', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', 'url');
      (doc.getCveProductStatus('CVE-2024-9999', 'prod:v1') === null).should.be.true();
    });

    it('returns the current status string', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', 'url');
      doc.getCveProductStatus('CVE-2024-1111', 'prod:v1').should.equal('under_investigation');
    });

    it('returns the updated status after a status move', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', 'url');
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', 'not reachable');
      doc.getCveProductStatus('CVE-2024-1111', 'prod:v1').should.equal('known_not_affected');
    });
  });

  describe('incrementVersion', () => {
    it('increments the document version number', () => {
      const doc = makeDoc();
      doc.incrementVersion();
      doc.toJson().document.tracking.version.should.equal('2');
      doc.incrementVersion();
      doc.toJson().document.tracking.version.should.equal('3');
    });

    it('appends a revision history entry', () => {
      const doc = makeDoc();
      doc.incrementVersion();
      const { revision_history } = doc.toJson().document.tracking;
      revision_history.should.have.length(2);
      revision_history[1].number.should.equal('2');
    });

    it('updates current_release_date without changing initial_release_date', () => {
      const doc = makeDoc();
      const { initial_release_date } = doc.toJson().document.tracking;
      doc.incrementVersion();
      const updated = doc.toJson().document.tracking;
      updated.initial_release_date.should.equal(initial_release_date);
      updated.current_release_date.should.be.aboveOrEqual(initial_release_date);
    });
  });
});
