import { createRequire as __WEBPACK_EXTERNAL_createRequire } from "module";
/******/ var __webpack_modules__ = ({

/***/ 982:
/***/ ((module) => {

module.exports = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("crypto");

/***/ }),

/***/ 896:
/***/ ((module) => {

module.exports = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("fs");

/***/ }),

/***/ 798:
/***/ ((__webpack_module__, __unused_webpack___webpack_exports__, __nccwpck_require__) => {

__nccwpck_require__.a(__webpack_module__, async (__webpack_handle_async_dependencies__, __webpack_async_result__) => { try {
/* harmony import */ var fs__WEBPACK_IMPORTED_MODULE_0__ = __nccwpck_require__(896);
/* harmony import */ var crypto__WEBPACK_IMPORTED_MODULE_1__ = __nccwpck_require__(982);
/* harmony import */ var _upgrade_js__WEBPACK_IMPORTED_MODULE_2__ = __nccwpck_require__(906);




const setOutput = (name, value) => {
  if (!process.env.GITHUB_OUTPUT) {
    console.log(`[output] ${name}=${value}`);
    return;
  }
  const strVal = String(value ?? '');
  if (strVal.includes('\n')) {
    const delimiter = `ghadelimiter_${name}_${(0,crypto__WEBPACK_IMPORTED_MODULE_1__.randomUUID)()}`;
    (0,fs__WEBPACK_IMPORTED_MODULE_0__.appendFileSync)(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${strVal}\n${delimiter}\n`);
  } else {
    (0,fs__WEBPACK_IMPORTED_MODULE_0__.appendFileSync)(process.env.GITHUB_OUTPUT, `${name}=${strVal}\n`);
  }
};

const EMPTY_OUTPUTS = {
  current_node: '', current_pnpm: '', new_node_version: '', new_pnpm: '', notes: '', has_changes: 'false'
};

const writeOutputs = (outputs) => {
  for (const [name, value] of Object.entries(outputs)) { setOutput(name, value); }
};

let result;
try {
  result = await (0,_upgrade_js__WEBPACK_IMPORTED_MODULE_2__/* .run */ .eF)({
    nodeMajor: process.env.INPUT_NODE_MAJOR_VERSION?.trim(),
    projectDirsInput: process.env.INPUT_PROJECT_DIRS?.trim() ?? '',
    upgradeToLatest: (0,_upgrade_js__WEBPACK_IMPORTED_MODULE_2__/* .parseBoolean */ .yG)(process.env.INPUT_UPGRADE_TO_LATEST),
    repoRoot: process.env.GITHUB_WORKSPACE || process.cwd()
  });
} catch (err) {
  // run() is written not to throw; this is a last resort so the job still emits outputs.
  writeOutputs(EMPTY_OUTPUTS);
  console.error(`::error::${err.stack || err.message}`);
  process.exit(1);
}

writeOutputs(result.outputs);
if (result.error) { console.error(`::error::${result.error}`); }
process.exit(result.exitCode);

__webpack_async_result__();
} catch(e) { __webpack_async_result__(e); } }, 1);

/***/ }),

/***/ 906:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __nccwpck_require__) => {


// EXPORTS
__nccwpck_require__.d(__webpack_exports__, {
  yG: () => (/* binding */ parseBoolean),
  eF: () => (/* binding */ run)
});

// UNUSED EXPORTS: PNPM_REGISTRY_URL, applyNodeEdits, applyPnpmEdits, baseEnv, escapeRegExp, formatErrorBlock, gitCheckpoint, gitRollback, installNode, installPnpm, io, isDirty, joinNotes, listFiles, pickVersions, pnpmInstallAll, pnpmUpgradeAll, readCurrentVersions, replaceBuildArg, replaceEnginePin, replaceInFile, resolveLatestPnpm, resolveProjectDirs, runCmd

// EXTERNAL MODULE: external "fs"
var external_fs_ = __nccwpck_require__(896);
;// CONCATENATED MODULE: external "path"
const external_path_namespaceObject = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("path");
;// CONCATENATED MODULE: external "os"
const external_os_namespaceObject = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("os");
;// CONCATENATED MODULE: external "child_process"
const external_child_process_namespaceObject = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("child_process");
;// CONCATENATED MODULE: ./auto-upgrade-node/resolve-node-version.js
const NODE_DIST_URL = 'https://nodejs.org/dist/index.json';

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const pickLatestVersion = (versions) => {
  return versions.slice().sort((a, b) => {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (partsA[i] !== partsB[i]) { return partsA[i] - partsB[i]; }
    }
    return 0;
  }).pop();
};

const resolveLatestNode = async (major, fetchImpl = fetch) => {
  const majorNum = String(major).replace(/^v/, '');
  const pattern = new RegExp(`^v?${escapeRegExp(majorNum)}\\.\\d+\\.\\d+$`);
  const res = await fetchImpl(NODE_DIST_URL);
  if (!res.ok) { throw new Error(`Node.js dist error fetching versions: ${res.status}`); }
  const entries = await res.json();
  const versions = [];
  const entryList = Array.isArray(entries) ? entries : [];
  for (const entry of entryList) {
    const ver = entry?.version;
    if (ver && pattern.test(ver)) {
      versions.push(ver.replace(/^v/, ''));
    }
  }
  if (versions.length === 0) { throw new Error(`No Node ${majorNum}.x.x versions found`); }
  return pickLatestVersion(versions);
};


;// CONCATENATED MODULE: ./auto-upgrade-node/upgrade.js






const PNPM_REGISTRY_URL = 'https://registry.npmjs.org/pnpm/latest';

// --- Notes formatting ---------------------------------------------------

// Lines inside a single note block are joined with \n so fenced code blocks stay
// intact; separate blocks are joined with \n\n.
const formatErrorBlock = (title, output) => {
  return [title, '```', (output || '(no output)').trim(), '```'].join('\n');
};

const joinNotes = (blocks) => blocks.filter(Boolean).join('\n\n');

// --- Input parsing ------------------------------------------------------

const parseBoolean = (val) => String(val ?? '').trim().toLowerCase() === 'true';

// The repo root first, then each configured directory. A bad entry is left to fail at
// `pnpm install`, which reports it far more clearly than a pre-flight check would.
const resolveProjectDirs = (input, repoRoot) => {
  const dirs = [repoRoot];
  for (const raw of String(input ?? '').split(',')) {
    const entry = raw.trim();
    if (!entry) { continue; }
    const full = (0,external_path_namespaceObject.resolve)(repoRoot, entry);
    if (!dirs.includes(full)) { dirs.push(full); }
  }
  return dirs;
};

// --- Version discovery --------------------------------------------------

// Only a full x.y.z is safe to use later as a literal `from` string when rewriting files —
// a bare major like "24" would partial-match "node:24.1.0" in a Dockerfile and mangle it
// into "node:<new>.1.0". Treat anything shorter as unknown rather than risk that.
const FULL_SEMVER = /^\d+\.\d+\.\d+$/;

const readCurrentVersions = (repoRoot) => {
  let currentNode = '';
  const nodeVersionPath = (0,external_path_namespaceObject.join)(repoRoot, '.node-version');
  if ((0,external_fs_.existsSync)(nodeVersionPath)) {
    const raw = (0,external_fs_.readFileSync)(nodeVersionPath, 'utf8').trim().replace(/^v/, '');
    currentNode = FULL_SEMVER.test(raw) ? raw : '';
  }

  let currentPnpm = '';
  const pkgPath = (0,external_path_namespaceObject.join)(repoRoot, 'package.json');
  if ((0,external_fs_.existsSync)(pkgPath)) {
    try {
      const rootPkg = JSON.parse((0,external_fs_.readFileSync)(pkgPath, 'utf8'));
      if (rootPkg.packageManager?.startsWith('pnpm@')) {
        currentPnpm = rootPkg.packageManager.replace('pnpm@', '');
      }
    } catch (err) {
      console.warn(`Warning reading package.json: ${err.message}`);
    }
  }

  // Corepack writes packageManager as "pnpm@<version>+sha512.<hash>" — strip the
  // build-metadata suffix so comparisons against the registry's plain version work.
  const currentPnpmVersion = currentPnpm.split('+')[0];
  return { currentNode, currentPnpm, currentPnpmVersion: FULL_SEMVER.test(currentPnpmVersion) ? currentPnpmVersion : '' };
};

const resolveLatestPnpm = async () => {
  try {
    const res = await fetch(PNPM_REGISTRY_URL);
    if (!res.ok) {
      console.warn(`Warning: npm registry returned ${res.status} for pnpm`);
      return '';
    }
    const data = await res.json();
    return data?.version ?? '';
  } catch (err) {
    console.warn(`Warning: failed to fetch pnpm from registry: ${err.message}`);
    return '';
  }
};

// Numeric x.y.z comparison, not string inequality — a plain `!==` would count a stale or
// hand-pinned *newer* current version as needing an "upgrade" to something older.
const isNewerVersion = (candidate, current) => {
  if (!current) { return true; }
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) { return diff > 0; }
  }
  return false;
};

// An empty string for either version means "nothing to upgrade". A pnpm upgrade is
// only considered when the repo already pins a version via packageManager.
const pickVersions = ({ currentNode, latestNode, currentPnpmVersion, latestPnpm }) => ({
  nodeVersion: latestNode && isNewerVersion(latestNode, currentNode) ? latestNode : '',
  pnpmVersion: currentPnpmVersion && latestPnpm && isNewerVersion(latestPnpm, currentPnpmVersion) ? latestPnpm : ''
});

// --- File rewriting -----------------------------------------------------

const upgrade_escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Uses a version-boundary-aware regex (not a plain substring replace) so that, e.g.,
// `node:20.11.1` doesn't also match and corrupt `node:20.11.10`, and `node:20.11.0` doesn't
// match and corrupt a longer dotted tag like `node:20.11.0.5`. A trailing non-digit,
// non-dot character (`node:20.11.0-alpine`) is still matched, since OS/variant suffixes on
// the same version are the common case this exists to handle.
const replaceInFile = (fullPath, from, to) => {
  if (!from || from === to) { return false; }
  const content = (0,external_fs_.readFileSync)(fullPath, 'utf8');
  const pattern = new RegExp(`(?<!\\d)${upgrade_escapeRegExp(from)}(?!\\d)(?!\\.\\d)`, 'g');
  const updated = content.replace(pattern, to);
  if (updated === content) { return false; }
  (0,external_fs_.writeFileSync)(fullPath, updated);
  return true;
};

// Matches "<key>": "<optional range operator><from>", preserving the range operator
// (^, ~, >=, <=, >, <) so ranges like "^20.11.0" still resolve. Global so a file
// pinning the same runtime in more than one place (engines, volta, ...) is fully
// updated rather than half-updated. Used for both "node" and "pnpm" engine pins.
const replaceEnginePin = (fullPath, key, from, to) => {
  if (!from || from === to) { return false; }
  const content = (0,external_fs_.readFileSync)(fullPath, 'utf8');
  const pattern = new RegExp(`("${upgrade_escapeRegExp(key)}"\\s*:\\s*")(\\^|~|>=|<=|>|<)?\\s*${upgrade_escapeRegExp(from)}(")`, 'g');
  const updated = content.replace(pattern, (match, pre, op = '', post) => `${pre}${op}${to}${post}`);
  if (updated === content) { return false; }
  (0,external_fs_.writeFileSync)(fullPath, updated);
  return true;
};

// Matches Docker build-arg syntax `<KEY>=<optional quote><from><optional quote>`, e.g.
// `ARG NODE_VERSION=20.11.0` or `ENV NODE_VERSION="20.11.0"`, for Dockerfiles that pin via
// `FROM node:${NODE_VERSION}` instead of a literal `node:<version>` tag. Reuses the same
// version-boundary guard as replaceInFile so `20.11.1` cannot partial-match `20.11.10` or
// `20.11.0.5`.
const replaceBuildArg = (fullPath, key, from, to) => {
  if (!from || from === to) { return false; }
  const content = (0,external_fs_.readFileSync)(fullPath, 'utf8');
  const pattern = new RegExp(`(${upgrade_escapeRegExp(key)}\\s*=\\s*"?)(?<!\\d)${upgrade_escapeRegExp(from)}(?!\\d)(?!\\.\\d)`, 'g');
  const updated = content.replace(pattern, `$1${to}`);
  if (updated === content) { return false; }
  (0,external_fs_.writeFileSync)(fullPath, updated);
  return true;
};

// --- Process steps ------------------------------------------------------

const runCmd = (cmd, args, opts = {}) => {
  const { quiet, ...spawnOpts } = opts;
  const result = (0,external_child_process_namespaceObject.spawnSync)(cmd, args, {
    encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...spawnOpts
  });
  if (!quiet) {
    if (result.stdout) { process.stdout.write(result.stdout); }
    if (result.stderr) { process.stderr.write(result.stderr); }
  }
  return {
    success: result.status === 0 && !result.error,
    output: [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  };
};

// Every process invocation in this module goes through io.runCmd — tests stub this one
// property to capture commands and control success/failure without spawning anything. A
// bare call to the `runCmd` const above would be unstubbable, since native ESM export
// bindings are read-only from outside the module.
const io = { runCmd };

// Tracked package.json / Dockerfile / *.Dockerfile paths. Asking git means node_modules,
// dist, and anything else ignored or untracked never shows up — no directory walk, and
// nothing to prune. `-z` NUL-terminates entries instead of newline-separating them, so git
// never C-quotes/escapes a path (which it otherwise does for non-ASCII or special
// characters) — a quoted entry parsed as a plain string would resolve to the wrong path.
const listFiles = (repoRoot) => {
  const res = io.runCmd('git', ['ls-files', '-z'], { cwd: repoRoot, quiet: true });
  if (!res.success) {
    console.warn(`Warning: could not list tracked files: ${res.output}`);
    return [];
  }
  return res.output.split('\0').reduce((acc, rel) => {
    if (!rel) { return acc; }
    const name = rel.split('/').pop();
    if (name === 'package.json' || name.toLowerCase().includes('dockerfile')) {
      acc.push((0,external_path_namespaceObject.join)(repoRoot, rel));
    }
    return acc;
  }, []);
};

const logEdit = (repoRoot, full, changed) => {
  if (changed) { console.log(`  Updated ${(0,external_path_namespaceObject.relative)(repoRoot, full)}`); }
};

const applyNodeEdits = ({ repoRoot, files, currentNode, nodeVersion }) => {
  (0,external_fs_.writeFileSync)((0,external_path_namespaceObject.join)(repoRoot, '.node-version'), `${nodeVersion}\n`);
  console.log('  Updated .node-version');
  if (!currentNode) { return; }

  for (const full of files) {
    let changed;
    if (full.endsWith('package.json')) {
      changed = replaceEnginePin(full, 'node', currentNode, nodeVersion);
    } else {
      // Dockerfiles pin Node via a literal `FROM node:<version>` tag, or a build arg
      // consumed as `FROM node:${NODE_VERSION}` — e.g. `ARG NODE_VERSION=20.11.0`.
      changed = replaceInFile(full, `node:${currentNode}`, `node:${nodeVersion}`);
      changed = replaceBuildArg(full, 'NODE_VERSION', currentNode, nodeVersion) || changed;
    }
    logEdit(repoRoot, full, changed);
  }
};

const applyPnpmEdits = ({ repoRoot, files, currentPnpm, currentPnpmVersion, pnpmVersion }) => {
  if (!currentPnpm) { return; }

  for (const full of files) {
    let changed;
    if (full.endsWith('package.json')) {
      // Three distinct shapes, all of which show up in real repos:
      //   "packageManager": "pnpm@12.4.2+sha512.abc"  → exact quoted literal, hash and all
      //   "ci": "corepack use pnpm@12.4.2"            → bare pin anywhere in the file
      //   "engines": { "pnpm": ">=12.4.2" }           → range pin, operator preserved
      // The first pass cannot cover the second: it anchors on the surrounding quotes.
      changed = replaceInFile(full, `"pnpm@${currentPnpm}"`, `"pnpm@${pnpmVersion}"`);
      changed = replaceInFile(full, `pnpm@${currentPnpmVersion}`, `pnpm@${pnpmVersion}`) || changed;
      changed = replaceEnginePin(full, 'pnpm', currentPnpmVersion, pnpmVersion) || changed;
    } else {
      // Dockerfiles pin pnpm via a bare, unquoted `pnpm@<version>` — e.g.
      // `RUN corepack prepare pnpm@12.4.2 --activate` or `npm install -g pnpm@12.4.2` — or a
      // build arg consumed as `pnpm@${PNPM_VERSION}` — e.g. `ARG PNPM_VERSION=12.4.2`.
      changed = replaceInFile(full, `pnpm@${currentPnpmVersion}`, `pnpm@${pnpmVersion}`);
      changed = replaceBuildArg(full, 'PNPM_VERSION', currentPnpmVersion, pnpmVersion) || changed;
    }
    logEdit(repoRoot, full, changed);
  }
};

// Stages the current, known-good state so a later step can be rolled back onto it.
const gitCheckpoint = (repoRoot) => io.runCmd('git', ['add', '-A'], { cwd: repoRoot, quiet: true });

// Restores the working tree from the index — back to the last checkpoint — discarding
// whatever the failed step churned. Anything the failed step created is untracked by
// then and `git clean` takes it; checkpointed files are in the index and survive. If the
// tree was already dirty before this run started, that state is the first checkpoint, so
// a rollback restores onto it rather than discarding it too.
const gitRollback = (repoRoot) => {
  console.log('Rolling back to the last checkpoint...');
  const res = io.runCmd('git', ['checkout', '--', '.'], { cwd: repoRoot });
  if (!res.success) { return res; }
  return io.runCmd('git', ['clean', '-fd'], { cwd: repoRoot });
};

const isDirty = (repoRoot) => {
  const res = io.runCmd('git', ['status', '--porcelain'], { cwd: repoRoot, quiet: true });
  return { ok: res.success, dirty: res.output.trim().length > 0 };
};

const baseEnv = () => ({ ...process.env, COREPACK_ENABLE_STRICT: '0' });

// Installs the resolved Node version via `n` and returns a spawn env with its bin dir.
const installNode = (version) => {
  console.log(`Installing Node ${version} via n...`);
  const npmInstallN = io.runCmd('npm', ['install', '-g', 'n']);
  if (!npmInstallN.success) {
    return { success: false, output: `Failed to install n:\n${npmInstallN.output}`, env: null };
  }

  const nPrefix = (0,external_path_namespaceObject.join)(process.env.RUNNER_TEMP || (0,external_os_namespaceObject.tmpdir)(), 'n');
  const nEnv = { ...baseEnv(), N_PREFIX: nPrefix };
  const nInstall = io.runCmd('n', [version], { env: nEnv });
  if (!nInstall.success) {
    return { success: false, output: `Failed to install Node ${version} via n:\n${nInstall.output}`, env: null };
  }

  return { success: true, output: '', env: { ...nEnv, PATH: `${(0,external_path_namespaceObject.join)(nPrefix, 'bin')}:${process.env.PATH}` } };
};

const installPnpm = (version, env) => {
  if (!version) { return { success: true, output: '' }; }
  console.log(`Installing pnpm@${version} globally...`);
  return io.runCmd('npm', ['install', '-g', `pnpm@${version}`], { env });
};

// A dir without its own pnpm-workspace.yaml is just a package.json that happens to be
// nested under the repo root's workspace (e.g. scripts/, tools/cli) — without
// --ignore-workspace, pnpm walks up to the root's pnpm-workspace.yaml and treats it as a
// member of that workspace, installing into (and upgrading) the root's lockfile instead
// of its own. A dir that pins its own pnpm-workspace.yaml is a project root in its own
// right, so it's left alone.
const workspaceArgs = (dir) => ((0,external_fs_.existsSync)((0,external_path_namespaceObject.join)(dir, 'pnpm-workspace.yaml')) ? [] : ['--ignore-workspace']);

// Stops at the first failing directory — a partially installed set of roots is not
// usable, and the caller resets and retries anyway.
const pnpmInstallAll = (dirs, env) => {
  for (const dir of dirs) {
    const args = ['install', '--no-frozen-lockfile', ...workspaceArgs(dir)];
    console.log(`Running pnpm ${args.join(' ')} in ${dir}...`);
    const res = io.runCmd('pnpm', args, { cwd: dir, env });
    if (!res.success) { return { ...res, failedDir: dir }; }
  }
  return { success: true, output: '', failedDir: null };
};

// Runs every directory even if an earlier one fails — the roots are independent, so a
// failure in one should not cost us the upgrades in the others.
const pnpmUpgradeAll = (dirs, env, latest) => {
  const failures = [];
  for (const dir of dirs) {
    const args = [...(latest ? ['-r', 'up', '--latest'] : ['-r', 'up']), ...workspaceArgs(dir)];
    console.log(`Running pnpm ${args.join(' ')} in ${dir}...`);
    const res = io.runCmd('pnpm', args, { cwd: dir, env });
    if (!res.success) { failures.push({ dir, output: res.output }); }
  }
  return { success: failures.length === 0, failures };
};

// --- Orchestration ------------------------------------------------------

const inDir = (repoRoot, dir) => (dir ? ` in \`${(0,external_path_namespaceObject.relative)(repoRoot, dir) || '.'}\`` : '');

const run = async ({ nodeMajor, projectDirsInput, upgradeToLatest, repoRoot }) => {
  const outputs = {
    current_node: '', current_pnpm: '', new_node_version: '', new_pnpm: '', notes: '', has_changes: 'false'
  };
  const notes = [];

  const finish = (exitCode) => {
    // gitCheckpoint stages intermediate progress along the way purely so a later failure
    // can roll back onto it — it's an internal safety net, not a signal that the run is
    // done. Unstage everything before returning so a plain `git diff` in the calling
    // workflow sees every change this run made, not just whatever is left unstaged after
    // the last checkpoint.
    io.runCmd('git', ['reset'], { cwd: repoRoot, quiet: true });
    const status = isDirty(repoRoot);
    if (status.ok) {
      outputs.has_changes = status.dirty ? 'true' : 'false';
    } else {
      outputs.has_changes = outputs.new_node_version || outputs.new_pnpm ? 'true' : 'false';
      notes.push('⚠️ Could not run `git status` to detect changes; `has_changes` was inferred from the version bumps alone.');
    }
    outputs.notes = joinNotes(notes);
    return { outputs, exitCode, error: null };
  };

  // Throws away everything and records only the Node bump, so reviewers still see the
  // upgrade even though it could not be installed. No dependency upgrade follows — the
  // install is known broken.
  const keepNodeVersionOnly = (nodeVersion, pnpmVersion) => {
    if (pnpmVersion) {
      notes.push(`Never attempted to upgrade pnpm to version ${pnpmVersion}.`);
    }
    const reset = gitRollback(repoRoot);
    if (!reset.success) {
      notes.push(formatErrorBlock('⚠️ Could not reset the workspace before the fallback:', reset.output));
    }
    (0,external_fs_.writeFileSync)((0,external_path_namespaceObject.join)(repoRoot, '.node-version'), `${nodeVersion}\n`);
    console.log('  Updated .node-version');
    outputs.new_node_version = nodeVersion;
    return finish(0);
  };

  const noteUpgradeFailures = (failures) => {
    for (const f of failures) {
      notes.push(formatErrorBlock(`⚠️ \`pnpm -r up\` failed${inDir(repoRoot, f.dir)}:`, f.output));
    }
  };

  if (!nodeMajor) {
    return { outputs, exitCode: 1, error: 'node_major_version input is required' };
  }
  const dirs = resolveProjectDirs(projectDirsInput, repoRoot);

  // The fallback paths below roll back to the last checkpoint to discard a failed
  // attempt's mess. If the tree already had uncommitted work before this run started,
  // stage it as the first checkpoint so a later rollback restores onto it instead of
  // discarding it along with the failed attempt.
  const before = isDirty(repoRoot);
  if (before.ok && before.dirty) {
    console.warn('::warning::Working tree was not clean before the upgrade; staging it as a baseline so a failed attempt rolls back onto it instead of discarding it. `has_changes` may include these unrelated edits.');
    const staged = gitCheckpoint(repoRoot);
    if (!staged.success) {
      return { outputs, exitCode: 1, error: `Working tree is not clean and could not be staged as a safe baseline: ${staged.output}` };
    }
  }

  // 1. Discover versions.
  const { currentNode, currentPnpm, currentPnpmVersion } = readCurrentVersions(repoRoot);
  outputs.current_node = currentNode;
  outputs.current_pnpm = currentPnpm;

  let latestNode;
  try {
    latestNode = await resolveLatestNode(nodeMajor);
  } catch (err) {
    return { outputs, exitCode: 1, error: err.message };
  }
  const latestPnpm = await resolveLatestPnpm();
  const { nodeVersion, pnpmVersion } = pickVersions({ currentNode, latestNode, currentPnpmVersion, latestPnpm });

  console.log(`Current Node: ${currentNode || '(none)'}  →  Latest Node ${nodeMajor}.x: ${latestNode}${nodeVersion ? ' (will upgrade)' : ' (already current)'}`);
  console.log(`Current pnpm: ${currentPnpmVersion || '(none)'}  →  Latest pnpm: ${latestPnpm || '(unknown)'}${pnpmVersion ? ' (will upgrade)' : ' (already current)'}`);

  const files = nodeVersion || pnpmVersion ? listFiles(repoRoot) : [];
  // 2. Toolchain. Only install Node when we are actually bumping it; otherwise the
  // caller's Node already matches .node-version.
  let env = baseEnv();
  if (nodeVersion) {
    const installed = installNode(nodeVersion);
    if (!installed.success) {
      notes.push(formatErrorBlock(`⚠️ Failed to install Node ${nodeVersion} on the runner:`, installed.output));
      notes.push('Only `.node-version` was updated so developers are aware of the upgrade. Review and run the upgrade manually.');
      return keepNodeVersionOnly(nodeVersion, pnpmVersion);
    }
    env = installed.env;
    console.log(`\nApplying Node ${nodeVersion}...`);
    const nodeEdits = { repoRoot, files, currentNode, nodeVersion };
    applyNodeEdits(nodeEdits);

    // A freshly `n`-installed Node has its own global prefix with no pnpm in it, so some
    // version has to land there even when pnpm is not being upgraded — otherwise the
    // install below has no `pnpm` on PATH at all. Prefer the repo's current pin; fall back
    // to the latest release for a repo that doesn't pin one via packageManager.
    const pnpmForNewPrefix = currentPnpmVersion || latestPnpm;
    const globalPnpm = installPnpm(pnpmForNewPrefix, env);
    if (!globalPnpm.success) {
      notes.push(formatErrorBlock(`⚠️ \`npm install -g pnpm@${pnpmForNewPrefix}\` failed on the Node ${nodeVersion} upgrade:`, globalPnpm.output));
      notes.push('Only `.node-version` was updated — the upgrade could not be installed. Run it manually before merging.');
      return keepNodeVersionOnly(nodeVersion, pnpmVersion);
    }

    const install = pnpmInstallAll(dirs, env);
    if (!install.success) {
      notes.push(formatErrorBlock(`**\`pnpm install\` failed on the Node ${nodeVersion} upgrade${inDir(repoRoot, install.failedDir)}:**`, install.output));
      notes.push('Only `.node-version` was updated — the upgrade could not be installed. Run it manually before merging.');
      return keepNodeVersionOnly(nodeVersion, pnpmVersion);
    }
    const checkpointed = gitCheckpoint(repoRoot);
    if (!checkpointed.success) {
      notes.push(formatErrorBlock(`⚠️ Could not checkpoint the Node ${nodeVersion} upgrade:`, checkpointed.output));
      notes.push('Only `.node-version` was updated — the upgrade could not be safely checkpointed. Run it manually before merging.');
      return keepNodeVersionOnly(nodeVersion, pnpmVersion);
    }
    outputs.new_node_version = nodeVersion;
  }

  // 4. pnpm on top of a tree that is known to install. A failure rolls back to the
  // checkpoint, which still holds the Node edits and the lockfile they installed with.
  if (pnpmVersion) {
    const pnpmInstalled = installPnpm(pnpmVersion, env);
    if (!pnpmInstalled.success) {
      notes.push(formatErrorBlock(`⚠️ \`npm install -g pnpm@${pnpmVersion}\` failed — pnpm may not be available at the expected version.`, pnpmInstalled.output));
      notes.push('⚠️ The pnpm upgrade was skipped because of the install error. Review and apply it manually if needed.');
    } else {
      console.log(`\nApplying pnpm ${pnpmVersion}...`);
      applyPnpmEdits({ repoRoot, files, currentPnpm, currentPnpmVersion, pnpmVersion });
      const install = pnpmInstallAll(dirs, env);
      const checkpointed = install.success ? gitCheckpoint(repoRoot) : { success: false, output: '' };
      if (install.success && checkpointed.success) {
        outputs.new_pnpm = pnpmVersion;
      } else {
        if (!install.success) {
          notes.push(formatErrorBlock(`**\`pnpm install\` failed on the pnpm ${pnpmVersion} upgrade${inDir(repoRoot, install.failedDir)}:**`, install.output));
        } else {
          notes.push(formatErrorBlock(`⚠️ Could not checkpoint the pnpm ${pnpmVersion} upgrade:`, checkpointed.output));
        }
        notes.push('⚠️ The pnpm upgrade was skipped because of that error. Review and apply it manually if needed.');
        gitRollback(repoRoot);
        if (currentPnpmVersion) {
          console.log(`Reverting global pnpm to current version ${currentPnpmVersion}...`);
          installPnpm(currentPnpmVersion, env);
        }
      }

    }
  }

  // 5. Dependency upgrade always runs last.
  const upgraded = pnpmUpgradeAll(dirs, env, upgradeToLatest);
  noteUpgradeFailures(upgraded.failures);
  if (upgraded.success) { return finish(0); }

  // A failed `pnpm -r up` still churns lockfiles. Roll back to the last checkpoint so the
  // pull request carries the upgrades that did install and none of the failure's mess.
  if (outputs.new_node_version || outputs.new_pnpm) {
    notes.push('The dependency upgrade failed and was rolled back. The Node.js and pnpm upgrades above installed cleanly and were kept.');
    gitRollback(repoRoot);
    return finish(0);
  }

  // Nothing else upgraded, so there is no pull request worth opening.
  gitRollback(repoRoot);
  return finish(1);
};


/***/ })

/******/ });
/************************************************************************/
/******/ // The module cache
/******/ var __webpack_module_cache__ = {};
/******/ 
/******/ // The require function
/******/ function __nccwpck_require__(moduleId) {
/******/ 	// Check if module is in cache
/******/ 	var cachedModule = __webpack_module_cache__[moduleId];
/******/ 	if (cachedModule !== undefined) {
/******/ 		return cachedModule.exports;
/******/ 	}
/******/ 	// Create a new module (and put it into the cache)
/******/ 	var module = __webpack_module_cache__[moduleId] = {
/******/ 		// no module.id needed
/******/ 		// no module.loaded needed
/******/ 		exports: {}
/******/ 	};
/******/ 
/******/ 	// Execute the module function
/******/ 	var threw = true;
/******/ 	try {
/******/ 		__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 		threw = false;
/******/ 	} finally {
/******/ 		if(threw) delete __webpack_module_cache__[moduleId];
/******/ 	}
/******/ 
/******/ 	// Return the exports of the module
/******/ 	return module.exports;
/******/ }
/******/ 
/************************************************************************/
/******/ /* webpack/runtime/async module */
/******/ (() => {
/******/ 	var webpackQueues = typeof Symbol === "function" ? Symbol("webpack queues") : "__webpack_queues__";
/******/ 	var webpackExports = typeof Symbol === "function" ? Symbol("webpack exports") : "__webpack_exports__";
/******/ 	var webpackError = typeof Symbol === "function" ? Symbol("webpack error") : "__webpack_error__";
/******/ 	var resolveQueue = (queue) => {
/******/ 		if(queue && queue.d < 1) {
/******/ 			queue.d = 1;
/******/ 			queue.forEach((fn) => (fn.r--));
/******/ 			queue.forEach((fn) => (fn.r-- ? fn.r++ : fn()));
/******/ 		}
/******/ 	}
/******/ 	var wrapDeps = (deps) => (deps.map((dep) => {
/******/ 		if(dep !== null && typeof dep === "object") {
/******/ 			if(dep[webpackQueues]) return dep;
/******/ 			if(dep.then) {
/******/ 				var queue = [];
/******/ 				queue.d = 0;
/******/ 				dep.then((r) => {
/******/ 					obj[webpackExports] = r;
/******/ 					resolveQueue(queue);
/******/ 				}, (e) => {
/******/ 					obj[webpackError] = e;
/******/ 					resolveQueue(queue);
/******/ 				});
/******/ 				var obj = {};
/******/ 				obj[webpackQueues] = (fn) => (fn(queue));
/******/ 				return obj;
/******/ 			}
/******/ 		}
/******/ 		var ret = {};
/******/ 		ret[webpackQueues] = x => {};
/******/ 		ret[webpackExports] = dep;
/******/ 		return ret;
/******/ 	}));
/******/ 	__nccwpck_require__.a = (module, body, hasAwait) => {
/******/ 		var queue;
/******/ 		hasAwait && ((queue = []).d = -1);
/******/ 		var depQueues = new Set();
/******/ 		var exports = module.exports;
/******/ 		var currentDeps;
/******/ 		var outerResolve;
/******/ 		var reject;
/******/ 		var promise = new Promise((resolve, rej) => {
/******/ 			reject = rej;
/******/ 			outerResolve = resolve;
/******/ 		});
/******/ 		promise[webpackExports] = exports;
/******/ 		promise[webpackQueues] = (fn) => (queue && fn(queue), depQueues.forEach(fn), promise["catch"](x => {}));
/******/ 		module.exports = promise;
/******/ 		body((deps) => {
/******/ 			currentDeps = wrapDeps(deps);
/******/ 			var fn;
/******/ 			var getResult = () => (currentDeps.map((d) => {
/******/ 				if(d[webpackError]) throw d[webpackError];
/******/ 				return d[webpackExports];
/******/ 			}))
/******/ 			var promise = new Promise((resolve) => {
/******/ 				fn = () => (resolve(getResult));
/******/ 				fn.r = 0;
/******/ 				var fnQueue = (q) => (q !== queue && !depQueues.has(q) && (depQueues.add(q), q && !q.d && (fn.r++, q.push(fn))));
/******/ 				currentDeps.map((dep) => (dep[webpackQueues](fnQueue)));
/******/ 			});
/******/ 			return fn.r ? promise : getResult();
/******/ 		}, (err) => ((err ? reject(promise[webpackError] = err) : outerResolve(exports)), resolveQueue(queue)));
/******/ 		queue && queue.d < 0 && (queue.d = 0);
/******/ 	};
/******/ })();
/******/ 
/******/ /* webpack/runtime/define property getters */
/******/ (() => {
/******/ 	// define getter functions for harmony exports
/******/ 	__nccwpck_require__.d = (exports, definition) => {
/******/ 		for(var key in definition) {
/******/ 			if(__nccwpck_require__.o(definition, key) && !__nccwpck_require__.o(exports, key)) {
/******/ 				Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 			}
/******/ 		}
/******/ 	};
/******/ })();
/******/ 
/******/ /* webpack/runtime/hasOwnProperty shorthand */
/******/ (() => {
/******/ 	__nccwpck_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ })();
/******/ 
/******/ /* webpack/runtime/compat */
/******/ 
/******/ if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = new URL('.', import.meta.url).pathname.slice(import.meta.url.match(/^file:\/\/\/\w:/) ? 1 : 0, -1) + "/";
/******/ 
/************************************************************************/
/******/ 
/******/ // startup
/******/ // Load entry module and return exports
/******/ // This entry module used 'module' so it can't be inlined
/******/ var __webpack_exports__ = __nccwpck_require__(798);
/******/ __webpack_exports__ = await __webpack_exports__;
/******/ 
