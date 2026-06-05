# IR & Middle-End — Professional

## 1. Perf work driven by escape and inline analysis

In production Go, the bulk of avoidable CPU cost on hot paths is **garbage collection pressure** caused by unnecessary heap allocations, and **call overhead / missed optimizations** caused by code the inliner declined to fold. The middle-end diagnostics (`-m`, `-m=2`) are the cheapest, most direct instruments you have. The professional workflow is:

1. Profile to find the hot functions (`pprof` CPU + alloc profiles).
2. For those functions, read `-gcflags=-m` to see what escapes and what does not inline.
3. Change the code so the analyzer can prove stack-ness / so the inliner accepts the function.
4. Re-benchmark with `-benchmem` and confirm `allocs/op` dropped.

This loop is tighter and more reliable than guessing, because the compiler *tells you* its decision and (at `-m=2`) often why.

---

## 2. Reducing allocations: the levers that actually move

**Avoid interface boxing on hot paths.** Every value crossing into `any`/`interface{}`/`error`/`...interface{}` tends to allocate. `fmt.Sprintf` in a hot loop allocates for each argument plus the result string. Replace with `strconv.AppendInt`, `append`, or a pre-typed path.

```go
// allocates: each arg boxed, result heaped
s := fmt.Sprintf("%d:%d", a, b)

// no boxing, reuses buffer
buf = strconv.AppendInt(buf[:0], int64(a), 10)
buf = append(buf, ':')
buf = strconv.AppendInt(buf, int64(b), 10)
```

**Return values, not pointers, when the value is small.** Returning `*T` from a constructor often forces `T` to the heap. Returning `T` lets the caller keep it on the stack (and inlining frequently elides the copy).

**Pre-size slices and maps.** `make([]T, 0, n)` avoids repeated `runtime.growslice` reallocation; `make(map[K]V, n)` avoids rehashing. A growing slice whose final size the compiler cannot bound escapes its backing array.

**Hoist allocations out of loops.** A buffer allocated once and reset (`buf = buf[:0]`) beats one allocated per iteration. This is the core idea behind reusable scratch buffers.

**Watch closures that escape.** A closure returned or stored on the heap drags its captured variables to the heap. If the closure is only called synchronously and locally, the compiler can keep captures on the stack — keep it that way.

---

## 3. When to fight the inliner (and when not to)

Most of the time, *let the inliner work* — write small functions and it folds them. But there are deliberate interventions:

- **Force out-of-line for honest benchmarks.** `//go:noinline` on the function under test prevents the benchmark loop from optimizing the call away or specializing it unrealistically.
- **Reduce binary size / icache pressure.** If a moderately large function is inlined into many cold call sites, the binary grows and instruction-cache locality suffers. Splitting the *cold* part into a separate `//go:noinline` helper, keeping the hot fast-path small and inlinable, is a known pattern (the "outlining the slow path" trick):

```go
func Get(k Key) (Val, bool) {
    if v, ok := fastPath(k); ok { // small, inlinable
        return v, true
    }
    return slowPath(k)            // //go:noinline, kept out of line
}
```

- **Help the inliner accept a function.** If a hot function just misses the budget, factor the cold/rare branch into a separate function. The remaining hot function shrinks under budget and inlines; the cold branch becomes a call you rarely take. This is often a bigger win than any micro-optimization inside the function.

Do **not** sprinkle `//go:noinline` for "predictability"; you will leave free performance on the table. Measure before and after each directive.

---

## 4. Reading `-m=2` like a professional

`-m=2` adds escape *reasoning* and inline *cost* accounting. Useful extractions:

```bash
# Why does this allocate? Show full escape flow for one package.
go build -gcflags='example.com/svc/cache=-m=2' ./... 2>&1 | less

# Just the escape verdicts in the hot package
go build -gcflags='example.com/svc/cache=-m' ./... 2>&1 \
  | grep -E 'escapes|moved to heap|does not escape'

# Inline costs / refusals
go build -gcflags='example.com/svc/cache=-m=2' ./... 2>&1 \
  | grep -E 'inline|cost'
```

At `-m=2` you see lines like `parameter x leaks to {heap} ...`, `flow: ~r0 = &t:`, and per-call inline cost decisions. The `flow:` lines trace the pointer graph the analyzer built — follow them to find the assignment that caused the escape (often a store into a struct field that itself escaped).

A complementary view: `go build -gcflags=-S` prints the final assembly so you can confirm a `runtime.newobject`/`runtime.makeslice` call truly disappeared. The decision (`-m`) plus the codegen (`-S`) together prove the change worked.

---

## 5. `sync.Pool` tradeoffs

When you genuinely cannot keep an object on the stack (it escapes legitimately, e.g., a large buffer handed to I/O), `sync.Pool` recycles heap objects to cut allocation *rate* and GC scan cost.

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func handle() {
    b := bufPool.Get().(*bytes.Buffer)
    b.Reset()
    defer bufPool.Put(b)
    // ... use b ...
}
```

Tradeoffs to respect:

- Pool contents are cleared at GC, so pooling is a win only when reuse rate within a GC cycle is high.
- The `Get().(*T)` type assertion is itself an interface op; the pool stores `any`. For tiny objects the bookkeeping can cost more than the allocation it saves — **always benchmark**.
- Pools shine for large/medium reusable buffers under high concurrency (this is exactly how `encoding/json`, `fmt`, and `net/http` use them internally), not for small short-lived values that should just stay on the stack.

The decision tree: *can it stay on the stack?* → fix the escape. *Must it heap-allocate but is reused hot?* → `sync.Pool`. *Allocated rarely?* → leave it alone.

---

## 6. GOFLAGS / CI to catch regressions

You can fail CI when a hot function starts allocating or stops inlining. Two practical techniques.

**Allocation budget tests.** `testing.AllocsPerRun` (or a benchmark asserting `b.ReportAllocs()` results) pins allocation counts:

```go
func TestNoAllocs(t *testing.T) {
    avg := testing.AllocsPerRun(1000, func() { hotPath(input) })
    if avg != 0 {
        t.Fatalf("hotPath allocated %.0f/op, want 0", avg)
    }
}
```

**`errorcheck`-style inline/escape assertions.** The Go project itself uses `// ERROR "..."` directives compiled with `-m` to assert that specific lines inline or escape. In your own repo you can run a build with `-m` and grep for expected lines in CI:

```bash
go build -gcflags='./internal/hot=-m' ./... 2>&1 \
  | tee /tmp/m.txt
grep -q 'inlining call to hotPath' /tmp/m.txt || { echo "hotPath stopped inlining!"; exit 1; }
grep -q 'moved to heap' /tmp/m.txt && { echo "new heap escape introduced!"; exit 1; }
```

`GOFLAGS` can centralize flags across `go` invocations (e.g. `GOFLAGS=-gcflags=all=-m` in a dedicated lint job), but keep it out of the *normal* build job — `-m` output is noisy and slows nothing-but-clutter CI. Use `benchstat` to gate benchmark deltas:

```bash
go test -run=^$ -bench=Hot -benchmem -count=10 ./... > new.txt
benchstat old.txt new.txt   # flags allocs/op and ns/op regressions
```

---

## 7. Real case studies

**`fmt` boxing in a logger.** A structured logger built on `fmt.Sprintf("%s=%v", k, v)` allocated several objects per field. `-m` showed `v escapes to heap` at the `%v` boxing site for every call. Replacing the hot integer/string fields with type-specialized `strconv.Append*`/`append` paths (reserving `%v` for the rare `any` case) dropped per-log allocations from ~6 to ~1 and cut GC CPU noticeably. The diagnostic that found it was a single `grep 'escapes to heap'`.

**Constructor returning a pointer.** A `NewVec3() *Vec3` used in a tight math loop showed `&Vec3{...} escapes to heap`. Changing it to return `Vec3` by value made the value stack-resident after inlining; the loop's `allocs/op` went to 0. Confirmed with `-S` showing the `runtime.newobject` gone.

**Slow path bloating a hot map getter.** A cache `Get` inlined a large miss-handling branch into every call site, ballooning the binary and missing icache. Outlining the miss path behind `//go:noinline` shrank `Get` under budget; it inlined into callers and the hot-hit path got measurably faster despite the extra indirection on misses.

**PGO on a JSON-heavy service.** Adding `default.pgo` from a production CPU profile let the compiler inline several normally-too-big decode helpers on the hot path and devirtualize a dominant `io.Reader`, yielding a low-single-digit percent CPU reduction with zero source changes.

---

## 8. Footguns

| Footgun | Consequence | Avoidance |
|---|---|---|
| Bare `go build -m` | Error / does nothing useful | Always `-gcflags=-m` |
| `-gcflags=-m` without `importpath=` | Floods output from all deps | Scope with `pkg=-m` |
| Forgetting `2>&1` | "No output" (it's on stderr) | Redirect stderr |
| `//go:noinline` left in prod code | Silent perf loss | Treat as benchmark-only; review for it |
| Optimizing allocs the GC handles cheaply | Wasted effort, uglier code | Profile first; chase only hot allocs |
| `sync.Pool` for tiny objects | Slower than plain alloc | Benchmark; prefer stack |
| Trusting stale `-m` after refactor | Wrong mental model | Re-run `-m`; decisions shift with inlining |
| Comparing benchmarks without `benchstat` | Noise read as signal | `-count=10` + `benchstat` |

---

## 9. Summary

- Drive perf with **profile → `-m`/`-m=2` → fix → `-benchmem`** loops, not guesses.
- Kill heap pressure: avoid **interface boxing**, return small values not pointers, pre-size slices/maps, hoist buffers, watch escaping closures.
- Fight the inliner only deliberately: `//go:noinline` for honest benchmarks, **outline cold paths** to keep hot paths inlinable.
- Read `-m=2` `flow:`/`leaks` lines to find the exact escape cause; confirm with `-S`.
- `sync.Pool` is for reused heap objects, not stack-able small ones — always benchmark.
- Gate regressions in CI with `AllocsPerRun`, `-m` greps, and `benchstat`.
- **PGO** buys free hot-path inlining/devirtualization in production.

---

## Further reading

- [Profile-guided optimization](https://go.dev/doc/pgo)
- [Diagnostics](https://go.dev/doc/diagnostics) — pprof, trace, GODEBUG
- `golang.org/x/perf/cmd/benchstat` — statistical benchmark comparison
- [Go FAQ: stack or heap](https://go.dev/doc/faq#stack_or_heap)
- Go source: [`cmd/compile/internal/escape`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/escape) and [`internal/inline`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/inline)
