/**
 * @file Frankie Programming Language parser
 * @author Tony Dunsworth <tony.dunsworth@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Operator precedence, loosest to tightest. Mirrors compiler/parser.py:
//   pipe > ternary > assign > or > and > not > | (merge) > comparison
//   > additive > multiplicative > range > unary > power > postfix
const PREC = {
  PIPE: 1,
  TERNARY: 2,
  ASSIGN: 3,
  OR: 4,
  AND: 5,
  NOT: 6,
  MERGE: 7,
  COMPARE: 8,
  ADD: 10,
  MUL: 20,
  RANGE: 25,
  UNARY: 30,
  POWER: 35,
  POSTFIX: 40,
};

export default grammar({
  name: 'frankie',

  word: $ => $.identifier,

  // Words that structure a block may never be read as identifiers.  Without
  // this, tree-sitter's keyword extraction falls back to `word` — here
  // `identifier` — whenever the keyword is not valid in the current lex state,
  // so a stray `end` or a leading `else` parses as a clean expression
  // statement naming a variable instead of being flagged.  The reference
  // lexer has no such fallback: every one of these is a dedicated token.
  //
  // This matters most where a construct can have an empty body — after
  // `if x\nend` the next `end` is no longer an expected token, which is
  // exactly the state in which the fallback used to kick in.
  //
  // Deliberately scoped to block structure.  The reference also reserves
  // `p`, `times`, `each`, `map`, `input`, `spawn` and `timeout`; leaving
  // those as identifiers is a divergence, but a harmless one that keeps
  // ordinary code like `map = fn` parseable.
  reserved: {
    global: $ => [
      'end', 'else', 'elsif', 'when', 'rescue', 'ensure', 'then',
    ],
  },

  externals: $ => [
    $._heredoc_start,
    $._heredoc_body,
    $._string_start,
    $._string_content,
    $._string_end,
    $._interp_start,
    // NOTE: order must match the TokenType enum in src/scanner.c.
    $._heredoc_end,
  ],

  extras: $ => [
    $.comment,
    /[ \t\r]/,
  ],

  conflicts: $ => [
    // `f if x then y end` — `if` may start a command argument, or be a
    // postfix control modifier. GLR resolves by viability of each branch.
    [$._primary, $.call],
    // `puts if x then y end` — keyword command with an `if` argument vs
    // bare command plus postfix `if`
    [$.call],
    // `return if x ... end` vs `return` with a postfix `if`
    [$.return_statement],
    // same pattern for `break` / `next`
    [$.break_statement],
    [$.next_statement],
    // `do ... while cond`: does the `while` end the do-body (do-while) or
    // start a nested while-loop? GLR viability decides — a nested while
    // needs `end`, a do-while terminator does not.
    [$.statements],
    // Same question one token earlier, now that the body may be empty:
    // `do while cond` reads as a do-while whose body is nothing at all, or as
    // a nested while-loop statement in the body's first position. They share
    // the whole prefix `do while <expr>`, so nothing up to the expression
    // distinguishes them. A nested loop still needs its own `end` plus a
    // closing `while` for the do-while, so viability resolves it.
    [$.while_statement, $.do_while_statement],
    // `{ f a: 1 }` — `a: 1` as a named command argument (brace body) vs an
    // expression-keyed hash pair (hash literal).
    [$._primary, $._named_argument],
    // def-params and call-args share the same LR state after `identifier`;
    // GLR resolves via the differing context beneath the merge.
    [$._parameter, $._primary],
    [$._parameter, $.destructuring_assignment],
    // `def f(a: T, b: U)` — the type identifier also looks like the start
    // of `identifier , ... = ...` inside the parameter list.
    [$._parameter, $.destructuring_assignment, $._primary],
    // `{a, b, c}` — record-definition members vs a hash-destructuring LHS
    // (`{a, b} = ...`): both shift `,` after an identifier inside braces.
    [$.destructuring_assignment, $.hash_destructuring_assignment],
    // `f(a, b)` / `[a, b]` / `puts a, b` vs the destructuring statement
    // `a, b = ...`: after an identifier the `,` is either a list separator
    // (reduce `_primary`) or the destructuring continuation (shift).  The
    // destructuring arm carries prec.right(3), which would otherwise win
    // statically and kill every comma-separated identifier list.
    [$._primary, $.destructuring_assignment],
    // trailing-comma / newline handling inside `{ ... }`, `[ ... ]`, `( ... )`
    [$.hash],
    [$.vector],
    [$._paren_args],
  ],

  rules: {
    source_file: $ => seq(
      optional($._terminator),
      optional($.statements),
    ),

    // ── Lexical ──────────────────────────────────────────────────────────

    comment: $ => /#[^\n]*/,

    identifier: $ => /[a-zA-Z_][a-zA-Z0-9_]*[?!]?/,

    number: $ => /\d[\d_]*(\.[\d_]+)?([eE][+-]?\d+)?/,

    symbol: $ => /:[a-zA-Z_][a-zA-Z0-9_]*/,

    string: $ => seq(
      $._string_start,
      repeat(choice($._string_content, $.interpolation)),
      $._string_end,
    ),

    interpolation: $ => seq($._interp_start, $._expression, '}'),

    heredoc_start: $ => $._heredoc_start,
    heredoc_body: $ => $._heredoc_body,
    heredoc_end: $ => $._heredoc_end,

    // A heredoc literal is one complete expression: the `<<~NAME` marker,
    // the newline that ends the marker line, the body (each `_heredoc_body`
    // token includes its trailing newline; the scanner splits a line at
    // `#{` so an interpolation can appear anywhere within it), and the
    // closer line — which deliberately EXCLUDES its trailing newline so that
    // newline remains available as the statement separator for what follows.
    heredoc: $ => seq(
      $.heredoc_start,
      $._newline,
      repeat(choice($.heredoc_body, $.interpolation)),
      $.heredoc_end,
    ),

    // `html_response(<<~HTML)` — the reference lexer reads `<<~HTML`, then
    // DEFERS whatever is left on the marker line until after the body: it
    // emits the heredoc as one STRING token that swallows the `)`, and then
    // re-emits RPAREN positioned at the closer line.  tree-sitter nodes are
    // contiguous source ranges, so that reordering is not expressible — a
    // token cannot follow a node that starts later in the file.
    //
    // The honest modelling is therefore that the tail belongs to the
    // heredoc: `heredoc` spans `<<~HTML)` through the closer line, and the
    // enclosing bracket is closed by that tail rather than by a token of its
    // own.  `_paren_args` grows a second form for exactly that case, instead
    // of making its `)` optional — an optional `)` would also let a
    // genuinely unbalanced `f(1` parse as a complete call.
    // Exactly ONE closer, not a run of them: `f((<<~A))` needs the inner
    // paren list to take one `)` and the outer to take the other, which a
    // `+` quantifier cannot express.
    _marker_tail: $ => token(/[ \t]*[)\]}]/),

    _heredoc_with_tail: $ => seq(
      $.heredoc_start,
      $._marker_tail,
      $._newline,
      repeat(choice($.heredoc_body, $.interpolation)),
      $.heredoc_end,
    ),

    // ── Statement structure ─────────────────────────────────────────────

    _terminator: $ => repeat1($._newline),
    _newline: $ => '\n',

    // A named node so editors can select a whole block body as one unit
    // (textobject `.inner`/`.inside`).  Hiding it made every construct's
    // body flat, leaving no node that spans just the body.
    statements: $ => seq(
      $._statement,
      repeat(seq($._terminator, $._statement)),
      optional($._terminator),
    ),

    _statement: $ => choice(
      seq(
        choice(
          $._expression,
          $.return_statement,
          $.break_statement,
          $.next_statement,
        ),
        optional($._postfix_control),
      ),
      $._block_statement,
    ),

    // `if` is deliberately absent here: it is reachable only through
    // `_primary`, so statement-position `if` parses as an expression
    // statement (the reference parser allows both, and `_primary` is the
    // only interpretation that also works in `x = if ... end`).
    _block_statement: $ => choice(
      $.unless_statement,
      $.while_statement,
      $.until_statement,
      $.for_statement,
      $.do_while_statement,
      $.begin_statement,
      $.case_statement,
      $.function_definition,
      $.record_definition,
      $.const_statement,
      $.import_statement,
      $.loop_statement,
    ),

    // Body of any block construct: an optional separator (the newline after
    // the header, or `then`) and then statements.
    //
    // `statements` is optional because the reference's `parse_body()` returns
    // an empty list whenever the construct is closed immediately — and since
    // comments are `extras`, a body holding nothing but a comment is empty
    // too.  So all of these are legal:
    //
    //     def f()
    //     end
    //     if x
    //       # TODO
    //     end
    //     [1].each do |item|
    //     end
    //
    // Keeping `statements` itself non-empty matters: it is a *visible* node,
    // and `.inner` / `.inside` text objects select it.  Making the rule
    // itself match the empty string would drop that node (and tree-sitter
    // rejects empty-matching rules outright), so the optionality lives in
    // `_body` instead — an empty body simply has no `(statements)` child,
    // which is the honest answer: there is nothing to select.
    //
    // `_body` must not match the empty string either, so it has two non-empty
    // arms — the statements, or the newlines standing in for them — and every
    // call site wraps it in `optional()`.  That wrapper is what covers the
    // zero-width case, `def f end` with no newline at all, which the
    // reference accepts too.  Splitting it this way is also unambiguous: a
    // statement can never begin with a newline, so whenever there IS a
    // newline it has exactly one possible owner.
    _body: $ => choice(
      seq(optional($._separator), $.statements),
      prec(1, $._terminator),
    ),
    _separator: $ => choice($._terminator, seq('then', optional($._terminator))),

    _postfix_control: $ => seq(choice('if', 'unless'), $._expression),

    // ── Statements ──────────────────────────────────────────────────────

    if_statement: $ => seq(
      'if', $._expression, optional($._body),
      repeat($.elsif_clause),
      optional($.else_clause),
      'end',
    ),

    elsif_clause: $ => seq('elsif', $._expression, optional($._body)),

    else_clause: $ => seq('else', optional($._body)),

    unless_statement: $ => seq(
      'unless', $._expression, optional($._body),
      optional($.else_clause),
      'end',
    ),

    while_statement: $ => choice(
      prec.dynamic(1, seq('while', $._loop_label, $._expression, optional($._body), 'end')),
      seq('while', $._expression, optional($._body), 'end'),
    ),

    until_statement: $ => choice(
      prec.dynamic(1, seq('until', $._loop_label, $._expression, optional($._body), 'end')),
      seq('until', $._expression, optional($._body), 'end'),
    ),

    for_statement: $ => seq(
      'for', optional($._loop_label), $.identifier, 'in',
      $._expression, optional($._body), 'end',
    ),

    do_while_statement: $ => seq(
      'do', optional($._body), 'while', $._expression,
    ),

    loop_statement: $ => seq(
      'loop', optional($._loop_label), optional('do'),
      optional($._body), 'end',
    ),

    begin_statement: $ => seq(
      'begin', optional($._body),
      repeat($.rescue_clause),
      optional($.ensure_clause),
      'end',
    ),

    // The reference only accepts identifiers here: an optional capitalised
    // error type, then an optional `=> var` or a bare lowercase var.
    // Case cannot be expressed in the grammar, so both slots are just
    // `identifier`.  `prec(1)` makes `rescue e` bind `e` rather than
    // starting the body with a statement named `e`.
    rescue_clause: $ => prec(1, seq(
      'rescue',
      optional($.identifier),
      optional(choice(seq('=>', $.identifier), $.identifier)),
      optional($._body),
    )),

    ensure_clause: $ => seq('ensure', optional($._body)),

    case_statement: $ => seq(
      'case', optional($._expression), optional($._separator),
      repeat($.when_clause),
      optional($.else_clause),
      'end',
    ),

    when_clause: $ => seq(
      'when', sep1($._expression, ','), optional($._body),
    ),

    // `prec.dynamic(1)` on the parameter list is load-bearing.  Without it
    // a single-parameter definition is ambiguous — `def outer(a)` can also
    // read as a definition with no parameters whose body begins with the
    // parenthesized expression `(a)` — and once `statements` became a
    // visible node the parser preferred that reading, moving `a` out of the
    // signature and into the body.  The dynamic precedence makes the
    // signature win without affecting any other construct.
    function_definition: $ => seq(
      'def', $.identifier,
      optional(prec.dynamic(1, seq('(', optional($._parameters), ')'))),
      optional(seq('->', $.identifier)),
      optional($._body), 'end',
    ),

    // The surrounding `(` `)` come from `function_definition`.
    //
    // Newlines are allowed after a comma but nowhere else, mirroring
    // `parse_func_def` in the reference parser, which does exactly one
    // `skip_newlines()` — inside the `while self.match(TT.COMMA)` loop:
    //
    //     def game_new(width: 32, height: 20,      # OK
    //                  port: 4100, cell: 22)
    //     def f(a, b                                # OK
    //            )                                  # not OK — no newline before `)`
    //     def f(                                    # not OK — no newline after `(`
    //       a)
    //
    // Lambda parameters are a separate rule (`_lambda_parameter`) and do NOT
    // get this: `->(a,\n b)` is a parse error upstream.
    _parameters: $ => prec.right(seq(
      $._parameter,
      repeat(seq(',', repeat($._newline), $._parameter)),
      optional(seq(',', repeat($._newline))),
    )),

    _parameter: $ => choice(
      prec.dynamic(1, seq($.identifier, ':', $.identifier, optional(seq('=', $._expression)))),
      seq($.identifier, ':', $._expression),
      seq($.identifier, '=', $._expression),
      $.identifier,
    ),

    record_definition: $ => seq(
      'record', $.identifier,
      '(', optional(sep($.identifier, ',')), ')',
    ),

    const_statement: $ => seq('const', $.identifier, '=', $._expression),

    import_statement: $ => seq(
      'import', optional($._expression), optional(seq('as', $.identifier)),
    ),

    return_statement: $ => seq('return', optional($._expression)),

    break_statement: $ => choice(
      prec.dynamic(1, seq('break', $._loop_label, optional($._expression))),
      seq('break', optional($._expression)),
    ),

    next_statement: $ => choice(
      prec.dynamic(1, seq('next', $._loop_label, optional($._expression))),
      seq('next', optional($._expression)),
    ),

    // v1.22 loop labels: `while :outer ... break :outer`.
    // The reference parser always treats a symbol here as a label, never as
    // a condition/value, so give it the higher precedence.
    _loop_label: $ => prec(1, $.symbol),

    // ── Expressions ─────────────────────────────────────────────────────

    _expression: $ => $._pipe,

    _pipe: $ => prec.left(PREC.PIPE, seq(
      $._ternary,
      repeat(seq('|>', $._pipe_rhs)),
    )),
    _pipe_rhs: $ => $._primary,

    _ternary: $ => prec.right(PREC.TERNARY, seq(
      $._assign,
      optional(seq('?', $._or, ':', $._ternary)),
    )),

    _assign: $ => choice(
      $.assignment,
      $.destructuring_assignment,
      $.hash_destructuring_assignment,
      $._or,
    ),

    // LHS is the same postfix chain used for expressions (`foo`, `foo.bar`,
    // `foo[0]`, `foo.bar[0]`) — the following assign-operator is what
    // distinguishes it from a plain expression.
    assignment: $ => prec.right(PREC.ASSIGN, seq(
      $._postfix,
      $._assign_op,
      $._expression,
    )),

    _assign_op: $ => choice(
      '=', '+=', '-=', '*=', '/=', '//=', '**=', '%=', '||=',
    ),

    // NOTE: no prec.right here — a precedence on this rule would resolve the
    // shift of `,` after `identifier` statically (shift beats the plain
    // `_primary → identifier` reduce), killing `f(a, b)` / `[a, b]`.  With
    // equal precedence the ambiguity is real, the declared conflict forks,
    // and GLR keeps only the viable branch (destructuring needs `=` later;
    // lists need `)` / `]` / newline).
    destructuring_assignment: $ => seq(
      $.identifier, ',',
      sep1(seq(optional('*'), $.identifier), ','),
      $._assign_op, $._expression,
    ),

    hash_destructuring_assignment: $ => prec.right(PREC.ASSIGN, seq(
      '{',
      seq($.identifier, repeat(seq(',', $.identifier))),
      '}', $._assign_op, $._expression,
    )),

    // `&&` / `||` are accepted as aliases of `and` / `or` (examples use
    // `&&`; the reference lexer silently drops it, we give it a real tree).
    _or: $ => prec.left(PREC.OR, seq($._and, repeat(seq(choice('or', '||'), $._and)))),
    _and: $ => prec.left(PREC.AND, seq($._not, repeat(seq(choice('and', '&&'), $._not)))),
    _not: $ => choice(seq('not', $._not), $._merge),
    _merge: $ => prec.left(PREC.MERGE, seq(
      $._comparison,
      repeat(seq('|', $._comparison)),
    )),

    _comparison: $ => prec.left(PREC.COMPARE, seq(
      $._additive,
      repeat(seq(choice('==', '!=', '<', '<=', '>', '>=', '=~'), $._additive)),
    )),

    _additive: $ => prec.left(PREC.ADD, seq(
      $._multiplicative,
      repeat(seq(choice('+', '-'), $._multiplicative)),
    )),

    _multiplicative: $ => prec.left(PREC.MUL, seq(
      $._unary,
      repeat(seq(choice('*', '/', '//', '%'), $._unary)),
    )),

    // Mirrors compiler/parser.py `parse_unary` / `parse_power`:
    //   await takes a postfix operand and returns (no range check)
    //   `-x` and power results may be followed by `..`/`...` (right-assoc,
    //   exactly like the reference's trailing range check)
    _unary: $ => choice(
      prec.right(PREC.UNARY, seq('await', $._postfix)),
      prec.right(PREC.RANGE, seq(
        choice(
          prec.right(PREC.UNARY, seq('-', $._unary)),
          $._power,
        ),
        optional(seq(choice('..', '...'), $._unary)),
      )),
    ),

    _power: $ => prec.right(PREC.POWER, seq(
      $._postfix,
      optional(seq('**', $._unary)),
    )),

    _postfix: $ => prec.left(PREC.POSTFIX, seq(
      $._primary,
      repeat(choice($.dot_call, $.safe_call, $._index, $.do_block)),
    )),

    // `prec.right`: on `(`, prefer shifting into the argument list —
    // `x.foo(a)` is a method call with args, exactly like the reference
    // parser (which ignores whitespace before LPAREN).
    // `.name(args)` method call, or the lambda-call form `fn.(args)`
    // (reference parser: dot followed immediately by LPAREN).
    dot_call: $ => prec.right(seq(
      '.',
      choice(
        seq($.identifier, optional($._paren_args)),
        $._paren_args,
      ),
    )),

    safe_call: $ => prec.right(seq(
      '&.', $.identifier,
      optional($._paren_args),
    )),

    _index: $ => seq('[', $._expression, ']'),

    // ── Primary ─────────────────────────────────────────────────────────

    _primary: $ => choice(
      $.number,
      $.string,
      $.heredoc,
      $.symbol,
      'true',
      'false',
      'nil',
      $.identifier,
      $.call,
      $.vector,
      $.hash,
      $._parenthesized,
      $.lambda,
      $.if_statement,
    ),

    // The reference parser does not skip newlines around a parenthesized
    // expression, so this is a single-line form only.
    _parenthesized: $ => seq('(', $._expression, ')'),

    vector: $ => choice(
      seq(
        '[',
        repeat($._newline),
        optional(seq(
          sep1($._expression, seq(',', repeat($._newline))),
          optional(seq(',', repeat($._newline))),
          repeat($._newline),
        )),
        ']',
      ),
      // A trailing heredoc closes the list, same as `_paren_args`.
      seq(
        '[',
        repeat($._newline),
        optional(seq(
          sep1($._expression, seq(',', repeat($._newline))),
          ',',
          repeat($._newline),
        )),
        alias($._heredoc_with_tail, $.heredoc),
      ),
    ),

    hash: $ => seq(
      '{',
      repeat($._newline),
      optional(seq(
        sep1($._hash_pair, seq(',', repeat($._newline))),
        optional(seq(',', repeat($._newline))),
        repeat($._newline),
      )),
      '}',
    ),

    _hash_pair: $ => choice(
      prec.dynamic(-1, seq($._expression, ':', $._expression)),
      prec(1, seq($.identifier, ':', $._expression)),
    ),

    // Calls: paren-call, keyword command (`puts "x"`, `raise e`),
    // and general command (`f a`) which loses to binary operators on ties
    call: $ => choice(
      seq(choice($.identifier, $._kw_command), $._paren_args),
      prec.dynamic(-1, seq($._kw_command, optional($._command_args))),
      prec.dynamic(-1, seq($.identifier, $._command_args)),
    ),

    _kw_command: $ => choice('puts', 'print', 'raise', 'require', 'stitch'),

    // Greedy: `puts a, b` is one command with two arguments, not a nested
    // command followed by a stray comma.
    _command_args: $ => prec.right(sep1($._argument, ',')),

    // `prec.left` makes `foo(a)` a paren-call rather than a command with a
    // parenthesized argument — matching the reference parser, where an
    // LPAREN immediately after an identifier always forms a FuncCall.
    // Level 1 keeps `_argument` preferred over a bare `_statement`, so
    // `rescue e x` parses the body as the command `e x` (no binding).
    _argument: $ => prec.left(1, choice($._named_argument, $._expression)),

    _named_argument: $ => seq($.identifier, ':', $._expression),

    _paren_args: $ => choice(
      seq(
        '(',
        repeat($._newline),
        optional(seq(
          sep1($._argument, seq(',', repeat($._newline))),
          optional(seq(',', repeat($._newline))),
          repeat($._newline),
        )),
        ')',
      ),
      // ...and the `heredoc`-closes-the-list form, where the final argument
      // is a heredoc that already absorbed the `)`.  Aliased back to
      // `heredoc` so this stays invisible in the tree: consumers see one
      // `(heredoc)` node either way, only its span differs.
      seq(
        '(',
        repeat($._newline),
        optional(seq(
          sep1($._argument, seq(',', repeat($._newline))),
          ',',
          repeat($._newline),
        )),
        alias($._heredoc_with_tail, $.heredoc),
      ),
    ),

    // `->(x) { ... }` / `->(x) do ... end`
    lambda: $ => seq(
      '->', '(',
      optional(sep($._lambda_parameter, ',')),
      ')',
      choice($._brace_body, $.do_block),
    ),

    _lambda_parameter: $ => seq($.identifier, optional(seq('=', $._expression))),

    _brace_body: $ => seq('{', optional($._body), '}'),

    // `expr do ... end` blocks attached after a call / command / identifier
    do_block: $ => seq(
      'do',
      optional($._block_params),
      optional($._body),
      'end',
    ),

    _block_params: $ => seq('|', optional(sep($.identifier, ',')), '|'),
  },
});

/**
 * One or more `rule`s separated by `separator`.
 */
function sep1(rule, separator) {
  return seq(rule, repeat(seq(separator, rule)));
}

/**
 * Zero or more `rule`s separated by `separator`.
 */
function sep(rule, separator) {
  return optional(sep1(rule, separator));
}

/**
 * A `(...)`-delimited, newline-tolerant comma-separated list.
 * `bracketed($._parameter, $)` is used for parameter lists.
 */
function bracketed(rule, $) {
  return seq(
    '(',
    repeat($._newline),
    optional(seq(
      sep1(rule, seq(',', repeat($._newline))),
      optional(seq(',', repeat($._newline))),
      repeat($._newline),
    )),
    ')',
  );
}
