# Go Defer — Senior Level

## 1. Overview

Senior-level defer mastery means precise understanding of three implementations the Go runtime can pick from for a given `defer` statement, the cost model for each, the interaction with the panic/recover machinery in `runtime/panic.go`, escape analysis on captured variables in deferred closures, and the implications for stack traces, GC, and tail-call elimination.

Three execution paths exist:
1. **Open-coded defer** (Go 1.14+, fast path, no allocation): the compiler emits inline code for the deferred call directly in the function epilogue.
2. **Stack-allocated defer** (`_defer` record on the stack): used when open-coded isn't applicable but the count is bounded at the call site.
3. **Heap-allocated defer** (the original Go ≤ 1.12 behavior): used when defers can run an unbounded number of times (defers inside loops).

The compiler chooses per-statement based on whether the defer is inside a loop, the total defer count in the function, whether the function uses `recover()`, and whether `-N` (no optimization) is in effect.

---

## 2. The Three Implementations

### 2.1 Open-Coded Defer (Go 1.14+)

The compiler emits the deferred call's machine code directly into the function's exit paths. There is no allocation, no linked-list manipulation, and no indirect call.

For:
```go
func f() {
    mu.Lock()
    defer mu.Unlock()
    work()
}
```

The compiler can transform to (conceptually):
```go
func f() {
    mu.Lock()
    work()
    mu.Unlock()
}
```

Plus a bit of bookkeeping to handle the panic case via a per-function "defer bits" bitmask, recorded in a `funcdata` table for the runtime to consult during panic unwinding.

#### Eligibility for open-coded defer

From `cmd/compile/internal/ssagen/ssa.go` (and historically `walk/order.go`), the conditions are roughly:
- The function has **at most 8 defer statements**.
- **No defer is inside a loop** (i.e., they are reachable a bounded number of times — at most once each).
- The function **does not call `recover` from a non-deferred caller**.
- The compiler optimizations are not disabled (`-gcflags=-N` disables them).
- The defer's call expression is "simple enough" that the compiler can stage its arguments in slots.

If any condition fails, the compiler falls back to the next strategy.

#### How panics see open-coded defers

When a panic propagates, the runtime needs to find which deferred calls to run. For open-coded defers, there's no `_defer` record, so the runtime consults a sidecar:
- A bitmask (`deferBits`) on the stack frame: bit `i` is set when the i-th defer has been registered.
- A `funcdata` table that maps each bit to a small program: where in the frame the call's arguments are staged, what function pointer to call.

`runtime.runOpenDeferFrame` walks this metadata during panic recovery in `runtime/panic.go`.

### 2.2 Stack-Allocated Defer

Pre-Go 1.13 always allocated `_defer` records on the heap. Go 1.13 introduced stack-allocated `_defer` records as an optimization. The record lives in the function's stack frame; the runtime threads it onto the per-`g` defer list with a single store.

```c
// runtime/runtime2.go
type _defer struct {
    siz       int32   // (no longer used after Go 1.17 ABI change)
    started   bool
    heap      bool    // true if heap-allocated, false if stack
    openDefer bool    // true if this is an open-coded defer record (rare)
    sp        uintptr
    pc        uintptr
    fn        *funcval
    _panic    *_panic
    link      *_defer
}
```

A stack-allocated defer is cheaper than heap (no GC pressure), but slower than open-coded (still pays for the linked-list push and the indirect call).

### 2.3 Heap-Allocated Defer

The fallback for "anything else", notably defers inside loops or in functions that don't qualify for open-coded.

```go
for _, x := range xs {
    defer cleanup(x)
}
```

Each iteration allocates a `_defer` on the heap, fills in `fn`, `pc`, `sp`, the captured arguments, and pushes onto the goroutine's defer list.

This is also the slowest path: ~30 ns/defer on Go 1.12 hardware. Go 1.14 didn't fix this case — it's still slow, because the defer count is unbounded at compile time.

---

## 3. Argument Evaluation Mechanics

Every defer evaluates its arguments at defer-time:

```go
func f() {
    x := 1
    defer log(x)  // log(1) is conceptually scheduled
    x = 2
}
```

The compiler:
1. Evaluates `x` (= 1) into a temporary.
2. Stores the temporary into the defer's argument slot (in the `_defer` record, or on the stack frame for open-coded).
3. Schedules the call.

For open-coded defers, the argument slot is a stack location reserved by the compiler. The deferred call's machine code reads from this slot at exit time.

For stack/heap-allocated defers, the argument slot is part of the `_defer` record. The runtime copies the slot into the new stack frame when invoking the deferred call.

For variadic functions (`fmt.Printf("...", args...)`), the slice header is also evaluated at defer-time. The slice **backing array** is shared, so a later `args[0] = ...` would still be visible (a pointer escape):

```go
args := []interface{}{x}
defer fmt.Println(args...) // header captured; backing array still referenced
args[0] = 999              // visible to deferred call
```

This is rarely intended. Almost always use a closure if you want late binding.

---

## 4. Closure Captures In Deferred Calls

A deferred closure captures variables by reference (per Go closure semantics). The closure value is allocated like any other closure — on the stack if it doesn't escape, on the heap if it does.

```go
func f() {
    x := 1
    defer func() { fmt.Println(x) }() // closure captures &x
    x = 2
}
```

The closure's funcval is built with a context pointer that points to a struct containing the captured variables (or pointers to them). Inside the deferred body, `x` is read through this context.

Escape analysis: because the closure's lifetime extends beyond the lexical scope of `x` (the closure is called at function exit, after `x = 2`), `x` must escape to the heap if the deferred-closure escapes. In practice, since the deferred closure runs in the same function, `x` may stay on the stack — the compiler can prove it doesn't outlive the frame.

You can confirm with `-gcflags=-m`:
```bash
go build -gcflags="-m=2" 2>&1 | grep -E "moved to heap|does not escape"
```

---

## 5. Panic / Defer / Recover Interaction

The runtime stores a per-`g` (goroutine) `_defer` linked list and a per-`g` `_panic` linked list. When `panic(v)` is called:

1. A `_panic` record is allocated.
2. The runtime walks the deferred-call list from head (most recent) to tail.
3. For each `_defer`, the runtime invokes the deferred function.
4. If the deferred function calls `recover()`, the runtime sets `recovered = true` on the current panic.
5. After the deferred function returns, if `recovered`, the panic stops propagating; the runtime jumps back to the function whose deferred call recovered, and that function returns normally.
6. If not recovered, the runtime continues unwinding and crashes the goroutine.

Key file: `runtime/panic.go`. Functions of interest:
- `gopanic` — entry point for `panic(v)`.
- `gorecover` — implementation of `recover()`.
- `runOpenDeferFrame` — runs open-coded defers during panic.
- `deferreturn` — the function the compiler inserts at the end of any function that uses defers.

### 5.1 Why `recover` only works in a deferred call

`gorecover` checks: is the current panic the most recent one, AND is the calling function the one immediately invoked by the panic-handling deferred call? If not, return `nil`. This precise check is why:
- `recover()` outside a deferred function returns `nil`.
- `recover()` in a function called by a deferred function (one frame deeper) also returns `nil`.

```go
defer func() {
    helper() // helper calls recover()
}()
panic("x")
// helper's recover() returns nil — wrong frame.
```

You must call `recover()` directly inside the deferred function.

---

## 6. The `deferreturn` Trampoline

For each function that uses defer (non-open-coded path), the compiler appends a call to `runtime.deferreturn` at every return. `deferreturn` walks the goroutine's defer list, popping records that belong to the current function and invoking them.

A function with open-coded defers does NOT need this trampoline — the compiler emits the calls inline.

You can see this with `go tool objdump` on a binary:
```bash
go build -o app main.go
go tool objdump -s "main\.f$" app | grep deferreturn
```

If you see `CALL runtime.deferreturn`, the function uses the slow path. If not, the defers are open-coded.

---

## 7. Stack Traces Through Defers

A stack trace during panic shows the panic's origin and the deferred frames currently executing:

```
panic: oh no

goroutine 1 [running]:
main.deferred(...)
        main.go:8
main.f(...)
        main.go:13
main.main()
        main.go:18 +0x...
```

Each deferred call appears as a frame because it actually is one — the runtime calls it and unwinds through its return.

Open-coded defers complicate this slightly. Because the call is inlined, the runtime has to synthesize the frame from `funcdata` so the trace looks the same to users.

---

## 8. GC Implications

Each pending `_defer` (heap or stack) holds references to:
- The deferred function (`fn`).
- The captured arguments.
- For closures, the closure's environment.

These count as GC roots until the defer fires. A long-running function with many heap-allocated defers (i.e., defers in a loop) holds onto every captured argument until function return. This is a classic memory-leak shape:

```go
func leak() {
    for _, big := range bigSlices {
        defer process(big) // pins every `big` until leak() returns
    }
}
```

If `bigSlices` has 1M entries, that's 1M `_defer` records + 1M references to large slices, all held alive until the function ends.

The fix is the same as the cleanup-leak fix: extract a helper, or call `process(big)` directly inside the loop without defer.

---

## 9. The 8-Defer Limit For Open-Coded

Why 8? The deferBits bitmask is an 8-bit field on the stack frame. The compiler authors chose 8 as a balance between covering most common cases and keeping the bitmask cheap. Functions with 9+ defers fall back to stack-allocated.

This is observable: a function with 8 defers is fast; the same function with 9 defers gets slower across the board.

```go
// Fast path
func f8() {
    defer a(); defer b(); defer c(); defer d()
    defer e(); defer f(); defer g(); defer h()
    work()
}

// Slow path (one extra defer)
func f9() {
    defer a(); defer b(); defer c(); defer d()
    defer e(); defer f(); defer g(); defer h()
    defer i()
    work()
}
```

---

## 10. Loops Disqualify Open-Coding

Even one defer inside a loop disqualifies the entire function from open-coding:

```go
// All defers fall back to slow path
func f() {
    defer A()      // slow because of the loop below
    for {
        defer B()  // unbounded count
    }
    defer C()      // slow
}
```

The compiler can't statically bound the total defer count, so it must use the linked-list path for everything.

A workaround: extract the loop body into a helper, leaving the outer function with only fixed defers.

---

## 11. Inlining And Defer

A function containing `defer` was historically not inlinable. Since Go 1.18 or so, the inliner can sometimes inline functions with simple defers, but this is conservative.

Check with `-gcflags=-m`:
```bash
go build -gcflags="-m" 2>&1 | grep "can inline"
```

If you see "function too complex" or "contains non-inlinable defer", the defer is preventing inlining.

This indirectly affects performance: a small wrapper function with `defer mu.Unlock()` inside might not inline into its callers, costing one call's worth of overhead per invocation. For super-hot paths, this matters; for everything else, it doesn't.

---

## 12. Profile-Guided Optimization (PGO)

Go 1.20+ supports PGO. PGO can devirtualize hot indirect calls, including the indirect call inside a defer (when the function pointer is constant at the call site). This is rare for defer specifically — the function is usually statically known — but PGO can help when the defer body itself contains indirect calls (e.g., via interfaces).

For most defer-heavy code, PGO's benefit is indirect: it inlines callers of defer-using functions, smoothing over the slight inlining cost.

---

## 13. Stack Growth And Defers

When a function's stack grows (Go grows stacks dynamically), all `_defer` records on that stack are relocated. This is correct because each `_defer` records its target function pointer, not a stack address.

For open-coded defers, the stack frame's reserved slots are simply moved with the frame. The compiler-generated bookkeeping continues to work.

This is invisible to user code but worth knowing if you're debugging garbage-collected memory unexpectedly relocated.

---

## 14. Disassembly Example

Compile a simple function:

```go
package main

import "sync"

var mu sync.Mutex

func F() {
    mu.Lock()
    defer mu.Unlock()
}
```

Build with optimizations and look at the disassembly:

```bash
go build -gcflags="-l -B" -o app main.go
go tool objdump -s "main\.F$" app
```

For Go 1.22 amd64, you'll see something like:

```
TEXT main.F(SB)
    MOVQ $main.mu(SB), AX
    CALL sync.(*Mutex).Lock(SB)
    MOVQ $main.mu(SB), AX
    CALL sync.(*Mutex).Unlock(SB)
    RET
```

No defer record, no `runtime.deferreturn` — this is open-coded defer. The Unlock call is inlined directly before the return.

If you put the defer inside a loop:

```go
func G() {
    for i := 0; i < 3; i++ {
        defer mu.Unlock()
    }
}
```

The disassembly will include `runtime.deferproc` (allocate and push) and `runtime.deferreturn` (run pending defers).

---

## 15. Compiler Source References

- `cmd/compile/internal/ssagen/ssa.go` — open-coded defer code generation.
- `cmd/compile/internal/walk/stmt.go` — older lowering of defer statements.
- `cmd/compile/internal/escape/escape.go` — escape analysis on deferred closures.
- `runtime/panic.go` — runtime defer/panic/recover.
- `runtime/runtime2.go` — `_defer` struct definition.

Search for `OpOpenDefer`, `runOpenDeferFrame`, `deferproc`, `deferprocStack` in the Go source.

---

## 16. ABI Changes For Defer

Go 1.17 introduced register-based ABI on amd64. This affected defer because:
- Argument passing changed.
- The `_defer` struct simplified (the `siz` field went away).
- Arguments are now staged differently for open-coded defers.

Compatibility is preserved — the runtime knows how to handle both old and new function signatures via `funcdata`.

---

## 17. Performance Numbers (Go 1.22, amd64)

| Scenario | Per-defer cost |
|----------|----------------|
| Open-coded (1-8 defers, no loop) | ~3-7 ns |
| Stack-allocated (rare; not loop, but ineligible for open-coding) | ~12-15 ns |
| Heap-allocated (defer in loop) | ~30-50 ns |
| Direct call (no defer) | ~1-3 ns |

The gap between open-coded and direct is small enough to not matter in 99% of code. The gap between heap-allocated and direct is large enough to matter in inner loops.

---

## 18. Production Patterns From The Senior Lens

### 18.1 Avoid defer inside hot loops

Cockroachdb's storage engine, Kubernetes' apiserver hot paths, and Prometheus' scrape inner loops all use explicit cleanup in the inner loop. The reason isn't open-coded defer being slow — it's that defers in loops force heap allocation.

### 18.2 Watch out for defers preventing inlining

If you write a 3-line wrapper function with one defer, it might not inline. Profile to confirm. If it's hot, restructure.

### 18.3 `defer cancel()` after context.WithTimeout

Even if the timeout fired, the cancel function still must be called to free resources. Always defer it.

### 18.4 Don't rely on `runtime.Goexit` for cleanup

`runtime.Goexit` runs defers, but it's not commonly used outside `t.FailNow`. Don't design your cleanup around it.

### 18.5 Stacking defers with explicit ordering

When you need cleanup order A-then-B-then-C, defer them in the order C-then-B-then-A. LIFO will reverse.

---

## 19. Testing And Defers

The `testing` package's `t.FailNow` calls `runtime.Goexit`, which **runs deferred calls** in the test goroutine before terminating it. This is why cleanup defers in tests work as expected.

`t.Cleanup(fn)` is a different mechanism — it registers a callback that the testing framework invokes after the test finishes. It's safer than defer in some cases:
- It's not affected by panics that escape the test.
- It runs in a controlled order chosen by the framework.

Use `t.Cleanup` for test-scoped resources you set up before the test body runs (in helpers).

---

## 20. Summary

Defer has three implementation strategies — open-coded, stack-allocated, heap-allocated — with order-of-magnitude performance differences. The compiler picks based on count, loop status, and `recover` use. Most code never notices, because open-coded defer is essentially free. The exceptions are inner loops with defers (always heap), functions with 9+ defers (drop to stack), and `recover`-using paths. Senior-level fluency means knowing which path applies, reading the disassembly when in doubt, and knowing when to restructure to keep the fast path.

---

## 21. References

- `runtime/panic.go` — primary defer/panic/recover implementation
- `runtime/runtime2.go` — `_defer` and `_panic` struct definitions
- `cmd/compile/internal/ssagen/ssa.go` — open-coded defer generation
- Go 1.13 release notes — stack-allocated defers
- Go 1.14 release notes — open-coded defers
- Go 1.17 release notes — register ABI
- Keith Randall's GopherCon talk on the open-coded defer optimization
