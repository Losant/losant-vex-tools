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
  const vulnerabilities = new Map(); // Map<cveId, { product_status: Map<status, Set>, threats: Map<"cat\tdetails", {category, details, ids: Set}>, flags: Map<label, Set>, remediations: Map<"cat\tdetails", {category, details, ids: Set}>, notes[] }>

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
          (vuln.threats ?? []).map((t) => {
            const category = t.category ?? 'impact';
            return [`${category}\t${t.details}`, { category, details: t.details, ids: new Set(t.product_ids) }];
          })
        ),
        flags: new Map(
          (vuln.flags ?? []).map((f) => [f.label, new Set(f.product_ids)])
        ),
        remediations: new Map(
          (vuln.remediations ?? []).map((r) => [`${r.category}\t${r.details}`, { category: r.category, details: r.details, ids: new Set(r.product_ids) }])
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
    const vulns = [...vulnerabilities.entries()].map(([cve, { product_status, threats, flags, remediations, notes }]) => {
      const ps = {};
      for (const [status, ids] of product_status) {
        if (ids.size > 0) { ps[status] = [...ids]; }
      }
      const threatArr = [...threats.values()]
        .filter(({ ids }) => ids.size > 0)
        .map(({ category, details, ids }) => ({ category, details, product_ids: [...ids] }));
      const flagArr = [...flags.entries()]
        .filter(([, ids]) => ids.size > 0)
        .map(([label, ids]) => ({ label, product_ids: [...ids] }));
      const remArr = [...remediations.values()]
        .filter(({ ids }) => ids.size > 0)
        .map(({ category, details, ids }) => ({ category, details, product_ids: [...ids] }));
      const result = { cve, product_status: ps };
      if (threatArr.length) { result.threats = threatArr; }
      if (flagArr.length) { result.flags = flagArr; }
      if (remArr.length) { result.remediations = remArr; }
      if (notes.length) { result.notes = notes; }
      return result;
    });
    return { document: meta, product_tree: { branches }, vulnerabilities: vulns };
  };

  const upsertProduct = ({ name, productId, productName, purl }) => {
    products.set(productId, {
      category: 'product_version',
      name,
      product: {
        name: productName ?? name,
        product_id: productId,
        product_identification_helper: { purl }
      }
    });
  };

  const updateVulnerabilityStatus = (cveId, productId, status, { justification, label, remediationCategory, remediationDetails } = {}) => {
    let vuln = vulnerabilities.get(cveId);
    if (!vuln) {
      vuln = { product_status: new Map(), threats: new Map(), flags: new Map(), remediations: new Map(), notes: [{ category: 'general', title: cveId, text: cveId }] };
      vulnerabilities.set(cveId, vuln);
    }

    const clearFrom = (map) => { for (const ids of map.values()) { ids.delete(productId); } };
    const addTo = (map, key) => { if (!map.has(key)) { map.set(key, new Set()); } map.get(key).add(productId); };

    clearFrom(vuln.product_status);
    addTo(vuln.product_status, status);

    if (status === 'under_investigation' && justification) {
      const note = vuln.notes.find((n) => n.category === 'general' && n.title === cveId);
      if (note) { note.text = justification; }
    }

    for (const entry of vuln.threats.values()) { entry.ids.delete(productId); }
    if (justification && (status === 'known_not_affected' || status === 'known_affected')) {
      const threatKey = `impact\t${justification}`;
      if (!vuln.threats.has(threatKey)) { vuln.threats.set(threatKey, { category: 'impact', details: justification, ids: new Set() }); }
      vuln.threats.get(threatKey).ids.add(productId);
    }

    clearFrom(vuln.flags);
    if (label && status === 'known_not_affected') {
      addTo(vuln.flags, label);
    }

    for (const rem of vuln.remediations.values()) { rem.ids.delete(productId); }
    if (remediationCategory && remediationDetails && (status === 'fixed' || status === 'known_affected')) {
      const key = `${remediationCategory}\t${remediationDetails}`;
      if (!vuln.remediations.has(key)) { vuln.remediations.set(key, { category: remediationCategory, details: remediationDetails, ids: new Set() }); }
      vuln.remediations.get(key).ids.add(productId);
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
