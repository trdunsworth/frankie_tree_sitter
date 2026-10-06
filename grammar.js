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
    // `loop do ...` — the `do` is the loop keyword's optional `do`, or the
    // start of a do-while statement in the loop's body.
    [$._separator, $.do_while_statement],
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

    // body of any block construct: statements, preceded by an optional
    // separator (newline after the header, or `then`)
    _body: $ => seq(optional($._separator), $.statements),
    _separator: $ => choice($._terminator, seq('then', optional($._terminator))),

    _postfix_control: $ => seq(choice('if', 'unless'), $._expression),

    // ── Statements ──────────────────────────────────────────────────────

    if_statement: $ => seq(
      'if', $._expression, $._body,
      repeat($.elsif_clause),
      optional($.else_clause),
      'end',
    ),

    elsif_clause: $ => seq('elsif', $._expression, $._body),

    else_clause: $ => seq('else', $._body),

    unless_statement: $ => seq(
      'unless', $._expression, $._body,
      optional($.else_clause),
      'end',
    ),

    while_statement: $ => choice(
      prec.dynamic(1, seq('while', $._loop_label, $._expression, $._body, 'end')),
      seq('while', $._expression, $._body, 'end'),
    ),

    until_statement: $ => choice(
      prec.dynamic(1, seq('until', $._loop_label, $._expression, $._body, 'end')),
      seq('until', $._expression, $._body, 'end'),
    ),

    for_statement: $ => seq(
      'for', optional($._loop_label), $.identifier, 'in',
      $._expression, $._body, 'end',
    ),

    do_while_statement: $ => seq(
      'do', optional($._terminator), $.statements, 'while', $._expression,
    ),

    loop_statement: $ => seq(
      'loop', optional($._loop_label), optional('do'),
      optional($._separator), $.statements, 'end',
    ),

    begin_statement: $ => seq(
      'begin', optional($._terminator), $.statements,
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
      $._body,
    )),

    ensure_clause: $ => seq('ensure', $._body),

    case_statement: $ => seq(
      'case', optional($._expression), optional($._separator),
      repeat($.when_clause),
      optional($.else_clause),
      'end',
    ),

    when_clause: $ => seq(
      'when', sep1($._expression, ','), $._body,
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
      $._body, 'end',
    ),

    // The surrounding `(` `)` come from `function_definition`.
    _parameters: $ => sep1($._parameter, ','),

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

    vector: $ => seq(
      '[',
      repeat($._newline),
      optional(seq(
        sep1($._expression, seq(',', repeat($._newline))),
        optional(seq(',', repeat($._newline))),
        repeat($._newline),
      )),
      ']',
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

    _paren_args: $ => seq(
      '(',
      repeat($._newline),
      optional(seq(
        sep1($._argument, seq(',', repeat($._newline))),
        optional(seq(',', repeat($._newline))),
        repeat($._newline),
      )),
      ')',
    ),

    // `->(x) { ... }` / `->(x) do ... end`
    lambda: $ => seq(
      '->', '(',
      optional(sep($._lambda_parameter, ',')),
      ')',
      choice($._brace_body, $.do_block),
    ),

    _lambda_parameter: $ => seq($.identifier, optional(seq('=', $._expression))),

    _brace_body: $ => seq(
      '{', optional($._separator), $.statements, '}',
    ),

    // `expr do ... end` blocks attached after a call / command / identifier
    do_block: $ => seq(
      'do',
      optional($._block_params),
      $._body,
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
