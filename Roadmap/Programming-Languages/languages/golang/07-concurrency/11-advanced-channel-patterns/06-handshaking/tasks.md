---
layout: default
title: Handshaking — Tasks
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/06-handshaking/tasks/
---

# Handshaking — Tasks

[← Back](../)

> Eight exercises. Each has a problem statement, a constraint list, and acceptance tests you must pass. Solutions are not provided — diff yourself against the constraints and run `go test -race`.

---

## Task 1 — The started channel

**Problem.** Write a function `StartWorker() (work chan<- int, started <-chan struct{})` that launches a goroutine. The goroutine performs an "expensive" setup (simulate with `time.Sleep(50 * time.Millisecond)`) and then drains the work channel until it is closed. The caller must be able to block on `started` until setup is complete.

**Constraints.**

- `started` must be a `chan struct{}`, not `chan bool`.
- The goroutine must call `close(started)` exactly once.
- No use of `sync.WaitGroup`, `sync.Once`, or mutex.

**Acceptance.**

```go
func TestStartedChannel(t *testing.T) {
    work, started := StartWorker()
    deadline := time.After(200 * time.Millisecond)
    select {
    case <-started:
        // ok
    case <-deadline:
        t.Fatal("worker did not signal started in time")
    }
    work <- 1
    close(work)
}
```

---

## Task 2 — Stop / stopped pair with deadline

**Problem.** Build `type Pump struct { ... }` with `New() *Pump`, `Run()`, and `Stop(ctx context.Context) error`. `Run` reads from an internal `time.Ticker` and increments a counter. `Stop` must:

1. Signal the goroutine to stop.
2. Wait for the goroutine to confirm it has stopped — or until `ctx` is done, in which case return `ctx.Err()`.
3. Be safe to call once. Calling twice may panic.

**Constraints.**

- Use a `stop chan struct{}` (closed by Stop) and `stopped chan struct{}` (closed by the goroutine on return).
- Do not use `sync.WaitGroup`.
- The `time.Ticker` must be stopped to avoid leaks.

**Acceptance.**

```go
func TestPumpStopSucceeds(t *testing.T) {
    p := New()
    go p.Run()
    time.Sleep(20 * time.Millisecond)
    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()
    if err := p.Stop(ctx); err != nil {
        t.Fatal(err)
    }
}

func TestPumpStopRespectsDeadline(t *testing.T) {
    // A pump that never returns must surface ctx.Err()
}
```

---

## Task 3 — Request / Ack loop

**Problem.** Implement a key-value store served by a single goroutine. Clients submit `Get` and `Set` requests via a channel; the goroutine handles them serially. Each request carries its own reply channel.

```go
type Op struct {
    Kind  string // "get" or "set"
    Key   string
    Value string        // for "set"
    Reply chan Result   // capacity 1
}

type Result struct {
    Value string
    OK    bool
    Err   error
}
```

**Constraints.**

- The reply channel must be buffered (capacity 1).
- The store must own the map; no other goroutine may touch it.
- A `Close()` method drains and exits cleanly.

**Acceptance.**

```go
func TestStoreSetGet(t *testing.T) {
    s := NewStore()
    defer s.Close()
    s.Set("k", "v")
    if v, ok := s.Get("k"); !ok || v != "v" {
        t.Fatal("get failed")
    }
}
```

---

## Task 4 — N-way startup barrier

**Problem.** Write `func StartN(n int, work func(id int)) (ready <-chan struct{})`. Launch `n` goroutines, each running `work(id)` *after* every goroutine has reached its starting point. `ready` is closed by the coordinator once all `n` goroutines are about to begin.

**Constraints.**

- Use exactly one `sync.WaitGroup` or `n` started channels — your choice.
- No goroutine may call `work` before every other goroutine has signalled readiness.

**Acceptance.**

```go
func TestBarrier(t *testing.T) {
    var started [4]int64
    ready := StartN(4, func(id int) {
        atomic.StoreInt64(&started[id], 1)
    })
    <-ready
    time.Sleep(10 * time.Millisecond)
    for _, s := range started {
        if atomic.LoadInt64(&s) != 1 {
            t.Fatal("goroutine did not start")
        }
    }
}
```

---

## Task 5 — Channel of channels worker pool

**Problem.** Implement a worker pool that uses `chan chan Job` for dispatch. The pool has `N` workers; each idle worker advertises itself by sending its own `chan Job` onto the shared dispatch channel.

```go
type Pool struct {
    dispatch chan chan Job
    quit     chan struct{}
}
```

**Constraints.**

- Workers must register on `dispatch` only when idle.
- `Submit(j Job)` reads an idle worker's channel from `dispatch` and sends the job on it.
- `Shutdown()` closes `quit` and waits for all workers to return.

**Acceptance.**

```go
func TestPoolProcesses(t *testing.T) {
    var n int64
    p := New(4, func(j Job) { atomic.AddInt64(&n, 1) })
    for i := 0; i < 100; i++ {
        p.Submit(Job{})
    }
    p.Shutdown()
    if atomic.LoadInt64(&n) != 100 {
        t.Fatalf("expected 100, got %d", n)
    }
}
```

---

## Task 6 — Rendezvous handoff

**Problem.** Implement `func Rendezvous[T any]() (send func(T), recv func() T)`. The two returned closures synchronise on a fresh unbuffered channel: `send(v)` blocks until `recv` is called; `recv()` blocks until `send` is called. After the handoff, both closures may be called again (any number of times).

**Constraints.**

- No exported channel; the handoff happens inside the closures.
- No buffering — every send must block until the matching receive arrives.

**Acceptance.**

```go
func TestRendezvous(t *testing.T) {
    send, recv := Rendezvous[int]()
    done := make(chan int)
    go func() { done <- recv() }()
    time.Sleep(20 * time.Millisecond)
    send(42)
    if got := <-done; got != 42 {
        t.Fatalf("got %d, want 42", got)
    }
}
```

---

## Task 7 — Supervisor with promotion handshake

**Problem.** Build a `Supervisor` that manages a sequence of `Worker` instances. Only one worker is "promoted" at a time. To replace the current worker with a new one:

1. Signal the old worker to step down via its `stop` channel.
2. Wait for its `stopped` channel.
3. Start the new worker, wait for its `started` channel.
4. Atomically swap the active reference.

**Constraints.**

- The supervisor's `Replace(newWorker)` must be safe to call concurrently; concurrent calls serialise.
- No request may be lost during the handoff: incoming work blocks until the new worker is ready.

**Acceptance.**

```go
func TestSupervisorHandoff(t *testing.T) {
    s := NewSupervisor(makeWorker())
    go func() {
        for i := 0; i < 10; i++ {
            s.Handle(Request{i})
        }
    }()
    time.Sleep(20 * time.Millisecond)
    s.Replace(makeWorker())
    // No request should be lost; all 10 should be handled.
}
```

---

## Task 8 — Drain handshake with context

**Problem.** A queue `type Queue struct { ... }` has a `Drain(ctx context.Context) error` method that:

1. Closes the input channel (no more pushes accepted).
2. Waits for all in-flight items to be processed.
3. Returns `nil` on completion or `ctx.Err()` on timeout.

**Constraints.**

- `Drain` may be called only once. A second call returns `ErrAlreadyDrained`.
- Pushes after `Drain` returns `ErrClosed`.
- Use a `drained chan struct{}` closed by the processor goroutine when its main loop exits.

**Acceptance.**

```go
func TestDrainSuccess(t *testing.T) {
    q := New()
    for i := 0; i < 100; i++ {
        q.Push(i)
    }
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    if err := q.Drain(ctx); err != nil {
        t.Fatal(err)
    }
}

func TestDrainTimeout(t *testing.T) {
    q := New() // pretend each item takes 100ms
    for i := 0; i < 10; i++ {
        q.Push(i)
    }
    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()
    if err := q.Drain(ctx); err == nil {
        t.Fatal("expected timeout")
    }
}
```

---

## How to evaluate your solutions

1. Run `go test -race ./...` and watch for `WARNING: DATA RACE`.
2. Run with `-count=100` to flush out scheduling-dependent bugs.
3. Add `runtime.GC(); runtime.NumGoroutine()` before and after the test body; the number must not grow.
4. Re-read the [Specification](specification.md) and verify each pattern's invariants by inspection.

The exercises overlap deliberately — by the end you will have written the started channel, the stop/stopped pair, the request/ack loop, and the channel-of-channels pool at least once each, which is the working vocabulary of every Go service you will read.
