; ============================================================================
; Frankie — fold queries (Helix / Neovim conventions)
; ============================================================================

; Block constructs fold around their bodies.
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
  (do_while_statement)
  (do_block)
  (lambda)
] @fold

; Literal containers fold when they span lines.  Folding a one-line vector or
; hash is a no-op in editors (nothing area-wise collapses), so this is always
; safe — it is the same policy most languages use.
[
  (vector)
  (hash)
] @fold
