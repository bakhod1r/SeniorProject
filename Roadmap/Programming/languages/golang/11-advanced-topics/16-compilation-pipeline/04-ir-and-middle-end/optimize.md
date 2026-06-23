# IR & Middle-End — Optimize

The allocation-reduction playbook, organized as a workflow. The premise: on CPU-bound Go services, the cheapest large wins usually come from removing avoidable **heap allocations** (less GC work) and from letting the **inliner** do its job. The middle-end diagnostics tell you exactly where to act.

---

## 1. Measure first: alloc profile + `-benchmem`

Never optimize allocations you haven't measured. Two complementary tools:

```bash
# Benchmark with allocation accounting
go test -run=^$ -bench=. -benchmem -count=10 ./... > base.txt

# Heap allocation profile to find WHERE allocations happen
go test -run=^$ -bench=BenchmarkHot -memprofile=mem.out ./...
go tool pprof -alloc_objects mem.out   # 'top', 'list Func', 'web'
```

`-benchmem` adds `B/op` and `allocs/op` columns. `allocs/op` is the number to drive to zero on hot paths. `pprof -alloc_objects` ranks call sites by allocation *count* (use `-alloc_space` for bytes). Always keep a `base.txt` to compare against.

---

## 2. Read `-m`: see the decisions

For every hot function from the profile, read the compiler's verdict:

```bash
go build -gcflags='example.com/hot=-m=2' ./... 2>&1 | less
```

You are looking for:

- `moved to heap: x` / `escapes to heap` → an allocation you might remove.
- `leaking param: p` → the function forces its argument to escape at *callers*.
- `cannot inline f` / absence of `can inline f` → a missed inline.
- `flow:` lines (at `-m=2`) → the pointer path that caused an escape — follow it to the root store.

The decision (`-m`) tells you *what to change*; the profile tells you *what's worth changing*. Use them together.

---

## 3. Keep things on the stack

The highest-leverage moves, roughly in order of payoff:

1. **Return values, not pointers**, for small structs. `func New() T` over `func New() *T` lets the result stay on the caller's stack after inlining.
2. **Avoid interface boxing on hot paths.** Don't pass hot values through `any`/`error`/`...interface{}`/`fmt`. Use typed paths (`strconv.Append*`, typed logger fields).
3. **Pre-size slices/maps**: `make([]T, 0, n)`, `make(map[K]V, n)`. Stops `growslice`/rehash and can keep small bounded slices on the stack.
4. **Don't store locals into longer-lived structures** unless they truly must outlive the frame. A store into a global/field that escapes drags the local with it.
5. **Don't return or store closures** you only call synchronously — captured vars stay on the stack then.
6. **Use array/value receivers** where mutation/identity isn't needed, so the receiver isn't forced to the heap.

After each change, re-run `-m` and confirm the `moved to heap` line is gone, then `-benchmem` to confirm `allocs/op` dropped.

---

## 4. Help the inliner

Inlining removes call overhead *and* enables escape analysis, devirtualization, and constant folding in the caller. To get more of it:

- **Keep hot functions small.** Stay under the ~80 cost budget. Split rare/cold branches into separate functions so the hot function shrinks and inlines.
- **Outline the slow path** behind `//go:noinline` so the hot fast path is small and inlinable:

```go
func Get(k Key) (Val, bool) {
    if v, ok := m[k]; ok { return v, true } // hot, tiny, inlines
    return getSlow(k)                        // //go:noinline below
}

//go:noinline
func getSlow(k Key) (Val, bool) { /* big miss handling */ }
```

- **Avoid inline blockers** in hot leaf code: `select`, heavy `defer`, very large `switch`. If a hot function just misses, removing one of these often tips it under budget.
- **Don't over-inline.** If `-l -l` style aggressiveness bloats the binary and hurts icache, that's a real regression — measure binary size and benchmarks, not just allocs.

Verify with `go build -gcflags=-m 2>&1 | grep 'inlining call to <fn>'`.

---

## 5. Devirtualize the hot interface calls

An interface call is an indirect jump through the itab. To turn the hot ones direct:

- Make the calling function inlinable so the concrete type flows in (static devirtualization).
- Or accept the concrete type on the hottest path instead of the interface.
- Or use **PGO** (next section) for profile-guided devirtualization when one dynamic type dominates.

Direct calls then become inline candidates themselves — devirtualization chains into inlining.

---

## 6. `sync.Pool` — when stack isn't possible

If an object legitimately escapes (handed to async I/O, genuinely large, retained across calls) and is reused at high rate, pool it:

```go
var bufPool = sync.Pool{New: func() any { return make([]byte, 0, 4096) }}

func handle(w io.Writer) {
    buf := bufPool.Get().([]byte)[:0]
    defer bufPool.Put(buf)
    // ... fill buf, write ...
}
```

Tradeoffs to respect before reaching for it:

- Pools are emptied at GC; only worth it when intra-cycle reuse is high.
- The `Get().(T)` assertion and `Put` bookkeeping cost something; for small objects it can be *slower* than plain allocation.
- It adds complexity and aliasing hazards (don't keep references to pooled buffers after `Put`).

Decision order: **stack > pre-sized reuse > sync.Pool > plain heap**. Benchmark each step.

---

## 7. PGO: free hot-path inlining/devirtualization

For services, collect a production-representative CPU profile and feed it back:

```bash
# 1. capture a profile (runtime/pprof or net/http/pprof) under real load
# 2. place it as default.pgo next to the main package (auto-detected),
#    or pass explicitly:
go build -pgo=cpu.pprof ./...

# compare before/after
go test -bench=. -benchmem -count=10 ./... > pgo.txt
benchstat base.txt pgo.txt
```

PGO raises the inline budget on hot call sites (inlining functions normally too big, only where it pays) and devirtualizes hot interface calls. It's safe (heuristics only, never correctness) and tolerant of slightly stale profiles. Typical gains are a few percent CPU with zero code change — do this before hand-tuning.

---

## 8. Benchmarking allocations correctly

```go
func BenchmarkParse(b *testing.B) {
    b.ReportAllocs()        // force allocs/op even without -benchmem
    input := makeInput()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sink = parse(input) // assign to package var to prevent dead-code elimination
    }
}
var sink Result
```

Rules:

- Assign results to a package-level `sink` so the optimizer can't delete the work.
- `b.ResetTimer()` after setup; `b.ReportAllocs()` to always show allocs.
- Run `-count=10` and compare with `benchstat` — a single run is noise.
- Use `testing.AllocsPerRun(n, f)` in a unit test to *assert* zero allocs and fail CI on regressions.

---

## 9. Checklist

- [ ] Profiled first; targeting *hot* allocations (`pprof -alloc_objects`), not all of them.
- [ ] Read `-gcflags='pkg=-m=2'` for each hot function; identified `moved to heap` / missed inlines.
- [ ] Returned small structs by value instead of pointer.
- [ ] Removed interface boxing (`fmt`/`any`) from hot paths.
- [ ] Pre-sized slices and maps with known capacity.
- [ ] Hoisted per-iteration allocations out of loops; reused buffers with `buf[:0]`.
- [ ] Kept hot functions under inline budget; outlined cold paths with `//go:noinline`.
- [ ] Devirtualized hot interface calls (inline the caller / concrete type / PGO).
- [ ] Considered `sync.Pool` only for reused legitimately-escaping objects; benchmarked it.
- [ ] Enabled PGO from a production profile; compared with `benchstat`.
- [ ] Pinned results with `AllocsPerRun`/`benchstat` gates in CI.
- [ ] Confirmed each change with `-m` (decision) **and** `-benchmem` (runtime truth).

---

## 10. Summary

- Optimize allocations top-down: **profile → `-m` → fix → `-benchmem`/`benchstat`**.
- Keep values on the **stack** (return by value, no boxing, pre-size, don't escape into globals/closures).
- **Help the inliner** by keeping hot functions small and outlining cold paths; inlining unlocks escape analysis and devirtualization.
- Use **`sync.Pool`** only for high-reuse escaping objects, and benchmark it.
- **PGO** gives a safe few-percent hot-path win with no code change.
- Benchmark allocations honestly: `ReportAllocs`, a `sink`, `-count=10`, `benchstat`, and CI `AllocsPerRun` gates.

---

## Further reading

- [Diagnostics](https://go.dev/doc/diagnostics) — pprof, memprofile, trace
- [Profile-guided optimization](https://go.dev/doc/pgo)
- `golang.org/x/perf/cmd/benchstat`
- [`testing` package](https://pkg.go.dev/testing) — `ReportAllocs`, `AllocsPerRun`, benchmarks
- Go source: [`cmd/compile/internal/escape`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/escape) and [`internal/inline`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/inline)
