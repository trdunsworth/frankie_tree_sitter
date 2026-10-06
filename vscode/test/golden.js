'use strict';

// The expected semantic tokens for examples/hello.fk, as
// [line, startChar, length, type, modifierBits].
//
// This is the one place both tests read the golden from: the headless test
// asserts the parser produces it, and the in-editor test asserts VSCodium's
// semantic token pipeline hands back exactly the same thing. Sharing it means
// the two can never drift apart silently.
const HELLO_FK_TOKENS = [
  [0, 0, 49, 'comment', 0],
  [2, 0, 4, 'variable', 0],
  [2, 5, 1, 'operator', 0],
  [2, 7, 7, 'string', 0],
  [3, 0, 4, 'function', 2],
  [3, 5, 17, 'string', 0],
  [3, 15, 4, 'variable', 0],
  [4, 0, 4, 'function', 2],
  [4, 5, 67, 'string', 0],
];

module.exports = { HELLO_FK_TOKENS };
