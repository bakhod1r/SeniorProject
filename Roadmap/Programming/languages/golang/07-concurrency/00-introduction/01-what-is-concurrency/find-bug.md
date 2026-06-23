# What is Concurrency — Find the Bug

> Each snippet contains at least one bug. Diagnose, then read the explanation. Bugs cover all the common concurrency mistakes: races, leaks, deadlocks, sub-optimal scaling, misuse of primitives, captured loop variables, and silent correctness errors.

---

## Bug 1 — The classic non-finishing program

```go
package main

import "fmt"

func main() {
    go fmt.Println("hello from goroutine")
    fmt.Println("hello from main")
}
```

**What is wrong?**

The program likely prints only `hello from main`. The main goroutine returns before the spawned goroutine has had a chance to run.

**Fix.**

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
        fmt.Println("hello from goroutine")
    }()
    fmt.Println("hello from main")
    wg.Wait()
}
```

---

## Bug 2 — Captured loop variable

```go
for i := 0; i < 5; i++ {
    go func() {
        fmt.Println(i)
    }()
}
time.Sleep(time.Second)
```

**What is wrong?**

Pre-Go 1.22: the closure captures `i` by reference, so by the time the goroutines run, `i == 5`. Output is `5 5 5 5 5`. In Go 1.22+, each iteration has a fresh `i`, so output is some permutation of `0..4`.

**Fix that works in every version.**

```go
for i := 0; i < 5; i++ {
    go func(i int) {
        fmt.Println(i)
    }(i)
}
```

---

## Bug 3 — Data race on a counter

```go
var counter int
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

**What is wrong?**

`counter++` is not atomic — it reads, increments, writes. Concurrent goroutines lose updates. Result is usually less than 1000.

**Fix (option A: atomic).**

```go
var counter int64
// ...
atomic.AddInt64(&counter, 1)
```

**Fix (option B: mutex).**

```go
var mu sync.Mutex
// ...
mu.Lock()
counter++
mu.Unlock()
```

---

## Bug 4 — WaitGroup.Add inside the goroutine

```go
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    go func() {
        wg.Add(1)
        defer wg.Done()
        work()
    }()
}
wg.Wait()
```

**What is wrong?**

`wg.Wait()` may run before any of the goroutines have executed `wg.Add(1)`. The counter is still 0, `Wait` returns immediately, the program "joins" goroutines that have not even started.

**Fix.**

Call `wg.Add(1)` in the parent before `go`.

```go
for i := 0; i < 10; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        work()
    }()
}
```

---

## Bug 5 — Goroutine leak via unbuffered send

```go
func fetch() int {
    ch := make(chan int)
    go func() {
        ch <- compute()
    }()
    select {
    case v := <-ch:
        return v
    case <-time.After(100 * time.Millisecond):
        return -1
    }
}
```

**What is wrong?**

If the timeout fires, the function returns `-1` and the caller goes on. But the goroutine still tries to send on the unbuffered `ch`. There is no receiver. The goroutine leaks forever.

**Fix.**

Use a buffered channel of capacity 1:

```go
ch := make(chan int, 1)
```

Now the send succeeds even if no one reads, and the goroutine exits.

---

## Bug 6 — Deadlock on an unbuffered channel

```go
func main() {
    ch := make(chan int)
    ch <- 1
    fmt.Println(<-ch)
}
```

**What is wrong?**

The send `ch <- 1` blocks until a receiver is ready. But the receiver is on the next line of the same goroutine. Deadlock; the runtime panics with "all goroutines are asleep."

**Fix.**

Either send from a separate goroutine, or use a buffered channel:

```go
ch := make(chan int, 1) // buffer = 1, send succeeds immediately
ch <- 1
fmt.Println(<-ch)
```

---

## Bug 7 — Closing a channel from multiple goroutines

```go
ch := make(chan int)
for i := 0; i < 10; i++ {
    go func() {
        ch <- 1
        close(ch)
    }()
}
```

**What is wrong?**

All ten goroutines try to close the channel. Closing a closed channel panics. The program crashes.

**Fix.**

Only the *owner* closes a channel, and only once. Common pattern: a dedicated producer goroutine closes the channel after sending all values.

```go
ch := make(chan int, 10)
go func() {
    defer close(ch)
    for i := 0; i < 10; i++ {
        ch <- 1
    }
}()
```

---

## Bug 8 — Concurrent reads of a slow value

```go
var x int
go func() {
    x = compute()
}()
fmt.Println(x)
```

**What is wrong?**

Two problems. First, a race: the main goroutine reads `x` while another is writing. Second, the main goroutine may read `x` before any write has happened, printing 0.

**Fix.**

Synchronise. The simplest fix is a `WaitGroup`:

```go
var x int
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    x = compute()
}()
wg.Wait()
fmt.Println(x)
```

---

## Bug 9 — Spawning a goroutine per byte

```go
data := []byte("hello world ...")
var wg sync.WaitGroup
for _, b := range data {
    wg.Add(1)
    go func(b byte) {
        defer wg.Done()
        // trivial work
        _ = b * 2
    }(b)
}
wg.Wait()
```

**What is wrong?**

For each byte you spawn a goroutine. Per-goroutine overhead (allocation, scheduling) is hundreds of nanoseconds; the work (`b * 2`) is one nanosecond. The concurrent code is hundreds of times slower than a single loop.

**Fix.**

Just iterate.

```go
for _, b := range data {
    _ = b * 2
}
```

Use goroutines only when per-task work is much larger than per-task overhead.

---

## Bug 10 — False sharing in concurrent counters

```go
type stats struct {
    a int64
    b int64
}
var s stats

go func() {
    for i := 0; i < 1_000_000; i++ {
        s.a++
    }
}()
go func() {
    for i := 0; i < 1_000_000; i++ {
        s.b++
    }
}()
```

**What is wrong?**

Two issues. First, the increments race (use atomics). Second, even if you fix the race with atomics, `a` and `b` likely share a cache line, so two cores contend on the line and throughput drops.

**Fix.**

```go
type stats struct {
    a int64
    _ [56]byte
    b int64
    _ [56]byte
}
// then atomic.AddInt64(&s.a, 1) etc.
```

---

## Bug 11 — Mutex held across a slow call

```go
var mu sync.Mutex
var cache = map[string]string{}

func get(key string) string {
    mu.Lock()
    defer mu.Unlock()
    if v, ok := cache[key]; ok {
        return v
    }
    v := slowFetch(key) // takes 100 ms
    cache[key] = v
    return v
}
```

**What is wrong?**

The lock is held during the 100 ms fetch. Every other concurrent caller blocks. Concurrency collapses to sequential.

**Fix.**

Release the lock during the slow call. Use `singleflight` to dedupe concurrent fetches for the same key:

```go
var g singleflight.Group

func get(key string) string {
    mu.Lock()
    if v, ok := cache[key]; ok {
        mu.Unlock()
        return v
    }
    mu.Unlock()
    v, _, _ := g.Do(key, func() (interface{}, error) {
        return slowFetch(key), nil
    })
    mu.Lock()
    cache[key] = v.(string)
    mu.Unlock()
    return v.(string)
}
```

---

## Bug 12 — Mistaking concurrency for parallelism

```go
func main() {
    runtime.GOMAXPROCS(1)
    var wg sync.WaitGroup
    n := 1_000_000_000
    chunks := 8
    chunk := n / chunks
    out := make([]int64, chunks)
    for c := 0; c < chunks; c++ {
        wg.Add(1)
        go func(c int) {
            defer wg.Done()
            var s int64
            for i := c * chunk; i < (c+1)*chunk; i++ {
                s += int64(i)
            }
            out[c] = s
        }(c)
    }
    wg.Wait()
}
```

**What is wrong?**

The CPU-bound code is split into 8 goroutines, but `GOMAXPROCS=1` forces them onto a single thread. They take turns; there is no parallel work. Total time is the same as sequential plus scheduling overhead.

**Fix.**

Remove the `runtime.GOMAXPROCS(1)` call, or set it to `runtime.NumCPU()`. For CPU-bound parallel work you need real cores.

---

## Bug 13 — Forgetting to drain a channel

```go
func main() {
    ch := make(chan int)
    go func() {
        for i := 0; i < 10; i++ {
            ch <- i
        }
        close(ch)
    }()
    for v := range ch {
        if v == 5 {
            return // break out of main early
        }
        fmt.Println(v)
    }
}
```

**What is wrong?**

When `v == 5` we return from `main`. The program exits, terminating any pending goroutine sends to `ch`. In this specific case, since `main` returns, the program shuts down — no leak in practice. But the **pattern** is dangerous: in any non-`main` function returning early from a `range` loop, the producer keeps trying to send and the goroutine leaks.

**Fix.**

Add a cancellation signal:

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
ch := make(chan int)
go func() {
    defer close(ch)
    for i := 0; i < 10; i++ {
        select {
        case <-ctx.Done():
            return
        case ch <- i:
        }
    }
}()
for v := range ch {
    if v == 5 {
        return
    }
    fmt.Println(v)
}
```

---

## Bug 14 — Reading the wrong "now"

```go
var counter int
go func() {
    for i := 0; i < 1_000_000; i++ {
        counter++
    }
}()
time.Sleep(time.Second)
fmt.Println(counter)
```

**What is wrong?**

The race. Even if you "got lucky" and saw 1_000_000, the program is broken. The Go memory model does not guarantee the main goroutine sees the updates without synchronisation. The compiler may even hoist the read of `counter` out of any subsequent loop, observing only the initial value.

**Fix.**

Synchronise the read with the write. Use `WaitGroup`, atomics, or a channel.

---

## Bug 15 — Concurrent map writes

```go
m := map[string]int{}
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        m[fmt.Sprintf("k%d", i)] = i
    }(i)
}
wg.Wait()
```

**What is wrong?**

Go's built-in `map` is not safe for concurrent use with at least one writer. The runtime detects this and panics with "fatal error: concurrent map writes" (since Go 1.6). Sometimes it does not detect and you get silent corruption.

**Fix (option A).** Protect with a mutex.

```go
var mu sync.Mutex
// ...
mu.Lock()
m["k"] = i
mu.Unlock()
```

**Fix (option B).** Use `sync.Map`, designed for concurrent use.

```go
var m sync.Map
m.Store("k", i)
```

---

## Bug 16 — The "all-or-nothing" anti-pattern

```go
func fetchAll(urls []string) ([]string, error) {
    out := make([]string, len(urls))
    var wg sync.WaitGroup
    var firstErr error
    for i, u := range urls {
        wg.Add(1)
        go func(i int, u string) {
            defer wg.Done()
            body, err := fetch(u)
            if err != nil {
                firstErr = err
                return
            }
            out[i] = body
        }(i, u)
    }
    wg.Wait()
    return out, firstErr
}
```

**What is wrong?**

Two problems. First, `firstErr` is racily written by concurrent goroutines (no mutex). Second, if any URL fails, the rest still run to completion — there is no cancellation. The result is partial; the error is *one* of the errors but not deterministically the first.

**Fix.**

Use `errgroup`:

```go
import "golang.org/x/sync/errgroup"

func fetchAll(ctx context.Context, urls []string) ([]string, error) {
    out := make([]string, len(urls))
    g, ctx := errgroup.WithContext(ctx)
    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            body, err := fetch(ctx, u)
            if err != nil {
                return err
            }
            out[i] = body
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return out, nil
}
```

The first error cancels `ctx`, aborting the in-flight fetches.

---

## Bug 17 — Recursive goroutines without bound

```go
func walk(n *Node) {
    if n == nil {
        return
    }
    go walk(n.Left)
    go walk(n.Right)
    visit(n)
}
```

**What is wrong?**

Every node spawns two goroutines. For a tree of N nodes, you get 2N goroutines, and you do not wait for any of them. The function returns before children visit. If `main` exits before the tree is fully processed, nodes are skipped.

Beyond correctness, the spawning rate is huge — easy to spawn millions of goroutines for a million-node tree.

**Fix.**

Use a `WaitGroup` to wait. Bound concurrency with a semaphore:

```go
func walk(n *Node, wg *sync.WaitGroup, sem chan struct{}) {
    defer wg.Done()
    if n == nil {
        return
    }
    visit(n)

    if n.Left != nil {
        wg.Add(1)
        sem <- struct{}{}
        go func() {
            defer func() { <-sem }()
            walk(n.Left, wg, sem)
        }()
    }
    if n.Right != nil {
        walk(n.Right, wg, sem) // recurse on this goroutine for the other child
    }
}

func WalkTree(root *Node) {
    var wg sync.WaitGroup
    sem := make(chan struct{}, runtime.NumCPU())
    wg.Add(1)
    walk(root, &wg, sem)
    wg.Wait()
}
```

---

## Bug 18 — Mixing concurrent and serial work with shared state

```go
type counter struct {
    n int
}

func bump(c *counter) {
    c.n++
}

func main() {
    c := &counter{}
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            bump(c)
        }()
    }
    wg.Wait()
    fmt.Println(c.n)
}
```

**What is wrong?**

Same as Bug 3, but hidden behind a function. The race detector still catches it, but in larger codebases the issue is easy to miss.

**Fix.**

Either put the synchronisation inside `bump`:

```go
func (c *counter) Bump() {
    atomic.AddInt64(&c.n, 1)
}
```

Or document that `bump` is not safe for concurrent use and require callers to synchronise.

---

## Bug 19 — Blocking goroutine cancels nothing

```go
func slow(ctx context.Context) {
    for i := 0; i < 1_000_000_000; i++ {
        _ = expensive(i)
    }
}
```

**What is wrong?**

If `ctx` is cancelled, the function has no idea. It runs to completion regardless. The cancellation is silently ignored.

**Fix.**

Check `ctx.Done()` periodically.

```go
func slow(ctx context.Context) error {
    for i := 0; i < 1_000_000_000; i++ {
        if i%10000 == 0 {
            select {
            case <-ctx.Done():
                return ctx.Err()
            default:
            }
        }
        _ = expensive(i)
    }
    return nil
}
```

Check rate trades responsiveness vs overhead; one check per 10 000 iterations is a typical balance.

---

## Bug 20 — Channel as a hashmap

```go
ch := make(chan map[string]int, 1)

go func() {
    m := <-ch
    m["x"] = 1
    ch <- m
}()
go func() {
    m := <-ch
    m["y"] = 2
    ch <- m
}()
```

**What is wrong?**

This is a roundabout way to share a map between goroutines. It works (the channel enforces single-owner semantics), but it is opaque, error-prone, and has surprising performance (channel operations are slower than mutex operations for the same task). Also: if one goroutine forgets to send the map back, the other blocks forever.

**Fix.**

Use a mutex:

```go
var (
    mu sync.Mutex
    m  = map[string]int{}
)

go func() {
    mu.Lock()
    m["x"] = 1
    mu.Unlock()
}()
go func() {
    mu.Lock()
    m["y"] = 2
    mu.Unlock()
}()
```

Channels excel at *communication*. Mutexes excel at *protecting shared state*. Pick by intent.

---

## Bug 21 — Forgetting to start the goroutine

```go
done := make(chan struct{})
defer close(done)

func() { // forgot 'go' here
    for {
        select {
        case <-done:
            return
        default:
            tick()
        }
    }
}()
```

**What is wrong?**

The function literal is *called* (synchronously), not *spawned* with `go`. The outer goroutine blocks forever inside the loop (or until `done` is closed, which never happens because the deferred close cannot run).

**Fix.**

Add `go`.

```go
go func() {
    // ...
}()
```

---

## Bug 22 — Concurrent close

```go
var done chan struct{} = make(chan struct{})
go func() {
    work()
    close(done)
}()
go func() {
    work()
    close(done) // panic: close of closed channel
}()
```

**What is wrong?**

Two goroutines both close the channel. The second `close` panics.

**Fix.**

Either:
- Only one goroutine closes (the designated owner).
- Use `sync.Once` to ensure close happens once:

```go
var once sync.Once
closeDone := func() { once.Do(func() { close(done) }) }
go func() { work(); closeDone() }()
go func() { work(); closeDone() }()
```

Or use a `WaitGroup` to know when all workers are done, then close in a separate goroutine.

---

## Bug 23 — RLock held during slow operation

```go
var mu sync.RWMutex
var cache = map[string]string{}

func get(key string) string {
    mu.RLock()
    defer mu.RUnlock()
    if v, ok := cache[key]; ok {
        return v
    }
    return slowLookup(key) // takes 100 ms
}
```

**What is wrong?**

The `RLock` is held during the slow lookup. Concurrent reads of *other* keys are blocked... no, wait — RWMutex allows multiple readers. So this is not blocking other reads. However, *writers* are blocked for the entire 100 ms. If a writer is queued, all subsequent readers block too (most Go RWMutex implementations starve readers in favour of waiting writers).

Beyond that: the slow lookup itself is now serialised by the `defer mu.RUnlock()` — many concurrent gets for the same uncached key all do the slow lookup independently, leading to thundering herd.

**Fix.**

Release the lock before the slow call, use `singleflight` to dedupe, re-acquire to update.

---

## Bug 24 — Time-based wait instead of synchronisation

```go
go startWorker()
time.Sleep(time.Second) // hope the worker is ready
sendWork()
```

**What is wrong?**

On slow machines (CI, containers under load), one second may not be enough. The flakiness arrives later — in production at 3 a.m.

**Fix.**

Use an explicit "ready" channel.

```go
ready := make(chan struct{})
go func() {
    setupWorker()
    close(ready)
    runWorker()
}()
<-ready
sendWork()
```

---

## Bug 25 — Concurrent code that "works" without race detector

```go
var flag bool
var data int

go func() {
    data = compute()
    flag = true
}()

for !flag {
    runtime.Gosched()
}
fmt.Println(data)
```

**What is wrong?**

The race detector catches it. The main goroutine spins reading `flag` while another writes it. Without synchronisation, the Go memory model gives no guarantee that the main goroutine ever sees `flag = true`. Compilers may even hoist the read of `flag` out of the loop entirely.

Even if it "works" today, this is undefined behaviour.

**Fix.**

Use a proper synchronisation primitive — a channel or `sync.WaitGroup`:

```go
done := make(chan struct{})
var data int
go func() {
    data = compute()
    close(done)
}()
<-done
fmt.Println(data)
```

The channel close establishes a happens-before relationship between the write to `data` and the main goroutine's read.

---

## Closing

The patterns above repeat in production code under different names:

- Confusing concurrency with parallelism.
- Sharing without synchronisation.
- Leaking goroutines on slow / failure paths.
- Holding locks across slow operations.
- Spawning goroutines for trivial work.
- Closing channels from multiple goroutines.
- Relying on timing instead of explicit signals.

Every one of these is caught by `go test -race` if executed under the right conditions. The harder ones — false sharing, lock contention, tail amplification — need profiling. The conceptual ones — concurrency vs parallelism, the role of synchronisation — need understanding of the Go memory model (covered in [04-memory-model](../04-memory-model/)).

Run the race detector. Bound your goroutines. Document ownership. Profile, do not guess.
