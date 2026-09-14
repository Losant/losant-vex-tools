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
      original.upsertProduct({ name: 'us-docker.pkg.dev/p/l/api', productId: 'us-docker.pkg.dev/p/l/api:v1', productName: 'us-docker.pkg.dev/p/l/api:v1', purl: 'abc' });
      original.updateVulnerabilityStatus('CVE-2024-1234', 'us-docker.pkg.dev/p/l/api:v1', 'known_not_affected', { justification: 'not reachable', label: 'vulnerable_code_not_in_execute_path' });
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

    it('hydrates flags from existing document', () => {
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
          flags: [{ label: 'component_not_present', product_ids: ['prod:v1'] }]
        }]
      };
      const doc = createVexDocument(existing);
      const json = doc.toJson();
      json.vulnerabilities[0].flags[0].label.should.equal('component_not_present');
      json.vulnerabilities[0].flags[0].product_ids.should.deepEqual(['prod:v1']);
    });

    it('hydrates remediations from existing document', () => {
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
          product_status: { fixed: ['prod:v1'] },
          remediations: [{ category: 'vendor_fix', details: 'upgrade to v2', product_ids: ['prod:v1'] }]
        }]
      };
      const doc = createVexDocument(existing);
      const json = doc.toJson();
      json.vulnerabilities[0].remediations[0].category.should.equal('vendor_fix');
      json.vulnerabilities[0].remediations[0].details.should.equal('upgrade to v2');
      json.vulnerabilities[0].remediations[0].product_ids.should.deepEqual(['prod:v1']);
    });
  });

  describe('upsertProduct', () => {
    it('adds a product to the product tree', () => {
      const doc = makeDoc();
      doc.upsertProduct({ name: 'repo/api', productId: 'repo/api:v1', productName: 'repo/api:v1', purl: 'abc123' });
      const { branches } = doc.toJson().product_tree;
      branches.should.have.length(1);
      branches[0].product.product_id.should.equal('repo/api:v1');
      branches[0].product.product_identification_helper.purl.should.equal('abc123');
    });

    it('sets the branch-level name to the bare repo path', () => {
      const doc = makeDoc();
      doc.upsertProduct({ name: 'repo/api', productId: 'repo/api:v1', productName: 'repo/api:v1', purl: 'abc123' });
      doc.toJson().product_tree.branches[0].name.should.equal('repo/api');
    });

    it('overwrites an existing product with the same productId', () => {
      const doc = makeDoc();
      doc.upsertProduct({ name: 'repo/api', productId: 'repo/api:v1', productName: 'repo/api:v1', purl: 'aaa' });
      doc.upsertProduct({ name: 'repo/api', productId: 'repo/api:v1', productName: 'repo/api:v1', purl: 'bbb' });
      const { branches } = doc.toJson().product_tree;
      branches.should.have.length(1);
      branches[0].product.product_identification_helper.purl.should.equal('bbb');
    });
  });

  describe('updateVulnerabilityStatus', () => {
    it('creates a new vulnerability entry on first call', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', { justification: 'https://nvd.nist.gov/vuln/detail/CVE-2024-1111' });
      const json = doc.toJson();
      json.vulnerabilities.should.have.length(1);
      json.vulnerabilities[0].cve.should.equal('CVE-2024-1111');
      json.vulnerabilities[0].product_status.under_investigation.should.deepEqual(['prod:v1']);
    });

    it('moves productId between status buckets correctly', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', { justification: 'url' });
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', { justification: 'not reachable' });
      const vuln = doc.toJson().vulnerabilities[0];
      vuln.product_status.should.not.have.property('under_investigation');
      vuln.product_status.known_not_affected.should.deepEqual(['prod:v1']);
    });

    it('toJson() omits empty status buckets after a status move', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', { justification: 'url' });
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', { justification: 'not reachable' });
      const ps = doc.toJson().vulnerabilities[0].product_status;
      ps.should.not.have.property('under_investigation');
      ps.should.have.property('known_not_affected');
    });

    describe('notes', () => {
      it('writes a note using justification for under_investigation', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', { justification: 'see NVD' });
        const { notes } = doc.toJson().vulnerabilities[0];
        notes.should.have.length(1);
        notes[0].text.should.equal('see NVD');
        notes[0].category.should.equal('general');
      });

      it('falls back to cveId as note text when no justification', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation');
        doc.toJson().vulnerabilities[0].notes[0].text.should.equal('CVE-2024-1111');
      });

      it('does not add a second note on subsequent calls', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', { justification: 'first' });
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v2', 'known_not_affected', { justification: 'second' });
        doc.toJson().vulnerabilities[0].notes.should.have.length(1);
      });

      it('updates the note text when called again with under_investigation', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', { justification: 'initial' });
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v2', 'under_investigation', { justification: 'updated' });
        doc.toJson().vulnerabilities[0].notes[0].text.should.equal('updated');
      });
    });

    describe('threats', () => {
      it('creates a threat entry for known_not_affected with justification', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', { justification: 'not reachable' });
        const vuln = doc.toJson().vulnerabilities[0];
        vuln.threats.should.have.length(1);
        vuln.threats[0].details.should.equal('not reachable');
        vuln.threats[0].product_ids.should.deepEqual(['prod:v1']);
      });

      it('creates a threat entry for known_affected with justification', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_affected', { justification: 'exploitable via network' });
        const vuln = doc.toJson().vulnerabilities[0];
        vuln.threats.should.have.length(1);
        vuln.threats[0].details.should.equal('exploitable via network');
      });

      it('does not create a threat entry for under_investigation', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', { justification: 'url' });
        doc.toJson().vulnerabilities[0].should.not.have.property('threats');
      });

      it('does not create a threat entry for fixed', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'fixed', { justification: 'patched' });
        doc.toJson().vulnerabilities[0].should.not.have.property('threats');
      });

      it('groups multiple products under the same threat when justification matches', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', { justification: 'not reachable' });
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v2', 'known_not_affected', { justification: 'not reachable' });
        const vuln = doc.toJson().vulnerabilities[0];
        vuln.threats.should.have.length(1);
        vuln.threats[0].product_ids.should.have.length(2);
      });

      it('removes productId from old threat when status changes', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', { justification: 'reason A' });
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'fixed', { remediationCategory: 'vendor_fix', remediationDetails: 'patched in v2' });
        const vuln = doc.toJson().vulnerabilities[0];
        vuln.should.not.have.property('threats');
      });
    });

    describe('flags', () => {
      it('creates a flag entry for known_not_affected with a label', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', { justification: 'not reachable', label: 'component_not_present' });
        const vuln = doc.toJson().vulnerabilities[0];
        vuln.flags.should.have.length(1);
        vuln.flags[0].label.should.equal('component_not_present');
        vuln.flags[0].product_ids.should.deepEqual(['prod:v1']);
      });

      it('groups multiple products under the same flag when label matches', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', { justification: 'n/a', label: 'component_not_present' });
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v2', 'known_not_affected', { justification: 'n/a', label: 'component_not_present' });
        const vuln = doc.toJson().vulnerabilities[0];
        vuln.flags.should.have.length(1);
        vuln.flags[0].product_ids.should.have.length(2);
      });

      it('creates separate flag entries for different labels', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', { justification: 'n/a', label: 'component_not_present' });
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v2', 'known_not_affected', { justification: 'n/a', label: 'vulnerable_code_not_present' });
        const vuln = doc.toJson().vulnerabilities[0];
        vuln.flags.should.have.length(2);
      });

      it('omits flags when no label is provided', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', { justification: 'not reachable' });
        doc.toJson().vulnerabilities[0].should.not.have.property('flags');
      });

      it('does not create a flag entry for known_affected', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_affected', { justification: 'exploitable', label: 'component_not_present' });
        doc.toJson().vulnerabilities[0].should.not.have.property('flags');
      });

      it('does not create a flag entry for fixed', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'fixed', { remediationCategory: 'vendor_fix', remediationDetails: 'patched', label: 'component_not_present' });
        doc.toJson().vulnerabilities[0].should.not.have.property('flags');
      });

      it('removes productId from old flag when status changes', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', { justification: 'n/a', label: 'component_not_present' });
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'fixed', { remediationCategory: 'vendor_fix', remediationDetails: 'patched' });
        doc.toJson().vulnerabilities[0].should.not.have.property('flags');
      });
    });

    describe('remediations', () => {
      it('creates a remediation entry for fixed with category and details', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'fixed', { remediationCategory: 'vendor_fix', remediationDetails: 'upgrade to v2' });
        const vuln = doc.toJson().vulnerabilities[0];
        vuln.remediations.should.have.length(1);
        vuln.remediations[0].category.should.equal('vendor_fix');
        vuln.remediations[0].details.should.equal('upgrade to v2');
        vuln.remediations[0].product_ids.should.deepEqual(['prod:v1']);
      });

      it('groups multiple products under the same remediation when category and details match', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'fixed', { remediationCategory: 'vendor_fix', remediationDetails: 'upgrade to v2' });
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v2', 'fixed', { remediationCategory: 'vendor_fix', remediationDetails: 'upgrade to v2' });
        const vuln = doc.toJson().vulnerabilities[0];
        vuln.remediations.should.have.length(1);
        vuln.remediations[0].product_ids.should.have.length(2);
      });

      it('omits remediations when no category or details provided', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'fixed', { justification: 'patched' });
        doc.toJson().vulnerabilities[0].should.not.have.property('remediations');
      });

      it('does not create a remediation entry for known_not_affected', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', { justification: 'n/a', remediationCategory: 'vendor_fix', remediationDetails: 'upgrade' });
        doc.toJson().vulnerabilities[0].should.not.have.property('remediations');
      });

      it('removes productId from old remediation when status changes', () => {
        const doc = makeDoc();
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'fixed', { remediationCategory: 'no_fix_planned', remediationDetails: 'reason B' });
        doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', { justification: 'not present' });
        doc.toJson().vulnerabilities[0].should.not.have.property('remediations');
      });
    });
  });

  describe('getCveProductStatus', () => {
    it('returns null before any status is set', () => {
      const doc = makeDoc();
      (doc.getCveProductStatus('CVE-2024-1111', 'prod:v1') === null).should.be.true();
    });

    it('returns null for an unknown CVE', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', { justification: 'url' });
      (doc.getCveProductStatus('CVE-2024-9999', 'prod:v1') === null).should.be.true();
    });

    it('returns the current status string', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', { justification: 'url' });
      doc.getCveProductStatus('CVE-2024-1111', 'prod:v1').should.equal('under_investigation');
    });

    it('returns the updated status after a status move', () => {
      const doc = makeDoc();
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'under_investigation', { justification: 'url' });
      doc.updateVulnerabilityStatus('CVE-2024-1111', 'prod:v1', 'known_not_affected', { justification: 'not reachable' });
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
