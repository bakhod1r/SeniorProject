# Go Functions Basics — Optimize

## Instructions

Each exercise presents a slow, allocation-heavy, or otherwise wasteful use of functions. Identify the issue, write an optimized version, and explain the improvement. Always benchmark before and after — `go test -bench` is your friend. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Exercise 1 🟢 — Indirect Call in a Hot Loop

**Problem**: A function passes a callback through a function-typed parameter and is called millions of times per second.

```go
func sumWith(xs []int, transform func(int) int) int {
    total := 0
    for _, x := range xs {
        total += transform(x)
    }
    return total
}

func double(x int) int { return x * 2 }

// In hot path:
// _ = sumWith(data, double)
```

**Question**: Why might this be slower than necessary, and how do you fix it without changing the API?

<details>
<summary>Solution</summary>

**Issue**: Each call to `transform` is an **indirect call** through a function value. The compiler cannot inline `double` because it doesn't know what `transform` is at compile time. Each iteration costs ~3-5 cycles for the indirect call instead of 0-1 for an inlined `x * 2`.

**Optimization** — write a direct version when the transform is fixed:
```go
func sumDoubled(xs []int) int {
    total := 0
    for _, x := range xs {
        total += x * 2 // inlined, vectorizable
    }
    return total
}
```

**Benchmark** (1M ints):
- `sumWith` (indirect callback): ~1.4 ms
- `sumDoubled` (direct): ~0.4 ms (~3.5×)

**When the API must stay generic** — devirtualize at the call site by storing the concrete function in a typed variable that the compiler can track, or use generics (Go 1.18+):

```go
func SumWith[T any](xs []T, transform func(T) T, add func(T, T) T) T {
    var zero T
    total := zero
    for _, x := range xs {
        total = add(total, transform(x))
    }
    return total
}
```

Go 1.21+ devirtualizes some interface and function-typed calls when the concrete type is statically knowable. PGO (`go build -pgo=...`) extends this to hot indirect calls.

**Key insight**: Function-typed parameters are great for flexibility but defeat inlining. In hot paths, prefer direct calls or generics.
</details>

---

## Exercise 2 🟢 — Closure Allocation in a Loop

**Problem**: A function is built fresh each iteration of a tight loop.

```go
func processAll(items []int) {
    for _, x := range items {
        run(func() int {
            return x + 1
        })
    }
}
```

**Question**: What is the cost, and how do you fix it?

<details>
<summary>Solution</summary>

**Issue**: Each iteration creates a new closure value capturing `x`. If the closure escapes to `run`, it heap-allocates. Even if it doesn't escape, the per-iteration allocation pressure shows up in benchmarks.

**Run** to confirm:
```bash
go build -gcflags="-m" .
# ./main.go:N:11: func literal escapes to heap
```

**Optimization** — pass the value as an argument instead of capturing:
```go
func processAll(items []int) {
    for _, x := range items {
        run(func(v int) int { return v + 1 }, x)
    }
}
```

Even better, lift the literal outside the loop so it's only allocated once:
```go
func processAll(items []int) {
    inc := func(v int) int { return v + 1 }
    for _, x := range items {
        run(inc, x)
    }
}
```

**Benchmark** (1M iterations, closure escapes):
- Per-iteration closure: ~80 ns/op, 24 B/op, 1 alloc/op
- Lifted closure with arg: ~10 ns/op, 0 B/op, 0 allocs/op

**Key insight**: A closure capturing per-iteration data forces an allocation per iteration when it escapes. Capture nothing — pass data as arguments — and lift the closure outside the loop.
</details>

---

## Exercise 3 🟢 — `defer` in a Tight Loop

**Problem**: A function `mu.Lock` / `mu.Unlock` pair is wrapped with defer inside a million-iteration loop.

```go
func bumpAll(items []int, mu *sync.Mutex, m map[int]int) {
    for _, k := range items {
        mu.Lock()
        defer mu.Unlock() // BUG
        m[k]++
    }
}
```

**Question**: Two issues here. What are they, and how do you fix?

<details>
<summary>Solution</summary>

**Issues**:
1. `defer mu.Unlock()` runs at **function exit**, not at end of iteration. After the first iteration the mutex stays locked; the second iteration deadlocks.
2. Even if iteration didn't deadlock (hypothetically), defer in a loop is ~50 ns/iter and prevents open-coded defer optimization.

**Fix** — explicit unlock per iteration, or split into a helper:
```go
// Option A: explicit unlock
func bumpAll(items []int, mu *sync.Mutex, m map[int]int) {
    for _, k := range items {
        mu.Lock()
        m[k]++
        mu.Unlock()
    }
}

// Option B: helper function
func bumpAll(items []int, mu *sync.Mutex, m map[int]int) {
    for _, k := range items {
        bump(mu, m, k)
    }
}

func bump(mu *sync.Mutex, m map[int]int, k int) {
    mu.Lock()
    defer mu.Unlock() // open-coded defer; ~1 ns
    m[k]++
}
```

**Benchmark** (1M iterations):
- Per-iter `mu.Lock(); m[k]++; mu.Unlock()`: ~22 ns/iter
- Per-iter via helper with defer: ~24 ns/iter (open-coded)
- Per-iter `mu.Lock(); defer mu.Unlock(); m[k]++` (the buggy version, deadlocks): N/A

**Key insight**: `defer` always runs at function exit. For per-iteration cleanup, either unlock explicitly or extract a helper so the defer scope is the iteration.
</details>

---

## Exercise 4 🟡 — Returning a Pointer Forces Heap Allocation

**Problem**: A constructor returns a pointer to a small struct.

```go
type Point struct{ X, Y float64 }

func newPoint(x, y float64) *Point {
    return &Point{X: x, Y: y}
}

// In hot path:
// for i := 0; i < N; i++ {
//     p := newPoint(float64(i), float64(i*2))
//     consume(p)
// }
```

**Question**: Where does the `Point` live, and is there a cheaper alternative?

<details>
<summary>Solution</summary>

**Where it lives**: `&Point{...}` escapes to the heap because the function returns a pointer. Each call allocates ~16 bytes plus GC tracking metadata. Verify:
```bash
go build -gcflags="-m" .
# &Point{...} escapes to heap
```

**Optimization** — return a value when the type is small (≤ ~64 bytes):
```go
func newPoint(x, y float64) Point {
    return Point{X: x, Y: y}
}

for i := 0; i < N; i++ {
    p := newPoint(float64(i), float64(i*2))
    consume(p)
}
```

The `Point` lives on the caller's stack, and Go's register ABI passes/returns it efficiently in registers (typically X0, X1 for two float64s).

**Benchmark** (1M iterations):
- Return `*Point`: ~30 ns/op, 16 B/op, 1 alloc/op
- Return `Point`: ~3 ns/op, 0 B/op, 0 allocs/op (~10×)

**When to keep the pointer return**: when callers must mutate the struct, when the type embeds a mutex/lock, or when the struct is large and copying would dominate.

**Key insight**: "Pointer = fast, value = slow" is wrong for small types. The register ABI makes value-typed returns very cheap; pointers force heap allocations.
</details>

---

## Exercise 5 🟡 — Boxing Through `interface{}`

**Problem**: A logging helper takes `any`, and is called in the hot path.

```go
func log(msg string, fields ...any) {
    // ... format msg with fields ...
    _ = msg
    _ = fields
}

// Hot path:
// for _, x := range data {
//     log("processed", x.ID, x.Score)
// }
```

**Question**: Where do allocations come from?

<details>
<summary>Solution</summary>

**Issue**: Passing a value through `any` (== `interface{}`) **boxes** non-pointer-typed values. Each `int`, `float64`, `bool`, etc. allocates an interface header + value on the heap (typically 8-16 B for scalars).

For `log("processed", x.ID, x.Score)` with two ints, that's 2 boxing allocations + 1 slice allocation for the `fields` variadic = 3 allocs per call.

**Optimization** — typed APIs for hot paths:
```go
type LogFields struct {
    ID    int
    Score int
    // add only what you need
}

func logTyped(msg string, f LogFields) { /* ... */ }

for _, x := range data {
    logTyped("processed", LogFields{ID: x.ID, Score: x.Score})
}
```

Or use a structured logger like `zap` / `zerolog` that avoids reflection for typed fields:
```go
log.Info("processed", zap.Int("id", x.ID), zap.Int("score", x.Score))
// zap uses sync.Pool + typed Field structs to avoid most allocations
```

**Benchmark** (1M iterations):
- `log("processed", id, score)` via `any`: ~95 ns/op, 64 B/op, 3 allocs/op
- `logTyped("processed", LogFields{...})`: ~12 ns/op, 0 B/op, 0 allocs/op

**Key insight**: `any` parameters are extremely flexible but force boxing for non-pointer values. For high-frequency call sites, typed APIs eliminate hidden allocations.
</details>

---

## Exercise 6 🟡 — Method Value Allocation in a Loop

**Problem**: Inside a loop, the code passes a method value as a callback.

```go
type Handler struct{ counter int }

func (h *Handler) Process(x int) { h.counter += x }

func runAll(h *Handler, data []int, fn func(int)) {
    for _, x := range data {
        fn(x)
    }
}

// Caller:
// h := &Handler{}
// for i := 0; i < N; i++ {
//     runAll(h, data, h.Process)
// }
```

**Question**: What allocates and how do you fix it?

<details>
<summary>Solution</summary>

**Issue**: `h.Process` is a **method value**. Creating a method value allocates a small `funcval` header that captures the receiver (`h`). This allocation happens at **every iteration** of the outer loop because `h.Process` is re-bound each call.

Verify:
```bash
go build -gcflags="-m" .
# h.Process escapes to heap (in some patterns)
```

**Optimization** — bind the method value once outside the loop:
```go
h := &Handler{}
process := h.Process // bind once
for i := 0; i < N; i++ {
    runAll(h, data, process)
}
```

**Or** use a method expression and pass the receiver explicitly (no boxing):
```go
func runAllExpr(h *Handler, data []int, fn func(*Handler, int)) {
    for _, x := range data {
        fn(h, x)
    }
}

// Caller:
process := (*Handler).Process // method expression: no boxing
for i := 0; i < N; i++ {
    runAllExpr(h, data, process)
}
```

**Benchmark** (1M outer iterations × 100 inner):
- `h.Process` re-bound each iter: ~120 ns/outer-op, 16 B/outer-op, 1 alloc/outer-op
- Bound once outside: ~110 ns/outer-op, 0 allocs
- Method expression: ~108 ns/outer-op, 0 allocs

**Key insight**: Each binding of a method value is a tiny allocation. In hot loops, bind once, or use a method expression.
</details>

---

## Exercise 7 🟡 — Variadic Slice Allocation

**Problem**: A variadic function is called with no args inside a loop.

```go
func event(name string, tags ...string) {
    // ... emit ...
    _ = name; _ = tags
}

for i := 0; i < N; i++ {
    event("tick")
}
```

**Question**: Does this allocate?

<details>
<summary>Solution</summary>

**Surprisingly**: when called with **no variadic arguments**, Go passes a `nil` slice — no allocation. Let's verify:
```bash
go test -benchmem -bench=.
# 0 allocs/op
```

When called with **a few arguments**, Go allocates a small slice on the **caller's stack** (since Go 1.4 for known-small variadic counts):
```go
event("tick", "tag1", "tag2") // typically stack-allocated slice
```

**The allocation appears** when the slice escapes (gets stored in a long-lived field, captured by an escaping closure, sent on a channel, etc.):
```go
var saved []string
func event(name string, tags ...string) {
    saved = tags // tags escapes; backing array on heap
}
```

**Optimization** — when you call variadic with a slice you already have, use the spread `...`:
```go
tags := []string{"tag1", "tag2"}
event("tick", tags...) // passes the existing slice; no copy
```

But beware: the callee may modify or hold references to the passed slice.

**Key insight**: Variadic params are not inherently allocating. They allocate only when the slice's backing array escapes. Read `-gcflags="-m"` to verify.
</details>

---

## Exercise 8 🔴 — Inlining Blocked by `defer`

**Problem**: A small function with `defer` won't inline, even though it looks tiny.

```go
func tryUpdate(m map[string]int, k string, v int) {
    defer func() {
        if r := recover(); r != nil {
            // log
        }
    }()
    m[k] = v
}
```

**Question**: Why doesn't this inline, and how do you fix it?

<details>
<summary>Solution</summary>

**Issue**: Functions containing `defer` were historically not inlinable. Since Go 1.20-1.22 the inliner has become more permissive, but `defer` with `recover` (especially from a closure) still often blocks inlining. Verify:
```bash
go build -gcflags="-m -m" .
# cannot inline tryUpdate: function too complex: cost X exceeds budget 80
# (or specifically: contains a defer)
```

**Optimization** — extract the defer/recover into a separate function so the inner `m[k] = v` becomes a tiny inlinable function:

```go
func tryUpdate(m map[string]int, k string, v int) {
    defer recoverIgnored()
    m[k] = v
}

//go:noinline
func recoverIgnored() {
    if r := recover(); r != nil {
        // log
    }
}
```

But honestly: if you call `tryUpdate` in a hot loop and inlining matters, **don't use `recover` at all** here. Map writes don't panic in normal use. Reserve recover for true unknown-input boundaries.

**Better fix** — remove the recover entirely:
```go
func tryUpdate(m map[string]int, k string, v int) {
    m[k] = v
}
```

This inlines trivially.

**Key insight**: `defer`+`recover` carries hidden cost beyond the defer itself — it blocks inlining. Use only at API boundaries, never per-iteration in hot paths.
</details>

---

## Exercise 9 🔴 — `return &local` Allocates Where a Caller Stack Frame Could Suffice

**Problem**:

```go
func newPair(a, b int) *[2]int {
    return &[2]int{a, b}
}

// Hot path:
for i := 0; i < N; i++ {
    p := newPair(i, i+1)
    consume(p)
}
```

**Question**: Verify this allocates, then propose a non-allocating alternative.

<details>
<summary>Solution</summary>

**Verification**:
```bash
go build -gcflags="-m" .
# &[2]int{...} escapes to heap
```

Per call: ~16 B (2 × 8-byte ints) on the heap.

**Optimization** — return a value:
```go
func newPair(a, b int) [2]int {
    return [2]int{a, b}
}

for i := 0; i < N; i++ {
    p := newPair(i, i+1)
    consume(p)
}
```

`[2]int` is 16 B, well within the register ABI budget — passed via X0/X1 registers, no allocation.

**Benchmark** (1M iters):
- Return `*[2]int`: ~30 ns/op, 16 B/op, 1 alloc/op
- Return `[2]int`: ~3 ns/op, 0 B/op, 0 allocs/op

**When the caller writes a sink pattern**, you can also have the caller pre-allocate and the function fill in:
```go
func fillPair(out *[2]int, a, b int) {
    out[0] = a
    out[1] = b
}

// Caller:
var p [2]int
for i := 0; i < N; i++ {
    fillPair(&p, i, i+1)
    consume(p)
}
```

This pattern avoids both the heap allocation and the return-value copy when `consume` doesn't need a fresh value each iteration.

**Key insight**: Returning a pointer to a freshly-constructed value forces heap allocation. For small fixed-size types, return by value. For caller-controlled lifetime, take a pointer parameter to fill in.
</details>

---

## Exercise 10 🔴 — PGO-Sensitive Function

**Problem**: A function is called via an interface in 99% of invocations from a single concrete type, but the compiler treats every call as fully indirect.

```go
type Doer interface {
    Do(int) int
}

type RealDoer struct{ scale int }
func (r *RealDoer) Do(x int) int { return x * r.scale }

func runMany(d Doer, xs []int) int {
    total := 0
    for _, x := range xs {
        total += d.Do(x) // indirect interface call
    }
    return total
}

// In production, called with *RealDoer 99% of the time:
// _ = runMany(real, data)
```

**Question**: How do you tell the compiler about the dominant concrete type so calls get inlined?

<details>
<summary>Solution</summary>

**Optimization 1 — PGO (Profile-Guided Optimization, Go 1.21+)**:

1. Capture a CPU profile from production:
   ```go
   import _ "net/http/pprof"
   // OR:
   pprof.StartCPUProfile(f)
   ```
2. Save profile as `default.pgo` next to `main.go`.
3. Build with PGO:
   ```bash
   go build -pgo=default.pgo .
   ```

The compiler sees that `d.Do` is dominantly `(*RealDoer).Do` and **devirtualizes** the call — inlining `RealDoer.Do` directly with a type-check fallback.

**Optimization 2 — Manual specialization** (no PGO):
```go
func runManyReal(d *RealDoer, xs []int) int {
    total := 0
    for _, x := range xs {
        total += d.Do(x) // direct call; inlinable
    }
    return total
}

func runMany(d Doer, xs []int) int {
    if r, ok := d.(*RealDoer); ok {
        return runManyReal(r, xs) // fast path
    }
    // generic fallback
    total := 0
    for _, x := range xs {
        total += d.Do(x)
    }
    return total
}
```

The type switch costs 1-2 ns at the entry, but the loop body becomes inlinable.

**Benchmark** (1M iters):
- Plain interface call: ~5.0 ns/op
- PGO-devirtualized: ~2.2 ns/op
- Manually specialized: ~1.8 ns/op

**Key insight**: Indirect calls (interfaces, function values) prevent inlining. PGO automates devirtualization for production workloads; manual specialization works without PGO at the cost of code duplication.
</details>

---

## Bonus Exercise 🔴 — Verify Inlining of a Hot Function

**Problem**: You wrote a small helper and want to confirm it inlines:

```go
func clamp(x, lo, hi int) int {
    if x < lo {
        return lo
    }
    if x > hi {
        return hi
    }
    return x
}
```

**Task**: Show the commands and output that prove `clamp` inlines into its callers.

<details>
<summary>Solution</summary>

```bash
# Step 1: see inlining decisions
go build -gcflags="-m -m" 2>&1 | grep clamp

# Expected output (truncated):
# ./main.go:N:6: can inline clamp with cost X as: ...
# ./main.go:M:N: inlining call to clamp
```

**Step 2 — inspect the assembly to confirm**:
```bash
go build -gcflags="-S" 2>asm.txt
# Look at the caller's body — clamp's instructions appear inline,
# with no CALL to "main.clamp".
```

**Step 3 — confirm zero overhead**:
```go
func BenchmarkClamp(b *testing.B) {
    sum := 0
    for i := 0; i < b.N; i++ {
        sum += clamp(i, 10, 100)
    }
    _ = sum
}
```

```bash
go test -bench=Clamp -benchmem
# BenchmarkClamp-N    1000000000    0.5 ns/op    0 B/op    0 allocs/op
```

If `clamp` were not inlined, you'd see ~3 ns/op for the call overhead.

**Step 4 — disable inlining to confirm the difference**:
```go
//go:noinline
func clampSlow(x, lo, hi int) int { /* same body */ }
```

```
BenchmarkClampSlow-N    300000000    3.5 ns/op    0 B/op    0 allocs/op
```

The 7× difference is exactly the call overhead.

**Key insight**: Always verify your performance assumptions with `-gcflags="-m"` and `go test -bench`. Compiler decisions (inlining, escape, BCE) are deterministic and observable — never guess.
</details>
