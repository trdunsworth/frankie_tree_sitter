'use strict';

// Launches VSCodium with this repository's extension in development mode and
// runs test/integration/suite.js inside it. Skipped when VSCodium is absent —
// the two headless suites still cover everything below the editor.
//
//   node test/integration/run.js        (or: npm run test:integration)
//   VSCODIUM_PATH=/path/to/Codium node test/integration/run.js

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { runTests } = require('@vscode/test-electron');

const VSCODIUM = process.env.VSCODIUM_PATH
  || '/Applications/VSCodium.app/Contents/MacOS/VSCodium';
const EXTENSION_PATH = path.join(__dirname, '..', '..');

async function main() {
  if (!fs.existsSync(VSCODIUM)) {
    console.log(`skipping integration test: no VSCodium at ${VSCODIUM} ` +
      '(set VSCODIUM_PATH to run it). The headless suites still cover the provider.');
    return;
  }

  // A throwaway profile keeps the run from touching the real editor state.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frankie-itest-'));
  console.log(`launching ${VSCODIUM} with a temporary profile in ${tmp}`);

  await runTests({
    vscodeExecutablePath: VSCODIUM,
    extensionDevelopmentPath: EXTENSION_PATH,
    extensionTestsPath: path.join(__dirname, 'suite.js'),
    launchArgs: [
      '--user-data-dir', path.join(tmp, 'ud'),
      '--extensions-dir', path.join(tmp, 'ext'),
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      path.join(EXTENSION_PATH, '..', 'examples'),
    ],
    timeout: 180000,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
