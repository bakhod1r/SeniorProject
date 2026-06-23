# Go Defer — Optimize

## Instructions

This document covers the cost of `defer` and how to optimize it (or avoid it) when it matters. Each section presents a problem, a measurement, and an optimization where applicable. Difficulty: Easy, Medium, Hard.

We assume Go 1.22+ on amd64. All benchmarks use `go test -bench` with `-benchtime=2s -count=5`. Numbers are typical, not exact — your mileage will vary by CPU.

---

## 1. The Cost Model

| Path | Per-defer cost | When picked |
|------|----------------|-------------|
| Direct call (no defer) | ~1-3 ns | Baseline |
| Open-coded defer (Go 1.14+) | ~3-7 ns | ≤ 8 defers, none in loop, no recover-from-non-deferred |
| Stack-allocated defer | ~12-15 ns | Ineligible for open-coded, count bounded |
| Heap-allocated defer | ~30-50 ns | Defer inside a loop, or count unbounded |

Critical thresholds:
- **9 defers** in a function disqualify open-coded — drop to stack-allocated.
- **One defer inside a loop** disqualifies the entire function from open-coded.
- **Calling `recover` from outside a deferred function** in the same function disables open-coded.
- **`-gcflags=-N`** (no optimization) disables open-coded.

---

## 2. Baseline Benchmark

A minimal benchmark to establish numbers on your machine.

```go
package deferbench

import (
    "sync"
    "testing"
)

var mu sync.Mutex

//go:noinline
func work() {}

func directCall() {
    mu.Lock()
    work()
    mu.Unlock()
}

func openCodedDefer() {
    mu.Lock()
    defer mu.Unlock()
    work()
}

func deferInLoop() {
    for i := 0; i < 1; i++ {
        mu.Lock()
        defer mu.Unlock()
        work()
    }
}

func BenchmarkDirectCall(b *testing.B) {
    for i := 0; i < b.N; i++ {
        directCall()
    }
}

func BenchmarkOpenCoded(b *testing.B) {
    for i := 0; i < b.N; i++ {
        openCodedDefer()
    }
}

func BenchmarkLoopDefer(b *testing.B) {
    for i := 0; i < b.N; i++ {
        deferInLoop()
    }
}
```

Typical result on Go 1.22, M1, single-threaded:
```
BenchmarkDirectCall-8    150000000   8.0 ns/op    0 B/op   0 allocs/op
BenchmarkOpenCoded-8     120000000  12.5 ns/op    0 B/op   0 allocs/op
BenchmarkLoopDefer-8      30000000  60.0 ns/op   16 B/op   1 allocs/op
```

The ~4ns overhead of open-coded defer is invisible in any real workload. The 60ns loop-defer (with allocation!) shows up in profiles.

---

## 3. Exercise 1 (Easy) — Defer In Hot Loop

**Problem**:

```go
func processAll(items []Item) {
    for _, it := range items {
        func() {
            defer it.Cleanup()
            it.Process()
        }()
    }
}
```

Even though `it.Process` is the hot work, the per-iteration defer adds cost.

**Question**: How much overhead per iteration, and what's the fix?

<details><summary>Solution</summary>

The closure isn't strictly inside a loop (the defer is inside an anonymous function called from a loop), but it allocates on every iteration if the anonymous function escapes.

**Optimization 1 — Inline cleanup**:
```go
func processAll(items []Item) {
    for _, it := range items {
        it.Process()
        it.Cleanup()
    }
}
```

If `Process` can panic and you need cleanup, this is a regression. Use option 2.

**Optimization 2 — Helper function**:
```go
func processAll(items []Item) {
    for _, it := range items {
        processOne(it)
    }
}

func processOne(it Item) {
    defer it.Cleanup()
    it.Process()
}
```

`processOne` qualifies for open-coded defer (one defer, no loop). Cost is ~3-7 ns/call instead of ~30-50 ns/call.

**Benchmark**:
- Inline anon-func with defer: 60 ns/op (heap-allocated path)
- Helper function: 12 ns/op (open-coded path)

**Key insight**: a defer inside a loop, even if syntactically wrapped in an anonymous function, drops to the heap path because the compiler can't bound the count. Extract a real top-level function.
</details>

---

## 4. Exercise 2 (Easy) — 9 Defers Crossing The Threshold

**Problem**:
```go
func setup() {
    defer cleanup1()
    defer cleanup2()
    defer cleanup3()
    defer cleanup4()
    defer cleanup5()
    defer cleanup6()
    defer cleanup7()
    defer cleanup8()
    defer cleanup9() // crosses the 8-defer threshold
    work()
}
```

**Question**: What's the cost difference between 8 and 9 defers?

<details><summary>Solution</summary>

8 defers stay on the open-coded fast path. 9 defers drop to stack-allocated.

**Benchmark**:
- 8 defers: ~30 ns/op (8 × ~3.5 ns each)
- 9 defers: ~135 ns/op (9 × ~15 ns each)

A 4× regression for adding one defer.

**Optimization** — combine into one defer if logically possible:
```go
func setup() {
    defer cleanupAll()
    work()
}

func cleanupAll() {
    cleanup1(); cleanup2(); ...
}
```

Or split the function so each part has ≤ 8 defers.

**Key insight**: the 8-defer threshold is a hard cliff. If a function is on the boundary, every additional defer is expensive.
</details>

---

## 5. Exercise 3 (Medium) — Recover Disqualifies Open-Coded

**Problem**:
```go
func safeFn() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    risky()
    return nil
}
```

**Question**: Does `recover` disqualify open-coded defer?

<details><summary>Solution</summary>

**Answer**: When `recover()` is called from inside a deferred closure, open-coded defer **still works** (the runtime supports recover in open-coded). The compiler emits the necessary metadata for `runtime.runOpenDeferFrame` to handle the recover correctly.

What disables open-coded is calling `recover` from a function NOT directly invoked by defer in the same function. That pattern is rare and broken anyway.

**Benchmark**:
- recover-in-defer (above): ~12 ns/op (open-coded; same as any defer)
- No recover at all: ~12 ns/op

No measurable difference. Recover-in-defer is free relative to defer.

**Key insight**: don't worry about recover-in-defer cost. It's the same as any defer. The cost only blows up if you *actually* panic, which is exceptional.
</details>

---

## 6. Exercise 4 (Medium) — Mutex Hot Path

**Problem**: a high-throughput cache with millions of get/set per second:

```go
func (c *Cache) Get(key string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.data[key]
}
```

Profile shows `Cache.Get` is hot. The defer is ~4 ns of ~30 ns total per call (~13%).

**Question**: should you remove the defer?

<details><summary>Solution</summary>

**Analysis**: 4 ns × N calls/sec is real on hot paths. For a path that's truly the bottleneck, removing the defer can recover 10-15% of latency.

**Optimization**:
```go
func (c *Cache) Get(key string) string {
    c.mu.RLock()
    v := c.data[key]
    c.mu.RUnlock()
    return v
}
```

**Benchmark** (1M ops, simulated):
- With defer: 30 ns/op
- Without defer: 26 ns/op

**Caveat**: now the function panics if `c.data[key]` panics (e.g., the map is nil). The defer would have unlocked even on panic. With the explicit unlock, a panic between RLock and RUnlock leaves the lock held and the goroutine dies — which then deadlocks every other reader/writer.

For a pure map read this isn't a real risk (map reads don't panic on missing keys). For more complex critical sections, keep the defer.

**Cockroachdb's pattern**: extract the work into a `Locked` helper to keep the lock acquisition explicit and the cleanup explicit:

```go
func (c *Cache) Get(key string) string {
    c.mu.RLock()
    v := c.getLocked(key)
    c.mu.RUnlock()
    return v
}

func (c *Cache) getLocked(key string) string {
    return c.data[key]
}
```

**Key insight**: profiling first is essential. Don't skip defer because "defer is slow"; skip it when profile data shows it matters.
</details>

---

## 7. Exercise 5 (Medium) — Heap Allocation Profile

**Problem**:
```go
func process(items []Item) {
    for _, it := range items {
        defer it.Close()
    }
    // ...
}
```

**Question**: how much memory is allocated?

<details><summary>Solution</summary>

Each iteration allocates one `_defer` record on the heap. The record is ~48 bytes on amd64 (after Go 1.17 ABI changes).

Plus, the captured `it` pinns the item alive until the function returns.

**Benchmark with `-benchmem`**:
```
BenchmarkLoopDefer-8   30000000  60 ns/op  48 B/op  1 allocs/op
```

Per-iter: 1 allocation, 48 bytes.

For 1M items: 1M allocations, ~48 MB of `_defer` records + indirect pin of all items.

**Optimization**: extract a helper:
```go
func process(items []Item) {
    for _, it := range items {
        processOne(it)
    }
}

func processOne(it Item) {
    defer it.Close()
    // ...
}
```

**Benchmark**:
- Loop with defer: 60 ns/op, 48 B/op, 1 alloc/op
- Helper-call pattern: 12 ns/op, 0 B/op, 0 allocs/op

**Key insight**: defer-in-loop is one of the few cases where defer measurably hurts. The fix is small (extract a function) and the benefit is large (eliminate per-iter allocation).
</details>

---

## 8. Exercise 6 (Medium) — Defer Vs Manual Cleanup In `Close`

**Problem**: a struct's Close method:
```go
func (s *Service) Close() error {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.closed { return nil }
    s.closed = true
    if err := s.conn.Close(); err != nil {
        return err
    }
    return s.db.Close()
}
```

**Question**: is the defer worth it here?

<details><summary>Solution</summary>

**Analysis**: `Close()` is called once per Service lifetime. The defer cost is irrelevant. Keep the defer for safety against panic.

**Benchmark**:
- With defer: 12 ns/op
- Without defer: 8 ns/op

In absolute terms, 4 ns once per Service lifetime is invisible.

**Key insight**: cost only matters on hot paths. One-time-per-instance functions can use defer freely.
</details>

---

## 9. Exercise 7 (Hard) — Trace Span With Negligible Overhead

**Problem**: every public method has a trace:
```go
func (s *Service) Foo(ctx context.Context, req *Req) (resp *Resp, err error) {
    defer trace(ctx, "Foo", &err)()
    // ...
}
```

The deferred trace closure logs duration and error.

**Question**: what's the cost?

<details><summary>Solution</summary>

The trace helper:
```go
func trace(ctx context.Context, name string, errp *error) func() {
    start := time.Now()
    return func() {
        elapsed := time.Since(start)
        if *errp != nil {
            metrics.Observe(name+".error", elapsed)
        } else {
            metrics.Observe(name+".success", elapsed)
        }
    }
}
```

Cost breakdown:
- `trace(...)` call: ~50 ns (allocates the closure if it escapes)
- `defer ...()`: ~12 ns (open-coded)
- Closure execution at exit: ~30 ns (time.Since + Observe)

Total: ~92 ns per call. For a function that takes 100 microseconds, that's 0.1% — invisible.

**Optimization** (only if measured to matter): use a stack-allocated trace context:
```go
func (s *Service) Foo(ctx context.Context, req *Req) (resp *Resp, err error) {
    var span Span
    span.Start(ctx, "Foo")
    defer span.End(&err)
    // ...
}
```

`Span` is a struct on the stack; no heap allocation. The defer of a method call is open-coded.

**Benchmark**:
- Closure-based trace: 92 ns/op + 1 alloc
- Stack span: 65 ns/op + 0 allocs

**Key insight**: deferred closures allocate when they escape. For tight observability paths, prefer stack-allocated trace structs.
</details>

---

## 10. Exercise 8 (Hard) — PGO And Defer

**Problem**: a function with one defer is called from a hot loop:
```go
func main() {
    for i := 0; i < N; i++ {
        helper()
    }
}

func helper() {
    mu.Lock()
    defer mu.Unlock()
    work()
}
```

**Question**: does PGO help?

<details><summary>Solution</summary>

PGO (profile-guided optimization, Go 1.20+) can:
- Inline `helper` into `main`'s loop body, even though it has a defer.
- Devirtualize indirect calls if the profile shows one target dominating.

For this specific case, the defer's open-coded path makes the function eligible for inlining (Go's inliner handles open-coded defers since ~1.18). PGO can boost the inlining decision based on call frequency.

**Setup**:
```bash
go build -o app
./app -cpuprofile=default.pgo
go build -pgo=default.pgo -o app2
```

**Benchmark**:
- Without PGO: 12 ns/op (defer is open-coded; helper not inlined)
- With PGO: 8 ns/op (helper inlined)

A 33% improvement, but only because PGO inlined the wrapper.

**Key insight**: PGO doesn't change defer's cost directly, but it can eliminate function-call overhead around defer-using helpers in hot paths.
</details>

---

## 11. Exercise 9 (Hard) — Pre-1.14 Era Code Migration

**Problem**: code written for Go 1.10 explicitly avoided defer for performance:
```go
// Pre-1.14 hot path: avoid defer for ~30 ns/call savings
func get(key string) string {
    mu.RLock()
    v := data[key]
    mu.RUnlock()
    return v
}
```

After upgrading to Go 1.14+, the cost of defer dropped from ~30 ns to ~4 ns.

**Question**: should you re-add the defer?

<details><summary>Solution</summary>

**Analysis**: depends on the path's importance. For most code, re-adding defer is a tradeoff: ~4 ns slower, but panic-safe.

**When to re-add**:
- The function does anything beyond a trivial map read.
- The function might be extended to do more in the future.
- The function is not in the top 10 of CPU profiles.

**When to keep without defer**:
- The function is a measured top-N hot path.
- The critical section is provably non-panicking.
- A teammate's benchmark showed the regression matters.

**Rule of thumb**: in 2024+, default to defer. The cases where it's bad enough to skip are rare and easy to identify with `pprof`.

**Key insight**: defer's cost has dropped by ~7-8x since the open-coded optimization. Pre-1.14 wisdom about avoiding defer is largely obsolete.
</details>

---

## 12. Exercise 10 (Hard) — Inlining Inhibition

**Problem**:
```go
func wrap(fn func() error) error {
    start := time.Now()
    defer log.Info("took", time.Since(start)) // ← does this prevent inlining?
    return fn()
}
```

**Question**: does the defer prevent `wrap` from being inlined?

<details><summary>Solution</summary>

In Go 1.22, the inliner has heuristics for "function complexity". A function with one open-coded defer is usually still inlinable, but it consumes more inline budget than a function without defer.

Check with `-gcflags=-m`:
```bash
go build -gcflags="-m=2" 2>&1 | grep wrap
```

If you see "can inline wrap (cost: 80)" and the threshold is 80, you're at the limit. Adding more code to `wrap` can push it over.

**Optimization** — extract the deferred body if the function is on the inlining edge:
```go
func wrap(fn func() error) error {
    return wrapWithLog(fn)
}

//go:noinline (or just keep it complex)
func wrapWithLog(fn func() error) error {
    start := time.Now()
    defer log.Info("took", time.Since(start))
    return fn()
}
```

Then inline `wrap` to a thin no-defer wrapper that the compiler will inline.

**Benchmark** (artificial):
- Inlined wrap: 5 ns/op
- Non-inlined wrap: 12 ns/op

7 ns difference, but only matters if `wrap` is on a sub-100ns hot path.

**Key insight**: defer affects inlining budget. For deeply nested wrappers in hot paths, watch the inline output and restructure if needed.
</details>

---

## 13. PProf Snippets

### Before (defer in loop)

```
File: app
Type: cpu
Showing nodes accounting for 250ms, 50% of 500ms total

      flat  flat%   sum%        cum   cum%
     150ms 30.0%  30.0%      150ms 30.0%  runtime.deferproc
     100ms 20.0%  50.0%      100ms 20.0%  runtime.deferreturn
```

`deferproc` and `deferreturn` together are 50% of CPU. This is a strong signal: defers in a hot loop.

### After (helper function)

```
File: app
Type: cpu
Showing nodes accounting for 50ms, 10% of 500ms total

      flat  flat%   sum%        cum   cum%
      30ms 6.0%   6.0%       30ms 6.0%   main.processOne
      20ms 4.0%  10.0%       20ms 4.0%   sync.(*Mutex).Lock
```

Total drops from 500ms to ~250ms; deferproc/deferreturn no longer appear. Win.

### Allocation Profile

```bash
go test -bench=. -benchmem -memprofile=mem.prof
go tool pprof mem.prof
```

If you see `runtime.newdefer` allocations, you have heap-path defers somewhere. Trace back to find the loop.

---

## 14. "Is It Worth Optimizing?" Guidance

For each defer, ask:

1. **Is this function in CPU/allocation profiles?** If no → leave defer alone.
2. **Is the defer in a loop?** If yes → fix immediately (extract helper). Easy win.
3. **Does the function have ≥9 defers?** If yes → consider splitting. Easy win.
4. **Is the function called >1M times/sec?** If yes → measure with/without defer.
5. **Does removing defer create a panic-safety risk?** If yes, weigh the risk against the perf gain.

In 99% of cases, the answer is "leave defer alone, it's fine".

The 1% where it matters: tight inner loops in storage engines, schedulers, allocators, query execution. Those teams know who they are.

---

## 15. Open-Coded Defer Verification

How to confirm a function uses the fast path:

```bash
go build -gcflags="-d=ssa/check_bce/debug=1" -o app main.go
go tool objdump -s "main\.f$" app | grep -E "deferproc|deferreturn"
```

If `deferproc` or `deferreturn` appears, the function is using the slow path.

If neither appears and you see your cleanup code inline before `RET`, the function is using open-coded defer.

For a more direct check:
```bash
go build -gcflags="-m=2" 2>&1 | grep -E "open-coded|defer"
```

The compiler logs which path it picked.

---

## 16. Common Optimizations Summary

| Pattern | Wrong | Right |
|---------|-------|-------|
| defer in loop | `for x := range xs { defer x.Close() }` | extract helper `func one(x X) { defer x.Close(); ... }` |
| 9+ defers | `defer a; ... defer i;` | split into 2 functions, each ≤ 8 defers |
| hot mutex | `mu.Lock(); defer mu.Unlock(); ...` | profile first; only skip defer if measured |
| trace closure | `defer trace("name")()` | only allocate when needed; consider stack span |
| close-error swallow | `defer f.Close()` (write path) | named return + closure that captures `err` |

---

## 17. Final Numbers

For Go 1.22, amd64, M1 single-thread (typical, varies):

| Operation | ns/op |
|-----------|-------|
| Direct call | 1-3 |
| `defer mu.Unlock()` (open-coded) | ~4 |
| `defer fmt.Println(x)` (open-coded, no closure) | ~6 |
| `defer func() { ... }()` (open-coded, with closure) | ~7 |
| `defer mu.Unlock()` (in loop) | ~50 (heap alloc) |
| 9-defer function vs 8-defer | +~100 ns total |

If your function takes ≥1 microsecond and isn't called millions of times per second, defer overhead is invisible.

---

## 18. Summary

Defer's cost is small (~3-7 ns) on the open-coded fast path. It becomes meaningful (~50 ns) only when forced into the heap path: defers inside loops, or 9+ defers in a function. Measure with `pprof` before optimizing. The standard fixes are: extract a helper to move per-iter cleanup out of the loop; split functions to keep defer count ≤ 8; restructure to keep `recover` inside deferred closures only. PGO can further reduce overhead by inlining defer-using wrappers in hot paths. For 99% of code, leave defer alone.

---

## 19. References

- Go 1.14 release notes — open-coded defer introduction
- Keith Randall, "The cost of defer in Go 1.14" (talk)
- `cmd/compile/internal/ssagen/ssa.go` — open-coded codegen
- Go runtime/panic.go — `runOpenDeferFrame`
- Dave Cheney, pre-1.14 benchmarks of defer
