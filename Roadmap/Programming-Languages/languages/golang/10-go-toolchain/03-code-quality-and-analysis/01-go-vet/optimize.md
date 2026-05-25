# go vet — Optimization

`go vet` is already fast — it shares the build cache and only typechecks (no codegen, no link). The exercises below tune it for **large repos** and **CI**, where small per-package savings add up. Numbers are illustrative; measure with `time` on your tree.

---

## Exercise 1: Warm the vet cache between CI runs

**Before** — every CI job starts with a cold `GOCACHE`; `go vet ./...` re-analyzes every package from scratch.

**After** — persist `~/.cache/go-build` and `~/go/pkg/mod` across jobs:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: go-${{ hashFiles('**/go.sum') }}
- run: go vet ./...
```

| Metric | Cold cache (200 pkgs) | Warm cache |
|--------|-----------------------|-----------|
| `go vet ./...` wall time | ~12s | ~0.3s |

The same cache that speeds up `go build` and `go test` speeds up `go vet`.

---

## Exercise 2: Vet only changed packages on PRs

**Before** — every PR vets the entire repo, even if it touched one file.

**After** — derive changed packages from git and vet only those:

```bash
PKGS=$(git diff --name-only origin/main...HEAD -- '*.go' \
  | xargs -I{} dirname {} \
  | sort -u \
  | sed 's|^|./|;s|$|/...|' )
[ -n "$PKGS" ] && go vet $PKGS
```

Run full `go vet ./...` on `main` post-merge for completeness.

| Metric | Full repo | Changed only |
|--------|-----------|--------------|
| Wall time on a 500-pkg repo | ~5s warm | ~0.2s |

This is the highest-leverage CI optimization for monorepos.

---

## Exercise 3: Parallelize via `-p`

`go vet` schedules per-package analysis in parallel up to `-p` (defaults to `GOMAXPROCS`). In constrained CI containers, the default can over- or under-subscribe.

```bash
go vet -p 4 ./...      # cap parallel work to actual CPU quota
```

| Metric | Default in 2-CPU container | `-p 2` |
|--------|----------------------------|--------|
| Throughput | Thrashing, slower | Matched, faster |

Match `-p` to the CI runner's actual CPU quota (not the host's vCPU count).

---

## Exercise 4: Disable expensive analyzers on huge trees

Some analyzers (especially SSA-based ones via `vettool`) are noticeably more expensive than the AST-only standard set. If you run a `vettool` (`staticcheck`, `nilness`, etc.), disabling rarely needed checks shortens the loop:

```bash
go vet -copylocks=false -unsafeptr=false ./big/tree/...
```

| Metric | All on | Selected off |
|--------|--------|--------------|
| Wall time on 1000-pkg subtree | ~6s | ~4s |

Only do this if profiling shows specific analyzers as the cost. Default is usually fine.

---

## Exercise 5: Replace `go test -vet=all` with explicit vet pass

**Before** — CI runs `go test -vet=all ./...`, which re-vets every package as part of the test job and conflates vet/test failures.

**After** — split into two stages that share the cache:

```bash
go vet ./...                       # one fast stage, clean failure signal
go test ./...                       # tests, with default (smaller) vet subset
```

| Metric | Combined | Split |
|--------|----------|-------|
| Wall time | t | t (cache shared) |
| Failure clarity | mixed | "vet failed" vs "test failed" |

You pay the same total cost, but failures are easier to triage and you can fail-fast on vet without launching test binaries.

---

## Exercise 6: Share `GOCACHE` across CI jobs

**Before** — each parallel job (lint, vet, test) has its own cache and re-analyzes everything.

**After** — point all jobs at a shared cache key derived from `go.sum` and the toolchain version:

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/go-build
    key: gocache-${{ runner.os }}-${{ env.GO_VERSION }}-${{ hashFiles('**/go.sum') }}
    restore-keys: |
      gocache-${{ runner.os }}-${{ env.GO_VERSION }}-
```

| Metric | Per-job cache | Shared cache |
|--------|---------------|--------------|
| First vet job | t | t |
| Subsequent vet job in same workflow | t (re-analyze) | ~0 (cached) |

Vet hashes the same inputs as build, so a cache populated by `go build` already serves vet.

---

## Exercise 7: Prefer vet over a heavier linter for fast feedback

**Before** — `make check` runs `golangci-lint run ./...` (~30s on a 500-pkg repo) on every save in a pre-commit hook. Developers disable the hook.

**After** — split feedback by latency:

```makefile
quick: ; go vet ./...                           # < 1s warm; runs on every save
slow:  ; go vet ./... && golangci-lint run ./... # runs pre-push or in CI
```

| Metric | golangci-lint always | vet first, lint pre-push |
|--------|----------------------|--------------------------|
| Inner-loop time | ~30s | ~0.3s |
| Developer adoption | Low (hook disabled) | High |

You catch the bug class vet covers immediately, then the broader checks at PR time.

---

## Exercise 8: Bundle analyzers into a single `unitchecker`

**Before** — CI runs `go vet`, then `staticcheck`, then your custom analyzer separately. Each step loads the package graph (the expensive part).

**After** — build a single `unitchecker` binary that registers vet + staticcheck + custom analyzers, then invoke it once via `-vettool`:

```go
// cmd/teamvet/main.go
package main
import (
    "golang.org/x/tools/go/analysis/unitchecker"
    "honnef.co/go/tools/analysis/code"
    "example.com/internal/nopanic"
    // ... vet's standard analyzers, staticcheck's, custom ...
)
func main() { unitchecker.Main(allAnalyzers...) }
```

```bash
go vet -vettool=$(go env GOBIN)/teamvet ./...
```

| Metric | Three separate tools | One unitchecker |
|--------|----------------------|------------------|
| Package loads | 3x | 1x |
| Total wall time | ~25s | ~9s |

This is how `golangci-lint` gets its speed advantage. For mature teams, it is the highest-leverage structural change.

---

## Measurement checklist
- [ ] Persist `GOCACHE` between CI runs (and across vet/build/test jobs).
- [ ] Vet only changed packages on PRs; full vet on `main`.
- [ ] Match `-p` to actual CPU quota in constrained containers.
- [ ] Split vet and test stages for clear failure signals.
- [ ] Use vet (not a heavy linter) in the inner loop for sub-second feedback.
- [ ] Bundle analyzers into one `unitchecker` to amortize package loading.
