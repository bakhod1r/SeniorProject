# goimports — Optimization

`goimports` is fast per file but does non-trivial work per run: candidate scanning, type-data loading, AST rewrite. These exercises shave repeated work or replace `goimports` where a faster path exists. Numbers are illustrative; measure with `time`.

---

## Exercise 1: Run on changed files in pre-commit

**Before** — the pre-commit hook runs `goimports -w .` over the entire repo on every commit:

```bash
goimports -w -local example.com/myorg .
```

On a 5,000-file repo this is tens of seconds even with a warm cache.

**After** — limit to staged Go files:

```bash
files=$(git diff --cached --name-only --diff-filter=ACM | grep '\.go$' || true)
[ -z "$files" ] && exit 0
goimports -w -local example.com/myorg $files
git add $files
```

| Metric | Whole tree | Staged files |
|--------|-----------|--------------|
| Typical pre-commit time | 20-45s | <0.5s |

Keep the full-tree check in CI for safety; keep the local hook fast.

---

## Exercise 2: Pin `goimports` version for cache reuse in CI

**Before** — CI installs `goimports@latest` every run, recompiling and re-downloading:

```bash
go install golang.org/x/tools/cmd/goimports@latest
goimports -l -local example.com/myorg .
```

Each CI job pays for `go install` (network + compile).

**After** — pin a specific version and cache `GOPATH/bin` (or use a pre-built tool image):

```bash
GOIMPORTS_VERSION=v0.24.0
go install golang.org/x/tools/cmd/goimports@${GOIMPORTS_VERSION}
goimports -l -local example.com/myorg .
```

Combine with `actions/cache` on `~/go/bin` keyed on the version string.

| Metric | `@latest` no cache | Pinned + cache |
|--------|--------------------|----------------|
| Install step | ~10-30s | ~0s (cache hit) |
| Cross-job consistency | drifts silently | identical |

---

## Exercise 3: Use `gopls organize_imports` in the editor

**Before** — the editor shells out to the `goimports` CLI on every save; cold candidate index per process start.

**After** — switch to `gopls`'s `source.organizeImports` code action, which reuses the language server's in-memory type info:

```jsonc
// VS Code
{
  "go.formatTool": "default",
  "[go]": {
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": { "source.organizeImports": "explicit" }
  }
}
```

| Metric | `goimports` CLI on save | `gopls organizeImports` |
|--------|-------------------------|--------------------------|
| Latency per save | 100ms-1s | 5-50ms |
| Memory per save | new process | reuses LSP session |

Keep the `goimports` CLI for CI; use `gopls` for the editor.

---

## Exercise 4: Batch invocation on changed files only

**Before** — a `make fmt` target formats everything every time:

```bash
goimports -w -local example.com/myorg .
```

**After** — operate on files changed since `main`:

```bash
files=$(git diff --name-only main...HEAD -- '*.go')
[ -z "$files" ] && exit 0
goimports -w -local example.com/myorg $files
```

| Metric | Full tree | Changed files |
|--------|-----------|---------------|
| Wall time | 10-30s | <1s typical |

This is the right default for local `make fmt`; reserve full-tree formatting for the rare "I bumped a dependency and want everything tidied" pass.

---

## Exercise 5: Exclude `vendor/` and generated trees

**Before** — `goimports -w .` descends into `vendor/`, mocks, and generated protobuf code, rewriting thousands of files you do not own:

```bash
goimports -w -local example.com/myorg .
```

**After** — explicit excludes:

```bash
find . -name '*.go' \
  -not -path './vendor/*' \
  -not -path '*/mocks/*' \
  -not -path '*/gen/*' \
  -print0 | xargs -0 goimports -w -local example.com/myorg
```

| Metric | Includes vendor/gen | Excluded |
|--------|---------------------|----------|
| Files rewritten on a clean repo | thousands (vendor) | only your code |
| Wall time | 30-60s | 2-5s |
| Diff noise | huge | none |

---

## Exercise 6: Parallelize with `xargs -P`

**Before** — single-process `goimports` walks the tree serially:

```bash
goimports -w -local example.com/myorg .
```

On many cores this leaves most of them idle.

**After** — fan out across cores in batches:

```bash
find . -name '*.go' -not -path './vendor/*' -print0 | \
  xargs -0 -P 8 -n 50 goimports -w -local example.com/myorg
```

`-P 8` runs 8 parallel `goimports` processes; `-n 50` gives each batch 50 files so per-process startup overhead amortizes.

| Metric | Serial | 8-way parallel |
|--------|--------|----------------|
| Wall time on 5k files | ~30s | ~6s |

Caveat: each process builds its own candidate index, so `-P` saturates memory faster than a single process. Tune `-P` to your core count and RAM headroom.

---

## Exercise 7: Replace with `gofumpt` (if you want stricter rules)

**Before** — your team is debating extra style rules `gofmt`/`goimports` do not enforce (e.g., no leading blank line in functions, simplified composite literals). PRs churn on style nits.

**After** — adopt `gofumpt` for layout and either keep `goimports` for imports or switch to `gci`:

```bash
# Option A: goimports + gofumpt (in this order)
goimports -w -local example.com/myorg .
gofumpt -w .

# Option B: gci + gofumpt (no goimports needed for import grouping)
gci write --skip-generated -s standard -s default -s "prefix(example.com/myorg)" .
gofumpt -w .
```

| Metric | `goimports` only | `gofumpt` (+ optional `gci`) |
|--------|------------------|-------------------------------|
| Style rules enforced | minimal | strict |
| PR style debate | recurring | eliminated |
| Setup complexity | low | medium |

This is a one-time PR over the entire repo — piecemeal migrations create merge conflicts.

---

## Exercise 8: Cache `GOMODCACHE` so candidate scans are warm

**Before** — CI starts each job with an empty `~/go/pkg/mod`; `goimports` scans an empty cache and finds candidates only in stdlib + your module.

**After** — persist `~/go/pkg/mod` and `~/.cache/go-build` across CI jobs (e.g., `actions/cache` keyed on `go.sum`):

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: go-${{ hashFiles('**/go.sum') }}
```

| Metric | Cold cache | Warm cache |
|--------|-----------|-----------|
| First `goimports` invocation | 5-15s | <1s |
| Whole-tree check on 5k files | 60-90s | 10-30s |

---

## Measurement checklist
- [ ] Use staged files in pre-commit; whole tree only in CI.
- [ ] Pin the `goimports` binary version everywhere.
- [ ] Prefer `gopls organizeImports` in the editor.
- [ ] Exclude `vendor/`, mocks, and generated trees explicitly.
- [ ] Parallelize bulk runs with `xargs -P` tuned to cores and RAM.
- [ ] Cache `GOMODCACHE` and `GOCACHE` in CI between jobs.
- [ ] Consider migrating to `gofumpt + gci` for stricter rules.
