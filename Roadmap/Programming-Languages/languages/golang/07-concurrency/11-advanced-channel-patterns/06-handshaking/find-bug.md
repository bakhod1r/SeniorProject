---
layout: default
title: Handshaking — Find the Bug
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/06-handshaking/find-bug/
---

# Handshaking — Find the Bug

[← Back](../)

> Eight snippets, each with one (or sometimes two) defects in the handshake protocol. Read, predict the failure, then read the explanation. The label "what breaks" is the symptom; the label "why" is the root cause.

---

## Bug 1 — The double close

```go
type Service struct {
    stop chan struct{}
}

func (s *Service) Stop() {
    close(s.stop)
}

func main() {
    s := &Service{stop: make(chan struct{})}
    go s.Stop()
    go s.Stop() // emergency shutdown
    time.Sleep(time.Second)
}
```

**What breaks.** Random panic: "close of closed channel".

**Why.** Both goroutines race to close `s.stop`. Only one may succeed; the other panics. Close is not idempotent.

**Fix.** Guard with `sync.Once`:

```go
type Service struct {
    stop chan struct{}
    once sync.Once
}

func (s *Service) Stop() {
    s.once.Do(func() { close(s.stop) })
}
```

---

## Bug 2 — Closing the wrong channel

```go
type Worker struct {
    in     chan int
    done   chan struct{}
}

func (w *Worker) Run() {
    for v := range w.in {
        process(v)
    }
    close(w.in) // signal done
}

func (w *Worker) Wait() {
    <-w.done
}
```

**What breaks.** `Wait()` blocks forever.

**Why.** The worker closes `w.in` — the input channel, which it *receives* from. That panics ("send on closed channel") if anything is still feeding `w.in`, but more importantly, `w.done` is never closed, so `Wait` never returns.

**Fix.** Close the channel the worker owns:

```go
func (w *Worker) Run() {
    defer close(w.done)
    for v := range w.in {
        process(v)
    }
}
```

The owner of `w.in` (the caller) is responsible for closing it.

---

## Bug 3 — Unbuffered reply channel after timeout

```go
type Req struct {
    Reply chan int
}

func worker(in <-chan Req) {
    for r := range in {
        r.Reply <- compute()
    }
}

func client(in chan<- Req, ctx context.Context) (int, error) {
    r := Req{Reply: make(chan int)} // unbuffered
    in <- r
    select {
    case v := <-r.Reply:
        return v, nil
    case <-ctx.Done():
        return 0, ctx.Err()
    }
}
```

**What breaks.** After a timeout, the worker goroutine blocks forever on `r.Reply <- compute()`. Goroutine leak.

**Why.** The reply channel is unbuffered. The client has abandoned it; the worker's send finds no receiver and parks.

**Fix.** Make the reply channel buffered with capacity 1:

```go
r := Req{Reply: make(chan int, 1)}
```

The send now always succeeds, the abandoned value is garbage-collected with the channel.

---

## Bug 4 — Started signal closed before init

```go
func startServer() (addr string, ready <-chan struct{}) {
    r := make(chan struct{})
    go func() {
        close(r) // notify: server starting
        ln, _ := net.Listen("tcp", ":0")
        addr = ln.Addr().String()
        http.Serve(ln, nil)
    }()
    return addr, r
}

func main() {
    a, ready := startServer()
    <-ready
    http.Get("http://" + a)
}
```

**What breaks.** The `http.Get` either targets an empty string or races the assignment of `addr`.

**Why.** The started channel is closed *before* the listener is created. The parent's read of `addr` happens-before the child's write. Worse, even if it didn't, there is a data race on `addr`.

**Fix.** Close *after* initialisation, and pass the address via the channel or a returned struct:

```go
type ServerReady struct {
    Addr string
}

func startServer() (<-chan ServerReady, error) {
    ready := make(chan ServerReady, 1)
    ln, err := net.Listen("tcp", ":0")
    if err != nil {
        return nil, err
    }
    go func() {
        ready <- ServerReady{Addr: ln.Addr().String()}
        http.Serve(ln, nil)
    }()
    return ready, nil
}
```

Bind the listener in the caller's goroutine — the only reliable way to know the address before signalling readiness.

---

## Bug 5 — The forgotten stopped channel

```go
type Pump struct {
    stop chan struct{}
}

func (p *Pump) Run() {
    t := time.NewTicker(100 * time.Millisecond)
    for {
        select {
        case <-p.stop:
            t.Stop()
            return
        case <-t.C:
            tick()
        }
    }
}

func (p *Pump) Stop() {
    close(p.stop)
}

func main() {
    p := &Pump{stop: make(chan struct{})}
    go p.Run()
    p.Stop()
    flushFinalState() // expects pump to have stopped
}
```

**What breaks.** `flushFinalState()` runs before the pump finishes its last `tick()` — sometimes.

**Why.** `Stop` only requests shutdown. There is no acknowledgement that the goroutine has returned. The main function races the goroutine's `return`.

**Fix.** Add the second channel:

```go
type Pump struct {
    stop, stopped chan struct{}
}

func (p *Pump) Run() {
    defer close(p.stopped)
    // ... same loop
}

func (p *Pump) Stop() {
    close(p.stop)
    <-p.stopped
}
```

---

## Bug 6 — Sending instead of closing for broadcast

```go
type Group struct {
    cancel chan struct{}
}

func (g *Group) Watch() {
    for i := 0; i < 5; i++ {
        go func() {
            <-g.cancel
            cleanup()
        }()
    }
}

func (g *Group) Cancel() {
    g.cancel <- struct{}{} // notify everyone
}
```

**What breaks.** Only one of the five goroutines unblocks. The other four hang.

**Why.** A send on an unbuffered channel unblocks exactly one receiver. To wake all five, the sender would have to send five times — and would block on the second send if the first receiver had already taken it.

**Fix.** Use close-as-broadcast:

```go
func (g *Group) Cancel() {
    close(g.cancel)
}
```

Now all five `<-g.cancel` reads return immediately with the zero value.

---

## Bug 7 — `chan chan T` with capacity > 0

```go
type Worker struct {
    jobs chan Job
}

func dispatcher(pool chan chan Job, jobs <-chan Job) {
    for j := range jobs {
        w := <-pool
        w <- j
    }
}

func newWorker(pool chan chan Job) *Worker {
    w := &Worker{jobs: make(chan Job, 8)} // buffered
    go func() {
        for {
            pool <- w.jobs // advertise
            j := <-w.jobs
            process(j)
        }
    }()
    return w
}
```

**What breaks.** A worker can have multiple unfinished jobs in flight — load balancing collapses.

**Why.** With `make(chan Job, 8)`, eight jobs can be queued into a single worker's channel before any of them are read. The dispatcher's invariant — "I send to an idle worker" — is no longer true; an "idle" worker may already have seven jobs waiting in its inner buffer.

**Fix.** Use an unbuffered worker channel:

```go
w := &Worker{jobs: make(chan Job)}
```

Now the dispatcher's send blocks until the worker actually receives, guaranteeing one-job-at-a-time semantics.

---

## Bug 8 — Reply channel leaked on context cancel

```go
type Req struct {
    Reply chan int
}

func worker(in <-chan Req) {
    for r := range in {
        r.Reply <- compute() // (capacity 1, so this is non-blocking)
    }
}

func client(ctx context.Context, in chan<- Req) (int, error) {
    r := Req{Reply: make(chan int, 1)}
    select {
    case in <- r:
    case <-ctx.Done():
        return 0, ctx.Err()
    }
    select {
    case v := <-r.Reply:
        return v, nil
    case <-ctx.Done():
        return 0, ctx.Err()
    }
}
```

**What breaks.** Subtle. If the context fires after the request is sent but before the worker has read it, the request sits in the worker's input queue holding a reference to the abandoned reply channel. Eventually the worker processes it, sends into the buffered reply, and the channel is freed — fine. But if the worker is slow and the client retries, requests stack up.

A deeper bug: if the worker has already received the request and computed the reply, the client never reads it; the reply is lost (the channel is garbage-collected with its value).

**Why.** The protocol does not explicitly cancel the request on the worker side. Cancellation is one-sided.

**Fix.** Embed the context in the request and have the worker check it before doing expensive work:

```go
type Req struct {
    Ctx   context.Context
    Reply chan int
}

func worker(in <-chan Req) {
    for r := range in {
        if r.Ctx.Err() != nil {
            continue // skip cancelled requests
        }
        r.Reply <- compute(r.Ctx)
    }
}
```

The worker now reads `r.Ctx` to decide whether to bother, and `compute` can also abort on cancellation.

---

## How to drill this

Each bug above maps to one of three failure modes:

1. **Lifecycle race.** Started or stopped signals out of order with state.
2. **Broadcast misuse.** Send-for-many or close-for-one.
3. **Leak.** Orphan goroutines blocked on dead channels.

When reviewing real code, ask of every channel: who allocates it, who sends, who receives, who closes. If two of those answers are "anyone," there is a bug waiting.
