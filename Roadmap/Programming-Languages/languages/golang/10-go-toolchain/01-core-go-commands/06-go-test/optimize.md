# go test — Optimization

Make the test suite fast without sacrificing signal. Numbers are illustrative.

---

## Exercise 1: Lean on the test cache locally

**Before** — re-running the full suite after a one-line change re-executes everything.

**After** — let the cache skip unchanged packages:

```bash
go test ./...        # changed packages run; the rest print (cached)
```

| Metric | `-count=1` always | cache enabled |
|--------|-------------------|---------------|
| Re-run after 1-file change | full suite | only affected packages |

Only use `-count=1` when you specifically need a forced re-run (e.g., external state).

---

## Exercise 2: Parallelize within and across packages

**Before** — serial tests on a multi-core machine leave cores idle.

**After:**

```go
func TestX(t *testing.T) { t.Parallel(); /* ... */ }
```

```bash
go test -p 8 -parallel 8 ./...
```

| Metric | serial | parallel (8 cores) |
|--------|--------|--------------------|
| Suite wall time | 80s | ~15s |

Ensure parallel tests do not share mutable state, or `-race` will (correctly) complain.

---

## Exercise 3: Split fast unit from slow integration

**Before** — every PR runs DB/network integration tests, taking minutes.

**After** — gate them by tag:

```bash
go test ./...                    # fast unit gate on every PR
go test -tags=integration ./...  # slow suite on merge/schedule
```

| Metric | everything per PR | split |
|--------|-------------------|-------|
| PR feedback time | ~6 min | ~40s |

---

## Exercise 4: Use `-short` for the inner loop

**Before** — a few long-running tests slow every local run.

**After** — skip them in quick loops:

```go
if testing.Short() { t.Skip("skipping in -short") }
```

```bash
go test -short ./...     # quick local loop
go test ./...            # full suite in CI
```

| Metric | full local run | `-short` |
|--------|----------------|----------|
| Local loop time | 25s | 4s |

---

## Exercise 5: Cache compilation in CI

**Before** — CI recompiles all test binaries from cold each job.

**After:**

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: gotest-${{ hashFiles('**/go.sum') }}
```

| Metric | cold build | cached build |
|--------|-----------|--------------|
| Test compile time | ~60s | ~8s |

The test *result* cache is usually cold in CI, but the *build* cache massively speeds compilation.

---

## Exercise 6: Right-size parallelism for the CI quota

**Before** — defaults set `-p`/`-parallel` from the host's many cores in a 2-CPU container, oversubscribing and thrashing.

**After:**

```bash
go test -p 2 -parallel 2 ./...   # match the CPU quota
```

| Metric | oversubscribed | matched |
|--------|----------------|---------|
| Suite wall time | inflated | steady |

---

## Exercise 7: Reduce per-test setup with `TestMain`

**Before** — each test spins up an expensive fixture (e.g., a test container) independently.

**After** — share it once per package:

```go
func TestMain(m *testing.M) {
	startFixture()
	code := m.Run()
	stopFixture()
	os.Exit(code)
}
```

| Metric | per-test fixture | per-package fixture |
|--------|------------------|---------------------|
| Setup cost | N × startup | 1 × startup |

---

## Measurement checklist
- [ ] Use the test cache locally; `-count=1` only when needed.
- [ ] Add `t.Parallel()` and tune `-p`/`-parallel`.
- [ ] Tag slow integration tests; keep the PR gate fast.
- [ ] Use `-short` for the inner loop.
- [ ] Cache `GOCACHE`/`GOMODCACHE` in CI for fast compilation.
- [ ] Match parallelism to the CI CPU quota.
- [ ] Share expensive fixtures via `TestMain`.
