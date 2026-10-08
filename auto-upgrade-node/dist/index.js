import { createRequire as __WEBPACK_EXTERNAL_createRequire } from "module";
/******/ var __webpack_modules__ = ({

/***/ 317:
/***/ ((module) => {

module.exports = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("child_process");

/***/ }),

/***/ 896:
/***/ ((module) => {

module.exports = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("fs");

/***/ }),

/***/ 857:
/***/ ((module) => {

module.exports = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("os");

/***/ }),

/***/ 928:
/***/ ((module) => {

module.exports = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("path");

/***/ }),

/***/ 798:
/***/ ((__webpack_module__, __unused_webpack___webpack_exports__, __nccwpck_require__) => {

__nccwpck_require__.a(__webpack_module__, async (__webpack_handle_async_dependencies__, __webpack_async_result__) => { try {
/* harmony import */ var fs__WEBPACK_IMPORTED_MODULE_0__ = __nccwpck_require__(896);
/* harmony import */ var path__WEBPACK_IMPORTED_MODULE_1__ = __nccwpck_require__(928);
/* harmony import */ var os__WEBPACK_IMPORTED_MODULE_2__ = __nccwpck_require__(857);
/* harmony import */ var child_process__WEBPACK_IMPORTED_MODULE_3__ = __nccwpck_require__(317);
/* harmony import */ var _resolve_node_version_js__WEBPACK_IMPORTED_MODULE_4__ = __nccwpck_require__(618);






const nodeMajor = process.env.INPUT_NODE_MAJOR_VERSION?.trim();
const scriptName = process.env.INPUT_SCRIPT_NAME?.trim() ?? '';
const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();

// Helper functions for reading/writing repo files to avoid static bundler asset relocation
const getRepoPath = (filename) => (0,path__WEBPACK_IMPORTED_MODULE_1__.join)(repoRoot, filename);
const repoFileExists = (filename) => (0,fs__WEBPACK_IMPORTED_MODULE_0__.existsSync)(getRepoPath(filename));
const readRepoFile = (filename) => (0,fs__WEBPACK_IMPORTED_MODULE_0__.readFileSync)(getRepoPath(filename), 'utf8');
const writeRepoFile = (filename, content) => (0,fs__WEBPACK_IMPORTED_MODULE_0__.writeFileSync)(getRepoPath(filename), content);

// Read current versions from repo files
let currentNode = '';
if (repoFileExists('.node-version')) {
  currentNode = readRepoFile('.node-version').trim().replace(/^v/, '');
}

let currentPnpm = '';
if (repoFileExists('package.json')) {
  try {
    const rootPkg = JSON.parse(readRepoFile('package.json'));
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

const setOutput = (name, value) => {
  if (!process.env.GITHUB_OUTPUT) {
    console.log(`[output] ${name}=${value}`);
    return;
  }
  const delimiter = `ghadelimiter_${name}_${Date.now()}`;
  (0,fs__WEBPACK_IMPORTED_MODULE_0__.appendFileSync)(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
};

const fail = (msg) => {
  console.error(`::error::${msg}`);
  process.exit(1);
};

// --- Main ---
if (!nodeMajor) { fail('node_major_version input is required'); }
if (scriptName && !repoFileExists(scriptName)) { fail(`script_name "${scriptName}" does not exist in the repo`); }

let latestNode;
try {
  latestNode = await (0,_resolve_node_version_js__WEBPACK_IMPORTED_MODULE_4__/* .resolveLatestNode */ .Gg)(nodeMajor);
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
console.log(`Current pnpm: ${currentPnpmVersion || '(none)'}  →  Latest pnpm: ${latestPnpm || '(unknown)'}${nodeVersion && pnpmVersion ? ' (will upgrade)' : ' (already current)'}`);

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
  const result = (0,child_process__WEBPACK_IMPORTED_MODULE_3__.spawnSync)(cmd, args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
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

  const nPrefix = (0,path__WEBPACK_IMPORTED_MODULE_1__.join)(process.env.RUNNER_TEMP || (0,os__WEBPACK_IMPORTED_MODULE_2__.tmpdir)(), 'n');
  const nEnv = { ...process.env, N_PREFIX: nPrefix };
  const nInstall = spawnLogged('n', [version], { env: nEnv });
  if (nInstall.status !== 0) {
    throw new Error(`Failed to install Node ${version} via n:\n${[nInstall.stdout, nInstall.stderr].filter(Boolean).join('\n')}`);
  }

  return { ...nEnv, PATH: `${(0,path__WEBPACK_IMPORTED_MODULE_1__.join)(nPrefix, 'bin')}:${process.env.PATH}` };
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
  if (!from || from === to) { return; }
  const fullPath = (0,path__WEBPACK_IMPORTED_MODULE_1__.join)(repoRoot, filePath);
  const content = (0,fs__WEBPACK_IMPORTED_MODULE_0__.readFileSync)(fullPath, 'utf8');
  const updated = content.replaceAll(from, to);
  if (updated !== content) {
    (0,fs__WEBPACK_IMPORTED_MODULE_0__.writeFileSync)(fullPath, updated);
    console.log(`  Updated ${filePath}`);
  }
};

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Matches "node": "<optional range operator><currentNode>", preserving the
// range operator (^, ~, >=, <=, >, <) so ranges like "^20.11.0" still resolve.
const replaceNodeEngine = (filePath, from, to) => {
  if (!from || from === to) { return; }
  const fullPath = (0,path__WEBPACK_IMPORTED_MODULE_1__.join)(repoRoot, filePath);
  const content = (0,fs__WEBPACK_IMPORTED_MODULE_0__.readFileSync)(fullPath, 'utf8');
  const pattern = new RegExp(`("node"\\s*:\\s*")(\\^|~|>=|<=|>|<)?${escapeRegExp(from)}(")`);
  const updated = content.replace(pattern, (match, pre, rangeOperator = '', post) => `${pre}${rangeOperator}${to}${post}`);
  if (updated !== content) {
    (0,fs__WEBPACK_IMPORTED_MODULE_0__.writeFileSync)(fullPath, updated);
    console.log(`  Updated ${filePath}`);
  }
};

const performGenericUpgrade = (env, withPnpm) => {
  console.log(`Applying generic file updates: Node ${currentNode} → ${nodeVersion}${withPnpm && pnpmVersion ? `, pnpm ${currentPnpmVersion} → ${pnpmVersion}` : ''}...`);
  writeRepoFile('.node-version', `${nodeVersion}\n`);
  console.log('  Updated .node-version');

  const found = (0,child_process__WEBPACK_IMPORTED_MODULE_3__.spawnSync)('find', [
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
        replaceNodeEngine(f, currentNode, nodeVersion);
      }
      if (withPnpm && pnpmVersion && currentPnpm) {
        replaceInFile(f, `"pnpm@${currentPnpm}"`, `"pnpm@${pnpmVersion}"`);
      }
    } else {
      if (currentNode) {
        replaceInFile(f, `node:${currentNode}`, `node:${nodeVersion}`);
      }
      if (withPnpm && pnpmVersion && currentPnpmVersion) {
        replaceInFile(f, `pnpm@${currentPnpmVersion}`, `pnpm@${pnpmVersion}`);
      }
    }
  }

  console.log('Running pnpm install...');
  const res = spawnLogged('pnpm', ['install', '--no-frozen-lockfile'], { env });
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
} else if (currentPnpmVersion) {
  pnpmInstallNote = installPnpm(currentPnpmVersion, spawnEnv);
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
    if (currentPnpmVersion) {
      console.log(`Reverting global pnpm to current version ${currentPnpmVersion}...`);
      installPnpm(currentPnpmVersion, spawnEnv);
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

__webpack_async_result__();
} catch(e) { __webpack_async_result__(e); } }, 1);

/***/ }),

/***/ 618:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __nccwpck_require__) => {

/* harmony export */ __nccwpck_require__.d(__webpack_exports__, {
/* harmony export */   Gg: () => (/* binding */ resolveLatestNode)
/* harmony export */ });
/* unused harmony exports NODE_DIST_URL, pickLatestVersion */
const NODE_DIST_URL = 'https://nodejs.org/dist/index.json';

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
