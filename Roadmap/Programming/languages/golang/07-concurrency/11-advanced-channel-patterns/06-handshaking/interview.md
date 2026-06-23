---
layout: default
title: Handshaking — Interview
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/06-handshaking/interview/
---

# Handshaking — Interview

[← Back](../)

> Twenty-plus questions, organised from intern level up to staff. Each has the question, a model answer, and a follow-up that interviewers tend to push toward.

---

## Junior (interns, first job)

### 1. What is a handshake in Go?

**Answer.** A handshake is a synchronisation between two goroutines using channels, where one side waits for the other to acknowledge an event. Unlike a one-way signal, both parties must complete their step before either advances. The simplest example is a `started` channel: the parent goroutine creates `started := make(chan struct{})`, the child closes it after setup, and the parent blocks on `<-started` until that close happens.

**Follow-up.** *Why use `chan struct{}` instead of `chan bool`?* Because the value carries no information — only the close event matters — and `struct{}` allocates zero bytes. It signals intent: this is a pure signal, not a data channel.

---

### 2. How do you wait for a goroutine to be "ready" before continuing?

**Answer.** Create a one-shot channel before the goroutine starts; the goroutine closes it after initialisation; the parent receives.

```go
started := make(chan struct{})
go func() {
    // setup work
    close(started)
    // main loop
}()
<-started
```

**Follow-up.** *What's wrong with `time.Sleep(100 * time.Millisecond)`?* It races with anything — slow CI, GC pause, scheduler — and gives no proof that initialisation actually completed.

---

### 3. What is the difference between `close(ch)` and `ch <- struct{}{}` as a signal?

**Answer.** `close(ch)` is a *broadcast*: any number of receivers will be unblocked, now and in the future. `ch <- struct{}{}` is a *unicast*: exactly one receiver is unblocked, and the next receiver will block again. Use close when you want everyone watching to know; use send when you want a single rendezvous.

**Follow-up.** *What happens if you close a channel twice?* Panic. The runtime catches the second close.

---

### 4. How do you signal "please stop" to a goroutine?

**Answer.** Close a `done` (or `stop`) channel. The goroutine selects on it in its main loop:

```go
for {
    select {
    case <-done:
        return
    case x := <-work:
        process(x)
    }
}
```

**Follow-up.** *What if you also need to wait until the goroutine has finished cleaning up?* Add a `stopped` channel. The goroutine closes it just before returning; the parent reads from it after closing `done`.

---

### 5. Why is a reply channel embedded in a request struct useful?

**Answer.** It gives the worker a private channel to answer just this requester. If the worker had a single shared reply channel, multiple requesters could not distinguish their answers. By allocating a fresh `reply chan T` inside each request, the requester reads its own dedicated answer.

```go
type Req struct {
    Q     string
    Reply chan string
}
```

**Follow-up.** *Should the reply channel be buffered?* Capacity 1 is the safe default. The worker can send without blocking even if the requester abandons the read (e.g., context cancelled).

---

## Middle (2–4 years)

### 6. Explain `chan chan T` and when you would use it.

**Answer.** It is a channel whose elements are themselves channels of `T`. The canonical use is a worker pool's job-dispatch loop: an idle worker sends *its own* `chan Job` onto a shared `chan chan Job`. The dispatcher pulls one out, sends the next job into it, and the worker — who has already been blocked reading from its inner channel — wakes up with the job.

The pattern guarantees that jobs go to *available* workers, not to a shared queue where idle and busy workers compete.

```go
type Worker struct{ jobs chan Job }
var pool chan chan Job
```

**Follow-up.** *How does this differ from a shared `chan Job`?* A shared channel hands a job to whoever happens to be reading at that instant. `chan chan Job` lets the worker advertise its availability first, which is useful for sticky routing or for limiting per-worker concurrency.

---

### 7. Compare a handshake to `sync.WaitGroup`.

**Answer.** `WaitGroup` is a counter for completion: "I am still doing N things; tell me when N reaches zero." A handshake is a pair of signals: "I have started" / "you may proceed", or "please stop" / "I have stopped." `WaitGroup` cannot answer "is the goroutine ready *now*" — only "has it returned." For startup synchronisation, use a started channel; for fan-in completion, use `WaitGroup`.

**Follow-up.** *Can you combine them?* Yes — a common pattern is a started channel for the begin handshake and a `WaitGroup` for the finish.

---

### 8. How does an N-way startup barrier work?

**Answer.** Either of two ways:

1. Each child closes a private `started_i` channel; the parent receives from each in turn (or via `select` if order matters).
2. A `sync.WaitGroup` of size N; each child calls `Done` after init; the parent calls `Wait`.

The channel version generalises to "started or failed" because the child can put an error on its own private channel before closing.

**Follow-up.** *What if one child fails to start?* Use a buffered error channel and a context. The parent reads from a combined error channel; on the first error it cancels the context, which the other children watch.

---

### 9. What is the rendezvous pattern?

**Answer.** Two goroutines synchronise on an unbuffered channel for a single value handoff. The send blocks until the receive runs, and vice versa, so both goroutines provably reach the rendezvous point at the same logical instant.

```go
c := make(chan int)
go func() { c <- 42 }()
v := <-c
```

It is the simplest possible handshake: no setup, no broadcast, just one-to-one synchronisation.

**Follow-up.** *Why not buffered?* A buffered channel of capacity 1 lets the sender finish before the receiver arrives. The synchronisation is lost.

---

### 10. How would you implement a request/ack loop with timeout?

**Answer.** Use a request struct with a reply channel and a `context.Context`. The requester sends, then `select`s on the reply channel and `ctx.Done()`. The worker likewise watches the context to avoid sending into an abandoned reply channel.

```go
type Req struct {
    Ctx   context.Context
    Q     string
    Reply chan string
}
```

**Follow-up.** *What if the reply channel is unbuffered and the requester has already given up?* The worker's send blocks forever. Make the reply channel buffered (capacity 1) so the send always succeeds.

---

### 11. Why is the stop/stopped pair preferable to just closing a done channel?

**Answer.** Closing `done` says "please stop." It does not say "I have stopped." Without the second channel, the parent cannot prove the worker has finished flushing buffers, closed files, returned connections to the pool, and so on. For testable shutdown — and for graceful shutdown in production — you need the acknowledgement.

**Follow-up.** *What if I just use `context.CancelFunc` and `<-ctx.Done()`?* That gives you only the request, not the acknowledgement. Wrap your goroutine in a function that closes a `stopped` channel on return, or use an `errgroup.Group.Wait()` to block until the worker truly returns.

---

### 12. What synchronisation guarantee does `close(c)` give?

**Answer.** Closing `c` happens-before every receive from `c` that returns because the channel is closed. So any write performed by the closing goroutine before `close(c)` is visible to any goroutine after it reads the zero value from `c`. Close is the broadcast variant of send for happens-before purposes.

**Follow-up.** *Where does this appear in the spec?* In the Go Memory Model under "Channel communication" — see [Specification](specification.md).

---

## Senior (4–8 years)

### 13. Design a graceful shutdown for an HTTP server that drains in-flight requests.

**Answer.** Wrap `http.Server` with a stop/stopped pair:

```go
type Server struct {
    srv     *http.Server
    stop    chan struct{}
    stopped chan struct{}
}

func (s *Server) Run() {
    go func() {
        defer close(s.stopped)
        <-s.stop
        ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        s.srv.Shutdown(ctx)
    }()
    _ = s.srv.ListenAndServe()
}

func (s *Server) Stop() {
    close(s.stop)
    <-s.stopped
}
```

`Stop` returns only after `Shutdown` has drained in-flight requests *or* the 30-second budget expires.

**Follow-up.** *What does `Shutdown` actually do?* Closes the listener, then blocks until all active connections idle. It does not forcibly kill connections — that is what the context timeout is for.

---

### 14. How would you supervise N children with a single handshake?

**Answer.** Use an `errgroup.WithContext`. The group's context is cancelled when any child returns an error, broadcasting "stop" to all children. `Wait` blocks until every child returns — the implicit "stopped" acknowledgement.

```go
g, ctx := errgroup.WithContext(parent)
for i := 0; i < N; i++ {
    i := i
    g.Go(func() error { return worker(ctx, i) })
}
err := g.Wait()
```

**Follow-up.** *Can you wait for startup as well?* Combine with N started channels or a single `sync.WaitGroup` of size N that each worker `Done`s after init.

---

### 15. Describe a leader-election promotion handshake.

**Answer.** A new leader cannot serve writes until the old leader has stepped down. The protocol:

1. Old leader receives "step down" (e.g., from etcd lease loss).
2. Old leader stops accepting writes, drains queues, calls `close(steppedDown)`.
3. New leader watches `steppedDown` (via the consensus log or a direct RPC).
4. New leader begins serving writes only after observing the step-down event.

In Go, the steppedDown signal is usually a context cancellation plus a state change committed to the consensus store, but the in-process variant is the stop/stopped pair you would write for any goroutine.

**Follow-up.** *Why not just have the new leader take over immediately?* Risk of split-brain — two leaders accepting writes simultaneously.

---

### 16. What is a "broken handshake" anti-pattern?

**Answer.** Common variants:

- Closing `done` from inside the worker, racing with another caller doing the same. Use `sync.Once` or have a single owner.
- Sending on `done` instead of closing — only one receiver wakes; others wait forever.
- Forgetting to drain a reply channel after timeout; the worker eventually sends and either blocks or — if buffered — leaks the slot.
- Closing `started` before initialisation completes; consumers proceed with half-initialised state.

**Follow-up.** *How do you spot them in code review?* Search for `close(` and verify each channel has exactly one owner; search for sends without a paired receive in the timeout path.

---

### 17. How do you avoid deadlock when a handshake involves three goroutines?

**Answer.** Identify the dependency cycle. Three-way handshakes deadlock when A waits for B, B waits for C, and C waits for A. Either:

- Topologically order the handshakes (A → B → C, no back-edges).
- Add a timeout via context to break the cycle at runtime.
- Replace synchronous handshakes with buffered channels where the back-edge can complete asynchronously.

**Follow-up.** *How do you test for this?* Run the goroutine creation under `go test -race -timeout=10s`. If the test hangs, dump goroutine stacks with `kill -SIGQUIT` or `runtime/pprof`.

---

### 18. Why are buffered ack channels often better than unbuffered ones?

**Answer.** A buffered ack channel (capacity 1) lets the worker send the acknowledgement and move on even if the requester has lost interest (timeout, context cancelled). With an unbuffered channel the worker blocks forever — a goroutine leak. The buffer absorbs the orphaned ack at the cost of one heap allocation per request.

**Follow-up.** *When is unbuffered correct?* When the synchronisation point matters — you want the worker to block until the requester actually receives the ack, e.g., for a rendezvous handoff.

---

## Staff / Principal

### 19. Compare channel handshakes to `sync.Cond`.

**Answer.** `sync.Cond` is the classical condition variable: a goroutine acquires a mutex, checks a predicate, and either proceeds or waits on `cond.Wait`, which atomically releases the mutex and blocks. The waker calls `cond.Signal` or `cond.Broadcast`.

A channel handshake achieves the same coordination without the mutex: close-as-broadcast is `cond.Broadcast`, a single send is `cond.Signal`, and the goroutine waits on `<-c` instead of `cond.Wait`. Channels integrate naturally with `select`, can be combined with cancellation contexts, and do not require remembering to hold a mutex when calling `Signal`.

The remaining reason to use `sync.Cond` is when the predicate is complex and the broadcast may unblock a stale waiter that needs to re-check — exactly the case `sync.Cond` was designed for. For one-shot events, channels win.

**Follow-up.** *What does the Go team recommend?* The proposal to deprecate `sync.Cond` was rejected, but the canonical advice (Pike, Cox) is to prefer channels for new code.

---

### 20. How would you design handshakes for a system with thousands of short-lived goroutines per second?

**Answer.** Two concerns dominate at that scale:

1. **Allocation pressure.** Allocating a fresh reply channel per request is fine at hundreds of QPS; at hundreds of thousands of QPS it shows up in heap profiles. Pool the channels (`sync.Pool`) or batch requests so each pool worker handles multiple before replying.
2. **Channel send/receive overhead.** Each channel op is a few hundred nanoseconds; in tight loops, atomic operations (`atomic.AddInt64`) are faster. Replace per-task handshakes with periodic batch synchronisation if possible.

For correctness, the same patterns apply — but you should benchmark before adopting them in the hot path.

**Follow-up.** *Have you actually had this problem?* The honest answer is "rarely." Most services live well below the rate at which channel overhead dominates. Measure before optimising.

---

### 21. Explain how the `errgroup` package implements its handshake.

**Answer.** `errgroup.WithContext(parent)` returns a `*Group` and a derived context. Internally:

- A `sync.WaitGroup` counts launched goroutines.
- A `sync.Once` guards the first error and the context cancel call.
- Each `Go(f)` increments the wait group; when the goroutine returns it decrements. On error, the Once fires, recording the error and cancelling the context — broadcasting "stop" to every other goroutine that watches `ctx.Done()`.
- `Wait()` blocks on the wait group and returns the recorded error.

It is the exact stop/stopped pattern, packaged as a library.

**Follow-up.** *What is the limit?* `errgroup` does not bound concurrency. For that, use `golang.org/x/sync/semaphore` or `errgroup.SetLimit` (added in Go 1.20).

---

### 22. Walk me through debugging a deadlocked handshake in production.

**Answer.** Start with the goroutine dump (`net/http/pprof` `goroutine?debug=2` or `kill -SIGQUIT`). Look for:

- Goroutines stuck on `chan receive` or `chan send` — these are the parties of the handshake.
- Cycle: A blocked on receive from `c1`, owner of `c1` blocked on receive from `c2`, owner of `c2` blocked on receive from `c1`.
- Forgotten close: every goroutine blocked on `<-stop` while no goroutine is in the `close(stop)` code path.
- Orphaned send: a goroutine blocked sending an ack into a reply channel whose creator has long since returned.

Cross-reference the stack traces with the channel-creating code to identify the owner and fix the protocol — usually by making a channel buffered, adding a context, or introducing a missing close.

**Follow-up.** *Static tools?* `go vet` catches some defects; the `staticcheck` linter is better. The race detector (`-race`) catches data races, not channel deadlocks — but a race detector report often points at the goroutine you forgot to synchronise with.
