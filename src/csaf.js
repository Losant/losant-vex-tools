import { clone } from 'omnibelt';

const DEFAULT_PUBLISHER = {
  category: 'vendor',
  name: 'Suse Edge Operational Intelligence',
  namespace: 'https://www.losant.com'
};

// status 'under_investigation', 'known_not_affected', 'fixed', 'known_affected'

export const createVexDocument = (docOrOptions, { publisher } = {}) => {
  let meta;
  const products = new Map(); // Map<product_id, branch entry>
  const vulnerabilities = new Map(); // Map<cveId, { product_status: Map<status, Set<productId>>, threats: Map<details, Set<productId>>, notes: [] }>

  if (docOrOptions?.document) {
    // Hydrate from existing CSAF document
    const existing = docOrOptions;
    meta = clone(existing.document);
    for (const branch of existing.product_tree?.branches ?? []) {
      products.set(branch.product.product_id, branch);
    }
    for (const vuln of existing.vulnerabilities ?? []) {
      vulnerabilities.set(vuln.cve, {
        product_status: new Map(
          Object.entries(vuln.product_status ?? {}).map(([s, ids]) => [s, new Set(ids)])
        ),
        threats: new Map(
          (vuln.threats ?? [])
            .filter((t) => t.category === 'impact')
            .map((t) => [t.details, new Set(t.product_ids)])
        ),
        notes: vuln.notes ?? []
      });
    }
  } else {
    // Build new document
    const { title, id } = docOrOptions ?? {};
    const now = new Date().toISOString();
    meta = {
      category: 'csaf_vex',
      csaf_version: '2.0',
      distribution: { tlp: { label: 'WHITE' } },
      publisher: publisher ?? DEFAULT_PUBLISHER,
      title,
      tracking: {
        id,
        status: 'final',
        version: '1',
        initial_release_date: now,
        current_release_date: now,
        revision_history: [{ date: now, number: '1', summary: 'Initial release' }]
      }
    };
  }

  const toJson = () => {
    const branches = [...products.values()];
    const vulns = [...vulnerabilities.entries()].map(([cve, { product_status, threats, notes }]) => {
      const ps = {};
      for (const [status, ids] of product_status) {
        if (ids.size > 0) { ps[status] = [...ids]; }
      }
      const threatArr = [...threats.entries()]
        .filter(([, ids]) => ids.size > 0)
        .map(([details, ids]) => ({ category: 'impact', details, product_ids: [...ids] }));
      const result = { cve, product_status: ps };
      if (threatArr.length) { result.threats = threatArr; }
      if (notes.length) { result.notes = notes; }
      return result;
    });
    return { document: meta, product_tree: { branches }, vulnerabilities: vulns };
  };

  const upsertProduct = ({ name, productId, productName, shaRef, purl }) => {
    const product_identification_helper = {}
    if (shaRef) {
      product_identification_helper.hashes = [{ file_hashes: [{ algorithm: 'SHA-256', value: shaRef }], filename: productName ?? name }]
    }
    if (purl) {
      product_identification_helper.purl = purl;
    }
    products.set(productId, {
      category: 'product_version',
      name,
      product: {
        name: productName ?? name,
        product_id: productId,
        product_identification_helper
      }
    });
  };

  const updateVulnerabilityStatus = (cveId, productId, status, justification) => {
    let vuln = vulnerabilities.get(cveId);
    if (!vuln) {
      vuln = { product_status: new Map(), threats: new Map(), notes: [{ category: 'general', title: cveId, text: justification || cveId }] };
      vulnerabilities.set(cveId, vuln);
    }

    // Move productId to the correct status bucket
    for (const ids of vuln.product_status.values()) { ids.delete(productId); }
    if (!vuln.product_status.has(status)) { vuln.product_status.set(status, new Set()); }
    vuln.product_status.get(status).add(productId);

    // Remove productId from all threats before re-assigning
    for (const ids of vuln.threats.values()) { ids.delete(productId); }

    if (justification && status !== 'under_investigation') {
      if (!vuln.threats.has(justification)) { vuln.threats.set(justification, new Set()); }
      vuln.threats.get(justification).add(productId);
    }
  };

  const incrementVersion = () => {
    const now = new Date().toISOString();
    const next = String(Number(meta.tracking.version) + 1);
    meta.tracking.version = next;
    meta.tracking.current_release_date = now;
    meta.tracking.revision_history.push({ date: now, number: next, summary: 'Updated vulnerability assessments' });
  };

  const getCveProductStatus = (cveId, productId) => {
    const vuln = vulnerabilities.get(cveId);
    if (!vuln) { return null; }
    for (const [status, ids] of vuln.product_status) {
      if (ids.has(productId)) { return status; }
    }
    return null;
  };

  const getProducts = () => [...products.values()];

  const getCveJustification = (cveId, productId) => {
    const vuln = vulnerabilities.get(cveId);
    if (!vuln) { return null; }
    for (const [details, ids] of vuln.threats) {
      if (ids.has(productId)) { return details; }
    }
    return null;
  };

  return {
    toJson,
    upsertProduct,
    updateVulnerabilityStatus,
    incrementVersion,
    getProducts,
    getCveProductStatus,
    getCveJustification
  };
};
