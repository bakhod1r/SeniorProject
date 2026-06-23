# Closing Channels — Tasks & Exercises

> Hands-on exercises grouped by difficulty. Each task has a goal, hints, and an extended solution. Try to solve before reading the solution.

---

## How to use this file

1. Read the task statement.
2. Attempt the solution before reading the hint.
3. Compile and run with `go run` and `go test -race`.
4. Compare to the model solution.
5. Some tasks have multiple acceptable solutions; the one shown is idiomatic.

Each task is self-contained. Working directory: `/tmp/close-tasks`.

---

## Junior

### Task 1: simple generator with close

**Goal.** Write a function `count(n int) <-chan int` that returns a channel emitting the integers `0..n-1` and then closes.

**Hint.** Spawn one goroutine inside the function, use `defer close`, return the channel.

**Solution.**

```go
package main

import "fmt"

func count(n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            out <- i
        }
    }()
    return out
}

func main() {
    for v := range count(5) {
        fmt.Println(v)
    }
}
```

**Expected output.**

```
0
1
2
3
4
```

**Why it works.** The `defer close(out)` runs after the loop completes. The consumer's `for range` exits when it sees the close.

---

### Task 2: read a closed channel five times

**Goal.** Demonstrate that a closed-drained channel can be received from any number of times without blocking, always returning the zero value.

**Hint.** Close the channel, then loop receiving and printing.

**Solution.**

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    close(ch)
    for i := 0; i < 5; i++ {
        v, ok := <-ch
        fmt.Println(i, v, ok)
    }
}
```

**Expected output.**

```
0 0 false
1 0 false
2 0 false
3 0 false
4 0 false
```

**Key takeaway.** Receive on closed never blocks, always returns zero value with `ok = false`.

---

### Task 3: distinguish closed from real zero

**Goal.** Send three values, one of them being zero. Close. Drain. Print whether each received value was a real send or post-close zero.

**Hint.** Use comma-ok in a for-loop.

**Solution.**

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)
    ch <- 10
    ch <- 0
    ch <- 20
    close(ch)
    for i := 0; i < 5; i++ {
        v, ok := <-ch
        if ok {
            fmt.Println("got value:", v)
        } else {
            fmt.Println("closed")
            return
        }
    }
}
```

**Expected output.**

```
got value: 10
got value: 0
got value: 20
closed
```

**Note.** The second value `0` is a *real* zero send (`ok = true`); the fourth iteration sees the closed-drained channel (`ok = false`).

---

### Task 4: broadcast cancellation

**Goal.** Spawn 5 worker goroutines. Each prints "stopping" when a done channel is closed. Close the done channel from main and verify all 5 print.

**Hint.** `chan struct{}` + `close`; use `sync.WaitGroup` to wait for them.

**Solution.**

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    done := make(chan struct{})
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            <-done
            fmt.Println("worker", id, "stopping")
        }(i)
    }
    close(done)
    wg.Wait()
}
```

**Expected output.** All 5 workers stop, in any order.

---

### Task 5: detect missing close

**Goal.** Write a program that demonstrates the deadlock when `for range` is used over an un-closed channel. Run it, observe the runtime's deadlock detector.

**Solution.**

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    go func() {
        for i := 0; i < 3; i++ {
            ch <- i
        }
        // intentionally no close
    }()
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Expected output.**

```
0
1
2
fatal error: all goroutines are asleep - deadlock!
```

**Key takeaway.** Always close a channel that the consumer iterates with `for range`.

---

### Task 6: trigger send-on-closed panic

**Goal.** Write a minimal program that panics with "send on closed channel."

**Solution.**

```go
package main

func main() {
    ch := make(chan int, 1)
    close(ch)
    ch <- 1 // panics
}
```

**Expected output.**

```
panic: send on closed channel
```

**Key takeaway.** Close is a one-way state transition; sends are forbidden after close.

---

## Middle

### Task 7: multi-sender close with synchronising closer

**Goal.** Three goroutines each send 10 integers on a shared channel. The channel must close exactly once after all senders are done. Consumer prints all 30 values.

**Hint.** `sync.WaitGroup` + a separate closer goroutine that calls `Wait` then `close`.

**Solution.**

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int)
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; j < 10; j++ {
                ch <- id*100 + j
            }
        }(i)
    }
    go func() {
        wg.Wait()
        close(ch)
    }()
    total := 0
    for v := range ch {
        _ = v
        total++
    }
    fmt.Println("received", total)
}
```

**Expected output.**

```
received 30
```

**Key takeaway.** Single-closer pattern via `Wait` + `close` in a coordinator goroutine.

---

### Task 8: idempotent close with `sync.Once`

**Goal.** Build a `SafeChannel` type with a `Close()` method that may be called any number of times safely. Verify by calling Close 5 times.

**Hint.** Embed a `sync.Once`; wrap the close call.

**Solution.**

```go
package main

import (
    "fmt"
    "sync"
)

type SafeChannel struct {
    Ch   chan int
    once sync.Once
}

func New() *SafeChannel { return &SafeChannel{Ch: make(chan int)} }

func (s *SafeChannel) Close() {
    s.once.Do(func() { close(s.Ch) })
}

func main() {
    s := New()
    for i := 0; i < 5; i++ {
        s.Close() // safe
    }
    _, ok := <-s.Ch
    fmt.Println("ok =", ok)
}
```

**Expected output.**

```
ok = false
```

**Key takeaway.** `sync.Once.Do` guarantees the close runs at most once.

---

### Task 9: pipeline with cascading close

**Goal.** Build a 3-stage pipeline: `source` emits 1..10, `square` squares them, `sum` accumulates. Run cleanly; close cascades.

**Solution.**

```go
package main

import "fmt"

func source(nums []int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            out <- n
        }
    }()
    return out
}

func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in {
            out <- n * n
        }
    }()
    return out
}

func sum(in <-chan int) int {
    total := 0
    for n := range in {
        total += n
    }
    return total
}

func main() {
    s := source([]int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10})
    q := square(s)
    fmt.Println(sum(q))
}
```

**Expected output.**

```
385
```

**Key takeaway.** Each stage closes its own output via `defer close`. The cascade is natural.

---

### Task 10: fan-in with merge

**Goal.** Merge three input channels into one output channel. The output closes when all three inputs close.

**Hint.** One goroutine per input copying to output; `WaitGroup` + closer for the output.

**Solution.**

```go
package main

import (
    "fmt"
    "sync"
)

func merge(cs ...<-chan int) <-chan int {
    var wg sync.WaitGroup
    out := make(chan int)
    output := func(c <-chan int) {
        defer wg.Done()
        for n := range c {
            out <- n
        }
    }
    wg.Add(len(cs))
    for _, c := range cs {
        go output(c)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}

func gen(start, n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            out <- start + i
        }
    }()
    return out
}

func main() {
    a := gen(0, 5)
    b := gen(100, 5)
    c := gen(1000, 5)
    count := 0
    for v := range merge(a, b, c) {
        _ = v
        count++
    }
    fmt.Println("received", count)
}
```

**Expected output.**

```
received 15
```

---

### Task 11: cancellable generator

**Goal.** Build a generator that produces an infinite stream but exits cleanly when a `context.Context` is cancelled. Demonstrate by cancelling after 100 ms.

**Solution.**

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func infinite(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        i := 0
        for {
            select {
            case <-ctx.Done():
                return
            case out <- i:
                i++
            }
        }
    }()
    return out
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    go func() {
        time.Sleep(100 * time.Millisecond)
        cancel()
    }()
    count := 0
    for range infinite(ctx) {
        count++
    }
    fmt.Println("emitted", count)
}
```

**Expected output.** A large variable count; the channel closes cleanly within ~100 ms.

**Key takeaway.** Cancellable generator: `select` on `ctx.Done()` + `out <- v`; `defer close(out)`.

---

### Task 12: done channel without closing data channel

**Goal.** Three senders share a data channel. A separate done channel signals shutdown. After done closes, all senders return, but the data channel is never closed (only drained). Demonstrate.

**Solution.**

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    data := make(chan int)
    done := make(chan struct{})
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; ; j++ {
                select {
                case <-done:
                    return
                case data <- id*100 + j:
                }
            }
        }(i)
    }

    received := 0
    go func() {
        for range data {
            received++
        }
    }()

    time.Sleep(50 * time.Millisecond)
    close(done)
    wg.Wait()
    fmt.Println("received", received)
}
```

**Expected output.** A large variable number; senders exited cleanly after `done` closed.

**Note.** `data` is intentionally never closed. The reader goroutine is leaked (intentionally for this demo). In production, you would close `data` after `wg.Wait()` and pair with a final drainer.

---

### Task 13: error result via wrapped struct

**Goal.** A worker emits results with possible errors. Use a `Result` struct; close the channel after the last result.

**Solution.**

```go
package main

import (
    "errors"
    "fmt"
)

type Result struct {
    Value int
    Err   error
}

func work(items []int) <-chan Result {
    out := make(chan Result)
    go func() {
        defer close(out)
        for _, it := range items {
            if it < 0 {
                out <- Result{Err: errors.New("negative")}
                return
            }
            out <- Result{Value: it * 2}
        }
    }()
    return out
}

func main() {
    for r := range work([]int{1, 2, 3, -1, 4}) {
        if r.Err != nil {
            fmt.Println("error:", r.Err)
            return
        }
        fmt.Println("value:", r.Value)
    }
}
```

**Expected output.**

```
value: 2
value: 4
value: 6
error: negative
```

---

## Senior

### Task 14: graceful HTTP server shutdown

**Goal.** Build a tiny HTTP server with a `/wait` endpoint that takes 5 seconds to respond. On SIGTERM, the server should close the listener, wait for in-flight handlers, and exit cleanly.

**Hint.** Use `http.Server.Shutdown` with a timeout.

**Solution.**

```go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/wait", func(w http.ResponseWriter, r *http.Request) {
        select {
        case <-time.After(5 * time.Second):
            fmt.Fprintln(w, "done")
        case <-r.Context().Done():
            // client disconnected
        }
    })

    srv := &http.Server{Addr: ":8080", Handler: mux}

    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    go func() {
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatal(err)
        }
    }()

    <-ctx.Done()
    log.Println("shutting down...")
    shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutCtx); err != nil {
        log.Println("shutdown error:", err)
    }
    log.Println("server exited")
}
```

**Test.** Run, hit `curl http://localhost:8080/wait`, then `Ctrl-C` the server. Observe it waits for the in-flight request.

**Key takeaway.** `http.Server.Shutdown` is the canonical "close listener, wait for handlers" pattern. Internally it uses `close` on a done channel.

---

### Task 15: bounded broadcaster

**Goal.** Build a broadcaster that supports up to 100 subscribers. Each subscriber receives every published event via its own channel. Slow subscribers drop messages.

**Solution.**

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Broadcaster struct {
    mu      sync.Mutex
    subs    map[chan int]struct{}
    closed  bool
}

func New() *Broadcaster {
    return &Broadcaster{subs: make(map[chan int]struct{})}
}

func (b *Broadcaster) Subscribe() (<-chan int, func()) {
    b.mu.Lock()
    defer b.mu.Unlock()
    ch := make(chan int, 16)
    if b.closed {
        close(ch)
        return ch, func() {}
    }
    b.subs[ch] = struct{}{}
    unsub := func() {
        b.mu.Lock()
        defer b.mu.Unlock()
        if _, ok := b.subs[ch]; ok {
            delete(b.subs, ch)
            close(ch)
        }
    }
    return ch, unsub
}

func (b *Broadcaster) Publish(v int) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for ch := range b.subs {
        select {
        case ch <- v:
        default:
        }
    }
}

func (b *Broadcaster) Close() {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.closed {
        return
    }
    b.closed = true
    for ch := range b.subs {
        close(ch)
    }
    b.subs = nil
}

func main() {
    b := New()
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        ch, _ := b.Subscribe()
        go func(id int, c <-chan int) {
            defer wg.Done()
            for v := range c {
                fmt.Println("sub", id, "got", v)
            }
            fmt.Println("sub", id, "exited")
        }(i, ch)
    }
    for i := 0; i < 5; i++ {
        b.Publish(i)
    }
    time.Sleep(50 * time.Millisecond)
    b.Close()
    wg.Wait()
}
```

**Key takeaway.** Each subscriber's channel is owned by the broadcaster; `Close` closes them all. `sync.Once`-style idempotence via `b.closed` flag.

---

### Task 16: detect a goroutine leak with close-correctness

**Goal.** Write a test that fails if a function leaks a goroutine. Use `runtime.NumGoroutine` before and after.

**Hint.** Capture baseline, run the function, sleep briefly to let cleanup finish, check delta.

**Solution.**

```go
package main

import (
    "runtime"
    "testing"
    "time"
)

func leaky() {
    ch := make(chan int)
    go func() {
        <-ch // never closes; leaks
    }()
}

func clean() {
    ch := make(chan int)
    done := make(chan struct{})
    go func() {
        select {
        case <-ch:
        case <-done:
        }
    }()
    close(done)
}

func TestLeaky(t *testing.T) {
    base := runtime.NumGoroutine()
    leaky()
    time.Sleep(10 * time.Millisecond)
    after := runtime.NumGoroutine()
    if after > base {
        t.Logf("leaked %d goroutines", after-base)
    }
}

func TestClean(t *testing.T) {
    base := runtime.NumGoroutine()
    clean()
    time.Sleep(10 * time.Millisecond)
    after := runtime.NumGoroutine()
    if after > base {
        t.Errorf("leaked %d goroutines", after-base)
    }
}
```

**Key takeaway.** `clean` uses a `done` channel + close to signal exit; `leaky` doesn't, so its goroutine is stuck.

---

### Task 17: race-free multi-sender with done channel

**Goal.** Combine the multi-sender pattern with a done channel for cancellation. Senders observe both "done" and "data full" cases.

**Solution.**

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

func main() {
    data := make(chan int)
    done := make(chan struct{})
    var wg sync.WaitGroup
    sent := atomic.Int64{}
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; ; j++ {
                select {
                case <-done:
                    return
                case data <- id*1000 + j:
                    sent.Add(1)
                }
            }
        }(i)
    }

    received := 0
    go func() {
        for range data {
            received++
        }
    }()

    time.Sleep(50 * time.Millisecond)
    close(done)
    wg.Wait()
    // drain any pending sends that may have happened between done check and our close
    // (none here because all senders exit on done; but pattern shown)
    close(data)
    fmt.Printf("sent=%d received=%d\n", sent.Load(), received)
}
```

**Key takeaway.** After `wg.Wait()` confirms all senders exited, `close(data)` is safe. The done channel cancels; the wait barrier proves quiescence; then close.

---

### Task 18: timeout-bounded shutdown

**Goal.** A worker may be in a long operation. Shutdown must wait up to 2 seconds; after that, give up and log.

**Solution.**

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Worker struct {
    done chan struct{}
    wg   sync.WaitGroup
    once sync.Once
}

func NewWorker() *Worker {
    w := &Worker{done: make(chan struct{})}
    w.wg.Add(1)
    go func() {
        defer w.wg.Done()
        select {
        case <-w.done:
            fmt.Println("worker stopping cleanly")
        case <-time.After(10 * time.Second):
            fmt.Println("worker timeout (long operation)")
        }
    }()
    return w
}

func (w *Worker) Stop(timeout time.Duration) error {
    w.once.Do(func() { close(w.done) })
    finished := make(chan struct{})
    go func() {
        w.wg.Wait()
        close(finished)
    }()
    select {
    case <-finished:
        return nil
    case <-time.After(timeout):
        return fmt.Errorf("shutdown timed out after %v", timeout)
    }
}

func main() {
    w := NewWorker()
    time.Sleep(20 * time.Millisecond)
    if err := w.Stop(2 * time.Second); err != nil {
        fmt.Println("error:", err)
    } else {
        fmt.Println("stopped cleanly")
    }
}
```

**Key takeaway.** Two closes: `done` for the signal, `finished` to bound the wait. The combination of close + select + timeout is the canonical bounded shutdown.

---

### Task 19: pipeline cancellation with `context`

**Goal.** Build a 3-stage pipeline that respects `ctx.Done()` for cancellation. Cancel mid-stream; verify clean exit.

**Solution.**

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func source(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-ctx.Done():
                return
            case out <- i:
            }
        }
    }()
    return out
}

func double(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in {
            select {
            case <-ctx.Done():
                return
            case out <- n * 2:
            }
        }
    }()
    return out
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    p := double(ctx, source(ctx))
    go func() {
        time.Sleep(50 * time.Millisecond)
        cancel()
    }()
    count := 0
    for range p {
        count++
    }
    fmt.Println("count", count)
}
```

**Key takeaway.** Every stage has `defer close(out)` and selects on `ctx.Done()`. Cancellation cascades cleanly.

---

### Task 20: detect "close called twice" in tests

**Goal.** Write a test that asserts a `Close` method is idempotent: calling it twice does not panic.

**Solution.**

```go
package main

import (
    "sync"
    "testing"
)

type Resource struct {
    ch   chan int
    once sync.Once
}

func New() *Resource { return &Resource{ch: make(chan int)} }
func (r *Resource) Close() { r.once.Do(func() { close(r.ch) }) }

func TestIdempotentClose(t *testing.T) {
    defer func() {
        if r := recover(); r != nil {
            t.Fatal("unexpected panic:", r)
        }
    }()
    r := New()
    for i := 0; i < 100; i++ {
        r.Close()
    }
}
```

---

### Task 21: priority select with closed done

**Goal.** Write a loop that prefers to check a "done" channel before processing work. If done closes, exit immediately, even if work is ready.

**Solution.**

```go
package main

import "fmt"

func loop(done <-chan struct{}, work <-chan int) {
    for {
        // priority: check done first, non-blocking
        select {
        case <-done:
            return
        default:
        }
        // then multiplexed select
        select {
        case <-done:
            return
        case v := <-work:
            fmt.Println("work:", v)
        }
    }
}

func main() {
    done := make(chan struct{})
    work := make(chan int, 10)
    for i := 0; i < 5; i++ {
        work <- i
    }
    close(done)
    loop(done, work)
}
```

**Expected output.** Nothing (the priority check on `done` exits immediately).

---

## Bonus Challenges

### Bonus 1: implement a "Once" using only channels

```go
type Once struct {
    done chan struct{}
    do   chan func()
}

func NewOnce() *Once {
    o := &Once{
        done: make(chan struct{}),
        do:   make(chan func()),
    }
    go func() {
        f := <-o.do
        f()
        close(o.done)
    }()
    return o
}

func (o *Once) Do(f func()) {
    select {
    case o.do <- f: // first caller wins
        <-o.done
    case <-o.done: // already done
    }
}
```

A goroutine runs the first `f` then closes `done`. All subsequent `Do` calls see `done` closed via select and return.

---

### Bonus 2: implement `errgroup.Wait()` semantics with close

```go
type Group struct {
    wg   sync.WaitGroup
    once sync.Once
    err  error
    done chan struct{}
}

func NewGroup() *Group { return &Group{done: make(chan struct{})} }

func (g *Group) Go(f func() error) {
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        if err := f(); err != nil {
            g.once.Do(func() {
                g.err = err
                close(g.done)
            })
        }
    }()
}

func (g *Group) Wait() error {
    g.wg.Wait()
    return g.err
}

func (g *Group) Done() <-chan struct{} { return g.done }
```

The first error closes `done`. Subscribers select on `Done()` to know about the error.

---

### Bonus 3: bounded subscription with auto-close on idle

Subscribers idle for >5s are auto-unsubscribed (their channel closed).

```go
// left as exercise; combine time.NewTimer + select on Done + close on idle
```

---

## Self-Check

After completing the tasks:

- [ ] You can write a generator that closes correctly.
- [ ] You can read a closed channel and distinguish close from real zero.
- [ ] You can build a multi-sender pattern with synchronising closer.
- [ ] You can build a pipeline with cascading close.
- [ ] You can use a done channel as a broadcast signal.
- [ ] You can integrate close with `context.Context`.
- [ ] You can test for goroutine leaks.
- [ ] You can implement bounded shutdown with timeout.
- [ ] You can avoid double-close with `sync.Once`.
- [ ] You can diagnose a "send on closed" panic.
