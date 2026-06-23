# Goroutine Common Pitfalls — Find the Bug

> The heaviest file in this subsection. Twenty-five-plus broken programs across the full pitfall catalogue, from beginner-level to staff-level subtle. For each: read carefully, predict the symptom (panic, race, leak, deadlock, wrong output, fatal error, performance regression), identify the root cause, and sketch the fix before reading the solution.
>
> If you have read the rest of this subsection — and especially the [junior.md](junior.md) catalogue — every bug here should be recognisable in family, even if not at first glance.

---

## How to use this file

1. Read the snippet to the end before forming an opinion. Many bugs hide in line N+3, not where your eye lands.
2. State the *symptom*: what does running this program produce? Panic? Race? Hang? Wrong output? Fatal error?
3. State the *cause*: name the pitfall family — captured variable, missing cancel, wrong-closer, atomic mixing, etc.
4. Sketch the *fix*: not just "add a mutex," but specifically *which* mutex around *which* code.
5. Read the solution and compare. The solution explains why your fix works and what alternative fixes look like.

---

## Easy

### Bug 1 — Captured `i` in a worker spawn

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

**Observation.** On Go 1.21, output is often `5 5 5 5 5`. On Go 1.22+, some permutation of `0 1 2 3 4`.

**Find the bug.**

---

### Bug 2 — `wg.Add(1)` after `go`

```go
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
    go func() {
        wg.Add(1)
        defer wg.Done()
        doWork()
    }()
}
wg.Wait()
fmt.Println("done")
```

**Observation.** "done" prints almost immediately, before most goroutines finish.

**Find the bug.**

---

### Bug 3 — Sleep instead of Wait

```go
go heavyWork()
time.Sleep(time.Second)
fmt.Println("hopefully done")
```

**Observation.** On the developer's laptop, prints after work completes. On a busy CI runner, prints before.

**Find the bug.**

---

### Bug 4 — Panic in a worker

```go
func startWorker(jobs <-chan Job) {
    go func() {
        for j := range jobs {
            process(j)  // can panic on malformed Job
        }
    }()
}
```

**Observation.** A single bad input crashes the whole service.

**Find the bug.**

---

### Bug 5 — Unread result channel

```go
func compute(x int) int {
    ch := make(chan int)
    go func() {
        ch <- expensive(x)
    }()
    if cached, ok := cache[x]; ok {
        return cached
    }
    return <-ch
}
```

**Observation.** `runtime.NumGoroutine()` grows over time.

**Find the bug.**

---

### Bug 6 — `for range` without close

```go
ch := make(chan int)
go func() {
    for v := range ch {
        process(v)
    }
}()
for i := 0; i < 10; i++ {
    ch <- i
}
// program continues, never closes ch
```

**Observation.** Receiver goroutine leaks.

**Find the bug.**

---

### Bug 7 — Concurrent map write

```go
m := make(map[int]int)
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        m[i] = i * 2
    }(i)
}
wg.Wait()
```

**Observation.** Sometimes runs fine; sometimes crashes with `fatal error: concurrent map writes`. Cannot be recovered.

**Find the bug.**

---

### Bug 8 — Captured `&item`

```go
type Item struct { Name string }
for _, item := range items {
    go func() {
        process(&item)
    }()
}
```

**Observation (Go 1.21).** All goroutines process the last item.

**Find the bug.**

---

### Bug 9 — Double close

```go
ch := make(chan int)
var wg sync.WaitGroup
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        defer close(ch)         // each goroutine closes
        ch <- i
    }(i)
}
wg.Wait()
```

**Observation.** Panic: `close of closed channel`.

**Find the bug.**

---

### Bug 10 — Forgotten `cancel()`

```go
func fetch(parent context.Context, url string) (*Response, error) {
    ctx, _ := context.WithTimeout(parent, 5*time.Second)
    return doHTTP(ctx, url)
}
```

**Observation.** `go vet` warns. Under load, memory grows.

**Find the bug.**

---

## Medium

### Bug 11 — `time.After` in a select loop

```go
func consumer(messages <-chan Message) {
    for {
        select {
        case m := <-messages:
            handle(m)
        case <-time.After(time.Second):
            return
        }
    }
}
```

**Observation.** Memory grows under high message rates.

**Find the bug.**

---

### Bug 12 — `defer f.Close()` in a loop

```go
func processFiles(names []string) error {
    for _, name := range names {
        f, err := os.Open(name)
        if err != nil {
            return err
        }
        defer f.Close()
        if err := process(f); err != nil {
            return err
        }
    }
    return nil
}
```

**Observation.** On 10 000 files, fails with "too many open files."

**Find the bug.**

---

### Bug 13 — Mutex over HTTP

```go
type Cache struct {
    mu sync.Mutex
    data map[string][]byte
}

func (c *Cache) Get(key string) ([]byte, error) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if v, ok := c.data[key]; ok {
        return v, nil
    }
    resp, err := http.Get("https://upstream/" + key)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    b, _ := io.ReadAll(resp.Body)
    c.data[key] = b
    return b, nil
}
```

**Observation.** Cache hits are fast; cache misses serialise everything.

**Find the bug.**

---

### Bug 14 — Atomic + plain read

```go
var requests int64

func handle() {
    atomic.AddInt64(&requests, 1)
    process()
}

func report() {
    for range time.Tick(time.Second) {
        fmt.Println("requests:", requests) // plain read
    }
}
```

**Observation.** Race detector flags a race. Numbers occasionally look stale.

**Find the bug.**

---

### Bug 15 — Singleton via `if == nil`

```go
var db *sql.DB

func DB() *sql.DB {
    if db == nil {
        db = openDB()
    }
    return db
}
```

**Observation.** Under heavy startup, several DB pools are created; only the last is reachable.

**Find the bug.**

---

### Bug 16 — Background goroutine outliving request

```go
func handleUpload(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    go func() {
        time.Sleep(10 * time.Second)
        s3.Upload(body)
    }()
    w.WriteHeader(http.StatusAccepted)
}
```

**Observation.** Memory grows linearly with request rate.

**Find the bug.**

---

### Bug 17 — `errgroup` ignoring `ctx`

```go
g, ctx := errgroup.WithContext(parent)
for _, url := range urls {
    url := url
    g.Go(func() error {
        return slowFetch(url)   // doesn't use ctx
    })
}
err := g.Wait()
```

**Observation.** When one URL fails, `Wait` still takes the full slowFetch time for all others.

**Find the bug.**

---

### Bug 18 — Closing input mid-iteration

```go
jobs := make(chan Job)
var wg sync.WaitGroup
for i := 0; i < 8; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := range jobs {
            process(j)
        }
    }()
}

for _, j := range allJobs {
    jobs <- j
    if j.Final {
        close(jobs)
    }
}
wg.Wait()
```

**Observation.** Sometimes panics: `send on closed channel`.

**Find the bug.**

---

### Bug 19 — WaitGroup passed by value

```go
func spawn(wg sync.WaitGroup, work func()) {
    go func() {
        defer wg.Done()
        work()
    }()
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        spawn(wg, work)
    }
    wg.Wait()
}
```

**Observation.** `Wait` blocks forever. `go vet` warns.

**Find the bug.**

---

### Bug 20 — Tight loop and `Gosched`

```go
runtime.GOMAXPROCS(1)

var wg sync.WaitGroup
wg.Add(2)
go func() {
    defer wg.Done()
    for i := 0; i < 1_000_000_000; i++ {
        runtime.Gosched()
        _ = i
    }
}()
go func() {
    defer wg.Done()
    fmt.Println("hello")
}()
wg.Wait()
```

**Observation.** "hello" prints eventually, but the program never finishes.

**Find the bug.**

---

## Hard

### Bug 21 — Shutdown race

```go
type Service struct {
    jobs   chan Job
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func (s *Service) Shutdown() {
    close(s.jobs)
    s.cancel()
    s.wg.Wait()
}

func (s *Service) Submit(j Job) {
    s.jobs <- j
}
```

**Observation.** During shutdown under load, panic: `send on closed channel`.

**Find the bug.**

---

### Bug 22 — `time.Tick` leak

```go
func monitor() {
    for t := range time.Tick(time.Second) {
        publish(t)
        if shouldStop() {
            return
        }
    }
}
```

**Observation.** Goroutine returns, but the ticker keeps firing into memory until process exit. Tested by repeatedly calling `monitor()`.

**Find the bug.**

---

### Bug 23 — Nested `LockOSThread` confusion

```go
func enterNS(fd int) error {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    return syscall.Setns(fd, syscall.CLONE_NEWNET)
}

func makeCall(ns int) error {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    if err := enterNS(ns); err != nil {
        return err
    }
    return dialAndRead()
}
```

**Observation.** Sometimes the dial happens in the wrong namespace.

**Find the bug.**

---

### Bug 24 — `sync.Once` capturing config

```go
var (
    once sync.Once
    cfg  *Config
)

func Initialize(c *Config) {
    once.Do(func() {
        cfg = c
        startBackground(c)
    })
}
```

**Observation.** Multiple callers pass different configs; only the first wins. Second callers silently use the first caller's config.

**Find the bug.**

---

### Bug 25 — RWMutex upgrade

```go
type Cache struct {
    mu   sync.RWMutex
    data map[string][]byte
}

func (c *Cache) GetOrLoad(key string) []byte {
    c.mu.RLock()
    if v, ok := c.data[key]; ok {
        c.mu.RUnlock()
        return v
    }
    c.mu.RUnlock()
    c.mu.Lock()
    v := load(key)
    c.data[key] = v
    c.mu.Unlock()
    return v
}
```

**Observation.** Under cache-miss bursts, `load(key)` is called multiple times for the same key.

**Find the bug.**

---

### Bug 26 — Send blocks on shutdown

```go
func (s *Service) Run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-s.jobs:
            s.results <- s.process(j)
        }
    }
}
```

**Observation.** During shutdown, `Run` hangs and never returns. `ctx.Done()` is closed; `s.jobs` is empty; but the goroutine is stuck.

**Find the bug.**

---

### Bug 27 — `init` spawning unmanaged goroutine

```go
package telemetry

var counters atomic.Int64

func init() {
    go func() {
        for range time.Tick(time.Second) {
            flush(counters.Load())
        }
    }()
}
```

**Observation.** Every test in every package that imports `telemetry` runs the flusher. Tests are slow and flaky.

**Find the bug.**

---

### Bug 28 — Panic taking down all peers

```go
func parallelMap(items []Item, fn func(Item) int) []int {
    out := make([]int, len(items))
    var wg sync.WaitGroup
    for i := range items {
        i := i
        wg.Add(1)
        go func() {
            defer wg.Done()
            out[i] = fn(items[i])
        }()
    }
    wg.Wait()
    return out
}
```

**Observation.** Works perfectly until one `fn(item)` panics on a bad input — then the whole process crashes.

**Find the bug.**

---

### Bug 29 — Cgo holding M

```go
package main

/*
#include <unistd.h>
void slow(void) { sleep(2); }
*/
import "C"

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    for round := 0; round < 10; round++ {
        for i := 0; i < 100; i++ {
            go C.slow()
        }
        time.Sleep(2500 * time.Millisecond)
        fmt.Println("round", round, "goroutines:", runtime.NumGoroutine())
    }
}
```

**Observation.** Thread count climbs every round.

**Find the bug.**

---

### Bug 30 — Context not propagated in DB call

```go
func (s *Service) Lookup(ctx context.Context, id string) (*User, error) {
    return s.db.Query("SELECT * FROM users WHERE id = $1", id)
}
```

**Observation.** Client cancels request; server-side query continues, returning when the DB finally responds. Heavy retries pile up zombie queries.

**Find the bug.**

---

## Solutions

### Solution 1

Pre-1.22, `i` is one variable shared across all iterations of the `for` loop. The closure captures `&i`. By the time the goroutines run, the loop is finished and `i == 5`. All goroutines read `5`.

Fix: pass `i` as a parameter.

```go
go func(i int) { fmt.Println(i) }(i)
```

This works on every Go version. On 1.22+, the original code also works because each iteration has a fresh `i`. Still prefer the parameter pass for portability and explicitness.

---

### Solution 2

`wg.Add(1)` is inside the goroutine body, so it runs in parallel with `wg.Wait()`. The race: `Wait` may run before any goroutine has executed its `Add`, see counter = 0, and return immediately.

Fix:

```go
for i := 0; i < 100; i++ {
    wg.Add(1)               // parent, serial with the for loop
    go func() {
        defer wg.Done()
        doWork()
    }()
}
```

The `sync.WaitGroup` docs are explicit: "calls with a positive delta that occur when the counter is zero must happen before a Wait."

---

### Solution 3

`time.Sleep` is hope, not synchronisation. The goroutine may take 500 ms, 2 s, or longer. The program prints "hopefully done" with the work still running.

Fix:

```go
done := make(chan struct{})
go func() {
    heavyWork()
    close(done)
}()
<-done
fmt.Println("definitely done")
```

Or `WaitGroup`, or `errgroup`. Never `time.Sleep`.

---

### Solution 4

A panic inside the goroutine, with no `recover` in the goroutine's `defer` chain, kills the entire process. Recovering in some other goroutine does not help.

Fix: defend the goroutine boundary.

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v\n%s", r, debug.Stack())
        }
    }()
    for j := range jobs {
        process(j)
    }
}()
```

Better fix: `process` should not panic on user input; return an error.

---

### Solution 5

The goroutine sends on an unbuffered channel: `ch <- expensive(x)`. If the function returns early via the cache hit, no one reads `ch`, the send blocks forever, the goroutine leaks.

Fix 1: buffer the channel.

```go
ch := make(chan int, 1)
```

Now the send completes whether or not anyone reads. The channel (and its single value) are GC'd with the function frame.

Fix 2: always read.

```go
v := <-ch
if cached, ok := cache[x]; ok {
    return cached
}
return v
```

---

### Solution 6

`for v := range ch` exits only when `ch` is closed. The producer's `for i := 0; i < 10; i++` finishes, but the program never closes `ch`. The receiver waits forever.

Fix:

```go
go func() {
    for i := 0; i < 10; i++ {
        ch <- i
    }
    close(ch)
}()
```

If multiple senders, use the single-closer pattern: a goroutine that waits on a `WaitGroup` of senders and then closes.

---

### Solution 7

The built-in `map` is not safe for concurrent use. The Go runtime adds explicit checks that, on detecting concurrent writes, abort the program with `fatal error: concurrent map writes`. This is *not* a panic — `recover` does not catch it.

Fix 1: mutex.

```go
var mu sync.Mutex
go func(i int) {
    defer wg.Done()
    mu.Lock()
    m[i] = i * 2
    mu.Unlock()
}(i)
```

Fix 2: `sync.Map`.

```go
var sm sync.Map
go func(i int) {
    defer wg.Done()
    sm.Store(i, i*2)
}(i)
```

`sync.Map` is best for write-once-read-many or disjoint-key-sets-per-goroutine. For most map use cases, `map + Mutex` is faster.

---

### Solution 8

`item` is the loop variable, mutated each iteration. Even though it is declared by `for _, item := range items`, in Go ≤ 1.21 it is a single variable. `&item` is the same address every time. By the time the goroutines run, `item` holds the last value.

Fix on all versions:

```go
for _, item := range items {
    item := item        // shadow
    go func() {
        process(&item)
    }()
}
```

Or:

```go
for _, item := range items {
    go func(item Item) {
        process(&item)
    }(item)
}
```

Note: even on Go 1.22+, *only* `for ... range` and `for i := ...; ...; ...` loop variables have per-iteration scope. Other variables inside the body still need explicit shadowing if captured.

---

### Solution 9

Each of the five goroutines `defer close(ch)`. The first close succeeds; the second panics with `close of closed channel`. Even before that, sends from goroutines that have not yet closed may race with a close from another goroutine — `send on closed channel`.

Fix: single-closer pattern.

```go
ch := make(chan int)
var wg sync.WaitGroup
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        ch <- i
    }(i)
}
go func() {
    wg.Wait()
    close(ch)
}()
for v := range ch {
    fmt.Println(v)
}
```

The closer goroutine waits for all senders and then closes once.

---

### Solution 10

`context.WithTimeout` returns a `cancel` function that must be called. Discarding it (`_ = cancel`) leaks the timer until the deadline fires. Under high call rates, in-flight contexts accumulate. `go vet` warns: "the cancel function is not used."

Fix:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
return doHTTP(ctx, url)
```

`defer cancel()` releases resources whether or not the timeout fires.

---

### Solution 11

`time.After` creates a fresh `Timer` on every call. The timer is alive in the runtime's heap until it fires or is GC'd. In a hot select loop, you accumulate one timer per loop iteration; if messages arrive at 100 k/s and timeout is 1 s, you have ~100 k pending timers in flight.

Fix: use a single `Timer` reused across iterations.

```go
timer := time.NewTimer(time.Second)
defer timer.Stop()
for {
    select {
    case m := <-messages:
        handle(m)
        if !timer.Stop() {
            <-timer.C
        }
        timer.Reset(time.Second)
    case <-timer.C:
        return
    }
}
```

The `Reset` dance is unfortunate. Go 1.23 made it simpler; check the release notes if you are on a recent toolchain.

---

### Solution 12

`defer` runs at function exit, not loop iteration exit. With 10 000 files, 10 000 file descriptors accumulate before any closes. The OS hits `ulimit -n` and `os.Open` returns errors.

Fix: extract the body to a function so `defer` scopes per-iteration.

```go
func processFiles(names []string) error {
    for _, name := range names {
        if err := processOne(name); err != nil {
            return err
        }
    }
    return nil
}

func processOne(name string) error {
    f, err := os.Open(name)
    if err != nil {
        return err
    }
    defer f.Close()
    return process(f)
}
```

---

### Solution 13

The mutex protects the in-memory map *and* the HTTP request. While the HTTP is in flight, no other goroutine can take the lock. Latency for all other operations spikes to the HTTP round-trip time. Throughput collapses.

Fix: move the HTTP outside the critical section.

```go
func (c *Cache) Get(key string) ([]byte, error) {
    c.mu.Lock()
    v, ok := c.data[key]
    c.mu.Unlock()
    if ok {
        return v, nil
    }

    // I/O outside lock
    resp, err := http.Get("https://upstream/" + key)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    b, _ := io.ReadAll(resp.Body)

    c.mu.Lock()
    c.data[key] = b
    c.mu.Unlock()
    return b, nil
}
```

Better: `singleflight` to deduplicate concurrent misses for the same key.

---

### Solution 14

`atomic.AddInt64` and a plain `_ = requests` read are mixing protocols. The atomic protocol promises happens-before only between atomic operations. A plain read may observe a torn value on some architectures, and the race detector flags it.

Fix:

```go
fmt.Println("requests:", atomic.LoadInt64(&requests))
```

Or use the typed wrapper:

```go
var requests atomic.Int64
requests.Add(1)
fmt.Println("requests:", requests.Load())
```

`atomic.Int64` makes the protocol explicit at the type level — you cannot accidentally do a plain read.

---

### Solution 15

`db == nil` check and `db = openDB()` assignment are not atomic. Two goroutines may both pass the check, both call `openDB`, both assign. The last write wins; earlier `db`s are garbage but their open connections persist until GC, briefly doubling the connection pool.

Fix: `sync.Once`.

```go
var (
    db   *sql.DB
    once sync.Once
)

func DB() *sql.DB {
    once.Do(func() {
        db = openDB()
    })
    return db
}
```

`sync.Once.Do` runs the function exactly once. Concurrent calls block until the first completes; subsequent calls return immediately.

---

### Solution 16

The goroutine captures `body` and outlives the request. Under load, each request pins its body for 10 seconds. At 1 k RPS, 10 k goroutines hold 10 k bodies — gigabytes.

Fix 1: bounded worker pool consuming from a buffered channel.

```go
type S3Uploader struct {
    queue chan []byte
}

func (u *S3Uploader) Submit(body []byte) error {
    select {
    case u.queue <- body:
        return nil
    default:
        return errBackpressure
    }
}
```

Workers consume from `queue` at controlled concurrency.

Fix 2: respond to the client after upload completes. This may not be appropriate for `StatusAccepted`-style flows, but it gives the client a signal.

---

### Solution 17

`errgroup.WithContext` cancels `ctx` on first error. But `slowFetch` ignores `ctx`, so the other tasks continue. `Wait` returns the first error after waiting for all the slow ignoring tasks.

Fix:

```go
g.Go(func() error {
    return slowFetchCtx(ctx, url)        // pass ctx
})
```

Inside `slowFetchCtx`, the HTTP request uses `http.NewRequestWithContext(ctx, ...)` so cancellation propagates to the network layer.

---

### Solution 18

The producer sends, then checks `if j.Final { close(jobs) }`. If `j.Final` was the *last* job to send, the close is fine. But the producer continues to the next iteration of `for _, j := range allJobs` — which is a send on closed channel.

Fix: close *after* the loop, not inside.

```go
for _, j := range allJobs {
    jobs <- j
}
close(jobs)
wg.Wait()
```

If `j.Final` is supposed to signal early termination, use a separate mechanism (a `done` channel, or a context).

---

### Solution 19

`sync.WaitGroup` contains internal state. Passing by value copies the state. The function's local `wg` is independent from the caller's. `Done` on the local copy does not decrement the caller's counter; the caller's `Wait` blocks forever.

`go vet`'s `copylocks` check catches this.

Fix:

```go
func spawn(wg *sync.WaitGroup, work func()) {
    go func() {
        defer wg.Done()
        work()
    }()
}
```

---

### Solution 20

Pre-Go 1.14, the scheduler could not preempt at arbitrary instructions; only at function call points. A tight loop with no function calls held the M indefinitely.

But this code *does* call `runtime.Gosched()` — a yield. The yield happens; the second goroutine runs and prints "hello." The bug is the *loop never ends*: 1 000 000 000 iterations, with `Gosched` each, takes a long time even on a fast machine. The `wg.Wait()` blocks until the first goroutine returns, which is after 1 billion yields.

Fix: make the loop actually exit. Or, if "make the loop yield" is the goal, the yield is correct on Go 1.14+ even without `Gosched` (async preemption handles it).

---

### Solution 21

`Shutdown` closes `s.jobs` first. If a `Submit` is in flight, the send on the now-closed channel panics.

Fix sequence:

1. Cancel context (signal producers).
2. Wait for producers to drain (via a separate WaitGroup or a "draining" flag).
3. Close `s.jobs`.
4. Wait for consumers via `s.wg`.

Or: make `Submit` context-aware and check a `closed` flag before sending.

```go
func (s *Service) Submit(j Job) error {
    select {
    case <-s.shutdownCtx.Done():
        return errClosed
    case s.jobs <- j:
        return nil
    }
}
```

The `select` ensures the send respects shutdown.

---

### Solution 22

`time.Tick` returns a channel from a `Ticker` that cannot be stopped. When `monitor` returns, the ticker continues firing into a channel no one reads. The ticker's internal goroutine and channel live until process exit. Calling `monitor()` repeatedly accumulates leaked tickers.

Fix:

```go
func monitor() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for tick := range t.C {
        publish(tick)
        if shouldStop() {
            return
        }
    }
}
```

`time.NewTicker` + `defer t.Stop()` is the only production-safe pattern.

---

### Solution 23

`LockOSThread` calls are counted: two calls require two unlocks to unpin. After `enterNS` returns, its `defer UnlockOSThread` decrements once — but `makeCall` is still pinned. Fine so far.

The bug is more subtle. If `enterNS`'s `defer UnlockOSThread` fires *after* `Setns` succeeded, and then `makeCall` continues, the goroutine is still pinned (thanks to `makeCall`'s outer `LockOSThread`). So the namespace switch persists. OK.

But what if `enterNS` is called *not* from `makeCall`? Then the inner `defer` decrements to zero, the goroutine becomes unpinned, the scheduler may move it to another M (which is in the *original* namespace). The dial happens on the wrong M.

Fix: be explicit about who pins. Either:

- Do not pin in `enterNS`; require the caller to be pinned.
- Or pin once and pass through.

Reference-counted locking is rarely the right pattern; explicit ownership is cleaner.

---

### Solution 24

`sync.Once.Do` runs the function exactly once. The first caller's `c` is bound; subsequent callers' `c` is ignored. Worse: the *second caller has no way to know* its config was discarded.

Fix patterns:

- Document the contract: "first caller wins."
- Return an error if called twice with different configs.
- Or remove the singleton pattern: pass config explicitly into each function call.

A general lesson: `sync.Once` for *idempotent* initialisation only. If the function has caller-specific parameters, `Once` is the wrong tool.

---

### Solution 25

Between `RUnlock` and `Lock`, another goroutine may have completed the same `GetOrLoad(key)` and populated the map. The current goroutine then re-loads, calling `load(key)` redundantly. If `load` has side effects (counter increment, billing event, external API call), duplication is a bug.

Fix: double-checked locking.

```go
func (c *Cache) GetOrLoad(key string) []byte {
    c.mu.RLock()
    v, ok := c.data[key]
    c.mu.RUnlock()
    if ok { return v }

    c.mu.Lock()
    defer c.mu.Unlock()
    if v, ok := c.data[key]; ok {
        return v        // someone else loaded
    }
    v = load(key)
    c.data[key] = v
    return v
}
```

Or use `singleflight.Group` to deduplicate `load` calls.

---

### Solution 26

`ctx.Done()` and `<-s.jobs` are in a `select`. If `s.results <- s.process(j)` blocks (no consumer), the goroutine is stuck in the send, *not* in the select. `ctx.Done()` cannot help — the select has already chosen the `jobs` case and moved past it.

Fix: nest a select around the send.

```go
case j := <-s.jobs:
    result := s.process(j)
    select {
    case s.results <- result:
    case <-ctx.Done():
        return
    }
```

Every potentially blocking operation in a long-running goroutine must be ctx-aware.

---

### Solution 27

`init` spawns a goroutine that lives forever. The goroutine cannot be stopped. Every test in every package that imports `telemetry` (directly or transitively) runs the flusher. Tests pollute each other; `goleak` flags the leak.

Fix: replace with an explicit lifecycle.

```go
type Telemetry struct { ... }

func Start(ctx context.Context) *Telemetry {
    t := &Telemetry{}
    t.wg.Add(1)
    go t.run(ctx)
    return t
}

func (t *Telemetry) Stop() {
    t.cancel()
    t.wg.Wait()
}
```

Callers (including test setup) explicitly start and stop.

---

### Solution 28

Each `fn` runs in its own goroutine. A panic in any of them has no local `recover`. The runtime terminates the entire process.

Fix: install a `recover` per goroutine.

```go
for i := range items {
    i := i
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer func() {
            if r := recover(); r != nil {
                log.Printf("item %d panicked: %v", i, r)
                // record the failure somehow
            }
        }()
        out[i] = fn(items[i])
    }()
}
```

Better: design `fn` to return an error rather than panic. The recover is defence in depth; the real fix is upstream input validation.

---

### Solution 29

Each `go C.slow()` spawns a goroutine that calls a C function. While inside the C call, the goroutine holds an M (the Go runtime cannot reuse the M for other goroutines while it is in C code). 100 concurrent cgo calls = 100 Ms held. Each iteration of the outer loop spawns 100 more before the previous 100 finish (because `time.Sleep(2500ms)` is just longer than the C sleep). The runtime accumulates Ms.

Fix: bound cgo concurrency with a semaphore.

```go
sem := make(chan struct{}, 10)
for round := 0; round < 10; round++ {
    for i := 0; i < 100; i++ {
        sem <- struct{}{}
        go func() {
            defer func() { <-sem }()
            C.slow()
        }()
    }
}
```

Now at most 10 Ms are held by cgo calls at any time.

---

### Solution 30

`s.db.Query` uses no context. Cancellation of `ctx` (from a disconnected client) does not propagate to the DB driver. The query runs to completion, returning when the DB finally responds. Heavy retries → many zombie queries piled up.

Fix:

```go
return s.db.QueryContext(ctx, "SELECT * FROM users WHERE id = $1", id)
```

`QueryContext` (and `ExecContext`) propagate cancellation to the driver, which can cancel mid-query on supported databases.

---

## Wrap-up

These thirty bugs span the entire pitfall catalogue. They share a few patterns:

- **Lifetime bugs.** 5, 6, 10, 11, 16, 22, 27. The goroutine, channel, or context outlives its useful scope.
- **Ordering bugs.** 2, 3, 9, 18, 19, 21, 23. Operations happen in the wrong order or are not synchronised.
- **Sharing bugs.** 1, 7, 8, 13, 14, 15, 17, 24, 25, 28, 30. Two goroutines touch state unsafely.
- **Runtime-aware bugs.** 4, 12, 20, 26, 29. The bug shows up only when you understand the runtime: stack vs heap, M holding, async preemption, cgo.

Pattern recognition is the goal. After a year of practice, every one of these should jump off the page within five seconds.

Continue to [optimize.md](optimize.md) for performance-focused exercises, or revisit [junior.md](junior.md) for the catalogue overview.
