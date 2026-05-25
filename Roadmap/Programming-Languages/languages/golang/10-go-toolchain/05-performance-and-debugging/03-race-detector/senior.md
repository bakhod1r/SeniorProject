# Race Detector — Senior

## 1. Architecture: where in your pipeline `-race` belongs

Set the policy explicitly so reviewers do not relitigate it:

- **Always** in CI on the unit and integration test suites (gating PR merges).
- **Sometimes** in staging — a `-race` binary under realistic load for a bounded window (hours to a day) to catch races that only appear with real concurrency.
- **Never** in production by default. The 5–10x memory and 2–20x CPU cost is not a small surcharge to tolerate; it changes capacity planning, autoscaling, and SLOs.

The exception, used by some shops on critical paths: a small fraction of production replicas run with `-race` behind a feature flag, with their reports collected centrally. Worth doing only when the workload can absorb the overhead and you have already done the work in CI and staging.

---

## 2. Scope of instrumentation

A nuance teams routinely get wrong: in Go, `-race` instruments **the whole binary**, not selected packages. There is no "race for these packages only." Once you pass `-race` to `go test` or `go build`, every compiled package in the build graph is instrumented. The cache key includes `-race`, so race and non-race builds live side by side in `GOCACHE`.

Practical consequences:
- You cannot exclude a hot dependency from instrumentation to "speed up" the race build.
- Sub-selecting packages happens at the **test selection** level (`go test -race ./internal/cache/...`), not at instrumentation level.
- A pre-commit hook can scope `-race` to just changed packages to keep the inner loop fast; the full `-race` run happens in CI.

---

## 3. `//go:build race` — race-only test helpers

The toolchain defines a build tag `race` whenever the build is instrumented. Use it to gate code that only makes sense under the detector — e.g., expensive assertions, paranoid invariant checks, or test helpers that call `runtime/race.Enable/Disable` (internal-only) or that intentionally trigger the detector.

```go
//go:build race

package mypkg

// AssertNoRace runs only in -race builds; the non-race build excludes this file.
func AssertNoRace(v *Cache) { /* expensive deep checks */ }
```

```go
//go:build !race

package mypkg

func AssertNoRace(v *Cache) {} // cheap no-op for normal builds
```

This pattern lets you keep heavy diagnostic code in the repo without paying for it in non-race builds.

---

## 4. Designing tests that exercise concurrency

The detector is dynamic; it only sees what your tests run. Two patterns reliably widen the set of observed interleavings:

```go
func TestCacheConcurrent(t *testing.T) {
    t.Parallel()                 // run alongside other parallel tests
    c := NewCache()
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            c.Set(fmt.Sprintf("k%d", i), i)
            _ = c.Get(fmt.Sprintf("k%d", (i+1)%100))
        }(i)
    }
    wg.Wait()
}
```

Combine with `-count=N` and `-shuffle=on`:

```bash
go test -race -count=20 -shuffle=on ./...
```

Property-style tests work well here: spawn many workers, assert a global invariant at the end, and let the detector report any races on the way.

---

## 5. How sync primitives create the edges the detector sees

The detector recognises Go's happens-before edges (per the Go Memory Model):

| Primitive | Happens-before edge it establishes |
|-----------|------------------------------------|
| `sync.Mutex.Unlock` → next `Lock` | Everything before `Unlock` happens before everything after the matching `Lock` |
| `sync.RWMutex` | Same for `Lock`/`RLock` semantics |
| `chan` send → corresponding receive | Send-side state happens before receive-side observation |
| `chan` close → receive of zero-value | Close happens before all receivers observing the close |
| `sync.WaitGroup.Done` → `Wait` return | Done-side state happens before code after `Wait` |
| `sync.Once.Do` | The first execution happens before all subsequent `Do` returns |
| `sync/atomic` Load/Store with the same address | Sequentially consistent for the same variable |

If you "synchronize" with anything *not* on this list — `time.Sleep`, busy-spin on a non-atomic boolean, a global flag — the detector will (rightly) report races. That is the detector telling you your synchronization is invalid under the Go Memory Model, not a quirk of the tool.

---

## 6. "No race observed" is not "no race"

Reading detector output requires intellectual honesty:

- A clean `-race` run says: in the interleavings explored, no conflicting unsynchronized access was observed.
- It does **not** say: this code is race-free.
- Conversely: when the detector fires, the race exists. There is no "flaky detector."

Senior consequence: treat `-race` as part of your evidence base, not the whole of it. Pair it with:
- Code review for shared-state patterns.
- `go vet` and `staticcheck` (catch some known-bad patterns statically).
- Stress tests in CI (`-count`, `-shuffle`, parallel workers).
- Architectural review — *which goroutines own which data?* Most races are an unclear ownership story, not a missing mutex.

---

## 7. Race detector vs other sanitizers

| Sanitizer | What it finds | Flag |
|-----------|---------------|------|
| Race detector | Data races (Go-level) | `-race` |
| Memory sanitizer (MSan) | Uses of uninitialized memory (cgo / C deps) | `-msan` |
| Address sanitizer (ASan) | Buffer overflows, use-after-free (mostly cgo) | `-asan` |

`-race`, `-msan`, and `-asan` are **mutually exclusive** in the same build. Most pure-Go codebases only need `-race`; `-msan` and `-asan` become interesting when you have non-trivial cgo.

---

## 8. Investigating reproducibility

When a race appears in CI but not locally, the typical levers:

```bash
go test -race -count=100 -run=TestThatRaces ./pkg     # widen window
GOMAXPROCS=8 go test -race ./pkg                      # more real parallelism
go test -race -cpu=1,2,4,8 ./pkg                      # test under different P counts
```

`GOMAXPROCS` matters: on `GOMAXPROCS=1`, goroutines time-slice cooperatively and many real races never interleave. The detector can still report races on the same OS thread (it tracks logical happens-before, not actual concurrency), but in practice you observe far more with multiple Ps.

---

## 9. Summary

`-race` instruments the whole binary; you cannot scope it per-package, only per-test-selection. Always in CI, often in staging behind a flag, never in production by default. Use the `race` build tag for race-only diagnostic code, design tests with `t.Parallel`, `-count`, and `-shuffle` to widen observed interleavings, and remember the asymmetry: every report is real, but a clean run is not a proof. Architectural clarity around data ownership is what actually removes races; the detector is the dynamic check that catches the ones that slip through.

---

## Further reading
- Go Memory Model: https://go.dev/ref/mem
- Race detector article: https://go.dev/doc/articles/race_detector
- ThreadSanitizer paper (Google): https://research.google/pubs/pub35604/
