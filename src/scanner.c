#include "tree_sitter/alloc.h"
#include "tree_sitter/array.h"
#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

typedef enum {
  HEREDOC_START,
  HEREDOC_BODY,
  STRING_START,
  STRING_CONTENT,
  STRING_END,
  INTERP_START,
  HEREDOC_END,
} TokenType;

typedef Array(char) String;

typedef struct {
  int32_t quote;
  bool triple;
  bool interp;
} StringMode;

typedef struct {
  String delim;
  // True when the next byte to scan begins a line.  A line that has already
  // produced an interpolation is mid-line and must never be re-tested
  // against the delimiter — see scan_heredoc_line.
  bool at_line_start;
} Heredoc;

typedef struct {
  Array(StringMode) strings;
  Array(Heredoc) heredocs;
} Scanner;

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

static inline bool is_space(int32_t c) {
  return c == ' ' || c == '\t' || c == '\r';
}

static inline bool is_delim_char(int32_t c) {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') ||
         (c >= 'A' && c <= 'Z') || c == '_';
}

static void scanner_reset(Scanner *scanner) {
  array_delete(&scanner->strings);
  for (uint32_t i = 0; i < scanner->heredocs.size; i++) {
    array_delete(&array_get(&scanner->heredocs, i)->delim);
  }
  array_delete(&scanner->heredocs);
}

static inline unsigned serialize(Scanner *scanner, char *buffer) {
  unsigned size = 0;

  if (size + 1 > TREE_SITTER_SERIALIZATION_BUFFER_SIZE) return 0;
  buffer[size++] = (char)scanner->strings.size;
  for (uint32_t i = 0; i < scanner->strings.size; i++) {
    if (size + 3 > TREE_SITTER_SERIALIZATION_BUFFER_SIZE) return 0;
    StringMode *mode = array_get(&scanner->strings, i);
    buffer[size++] = (char)mode->quote;
    buffer[size++] = (char)mode->triple;
    buffer[size++] = (char)mode->interp;
  }

  if (size + 1 > TREE_SITTER_SERIALIZATION_BUFFER_SIZE) return 0;
  buffer[size++] = (char)scanner->heredocs.size;
  for (uint32_t i = 0; i < scanner->heredocs.size; i++) {
    Heredoc *heredoc = array_get(&scanner->heredocs, i);
    if (size + sizeof(uint32_t) + heredoc->delim.size + 1 >
        TREE_SITTER_SERIALIZATION_BUFFER_SIZE) {
      return 0;
    }
    memcpy(&buffer[size], &heredoc->delim.size, sizeof(uint32_t));
    size += sizeof(uint32_t);
    memcpy(&buffer[size], heredoc->delim.contents, heredoc->delim.size);
    size += heredoc->delim.size;
    buffer[size++] = (char)heredoc->at_line_start;
  }

  return size;
}

static inline void deserialize(Scanner *scanner, const char *buffer,
                               unsigned length) {
  unsigned size = 0;
  scanner_reset(scanner);

  if (length == 0) return;

  uint8_t string_count = (uint8_t)buffer[size++];
  for (uint8_t i = 0; i < string_count; i++) {
    StringMode mode = {0};
    mode.quote = (unsigned char)buffer[size++];
    mode.triple = buffer[size++] != 0;
    mode.interp = buffer[size++] != 0;
    array_push(&scanner->strings, mode);
  }

  uint8_t heredoc_count = (uint8_t)buffer[size++];
  for (uint8_t i = 0; i < heredoc_count; i++) {
    Heredoc heredoc = {0};
    heredoc.delim = (String)array_new();
    uint32_t word_length = 0;
    memcpy(&word_length, &buffer[size], sizeof(uint32_t));
    size += sizeof(uint32_t);
    array_reserve(&heredoc.delim, word_length);
    memcpy(heredoc.delim.contents, &buffer[size], word_length);
    heredoc.delim.size = word_length;
    size += word_length;
    heredoc.at_line_start = (size < length) ? (buffer[size++] != 0) : false;
    array_push(&scanner->heredocs, heredoc);
  }
}

// Scan the interior of the innermost open string: `_string_content`,
// `_string_end`, or `_interp_start`.
static bool scan_string(Scanner *scanner, TSLexer *lexer,
                        const bool *valid_symbols) {
  StringMode *mode = array_back(&scanner->strings);
  bool has_content = false;

  for (;;) {
    if (lexer->eof(lexer)) {
      if (has_content && valid_symbols[STRING_CONTENT]) {
        lexer->mark_end(lexer);
        lexer->result_symbol = STRING_CONTENT;
        return true;
      }
      // Unterminated string: let the parser report the missing `_string_end`.
      return false;
    }

    // Single-line strings cannot span lines: stop before the newline so the
    // parser reports a missing `_string_end` instead of swallowing the rest
    // of the file as content.
    if (!mode->triple && lexer->lookahead == '\n') {
      if (has_content && valid_symbols[STRING_CONTENT]) {
        lexer->mark_end(lexer);
        lexer->result_symbol = STRING_CONTENT;
        return true;
      }
      return false;
    }

    if (lexer->lookahead == mode->quote) {
      // Candidate end of content (before the closer).
      lexer->mark_end(lexer);
      bool closes = false;
      advance(lexer);
      if (!mode->triple) {
        closes = true;
      } else if (!lexer->eof(lexer) && lexer->lookahead == mode->quote) {
        advance(lexer);
        if (!lexer->eof(lexer) && lexer->lookahead == mode->quote) {
          advance(lexer);
          closes = true;
        }
      }

      if (closes) {
        if (has_content) {
          if (!valid_symbols[STRING_CONTENT]) return false;
          // Token end stays at the pre-quote mark.
          lexer->result_symbol = STRING_CONTENT;
          return true;
        }
        if (!valid_symbols[STRING_END]) return false;
        lexer->mark_end(lexer);
        array_pop(&scanner->strings);
        lexer->result_symbol = STRING_END;
        return true;
      }
      // A lone quote (or two of three) inside a triple string: content.
      has_content = true;
      continue;
    }

    if (mode->interp && lexer->lookahead == '#' &&
        valid_symbols[INTERP_START]) {
      lexer->mark_end(lexer);  // content ends before '#'
      advance(lexer);
      if (!lexer->eof(lexer) && lexer->lookahead == '{') {
        if (has_content) {
          if (!valid_symbols[STRING_CONTENT]) return false;
          lexer->result_symbol = STRING_CONTENT;
          return true;
        }
        advance(lexer);  // consume '{'
        lexer->mark_end(lexer);
        lexer->result_symbol = INTERP_START;
        return true;
      }
      // '#' not starting an interpolation: plain content.
      has_content = true;
      continue;
    }

    if (lexer->lookahead == '\\') {
      advance(lexer);
      if (!lexer->eof(lexer)) advance(lexer);
      has_content = true;
      continue;
    }

    advance(lexer);
    has_content = true;
  }
}

// Consume one heredoc line — or, when a `#{` interpolation splits it, the
// run of content before that marker.
//
// A line whose trimmed content equals the delimiter ends the heredoc: emit
// `_heredoc_end`, ending the token BEFORE the newline so that newline stays
// available as the statement separator, and pop the queue.  Any other line
// is emitted whole (including its trailing newline) as `_heredoc_body`.
//
// `#{` splits the line: the content before it goes out as `_heredoc_body`
// (or is skipped when the marker leads the line) and `_interp_start` is
// emitted so the grammar can parse the expression; scanning then resumes
// after that expression's `}`.  The reference lexer offers no escape here —
// in a heredoc `\#{x}` interpolates and keeps the backslash as literal text
// — so `\` needs no special handling.  A `#` not followed by `{` is ordinary
// content.
//
// A line that has produced an interpolation is known to be a body line: a
// delimiter is an identifier and can never contain `#{`.  Clearing
// `at_line_start` on the way out means the resumed scan skips the
// delimiter test, which would otherwise read the tail of
// `  text #{x} MSG` as the closer.
static bool scan_heredoc_line(Scanner *scanner, TSLexer *lexer,
                              const bool *valid_symbols) {
  Heredoc *heredoc = array_front(&scanner->heredocs);
  const char *delim = heredoc->delim.contents;
  uint32_t delim_len = heredoc->delim.size;

  // 0: leading whitespace, 1: matching delimiter, 2: trailing whitespace,
  // 3: line can no longer match.  A resumed mid-line scan starts in 3.
  bool line_start = heredoc->at_line_start;
  uint32_t matched = 0;
  unsigned phase = line_start ? 0 : 3;
  bool consumed = false;

  for (;;) {
    if (lexer->eof(lexer)) {
      bool closes = line_start &&
                    ((phase == 1 && matched == delim_len) || phase == 2);
      if (closes && consumed && valid_symbols[HEREDOC_END]) {
        lexer->mark_end(lexer);
        array_delete(&heredoc->delim);
        array_erase(&scanner->heredocs, 0);
        lexer->result_symbol = HEREDOC_END;
        return true;
      }
      if (consumed && valid_symbols[HEREDOC_BODY]) {
        lexer->mark_end(lexer);
        lexer->result_symbol = HEREDOC_BODY;
        return true;
      }
      return false;
    }

    int32_t c = lexer->lookahead;

    if (c == '#' && valid_symbols[INTERP_START]) {
      lexer->mark_end(lexer);  // body content ends before '#'
      advance(lexer);
      if (!lexer->eof(lexer) && lexer->lookahead == '{') {
        if (consumed) {
          if (!valid_symbols[HEREDOC_BODY]) return false;
          lexer->result_symbol = HEREDOC_BODY;
          heredoc->at_line_start = false;
          return true;
        }
        advance(lexer);  // consume '{'
        lexer->mark_end(lexer);
        heredoc->at_line_start = false;
        lexer->result_symbol = INTERP_START;
        return true;
      }
      // '#' not opening an interpolation: literal content.  '#' can never
      // appear in a delimiter, so it also ends any match in progress.
      phase = 3;
      consumed = true;
      continue;
    }

    if (c == '\n') {
      bool closes = line_start &&
                    ((phase == 1 && matched == delim_len) || phase == 2);
      if (closes && valid_symbols[HEREDOC_END]) {
        // Stop before the newline: it terminates the statement that
        // carried the `<<~NAME` marker's body.
        lexer->mark_end(lexer);
        array_delete(&heredoc->delim);
        array_erase(&scanner->heredocs, 0);
        lexer->result_symbol = HEREDOC_END;
        return true;
      }
      advance(lexer);
      lexer->mark_end(lexer);
      consumed = true;
      heredoc->at_line_start = true;
      break;
    }

    if (phase == 0) {
      if (is_space(c)) {
        advance(lexer);
      } else if (matched < delim_len && (char)c == delim[matched]) {
        matched++;
        advance(lexer);
        if (matched == delim_len) phase = 1;
      } else {
        phase = 3;
        advance(lexer);
      }
    } else if (phase == 1) {
      if (matched < delim_len && (char)c == delim[matched]) {
        matched++;
        advance(lexer);
        if (matched == delim_len) phase = 1;
      } else if (matched == delim_len && is_space(c)) {
        phase = 2;
        advance(lexer);
      } else {
        phase = 3;
        advance(lexer);
      }
    } else if (phase == 2) {
      if (is_space(c)) {
        advance(lexer);
      } else {
        phase = 3;
        advance(lexer);
      }
    } else {
      advance(lexer);
    }
    consumed = true;
  }

  if (!consumed) return false;
  if (!valid_symbols[HEREDOC_BODY]) return false;
  lexer->result_symbol = HEREDOC_BODY;
  return true;
}

// `<<~NAME` or `<<NAME` — matches the reference lexer, which requires the
// delimiter identifier to start immediately after `<<` / `<<~`.
static bool scan_heredoc_start(Scanner *scanner, TSLexer *lexer) {
  advance(lexer);  // first '<'
  if (lexer->eof(lexer) || lexer->lookahead != '<') return false;
  advance(lexer);  // second '<'
  if (!lexer->eof(lexer) && lexer->lookahead == '~') advance(lexer);

  if (lexer->eof(lexer) || !is_delim_char(lexer->lookahead)) return false;

  Heredoc heredoc = {0};
  heredoc.delim = (String)array_new();
  heredoc.at_line_start = true;
  while (!lexer->eof(lexer) && is_delim_char(lexer->lookahead)) {
    array_push(&heredoc.delim, (char)lexer->lookahead);
    advance(lexer);
  }
  array_push(&scanner->heredocs, heredoc);

  lexer->mark_end(lexer);
  lexer->result_symbol = HEREDOC_START;
  return true;
}

static bool scan_string_start(Scanner *scanner, TSLexer *lexer) {
  int32_t quote = lexer->lookahead;
  advance(lexer);  // opening quote
  lexer->mark_end(lexer);

  bool triple = false;
  if (!lexer->eof(lexer) && lexer->lookahead == quote) {
    advance(lexer);  // second quote
    if (!lexer->eof(lexer) && lexer->lookahead == quote) {
      advance(lexer);  // third quote → triple-quoted
      lexer->mark_end(lexer);
      triple = true;
    }
    // For `""` the second quote is left for `_string_end`.
  }

  StringMode mode = {0};
  mode.quote = quote;
  mode.triple = triple;
  mode.interp = quote == '"';
  array_push(&scanner->strings, mode);

  lexer->result_symbol = STRING_START;
  return true;
}

bool tree_sitter_frankie_external_scanner_scan(void *payload, TSLexer *lexer,
                                               const bool *valid_symbols) {
  Scanner *scanner = (Scanner *)payload;

  // 1. Interior of an open string (gated on validity so that a `}` closing
  //    an interpolation, or a nested string's opener, is never swallowed).
  if (scanner->strings.size > 0 &&
      (valid_symbols[STRING_CONTENT] || valid_symbols[STRING_END] ||
       valid_symbols[INTERP_START])) {
    return scan_string(scanner, lexer, valid_symbols);
  }

  // 2. Heredoc lines (before any skipping: leading spaces on a body line
  //    are content, not trivia).  Validity of `_heredoc_body` /
  //    `_heredoc_end` — which the grammar only allows after the marker
  //    line's `_newline` — gates this, so no arming flag is needed.
  if (scanner->heredocs.size > 0 &&
      (valid_symbols[HEREDOC_BODY] || valid_symbols[HEREDOC_END])) {
    return scan_heredoc_line(scanner, lexer, valid_symbols);
  }

  // 3. The parser may call us at the whitespace *before* the real token
  //    (e.g. the space between `=` and `"`).  Skip horizontal whitespace so
  //    the checks below see the actual next character.  Advances are
  //    discarded when we return false.
  while (!lexer->eof(lexer) && is_space(lexer->lookahead)) {
    skip(lexer);
  }
  if (lexer->eof(lexer)) return false;

  // 4. Heredoc marker.
  if (valid_symbols[HEREDOC_START] && lexer->lookahead == '<') {
    if (scan_heredoc_start(scanner, lexer)) return true;
  }

  // 5. String opener.
  if (valid_symbols[STRING_START] &&
      (lexer->lookahead == '"' || lexer->lookahead == '\'')) {
    return scan_string_start(scanner, lexer);
  }

  return false;
}

void *tree_sitter_frankie_external_scanner_create(void) {
  Scanner *scanner = ts_calloc(1, sizeof(Scanner));
  array_init(&scanner->strings);
  array_init(&scanner->heredocs);
  return scanner;
}

void tree_sitter_frankie_external_scanner_destroy(void *payload) {
  Scanner *scanner = (Scanner *)payload;
  scanner_reset(scanner);
  ts_free(scanner);
}

unsigned tree_sitter_frankie_external_scanner_serialize(void *payload,
                                                        char *buffer) {
  return serialize((Scanner *)payload, buffer);
}

void tree_sitter_frankie_external_scanner_deserialize(void *payload,
                                                      const char *buffer,
                                                      unsigned length) {
  deserialize((Scanner *)payload, buffer, length);
}
