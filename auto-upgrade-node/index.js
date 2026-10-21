import { appendFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { parseBoolean, run } from './upgrade.js';

const setOutput = (name, value) => {
  if (!process.env.GITHUB_OUTPUT) {
    console.log(`[output] ${name}=${value}`);
    return;
  }
  const strVal = String(value ?? '');
  if (strVal.includes('\n')) {
    const delimiter = `ghadelimiter_${name}_${randomUUID()}`;
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${strVal}\n${delimiter}\n`);
  } else {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${strVal}\n`);
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
  result = await run({
    nodeMajor: process.env.INPUT_NODE_MAJOR_VERSION?.trim(),
    projectDirsInput: process.env.INPUT_PROJECT_DIRS?.trim() ?? '',
    upgradeToLatest: parseBoolean(process.env.INPUT_UPGRADE_TO_LATEST),
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
