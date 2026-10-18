; ============================================================================
; Frankie — indentation queries (Helix / Neovim conventions)
; ============================================================================

; Block constructs indent their bodies until the node ends.
[
  (function_definition)
  (if_statement)
  (unless_statement)
  (while_statement)
  (until_statement)
  (for_statement)
  (loop_statement)
  (begin_statement)
  (case_statement)
  (do_block)
  (lambda)
] @indent.begin

; `end` closes the block: its line dedents to the opener's level.
"end" @indent.end

; Mid-block keywords align with the opener, not its body.
["else" "elsif" "ensure" "rescue" "when"] @indent.branch

; `do ... while cond` has no `end`, so the whole node still opens one
; indent: its body indents from the `do` line, and the `while` line — the
; closing line, not the opening one of a `while` loop — dedents.  Keeping the
; node in the list above is what made everything after a do-while over-indent
; for good, because no `end` ever released it.
(do_while_statement "do") @indent.begin
(do_while_statement "while") @indent.end

; Brackets that open mid-line and close on a later line: hanging call
; arguments (`html_response(a, options: { ... })`) and multi-line vector and
; hash literals.  On a one-line list the opening and closing tokens are on
; the same line and net out; the closing token's line sits at the level the
; opener started at.
["(" "[" "{"] @indent.begin
[")" "]" "}"] @indent.end
