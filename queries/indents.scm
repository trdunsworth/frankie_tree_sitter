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
  (do_while_statement)
  (begin_statement)
  (case_statement)
  (do_block)
  (lambda)
] @indent.begin

; `end` closes the block: its line dedents to the opener's level.
"end" @indent.end

; Mid-block keywords align with the opener, not its body.
["else" "elsif" "ensure" "rescue" "when"] @indent.branch
