# Differential oracle (`test/oracle/`)

The strongest test of this grammar asks the question the repo was audited
against: **does it accept/reject exactly what the Frankie compiler accepts and
rejects?** `scripts/oracle/run.py` answers it by running both parsers over
every fixture and failing on any disagreement that isn't deliberately
allowlisted in `test/oracle/allowlist.txt`.

```bash
npm run build:wasm                    # the web-tree-sitter side needs the wasm
bash scripts/oracle/setup-ref.sh      # shallow-clones tag v1.22.3 → .oracle/Frankie
npm run test:oracle                   # python3 scripts/oracle/run.py
```

## Fixture sets

| Set | Where | Whose | What it guards |
|---|---|---|---|
| `upstream/` | cloned at run time, never committed | upstream | every `.fk` in the reference checkout (74 files at v1.22.3: `examples/`, `examples/projects/`, `stitches/`) — the constructs the language itself ships, where past grammar regressions (multi-line `def` parameters, heredocs in a call argument) first showed up |
| `snippets/` | vendored | this repo | 181 construct snippets, one per language feature/boundary |
| `malformed/` | vendored | this repo | 30 inputs both parsers must REJECT (unterminated string/heredoc, missing `end`, stray keyword…) |

## Why nothing upstream is committed here

`atejada/Frankie` is **GPL-3.0**. This grammar is MIT, and this repo deliberately does not vendor upstream source or example files: the oracle clones the pinned tag at run time, uses it read-only, and the checkout lives in `.oracle/` (git-ignored). Deleting the directory restores a clean tree. `test/oracle/snippets/` and `test/oracle/malformed/` are written for this repo are unaffected by the reference's licence.

Only the vendored 46 `examples/*.fk` are upstream copies — they predate the licence decision above and exist so `npm run test:examples` works offline. Treat them as test data under the upstream licence (see README "Ground truth").

## Enlisting a divergence, and the rule about the list

If the reference and this grammar legitimately disagree — say a construct is
laxer here than upstream wants — add ONE line to `test/oracle/allowlist.txt`:

```
snippets/attr_write.fk    # attribute assignment: accepted here, upstream only allows index assignment
```

And state why it's on purpose. The list is a contract, not a scratchpad:

* With no `#`-reason column the run fails (the driver ignores malformed lines
  and flags the fixture instead).
* A divergence the entry describes disappearing changes nothing — the entry
  then describes a case that agrees, and should be DELETED rather than left
  to rot. `python3 scripts/oracle/run.py` prints allowlisted entries each run,
  so dead ones are easy to spot.

## Pinning

`scripts/oracle/setup-ref.sh` clones **tag `v1.22.3`**
(`fa913c7dfd90767c0a47add536c6b05c560929a0`) so both runs of the same
workflow see the same upstream. Override with `FRANKIE_REF_TAG=…` for new
releases — the tag is the version this grammar tracks.

## What's not in CI

The language book's **777 code-block corpus** from the audit is not part of
any workflow: the blocks were extracted from the book PDF, not from
`docs/*.md` (which has 18 fenced `fk` blocks), and can't be rebuilt from a
clone. It stays a local-only check from the audit run; the vendored sets above
cover the same behaviours.
