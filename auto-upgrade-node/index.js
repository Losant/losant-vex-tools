import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { resolveLatestNode } from './resolve-node-version.js';

const nodeMajor = process.env.INPUT_NODE_MAJOR_VERSION?.trim();
const scriptName = process.env.INPUT_SCRIPT_NAME?.trim() ?? '';
const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();

// Helper functions for reading/writing repo files to avoid static bundler asset relocation
const getRepoPath = (filename) => join(repoRoot, filename);
const repoFileExists = (filename) => existsSync(getRepoPath(filename));
const readRepoFile = (filename) => readFileSync(getRepoPath(filename), 'utf8');
const writeRepoFile = (filename, content) => writeFileSync(getRepoPath(filename), content);

// Read current versions from repo files
let currentNode = '';
if (repoFileExists('.node-version')) {
  currentNode = readRepoFile('.node-version').trim().replace(/^v/, '');
}

let currentPnpm = '';
if (repoFileExists('package.json')) {
  try {
    const rootPkg = JSON.parse(readRepoFile('package.json'));
    currentPnpm = rootPkg.packageManager?.replace('pnpm@', '') ?? '';
  } catch (err) {
    console.warn(`Warning reading package.json: ${err.message}`);
  }
}
// Corepack writes packageManager as "pnpm@<version>+sha512.<hash>" — strip the
// build-metadata suffix so comparisons against the registry's plain version work.
const currentPnpmVersion = currentPnpm.split('+')[0];

const setOutput = (name, value) => {
  if (!process.env.GITHUB_OUTPUT) {
    console.log(`[output] ${name}=${value}`);
    return;
  }
  const delimiter = `ghadelimiter_${name}_${Date.now()}`;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
};

const fail = (msg) => {
  console.error(`::error::${msg}`);
  process.exit(1);
};

// --- Main ---
if (!nodeMajor) { fail('node_major_version input is required'); }

let latestNode;
try {
  latestNode = await resolveLatestNode(nodeMajor);
} catch (err) {
  fail(err.message);
}
const nodeVersion = latestNode !== currentNode ? latestNode : '';

// Fetch latest pnpm from npm registry (non-fatal if registry fails)
let latestPnpm = '';
try {
  const pnpmRes = await fetch('https://registry.npmjs.org/pnpm/latest');
  if (pnpmRes.ok) {
    const pnpmData = await pnpmRes.json();
    latestPnpm = pnpmData.version ?? '';
  } else {
    console.warn(`Warning: npm registry returned ${pnpmRes.status} for pnpm`);
  }
} catch (err) {
  console.warn(`Warning: failed to fetch pnpm from registry: ${err.message}`);
}
const pnpmVersion = currentPnpmVersion && latestPnpm && latestPnpm !== currentPnpmVersion ? latestPnpm : '';

console.log(`Current Node: ${currentNode || '(none)'}  →  Latest Node ${nodeMajor}.x: ${latestNode}${nodeVersion ? ' (will upgrade)' : ' (already current)'}`);
console.log(`Current pnpm: ${currentPnpmVersion || '(none)'}  →  Latest pnpm: ${latestPnpm || '(unknown)'}${pnpmVersion ? ' (will upgrade)' : ' (already current)'}`);

setOutput('current_node', currentNode);
setOutput('current_pnpm', currentPnpm);

if (!nodeVersion) {
  console.log('Node is already at the latest version for this major — nothing to upgrade.');
  setOutput('new_node_version', '');
  setOutput('new_pnpm', '');
  setOutput('notes', '');
  process.exit(0);
}

// An upgrade is available
setOutput('new_node_version', nodeVersion);

const spawnLogged = (cmd, args, opts = {}) => {
  const result = spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  if (result.stdout) { process.stdout.write(result.stdout); }
  if (result.stderr) { process.stderr.write(result.stderr); }
  return result;
};

const gitReset = () => {
  console.log('Resetting git workspace to clean state...');
  spawnLogged('git', ['checkout', '--', '.']);
  spawnLogged('git', ['clean', '-fd']);
};

// Installs the resolved Node version via `n` and returns a spawn env with its bin dir
const installNode = (version) => {
  console.log(`Installing Node ${version} via n...`);
  const npmInstallN = spawnLogged('npm', ['install', '-g', 'n']);
  if (npmInstallN.status !== 0) {
    throw new Error(`Failed to install n:\n${[npmInstallN.stdout, npmInstallN.stderr].filter(Boolean).join('\n')}`);
  }

  const nPrefix = join(process.env.RUNNER_TEMP || repoRoot, 'n');
  const nEnv = { ...process.env, N_PREFIX: nPrefix };
  const nInstall = spawnLogged('n', [version], { env: nEnv });
  if (nInstall.status !== 0) {
    throw new Error(`Failed to install Node ${version} via n:\n${[nInstall.stdout, nInstall.stderr].filter(Boolean).join('\n')}`);
  }

  return { ...nEnv, PATH: `${join(nPrefix, 'bin')}:${process.env.PATH}` };
};

const installPnpm = (version, env) => {
  console.log(`Installing pnpm@${version} globally...`);
  const res = spawnLogged('npm', ['install', '-g', `pnpm@${version}`], { env });
  if (res.status !== 0) {
    return `⚠️ \`npm install -g pnpm@${version}\` failed — pnpm may not be available at the new version for subsequent steps.\n\`\`\`\n${[res.stdout, res.stderr].filter(Boolean).join('\n').trim()}\n\`\`\``;
  }
  return '';
};

const runScript = (scriptPath, env, extraEnv = {}) => {
  const fullEnv = {
    ...env,
    NODE_VERSION: nodeVersion,
    PNPM_VERSION: '',
    SKIP_NODE_INSTALL: '1',
    SKIP_BUILD: '1',
    COREPACK_ENABLE_STRICT: '0',
    ...extraEnv
  };
  console.log(`Running: bash ${scriptPath}`);
  console.log(`  NODE_VERSION=${fullEnv.NODE_VERSION} PNPM_VERSION=${fullEnv.PNPM_VERSION} SKIP_NODE_INSTALL=1 SKIP_BUILD=1`);
  const result = spawnLogged('bash', [scriptPath], { env: fullEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    success: result.status === 0 && !result.error,
    output: [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  };
};

const replaceInFile = (filePath, from, to) => {
  const content = readFileSync(filePath, 'utf8');
  const updated = content.replaceAll(from, to);
  if (updated !== content) {
    writeFileSync(filePath, updated);
    console.log(`  Updated ${filePath}`);
  }
};

const performGenericUpgrade = (env, withPnpm) => {
  console.log(`Applying generic file updates: Node ${currentNode} → ${nodeVersion}${withPnpm && pnpmVersion ? `, pnpm ${currentPnpmVersion} → ${pnpmVersion}` : ''}...`);
  writeRepoFile('.node-version', `${nodeVersion}\n`);
  console.log('  Updated .node-version');

  const found = spawnSync('find', [
    '.',
    '(', '-name', 'node_modules', '-o', '-name', '.git', '-o', '-name', 'dist', ')', '-prune', '-o',
    '(', '-name', 'package.json', '-o', '-name', 'Dockerfile', '-o', '-name', '*.Dockerfile', ')',
    '-print'
  ], { cwd: repoRoot, encoding: 'utf8' });
  if (found.error) {
    return {
      success: false,
      output: `find failed: ${found.error.message}`
    };
  }

  for (const f of found.stdout.trim().split('\n').filter(Boolean)) {
    if (f.endsWith('package.json')) {
      if (currentNode) {
        replaceInFile(f, `"node": "${currentNode}"`, `"node": "${nodeVersion}"`);
      }
      if (withPnpm && pnpmVersion && currentPnpm) {
        replaceInFile(f, `"pnpm@${currentPnpm}"`, `"pnpm@${pnpmVersion}"`);
      }
    } else {
      if (currentNode) {
        replaceInFile(f, `node:${currentNode}`, `node:${nodeVersion}`);
      }
      if (withPnpm && pnpmVersion && currentPnpm) {
        replaceInFile(f, `pnpm@${currentPnpm}`, `pnpm@${pnpmVersion}`);
      }
    }
  }

  console.log('Running pnpm install...');
  const res = spawnLogged('pnpm', ['install'], { env });
  return {
    success: res.status === 0 && !res.error,
    output: [res.error?.message, res.stdout, res.stderr].filter(Boolean).join('\n').trim()
  };
};

// Progressive fallback helper
const applyMinimalFallback = (notesList) => {
  console.log('\nApplying minimal fallback: updating only .node-version...');
  gitReset();
  writeRepoFile('.node-version', `${nodeVersion}\n`);
  console.log('  Updated .node-version');
  setOutput('new_pnpm', '');
  setOutput('notes', notesList.filter(Boolean).join('\n\n'));
};

let spawnEnv;
try {
  spawnEnv = installNode(nodeVersion);
} catch (err) {
  console.error(`Failed to install Node ${nodeVersion}: ${err.message}`);
  applyMinimalFallback([
    `⚠️ Failed to install Node ${nodeVersion} on runner:`,
    '```',
    err.message,
    '```',
    'Only `.node-version` was updated so developers are aware of the upgrade. Review and run the upgrade manually.'
  ]);
  process.exit(0);
}

let pnpmInstallNote = '';
if (pnpmVersion) {
  pnpmInstallNote = installPnpm(pnpmVersion, spawnEnv);
}

const runUpgrade = (withPnpm) => {
  if (scriptName) {
    return runScript(scriptName, spawnEnv, { PNPM_VERSION: withPnpm && pnpmVersion ? pnpmVersion : '' });
  }
  return performGenericUpgrade(spawnEnv, withPnpm);
};

const upgradeTypeDesc = scriptName ? `script: ${scriptName}` : 'generic upgrade';

if (pnpmVersion) {
  // Attempt 1: Node + pnpm
  console.log(`\nAttempt 1 (${upgradeTypeDesc}): Node ${nodeVersion} + pnpm ${pnpmVersion}...`);
  const try1 = runUpgrade(true);

  if (try1.success) {
    console.log('Attempt 1 succeeded.');
    setOutput('new_pnpm', pnpmVersion);
    setOutput('notes', pnpmInstallNote);
  } else {
    console.log('\nAttempt 1 failed. Resetting workspace and retrying with node upgrade only (no pnpm)...');
    gitReset();
    if (currentPnpm) {
      console.log(`Reverting global pnpm to current version ${currentPnpm}...`);
      installPnpm(currentPnpm, spawnEnv);
    }

    // Attempt 2: Node only
    console.log(`\nAttempt 2 (${upgradeTypeDesc}): Node ${nodeVersion} only...`);
    const try2 = runUpgrade(false);

    if (try2.success) {
      console.log('Attempt 2 succeeded (node only).');
      setOutput('new_pnpm', '');
      setOutput('notes', [
        '⚠️ pnpm upgrade was skipped — the upgrade failed when pnpm was included.',
        'Review and apply the pnpm upgrade manually if needed.',
        '',
        `**Attempt 1 error (with pnpm ${pnpmVersion}):**`,
        '```',
        try1.output,
        '```'
      ].join('\n'));
    } else {
      // Both attempts failed: Fall back to .node-version only
      applyMinimalFallback([
        '⚠️ The upgrade failed on both attempts. Only `.node-version` was updated.',
        'Run the upgrade manually before merging.',
        '',
        `**Attempt 1 error (with pnpm ${pnpmVersion}):**`,
        '```',
        try1.output,
        '```',
        '',
        '**Attempt 2 error (node only):**',
        '```',
        try2.output,
        '```'
      ]);
    }
  }
} else {
  // No pnpm upgrade needed: single attempt for Node only
  console.log(`\nAttempt 1 (${upgradeTypeDesc}): Node ${nodeVersion} only...`);
  const try1 = runUpgrade(false);

  if (try1.success) {
    console.log('Upgrade succeeded.');
    setOutput('new_pnpm', '');
    setOutput('notes', '');
  } else {
    console.log('\nUpgrade failed. Falling back to .node-version only...');
    applyMinimalFallback([
      '⚠️ The upgrade failed. Only `.node-version` was updated.',
      'Run the upgrade manually before merging.',
      '',
      '**Attempt 1 error:**',
      '```',
      try1.output,
      '```'
    ]);
  }
}
