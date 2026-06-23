# Go Closures — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: What is a closure in Go?**

**Answer**: A closure is a function value that captures (references) variables from its enclosing lexical scope. When the function is later called, it can read and write those captured variables — even after the enclosing function has returned.

```go
func makeCounter() func() int {
    n := 0
    return func() int { n++; return n }
}

c := makeCounter()
fmt.Println(c(), c(), c()) // 1 2 3
```

`n` is captured. The returned closure keeps it alive.

---

**Q2: How does Go capture variables in a closure?**

**Answer**: **By reference**. The closure and the outer scope share the same variable. Changes outside affect inside, and vice versa.

```go
x := 1
f := func() int { return x }
x = 99
fmt.Println(f()) // 99 — sees the updated value
```

---

**Q3: How do you create a counter using a closure?**

**Answer**:
```go
func newCounter() func() int {
    n := 0
    return func() int {
        n++
        return n
    }
}

c := newCounter()
fmt.Println(c()) // 1
fmt.Println(c()) // 2
```

Each call to `newCounter()` creates a fresh `n` and a new closure that captures it.

---

**Q4: What's the loop-variable closure pitfall (pre-Go 1.22)?**

**Answer**: In Go ≤ 1.21, all closures inside a `for` loop captured the SAME loop variable. After the loop, that variable held the final value. So:

```go
for i := 0; i < 3; i++ {
    go func() { fmt.Println(i) }() // prints 3 3 3 (or races)
}
```

In Go 1.22+, each iteration has its own variable, fixing this.

---

**Q5: How do you take a snapshot of a captured variable?**

**Answer**: Shadow with `x := x` inside the closure (or before passing it):

```go
x := 1
f := func() int {
    x := x // snapshot at creation time
    return x
}
x = 99
fmt.Println(f()) // 1 — sees the snapshot
```

Or pass as an argument:
```go
f := func(snapshot int) func() int {
    return func() int { return snapshot }
}(x)
```

---

**Q6: Can a closure recurse?**

**Answer**: Not by anonymous self-reference (no name). Use:

```go
var fact func(int) int
fact = func(n int) int {
    if n <= 1 { return 1 }
    return n * fact(n-1)
}
```

The variable `fact` is captured; by call time, it's been assigned.

---

## Middle Level Questions

**Q7: When does a closure heap-allocate vs stack-allocate?**

**Answer**: Determined by escape analysis:
- **Stack**: closure doesn't escape its enclosing function (not returned, not stored in a global, not captured by another escaping closure).
- **Heap**: closure escapes — the closure struct + captured variables move to the heap.

Verify with `go build -gcflags="-m=2"`.

---

**Q8: How do you make a counter thread-safe?**

**Answer**: Synchronize with a mutex captured by the closure:

```go
func newSafeCounter() func() int {
    var mu sync.Mutex
    n := 0
    return func() int {
        mu.Lock()
        defer mu.Unlock()
        n++
        return n
    }
}
```

Or use atomic operations:
```go
import "sync/atomic"

func newAtomicCounter() func() int64 {
    var n int64
    return func() int64 {
        return atomic.AddInt64(&n, 1)
    }
}
```

---

**Q9: How do multiple closures share state?**

**Answer**: Closures defined in the same scope share the captured variables:

```go
n := 0
incr := func() { n++ }
get := func() int { return n }

incr(); incr()
fmt.Println(get()) // 2
```

Both closures share `n`. Useful for "object-like" patterns (multiple methods on one state).

---

**Q10: Can a closure capture itself?**

**Answer**: Not directly via the literal, but via a captured variable:

```go
var f func()
f = func() {
    if condition {
        f() // captures the variable f, which now holds the literal
    }
}
```

This enables recursion and self-modification.

---

**Q11: What changed about loop variables in Go 1.22?**

**Answer**: Each iteration creates a fresh variable for any iteration variable declared with `:=` (in all three for-forms). Closures capturing loop variables now see distinct per-iteration values.

This change is gated by `go 1.22` in `go.mod`. Older modules retain pre-1.22 behavior.

---

**Q12: Why does this print `1`, not `99`?**

```go
type C struct{ n int }
func (c C) Show() { fmt.Println(c.n) }

c := C{n: 1}
show := c.Show
c.n = 99
show()
```

**Answer**: `Show` has a value receiver. `c.Show` creates a method value that captures a COPY of `c` at the time of binding (when `c.n == 1`). Subsequent changes to `c` don't affect the captured copy.

For pointer-receiver methods, the closure would capture the pointer, and changes would be visible.

---

## Senior Level Questions

**Q13: Walk through what happens when the compiler sees `func() { x++ }` capturing `x`.**

**Answer**:
1. **Free variable analysis**: identifies `x` as a free variable.
2. **Closure conversion**: synthesizes a closure struct type containing a pointer to `x`.
3. **Heap promotion**: if the closure escapes, `x` is allocated on the heap as a "shared cell"; its address is stored in the closure struct.
4. **Body rewriting**: replaces `x++` with loads/stores through the closure context register (DX on amd64).
5. **Funcval generation**: emits a function value pointing to the compiled body, with the closure struct attached.
6. **Caller code**: when the closure is called, DX is set to the closure struct address before the indirect call.

---

**Q14: What's the cost of an indirect call through a closure?**

**Answer**: Approximately 3-5 cycles vs 1-2 for a direct call. Cost components:
- Load funcval pointer.
- Load code pointer from funcval.
- Indirect branch (may mispredict if call target varies).
- No inlining (compiler can't see the body at the call site).

For typical code this is negligible. For tight inner loops doing >10⁸ calls/sec, it matters.

PGO (Go 1.21+) can devirtualize hot indirect calls.

---

**Q15: How does the Go 1.22 loop-variable change work at the implementation level?**

**Answer**: The compiler synthesizes a per-iteration variable. Conceptually:

```go
for i := 0; i < N; i++ { body }

// becomes:

for outerI := 0; outerI < N; outerI++ {
    i := outerI // fresh per iteration
    body
}
```

When closures don't capture `i`, the compiler optimizes away the per-iteration alloc (uses a single stack slot). When closures DO capture, each iteration's `i` gets its own storage.

The change is gated by `go.mod`'s `go` directive.

---

**Q16: A closure captures a 1 MB struct pointer. What's the memory impact?**

**Answer**: As long as the closure exists, the 1 MB struct is reachable through the closure's capture and cannot be GC'd. If you have N such closures, you pin N × 1 MB.

Fix: extract only the data you need:
```go
// Bad
func makeF(big *BigData) func() byte {
    return func() byte { return big.firstByte() } // pins big
}

// Good
func makeF(big *BigData) func() byte {
    first := big.firstByte()
    return func() byte { return first } // captures 1 byte
}
```

After the fix, `big` becomes unreachable as soon as `makeF` returns.

---

**Q17: What happens when a goroutine captures a variable in a long-running closure?**

**Answer**: The captured variable (and its pointees) stay alive for the lifetime of the goroutine. If the goroutine never exits, the variables are pinned forever — a memory leak.

Always design long-running goroutines for cancellation:
```go
go func(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        // ... work ...
        }
    }
}(ctx)
```

---

**Q18: How do you minimize GC pressure from closures?**

**Answer**:
1. **Capture primitives** (int, bool) instead of pointers when possible.
2. **Group captures** in a small struct to reduce per-closure overhead.
3. **Drop closures promptly** when done; nil out references.
4. **Avoid creating closures in hot loops**; hoist them out.
5. **Use struct + methods** instead of closures when state is rich (one allocation, fewer roots).

---

**Q19: What's the difference between a closure and a method value in Go's representation?**

**Answer**: A method value `c.M` is essentially a closure that captures the receiver `c`. The runtime synthesizes a funcval whose code pointer is the method body and whose context contains `c`.

A general closure has the same structure but with arbitrary captured variables.

Both are funcvals at runtime. Method values are a special case of closures.

For hot paths, method expressions `T.M` produce a function value WITHOUT capturing the receiver (the receiver is passed as the first arg) — no allocation for binding.

---

**Q20: Closure-based DSL vs interface-based design — when do you choose each?**

**Answer**:
- **Closures**: when the "policy" is small, single-method-like, and dynamic. Composable combinators (And, Or, Filter) are natural as closures.
- **Interfaces**: when there's a fixed contract with multiple methods, used across many call sites, or when implementations are rich enough to deserve their own type.

Closures excel for combinator libraries (pipelines, predicate combinations). Interfaces excel for plugin architectures.

The `http.HandlerFunc` adapter shows the bridge: a function type that satisfies an interface — getting both the closure ergonomics and interface compatibility.

---

## Scenario-Based Questions

**Q21: Your service uses closures heavily and now experiences high GC pause times. How do you diagnose?**

**Answer**:
1. **Profile allocations**: `go test -benchmem -bench=.` and `pprof -alloc_objects`.
2. **Identify high-allocation closures**: which call sites?
3. **Check capture sizes**: are large objects pinned via captures?
4. **Reduce captures**: extract minimum data, capture primitives.
5. **Hoist closures out of hot loops**.
6. **Consider migrating to struct + methods** for rich state.
7. **Bound closure pool sizes** if using closures as queue items.

---

**Q22: A test was passing in Go 1.21 but now fails in Go 1.22. The test spawns goroutines in a loop. What might have changed?**

**Answer**: The Go 1.22 loop-variable change. Code that relied on shared loop-variable behavior may now see distinct per-iteration values. Some tests benefit (latent bugs revealed); others break (pre-existing assumptions invalidated).

Investigation:
1. Identify the goroutines and what they capture.
2. Check whether the test depends on all goroutines seeing the SAME final value (broken behavior in retrospect).
3. Update test expectations to match correct per-iteration behavior, OR explicitly capture the final value if that was intentional.

---

**Q23: A code reviewer suggests "extract this closure to a struct". Valid push-back?**

**Answer**:
- The closure has 1-2 captures and a single behavior — closure is concise.
- The closure is local to one function, no reuse needed — closure avoids ceremony.
- The closure uses generics in a way structs would complicate.

Push to extract when:
- 3+ captures or rich state.
- Need direct testing.
- Multiple methods on the same state.
- Closure escapes and is heavily used (allocation profile shows it).

The choice is contextual. Both are idiomatic.

---

**Q24: A service spawns thousands of goroutines per second, each capturing per-request data. Memory grows. How do you fix?**

**Answer**:
1. **Audit the goroutine bodies**: are they exiting promptly, or leaking?
2. **Check captured data sizes**: is per-request state being pinned?
3. **Add `runtime.SetMaxGCPercent` or similar** to throttle GC — but this is a band-aid.
4. **Extract minimum captures**: only what each goroutine actually needs.
5. **Use a worker pool** instead of spawning per request — N workers draining a channel of requests.
6. **Add cancellation context** to ensure goroutines exit on shutdown or timeout.

Worker pool is usually the right architecture for high-throughput systems.

---

## FAQ

**Are closures slower than direct function calls?**

For non-capturing literals: identical speed (sometimes inlined).
For capturing closures: ~3-5 cycles per call extra (indirect call) + heap allocation if escaping.

For typical code, the difference is irrelevant. For hot inner loops, prefer direct calls.

---

**Why doesn't Go have explicit closure syntax?**

Go's design treats closures as a natural consequence of function literals capturing variables. There's no separate `closure` keyword because every function literal is potentially a closure.

---

**Can I close over `for range` variables in Go 1.22?**

Yes, and they now have per-iteration semantics. Each closure captures a fresh `i` (or other iteration variable).

---

**How do I use closures with goroutines safely?**

1. Pass loop variables as arguments (or use Go 1.22+).
2. Synchronize captured mutable state.
3. Ensure goroutines exit (avoid leaks).
4. Capture minimum data.

---

**Can closures be compared?**

No. Function values (closures included) can only be compared to nil. `f == g` is a compile error.

---

**Why does my closure show as `main.main.func1`?**

That's the synthesized name from closure conversion. Use named functions if you want clearer stack traces and profiler outputs.

---

**Does `defer` invoke a closure?**

Yes. `defer func() { ... }()` schedules the closure call for function exit. The closure captures any variables it references; their values at exit time are what the closure sees.

---

**Where can I see closure conversion in the Go source?**

`cmd/compile/internal/walk/closure.go` and related files in `cmd/compile/internal/ir/`. Also check `cmd/compile/internal/escape/` for escape analysis decisions.
