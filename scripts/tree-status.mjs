#!/usr/bin/env node
// Print, for each file given on argv, whether its tree carries an error.
//
// `tree-sitter parse` does NOT reliably report this: a zero-width MISSING
// node for an *external* token is omitted from its text output and its exit
// code stays 0. An unterminated heredoc is exactly that case, which is how it
// looked "silently accepted" when it is in fact flagged. Ask the tree.
import { readFileSync } from 'node:fs';
import { Parser, Language } from 'web-tree-sitter';

await Parser.init();
const lang = await Language.load(new URL('../tree-sitter-frankie.wasm', import.meta.url));
const parser = new Parser();
parser.setLanguage(lang);

for (const path of process.argv.slice(2)) {
  const src = readFileSync(path, 'utf8');
  const tree = parser.parse(src);
  console.log(tree.rootNode.hasError ? 'ERR' : 'OK', path);
}
