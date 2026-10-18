; ============================================================================
; Frankie (tree-sitter-frankie) — highlight queries
;
; Grammar has no fields: captures rely on named/anonymous child order and
; `.` adjacency anchors.  Later patterns override earlier ones for the
; same node.  On tree-sitter 0.27.0 some shapes hang or take seconds to
; COMPILE — chained `.` anchors between same-type named siblings, and
; anonymous-token `[ ... ]` alternations after a capture.  Neither appears
; here; see README "Query-author notes" and queries/locals.scm for the
; full list and scripts/check-query.sh to test a pattern.
; ============================================================================

; ── Comments ───────────────────────────────────────────────────────────────
(comment) @comment

; ── Literals ───────────────────────────────────────────────────────────────
(string) @string
(heredoc) @string
(number) @number
(symbol) @constant
["true" "false"] @boolean
"nil" @constant.builtin

; ── Keywords ───────────────────────────────────────────────────────────────
[
  "if" "elsif" "else" "unless" "while" "until" "for" "in"
  "loop" "do" "end" "begin" "rescue" "ensure" "case" "when" "then"
  "break" "next" "return" "and" "or" "not" "await"
  "import" "as" "record" "const"
] @keyword

"def" @keyword.function

; ── Keyword commands / builtins ────────────────────────────────────────────
["puts" "print" "raise" "require" "stitch"] @function.builtin

; ── Operators ──────────────────────────────────────────────────────────────
[
  "=" "+=" "-=" "*=" "/=" "//=" "**=" "%=" "||="
  "+" "-" "*" "/" "//" "**" "%"
  "==" "!=" "<" "<=" ">" ">=" "=~"
  ".." "..." "|>" "&." "->"
  "&&" "||"
  "?" "|"
  "=>"
] @operator

; ── Punctuation ────────────────────────────────────────────────────────────
["(" ")" "[" "]" "{" "}"] @punctuation.bracket
["." "," ":"] @punctuation.delimiter

; ── Variables (generic; specific captures below override) ──────────────────
(identifier) @variable

; ── Function definition ────────────────────────────────────────────────────
(function_definition "def" . (identifier) @function)

; return type: `-> Int`
(function_definition "->" . (identifier) @type)

; parameter names: typed `x: T`, defaulting `x = 1`, later `..., y`
(function_definition (identifier) @variable.parameter . ":")
(function_definition (identifier) @variable.parameter . "=")
(function_definition "," . (identifier) @variable.parameter)

; ...and the FIRST bare parameter: `def add(a, b)` — `a` has no type or
; default, so the `:`/`=`/`,` patterns above never see it; only something
; anchored to the opening `(` does.  Each ends on a concrete token because a
; bare anchored node as the last pattern step costs seconds to compile on
; tree-sitter 0.27 (see locals.scm hazards).
(function_definition "(" . (identifier) @variable.parameter . ",")
(function_definition "(" . (identifier) @variable.parameter . ")")

; parameter types: identifier after `:` in the signature
(function_definition ":" . (identifier) @type)

; ── Record definition: `record Foo(a, b)` ──────────────────────────────────
(record_definition "record" . (identifier) @type)
(record_definition "," . (identifier) @property)

; ...and the first field, same reasoning as the first `def` parameter
(record_definition "(" . (identifier) @property . ",")
(record_definition "(" . (identifier) @property . ")")

; ── Const statement ────────────────────────────────────────────────────────
(const_statement "const" . (identifier) @constant)

; ── Lambda parameters ──────────────────────────────────────────────────────
(lambda (identifier) @variable.parameter . "=")
(lambda "," . (identifier) @variable.parameter)
(lambda "(" . (identifier) @variable.parameter . ",")
(lambda "(" . (identifier) @variable.parameter . ")")

; ── Block params: `do |a, b|` ──────────────────────────────────────────────
(do_block "|" (identifier) @variable.parameter "|")
(do_block "," . (identifier) @variable.parameter)

; ── Hash keys and named call arguments ─────────────────────────────────────
; The trailing `":"` is load-bearing for call arguments — it is what tells
; `f(a)` apart from `f(a: 1)` — but not for hash keys: `{a}` is not a hash,
; so an identifier directly after `{` or `,` is always a key.  Dropping it
; there takes compile time for this pattern from 0.65s to 0.03s on
; tree-sitter 0.27.
(hash "{" . (identifier) @property)
(hash "," . (identifier) @property)
(call "(" . (identifier) @property ":")
(call "," . (identifier) @property ":")

; ── Calls: callee is the first child of a call node ────────────────────────
(call . (identifier) @function)

; ── Method access: `.name` / `&.name` are their own nodes ──────────────────
(dot_call (identifier) @function)
(safe_call (identifier) @function)

; ── Overrides: in keyword commands the first identifier is an argument,
;    not the callee (later patterns win for the same node) ─────────────────
(call ["puts" "print" "require" "stitch"] . (identifier) @variable)
(call "raise" . (identifier) @type)

; ── Contextual declarations: `error Foo`, `enum Status(...)` ───────────────
; Upstream parses both at statement position, and this grammar models them as
; a call with a literal callee: `error Foo` is `(call (identifier) (identifier))`,
; `enum Status(...)` is `(call (identifier) (call (identifier) ...))`.  Neither
; is a lexable keyword — both are bare identifiers a program could name — so
; recognition is by TEXT, through `#eq?` predicates on the callee; every other
; call that shape-matches (e.g. `puts x`) fails the string check cheaply.
; They sit at the very end so the declaration reading wins over the generic
; callee capture above.
((call (identifier) @keyword (identifier) @type)
  (#eq? @keyword "error") (#match? @type "^[A-Z]"))
((call (identifier) @keyword (call . (identifier) @type "("))
  (#eq? @keyword "enum"))

; ── Stdlib functions that are keywords upstream but plain identifiers here:
;    `test "name" do ... end`, `benchmark "label" do ... end`, `breakpoint()`
;    are sugar for calls with a do-block argument, so they pass through
;    `call` like any function call.  Highlighting them as builtins keeps the
;    look of the sugar; real user identifiers named `test` etc. stay @variable
;    when they are not being called.
((call (identifier) @function.builtin)
  (#match? @function.builtin "^(test|benchmark|breakpoint)$"))
