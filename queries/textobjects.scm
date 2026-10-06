; ============================================================================
; Frankie (tree-sitter-frankie) — text-object queries
;
; Serves two conventions at once by carrying both capture names on the same
; node, so one file covers Neovim and Helix:
;
;     Neovim (nvim-treesitter-textobjects)   Helix
;       @function.outer  @function.inner      function.around  function.inside
;       @class.outer     @class.inner         class.around     class.inside
;       @parameter.outer @parameter.inner     parameter.around parameter.inside
;       @comment.outer   @comment.inner       comment.around   comment.inside
;       @block.outer     @block.inner
;       @conditional.outer/.inner
;       @loop.outer/.inner
;       @call.outer/.inner
;       @statement.outer
;       @assignment.outer
;       @return.outer
;
; ── `.inner` / `.inside` ───────────────────────────────────────────────────
; These capture the body of a construct.  They work because `statements` is
; a visible node: the grammar used to hide its body rules, which left every
; construct flat with no node spanning just the body.
;
;     (function_definition
;       (identifier)          ; name
;       (statements ...))     ; ← the body, exactly
;
; A construct's body is always its own direct `(statements)` child, so these
; patterns cannot grab a nested construct's body by accident.
;
; Not provided, and why:
;   * `@class.inner` — `record Point(x, y)` has no body, only a field list.
;   * `@call.inner`   — `f(a, b)` has no node spanning just the arguments.
;   * `@assignment.lhs`/`@rhs` — the right-hand side often is not one node:
;     `x = a ? b : c` parses as `x`, `=`, `a`, `?`, `b`, `:`, `c` siblings,
;     so a `@rhs` capture would select only `a`.
;   * `@comment.inner` — would need a range directive; none are used here
;     (`#make-range!` / `#offset!` are Neovim-only and can fail query load
;     in Helix).
;
; Known limits:
;   * `@parameter.*` covers the parameter NAME only.  `v: Int = 0` has no
;     node spanning the whole parameter, so swapping exchanges names and
;     leaves the types/defaults in place — which is usually what you want.
;   * `@statement.outer` covers statements that are a node of their own.
;     A postfix chain flattens into its parent, so `items.each do ... end`
;     is three sibling nodes with no node spanning it — select it with
;     `@block.outer` on the block instead.
;   * `@call.*` covers `f(...)` exactly.  `a.b(...)` is a postfix chain with
;     no single node for the whole expression, so it matches `.b(...)`.
; ============================================================================

; ── Functions ─────────────────────────────────────────────────────────────
(function_definition) @function.outer @function.around
(function_definition (statements) @function.inner @function.inside)

; ── Classes (records) ─────────────────────────────────────────────────────
(record_definition) @class.outer @class.around

; ── Conditionals ──────────────────────────────────────────────────────────
(if_statement) @conditional.outer @conditional.around
(unless_statement) @conditional.outer @conditional.around
(case_statement) @conditional.outer @conditional.around

; The branch bodies.  `when_clause` and `else_clause` carry one of their own,
; so placing the cursor on a branch selects that branch's body.
(if_statement (statements) @conditional.inner @conditional.inside)
(unless_statement (statements) @conditional.inner @conditional.inside)
(elsif_clause (statements) @conditional.inner @conditional.inside)
(else_clause (statements) @conditional.inner @conditional.inside)
(when_clause (statements) @conditional.inner @conditional.inside)

; ── Loops ─────────────────────────────────────────────────────────────────
(while_statement) @loop.outer @loop.around
(until_statement) @loop.outer @loop.around
(for_statement) @loop.outer @loop.around
(loop_statement) @loop.outer @loop.around
(do_while_statement) @loop.outer @loop.around

(while_statement (statements) @loop.inner @loop.inside)
(until_statement (statements) @loop.inner @loop.inside)
(for_statement (statements) @loop.inner @loop.inside)
(loop_statement (statements) @loop.inner @loop.inside)
(do_while_statement (statements) @loop.inner @loop.inside)

; ── Blocks ────────────────────────────────────────────────────────────────
(do_block) @block.outer @block.around
(begin_statement) @block.outer @block.around

(do_block (statements) @block.inner @block.inside)
(begin_statement (statements) @block.inner @block.inside)
(rescue_clause (statements) @block.inner @block.inside)
(ensure_clause (statements) @block.inner @block.inside)

; ── Calls ─────────────────────────────────────────────────────────────────
(call) @call.outer @call.around
(dot_call) @call.outer @call.around
(safe_call) @call.outer @call.around

; ── Assignments ───────────────────────────────────────────────────────────
(assignment) @assignment.outer @assignment.around
(destructuring_assignment) @assignment.outer @assignment.around

; ── Return ────────────────────────────────────────────────────────────────
(return_statement) @return.outer @return.around

; ── Statements ────────────────────────────────────────────────────────────
; An explicit list rather than `(statements (_))`: a postfix chain flattens
; into sibling nodes, so `items.each do ... end` is `items`, `.each` and the
; block, and a wildcard would capture each as a "statement".  Every node
; below is a whole statement in its own right, wherever it appears.
[
  (call)
  (assignment)
  (destructuring_assignment)
  (hash_destructuring_assignment)
  (return_statement)
  (break_statement)
  (next_statement)
  (if_statement)
  (unless_statement)
  (while_statement)
  (until_statement)
  (for_statement)
  (do_while_statement)
  (loop_statement)
  (begin_statement)
  (case_statement)
  (function_definition)
  (record_definition)
  (const_statement)
  (import_statement)
  (comment)
] @statement.outer

; ── Comments ──────────────────────────────────────────────────────────────
(comment) @comment.outer @comment.around

; ── Parameters ────────────────────────────────────────────────────────────
; The parameter name is the whole object: the signature is flat, so there is
; no node covering `v: Int = 0`.  The `(` and `,` anchors are the same ones
; locals.scm uses — body commas live inside call/vector/hash nodes.
(function_definition "(" . (identifier) @parameter.inner @parameter.outer @parameter.inside @parameter.around)
(function_definition "," . (identifier) @parameter.inner @parameter.outer @parameter.inside @parameter.around)
(lambda "(" . (identifier) @parameter.inner @parameter.outer @parameter.inside @parameter.around . [")" "," "="])
(lambda "," . (identifier) @parameter.inner @parameter.outer @parameter.inside @parameter.around)
(do_block "do" . "|" . (identifier) @parameter.inner @parameter.outer @parameter.inside @parameter.around)
(do_block "," . (identifier) @parameter.inner @parameter.outer @parameter.inside @parameter.around)
