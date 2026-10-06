# Frankie for VS Code

Frankie (`.fk`) language support. Highlighting comes from this repository's
tree-sitter grammar, with a TextMate grammar as a fallback so files are never
left unstyled.

## How it works

1. On activation the extension loads `tree-sitter-frankie.wasm` and
   `queries/highlights.scm` — both built from the parent grammar, never
   maintained here.
2. It registers a `DocumentSemanticTokensProvider`. For each document it runs
   the highlights query and maps the resulting capture names onto VS Code's
   standard semantic token legend (`src/tokens.js`).
3. Anything not in that map — currently all punctuation — is left to
   `syntaxes/fk.tmLanguage.json`, which handles comments, strings, heredocs
   (including the `#{…}` interpolation and delimiter back-reference), numbers,
   keywords, types and operators on its own.

If the `.wasm` or the query is missing or fails to load, the extension says so
in the **Frankie** output channel and lets the TextMate grammar carry on rather
than failing the whole file.

| Capture in `highlights.scm` | VS Code token |
|---|---|
| `variable` | `variable` |
| `variable.parameter` | `parameter` |
| `property` | `property` |
| `function` | `function` |
| `function.builtin` | `function` + `defaultLibrary` |
| `type` | `type` |
| `keyword` | `keyword` |
| `keyword.function` | `keyword` + `declaration` |
| `boolean` | `variable` + `readonly` + `defaultLibrary` |
| `constant` / `constant.builtin` | `variable` + `readonly` (+ `defaultLibrary`) |
| `string` / `number` / `comment` / `operator` | same names |
| `punctuation.*` | *not mapped* — left to the TextMate grammar |

## Development

```sh
cd vscode
npm run assets              # build the .wasm and copy it plus queries/highlights.scm here
npm install
npm test                    # headless tests, no VS Code required
npm run test:integration    # the same provider, launched inside a real VSCodium
```

`npm run assets` shells out to `scripts/build-vscode.sh` in the parent
repository; the `.wasm` and the copied query are git-ignored on both sides so
they can never drift from the grammar they were built from.

### Tests

`npm test` runs three suites with Node's built-in runner:

- **`test/token-provider.test.js`** — the token pipeline (`src/tokens.js`)
  across all 46 files in `examples/`: every record in bounds, ordered, and
  covered by the legend; a golden assertion for `hello.fk`; multi-line nodes
  emitted once per covered line.
- **`test/textmate.test.js`** — the fallback grammar through `vscode-textmate`
  + `oniguruma`, the same tokenizer VS Code uses. Includes the case that
  actually matters for heredocs: a body line ending in the delimiter must not
  close the heredoc, while a line that is just the delimiter must.
- **`test/extension.test.js`** — `src/extension.js` activated against a
  stand-in for the VS Code API: the provider is registered, its output is a
  well-formed `Uint32Array`, the setting toggle falls back to TextMate, and a
  throwing document does not take the extension down.

The `hello.fk` golden lives in `test/golden.js`, shared by the headless test
and the integration test so the two can never drift.

### Integration test

```sh
cd vscode
npm run test:integration
```

Launches VSCodium with a temporary profile (the real one is never touched),
opens `examples/hello.fk`, activates the extension and asks VS Code's own
semantic token pipeline — `_provideDocumentSemanticTokensLegend` /
`_provideDocumentSemanticTokens` — for the result, then asserts it decodes to
exactly the shared golden, that the language id is `frankie`, and that flipping
`frankie.semanticHighlighting` off hands the file back to TextMate.

It is skipped, not failed, when VSCodium is not installed; set `VSCODIUM_PATH`
to point at another build (VS Code itself works — it is the same codebase).

## Packaging

```sh
cd vscode
npm run assets && npm install
npx @vscode/vsce package    # → frankie-<version>.vsix
code --install-extension frankie-<version>.vsix
```

To publish, `npx @vscode/vsce publish` (needs a Visual Studio Marketplace
personal access token).

## Settings

| Setting | Default | Effect |
|---|---|---|
| `frankie.semanticHighlighting` | `true` | Set to `false` to use the TextMate grammar alone. |
