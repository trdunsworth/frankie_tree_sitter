'use strict';

// Capture names emitted by queries/highlights.scm, mapped onto VS Code's
// standard semantic token legend. This table is the whole contract between
// the grammar and the editor: anything missing here falls through to the
// TextMate grammar in syntaxes/fk.tmLanguage.json.
//
// `punctuation.bracket` and `punctuation.delimiter` are deliberately absent.
// They account for roughly 10 000 captures across the example corpus, and
// both VS Code and TextMate themes already colour punctuation well — emitting
// them as semantic tokens would only fight the fallback grammar for pixels.

const TOKEN_MAP = Object.freeze({
  variable: ['variable', []],
  'variable.parameter': ['parameter', []],
  property: ['property', []],
  function: ['function', []],
  'function.builtin': ['function', ['defaultLibrary']],
  type: ['type', []],
  keyword: ['keyword', []],
  'keyword.function': ['keyword', ['declaration']],
  boolean: ['variable', ['readonly', 'defaultLibrary']],
  constant: ['variable', ['readonly']],
  'constant.builtin': ['variable', ['readonly', 'defaultLibrary']],
  string: ['string', []],
  number: ['number', []],
  comment: ['comment', []],
  operator: ['operator', []],
});

const TOKEN_TYPES = Object.freeze(
  [...new Set(Object.values(TOKEN_MAP).map(([type]) => type))].sort(),
);

const TOKEN_MODIFIERS = Object.freeze(
  [...new Set(Object.values(TOKEN_MAP).flatMap(([, mods]) => mods))].sort(),
);

const typeIndex = (type) => TOKEN_TYPES.indexOf(type);

const modifierBits = (mods) =>
  mods.reduce((bits, mod) => bits | (1 << TOKEN_MODIFIERS.indexOf(mod)), 0);

// VS Code semantic tokens must be single line and at least one character
// wide, so a node that spans lines is emitted once per line it covers.
function recordsForNode(node, lines) {
  const start = node.startPosition;
  const end = node.endPosition;
  const out = [];
  const push = (row, startChar, length) => {
    const lineLength = lines[row];
    if (lineLength === undefined || startChar >= lineLength) return;
    out.push({
      line: row,
      startChar,
      length: Math.max(1, Math.min(length, lineLength - startChar)),
    });
  };

  if (start.row === end.row) {
    push(start.row, start.column, end.column - start.column);
    return out;
  }
  push(start.row, start.column, lines[start.row] - start.column);
  for (let row = start.row + 1; row < end.row; row++) push(row, 0, lines[row]);
  push(end.row, 0, end.column);
  return out;
}

// Flatten a document's text into per-line lengths, dropping the \r of CRLF
// so column arithmetic matches what VS Code reports.
function lineLengths(text) {
  return text.split('\n').map((line) => (line.endsWith('\r') ? line.length - 1 : line.length));
}

/**
 * Run the highlights query over `text` and return semantic token records
 * ordered the way `vscode.SemanticTokensBuilder` requires.
 *
 * @param {import('web-tree-sitter').Parser} parser
 * @param {import('web-tree-sitter').Query} query
 * @param {string} text
 */
function collectTokens(parser, query, text) {
  const lines = lineLengths(text);
  const tree = parser.parse(text);
  // The tree owns the nodes the captures point at, so it must outlive every
  // read of capture.node — freeing it first yields garbage spans.
  try {
    const records = [];
    for (const capture of query.captures(tree.rootNode)) {
      const mapped = TOKEN_MAP[capture.name];
      if (!mapped) continue;
      const [type, mods] = mapped;
      const typeIdx = typeIndex(type);
      const bits = modifierBits(mods);
      for (const rec of recordsForNode(capture.node, lines)) {
        records.push({ ...rec, type, typeIndex: typeIdx, modifierBits: bits });
      }
    }
    // The query walks the tree, not the file, so captures come back in parse
    // order rather than position order; VS Code requires the latter.
    records.sort(
      (a, b) => a.line - b.line || a.startChar - b.startChar || a.length - b.length,
    );
    return records;
  } finally {
    if (typeof tree.delete === 'function') tree.delete();
  }
}

module.exports = {
  TOKEN_MAP,
  TOKEN_TYPES,
  TOKEN_MODIFIERS,
  typeIndex,
  modifierBits,
  lineLengths,
  recordsForNode,
  collectTokens,
};
