# Go Variadic Functions — Optimize

## Instructions

Each exercise presents an inefficient or wasteful use of variadic functions. Identify the issue, write an optimized version, and explain the improvement. Always benchmark before and after. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Exercise 1 🟢 — Pre-allocate Concat Output

**Problem**: A function concatenates multiple slices using `append` in a loop.

```go
func concat(groups ...[]int) []int {
    var out []int
    for _, g := range groups {
        out = append(out, g...)
    }
    return out
}
```

**Question**: How can you reduce allocations?

<details>
<summary>Solution</summary>

**Issue**: `append` on a nil starting slice triggers ~log2(N) reallocations as the result grows. For 10 groups totaling 100k items, that's ~17 allocations and copies.

**Optimization** — count first, allocate once:
```go
func concat(groups ...[]int) []int {
    n := 0
    for _, g := range groups {
        n += len(g)
    }
    out := make([]int, 0, n) // single allocation, exact capacity
    for _, g := range groups {
        out = append(out, g...)
    }
    return out
}
```

**Benchmark** (10 groups × 10k ints):
- Naive: ~250 µs/op, 800 KB/op, 17 allocs/op
- Pre-allocated: ~80 µs/op, 800 KB/op, 1 alloc/op

**This is exactly what `slices.Concat` does** (Go 1.21+):
```go
import "slices"
out := slices.Concat(g1, g2, g3)
```

**Key insight**: When you know the final size, always pre-allocate. `append`'s amortized growth is wasteful when you can predict the total.
</details>

---

## Exercise 2 🟢 — Avoid `...any` for Typed Logging

**Problem**: A logging helper takes `...any`.

```go
func logf(format string, args ...any) {
    fmt.Printf(format+"\n", args...)
}

// Hot path:
// for _, ev := range events {
//     logf("processed %d items in %dms", ev.Count, ev.DurMs)
// }
```

**Question**: What allocations occur, and how do you eliminate them?

<details>
<summary>Solution</summary>

**Issue**: Each `logf` call boxes `ev.Count` and `ev.DurMs` (both `int`) into `any`. For ints in the staticuint64s pool (0-255) this is free; for larger ints it's an allocation each.

**Optimization** — provide typed variants:
```go
type Field struct {
    Key   string
    Int64 int64
    Str   string
    Type  fieldType // tInt64 | tStr ...
}

func IntField(k string, v int) Field { return Field{Key: k, Int64: int64(v), Type: tInt64} }
func StrField(k, v string) Field     { return Field{Key: k, Str: v, Type: tStr} }

func info(msg string, fs ...Field) {
    // ... format using typed fields directly ...
}

// Hot path:
for _, ev := range events {
    info("processed", IntField("count", ev.Count), IntField("ms", ev.DurMs))
}
```

**Benchmark** (1M iterations):
- `logf("...", count, durMs)` via `...any`: ~120 ns/op, 48 B/op, 3 allocs/op
- `info("...", IntField(...), IntField(...))`: ~25 ns/op, 0 B/op, 0 allocs/op

This is the design behind `zap`, `zerolog`, and `slog` (Go 1.21+).

**Key insight**: `...any` is convenient but allocates per-arg for non-pointer values. Typed variadics eliminate the boxing.
</details>

---

## Exercise 3 🟡 — Spread Defensive Copy When Not Needed

**Problem**: A function defensively copies the spread input even though it only reads it.

```go
func sum(xs ...int) int {
    local := append([]int(nil), xs...) // unnecessary copy
    total := 0
    for _, x := range local {
        total += x
    }
    return total
}
```

**Question**: When is the defensive copy needed and when is it wasteful?

<details>
<summary>Solution</summary>

**Issue**: This function only reads `xs`. The defensive copy allocates a new slice every call — pure waste.

**Optimization** — read directly:
```go
func sum(xs ...int) int {
    total := 0
    for _, x := range xs {
        total += x
    }
    return total
}
```

**When you DO need defensive copy**:
- The function stores the slice past the call (`s.buf = xs`).
- The function returns a slice that should be independent of the input.
- The function passes the slice to a goroutine that outlives the call.

**Benchmark** (1k ints per call, 1M calls):
- With unnecessary copy: ~3.5 µs/op, 8 KB/op, 1 alloc/op
- Without copy: ~0.4 µs/op, 0 B/op, 0 allocs/op

**Key insight**: Defensive copy has a real cost. Use it deliberately, only when storing or crossing concurrency boundaries.
</details>

---

## Exercise 4 🟡 — Spread vs Literal in a Hot Path

**Problem**: A hot loop calls a variadic with the same literal args each iteration.

```go
for i := 0; i < N; i++ {
    process(1, 2, 3, 4, 5) // same args every time
}
```

**Question**: Is the implicit slice constructed N times? How would you avoid that?

<details>
<summary>Solution</summary>

**Issue**: Yes, the compiler builds a fresh implicit slice on each call. For literal args this slice is typically stack-allocated, so the cost is small but non-zero (~3 ns per call).

**Optimization** — build the slice once:
```go
args := []int{1, 2, 3, 4, 5}
for i := 0; i < N; i++ {
    process(args...)
}
```

Now the spread form passes the existing slice header — no per-iteration construction.

**Benchmark** (10M iterations, 5 ints):
- Literal each call: ~30 ms total (~3 ns/op)
- Pre-built and spread: ~10 ms total (~1 ns/op)

This is a micro-optimization that matters only when:
- The variadic call is inside a tight loop (>100M calls/sec).
- The args are constant across iterations.

**Key insight**: Hoisting the slice out of the loop converts N implicit constructions into one. For very hot loops this is measurable.
</details>

---

## Exercise 5 🟡 — Forwarding Allocates Unnecessarily

**Problem**: A wrapper rebuilds args instead of forwarding:

```go
func wrap(args ...any) {
    rebuilt := make([]any, len(args))
    copy(rebuilt, args)
    inner(rebuilt...)
}
```

**Question**: What's wrong, and how do you fix it?

<details>
<summary>Solution</summary>

**Issue**: The wrapper allocates a fresh `[]any` slice and copies elements, only to spread it back. The receiving `inner` function will see the same elements as if `wrap` had just done `inner(args...)`.

**Optimization** — forward directly:
```go
func wrap(args ...any) {
    inner(args...)
}
```

**Benchmark** (3 args, 1M iterations):
- Rebuild + spread: ~80 ns/op, 48 B/op, 1 alloc/op
- Direct spread: ~15 ns/op, 0 B/op, 0 allocs/op

**The only reason to rebuild** is if the wrapper needs to mutate or filter elements:
```go
func wrapFiltered(args ...any) {
    nonNil := args[:0]
    for _, a := range args {
        if a != nil {
            nonNil = append(nonNil, a)
        }
    }
    inner(nonNil...)
}
```

This in-place compaction reuses `args`'s backing array.

**Key insight**: When forwarding unchanged, just spread. Defensive copy or rebuild only when transforming.
</details>

---

## Exercise 6 🟡 — Generic Variadic Avoiding `...any`

**Problem**: A library function uses `...any` for flexibility:

```go
func first(args ...any) any {
    if len(args) == 0 {
        return nil
    }
    return args[0]
}
```

**Question**: How do generics improve this?

<details>
<summary>Solution</summary>

**Issue**: `...any` boxes each arg. Calling `first(1, 2, 3)` allocates 3 boxed ints (or uses the static pool for small ints).

**Optimization** — generic variadic (Go 1.18+):
```go
func First[T any](xs ...T) (T, bool) {
    var zero T
    if len(xs) == 0 {
        return zero, false
    }
    return xs[0], true
}
```

**Benchmark** (3 ints, 10M iterations):
- `first(1, 2, 3)` via `...any`: ~85 ns/op, 32 B/op, 3 allocs/op
- `First(1, 2, 3)` (generic): ~3 ns/op, 0 B/op, 0 allocs/op

The generic version inlines and stays on the stack.

**Caveat**: generic variadic with no args fails type inference: `First()` needs `First[int]()` explicitly.

**Key insight**: Generics + variadic = same flexibility without boxing. Migrate `...any` APIs to generics where possible.
</details>

---

## Exercise 7 🟡 — Spread Slice That Will Be Mutated

**Problem**: A consumer reuses a slice across calls:

```go
buf := make([]int, 0, 1024)
for _, ev := range events {
    buf = buf[:0]
    buf = append(buf, ev.Items...)
    process(buf...) // BUG?
}
```

**Question**: Is `process(buf...)` safe? How do you make it efficient AND safe?

<details>
<summary>Solution</summary>

**Issue**: If `process` retains `buf` past its call (stores it, hands to a goroutine), the next iteration's `buf = buf[:0]` and `append` will corrupt the retained data.

**Optimization with safety**:

**Case A — `process` doesn't retain the slice**:
```go
buf := make([]int, 0, 1024)
for _, ev := range events {
    buf = buf[:0]
    buf = append(buf, ev.Items...)
    process(buf...) // SAFE if process is purely transient
}
```

This is the most efficient form — single allocation for `buf`, reused across iterations.

**Case B — `process` may retain the slice**:
```go
for _, ev := range events {
    snapshot := make([]int, len(ev.Items))
    copy(snapshot, ev.Items)
    process(snapshot...) // process gets its own slice
}
```

Or push the copy into `process`:
```go
func process(items ...int) {
    snapshot := append([]int(nil), items...)
    // store snapshot
}
```

**Benchmark** (1k events × 100 items):
- Reused buf, transient process: ~150 µs/op, 1 alloc/op
- Per-event copy: ~400 µs/op, 1000 allocs/op

**Key insight**: Reused-slice + variadic-spread is fast but unsafe if the callee retains. Document the contract or copy at the boundary.
</details>

---

## Exercise 8 🔴 — Pool the Variadic Slice

**Problem**: `fmt`-style helper allocates a fresh `[]any` per call.

```go
func myPrintf(format string, args ...any) {
    // ... format args into a buffer ...
    _ = format; _ = args
}
```

**Question**: How would `zap`-style libraries pool the args slice?

<details>
<summary>Solution</summary>

**Optimization** — `sync.Pool` for the args buffer:
```go
var argsPool = sync.Pool{
    New: func() any { return make([]any, 0, 8) },
}

func myPrintf(format string, args ...any) {
    buf := argsPool.Get().([]any)
    defer func() {
        // CRITICAL: clear references so GC can reclaim
        for i := range buf {
            buf[i] = nil
        }
        argsPool.Put(buf[:0])
    }()
    buf = append(buf, args...)
    // ... format using buf ...
}
```

**Caveat**: this only helps if `args` itself didn't already escape (which it usually does for `...any`). The pool is most beneficial when the callee builds further intermediate slices.

**Real win** comes from typed APIs (`zap.Field`) that avoid both boxing and slice allocation.

**Benchmark** for the args-pool pattern (3 args, 1M iterations):
- Naive: ~120 ns/op, 48 B/op, 3 allocs/op
- Pooled (but still boxing): ~70 ns/op, 32 B/op, 2 allocs/op
- Typed Field (zap-style): ~15 ns/op, 0 B/op, 0 allocs/op

**Key insight**: `sync.Pool` reduces but doesn't eliminate `...any` cost. Typed APIs are the actual fix; pooling is a secondary lever.
</details>

---

## Exercise 9 🔴 — Verify Implicit Slice Stays on Stack

**Problem**: You have a typed variadic helper and want to confirm zero allocations.

```go
type Tag struct{ Key, Value string }

func emit(metric string, tags ...Tag) {
    // ... ship metric ...
    _ = metric; _ = tags
}

// Hot:
// for i := 0; i < N; i++ {
//     emit("hits", Tag{"path", "/users"}, Tag{"status", "200"})
// }
```

**Task**: Show how to verify the variadic slice doesn't escape.

<details>
<summary>Solution</summary>

**Step 1 — escape analysis**:
```bash
go build -gcflags="-m=2" 2>&1 | grep -E "tags|emit"
```

Expected output (something like):
```
./main.go:NN:NN: ([]Tag){...} does not escape
./main.go:NN:NN: emit ... can inline
```

**Step 2 — benchmark with `-benchmem`**:
```go
func BenchmarkEmit(b *testing.B) {
    for i := 0; i < b.N; i++ {
        emit("hits", Tag{"path", "/users"}, Tag{"status", "200"})
    }
}
```

```bash
go test -bench=Emit -benchmem
# BenchmarkEmit-8    100000000   12 ns/op   0 B/op   0 allocs/op
```

If you see `0 B/op, 0 allocs/op`, the implicit slice is stack-allocated.

**If allocs appear**, `emit` is retaining the slice somehow:
- It stores `tags` in a struct field, channel, or global.
- It passes `tags` to a goroutine.
- It captures `tags` in an escaping closure.

To force stack allocation, ensure `emit`'s body doesn't escape `tags`. E.g.:
- Convert each tag to a `string` immediately.
- Process inline; don't store.

**Key insight**: Escape analysis is deterministic — verify with `-gcflags="-m"` rather than guess. Once you see "does not escape," the variadic is free.
</details>

---

## Exercise 10 🔴 — Variadic + PGO

**Problem**: A `Sort` function takes a comparator via `...func`:

```go
func sortWith(s []int, less ...func(a, b int) bool) {
    if len(less) == 0 {
        sort.Ints(s)
        return
    }
    sort.Slice(s, func(i, j int) bool { return less[0](s[i], s[j]) })
}
```

**Question**: PGO can devirtualize through a variadic of function values. Show the workflow.

<details>
<summary>Solution</summary>

**Issue**: `less[0]` is an indirect call inside a hot sort loop. The compiler cannot inline it because the function value is unknown.

**Optimization with PGO** (Go 1.21+):

1. **Capture a profile** in production (or representative load test):
   ```go
   import (
       "os"
       "runtime/pprof"
   )

   f, _ := os.Create("default.pgo")
   pprof.StartCPUProfile(f)
   defer pprof.StopCPUProfile()

   // Run workload
   ```

2. **Rebuild with PGO**:
   ```bash
   go build -pgo=default.pgo .
   ```

3. **Verify devirtualization**:
   ```bash
   go build -pgo=default.pgo -gcflags="-m=2" 2>&1 | grep -i "devirtual"
   # devirtualized call: less[0] → main.dominantLessFn
   ```

The compiler will inline calls to `less[0]` when one concrete function dominates the call site (e.g., `func(a, b int) bool { return a < b }` everywhere).

**Benchmark** (sort 100k ints, 1k iterations):
- Without PGO: ~3.2 ms/op
- With PGO: ~2.5 ms/op (~22% faster)

**Without PGO, manual specialization** also works:
```go
func sortWithDefault(s []int) {
    sort.Slice(s, func(i, j int) bool { return s[i] < s[j] }) // inlinable comparator
}
```

**Key insight**: PGO automates devirtualization for variadic-of-functions. For known-dominant patterns, manual specialization works without PGO at the cost of code duplication.
</details>

---

## Bonus Exercise 🔴 — Construct vs Reuse Implicit Slice

**Problem**: You measure that `sum(1, 2, 3)` calls allocate in production. Why might that happen?

<details>
<summary>Solution</summary>

The implicit slice usually doesn't escape — but it CAN escape if:

1. **`sum` retains it** (stores in a global, channel, etc.).
2. **`sum` is generic and the compiler can't prove non-escape** for some type instantiations.
3. **Inlining is disabled** (e.g., due to a `defer` in `sum` that breaks the inliner).

**Diagnosis**:
```bash
go build -gcflags="-m=2" 2>&1 | grep escape
# Look for "[]int{...} escapes to heap"
```

**Common fixes**:
1. If `sum` stores the slice, remove the storage or copy out the element you need.
2. Inline `sum` manually at the hot call site.
3. Use a non-variadic specialization for the most common arg counts:
   ```go
   func sum2(a, b int) int { return a + b }
   func sum3(a, b, c int) int { return a + b + c }
   func sumN(xs ...int) int { /* general */ return 0 }
   ```

**Profile to confirm**:
```bash
go test -bench=Sum -benchmem -memprofile=mem.out
go tool pprof -alloc_objects mem.out
# top → look for sum's frame
```

**Key insight**: Variadic allocations are predictable and observable. `-gcflags="-m"` and `pprof -alloc_objects` will tell you exactly where.
</details>
