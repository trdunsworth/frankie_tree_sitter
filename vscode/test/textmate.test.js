'use strict';

// Exercises syntaxes/fk.tmLanguage.json through the same tokenizer VS Code
// uses (vscode-textmate + oniguruma), so the fallback grammar is verified
// rather than merely shipped. The important case is the heredoc: TextMate
// tokenizes line by line, and only a backreference in the `end` pattern can
// tell `  text #{x} MSG` (body) from a line that is just `MSG` (closer).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const GRAMMAR = path.join(__dirname, '..', 'syntaxes', 'fk.tmLanguage.json');

let registry;
let grammar;

test.before(async () => {
  const wasmPath = require.resolve('vscode-oniguruma/release/onig.wasm');
  await oniguruma.loadWASM(fs.readFileSync(wasmPath).buffer);

  registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (str) => new oniguruma.OnigString(str),
    }),
    loadGrammar: (scopeName) =>
      scopeName === 'source.frankie'
        ? vsctm.parseRawGrammar(fs.readFileSync(GRAMMAR, 'utf8'), GRAMMAR)
        : null,
  });
  grammar = await registry.loadGrammar('source.frankie');
  assert.ok(grammar, 'grammar failed to load');
});

function tokenize(text) {
  const lines = text.split('\n');
  let stack = vsctm.INITIAL;
  return lines.map((line) => {
    const result = grammar.tokenizeLine(line, stack);
    stack = result.ruleStack;
    return {
      line,
      tokens: result.tokens.map((t) => ({
        text: line.slice(t.startIndex, t.endIndex),
        scopes: t.scopes,
      })),
    };
  });
}

test('comments, numbers, keywords and calls get their scopes', () => {
  const [comment, assign, call] = tokenize('# a note\nx = 1\nputs "hi"');
  assert.ok(comment.tokens[0].scopes.includes('comment.line.number-sign.frankie'));
  assert.ok(assign.tokens.some((t) => t.scopes.includes('constant.numeric.frankie')));
  assert.ok(assign.tokens.some((t) => t.scopes.includes('keyword.operator.frankie')));
  assert.ok(call.tokens.some((t) => t.scopes.includes('support.function.builtin.frankie')));
  assert.ok(call.tokens.some((t) => t.scopes.includes('string.quoted.double.frankie')));
});

test('string interpolation nests inside the string', () => {
  const [line] = tokenize('puts "Hello, #{name}!"');
  const open = line.tokens.find((t) => t.text === '#{');
  assert.ok(open, 'expected an interpolation opener');
  assert.ok(open.scopes.includes('punctuation.section.interpolation.begin.frankie'));
  const inner = line.tokens.find((t) => t.text === 'name');
  assert.ok(inner.scopes.includes('variable.other.frankie'),
    `name should be an identifier inside interpolation, got ${JSON.stringify(inner)}`);
});

test('def, types and symbols are recognized', () => {
  const [line] = tokenize('def area(r: Float): Float');
  assert.ok(line.tokens.some((t) => t.scopes.includes('keyword.other.frankie')));
  assert.ok(line.tokens.some((t) => t.scopes.includes('entity.name.type.frankie')));
  const [symbol] = tokenize(':done');
  assert.ok(symbol.tokens.some((t) => t.scopes.includes('constant.other.symbol.frankie')));
});

test('a heredoc body is not closed by a delimiter that is not alone on its line', () => {
  const lines = tokenize([
    'x = <<~MSG',
    '  text #{x} MSG',
    'MSG',
    'y = 1',
  ].join('\n'));

  // Line 2 ends with MSG but is body text: still inside the heredoc, and the
  // trailing MSG must not be scored as the closer. It may be grouped with the
  // space in front of it, so match on trimmed text.
  const bodyTokens = lines[1].tokens;
  const trailingMsg = bodyTokens.find((t) => t.text.trim() === 'MSG');
  assert.ok(trailingMsg, `expected the trailing MSG token, got ${
    JSON.stringify(bodyTokens.map((t) => t.text))}`);
  assert.ok(trailingMsg.scopes.includes('string.unquoted.heredoc.frankie'),
    `body line should stay inside the heredoc, got ${JSON.stringify(trailingMsg.scopes)}`);
  assert.ok(!trailingMsg.scopes.includes('punctuation.definition.string.end.frankie'),
    'MSG inside a body line must not be treated as the closer');

  // Line 3 is the real closer.
  const closer = lines[2].tokens.find((t) => t.text.trim() === 'MSG');
  assert.ok(closer.scopes.includes('punctuation.definition.string.end.frankie'),
    `expected the closer to be recognised, got ${JSON.stringify(closer.scopes)}`);

  // Line 4 is back to normal code.
  const after = lines[3].tokens;
  assert.ok(!after.some((t) => t.scopes.includes('string.unquoted.heredoc.frankie')),
    'heredoc scope must not leak past the closer');
});

test('an interpolation inside a heredoc keeps the body scoped', () => {
  const lines = tokenize('s = <<~A\n  value #{x} here\nA\n');
  const inner = lines[1].tokens.find((t) => t.text === 'x');
  assert.ok(inner, 'expected the interpolated identifier');
  assert.ok(inner.scopes.includes('variable.other.frankie'));
  assert.ok(inner.scopes.includes('string.unquoted.heredoc.frankie'),
    'interpolation is nested inside the heredoc scope');
});
