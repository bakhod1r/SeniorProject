# Memory Management in Depth — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.22+ (1.24+ for cleanup-API tasks).

---

## Task 1: Reading `MemStats`

Write a program that prints `HeapAlloc`, `HeapInuse`, `HeapIdle`, and `NumGC` once a second for 10 seconds.

**Acceptance criteria**
- [ ] Output shows values updating each second.
- [ ] You can describe in one sentence what each field means.
- [ ] You replace `ReadMemStats` with `runtime/metrics.Read` reading the equivalent metrics and confirm the numbers agree to within a few KiB.

---

## Task 2: Observe a GC cycle

Run any allocation-heavy program with `GODEBUG=gctrace=1`.

**Acceptance criteria**
- [ ] You capture at least 5 GC-trace lines from stderr.
- [ ] You annotate one of the lines field-by-field (cycle, time, %CPU, phase times, heap sizes, goal, P count).
- [ ] You change `GOGC` (e.g., to `50` and `200`) and observe that the cycle count and heap goals change accordingly.

---

## Task 3: Watch escape analysis

Write `func returnsInt() *int { x := 42; return &x }` and `func returnsValue() int { x := 42; return x }`.

**Acceptance criteria**
- [ ] `go build -gcflags="-m"` reports `moved to heap: x` for the first and nothing for the second.
- [ ] You write a third function `passToInterface(x int) { fmt.Println(x) }` and observe the escape note for the interface conversion.
- [ ] You rewrite one of them so it stops escaping and confirm the message goes away.

---

## Task 4: Bench an allocation regression

Use the snippet below as a starting point.

```go
func BenchmarkBuild(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        var s string
        for _, p := range []string{"a", "b", "c", "d"} {
            s += p
        }
        _ = s
    }
}
```

**Acceptance criteria**
- [ ] `go test -bench=. -benchmem` reports a baseline.
- [ ] You replace `s +=` with `strings.Builder` (with `Grow`) and the new bench shows fewer allocs/op.
- [ ] You capture both runs and compute the diff with `benchstat`.

---

## Task 5: A `sync.Pool` that helps (and one that doesn't)

Build two HTTP handlers: one that allocates a 4 KiB scratch slice per request, one that obtains it from a `sync.Pool`. Hit them with `hey -n 100000 -c 100`.

**Acceptance criteria**
- [ ] The pooled version's `pprof -alloc_objects` profile shows ~10× fewer allocations.
- [ ] You then change the workload to "allocate a 64 MiB buffer" and observe that pooling now retains 64 MiB indefinitely.
- [ ] You add a cap-based discard in `defer Put` and verify the residency drops.

---

## Task 6: Heap leak via slice retention

Write `func header(path string) []byte` that reads a file and returns the first 100 bytes via `raw[:100]`.

**Acceptance criteria**
- [ ] You write a benchmark that calls it 100 times on a 50 MiB file and confirm `HeapAlloc` grows by ~5 GiB.
- [ ] You change the function to `slices.Clone(raw[:100])` and confirm `HeapAlloc` stays flat across iterations.
- [ ] You write a short comment in the code explaining why the original leaked.

---

## Task 7: Goroutine leak

Write a producer that sends on an unbuffered channel with no consumer. Spawn 1000 producers.

**Acceptance criteria**
- [ ] `runtime.NumGoroutine()` reports >1000 after spawning.
- [ ] Capture `/debug/pprof/goroutine?debug=2` and find the leaked goroutines in the dump.
- [ ] Fix by adding a `context.Context` with cancellation; verify goroutine count returns to baseline.

---

## Task 8: `GOMEMLIMIT` in action

Write a program that allocates 100 MiB slices in a loop and drops the reference each iteration (so each is garbage at the start of the next).

**Acceptance criteria**
- [ ] Without `GOMEMLIMIT`, the program reaches steady-state RSS around 200 MiB (one live + headroom).
- [ ] With `GOMEMLIMIT=150MiB`, GC runs more often, steady-state RSS drops, and `GCCPUFraction` rises.
- [ ] You annotate the result with the trade-off in your own words.

---

## Task 9: From `SetFinalizer` to `AddCleanup`

Pick a small type that owns an OS resource (e.g., wraps an `os.File`) and attach a finalizer.

**Acceptance criteria**
- [ ] You demonstrate (with `runtime.GC()`) that the finalizer runs once.
- [ ] You demonstrate that a cycle of two finalizer-bearing objects pointing at each other never collects.
- [ ] You rewrite using `runtime.AddCleanup` (Go 1.24+) and confirm the cycle no longer blocks collection.

---

## Task 10: pprof a real heap

Pick any Go service you've written, expose `/debug/pprof/heap`, and generate steady load.

**Acceptance criteria**
- [ ] You capture an in-use profile and identify the top-3 allocation sites.
- [ ] You capture an alloc-objects profile and explain how it differs from in-use.
- [ ] You pick one site and reduce its allocations by ≥30% (preallocation, pooling, or value-vs-pointer change). You bench the change before and after.

---

## Task 11: Stack growth, observed

Write a recursive function whose argument is a struct slightly under the initial stack size, recursing N times.

**Acceptance criteria**
- [ ] With `GODEBUG=schedtrace=1000`, the goroutine's stack size visibly grows for large N.
- [ ] You rewrite iteratively and confirm the stack stays at the initial size.
- [ ] You explain why the runtime is forced to copy on growth and what that costs.

---

## Task 12: Capacity planning

For an HTTP service you maintain (or build a small one), produce a one-page capacity plan.

**Acceptance criteria**
- [ ] You measure steady-state `live_heap` under realistic load.
- [ ] You measure peak goroutine count and average stack size.
- [ ] You compute `peak_rss ≈ live_heap × (1 + GOGC/100) + stacks × goroutines + overheads`.
- [ ] You compare to actual RSS and explain any gap (cgo, mapped files, retained idle pages).
- [ ] You write the value you'd set for `GOMEMLIMIT` and `GOGC` in production, with a one-paragraph justification.

---

## Stretch — Task 13: Allocation-free hot path

Pick a small but realistic kernel (e.g., parse a fixed binary header, sum a slice with conditions, render a tiny template).

**Acceptance criteria**
- [ ] A benchmark with `-benchmem` reports `0 allocs/op`.
- [ ] You document each technique used (preallocated output, value receivers, avoided `interface{}`, etc.) with a one-line note.
- [ ] You write a regression benchmark that fails CI if the count rises above zero.

---

## Submission

Each task should produce:

1. A short writeup (5–15 lines) of what you observed.
2. The code you ran or modified.
3. The benchmark or profile output that backs your conclusions.

These artifacts are what turn "I read about memory" into "I can debug it in production".
