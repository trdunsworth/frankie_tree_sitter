'use strict';

// Headless checks for the semantic token pipeline. These run without VS Code,
// so they exercise exactly the code the extension ships (src/tokens.js) and
// catch the class of bug the editor would otherwise surface as garbled
// highlighting: out-of-bounds ranges, wrong spans, unordered output, or
// token types the legend does not declare.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Parser, Language, Query } = require('web-tree-sitter');
const {
  TOKEN_MAP,
  TOKEN_TYPES,
  TOKEN_MODIFIERS,
  collectTokens,
  lineLengths,
} = require('../src/tokens');

const EXT = path.join(__dirname, '..');
const ROOT = path.join(EXT, '..');

let parser;
let query;

test.before(async () => {
  await Parser.init();
  const language = await Language.load(path.join(EXT, 'tree-sitter-frankie.wasm'));
  parser = new Parser();
  parser.setLanguage(language);
  query = new Query(
    language,
    fs.readFileSync(path.join(EXT, 'queries', 'highlights.scm'), 'utf8'),
  );
});

test('legend lists exactly the types and modifiers TOKEN_MAP uses', () => {
  const types = new Set();
  const mods = new Set();
  for (const [type, modifiers] of Object.values(TOKEN_MAP)) {
    types.add(type);
    for (const m of modifiers) mods.add(m);
  }
  assert.deepEqual([...types].sort(), [...TOKEN_TYPES]);
  assert.deepEqual([...mods].sort(), [...TOKEN_MODIFIERS]);
});

test('punctuation falls through to the TextMate grammar', () => {
  assert.equal(TOKEN_MAP['punctuation.bracket'], undefined);
  assert.equal(TOKEN_MAP['punctuation.delimiter'], undefined);
});

function assertValid(records, text) {
  const lines = lineLengths(text);
  const typeMask = (1 << TOKEN_MODIFIERS.length) - 1;

  let previous = { line: -1, startChar: -1 };
  for (const r of records) {
    assert.ok(Number.isInteger(r.line) && r.line >= 0 && r.line < lines.length,
      `line ${r.line} out of range`);
    assert.ok(r.startChar >= 0, `negative startChar ${r.startChar}`);
    assert.ok(r.length >= 1, `length ${r.length} must be >= 1`);
    assert.ok(r.startChar + r.length <= lines[r.line],
      `token [${r.line},${r.startChar}]+${r.length} exceeds line length ${lines[r.line]}`);
    assert.ok(TOKEN_TYPES.includes(r.type), `type ${r.type} not in legend`);
    assert.equal(r.typeIndex, TOKEN_TYPES.indexOf(r.type));
    assert.equal(r.modifierBits & ~typeMask, 0, 'modifier bit outside legend');
    assert.ok(r.line > previous.line
      || (r.line === previous.line && r.startChar >= previous.startChar),
    'records are not ordered by position');
    previous = r;
  }
}

test('every example yields ordered, in-bounds tokens', () => {
  const dir = path.join(ROOT, 'examples');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.fk'));
  assert.ok(files.length >= 40, `expected the example corpus, found ${files.length}`);

  let total = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const records = collectTokens(parser, query, text);
    assertValid(records, text);

    const tree = parser.parse(text);
    let mapped = 0;
    try {
      mapped = query.captures(tree.rootNode).filter((c) => TOKEN_MAP[c.name]).length;
    } finally {
      tree.delete();
    }
    // Every mapped capture yields at least one record; multi-line nodes yield
    // one per covered line, so this count can only grow.
    assert.ok(records.length >= mapped,
      `${file}: ${records.length} records for ${mapped} mapped captures`);
    if (text.trim()) assert.ok(records.length > 0, `${file}: no tokens emitted`);
    total += records.length;
  }
  assert.ok(total > 1000, `expected substantial coverage, got ${total} tokens`);
});

test('hello.fk matches its expected tokens exactly', () => {
  const text = fs.readFileSync(path.join(ROOT, 'examples', 'hello.fk'), 'utf8');
  const records = collectTokens(parser, query, text);
  const shape = records.map(
    ({ line, startChar, length, type, modifierBits }) =>
      [line, startChar, length, type, modifierBits],
  );
  assert.deepEqual(shape, [
    [0, 0, 49, 'comment', 0],
    [2, 0, 4, 'variable', 0],
    [2, 5, 1, 'operator', 0],
    [2, 7, 7, 'string', 0],
    [3, 0, 4, 'function', 2],
    [3, 5, 17, 'string', 0],
    [3, 15, 4, 'variable', 0],
    [4, 0, 4, 'function', 2],
    [4, 5, 67, 'string', 0],
  ]);
});

test('a node spanning lines is emitted once per line', () => {
  const text = 'x = <<~A\n  one\n  two\nA\n';
  const records = collectTokens(parser, query, text);
  const stringRows = records.filter((r) => r.type === 'string').map((r) => r.line);
  assert.deepEqual(stringRows, [0, 1, 2, 3],
    'heredoc (heredoc) @string should cover every line it spans');
  assertValid(records, text);
});

test('the heredoc interpolation fixture tokenizes cleanly', () => {
  const text = fs.readFileSync(
    path.join(ROOT, 'test', 'fixtures', 'heredoc_interpolation.fk'), 'utf8');
  const records = collectTokens(parser, query, text);
  assertValid(records, text);
  assert.ok(records.some((r) => r.type === 'string'), 'expected string tokens');
  assert.ok(records.some((r) => r.type === 'variable'), 'expected interpolation tokens');
});
