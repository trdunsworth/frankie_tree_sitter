# Changelog

All notable changes to `tree-sitter-frankie` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org).

## [0.1.0] — 2026-10-17

First shareable release: grammar, queries, editor packaging and a
differential CI harness that keeps the grammar honest against the Frankie
reference compiler.

### Grammar

- Grammar for Frankie v1.22 (at reference tag `v1.22.3`): statements,
  control flow (including `do ... while`), begin/rescue/ensure, case/when,
  records, contextual declarations (`error Foo`, `enum Status(...)`),
  heredocs with interpolations, dotted calls, keyword-command calls
  (`puts x`, `p x`), multi-line `def` parameter lists, lambda `->` forms,
  vectors and hashes.
- Empty function bodies parse as such (`def f\nend`) while the visible
  `(statements)` node stays non-empty.
- `end`/`else`/`elsif`/`when`/`rescue`/`ensure`/`then` are reserved.
- Heredoc inline in call arguments (the bracket is absorbed into the
  heredoc node the way the reference lexer reorders its tokens). Unsupported
  edge (documented): multi-argument calls with two heredocs, heredoc inside
  double parentheses.

### Differential harness (CI)

- `scripts/oracle/run.py` runs the grammar and the upstream reference
  compiler (cloned at runtime, pinned to `v1.22.3`) over 285 fixtures; every
  disagreement must be a documented allowlist entry or CI fails.
- Error reporting is tree-based (`scripts/tree-status.mjs`, web-tree-sitter
  `hasError`/`isMissing`): `tree-sitter parse` prints zero-width MISSING
  nodes for external tokens and exits 0, so it cannot be trusted as a gate.

### Queries

- `highlights.scm`: first bare parameter/field/lambda captures,
  `rescue Foo => e` operator, contextual `error`/`enum` declarations and
  `test`/`benchmark`/`breakpoint` builtins via text predicates (they are
  identifiers upstream, not keywords).
- `indents.scm`: do-while opens on `do` and closes on its `while` line;
  multi-line bracket continuation indent.
- `locals.scm`: string-form `import "lib/math"` definitions.
- `folds.scm`: block constructs and multi-line vector/hash folding.

### Editor packaging

- VS Code extension (`vscode/`): semantic highlighting driven by the wasm
  build of this grammar with a TextMate fallback grammar.
- Semantic tokens are resolved to disjoint spans by query priority (later
  capture wins its range, earlier captures split around it) — previously
  ~3 500 duplicate and ~1 450 overlapping tokens across the example corpus.
- `go.sum` generated so `go test ./bindings/go/` works on a fresh checkout.
- Headless extension tests (`vscode/test/`) run in CI as a separate job.
- Single-job CI (`checks`) covers generate-sync, corpus, wasm parity,
  examples, queries and the differential oracle; first run fully green.

### Known limitations

- `test`-suite baseline, tags and benchmark execution are stdlib-only
  concerns upstream — the grammar accepts their call syntax only.
- `tree-sitter highlight` CLI needs `queries/` registered in
  `tree-sitter.json`; folding queries ride editor-side.
