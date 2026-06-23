# Deadlock in Go — Find the Bug

> Each section presents broken code. Read it carefully, predict the symptom, then read the explanation and the fix. The bugs are real — every one has appeared in production Go code.

---

## How to use this file

1. Read the snippet.
2. State the symptom: panic, deadlock, leak, wrong output, race?
3. Identify the root cause.
4. Sketch a fix.
5. Read the explanation and compare.

---

## Bug 1: send to nobody

```go
package main

func main() {
    ch := make(chan int)
    ch <- 42
}
```

**Symptom.** `fatal error: all goroutines are asleep - deadlock!` immediately on startup.

**Root cause.** The unbuffered send blocks because there is no receiver. The main goroutine is the only goroutine. The runtime detects whole-program deadlock and aborts.

**Fix.** Either buffer the channel, or send from a goroutine that has a receiver waiting:

```go
ch := make(chan int, 1)
ch <- 42
```

Or:

```go
ch := make(chan int)
go func() { ch <- 42 }()
v := <-ch
_ = v
```

---

## Bug 2: receive from nobody

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    fmt.Println(<-ch)
}
```

**Symptom.** Same — `fatal error: all goroutines are asleep`.

**Root cause.** The receive blocks because no goroutine will ever send.

**Fix.** Add a sender goroutine, or use a buffered/closed channel.

---

## Bug 3: `for range` with no `close`

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    go func() {
        for i := 0; i < 5; i++ {
            ch <- i
        }
    }()
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Symptom.** Prints `0 1 2 3 4`, then `fatal error: all goroutines are asleep`.

**Root cause.** The producer sends 5 values and exits without closing. The consumer's `for range` blocks waiting for the next value. Once the producer goroutine has exited, only the main goroutine remains, parked on `<-ch`. Runtime detects deadlock.

**Fix.** `defer close(ch)` inside the producer:

```go
go func() {
    defer close(ch)
    for i := 0; i < 5; i++ {
        ch <- i
    }
}()
```

---

## Bug 4: closing in the wrong goroutine

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    go func() {
        for i := 0; i < 5; i++ {
            ch <- i
        }
    }()
    close(ch)
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Symptom.** Panic: `send on closed channel`.

**Root cause.** The `close(ch)` runs in the main goroutine *immediately* after the `go` statement, before the spawned goroutine has done anything. The first `ch <- i` then panics.

**Fix.** Close from the producer side:

```go
go func() {
    defer close(ch)
    for i := 0; i < 5; i++ {
        ch <- i
    }
}()
for v := range ch {
    fmt.Println(v)
}
```

---

## Bug 5: `WaitGroup` without `Done`

```go
package main

import "sync"

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        // forgot wg.Done()
    }()
    wg.Wait()
}
```

**Symptom.** `fatal error: all goroutines are asleep` after the goroutine exits.

**Root cause.** The counter starts at 1, the goroutine exits without decrementing, the main goroutine waits forever.

**Fix.** `defer wg.Done()` first inside the body:

```go
go func() {
    defer wg.Done()
    // ...
}()
```

---

## Bug 6: `Add` after `Wait`

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    go func() {
        wg.Add(1)
        defer wg.Done()
        fmt.Println("work")
    }()
    wg.Wait()
}
```

**Symptom.** Often prints nothing and exits. Sometimes panics with `sync: WaitGroup is reused before previous Wait has returned`.

**Root cause.** `wg.Wait()` runs immediately because the counter is 0 — the spawned goroutine has not yet called `Add`. Even if it does, the timing is racy.

**Fix.** Always `Add` before `go`:

```go
wg.Add(1)
go func() {
    defer wg.Done()
    fmt.Println("work")
}()
wg.Wait()
```

---

## Bug 7: classic mutex inversion

```go
package main

import "sync"

var muA, muB sync.Mutex

func ab() {
    muA.Lock()
    muB.Lock()
    muB.Unlock()
    muA.Unlock()
}

func ba() {
    muB.Lock()
    muA.Lock()
    muA.Unlock()
    muB.Unlock()
}

func main() {
    go ab()
    ba()
}
```

**Symptom.** `fatal error: all goroutines are asleep` with two goroutines parked on `sync.Mutex.Lock`.

**Root cause.** `ab` grabs A then asks for B; `ba` grabs B then asks for A. Each holds what the other needs. Cycle.

**Fix.** Acquire in a canonical order. By rule, always A before B:

```go
func ba() {
    muA.Lock()  // changed from muB.Lock()
    muB.Lock()
    muA.Unlock()
    muB.Unlock()
}
```

---

## Bug 8: self-deadlock with non-reentrant mutex

```go
package main

import "sync"

var mu sync.Mutex

func outer() {
    mu.Lock()
    inner()
    mu.Unlock()
}

func inner() {
    mu.Lock()
    defer mu.Unlock()
    // ...
}

func main() {
    outer()
}
```

**Symptom.** `fatal error: all goroutines are asleep`.

**Root cause.** `sync.Mutex` is not reentrant. The same goroutine calling `Lock` twice blocks forever.

**Fix.** Split into a public locked wrapper and a private unlocked implementation:

```go
func outer() {
    mu.Lock()
    defer mu.Unlock()
    innerLocked()
}

func inner() {
    mu.Lock()
    defer mu.Unlock()
    innerLocked()
}

func innerLocked() {
    // ... assumes mu is held
}
```

---

## Bug 9: forgotten `Unlock` on early return

```go
package main

import (
    "errors"
    "sync"
)

type Store struct {
    mu    sync.Mutex
    valid bool
    data  map[string]string
}

func (s *Store) Set(key, val string) error {
    s.mu.Lock()
    if !s.valid {
        return errors.New("invalid")
    }
    s.data[key] = val
    s.mu.Unlock()
    return nil
}
```

**Symptom.** First call with `!s.valid` leaks the lock. The next call blocks forever.

**Root cause.** The early return path does not unlock.

**Fix.** Always use `defer Unlock`:

```go
func (s *Store) Set(key, val string) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    if !s.valid {
        return errors.New("invalid")
    }
    s.data[key] = val
    return nil
}
```

---

## Bug 10: nil channel in `select`

```go
package main

import "fmt"

func main() {
    var ch chan int
    select {
    case v := <-ch:
        fmt.Println(v)
    }
}
```

**Symptom.** `fatal error: all goroutines are asleep`.

**Root cause.** Receive on a nil channel blocks forever. `select` with one nil-channel case is equivalent to `select {}`.

**Fix.** Initialize the channel:

```go
ch := make(chan int)
```

Or include another case (typically `ctx.Done`) or a default.

---

## Bug 11: blocked send in `select` with no default

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    done := make(chan struct{})
    select {
    case ch <- 1:
        fmt.Println("sent")
    case <-done:
        fmt.Println("done")
    }
}
```

**Symptom.** `fatal error: all goroutines are asleep`.

**Root cause.** No receiver for `ch`, no closer for `done`. Both cases block forever.

**Fix.** Either start a receiver on `ch`, close `done`, or add a `default`:

```go
select {
case ch <- 1:
case <-done:
default:
    fmt.Println("would block")
}
```

---

## Bug 12: DB call while holding cache lock

```go
type Cache struct {
    mu    sync.Mutex
    items map[string]*Item
}

func (c *Cache) Get(key string) (*Item, error) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if v, ok := c.items[key]; ok {
        return v, nil
    }
    v, err := db.Load(key)
    if err != nil {
        return nil, err
    }
    c.items[key] = v
    return v, nil
}
```

**Symptom.** Under load, all `Get` calls eventually hang. The runtime detector does not fire because HTTP handlers keep the program alive.

**Root cause.** `db.Load` is called with `c.mu` held. If the DB is slow or blocked (e.g., waiting on another goroutine that wants `c.mu`), the deadlock manifests across the cache and DB.

**Fix.** Release the lock around the DB call. Use `singleflight` to deduplicate concurrent misses:

```go
func (c *Cache) Get(key string) (*Item, error) {
    c.mu.Lock()
    if v, ok := c.items[key]; ok {
        c.mu.Unlock()
        return v, nil
    }
    c.mu.Unlock()

    v, err, _ := c.sf.Do(key, func() (any, error) {
        return db.Load(key)
    })
    if err != nil {
        return nil, err
    }
    item := v.(*Item)

    c.mu.Lock()
    c.items[key] = item
    c.mu.Unlock()
    return item, nil
}
```

---

## Bug 13: RWMutex reader holds while writer waits

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]int
}

func (c *Cache) GetOrSet(key string, val int) int {
    c.mu.RLock()
    if v, ok := c.m[key]; ok {
        c.mu.RUnlock()
        return v
    }
    // ... compute and store
    c.mu.Lock() // BAD: trying to upgrade
    c.m[key] = val
    c.mu.Unlock()
    c.mu.RUnlock() // unlock the read we still hold
    return val
}
```

**Symptom.** Deadlock on contention. The `Lock` call blocks waiting for all readers to release. Our own goroutine still holds the read lock. We are waiting for ourselves.

**Root cause.** `sync.RWMutex` does not support upgrade. A goroutine holding `RLock` cannot then acquire `Lock` — that is self-deadlock.

**Fix.** Release the read lock before acquiring the write lock, then re-check:

```go
func (c *Cache) GetOrSet(key string, val int) int {
    c.mu.RLock()
    if v, ok := c.m[key]; ok {
        c.mu.RUnlock()
        return v
    }
    c.mu.RUnlock()

    c.mu.Lock()
    defer c.mu.Unlock()
    if v, ok := c.m[key]; ok { // re-check inside write lock
        return v
    }
    c.m[key] = val
    return val
}
```

---

## Bug 14: `context.WithTimeout` with no `cancel` call

```go
func handler(parent context.Context) {
    ctx, _ := context.WithTimeout(parent, time.Second)
    doWork(ctx)
}
```

**Symptom.** Not a deadlock per se, but `go vet` reports: `the cancel function returned by context.WithTimeout should be called, not discarded`.

**Root cause.** The timer behind `WithTimeout` is not cancelled when `doWork` returns early. It will eventually fire, but until then it leaks. In high-call-rate handlers, this accumulates.

**Fix.** Always `defer cancel()`:

```go
func handler(parent context.Context) {
    ctx, cancel := context.WithTimeout(parent, time.Second)
    defer cancel()
    doWork(ctx)
}
```

---

## Bug 15: goroutine that ignores its context

```go
func work(ctx context.Context, ch <-chan Task) {
    for task := range ch {
        process(task)
    }
}
```

**Symptom.** When the caller cancels `ctx`, `work` keeps running. If the caller is blocked waiting for `work` to return, deadlock.

**Root cause.** `work` does not check `ctx.Done`. The `for range` blocks on `ch`, ignoring cancellation.

**Fix.** `select` on both:

```go
func work(ctx context.Context, ch <-chan Task) {
    for {
        select {
        case <-ctx.Done():
            return
        case task, ok := <-ch:
            if !ok {
                return
            }
            process(task)
        }
    }
}
```

---

## Bug 16: `errgroup` worker that does not check `ctx`

```go
g, ctx := errgroup.WithContext(context.Background())
g.Go(func() error {
    return work1(ctx)
})
g.Go(func() error {
    return work2() // forgot to pass ctx
})
err := g.Wait()
```

**Symptom.** When `work1` fails, `errgroup` cancels `ctx`, but `work2` does not know — it has no context. `work2` runs to completion regardless. `g.Wait` blocks until `work2` finishes, possibly never.

**Root cause.** `work2` is not cancellable.

**Fix.** Pass `ctx` to every worker:

```go
g.Go(func() error {
    return work2(ctx)
})
```

And make sure `work2` actually observes `ctx.Done`.

---

## Bug 17: locked goroutine sending to a slow channel

```go
type Logger struct {
    mu sync.Mutex
    ch chan string
}

func (l *Logger) Log(msg string) {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.ch <- msg
}
```

**Symptom.** If the consumer of `l.ch` is slow, `Log` blocks holding the mutex. Other callers of `Log` block on the mutex. Throughput collapses to the speed of the consumer. If the consumer ever fully stops, deadlock.

**Root cause.** A blocking send is performed while holding a lock. The lock is held for the full duration of the channel-send wait.

**Fix.** Send outside the lock:

```go
func (l *Logger) Log(msg string) {
    // No lock needed at all if l.ch is set once and immutable.
    l.ch <- msg
}
```

If the channel itself needs protection (e.g., it can be replaced), copy the pointer under the lock and send outside:

```go
func (l *Logger) Log(msg string) {
    l.mu.Lock()
    ch := l.ch
    l.mu.Unlock()
    ch <- msg
}
```

---

## Bug 18: `Cond.Wait` without holding the lock

```go
var mu sync.Mutex
cond := sync.NewCond(&mu)

go func() {
    cond.Wait() // BUG: not holding mu
}()

mu.Lock()
cond.Signal()
mu.Unlock()
```

**Symptom.** Runtime panic: `sync: unlock of unlocked mutex`, or undefined behaviour. Sometimes the goroutine blocks forever.

**Root cause.** `cond.Wait` requires the lock to be held; it unlocks-and-parks atomically. Calling without the lock breaks the invariant.

**Fix.**

```go
go func() {
    mu.Lock()
    defer mu.Unlock()
    for !condition() {
        cond.Wait()
    }
}()
```

---

## Bug 19: spurious wakeup not handled

```go
mu.Lock()
if !ready {
    cond.Wait()
}
// use ready state
mu.Unlock()
```

**Symptom.** Occasionally the code proceeds when `ready` is still false. May then read uninitialized state.

**Root cause.** `cond.Wait` can return spuriously (especially with `Broadcast`). The condition must be re-checked after every wake.

**Fix.** `for` loop:

```go
mu.Lock()
for !ready {
    cond.Wait()
}
// safe to use ready state
mu.Unlock()
```

---

## Bug 20: deadlock with `sync.Once` recursion

```go
var once sync.Once

func setup() {
    once.Do(func() {
        // ...
        setup() // recursive call
    })
}
```

**Symptom.** `fatal error: all goroutines are asleep`, or hang.

**Root cause.** `sync.Once.Do` holds an internal mutex while `f` runs. A recursive call enters `Do` again, tries to acquire the mutex, blocks. Same-goroutine deadlock.

**Fix.** Restructure to not recurse, or use a different one-time pattern.

---

## Bug 21: fan-in close race

```go
func fanIn(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for v := range a {
            out <- v
        }
        close(out)
    }()
    go func() {
        for v := range b {
            out <- v
        }
        close(out) // BUG: second close panics
    }()
    return out
}
```

**Symptom.** Panic: `close of closed channel`. Or, before that, send-on-closed panic if one closer races ahead.

**Root cause.** Two goroutines both try to close `out`. The second closer panics.

**Fix.** Use `WaitGroup` and a single closer:

```go
func fanIn(a, b <-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        for v := range a {
            out <- v
        }
    }()
    go func() {
        defer wg.Done()
        for v := range b {
            out <- v
        }
    }()
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

---

## Bug 22: worker pool with no exit signal

```go
func worker(jobs <-chan Job) {
    for j := range jobs {
        process(j)
    }
}

func main() {
    jobs := make(chan Job, 10)
    for i := 0; i < 5; i++ {
        go worker(jobs)
    }
    for _, j := range allJobs() {
        jobs <- j
    }
    // forgot close(jobs); workers hang
}
```

**Symptom.** Main exits (no `Wait`), but workers are still running. Or, if main does `Wait`, deadlock.

**Root cause.** Workers loop on `for range jobs`. Without `close(jobs)`, they wait forever.

**Fix.**

```go
close(jobs) // tell workers no more jobs
```

After closing, workers' `for range` terminates when the channel drains. Combine with `WaitGroup` to wait for them.

---

## Bug 23: select with `default` masking the deadlock

```go
func send(ch chan int, v int) {
    select {
    case ch <- v:
    default:
        // dropped silently
    }
}
```

**Symptom.** No deadlock. But values are silently dropped. The behaviour you intended ("queue and process") is now "drop-on-overflow."

**Root cause.** Not a deadlock, but a deadlock-adjacent design smell. The `default` was added because the channel sometimes blocked. Now you have data loss.

**Fix.** Decide explicitly:

- If drop is correct: log or count drops so the data loss is visible.
- If drop is wrong: increase channel capacity or apply backpressure (block).

---

## Bug 24: time.Sleep masking detection in test

```go
func TestThing(t *testing.T) {
    ch := make(chan int)
    go func() {
        time.Sleep(time.Second)
    }()
    <-ch
}
```

**Symptom.** Test hangs for `time.Sleep` plus test framework's `-timeout` (default 10 minutes), then fails with `panic: test timed out after 10m0s`. Not a clear deadlock.

**Root cause.** The sleeping goroutine masks the runtime detector. The receive on `ch` is a real deadlock — there is no sender — but the sleeping goroutine has a pending timer, so `checkdead` does not fire.

**Fix.** Use a timeout in the test body explicitly:

```go
func TestThing(t *testing.T) {
    ch := make(chan int)
    done := make(chan struct{})
    go func() {
        defer close(done)
        <-ch
    }()
    select {
    case <-done:
    case <-time.After(time.Second):
        t.Fatal("deadlocked")
    }
}
```

---

## Bug 25: lost cancel in nested context

```go
func parent(ctx context.Context) error {
    ctx, cancel := context.WithCancel(ctx)
    // forgot defer cancel()

    if err := step1(ctx); err != nil {
        return err
    }
    return step2(ctx)
}
```

**Symptom.** Resource leak on every call. `go vet` reports `lostcancel`.

**Root cause.** Without `cancel()`, the internal goroutine that watches the parent context for cancellation leaks. The parent context may still cancel, but the timer/listener goroutine remains.

**Fix.** `defer cancel()` immediately after `WithCancel`.

---

## Bug 26: read deadline not set on cancel

```go
func readWithCtx(ctx context.Context, conn net.Conn, p []byte) (int, error) {
    type res struct {
        n   int
        err error
    }
    done := make(chan res, 1)
    go func() {
        n, err := conn.Read(p)
        done <- res{n, err}
    }()
    select {
    case r := <-done:
        return r.n, r.err
    case <-ctx.Done():
        return 0, ctx.Err()
    }
}
```

**Symptom.** When context is cancelled, the function returns. But the inner goroutine is still blocked on `conn.Read`. It will not exit until the OS read returns. Goroutine leak.

**Root cause.** Cancelling the context does not interrupt the system call.

**Fix.** Set a past deadline on the connection to unblock the read, then drain:

```go
case <-ctx.Done():
    conn.SetReadDeadline(time.Now())
    <-done
    return 0, ctx.Err()
```

---

## Bug 27: holding a lock during a callback

```go
type EventBus struct {
    mu        sync.Mutex
    listeners []func(Event)
}

func (b *EventBus) Publish(e Event) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for _, l := range b.listeners {
        l(e)
    }
}

func (b *EventBus) Subscribe(l func(Event)) {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.listeners = append(b.listeners, l)
}
```

**Symptom.** If any listener tries to `Subscribe` (or `Publish`) from inside its callback, deadlock — same-goroutine, same-mutex.

**Root cause.** Listener callbacks run while holding `mu`. Any listener that touches the bus deadlocks.

**Fix.** Copy listeners under the lock, release, then call:

```go
func (b *EventBus) Publish(e Event) {
    b.mu.Lock()
    listeners := append([]func(Event)(nil), b.listeners...)
    b.mu.Unlock()
    for _, l := range listeners {
        l(e)
    }
}
```

---

## Bug 28: `Mutex` copied by value

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func work(c Counter) {  // value receiver — copy
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}

func main() {
    var c Counter
    work(c)
    fmt.Println(c.n) // prints 0
}
```

**Symptom.** No deadlock (in this trivial case), but the increment is lost. `go vet` reports `passes lock by value`.

**Root cause.** `Counter` is passed by value. The `Lock` is on a copy, the increment is on a copy, the original is untouched. Worse, in more complex code two callers may end up racing on different copies of the same logical mutex, leading to corruption *and* later deadlock if they try to coordinate.

**Fix.** Pointer receiver:

```go
func work(c *Counter) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

---

## Bug 29: deadlock through channel of channels

```go
type Request struct {
    reply chan int
}

func server(reqs <-chan Request) {
    for req := range reqs {
        req.reply <- 42
    }
}

func main() {
    reqs := make(chan Request)
    go server(reqs)

    reply := make(chan int)
    reqs <- Request{reply: reply}
    // forgot to receive on reply
    close(reqs)
    select {} // wait
}
```

**Symptom.** Server hangs sending to `req.reply`. Main hangs in `select {}`. Runtime detector eventually fires once the server is the only blocked goroutine and main is parked.

**Root cause.** Server sends to `req.reply`, but main never receives. Server blocks on the send. With `select{}` parking main and no other liveness source, detection fires.

**Fix.** Always receive on the reply channel after sending:

```go
reqs <- Request{reply: reply}
v := <-reply
fmt.Println(v)
```

Or use a buffered reply channel (`make(chan int, 1)`) so the server's send does not block.

---

## Bug 30: deadlock in test cleanup

```go
func TestThing(t *testing.T) {
    server := startServer()
    t.Cleanup(func() {
        server.Shutdown(context.Background())
    })

    // test body that hangs the server somehow
}
```

**Symptom.** Test hangs in cleanup. `Shutdown` waits for in-flight handlers; if any are deadlocked, `Shutdown` blocks forever.

**Root cause.** `Shutdown(context.Background())` has no deadline. If handlers do not return, neither does `Shutdown`.

**Fix.** Pass a context with a deadline to `Shutdown`:

```go
t.Cleanup(func() {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    server.Shutdown(ctx)
})
```

After the timeout, `Shutdown` returns even if handlers are stuck. Then `goleak` (or the test framework) can flag the leaked goroutines.

---

## Bug 31: deadlock in init

```go
package thing

var once sync.Once
var instance *Thing

func init() {
    once.Do(func() {
        instance = newThing()
    })
}

func newThing() *Thing {
    Get() // depends on instance
    return &Thing{}
}

func Get() *Thing {
    once.Do(func() {
        instance = newThing()
    })
    return instance
}
```

**Symptom.** Deadlock on package initialization.

**Root cause.** `init` calls `Do`, which holds the internal `Once` mutex while running the function. The function calls `newThing`, which calls `Get`, which calls `Do` again. Same-goroutine recursion on `Once`.

**Fix.** Break the cycle. Either initialize without using `Once` in `init`, or restructure so `newThing` does not call `Get`.

---

## Bug 32: forever-blocked health check

```go
func healthCheck(w http.ResponseWriter, _ *http.Request) {
    storeMu.Lock()
    defer storeMu.Unlock()
    if store.IsHealthy() {
        w.WriteHeader(200)
    } else {
        w.WriteHeader(503)
    }
}
```

**Symptom.** Under load, `/healthz` hangs. Kubernetes liveness probe fails, pod is restarted, traffic spike, more failures. Cascade.

**Root cause.** `storeMu` is contested. The health check waits for the mutex held by some hot path. If that hot path is itself slow or deadlocked, the health check never completes — and the pod is killed for failing the probe rather than for the underlying issue.

**Fix.** Health checks should not block on application mutexes. Use atomic flags:

```go
var storeHealthy atomic.Bool

func healthCheck(w http.ResponseWriter, _ *http.Request) {
    if storeHealthy.Load() {
        w.WriteHeader(200)
    } else {
        w.WriteHeader(503)
    }
}
```

The store updates the flag asynchronously. Health check is lock-free and constant-time.

---

## Bug 33: errgroup with blocking work that ignores ctx

```go
g, ctx := errgroup.WithContext(context.Background())
g.Go(func() error {
    return fastWork(ctx)
})
g.Go(func() error {
    time.Sleep(time.Hour) // ignores ctx
    return nil
})
err := g.Wait()
```

**Symptom.** `g.Wait` blocks for an hour even if `fastWork` returns an error.

**Root cause.** `errgroup.WithContext` cancels `ctx` when any worker errors. But `time.Sleep` ignores context. The slow worker keeps sleeping.

**Fix.** Use a cancellable sleep:

```go
select {
case <-time.After(time.Hour):
case <-ctx.Done():
    return ctx.Err()
}
```

---

## Bug 34: deadlock from buffered channel under-sized

```go
func main() {
    ch := make(chan int, 1)
    ch <- 1
    ch <- 2 // blocks: buffer full
}
```

**Symptom.** `fatal error: all goroutines are asleep`.

**Root cause.** Buffer holds 1; second send blocks waiting for a receiver. None exists.

**Fix.** Size the buffer correctly, or have a receiver, or rethink the design.

---

## Bug 35: deadlock from `select` with all-blocked cases

```go
package main

func main() {
    a := make(chan int)
    b := make(chan int)
    select {
    case <-a:
    case <-b:
    }
}
```

**Symptom.** `fatal error: all goroutines are asleep`.

**Root cause.** Both cases block (no senders, no closes). `select` blocks until *one* case is ready. None will ever be. Main parks. Detector fires.

**Fix.** Provide a sender, close one of the channels, add a `time.After` case, or add a `default`.

---

## Practice protocol

Take any project you have written, pick a function at random that uses concurrency, and ask:

1. What blocking operations does it perform?
2. For each, what guarantees the wakeup?
3. Is there any path on which the wakeup never arrives?
4. Could this combine with another function's locking in a cycle?

If you cannot answer in under a minute, you have a candidate for a refactor — or a real bug waiting to surface.
