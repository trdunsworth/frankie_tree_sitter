#!/usr/bin/env python3
"""Differential oracle: the upstream Frankie compiler vs this tree-sitter grammar.

For every fixture, both parsers must reach the SAME accept/reject verdict. A
disagreement fails the run unless the fixture is listed in
test/oracle/allowlist.txt with a documented reason (a difference this repo
accepts on purpose).

The reference side runs out of a checkout of github.com/atejada/Frankie, which
is GPL-licensed — nothing from it is vendored into this repo. `--ref-dir`
points at such a checkout; prepare it with:

    bash scripts/oracle/setup-ref.sh      # shallow-clones tag v1.22.3 → .oracle/Frankie

Fixture sets:
  * test/oracle/snippets/*.fk   — construct snippets written for this repo
  * test/oracle/malformed/*.fk  — inputs that must be REJECTED by both
  * <ref-dir>/**.fk             — every .fk in the upstream checkout (74 files
    at v1.22.3: examples/, examples/projects/, stitches/). These cover the
    constructs upstream itself ships, which is where grammar regressions in
    past releases first showed up (def parameter lists wrapped after a comma,
    heredocs in a call argument list).

The tree-sitter side takes its verdict off the tree (web-tree-sitter
`hasError`, via ../tree-status.mjs), NOT off `tree-sitter parse` output: a
missing EXTERNAL token — the `_heredoc_end` of an unterminated heredoc —
becomes a zero-width MISSING node that the CLI's printer omits, and the CLI
still exits 0. So build the wasm first (npm run build:wasm; test:wasm does it
too).

Exit status is 0 only when every fixture agrees, or every disagreement is
allowlisted.
"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SET_DIRS = (
    ("snippets", ROOT / "test" / "oracle" / "snippets"),
    ("malformed", ROOT / "test" / "oracle" / "malformed"),
)


class RefCompiler:
    """The upstream parser, imported in-process from a checkout of Frankie."""

    def __init__(self, ref_dir: str):
        self.dir = Path(ref_dir).resolve()
        if not (self.dir / "compiler").is_dir():
            raise SystemExit(
                f"no compiler package under {self.dir} — run\n"
                f"  bash scripts/oracle/setup-ref.sh\n"
                f"or pass --ref-dir <path to an atejada/Frankie checkout>."
            )
        sys.path.insert(0, str(self.dir))
        try:
            from compiler.lexer import LexError, Lexer  # noqa: F401
            from compiler.parser import ParseError, Parser  # noqa: F401
        except ImportError as exc:
            raise SystemExit(f"could not import the upstream compiler from {self.dir}: {exc}")
        self.Lexer = Lexer
        self.Parser = Parser
        self.lex_error = LexError
        self.parse_error = ParseError

    def accepts(self, source: str):
        try:
            tokens = self.Lexer(source).tokenize()
            self.Parser(tokens).parse()
        except (self.lex_error, self.parse_error) as exc:
            return False, f"{type(exc).__name__}: {exc}"
        except Exception as exc:  # noqa: BLE001 - a crash is still a rejection
            return False, f"crash: {type(exc).__name__}: {exc}"
        return True, ""


def ts_verdicts(paths, repo: Path):
    """One node process per BATCH: web-tree-sitter loads the wasm ONCE."""
    out = {}
    p = subprocess.run(
        ["node", str(repo / "scripts" / "tree-status.mjs"), *paths],
        cwd=repo, capture_output=True, text=True,
    )
    if p.returncode != 0:
        raise SystemExit(f"tree-status.mjs failed (exit {p.returncode}):\n{p.stderr}")
    for line in p.stdout.splitlines():
        verdict, _, path = line.partition(" ")
        if not path:
            continue
        out[path] = verdict == "OK"
    missing = [p for p in paths if p not in out]
    if missing:
        raise SystemExit(f"tree-status did not report: {missing}")
    return out


def load_allowlist(path: Path):
    allowed = {}
    if not path.exists():
        return allowed
    for line in path.read_text().splitlines():
        stripped = line.split("#", 1)[0].strip()
        if stripped:
            allowed[stripped] = line.split("#", 1)[1].strip() if "#" in line else ""
    return allowed


def main():
    ap = argparse.ArgumentParser(description="differential oracle vs the upstream Frankie compiler")
    ap.add_argument("--ref-dir", default=".oracle/Frankie",
                    help="checkout of atejada/Frankie (see scripts/oracle/setup-ref.sh)")
    ap.add_argument("--allowlist", default=None,
                    help="override the divergences-we-accept list (default test/oracle/allowlist.txt)")
    args = ap.parse_args()

    allowlist_path = Path(args.allowlist) if args.allowlist else ROOT / "test" / "oracle" / "allowlist.txt"
    allowed = load_allowlist(allowlist_path)
    fail = 0

    ref = RefCompiler(args.ref_dir)

    # Collect fixtures: (set label, file, allowlist key).
    fixtures = []
    for label, directory in SET_DIRS:
        if directory.is_dir():
            for f in sorted(directory.glob("*.fk")):
                fixtures.append((label, f, f"{label}/{f.name}"))
        else:
            print(f"== {label}: skipped, {directory} does not exist")
    ref_files = sorted(ref.dir.glob("**/*.fk"))
    for f in ref_files:
        fixtures.append(("upstream", f, f"upstream/{f.relative_to(ref.dir)}"))

    paths = [str(f.resolve()) for _, f, _ in fixtures]
    statuses = ts_verdicts(paths, ROOT)

    buckets = {}

    unlisted = []
    for label, f, key in fixtures:
        src = f.read_text()
        ref_ok, ref_msg = ref.accepts(src)
        ts_ok = statuses[str(f.resolve())]
        verdict = "both accept" if (ref_ok and ts_ok) else \
                  "both reject" if (not ref_ok and not ts_ok) else \
                  "TS rejects / REF accepts" if not ts_ok else \
                  "TS accepts / REF rejects"
        b = buckets.setdefault(label, {"both accept": 0, "both reject": 0,
                                       "TS rejects / REF accepts": 0,
                                       "TS accepts / REF rejects": 0})
        b[verdict] += 1
        if verdict in ("both accept", "both reject"):
            continue
        if key in allowed:
            print(f"  allowlisted ({verdict.strip().replace(' / ', '/')}): {key}: {allowed[key]}")
            continue
        fail += 1
        unlisted.append((label, verdict, key, ref_msg, src))

    for label, b in buckets.items():
        if not b:
            continue
        total = sum(b.values())
        disagreements = total - b["both accept"] - b["both reject"]
        print(f"== {label}: {total} fixtures — agree {b['both accept'] + b['both reject']}, "
              f"disagree {disagreements} "
              f"(gaps {b['TS rejects / REF accepts']}, too-lax {b['TS accepts / REF rejects']})")

    if unlisted:
        print("\nUNLISTED divergences (neither side agreed, not in the allowlist):")
        for label, verdict, key, ref_msg, src in unlisted:
            print(f"### {verdict}  [{label}] {key}")
            if ref_msg:
                print(f"    ref: {ref_msg}")
            for ln in src.strip().splitlines()[:8]:
                print(f"    | {ln}")
            print()
        raise SystemExit(1)
    if fail == 0:
        print("\nOK — every fixture agrees with the reference compiler "
              "(or is a documented, allowlisted divergence).")


if __name__ == "__main__":
    main()
