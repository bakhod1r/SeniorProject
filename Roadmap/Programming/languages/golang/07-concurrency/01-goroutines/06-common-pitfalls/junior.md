# Goroutine Common Pitfalls — Junior Level

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
> Focus: "Here are the wrong-looking goroutines that every Go programmer ships at least once. Learn the shape, learn the fix, and learn the question you should have asked before writing them."

If you have read the previous five subsections, you can spawn goroutines, give them work, and wait for them with a `WaitGroup` or a channel. You also know that they are cheap, that they live in user space, that they share memory, and that an unrecovered panic kills the process.

What this subsection adds is a single skill: **pattern recognition for failure**. Goroutine bugs are not random typos — they come from a small number of repeating shapes. Once you know the shapes, you can spot them on a code review at a glance:

- A `for` loop with `go func()` that closes over a variable instead of taking it as a parameter
- A `wg.Add(1)` written inside the goroutine body, after `go`
- A `time.Sleep(time.Second)` used to "wait for the goroutines to finish"
- A `go someTask()` with no obvious answer to "how does this goroutine exit?"
- A `chan int` that has a sender but no guaranteed reader
- A `panic` in a worker goroutine with no `recover` at the boundary
- A `map[string]int` that two goroutines write to without a `Mutex`
- A `time.After(...)` inside a `select` loop that ticks every iteration
- A `context.WithCancel` whose `cancel` is never called
- A `defer` piling up inside a tight loop in a long-running goroutine
- A `mu.Lock()` followed by a blocking network call

This file gives each of these its own example, root cause, and fix. By the end you should be able to read someone else's pull request and feel a little chill — the *correct* chill — at every one of these patterns.

A note on scope. This file *catalogues* pitfalls. Some, especially goroutine leaks, are deep enough that they deserve their own subsection. In those cases you will see a pointer to the deeper coverage. The goal here is fast recognition, not exhaustive analysis.

---

## Prerequisites

- **Required:** You have read `01-overview`, `02-vs-os-threads`, `03-stack-growth`, `04-runtime-management`, and `05-best-practices` in this same goroutines section.
- **Required:** You can spawn a goroutine, use `sync.WaitGroup`, and you understand that channels carry values between goroutines.
- **Required:** Familiarity with closures and function literals — many pitfalls live in the closure body.
- **Required:** Working `go` toolchain, preferably 1.22 or newer. The loop-variable pitfall behaves differently before 1.22.
- **Helpful:** You have run `go test -race` at least once and have seen the race detector report a race.
- **Helpful:** Awareness that `context.Context` exists. It is covered in depth later, but it appears in a handful of pitfalls here.

If you can write a short program that spawns ten goroutines, waits for them, and prints a counter — and you understand why a bare `counter++` from many goroutines is wrong — you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Pitfall** | A wrong-looking but compilable code pattern that produces incorrect behaviour at runtime. Not a syntax error. |
| **Captured loop variable** | A variable declared in a `for` header that a closure references; before Go 1.22 a single variable was shared across iterations, causing all goroutines to read the same value. |
| **Goroutine leak** | A goroutine that does not exit when it should, holding memory and resources until the program ends. |
| **Data race** | Two goroutines accessing the same memory location without synchronisation, where at least one is a write. Detected with `go test -race`. |
| **Deadlock** | All goroutines are blocked waiting on each other; nothing can make progress. Runtime detects the "all goroutines asleep" case and panics. |
| **Live lock** | All goroutines are running but no useful work happens (busy loops, ping-pong). Worse than deadlock — looks healthy on a CPU graph. |
| **Concurrent map access** | Two or more goroutines reading/writing a built-in `map` simultaneously. The runtime detects this and aborts the program with `fatal error: concurrent map writes`. |
| **Double close** | Calling `close(ch)` on the same channel twice. Panics with `close of closed channel`. |
| **Send on closed channel** | Sending a value on a channel after `close(ch)`. Panics with `send on closed channel`. |
| **`recover`** | Built-in function that stops a panic in progress, but only when called from a deferred function in the same goroutine. |
| **`sync.Once`** | A primitive that runs a function exactly one time, no matter how many goroutines call it. The canonical singleton initialiser. |
| **`context.Context`** | The standard idiom for carrying cancellation, deadlines, and request-scoped values across goroutine boundaries. |
| **`atomic`** | The `sync/atomic` package, providing lock-free reads and writes of integer and pointer values. Must not be mixed with non-atomic access to the same variable. |

---

## Core Concepts

### Pitfalls are not bugs in the runtime — they are bugs in the contract

The Go runtime is conservative. It does not prevent races, leaks, or panics; it only detects a few of them at runtime (the race detector, concurrent map access, deadlock with no runnable goroutines). Everything else — exit conditions, ownership, lifetime — is *your* contract to enforce. A "common pitfall" is a place where the contract is fragile and easy to violate without noticing.

Once you internalise this, every pitfall becomes a question:

- "How does this goroutine exit?"
- "Who owns this variable? Who reads, who writes, under what lock?"
- "Who closes this channel? Who guarantees the close happens?"
- "What happens if this function panics? What happens if it returns an error?"
- "What happens if the caller cancels?"

If you cannot answer all five, you have a pitfall waiting to happen.

### Most pitfalls split into three families

It helps to file pitfalls into mental categories:

1. **Lifetime bugs** — the goroutine starts and never stops, or stops too soon. *Examples:* leaks via unread channels, missing `cancel()`, ticker not stopped.
2. **Ordering bugs** — two goroutines do things in an unintended order. *Examples:* `wg.Add` inside the goroutine, `time.Sleep` as synchronisation, send-before-close races.
3. **Sharing bugs** — two goroutines touch shared state unsafely. *Examples:* captured loop variable, concurrent map access, atomic+non-atomic mixing.

Most of the file maps to one of these. When you see a new bug, ask: "Is this lifetime, ordering, or sharing?" The fix usually lives in that family.

### Pitfalls compound

A single bug is usually obvious. Real-world pitfalls compound: a captured loop variable shows up as wrong output, but only sometimes, because the data race made the actual symptom intermittent. A leaked goroutine causes the heap to grow slowly, but you only notice when an unrelated allocation pushes the GC over a threshold. The Go runtime almost never gives you a stack trace pointing at "the bug" — instead you get a downstream symptom and have to walk back.

This is why the bug catalogue matters. Knowing the shapes lets you walk back faster.

### `go` is a one-way door

There is no "undo." Once `go f()` executes, the goroutine is scheduled. You cannot cancel it from outside without explicit cooperation (a channel, a `context.Context`, an atomic flag the goroutine polls). Any pitfall that says "stop the goroutine" requires that the goroutine wanted to be stopped — that it polls a stop signal.

---

## Real-World Analogies

### Pitfalls are like loaded but uncocked traps

Each pitfall is a tripwire. The code compiles and may even run correctly on your laptop. The trap fires only when conditions align: high load, a particular OS, a specific Go version, a slow disk, a flaky network. The job of this file is to point at each tripwire and say "do not step here, even when nothing seems to happen."

### A leaked goroutine is like a tab you forgot to close

A browser tab open in the background uses no visible CPU. It holds memory, a TCP connection, a JS context. Multiply by a hundred tabs and your laptop fan spins. A leaked goroutine is the same — invisible while small, lethal at scale.

### A captured loop variable is like a passing baton with shared writing on it

Imagine relay runners passing a baton. Each runner writes their number on the baton with a single shared marker. By the time you read the baton, only the last writer's number is visible. That is closure capture of a single shared variable.

### A `wg.Add(1)` inside the goroutine is like sending an invitation after the meeting started

The meeting is `wg.Wait()` — it begins when the counter is zero. If you send the invitation (`Add`) after the meeting started, the meeting is already over. The goroutine arrives to find an empty room.

### A `time.Sleep` for synchronisation is like setting a kitchen timer for "hopefully long enough"

Sometimes the cake bakes in 30 minutes. Sometimes 45. If your timer is set to 35 minutes, sometimes you eat raw cake. The fix is a thermometer (`WaitGroup`), not a longer timer.

---

## Mental Models

### Model 1: The "exit slip" rule

Every goroutine must have an answer to *one* question on its exit slip: "When does this goroutine return?" If you write `go f()` and cannot answer the question in one sentence, you have a leak waiting to happen. Acceptable answers include:

- "When `f` returns, which it does after processing one item."
- "When `ctx.Done()` fires."
- "When the input channel is closed and drained."
- "When `done` is closed."

Unacceptable answers:

- "Eventually."
- "When the program exits."
- "I think it returns somewhere."

### Model 2: Pitfalls live in pairs

Most pitfalls have a *symmetric* pair that is also wrong:

- `wg.Add` outside, `wg.Done` outside → underflow / never zero
- `wg.Add` inside the goroutine → race with `Wait`
- `wg.Add` outside, `wg.Done` inside → correct
- `wg.Add` outside, `wg.Done` missing → `Wait` blocks forever

The mental shortcut: `Add` belongs to the parent (it knows how many to spawn). `Done` belongs to the child (it knows when it has finished its own work).

### Model 3: "The race detector is a sieve, not a fence"

`go test -race` catches *observed* races. It does not catch races that did not happen during the test run. A 99% safe codebase can still have a 1%-probability race that takes down production. The race detector raises confidence; it does not prove safety. Pair it with code review for the patterns in this file.

### Model 4: "If you cannot explain ownership, you cannot explain correctness"

For every shared variable, you must be able to say: "Goroutine X owns this for read. Goroutine Y owns this for write. The handoff happens at channel send / mutex unlock / context cancel." Variables without owners are bugs.

---

## Pros & Cons

This is a meta-section: the "pros and cons of knowing pitfalls."

### Pros of learning pitfalls explicitly

- **You read code faster.** You spot bad patterns visually, without running.
- **You write fewer bugs.** Pattern recognition flips into pattern avoidance.
- **You debug faster.** When a real bug shows up, the catalogue narrows the search.
- **You review better.** PR reviews become "I see the captured variable on line 42" instead of "looks fine to me."
- **You design defensively.** Knowing how `WaitGroup.Add` can race makes you write `Add` outside the goroutine on the first try.

### Cons / risks

- **You can become paranoid.** Not every shared variable needs a mutex. Some are immutable, some are owned by one goroutine.
- **You can over-engineer.** Adding a context and an `errgroup` and a buffered result channel to a 10-line script is wasteful.
- **You can mistake symptoms for causes.** A program that prints `5 5 5` could be the loop-variable bug *or* could be a logic bug that always assigns 5. The catalogue is a tool; thinking is still required.

---

## Use Cases

This subsection's "use cases" are the situations where you should reach for it:

| Situation | How this file helps |
|---|---|
| Reviewing a PR with `go func()` | Skim the bug catalogue for any matching shape. |
| Debugging "program hangs on shutdown" | Check the goroutine leak section, the missing `cancel()` section, and `wg.Done` audit. |
| Debugging "program crashes with no message" | Look at panic-in-goroutine, concurrent map access, double close. |
| Tracking a slow memory leak | Goroutine leaks, ticker not stopped, `time.After` in select loop. |
| "Tests pass but production is flaky" | Captured loop variable, `time.Sleep` for synchronisation, atomic mixing. |
| Onboarding a new Go engineer | This file as a checklist. |

---

## Code Examples

The examples below are organised by pitfall. Each one has the broken form, the symptom, the cause, and the fix.

### Example 1: Captured loop variable (the most common Go concurrency bug)

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(i)
        }()
    }
    wg.Wait()
}
```

**Symptom (Go ≤ 1.21).** Output is some permutation of `5 5 5 5 5`, or sometimes `3 5 5 5 5`, never `0 1 2 3 4`.

**Symptom (Go 1.22+).** Output is some permutation of `0 1 2 3 4`. The change in semantics fixed the bug *for the loop-variable case specifically*.

**Cause.** Pre-1.22, the variable `i` is a single variable shared across all iterations. The closure captures it by reference. By the time goroutines run, the loop has finished and `i == 5`. Go 1.22 made each iteration create a new `i`, which closures bind to.

**Fix that works on all versions.**

```go
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(i int) {        // parameter shadow
        defer wg.Done()
        fmt.Println(i)
    }(i)                    // pass the current value
}
```

The parameter `i` is its own variable in each goroutine's frame. Even on Go 1.5 from 2015 this works.

**Why prefer the parameter even on 1.22+?** Three reasons. First, the code is portable to old codebases. Second, the explicit pass shows intent: *I am snapshotting this value*. Third, the same pattern applies to variables that are not in the loop header — like `for _, x := range items { x := x; go ... }` — where you still need the shadow trick.

### Example 2: `wg.Add(1)` inside the goroutine

```go
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    go func() {
        wg.Add(1)           // BUG: races with Wait
        defer wg.Done()
        doWork()
    }()
}
wg.Wait()
```

**Symptom.** Sometimes `Wait` returns immediately, before any goroutine has called `Done`. The "all workers done" message prints with workers still running.

**Cause.** `wg.Wait()` runs concurrently with the goroutines. If the scheduler runs `Wait` before any goroutine has executed its `Add`, the counter is still zero — `Wait` returns immediately. The race is fundamental: the parent does not know whether the child has reached `Add` yet.

**Fix.**

```go
for i := 0; i < 10; i++ {
    wg.Add(1)               // in the parent, before go
    go func() {
        defer wg.Done()
        doWork()
    }()
}
wg.Wait()
```

`Add` in the parent runs in serial with the `for` loop; by the time `Wait` is called, the counter is 10. Then `Done` in each goroutine decrements it.

**Rule of thumb.** `Add` in the parent, `Done` in the child. Never the reverse.

### Example 3: Forgetting `wg.Done()`, or forgetting `defer`

```go
var wg sync.WaitGroup
wg.Add(1)
go func() {
    if condition {
        return              // BUG: forgot to call Done
    }
    work()
    wg.Done()
}()
wg.Wait()
```

**Symptom.** `Wait` blocks forever. If this is the main goroutine, the runtime reports a deadlock.

**Cause.** The early `return` path skipped `wg.Done()`. The counter stays positive forever.

**Fix.**

```go
go func() {
    defer wg.Done()         // runs on every exit path, including panic
    if condition {
        return
    }
    work()
}()
```

`defer wg.Done()` immediately after the parent's `Add` is the only style that survives early returns and panics.

### Example 4: `time.Sleep` as synchronisation

```go
go heavyWork()
time.Sleep(500 * time.Millisecond)
fmt.Println("hopefully done")
```

**Symptom.** Tests pass on the developer's machine, fail on a loaded CI runner. Or pass for a year and then fail in production on a slow VM.

**Cause.** `time.Sleep` is a hope, not a guarantee. The goroutine may take 600 ms, 2 s, or never finish. The program prints "hopefully done" with the work still running.

**Fix.** Use `WaitGroup`, a result channel, or `errgroup.Group`.

```go
done := make(chan struct{})
go func() {
    heavyWork()
    close(done)
}()
<-done
fmt.Println("definitely done")
```

**When sleep *is* okay.** In a test for a timing-dependent assertion (and even then, prefer `eventually` polling). In a `for { ...; time.Sleep(interval); }` loop where the sleep is the *whole purpose*, not a synchronisation primitive.

### Example 5: Unrecovered panic kills the program

```go
go func() {
    parseUserInput(input)   // can panic on malformed input
}()
```

**Symptom.** A single bad input crashes the entire HTTP server. Other goroutines mid-request die too.

**Cause.** A panic inside any goroutine, with no `recover` in that goroutine's `defer` chain, propagates to runtime termination. Recovering elsewhere does not help.

**Fix.** Wrap the goroutine body with a `recover` at the boundary.

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v\n%s", r, debug.Stack())
        }
    }()
    parseUserInput(input)
}()
```

**Better fix.** Make `parseUserInput` not panic on user input. Panics belong to *programmer errors*; bad input should return `error`. Use `recover` as defence in depth, not as an error-handling strategy.

### Example 6: Goroutine leak — sender blocked forever

```go
func compute() int {
    ch := make(chan int)    // unbuffered
    go func() {
        ch <- doWork()      // blocks until someone receives
    }()
    if cachedValue != nil {
        return *cachedValue // never read ch — leak
    }
    return <-ch
}
```

**Symptom.** `runtime.NumGoroutine()` slowly increases over time. Heap grows. Eventually OOM.

**Cause.** When `cachedValue != nil`, the function returns without receiving from `ch`. The goroutine's send blocks forever; the goroutine is leaked.

**Fix 1: buffer the channel.**

```go
ch := make(chan int, 1)
```

The send completes whether or not anyone reads. If no one reads, the goroutine exits and the buffered value is collected with the channel.

**Fix 2: always read.**

```go
result := <-ch
if cachedValue != nil {
    return *cachedValue
}
return result
```

Now the function always drains `ch` before returning.

For deep coverage of leak shapes, see the planned `07-goroutine-lifecycle-leaks` chapter (coming soon).

### Example 7: Goroutine leak — receiver on never-closed channel

```go
ch := make(chan Item)
go func() {
    for item := range ch {
        process(item)
    }
}()
// ... feed values for a while ...
// program continues, never closes ch — goroutine lives forever
```

**Symptom.** Same as Example 6: leak accumulating.

**Cause.** `for v := range ch` exits only when `ch` is closed. If it is never closed, the receiver waits forever.

**Fix.** Close the channel when the sender is done.

```go
defer close(ch)
```

If there are multiple senders, use the "single closer" pattern: one goroutine that knows when all senders are done (often a `WaitGroup` waiter) closes the channel.

### Example 8: Goroutine leak — ticker not stopped

```go
go func() {
    t := time.NewTicker(time.Second)
    for {
        select {
        case <-t.C:
            doTick()
        }
    }
}()
```

**Symptom.** Goroutine and ticker both leak. If created in a loop or a per-request handler, leak accumulates.

**Cause.** `for { select { ... } }` with only one case has no exit path. The ticker also has no `Stop()` call, so its internal goroutine and channel leak too.

**Fix.**

```go
go func() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            doTick()
        }
    }
}()
```

Always `defer t.Stop()` after `time.NewTicker(...)`. Always have an exit case in the select.

### Example 9: Concurrent map access — fatal error, not a race

```go
m := map[string]int{}
for i := 0; i < 100; i++ {
    go func(i int) {
        m[fmt.Sprintf("k%d", i)] = i
    }(i)
}
```

**Symptom.** Program crashes with `fatal error: concurrent map writes`. This is a runtime-detected fatal error; the process exits immediately. It is *not* a panic — `recover` does not catch it.

**Cause.** Go's built-in map is not safe for concurrent use. The runtime adds explicit checks to detect concurrent writes and aborts the program.

**Fix 1: lock around access.**

```go
var mu sync.Mutex
m := map[string]int{}
for i := 0; i < 100; i++ {
    go func(i int) {
        mu.Lock()
        m[fmt.Sprintf("k%d", i)] = i
        mu.Unlock()
    }(i)
}
```

**Fix 2: use `sync.Map` for the right shape of workload.**

```go
var m sync.Map
m.Store("k1", 42)
v, _ := m.Load("k1")
```

`sync.Map` is optimised for "write once, read many" or "disjoint key sets per goroutine." It is *slower* than `map + Mutex` for typical workloads.

### Example 10: Capturing pointers across goroutines

```go
type Request struct{ Data []byte }

for _, r := range requests {
    go process(&r)          // BUG: &r is the same address on every iteration (pre-1.22)
}
```

**Symptom.** All goroutines see the last request's data, or random subsets.

**Cause.** Same family as the captured loop variable: `r` is a single variable that the `for ... range` rebinds. `&r` is the same address every time. By the time the goroutines run, the slot holds whatever the loop left in it.

**Fix.**

```go
for _, r := range requests {
    r := r              // shadow
    go process(&r)
}
```

Or pass by value if possible: `go func(r Request) { process(&r) }(r)`.

### Example 11: Double-close of a channel

```go
ch := make(chan int)
close(ch)
close(ch)                   // panic: close of closed channel
```

**Symptom.** Panic. Cannot be recovered if it propagates out of a deferred function.

**Cause.** Closing the same channel twice is a programmer error. Often shows up when multiple senders each "close on exit" with `defer close(ch)`.

**Fix.** Single closer pattern: exactly one place in the program closes a given channel. See [02-channels/06-closing-channels](../../02-channels/06-closing-channels/) for the full treatment.

### Example 12: Send on closed channel

```go
ch := make(chan int)
close(ch)
ch <- 1                     // panic: send on closed channel
```

**Symptom.** Panic. Common when the closer closes too early or the senders did not observe the close.

**Cause.** Sending on a closed channel is always a panic. The language does not let senders test "is this channel closed?" reliably from outside — they must coordinate.

**Fix.** Reorder lifetimes so all senders finish before the channel is closed. Often via `wg.Wait(); close(ch)` in a goroutine that owns the close.

### Example 13: Closing a receive-only channel

```go
func consume(ch <-chan int) {
    close(ch)               // compile error: cannot close receive-only channel
}
```

**Symptom.** Compile error. This is the *easy* version of pitfall 12 — the compiler catches it.

**Cause.** Receive-only channels (`<-chan T`) can only be received from. The compiler enforces directionality.

**Fix.** Either keep the channel bidirectional inside the closing function, or restructure ownership so closing happens before the channel is narrowed to receive-only.

### Example 14: `time.After` in a select loop

```go
for {
    select {
    case msg := <-msgs:
        process(msg)
    case <-time.After(time.Second):
        return              // timeout
    }
}
```

**Symptom.** Memory grows under load. Each iteration of the `for` loop creates a new `Timer` from `time.After`. If `msgs` is busy, the timeout case is never selected, but the timer is not garbage-collected until it fires (1 second later).

**Cause.** `time.After` returns a channel from a fresh `Timer`. The timer is alive in the runtime's heap until it fires. Allocating one per iteration when iterations are fast is a slow leak.

**Fix.**

```go
timer := time.NewTimer(time.Second)
defer timer.Stop()
for {
    select {
    case msg := <-msgs:
        process(msg)
        if !timer.Stop() {
            <-timer.C
        }
        timer.Reset(time.Second)
    case <-timer.C:
        return
    }
}
```

Reusing a single `Timer` avoids the per-iteration allocation. The `Reset` dance is awkward but correct. Go 1.23 made `Reset` simpler — see the release notes.

For the full chapter on timers and tickers, see [02-channels](../../02-channels/) and the `time` package documentation.

### Example 15: `defer` inside a tight loop

```go
for _, file := range files {
    f, err := os.Open(file)
    if err != nil {
        return err
    }
    defer f.Close()         // BUG: deferred until function returns
    process(f)
}
```

**Symptom.** "Too many open files" errors on big inputs. All `defer`s are queued for function return — none run during the loop.

**Cause.** `defer` runs at function exit, not loop iteration exit. With 10 000 files, 10 000 open file descriptors accumulate before any closes.

**Fix.** Extract the body to a function:

```go
for _, file := range files {
    if err := processFile(file); err != nil {
        return err
    }
}

func processFile(name string) error {
    f, err := os.Open(name)
    if err != nil {
        return err
    }
    defer f.Close()         // runs at the end of processFile, per iteration
    return process(f)
}
```

In the goroutine context: if a long-running goroutine has `defer`s inside a `for` loop, each iteration adds to the defer chain. Same fix.

### Example 16: Forgetting to call `cancel()`

```go
ctx, _ := context.WithTimeout(parent, 5*time.Second)
result := doRequest(ctx)
return result
```

**Symptom.** `go vet` warns: "the cancel function is not used." At runtime, the context's timer leaks until 5 seconds after the call.

**Cause.** `WithTimeout` (and `WithCancel`, `WithDeadline`) return a `cancel` function that must be called to release resources. If you discard it, the runtime keeps the timer and child contexts alive until the deadline.

**Fix.**

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
return doRequest(ctx)
```

`defer cancel()` releases resources promptly whether or not the timeout fires.

### Example 17: Mutex held over a syscall or unbounded operation

```go
var mu sync.Mutex
mu.Lock()
data, err := http.Get(url)  // blocks for who-knows-how-long
defer mu.Unlock()
```

**Symptom.** All other goroutines that want the lock are blocked until the network call returns. Latency spikes; throughput collapses.

**Cause.** The mutex protects a critical section, but the section now includes a network round trip. The lock holder pauses the world for as long as the network takes.

**Fix.** Move the I/O outside the critical section:

```go
data, err := http.Get(url)
if err != nil { return err }

mu.Lock()
defer mu.Unlock()
state.Update(data)
```

The mutex protects only the in-memory update.

### Example 18: Mixing atomic and non-atomic access

```go
var counter int64
go func() {
    atomic.AddInt64(&counter, 1)
}()
go func() {
    fmt.Println(counter)    // plain read, no atomic
}()
```

**Symptom.** Race detector flags a race. On some architectures, the read may observe a torn value.

**Cause.** Atomic operations are a *consistent protocol*. If one goroutine uses `atomic.AddInt64`, every other goroutine must use `atomic.LoadInt64` to read. Mixing atomic writes with plain reads loses the synchronisation guarantees.

**Fix.**

```go
fmt.Println(atomic.LoadInt64(&counter))
```

Or use the typed wrappers introduced in Go 1.19: `atomic.Int64`, `atomic.Pointer[T]`. They prevent the mixing mistake at the type level.

```go
var counter atomic.Int64
counter.Add(1)
fmt.Println(counter.Load())
```

### Example 19: Unsynchronised init of a singleton

```go
var instance *Service

func Get() *Service {
    if instance == nil {
        instance = &Service{...}    // race if called from multiple goroutines
    }
    return instance
}
```

**Symptom.** Race detector flags a race. Multiple goroutines may each construct their own `instance`, the last one winning; earlier `instance`s are garbage but may have side effects.

**Fix.** `sync.Once`.

```go
var (
    instance *Service
    once     sync.Once
)

func Get() *Service {
    once.Do(func() {
        instance = &Service{...}
    })
    return instance
}
```

`sync.Once.Do` runs the function exactly once, no matter how many goroutines call `Do` concurrently. Subsequent calls return immediately.

### Example 20: Background goroutine outliving its parent

```go
func handleRequest(req *Request) {
    go func() {
        time.Sleep(10 * time.Minute)
        cleanup(req)
    }()
    return
}
```

**Symptom.** Each request leaves a goroutine pinning the entire request struct (and any captured context, body, headers) for 10 minutes. Under load this is gigabytes.

**Cause.** The goroutine outlives the request and references the request's data via closure capture.

**Fix.** Use `context.Context` with cancellation, or move the cleanup to a worker pool that batches.

```go
func handleRequest(ctx context.Context, req *Request) {
    select {
    case cleanupQueue <- req:
    case <-ctx.Done():
    }
}
```

A separate pool drains `cleanupQueue` at controlled concurrency.

### Example 21: WaitGroup reused across goroutines

```go
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        work()
    }()
}
wg.Wait()
wg.Add(5)                   // dangerous: reuse before Wait returned in all callers
```

**Symptom.** `sync.WaitGroup` documents: "Note that calls with a positive delta that occur when the counter is zero must happen before a Wait. Calls with a positive delta, or calls with a negative delta that start when the counter is greater than zero, may happen at any time."

In practice: if `Add(positive)` races with `Wait()`, behaviour is undefined. The classic bug is reusing a `WaitGroup` across batches — one goroutine is still in `Wait` while another calls `Add`.

**Fix.** Use a fresh `WaitGroup` per batch, or guarantee all `Wait`s have returned before the next `Add`. A `sync.Mutex` around the batch boundary helps if you must reuse.

---

## Coding Patterns

### Pattern 1: The "exit slip" comment

For every goroutine you spawn, write a one-line comment about how it exits.

```go
// exits when ctx is cancelled
go consumer(ctx, ch)

// exits when ch is closed
go publisher(ch)

// exits when input drains and wg signals
go worker(input, &wg)
```

The comment is for the reader, but writing it is for you — if you cannot finish the sentence, the goroutine is already a bug.

### Pattern 2: Pass-by-parameter, capture-by-nothing

```go
for _, item := range items {
    go func(item Item) {
        process(item)
    }(item)
}
```

Avoid closure capture for anything other than truly shared state. Parameters make ownership and snapshotting explicit.

### Pattern 3: `defer cancel()` next to `WithCancel`/`WithTimeout`

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
```

Always. No exceptions. `go vet` will warn if you forget.

### Pattern 4: Single closer, multiple senders

```go
var wg sync.WaitGroup
for i := 0; i < N; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for _, v := range produce() {
            ch <- v
        }
    }()
}
go func() {
    wg.Wait()
    close(ch)
}()
```

The producers do not close. A separate goroutine waits for them all and then closes once.

### Pattern 5: Buffered result channel of size 1 for "one-shot" goroutines

```go
errCh := make(chan error, 1)
go func() {
    errCh <- doWork()
}()
// the send never blocks even if no one reads
```

Prevents the leak in Example 6.

---

## Clean Code

- **Name your goroutines (in comments).** `// fetcher`, `// consumer`, `// drainer`. Helps when reading stack traces.
- **Keep `go func() {...}()` bodies short.** If the body is more than 30 lines, extract a named function.
- **One `WaitGroup` per batch.** Do not reuse across phases.
- **`defer` the cleanup, always.** `defer wg.Done()`, `defer cancel()`, `defer t.Stop()`, `defer mu.Unlock()`.
- **Cluster spawn and join.** When possible, the `go` and the `Wait` live in the same function. Lifetime is visible.

---

## Product Use / Feature

| Product context | Pitfall to watch for |
|---|---|
| HTTP handler that fires async work | Background goroutine outliving the request (Example 20) |
| Worker pool fed from a queue | Send-on-closed when the queue closer races senders (Example 12) |
| Periodic flush goroutine | Ticker not stopped (Example 8), missing `cancel()` (Example 16) |
| Caching layer | Unsynchronised init (Example 19), concurrent map writes (Example 9) |
| File-processing job | `defer` in a tight loop (Example 15) |
| Distributed lock leader election | Mutex over a syscall (Example 17), atomic mixing (Example 18) |
| Fan-out to N services | Captured loop variable (Example 1), `time.After` in select (Example 14) |

---

## Error Handling

Pitfalls compound with errors. Two recurring traps:

### Trap 1: errors lost in a goroutine

```go
go func() {
    err := doWork()
    // err is discarded
}()
```

The goroutine ran, an error happened, and no caller will ever know. **Always** route errors back somewhere — a channel, an `errgroup`, a logger, an atomic pointer.

### Trap 2: a panic that should have been an error

If `doWork` can fail on bad input, return an `error`. Do not panic and rely on a `recover` somewhere. Panics are for programmer errors (nil dereference in code that should never see nil); errors are for runtime failures.

### Pattern: `errgroup` for "all or first failure"

```go
import "golang.org/x/sync/errgroup"

g, ctx := errgroup.WithContext(parent)
for _, url := range urls {
    url := url
    g.Go(func() error {
        return fetch(ctx, url)
    })
}
if err := g.Wait(); err != nil {
    return err
}
```

`errgroup` cancels the context on first error, so other goroutines stop early — but they must respect `ctx.Done()`.

---

## Security Considerations

- **Panic = process exit = service outage.** A malicious payload that triggers a `nil` dereference inside any goroutine kills the entire process. Defence: recover at the goroutine boundary; better, validate input so the panic does not happen.
- **Goroutine spawn = DoS vector.** If `handleRequest` spawns N goroutines per request, an attacker controls N. Bound concurrency with a worker pool or semaphore.
- **Captured loop variable = wrong authorisation.** "Authorise all users in this slice in parallel" plus closure capture can authorise the wrong user. Race + capture is a security bug, not just a correctness bug.
- **Leaked goroutines hold secrets.** If a goroutine captures a session token or a decrypted key and never exits, the secret stays in memory after it should have been zeroed.

---

## Performance Tips

- **Goroutine churn has a cost.** Spawning 10 000 short-lived goroutines per second is far slower than running a pool of 10 workers that each handle 1 000 jobs.
- **`time.After` in a hot loop costs allocations.** Reuse a `Timer`.
- **`sync.Map` is slower than `map + Mutex` for typical workloads.** Benchmark before switching.
- **Atomics are faster than mutexes for single integer state.** `atomic.Int64` beats `mu.Lock(); n++; mu.Unlock()`.
- **`defer` has a per-call cost (~30 ns in Go 1.14+).** Negligible normally; in a 1B-iteration loop, measurable.

---

## Best Practices

1. Always answer "how does this goroutine exit?" before writing the body.
2. Always pass loop variables as parameters; never close over them.
3. Always `wg.Add` in the parent, `defer wg.Done` in the child.
4. Always `defer cancel()` next to `WithCancel`/`WithTimeout`/`WithDeadline`.
5. Always `defer t.Stop()` after `time.NewTicker`/`time.NewTimer` if the lifetime is bounded.
6. Always make buffered result channels size 1 for "one-shot" patterns to prevent leaks.
7. Always `recover` at the goroutine boundary if the body can panic on untrusted input.
8. Always run `go test -race` in CI.
9. Never use `time.Sleep` for synchronisation.
10. Never close a channel from the receiving side or from one of many senders without coordination.
11. Never share a `map` across goroutines without a `Mutex` or use `sync.Map`.
12. Never mix atomic and non-atomic access to the same variable.

---

## Edge Cases & Pitfalls

This entire file is the edge cases section for the goroutines track. A few extras that did not get their own example:

- **Nil channel** — sends and receives on a `nil` channel block forever. Sometimes used intentionally in `select` to "disable" a case; if it happens by accident, you have a silent leak.
- **`select` with no `default` and all-nil cases** — blocks forever. Easy to reach if every case channel is conditionally niled.
- **`recover` outside `defer`** — returns `nil`. A common mistake when copying `defer func() { recover() }` patterns.
- **`runtime.Gosched` as a fix for races** — does nothing. Yielding gives other goroutines a chance to run, which makes the race *more* likely to manifest, not less.
- **`GOMAXPROCS=1` "makes my code single-threaded"** — it does not. Preemption still happens. Races still exist. See `02-vs-os-threads`.

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| Closure captures loop variable (pre-1.22) | Pass as parameter |
| `wg.Add(1)` inside the goroutine | Move to the parent before `go` |
| `wg.Done()` only on success path | `defer wg.Done()` at the top |
| `time.Sleep` to wait for completion | `WaitGroup` or channel |
| Unrecovered panic on bad input | `defer recover()` at boundary, validate input upstream |
| Goroutine sends to unread channel | Buffer of size 1 or always read |
| Goroutine receives from never-closed channel | Close from a single owner |
| Concurrent map writes | `sync.Mutex` or `sync.Map` |
| `close(ch)` twice | Single closer pattern |
| Send after close | Reorder lifetimes |
| `time.After` in tight select | Reuse `Timer` |
| `defer` in tight loop | Extract to function |
| `WithTimeout` without `cancel()` | `defer cancel()` always |
| Mutex over network call | Move I/O out of critical section |
| Atomic write + plain read | Use `atomic.Load*` or `atomic.Int64` |
| Singleton init via `if ptr == nil` | `sync.Once` |
| Goroutine outlives request | `context.Context` cancellation |
| Reusing `WaitGroup` mid-batch | Fresh `WaitGroup` per batch |

---

## Common Misconceptions

> *"Captured loop variable is fixed in 1.22, so I do not need parameters."* — The fix only applies to `for ... range` and `for i := ...; ...; ...` loop variables. Other captured variables (e.g., values inside a `for ... range items { x := compute() ... }` body) still need explicit handling.

> *"`time.Sleep(10 * time.Millisecond)` is long enough on modern machines."* — Modern machines are also occasionally slow. CI runners pause. VMs get descheduled. Sleep-based sync is always wrong.

> *"`recover` catches everything."* — `recover` only catches panics in the same goroutine, only inside `defer`. Fatal errors (concurrent map writes, stack overflow) are not recoverable.

> *"`sync.Map` is the safe map."* — Not a drop-in. Different API, different performance characteristics. For most cases `map + Mutex` is better.

> *"`atomic` is faster than mutex, so use atomics."* — For one integer, yes. For multi-field state, no. A mutex around a struct is simpler and correct; atomics need careful layout and ordering reasoning.

> *"`go vet` catches the pitfalls."* — It catches some (`unkeyed composite literals`, `cancel function not used`, `lock copy`). It does not catch most. You still need review and tests.

> *"The race detector catches all races."* — It catches races that *happen during the test run*. Races on rarely-exercised paths slip through.

> *"`runtime.NumGoroutine()` increasing means a leak."* — Sometimes. It can also mean legitimate concurrency. Look at *goroutine identity over time*, not a snapshot.

---

## Tricky Points

### Why does the captured loop variable bug print "5 5 5 5 5" specifically?

By the time the goroutines actually run, the loop has finished. The variable `i` holds the post-loop value, which is `5` (the value that failed the `i < 5` check). All goroutines, sharing that variable, read `5`.

### Why does `go vet` complain about the unused `cancel`?

The `cancel` is not just a function — it is the link in a chain of contexts. Discarding it leaves the context-tree resources (timers, child contexts) alive until the parent context is itself cancelled or the deadline passes. `go vet` warns because this is almost always a bug.

### Why is a buffered channel of size 1 the "leak-proof" pattern?

The goroutine sends and immediately exits. If no one reads, the channel and its single value hold ~16 bytes of garbage that the GC will collect. The goroutine itself is gone. With unbuffered, the goroutine would block on the send forever — that is the leak.

### Why does `sync.WaitGroup` document "Add must happen before Wait"?

`Wait` reads the counter, and if zero, returns. If `Add` runs after `Wait` started, the counter snapshot was zero — `Wait` already returned. The two operations are not synchronised by the `WaitGroup` itself for "Add when counter is zero."

### Why is closing a channel from the receiver always wrong?

The sender does not check before sending. If the receiver closes mid-send, the next send panics. The contract is: the *owner* of the send side closes. Owners can be one of N senders coordinating via `WaitGroup`, or a separate goroutine.

---

## Test

```go
package pitfalls_test

import (
    "context"
    "runtime"
    "sync"
    "sync/atomic"
    "testing"
    "time"
)

// Demonstrates the captured-variable fix.
func TestParameterShadow(t *testing.T) {
    var got [5]int
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            got[i] = i
        }(i)
    }
    wg.Wait()
    for i, v := range got {
        if v != i {
            t.Fatalf("index %d: got %d", i, v)
        }
    }
}

// Demonstrates that wg.Add in the parent is required.
func TestAddBeforeGo(t *testing.T) {
    var wg sync.WaitGroup
    var counter int64
    wg.Add(10)
    for i := 0; i < 10; i++ {
        go func() {
            defer wg.Done()
            atomic.AddInt64(&counter, 1)
        }()
    }
    wg.Wait()
    if counter != 10 {
        t.Fatalf("expected 10, got %d", counter)
    }
}

// Demonstrates buffered channel of 1 prevents leak.
func TestBufferedOneShot(t *testing.T) {
    before := runtime.NumGoroutine()
    for i := 0; i < 1000; i++ {
        ch := make(chan int, 1)
        go func() {
            ch <- 42
        }()
        // intentionally do not read
    }
    runtime.GC()
    runtime.Gosched()
    time.Sleep(10 * time.Millisecond)
    after := runtime.NumGoroutine()
    if after-before > 50 {
        t.Fatalf("leaked goroutines: before=%d after=%d", before, after)
    }
}

// Demonstrates defer cancel().
func TestDeferCancel(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()
    select {
    case <-ctx.Done():
    case <-time.After(time.Second):
        t.Fatal("context did not finish")
    }
}
```

Always run with `-race`:

```bash
go test -race ./...
```

---

## Tricky Questions

**Q.** What does this print on Go 1.21? On 1.22?

```go
for i := 0; i < 3; i++ {
    go func() { fmt.Println(i) }()
}
time.Sleep(time.Second)
```

**A.** 1.21: most often `3 3 3`. 1.22: some permutation of `0 1 2`. The semantics of the loop variable changed.

---

**Q.** Why does this leak?

```go
ch := make(chan int)
go func() { ch <- 42 }()
if condition { return }
fmt.Println(<-ch)
```

**A.** When `condition` is true, the goroutine's send blocks forever. Fix: `make(chan int, 1)`.

---

**Q.** What is wrong with this `WaitGroup`?

```go
var wg sync.WaitGroup
for i := 0; i < 5; i++ {
    go func() {
        wg.Add(1)
        defer wg.Done()
        work()
    }()
}
wg.Wait()
```

**A.** `Wait` may run before any goroutine reaches `Add`, returning immediately. `Add` belongs in the parent before `go`.

---

**Q.** Why does this panic intermittently?

```go
ch := make(chan int)
for i := 0; i < 5; i++ {
    go func() {
        defer close(ch)
        ch <- 1
    }()
}
```

**A.** Five goroutines each close the same channel. After the first close succeeds, the next close panics. Additionally, sends from other goroutines after the close panic.

---

**Q.** Why is this a problem under load?

```go
for {
    select {
    case msg := <-msgs:
        process(msg)
    case <-time.After(time.Second):
        return
    }
}
```

**A.** A fresh timer is allocated per iteration. Under high message rates, the heap fills with pending timers. Reuse a single `time.NewTimer` and `Reset`.

---

**Q.** What does this print?

```go
var counter int64
var wg sync.WaitGroup
for i := 0; i < 1000; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        counter++
    }()
}
wg.Wait()
fmt.Println(counter)
```

**A.** Almost always less than 1000, varying every run. `counter++` is read-modify-write; concurrent increments lose updates. Fix: `atomic.AddInt64(&counter, 1)`.

---

## Cheat Sheet

```go
// Pass loop variable
for _, x := range items {
    go func(x Item) { ... }(x)
}

// WaitGroup
wg.Add(1)               // in parent, before go
go func() {
    defer wg.Done()     // in child, at top, with defer
    work()
}()
wg.Wait()

// Cancellation
ctx, cancel := context.WithTimeout(parent, dur)
defer cancel()

// Timer / Ticker
t := time.NewTicker(interval)
defer t.Stop()
for {
    select {
    case <-ctx.Done(): return
    case <-t.C: tick()
    }
}

// Result channel
errCh := make(chan error, 1)    // size 1 to prevent leak
go func() { errCh <- doWork() }()

// Recover at boundary
go func() {
    defer func() {
        if r := recover(); r != nil { log.Println(r) }
    }()
    risky()
}()

// Singleton
var once sync.Once
once.Do(func() { instance = &Service{} })

// Atomic
var n atomic.Int64
n.Add(1); v := n.Load()

// Single closer for fan-in
go func() { wg.Wait(); close(ch) }()
```

---

## Self-Assessment Checklist

- [ ] I can spot a captured loop variable bug at a glance.
- [ ] I never put `wg.Add(1)` inside a goroutine body.
- [ ] I always pair `defer wg.Done()` with the parent's `wg.Add(1)`.
- [ ] I never use `time.Sleep` to synchronise goroutines in production code.
- [ ] I wrap untrusted-input goroutines with `defer recover()`.
- [ ] I know three distinct ways a goroutine can leak.
- [ ] I know why concurrent map writes are a fatal error rather than a recoverable panic.
- [ ] I always pair `WithCancel`/`WithTimeout` with `defer cancel()`.
- [ ] I never hold a mutex across a network or disk syscall.
- [ ] I never mix `atomic.AddInt64(&n, 1)` with a plain `_ = n` read on the same variable.
- [ ] I use `sync.Once` for singletons, never `if instance == nil`.
- [ ] I have read about goroutine leak detection in `07-goroutine-lifecycle-leaks`.

---

## Summary

The pitfalls in this file are not exotic. They are the patterns that every Go programmer types out at some point and then has to debug. The bugs all share a structure: a contract between goroutines was implicit, and reality violated the implicit assumption. Captured loop variables assume the closure binds at goroutine-run time; in fact, before 1.22, it binds to a shared slot. `wg.Add` inside the goroutine assumes the goroutine runs before `Wait`; in fact, the scheduler may run `Wait` first. `time.Sleep` assumes a known upper bound on goroutine duration; in fact, no such bound exists.

The cure is mechanical: pass values as parameters, `Add` in the parent and `Done` in the child with `defer`, replace sleeps with explicit waits, recover at the boundary, buffer one-shot result channels, `defer cancel()`, `defer t.Stop()`, single-closer per channel, `sync.Once` for singletons. Most of these are one-line changes once you have learned to see the shape.

The next step is to drill recognition. Move on to `find-bug.md` in this subsection, and to the dedicated leak coverage in [07-goroutine-lifecycle-leaks](../07-goroutine-lifecycle-leaks/).

---

## What You Can Build

With this material internalised, you can:

- Code-review someone else's PR for goroutine pitfalls in under five minutes.
- Diagnose "tests pass but production is flaky" by enumerating the eight likely shapes.
- Fix a leaking long-running service by mechanically walking the goroutine catalogue.
- Author CI guard tests using `goleak` and `-race` that catch regressions.
- Write Go training material for your team using this file as a checklist.

---

## Further Reading

- The Go Blog — [Go 1.22 changes loop variable semantics](https://go.dev/blog/loopvar-preview)
- The Go Blog — [Share Memory By Communicating](https://go.dev/blog/codelab-share)
- The Go Blog — [Concurrency is not parallelism](https://go.dev/blog/waza-talk)
- The Go Memory Model — <https://go.dev/ref/mem>
- `go.uber.org/goleak` — <https://github.com/uber-go/goleak>
- `golang.org/x/sync/errgroup` — <https://pkg.go.dev/golang.org/x/sync/errgroup>
- Effective Go — <https://go.dev/doc/effective_go>
- Russ Cox — [Off to the Races](https://research.swtch.com/gorace)

---

## Related Topics

- [07-goroutine-lifecycle-leaks](../07-goroutine-lifecycle-leaks/) — deep treatment of leak shapes and detection
- [02-channels/06-closing-channels](../../02-channels/06-closing-channels/) — single-closer, double-close, send-on-closed
- [02-channels/07-channel-pitfalls](../../02-channels/07-channel-pitfalls/) — channel-specific patterns
- [03-mutex-sync](../../03-mutex-sync/) — locking, `sync.Once`, atomic
- [05-context](../../05-context/) — cancellation propagation
- [01-goroutines/05-best-practices](../05-best-practices/) — positive patterns that prevent the negative patterns here

---

## Diagrams & Visual Aids

### Three families of pitfalls

```
            +----------------+   +----------------+   +----------------+
            |   LIFETIME     |   |   ORDERING     |   |   SHARING      |
            |  (leaks)       |   |  (races with   |   |  (races on     |
            |                |   |   coordination)|   |   state)       |
            +--------+-------+   +--------+-------+   +--------+-------+
                     |                    |                    |
        - leak via unread ch   - wg.Add inside go    - captured loop var
        - leak via no close    - time.Sleep sync     - concurrent map
        - ticker not stopped   - send-before-close   - atomic mixing
        - missing cancel()     - panic in wrong gor. - singleton init race
        - bg gor outlives par. - double close        - WaitGroup reuse
        - time.After in select - send on closed
        - defer in tight loop
        - mutex over syscall
```

### Lifecycle of a leaked goroutine

```
spawned ──> running ──> blocked on send ──> waiting forever
                              ▲
                              │
                       (no receiver ever)
```

### Captured loop variable (pre-1.22)

```
       i=0  ┐
       i=1  │ same address &i, value mutated by loop
       i=2  ├──> goroutines all read &i AFTER loop ends (i=N)
       i=3  │     final value = N
       i=4  ┘
```

### `wg.Add` inside the goroutine: race window

```
parent:  wg.Wait() ── counter is 0, returns immediately ──> next code
child:                        wg.Add(1) ── too late
                              wg.Done()
```

### Single-closer pattern

```
producers  ──┐
producers  ──┤   wg.Wait()
producers  ──┼──> closer goroutine ──> close(ch)
producers  ──┘                          │
                                        ▼
                                    consumer (for v := range ch)
```

### Mutex over syscall

```
goroutine A:  mu.Lock() ── HTTP request ── 5s ── mu.Unlock()
goroutine B:  mu.Lock() ─── BLOCKED for ~5s ───
goroutine C:  mu.Lock() ─── BLOCKED for ~5s ───
```

### Atomic + plain read

```
goroutine A:  atomic.AddInt64(&n, 1)   ── protocol: atomic
goroutine B:  fmt.Println(n)            ── protocol: plain  <-- broken
```

The protocol breaks. The race detector reports it.
