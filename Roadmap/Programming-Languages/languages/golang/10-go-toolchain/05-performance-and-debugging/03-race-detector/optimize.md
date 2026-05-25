# Race Detector — Optimization

`-race` is expensive (2x–20x CPU, 5x–10x memory). These exercises reduce when and how you pay for it without losing coverage. Numbers are illustrative; measure on your workload.

---

## Exercise 1: Scope pre-commit to changed packages

**Before** — pre-commit runs `go test -race ./...` on every commit; even a 1-line change retests the world.

```bash
go test -race ./...     # 4m20s on a medium repo
```

**After** — restrict to packages that changed (and their reverse deps in a follow-up step):

```bash
CHANGED=$(git diff --cached --name-only | grep '\.go$' \
         | xargs -n1 dirname | sort -u \
         | sed 's|^|./|')
[ -n "$CHANGED" ] && go test -race -count=1 $CHANGED
```

| Metric | full suite | changed packages |
|--------|------------|------------------|
| Pre-commit time | ~4m20s | ~12s |
| Coverage | full | scoped (CI still runs full) |

Keep the full `-race ./...` in CI — locally you only want fast feedback.

---

## Exercise 2: Run `-race` on integration tests only when budget is tight

**Before** — every unit test runs under `-race` in CI, doubling the unit suite from 2 minutes to ~6 minutes.

**After** — split jobs by tag:

```bash
go test -count=1 ./...                              # fast unit tests, no -race
go test -race -tags=integration -count=1 ./...      # heavier suite, race-instrumented
```

| Metric | always -race | split jobs |
|--------|--------------|------------|
| PR feedback time | 6 min | 2 min (unit) + 6 min (race, parallel) |
| Race coverage | every test | every integration test (the ones that actually exercise concurrency) |

Trade-off: pure unit tests with no goroutines barely benefit from `-race`. Spending the cycles on integration tests is usually better signal-per-second.

---

## Exercise 3: Tune `GORACE=history_size`

**Before** — race reports often show "Previous access" with an empty or shallow stack — the event was evicted from the history buffer before the report fired.

```bash
go test -race ./...
# WARNING: DATA RACE
# Read at 0x... by goroutine 42:
#   <full stack>
# Previous write at 0x...: <no stack — history overrun>
```

**After:**

```bash
GORACE='history_size=7' go test -race ./...
```

| Metric | default history (log2=1) | history_size=7 |
|--------|--------------------------|----------------|
| Per-goroutine event memory | low | ~64x higher per goroutine |
| Report quality | sometimes truncated | full stacks for distant prior accesses |

Use the max only when you actually have a race that the default history can't trace; otherwise the memory cost adds up across many goroutines.

---

## Exercise 4: Parallelize across packages with `-p`

**Before** — `go test -race ./...` on an 8-core machine but `-p` defaults to the CPU count without coordinating with `-race`'s already-high per-process cost.

```bash
go test -race ./...   # OOMs occasionally because each test process is 5x RSS
```

**After** — cap parallelism to fit memory:

```bash
go test -race -p 4 ./...   # 4 test packages run in parallel instead of 8
```

| Metric | -p=8 (default) | -p=4 (constrained) |
|--------|----------------|--------------------|
| Peak RSS | 18 GB | 10 GB |
| Wall time | 7m (with swapping) | 5m (no swap) |

Counterintuitively, fewer parallel processes can be faster under `-race` because each one is heavier.

---

## Exercise 5: `-race` in staging via rolling restart

**Before** — to catch staging-only races, the team flips a staging deploy to `-race` for an hour, then rolls back. During that hour everything is 5x slower; downstream tests timeout.

**After** — bake a `-race` build, deploy it to **one** replica of the staging fleet at a time, drain traffic to a manageable share, and ship reports to logs:

```bash
go build -race -o staging-app ./cmd/server
# deploy to 1 of N pods; GORACE='log_path=/var/log/race halt_on_error=0'
```

| Metric | full fleet -race | 1-replica canary |
|--------|------------------|-------------------|
| Latency impact on staging users | 5x p99 | small share affected |
| Coverage of real interleavings | full | high (real traffic, real concurrency) |

Tail latencies stay sane and you still get representative race reports.

---

## Exercise 6: Separate race job in CI

**Before** — race tests block the merge queue; PRs sit waiting on a 12-minute race step before any other check completes.

**After** — split the workflow so race is a parallel job, not a serial step:

```yaml
jobs:
  unit:      { runs-on: ubuntu-latest, steps: [ ..., go test ./... ] }
  race:      { runs-on: ubuntu-latest, steps: [ ..., go test -race ./... ] }
  lint:      { runs-on: ubuntu-latest, steps: [ ..., go vet ./... ] }
```

| Metric | serial | parallel jobs |
|--------|--------|----------------|
| Wall time on PR | unit + race + lint = 18m | max(unit, race, lint) = 12m |
| Fast-fail signal | only after 18m | unit/lint fail in 3m, race in 12m |

You get the same race coverage but engineers stop waiting on it for unrelated feedback.

---

## Exercise 7: Use `sync/atomic` for hot single-word state

**Before** — a hot counter incremented from many goroutines uses `sync.Mutex`. Under `-race`, the mutex acquisition path is instrumented heavily; benchmarks under `-race` show ~8x slowdown.

```go
mu.Lock(); counter++; mu.Unlock()
```

**After:**

```go
atomic.AddInt64(&counter, 1)
```

| Metric | Mutex (under -race) | atomic.AddInt64 (under -race) |
|--------|---------------------|-------------------------------|
| ns/op | ~450 ns | ~70 ns |
| Race-safety | yes | yes (atomic establishes the edge) |

Bonus: the production (non-`-race`) build is also faster. Use atomics for single-word state; reserve mutexes for invariants spanning multiple fields.

---

## Exercise 8: Exclude vendor/ and generated code

**Before** — `go test -race ./...` includes `./vendor/...` (if you vendor) and re-instruments third-party packages that already passed their own tests.

**After:**

```bash
go test -race $(go list ./... | grep -v /vendor/ | grep -v /gen/)
```

| Metric | with vendor/gen | excluded |
|--------|-----------------|----------|
| Wall time | 9 min | 5 min |
| Coverage | duplicate (vendor already tested upstream) | your code only |

Most modern repos do not vendor, but generated test-only code (gomock, protoc, etc.) is worth excluding too.

---

## Measurement checklist
- [ ] Local pre-commit is scoped to changed packages.
- [ ] CI splits unit and race into parallel jobs.
- [ ] `GORACE=history_size` is tuned only when reports lose stacks.
- [ ] `-p` is set to fit memory under `-race` on constrained runners.
- [ ] Staging uses a canary replica with `-race`, not the whole fleet.
- [ ] Hot single-word counters use `sync/atomic`, not `sync.Mutex`.
- [ ] `vendor/` and generated code are excluded from the race test list.
- [ ] Benchmarks never run with `-race` (the numbers are not real).
