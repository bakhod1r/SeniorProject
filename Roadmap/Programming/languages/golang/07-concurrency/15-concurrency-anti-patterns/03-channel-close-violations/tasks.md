---
layout: default
title: Tasks
parent: Channel Close Violations
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 7
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/03-channel-close-violations/tasks/
---

# Channel Close Violations — Hands-On Tasks

## Introduction

This file provides 15+ hands-on tasks. Each task includes a problem statement, hints, and a reference solution. Work through them in order; later tasks build on earlier ones.

Run each solution with `go test -race -count=10` to verify correctness under concurrency.

---

## Task 1: Single-Sender Pipeline

**Goal.** Build a producer-consumer pipeline where one goroutine generates integers 1 through 100, and another goroutine sums them. Use a channel; the producer closes the channel when done.

**Hints.**
- Use `defer close(out)` in the producer.
- Use `for range` in the consumer.

**Reference solution.**

```go
package main

import "fmt"

func produce() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 1; i <= 100; i++ {
            out <- i
        }
    }()
    return out
}

func main() {
    sum := 0
    for v := range produce() {
        sum += v
    }
    fmt.Println(sum) // 5050
}
```

---

## Task 2: Fan-In (Multi-Sender Coordination)

**Goal.** Two goroutines each generate integers from a different range. A third goroutine merges them into one stream. Sum the merged stream.

**Hints.**
- Two senders, one consumer: use a coordinator goroutine to close the merged channel.
- Use `sync.WaitGroup`.

**Reference solution.**

```go
package main

import (
    "fmt"
    "sync"
)

func gen(start, count int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < count; i++ {
            out <- start + i
        }
    }()
    return out
}

func merge(srcs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(srcs))
    for _, s := range srcs {
        go func(s <-chan int) {
            defer wg.Done()
            for v := range s {
                out <- v
            }
        }(s)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

func main() {
    merged := merge(gen(1, 10), gen(100, 10))
    sum := 0
    for v := range merged {
        sum += v
    }
    fmt.Println(sum) // 55 + 1045 = 1100
}
```

---

## Task 3: Fan-Out (Multi-Receiver Cancellation)

**Goal.** One producer feeds N workers, each processing in parallel. On context cancellation, workers must exit cleanly.

**Hints.**
- Workers select on `ctx.Done()` and the work channel.
- The producer closes the work channel when it finishes (or on cancellation).

**Reference solution.**

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()

    work := make(chan int)
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    fmt.Printf("worker %d: cancelled\n", id)
                    return
                case v, ok := <-work:
                    if !ok { return }
                    fmt.Printf("worker %d: %d\n", id, v)
                    time.Sleep(20 * time.Millisecond)
                }
            }
        }(i)
    }

    go func() {
        defer close(work)
        for i := 0; ; i++ {
            select {
            case <-ctx.Done():
                return
            case work <- i:
            }
        }
    }()

    wg.Wait()
}
```

---

## Task 4: Idempotent Close

**Goal.** Implement a service struct with a `Close()` method. Multiple concurrent calls to `Close()` should not panic; each should return the same result.

**Hints.**
- Use `sync.Once`.

**Reference solution.**

```go
package main

import (
    "fmt"
    "sync"
)

type Svc struct {
    done chan struct{}
    once sync.Once
    err  error
}

func New() *Svc { return &Svc{done: make(chan struct{})} }

func (s *Svc) Close() error {
    s.once.Do(func() {
        s.err = s.cleanup()
        close(s.done)
    })
    <-s.done
    return s.err
}

func (s *Svc) cleanup() error {
    fmt.Println("cleaning up")
    return nil
}

func main() {
    s := New()
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); _ = s.Close() }()
    }
    wg.Wait()
}
```

cleanup runs exactly once; all callers wait for it.

---

## Task 5: Safe-Close Wrapper

**Goal.** Implement a `SafeCh[T]` wrapper around a channel. `Send` returns false if Close has been called; `Close` is idempotent; the data channel is never closed (only the done channel).

**Hints.**
- Use a done channel + sync.Once for Close.
- Send uses select on done.

**Reference solution.**

```go
package main

import (
    "fmt"
    "sync"
)

type SafeCh[T any] struct {
    ch   chan T
    done chan struct{}
    once sync.Once
}

func NewSafeCh[T any](buf int) *SafeCh[T] {
    return &SafeCh[T]{ch: make(chan T, buf), done: make(chan struct{})}
}

func (s *SafeCh[T]) Send(v T) bool {
    select {
    case <-s.done: return false
    case s.ch <- v: return true
    }
}

func (s *SafeCh[T]) Recv() (T, bool) {
    select {
    case v := <-s.ch: return v, true
    case <-s.done:
        var z T
        return z, false
    }
}

func (s *SafeCh[T]) Close() { s.once.Do(func() { close(s.done) }) }

func main() {
    c := NewSafeCh[int](2)
    c.Send(1)
    c.Send(2)
    c.Close()
    fmt.Println(c.Send(3)) // false
    v, ok := c.Recv()
    fmt.Println(v, ok) // depends on race; usually returns 1 or 0/false
}
```

---

## Task 6: Pipeline with Cancellation

**Goal.** Build a three-stage pipeline (generate → filter → map). On cancellation, all stages exit cleanly within milliseconds.

**Hints.**
- Each stage takes context; each select has a `ctx.Done()` arm in both receive and send.
- Each stage `defer close(out)`.

**Reference solution.**

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func gen(ctx context.Context, n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            select {
            case <-ctx.Done(): return
            case out <- i:
            }
        }
    }()
    return out
}

func filter(ctx context.Context, in <-chan int, p func(int) bool) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            if !p(v) { continue }
            select {
            case <-ctx.Done(): return
            case out <- v:
            }
        }
    }()
    return out
}

func mapStage(ctx context.Context, in <-chan int, f func(int) int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            mapped := f(v)
            select {
            case <-ctx.Done(): return
            case out <- mapped:
            }
        }
    }()
    return out
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()

    src := gen(ctx, 1000)
    even := filter(ctx, src, func(v int) bool { return v%2 == 0 })
    doubled := mapStage(ctx, even, func(v int) int { return v * 2 })

    for v := range doubled {
        fmt.Println(v)
    }
}
```

After 100ms, cancellation triggers; every stage exits; the consumer's range exits.

---

## Task 7: Worker Pool with Graceful Drain

**Goal.** Build a worker pool. On `Shutdown(ctx)`, the pool stops accepting new Submits, drains its queue, waits for in-flight jobs to finish (subject to ctx), and returns nil or ctx.Err().

**Hints.**
- Use sync.Once for the drain trigger.
- Workers select on a drain signal channel.

**Reference solution.**

```go
package pool

import (
    "context"
    "errors"
    "sync"
    "sync/atomic"
)

var ErrClosed = errors.New("pool: closed")

type Job interface{ Run() }

type Pool struct {
    jobs chan Job
    done chan struct{}
    wg   sync.WaitGroup
    once sync.Once
    inflight atomic.Int64
}

func New(workers, queue int) *Pool {
    p := &Pool{
        jobs: make(chan Job, queue),
        done: make(chan struct{}),
    }
    p.wg.Add(workers)
    for i := 0; i < workers; i++ {
        go p.worker()
    }
    return p
}

func (p *Pool) Submit(j Job) error {
    select {
    case <-p.done: return ErrClosed
    default:
    }
    select {
    case <-p.done: return ErrClosed
    case p.jobs <- j: return nil
    }
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for {
        select {
        case <-p.done:
            for {
                select {
                case j := <-p.jobs:
                    p.inflight.Add(1)
                    j.Run()
                    p.inflight.Add(-1)
                default:
                    return
                }
            }
        case j := <-p.jobs:
            p.inflight.Add(1)
            j.Run()
            p.inflight.Add(-1)
        }
    }
}

func (p *Pool) Shutdown(ctx context.Context) error {
    p.once.Do(func() { close(p.done) })
    waitCh := make(chan struct{})
    go func() { p.wg.Wait(); close(waitCh) }()
    select {
    case <-waitCh: return nil
    case <-ctx.Done(): return ctx.Err()
    }
}
```

Test with stress: many concurrent Submits and Shutdowns.

---

## Task 8: Producer with Bounded Drain

**Goal.** Build a producer that has been receiving items, has at most 10 buffered, and on `Drain(ctx)` consumes the buffer with no new items entering. Drain bounded by ctx timeout.

**Hints.**
- Two channels: input (from upstream) and output (to consumer).
- Drain stops accepting input; consumer reads output until empty.

**Reference solution.**

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Producer struct {
    in   chan int
    done chan struct{}
    once sync.Once
}

func New() *Producer {
    p := &Producer{
        in: make(chan int, 10),
        done: make(chan struct{}),
    }
    return p
}

func (p *Producer) Send(v int) bool {
    select {
    case <-p.done: return false
    case p.in <- v: return true
    }
}

func (p *Producer) Drain(ctx context.Context) []int {
    p.once.Do(func() { close(p.done) })
    var out []int
    for {
        select {
        case v := <-p.in:
            out = append(out, v)
        case <-ctx.Done():
            return out
        default:
            return out
        }
    }
}

func main() {
    p := New()
    for i := 0; i < 5; i++ { p.Send(i) }
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    fmt.Println(p.Drain(ctx)) // [0 1 2 3 4]
    fmt.Println(p.Send(99))   // false
}
```

---

## Task 9: Pub-Sub with Independent Subscribers

**Goal.** Build a pub-sub where:

- Publishers call `Publish(event)`.
- Subscribers call `Subscribe()` to get a channel.
- Subscribers call `Unsubscribe(channel)` to stop.
- Closing one subscriber does not affect others.

**Hints.**
- Store subscribers in a map; protect with a mutex.
- Unsubscribe removes from the map and closes the subscriber's channel.

**Reference solution.**

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type PubSub struct {
    mu  sync.Mutex
    subs map[uint64]chan string
    next uint64
}

func New() *PubSub {
    return &PubSub{subs: map[uint64]chan string{}}
}

func (p *PubSub) Subscribe() (uint64, <-chan string) {
    p.mu.Lock()
    defer p.mu.Unlock()
    id := p.next
    p.next++
    ch := make(chan string, 4)
    p.subs[id] = ch
    return id, ch
}

func (p *PubSub) Unsubscribe(id uint64) {
    p.mu.Lock()
    defer p.mu.Unlock()
    if ch, ok := p.subs[id]; ok {
        close(ch)
        delete(p.subs, id)
    }
}

func (p *PubSub) Publish(msg string) {
    p.mu.Lock()
    defer p.mu.Unlock()
    for _, ch := range p.subs {
        select {
        case ch <- msg:
        default:
        }
    }
}

func main() {
    ps := New()
    id1, ch1 := ps.Subscribe()
    id2, ch2 := ps.Subscribe()

    go func() { for m := range ch1 { fmt.Println("sub1:", m) } }()
    go func() { for m := range ch2 { fmt.Println("sub2:", m) } }()

    ps.Publish("hello")
    ps.Publish("world")
    time.Sleep(10 * time.Millisecond)
    ps.Unsubscribe(id1)
    ps.Publish("goodbye")
    time.Sleep(10 * time.Millisecond)
    ps.Unsubscribe(id2)
}
```

---

## Task 10: Errgroup-Based Pipeline

**Goal.** Use `golang.org/x/sync/errgroup` to coordinate a multi-stage pipeline. On the first error, all stages cancel and exit.

**Hints.**
- `errgroup.WithContext` returns a context that cancels on first error.
- Each stage takes the context.

**Reference solution.**

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "math/rand"

    "golang.org/x/sync/errgroup"
)

func main() {
    g, ctx := errgroup.WithContext(context.Background())
    in := make(chan int, 8)
    mid := make(chan int, 8)

    g.Go(func() error {
        defer close(in)
        for i := 0; i < 100; i++ {
            select {
            case <-ctx.Done(): return ctx.Err()
            case in <- i:
            }
        }
        return nil
    })

    g.Go(func() error {
        defer close(mid)
        for v := range in {
            if rand.Intn(100) == 0 {
                return errors.New("random failure")
            }
            select {
            case <-ctx.Done(): return ctx.Err()
            case mid <- v * 2:
            }
        }
        return nil
    })

    g.Go(func() error {
        for v := range mid {
            fmt.Println(v)
        }
        return nil
    })

    if err := g.Wait(); err != nil {
        fmt.Println("pipeline error:", err)
    }
}
```

---

## Task 11: Detect Closed Channel via Comma-Ok

**Goal.** Write a function that reads up to N values from a channel and returns them. Stop early if the channel closes.

**Hints.**
- Use the comma-ok form in a for loop.

**Reference solution.**

```go
func takeN[T any](ch <-chan T, n int) []T {
    var out []T
    for i := 0; i < n; i++ {
        v, ok := <-ch
        if !ok { return out }
        out = append(out, v)
    }
    return out
}
```

---

## Task 12: Coordinator That Closes After WaitGroup

**Goal.** Implement a `closeAfterWG` helper: takes a WaitGroup and a channel; spawns a goroutine that waits for the WG and then closes the channel.

**Reference solution.**

```go
func closeAfterWG(wg *sync.WaitGroup, ch chan<- int) {
    // Note: chan<- int cannot be closed directly via type system.
    // Caller must pass chan int (bidirectional).
}

func closeAfterWGBidi(wg *sync.WaitGroup, ch chan int) {
    go func() {
        wg.Wait()
        close(ch)
    }()
}
```

Realisation: the function needs `chan int`, not `chan<- int`, to call close. The caller is exposing the channel for close authority.

---

## Task 13: Drainable Channel with Snapshot

**Goal.** Build a `Snapshot()` method that captures the current channel state (occupancy, closed-or-not, capacity).

**Hints.**
- `len(ch)` and `cap(ch)` are atomic.
- To check closed without panic, use non-blocking receive in a select.

**Reference solution.**

```go
type Stats struct {
    Length   int
    Capacity int
    Closed   bool
}

func Snapshot[T any](ch chan T) Stats {
    s := Stats{
        Length:   len(ch),
        Capacity: cap(ch),
    }
    select {
    case v, ok := <-ch:
        if !ok {
            s.Closed = true
        } else {
            // Oops, we consumed a value. Put it back?
            // This is why there is no IsClosed in Go.
            // For safety, we can't return v back without races.
            _ = v
        }
    default:
        // Channel not closed and not ready (empty or no waiter).
    }
    return s
}
```

This implementation is unsafe — it may consume a value. The lesson: there is no race-free way to check "is closed" without potentially destroying state. The "right" answer is "you can't"; design so you don't need to ask.

---

## Task 14: Race Detector Reveal

**Goal.** Write a broken close pattern and run it under `-race`. Verify the detector flags it.

**Reference solution.**

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int)
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        ch <- 1
    }()
    go func() {
        defer wg.Done()
        close(ch)
    }()
    wg.Wait()
    fmt.Println("done")
}
```

Run with `go run -race main.go`. The race detector will report a write/read race on ch.

---

## Task 15: Multi-Producer Coordinator with sync.Once

**Goal.** Multiple producers may shut down independently. The last one to finish should close the shared output channel.

**Hints.**
- Use an atomic counter. The last decrement closes the channel.

**Reference solution.**

```go
package main

import (
    "sync"
    "sync/atomic"
)

type Coord struct {
    out chan int
    rem atomic.Int32
}

func New(producers int) *Coord {
    c := &Coord{out: make(chan int)}
    c.rem.Store(int32(producers))
    return c
}

func (c *Coord) Out() <-chan int { return c.out }

func (c *Coord) Done() {
    if c.rem.Add(-1) == 0 {
        close(c.out)
    }
}

func main() {
    coord := New(3)
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            defer coord.Done()
            for j := 0; j < 5; j++ {
                coord.out <- id*10 + j
            }
        }(i)
    }
    go func() { wg.Wait() }()
    for v := range coord.Out() {
        _ = v
    }
}
```

Note: `coord.Done()` is called from each producer's defer. The atomic counter ensures exactly one close.

---

## Task 16: Server with Graceful HTTP Shutdown

**Goal.** Build an HTTP server that handles SIGTERM gracefully, completing in-flight requests within 10 seconds.

**Reference solution.**

```go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    srv := &http.Server{
        Addr: ":8080",
        Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            time.Sleep(2 * time.Second)
            fmt.Fprintln(w, "hello")
        }),
    }

    go func() {
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatal(err)
        }
    }()

    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
    <-sigCh

    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if err := srv.Shutdown(ctx); err != nil {
        log.Println("shutdown:", err)
    }
}
```

---

## Task 17: Implement Latch (One-Shot Broadcast)

**Goal.** Implement a `Latch` type with `Fire()` and `Wait()` semantics. Fire is idempotent; Wait blocks until Fire is called; after Fire, Wait returns instantly.

**Reference solution.**

```go
type Latch struct {
    ch   chan struct{}
    once sync.Once
}

func NewLatch() *Latch { return &Latch{ch: make(chan struct{})} }
func (l *Latch) Fire() { l.once.Do(func() { close(l.ch) }) }
func (l *Latch) Wait() { <-l.ch }
func (l *Latch) Fired() bool {
    select { case <-l.ch: return true; default: return false }
}
```

---

## Task 18: Custom errgroup Implementation

**Goal.** Implement a stripped-down errgroup with `Go(func() error)` and `Wait() error`.

**Reference solution.**

```go
type Group struct {
    wg      sync.WaitGroup
    errOnce sync.Once
    err     error
    cancel  func()
}

func NewGroup(parent context.Context) (*Group, context.Context) {
    ctx, cancel := context.WithCancel(parent)
    return &Group{cancel: cancel}, ctx
}

func (g *Group) Go(fn func() error) {
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        if err := fn(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                g.cancel()
            })
        }
    }()
}

func (g *Group) Wait() error {
    g.wg.Wait()
    g.cancel()
    return g.err
}
```

Note: the cancel triggers context cancellation, which propagates to in-flight goroutines.

---

## Task 19: Stress Test for Idempotent Close

**Goal.** Write a test that runs 1000 concurrent Close() calls and verifies no panic.

**Reference solution.**

```go
package svc

import (
    "sync"
    "testing"
)

func TestStressClose(t *testing.T) {
    s := New()
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); _ = s.Close() }()
    }
    wg.Wait()
}
```

Run with `go test -race -count=10`. If sync.Once is missing in Close, this fails.

---

## Task 20: Diagnose a Goroutine Leak

**Goal.** Read this program; explain why it leaks goroutines; fix the leak.

```go
func main() {
    ch := make(chan int)
    for i := 0; i < 10; i++ {
        go func() {
            v := <-ch  // blocks forever
            fmt.Println(v)
        }()
    }
    time.Sleep(time.Second)
    // 10 goroutines still blocked
}
```

**Diagnosis.** 10 goroutines are blocked on `<-ch`. No one sends to ch. No one closes ch. The goroutines never exit. Leak.

**Fix.** Either send 10 values then close:

```go
for i := 0; i < 10; i++ {
    ch <- i
}
close(ch)
```

Or just close (each goroutine sees ok=false):

```go
close(ch)
```

Or use a done-channel for cancellation:

```go
done := make(chan struct{})
for i := 0; i < 10; i++ {
    go func() {
        select { case v := <-ch: ... case <-done: return }
    }()
}
close(done) // wakes all
```

---

## Closing Notes

Working through these tasks builds the muscle memory for correct close handling. Patterns become second nature:

- Single sender: `defer close(out)`.
- Multiple senders: coordinator with WaitGroup.
- Idempotent close: `sync.Once`.
- Cancellation: done-channel or context.
- Safe send: select on done.

Run all your code with `-race`. Stress test. Verify with goleak. The disciplined practice is what produces production-grade Go.
