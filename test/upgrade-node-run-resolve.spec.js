import 'should';
import { pickLatestVersion, resolveLatestNode } from '../auto-upgrade-node/resolve-node-version.js';

describe('pickLatestVersion', () => {
  it('picks the highest patch version', () => {
    pickLatestVersion(['24.1.0', '24.21.0', '24.9.0']).should.equal('24.21.0');
  });

  it('returns the only version when given a single version', () => {
    pickLatestVersion(['24.21.0']).should.equal('24.21.0');
  });
});

describe('resolveLatestNode', () => {
  const mockResponse = (data, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => data
  });

  it('filters versions to the requested major and returns the highest version', async () => {
    const fetchImpl = async () => mockResponse([
      { version: 'v24.1.0' }, { version: 'v24.21.0' }, { version: 'v22.1.0' }
    ]);
    const result = await resolveLatestNode('24', fetchImpl);
    result.should.equal('24.21.0');
  });

  it('handles major versions passed with or without v prefix', async () => {
    const fetchImpl = async () => mockResponse([
      { version: '24.1.0' }, { version: 'v24.2.0' }
    ]);
    const result = await resolveLatestNode('v24', fetchImpl);
    result.should.equal('24.2.0');
  });

  it('throws when no versions match the requested major', async () => {
    const fetchImpl = async () => mockResponse([{ version: 'v22.1.0' }]);
    let error = null;
    try {
      await resolveLatestNode('24', fetchImpl);
    } catch (err) {
      error = err;
    }
    (error === null).should.be.false();
  });

  it('throws when the Node dist request fails', async () => {
    const fetchImpl = async () => mockResponse(null, false, 500);
    let error = null;
    try {
      await resolveLatestNode('24', fetchImpl);
    } catch (err) {
      error = err;
    }
    (error === null).should.be.false();
  });
});
