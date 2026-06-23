# goimports — Senior

## 1. The resolution pipeline, precisely

`goimports` is a **single-file** rewriter. Per invocation, per file, it does roughly:

1. Parse the file (`go/parser`) into an AST.
2. Apply `gofmt`-equivalent transforms.
3. Walk the AST to collect **unresolved names** that look like package selectors (`pkg.Symbol`) and **declared imports**.
4. For each unresolved package name, consult a **candidate package index** built from stdlib + module graph + module cache + (legacy) GOPATH.
5. For each candidate, verify it exports the requested symbol using `go/types` on the candidate package's API (loaded from cached export data when possible).
6. For each declared but unused import, drop it.
7. Re-emit the import block grouped by `-local` policy and write the file.

Step 5 is the expensive one: to confidently disambiguate, `goimports` may need to load the type system for several candidate packages. This is also why `goimports` is **slow** on large repos with deep dependency graphs — it can pull a non-trivial subset of the type graph into memory just to format one file.

---

## 2. Why `gopls organizeImports` is the modern replacement

`gopls` (the Go language server) already keeps the type-checked program in memory while you edit. Its `source.organizeImports` code action performs the same fixup `goimports` does, but:

- It uses **already-loaded** type information; no fresh package scan per file.
- It is incremental: when you edit one file, only that file is re-resolved.
- It honors the same `local` prefix policy via `gopls` settings.
- It runs over the LSP so every editor that speaks LSP gets identical behavior.

For day-to-day editing, `gopls organizeImports` (wired to format-on-save) is faster and more accurate than shelling out to `goimports`. The CLI `goimports` remains the right tool for batch fixups and CI checks where no language server is available.

---

## 3. Designing the CI policy

A pragmatic policy for a multi-engineer Go repo:

1. **Formatter is mandatory.** Merging is blocked if `goimports -l -local <prefix> .` is non-empty.
2. **Pin the `goimports` binary version** in CI. The output of `goimports` has changed in subtle ways across releases; if local and CI use different versions, you get a PR that passes for the author and fails for everyone else.
3. **One `-local` value, written down.** Put it in `Makefile`/`scripts/fmt.sh` so every invocation (local, CI, pre-commit) uses the same string.
4. **Run on every file under the repo, not just changed files.** A new dependency upgrade can change what is referenced; a per-file check misses the fallout. Running on `.` is fast enough for tens of thousands of files.
5. **Surface the diff.** A failing CI step that prints `goimports -d -local … .` is dramatically faster to fix than a bare "not formatted" message.

```bash
# scripts/fmt-check.sh
set -e
GOIMPORTS_VERSION=v0.24.0
go install golang.org/x/tools/cmd/goimports@${GOIMPORTS_VERSION}
diff=$(goimports -l -local example.com/myorg .)
if [ -n "$diff" ]; then
  echo "Unformatted files:"; echo "$diff"
  goimports -d -local example.com/myorg .
  exit 1
fi
```

---

## 4. The three-group import block convention

The community-standard layout:

```go
import (
    "context"          // stdlib
    "fmt"

    "github.com/google/uuid"   // third-party
    "go.uber.org/zap"

    "example.com/myorg/internal/db"   // local
    "example.com/myorg/pkg/util"
)
```

Rules to enforce in review:
- Exactly three groups, separated by a single blank line.
- Each group sorted lexically (`goimports` does this).
- Stdlib never mixes with third-party (`goimports` enforces this).
- Local prefix(es) are configured via `-local` (or `gopls`'s `local` setting). Without it, your local packages will appear mixed with third-party packages.

`goimports` defaults to **two** groups (stdlib / non-stdlib). The third group only appears when `-local` is provided. This is the most common reason a team's import blocks "look fine locally but CI rejects them" — one person ran `goimports` without `-local`.

---

## 5. Interaction with `gci` and `gofumpt`

Alternative formatters in the ecosystem:

- **`gofumpt`** — a stricter superset of `gofmt` (no import logic): enforces additional style rules `gofmt` does not (e.g., no leading blank line in functions, simplified composite literals). Pairs with `goimports` if you run them in order: `goimports` first, then `gofumpt`. They do not fight if you respect that order.
- **`gci`** — focused entirely on **import grouping**, with richer rules than `goimports -local` (e.g., four groups, custom prefixes, per-group sorting). Teams that need more than three groups (e.g., split internal vs vendor) move from `goimports` to `gci`. If you adopt `gci`, you usually keep it for grouping and let `gofumpt` handle the rest.

A common modern stack: `gofumpt` (formatting) + `gci` (imports). A common older stack: `goimports` only. Mixing all three without a strict order leads to formatter battles where each tool undoes the previous one.

---

## 6. Performance characterization

`goimports` work scales with:
- Number of unresolved identifiers per file (forces candidate lookup).
- Size of the candidate index (stdlib is constant; module cache grows with dependencies; GOPATH grows unboundedly).
- Whether export data is cached (cold cache → load full package source).

Typical numbers on a laptop:
- Small file in a fresh module: ~50ms.
- Large file (~2k LoC) in a repo with hundreds of dependencies: 200ms-1s per file.
- `goimports -w .` on a 5,000-file monorepo: tens of seconds.

If `goimports -w .` becomes painful in pre-commit, switch to **changed-files only**:

```bash
git diff --cached --name-only --diff-filter=ACM | grep '\.go$' | \
  xargs -r goimports -w -local example.com/myorg
```

Or move the full-tree check to CI only, and use `gopls organizeImports` in the editor for the inner loop.

---

## 7. Production-grade pitfalls

- **Generated files.** Some generators emit non-canonical imports that `goimports` rewrites, causing `go generate ./... && git diff --exit-code` to fail. Either configure the generator to emit clean output, or exclude generated files from formatter passes (`// Code generated ... DO NOT EDIT.` is a convention some tools respect).
- **Vendor directories.** `goimports -w .` will happily rewrite `vendor/`, which is almost never what you want. Exclude `vendor/` and other read-only trees explicitly.
- **CGO files.** `goimports` parses `.go` files; it ignores `.c`/`.h` but it will look at the `import "C"` block. It generally leaves the `import "C"` alone but the comment block above it has caused churn historically.
- **Version drift between editor and CI.** If your editor's `gopls` ships a different `goimports` internal version than your CI binary, two engineers can produce different "correct" output. Pin both.

---

## 8. When to *not* use `goimports`

- **In `gopls`-driven editors:** prefer the LSP `organizeImports` code action — it is faster and uses live type info.
- **In huge monorepos with custom layout:** `gci` gives you more control over grouping.
- **In codebases adopting `gofumpt`:** keep `goimports` for imports only or replace with `gofumpt + gci`.
- **In `go generate` pipelines that need stable output:** prefer formatters that are deterministic across versions (or pin aggressively).

---

## 9. Summary

`goimports` adds and removes imports by name-based candidate scanning against the module graph, which makes it slower than `gofmt` and occasionally wrong on ambiguous symbols. For interactive editing, prefer `gopls`'s `organizeImports`; for CI, run `goimports -l -local <prefix> .` against the whole tree with a pinned binary version. Document the `-local` prefix and enforce a three-group import layout in review, and decide deliberately whether to stay on `goimports` or move to a `gofumpt + gci` stack.

---

## Further reading
- `gopls` design overview: https://github.com/golang/tools/blob/master/gopls/doc/design/design.md
- `gci`: https://github.com/daixiang0/gci
- `gofumpt`: https://github.com/mvdan/gofumpt
