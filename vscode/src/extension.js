'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { Parser, Language, Query } = require('web-tree-sitter');
const { TOKEN_TYPES, TOKEN_MODIFIERS, collectTokens } = require('./tokens');

const LANGUAGE_SELECTOR = { language: 'frankie' };
const LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);

let parser;
let query;

function assets() {
  return {
    wasm: path.join(__dirname, '..', 'tree-sitter-frankie.wasm'),
    highlights: path.join(__dirname, '..', 'queries', 'highlights.scm'),
  };
}

/**
 * Load the bundled grammar. Returns null (leaving the TextMate grammar as the
 * only source of highlighting) rather than throwing, so a missing or stale
 * .wasm degrades instead of disabling highlighting entirely.
 */
async function loadGrammar(output) {
  const { wasm, highlights } = assets();
  for (const file of [wasm, highlights]) {
    if (!fs.existsSync(file)) {
      output.appendLine(`missing asset: ${file} — run \`npm run assets\` in vscode/`);
      return null;
    }
  }
  await Parser.init();
  const language = await Language.load(wasm);
  const p = new Parser();
  p.setLanguage(language);
  const q = new Query(language, fs.readFileSync(highlights, 'utf8'));
  output.appendLine(`loaded ${path.basename(wasm)} and queries/highlights.scm`);
  return { parser: p, query: q };
}

function makeProvider(output) {
  return {
    provideDocumentSemanticTokens(document) {
      try {
        if (!vscode.workspace.getConfiguration('frankie', document.uri)
          .get('semanticHighlighting', true)) {
          return null;
        }
        const records = collectTokens(parser, query, document.getText());
        const builder = new vscode.SemanticTokensBuilder(LEGEND);
        for (const r of records) {
          builder.push(r.line, r.startChar, r.length, r.typeIndex, r.modifierBits);
        }
        return builder.build();
      } catch (err) {
        output.appendLine(`highlight failed for ${document.uri.fsPath}: ${err}`);
        return null;
      }
    },
  };
}

async function activate(context) {
  const output = vscode.window.createOutputChannel('Frankie');
  context.subscriptions.push(output);

  try {
    const loaded = await loadGrammar(output);
    if (!loaded) {
      vscode.window.showWarningMessage(
        'Frankie: the bundled tree-sitter grammar could not be loaded — ' +
        'falling back to the TextMate grammar. See the Frankie output channel.',
      );
      return;
    }
    ({ parser, query } = loaded);
  } catch (err) {
    output.appendLine(`failed to initialise tree-sitter: ${err}`);
    vscode.window.showWarningMessage(
      `Frankie: could not start tree-sitter (${err.message}). ` +
      'Falling back to the TextMate grammar.',
    );
    return;
  }

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      LANGUAGE_SELECTOR,
      makeProvider(output),
      LEGEND,
    ),
  );
}

function deactivate() {
  parser = undefined;
  query = undefined;
}

module.exports = { activate, deactivate };
