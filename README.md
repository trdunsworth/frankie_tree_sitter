# tree-sitter-frankie

[tree-sitter](https://tree-sitter.github.io) grammar for the
[Frankie programming language](https://atejada.github.io/frankielanguage/site/)
(`.fk` files).

Frankie is a procedural, dynamically-typed language "stitched together from
Ruby, Python, R, and Fortran." This repository provides the parser core used
for syntax highlighting, indentation, folding, and structural editing across
editors.

## Status

The grammar targets Frankie v1.22 syntax.

- P0 scaffold: complete (config, tests wiring, corpus)
- P1 grammar: **complete** — all 46 files in `examples/` (harvested from
  upstream `atejada/Frankie`) parse with zero `ERROR`/`MISSING` nodes, and
  the 28 unit tests in `test/corpus/` pass
- P2 queries: **complete** — `queries/highlights.scm` and
  `queries/indents.scm`
- P3 editor integration: query files are drop-in ready; see below
- P4 structural queries: **complete** — `queries/locals.scm` (scopes,
  definitions, references) and `queries/textobjects.scm` (Neovim + Helix
  text objects)

## Development

```sh
npm install
tree-sitter generate     # regenerate src/parser.c from grammar.js
tree-sitter test         # run test/corpus unit tests
tree-sitter test -u      # regenerate expected trees after a grammar change
npm run test:examples    # parse examples/*.fk, fail on any ERROR node
tree-sitter parse examples/hello.fk
tree-sitter highlight --html file.fk   # render highlighting (needs queries/ registered in tree-sitter.json)
tree-sitter playground   # interactive playground (builds wasm)
```

A custom scanner (`src/scanner.c`) handles constructs that cannot be
expressed with context-free rules alone:

- interpolated strings (`"#{expr}"`, single/triple-quoted variants)
- heredocs (`<<~DELIM ... DELIM`); heredoc bodies are opaque line tokens

The grammar declares GLR conflicts for the statement-level ambiguities
(destructuring vs. comma lists, command vs. paren call, postfix control).

## Queries

| File | Purpose |
|---|---|
| `queries/highlights.scm` | syntax highlighting (Neovim, Helix, Zed, kak-tree-sitter, …) |
| `queries/indents.scm` | auto-indentation (Neovim, Helix) |
| `queries/locals.scm` | scopes, definitions and references — rename, "highlight usages" (Neovim) |
| `queries/textobjects.scm` | text objects: function/class/loop/block/call/parameter/comment … (Neovim, Helix) |

`textobjects.scm` carries both `@function.outer`/`@function.around` style
captures on the same node, so one file serves Neovim and Helix. Body
selections (`@function.inner`, `@loop.inner`, `@conditional.inner`,
`@block.inner`) work because every construct body is a `(statements)`
child; `@class.inner`, `@call.inner` and full-span `@parameter.outer` are
deliberately absent — see "Known limitations".

### Query-author notes (tree-sitter 0.27.0)

The query compiler has two failure modes worth knowing about; both are
reproducible with `scripts/check-query.sh`, which compiles a query with a
timeout and fails on a hang:

```sh
scripts/check-query.sh queries/locals.scm            # all examples
scripts/check-query.sh queries/locals.scm file.fk    # one file
QUERY_TIMEOUT=8 scripts/check-query.sh q.scm /dev/null
```

- **Hangs at compile time** (even against an empty file):
  - two chained `.` anchors between named siblings of the same type —
    `(rescue_clause "rescue" . (identifier) . (identifier) @v)` hangs,
    `(rescue_clause "rescue" . (_) . (identifier) @v)` does not;
  - a `[ ... ]` alternation of anonymous tokens following a captured
    sibling — `(assignment (identifier) @v . ["=" "+=" … x9])` hangs.
- **Slow at compile time**, by parent and pattern shape rather than by
  match volume: `(lambda "(" . (identifier) @v)` takes 2.9s on its own.
  Giving the pattern a concrete or bracketed continuation
  (`… @v . [")" "," "="]`) cuts that to 0.1s.

These are compile costs, so they are identical for an empty file and a
large one — which is why a query can be correct and still freeze an editor
on open.


## Known limitations

- Interpolation inside heredoc bodies is not tokenized (bodies are opaque)
- Brace blocks with parameters (`.each { |x| ... }`) are not in the grammar;
  use the `do … end` form (the upstream examples only use `do`)
- Identifier-argument postfix chains in keyword commands attach outside the
  command node (`puts a.b` → `(call puts a)` + `(dot_call b)`); tokens and
  highlight captures are unaffected
- `!` is not an operator (use `not`), matching the reference lexer
- ASCII-only identifiers
- **No text object that spans more than one node.** Everything selecting a
  single node is exact; the rest is left out rather than faked with ranges
  or offsets, so no editor selects a wrong region:

  | Missing | Why |
  |---|---|
  | `@class.inner` | `record Point(x, y)` has no body, only a field list |
  | `@call.inner` | `f(a, b)` has no node spanning just the arguments |
  | `@assignment.lhs`/`@rhs` | `x = a ? b : c` is a run of sibling nodes (`x`, `=`, `a`, `?`, `b`, `:`, `c`), so `@rhs` would select only `a` |
  | `@comment.inner` | needs a range directive; `#make-range!`/`#offset!` are Neovim-only and can fail query load in Helix |
  | full-span `@parameter.outer` | `v: Int = 0` has no node covering the whole parameter, so `@parameter.*` captures the name only |

- Block bodies are a visible `(statements)` node rather than being flattened
  into their construct. This is what makes `@function.inner` and friends
  work, and it keeps body expressions from being misread as part of a
  signature.

## Ground truth

The language reference used while building the grammar:

- Upstream docs: <https://atejada.github.io/frankielanguage/site/>
- `SPEC.md` (informal EBNF) and `compiler/lexer.py` / `compiler/parser.py`
  in [`atejada/Frankie`](https://github.com/atejada/Frankie)
- `examples/*.fk` copied here as the parse corpus

## Editor integration

The grammar builds a C parser (`tree-sitter build`) and ships the four
query files in `queries/`: `highlights.scm`, `indents.scm`, `locals.scm`
and `textobjects.scm`.

### Neovim (0.10+)

```lua
-- with nvim-treesitter (master branch): add to parser config, or
require("nvim-treesitter.parsers").frankie = {
  install_info = {
    url = "https://github.com/trdunsworth/frankie_tree_sitter",
    files = { "src/parser.c" },
    branch = "main",
  },
  filetypes = { "fk" },
}
-- queries: symlink this repo's queries/* into
--   ~/.config/nvim/queries/frankie/
--   locals.scm is used by nvim-treesitter-refactor / rules.nvim
--   textobjects.scm by nvim-treesitter-textobjects
```

### Helix

Add to `languages.toml`:

```toml
[language-server.frankie]

[[grammar]]
name = "frankie"
source = { path = "/path/to/tree-sitter-frankie" }

[[language]]
name = "fk"
scope = "source.frankie"
file-types = ["fk"]
roots = ["frankie.toml"]
comment-token = "#"
indent = { tab-width = 2, unit = "  " }
grammar = "frankie"
```

Copy `queries/highlights.scm`, `queries/indents.scm` and
`queries/textobjects.scm` to
`~/.config/helix/runtime/queries/frankie/`. (`locals.scm` is a Neovim
convention; Helix does not read it.)

### Zed

Create an extension directory with `extension.toml`:

```toml
id = "frankie"
name = "Frankie"
version = "0.1.0"
schema_version = 1

[grammars.frankie]
language = "Frankie"
source = { git = "https://github.com/trdunsworth/frankie_tree_sitter", ref = "main" }

[language_servers.frankie]
name = "Frankie"
languages = ["Frankie"]
```

plus `languages/frankie/config.json` (`"parser": "frankie"`,
`"grammars": ["frankie"]`, filetypes) and a copy of `queries/highlights.scm`.

### Emacs (29+, treesit)

```elisp
;; after building the grammar library (tree-sitter build):
(add-to-list 'treesit-extra-load-path "/path/to/tree-sitter-frankie")
;; with the grammar installed as libtree-sitter-frankie.(so|dylib):
(define-derived-mode frankie-ts-mode prog-mode "Frankie"
  :mode "\\.fk\\'"
  (when (treesit-ready-p 'frankie)
    (treesit-major-mode-setup)))
```

Highlight queries load from `queries/highlights.scm` next to the grammar
source when `treesit-language-source-alist` points at this repo.

### VS Code / Electron

Two options:

1. **TextMate grammar** (simplest): convert or hand-write a
   `fk.tmLanguage.json` for the built-in tokenizer — no tree-sitter needed.
2. **tree-sitter WASM** (full fidelity): install emscripten, then

   ```sh
   tree-sitter build --wasm   # produces tree-sitter-frankie.wasm
   ```

   and load it with a tree-sitter WASM host extension (e.g.
   `tree-sitter-vscode`-style hosts), pointing `queries/highlights.scm` as
   the highlight query.

### Kakoune

Use [`kak-tree-sitter`](https://github.com/kak-us/kak-tree-sitter) with this
grammar and the same `highlights.scm`, or fall back to Kakoune's built-in
`regexp` highlighter for `.fk` files.

## License

MIT
