import 'should';
import { mkdtempSync, rmSync, cpSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { stub, restore } from 'sinon';
import { io, run, PNPM_REGISTRY_URL } from '../auto-upgrade-node/upgrade.js';
import { NODE_DIST_URL } from '../auto-upgrade-node/resolve-node-version.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '__fixtures__', 'test-repo');

// Copies the fixture repo into a disposable temp dir so applyNodeEdits/applyPnpmEdits can
// write real files without mutating the checked-in fixture.
const makeRepo = () => mkdtempSync(join(tmpdir(), 'auto-upgrade-node-'));

const jsonResponse = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });

// resolveLatestNode and resolveLatestPnpm both call the real, un-mocked `fetch` global —
// stubbing globalThis.fetch (unlike a bare named import) works under native ESM, so no
// seam is needed in upgrade.js itself for the network boundary.
const stubFetch = ({ nodeVersion, pnpmVersion, nodeOk = true, pnpmOk = true }) => {
  stub(globalThis, 'fetch').callsFake(async (url) => {
    if (url === NODE_DIST_URL) {
      return jsonResponse(nodeVersion ? [{ version: `v${nodeVersion}` }] : [], nodeOk);
    }
    if (url === PNPM_REGISTRY_URL) {
      return jsonResponse({ version: pnpmVersion }, pnpmOk);
    }
    throw new Error(`Unexpected fetch url in test: ${url}`);
  });
};

// Every shell command in upgrade.js goes through io.runCmd. Stubbing that single property
// captures every command the run made (for assertions) and lets each test script exactly
// which commands fail, without a single real process ever getting spawned.
const matchKey = (cmd, args) => {
  if (cmd === 'git') { return `git ${args[0]}`; }
  if (cmd === 'npm') { return args.includes('n') ? 'npm install -g n' : 'npm install -g pnpm'; }
  if (cmd === 'n') { return 'n <version>'; }
  if (cmd === 'pnpm') { return args[0] === 'install' ? 'pnpm install' : 'pnpm -r up'; }
  return `${cmd} ${args[0] ?? ''}`;
};

// There is no real git repo at the copied fixture path, so `git ls-files` needs a default
// stand-in for every test that touches file rewriting; `git status` defaults to clean.
const DEFAULT_HANDLERS = {
  'git ls-files': () => ({ success: true, output: 'package.json\nDockerfile\nscripts/package.json' }),
  'git status': () => ({ success: true, output: '' })
};

const stubRunCmd = (handlers = {}) => {
  const merged = { ...DEFAULT_HANDLERS, ...handlers };
  const calls = [];
  stub(io, 'runCmd').callsFake((cmd, args, opts) => {
    calls.push({ cmd, args, opts, key: matchKey(cmd, args) });
    const handler = merged[matchKey(cmd, args)];
    if (handler) { return handler({ cmd, args, opts }); }
    return { success: true, output: '' };
  });
  return calls;
};

describe('run', () => {
  const repos = [];

  beforeEach(() => {
    stub(console, 'log');
    stub(console, 'warn');
  });

  afterEach(() => {
    restore();
    while (repos.length) { rmSync(repos.pop(), { recursive: true, force: true }); }
  });

  const setupRepo = () => {
    const repoRoot = makeRepo();
    repos.push(repoRoot);
    cpSync(FIXTURE_DIR, repoRoot, { recursive: true });
    return repoRoot;
  };

  it('requires node_major_version and runs no commands', async () => {
    const calls = stubRunCmd();
    const result = await run({ nodeMajor: '', projectDirsInput: '', upgradeToLatest: false, repoRoot: '/unused' });

    result.exitCode.should.equal(1);
    result.error.should.equal('node_major_version input is required');
    calls.length.should.equal(0);
  });

  it('surfaces a failure to resolve the latest Node version as a top-level error', async () => {
    stubFetch({ nodeVersion: '24.3.0', pnpmVersion: '10.0.0', nodeOk: false });
    const repoRoot = setupRepo();

    const result = await run({ nodeMajor: '24', projectDirsInput: '', upgradeToLatest: false, repoRoot });

    result.exitCode.should.equal(1);
    result.error.should.match(/Node\.js dist error/);
  });

  it('still runs `pnpm -r up` when Node.js and pnpm are already current', async () => {
    stubFetch({ nodeVersion: '20.11.0', pnpmVersion: '10.0.0' });
    const repoRoot = setupRepo();
    const calls = stubRunCmd({
      'git status': () => ({ success: true, output: 'M package.json' })
    });

    const result = await run({ nodeMajor: '20', projectDirsInput: '', upgradeToLatest: false, repoRoot });

    result.exitCode.should.equal(0);
    result.outputs.new_node_version.should.equal('');
    result.outputs.new_pnpm.should.equal('');
    result.outputs.has_changes.should.equal('true');
    calls.some((c) => c.key === 'pnpm -r up').should.be.true();
    calls.some((c) => c.key === 'npm install -g n').should.be.false();
    readFileSync(join(repoRoot, '.node-version'), 'utf8').should.equal('20.11.0\n');
  });

  it('upgrades Node.js, reinstalls pnpm globally, and rewrites pins on success', async () => {
    stubFetch({ nodeVersion: '24.3.0', pnpmVersion: '10.0.0' });
    const repoRoot = setupRepo();
    const calls = stubRunCmd();

    const result = await run({ nodeMajor: '24', projectDirsInput: '', upgradeToLatest: false, repoRoot });

    result.exitCode.should.equal(0);
    result.outputs.new_node_version.should.equal('24.3.0');
    result.outputs.new_pnpm.should.equal('');

    readFileSync(join(repoRoot, '.node-version'), 'utf8').should.equal('24.3.0\n');
    JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).engines.node.should.equal('24.3.0');
    const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8');
    dockerfile.should.containEql('node:24.3.0-alpine');
    dockerfile.should.containEql('NODE_VERSION=24.3.0');

    calls.some((c) => c.key === 'npm install -g n').should.be.true();
    calls.some((c) => c.key === 'n <version>' && c.args[0] === '24.3.0').should.be.true();
    calls.some((c) => c.key === 'npm install -g pnpm' && c.args[2] === 'pnpm@10.0.0').should.be.true();
    calls.some((c) => c.key === 'pnpm install').should.be.true();
    calls.some((c) => c.key === 'git add').should.be.true();
  });

  it('falls back to a Node-only pin when `n` fails to install the new version', async () => {
    stubFetch({ nodeVersion: '24.3.0', pnpmVersion: '10.0.0' });
    const repoRoot = setupRepo();
    const calls = stubRunCmd({
      'n <version>': () => ({ success: false, output: 'n: network error' })
    });

    const result = await run({ nodeMajor: '24', projectDirsInput: '', upgradeToLatest: false, repoRoot });

    result.exitCode.should.equal(0);
    result.outputs.new_node_version.should.equal('24.3.0');
    result.outputs.notes.should.match(/Failed to install Node 24\.3\.0 on the runner/);
    readFileSync(join(repoRoot, '.node-version'), 'utf8').should.equal('24.3.0\n');

    // No point reinstalling pnpm or touching dependencies once Node itself never installed.
    calls.some((c) => c.key === 'npm install -g pnpm').should.be.false();
    calls.some((c) => c.key === 'pnpm install').should.be.false();
    calls.some((c) => c.key === 'git reset').should.be.true();
  });

  it('falls back to a Node-only pin when `pnpm install` fails after the Node bump', async () => {
    stubFetch({ nodeVersion: '24.3.0', pnpmVersion: '10.0.0' });
    const repoRoot = setupRepo();
    stubRunCmd({
      'pnpm install': () => ({ success: false, output: 'ERR_PNPM native build failed' })
    });

    const result = await run({ nodeMajor: '24', projectDirsInput: '', upgradeToLatest: false, repoRoot });

    result.exitCode.should.equal(0);
    result.outputs.new_node_version.should.equal('24.3.0');
    result.outputs.notes.should.match(/pnpm install` failed on the Node 24\.3\.0 upgrade/);
  });

  it('upgrades pnpm alone without touching Node.js toolchain', async () => {
    stubFetch({ nodeVersion: '20.11.0', pnpmVersion: '10.5.0' });
    const repoRoot = setupRepo();
    const calls = stubRunCmd();

    const result = await run({ nodeMajor: '20', projectDirsInput: '', upgradeToLatest: false, repoRoot });

    result.exitCode.should.equal(0);
    result.outputs.new_node_version.should.equal('');
    result.outputs.new_pnpm.should.equal('10.5.0');

    JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).packageManager.should.equal('pnpm@10.5.0');
    const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8');
    dockerfile.should.containEql('pnpm@10.5.0');
    dockerfile.should.containEql('PNPM_VERSION=10.5.0');

    calls.some((c) => c.key === 'npm install -g n').should.be.false();
    calls.some((c) => c.key === 'npm install -g pnpm' && c.args[2] === 'pnpm@10.5.0').should.be.true();
  });

  it('rolls back and reverts the global pnpm version when the pnpm install fails, then still runs the dependency upgrade', async () => {
    stubFetch({ nodeVersion: '20.11.0', pnpmVersion: '10.5.0' });
    const repoRoot = setupRepo();
    const calls = stubRunCmd({
      'pnpm install': () => ({ success: false, output: 'ERR_PNPM lockfile conflict' })
    });

    const result = await run({ nodeMajor: '20', projectDirsInput: '', upgradeToLatest: false, repoRoot });

    result.exitCode.should.equal(0);
    result.outputs.new_pnpm.should.equal('');
    result.outputs.notes.should.match(/pnpm install` failed on the pnpm 10\.5\.0 upgrade/);

    calls.some((c) => c.key === 'git checkout').should.be.true();
    // Reverts to the current version, then still attempts the final dependency upgrade.
    const pnpmInstalls = calls.filter((c) => c.key === 'npm install -g pnpm');
    pnpmInstalls.map((c) => c.args[2]).should.deepEqual(['pnpm@10.5.0', 'pnpm@10.0.0']);
    calls.some((c) => c.key === 'pnpm -r up').should.be.true();
  });

  it('rolls back to the last checkpoint when the final dependency upgrade fails but something else upgraded', async () => {
    stubFetch({ nodeVersion: '24.3.0', pnpmVersion: '10.0.0' });
    const repoRoot = setupRepo();
    const calls = stubRunCmd({
      'pnpm -r up': () => ({ success: false, output: 'ERR_PNPM peer dependency conflict' })
    });

    const result = await run({ nodeMajor: '24', projectDirsInput: '', upgradeToLatest: false, repoRoot });

    result.exitCode.should.equal(0);
    result.outputs.new_node_version.should.equal('24.3.0');
    result.outputs.notes.should.match(/pnpm -r up` failed/);
    result.outputs.notes.should.match(/rolled back/);
    calls.some((c) => c.key === 'git checkout').should.be.true();
    calls.some((c) => c.key === 'git reset').should.be.false();
  });

  it('resets the workspace and exits 1 when the final dependency upgrade fails and nothing else upgraded', async () => {
    stubFetch({ nodeVersion: '20.11.0', pnpmVersion: '10.0.0' });
    const repoRoot = setupRepo();
    const calls = stubRunCmd({
      'pnpm -r up': () => ({ success: false, output: 'ERR_PNPM registry unreachable' }),
      'git status': () => ({ success: true, output: '' })
    });

    const result = await run({ nodeMajor: '20', projectDirsInput: '', upgradeToLatest: false, repoRoot });

    result.exitCode.should.equal(1);
    result.outputs.new_node_version.should.equal('');
    result.outputs.new_pnpm.should.equal('');
    calls.some((c) => c.key === 'git reset').should.be.true();
    calls.some((c) => c.key === 'git checkout').should.be.false();
  });

  it('adds --ignore-workspace only for project_dirs entries without their own pnpm-workspace.yaml', async () => {
    stubFetch({ nodeVersion: '20.11.0', pnpmVersion: '10.0.0' });
    const repoRoot = setupRepo();
    const calls = stubRunCmd();

    const result = await run({ nodeMajor: '20', projectDirsInput: 'scripts', upgradeToLatest: true, repoRoot });

    result.exitCode.should.equal(0);
    const upgrades = calls.filter((c) => c.key === 'pnpm -r up');
    upgrades.length.should.equal(2);

    const rootUpgrade = upgrades.find((c) => c.opts.cwd === repoRoot);
    const scriptsUpgrade = upgrades.find((c) => c.opts.cwd === join(repoRoot, 'scripts'));
    // The fixture root pins its own pnpm-workspace.yaml, so it's left alone; scripts/ has
    // no workspace file of its own and would otherwise be swept into the root's workspace.
    rootUpgrade.args.should.not.containEql('--ignore-workspace');
    scriptsUpgrade.args.should.containEql('--ignore-workspace');
    rootUpgrade.args.should.containEql('--latest');
  });
});
