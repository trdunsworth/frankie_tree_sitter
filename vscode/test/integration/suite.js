'use strict';

// Runs INSIDE VSCodium, launched by test/integration/run.js. This is the only
// test that touches a real editor: it opens a .fk file, activates the
// extension, and asks VS Code's own semantic token pipeline for the result.
//
// The tokens it expects are the same HELLO_FK_TOKENS golden the headless test
// checks against the parser directly, so this ties the two together — if the
// provider is registered but silently wrong, if the legend rejects the types we
// emit, or if VS Code's token pipeline drops or reorders records, they stop
// agreeing.

const assert = require('node:assert');
const path = require('node:path');
const vscode = require('vscode');
const { HELLO_FK_TOKENS } = require('../golden');

const EXTENSION_ID = 'trdunsworth.frankie';
const TOKENS_PER_RECORD = 5;

// VS Code exposes no vscode.executeDocumentSemanticTokensProvider (the request
// was closed as a duplicate); the built-ins are vscode.provideDocumentSemanticTokens*
// plus the internal underscore-prefixed handles. Not every build registers both,
// so probe and use whichever is present.
const TOKEN_COMMANDS = [
  'vscode.provideDocumentSemanticTokens',
  '_provideDocumentSemanticTokens',
];
const LEGEND_COMMANDS = [
  'vscode.provideDocumentSemanticTokensLegend',
  '_provideDocumentSemanticTokensLegend',
];

/**
 * Decode what the built-in command hands back: a VSBuffer wrapping the
 * little-endian SemanticTokens DTO — [id, type, dataLength, ...data] — where
 * each record is [deltaLine, deltaChar, length, typeIndex, modifierBits].
 * Returns records in absolute [line, startChar, length, typeName, mods] form.
 */
function decodeTokens(result, legend) {
  assert.ok(result && result.buffer, `expected a semantic tokens buffer, got ${
    result === null ? 'null' : Object.keys(result || {}).join(',')}`);
  const bytes = new Uint8Array(result.buffer);
  assert.strictEqual(bytes.byteLength % 4, 0,
    `token buffer length ${bytes.byteLength} is not a whole number of uint32s`);
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);

  assert.ok(words.length >= 3, `token DTO too short: ${words.length} words`);
  const type = words[1];
  const dataLength = words[2];
  assert.strictEqual(type, 1, `expected a full tokens DTO (type 1), got ${type}`);
  assert.strictEqual(words.length, 3 + dataLength,
    `token DTO declares ${dataLength} data words but carried ${words.length - 3}`);
  const data = words.subarray(3, 3 + dataLength);

  const records = [];
  let line = 0;
  let startChar = 0;
  for (let i = 0; i + TOKENS_PER_RECORD <= data.length; i += TOKENS_PER_RECORD) {
    const deltaLine = data[i];
    const deltaChar = data[i + 1];
    const length = data[i + 2];
    const typeIndex = data[i + 3];
    const modifierBits = data[i + 4];

    line += deltaLine;
    if (deltaLine === 0) {
      startChar += deltaChar;
    } else {
      startChar = deltaChar;
    }
    assert.ok(typeIndex < legend.tokenTypes.length,
      `token type index ${typeIndex} is not in the legend`);
    records.push([line, startChar, length, legend.tokenTypes[typeIndex], modifierBits]);
  }
  return records;
}

async function run() {
  const repoRoot = path.join(__dirname, '..', '..', '..');
  const file = path.join(repoRoot, 'examples', 'hello.fk');
  const uri = vscode.Uri.file(file);

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  assert.strictEqual(document.languageId, 'frankie',
    `.fk should open as language "frankie", got "${document.languageId}"`);

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `extension ${EXTENSION_ID} is not installed`);
  await extension.activate();
  assert.ok(extension.isActive, 'extension did not activate');

  const commands = await vscode.commands.getCommands();
  const legendCommand = LEGEND_COMMANDS.find((c) => commands.includes(c));
  const tokenCommand = TOKEN_COMMANDS.find((c) => commands.includes(c));
  assert.ok(legendCommand, `no semantic tokens legend command; saw ${
    commands.filter((c) => /semantic/i.test(c)).join(', ') || 'nothing'}`);
  assert.ok(tokenCommand, `no semantic tokens command; saw ${
    commands.filter((c) => /semantic/i.test(c)).join(', ') || 'nothing'}`);
  console.log(`using ${legendCommand} / ${tokenCommand}`);

  // A non-null legend proves VS Code found and selected our provider for this
  // document, before we ever ask for tokens.
  const legend = await vscode.commands.executeCommand(legendCommand, uri);
  assert.ok(legend && Array.isArray(legend.tokenTypes) && legend.tokenTypes.length > 0,
    'VS Code did not return a legend for a .fk document');
  console.log(`legend: ${legend.tokenTypes.join(',')} / ${
    legend.tokenModifiers.join(',')}`);

  const records = decodeTokens(
    await vscode.commands.executeCommand(tokenCommand, uri), legend);

  assert.strictEqual(records.length, HELLO_FK_TOKENS.length,
    `expected ${HELLO_FK_TOKENS.length} tokens, got ${records.length}`);
  assert.deepStrictEqual(records, HELLO_FK_TOKENS,
    'VSCodium\'s semantic tokens disagree with the headless golden');

  // Independent sanity check against the document text itself.
  const lines = document.getText().split('\n');
  for (const [line, startChar, length] of records) {
    assert.ok(line >= 0 && line < lines.length, `token line ${line} out of range`);
    assert.ok(length >= 1, `token length ${length} must be >= 1`);
    assert.ok(startChar + length <= lines[line].length,
      `token [${line},${startChar}]+${length} exceeds line length ${lines[line].length}`);
  }

  // Turning the setting off must hand the file back to the TextMate grammar.
  const config = vscode.workspace.getConfiguration('frankie');
  const original = config.get('semanticHighlighting');
  await config.update('semanticHighlighting', false, vscode.ConfigurationTarget.Global);
  try {
    const off = await vscode.commands.executeCommand(tokenCommand, uri);
    assert.ok(!off || !off.buffer || off.buffer.byteLength === 0,
      'provider should yield nothing when semanticHighlighting is off');
  } finally {
    await config.update('semanticHighlighting', original, vscode.ConfigurationTarget.Global);
  }

  console.log(`OK: ${records.length} semantic tokens in ${path.basename(file)}, ` +
    'language id, legend and settings verified');
}

module.exports = { run };
