export const NODE_DIST_URL = 'https://nodejs.org/dist/index.json';

export const pickLatestVersion = (versions) => {
  return versions.slice().sort((a, b) => {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (partsA[i] !== partsB[i]) { return partsA[i] - partsB[i]; }
    }
    return 0;
  }).pop();
};

export const resolveLatestNode = async (major, fetchImpl = fetch) => {
  const majorNum = String(major).replace(/^v/, '');
  const pattern = new RegExp(`^v?${majorNum}\\.\\d+\\.\\d+$`);
  const res = await fetchImpl(NODE_DIST_URL);
  if (!res.ok) { throw new Error(`Node.js dist error fetching versions: ${res.status}`); }
  const entries = await res.json();
  const versions = [];
  for (const entry of entries ?? []) {
    const ver = entry?.version;
    if (ver && pattern.test(ver)) {
      versions.push(ver.replace(/^v/, ''));
    }
  }
  if (versions.length === 0) { throw new Error(`No Node ${majorNum}.x.x versions found`); }
  return pickLatestVersion(versions);
};

