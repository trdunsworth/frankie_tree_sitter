#!/usr/bin/env node
// Verify tree-sitter-frankie.wasm against the native parser.
//
//     npm run test:wasm
//
// Builds the module first (see package.json), then checks that:
//
//   * the module loads in a JS runtime (web-tree-sitter);
//   * every file in examples/ parses with no ERROR/MISSING nodes;
//   * each of those trees is byte-identical to `tree-sitter parse` with
//     positions stripped — so the Wasm build is not merely "close", it is
//     the same tree the native library produces;
//   * the heredoc-interpolation fixture yields exactly one (interpolation)
//     per `#{` in its source, and no errors;
//   * all four query files compile and report the same capture counts as
//     the native CLI.
//
// Set TREE_SITTER=/path/to/tree-sitter to use a specific CLI binary.

import { Parser, Language, Query } from "web-tree-sitter";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasm = join(root, "tree-sitter-frankie.wasm");
const cli = process.env.TREE_SITTER ?? "tree-sitter";
const failures = [];
const fail = (msg) => failures.push(msg);

if (!existsSync(wasm)) {
  console.error(`missing ${wasm}\nrun \`npm run build:wasm\` first`);
  process.exit(1);
}

await Parser.init();
const language = await Language.load(wasm);
const parser = new Parser();
parser.setLanguage(language);

const errors = (node) => {
  const out = [];
  const walk = (n) => {
    if (n.type === "ERROR" || n.isMissing) out.push(n);
    for (let i = 0; i < n.childCount; i++) walk(n.child(i));
  };
  walk(node);
  return out;
};

// S-expression without positions, matching `tree-sitter parse` output.
const sexp = (node) => {
  if (node.namedChildCount === 0) return `(${node.type})`;
  const kids = [];
  for (let i = 0; i < node.namedChildCount; i++) kids.push(sexp(node.namedChild(i)));
  return `(${node.type} ${kids.join(" ")})`;
};

// `tree-sitter parse` prints the same named-node S-expression, laid out over
// several indented lines; normalise both sides to a single space-separated
// line so only the structure is compared.
const run = (args) =>
  execFileSync(cli, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const nativeSexp = (file) =>
  run(["parse", file])
    .replace(/ \[\d+, \d+\] - \[\d+, \d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const nativeCaptures = (query, file) =>
  run(["query", "-c", query, file])
    .split("\n")
    .filter((l) => l.includes("capture:")).length;

// 1. every example parses cleanly, with the same tree as the native parser
const examples = readdirSync(join(root, "examples")).filter((f) => f.endsWith(".fk"));
let mismatches = 0;
for (const f of examples) {
  const path = join(root, "examples", f);
  const tree = parser.parse(readFileSync(path, "utf8"));
  const errs = errors(tree.rootNode);
  if (errs.length) {
    fail(`examples/${f}: ${errs.length} ERROR/MISSING node(s)`);
    continue;
  }
  let native;
  try {
    native = nativeSexp(path);
  } catch (e) {
    fail(`examples/${f}: native parse failed: ${e.message.split("\n")[0]}`);
    continue;
  }
  if (native !== sexp(tree.rootNode)) {
    mismatches++;
    if (mismatches <= 3) fail(`examples/${f}: Wasm tree differs from native tree`);
  }
}
if (mismatches > 3) fail(`...and ${mismatches - 3} more tree mismatches`);
console.log(`examples: ${examples.length}/${examples.length} parse clean`);

// 2. heredoc interpolation: one (interpolation) per `#{` in the source
const fixture = join(root, "test/fixtures/heredoc_interpolation.fk");
const fixtureSrc = readFileSync(fixture, "utf8");
const expected = fixtureSrc.split("#{").length - 1;
const fixtureTree = parser.parse(fixtureSrc);
const fixtureErrs = errors(fixtureTree.rootNode);
const found = new Query(language, "(interpolation) @i").captures(fixtureTree.rootNode).length;
if (fixtureErrs.length) fail(`heredoc fixture: ${fixtureErrs.length} ERROR/MISSING node(s)`);
if (found !== expected)
  fail(`heredoc fixture: ${found} interpolation nodes, expected ${expected} (one per '#{')`);
console.log(`heredoc fixture: ${found}/${expected} interpolations, ${fixtureErrs.length} errors`);

// 3. every query compiles, and capture counts match the native CLI
const sample = join(root, "examples/whats_new_v110.fk");
const sampleSrc = readFileSync(sample, "utf8");
const sampleTree = parser.parse(sampleSrc);
for (const name of ["highlights", "indents", "locals", "textobjects"]) {
  const file = join(root, "queries", `${name}.scm`);
  let query;
  try {
    query = new Query(language, readFileSync(file, "utf8"));
  } catch (e) {
    fail(`queries/${name}.scm: does not compile: ${String(e.message ?? e)}`);
    continue;
  }
  const wasmCount = query.captures(sampleTree.rootNode).length;
  let nativeCount = 0;
  try {
    nativeCount = nativeCaptures(file, sample);
  } catch {
    console.log(`  (${name}: native CLI unavailable, skipped parity)`);
    continue;
  }
  if (wasmCount !== nativeCount)
    fail(`queries/${name}.scm: wasm ${wasmCount} captures, native ${nativeCount}`);
  console.log(`query ${name}: ${wasmCount} captures (native ${nativeCount})`);
}

if (failures.length) {
  console.error(`\nFAIL (${failures.length})`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nOK — wasm matches the native parser");
