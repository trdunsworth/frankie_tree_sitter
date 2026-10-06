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

; parameter types: identifier after `:` in the signature
(function_definition ":" . (identifier) @type)

; ── Record definition: `record Foo(a, b)` ──────────────────────────────────
(record_definition "record" . (identifier) @type)
(record_definition "," . (identifier) @property)

; ── Const statement ────────────────────────────────────────────────────────
(const_statement "const" . (identifier) @constant)

; ── Lambda parameters ──────────────────────────────────────────────────────
(lambda (identifier) @variable.parameter . "=")
(lambda "," . (identifier) @variable.parameter)

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
