---
layout: default
title: Cleanup Ordering — Junior
parent: Cleanup Ordering
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/03-cleanup-ordering/junior/
---

# Cleanup Ordering — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "Why does Go have `defer`? In what order do my cleanups run? When does a deferred function actually execute?"

When you open a file, acquire a lock, or start a network connection in Go, you also take on a debt: you must release that resource later. The `defer` statement is Go's primary tool for paying that debt. It says: "no matter how this function exits — return, panic, or early exit — run this cleanup before leaving."

```go
file, err := os.Open("data.txt")
if err != nil {
    return err
}
defer file.Close()
```

That line is one of the first idioms every Go programmer learns. It looks innocent: schedule a close, get on with the work. But behind the simplicity is a precise set of rules. Deferred calls run in **LIFO** order (last-in, first-out). Their arguments are evaluated **at the moment of the `defer` statement**, not at the moment they actually run. They run even when the function panics. And — more subtly — they can themselves modify the function's named return value, swallow errors, or call other deferred functions that run in *their* own order.

This sub-topic begins at that idiom and works outward. By the end of this junior file you will be able to:

- Read a function and predict the exact order in which its deferred calls fire
- Explain why `defer` arguments are evaluated at the `defer` line, not at function exit
- Use `defer` to close files, unlock mutexes, and stop tickers safely
- Avoid the most common rookie traps: defer inside a loop, ignored errors from `Close`, deferred calls that capture stale variables
- Understand the rough relationship between `defer` and `context` cancellation — enough to spot the difference between "cancel signals" and "actual cleanup"
- Recognise that a goroutine's deferred functions only run when *that goroutine* exits, not when its parent exits

You do **not** yet need to understand `context.AfterFunc`, open-coded defer optimisation, the `runtime.deferproc` machinery, panic/recover during cleanup, or the design of resource hierarchies spanning multiple packages. Those belong to the middle, senior, and professional files. This file is about the moment your function says "I am leaving" and a small stack of cleanup calls unwinds in the reverse order they were registered.

We will keep the examples short, runnable, and faithful to real Go behaviour. Every snippet in this file compiles. If a snippet shows a deliberate bug, it will be clearly labelled `// BUG:`.

---

## Prerequisites

- **Required:** Go 1.21 or newer installed. Check with `go version`. Some examples use `context.AfterFunc`, which appeared in 1.21.
- **Required:** Comfort writing and running a `main` function and a few helpers in one file.
- **Required:** Familiarity with `os.Open`, `os.Create`, `*os.File`, and the `io.Reader`/`io.Closer` interfaces. You should know that `Close()` can return an error.
- **Required:** Familiarity with `sync.Mutex` and `sync.WaitGroup` at the level of "I can lock, unlock, and wait."
- **Helpful:** A passing acquaintance with `context.Context` and the idea that `cancel()` is itself a function you call.
- **Helpful:** Awareness that panics in Go are recoverable from a deferred function — we will not dwell on `recover` here, but it shows up.

If `defer fmt.Println("done")` makes sense to you and you have ever opened a file with `os.Open`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`defer`** | A statement that registers a function call to run when the surrounding function returns, panics, or otherwise unwinds. Syntax: `defer Call(args)`. |
| **Defer stack** | The per-goroutine, per-function stack of pending deferred calls. New defers are pushed on top; on function exit they pop from the top down — LIFO order. |
| **LIFO** | "Last in, first out" — the same pattern as a stack of plates. Crucial for cleanup because resources acquired in order A → B → C should be released in order C → B → A. |
| **Cleanup** | Code that releases a resource, ends a transaction, flushes a buffer, or otherwise restores invariants the function disturbed. |
| **`Close()`** | The conventional method name for releasing a resource. Defined by the `io.Closer` interface. Returns an `error` because closing can fail. |
| **`Stop()`** | The conventional method name for stopping a timer, ticker, or background routine. |
| **Named return value** | A return value declared in the function signature, e.g. `func read() (err error)`. Deferred functions can read and modify it. |
| **Resource hierarchy** | An ordered set of resources where releasing one in the wrong order produces a use-after-close, a leaked goroutine, or a corrupted state. |
| **Idempotent cleanup** | Cleanup that is safe to call more than once. `os.File.Close` returns an error on the second call but does not crash; some Close methods crash. |
| **Open-coded defer** | A compiler optimisation that inlines a small number of defers into the function body rather than allocating a runtime defer record. Reduces overhead. |
| **`context.AfterFunc`** | A Go 1.21 hook: `stop := context.AfterFunc(ctx, fn)`. Runs `fn` in its own goroutine after `ctx` is cancelled. Useful for cleanup that must survive the parent goroutine. |
| **Goroutine exit** | The moment a goroutine's top-level function returns. Only at that moment do *that goroutine's* deferred calls fire — not the parent's. |

---

## Core Concepts

### `defer` registers a call; it does not call it yet

The single line

```go
defer file.Close()
```

does two things and only two things:

1. It evaluates the receiver `file` (and any argument expressions) **now**, at the point of the `defer` statement.
2. It pushes "call `Close()` on this value" onto the goroutine's defer stack for this function.

It does **not** call `Close` yet. The call happens when the function is about to return — by any path. That includes a `return` statement, the end of the function body, and a panic.

```go
func read() error {
    file, err := os.Open("data.txt")
    if err != nil {
        return err
    }
    defer file.Close() // <-- registered here, but not run yet

    data, err := io.ReadAll(file)
    if err != nil {
        return err // Close runs as part of returning
    }
    process(data)
    return nil // Close also runs here
}
```

### LIFO order

If a function registers three defers in order A, B, C, they run in order C, B, A:

```go
func three() {
    defer fmt.Println("A")
    defer fmt.Println("B")
    defer fmt.Println("C")
    fmt.Println("body")
}
```

Output:

```
body
C
B
A
```

Why LIFO? Because resources have nesting structure. You open a file, then *inside that file* you start a buffered reader. The reader must be flushed before the file is closed, or the flush writes into a closed file. By deferring in acquisition order, LIFO unwinding gives you the right release order for free.

### Argument capture: evaluated at `defer`, called later

```go
func surprise() {
    x := 1
    defer fmt.Println("deferred sees x =", x)
    x = 99
    fmt.Println("body sees x =", x)
}
```

Output:

```
body sees x = 99
deferred sees x = 1
```

The argument `x` was *evaluated* at the moment the `defer` statement executed. Even though `Println` itself runs much later, it sees the value `1`, not `99`.

This is the single most common source of confusion for newcomers. If you want to defer a *function* that reads the latest value of `x`, wrap it in a closure:

```go
func updated() {
    x := 1
    defer func() { fmt.Println("deferred sees x =", x) }()
    x = 99
}
```

Now the closure captures `x` by reference (well, by closure over the variable), and prints `99`.

### Defer runs on every exit path — including panics

```go
func mayPanic() {
    defer fmt.Println("cleanup")
    panic("boom")
}
```

Output before the panic crashes the program:

```
cleanup
panic: boom
```

This is what makes `defer` reliable: you do not have to remember to put `Close()` in every `return` branch and in every error path and in every conditional. A single `defer` covers them all.

The only exit that *skips* defers is `os.Exit` (and the runtime's exit on unrecovered fatal errors). Plain panics, unrecovered or not, do run defers.

### Defers belong to the goroutine that registered them

A deferred call attached to `f` only runs when `f` itself returns. If `f` spawns a goroutine that calls `g`, the defers inside `g` belong to *that new goroutine* and run when *g* returns, not when *f* returns.

```go
func parent() {
    defer fmt.Println("parent done")
    go child()
    time.Sleep(50 * time.Millisecond)
    fmt.Println("parent returning")
}

func child() {
    defer fmt.Println("child done")
    fmt.Println("child running")
}
```

`parent done` fires when `parent` returns. `child done` fires whenever `child` returns — which could be before, after, or never (if `child` blocks forever) relative to `parent`. This is the source of the "spawned goroutine leak" pattern: registering a defer in a goroutine that never exits is the same as never registering it at all.

### Context cancellation is not cleanup

A subtlety that confuses many Go newcomers: calling `cancel()` on a `context.CancelFunc` does **not** clean up your resources. It only sends a signal — it closes `ctx.Done()`. *Your code* must observe that signal and release whatever it owns.

```go
ctx, cancel := context.WithTimeout(parent, time.Second)
defer cancel() // releases the timer; does not close your file
```

The `defer cancel()` is itself important — it releases the goroutine the timer holds — but if your function also opened a file or acquired a lock, those need their own defers.

We will explore the relationship between context cancellation and cleanup more in the middle and senior files. For now, the message is: `defer cancel()` is one defer among many; do not let it stand in for resource cleanup.

---

## Real-World Analogies

### Plates in a sink

Imagine washing dishes. You stack them in the sink in the order you used them: dinner plate first, salad plate on top, dessert plate last. When you wash them, you take them off the top of the stack — the dessert plate first, then the salad plate, then the dinner plate. That is LIFO and it is exactly how `defer` runs.

If you tried to wash the bottom plate first, you would have to move the others out of the way. Software has the same problem: you cannot close a database connection that a transaction is still using; the transaction (acquired *after* the connection) must close first.

### Boarding and leaving an aeroplane

When you board, you put your bag in the overhead bin (resource 1), buckle your seatbelt (resource 2), put on your headphones (resource 3). When the flight ends, you unwind in reverse: take off headphones, unbuckle, retrieve bag. Try the reverse order and you find yourself standing in the aisle holding three things at once with your seatbelt fastened.

### A nested set of contracts

A construction contract may have sub-contracts. The general contractor signs first, then sub-contracts the plumbing, then sub-contracts the electrics. When the project ends, the electrician's contract closes first, then the plumber's, then the general contractor's. The order matters because the sub-contracts depend on the parent contract being in force.

### Undoing a recipe

If a recipe says "preheat the oven, melt the butter, mix the dough, bake," cleaning up means turning off the oven (last), washing the bowl (mid), and putting the butter back (first). LIFO again — and missing the last step (turn off the oven) is the kind of bug that runs the gas bill up overnight.

---

## Mental Models

### Model 1: The defer stack as a pending-work list

Picture each goroutine's current function as having an invisible to-do list. Every `defer` statement appends an item to the *top* of that list. When the function returns, the runtime pops items off the top one at a time and runs them. The function only truly exits after the list is empty.

```
function body executes
   defer A          [A]
   defer B          [B, A]
   defer C          [C, B, A]
return triggers unwinding:
   pop C, run C     [B, A]
   pop B, run B     [A]
   pop A, run A     []
function actually returns to caller
```

### Model 2: Frozen arguments, deferred call

Each defer record stores:
- A function pointer
- A snapshot of the argument values at registration time
- A link to the next defer record

The function pointer is not called at registration time; the *arguments* are evaluated. This is why `defer fmt.Println(x)` prints the value of `x` at the defer site, even if `x` changes later.

### Model 3: `defer` as a guard

Think of `defer X()` as installing a guard at the function's exit door. No matter how you try to leave — return, panic, `os.PathError` — the guard executes before the door opens. There can be multiple guards (LIFO), and each one only sees the world as it was when *it* was installed (for arguments) or as it is now (for closure captures).

### Model 4: Lifetimes and ownership

A function `f` *owns* every resource it acquires until it explicitly transfers ownership. `defer Close()` is a vow: "I will release this before I leave." A function that returns a still-open resource is *transferring* ownership to the caller — and must not defer-close it.

```go
// owns the file; closes before returning
func processFile(path string) error {
    f, err := os.Open(path)
    if err != nil { return err }
    defer f.Close()
    return process(f)
}

// transfers ownership; caller must close
func openFile(path string) (*os.File, error) {
    return os.Open(path)
}
```

Mixing these two patterns — deferring a close on a resource you are about to return — is a use-after-close bug.

---

## Pros & Cons

### Pros of `defer`

- **Centralised cleanup.** One line at the top of a function ensures the cleanup runs on every exit path.
- **Panic-safe.** Cleanup runs even when the function panics, preventing leaks during failure.
- **Reads top-to-bottom.** Acquisition and intended cleanup sit next to each other in code, making intent obvious.
- **LIFO ordering for free.** The natural acquisition order produces the natural release order without any extra bookkeeping.
- **Compiler-optimised in many cases.** Modern Go inlines short defers ("open-coded defer") so the runtime cost is negligible.

### Cons / costs of `defer`

- **Not free.** A defer that the compiler cannot open-code allocates a small record on the heap and follows a linked list at exit. Hot loops with one defer per iteration can show up in profiles.
- **Easy to misuse in loops.** `for ... { defer file.Close() }` registers a defer per iteration; all of them run only when the enclosing function exits, which is a leak.
- **Silent error swallowing.** `defer f.Close()` discards the error from `Close`. Writers that buffer (like `bufio.Writer` over a file) can lose data this way.
- **Hidden control flow.** A reader who skims a function may miss that the defer mutates a named return value — making it look as if the function returns one thing when in fact it returns another.

We expand on each of these in the relevant sections below.

---

## Use Cases

`defer` is the right tool for almost any "acquire / release" pair. Common cases:

- **File handles.** `f, _ := os.Open(...); defer f.Close()`
- **Mutex locks.** `mu.Lock(); defer mu.Unlock()`
- **Database transactions.** `tx, _ := db.BeginTx(...); defer tx.Rollback()` (with a subsequent `Commit` that nullifies the rollback)
- **HTTP response bodies.** `resp, _ := http.Get(...); defer resp.Body.Close()`
- **Timers and tickers.** `t := time.NewTicker(...); defer t.Stop()`
- **Context cancellation.** `ctx, cancel := context.WithTimeout(...); defer cancel()`
- **`sync.WaitGroup.Done`** at the top of a goroutine: `defer wg.Done()` ensures the counter decrements even on panic.
- **Tracing / metrics.** `defer trace.End()`, `defer func() { metrics.Observe(time.Since(start)) }()`.
- **Recovering from panics in goroutines.** `defer func() { if r := recover(); r != nil { log.Print(r) } }()`.
- **Restoring state in tests.** `oldEnv := os.Getenv("X"); os.Setenv("X", "test"); defer os.Setenv("X", oldEnv)`.

When `defer` is *not* the right tool:
- When the resource must be released *before* the function exits (e.g. you need to use it, release it, then continue computation).
- When cleanup must survive the goroutine that registered it (use `context.AfterFunc` or a shutdown channel).
- When you need fine-grained ordering control — for example, releasing in batches, or releasing the *first* resource before the others. Then you call cleanup functions manually.

---

## Code Examples

All examples in this section are complete, runnable Go programs. Save each as `main.go`, run with `go run main.go`.

### Example 1: A single defer

```go
package main

import "fmt"

func main() {
    fmt.Println("start")
    defer fmt.Println("cleanup")
    fmt.Println("middle")
}
```

Output:

```
start
middle
cleanup
```

The deferred `Println("cleanup")` runs after the function body finishes — last, even though it was written second.

### Example 2: LIFO with three defers

```go
package main

import "fmt"

func main() {
    defer fmt.Println("first defer")
    defer fmt.Println("second defer")
    defer fmt.Println("third defer")
    fmt.Println("body")
}
```

Output:

```
body
third defer
second defer
first defer
```

### Example 3: Argument evaluation timing

```go
package main

import "fmt"

func main() {
    x := 10
    defer fmt.Println("deferred:", x) // captures 10 NOW
    x = 99
    fmt.Println("body:", x)
}
```

Output:

```
body: 99
deferred: 10
```

The deferred call printed `10`, the value of `x` at the moment of the `defer` statement.

### Example 4: Closure captures by reference

```go
package main

import "fmt"

func main() {
    x := 10
    defer func() { fmt.Println("deferred:", x) }()
    x = 99
    fmt.Println("body:", x)
}
```

Output:

```
body: 99
deferred: 99
```

A closure captures the *variable*, not its value. By the time the closure runs, `x` is 99.

### Example 5: Closing a file

```go
package main

import (
    "fmt"
    "io"
    "os"
)

func main() {
    f, err := os.Open("/etc/hostname")
    if err != nil {
        fmt.Println("open:", err)
        return
    }
    defer f.Close()

    data, err := io.ReadAll(f)
    if err != nil {
        fmt.Println("read:", err)
        return
    }
    fmt.Printf("read %d bytes\n", len(data))
}
```

The defer guarantees `f.Close()` runs whether the read succeeds, fails, or panics.

### Example 6: Mutex unlock

```go
package main

import (
    "fmt"
    "sync"
)

var (
    mu      sync.Mutex
    counter int
)

func bump() {
    mu.Lock()
    defer mu.Unlock()
    counter++
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            bump()
        }()
    }
    wg.Wait()
    fmt.Println("counter =", counter)
}
```

`defer mu.Unlock()` is the right way to release a mutex in any non-trivial function. If the function panics mid-update, the mutex still unlocks, and other goroutines do not deadlock.

### Example 7: Panic-safe cleanup

```go
package main

import "fmt"

func mayPanic() {
    defer fmt.Println("cleanup ran")
    panic("oh no")
}

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    mayPanic()
}
```

Output:

```
cleanup ran
recovered: oh no
```

`mayPanic`'s defer ran before the panic propagated up to `main`'s `recover`.

### Example 8: Returning an error captured by defer

```go
package main

import (
    "errors"
    "fmt"
)

func work() (err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("work failed: %w", err)
        }
    }()
    return errors.New("disk full")
}

func main() {
    fmt.Println(work())
}
```

Output:

```
work failed: disk full
```

The deferred closure wraps the named return value `err`. Without `err` as a named return, the closure could not see or modify the error.

### Example 9: Stopping a ticker

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    t := time.NewTicker(50 * time.Millisecond)
    defer t.Stop()

    for i := 0; i < 5; i++ {
        <-t.C
        fmt.Println("tick", i)
    }
}
```

`defer t.Stop()` releases the underlying timer resource. Without it, the ticker leaks until garbage collection — and even then, only because newer Go versions hooked tickers into the GC.

### Example 10: A goroutine's defer fires when *that* goroutine exits

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer fmt.Println("goroutine cleanup")
        fmt.Println("goroutine work")
    }()
    fmt.Println("main waiting")
    wg.Wait()
    fmt.Println("main done")
}
```

Output:

```
main waiting
goroutine work
goroutine cleanup
main done
```

The goroutine's defers ran when the goroutine returned, not when `main` returned. `main`'s `Wait()` blocked until the goroutine was fully done — *including* its defers.

### Example 11: `defer` inside a `for` loop — usually a bug

```go
package main

import (
    "fmt"
    "os"
)

// BUG: defers stack up; all closes run only when ProcessAll returns.
func ProcessAll(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            return err
        }
        defer f.Close() // <-- never runs until ProcessAll exits
        _ = f
    }
    return nil
}

func main() {
    fmt.Println("see junior.md commentary for the fix")
    _ = ProcessAll
}
```

If `paths` has a million entries, `ProcessAll` holds a million open files until it returns. The fix is to lift the body into a helper that closes per iteration:

```go
func ProcessAll(paths []string) error {
    for _, p := range paths {
        if err := processOne(p); err != nil {
            return err
        }
    }
    return nil
}

func processOne(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()
    _ = f
    return nil
}
```

### Example 12: Acquire two resources, release in reverse

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    in, err := os.Open("/etc/hostname")
    if err != nil {
        fmt.Println(err); return
    }
    defer in.Close()

    out, err := os.Create("/tmp/copy.txt")
    if err != nil {
        fmt.Println(err); return
    }
    defer out.Close()

    // ... use both ...
    fmt.Println("both open")
}
```

When `main` returns, `out.Close()` runs first (last defer registered → first popped), then `in.Close()`. LIFO matches the natural "release the inner resource first" rule.

### Example 13: Defer with `context.WithCancel`

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel() // crucial: releases context's internal goroutine

    go func() {
        select {
        case <-ctx.Done():
            fmt.Println("worker: cancelled")
        case <-time.After(time.Second):
            fmt.Println("worker: timed out")
        }
    }()

    time.Sleep(100 * time.Millisecond)
    cancel()                          // signal early
    time.Sleep(100 * time.Millisecond) // give worker a chance to print
}
```

Note that `cancel` is called explicitly (the first call wins; later calls are no-ops). The `defer cancel()` exists for the case where the function returns without reaching the explicit call.

### Example 14: `context.AfterFunc` — Go 1.21

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    stop := context.AfterFunc(ctx, func() {
        fmt.Println("cleanup after cancel")
    })
    defer stop() // if we exit before cancel, deregister the AfterFunc

    cancel() // schedule the AfterFunc
    time.Sleep(50 * time.Millisecond)
}
```

`AfterFunc` runs its callback in a fresh goroutine the moment `ctx` is cancelled. The returned `stop` lets you deregister it if you no longer want it to fire. We cover this in depth in `middle.md` and `senior.md`.

### Example 15: Tracking elapsed time

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    defer func(start time.Time) {
        fmt.Println("elapsed:", time.Since(start))
    }(time.Now()) // argument evaluated now → start is captured

    time.Sleep(120 * time.Millisecond)
}
```

The trick: passing `time.Now()` as an argument to the deferred function captures the starting instant *at defer time*. The closure then reads the captured `start` and computes the difference at exit.

---

## Coding Patterns

### Pattern 1: Acquire-and-defer immediately

```go
f, err := os.Open(path)
if err != nil {
    return err
}
defer f.Close()
```

Always put the `defer` on the line directly after a successful acquisition. Errors before the `defer` mean the resource was never acquired; errors after it are covered by the defer.

### Pattern 2: Per-iteration cleanup via helper

```go
for _, p := range paths {
    if err := processOne(p); err != nil {
        return err
    }
}

func processOne(p string) error {
    f, err := os.Open(p)
    if err != nil { return err }
    defer f.Close()
    // ...
    return nil
}
```

Each call to `processOne` has its own defer scope, so each file closes promptly.

### Pattern 3: Defer-then-rollback for transactions

```go
tx, err := db.BeginTx(ctx, nil)
if err != nil { return err }
defer tx.Rollback() // safe: Rollback after Commit is a no-op

// ... work ...

return tx.Commit()
```

A successful `Commit` makes the deferred `Rollback` a no-op. A return before `Commit` rolls back. Clean and resilient.

### Pattern 4: Capture a named return value

```go
func read(path string) (err error) {
    f, oerr := os.Open(path)
    if oerr != nil { return oerr }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    // ... read ...
    return nil
}
```

If reading succeeded but `Close` failed (rare for read-only files, common for writes), the function still reports the close error.

### Pattern 5: `defer cancel()` for every `context.With*`

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
```

The Go vet tool will warn if you forget. `cancel` is cheap and idempotent; defer it unconditionally.

### Pattern 6: A one-line trace probe

```go
defer trace("processOrder")()

func trace(name string) func() {
    start := time.Now()
    log.Printf("enter %s", name)
    return func() {
        log.Printf("exit  %s after %s", name, time.Since(start))
    }
}
```

The outer call returns a closure; the closure is then deferred. The result: a paired enter/exit log around any function.

---

## Clean Code

A few practical guidelines for keeping defer-driven cleanup readable.

### 1. Defer immediately after acquisition

Don't separate the acquisition from the defer by ten lines of logic. The reader should not have to scan the function to be confident the cleanup is registered.

Bad:

```go
f, err := os.Open(path)
if err != nil { return err }
// ... 30 lines ...
defer f.Close()
```

Good:

```go
f, err := os.Open(path)
if err != nil { return err }
defer f.Close()
// ... 30 lines ...
```

### 2. Prefer one resource per function

Functions that acquire and clean up four different resources tend to grow complex defer stacks and become hard to reason about. Split them.

### 3. Name your return value when defers modify errors

```go
func read() (err error) { ... }
```

The named return makes it obvious to readers that the deferred function can modify `err`.

### 4. Avoid `defer` in tight loops

If a function loops a million times and defers on each iteration, those defers stack up and only run at function exit. Either lift the body into a helper or call the cleanup explicitly.

### 5. Don't ignore errors from `Close`

For files you only read, `Close` is unlikely to fail in a way that matters. For files you write — and for things like `bufio.Writer.Flush` or transaction `Commit` — a failed `Close` can mean lost data. Handle it.

### 6. Document the order if it is not obvious

If three defers have an order that matters for correctness and not just for closure-of-resource, write a one-line comment explaining why.

---

## Product Use / Feature

In a typical production Go service, cleanup ordering is the difference between a healthy shutdown and a cascade of "use of closed network connection" log lines. Concrete situations where order matters:

- **HTTP server shutdown.** Close the listener, then drain in-flight requests, then close database pools. Reverse the order and you cut connections to the database while requests still need it.
- **Worker pool shutdown.** Stop accepting new tasks, drain the queue, signal workers, wait for them to exit, then close logs and metrics. Reverse, and workers race the log writer.
- **gRPC client lifecycle.** Stop streaming RPCs first, then close the client connection, then close the credential source. Reverse, and the streams panic on a closed transport.
- **Distributed tracing flush.** The tracer's `Shutdown` must be deferred *first* — so it pops *last* — to ensure that all other defers' spans get flushed before the process exits.

You will see these patterns first-hand if you read the standard library: `net/http`'s `Server.Shutdown`, `database/sql`'s `DB.Close`, and the `os/exec.Cmd` lifecycle all reflect strict ordering rules.

---

## Error Handling

### Errors returned from `Close`

Most `Close` methods can return an error. `defer f.Close()` discards that error. For files opened only for reading, that is usually fine. For files opened for writing, or for any buffered writer, ignoring the error is a real bug because:

- The OS might still have un-flushed kernel buffers when `Close` runs.
- A network filesystem might fail the flush.
- A `bufio.Writer` over the file might still be holding bytes you never wrote.

The defensive pattern:

```go
func write(path string, data []byte) (err error) {
    f, err := os.Create(path)
    if err != nil { return err }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    _, err = f.Write(data)
    return err
}
```

Two things to notice:
1. The function uses a *named return* `(err error)` so the deferred closure can modify it.
2. The closure only overwrites `err` if it was `nil` — so a real write error is not masked by a close error.

### Panics during cleanup

A deferred function can itself panic. When it does, the panic *replaces* any panic already in flight (if any), and unwinding continues with the new one. The Go specification calls this "the original panic value is discarded." In practice, this means a buggy `Close` that panics will hide the bug that actually caused the function to fail.

For now, just be aware. Recovery patterns are a middle-level topic.

### Multiple errors

If you defer two cleanups and both can fail, you generally want to report both. Go 1.20 introduced `errors.Join`:

```go
defer func() {
    if cerr := closer.Close(); cerr != nil {
        err = errors.Join(err, cerr)
    }
}()
```

This avoids dropping either error. We expand on multi-error cleanup in `middle.md`.

---

## Security Considerations

Cleanup order is not just hygiene; it can have security implications.

- **Sensitive data in buffers.** If you write secrets to a file and rely on `defer f.Close()` to flush, but the program crashes earlier, the secret might never hit disk — or might end up only partially written and recoverable in unexpected places.
- **Stale TLS state.** Closing a TLS connection involves sending a close-notify alert. If you skip it (because of out-of-order defers), the peer cannot distinguish your normal close from an attacker truncation. Always defer-close TLS connections.
- **File permissions during write.** Creating a file with `os.Create` uses `0666`-with-umask. If you set explicit permissions afterwards (`f.Chmod(0600)`), put the `Chmod` *before* writing sensitive data, not in a deferred call. Otherwise the data exists with wider permissions for an instant.
- **Lock release on panic.** If a critical section panics with the lock still held but no defer to release it, every goroutine waiting on the lock is wedged. That is a denial-of-service. Always defer-unlock.
- **Resource exhaustion as DoS.** A defer-in-loop bug that leaks file descriptors will eventually exhaust the process's FD limit, taking the service down. Cleanup ordering is part of availability.

---

## Performance Tips

- **Open-coded defers are nearly free.** The compiler inlines defers when a function has fewer than eight at compile time and none of them are inside a loop. The cost in those cases is a few extra instructions.
- **Heap defers are slower.** A `defer` inside a loop or one of more than eight in a function falls back to a heap-allocated defer record. The cost is small but measurable in tight benchmarks.
- **Don't optimise prematurely.** For 99% of code, the cost of `defer` is invisible. Profile first; do not contort your code to avoid one defer per function.
- **Avoid `defer` in hot loops if it shows up in a profile.** Lift the body into a helper, or call cleanup explicitly.
- **`defer` does not increase allocation by default.** Open-coded defers do not allocate. Heap defers allocate exactly one record per defer.

---

## Best Practices

- Defer the cleanup *immediately* after a successful acquisition.
- Use named return values when a defer modifies the returned error.
- Do not defer in a tight loop; extract a helper.
- Never assume `Close` succeeds — handle its error explicitly for writes.
- For every `context.With*`, defer the returned `cancel`.
- For long-lived resources owned by a goroutine, register the cleanup with `defer` at the top of the goroutine, *and* make sure the goroutine actually exits.
- Use `defer mu.Unlock()` whenever the locked region is more than a couple of lines.
- Use `defer trace("name")()` as a quick way to add enter/exit logging without modifying function bodies.

---

## Edge Cases & Pitfalls

### `os.Exit` skips defers

```go
func main() {
    defer fmt.Println("never prints")
    os.Exit(0)
}
```

Nothing prints. `os.Exit` terminates immediately. If you must `os.Exit` from a function that holds resources, release them manually first.

### `runtime.Goexit` runs defers

```go
go func() {
    defer fmt.Println("goexit cleanup ran")
    runtime.Goexit()
}()
```

`runtime.Goexit` ends the calling goroutine and runs its defers. Useful in testing (`t.FailNow` uses it).

### Defers in `init` functions

`init` functions can use `defer`. The defers run when `init` returns. Nothing surprising — but if `init` panics, the program may abort before its defers in *other* `init` functions get a chance.

### Defers on `nil` pointers

```go
var f *os.File
defer f.Close() // panic: nil pointer dereference
```

The defer *registers* fine, but when it runs, `f.Close()` panics because the receiver is nil. Always check the error from acquisition *before* deferring close.

### Argument evaluation captures pointers

```go
m := map[string]int{"x": 1}
defer fmt.Println(m) // evaluates m (the map header) now
m["x"] = 99          // mutates the underlying map
// at function exit, deferred prints map[x:99]
```

The defer captured the *map header*, not a copy of the contents. Maps and slices are reference types: their headers are evaluated, but the data they point to is shared. If you want a snapshot, copy the map explicitly before the defer.

### Defers in returning a closure

```go
func returnsCleanup() func() {
    f, _ := os.Open("/etc/hostname")
    return func() { f.Close() } // caller owns the file now
}
```

Do not `defer f.Close()` here — you would close the file before the caller could use it.

### Defers across multiple goroutines do not coordinate

If you spawn three goroutines, each of them has its own defer stack. A defer in `main` does not run when goroutine 2 returns. We will return to this in `middle.md` and `senior.md`.

---

## Common Mistakes

### Mistake 1: Deferred close inside a loop

Already covered in Example 11. The fix is to extract a helper.

### Mistake 2: Ignoring the error from `Close` on a writer

```go
// BUG
f, _ := os.Create("/tmp/out")
defer f.Close()
fmt.Fprintln(f, "important data")
```

The `Close` error is dropped. If the disk is full, this code silently loses data.

### Mistake 3: Forgetting `defer cancel()`

```go
// BUG
ctx, _ := context.WithTimeout(parent, time.Second)
go work(ctx)
```

The `cancel` is never called. The timer leaks until either the timeout fires or the process exits. `go vet` catches this.

### Mistake 4: Capturing loop variables in deferred closures

```go
for i := 0; i < 3; i++ {
    defer func() { fmt.Println(i) }() // in Go ≤ 1.21 prints 3,3,3
}
```

Go 1.22+ scopes the loop variable per iteration, so this prints 2,1,0. In older Go, it printed 3,3,3 from the shared variable. Either way, do not rely on it; pass `i` explicitly to a function.

### Mistake 5: Deferring on a resource you are about to return

```go
// BUG: caller receives a closed file
func openFile(path string) (*os.File, error) {
    f, err := os.Open(path)
    if err != nil { return nil, err }
    defer f.Close()
    return f, nil
}
```

The defer fires before the return value reaches the caller. Either drop the defer (transfer ownership) or do not return the resource.

### Mistake 6: Defers after a panic in a different goroutine

```go
go func() {
    defer fmt.Println("cleanup")
    panic("boom")
}()
// main does not recover; process exits
```

If `main` does not block waiting, the program may exit before the goroutine's defer runs. Even when it does run, an unrecovered panic in one goroutine still terminates the whole process.

### Mistake 7: Confusing `defer cancel()` with cleanup of *resources*

`defer cancel()` releases the context's internal state; it does not close your files, your transactions, or your locks. Each of those needs its own defer.

---

## Common Misconceptions

> "Defers run in the order I wrote them."

No — LIFO, the reverse order. This is the single most common misconception.

> "The arguments to a deferred call are evaluated when it runs."

No — at the moment of the `defer` statement. The call itself is delayed.

> "If a goroutine panics, my main function's defers still run before the program exits."

Yes — but only *if* main blocks (e.g. via `WaitGroup`) until the panicking goroutine is done, or if you have a `recover` in the panicking goroutine.

> "I should always defer the close."

Usually yes, but not when the resource is being returned to the caller (transfer of ownership) and not when the resource must be released before the function exits.

> "Defer is too slow for production."

No, in the vast majority of cases. Open-coded defers in Go ≥ 1.14 are nearly free. Profile before changing your code.

> "context.AfterFunc is just a fancy defer."

No. `AfterFunc` runs *in its own goroutine* when the context is cancelled — possibly long after the registering function has returned. It is the right tool for cleanup that must outlive the parent. We will explore it deeply in `senior.md`.

---

## Tricky Points

- **The order of side effects matters.** If two defers both modify a named return value, the *last-pushed* defer runs first and sees the value as set by the body; the *first-pushed* defer runs last and sees the value as set by the second.
- **A defer in a deferred function**. You can write `defer func() { defer cleanup() }()`. The outer closure is registered now; when it runs (at function exit), it registers `cleanup` on its own (empty) defer stack and immediately exits, running `cleanup`. Almost never useful, but legal.
- **`return x` is actually two steps**: assign `x` to the return values, then run defers, then return. This is why a deferred function can mutate a named return value *after* the `return` expression has been evaluated.
- **`recover` only works inside a deferred function.** Calling `recover()` outside one always returns nil. This is by design.
- **Method values vs method expressions in defer.** `defer obj.Method()` evaluates `obj`'s method-value at defer time. If `obj` is reassigned later, the *original* method value is still scheduled.

---

## Test

A quick self-test. Predict the output before scrolling.

```go
package main

import "fmt"

func main() {
    fmt.Println("a")
    defer fmt.Println("b")
    fmt.Println("c")
    defer fmt.Println("d")
    fmt.Println("e")
}
```

Output:

```
a
c
e
d
b
```

Another:

```go
package main

import "fmt"

func swap() (x int) {
    defer func() { x = x * 2 }()
    return 5
}

func main() {
    fmt.Println(swap())
}
```

Output: `10`. The `return 5` sets `x = 5`; the deferred closure doubles it to `10`; the function returns `10`.

One more:

```go
package main

import "fmt"

func sneaky() {
    i := 0
    defer fmt.Println("i =", i)
    for i = 0; i < 3; i++ {
    }
}

func main() {
    sneaky()
}
```

Output: `i = 0`. The deferred `Println` captured the *value* of `i` (0) at the `defer` line. The loop mutates `i` to 3, but the defer already has its snapshot.

---

## Tricky Questions

**Q1.** What is printed?

```go
func main() {
    for i := 0; i < 3; i++ {
        defer fmt.Println(i)
    }
}
```

**A.** `2`, then `1`, then `0`. Each defer captures the value of `i` at its registration. They run in LIFO order, so the last-registered (i=2) runs first.

**Q2.** What is printed?

```go
func main() {
    f, _ := os.Open("/etc/hostname")
    defer f.Close()
    panic("crash")
}
```

**A.** Nothing visible from `f.Close()` — the close runs, but its return value is discarded. Then the runtime prints the panic message and the stack trace.

**Q3.** Why does `go vet` complain about `cancel` not being called?

**A.** Because functions like `context.WithCancel` return a `cancel` function that must be invoked to release internal resources. Forgetting it leaks a goroutine and a timer.

**Q4.** In what order do these print?

```go
func main() {
    defer fmt.Println("a")
    defer func() {
        defer fmt.Println("b")
        fmt.Println("c")
    }()
    fmt.Println("d")
}
```

**A.** `d`, then `c`, then `b`, then `a`. The outer body prints `d`. Then `main`'s defers pop in LIFO order: the closure runs first, printing `c`, registering its own defer `b`, and returning — at which point `b` fires. Finally `main`'s first defer runs `a`.

**Q5.** Is `defer f.Close()` a leak if `f` is `nil`?

**A.** Not a leak — it's a runtime panic when the defer fires. Always check the error from acquisition before deferring.

---

## Cheat Sheet

```
defer Call(args)              register Call with args evaluated NOW
                              call runs at function exit, LIFO

defer func() { ... }()        closure captures variables by reference

named return + defer          deferred closure can modify the return

defer cancel()                always, for every context.With*

defer mu.Unlock()             always, when locked region > 2 lines

defer f.Close()               always, after a successful Open
                              wrap in closure if you care about the error

defer t.Stop()                for every NewTimer / NewTicker

DON'T defer in tight loops    extract a helper that defers per iteration

DON'T defer on a resource     you are about to return to the caller

os.Exit                       skips defers (rare, but it does happen)
panic                         runs defers; recover inside a defer
runtime.Goexit                runs defers
```

---

## Self-Assessment Checklist

- [ ] I can predict the print order of any program with `defer` statements.
- [ ] I know that defer arguments are evaluated at the defer line, not at exit.
- [ ] I can name three resources that should be closed with `defer`.
- [ ] I know why `defer` inside a loop is usually a bug, and I can write the fix.
- [ ] I know how a deferred closure can modify a named return value.
- [ ] I can explain the difference between `defer cancel()` and `defer f.Close()`.
- [ ] I know that `os.Exit` skips defers but `panic` runs them.
- [ ] I can describe what `context.AfterFunc` does at a one-sentence level.
- [ ] I can write a `defer trace("name")()` helper from scratch.
- [ ] I have, at least once, run a small program and counted the defers myself to confirm LIFO.

---

## Summary

`defer` is the workhorse of Go cleanup. It registers a function call to run when the surrounding function exits, in LIFO order with respect to other defers, with arguments evaluated at the defer site. It runs on panic. It does not run on `os.Exit`. It is essentially free in the common case. It interacts with named return values, with closures, with mutexes, with contexts, with timers, and with every resource your code acquires. Cleanup *ordering* in Go is, at the junior level, exactly the ordering imposed by the defer stack — once you internalise LIFO, half the rules write themselves.

The remaining half — what to do when cleanup must outlive the goroutine that registered it, when context cancellation interacts with deferred shutdown, when errors from cleanup must be propagated through panic and recover, and when the runtime's defer implementation itself becomes a bottleneck — is the subject of the next files. But it all rests on the foundation built here: a function exits, a stack of pending calls unwinds, and your program leaves the world tidier than it found it.

---

## What You Can Build

With just the contents of this file you can already write:

- A small file-processing tool that opens, reads, transforms, and writes files with no leaks
- A tiny HTTP client that closes response bodies safely
- A thread-safe counter using `sync.Mutex` and `defer mu.Unlock()`
- A function that prints an "elapsed time" line at exit using the `defer time` trick
- A worker function with `defer wg.Done()` and `defer recover()` that survives panics
- A short shell-like utility that wraps every command in `defer cancel()` for context cleanup
- A test helper that saves and restores an environment variable using `defer`

---

## Further Reading

- The Go specification, "Defer statements" section: https://go.dev/ref/spec#Defer_statements
- *Effective Go*, "Defer, Panic, and Recover": https://go.dev/doc/effective_go#defer
- Dave Cheney, *Five things that make Go fast* — discusses open-coded defers
- The Go blog, "Defer, Panic, and Recover" (2010, still relevant)
- The Go 1.14 release notes, on open-coded defer optimisation
- The Go 1.21 release notes, on `context.AfterFunc`
- `golang.org/x/tools/go/analysis/passes/lostcancel` — the `go vet` pass for forgotten `cancel`

---

## Related Topics

- `01-cooperative-vs-force` — how a context-cancelled goroutine eventually reaches the function that owns its defers
- `02-partial-cancellation` — when only part of a workflow is cancelled, cleanup ordering decides which resources stay alive
- The Concurrency overview's `01-goroutines/01-overview` — the rule that a goroutine's defers run when that goroutine exits, not when its parent does
- Panic / recover patterns (covered later in the Errors-and-Panics track)
- `context.Context` — the source of the `cancel` you should always defer

---

## Diagrams & Visual Aids

### The defer stack

```
   function body executes
        defer A     ┌───┐
        defer B     │ A │
        defer C     ├───┤
                    │ B │
                    ├───┤
                    │ C │  <- top
                    └───┘

   on return, pop top to bottom:
        run C
        run B
        run A
   then return to caller
```

### LIFO matches natural resource nesting

```
   acquire DB connection         release: 3rd
   acquire transaction           release: 2nd
   acquire prepared statement    release: 1st
                                 (LIFO unwinding = correct order)
```

### Defer argument capture

```
   defer fmt.Println(x)
       ^^^^^^^^^^^^^^
       x is evaluated NOW
       its value is stored in the defer record

   later, at function exit:
       Println is called with the stored value
       not with x's current value
```

### Defer and panic

```
   normal exit:   body -> defers (LIFO) -> return
   panic exit:    body -> panic -> defers (LIFO) -> propagate panic
                                        ^
                                        recover() here can catch the panic
   os.Exit:       body -> Exit (no defers, no recover)
   Goexit:        body -> Goexit -> defers (LIFO) -> goroutine ends
```

### Goroutine-scoped defers

```
   parent()  --[go child()]-->  child()
       │                          │
       │  defer P_done            │  defer C_done
       │                          │
       └─ returns: runs P_done    └─ returns: runs C_done
                                        independent stacks
```

### `defer cancel()` vs resource cleanup

```
   ctx, cancel := context.WithTimeout(...)
   defer cancel()              <- releases context's internal timer

   f, _ := os.Open(...)
   defer f.Close()             <- releases the OS file descriptor

   These are SEPARATE defers. Each closes a different thing.
```

### A typical request handler

```
   handler:
     defer span.End()          (registered 1st)
     defer cancel()            (registered 2nd)
     defer body.Close()        (registered 3rd)

   on return:
     body.Close()   (pop 3rd)
     cancel()       (pop 2nd)
     span.End()     (pop 1st, last)

   → spans always close last, capturing everything
```

---

## Extended Worked Examples

The remaining examples in this section take a single resource each and walk through it from acquisition to clean release in real code. They build on Examples 1–15 but spend more time on the *reasoning* — not just "what is the right pattern," but "why is it the right pattern, and what breaks if you deviate."

### Example 16: A complete file copy, with both reads and writes safe

```go
package main

import (
    "errors"
    "fmt"
    "io"
    "os"
)

func copyFile(src, dst string) (err error) {
    in, err := os.Open(src)
    if err != nil {
        return fmt.Errorf("open src: %w", err)
    }
    defer func() {
        if cerr := in.Close(); cerr != nil && err == nil {
            err = fmt.Errorf("close src: %w", cerr)
        }
    }()

    out, err := os.Create(dst)
    if err != nil {
        return fmt.Errorf("create dst: %w", err)
    }
    defer func() {
        if cerr := out.Close(); cerr != nil && err == nil {
            err = fmt.Errorf("close dst: %w", cerr)
        }
    }()

    if _, err = io.Copy(out, in); err != nil {
        return fmt.Errorf("copy: %w", err)
    }
    if err = out.Sync(); err != nil {
        return fmt.Errorf("sync: %w", err)
    }
    return nil
}

func main() {
    if err := copyFile("/etc/hostname", "/tmp/hostname.copy"); err != nil {
        if errors.Is(err, os.ErrNotExist) {
            fmt.Println("source missing")
            return
        }
        fmt.Println("error:", err)
        return
    }
    fmt.Println("copy ok")
}
```

Notice the structure:
- Two acquisitions, each followed immediately by `defer`.
- Both deferred closures use the named return `err` to propagate close errors *only when no earlier error has already been observed*. This avoids overwriting a real `io.Copy` failure with a cosmetic close error.
- `Sync` is called explicitly before the deferred `Close` to flush kernel buffers — important for any "the file must be on disk before I do X" workflow.
- LIFO ordering means `out` closes before `in`. The writer is the last resource we touched, so it closes first. Correct.

### Example 17: A defer that releases a lock under conditions

```go
package main

import (
    "fmt"
    "sync"
)

type Cache struct {
    mu    sync.Mutex
    items map[string]string
}

func (c *Cache) GetOrLoad(key string, load func() (string, error)) (string, error) {
    c.mu.Lock()
    if v, ok := c.items[key]; ok {
        c.mu.Unlock()         // release before doing nothing further
        return v, nil
    }
    c.mu.Unlock()             // release during the slow load

    v, err := load()
    if err != nil {
        return "", err
    }

    c.mu.Lock()
    defer c.mu.Unlock()
    if existing, ok := c.items[key]; ok {
        return existing, nil  // someone else loaded it; discard ours
    }
    c.items[key] = v
    return v, nil
}

func main() {
    c := &Cache{items: map[string]string{}}
    v, _ := c.GetOrLoad("k", func() (string, error) { return "v1", nil })
    fmt.Println(v)
}
```

This example is deliberately *not* a textbook "lock; defer unlock; do work; return." The function locks, briefly checks state, *unlocks*, runs a slow load, then locks again. The final lock is paired with a `defer Unlock` because the rest of the function is short and we know we want to release on every exit path. The earlier `Unlock` is explicit because we need to release *before* the slow operation, not on function exit.

Lesson: `defer mu.Unlock()` is right when the locked region extends to function exit. When it does not, plain `Unlock` is right.

### Example 18: A defer that runs even when an inner goroutine panics

```go
package main

import (
    "fmt"
    "sync"
)

func runWorkers(n int) {
    var wg sync.WaitGroup
    defer wg.Wait() // ensure we do not leave until all workers exit

    for i := 0; i < n; i++ {
        wg.Add(1)
        i := i
        go func() {
            defer wg.Done()
            defer func() {
                if r := recover(); r != nil {
                    fmt.Printf("worker %d recovered from %v\n", i, r)
                }
            }()
            if i == 2 {
                panic("boom")
            }
            fmt.Println("worker", i, "done")
        }()
    }
}

func main() {
    runWorkers(4)
    fmt.Println("main done")
}
```

Two important points:
1. `defer wg.Wait()` at the top of `runWorkers` is registered first, so it pops *last*. That is what we want: the function should wait for workers *after* doing everything else.
2. Each worker has *two* defers: `wg.Done()` (registered first, pops last) and the recover-closure (registered second, pops first). The recover runs *before* `wg.Done`, so the recover sees the panic, prints, returns; then `wg.Done` decrements. If we had swapped the order, `wg.Done` would run while a panic was still in flight, then the recover would catch it — but the wait group would already be decremented. Same effect for this case, but the principle (cleanup-before-counter-decrement) is good practice.

### Example 19: A trace probe that survives panics

```go
package main

import (
    "fmt"
    "time"
)

func trace(name string) func() {
    start := time.Now()
    fmt.Printf("[ENTER %s]\n", name)
    return func() {
        fmt.Printf("[EXIT  %s after %s]\n", name, time.Since(start))
    }
}

func doWork() {
    defer trace("doWork")()
    time.Sleep(50 * time.Millisecond)
}

func mayCrash() {
    defer trace("mayCrash")()
    panic("planned")
}

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    doWork()
    mayCrash()
}
```

Output is roughly:

```
[ENTER doWork]
[EXIT  doWork after 50ms]
[ENTER mayCrash]
[EXIT  mayCrash after 0s]
recovered: planned
```

The trace probe prints `EXIT` for `mayCrash` *before* the panic propagates because deferred functions run on panic. This is exactly why `defer` is the right tool for tracing.

### Example 20: Manual cleanup when defer is awkward

Sometimes a function must release a resource *before* it exits — for example, to release a lock while doing slow I/O, or to release a file descriptor that the OS limits. In these cases, `defer` is still useful for the *fallback* — the case where you forget to release manually or an error interrupts you. The pattern:

```go
package main

import (
    "fmt"
    "os"
)

func process(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    closed := false
    defer func() {
        if !closed {
            _ = f.Close()
        }
    }()

    if _, err := f.Stat(); err != nil {
        return err
    }
    // explicit close before doing more work
    if err := f.Close(); err != nil {
        return err
    }
    closed = true

    // ... more work that does not need the file ...
    return nil
}

func main() {
    if err := process("/etc/hostname"); err != nil {
        fmt.Println(err)
    }
}
```

The `closed` boolean prevents a double-close. The defer is a safety net: if we forget to set `closed = true`, or if an error skips that line, the file still gets closed.

### Example 21: Nested defers in nested scopes

A common pattern in Go's standard library is a "function-with-helper" structure where the helper has its own defer scope:

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    for _, path := range []string{"/etc/hostname", "/etc/hosts"} {
        if err := show(path); err != nil {
            fmt.Println(path, "→", err)
        }
    }
}

func show(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()

    fi, err := f.Stat()
    if err != nil {
        return err
    }
    fmt.Printf("%-20s %d bytes\n", path, fi.Size())
    return nil
}
```

Each call to `show` has its own `defer f.Close()`. The file closes promptly after each call, regardless of what happens in the next call. This is the canonical fix for the "defer-in-loop" bug.

### Example 22: A short-lived context inside a loop

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    for i := 0; i < 3; i++ {
        if err := tick(i); err != nil {
            fmt.Println("tick", i, "→", err)
        }
    }
}

func tick(i int) error {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()

    select {
    case <-time.After(50 * time.Millisecond):
        fmt.Println("tick", i, "completed")
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Each iteration creates its own context with its own `cancel`, deferred immediately. When `tick` returns, `cancel` fires, releasing the timer. The loop runs three independent rounds with no leaks.

### Example 23: A worker that respects its parent context

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()

    var wg sync.WaitGroup
    wg.Add(1)
    go worker(ctx, &wg)
    wg.Wait()
}

func worker(ctx context.Context, wg *sync.WaitGroup) {
    defer wg.Done()
    defer fmt.Println("worker cleanup")

    ticker := time.NewTicker(50 * time.Millisecond)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            fmt.Println("tick")
        }
    }
}
```

The worker has three defers, in registration order: `wg.Done`, `fmt.Println("worker cleanup")`, `ticker.Stop`. They pop in reverse:
1. `ticker.Stop()` — stops the timer goroutine inside `time.NewTicker`
2. `fmt.Println("worker cleanup")` — logs that the worker is exiting
3. `wg.Done()` — signals to `main` that the worker is fully done

If `main`'s `wg.Wait()` returned *between* steps 1 and 3, we would have a race: `main` would think the worker was done while it was still in the middle of cleanup. By placing `wg.Done` *first* in the registration list (= last in execution), we guarantee that "done" really does mean done.

### Example 24: Defer with a method on an interface

```go
package main

import "fmt"

type resource interface {
    Close() error
}

type fakeResource struct{ name string }

func (r *fakeResource) Close() error {
    fmt.Println("closing", r.name)
    return nil
}

func use(r resource) {
    defer r.Close()
    fmt.Println("using", r.(*fakeResource).name)
}

func main() {
    use(&fakeResource{name: "A"})
}
```

Output:

```
using A
closing A
```

`r.Close()` is a method-value bound to the interface. The defer stores the method-value plus its (zero) arguments. Even if `r` is reassigned in the body, the bound method-value already captured the original receiver — but be careful: in this snippet `r` is a parameter, not reassigned. In other code paths you might reassign it; the defer would still call the original.

### Example 25: A small "shutdown manager" the manual way

Before reaching for `context.AfterFunc`, it is worth seeing how you would build a small shutdown manager with just plain `defer`:

```go
package main

import "fmt"

type Shutdown struct {
    fns []func()
}

func (s *Shutdown) Add(fn func()) { s.fns = append(s.fns, fn) }

func (s *Shutdown) Run() {
    for i := len(s.fns) - 1; i >= 0; i-- {
        s.fns[i]()
    }
}

func main() {
    var s Shutdown
    defer s.Run()

    s.Add(func() { fmt.Println("close db") })
    s.Add(func() { fmt.Println("close redis") })
    s.Add(func() { fmt.Println("close logger") })

    fmt.Println("doing work")
}
```

Output:

```
doing work
close logger
close redis
close db
```

This is a minimal "registry of cleanup functions" run in LIFO order at process exit. It is *equivalent* to writing three defers — but it lets you register cleanups from helpers that do not own the top-level function. We will see a more sophisticated version using `context.AfterFunc` in `middle.md`.

### Example 26: Errors from multiple closes

```go
package main

import (
    "errors"
    "fmt"
)

type closer struct {
    name string
    err  error
}

func (c *closer) Close() error {
    fmt.Println("closing", c.name)
    return c.err
}

func use() (err error) {
    a := &closer{name: "a", err: errors.New("a failed")}
    defer func() {
        if cerr := a.Close(); cerr != nil {
            err = errors.Join(err, cerr)
        }
    }()
    b := &closer{name: "b"}
    defer func() {
        if cerr := b.Close(); cerr != nil {
            err = errors.Join(err, cerr)
        }
    }()
    return nil
}

func main() {
    fmt.Println("result:", use())
}
```

`b.Close` runs first (LIFO), succeeds. `a.Close` runs next, returns its error. `errors.Join` accumulates errors as the defers unwind. The final printed error includes `a failed`. If both had failed, the result would carry both.

### Example 27: Cleanup that must not run twice

Some resources are not safe to close twice — for example, certain network connections, channels, or sync.Once-protected handles. A pattern that ensures a single close:

```go
package main

import (
    "fmt"
    "sync"
)

type Once struct {
    closeFn func() error
    once    sync.Once
    err     error
}

func (o *Once) Close() error {
    o.once.Do(func() { o.err = o.closeFn() })
    return o.err
}

func main() {
    o := &Once{closeFn: func() error { fmt.Println("real close"); return nil }}
    defer o.Close()
    defer o.Close() // safe: only one real close
}
```

The `sync.Once` ensures the underlying close runs exactly once. The two deferred calls share that guarantee. Useful when you cannot easily prove statically that only one path closes the resource.

### Example 28: A panic in cleanup hides the original error

```go
package main

import "fmt"

func bad() (err error) {
    defer func() {
        panic("cleanup panic")
    }()
    return fmt.Errorf("original error")
}

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    fmt.Println("result:", bad())
}
```

Output:

```
recovered: cleanup panic
```

The original error from `bad` is *never returned*. The cleanup panic replaced the in-flight return. This is one reason to keep cleanup boring: do not call functions that might panic from inside a defer unless you are wrapping them with a `recover`.

### Example 29: A defer registered conditionally

```go
package main

import (
    "fmt"
    "os"
)

func conditional(needFile bool) error {
    if needFile {
        f, err := os.Open("/etc/hostname")
        if err != nil {
            return err
        }
        defer f.Close()
        fmt.Println("file opened")
    }
    fmt.Println("doing work")
    return nil
}

func main() {
    _ = conditional(true)
    _ = conditional(false)
}
```

The defer is registered only when `needFile` is true. When the function exits, the defer stack may be empty (the false branch) or contain the close (the true branch). Both behaviours are correct because the defer is a normal statement and obeys normal control flow.

### Example 30: Defer with anonymous struct returns

```go
package main

import "fmt"

func info() (out struct {
    name string
    n    int
}) {
    defer func() { out.n = len(out.name) }()
    out.name = "hello"
    return
}

func main() {
    i := info()
    fmt.Println(i.name, i.n)
}
```

Output:

```
hello 5
```

The deferred closure reads and writes the named return value (`out`) after the body has set its `name`. This works for any composite named return, not just plain primitives.

---

## More Coding Patterns

### Pattern 7: Save/restore environment in tests

```go
func TestSomething(t *testing.T) {
    old := os.Getenv("DEBUG")
    os.Setenv("DEBUG", "1")
    defer os.Setenv("DEBUG", old)
    // ... test ...
}
```

Restore the previous value on exit, regardless of whether the test panicked or returned.

### Pattern 8: Pair `Lock`/`Unlock` with `defer`, but unlock early when you need to

```go
mu.Lock()
defer mu.Unlock()
if cheapCheck() {
    return
}
mu.Unlock()
slowWork()
mu.Lock()
// no need to re-defer; the original defer will fire
```

The deferred `Unlock` fires on function return. If you `Unlock` and `Lock` again inside the body, the deferred call still matches the *final* state. A double-unlock panics on `sync.Mutex`; do not let that happen.

### Pattern 9: Defer the cancel of every derived context

```go
ctx1, cancel1 := context.WithCancel(parent)
defer cancel1()
ctx2, cancel2 := context.WithTimeout(ctx1, time.Second)
defer cancel2()
ctx3, cancel3 := context.WithDeadline(ctx2, deadline)
defer cancel3()
```

Each `cancel` is independent. Each is small. Defer all of them.

### Pattern 10: Cleanup that runs even if the goroutine is the only reference

```go
go func() {
    defer cleanup()
    work()
}()
```

Even if no other code is waiting for this goroutine, its defer still runs when it exits (return or panic — but *not* if the whole program exits first).

---

## More Common Mistakes

### Mistake 8: A defer that captures by closure but the variable was reassigned

```go
// BUG
f, _ := os.Open("a.txt")
defer func() { f.Close() }() // captures variable f
f, _ = os.Open("b.txt")      // reassigns; "a.txt" is leaked!
defer func() { f.Close() }() // closes "b.txt" twice? no — only once
```

The first closure captures the *variable* `f`. By the time it runs, `f` points to "b.txt". The first file is leaked. Either copy `f` into a fresh local before the defer, or use `defer f.Close()` (the method form, which captures the receiver by value).

### Mistake 9: Defer after a check that may return without acquiring

```go
// SUBTLE: this is correct.
f, err := os.Open(path)
if err != nil {
    return err // no defer; no resource to release
}
defer f.Close() // only registered after acquisition succeeded
```

But:

```go
// BUG
defer f.Close() // f is nil here — panics when defer fires
f, err := os.Open(path)
```

Always acquire first, *then* defer.

### Mistake 10: Confusing return values that are set after defer fires

```go
// BUG?
func read() error {
    f, err := os.Open(path)
    if err != nil { return err }
    defer f.Close()
    if _, err := io.ReadAll(f); err != nil {
        return err
    }
    return nil
}
```

This is *correct*, not buggy. The `:= err` inside the if creates a new local `err` — but the function only returns `nil` at the end, or the outer `err` at the top. No defer-related bug here. But contrast with:

```go
// BUG: close error swallowed
func read() error {
    f, err := os.Open(path)
    if err != nil { return err }
    defer f.Close() // discards Close's error
    _, err = io.ReadAll(f)
    return err
}
```

The close error is dropped. For reads, that is usually fine. For writes, it is not.

### Mistake 11: Using `defer` to release a lock you only briefly held

A common over-use: holding a lock for the entire function when you really only need it for two lines. `defer mu.Unlock()` is convenient but extends the critical section. If the function does slow I/O, your lock is now held during that I/O. Refactor.

---

## Even More Tricky Points

- **Defer order across receiver and arguments.** `defer obj.Method(expensive())` evaluates `obj` *and* `expensive()` immediately, then schedules the call. If `expensive()` panics, the defer is never registered — the panic happens at the defer line.
- **`return` with multiple values and defers.** With named returns `(a, b int)`, a deferred function can modify *either*. With unnamed returns, the defer cannot see them.
- **Defer interaction with `goto`.** A `goto` that jumps out of a block does not skip defers for any function that has not yet returned. Defers run only at function exit, not at block exit.
- **Defers in deferred panics.** If you call `panic` inside a deferred function, the *original* panic value is discarded, and the *new* one propagates. The next defer in the stack still runs.
- **Closure traps with `range`.** Pre-Go-1.22 `for i, v := range xs { defer fn(v) }` captured `v` per defer (since `v` is the argument, evaluated at defer line). But `for i, v := range xs { defer func() { fn(v) }() }` shared `v` across closures, printing the last value many times. Go 1.22 fixed this by giving each iteration its own `v`.

---

## Extended Self-Test

```go
package main

import "fmt"

func main() {
    defer fmt.Println("1")
    func() {
        defer fmt.Println("2")
        defer fmt.Println("3")
        fmt.Println("4")
    }()
    defer fmt.Println("5")
    fmt.Println("6")
}
```

Predict the output. Answer:

```
4
3
2
6
5
1
```

Reason: the inner anonymous function has its own defer stack, which unwinds when it returns. Then `main` continues and prints `6`. Then `main` returns and its defers pop: `5`, then `1`.

Another:

```go
package main

import "fmt"

func first() (n int) {
    defer func() { n++ }()
    return 10
}

func second() int {
    n := 10
    defer func() { n++ }()
    return n
}

func main() {
    fmt.Println(first(), second())
}
```

Output: `11 10`. The named return in `first` is visible to the defer, which increments it after `return 10` assigns. The unnamed return in `second` is captured by value at the `return n` statement; the defer increments the local `n`, but the function has already chosen its return value.

### Another tricky case

```go
package main

import "fmt"

func tricky() int {
    n := 0
    defer func() { n++ }()
    return n
}

func main() {
    fmt.Println(tricky())
}
```

Output: `0`. Unnamed return — the function captures `n` (value 0) at the `return` line, then runs the defer (which increments the local `n` to 1, but the return value is already 0).

---

## Diagrams: Acquisition vs Release Order

```
Code order            Defer registration order   Run order at exit
─────────────────────────────────────────────────────────────────
open A                push A                     pop C  (run close C)
defer close A          stack: [A]                pop B  (run close B)
open B                push B                     pop A  (run close A)
defer close B          stack: [A, B]
open C                push C
defer close C          stack: [A, B, C]
```

LIFO is exactly "close in reverse of open." No bookkeeping needed.

```
Wrong order                Right order
───────────────────────────────────────────
close A                    close C
close B                    close B
close C                    close A
↑                          ↑
"close the outer first"    "close the inner first"
breaks invariants          preserves them
```

That picture is the whole reason `defer` is LIFO and not FIFO.

---

## A Longer Worked Story: Building Up a Small Service

The rest of this file walks through one extended example — a tiny in-process job runner — to show how cleanup ordering unfolds when you assemble a few moving parts. We add features one at a time, each one introducing one more thing that must be cleaned up.

### Step 1: A function that opens a file

```go
package main

import (
    "fmt"
    "io"
    "os"
)

func loadJobs(path string) ([]string, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close()
    data, err := io.ReadAll(f)
    if err != nil {
        return nil, err
    }
    return splitLines(data), nil
}

func splitLines(b []byte) []string {
    var out []string
    cur := []byte{}
    for _, c := range b {
        if c == '\n' {
            out = append(out, string(cur))
            cur = cur[:0]
        } else {
            cur = append(cur, c)
        }
    }
    if len(cur) > 0 {
        out = append(out, string(cur))
    }
    return out
}

func main() {
    jobs, err := loadJobs("/etc/hostname")
    if err != nil {
        fmt.Println(err); return
    }
    fmt.Println("jobs:", jobs)
}
```

Cleanup: one defer, closes the file. Trivial.

### Step 2: Add a mutex around shared state

```go
package main

import (
    "fmt"
    "sync"
)

type Runner struct {
    mu      sync.Mutex
    counter int
}

func (r *Runner) bump() {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.counter++
}

func main() {
    r := &Runner{}
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            r.bump()
        }()
    }
    wg.Wait()
    fmt.Println(r.counter)
}
```

Two kinds of defer here:
- `defer r.mu.Unlock()` inside `bump` — releases the lock on exit.
- `defer wg.Done()` inside each goroutine — decrements the wait group, even if the goroutine panics.

If we removed `defer wg.Done()` and `r.bump()` panicked, `wg.Wait()` would block forever. The defer is part of why this code is robust.

### Step 3: Add a context with cancellation

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Runner struct {
    mu      sync.Mutex
    counter int
}

func (r *Runner) bump() {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.counter++
}

func (r *Runner) Run(ctx context.Context) {
    ticker := time.NewTicker(20 * time.Millisecond)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            r.bump()
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()

    r := &Runner{}
    var wg sync.WaitGroup
    wg.Add(1)
    go func() { defer wg.Done(); r.Run(ctx) }()
    wg.Wait()
    fmt.Println("bumps:", r.counter)
}
```

Cleanup story now:
- `main` defers `cancel` (releases the timeout's internal goroutine and signals child contexts).
- The goroutine defers `wg.Done` (so main knows when it is safe to exit).
- `Run` defers `ticker.Stop` (releases the ticker).

If `main`'s timeout fires, `ctx.Done()` closes, `Run` sees it and returns, `ticker.Stop` fires, `wg.Done` fires, `wg.Wait` returns, `defer cancel` fires, `main` exits. Five defers in three scopes. None of them was registered with knowledge of the others; each one cleans up its own piece.

### Step 4: Add a file we write to during work

```go
package main

import (
    "context"
    "fmt"
    "os"
    "sync"
    "time"
)

type Runner struct {
    mu      sync.Mutex
    counter int
    out     *os.File
}

func (r *Runner) bump() {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.counter++
    fmt.Fprintln(r.out, "bump", r.counter)
}

func (r *Runner) Run(ctx context.Context) {
    ticker := time.NewTicker(20 * time.Millisecond)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            r.bump()
        }
    }
}

func main() {
    f, err := os.Create("/tmp/run.log")
    if err != nil {
        fmt.Println(err); return
    }
    defer func() {
        if cerr := f.Close(); cerr != nil {
            fmt.Println("close error:", cerr)
        }
    }()

    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()

    r := &Runner{out: f}
    var wg sync.WaitGroup
    wg.Add(1)
    go func() { defer wg.Done(); r.Run(ctx) }()
    wg.Wait()
    fmt.Println("bumps:", r.counter)
}
```

Order of defers in `main`:
1. `defer f.Close()` (registered first → runs last)
2. `defer cancel()` (registered second → runs second-to-last)
3. (the goroutine's defers run inside the goroutine when it exits, before `wg.Wait` returns)

When `main` returns: `cancel()` runs first, then `f.Close()`. That order matters: if `f.Close()` ran first, the goroutine might still be trying to write to `f` and would hit an "already closed" error.

But wait — the goroutine has already exited by this point, thanks to `wg.Wait()`. So actually, either order would be safe. But the *style* matters: we always cancel before closing files because if for some reason `wg.Wait()` was missing, the cancel-then-close order would at least give the goroutine a chance to notice the cancellation before its writes panicked.

### Step 5: Add `context.AfterFunc` for guaranteed-after-cancel cleanup

Imagine we want to log a message *every time* the context is cancelled, no matter how. `defer` cannot do this directly — `defer` runs at function exit, not at cancel. `context.AfterFunc` is the tool:

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()

    stop := context.AfterFunc(ctx, func() {
        fmt.Println("after-func: context cancelled, cause =", context.Cause(ctx))
    })
    defer stop()

    fmt.Println("doing work")
    time.Sleep(200 * time.Millisecond)
}
```

When the timeout fires, `AfterFunc` runs the callback in a fresh goroutine. The `stop` is deferred so that if we exit cleanly *before* cancellation, we deregister the callback. The combination of `AfterFunc` + `defer stop()` is the canonical 1.21+ pattern.

We will go deep on `AfterFunc` in `middle.md` and `senior.md`. For now, just appreciate that some cleanup naturally belongs to "after cancel," not "at function exit" — and Go gave us a primitive for it in 1.21.

### Step 6: Putting it all together with order analysis

Here is the full small service. Note where each defer is registered and predict the unwinding order.

```go
package main

import (
    "context"
    "fmt"
    "os"
    "sync"
    "time"
)

type Runner struct {
    mu      sync.Mutex
    counter int
    out     *os.File
}

func (r *Runner) bump() {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.counter++
    fmt.Fprintln(r.out, "bump", r.counter)
}

func (r *Runner) Run(ctx context.Context) {
    ticker := time.NewTicker(20 * time.Millisecond)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            r.bump()
        }
    }
}

func main() {
    f, err := os.Create("/tmp/run.log")
    if err != nil { fmt.Println(err); return }
    defer func() {
        fmt.Println("closing log file")
        if cerr := f.Close(); cerr != nil {
            fmt.Println("close error:", cerr)
        }
    }()

    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer func() {
        fmt.Println("cancel context")
        cancel()
    }()

    stop := context.AfterFunc(ctx, func() {
        fmt.Println("after-func: cancelled")
    })
    defer func() {
        fmt.Println("deregister after-func")
        stop()
    }()

    r := &Runner{out: f}
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer fmt.Println("goroutine exit")
        r.Run(ctx)
    }()
    fmt.Println("main: waiting")
    wg.Wait()
    fmt.Println("main: done waiting")
}
```

Approximate output when running on a 200ms timeout with 20ms ticks:

```
main: waiting
after-func: cancelled
goroutine exit
main: done waiting
deregister after-func
cancel context
closing log file
```

Note the LIFO unwinding of `main`'s defers: `deregister after-func`, then `cancel context`, then `closing log file`. They were registered in the opposite order: `f.Close`, `cancel`, `stop`.

This is what cleanup ordering looks like in real Go code. The picture is small but every line earns its place.

### Step 7: What would go wrong with the wrong order?

What if we registered `f.Close()` *after* `stop()`?

```go
stop := context.AfterFunc(ctx, doStuff)
defer stop()

f, _ := os.Create("/tmp/run.log")
defer f.Close()
```

Now `f.Close()` runs *first* at exit (LIFO), then `stop()`. If the `AfterFunc` callback `doStuff` writes to `f`, and the callback is still in flight when we run `stop`, we have already closed `f`. Result: the callback writes to a closed file.

Why is this even possible? Because `stop()` does *not* wait for an in-flight callback to finish. It either deregisters a callback that has not yet started, or it does nothing if the callback has already started. So there is a race window where the callback runs against a closed `f`.

The fix is exactly what we had: register `f.Close()` *before* `stop`, so `stop()` runs first at exit. Or, more conservatively, call `cancel()` explicitly, then sleep/synchronise to make sure the callback finished, then close `f`. We will explore this in `senior.md`.

For now, internalise the principle: *the order in which you defer cleanup is the order in which it runs in reverse. Choose your acquisition order so that LIFO release matches the dependency direction.*

---

## Wrap-up: The Junior's Checklist for Cleanup Ordering

You now have:

- The mental model of the per-function defer stack
- The LIFO rule, with the right intuition for why
- Argument-vs-closure capture semantics
- Twelve or so concrete patterns you will actually use in real code
- The three or four most common bugs with their fixes
- A sketch of how `defer` interacts with `panic`, `recover`, `context`, and `AfterFunc`
- A worked example that grew from one file to a small service with five cleanup layers

The middle file picks up where this one stops: errors from deferred close, cleanup that must survive context cancellation, `context.AfterFunc` for real, and the wider question of how cleanup ordering interacts with goroutine lifecycles.

Before moving on, make sure you can answer these from memory:

- In `defer fmt.Println(x)`, when is `x` evaluated?
- In `defer func() { fmt.Println(x) }()`, when is `x` read?
- What happens if you `defer f.Close()` and then `panic`?
- What happens if you `os.Exit` from inside a function with three pending defers?
- Why is `for ... { defer f.Close() }` a bug?
- Why must `context.WithTimeout`'s cancel be deferred?
- What does `context.AfterFunc` do that `defer` cannot?

If those answers come quickly, you are ready for the middle file.

---

## FAQ — Questions Juniors Actually Ask

**Q. Is `defer` part of the language or part of the standard library?**

It is a language construct, defined in the Go specification. The runtime supplies the implementation, but `defer` itself is a keyword like `for` or `return`.

**Q. Can I `defer` an expression, or only a function call?**

Only a function (or method) call. `defer 1 + 2` does not compile. The right-hand side of `defer` must be a syntactic call: `defer f()`, `defer obj.Method(x, y)`, or `defer func() { ... }()`.

**Q. Does the deferred function see changes to the function's local variables made after the `defer` line?**

Closures over local variables: yes (the closure captures the variable, not its value at defer time).
Arguments passed to the deferred call: no (arguments are evaluated at the defer line).

**Q. Can I `recover` outside a deferred function?**

You can call `recover()`, but it returns nil if not called from inside a deferred function that is currently unwinding a panic. The intended use is exclusively from inside a defer.

**Q. Does `defer` have any heap cost?**

In Go ≥ 1.14, simple defers that the compiler can prove are not inside a loop are *open-coded*: they compile to a small block of conditional cleanup at the function's exit point with no heap allocation. Defers that the compiler cannot open-code allocate a small `_defer` record on the goroutine's defer chain. Allocation is roughly one struct per defer.

**Q. Is `defer` slower than calling cleanup manually?**

In microbenchmarks, manual cleanup is faster. In real programs, the difference is rarely measurable. Use defer for correctness; profile before optimising.

**Q. What if my deferred function takes a long time?**

It still runs. The function does not return to its caller until all defers finish. If your defer does I/O that takes seconds, your function takes seconds to return. This is rarely what you want.

**Q. Can I cancel a defer once it is registered?**

Not directly. You can make the deferred call a no-op by setting a flag that the closure checks:

```go
canceled := false
defer func() { if !canceled { cleanup() } }()
// ... later ...
canceled = true
```

But this is rarely useful.

**Q. Why do all my deferred Closes silently fail in production?**

Probably because you wrote `defer f.Close()` without checking the error. For writes, swap in the named-return pattern:

```go
defer func() {
    if cerr := f.Close(); cerr != nil && err == nil {
        err = cerr
    }
}()
```

**Q. Should I always use the named-return pattern?**

For functions that *write* and then close, yes. For functions that only *read*, the cost of the pattern outweighs the benefit (read-close almost never fails meaningfully).

**Q. Why does `go vet` warn me about a missing `cancel`?**

Because functions like `context.WithCancel` and `context.WithTimeout` return a `cancel` function that you must invoke. Forgetting it leaks the context's internal goroutine and timer. The vet check is called `lostcancel`.

**Q. Can I defer in `main`?**

Yes. `main`'s defers run before the program exits — unless you call `os.Exit`, in which case they do not. This is one reason to avoid `os.Exit` in `main` and let `return` handle it.

**Q. What happens if the deferred function panics during another panic?**

The new panic replaces the old one. The old panic value is lost (unless something `recover`-ed it earlier). The next defer in the stack still runs with the new panic in flight.

**Q. Is `defer` thread-safe?**

The defer mechanism is per-goroutine, so there is no sharing. But the *function you defer* can have its own thread-safety issues — for example, `defer mu.Unlock()` is safe only if `mu` was locked by this goroutine.

**Q. Can I `defer` a method on a struct field?**

Yes: `defer obj.field.Method()`. Be aware that `obj` and `obj.field` are evaluated at the defer line. If `obj.field` is later reassigned, the defer still calls the *original* field's method.

**Q. Does `defer` work with generic functions?**

Yes. From the language's point of view, the deferred call is just a function call. Type parameters are erased at the defer site.

**Q. Should I defer in a function that already has a `recover`?**

The defer registers normally; the `recover` runs inside it. Common pattern:

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("recovered: %v", r)
    }
}()
```

The function's other defers still run normally — recover catches the panic, the function exits normally, the remaining defers fire on the way out.

**Q. Does the order of defers matter for performance?**

No. The defer chain is a linked list (or, for open-coded defers, a sequence of branches). Both pop quickly in LIFO order. The order matters only for *correctness*: which resource you release first.

**Q. Can a defer modify an unnamed return value?**

No. Unnamed returns are captured at the `return` statement; deferred functions cannot reach the values that have already been moved into the return slot. If you want a defer to influence the return, name your returns.

**Q. What happens if I defer inside `init`?**

`init`'s defers run when `init` returns, just like any function. There is nothing magical.

**Q. Is there a way to see the defer chain at runtime?**

Not portably. The runtime keeps the chain internally, but Go does not expose it. Debuggers like Delve can show it. In production, you cannot programmatically enumerate pending defers.

**Q. Can defer leak memory?**

A heap-allocated defer record costs a few dozen bytes. They are cleaned up when the function returns. A defer-in-loop bug *can* leak memory in the sense that many records accumulate until the enclosing function returns — at which point they all clear at once. The bigger leak is usually file descriptors or goroutines, not the defer records themselves.

**Q. What is the maximum number of defers in one function?**

There is no hard limit. The runtime can chain arbitrarily many. The compiler only open-codes the first eight (in Go 1.14+); the rest fall back to heap allocation. So eight is the "free" budget; beyond that you pay per defer.

**Q. Should I be afraid of nested defers in a closure?**

Not at all. The defer mechanism handles them correctly: the closure has its own defer scope, which unwinds when the closure returns. Just remember that the closure's defers run when the closure returns, not when the outer function returns.

**Q. What if I want a cleanup to run *before* every return, but only conditionally?**

Use a function:

```go
cleanup := func() { /* may be no-op */ }
defer cleanup()
// ... reassign cleanup as needed ...
```

The defer calls whatever `cleanup` happens to be at the moment it runs (because `cleanup` is captured by the closure — well, by the deferred call's receiver, which is the variable itself).

Actually wait: `defer cleanup()` evaluates `cleanup` at the defer line. So the *original* function is what runs, not a later reassignment. To get late-binding, wrap it: `defer func() { cleanup() }()`. Now the closure looks up `cleanup` at exit and runs whatever it points to.

This subtlety bites people. Remember:
- `defer f()` — `f` is looked up *now*, called later.
- `defer func() { f() }()` — closure looked up later; `f` looked up inside the closure when it runs.

---

The junior story ends here. The middle file picks up the deeper questions: errors from cleanup, AfterFunc semantics, and cleanup that must survive cancellation.

---

## One More Practice Drill

Read the code below carefully, predict the output, then run it.

```go
package main

import "fmt"

func a() (s string) {
    defer func() { s = s + "/a-defer" }()
    s = "a"
    return
}

func b() string {
    s := "b"
    defer func() { s = s + "/b-defer" }()
    return s
}

func c() (x int) {
    defer func() { x++ }()
    defer func() { x *= 2 }()
    x = 3
    return
}

func main() {
    fmt.Println(a())
    fmt.Println(b())
    fmt.Println(c())
}
```

Expected output:

```
a/a-defer
b
7
```

Reasoning:
- `a`: named return `s` starts as `"a"` after `s = "a"`. `return` assigns `s = "a"` to the return slot (no-op). Defer runs: `s` becomes `"a/a-defer"`. Function returns `"a/a-defer"`.
- `b`: unnamed return. `return s` captures the value `"b"`. Defer modifies the local `s`, but the return slot already has `"b"`.
- `c`: named return `x`. `x = 3`. `return` is a no-op. Defers pop LIFO: first `x *= 2` (x=6), then `x++` (x=7). Function returns `7`.

If you got all three right without running the code, you have internalised the rules. Move on to `middle.md`.

---

## Quick Reference Card (Printable)

```
DEFER CHEAT CARD
================
defer f()                       evaluate f and args NOW, run later
defer func() { ... }()          closure captures variables by ref
LIFO order at function exit
runs on return, runs on panic, NOT on os.Exit
runs in the goroutine that registered it
named returns: defer can read/write them
unnamed returns: defer cannot reach them

ALWAYS
  defer cancel()               for every context.With*
  defer mu.Unlock()            after mu.Lock() if region > 2 lines
  defer f.Close()              after a successful Open
  defer t.Stop()               for every NewTicker / NewTimer
  defer wg.Done()              at top of every goroutine using wg

NEVER
  defer in a tight loop        extract a helper
  defer on a returned resource caller owns it
  defer Close without err      for writers; use named-return pattern

CONTEXT
  cancel sends a signal, not a cleanup
  defer cancel() releases context's timer
  context.AfterFunc (1.21+) runs in a new goroutine on cancel
```

Tape this to your monitor for a week. After a week, you will not need it.
