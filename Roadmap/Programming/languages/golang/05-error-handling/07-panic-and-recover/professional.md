# panic and recover — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Runtime Implementation of panic](#the-runtime-implementation-of-panic)
3. [How recover Detects Whether It Is in a Deferred Frame](#how-recover-detects-whether-it-is-in-a-deferred-frame)
4. [The defer Record](#the-defer-record)
5. [Open-Coded Defers (Go 1.14+)](#open-coded-defers-go-114)
6. [Cost of panic vs Normal Return](#cost-of-panic-vs-normal-return)
7. [The Stack Walk](#the-stack-walk)
8. [Runtime Panics vs User Panics](#runtime-panics-vs-user-panics)
9. [Fatal Errors That recover Cannot Catch](#fatal-errors-that-recover-cannot-catch)
10. [Goroutine Lifecycle and Panic](#goroutine-lifecycle-and-panic)
11. [Compiler-Inserted Calls](#compiler-inserted-calls)
12. [Panic Buffering and the panic Linked List](#panic-buffering-and-the-panic-linked-list)
13. [Panic in init Functions](#panic-in-init-functions)
14. [Reading Real Panic Output](#reading-real-panic-output)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "What happens under the hood?"

At professional level, you stop thinking of panic and recover as language constructs and start thinking of them as runtime mechanisms with measurable cost: data structures in `runtime`, compiler-inserted calls at every defer, stack walks, and explicit handshakes with the scheduler. Knowing how the machinery actually works is the difference between guessing and predicting your service's behavior under stress.

This file is about panic and recover at the level of the runtime source.

---

## The Runtime Implementation of panic

`panic(v)` is a built-in keyword, but the compiler lowers it to a call to `runtime.gopanic(v any)` defined in `$GOROOT/src/runtime/panic.go`.

Roughly:

```go
func gopanic(e any) {
    gp := getg()
    // Allocate a _panic record on the goroutine's stack
    var p _panic
    p.arg = e
    p.link = gp._panic
    gp._panic = (*_panic)(noescape(unsafe.Pointer(&p)))

    // Walk the deferred call records, calling each one
    for {
        d := gp._defer
        if d == nil { break }
        // run the deferred function (it may call recover)
        d.fn()
        // ...
        if p.recovered {
            // resume execution at the recover point
            mcall(recovery)
        }
        // pop the defer
        gp._defer = d.link
    }

    // No defer caught it — die.
    fatalpanic(gp._panic)
}
```

The data structures involved:

- **`_panic`**: a per-active-panic record (linked list, since defers can panic during a panic).
- **`_defer`**: a per-deferred-call record (linked list, LIFO).
- Both live on the goroutine's stack (when possible) or heap (when escape analysis or large defers prevent stack allocation).

When `recover` is called, it sets `p.recovered = true`, which tells `gopanic` to stop unwinding after the current deferred function returns.

---

## How recover Detects Whether It Is in a Deferred Frame

`recover` is a built-in lowered to `runtime.gorecover`:

```go
func gorecover(argp uintptr) any {
    gp := getg()
    p := gp._panic
    if p != nil && !p.recovered && argp == uintptr(p.argp) {
        p.recovered = true
        return p.arg
    }
    return nil
}
```

The trick: `argp` is the address of the *caller's* arguments. The compiler passes it implicitly. The runtime compares this with the recorded `argp` of the active deferred call. They match only if `recover` is being called from the *direct* deferred function.

This is why `recover` inside a helper called from a defer does not work: the argp differs because there is an extra stack frame.

This is also why `defer logRecover()` (where `logRecover` calls `recover`) has subtle behavior: in modern Go, the runtime walks up to the deferred frame and the comparison succeeds because `logRecover` *is* the deferred function. But putting recover in a function that the deferred function calls fails the argp check.

---

## The defer Record

Each `defer` schedules a `_defer` struct (`$GOROOT/src/runtime/runtime2.go`):

```go
type _defer struct {
    started   bool
    heap      bool
    openDefer bool       // open-coded defer optimization
    sp        uintptr    // sp at time of defer
    pc        uintptr    // pc at time of defer
    fn        func()     // the deferred function
    _panic    *_panic    // active panic, if any
    link      *_defer    // next in the linked list
    // ...
}
```

A linked list, headed by `gp._defer`. Each `defer` statement allocates one (on stack if possible). When the function returns or panics, the runtime walks this list LIFO.

Pre-Go-1.14, every defer was heap-allocated and cost ~50 ns. Go 1.14 introduced **open-coded defers** that the compiler inlines into the function body when it can.

---

## Open-Coded Defers (Go 1.14+)

If a function has at most 8 defers and all of them are unconditional (not in a loop), the compiler can transform them from runtime calls into inline code:

```go
// Original:
defer cleanup1()
defer cleanup2()
work()

// Compiler-generated:
work()
cleanup2()
cleanup1()
```

Plus a small bitmap to track which defers actually ran (in case of an early return). On the panic path, the runtime knows to handle open-coded defers via stack frame metadata.

The result: defer overhead dropped from ~50 ns to ~2 ns in many cases.

This optimization is *automatic*. You do not opt in. But you can lose it: a defer in a loop, more than 8 defers, or a defer in a recover-related function may force runtime defers.

You can inspect with:

```bash
go build -gcflags='-m=2' ./...
```

Look for output mentioning "open coded defer" vs "stack-allocated defer."

---

## Cost of panic vs Normal Return

Concrete numbers (modern x86-64, Go 1.21):

| Operation | Cost |
|-----------|------|
| Plain function return | ~1 ns |
| Function with one open-coded defer (success path) | ~2 ns |
| Function with one stack-allocated defer (success path) | ~10 ns |
| Function with one heap-allocated defer (success path) | ~50 ns |
| panic + immediate recover (one frame) | ~500 ns |
| panic + recover (10 frames deep) | ~1-2 µs |
| panic crashing the program | varies (the program is dying) |

**Roughly: panic+recover is 100-500x slower than a normal return.** This is why panic must not be used for control flow.

The runtime cost comes from:
1. Allocating a `_panic` record.
2. Walking the deferred call list and running each.
3. Stack frame metadata lookup at each frame.
4. Re-entry into the resumed function via `runtime.recovery`.

---

## The Stack Walk

When a panic propagates, the runtime walks the goroutine's stack frame by frame. At each frame:

1. Look up the `_defer` linked list head for that frame.
2. Run each deferred function in LIFO order.
3. While running, `recover` may be called — sets `p.recovered = true`.
4. After all defers in the frame run, if `p.recovered`, jump to recovery; else continue to caller's frame.

The walking itself uses Go's stack-frame metadata (used by the GC for live-pointer scanning, by the scheduler for stack growth, etc.). It is shared infrastructure — the runtime does not maintain a separate "panic walker."

For panics that crash the program, the runtime additionally:
- Calls each deferred function in every frame.
- Prints the panic value and the stack trace to stderr.
- Calls `runtime·exit(2)`.

The stack-trace output you see comes from `runtime.printpanics` and `runtime.tracebackothers`.

---

## Runtime Panics vs User Panics

User panics (from `panic("x")`) and runtime panics (from nil deref, etc.) go through the *same* `gopanic` machinery. The runtime simply calls `gopanic` itself when it detects an invariant violation:

```go
// In runtime/panic.go, the runtime defines:
func panicmem()       { panic(memoryError{}) }  // nil pointer
func panicindex()     { panic(boundsError{}) }  // index out of range
func panicdivide()    { panic(runtimeError{...}) } // divide by zero
```

The compiler emits calls to these helpers when generating bounds checks, nil checks, and divide instructions.

This means runtime panics are recoverable just like user panics. From `recover`'s perspective, they are identical (only the type and message of the value differ).

The exception: **fatal errors** are *not* panics.

---

## Fatal Errors That recover Cannot Catch

Some runtime conditions are not implemented as panics; they are fatal errors that print and exit, bypassing the panic/recover machinery. Examples:

- **Concurrent map writes** (detected by the runtime when its hash check fails): `fatal error: concurrent map writes`.
- **Stack overflow** in some forms.
- **Out-of-memory** in critical allocations (often).
- **All goroutines asleep** (deadlock detection): `fatal error: all goroutines are asleep - deadlock!`.

These call `runtime.throw`, not `runtime.gopanic`. They print, dump all goroutine stacks, and exit. No `recover` can intercept them.

This distinction matters. If you see `fatal error:` in the output (not just `panic:`), recover would not have helped, and you must address the underlying cause.

---

## Goroutine Lifecycle and Panic

Each goroutine has a `g` struct (`runtime/runtime2.go`) with:

- `_defer` — head of deferred call list.
- `_panic` — head of active panic list.
- `goid` — goroutine ID (for tracebacks).
- `status` — runnable, running, syscall, etc.

When a goroutine starts (`go fn()`), the runtime sets up a fresh `g` with empty `_defer` and `_panic` lists. When it ends (normal return), the runtime returns the `g` to the pool.

A panic in goroutine A walks A's stack. Goroutine B, sharing nothing, is unaffected — *unless* A is the only goroutine alive *and* A's panic is unrecovered, in which case the program crashes.

Why does an unrecovered panic in *any* goroutine crash the program? Because `fatalpanic` calls `runtime·exit`, which exits the process. There is no per-goroutine "die quietly" path — once a goroutine fatally panics, it takes the process with it.

This is by design: a panic is "we are in an impossible state"; you cannot trust the rest of the process either.

---

## Compiler-Inserted Calls

Several runtime calls happen because of compiler insertion, not user code:

- Every nil pointer check that the compiler can't elide → `panicmem`.
- Every slice index → bounds check → `panicindex`.
- Every integer division → divisor check → `panicdivide`.
- Every type assertion (one-value form) → type compare → `runtime.panicdottype`.
- Every map write to nil → nil-map check → `panicwrite`.
- Every send on closed channel → `runtime.panicsend1`.
- Every close of nil/closed channel → `panicchan`.

You can find these in `runtime/panic.go`. The compiler emits them as branch targets; happy paths skip them.

This is also why `if err != nil` works so well at the assembly level: it is just a value compare and a conditional branch, while panic-based control flow involves the entire panic machinery.

---

## Panic Buffering and the panic Linked List

A subtle case: a deferred function panics during a panic. The runtime maintains a linked list of `_panic` records, headed by `g._panic`:

```go
type _panic struct {
    arg       any
    link      *_panic
    pc        uintptr
    sp        unsafe.Pointer
    recovered bool
    aborted   bool
    goexit    bool
}
```

When defer panics during a panic, the new panic is pushed onto the list. The unwinding continues with the *new* panic. If recovered, the new panic is consumed; the old one is marked `aborted`.

In Go 1.13+, the print routine walks the panic list and prints both:

```
panic: original
        panic: while handling
        ...
goroutine 1 [running]:
...
```

This is why you sometimes see two panics in a stack trace — one from the original problem, one from the cleanup that itself failed.

---

## Panic in init Functions

`init()` panics are special:

- They run during program start, before `main`.
- A panic in `init` aborts the program with the panic message.
- `recover` in main cannot help because main has not yet run.
- Even a `defer` in main is not yet registered.

If you panic in an `init`:

```go
func init() {
    panic("required env not set")
}
```

The output is:
```
panic: required env not set
goroutine 1 [running]:
main.init.0()
        /path/main.go:5 +0x...
exit status 2
```

This is technically correct but ugly. Prefer:

```go
func init() {
    if os.Getenv("KEY") == "" {
        fmt.Fprintln(os.Stderr, "KEY environment variable required")
        os.Exit(1)
    }
}
```

A clean message instead of a stack trace. Reserve `init` panics for genuine programmer errors that should never reach production.

---

## Reading Real Panic Output

A typical panic stack trace:

```
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x1043f24]

goroutine 1 [running]:
main.deepFunc(0x0)
        /home/user/app/main.go:42 +0x4
main.middle(...)
        /home/user/app/main.go:35
main.main()
        /home/user/app/main.go:30 +0x18
exit status 2
```

How to read it:

- **Line 1**: panic value (the string description).
- **Line 2**: signal info (only for runtime panics that go through SIGSEGV).
- **Goroutine N [state]**: which goroutine, what state.
- **Each stack frame**: function name, args (in hex), file:line, instruction offset.

The frames are listed innermost-first (the one that actually panicked at the top, main at the bottom).

For all-goroutines dumps (in case of fatal errors), every goroutine appears with its own stack. These can be hundreds of lines and are hard to read until you grep for the goroutine that panicked first.

Tools:
- `go tool trace` for runtime traces.
- Sentry/Honeycomb for grouping panics by stack signature.
- `delve` (`dlv debug`) for live debugging when you can reproduce.

---

## Summary

At professional level, panic and recover stop being keywords and become runtime artifacts: `_panic` and `_defer` records on goroutine stacks, compiler-inserted calls to `runtime.panicX`, stack walks driven by `gopanic`, the open-coded defer optimization that makes ordinary defers nearly free. You can now answer "how much does this cost?" with concrete numbers, "why doesn't my recover work?" by appealing to the argp comparison, and "why did this fatal error not get caught?" by recognizing `runtime.throw` versus `runtime.gopanic`. Knowing the runtime is what makes panic-related bugs in production go from mysterious to inevitable-in-hindsight.

---

## Further Reading

- `$GOROOT/src/runtime/panic.go` — the runtime panic implementation.
- `$GOROOT/src/runtime/runtime2.go` — `_panic`, `_defer`, `g` struct definitions.
- [Go 1.14 release notes — defer optimizations](https://go.dev/doc/go1.14#runtime)
- [Go 1.13 release notes — panic chain printing](https://go.dev/doc/go1.13#runtime)
- [Open-coded defer design doc](https://go.googlesource.com/proposal/+/refs/heads/master/design/34481-opencoded-defers.md)
- `go build -gcflags='-m=2'` to inspect inlining and defer placement.
- `go tool objdump` to see lowered panic calls in assembly.
