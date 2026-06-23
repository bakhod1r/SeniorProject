---
layout: default
title: WaitGroups — Find the Bug
parent: WaitGroups
grand_parent: sync Package
nav_order: 8
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/02-waitgroups/find-bug/
---

# WaitGroups — Find the Bug

← Back to WaitGroups

Each exercise contains buggy code, a hint, and a discussion. Try to spot the bug before reading the discussion.

A reminder: run all examples with the race detector:

```
go run -race main.go
```

The race detector catches *most* WaitGroup bugs. It is your best friend.

---

## Bug 1 — `Add` inside the goroutine

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        go func(i int) {
            wg.Add(1)
            defer wg.Done()
            fmt.Println(i)
        }(i)
    }
    wg.Wait()
}
```

**Hint.** What does `wg.Wait()` do if the counter is zero?

**Discussion.** When `wg.Wait()` is called, none of the goroutines may have had a chance to call `wg.Add(1)`. The counter is zero, `Wait` returns immediately, `main` exits, and goroutines die mid-print.

The race detector reports:

```
WARNING: DATA RACE
Read at 0x... by goroutine 6:
  sync.(*WaitGroup).Wait()
Previous write at 0x... by goroutine 7:
  sync.(*WaitGroup).Add()
```

**Fix.** Move `Add` to the parent, before `go`.

```go
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        fmt.Println(i)
    }(i)
}
wg.Wait()
```

Or once before the loop:

```go
wg.Add(5)
for i := 0; i < 5; i++ {
    go func(i int) {
        defer wg.Done()
        fmt.Println(i)
    }(i)
}
wg.Wait()
```

---

## Bug 2 — Missing `Done`

```go
func main() {
    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        time.Sleep(100 * time.Millisecond)
        fmt.Println("A")
    }()

    go func() {
        time.Sleep(200 * time.Millisecond)
        fmt.Println("B")
        // forgot wg.Done()
    }()

    wg.Wait()
    fmt.Println("done")
}
```

**Hint.** What is the counter when both goroutines have printed?

**Discussion.** After both goroutines print, the counter is 1 (only goroutine A called `Done`). `Wait` blocks forever. If no other goroutines are alive, you'll see:

```
A
B
fatal error: all goroutines are asleep - deadlock!
```

**Fix.** Add `defer wg.Done()` as the first line of goroutine B. The `defer` form makes it impossible to forget on early return or panic.

---

## Bug 3 — Copy of WaitGroup

```go
func worker(wg sync.WaitGroup, id int) {
    defer wg.Done()
    fmt.Println("worker", id)
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go worker(wg, i)
    }
    wg.Wait()
}
```

**Hint.** Run `go vet ./...` before running.

**Discussion.** `worker` takes `wg sync.WaitGroup` by value. Each call passes a *copy*. The copies' `Done` calls decrement different counters from the one in `main`, so `main`'s counter stays at 3 and `Wait` deadlocks.

`go vet` says:

```
./main.go:5:13: func worker passes lock by value: sync.WaitGroup contains sync.noCopy
```

**Fix.** Pass `*sync.WaitGroup`.

```go
func worker(wg *sync.WaitGroup, id int) {
    defer wg.Done()
    fmt.Println("worker", id)
}

go worker(&wg, i)
```

---

## Bug 4 — Negative counter panic

```go
func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer wg.Done()       // belt and braces?
        fmt.Println("done")
    }()
    wg.Wait()
}
```

**Hint.** How many `Done`s for one `Add`?

**Discussion.** Two deferred `Done` calls for one `Add(1)`. The counter goes from 1 → 0 → -1. The second `Done` panics:

```
panic: sync: negative WaitGroup counter
```

**Fix.** One `Done` per `Add(1)`. If you genuinely want the goroutine to "count for two", use `wg.Add(2)`.

---

## Bug 5 — Double-Wait misuse with reuse

```go
func main() {
    var wg sync.WaitGroup
    for round := 0; round < 3; round++ {
        wg.Add(2)
        go func() { defer wg.Done(); doWork() }()
        go func() { defer wg.Done(); wg.Wait() }()  // !
        wg.Wait()
    }
}
```

**Hint.** What is the second goroutine doing?

**Discussion.** The second goroutine calls `wg.Wait()` while still holding a counter slot for itself. Outcome: that goroutine waits for the counter to reach zero, but it is itself part of the count. The counter becomes 1 once the first goroutine's `Done` runs, but the second goroutine never decrements because it's stuck in `Wait`. Deadlock.

In addition, when `main` reaches its own `wg.Wait()`, both waiters are pending. They will all be released *together* when the counter eventually hits zero — except it never will.

**Fix.** Don't have a goroutine wait for itself. If you genuinely need a goroutine that waits for *other* work, structure it with a separate WaitGroup or a done-channel.

---

## Bug 6 — Capturing `wg` by value in a closure

```go
func main() {
    var wg sync.WaitGroup
    wg.Add(3)
    spawn := func(wg sync.WaitGroup) {     // value parameter!
        for i := 0; i < 3; i++ {
            go func(i int) {
                defer wg.Done()
                fmt.Println(i)
            }(i)
        }
    }
    spawn(wg)
    wg.Wait()
}
```

**Hint.** Re-read the parameter type of `spawn`.

**Discussion.** `spawn` declares `wg sync.WaitGroup` (no pointer). The whole function works on a *copy*. The goroutines inside call `Done` on the copy, never on `main`'s WaitGroup. `main` deadlocks.

`go vet` catches this.

**Fix.**

```go
spawn := func(wg *sync.WaitGroup) {
    for i := 0; i < 3; i++ {
        go func(i int) {
            defer wg.Done()
            fmt.Println(i)
        }(i)
    }
}
spawn(&wg)
```

---

## Bug 7 — Missing `Done` on panic path

```go
func worker(wg *sync.WaitGroup, items []int) {
    for _, it := range items {
        if it < 0 {
            panic("bad item")
        }
        process(it)
    }
    wg.Done()                  // last line
}
```

**Hint.** What if a panic happens inside the loop?

**Discussion.** A panic skips the rest of the function, including `wg.Done()`. The panic propagates and crashes the program — but if there's a `recover` in a parent, the WaitGroup is now stuck at the wrong counter and `Wait` deadlocks.

Even without a recover, if multiple goroutines were sharing the WaitGroup, the panic crashes the whole process and the WaitGroup state is moot. But once you start adding `recover`-based supervisors, the missing `Done` matters.

**Fix.** Use `defer`:

```go
func worker(wg *sync.WaitGroup, items []int) {
    defer wg.Done()
    for _, it := range items {
        if it < 0 {
            panic("bad item")
        }
        process(it)
    }
}
```

---

## Bug 8 — Reuse race

```go
func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            time.Sleep(time.Millisecond)
        }(i)
    }
    go func() {
        wg.Wait()             // first waiter
        wg.Add(1)             // tries to reuse
        go func() { defer wg.Done() }()
    }()
    wg.Wait()                 // main also waits
    time.Sleep(100 * time.Millisecond)
}
```

**Hint.** Two `Wait`s; the inner goroutine reuses the WaitGroup right after one of them returns.

**Discussion.** When the original 5 goroutines finish, both `Wait` callers are released roughly simultaneously. The inner goroutine then calls `Add(1)`. If `main`'s `Wait` is still in its release path (between observing zero and returning), this `Add` can race with it and panic:

```
panic: sync: WaitGroup is reused before previous Wait has returned
```

**Fix.** Don't reuse a WaitGroup across overlapping waiters. If you need two phases, use two WaitGroups.

```go
var phase1, phase2 sync.WaitGroup
// ...
phase1.Wait()
phase2.Add(1)
// ...
```

---

## Bug 9 — Forgotten close on the error channel

```go
func runAll(fns []func() error) []error {
    errs := make(chan error, len(fns))
    var wg sync.WaitGroup
    wg.Add(len(fns))
    for _, fn := range fns {
        go func(fn func() error) {
            defer wg.Done()
            if err := fn(); err != nil {
                errs <- err
            }
        }(fn)
    }
    wg.Wait()
    var out []error
    for err := range errs {
        out = append(out, err)
    }
    return out
}
```

**Hint.** What does `for err := range errs` do?

**Discussion.** `for ... range chan` iterates until the channel is *closed*. The channel here is never closed, so the range loop hangs forever. The function returns nothing.

**Fix.** Close after `Wait`:

```go
wg.Wait()
close(errs)
for err := range errs {
    out = append(out, err)
}
```

Order matters: close *after* `Wait`, never before — closing while senders are running causes a panic.

---

## Bug 10 — Unbuffered error channel

```go
func runAll(fns []func() error) error {
    errs := make(chan error)             // unbuffered
    var wg sync.WaitGroup
    wg.Add(len(fns))
    for _, fn := range fns {
        go func(fn func() error) {
            defer wg.Done()
            if err := fn(); err != nil {
                errs <- err
            }
        }(fn)
    }
    wg.Wait()
    close(errs)
    for err := range errs {
        return err
    }
    return nil
}
```

**Hint.** What happens if multiple `fn`s fail?

**Discussion.** The channel is unbuffered. The first goroutine that sends `errs <- err` blocks until someone receives. Nobody is receiving — `main` is in `wg.Wait()`. Deadlock.

**Fix.** Buffer to `len(fns)`:

```go
errs := make(chan error, len(fns))
```

Now sends are non-blocking and the goroutines can finish.

---

## Bug 11 — Counting wrong

```go
func processBatch(items []Item, wg *sync.WaitGroup) {
    wg.Add(len(items))
    for _, it := range items {
        if it.Skip {
            continue
        }
        go func(it Item) {
            defer wg.Done()
            process(it)
        }(it)
    }
}
```

**Hint.** Count the `Add`s and the `Done`s.

**Discussion.** `Add` adds `len(items)`, but goroutines only spawn for non-skipped items. The skipped items are added to the counter but never decremented. `Wait` deadlocks.

**Fix.** Either don't `Add` for skipped items, or `Done` for them:

```go
wg.Add(len(items))
for _, it := range items {
    if it.Skip {
        wg.Done()                    // balance the Add
        continue
    }
    go func(it Item) { defer wg.Done(); process(it) }(it)
}
```

Cleaner: only `Add` for items you actually spawn.

```go
for _, it := range items {
    if it.Skip {
        continue
    }
    wg.Add(1)
    go func(it Item) { defer wg.Done(); process(it) }(it)
}
```

---

## Bug 12 — Value receiver on a method

```go
type Server struct {
    wg sync.WaitGroup
}

func (s Server) Spawn(f func()) {
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        f()
    }()
}

func (s Server) Wait() { s.wg.Wait() }

func main() {
    var s Server
    s.Spawn(func() { fmt.Println("hi") })
    s.Wait()
}
```

**Hint.** Where does `s.wg` actually live?

**Discussion.** Both methods have value receivers. Each call gets its own copy of `Server`, so `Spawn` increments a copy's WaitGroup and `Wait` waits on a different copy's WaitGroup (initial value, counter 0). `Wait` returns immediately, the goroutine is killed mid-print.

`go vet` says:

```
./main.go:7:6: method Spawn copies lock value: sync.WaitGroup contains sync.noCopy
```

**Fix.** Pointer receivers:

```go
func (s *Server) Spawn(f func()) { ... }
func (s *Server) Wait()           { ... }
```

---

## Bug 13 — Goroutine leak after timeout

```go
func waitOrTimeout(wg *sync.WaitGroup, d time.Duration) {
    done := make(chan struct{})
    go func() {
        wg.Wait()
        close(done)
    }()
    select {
    case <-done:
    case <-time.After(d):
        // timed out
    }
}
```

Used in:

```go
func processAll(items []Item) {
    var wg sync.WaitGroup
    wg.Add(len(items))
    for _, it := range items {
        go func(it Item) {
            defer wg.Done()
            process(it)               // never finishes for some items!
        }(it)
    }
    waitOrTimeout(&wg, 5*time.Second)
}
```

**Hint.** What does the wrapper goroutine do if `process` hangs?

**Discussion.** If any `process(it)` call never returns, the wrapper goroutine inside `waitOrTimeout` will be stuck in `wg.Wait()` forever. Calling `processAll` repeatedly leaks one wrapper goroutine per call. Over a long-running service, this is a steady leak.

**Fix.** The fundamental problem is that `wg.Wait()` cannot be cancelled. Instead, plumb a `context.Context` through `process` so it observes cancellation:

```go
func processAll(parent context.Context, items []Item) error {
    ctx, cancel := context.WithTimeout(parent, 5*time.Second)
    defer cancel()
    var wg sync.WaitGroup
    wg.Add(len(items))
    for _, it := range items {
        go func(it Item) {
            defer wg.Done()
            process(ctx, it)
        }(it)
    }
    wg.Wait()                          // workers exit when ctx cancelled
    return ctx.Err()
}
```

Now there is no leak — the workers are guaranteed to return when `ctx` cancels.

---

## Bug 14 — Concurrent map writes despite WaitGroup

```go
func buildMap(items []string) map[string]int {
    out := make(map[string]int)
    var wg sync.WaitGroup
    wg.Add(len(items))
    for _, it := range items {
        go func(it string) {
            defer wg.Done()
            out[it] = len(it)         // racy
        }(it)
    }
    wg.Wait()
    return out
}
```

**Hint.** WaitGroup synchronises *Wait* with *Done*, not goroutines with each other.

**Discussion.** Multiple goroutines write to the same `map`. Maps are not safe for concurrent writes. The race detector reports a data race; without `-race` you may see corruption or a runtime panic ("concurrent map writes").

**Fix.** Add a mutex.

```go
var mu sync.Mutex
go func(it string) {
    defer wg.Done()
    v := len(it)
    mu.Lock()
    out[it] = v
    mu.Unlock()
}(it)
```

Or use `sync.Map`, or build per-goroutine partial maps and merge.

---

## Bug 15 — `wg.Wait` then `wg.Add` in the same goroutine

```go
func main() {
    var wg sync.WaitGroup
    wg.Wait()                          // counter is 0; returns immediately
    wg.Add(1)                          // legal? yes
    go func() { defer wg.Done() }()
    wg.Wait()                          // legal
}
```

**Hint.** Is this actually a bug?

**Discussion.** This is *not* a bug. The first `Wait` returns instantly because the counter is zero. The subsequent `Add` happens-after that return, satisfying the happens-before requirement. The second `Wait` correctly waits for the goroutine.

This is an example to internalise: "WaitGroup before any use" is fine. The trouble is only when *concurrent* `Add` and `Wait` overlap.

---

## Bug 16 — Closure capture of mutable counter

```go
func main() {
    var wg sync.WaitGroup
    n := 5
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            fmt.Println(i)              // captures i
        }()
    }
    wg.Wait()
}
```

**Hint.** What does `i` look like inside each goroutine, in Go 1.21 and earlier?

**Discussion.** Pre Go 1.22, the loop variable `i` is shared across all iterations; by the time the goroutines run, `i` is `5`. You may see "5 5 5 5 5". This is technically a closure bug, not a WaitGroup bug, but it's commonly conflated.

In Go 1.22+, each iteration has its own `i`, and the example prints 0–4 in some order.

**Fix (portable across versions).**

```go
go func(i int) {
    defer wg.Done()
    fmt.Println(i)
}(i)
```

---

## Bug 17 — `Wait` from inside a worker

```go
func process(items []Item, wg *sync.WaitGroup) {
    for _, it := range items {
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            doWork(it)
        }(it)
    }
    wg.Wait()              // OK
}

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        process([]Item{...}, &wg)        // nests its own Adds and Waits
    }()
    wg.Wait()
}
```

**Hint.** What if the inner `Wait` runs while the outer counter is non-zero?

**Discussion.** `process`'s `wg.Wait()` waits for the WaitGroup to reach zero, but the outer goroutine still holds a count of 1 (from the original `wg.Add(1)`). The inner `Wait` waits for the outer goroutine, which is sitting in `process` waiting for the inner items, which all `Done` correctly... but the outer `Wait` decrement comes from a `defer` in the outer goroutine, not from the inner items.

Actually, walk through it carefully. When the inner items finish, the counter drops by `len(items)` from a peak of `len(items)+1` to 1. The inner `Wait` keeps waiting because the counter isn't zero. The outer goroutine cannot return because it is sitting in the inner `Wait`. The outer `Done` never fires. Deadlock.

**Fix.** Don't share a WaitGroup across nested levels of work. Use one WaitGroup per level.

---

## Bug 18 — `Wait` race when reusing in goroutine

```go
var wg sync.WaitGroup

func roundOnce() {
    wg.Add(3)
    for i := 0; i < 3; i++ {
        go func() { defer wg.Done(); doWork() }()
    }
    wg.Wait()
}

func main() {
    for i := 0; i < 100; i++ {
        go roundOnce()                  // 100 concurrent rounds
    }
    time.Sleep(time.Second)
}
```

**Hint.** What does `wg` look like across 100 simultaneous `roundOnce` calls?

**Discussion.** All 100 goroutines `Add(3)` and `Wait` on the *same* package-level `wg`. The counter accumulates to 300. Each `Wait` waits for the counter to hit zero, which only happens once *all 300* `Done`s have fired. Worse, the reuse rules are violated because new `Add`s happen during in-progress `Wait`s.

**Fix.** Use a local WaitGroup per call:

```go
func roundOnce() {
    var wg sync.WaitGroup
    wg.Add(3)
    for i := 0; i < 3; i++ {
        go func() { defer wg.Done(); doWork() }()
    }
    wg.Wait()
}
```

A package-level WaitGroup is almost always a sign of trouble.

---

## Bug 19 — Asymmetric `Add`/`Done`

```go
func startWorkers(n int, wg *sync.WaitGroup) {
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            for j := 0; j < 5; j++ {
                wg.Add(1)
                go func() {
                    defer wg.Done()
                    work()
                }()
            }
        }(i)
    }
}
```

**Hint.** Outer goroutines spawn inner goroutines. Are the `Add`s ordered correctly?

**Discussion.** The outer goroutine calls `wg.Add(1)` *before* `go func() {...}()`. That part is correct. But the parent caller's `wg.Wait()` (not shown) might run while the outer goroutines haven't yet executed their `Add(1)` lines. Whether this races depends on whether the caller does its `Wait` after `startWorkers` returns and before the outer goroutines have begun.

If `startWorkers` returns before the outer goroutines have even started, the counter is `n` (all outer adds happened in the parent loop, good). But if the parent calls `Wait` and one of the outer goroutines' `Add(1)` for inner work hasn't happened yet, the counter could prematurely reach zero.

The correct pattern: `Add` must happen-before the goroutine that will `Done` is launched. Here it does for outer goroutines, but for inner goroutines the `Add(1)` is sequenced in the *outer goroutine*, which is fine — *as long as* the parent `Wait` does not run until at least one outer goroutine has begun.

In practice: the outer goroutines' `wg.Add(1)` will fire before they exit (because they run before their `defer wg.Done()`), so by the time the outer goroutine `Done`s, the counter is `n - 1 + 5` and won't reach zero until all inner work is done. Subtle but correct.

**Discussion.** This is actually correct, but it's a code smell — nested `Add`s are confusing and any small change easily introduces a real bug. Prefer a flat fan-out where possible.

---

## Bug 20 — `WaitGroup` on a stack escape

```go
type Job struct {
    wg sync.WaitGroup
}

func (j *Job) Run() {
    j.wg.Add(1)
    go func() {
        defer j.wg.Done()
        time.Sleep(100 * time.Millisecond)
    }()
}

func startJob() *Job {
    var j Job
    j.Run()
    return &j                     // !
}

func main() {
    j := startJob()
    j.wg.Wait()                   // does this work?
}
```

**Hint.** When does the `Job` value's address escape to the heap?

**Discussion.** Returning `&j` causes `j` to escape to the heap. The pointer in `main` and the pointer captured by the goroutine point to the same heap object. So `j.wg.Wait()` and `j.wg.Done()` operate on the same WaitGroup. This works correctly.

The bug-bait is purely cosmetic: it *looks* like a stack-vs-heap problem, but Go's escape analysis handles it. As long as you never copy `j` after first use, you're fine.

The actual bug to watch for: if someone changes `startJob` to return `j` (by value), the WaitGroup gets copied and everything breaks silently. Document with a comment.

---

## Going further

- Run every example with `go run -race main.go`. Treat the race detector as your primary teacher.
- Write your own buggy WaitGroup programs from memory and have a colleague spot the bug.
- Read `src/sync/waitgroup_test.go` for the standard library's own WaitGroup tests; many cover edge cases that match these bugs.

A WaitGroup is one of the smallest concurrency primitives in Go, but the bugs it admits are remarkably varied. Internalising the rules — Add before go, defer Done, pointer always, Wait then reuse — eliminates 95% of them. The race detector catches the rest.
