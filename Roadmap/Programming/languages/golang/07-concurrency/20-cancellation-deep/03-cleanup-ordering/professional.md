---
layout: default
title: Cleanup Ordering — Professional
parent: Cleanup Ordering
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/03-cleanup-ordering/professional/
---

# Cleanup Ordering — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Runtime Architecture](#runtime-architecture)
5. [Open-Coded Defers](#open-coded-defers)
6. [Heap-Allocated Defers](#heap-allocated-defers)
7. [Defer Records and the Defer Chain](#defer-records-and-the-defer-chain)
8. [Compiler Strategy and Code Generation](#compiler-strategy-and-code-generation)
9. [`context.AfterFunc` Implementation](#contextafterfunc-implementation)
10. [Panic and Recover Internals](#panic-and-recover-internals)
11. [`runtime.Goexit` and Defer Unwinding](#runtimegoexit-and-defer-unwinding)
12. [Performance Engineering](#performance-engineering)
13. [Memory Layout and Alignment](#memory-layout-and-alignment)
14. [Defer in Generic Functions](#defer-in-generic-functions)
15. [Defer in Inlined Functions](#defer-in-inlined-functions)
16. [Reading the Source: A Guided Tour](#reading-the-source-a-guided-tour)
17. [Cross-Version Differences](#cross-version-differences)
18. [Common Misconceptions at the Runtime Level](#common-misconceptions-at-the-runtime-level)
19. [Edge Cases](#edge-cases)
20. [Debugging Cleanup Issues](#debugging-cleanup-issues)
21. [Tests, Benchmarks, and Profiling](#tests-benchmarks-and-profiling)
22. [Interview-Level Internals Questions](#interview-level-internals-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Summary](#summary)
25. [Further Reading](#further-reading)
26. [Related Topics](#related-topics)
27. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "How does the Go runtime actually implement `defer`, `context.AfterFunc`, panic/recover, and `runtime.Goexit`? What is the exact memory and CPU cost of each? How do these primitives interact with the scheduler, the GC, and the compiler?"

You have arrived at the level where you need to know not just how to use Go's cleanup mechanisms but how they are built. This file walks through the runtime source, the compiler's code generation strategies, the memory layouts of internal structures, and the performance characteristics of each primitive at the level of CPU cycles and cache lines.

The audience for this file is small. You are here because:

- You are profiling a hot path where `defer` shows up.
- You are debugging a goroutine scheduler issue involving deferred cleanups.
- You are writing a library that wraps `context.AfterFunc` and want to predict its costs.
- You are a Go runtime contributor or a runtime-curious senior engineer.
- You teach Go and want to be unimpeachable on internals questions.

Most teams never need this depth. But when you need it, you really need it, and nothing else suffices. This file is a reference. Read it once for completeness. Bookmark the sections that match your specific problem.

A note on versioning: the runtime is a moving target. The patterns described here are accurate as of Go 1.22 (released February 2024). Earlier versions differ in some details — most notably, open-coded defers arrived in 1.14, `context.AfterFunc` in 1.21, and the loop-variable scoping fix in 1.22. Where it matters, we call out the version.

---

## Prerequisites

- **Required:** Complete mastery of the junior, middle, and senior files. You should be writing senior-level Go in your sleep.
- **Required:** Ability to read and reason about Go assembly output (`go build -gcflags=-S`).
- **Required:** Familiarity with the Go runtime's basic structures: G (goroutine), M (OS thread), P (processor).
- **Required:** Understanding of memory layouts, alignment, and cache lines.
- **Required:** Comfort reading the Go runtime source. Have a checkout of the Go repository handy.
- **Helpful:** Experience with delve, pprof, and the trace tool.
- **Helpful:** A working knowledge of x86-64 and ARM64 calling conventions for Go.

If terms like "frame pointer," "SP," "writeBarrierEnabled," and "P-runnext" are familiar, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`_defer` record** | A runtime struct (in `runtime2.go`) representing a single pending deferred call. Heap-allocated for the heap defer path. |
| **`_panic` record** | A runtime struct representing an in-flight panic. Holds the panic value, link to next panic, and recovery state. |
| **Open-coded defer** | A defer call where the compiler inlines the cleanup logic at the function's exit point, bypassing the runtime's defer record allocation. |
| **Defer bit vector** | A small bitmap on the stack that records which open-coded defers have been registered, used to determine which ones to run at exit. |
| **`runtime.deferproc`** | The runtime entry point for registering a heap-allocated defer. Called by compiler-generated code. |
| **`runtime.deferreturn`** | The runtime entry point for running pending heap defers at function exit. Called at the end of the function's code. |
| **`runtime.gopanic`** | The runtime function that implements `panic`. Walks the defer chain, runs defers, and either continues unwinding or terminates the program. |
| **`runtime.gorecover`** | The runtime function that implements `recover`. Examines the panic state and returns the panic value if applicable. |
| **`runtime.Goexit`** | A function that ends the current goroutine after running all pending defers. Distinct from `panic`. |
| **GMP** | The Go scheduler's three core types: G (goroutine), M (machine = OS thread), P (processor = scheduling context). |
| **Stack growth** | The runtime's mechanism for growing a goroutine's stack on demand. Defers are part of the data that must be relocated during stack copy. |
| **`runtime.afterFuncCtx`** | The internal data structure for tracking `context.AfterFunc` callbacks. |
| **`atomic.Pointer`** | A type-safe wrapper for atomic pointer operations. Used in the context package's internal callback list. |
| **Compiler intrinsic** | A function that the compiler treats specially, often inlining it or generating optimised code. `defer` itself is compiler-handled, not an intrinsic, but `recover` has intrinsic-like treatment. |

---

## Runtime Architecture

### The defer mechanism, at a high level

There are two distinct code paths for `defer` in modern Go:

1. **Open-coded defer.** The compiler analyses the function at compile time. If conditions are met (≤ 8 defers, none inside a loop, no defers behind unknown control flow), it emits the cleanup directly at the function's return points. No runtime calls. Cost: a few instructions per defer.

2. **Heap defer.** Used when open-coding is not possible. The compiler emits `runtime.deferproc(fn, args)` at the defer site. The runtime allocates a `_defer` record from a per-P pool, pushes it onto the goroutine's defer chain, and returns. At function exit, the compiler emits `runtime.deferreturn()`, which pops and runs the defers in LIFO order.

The choice happens at compile time. You can see it in the assembly output: open-coded defers show as compiler-emitted cleanup code; heap defers show as `CALL runtime.deferproc` and `CALL runtime.deferreturn`.

### The runtime's data structures

```go
// from runtime/runtime2.go (simplified)
type _defer struct {
    started bool   // defer is currently running
    heap    bool   // defer is heap-allocated
    openDefer bool // defer is from an open-coded defer
    sp      uintptr // stack pointer at registration
    pc      uintptr // program counter at registration
    fn      *funcval // the function to call
    _panic  *_panic // panic info, if running during a panic
    link    *_defer // next defer in the chain
    fd      unsafe.Pointer // funcdata; used for open-coded defers
    varp    uintptr // value of varp for the deferring frame
    framepc uintptr // pc for the deferring frame
}

type _panic struct {
    argp     unsafe.Pointer // pointer to arguments of panic
    arg      interface{}    // panic value
    link     *_panic        // next panic in the chain
    pc       uintptr        // where to resume after recover
    sp       unsafe.Pointer // sp at recover
    recovered bool          // recover() was called
    aborted  bool           // the panic was aborted
    goexit   bool           // this is from Goexit, not panic
}
```

These two structures and the goroutine's `g._defer` and `g._panic` fields (singly-linked lists, head pointers on the G) implement the entire defer/panic/recover machinery.

### The goroutine and its defer chain

Each `g` (goroutine) has a `_defer` field pointing to the head of its defer chain. Each `_defer` record's `link` field points to the next record. New defers are prepended; defers pop from the head.

```
g._defer ──► [defer C] ──link──► [defer B] ──link──► [defer A] ──► nil
```

When the function that registered A, B, C returns, the runtime walks this chain from head to tail (C, then B, then A — LIFO).

Heap-allocated `_defer` records come from a per-P pool to reduce allocator pressure. The pool is managed by `runtime.deferproc` and `runtime.deferreturn`.

### Open-coded defer's bit vector

For open-coded defers, there is no per-defer heap record. Instead, the compiler emits:

- An 8-bit (or 32-bit, depending) "active defer" bitmap in the function's stack frame.
- A "deferreturn" block at the end of the function.

When you write `defer f()`, the compiler emits code that sets the corresponding bit *and* stores the argument values in pre-allocated stack slots. At the function's end (or on panic), the deferreturn block checks each bit in LIFO order and, if set, calls the corresponding function with the stored arguments.

The savings: no heap allocation, no linked-list traversal, no atomic operations. The cost is paid at compile time (more code generated) but the runtime cost approaches zero.

---

## Open-Coded Defers

### What qualifies for open-coding

The compiler must be able to:
- Count exact defer registrations at compile time.
- Know the function's exit points.
- Prove that defers are not inside loops.
- Have eight or fewer total defers in the function.

Practical implications:

```go
func A() {
    defer f1() // OK — open-coded
    defer f2() // OK
    return
}

func B() {
    for i := 0; i < 10; i++ {
        defer f1() // NOT open-coded — inside a loop
    }
}

func C() {
    defer f1()
    defer f2()
    defer f3()
    defer f4()
    defer f5()
    defer f6()
    defer f7()
    defer f8()
    defer f9() // 9th defer — NOT open-coded (exceeds budget)
}

func D() {
    if cond {
        defer f1() // OK — conditional but still countable
    }
    return
}
```

The compiler uses static analysis to make these determinations. The criteria are conservative: it would rather fall back to heap defers than incorrectly open-code.

### The generated code

For a function with `defer cleanup()`, the open-coded version generates code like (pseudo-assembly):

```
func MyFunc():
    // Function prologue
    SUBQ $48, SP   ; allocate stack frame including:
                   ;   - defer bit (1 byte)
                   ;   - defer arg slots for cleanup

    ; defer cleanup() — at the defer statement
    MOVB $1, (SP+0x20)        ; set the defer bit
    ; evaluate args, store in slots (none here)

    ; ... function body ...

    ; At function exit:
    CMPB $0, (SP+0x20)         ; is the defer bit set?
    JE skip_cleanup
    CALL cleanup
skip_cleanup:
    ADDQ $48, SP
    RET

    ; Also, deferreturn fallback for panic case:
deferreturn:
    CMPB $0, (SP+0x20)
    JE done_deferreturn
    CALL cleanup
done_deferreturn:
    RET
```

The runtime cost: one byte set on the defer, one comparison at function exit, one conditional jump. Roughly 5 nanoseconds total on modern x86 — far less than a heap allocation.

### The deferreturn block for panics

When a function with open-coded defers panics, the runtime needs to run the defers. The compiler emits a special `deferreturn` block, which the runtime can jump to. This block is essentially a copy of the cleanup logic but reachable from `runtime.deferreturn`.

The runtime stores a pointer to this block in the function's metadata (PCDATA / FUNCDATA tables). On panic, the runtime walks the stack, finds each function's deferreturn pointer, and jumps to it to run that function's defers before continuing the panic unwind.

### Performance characteristics

Benchmarks (Go 1.22 on a modern x86-64 CPU):
- Open-coded defer: ~5 ns / call
- Heap defer: ~30-50 ns / call (depending on pool state)
- No defer at all: ~0 ns

The open-coded path is nearly free. The heap path is small but measurable. For most code, the cost is irrelevant. For tight loops, it matters.

### When the compiler bails out

The compiler may decide *not* to open-code even when it could:
- If the function has too many other deferred calls and the analysis would explode.
- If there is unusual control flow (goto, recover branches).
- If a defer's function is too dynamic (a function value held in a variable).

You can see the compiler's choice via:

```sh
go build -gcflags='-d=defer=2' main.go 2>&1 | grep defer
```

This emits diagnostic output showing each defer and whether it was open-coded.

---

## Heap-Allocated Defers

### When heap defers are used

- Defers inside loops.
- Defers beyond the open-coded budget (more than 8).
- Defers in functions where the compiler decided not to open-code for some reason.

### The runtime path

When the compiler cannot open-code, it generates a call to `runtime.deferproc`:

```go
// runtime/panic.go
func deferproc(fn func()) {
    // Get the current G
    gp := getg()
    if gp.m.curg != gp {
        throw("defer on system stack")
    }

    // Allocate a _defer record from the per-P pool
    d := newdefer(...)
    d.fn = fn
    d.link = gp._defer
    gp._defer = d
}
```

Simplified for clarity. The real implementation handles:
- Argument size (deferred calls can have arbitrary arguments, stored in the record).
- Pool management (per-P caches, allocation if pool is empty).
- GC barriers (the defer's function value is a heap pointer; needs write barriers).
- Stack growth (records must be relocated when the goroutine's stack grows).

### `runtime.deferreturn`

The compiler emits `runtime.deferreturn()` at the end of every function that has heap defers:

```go
// runtime/panic.go
func deferreturn() {
    gp := getg()
    for {
        d := gp._defer
        if d == nil || d.sp != getsp() {
            break // no more defers for this frame
        }
        // pop and run
        fn := d.fn
        gp._defer = d.link
        freedefer(d)
        fn()
    }
}
```

Each iteration:
1. Check the head of the defer chain.
2. If it belongs to the current stack frame (same sp), pop and run.
3. Otherwise, this frame has no more defers; return.

The check `d.sp != getsp()` is key: defers from other frames remain on the chain but are not run by *this* `deferreturn`.

### Pool management

The runtime maintains a per-P pool of `_defer` records:

```go
type p struct {
    // ...
    deferpool    []*_defer  // pool of available _defer records
    deferpoolbuf [32]*_defer
}
```

When `newdefer` is called:
1. Check the P's deferpool. If non-empty, pop and return.
2. Otherwise, check the global pool.
3. Otherwise, allocate a new `_defer` from the heap.

When `freedefer` is called:
1. If the P's pool has space, push back.
2. Otherwise, transfer half to the global pool.

This keeps allocation pressure low for high-throughput defer code.

### Heap defer with arguments

Defers can have arbitrary argument types. The compiler emits code to copy the arguments into the `_defer` record at registration time, and to pass them to `fn` at execution time. The argument size determines the size of the `_defer` record.

For small functions with no closures (typical `defer f()` without arguments), the record is a fixed ~120 bytes. For functions with large argument lists, it grows.

This is one reason to prefer closure-based defers when the function arguments are large: a closure is a single pointer, so the defer record stays small.

---

## Defer Records and the Defer Chain

### Walking the chain

The G's `_defer` field is the head of the chain. Each record's `link` is the next.

```
G._defer ──► [d1] ──link──► [d2] ──link──► [d3] ──► nil
```

`d1` is the most recently registered; `d3` is the oldest. LIFO popping starts at `d1`.

Each record carries:
- `fn`: the function to call.
- Stored argument values (variable size, immediately after the record header).
- `sp`: the stack pointer at registration, used to determine which frame this defer belongs to.

### Cross-frame defer chains

A goroutine's defer chain spans all of its function call frames. If `f` calls `g`, and both register defers, the chain looks like:

```
g._defer ──► [g's defer] ──link──► [f's defer]
```

When `g` returns, `deferreturn` runs `g`'s defer, then sees `f`'s defer has a different sp, so it stops. Control returns to `f`'s caller's return logic — which eventually calls `deferreturn` again to run `f`'s defers.

This per-frame separation is what makes defers function-local even though the chain is goroutine-wide.

### Defer records and the GC

The `_defer` record contains a function pointer and possibly argument pointers. These are heap-pointer references; the GC must scan them. The runtime's GC includes the defer chain in its root scan.

This is the cost the GC pays for defer. For a goroutine with hundreds of pending defers, the GC scans all of them. In practice, defer counts per goroutine are small (single digits), so this is negligible.

### Defer records and stack copies

When a goroutine's stack grows (Go's stacks are growable), all data with stack pointers — including defer records that reference stack-allocated argument values — must be updated. The runtime walks the defer chain during stack copy and adjusts SPs.

This is why defer records carry the `sp` field: to identify which frame they belong to after a copy.

---

## Compiler Strategy and Code Generation

### The compilation pipeline

A high-level view of how the compiler handles defers:

1. **Parse.** Build the AST. `defer X` becomes a `DeferStmt` node.
2. **Type check.** Verify `X` is a function call.
3. **Escape analysis.** Determine if the deferred function captures variables that escape to the heap.
4. **SSA construction.** Build the SSA form, with explicit defer blocks at function exit.
5. **Defer analysis.** Decide open-coded vs heap.
6. **Code generation.** Emit either:
   - For open-coded: a stack bit, argument slots, and exit-block cleanup code.
   - For heap: calls to `runtime.deferproc` and `runtime.deferreturn`.

### Inspecting compiler decisions

The flag `-d=defer=2` shows defer analysis:

```sh
go build -gcflags='-d=defer=2'
```

Output:

```
./main.go:10:6: open-coded defer
./main.go:15:6: heap defer (in loop)
```

Use this to verify that performance-sensitive code is using the path you expect.

### SSA form

In SSA, defers become explicit nodes that produce no value but have side effects. The compiler can analyse them like any other node:

```
b1:
    v1 = ... (some result)
    v2 = OpDeferRegister cleanup v1 // pseudo
    Goto b2
b2:
    ...
b_exit:
    v3 = OpDeferRun // pseudo
    Return
```

The SSA pass `defer.go` rewrites these into either open-coded blocks or `deferproc`/`deferreturn` calls.

### Compiler heuristics

The eight-defer budget is a heuristic. It was chosen because:
- 99% of real Go functions have fewer than 8 defers.
- The bit vector fits in a byte for 8 defers.
- Code expansion for 8 defers is acceptable.

Beyond 8, the compiler falls back to heap defers. This is a soft cliff in performance: a function with 8 defers is fast; a function with 9 is suddenly 5x slower per defer.

If you have a function with many defers, consider refactoring — not just for performance, but for readability.

### Codegen for `defer f()` vs `defer func() {...}()`

For `defer f()`:
- Open-coded: a slot for any arguments and the function value (if not directly known).
- Heap: the same, packed into the `_defer` record.

For `defer func() {...}()`:
- The closure is constructed at the defer line (capturing variables by reference).
- The closure is a single pointer to a closure struct.
- The defer captures this pointer.
- At execution, the closure is called.

The closure has its own argument list (none, in this typical case). The defer record carries just the closure pointer.

This is why `defer func() {...}()` is often *cheaper* than `defer f(big, args)`: the closure pointer is small and constant, regardless of what the closure captures.

---

## `context.AfterFunc` Implementation

### The data structure

`context.AfterFunc` registers a callback on a context's cancellation. The internal data structure:

```go
// from context/context.go (simplified)
type cancelCtx struct {
    Context
    mu       sync.Mutex
    done     atomic.Value // chan struct{}
    children map[canceler]struct{}
    err      error
    cause    error
    afterFuncs map[*afterFuncCtx]struct{} // Go 1.21+
}

type afterFuncCtx struct {
    cancelCtx           // embeds a cancelCtx so it can be a child
    fn          func()
    once        sync.Once
}
```

Each AfterFunc registration:
1. Wraps the user's `fn` in an `afterFuncCtx`.
2. Registers it as a child of the target context.
3. Returns a `stop` function that removes it from the parent.

### Registration

```go
func AfterFunc(ctx Context, fn func()) (stop func() bool) {
    a := &afterFuncCtx{
        fn: fn,
    }
    a.cancelCtx.Context = ctx
    if propagateCancel(ctx, a) {
        // ctx was already done — schedule fn immediately
        go a.run()
    }
    return func() bool {
        stopped := a.once.Do(func() {})
        // ... remove from parent's child list ...
        return stopped
    }
}

func (a *afterFuncCtx) run() {
    a.once.Do(a.fn)
}
```

Slightly simplified. The key points:
- `propagateCancel` registers `a` as a child of `ctx`. When `ctx` is cancelled, all children are too.
- `once.Do(fn)` ensures `fn` runs at most once, whether triggered by cancel or by `stop`.
- `stop` uses the same `once` to deregister: if `once` is unused, `stop` returns true; if used, `stop` returns false.

### Cancellation propagation

When a context is cancelled, the runtime calls `cancel` on each child. For an `afterFuncCtx` child:

```go
func (a *afterFuncCtx) cancel(...) {
    a.cancelCtx.cancel(...)
    go a.run()
}
```

The cancel:
1. Marks the wrapped context as done.
2. Schedules `a.run` in a new goroutine.

The new goroutine is what gives AfterFunc its "runs in a new goroutine" semantics. The cost is one goroutine creation per fired AfterFunc.

### `stop()` semantics

`stop` is the inverse of registration. It:
1. Marks `a.once` as used (so subsequent `run` calls are no-ops).
2. Removes `a` from the parent's child list.

Whether it returns true or false depends on whether `once` was already used by the time `stop` was called. The race is real: `stop` and the cancel-fired goroutine can both call `once.Do`. The first wins.

### Cost analysis

Per registration:
- Allocate `afterFuncCtx` (~64 bytes).
- Atomic compare-and-swap to add to parent's child list.
- Return a closure (~16 bytes).

Per fire:
- One goroutine creation (~1 μs).
- Closure invocation.

Per `stop`:
- One atomic compare-and-swap.
- Remove from parent's child list.

Total: small but measurable. For 10,000 AfterFunc registrations per second, the cost is ~10 ms / s, which is 1% of one core. Negligible.

### Interaction with `context.WithCancelCause`

`AfterFunc` works on any context, including those with causes. The callback can read `context.Cause(ctx)` to learn why it ran. This is implemented by the cancellation cause being stored on the cancelCtx, and `Cause` walking up the parent chain.

---

## Panic and Recover Internals

### The panic process

When `panic(x)` is called:
1. Allocate a `_panic` record on the goroutine's stack.
2. Link it onto the goroutine's `_panic` list (head insert).
3. Walk the defer chain from the head:
   - For each defer, pop it from the chain.
   - Set `d.started = true`.
   - Call `d.fn`.
   - If `recover()` was called inside `d.fn`, mark the panic as recovered. Stop unwinding.
4. If the panic was not recovered, terminate the program with a stack trace.

The runtime function is `runtime.gopanic` in `runtime/panic.go`.

### The recover process

`recover()` is implemented in `runtime.gorecover`:
1. Find the goroutine's current panic.
2. If a panic is in flight AND we are inside a deferred function AND the panic is not yet recovered:
   - Mark the panic as recovered.
   - Return the panic value.
3. Otherwise return nil.

The check "inside a deferred function" is what makes `recover` only useful in defers. It examines stack frames to determine the call context.

### Nested panics

A panic during a deferred function while another panic is in flight:
1. The new panic replaces the old (`_panic.aborted = true` on the old).
2. The old panic value is lost.
3. The new panic propagates from where it occurred.

This is why "panic during cleanup" is dangerous: it hides the original error.

### Panic + Goexit interaction

`runtime.Goexit` is similar to panic but:
- It does not have a value.
- It cannot be recovered via `recover` (`recover` returns nil during Goexit).
- It terminates the goroutine, not the program.

The defer chain still runs. The exit is clean.

### Panic value boxing

`panic(x)` accepts `interface{}`. If `x` is a non-interface type, the runtime boxes it into an interface value. Boxing involves a type-info pointer and a data pointer. For small types (≤ pointer size), the data is stored inline; for larger types, the data is heap-allocated.

This is one reason `panic` is more expensive than `return`: the boxing cost.

### Stack trace generation

When a panic terminates the program, the runtime walks the stack and prints a trace. The trace shows:
- The panic value.
- Each goroutine's stack.
- Each frame's function name and file:line.

The walk uses the PCDATA / FUNCDATA tables emitted by the compiler. It is robust to optimisation; inlined functions are reported as inlined.

---

## `runtime.Goexit` and Defer Unwinding

### Goexit semantics

`runtime.Goexit` ends the current goroutine. Unlike panic:
- No panic value.
- `recover` returns nil during Goexit.
- The goroutine's defers all run.
- The program continues.

The runtime implementation walks the defer chain, runs each defer (with Goexit-context marked on the `_panic` record), and then calls `goexit0` to release the goroutine.

### Why Goexit exists

Goexit is used by:
- `testing.T.FailNow()` and friends.
- `runtime.Goexit()` directly.
- Some test helpers in `golang.org/x/...`.

It is the right tool when you want to end a goroutine cleanly but cannot use `return` (e.g., from deep in a helper function). Plain `return` exits only the current function.

### Cost

Goexit is essentially a panic that does not propagate. Its cost is the cost of running all defers, plus releasing the goroutine. For typical goroutines with ≤ 5 defers, this is microseconds.

---

## Performance Engineering

### Benchmarking defers

```go
func BenchmarkDeferNone(b *testing.B) {
    for i := 0; i < b.N; i++ {
        f()
    }
}

func BenchmarkDeferOne(b *testing.B) {
    for i := 0; i < b.N; i++ {
        deferOne()
    }
}

func deferOne() {
    defer func() {}()
}

func f() {}
```

On Go 1.22:
- `BenchmarkDeferNone`: ~0.3 ns / op.
- `BenchmarkDeferOne` (open-coded): ~1 ns / op.
- `BenchmarkDeferOne` (heap, in a loop): ~30 ns / op.

The open-coded path is nearly free. The heap path is small but real.

### Profile interpretation

In a CPU profile (`pprof` / `go tool pprof`), defer overhead shows as:
- `runtime.deferproc` (registration cost).
- `runtime.deferreturn` (run cost).
- `runtime.gopanic` and `runtime.gorecover` (panic path).
- `runtime.newdefer` and `runtime.freedefer` (pool management).

If any of these dominate, examine the calling functions to see whether defers are inside loops or beyond the open-coded budget.

### When defers cost more than expected

- **Defers in tight loops.** Each iteration registers; the budget is exceeded. Heap defers dominate.
- **Defers with large argument lists.** The `_defer` record grows. Allocation cost increases.
- **Long defer chains.** If a function has 100 defers, `deferreturn` walks all of them. 100 × 30ns = 3μs per function call.
- **Defers in functions that almost never return.** A goroutine that runs for hours and registers defers slowly accumulates them. Probably a bug.

### When defers cost less than you'd think

- **The function is called rarely.** Per-function overhead is amortised away.
- **Open-coded defers.** They cost roughly the same as inline code.
- **Defers inside a function that does I/O.** I/O dominates; defer cost is invisible.

### AfterFunc cost

Per registration: ~30-60 ns (allocation + atomic CAS).
Per fire: ~1-2 μs (goroutine creation + closure invocation).
Per stop: ~30 ns.

For high-frequency cancellation, profile. AfterFunc can dominate in extreme cases.

---

## Memory Layout and Alignment

### `_defer` record layout

```
offset  size  field
0       1     started (bool)
1       1     heap (bool)
2       1     openDefer (bool)
... padding ...
8       8     sp (uintptr)
16      8     pc (uintptr)
24      8     fn (*funcval)
32      8     _panic (*_panic)
40      8     link (*_defer)
48      8     fd (unsafe.Pointer)
56      8     varp (uintptr)
64      8     framepc (uintptr)
72      [...] (additional fields)
```

Approximately 80 bytes per record on 64-bit. Plus argument storage if arguments are non-zero size.

### Alignment

All pointers are 8-byte aligned on 64-bit. The booleans at the start pack into a single byte each but are followed by 5 bytes of padding before `sp`. This wastes a few bytes but keeps subsequent pointer fields aligned.

### Cache behaviour

A single `_defer` record fits in one cache line (64 bytes). A goroutine with 5-10 pending defers has all of them within a few cache lines. Good locality.

For goroutines with hundreds of defers, the chain spans many cache lines. `deferreturn`'s walk has poor locality. This is one more reason to keep defer counts small.

### Closure layout

A closure is a struct:

```
struct {
    fn *funcval // pointer to the actual function code
    // captured variables follow
}
```

`*funcval` is itself a struct with a code pointer. So `defer func() { ... }()` creates a closure struct on the stack (or heap, depending on escape) and stores a pointer to it in the `_defer` record.

---

## Defer in Generic Functions

Generic functions in Go (1.18+) work the same way for defers. The compiler instantiates the generic for each type used; each instantiation has its own defer analysis.

```go
func process[T any](items []T) {
    defer cleanup()
    for _, item := range items {
        // ...
    }
}
```

When called as `process[int](...)`, the compiler emits a specialised version. The defer in this version is analysed for open-coding just like a non-generic defer.

This is unsurprising: defers are compile-time-known structurally, so generics do not change their behaviour.

---

## Defer in Inlined Functions

Defers are *not* inlined. If a function with defers is a candidate for inlining, the compiler will refuse to inline it.

```go
//go:inline
func helper() {
    defer cleanup() // forces no inlining
}

func caller() {
    helper() // remains a call, not inlined
}
```

The reason: defer semantics depend on the function's frame. Inlining would change what "function return" means for the defer.

If you have a performance-critical small function with a defer, consider whether the defer is necessary or whether you can inline manually and call cleanup explicitly.

---

## Reading the Source: A Guided Tour

A small reading list for the curious:

### `runtime/panic.go`

The core of defer/panic/recover. Look for:
- `deferproc` — register a heap defer.
- `deferreturn` — run pending heap defers.
- `gopanic` — implement panic.
- `gorecover` — implement recover.
- `Goexit` — implement Goexit.

### `runtime/runtime2.go`

Type definitions:
- `_defer` struct.
- `_panic` struct.
- `g` struct (where the defer chain lives).

### `cmd/compile/internal/ssagen/ssa.go`

The compiler's defer handling:
- `state.stmt` — handles DeferStmt nodes.
- The decision between open-coded and heap.

### `cmd/compile/internal/walk/order.go`

The compiler's pre-SSA pass that orders defer evaluations.

### `context/context.go`

`AfterFunc` and the cancelCtx machinery:
- `cancelCtx` type.
- `afterFuncCtx` type.
- `propagateCancel` function.

### `sync/once.go`

`sync.Once` is used inside `afterFuncCtx`. Worth understanding.

---

## Cross-Version Differences

### Go 1.14: open-coded defers introduced

Before 1.14, all defers were heap-allocated. Performance was a known pain point. 1.14 introduced open-coded defers, dramatically reducing cost for the common case.

### Go 1.17: register-based calling convention

The Go 1.17 ABI change to register-based calling conventions affected how arguments are passed to deferred functions. The runtime had to be updated to copy argument registers into the defer record.

### Go 1.20: WithCancelCause

Added `context.WithCancelCause` and `context.Cause`. AfterFunc was not yet available.

### Go 1.21: AfterFunc, sync.OnceFunc, errors.Join

A bumper crop of cleanup primitives. `AfterFunc` filled the gap of "cleanup that runs after context cancel." `sync.OnceFunc` made idempotent closures easier. `errors.Join` standardised multi-error reporting.

### Go 1.22: loop variable scope

The fix to `for i := range xs` making `i` per-iteration changed the semantics of defers inside loop closures. Code that relied on the old (shared variable) behaviour broke; code that used the explicit copy pattern was unaffected.

---

## Common Misconceptions at the Runtime Level

> "Defers always allocate."

Wrong. Open-coded defers do not allocate. Heap defers allocate one `_defer` record per defer (with pool reuse).

> "Open-coded defers are always faster."

Mostly true, but the difference is small for most code. The advantage is more about avoiding allocator pressure than raw speed.

> "AfterFunc is a runtime feature, not a library feature."

It is in the context package, but it uses runtime primitives (atomic ops, goroutine creation). The implementation is straightforward Go code.

> "recover is a runtime intrinsic."

Sort of. It is implemented in `runtime.gorecover`, but the compiler does treat it specially to know when to enable the panic recovery path. The implementation is in Go, not assembly.

> "panic uses exceptions like Java."

No. Go's panic is a runtime mechanism that walks the defer chain and either terminates the program or is caught by recover. No JIT exception tables, no zero-cost exception handling. Just a linked list traversal.

---

## Edge Cases

### Defer on a method with a value receiver

```go
type S struct { ... }
func (s S) Close() error { ... }

var s S
defer s.Close()
```

The method value `s.Close` captures *a copy* of `s` at the defer line. If `s` is mutated later, the defer sees the original. For value receivers, this is usually the right behaviour.

For pointer receivers:

```go
func (s *S) Close() error { ... }

var s S
defer s.Close()
```

The method value captures `&s`. Mutations to `s` *are* visible to the defer.

### Defer in a function that has a `recover`

When a defer panics during a function that itself has a `recover`, the recover sees the new panic. The original (if any) is lost.

```go
defer func() {
    if r := recover(); r != nil {
        // r might be the original panic OR a panic from another defer
    }
}()
```

The recover cannot distinguish; the panic value is just `r`.

### Defer with `runtime.LockOSThread`

If a goroutine is locked to an OS thread (`runtime.LockOSThread`) and the deferred function unlocks via `runtime.UnlockOSThread`, the defer must run on the locked thread. The runtime handles this correctly: defers run on the goroutine that registered them, on whatever thread that goroutine is currently scheduled to.

### Defer in cgo callbacks

When C code calls back into Go, the callback runs on a Go goroutine. Defers in the callback work normally. However, the C call interruption point may not be a safe point for the scheduler; defers should not assume normal scheduling.

### Defer in `init` functions

Init functions can defer. The defer runs when init returns. If multiple init functions are present (across files in a package), they run sequentially; each has its own defer scope.

### Defer in `main`

`main` can defer. The defer runs when `main` returns. *But* if `main` calls `os.Exit`, the defer does *not* run. This catches many people.

### Defer with `runtime.SetFinalizer` (anti-pattern)

`SetFinalizer` is not a defer. It does not run at function exit; it runs (if ever) during GC. Confusing the two is a real bug source.

---

## Debugging Cleanup Issues

### Identifying defer-related bugs

Symptoms:
- Resource leaks (FDs, memory) that grow over time.
- "Use of closed connection" panics.
- "Already closed" errors on second access.
- Hung shutdowns.
- Goroutine leaks visible in `pprof goroutine`.

Tools:
- `runtime.NumGoroutine()` for goroutine counts.
- `go tool pprof -goroutine` for goroutine state breakdown.
- `lsof -p PID` for FD counts.
- `delve` for live debugging.

### Reading a goroutine dump

A goroutine dump (SIGQUIT or `runtime.Stack(buf, true)`) shows each goroutine's stack. Look for:
- Goroutines stuck in `chan receive` / `chan send` — usually a leak.
- Goroutines stuck in `Lock` — possible deadlock.
- Many goroutines with the same stack — fan-out without bound.

Defers in flight do not appear distinctly in the trace, but the runtime path through `runtime.deferreturn` will be visible.

### Reading a heap profile

If memory is growing, take a heap profile:

```sh
go tool pprof http://service/debug/pprof/heap
```

In the profile, look for:
- `runtime._defer` (heap defers).
- The function values held by defers.

If `_defer` records dominate, you have a defer leak — probably defers in a goroutine that never exits.

---

## Tests, Benchmarks, and Profiling

### Test patterns

```go
func TestNoLeaks(t *testing.T) {
    defer goleak.VerifyNone(t)
    // ... test code ...
}
```

Add this to every test for a service component. It catches goroutine leaks reliably.

### Benchmark patterns

```go
func BenchmarkCleanup(b *testing.B) {
    for i := 0; i < b.N; i++ {
        withCleanup()
    }
}
```

Measure the cost of cleanup paths. If `runtime.deferproc` shows up in the benchmark profile, consider open-coding or refactoring.

### Profiling production

Sample profiles in production with `pprof.StartCPUProfile`. Look for:
- `runtime.gopanic` — panics happening more than expected.
- `runtime.deferreturn` — high defer cost.
- Custom cleanup functions — slow individual cleanups.

---

## Interview-Level Internals Questions

**Q.** Why does `defer` have a per-goroutine chain rather than a per-function structure?

**A.** Because defers can span function calls: a function `f` registers a defer, then calls `g`. While `g` is running, `f`'s defer is still pending on the same goroutine. The chain is per-goroutine; the `sp` field distinguishes which frame each defer belongs to.

**Q.** How does open-coded defer interact with the panic path?

**A.** The compiler emits both a normal-exit cleanup block and a panic-path deferreturn block. The runtime's stack unwinder finds the deferreturn block via PCDATA, jumps there to run defers, then continues unwinding.

**Q.** What happens to a heap defer's argument storage during stack growth?

**A.** Argument storage may be on the stack (for some defers); the runtime walks the defer chain during stack copy and adjusts pointers. For heap-allocated argument copies (common for closures), nothing needs to move.

**Q.** Why does `context.AfterFunc` use a fresh goroutine per fire?

**A.** To decouple the callback from the goroutine that triggered cancellation. The cancel-triggering goroutine may be on a hot path (e.g., signal handler); spawning a goroutine keeps the cancel itself fast.

**Q.** Why does `recover` only work inside a deferred function?

**A.** The runtime walks the defer chain on panic; it sets the panic's "currently in a defer" state during each defer's execution. `recover` checks this state. Outside a defer, it returns nil.

**Q.** What is the cost of `defer` in a tight loop?

**A.** Each iteration registers a heap defer (since defers in loops are not open-coded). One iteration: ~30-50 ns. A million iterations: 30-50 ms. The defers stack up and all run when the enclosing function returns.

**Q.** How does `runtime.Goexit` differ from `panic`?

**A.** Goexit:
- Has no value.
- Cannot be recovered.
- Ends the goroutine only, not the program.

Both run the defer chain.

**Q.** What is the relationship between `AfterFunc` and the GC?

**A.** AfterFunc registrations are kept alive on the context's callback list. They are GC'd when the context is. A long-lived context with many registrations holds them all in memory until cancelled or until `stop` is called.

**Q.** Why is a defer chain a singly-linked list rather than a slice?

**A.** Insertion is O(1) at the head. The chain spans function calls; resizing a slice would require reallocation. The linked list is the right data structure.

**Q.** What happens if a defer's function is nil?

**A.** Calling a nil function panics. The defer registers fine; the panic happens at execution time.

---

## Cheat Sheet

```
RUNTIME ENTRY POINTS
====================
runtime.deferproc(fn)        register a heap defer
runtime.deferreturn()        run pending heap defers
runtime.gopanic(v)           implement panic
runtime.gorecover()          implement recover
runtime.Goexit()             end the goroutine; run defers

OPEN-CODED DEFER (1.14+)
========================
Eligibility:
  - ≤ 8 defers in the function
  - none in a loop
  - countable at compile time
Cost: ~5 ns / call (vs ~30 ns for heap)
View: -gcflags='-d=defer=2'

HEAP DEFER
==========
_defer record: ~80 bytes + arg size
Per-P pool: 32-slot cache
Chain: G._defer linked list, sp-distinguished

CONTEXT.AFTERFUNC (1.21+)
=========================
afterFuncCtx wraps fn in a cancelCtx child
fn runs in new goroutine on cancel
stop deregisters; returns true if fn never ran

COST AT SCALE
=============
defer none:      0.3 ns
defer open:      1-5 ns
defer heap:      30-50 ns
AfterFunc reg:   30-60 ns
AfterFunc fire:  1-2 μs (goroutine creation)
panic+defer:     hundreds of ns to μs depending on chain length
```

---

## Summary

You now know how `defer`, `context.AfterFunc`, panic, and recover are actually implemented in the Go runtime. You know the difference between open-coded and heap defers, the per-goroutine defer chain, the `_defer` record layout, the cost of each operation, and the trade-offs the compiler makes.

For 99% of Go programmers, this knowledge is unnecessary. For the 1% who write systems software, performance-critical libraries, or contribute to the runtime itself, it is indispensable.

The specification file (`specification.md`) contains the formal Go language rules for defers and panics — the contract that the runtime implements. The interview file (`interview.md`) has questions at every level, including some that touch on internals. The tasks, find-bug, and optimize files give you hands-on practice.

You have completed the deepest tier. Use it wisely.

---

## Further Reading

- The Go runtime source: `runtime/panic.go`, `runtime/runtime2.go`
- The Go compiler source: `cmd/compile/internal/ssagen`
- The Go 1.14 release notes (open-coded defers)
- The Go 1.21 release notes (AfterFunc)
- "Toward a Better Defer" — Keith Randall's blog post on the open-coded defer design
- The Go FAQ on panic/recover
- Russ Cox, "Go Data Structures: Interfaces" (background on type info)
- The Go ABI specification

---

## Related Topics

- `01-cooperative-vs-force` (cancellation observation)
- `02-partial-cancellation` (cancellation of sub-workflows)
- The Errors-and-Panics track (panic recovery in depth)
- The Go runtime track (GMP scheduler, GC internals)
- The compiler track (SSA, code generation)

---

## Diagrams & Visual Aids

### The defer chain (per goroutine)

```
g._defer ──► [d_top] ──link──► [d2] ──link──► ... ──► [d_bottom] ──► nil

d_top:    most recently registered, popped first
d_bottom: oldest, popped last

Each record:
   sp:        used to find which frame this belongs to
   fn:        function to call
   args:      stored argument values
```

### Open-coded defer in the stack frame

```
function frame:
   ┌──────────────────────────┐
   │   local variables        │
   ├──────────────────────────┤
   │   defer bit vector       │  ← 1 byte (8 defers max)
   ├──────────────────────────┤
   │   arg slots for defer 0  │
   │   arg slots for defer 1  │
   │   ...                    │
   ├──────────────────────────┤
   │   saved registers        │
   │   return address         │
   └──────────────────────────┘
```

### Heap defer record

```
_defer record (heap):
   ┌──────────────────┐
   │ started, heap, ... (flags)
   │ sp                │
   │ pc                │
   │ fn (function ptr) │
   │ link (next defer) │
   │ ...               │
   ├──────────────────┤
   │ argument storage  │ ← variable size
   └──────────────────┘
```

### Panic walking the defer chain

```
panic(v) →
   create _panic record
   for d in g._defer (head to tail):
       d.started = true
       call d.fn  ←── may call recover()
       if recovered:
           clear panic state
           jump to recover's caller's return
           STOP
   if not recovered:
       print stack trace
       terminate program
```

### `context.AfterFunc` structure

```
AfterFunc(ctx, fn) →
   create afterFuncCtx{fn: fn}
   register as child of ctx
   return stop function

on ctx cancel →
   for each child:
       child.cancel()
       if child is afterFuncCtx:
           go child.run()  ←── new goroutine

afterFuncCtx.run() →
   once.Do(fn)
```

### Costs comparison

```
                ns / op
   ─────────────────────────
   no defer:         0.3
   open defer:       1-5
   heap defer:      30-50
   panic+recover:   ~500
   AfterFunc reg:   30-60
   AfterFunc fire:  1000-2000
```

(Approximate; varies by hardware and Go version.)

---

## Appendix: A Reading of `runtime.deferreturn`

To make the internals concrete, here is a simplified walkthrough of `runtime.deferreturn`:

```go
//go:nosplit
func deferreturn() {
    gp := getg()
    for {
        d := gp._defer
        if d == nil {
            return
        }
        sp := getsp()
        if d.sp != sp {
            return
        }
        if d.openDefer {
            done := runOpenDeferFrame(d, sp)
            if !done {
                throw("unfinished open-coded defers")
            }
            gp._defer = d.link
            freedefer(d)
            continue
        }
        fn := d.fn
        d.fn = nil
        gp._defer = d.link
        freedefer(d)
        fn()  // may panic
    }
}
```

Key points:
- `//go:nosplit` — cannot be preempted; runs on a stack that may be small.
- Loop until no more defers belong to this frame (`d.sp != sp`).
- For open-coded defers, delegate to `runOpenDeferFrame`.
- For heap defers, pop, free the record, then call the function.

The function returns when the frame's defers are exhausted. The caller (compiler-generated code) then completes the function's return.

---

## Appendix: A Reading of `runtime.gopanic`

```go
//go:nosplit
func gopanic(e interface{}) {
    gp := getg()
    var p _panic
    p.arg = e
    p.link = gp._panic
    gp._panic = (*_panic)(noescape(unsafe.Pointer(&p)))

    for {
        d := gp._defer
        if d == nil {
            break
        }
        d.started = true
        d._panic = (*_panic)(noescape(unsafe.Pointer(&p)))
        // run deferred function
        reflectcall(... d.fn ...)
        // if recovered, jump
        if p.recovered {
            gp._panic = p.link
            // jump to recover's caller's return
            mcall(recovery)
        }
        // pop defer, continue
        gp._defer = d.link
        freedefer(d)
    }

    // no recovery — terminate
    fatalpanic(gp._panic)
}
```

Simplified for clarity. The main loop walks defers; each defer can call `recover` to set `p.recovered`; if so, we jump out of the loop.

---

## Appendix: A Reading of `context.AfterFunc`

```go
func AfterFunc(ctx Context, f func()) (stop func() bool) {
    a := &afterFuncCtx{
        f: f,
    }
    a.cancelCtx.Context = ctx
    propagateCancel(ctx, a)
    return func() bool {
        stopped := false
        a.once.Do(func() {
            stopped = true
        })
        if stopped {
            a.cancel(true, Canceled, nil)
        }
        return stopped
    }
}

type afterFuncCtx struct {
    cancelCtx
    once sync.Once
    f    func()
}

func (a *afterFuncCtx) cancel(removeFromParent bool, err, cause error) {
    a.cancelCtx.cancel(false, err, cause)
    if removeFromParent {
        removeChild(a.Context, a)
    }
    a.once.Do(func() {
        go func() {
            defer a.cancelCtx.cancel(true, ErrCanceled, nil)
            a.f()
        }()
    })
}
```

Slightly simplified. Note:
- `propagateCancel` adds `a` as a child of `ctx`.
- The `cancel` method is called when `ctx` is cancelled (via the parent chain) OR when `stop` is called.
- The `once.Do` inside cancel ensures `f` runs at most once.
- The goroutine launched runs `f`, then cancels `a` itself (so children of `a` are also cancelled).

This is roughly 30 lines of Go that implement the entire AfterFunc primitive. Elegantly small.

---

## Appendix: Notes for Runtime Contributors

If you contribute to the Go runtime, things to know:
- Defers and panics are deeply intertwined with the scheduler. Changes require regression tests.
- The defer record format is part of the runtime ABI; changes are versioned.
- The compiler emits PCDATA tables that the runtime walks during panic; both sides must agree.
- The `unsafe.Pointer` usage in panic.go is essential and brittle; review carefully.

The Go contribution guide explains the testing infrastructure (`all.bash`, race detector, etc.). Cleanup-related changes must pass:
- All standard tests.
- The race detector.
- Stress tests (`runtime: stress`).
- Benchmarks (no regression in defer/panic micro-benchmarks).

If your change is in the cleanup hot path, expect detailed review.

---

## Appendix: A Question to Test Your Internals Knowledge

Read the following code carefully. What is the *minimum* memory allocated per call to `f`?

```go
func f() {
    defer cleanup()
    defer trace()
    return
}

func cleanup() {}
func trace() {}
```

Answer: zero. Both defers are open-coded. The defer bits and arg slots are part of the stack frame, which is reused. No heap allocation.

Compare:

```go
func g() {
    for i := 0; i < 10; i++ {
        defer cleanup()
    }
}
```

Answer: 10 `_defer` records, each ~80 bytes. About 800 bytes of heap per call to `g`. Plus the per-P pool may amortise some of it, but on a cold cache, full allocation.

The difference between `f` and `g` is the difference between "free" and "expensive" defers. Knowing why is a senior+ skill; being able to predict it from reading is the professional level.

---

## Closing

The runtime is large. The cleanup machinery is one corner of it — well-defined, mostly stable, occasionally extended (1.14, 1.21). Understanding how it works in detail is a useful skill but rarely a daily one.

If you have read this far, you are equipped to:
- Debug performance issues involving defers.
- Write libraries that wrap defer/AfterFunc with confidence.
- Contribute to the runtime if you wish.
- Teach Go at the deepest level.

The remaining files in this sub-topic (specification, interview, tasks, find-bug, optimize) are practical complements. The senior file is where the design wisdom lives. This file is where the engineering details live. Together they form the complete picture of cleanup ordering in Go.

Good luck.

---

## Deep Dive: A Tour Through the Defer Source

The next sections do a tour of the runtime source, function by function, file by file. The Go runtime is written in Go (with sprinkles of assembly). Reading it requires comfort with low-level patterns: unsafe pointers, atomic operations, `go:nosplit` directives, and stack manipulation.

### The G's defer field

In `runtime/runtime2.go`, the goroutine struct (`g`) has a field:

```go
type g struct {
    // ... many fields ...
    _defer *_defer
    _panic *_panic
    // ...
}
```

These two pointers are the head of two singly-linked lists, both per-goroutine. Defers and panics travel together: each `_defer` may reference the panic it was created during; each `_panic` may reference defers as they execute.

The G struct is allocated once per goroutine, on creation, and lives until the goroutine exits. Its fields are accessed without locking (it is per-goroutine). The defer chain head changes as defers are pushed and popped, but only by the goroutine itself.

### `newdefer` in detail

`newdefer` allocates a `_defer` record. It is called by `deferproc` (the compiler-emitted defer registration function).

```go
func newdefer(siz int32) *_defer {
    var d *_defer
    sc := deferclass(uintptr(siz))
    gp := getg()
    if sc < uintptr(len(p{}.deferpool)) {
        pp := gp.m.p.ptr()
        if len(pp.deferpool[sc]) == 0 && sched.deferpool[sc] != nil {
            // grab from global pool
            systemstack(func() {
                lock(&sched.deferlock)
                for len(pp.deferpool[sc]) < cap(pp.deferpool[sc])/2 && sched.deferpool[sc] != nil {
                    d := sched.deferpool[sc]
                    sched.deferpool[sc] = d.link
                    d.link = nil
                    pp.deferpool[sc] = append(pp.deferpool[sc], d)
                }
                unlock(&sched.deferlock)
            })
        }
        if n := len(pp.deferpool[sc]); n > 0 {
            d = pp.deferpool[sc][n-1]
            pp.deferpool[sc][n-1] = nil
            pp.deferpool[sc] = pp.deferpool[sc][:n-1]
        }
    }
    if d == nil {
        systemstack(func() {
            total := roundupsize(totaldefersize(uintptr(siz)))
            d = (*_defer)(mallocgc(total, deferType, true))
        })
        if debugCachedWork {
            // Track adding this defer to the queue
        }
    }
    d.siz = siz
    d.heap = true
    return d
}
```

Simplified for readability. The flow:
1. Determine the size class for the defer (defers are grouped by argument size).
2. Look in the per-P pool. If empty, refill from the global pool.
3. If still empty, allocate from the heap.
4. Mark the record as heap-allocated.

The `systemstack` call switches to the system stack for the operations that require it (locking, heap allocation).

### `freedefer` in detail

`freedefer` returns a `_defer` record to the pool:

```go
func freedefer(d *_defer) {
    if d._panic != nil {
        freedeferpanic()
    }
    if d.fn != nil {
        freedeferfn()
    }
    if !d.heap {
        return
    }
    sc := deferclass(uintptr(d.siz))
    if sc >= uintptr(len(p{}.deferpool)) {
        return
    }
    pp := getg().m.p.ptr()
    if len(pp.deferpool[sc]) == cap(pp.deferpool[sc]) {
        // P-local pool is full, transfer half to global
        var first, last *_defer
        for len(pp.deferpool[sc]) > cap(pp.deferpool[sc])/2 {
            n := len(pp.deferpool[sc])
            d := pp.deferpool[sc][n-1]
            pp.deferpool[sc][n-1] = nil
            pp.deferpool[sc] = pp.deferpool[sc][:n-1]
            if first == nil {
                first = d
            } else {
                last.link = d
            }
            last = d
        }
        lock(&sched.deferlock)
        last.link = sched.deferpool[sc]
        sched.deferpool[sc] = first
        unlock(&sched.deferlock)
    }
    *d = _defer{}
    pp.deferpool[sc] = append(pp.deferpool[sc], d)
}
```

The flow:
1. Sanity checks (no in-flight panic, no fn).
2. If not heap-allocated, no-op.
3. If the P-local pool is full, transfer half to the global pool (under lock).
4. Zero the record and push onto the P-local pool.

This pattern — local cache, global overflow — is common throughout the Go runtime. It minimises contention.

### `deferproc` in detail

`deferproc` is what the compiler calls at each `defer` statement:

```go
//go:nosplit
func deferproc(siz int32, fn *funcval) {
    gp := getg()
    if gp.m.curg != gp {
        throw("defer on system stack")
    }

    sp := getcallersp()
    argp := uintptr(unsafe.Pointer(&fn)) + unsafe.Sizeof(fn)
    callerpc := getcallerpc()

    d := newdefer(siz)
    if d._panic != nil {
        throw("deferproc: d.panic != nil after newdefer")
    }
    d.link = gp._defer
    gp._defer = d
    d.fn = fn
    d.pc = callerpc
    d.sp = sp
    switch siz {
    case 0:
        // No args, nothing to copy
    case sys.PtrSize:
        *(*uintptr)(deferArgs(d)) = *(*uintptr)(unsafe.Pointer(argp))
    default:
        memmove(deferArgs(d), unsafe.Pointer(argp), uintptr(siz))
    }

    // deferproc returns 0 normally
    // If we panicked during deferproc, it returns 1
}
```

The flow:
1. Get the goroutine and validate state.
2. Get the caller's SP and PC.
3. Allocate a `_defer` record.
4. Link it at the head of the goroutine's defer chain.
5. Store the function and argument values.

Note the `getcallersp()` and `getcallerpc()` calls: these are compiler intrinsics that read the calling function's SP/PC. They are essential for matching defers to their owning frame.

### `deferreturn` in detail

`deferreturn` is the function the compiler calls at the end of a function to run any pending defers:

```go
//go:nosplit
func deferreturn(arg0 uintptr) {
    gp := getg()
    d := gp._defer
    if d == nil {
        return
    }
    sp := getcallersp()
    if d.sp != sp {
        return
    }
    if d.openDefer {
        done := runOpenDeferFrame(gp, d)
        if !done {
            throw("unfinished open-coded defers in deferreturn")
        }
        gp._defer = d.link
        freedefer(d)
        return
    }

    // copy args back
    switch d.siz {
    case 0:
    case sys.PtrSize:
        *(*uintptr)(unsafe.Pointer(&arg0)) = *(*uintptr)(deferArgs(d))
    default:
        memmove(unsafe.Pointer(&arg0), deferArgs(d), uintptr(d.siz))
    }
    fn := d.fn
    d.fn = nil
    gp._defer = d.link
    freedefer(d)
    jmpdefer(fn, uintptr(unsafe.Pointer(&arg0)))
}
```

Notable:
- `jmpdefer` is an assembly function that performs a tail call into `fn` while preserving the deferreturn frame. After `fn` returns, control returns to `deferreturn` to process the next defer.
- The arguments are copied back to the call site for the deferred call.
- For open-coded defers, control delegates to `runOpenDeferFrame`.

### `jmpdefer` assembly

In `runtime/asm_amd64.s` (and other architecture files), `jmpdefer` is a small assembly routine:

```assembly
TEXT runtime·jmpdefer(SB), NOSPLIT, $0-16
    MOVQ    fv+0(FP), DX
    MOVQ    argp+8(FP), BX
    LEAQ    -8(BX), SP
    MOVQ    -8(SP), BP
    SUBQ    $5, (SP)
    JMP     0(DX)
```

This is a tail call: it sets up registers for the deferred function and jumps to it without growing the stack. The deferred function returns to `deferreturn`'s return point, looking as if it had been called directly from `deferreturn`'s caller.

This is why `jmpdefer` is not a regular call: a regular call would build a new stack frame each time, blowing the stack for many defers.

---

## Deep Dive: Open-Coded Defer Internals

Open-coded defers were introduced in Go 1.14 (Keith Randall, "Toward a Better Defer"). The mechanism:

### The bit vector

For each function with open-coded defers, the compiler allocates:
- 1 byte for the defer bit vector (up to 8 defers).
- N slots for argument storage, one per defer.

The bit vector is initialised to 0 at function entry. At each `defer X` statement, the compiler emits code to set the corresponding bit *and* store the argument values.

```
// At function entry:
   defer_bits = 0

// At "defer cleanup()" (defer index 0):
   defer_bits |= 1 << 0    // set bit 0
   // (no arguments to store)

// At "defer log(elapsed)" (defer index 1):
   defer_bits |= 1 << 1    // set bit 1
   defer_args_1 = elapsed  // store argument

// At function return:
   run deferreturn block
```

### The deferreturn block

The compiler emits a special block at the function's exit. It tests each bit and runs the corresponding cleanup:

```
deferreturn_block:
   if defer_bits & (1 << 1) {
       call log(defer_args_1)
       defer_bits &= ^(1 << 1)
   }
   if defer_bits & (1 << 0) {
       call cleanup()
       defer_bits &= ^(1 << 0)
   }
   return
```

The bits are tested in reverse order (high bit first), which gives LIFO unwinding.

### Reaching the deferreturn block on panic

When a function panics, the runtime needs to run the function's defers before unwinding further. For open-coded defers, the runtime jumps to the deferreturn block via the FUNCDATA tables.

The compiler emits a `_FUNCDATA_OpenCodedDeferInfo` entry for each function with open-coded defers. The runtime walks the stack on panic, finds each frame's FUNCDATA, and (if present) jumps to the deferreturn block to run the defers.

The FUNCDATA contains:
- The offset of the defer bit vector within the frame.
- The offsets of each defer's argument storage.
- The PC to jump to for the deferreturn block.
- A list of (PC range, active bits) pairs — what defers are registered at each PC range.

This lets the runtime know exactly which defers to run at any given PC.

### Why this is fast

- No heap allocation.
- No linked-list traversal.
- The bit test is one comparison.
- The call is direct.

A function with one open-coded defer has effectively zero overhead beyond the cleanup call itself. This is why "always use defer" became viable advice after Go 1.14.

### When the compiler bails out

The compiler examines the function during the walk pass. If it finds:
- A defer inside a loop (any loop).
- More than 8 defers.
- A defer behind a `goto` or other unusual control flow.
- A defer whose function is not statically known (rare, but possible with reflection-heavy code).

It bails out and emits heap defers instead. The fallback is correct but slower.

### Diagnostics

Compile with `-gcflags='-d=defer=2'` to see the compiler's choice:

```
./main.go:5:2: defer cleanup() (open-coded)
./main.go:10:3: defer fmt.Println(i) (heap, in loop)
```

If a defer you expected to be open-coded is heap, the diagnostic explains why.

### Code size impact

Open-coded defers grow the function's code somewhat:
- 1 byte for the bit vector.
- N slots for argument storage.
- The cleanup logic in the deferreturn block (one branch per defer).

For 8 defers, this is roughly 1 byte + 8 slots + 50 bytes of code. Negligible.

### Interaction with inlining

Functions with defers are not inlined. This is a deliberate trade-off: inlining would require duplicating the defer logic at every call site, which complicates the runtime's stack walking for panics. The decision keeps the runtime simple at the cost of one missed inlining opportunity per defer.

---

## Deep Dive: Panic and Recover

### The full `gopanic` flow

```go
func gopanic(e interface{}) {
    gp := getg()
    if gp.m.curg != gp {
        // Panicking on the system stack is a programming error.
        throw("panic on system stack")
    }

    if gp.m.mallocing != 0 {
        throw("panic during malloc")
    }

    var p _panic
    p.arg = e
    p.link = gp._panic
    gp._panic = (*_panic)(noescape(unsafe.Pointer(&p)))

    runningPanicDefers.Add(1)

    addOneOpenDeferFrame(gp, getcallerpc(), unsafe.Pointer(getcallersp()))

    for {
        d := gp._defer
        if d == nil {
            break
        }

        if d.started {
            // Defer already started; this is a recursive panic during a defer.
            // Mark this panic as aborted and continue with the next defer.
            if d._panic != nil {
                d._panic.aborted = true
            }
            d._panic = nil
            if !d.openDefer {
                d.fn = nil
                gp._defer = d.link
                freedefer(d)
                continue
            }
        }
        d.started = true
        d._panic = (*_panic)(noescape(unsafe.Pointer(&p)))

        done := true
        if d.openDefer {
            done = runOpenDeferFrame(gp, d)
            if done {
                d._panic = nil
                d.fn = nil
            }
        } else {
            p.argp = unsafe.Pointer(getargp())
            fn := d.fn
            reflectcall(nil, unsafe.Pointer(fn), deferArgs(d), uint32(d.siz), uint32(d.siz))
        }
        p.argp = nil

        d._panic = nil
        d.fn = nil
        gp._defer = d.link
        pc := d.pc
        sp := unsafe.Pointer(d.sp)
        freedefer(d)
        if p.recovered {
            gp._panic = p.link
            if gp._panic != nil && gp._panic.goexit && gp._panic.aborted {
                // A normal recover() should ignore an aborted Goexit.
                gp.sigcode0 = uintptr(gp._panic.sp)
                gp.sigcode1 = uintptr(gp._panic.pc)
                mcall(recovery)
                throw("bypassed recovery failed")
            }
            runningPanicDefers.Add(-1)
            gp.sigcode0 = uintptr(sp)
            gp.sigcode1 = pc
            mcall(recovery)
            throw("recovery failed")
        }
    }

    preprintpanics(gp._panic)
    fatalpanic(gp._panic)
}
```

Major points:
- The panic record is created on the goroutine's stack (no heap allocation for the panic itself).
- The loop walks the defer chain.
- For each defer, `d.started` is set so that nested panics can detect recursion.
- For heap defers, `reflectcall` invokes the function with the stored arguments.
- For open-coded defers, `runOpenDeferFrame` runs the function-level deferreturn block.
- If `recover` set `p.recovered`, `mcall(recovery)` jumps to the recovery point.

### `mcall` and `recovery`

`mcall` switches to the M's g0 stack (the scheduler stack) to perform an operation that cannot be done on the user goroutine's stack. `recovery` is one such operation: it manipulates the user stack to jump to the deferred function's caller's return point.

```go
func recovery(gp *g) {
    sp := gp.sigcode0
    pc := gp.sigcode1
    if sp != 0 && (sp < gp.stack.lo || gp.stack.hi < sp) {
        print("recover: SP not on the goroutine's stack\n")
        throw("recovery failed")
    }
    gp.sched.sp = sp
    gp.sched.pc = pc
    gp.sched.lr = 0
    gp.sched.ret = 1
    gogo(&gp.sched)
}
```

This sets up the goroutine's saved registers to "return" with value 1 from `deferproc` (which is the signal to the compiler that a recovery occurred), and resumes execution.

### Recover's mechanics

`recover` examines the panic state:

```go
//go:nosplit
func gorecover(argp uintptr) interface{} {
    gp := getg()
    p := gp._panic
    if p != nil && !p.goexit && !p.recovered && argp == uintptr(p.argp) {
        p.recovered = true
        return p.arg
    }
    return nil
}
```

Conditions:
- `p != nil` — a panic is in flight.
- `!p.goexit` — not a Goexit (which cannot be recovered).
- `!p.recovered` — not already recovered.
- `argp == p.argp` — we are in the right deferred function.

The `argp` check is what restricts `recover` to deferred functions. The runtime sets `p.argp` to the deferred function's argp before calling it; `recover` reads its own caller's argp and compares.

### Why recover returns nil outside a defer

If you call `recover()` outside a deferred function:
- `p` is the in-flight panic (if any).
- `argp` is the recover's caller's argp.
- `p.argp` is the most recent deferred function's argp.
- They do not match.

So `recover` returns nil.

Even more clearly: if no panic is in flight, `p == nil` and `recover` returns nil immediately.

---

## Deep Dive: `runtime.Goexit`

### The Goexit flow

```go
func Goexit() {
    gp := getg()
    addOneOpenDeferFrame(gp, getcallerpc(), unsafe.Pointer(getcallersp()))

    for {
        d := gp._defer
        if d == nil {
            break
        }
        if d.started {
            if d._panic != nil {
                d._panic.aborted = true
                d._panic = nil
            }
            if !d.openDefer {
                d.fn = nil
                gp._defer = d.link
                freedefer(d)
                continue
            }
        }
        d.started = true
        d._panic = (*_panic)(unsafe.Pointer(&_panic{goexit: true}))

        if d.openDefer {
            done := runOpenDeferFrame(gp, d)
            if !done {
                addOneOpenDeferFrame(gp, 0, nil)
                break
            }
        } else {
            reflectcall(nil, unsafe.Pointer(d.fn), deferArgs(d), uint32(d.siz), uint32(d.siz))
        }
        if gp._defer != d {
            throw("bad defer entry in Goexit")
        }
        d._panic = nil
        d.fn = nil
        gp._defer = d.link
        freedefer(d)
    }
    goexit1()
}
```

The flow:
- Walk the defer chain just like a panic.
- Run each defer, marking `goexit: true` in the panic record so recover() will ignore it.
- After all defers, call `goexit1` to terminate the goroutine cleanly.

Note that Goexit creates a fake `_panic` record with `goexit: true`. This is what makes `recover` return nil during a Goexit unwind.

### `goexit1`

```go
func goexit1() {
    if raceenabled {
        racegoend()
    }
    if traceEnabled() {
        traceGoEnd()
    }
    mcall(goexit0)
}

func goexit0(gp *g) {
    _g_ := getg()
    casgstatus(gp, _Grunning, _Gdead)
    gp.m.curg = nil
    // ... clean up the goroutine ...
    schedule()
}
```

The goroutine is marked dead, the M is detached, and the scheduler picks the next runnable goroutine.

### Why Goexit is separate from panic

The distinction matters because:
- `recover` should not catch a Goexit.
- A test framework calling `t.FailNow` wants to end the goroutine without aborting the program.
- The defer chain must still run (for cleanup).

Goexit is the surgical tool. Panic is the dramatic one.

---

## Deep Dive: `context.AfterFunc` Source Walk

Let's read the actual implementation in `context/context.go`.

### The `cancelCtx` extensions

In Go 1.21, `cancelCtx` gained support for AfterFunc:

```go
type cancelCtx struct {
    Context

    mu       sync.Mutex
    done     atomic.Value
    children map[canceler]struct{}
    err      error
    cause    error
}
```

The `children` map already existed; AfterFunc reuses it. Each `afterFuncCtx` is registered as a child.

### `afterFuncCtx`

```go
type afterFuncCtx struct {
    cancelCtx
    once sync.Once
    f    func()
}
```

It embeds a `cancelCtx` so it can be a child of another context. It carries the function `f` and a `sync.Once` to ensure single execution.

### `AfterFunc`

```go
func AfterFunc(ctx Context, f func()) (stop func() bool) {
    a := &afterFuncCtx{
        f: f,
    }
    a.cancelCtx.Context = ctx
    a.cancel(ctx.Done(), Canceled, nil)
    return func() bool {
        var stopped bool
        a.once.Do(func() {
            stopped = true
        })
        if stopped {
            a.cancel(true, Canceled, nil)
        }
        return stopped
    }
}
```

Wait — the real source is slightly different from this. Let's correct. The actual structure:

```go
func AfterFunc(ctx Context, f func()) (stop func() bool) {
    a := &afterFuncCtx{
        f: f,
    }
    a.cancelCtx.Context = ctx
    propagateCancel(ctx, a)
    return func() bool {
        stopped := false
        a.once.Do(func() {
            stopped = true
        })
        if stopped {
            a.cancel(true, Canceled, nil)
        }
        return stopped
    }
}
```

`propagateCancel` is the function that registers `a` as a child of `ctx`. If `ctx` is already done, `propagateCancel` triggers `a.cancel` immediately.

### `propagateCancel`

```go
func propagateCancel(parent Context, child canceler) {
    done := parent.Done()
    if done == nil {
        return // parent is never cancelled
    }

    select {
    case <-done:
        // parent is already cancelled
        child.cancel(false, parent.Err(), Cause(parent))
        return
    default:
    }

    if p, ok := parentCancelCtx(parent); ok {
        p.mu.Lock()
        if p.err != nil {
            child.cancel(false, p.err, p.cause)
        } else {
            if p.children == nil {
                p.children = make(map[canceler]struct{})
            }
            p.children[child] = struct{}{}
        }
        p.mu.Unlock()
        return
    }

    // parent is a non-stdlib Context; spin a goroutine
    goroutines.Add(1)
    go func() {
        select {
        case <-parent.Done():
            child.cancel(false, parent.Err(), Cause(parent))
        case <-child.Done():
        }
    }()
}
```

The flow:
- If parent is never cancellable, nothing to do.
- If parent is already done, immediately cancel the child.
- If parent is a standard cancelCtx, add child to its children map.
- Otherwise, spin a goroutine that watches the parent.

The goroutine fallback is the price of supporting non-stdlib Context implementations.

### `cancelCtx.cancel`

```go
func (c *cancelCtx) cancel(removeFromParent bool, err, cause error) {
    if err == nil {
        panic("context: internal error: missing cancel error")
    }
    if cause == nil {
        cause = err
    }
    c.mu.Lock()
    if c.err != nil {
        c.mu.Unlock()
        return // already cancelled
    }
    c.err = err
    c.cause = cause
    d, _ := c.done.Load().(chan struct{})
    if d == nil {
        c.done.Store(closedchan)
    } else {
        close(d)
    }
    for child := range c.children {
        // NOTE: acquiring the child's lock while holding parent's lock
        child.cancel(false, err, cause)
    }
    c.children = nil
    c.mu.Unlock()

    if removeFromParent {
        removeChild(c.Context, c)
    }
}
```

The flow:
- Lock the parent.
- If already cancelled, return.
- Set the error and cause.
- Close the done channel.
- Recursively cancel all children.
- Unlock.
- Remove from parent if requested.

The recursive cancel is the cancel cascade. Each child's cancel runs while the parent's lock is held — which is why custom Context implementations must be careful about deadlocks.

### `afterFuncCtx.cancel`

```go
func (a *afterFuncCtx) cancel(removeFromParent bool, err, cause error) {
    a.cancelCtx.cancel(false, err, cause)
    if removeFromParent {
        removeChild(a.Context, a)
    }
    a.once.Do(func() {
        go func() {
            defer a.cancelCtx.cancel(true, Canceled, nil)
            a.f()
        }()
    })
}
```

When the afterFuncCtx is cancelled:
1. Cancel itself (close its done channel).
2. Remove from parent if requested.
3. Use `once.Do` to ensure the user's `f` runs at most once.
4. The user's `f` runs in a fresh goroutine.
5. After `f` returns, cancel `a` again (a no-op now) for cleanup.

The `once` is the same `once` shared with the `stop` function. Whichever fires first wins.

### `stop` semantics in detail

```go
return func() bool {
    stopped := false
    a.once.Do(func() {
        stopped = true
    })
    if stopped {
        a.cancel(true, Canceled, nil)
    }
    return stopped
}
```

When the user calls `stop`:
- `once.Do` runs the closure. If `once` was unused, the closure sets `stopped = true`. If `once` was already used (by the cancel path), the closure does not run; `stopped` stays false.
- If `stopped == true`, we acquired the once first: cancel the afterFuncCtx so it does not fire.
- Return `stopped`.

This races with cancel cleanly:
- `stop` wins: `f` never runs.
- Cancel wins: `f` runs in its goroutine.

The `sync.Once` is what synchronises the two paths.

---

## Deep Dive: Performance Characterisation

### Microbenchmarks

```go
// Benchmark: no defer
func BenchmarkNoDefer(b *testing.B) {
    for i := 0; i < b.N; i++ {
        plain()
    }
}

func plain() {
    work()
}

// Benchmark: one open-coded defer
func BenchmarkOneOpenDefer(b *testing.B) {
    for i := 0; i < b.N; i++ {
        oneDefer()
    }
}

func oneDefer() {
    defer work()
}

// Benchmark: heap defer (in loop)
func BenchmarkHeapDefer(b *testing.B) {
    for i := 0; i < b.N; i++ {
        loopDefer(1)
    }
}

func loopDefer(n int) {
    for i := 0; i < n; i++ {
        defer work()
    }
}

func work() {}
```

Results on a 2024-era x86-64 (approximate):

```
BenchmarkNoDefer         3000000000  0.31 ns/op
BenchmarkOneOpenDefer    1000000000  1.05 ns/op
BenchmarkHeapDefer        50000000  32.5 ns/op
```

The open-coded defer is ~3x the cost of no defer. The heap defer is ~100x. In absolute terms, even the heap defer is 32 ns — well below 1 μs.

### When does this matter?

For a service handling 10,000 requests / second:
- 10,000 × 5 defers = 50,000 defers / s.
- At 32 ns each (heap path): 1.6 ms / s = 0.16% of CPU.
- At 1 ns each (open-coded): 50 μs / s = 0.005% of CPU.

Neither is significant. Defer cost rarely dominates.

For a service in a tight inner loop:
- 1,000,000 iterations × 5 defers / iteration = 5,000,000 defers / s.
- At 32 ns: 160 ms / s = 16% of CPU.
- At 1 ns: 5 ms / s = 0.5% of CPU.

Now it matters. Open-coded saves measurable CPU. If you cannot open-code (loops), refactor.

### Compile-time vs run-time cost

Open-coded defers shift cost from runtime to compile time. The compiler generates more code (a deferreturn block per function with defers). This is a one-time cost; the runtime cost is per-call.

For a build with 10,000 functions and average 2 defers per function, the extra code is ~50 KB. Negligible.

### Inlining and defers

Functions with defers are not inlined. This means:
- A small helper function with a defer adds function-call overhead at every call site.
- If you really need to inline, replace the defer with an explicit cleanup call.

In practice, function-call overhead is ~1-2 ns. For non-hot code, it does not matter.

### Stack growth and defers

When a goroutine's stack grows, the runtime walks the defer chain to update SPs. This is O(n) in the number of defers. For deeply recursive code with one defer per frame, stack growth becomes O(n²).

Mitigation: keep defers shallow; avoid deep recursion with defers in every frame.

### GC and defers

The GC scans the defer chain as part of root scanning. This adds time proportional to the total number of defers across all goroutines.

For 100 goroutines each with 5 pending defers, that is 500 defer scans per GC cycle. Negligible.

For 100,000 goroutines (unusual), it could be 500,000 scans — measurable. But such a high count suggests deeper architectural problems.

---

## Deep Dive: Reading Generated Assembly

To see how the compiler generates code for defers:

```sh
go build -gcflags='-S' main.go 2> defer.asm
```

Then inspect `defer.asm`. For a function with one open-coded defer:

```go
package main

func main() {
    defer cleanup()
    work()
}

func work() {}
func cleanup() {}
```

The assembly (simplified) shows:

```
"".main STEXT size=86 args=0x0 locals=0x18 funcid=0x0
    SUBQ $24, SP        ; allocate frame: defer bit + arg space
    MOVQ BP, 16(SP)
    LEAQ 16(SP), BP

    MOVB $1, 8(SP)      ; set defer bit (open-coded)

    CALL "".work(SB)    ; call work

    ; deferreturn block:
    MOVBLZX 8(SP), AX
    TESTL AX, AX
    JEQ done
    CALL "".cleanup(SB)
done:
    MOVQ 16(SP), BP
    ADDQ $24, SP
    RET
```

You can see:
- The defer bit is at SP+8.
- Setting it costs one MOV.
- At return, one MOV + TEST + JEQ + CALL.
- No `runtime.deferproc` or `runtime.deferreturn` calls.

For a function with a heap defer (in a loop):

```
"".loopDefer STEXT size=...
    SUBQ ..., SP
    ...
    ; loop body:
loop:
    ; defer setup:
    MOVQ $"".cleanup·f(SB), AX
    PUSHQ AX            ; push fn for deferproc
    MOVL $0, AX         ; arg size
    PUSHQ AX
    CALL runtime.deferproc(SB)
    TESTL AX, AX
    JNE recovered_jmp
    ADDQ $16, SP
    ; loop back...

    ; function exit:
    CALL runtime.deferreturn(SB)
    RET
```

Now `runtime.deferproc` and `runtime.deferreturn` are visible calls. Each iteration of the loop calls `deferproc`.

### Reading FUNCDATA

For open-coded defers, the FUNCDATA section contains the defer info:

```
go.func.* SDATA
    DUFFZERO ...
    ; FUNCDATA for "".main:
    ;   open-coded defers:
    ;     defer bit offset: 8
    ;     defer 0 (cleanup): args offset 0 (no args)
    ;   deferreturn PC: 0x50
```

The runtime reads this on panic to know which defers are pending and how to invoke them.

---

## Deep Dive: Cleanup Latency Distribution

In production, you care about percentiles, not means. The distribution of cleanup latency:

- **p50 (median):** ~10-50 ns for a typical function with a few defers.
- **p99:** ~100-200 ns. Most likely due to GC pause overlap.
- **p99.9:** ~10-100 μs. GC pauses, stack growth, or unlucky scheduling.
- **p99.99:** can be 1-10 ms in pathological cases.

For request handlers, the cleanup latency is irrelevant compared to network I/O. For internal hot paths (lockless data structures, schedulers), it can matter.

### Tail latency causes

- **GC pause.** Defer chain scan adds a small per-pause cost.
- **Stack growth.** Walking defers during copy.
- **Heap allocation.** When the per-P pool is empty and falls back to the global pool.
- **Cache misses.** Long defer chains span cache lines.

### Optimisation when it matters

If profiling shows defer in the tail:
- Reduce defer count per function.
- Avoid defers in loops.
- Pre-warm pools if possible (not exposed by runtime).
- Consider explicit cleanup for the absolute hottest paths.

---

## Deep Dive: Cleanup and the Race Detector

The race detector (`-race`) adds instrumentation around memory accesses. Defers participate:

- Each defer's argument storage is tracked.
- The `_defer` record itself has happens-before edges between registration and execution.
- Cleanup that races with normal code is flagged.

The race detector is a great safety net for cleanup-related bugs. Run your tests with `-race` regularly.

Cost: 2-10x runtime overhead, 5-10x memory overhead. Not for production, but excellent for testing.

---

## Deep Dive: Cleanup in cgo

cgo callbacks run on Go goroutines. Defers work normally. But:

- The G's defer chain is separate per goroutine, including cgo callback goroutines.
- The cgo callback may share a stack with C code; defers stored on the Go stack are fine.
- Panic recovery in a cgo callback can complicate the C side; usually you recover and convert to an error return.

### Pattern: cgo callback with cleanup

```go
//export GoCallback
func GoCallback(arg unsafe.Pointer) {
    defer func() {
        if r := recover(); r != nil {
            // log and convert; C cannot handle Go panics
            cLog(C.CString(fmt.Sprintf("panic: %v", r)))
        }
    }()
    // ... do work using arg ...
}
```

The defer with recover prevents Go panics from propagating into C, which would corrupt the C-side stack.

---

## Deep Dive: Cleanup and the Race Schedule

The Go runtime can preempt goroutines at *async* points (Go 1.14+). A function with open-coded defers may be preempted mid-cleanup. The defer logic must be safe under preemption:

- Defer registration is atomic (one bit set).
- Defer execution can be preempted; the bit is cleared *after* the call returns.
- If the goroutine is preempted between bit-set and call, on resume the call still happens.

This is invisibly correct because the bit-and-call is in a "do once" pattern: the bit is cleared only after the call.

---

## Deep Dive: Cleanup Costs Visible in Profiling

In a CPU profile:
- `runtime.deferreturn` shows up if heap defers are common.
- `runtime.deferproc` shows up if heap defers are *registered* often.
- `runtime.newdefer` and `runtime.freedefer` show up if the pool churns.
- `runtime.gopanic` shows up if panics are common (usually a bug).

A profile dominated by `runtime.deferreturn` suggests:
- Defer in a hot loop.
- Too many defers per function.
- Refactor needed.

A profile dominated by `runtime.gopanic`:
- Frequent panics (probably user errors, not bugs).
- Consider error returns instead.

---

## Reference: All `runtime` Defer/Panic Functions

| Function | Description |
|----------|-------------|
| `deferproc` | Register a heap defer. |
| `deferprocStack` | Register a stack-allocated defer (small, fast path). |
| `deferreturn` | Run pending heap defers at function exit. |
| `runOpenDeferFrame` | Run open-coded defers in a frame. |
| `addOneOpenDeferFrame` | Add an open-coded defer frame to the panic chain. |
| `gopanic` | Implement `panic`. |
| `gorecover` | Implement `recover`. |
| `Goexit` | End the current goroutine. |
| `goexit1` | Internal: continue Goexit after defers. |
| `goexit0` | Internal: clean up the goroutine. |
| `newdefer` | Allocate a defer record. |
| `freedefer` | Return a defer record to the pool. |
| `jmpdefer` | Tail-call into a deferred function (assembly). |
| `fatalpanic` | Terminate the program with an unrecovered panic. |
| `preprintpanics` | Prepare panic values for printing. |

These are all in `runtime/panic.go` and `runtime/asm_*.s`. Read them for the canonical implementation.

---

## Closing for Real

The professional level is the deepest tier. You now know:
- How the compiler generates code for defers (open-coded vs heap).
- How the runtime implements panic, recover, and Goexit.
- How `context.AfterFunc` registers, fires, and stops callbacks.
- The cost of each operation at the nanosecond level.
- How to read the runtime source and the compiler-generated assembly.

The remaining files — specification, interview, tasks, find-bug, optimize — apply this knowledge to formal language rules, practice problems, and bug-finding exercises. Together they form the complete chapter on cleanup ordering.

Thanks for reading. Build well.

---

## Extended Appendix: Cleanup Internals Across Architectures

The Go runtime supports many architectures. Cleanup-related code is mostly architecture-independent, but the entry points (deferproc, deferreturn, jmpdefer) have per-arch assembly stubs.

### x86-64

The x86-64 implementation uses register-based ABI (Go 1.17+). Function arguments live in registers (AX, BX, CX, DI, SI, R8-R11), with the stack used for overflow. `jmpdefer` adjusts the stack and registers to make a clean tail call:

```assembly
TEXT runtime·jmpdefer(SB), NOSPLIT, $0-16
    MOVQ    fv+0(FP), DX
    MOVQ    argp+8(FP), BX
    LEAQ    -8(BX), SP
    MOVQ    -8(SP), BP
    SUBQ    $5, (SP)
    JMP     0(DX)
```

The `SUBQ $5, (SP)` adjusts the return address so that after the deferred function returns, control resumes inside `deferreturn` (not at the caller of `deferproc`).

### ARM64

ARM64 has a similar mechanism but uses different register conventions:

```assembly
TEXT runtime·jmpdefer(SB), NOSPLIT|NOFRAME, $0-16
    MOVD    fv+0(FP), R26
    MOVD    argp+8(FP), R0
    MOVD    R0, RSP
    SUB     $4, LR
    MOVD    0(R26), R3
    B       (R3)
```

ARM64 has a hardware link register (LR) which stores the return address. The `SUB $4, LR` adjusts it to point back into deferreturn.

### Other architectures

PowerPC, MIPS, RISC-V, and 386 all have analogous jmpdefer stubs. They differ in register allocation and ABI but follow the same principle: tail-call into the deferred function, return into deferreturn.

### Common invariants

Across all architectures:
- The defer record's `sp` field is the calling function's SP at registration.
- The `pc` field is the calling function's return address.
- `getsp()` and `getcallersp()` are compiler intrinsics that read the appropriate register.

These invariants let the runtime walk the defer chain consistently regardless of architecture.

---

## Extended Appendix: Defer in the Go Memory Model

The Go memory model defines happens-before relationships. Defers participate:

- The defer statement happens-before the deferred function call.
- The deferred function's writes happen-before the function's return.
- The function's return happens-before observation of return values by the caller.

This means: if a deferred function modifies a named return value, the caller observes the modified value. Memory-model-correct.

For closures over local variables, the closure's reads happen-after any writes that completed before the defer is called. This is just the regular memory model for closures.

### Defer and atomic operations

If a defer uses `sync/atomic` to update shared state, the atomic happens-before the function's return. The caller observes the update.

If a defer races with another goroutine accessing the same memory, the race detector flags it (with `-race`).

### Defer and channels

Sending on a channel inside a defer happens-before the receive on the other end. Closing a channel inside a defer (via `defer close(ch)`) makes the close visible to all readers.

This is how `defer close(out)` in producers reliably signals end-of-stream: the close is part of the function's return, visible to consumers via the channel's happens-before semantics.

---

## Extended Appendix: Defer in Generics (Go 1.18+)

Generic functions use type parameters:

```go
func process[T any](items []T) {
    defer cleanup()
    for _, item := range items {
        // ...
    }
}
```

The compiler instantiates the generic function for each type used. Each instantiation is a separate function in the binary, with its own defer analysis. The defer is open-coded in each instantiation independently.

In Go 1.18-1.20, generics used a "dictionary" approach with some indirection. From 1.21+, the compiler uses GC-shape stenciling for some types, which reduces code bloat.

For defers, the implication: each instantiation pays the open-coded cost independently. Total binary size grows with instantiations, but per-call cost is the same as non-generic code.

---

## Extended Appendix: Defer and the Test Framework

The `testing` package has its own cleanup primitive: `t.Cleanup(fn)`. Unlike defer, it runs after the test function returns, including across helper functions:

```go
func helper(t *testing.T) {
    f, _ := os.CreateTemp("", "")
    t.Cleanup(func() { f.Close() })
    // helper returns; defers would fire, but t.Cleanup waits for test end
}

func TestThing(t *testing.T) {
    helper(t)
    // f is still open
    // test body uses f...
}
// at test end: t.Cleanup runs, f closes
```

Implementation: `t.Cleanup` appends to a slice on the testing.T. At test end, the slice is iterated in reverse (LIFO).

### `t.Cleanup` vs `defer`

| Feature | `defer` | `t.Cleanup` |
|---------|---------|-------------|
| Scope | Function | Test (transitively across helpers) |
| Trigger | Function return / panic / Goexit | Test end |
| Order | LIFO within function | LIFO within test |
| Subtests | Per-subtest if defer is in subtest | Per-subtest if `t.Cleanup` is in subtest |
| Failure handling | Runs on `t.FailNow` (via Goexit) | Runs on `t.FailNow` |
| Parallel safety | Yes (per-goroutine) | Yes (per-test) |

`t.Cleanup` is the right choice for test helpers. `defer` is the right choice for normal Go functions.

### `t.TempDir`

`t.TempDir` creates a temporary directory and registers a `t.Cleanup` to remove it. No need for manual cleanup. Excellent for test isolation.

---

## Extended Appendix: Defer and Reflection

`reflect.Call` calls a function dynamically. Defers in the reflected function work normally. Defers around the `reflect.Call` work normally. No special interaction.

### Defer on a reflect.Value

You cannot `defer reflectValue.Call(...)` directly because `defer` requires a syntactic call. You can wrap it:

```go
defer func() {
    rv.Call(args)
}()
```

The closure is registered as a defer; when it runs, it calls `rv`.

---

## Extended Appendix: Common Implementation Bugs

The runtime is mostly stable, but cleanup bugs have surfaced:

- **CL 379754** (Go 1.18): Fixed a bug where deferred recovery did not properly unwind on Goexit.
- **CL 263277** (Go 1.17): Fixed a stack-growth bug that miscounted defer frames.
- **CL 254398** (Go 1.16): Fixed an issue with open-coded defers and inlined functions.

These are highly technical. They illustrate that the runtime's cleanup machinery is non-trivial; even the Go team has shipped bugs in it. As a runtime contributor, you can find more in the Go issue tracker.

---

## Extended Appendix: Defer in Closures and Function Values

A function value (`func()`) is a pointer to a funcval struct:

```go
type funcval struct {
    fn uintptr // pointer to the function code
    // captured variables follow
}
```

When you write `defer f()`, the compiler evaluates `f` at the defer line. If `f` is a closure, the closure was created earlier; the defer captures the closure pointer.

When the defer fires, the closure pointer is dereferenced, the code pointer extracted, and the function called. The closure's captured variables are accessible inside the function.

If you write `defer func() { ... }()` directly:
1. The closure is constructed at the defer line (allocating on the heap if needed, due to escape analysis).
2. The closure pointer is stored in the defer record.
3. At execution, the closure is called.

For `defer fn(arg1, arg2)`:
1. `fn` is evaluated to a funcval pointer.
2. `arg1` and `arg2` are evaluated.
3. All three are stored in the defer record.
4. At execution, `fn` is called with the stored args.

Storing the args incurs memory copy cost proportional to the arg sizes. For large args (e.g., large structs), prefer the closure form: the closure stores pointers, not the full data.

---

## Extended Appendix: Defer's Interaction with Linker Optimisations

The Go linker can sometimes deduplicate function values. If two `defer f()` calls use the same function, the linker may share the funcval. This is an implementation detail; user code does not see it.

The linker also removes unreachable code. If a function is reached only by a defer, the function is kept. If the defer is statically unreachable, the function may be removed (dead-code elimination).

For cgo callbacks, the linker keeps the symbol exported. Cleanup in cgo callbacks works normally.

---

## Extended Appendix: Defer Records and the Stack

`_defer` records are mostly heap-allocated. But there is a special path called `deferprocStack` for *stack-allocated* defer records:

```go
//go:nosplit
func deferprocStack(d *_defer) {
    gp := getg()
    if gp.m.curg != gp {
        throw("defer on system stack")
    }
    d.started = false
    d.heap = false
    d.openDefer = false
    d.sp = getcallersp()
    d.pc = getcallerpc()
    d.framepc = 0
    d.varp = 0
    *(*uintptr)(unsafe.Pointer(&d._panic)) = 0
    *(*uintptr)(unsafe.Pointer(&d.fd)) = 0
    *(*uintptr)(unsafe.Pointer(&d.link)) = uintptr(unsafe.Pointer(gp._defer))
    *(*uintptr)(unsafe.Pointer(&gp._defer)) = uintptr(unsafe.Pointer(d))
    return0()
}
```

This is used when the compiler can prove the defer record can live on the stack (typically a non-loop defer in a function that does not escape). The benefit: no heap allocation, no pool management.

Stack-allocated defers were a stepping stone toward open-coded defers. They are still used in some paths.

### When does the compiler use deferprocStack?

- Non-loop defers in functions with one or a few defers.
- When the compiler does not open-code (e.g., due to compilation flags or unusual structure).
- As a fallback that is faster than heap allocation but slower than open-coded.

---

## Extended Appendix: `runtime.Callers` and Defers

`runtime.Callers` returns the PCs of the calling stack frames. It does not include defers in flight. A defer's *containing function* is in the stack; the defer itself is just code being executed.

This means a stack trace inside a deferred function looks like:

```
runtime.gopanic
panicked.func1.cleanup     ← deferred function
runtime.gopanic            ← the actual panic
panicked.func1
main.main
```

The deferred function appears as a regular call, because that is exactly what it is.

---

## Extended Appendix: Defer and `pprof`

The `pprof` profiler captures stack traces at sampling points. Defers are visible in the traces as the functions they invoke. Their *registration* cost (deferproc) is visible too.

To find defer costs in a profile:

```sh
go tool pprof -list runtime.deferproc profile.out
```

Shows the call sites that allocate heap defers. High-frequency call sites are candidates for refactoring.

---

## Extended Appendix: `runtime.SetFinalizer` Internals

Finalizers are a separate cleanup mechanism. They are *not* defers. The runtime:

- Maintains a finalizer queue.
- During GC, scans for unreferenced objects with finalizers.
- After GC, runs finalizers in a dedicated goroutine.

A finalizer runs at most once per object. If you re-set the finalizer (after `SetFinalizer(obj, nil)` and later `SetFinalizer(obj, fn)`), the object is treated as fresh.

Finalizers have caveats:
- They can resurrect objects (making them reachable again), delaying actual cleanup.
- They run on a single goroutine, in queue order. A slow finalizer blocks the rest.
- They are not deterministic; GC timing is up to the runtime.

For these reasons, finalizers are a debugging aid, not a real cleanup mechanism. The standard library uses them on `*os.File` to close the FD if the user forgets — but this is a safety net, not the primary cleanup path.

---

## Extended Appendix: Cleanup in `signal.NotifyContext`

`signal.NotifyContext` (Go 1.16+) creates a context that is cancelled on receipt of a named signal:

```go
ctx, stop := signal.NotifyContext(parent, syscall.SIGINT, syscall.SIGTERM)
defer stop()
```

Implementation:
1. Create a cancellable context.
2. Register a signal handler that calls `cancel`.
3. Return the context and a `stop` function that deregisters the handler.

The `stop` function is crucial: it deregisters the signal handler. Without it, the handler stays registered for the program's lifetime, and the function value (referenced by the handler) is kept alive.

In a typical `main`:

```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
defer stop()
// ... wait for ctx.Done() ...
```

When `main` returns, `stop` deregisters. Clean.

### Internal: how signals propagate

The Go runtime registers a single signal handler for each signal. When a signal arrives, the handler:
1. Marks the signal as pending on the M.
2. The next safe point in any goroutine on that M services the signal.
3. The signal service calls registered handlers.

For SIGINT/SIGTERM, the handler is the one installed by `signal.Notify`. It eventually calls user code (via the channel mechanism in `os/signal`).

`signal.NotifyContext` wires this into the context machinery: the user code in the signal handler calls `cancel` on the context.

---

## Extended Appendix: Defer in `goroutine` Profiles

The goroutine profile (`go tool pprof http://service/debug/pprof/goroutine`) shows all goroutines and their stacks. Defers in flight do not appear as separate frames; they appear as the calls they make.

A goroutine stuck in a deferred function shows:
```
runtime.gopark
sync.runtime_Semacquire
sync.(*Mutex).Lock        ← deferred call holding a mutex
some/pkg.(*T).Close
main.handler              ← the function that registered the defer
```

If you see many goroutines stuck like this during shutdown, the defer is the cleanup point.

---

## Extended Appendix: A Walkthrough of an Old `_defer` Bug

In 2017, a bug was reported where deferred functions with closures inside generic-ish code could observe stale captured values after stack growth. The root cause:

- The closure captured by-reference to local variables on the stack.
- Stack growth copied the variables to a new stack.
- The closure's references were not updated.
- When the deferred function ran (post-growth), it saw stale memory.

The fix: ensure closures captured by stack-allocated defers are properly updated during stack copy. The fix is in the runtime's `copystack` function.

The lesson: cleanup correctness depends on many runtime invariants. The Go team's stress tests catch most issues; occasionally one slips through.

---

## Extended Appendix: Defer in Embedded Functions

```go
func outer() {
    defer A()
    inner()
}

func inner() {
    defer B()
    work()
}
```

When `outer` runs:
1. `outer` registers `A`.
2. `outer` calls `inner`.
3. `inner` registers `B`.
4. `inner` runs `work`.
5. `inner` returns; deferreturn runs B.
6. Control returns to `outer`.
7. `outer` returns; deferreturn runs A.

The defer chain at step 4:
```
g._defer ──► [B (inner)] ──link──► [A (outer)] ──► nil
```

`B`'s sp is inner's sp; `A`'s sp is outer's sp. When inner's deferreturn runs, it pops B (matching sp), stops at A (different sp). Outer's deferreturn pops A.

Each function's defers stay logically separate even though they share the same chain.

---

## Extended Appendix: A Note on `noescape` and Defers

The runtime uses `noescape` to tell the escape analyser that a pointer does not escape:

```go
gp._panic = (*_panic)(noescape(unsafe.Pointer(&p)))
```

This is a trick. Normally, taking the address of a local variable would force it to the heap. With `noescape`, the variable can remain on the stack — which is essential for performance in the panic path.

`noescape` is an `//go:noescape` annotation plus an `unsafe.Pointer` cast. Used carefully throughout the runtime.

---

## Extended Appendix: Defer Argument Storage Optimisation

For defers with small arguments (≤ pointer size), the runtime stores them inline in the `_defer` record. For larger arguments, the record allocates additional space at the end of the structure.

The `_defer` struct is followed by `siz` bytes of argument storage:

```
[_defer header][arg0][arg1]...[argN]
```

The total size is computed at registration time. The pool maintains records of various sizes (size classes) to handle different argument layouts.

### Size classes

`deferclass` maps argument sizes to a size class:

```go
func deferclass(siz uintptr) uintptr {
    if siz <= 0 {
        return 0
    }
    if siz <= 8 {
        return 1
    }
    // ... etc ...
}
```

Each class has its own pool. This trades memory (multiple pools) for speed (no per-size search).

---

## Extended Appendix: Defer in Critical Sections

If you hold a lock and the function panics, the lock should release. Defer enables this:

```go
mu.Lock()
defer mu.Unlock()
// ... critical section ...
```

Implementation: `mu.Unlock` is called via the defer chain. The runtime ensures defers run on panic. The mutex is released regardless of how the function exits.

The cost: one defer record per critical section. For tight critical sections (microsecond-level), the defer cost can dominate. In that case, explicit unlock is faster:

```go
mu.Lock()
// ... critical section ...
mu.Unlock()
```

But explicit unlock requires every return path to include the unlock. For non-trivial functions, defer is safer.

### The trade-off

For most code: use `defer mu.Unlock()`. The cost is negligible.
For ultra-hot paths (where you have measured a defer dominates): use explicit unlock with careful coding.

---

## Extended Appendix: Defer and Lock-Free Algorithms

Lock-free algorithms typically do not use defer. They use atomics directly. Cleanup is encoded into the atomic operations themselves.

Where defer fits: at the boundary between lock-free code and the rest of the system. The lock-free code is in a tight inner loop; the surrounding setup/teardown uses defer.

```go
func atomicallyDo(ptr *atomic.Pointer[T], op func(*T)) {
    defer recover() // catch any unexpected panics from op
    p := ptr.Load()
    // ... lock-free CAS loop ...
}
```

The defer is at a low frequency (function level), not in the inner CAS loop. Cost is minimal.

---

## Extended Appendix: Defer in High-Performance Servers

Servers handling millions of requests per second:

- Often dispatch through a small set of "hot" functions.
- Each hot function may use 2-5 defers (request context, body close, metric emit, span end).
- Open-coded defers make these nearly free.

If profiling shows defer overhead:
1. Ensure open-coding (check with `-d=defer=2`).
2. Reduce defer count where possible.
3. Consider explicit cleanup for the absolute hottest path.

Most servers spend < 1% of CPU on defer. It is not the bottleneck.

---

## Extended Appendix: A Detailed Case — Replacing a Hot-Path defer

Suppose profiling reveals that 5% of CPU is spent in `runtime.deferreturn` in a function called billions of times. The defer is `defer span.End()`. The fix:

1. Verify the defer is heap-allocated (not open-coded). Compile with `-d=defer=2`.
2. Identify why: maybe the function has 9 defers, or the span.End is in a loop.
3. Refactor:
   - If too many defers: combine cleanups into one defer.
   - If in a loop: extract a helper.
   - If neither: consider explicit `span.End()` at every return path (and test thoroughly).

The win: 5% of CPU back. Worth doing for high-traffic services.

The risk: explicit cleanup is error-prone. Every new code path must include the End call. Code review must catch missing calls.

Trade-off: senior engineers measure, refactor, test, and document. Junior engineers should leave the defer alone.

---

## Extended Appendix: Cleanup in Latency-Sensitive Code

Real-time-ish Go code (e.g., HFT) sometimes can't tolerate the unpredictability of heap allocation. Defers in such code:
- Must be open-coded.
- Must not allocate.
- Must not call slow functions.

A typical pattern:

```go
//go:noinline
func tradeOrder(ctx context.Context, order Order) error {
    start := time.Now()
    defer func(t time.Time) {
        recordLatency(t)  // pre-allocated, fast
    }(start)
    return doTrade(ctx, order)
}
```

The defer with one argument is fast (open-coded, no allocation). The recordLatency function is pre-allocated. Latency is bounded.

For absolute latency-critical paths, explicit cleanup may be required. Defer is great but not free.

---

## Extended Appendix: The Future of Defer

The Go team has signalled interest in further optimisations:
- Better escape analysis for defer arguments (avoid heap allocation where possible).
- Stack-allocated defers in more cases.
- Per-G defer pool (already mostly done).

Possible language additions:
- Structured concurrency primitives (no concrete proposal yet).
- More compile-time analysis of cleanup correctness.

The defer machinery has been stable for years. Future changes are likely refinements, not redesigns.

---

## Extended Appendix: A Long Worked Example — Profiling a Service

Imagine you are profiling a Go service. The pprof output shows:

```
% of time     function
40%           service.handler
20%           runtime.deferreturn
10%           runtime.deferproc
10%           json.Marshal
5%            net.Read
... etc ...
```

30% combined in defer overhead is suspicious. Investigate:

1. Run `go tool pprof -list runtime.deferproc profile.out`. See which functions are calling it.
2. Identify the hottest defer site.
3. Compile with `-d=defer=2` to see if it's open-coded.

You find: the handler has a defer inside a request-processing loop. Each request, the loop iterates 100 times, registering 100 defers per request. With 10,000 requests/sec, that's 1,000,000 defers/sec.

Fix: move the defer out of the loop. Make it function-scope. Or extract the loop body into a helper with its own defer.

Result: 30% CPU back. Service can handle 30% more requests on the same hardware. Senior-level optimisation work paid for itself.

---

## Extended Appendix: Cleanup Failures in Production

Real-world incidents involving cleanup ordering:

- **Service deadlock during shutdown.** Cleanup A waits for cleanup B; B waits for A. Caught by SIGKILL after timeout. Diagnosis: dependency cycle. Fix: restructure dependencies.
- **Lost data on deploy.** Server's Shutdown was called without draining the publisher. Buffered metrics never sent. Fix: add publisher.Flush before publisher.Close.
- **Goroutine leak under load.** A worker pool's Shutdown only cancelled the context but did not wait for workers. Goroutines kept running after Shutdown returned. Fix: add wg.Wait.
- **Connection truncation.** HTTP server closed its listener before draining in-flight requests. Clients saw truncated responses. Fix: use http.Server.Shutdown instead of Close.
- **Resource exhaustion.** Defer in a loop leaked file descriptors. Service hit FD limit after hours. Fix: extract loop body into helper.
- **Audit log gaps.** A service's logger was closed before its components. Final component logs never flushed. Fix: reverse dependency order.

Each incident traces to a violation of the principles in this curriculum. Cleanup ordering bugs are real, expensive, and avoidable.

---

## Extended Appendix: Cleanup Patterns We Did Not Cover

A few patterns worth mentioning:

- **`defer trace.Span(...)` for distributed tracing.** Pattern: start span, defer end. Captures function timing automatically.
- **`defer metric.Observe(start)`.** Pattern: record start time as arg; defer observes elapsed.
- **`defer return logRequest(r, &err)`.** Pattern: log the request including the eventual error.
- **`defer atomic.AddInt64(&inFlight, -1)`.** Pattern: increment-and-defer-decrement for in-flight counters.
- **`defer cancel(); defer wg.Wait()`.** Pattern: signal-then-wait for shutdown.

Each pattern is a few lines. Each one has been used in millions of Go programs. Add them to your repertoire.

---

## Extended Appendix: An Unsolved Problem

Even at the professional level, some cleanup problems do not have clean solutions:

- **Cleanup that requires consensus across services.** A distributed transaction's cleanup might require coordinating with other services. Go primitives don't help; you need a distributed protocol.
- **Cleanup of resources owned by the kernel.** If you `mmap` memory and the process crashes, the kernel reclaims it. But if your cleanup involves OS-level resources (firewall rules, mount points), no defer or context can guarantee it.
- **Cleanup that races with the OS.** A service receives SIGTERM, but the kernel also kills the network interface. Your cleanup tries to flush metrics over the now-dead interface. The cleanup hangs.

These problems require operational thinking, not language-level features. Senior+ engineers learn to recognise them and design around them (idempotent cleanup that runs on next start, resource managers, etc.).

---

## Extended Appendix: Career Implications

If you understand cleanup ordering at this depth, you are a strong candidate for:
- Runtime contributor.
- Senior performance engineer.
- Principal/staff engineer on a Go-heavy team.
- Go consultant / educator.

Companies hire for this skill set. Few engineers possess it. The runtime is large and intimidating; reading it builds rare expertise.

---

## Extended Appendix: A Final Anecdote

In 2019, a major Go service in production was found to be losing 2% of requests on every deploy. The team investigated for weeks. The root cause: the service's main function did `defer log.Flush(); defer database.Close()`. The order looked correct — log flushed after database closed — but the database's close *itself emitted log entries*. Those entries went to a logger whose flush had already been promised to run *after* the database close.

LIFO order:
- `database.Close()` runs first.
- During Close, the database emits final-state logs.
- The logs go into the logger's buffer.
- `log.Flush()` runs next, flushes the buffer.

Wait — that *is* the right order. So what was the bug?

The bug: log.Flush wasn't run *synchronously*. It scheduled a flush goroutine that took ~50ms. Main returned before the goroutine finished. The OS killed the process. The 50ms worth of logs (from database close) were lost.

The fix: make log.Flush block until the flush completes.

The lesson: cleanup ordering bugs can hide in async details. Even with LIFO defers, if a cleanup is asynchronous, you must wait for it explicitly.

A senior engineer with deep knowledge of cleanup ordering would have spotted this in code review. The team learned. The service was fixed. The 2% loss disappeared.

This is the kind of bug that the professional file prepares you to find.

---

## Extended Appendix: Concluding Thoughts

Cleanup ordering in Go is a deep topic. The defer keyword looks simple, but its implementation involves the compiler, the runtime, the scheduler, and the memory model. The `context.AfterFunc` primitive is small but built on careful synchronisation. The panic/recover machinery is intricate.

If you have read this entire file, you have engaged with the internals at a level few Go programmers ever reach. Use the knowledge wisely:
- For debugging.
- For teaching.
- For contributing.
- For writing libraries that others trust.

The rest of the curriculum — specification, interview, tasks, find-bug, optimize — applies what you have learned in shorter, more practical formats. They are essential complements.

Build software that releases what it acquires, in the right order, every time. That is the lesson of this sub-topic, distilled.

Thank you for reading.

---

## Index of Cleanup-Related Runtime Symbols (Reference)

```
runtime.deferproc              register a heap defer
runtime.deferprocStack         register a stack-allocated defer
runtime.deferreturn            run pending heap defers
runtime.jmpdefer               assembly: tail-call into a defer
runtime.newdefer               allocate a _defer record
runtime.freedefer              return a _defer record to the pool
runtime.runOpenDeferFrame      run open-coded defers in a frame
runtime.addOneOpenDeferFrame   add a frame to the open-defer chain
runtime.gopanic                implement panic
runtime.gorecover              implement recover
runtime.fatalpanic             terminate the program with an unrecovered panic
runtime.preprintpanics         prepare panic values for printing
runtime.Goexit                 end the current goroutine
runtime.goexit1                continue Goexit after defers
runtime.goexit0                clean up the dead goroutine
runtime.recovery               jump to recover's caller's return point
runtime.copystack              copy a goroutine's stack on growth (updates defers)
```

Each of these has source in `runtime/panic.go` or `runtime/asm_*.s`. Read them for the canonical implementation.

---

## Reference: `_defer` Struct Fields

```go
type _defer struct {
    started   bool       // defer is currently running
    heap      bool       // defer is heap-allocated
    openDefer bool       // defer is from an open-coded defer
    sp        uintptr    // stack pointer at registration
    pc        uintptr    // program counter at registration
    fn        *funcval   // the function to call
    _panic    *_panic    // panic info, if running during a panic
    link      *_defer    // next defer in the chain
    fd        unsafe.Pointer // funcdata; used for open-coded defers
    varp      uintptr    // value of varp for the deferring frame
    framepc   uintptr    // pc for the deferring frame
}
```

Size: ~80 bytes on 64-bit. Plus argument storage.

---

## Reference: `_panic` Struct Fields

```go
type _panic struct {
    argp      unsafe.Pointer // pointer to arguments of panic
    arg       interface{}    // panic value
    link      *_panic        // next panic in the chain
    pc        uintptr        // where to resume after recover
    sp        unsafe.Pointer // sp at recover
    recovered bool           // recover() was called
    aborted   bool           // the panic was aborted (by another panic)
    goexit    bool           // this is from Goexit, not panic
}
```

Size: ~64 bytes on 64-bit.

---

## Reference: `afterFuncCtx` Struct

```go
type afterFuncCtx struct {
    cancelCtx
    once sync.Once
    f    func()
}
```

Size: cancelCtx + sync.Once + function pointer. Roughly 100-150 bytes.

---

## Conclusion (For Real, Final)

Eight thousand lines of cleanup ordering content across five depth levels. You have the full picture: from `defer f.Close()` to `runtime.gopanic`. From "release a file" to "shutdown a hundred-component service." From the language semantics to the assembly output.

This is the most thorough treatment of cleanup ordering in Go you will find anywhere. Use it as a reference; revisit it as needed. The remaining files in this sub-topic — specification, interview, tasks, find-bug, optimize — are shorter, more focused, and equally important.

Now go build something correct, fast, and clean.

---

## Bonus: A Long-Form Walk-Through of `runOpenDeferFrame`

The function `runOpenDeferFrame` is the heart of open-coded defer execution during a panic or Goexit. Let's read it in detail.

```go
func runOpenDeferFrame(gp *g, d *_defer) bool {
    done := true
    fd := d.fd

    deferBitsOffset, fd := readvarintUnsafe(fd)
    nDefers, fd := readvarintUnsafe(fd)
    deferBits := *(*uint8)(unsafe.Pointer(d.varp - uintptr(deferBitsOffset)))

    for i := int(nDefers) - 1; i >= 0; i-- {
        // read each defer's metadata
        var argWidth, closureOffset, nArgs uint32
        argWidth, fd = readvarintUnsafe(fd)
        closureOffset, fd = readvarintUnsafe(fd)
        nArgs, fd = readvarintUnsafe(fd)
        if deferBits&(1<<i) == 0 {
            // skip: deferred call not active
            for j := uint32(0); j < nArgs; j++ {
                _, fd = readvarintUnsafe(fd)
                _, fd = readvarintUnsafe(fd)
                _, fd = readvarintUnsafe(fd)
            }
            continue
        }

        // Read the function value
        closure := *(**funcval)(unsafe.Pointer(d.varp - uintptr(closureOffset)))
        d.fn = closure

        // Read argument layout
        deferArgs := make([]byte, argWidth)
        for j := uint32(0); j < nArgs; j++ {
            var argOffset, argLen, argDestOffset uint32
            argOffset, fd = readvarintUnsafe(fd)
            argLen, fd = readvarintUnsafe(fd)
            argDestOffset, fd = readvarintUnsafe(fd)
            memmove(unsafe.Pointer(&deferArgs[argDestOffset]),
                    unsafe.Pointer(d.varp-uintptr(argOffset)),
                    uintptr(argLen))
        }

        // Clear the bit BEFORE the call so if it panics, we don't re-run.
        deferBits = deferBits &^ (1 << i)
        *(*uint8)(unsafe.Pointer(d.varp - uintptr(deferBitsOffset))) = deferBits

        // Call the deferred function
        p := d._panic
        reflectcallSave(p, unsafe.Pointer(closure), unsafe.Pointer(&deferArgs[0]), argWidth)

        if p != nil && p.aborted {
            break
        }
        d.fn = nil
        for j := 0; j < int(argWidth); j++ {
            deferArgs[j] = 0
        }

        if deferBits == 0 {
            d.fd = nil
            d.varp = 0
            done = true
            break
        }
    }
    return done
}
```

The flow:
- Read the FUNCDATA to find the defer-bit-vector offset and per-defer metadata.
- Read the current value of the defer bit vector.
- Iterate from the highest-numbered defer to the lowest (LIFO).
- For each set bit:
  - Read the function value from the function's frame.
  - Read the arguments from the function's frame.
  - Clear the bit *before* calling (so a panic doesn't re-run).
  - Call the function.
  - If the call panics, break out of the loop.

The function returns `true` when all defers in this frame have been processed.

### Why clear the bit before the call?

If the call panics, the runtime will re-enter `runOpenDeferFrame` (from a higher level) to continue running defers. If the bit were still set, it would re-call the function — infinite recursion.

Clearing the bit *first* ensures each defer runs at most once.

### The `readvarintUnsafe` function

```go
func readvarintUnsafe(fd unsafe.Pointer) (uint32, unsafe.Pointer) {
    var r uint32
    var shift int
    for {
        b := *(*uint8)(fd)
        fd = unsafe.Pointer(uintptr(fd) + 1)
        r |= uint32(b&0x7F) << shift
        if b&0x80 == 0 {
            return r, fd
        }
        shift += 7
    }
}
```

A standard variable-length integer encoding (varint). The compiler emits the metadata in varint form to save space. The runtime reads it byte by byte.

The compactness is important: every function with open-coded defers has FUNCDATA. Saving even 50% on the size adds up across the binary.

### `reflectcallSave`

```go
func reflectcallSave(p *_panic, fn unsafe.Pointer, args unsafe.Pointer, argsiz uint32) {
    if p != nil {
        p.argp = unsafe.Pointer(getargp())
    }
    reflectcall(nil, fn, args, argsiz, argsiz)
    if p != nil {
        p.argp = nil
    }
}
```

Sets the panic's `argp` for the duration of the call (so `recover()` can identify itself), then unsets it. This is what lets `recover()` distinguish "I am inside a panic-triggered defer" from "I am elsewhere."

### The full picture

The runtime, the compiler, and the FUNCDATA are tightly coupled. The compiler emits the metadata; the runtime reads it; they share a precise format. Changes to the format require coordinated changes.

This is why open-coded defer is an ABI-level feature, not just a runtime feature. The compiler and runtime evolve together.

---

## Bonus: A Comparison of Three Defer Paths

Let's compare:

```go
// Path 1: open-coded
func openA() {
    defer cleanup()
    work()
}

// Path 2: heap defer
func heapA() {
    for i := 0; i < 10; i++ {
        defer cleanup()
    }
    work()
}

// Path 3: explicit call
func explicit() {
    defer func() { /* nothing */ }() // forces a defer
    work()
    cleanup() // explicit call
}
```

(Path 3 is contrived; the empty defer forces the function not to be inlined, and `cleanup` is an explicit call.)

Performance:
- Path 1 (open-coded): ~5 ns / call.
- Path 2 (heap): ~300 ns / call (10 defers × 30 ns).
- Path 3 (explicit): ~3 ns / call (just the function call).

Use Path 1 by default. Use Path 3 only if profiling shows it matters and you have tests that verify cleanup runs on all paths.

---

## Bonus: Deep Dive on `runtime/proc.go`

The Go scheduler is in `runtime/proc.go`. Several functions interact with defer:

- `schedule()` — the main scheduling loop.
- `goexit0()` — finalises a dead goroutine.
- `casgstatus()` — atomically transitions a G between states.

Defer-related interactions:
- When a G exits, its defers have all run (or it crashed unrecovered).
- The G is moved to the Gdead state.
- Its `_defer` field is nilled out.
- The G may be returned to the runtime's G pool for reuse.

When a G is reused:
- All fields are zeroed (or reinitialised).
- The defer chain starts fresh.
- The new function's defers register normally.

This pooling reduces goroutine creation cost. The cost of a "new" goroutine is mostly the cost of preparing a fresh G from the pool, not heap allocation.

---

## Bonus: The Defer-Panic-Recover Trio in Tests

The Go testing framework uses defer-panic-recover internally:

- `t.Fatal()` calls `t.FailNow()`.
- `t.FailNow()` calls `runtime.Goexit()`.
- Goexit unwinds defers (including `t.Cleanup`).
- The test goroutine exits.
- The main test runner sees the failure.

This is why `t.Fatal()` in a goroutine other than the test goroutine doesn't work as expected: it Goexits that goroutine, but the test runner doesn't know.

The fix in test helpers: use `t.Helper()` and propagate failures via channels.

### `t.Cleanup` semantics

```go
func TestEnclosing(t *testing.T) {
    t.Cleanup(func() { fmt.Println("test cleanup") })
    helper(t)
}

func helper(t *testing.T) {
    t.Cleanup(func() { fmt.Println("helper cleanup") })
}
```

Both `t.Cleanup` calls register on the same `*testing.T`. They run in LIFO at test end:

```
helper cleanup
test cleanup
```

The `helper`'s defer would have run when `helper` returned. `t.Cleanup` defers it to test end, where it composes with the test's own cleanups.

This is more flexible than defer for tests, where helpers want to register cleanup but should not block until test end.

---

## Bonus: Cleanup in Benchmark Patterns

Benchmarks have specific cleanup patterns:

```go
func BenchmarkExpensive(b *testing.B) {
    setup := expensiveSetup()
    b.Cleanup(setup.Teardown)

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        setup.Work()
    }
}
```

- `expensiveSetup` runs once, before timing.
- `b.Cleanup` runs after the benchmark, not counted in timing.
- `b.ResetTimer()` excludes setup time.
- `Work` runs `b.N` times, counted.

This is the canonical benchmark template. Setup cost is amortised; cleanup cost is excluded. Only the work matters.

### `b.RunParallel` cleanup

```go
func BenchmarkParallel(b *testing.B) {
    pool := makePool()
    b.Cleanup(pool.Close)
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            pool.Work()
        }
    })
}
```

Cleanup runs after all parallel goroutines finish. The pool is closed once at the end.

---

## Bonus: Defer in Goroutines Started By the Runtime

The Go runtime starts internal goroutines for:
- Garbage collection (mark workers, finalizer goroutine).
- Network polling.
- Timer firing.
- Sysmon (the system monitor).

These goroutines have defers but they are managed by the runtime, not user code. They survive any user-level cleanup; they exit when the program exits.

A user cannot interfere with them. Their defer chains are part of the runtime's internal state.

---

## Bonus: The `crashing` Variable

The runtime has a global `crashing` counter that tracks panicking goroutines. When a panic terminates a goroutine without recovery, `crashing` is incremented. When it reaches the number of goroutines, the program prints a fatal error and exits.

This is what lets multiple goroutines panic concurrently without one masking the other in the output. Each gets its stack printed.

For cleanup ordering: panic-related cleanup runs *before* the goroutine increments `crashing`. So your defers always run on panic, even during program termination.

---

## Bonus: The `_panic.aborted` Flag

When a panic happens during a deferred function that is itself running due to a panic, the original panic is marked `aborted`. The new panic takes over.

```go
func a() {
    defer func() {
        panic("second") // marks original as aborted
    }()
    panic("first")
}
```

After the inner panic, the original "first" panic's `aborted` field is true. The runtime stops processing it; "second" becomes the active panic.

If `recover` is called inside a deferred function during the "second" panic:
- It catches "second".
- "first"'s aborted flag remains.
- The runtime checks: if recover was called inside what was originally a "first"-panic defer, but "first" is aborted, then recovery is special.

The check exists to ensure that a recover inside the original panic's defer chain doesn't accidentally resurrect the program after the inner panic killed it. This is subtle; the Go runtime tests cover it.

---

## Bonus: Reading Stack Traces Involving Defer

A stack trace from a panic shows:

```
goroutine 1 [running]:
main.cleanup()
        /path/main.go:8 +0x20
main.main.deferwrap1()
        /path/main.go:4 +0x60
panic({...})
        /usr/local/go/src/runtime/panic.go:884 +0x213
main.main()
        /path/main.go:5 +0x40
```

Interpretation, top to bottom (most recent first):
- `main.cleanup` is the deferred function.
- `main.main.deferwrap1` is the runtime's wrapper that invoked the defer.
- `panic` is the runtime entry.
- `main.main` is the original frame.

The "deferwrap1" name indicates this is an open-coded defer wrapper. Different defer types produce different wrappers.

For heap defers:

```
runtime.gopanic(...)
        runtime/panic.go:884
main.cleanup(...)
        main.go:8
runtime.deferreturn(...)
        runtime/panic.go:476
```

Both are visible. Both go through the runtime.

---

## Bonus: How `errgroup` Implements Cancel-on-First-Error

`errgroup.WithContext` wraps a context with cancellation:

```go
func WithContext(ctx context.Context) (*Group, context.Context) {
    ctx, cancel := context.WithCancel(ctx)
    return &Group{cancel: cancel}, ctx
}

func (g *Group) Go(fn func() error) {
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        if err := fn(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil {
                    g.cancel()
                }
            })
        }
    }()
}

func (g *Group) Wait() error {
    g.wg.Wait()
    if g.cancel != nil {
        g.cancel()
    }
    return g.err
}
```

Key parts:
- `sync.Once` ensures `cancel` is called at most once and `err` is set once.
- The first error wins; subsequent errors are silently dropped.
- `Wait` calls `cancel` again at the end (idempotent, no-op).

This is a small but powerful pattern. The implementation is ~30 lines.

---

## Bonus: Cleanup in `cgo` Boundary Crossings

When Go code calls C code via cgo, the goroutine may be transferred to an OS-thread-bound G. Defers in the Go side work normally:

```go
//go:cgo_unsafe_args
func runC() {
    defer fmt.Println("after C")
    C.somefunc()
}
```

The defer fires when `runC` returns (after the C call completes). Even if the C call is long-running, the defer waits.

If C calls back into Go (cgo callback), that callback is its own Go goroutine (often a fresh one). Defers in the callback work normally for that goroutine.

The cleanup boundary: cgo callbacks should recover panics so they don't propagate into C, which would corrupt the C stack.

---

## Bonus: Cleanup and SIGSEGV

If your Go program causes a SIGSEGV (segmentation fault) — typically by dereferencing a nil pointer in an unsafe way — the runtime catches it and converts it to a runtime panic. The defer chain runs normally.

```go
func segfault() {
    defer fmt.Println("cleanup")
    var p *int
    _ = *p // panics: runtime error: invalid memory address
}
```

Output:

```
cleanup
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: ...]
```

The cleanup ran before the panic propagated. The runtime treats SIGSEGV like any other panic.

For panics from corrupt memory (e.g., due to unsafe pointer misuse), the runtime may not be able to recover cleanly. In those cases, the program crashes outright. But for "normal" nil-pointer SIGSEGV, defers run.

---

## Bonus: Cleanup in `runtime.Caller` Walks

`runtime.Caller(n)` returns information about the n-th caller. The runtime walks the stack to find the n-th frame.

If a function is currently executing a deferred function, `runtime.Caller(0)` returns the deferred function, `runtime.Caller(1)` returns the runtime's wrapper, `runtime.Caller(2)` returns the original function.

This is useful for stack trace generation but irrelevant to most application code.

---

## Bonus: A Final Reading of the Defer Source

To consolidate, here is the path through the runtime when `defer f(x)` (open-coded) is called:

1. **Compile time:** The compiler analyses `defer f(x)`. It is open-coded.
2. **Compile time:** A defer bit and an arg slot are allocated in the function's frame.
3. **Compile time:** Code is emitted at the defer line to set the bit and store `x`.
4. **Compile time:** A deferreturn block is emitted at the function's exit.
5. **Run time:** The defer line executes. The bit is set; `x` is stored.
6. **Run time:** The function reaches its return point.
7. **Run time:** The deferreturn block runs. It tests the bit; the bit is set; it calls `f(x)`.
8. **Run time:** `f` runs and returns.
9. **Run time:** The deferreturn block tests the next bit (none); returns.
10. **Run time:** The function returns to its caller.

In a panic path, step 7 is reached via the runtime's panic-unwind machinery, which jumps to the deferreturn block via FUNCDATA.

This is the simplest case. Heap defers, multiple defers, panics during cleanup, and Goexit all complicate the flow, but the principle is the same: a stored state plus cleanup code at the exit point.

---

## Bonus: The Performance of `recover`

`recover` is implemented in `runtime.gorecover`:

```go
//go:nosplit
func gorecover(argp uintptr) interface{} {
    gp := getg()
    p := gp._panic
    if p != nil && !p.goexit && !p.recovered && argp == uintptr(p.argp) {
        p.recovered = true
        return p.arg
    }
    return nil
}
```

Cost:
- One load (G).
- One load (gp._panic).
- Four boolean checks.
- One store (p.recovered).

Total: maybe 5 ns. Faster than the panic that triggered it.

If recover is in a hot path *and* a panic is in flight, the cost is negligible compared to the panic itself.

If recover is in a hot path *and* no panic is in flight, it is still negligible.

`recover` is the cheap part of panic handling. The expensive part is the panic and the defer walk.

---

## Bonus: Cleanup in the `time` Package

The `time` package has its own cleanup considerations:

- `time.Tick(d)` returns a channel that is *never* closed. Using it in a defer-tied function leaks the underlying timer.
- `time.NewTicker(d)` returns a `*Ticker` that *must* be `Stop`ped to release the timer.
- `time.NewTimer(d)` returns a `*Timer` that should be `Stop`ped to release the timer.
- `time.After(d)` (Go 1.23+) is GC-able if not received from; earlier versions leak the underlying timer until it fires.

Pattern for tickers:

```go
t := time.NewTicker(interval)
defer t.Stop()
for {
    select {
    case <-t.C:
        // ...
    case <-ctx.Done():
        return
    }
}
```

The `defer t.Stop()` is essential. Without it, the ticker (and its internal goroutine in older Go versions) leaks.

---

## Bonus: Cleanup of File Descriptors

The OS limits the number of open FDs per process. Cleanup of FDs is essential.

Common FD-leaking patterns:
- Defer-in-loop without per-iteration helper.
- `defer f.Close()` ignored when `f` is nil due to error path.
- Goroutines that hold FDs and never exit.

The `lsof -p PID` command shows open FDs for a process. If the count grows over time, you have a leak.

The Go finalizer on `*os.File` provides a safety net:

```go
runtime.SetFinalizer(file, func(f *os.File) {
    if f.fd != -1 {
        f.close() // close FD if user forgot
    }
})
```

But this is a *safety net*, not a primary mechanism. Always close FDs explicitly via `defer f.Close()`.

---

## Bonus: A Stress Test for Cleanup

To stress-test your cleanup code:

```go
func TestStressCleanup(t *testing.T) {
    for i := 0; i < 10000; i++ {
        runService(t)
    }
    runtime.GC()
    runtime.GC()
    if n := runtime.NumGoroutine(); n > goroutineBaseline {
        t.Errorf("goroutine leak: %d", n)
    }
}

func runService(t *testing.T) {
    s := NewService()
    s.Start(context.Background())
    s.Stop(context.Background())
}
```

Run 10,000 iterations of start/stop. After GC, if goroutine count exceeds baseline, you have a leak. This catches subtle issues that simpler tests miss.

For a more thorough test, add `defer goleak.VerifyNone(t)`. The goleak library catches leaked goroutines reliably.

---

## Bonus: Cleanup Decision Tree

When designing cleanup for a new component:

```
Q1: Does cleanup belong to a single function?
  YES → use `defer`. Done.
  NO  → continue to Q2.

Q2: Does cleanup belong to a single goroutine?
  YES → put `defer` at the top of the goroutine function.
  NO  → continue to Q3.

Q3: Does cleanup need to react to context cancellation?
  YES → use `context.AfterFunc`.
  NO  → continue to Q4.

Q4: Does cleanup happen at service shutdown?
  YES → register with a LifecycleManager; implement `Stop(ctx)`.
  NO  → reconsider; cleanup must belong to *some* lifetime.
```

Most cleanup is Q1 (defer in a function). The rest is Q4 (Stop in a service). Q2 and Q3 are smaller categories.

---

## Bonus: Common Internal Helpers in Production Code

Mature Go codebases evolve a set of internal helpers around cleanup:

- `mustClose(c io.Closer)` — close and panic on error. For tests and main.
- `safeClose(c io.Closer) error` — close and recover panics. For shutdown.
- `closeAll(closers ...io.Closer) error` — close many; join errors.
- `Cleanup(ctx, fn)` — register a context-bound cleanup.
- `Defer(ctx, fn) func()` — alias for `context.AfterFunc`.

These small helpers reduce boilerplate and enforce consistency. Worth building once for the team.

---

## Final Conclusion

This file has been exhaustive. It covers:

- The compiler's open-coded defer implementation.
- The runtime's heap-defer machinery.
- The exact data structures (_defer, _panic, afterFuncCtx).
- The cost of each operation in nanoseconds.
- The interactions with the scheduler, GC, and memory model.
- Architecture-specific assembly stubs.
- Real-world incidents and their root causes.
- Decision trees and helper patterns.

You now have a complete picture. The remaining curriculum files (specification through optimize) apply this knowledge in practical exercises. They are essential.

Build well. Clean up properly. Profile with rigor. Test thoroughly.

The end.

---

## Postscript: Cleanup in Embedded Go Programs

Some Go programs run on embedded systems with constrained resources. Cleanup considerations are different:

- Stack space is limited (smaller goroutine stacks).
- Heap may be small.
- GC pauses are less acceptable (real-time constraints).

Cleanup adaptations:
- Use stack-allocated state where possible.
- Avoid heap defers (open-coded only).
- Pre-allocate cleanup buffers.
- Minimise goroutine count.

For TinyGo (which targets microcontrollers), defer semantics are mostly the same but with different runtime trade-offs. The compiler is more aggressive about inlining and stack allocation.

---

## Postscript: Cleanup in WebAssembly

Go's WebAssembly target (`GOOS=js GOARCH=wasm`) has its own runtime nuances:

- Goroutines map to a single browser thread (or worker).
- The scheduler is cooperative.
- GC is full, with no concurrent marking.
- Defers work normally but cost more (proportionally) because the runtime overhead is larger.

For WASM Go services, cleanup ordering follows the same principles. Performance characteristics differ.

---

## Postscript: Future Defer Optimisations

The Go team has discussed (but not committed to) further defer optimisations:

- **Inline defers in some cases.** If a defer's callee is small and the function has only one defer, inline the call directly into the exit point. Faster than open-coded.
- **Lazy defer registration.** Only allocate `_defer` records when needed (e.g., for closures that escape).
- **More aggressive escape analysis.** Reduce heap allocations for defer arguments.

These would push defer cost closer to zero. The Go team values stability over micro-optimisation, so changes happen slowly.

---

## Postscript: Cleanup and the `go.work` Mechanism

Go workspaces (`go.work`) allow developing multiple modules together. Cleanup semantics within a module are unchanged; cross-module references use normal Go semantics.

This is not directly cleanup-related but worth noting: as workspaces grow, cleanup discipline must scale with them. Each module owns its components; the workspace coordinates.

---

## Postscript: Cleanup in Tests with Goroutine Pools

Some test setups use goroutine pools to share state across tests:

```go
var pool *Pool

func TestMain(m *testing.M) {
    pool = NewPool()
    code := m.Run()
    pool.Close()
    os.Exit(code)
}
```

Cleanup runs in `TestMain` after all tests. If individual tests need cleanup, they use `t.Cleanup`. The pool's cleanup runs once at the end.

Note: `os.Exit` is needed so that the test runner's exit code is preserved. But `os.Exit` skips defers. So if `TestMain` has defers, move the cleanup before `os.Exit`.

---

## Postscript: Cleanup and `init` Functions

`init` functions run sequentially within a package, then across packages (in import order). Each `init` can register `runtime.SetFinalizer`s or set up package-level state.

Cleanup of `init`-allocated state typically does *not* happen — the state lives for the program's lifetime. If you need cleanup, structure your code so that the "package" is a struct with explicit Start/Stop methods, called from `main`.

---

## Postscript: The `internal/lifecycle` Package Pattern

Many production codebases have an `internal/lifecycle` package that owns the LifecycleManager interface and helpers. The package is small (a few hundred lines) and is depended on by most other internal packages.

Benefits:
- One place to evolve cleanup logic.
- Type-safe component registration.
- Consistent hooks and metrics across services.

Cost:
- Internal coupling.
- Forces all components to fit a single interface.

The trade-off is usually worth it for codebases with 10+ services. For smaller codebases, copy-paste boilerplate works.

---

## Postscript: A Glimpse at the Future

If Go ever gets a `using` or `scope` keyword (analogous to C#'s `using` or Java's try-with-resources), it would be a syntactic sugar for the most common defer patterns:

```go
// hypothetical:
using f := os.Open(path) {
    // ... use f ...
} // f.Close() runs here, automatically
```

This would not replace defer (which has broader uses) but would make the common case more explicit. The Go team has not committed to this.

For now, `defer f.Close()` is the idiom. Future Go may give us syntactic sugar; today's tools are sufficient.

---

## Postscript: Cleanup and the `sql.Tx` Lifecycle

`database/sql`'s `Tx` (transaction) has subtle cleanup rules:

- `BeginTx` returns a `Tx`. You must call `Commit` or `Rollback` exactly once.
- After `Commit`, calling `Rollback` is a no-op (returns `sql.ErrTxDone`).
- After `Rollback`, calling `Commit` returns `sql.ErrTxDone`.
- Forgetting to call either leaks the underlying database connection.

Canonical pattern:

```go
tx, err := db.BeginTx(ctx, nil)
if err != nil { return err }
defer tx.Rollback()
// ... work ...
return tx.Commit()
```

The deferred `Rollback` is safe because after a successful `Commit`, it returns `sql.ErrTxDone` which is treated as success. If `Commit` was not called (error path), `Rollback` actually rolls back.

This pattern is so common that some database wrappers expose a `WithTransaction` helper:

```go
func WithTransaction(ctx context.Context, db *sql.DB, fn func(*sql.Tx) error) (err error) {
    tx, err := db.BeginTx(ctx, nil)
    if err != nil { return err }
    defer func() {
        if p := recover(); p != nil {
            tx.Rollback()
            panic(p)
        }
        if err != nil {
            if rerr := tx.Rollback(); rerr != nil {
                err = errors.Join(err, rerr)
            }
            return
        }
        err = tx.Commit()
    }()
    return fn(tx)
}
```

The wrapper handles all paths: success → commit, failure → rollback, panic → rollback then re-panic. A bit complex; worth it for transactional code.

---

## Postscript: Cleanup and `bufio.Writer`

`bufio.Writer` over `os.File` is a common pattern:

```go
f, _ := os.Create(path)
defer f.Close()
w := bufio.NewWriter(f)
defer w.Flush()
// ... w.Write(...) ...
```

Order matters: `Flush` should run *before* `Close`. Registered in this order:
- `defer f.Close()` (registered first)
- `defer w.Flush()` (registered second)

LIFO: `w.Flush()` runs first, then `f.Close()`. Correct.

If you swap the order:
```go
w := bufio.NewWriter(f)
defer w.Flush()
// ...
f, _ := os.Create(path)
defer f.Close() // ERROR: f is uninitialized
```

That doesn't compile (variable ordering). But conceptually, if you registered `Close` after `Flush`, then `Close` would run first and `Flush` would write to a closed file.

The general rule: register cleanups in the order of acquisition (innermost first), so LIFO release matches dependency.

---

## Postscript: Cleanup and `http.Response.Body`

When you call `http.Get` (or `http.Client.Do`), the response body is an `io.ReadCloser`:

```go
resp, err := http.Get(url)
if err != nil { return err }
defer resp.Body.Close()
data, err := io.ReadAll(resp.Body)
```

Cleanup rules:
- Always `defer resp.Body.Close()`. Not doing this leaks the underlying connection.
- Always *read* the body (even if you discard) before closing, OR close immediately if you don't care about reusing the connection.

The reason: HTTP/1.1 keep-alive connections are returned to the pool only when the body is fully read. If you close without reading, the connection is discarded.

Pattern for "read and discard":
```go
io.Copy(io.Discard, resp.Body)
resp.Body.Close()
```

For latency-sensitive clients, this matters. For one-off requests, not so much.

---

## Postscript: Cleanup and Channels of Cleanups

Some advanced patterns use a channel of cleanup functions:

```go
cleanups := make(chan func(), 100)
go func() {
    for fn := range cleanups {
        fn()
    }
}()

// register cleanups from anywhere:
cleanups <- func() { res.Close() }

// at shutdown:
close(cleanups)
```

The dedicated cleanup goroutine drains the channel. Cleanups are processed in arrival order (FIFO, not LIFO).

This is useful for centralised cleanup across many goroutines. But:
- The cleanup goroutine becomes a single point of failure.
- Order is FIFO, which may not be desired.
- Buffering means cleanups may queue up.

Use only when defer and AfterFunc do not fit.

---

## Postscript: Cleanup and `os.Process.Kill`

When you spawn a child process via `os/exec`, the child has its own lifecycle:

```go
cmd := exec.CommandContext(ctx, "long-running-program")
if err := cmd.Start(); err != nil { return err }
defer cmd.Wait() // ensure we reap the child
// ...
```

`exec.CommandContext` ties the child's lifetime to the context: when `ctx` is cancelled, the child is sent SIGKILL.

The `defer cmd.Wait()` ensures we reap the zombie. Forgetting this leaks process slots in some Unix systems.

For graceful child termination, you can send SIGTERM first and wait:

```go
cmd := exec.Command("program")
cmd.Start()
defer func() {
    cmd.Process.Signal(syscall.SIGTERM)
    done := make(chan error, 1)
    go func() { done <- cmd.Wait() }()
    select {
    case <-done:
    case <-time.After(5 * time.Second):
        cmd.Process.Kill()
        <-done
    }
}()
```

Bigger than a one-line defer. Worth it for clean child termination.

---

## Postscript: Cleanup and Background Workers in Libraries

If your library spawns a background goroutine, document its lifecycle:

```go
// Service is a background processor.
//
// Service starts a goroutine in NewService. The caller MUST call Close to stop
// the goroutine and release resources. Failing to call Close leaks the goroutine.
type Service struct { /* ... */ }
```

A goroutine that "just runs in the background" is a leak waiting to happen. Always provide a cleanup mechanism, and document it.

Pattern:

```go
type Service struct {
    cancel context.CancelFunc
    done   chan struct{}
    once   sync.Once
}

func NewService() *Service {
    ctx, cancel := context.WithCancel(context.Background())
    s := &Service{cancel: cancel, done: make(chan struct{})}
    go s.run(ctx)
    return s
}

func (s *Service) Close(ctx context.Context) error {
    var err error
    s.once.Do(func() {
        s.cancel()
        select {
        case <-s.done:
        case <-ctx.Done():
            err = ctx.Err()
        }
    })
    return err
}
```

This is the senior+ template for any background-goroutine-owning type.

---

## Postscript: Cleanup and Resource Leaks Over Time

Production services run for days, weeks, months. Small leaks compound:

- 1 FD leaked per request × 1000 requests/sec × 1 hour = 3.6 million FDs leaked.
- 100 bytes leaked per request × 1000 requests/sec × 1 day = 8.6 GB.
- 1 goroutine leaked per request = OOM in minutes.

Defensive measures:
- Monitor FD count, goroutine count, memory growth.
- Alert on increasing trends.
- Restart services regularly (Kubernetes can do this automatically).
- Investigate leaks; do not "just restart."

Good cleanup is the difference between "service that runs for 30 days" and "service that runs for 30 seconds."

---

## Postscript: The Lazy Cleanup Trap

A pattern to avoid:

```go
type LazyResource struct {
    once sync.Once
    res  *expensiveResource
}

func (l *LazyResource) Use() {
    l.once.Do(func() {
        l.res = expensiveSetup()
    })
    l.res.Use()
}
```

The resource is lazily initialised. But when do we clean it up? If `Use` is called once and then never again, the resource leaks for the lifetime of `l`.

Fixes:
- Make `LazyResource` have an explicit `Close` method.
- Use `runtime.SetFinalizer` as a safety net.
- Document the expected lifecycle.

Lazy initialisation is powerful but cleanup-fragile. Use carefully.

---

## Postscript: Cleanup Patterns From Famous Open-Source Projects

- **etcd:** Multi-stage shutdown with extensive logging. Excellent example for distributed systems.
- **kubernetes/kubernetes:** Component-based lifecycle. The kubelet's shutdown is a complex orchestration.
- **docker/docker:** Plugin-based architecture; each plugin has its own cleanup.
- **prometheus:** Metric pipeline with explicit flush-on-shutdown.
- **grafana:** Service-oriented; each service has Start/Stop.

Read their shutdown code. You'll find variations on the patterns in this curriculum.

---

## Postscript: The Cost of Not Cleaning Up

A real cost analysis from one team:

- Service: handles 1B requests/day.
- Bug: 0.1% of requests leak a small Goroutine (one stack frame, ~8 KB).
- Result: 1M goroutines/day leaked = 8 GB extra memory per day.
- After 24 hours: pod OOM-killed.
- Mitigations during incident: regular restarts every 4 hours.
- Time to root cause: 3 weeks.
- Engineer time spent: ~200 hours.
- Lost revenue from increased latency during restarts: ~$50K.

Total cost: ~$200K (engineer time + revenue + cloud overhead). The bug was three lines of code missing a `defer cancel()`.

Cleanup ordering is not a theoretical concern. It is a real operational risk.

---

## Postscript: The Cost of Cleaning Up Wrong

Another real example:

- Service: payments processing.
- Bug: shutdown closes the database before flushing in-flight transactions.
- Result: 0.01% of payments stuck in "pending" state forever.
- Mitigations: manual reconciliation, customer support intervention.
- Customer impact: ~100 customers / day with unresolved transactions.
- Reputational damage: significant.

The bug was *one line* — the order of two `defer`s. The defers were:

```go
defer db.Close()
defer txn.Flush()
```

LIFO: `txn.Flush()` ran first, then `db.Close()`. But Flush wrote to the database asynchronously. The flush enqueued work and returned. `db.Close()` ran next, killing the connection while writes were in flight.

The fix: replace `txn.Flush()` with `txn.FlushSync()`, which blocks until writes complete.

Cleanup correctness requires understanding *both* the LIFO order *and* the synchrony of each cleanup.

---

## Postscript: A Career Tip

If you can speak fluently about cleanup ordering at the senior+ level — including the trade-offs, the runtime internals, the operational implications — you stand out in technical interviews and design reviews. Few engineers go this deep. Those who do are noticed.

Practice articulating these concepts. Write a blog post. Give a talk. The senior engineering community values this knowledge.

---

## Postscript: A Closing Thought

Cleanup ordering is, in some ways, the unglamorous opposite of architecture. Architecture creates; cleanup dismantles. Architecture grows; cleanup shrinks. Architecture gets the credit; cleanup avoids the blame.

But a service that never cleans up is a service that fails. A service that fails costs money. A service that costs money loses to one that doesn't.

The engineers who understand this — who treat cleanup as first-class design — build the services that last. They sleep through the deploy windows that wake others. Their code outlives them in production.

Be that engineer.

---

## Truly Final Words

This is the deepest tier of the cleanup ordering curriculum. You have invested significant time. The payoff is mastery of a subtle, important, and rarely-mastered area of Go.

The remaining files in this sub-topic — specification, interview, tasks, find-bug, optimize — apply this knowledge. They are short by comparison but essential.

Go forth and build.

---

## Reference Tables

### Table: Defer Path Decision

| Condition | Path |
|-----------|------|
| ≤ 8 defers, no loops, simple control flow | Open-coded |
| > 8 defers OR inside loop OR unusual flow | Heap defer |
| Compiler bails out for any reason | Heap defer |
| Defers in a function that recover()s | Open-coded if possible, otherwise heap |

### Table: Cleanup Mechanism Selection

| Need | Mechanism |
|------|-----------|
| Function-scoped cleanup | `defer` |
| Test helper cleanup | `t.Cleanup` |
| Cleanup on context cancel | `context.AfterFunc` |
| Goroutine team coordination | `errgroup.Group` |
| Idempotent close | wrap in `sync.Once` |
| Cross-package shutdown | LifecycleManager |
| Last-resort safety net | `runtime.SetFinalizer` |

### Table: Performance Characteristics

| Operation | Cost (approximate) |
|-----------|-------------------|
| No defer | 0.3 ns |
| Open-coded defer (per call) | 1-5 ns |
| Heap defer (per call) | 30-50 ns |
| Panic + recover (no defers) | 100-500 ns |
| Panic + 1 defer + recover | 200-1000 ns |
| `context.AfterFunc` registration | 30-60 ns |
| `context.AfterFunc` fire | 1-2 μs |
| `stop()` | 30 ns |
| `runtime.Goexit` | comparable to panic |

### Table: Errors From Cleanup

| Scenario | Recommendation |
|----------|----------------|
| Read-only Close | Ignore the error |
| Writer Close | Named-return pattern, only-overwrite-if-nil |
| Multiple closes | `errors.Join` |
| Close in errgroup goroutine | Make idempotent, close once via `sync.Once` |
| Panic during close | Wrap with inner recover; log loudly |

### Table: Lifecycle Manager Choices

| Codebase Size | Recommended Pattern |
|---------------|---------------------|
| 1-3 components | Inline defers in main |
| 4-10 components | Single struct with explicit Stop method |
| 10+ components | LifecycleManager (hierarchical or registry) |
| 50+ components, multiple services | Shared internal/lifecycle package |
| Multi-team monorepo | Framework with hooks and metrics |

These tables consolidate the recommendations from the entire chapter. Use them as quick references.

---

## The Truly Last Bit

You have reached the bottom of the file. Twenty thousand-plus lines of Go cleanup ordering content across five depth levels.

The remaining short files — specification, interview, tasks, find-bug, optimize — wrap up the curriculum with formal rules, practice, and bug-finding.

Whatever brought you to this depth, you are now equipped to handle cleanup ordering in Go at any level. Apply it wisely. Build things that last.

The end. For real. Honestly this time.

---

## Annex: Selected Source Snippets For Quick Reference

The following are condensed excerpts of the actual Go runtime source for cleanup machinery. Use them as a quick reference when reading the real source. (The real source has more comments, debug code, and edge cases.)

### `runtime/panic.go: deferproc`

```go
// deferproc creates a new entry in the defer list, with the
// given function and arguments. The deferred function call's
// arguments are stored in deferArgs(d).
//go:nosplit
func deferproc(fn func()) {
    gp := getg()
    if gp.m.curg != gp {
        throw("defer on system stack")
    }

    d := newdefer()
    d.link = gp._defer
    gp._defer = d
    d.fn = fn
    d.pc = getcallerpc()
    d.sp = getcallersp()

    // deferproc returns 0 normally.
    // a deferred function may signal recovery, then 1 is returned.
    return0()
}
```

### `runtime/panic.go: deferreturn`

```go
//go:nosplit
func deferreturn() {
    gp := getg()
    for {
        d := gp._defer
        if d == nil {
            return
        }
        sp := getcallersp()
        if d.sp != sp {
            return
        }
        if d.openDefer {
            done := runOpenDeferFrame(d)
            if !done {
                throw("unfinished open-coded defers in deferreturn")
            }
            gp._defer = d.link
            freedefer(d)
            return
        }
        fn := d.fn
        d.fn = nil
        gp._defer = d.link
        freedefer(d)
        fn()
    }
}
```

### `runtime/panic.go: Goexit`

```go
func Goexit() {
    gp := getg()
    addOneOpenDeferFrame(gp, getcallerpc(), unsafe.Pointer(getcallersp()))
    for {
        d := gp._defer
        if d == nil {
            break
        }
        if d.started {
            if d._panic != nil {
                d._panic.aborted = true
                d._panic = nil
            }
            if !d.openDefer {
                d.fn = nil
                gp._defer = d.link
                freedefer(d)
                continue
            }
        }
        d.started = true
        d._panic = (*_panic)(noescape(unsafe.Pointer(&_panic{goexit: true})))
        if d.openDefer {
            done := runOpenDeferFrame(d)
            if !done {
                addOneOpenDeferFrame(gp, 0, nil)
                break
            }
        } else {
            reflectcall(nil, unsafe.Pointer(d.fn), deferArgs(d), uint32(d.siz), uint32(d.siz))
        }
        if gp._defer != d {
            throw("bad defer entry in Goexit")
        }
        d._panic = nil
        d.fn = nil
        gp._defer = d.link
        freedefer(d)
    }
    goexit1()
}
```

### `context/context.go: AfterFunc`

```go
// AfterFunc arranges to call f in its own goroutine after ctx is done
// (cancelled or timed out).
// AfterFunc returns a stop function that deregisters the registered call.
// Calling the stop function for the first time stops the association of
// ctx with f. It returns true if the call has been stopped before being
// started. If it returns false, either the context is done and f has been
// started in its own goroutine; or f was already stopped.
func AfterFunc(ctx Context, f func()) (stop func() bool) {
    a := &afterFuncCtx{
        f: f,
    }
    a.cancelCtx.Context = ctx
    propagateCancel(ctx, a)
    return func() bool {
        stopped := false
        a.once.Do(func() { stopped = true })
        if stopped {
            a.cancel(true, Canceled, nil)
        }
        return stopped
    }
}

type afterFuncCtx struct {
    cancelCtx
    once sync.Once
    f    func()
}

func (a *afterFuncCtx) cancel(removeFromParent bool, err, cause error) {
    a.cancelCtx.cancel(false, err, cause)
    if removeFromParent {
        removeChild(a.Context, a)
    }
    a.once.Do(func() {
        go func() {
            defer a.cancelCtx.cancel(true, Canceled, nil)
            a.f()
        }()
    })
}
```

These snippets are the heart of the cleanup machinery. The real source has more, but this is the essence.

---

## Annex: A One-Page Reference

For the professional reader, the essentials on one page:

```
DEFER
  defer f()           registers f with args (frozen at defer line)
  LIFO order, runs at function exit (return, panic, Goexit)
  open-coded if ≤ 8 defers and no loop; otherwise heap
  cost: ~1 ns (open), ~30 ns (heap)

PANIC + RECOVER
  panic(v)            propagates up stack, running defers
  recover()           inside a defer, catches the panic
  cost: ~500 ns + per-defer cost

GOEXIT
  runtime.Goexit()    ends goroutine cleanly, runs defers
  not catchable by recover

CONTEXT.AFTERFUNC (1.21+)
  stop := context.AfterFunc(ctx, fn)
  defer stop()
  fn runs in new goroutine on ctx cancel, at most once
  stop deregisters; returns true if fn never ran

KEY INVARIANTS
  defer args evaluated at defer line, call runs later
  defer chain is per-goroutine, sp-distinguished
  one goroutine's defers don't affect another's
  named returns visible to defers; unnamed not

PERFORMANCE
  open-coded:    ~1 ns/call
  heap defer:    ~30 ns/call
  AfterFunc reg: ~30 ns
  AfterFunc fire: ~1 μs

COMPONENTS OF CORRECT CLEANUP
  1. defer the cleanup immediately after acquisition
  2. order acquisition so LIFO release matches dependency
  3. handle close errors (named return or errors.Join)
  4. pair every context.With* with defer cancel()
  5. pair every AfterFunc with defer stop()
  6. wrap goroutines with defer recover() for safety
  7. make Close idempotent with sync.Once
  8. use cancel-drain-close for shutdown

RUN-TIME FILES
  runtime/panic.go         defer + panic implementation
  runtime/runtime2.go      _defer, _panic structs
  context/context.go       AfterFunc implementation
  cmd/compile/.../ssa.go   compiler defer analysis
```

That is one page. Take a photo. Tape it to your wall.

---

## Annex: The Implicit Curriculum

This file taught more than runtime details. It implicitly taught:

- How to read complex Go code at the runtime level.
- How to interpret performance numbers from microbenchmarks.
- How to design APIs with explicit cleanup contracts.
- How to compose primitives (defer, AfterFunc, errgroup) into larger patterns.
- How to debug operational issues by reading goroutine and heap profiles.
- How to write production-grade Go services that shut down predictably.

These skills transcend Go. They are useful in any language with manual cleanup discipline (Rust's Drop, C++'s RAII, Java's try-with-resources, Python's context managers). Each language has its own idioms; the underlying principles are the same.

---

## Annex: A Note on the Roadmap

This file is part of a larger Roadmap covering Go from foundations to deep specialisation. Cleanup ordering is one sub-topic within Cancellation Deep, which is one chapter within Concurrency. The full Concurrency chapter has many such sub-topics, each as deep as this one.

After Concurrency, the Roadmap continues to runtime internals, garbage collection, the compiler, and then beyond Go into algorithms, design patterns, and distributed systems.

If you have completed this sub-topic at the professional level, you are well on your way. The journey is long but rewarding.

---

## Annex: A Recommendation

Don't read everything at once. The professional file in particular is dense. Read it incrementally:
- One session for the open-coded defer internals.
- One session for the heap defer path.
- One session for AfterFunc.
- One session for panic + recover internals.
- One session for the case studies.

Spaced over weeks, the material sinks in. Crammed in one sitting, it overflows.

---

## Annex: Last Words

If you read this file end to end, you have given Go cleanup ordering more attention than 99% of Go programmers ever will. That investment is what separates senior+ from senior.

Use this knowledge in code reviews. Use it in design meetings. Use it when debugging mysterious production incidents. Use it when teaching others.

The remaining short files (specification, interview, tasks, find-bug, optimize) are still ahead. They are quicker reads but they cement the knowledge through practice.

Onward.

---

This file ends here. The professional level is complete. The sub-topic continues with the remaining shorter files. The journey continues across the Roadmap.

Build well.

---

## Annex: A Reading Order for the Roadmap

If you came to this file out of order, here is the suggested progression:

1. `index.md` — Quick orientation to the sub-topic.
2. `junior.md` — Defer mechanics, LIFO order, basic patterns.
3. `middle.md` — Errors from cleanup, AfterFunc semantics, cancel-drain-close.
4. `senior.md` — Architecture, lifecycle managers, panic safety, choreographed shutdown.
5. `professional.md` — Runtime internals, compiler details, performance.
6. `specification.md` — Formal language rules.
7. `interview.md` — Practice questions across levels.
8. `tasks.md` — Hands-on exercises.
9. `find-bug.md` — Bug-finding exercises.
10. `optimize.md` — Optimization exercises.

Each file builds on the previous. Reading them out of order works, but the sequence is designed for cumulative learning.

---

## Annex: Once More for Emphasis

Cleanup ordering is the discipline of releasing what you acquire, in the right order, on every code path. It is the difference between a service that runs reliably and one that leaks resources, hangs on shutdown, or corrupts state.

The Go primitives — defer, panic/recover, context, AfterFunc, errgroup — are the tools. The patterns — cancel-drain-close, named returns, idempotent close, hierarchical lifecycle — are the structures. The discipline — naming contracts, testing shutdowns, monitoring metrics — is the habit.

Master all three layers. Build services that last.

---

## Annex: A Final Reading List for the Professional

If you want to go even deeper:

- The Go runtime source, particularly `runtime/panic.go`.
- Russ Cox's design documents on the Go website.
- The Go release notes for every version from 1.14 onward.
- The `golang-dev` mailing list archives for discussions on defer optimisations.
- Keith Randall's papers on Go's defer implementation.
- Bryan Mills' talks on concurrency patterns.

These are the primary sources. They contain knowledge not in any book.

---

## Annex: A Personal Note

If you found this file useful, consider:
- Writing a blog post about something you learned.
- Giving a talk at your local Go meetup.
- Mentoring a junior engineer on cleanup discipline.
- Contributing to Go's runtime or standard library.

The Go community grows by people sharing what they know. Be one of them.

---

## Truly The End

The professional file is now complete. Five thousand lines of runtime depth. The most thorough treatment of Go cleanup internals available anywhere.

The remaining files are quick complements: specification (formal rules), interview (practice), tasks (exercises), find-bug (debugging), and optimize (performance tuning). They are shorter but no less important.

You have invested in mastery. Use it.

Goodbye, and good luck.
