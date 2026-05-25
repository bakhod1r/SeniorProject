# staticcheck — Optimization

Staticcheck's cold-cache runtime is dominated by type-checking and SSA construction. Warm-cache runs are fast. These exercises cut wall time and CI minutes. Numbers are illustrative; measure on your machine with `time`.

---

## Exercise 1: Cache `GOCACHE` and the staticcheck cache between CI runs

**Before** — every CI job re-type-checks the whole module and rebuilds analyzer facts: tens of seconds to minutes.

**After** — persist both caches across jobs:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
      ~/.cache/staticcheck
    key: staticcheck-${{ runner.os }}-${{ hashFiles('**/go.sum') }}
```

| Metric | Cold cache | Warm cache |
|--------|-----------|-----------|
| `staticcheck ./...` (100k LOC) | ~60s | ~5s |

The staticcheck cache holds analyzer facts (deprecation, SSA-derived results); reusing it is what makes warm runs fast.

---

## Exercise 2: Pin the staticcheck version so the cache survives

**Before** — `go install staticcheck@latest` may install a new binary on each CI run; the cache is keyed partly on the staticcheck version, so a new binary invalidates everything.

**After:**

```bash
go install honnef.co/go/tools/cmd/staticcheck@v0.5.1
```

| Metric | `@latest` (binary changes) | pinned `@v0.5.1` |
|--------|---------------------------|------------------|
| Cache hit rate | low (frequent invalidation) | high (stable key) |

Pinning is both a *correctness* and a *performance* lever. Bump the version deliberately in its own PR.

---

## Exercise 3: Run only `-checks=SA*` in pre-commit

**Before** — full check set in pre-commit takes seconds and slows the inner loop. Engineers start using `git commit --no-verify`.

**After** — pre-commit runs the high-signal subset; full set runs in CI:

```bash
# .git/hooks/pre-commit (or via lefthook/pre-commit framework)
staticcheck -checks=SA* ./...
```

| Metric | full check set | `SA*` only |
|--------|---------------|------------|
| Pre-commit time | ~6s | ~2s |

`SA*` catches real bugs locally; let the full set run in CI where time is cheaper. Do not skip linting locally entirely — only narrow it.

---

## Exercise 4: Tune concurrency for constrained CI

Staticcheck parallelizes analyzer work using `runtime.GOMAXPROCS`. Inside a container with a CPU quota lower than the host CPU count, the default oversubscribes and thrashes.

**Before** — 16-core host, container limited to 2 cores; staticcheck spawns 16 workers fighting over 2 CPUs.

**After:**

```bash
staticcheck -debug.max-concurrent-jobs=2 ./...
```

| Metric | default (oversubscribed) | matched to quota |
|--------|--------------------------|------------------|
| Wall time | ~25s | ~10s |

Match the flag to the actual container CPU limit. Also set `GOMAXPROCS=2` so the Go runtime itself does not oversubscribe.

---

## Exercise 5: Exclude vendor/generated directories

**Before** — `staticcheck ./...` analyzes `vendor/`, generated mocks, protobuf output: minutes of wasted work and noisy findings you cannot fix.

**After** — restrict the package set and use file-level ignores in generated files:

```bash
# Only your own code
staticcheck $(go list ./... | grep -v /vendor/ | grep -v /gen/)
```

For protobuf/mock files, add at the top:

```go
//lint:file-ignore U1000 generated code
//lint:file-ignore SA1019 generated code may use legacy APIs
```

| Metric | scans vendor + generated | restricted |
|--------|--------------------------|------------|
| Wall time | ~40s | ~12s |
| Noise findings | hundreds | ~0 |

Most generators do not output staticcheck-clean code; analyzing them is wasted budget.

---

## Exercise 6: Reuse the analyzer cache via `golangci-lint`

**Before** — running `golangci-lint run ./...` (which includes staticcheck) and then `staticcheck ./...` separately doubles the work because each tool has its own cache.

**After** — pick one entry point per CI step:

```bash
# Option A: golangci-lint only (single cache, slightly older staticcheck)
golangci-lint run ./...

# Option B: staticcheck only (latest checks, dedicated cache)
staticcheck -set_exit_status ./...
```

| Metric | both | one entry point |
|--------|------|-----------------|
| CI wall time | ~30s | ~15s |

If you need both for different check coverage, run them in **parallel** CI steps on the same caches, not sequentially.

---

## Exercise 7: Prefer `gopls` analyzers in the IDE

**Before** — your editor runs `staticcheck` on save via a file-watcher: full-package analysis on every keystroke pause, seconds of latency.

**After** — let `gopls` surface staticcheck analyzers inline. Enable in your editor's `gopls` settings:

```json
{
  "gopls": {
    "staticcheck": true
  }
}
```

| Metric | external watcher | gopls integration |
|--------|------------------|-------------------|
| Feedback latency on save | ~2s | sub-second (incremental) |

`gopls` shares its type-checked state across saves, so it only re-runs the analyzers that depend on the changed file. Reserve the CLI for pre-commit and CI.

---

## Exercise 8: Run on changed packages only in PR checks

**Before** — every PR re-runs staticcheck on the whole repo, even one-line changes.

**After** — compute affected packages from the diff and pass only those:

```bash
PKGS=$(git diff --name-only origin/main... | grep '\.go$' \
  | xargs -n1 dirname | sort -u | sed 's|^|./|' | sort -u)
[ -n "$PKGS" ] && staticcheck -set_exit_status $PKGS
```

| Metric | full repo | changed packages only |
|--------|-----------|----------------------|
| PR check time (small diff) | ~30s | ~3s |

Caveat: cross-package effects (e.g., adding a deprecation comment) may be missed; keep a nightly full-repo run as a safety net.

---

## Measurement checklist
- [ ] Persist `~/.cache/go-build`, `~/go/pkg/mod`, and `~/.cache/staticcheck` in CI.
- [ ] Pin the staticcheck binary version so the cache is not invalidated per run.
- [ ] Limit pre-commit to `-checks=SA*` for the inner loop.
- [ ] Cap `-debug.max-concurrent-jobs` to the container's CPU quota.
- [ ] Exclude `vendor/` and generated code from analysis.
- [ ] Choose `golangci-lint` *or* standalone staticcheck per step; do not duplicate.
- [ ] Enable staticcheck via `gopls` in the editor; reserve the CLI for pre-commit/CI.
