'use strict';

// Exercises src/extension.js — the part headless tests cannot reach — by
// running its real activation path against a minimal stand-in for the VS Code
// API. This is what catches wrong builder/legend usage, bad asset paths, a
// provider registered with the wrong shape, or an exception during activate.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const EXT = path.join(__dirname, '..');
const SENTINEL = path.join(__dirname, '__mock_vscode__.js');

let registered;
let warnings = [];
let configValue = true;

class SemanticTokensLegend {
  constructor(tokenTypes, tokenModifiers) {
    this.tokenTypes = tokenTypes;
    this.tokenModifiers = tokenModifiers;
  }
}

class SemanticTokensBuilder {
  constructor(legend) {
    this.legend = legend;
    this.data = [];
  }
  push(line, char, length, tokenType, tokenModifiers) {
    assert.ok(this.legend, 'builder pushed to without a legend');
    assert.ok(tokenType >= 0 && tokenType < this.legend.tokenTypes.length,
      `tokenType ${tokenType} outside legend`);
    this.data.push(line, char, length, tokenType, tokenModifiers);
  }
  build() {
    return { data: Uint32Array.from(this.data) };
  }
}

const mockVscode = {
  SemanticTokensLegend,
  SemanticTokensBuilder,
  languages: {
    registerDocumentSemanticTokensProvider(selector, provider, legend) {
      registered = { selector, provider, legend };
      return { dispose() { registered = undefined; } };
    },
  },
  window: {
    createOutputChannel() {
      return { appendLine() {}, clear() {}, dispose() {} };
    },
    showWarningMessage(message) {
      warnings.push(message);
      return Promise.resolve(undefined);
    },
  },
  workspace: {
    getConfiguration() {
      return { get: (key, fallback) => (key === 'semanticHighlighting' ? configValue : fallback) };
    },
  },
};

// Redirect require('vscode') to an in-memory module before loading the code
// under test; VS Code injects that module itself and it is not installed here.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return SENTINEL;
  return originalResolve.call(this, request, ...rest);
};
require.cache[SENTINEL] = {
  id: SENTINEL,
  filename: SENTINEL,
  loaded: true,
  exports: mockVscode,
};

const extension = require('../src/extension');

function context() {
  return { subscriptions: [], asAbsolutePath: (p) => path.join(EXT, p) };
}

function document(text) {
  return { uri: { fsPath: '/tmp/sample.fk' }, getText: () => text };
}

test.before(async () => {
  assert.ok(fs.existsSync(path.join(EXT, 'tree-sitter-frankie.wasm')),
    'missing tree-sitter-frankie.wasm — run `npm run assets`');
  await extension.activate(context());
  assert.ok(registered, 'extension did not register a semantic token provider');
  assert.equal(registered.selector.language, 'frankie');
  assert.ok(Array.isArray(registered.legend.tokenTypes));
  assert.ok(Array.isArray(registered.legend.tokenModifiers));
});

test('provider returns well-formed VS Code token data', () => {
  const text = '# hi\nname = "World"\nputs "Hello, #{name}!"\n';
  const result = registered.provider.provideDocumentSemanticTokens(document(text));
  assert.ok(result, 'provider returned nothing');
  const { data } = result;
  assert.ok(data instanceof Uint32Array, 'expected a Uint32Array');
  assert.equal(data.length % 5, 0, 'tokens are 5 uint32s each');

  const lines = text.split('\n');
  const legend = registered.legend;
  for (let i = 0; i < data.length; i += 5) {
    const [line, char, length, type, mods] = data.slice(i, i + 5);
    assert.ok(line >= 0 && line < lines.length, `line ${line} out of range`);
    assert.ok(char >= 0 && length >= 1, `bad range ${char}+${length}`);
    assert.ok(char + length <= lines[line].length, 'token exceeds its line');
    assert.ok(type < legend.tokenTypes.length, 'type outside legend');
    const mask = (1 << legend.tokenModifiers.length) - 1;
    assert.equal(mods & ~mask, 0, 'modifier bit outside legend');
  }
  assert.ok(data.length > 0, 'expected at least one token');
});

test('disabling the setting falls back to TextMate', () => {
  configValue = false;
  try {
    assert.equal(
      registered.provider.provideDocumentSemanticTokens(document('x = 1\n')),
      null,
      'expected null so the TextMate grammar alone colours the file',
    );
  } finally {
    configValue = true;
  }
});

test('a document that fails to tokenize does not throw', () => {
  // getText() throwing stands in for any runtime failure inside the provider.
  const broken = { uri: { fsPath: '/tmp/broken.fk' }, getText() { throw new Error('boom'); } };
  assert.equal(registered.provider.provideDocumentSemanticTokens(broken), null);
});

test('assets referenced by the extension exist where it looks for them', () => {
  const wasm = path.join(EXT, 'tree-sitter-frankie.wasm');
  const highlights = path.join(EXT, 'queries', 'highlights.scm');
  assert.ok(fs.existsSync(wasm), `${wasm} missing`);
  assert.ok(fs.existsSync(highlights), `${highlights} missing`);
});
