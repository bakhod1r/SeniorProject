---
layout: default
title: WaitGroups — Middle
parent: WaitGroups
grand_parent: sync Package
nav_order: 2
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/02-waitgroups/middle/
---

# WaitGroups — Middle

← Back to WaitGroups

You know the API. Now we look at the real problems: when `Add` and `Wait` race, when `WaitGroup` lives inside a struct, how to combine it with errors, how to spawn a dynamic number of workers, and the often-misunderstood rule about reusing a WaitGroup.

---

## 1. Race: `Add` after `Wait`

The most subtle WaitGroup bug is this:

```go
var wg sync.WaitGroup

go func() {
    wg.Add(1)             // (A)
    defer wg.Done()
    work()
}()

wg.Wait()                 // (B)
```

If (B) runs before (A), `Wait` sees a counter of 0 and returns immediately. The goroutine is silently abandoned. The race detector catches this:

```
==================
WARNING: DATA RACE
Read at 0x... by goroutine 6:
  sync.(*WaitGroup).Wait()
Previous write at 0x... by goroutine 7:
  sync.(*WaitGroup).Add()
==================
```

The Go documentation states the rule:

> "Calls with a positive delta that occur when the counter is zero must happen before a Wait."

Translation: **`Add(positive)` must happen-before `Wait`**, in the same memory-order sense as a mutex lock. The simplest way to guarantee this is to call `Add` from the same goroutine that will call `Wait`, before launching any worker.

```go
var wg sync.WaitGroup
wg.Add(1)                 // safe — happens before any Wait
go func() {
    defer wg.Done()
    work()
}()
wg.Wait()
```

---

## 2. The "fan-out" template

Here is the standard fan-out skeleton you'll write hundreds of times:

```go
func fanOut(items []Item) {
    var wg sync.WaitGroup
    wg.Add(len(items))
    for _, it := range items {
        go func(it Item) {
            defer wg.Done()
            process(it)
        }(it)
    }
    wg.Wait()
}
```

Notes:

- `wg.Add(len(items))` once, not `Add(1)` in the loop. Slightly faster, just as readable.
- `it` is passed as a parameter to avoid the loop-variable capture bug.
- `defer wg.Done()` is the first line.

Memorise this template. It is the spine of nearly every WaitGroup program.

---

## 3. Bounded fan-out (worker pool)

The fan-out template above starts one goroutine per item. If you have a million items, that is a million goroutines — usually fine in Go, but not always. A **bounded worker pool** caps concurrency.

```go
func bounded(items []Item, workers int) {
    jobs := make(chan Item)
    var wg sync.WaitGroup

    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func() {
            defer wg.Done()
            for it := range jobs {
                process(it)
            }
        }()
    }

    for _, it := range items {
        jobs <- it
    }
    close(jobs)
    wg.Wait()
}
```

The pattern:

1. Spawn N workers; `Add(N)` once.
2. Push jobs onto a channel.
3. `close(jobs)` when the producer is done.
4. Each worker exits its `for range` when the channel is drained, then calls `Done` via `defer`.
5. `Wait` blocks until all workers have exited.

This is the canonical worker-pool idiom in Go. Memorise it.

---

## 4. Dynamic spawn — when you don't know N up front

Sometimes the work generates more work as it runs (web crawling, file-tree walking). You can't `Add(N)` once because N is unknown. The pattern:

```go
var wg sync.WaitGroup

var crawl func(url string)
crawl = func(url string) {
    defer wg.Done()
    for _, link := range fetchLinks(url) {
        wg.Add(1)              // BEFORE the go
        go crawl(link)
    }
}

wg.Add(1)
go crawl(seed)
wg.Wait()
```

The crucial detail: each call site that *spawns* a goroutine calls `Add(1)` before the `go` keyword. This satisfies the happens-before requirement: the `Add` is sequenced before the goroutine that will call `Done`.

A common bug is calling `Add` *inside* the spawned goroutine. Don't.

---

## 5. Combining WaitGroup with errors

`WaitGroup` only counts. To collect errors, the simplest pattern is a buffered channel sized to the worker count:

```go
errs := make(chan error, len(items))
var wg sync.WaitGroup
wg.Add(len(items))

for _, it := range items {
    go func(it Item) {
        defer wg.Done()
        if err := process(it); err != nil {
            errs <- err
        }
    }(it)
}

wg.Wait()
close(errs)

var firstErr error
for err := range errs {
    if firstErr == nil {
        firstErr = err
    }
    log.Println(err)
}
```

Three rules:

1. The channel must be buffered to at least the number of senders, so no goroutine blocks on send.
2. Close the channel only **after** `Wait` returns — closing while senders are still active panics.
3. Drain the channel *after* close, not before, otherwise you may miss errors.

We'll see the cleaner `errgroup` alternative in §11.

---

## 6. Returning results

For results, the pattern is similar but the channel is typed.

```go
type Result struct {
    Item Item
    Out  Output
    Err  error
}

results := make(chan Result, len(items))
var wg sync.WaitGroup
wg.Add(len(items))

for _, it := range items {
    go func(it Item) {
        defer wg.Done()
        out, err := process(it)
        results <- Result{it, out, err}
    }(it)
}

wg.Wait()
close(results)

for r := range results {
    handle(r)
}
```

Note: order is *not* preserved. If you need order, write to a pre-allocated slice indexed by position:

```go
out := make([]Output, len(items))
for i, it := range items {
    go func(i int, it Item) {
        defer wg.Done()
        out[i], _ = process(it)        // each goroutine writes to a unique index
    }(i, it)
}
wg.Wait()
```

Different goroutines writing to *different* indices of the same slice is safe — there is no shared cache line *concept* here for correctness, only for performance (false sharing, covered in senior).

---

## 7. WaitGroup inside a struct

Once your code grows, the WaitGroup often lives on a struct:

```go
type Server struct {
    wg     sync.WaitGroup
    quit   chan struct{}
}

func (s *Server) Spawn(task func()) {
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        task()
    }()
}

func (s *Server) Shutdown() {
    close(s.quit)
    s.wg.Wait()
}
```

Two important constraints:

**1. Pointer receivers only.**
The methods that touch `s.wg` must be on `*Server`, not on `Server`. A value receiver would receive a copy of the struct *and the WaitGroup inside it*, breaking everything.

```go
// BAD
func (s Server) Spawn(task func()) { ... }   // s is a copy; s.wg is a useless copy

// GOOD
func (s *Server) Spawn(task func()) { ... }
```

**2. Don't copy the struct after first use.**
Same reasoning. `go vet` will flag any code path that copies a struct containing a `sync.WaitGroup`.

---

## 8. Reusing a WaitGroup

You can reuse a `WaitGroup` after `Wait` returns — the docs explicitly allow it:

> "Note that a WaitGroup must not be copied after first use. ... All calls to Add must happen before the call to Wait or be concurrently synchronised with prior Add calls."

The rule for reuse: **the next `Add` must happen-after the previous `Wait` returns**. It is not safe to interleave `Add` and `Wait` across different "rounds".

```go
// SAFE: clean separation between rounds
for round := 0; round < 3; round++ {
    wg.Add(N)
    for i := 0; i < N; i++ {
        go work(&wg)
    }
    wg.Wait()         // round done; counter is 0
}
```

```go
// UNSAFE: an Add in round 2 may race with the Wait of round 1
go func() {
    wg.Add(1)
    go work(&wg)
}()
wg.Wait()
```

If you find yourself reaching for reuse, it's often clearer to allocate a fresh `WaitGroup` per round.

---

## 9. Calling `Wait` from multiple goroutines

It's legal but rarely useful:

```go
var wg sync.WaitGroup
wg.Add(1)

go func() { wg.Wait(); fmt.Println("A") }()
go func() { wg.Wait(); fmt.Println("B") }()

time.Sleep(100 * time.Millisecond)
wg.Done()
```

Both waiters are released atomically when the counter reaches zero. They then return; the WaitGroup is back at zero and can be reused (subject to §8).

---

## 10. Anti-pattern: the "Add inside goroutine" race

We saw this in junior, but it appears in subtle disguise. For example:

```go
func process(items []Item, wg *sync.WaitGroup) {
    for _, it := range items {
        go func(it Item) {
            wg.Add(1)              // BUG
            defer wg.Done()
            ...
        }(it)
    }
}
```

The race is identical: `wg.Add(1)` may execute *after* the parent's `wg.Wait()`. Even if you can't observe it locally, the race detector will, and CI will fail intermittently.

The fix is always: move `Add` to the parent's loop, before `go`.

---

## 11. errgroup — the "WaitGroup with error propagation"

`golang.org/x/sync/errgroup.Group` is the modern, ergonomic replacement for the WaitGroup-plus-error-channel pattern.

```go
import "golang.org/x/sync/errgroup"

func fanOut(items []Item) error {
    var g errgroup.Group
    for _, it := range items {
        it := it
        g.Go(func() error {
            return process(it)
        })
    }
    return g.Wait()           // returns the first non-nil error
}
```

Key features:

| Feature                      | `sync.WaitGroup` | `errgroup.Group` |
|------------------------------|------------------|------------------|
| Counts goroutines            | yes              | yes              |
| Each task can return error   | no               | yes              |
| First error is returned      | no               | yes              |
| Cancels remaining on error   | no (need ctx)    | yes (with `WithContext`) |
| Concurrency limit            | no               | yes (`SetLimit`) |

For most "fan-out and wait for errors" workloads, prefer `errgroup`. Use raw `WaitGroup` when:

- Goroutines genuinely can't fail (or you don't care about errors).
- You're inside the standard library and can't take an `x/sync` dependency.
- You want to wait for goroutines that have *side effects only* (no return value).

---

## 12. errgroup with cancellation

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

g, ctx := errgroup.WithContext(ctx)

for _, url := range urls {
    url := url
    g.Go(func() error {
        return fetch(ctx, url)
    })
}

if err := g.Wait(); err != nil {
    log.Printf("fan-out failed: %v", err)
}
```

When any `g.Go` callback returns a non-nil error, the derived `ctx` is cancelled. All other goroutines should observe `ctx.Done()` and return early. This gives you the **fail-fast** semantics that `WaitGroup` alone cannot provide.

---

## 13. WaitGroup vs done-channel

For waiting on **one** goroutine, the done-channel is often clearer:

```go
done := make(chan struct{})
go func() {
    defer close(done)
    work()
}()
<-done
```

For waiting on **many** with a known count, WaitGroup wins:

```go
var wg sync.WaitGroup
wg.Add(len(items))
for _, it := range items { go work(it, &wg) }
wg.Wait()
```

For waiting on **many** with results, channels are typically better because they double as the result transport. Rule of thumb: if there's already a result channel, you may not need a WaitGroup at all — count completions on the channel itself.

---

## 14. Example: parallel directory walk

```go
func sumSizes(root string) (int64, error) {
    var (
        total int64
        wg    sync.WaitGroup
        mu    sync.Mutex
        firstErr error
    )

    wg.Add(1)
    go walk(root, &wg, &mu, &total, &firstErr)
    wg.Wait()

    return total, firstErr
}

func walk(dir string, wg *sync.WaitGroup, mu *sync.Mutex, total *int64, errp *error) {
    defer wg.Done()
    entries, err := os.ReadDir(dir)
    if err != nil {
        mu.Lock()
        if *errp == nil { *errp = err }
        mu.Unlock()
        return
    }
    for _, e := range entries {
        path := filepath.Join(dir, e.Name())
        if e.IsDir() {
            wg.Add(1)
            go walk(path, wg, mu, total, errp)
            continue
        }
        info, err := e.Info()
        if err != nil { continue }
        atomic.AddInt64(total, info.Size())
    }
}
```

Notes:

- `Add(1)` precedes every `go walk(...)`.
- The recursion-through-goroutines is bounded only by the directory depth × fan-out. For very wide trees you'd want a worker pool.
- We use `atomic.AddInt64` for the size counter and a mutex for the first-error slot.

---

## 15. Testing with WaitGroups

When testing async code you'll often write helper goroutines and wait for them.

```go
func TestProducerConsumer(t *testing.T) {
    in := make(chan int)
    out := make(chan int)

    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        producer(in)
    }()

    go func() {
        defer wg.Done()
        consumer(in, out)
    }()

    // ... drive the test ...
    close(in)
    wg.Wait()                  // ensure both goroutines have exited
}
```

A test that finishes before its goroutines exit can leave them touching `t.Logf` after the test framework has moved on, which the race detector flags. Always `Wait` before the test returns.

For tests that need a *timeout* on the wait:

```go
done := make(chan struct{})
go func() { wg.Wait(); close(done) }()
select {
case <-done:
case <-time.After(2 * time.Second):
    t.Fatal("timeout waiting for goroutines")
}
```

---

## 16. Common pitfalls revisited

| Pitfall                                | Symptom                            | Fix                              |
|----------------------------------------|------------------------------------|----------------------------------|
| `Add` inside goroutine                 | Race detector warning, occasional miss | Move Add to parent, before `go` |
| Pass WaitGroup by value                | `go vet` lock-by-value warning     | Pass `*sync.WaitGroup`          |
| Forget `defer wg.Done()`               | Deadlock in `Wait`                 | Use defer, always               |
| Done called twice                      | Negative-counter panic             | Audit code paths                |
| Reuse with overlapping Add/Wait        | Race detector, hangs               | Allocate fresh per round        |
| Channel-of-errors closed too early     | Send on closed channel panic       | Close after `Wait`              |
| Channel-of-errors unbuffered           | Producer goroutines block forever  | Buffer to len(items)            |

---

## 17. Quick exercise

Spot the bug:

```go
type Pool struct {
    wg sync.WaitGroup
}

func (p Pool) Run(task func()) {
    p.wg.Add(1)
    go func() {
        defer p.wg.Done()
        task()
    }()
}

func (p Pool) Wait() { p.wg.Wait() }
```

Two bugs:

1. Value receivers — `p` is a copy of the pool, so `p.wg` is a copy of the WaitGroup. `Add` and `Done` modify a counter that nobody is waiting on.
2. The pool itself is meant to be shared, but copying it through value receivers makes that impossible.

Fix:

```go
func (p *Pool) Run(task func()) { ... }
func (p *Pool) Wait()           { ... }
```

If you saw both, you're ready for [senior.md](senior.md). If only one, read §7 again.

---

## 18. Going deeper

- [senior.md](senior.md) — memory model, errgroup deep-dive, context cancellation, fan-in patterns
- [professional.md](professional.md) — internals, race detector hooks
- [find-bug.md](find-bug.md) — debug broken WaitGroup programs
- [optimize.md](optimize.md) — replacing WaitGroup with channels, errgroup tricks

The middle level is mostly about *patterns*. The senior level is about understanding *why* those patterns are correct at the memory-model level.
