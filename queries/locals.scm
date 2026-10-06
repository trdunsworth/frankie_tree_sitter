; ============================================================================
; Frankie (tree-sitter-frankie) — local scope / definition / reference queries
;
; Consumed by Neovim (nvim-treesitter-refactor, rules.nvim, ...) and other
; tools that resolve `@local.*` captures.
;
; Grammar has no fields: captures rely on child order and `.` adjacency
; anchors.  Layout mirrors highlights.scm — the broad reference pattern
; comes first, then the specific definition patterns, so a node carrying
; both resolves as a definition (later patterns win for the same node).
;
; ── tree-sitter 0.27.0 query-compiler hazards ─────────────────────────────
; All verified with scripts/check-query.sh; these bite at COMPILE time and
; are independent of the file being queried (an empty file is enough):
;
;   * Two chained `.` anchors between named siblings of the same type hang
;       (rescue_clause "rescue" . (identifier) . (identifier) @v)   HANGS
;       (rescue_clause "rescue" . (_) . (identifier) @v)            OK
;   * A `[ ... ]` alternation of anonymous tokens after a captured sibling
;     hangs for larger token sets:
;       (assignment (identifier) @v . ["=" "+=" "-=" ... x9])       HANGS
;     but is fine as a trailing continuation of a `(`-anchored capture.
;   * A pattern whose last step is an anchored named node can cost seconds
;     to compile — e.g. `(lambda "(" . (identifier) @v)` takes 2.9s.
;     Giving it a concrete or bracketed continuation cuts that to 0.1s.
;   * `(_)` as that continuation is worse still (>30s on `lambda`), so it
;     is only used where nothing else matches the grammar (rescue).
;
; Target: the whole file compiles in well under a second.
;
; Known limits
;   * `(assignment . (identifier) ...)` deliberately takes the FIRST child
;     rather than testing the operator, so the root of a field/index write
;     (`cache[key] = v`, `cfg.theme = dark`) is marked as a definition too.
;     That is benign — it is a variable the file already refers to — and it
;     is what keeps assignment down to one cheap pattern.  Testing the
;     operator instead costs 1.2s per pattern.
;   * Compound operators on destructuring targets (`a, b += 1`) are not
;     captured; only `,` and `=` are, because those two patterns are fast
;     and cover every form the examples use.
; ============================================================================

; ── Scopes ────────────────────────────────────────────────────────────────
[
  (source_file)
  (function_definition)
  (lambda)
  (do_block)
  (if_statement)
  (elsif_clause)
  (else_clause)
  (unless_statement)
  (while_statement)
  (until_statement)
  (for_statement)
  (loop_statement)
  (do_while_statement)
  (begin_statement)
  (rescue_clause)
  (ensure_clause)
  (case_statement)
  (when_clause)
] @local.scope

; ── References ────────────────────────────────────────────────────────────
; Usages such as `puts total` only surface through this pattern, so it has
; to be broad.  Declaration sites are re-claimed by the patterns below.
(identifier) @local.reference

; ── Definitions ───────────────────────────────────────────────────────────

; `def name(...) -> T`
(function_definition "def" . (identifier) @local.definition.function)

; Parameters.  The parameter list's `(` and its `,` separators are the only
; comma/paren children of the signature: the body is a `(statements)` child,
; so nothing from it can be confused with the parameter list.
(function_definition "(" . (identifier) @local.definition.parameter)
(function_definition "," . (identifier) @local.definition.parameter)

; Lambda parameters: `->(a, b = 1) { ... }`.  Each parameter is followed by
; `)` `,` or `=`, and making that the last step is what keeps the compiler
; fast (see hazards above).
(lambda "(" . (identifier) @local.definition.parameter . [")" "," "="])
(lambda "," . (identifier) @local.definition.parameter)

; Block parameters: `do |item, idx| ... end`.  The opening `|` is the only
; `|` directly after `do`; body `|` merge operators appear later.
(do_block "do" . "|" . (identifier) @local.definition.parameter)
(do_block "," . (identifier) @local.definition.parameter)

; `record Point(x, y)` — the type itself, plus each field.
(record_definition "record" . (identifier) @local.definition.type)
(record_definition "(" . (identifier) @local.definition.field)
(record_definition "," . (identifier) @local.definition.field)

; `const MAX = 3`
(const_statement "const" . (identifier) @local.definition.constant)

; `import io` / `import a.b as c`
(import_statement "import" . (identifier) @local.definition.import)
(import_statement "as" . (identifier) @local.definition.namespace)

; `for item in items` — the loop variable always sits directly before `in`,
; which keeps a `:label` (a symbol) from confusing the match.
(for_statement (identifier) @local.definition.var . "in")

; ── rescue bindings ───────────────────────────────────────────────────────
; `rescue e` | `rescue Type e` | `rescue Type => e` | `rescue => e`.
; The binding is lowercase and the error type is capitalised, so matching
; on case separates them; `=>` is unambiguous on its own.  The `Type e`
; form needs two siblings in a row, which the compiler will not take as two
; chained anchors — the wildcard stands in for the type.  The `=>` pattern is
; chained off `rescue` rather than off `=>` so that `rescue Type => e` is
; handled by the wildcard pattern alone and the binding is not captured
; twice.
;
; Residual: a rescue clause with a type but no binding whose body starts
; with a bare lowercase identifier (`rescue Foo` then `bar`) marks `bar`.
; Every form the examples use is covered exactly.
(rescue_clause "rescue" . "=>" . (identifier) @local.definition.var
  (#match? @local.definition.var "^[a-z_]"))
(rescue_clause "rescue" . (identifier) @local.definition.var
  (#match? @local.definition.var "^[a-z_]"))
(rescue_clause "rescue" . (identifier) @local.definition.type
  (#match? @local.definition.type "^[A-Z]"))
(rescue_clause "rescue" . (_) . (identifier) @local.definition.var
  (#match? @local.definition.var "^[a-z_]"))

; ── Assignment targets ────────────────────────────────────────────────────
; The target of `x = ...`, `x += ...`, `x.y = ...` is always the first
; child, whatever the operator.
(assignment . (identifier) @local.definition.var)

; Destructuring: `head, tail = ...`.  Every name is followed either by the
; next `,` or by `=` — the trailing value is followed by neither.
(destructuring_assignment (identifier) @local.definition.var . ",")
(destructuring_assignment (identifier) @local.definition.var . "=")

; `{a, b} = ...` — likewise: each name is followed by `,` or by `}`.
(hash_destructuring_assignment (identifier) @local.definition.var . ",")
(hash_destructuring_assignment (identifier) @local.definition.var . "}")
