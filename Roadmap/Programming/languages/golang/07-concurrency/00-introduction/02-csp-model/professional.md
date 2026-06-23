# CSP Model — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Process Algebras: A Family Tree](#process-algebras-a-family-tree)
3. [Formal CSP Syntax](#formal-csp-syntax)
4. [Traces, Failures, and Divergences](#traces-failures-and-divergences)
5. [Refinement Checking with FDR](#refinement-checking-with-fdr)
6. [Channels in the Go Runtime](#channels-in-the-go-runtime)
7. [Select Implementation](#select-implementation)
8. [Closing, Nil, and Reflect.Select](#closing-nil-and-reflectselect)
9. [Channel Performance Numbers](#channel-performance-numbers)
10. [Summary](#summary)

---

## Introduction

This file is for engineers who want to peek inside both the theory (process algebras) and the practice (Go runtime channel implementation). Neither is required to use channels effectively, but each clarifies what Go's pragmatic choices cost and buy.

We touch the original CSP formalism, neighbouring process algebras (CCS, ACP, π-calculus), the FDR refinement checker, and the runtime's `hchan` data structure. The goal: see the trade-offs Go made and understand the corners of the implementation that surprise day-to-day users.

---

## Process Algebras: A Family Tree

Several formal models of concurrency emerged in the 1970s–80s. Each provides a small algebra of processes and reasoning rules.

### CSP (Hoare, 1978)

The first version of CSP appeared in CACM 1978. Hoare extended it into a book-length treatment in 1985. CSP uses **named channels** as the synchronisation primitive. Processes communicate by simultaneous send and receive on a channel; there are no anonymous events.

### CCS (Milner, 1980)

The Calculus of Communicating Systems. Similar in spirit but uses **events** rather than channels. A process can emit or accept events; two processes synchronise when one emits and the other accepts the same event name. CCS has a particularly clean equational theory.

### ACP (Bergstra and Klop, 1984)

Algebra of Communicating Processes. A more abstract algebraic treatment with axioms; less prescriptive about the underlying model.

### π-calculus (Milner, 1992)

Extends CCS with **channel mobility**: channels can be passed as messages, so the network topology changes over time. The closest formal match for Go's `chan chan T` patterns. Influential in the design of mobile code and distributed systems.

### Join calculus (Fournet, Gonthier, 1996)

An asynchronous variant emphasising *join patterns* — multiple message arrivals trigger one reaction. Implemented in Polyphonic C# and JoCaml.

### CSP-M (Roscoe et al., 1990s)

Machine-readable CSP for use with the FDR refinement checker. The form in which CSP is most often *used* today.

Go inherits the CSP-style channel abstraction and the philosophy "share by communicating." It is less formal than CSP-M but closer in spirit to π-calculus, because Go's channels are first-class values that can be passed through channels (mobile).

---

## Formal CSP Syntax

A minimal subset, in machine-readable CSP-M:

```
-- Basic processes
STOP                    -- deadlocked
SKIP                    -- successful termination

-- Prefix
a -> P                  -- engage in event a, then behave as P

-- Choice
P [] Q                  -- external choice
P |~| Q                 -- internal (nondeterministic) choice

-- Composition
P ; Q                   -- sequential
P || Q                  -- parallel (synchronise on shared events)
P ||| Q                 -- interleave (no synchronisation)
P [| {a,b} |] Q         -- partial sync on {a,b}

-- Communication
c!v -> P                -- send v on c, then P
c?x -> P                -- receive x on c, then P

-- Hiding
P \ {a, b}              -- hide events a, b from outer view

-- Recursion
P = a -> P              -- P does a, then becomes P again
```

A typical example: a one-slot buffer.

```
BUFFER1 = in?x -> out!x -> BUFFER1
```

Read `x` on `in`, write it to `out`, recurse. A two-stage pipeline of buffers:

```
BUFFER2 = (BUFFER1[in <- in, out <- mid]) [| {mid} |] (BUFFER1[in <- mid, out <- out]) \ {mid}
```

Two BUFFER1 processes glued on a hidden channel `mid`. The result behaves like a two-slot buffer.

The Go equivalent:

```go
func buffer1(in <-chan int, out chan<- int) {
    for v := range in {
        out <- v
    }
    close(out)
}

func buffer2() (chan<- int, <-chan int) {
    in := make(chan int)
    mid := make(chan int)
    out := make(chan int)
    go buffer1(in, mid)
    go buffer1(mid, out)
    return in, out
}
```

Note the close-propagation: when `in` closes, the first `buffer1` returns and closes `mid`, which makes the second `buffer1` return and close `out`.

---

## Traces, Failures, and Divergences

CSP semantics are defined over three sets of observations:

### Traces

A trace is a finite sequence of events the process engages in. The trace semantics describe what the process can do.

```
traces(a -> b -> STOP) = { <>, <a>, <a, b> }
```

The process can produce zero events (initial state), one event `a`, or the full sequence `a, b`.

### Failures

A failure is a pair `(trace, refusals)`: after performing `trace`, the process can refuse to engage in any event in `refusals`.

This distinguishes processes that have the same traces but different behaviour. `a -> b -> STOP` and `a -> (b -> STOP [] c -> STOP)` have different failures.

### Divergences

A divergence is a trace after which the process can engage in an infinite sequence of internal events without producing observable behaviour.

The full failures-divergences semantics (`F-D` or `FDR3`) is the most general; it can detect both deadlock and livelock.

For practical Go programmers, the lesson is: a process's behaviour is *not* just what events it produces, but also what it refuses and where it diverges. Tools like FDR formalise this; humans usually reason informally.

---

## Refinement Checking with FDR

FDR (Failures-Divergences Refinement) is a tool by Bill Roscoe and Goldsmith at Oxford. It checks whether one CSP-M process refines another.

`P` is refined by `Q` (written `P [= Q`) if every behaviour of `Q` is also a behaviour of `P`. Refinement is the formal notion of "implementation conforms to specification."

Typical use:

1. Write a high-level specification: `SPEC = ...` (what the system should do).
2. Write a detailed implementation: `IMPL = ...` (how it does it).
3. Ask FDR: `SPEC [= IMPL`?

If yes, the implementation is correct. If no, FDR produces a counterexample trace.

FDR can also check for:

- Deadlock freedom.
- Livelock freedom.
- Determinism.

This is overkill for most Go code, but it is the standard for safety-critical concurrency design — naval systems, railway interlocks, hardware verification. Some teams write a CSP-M model of a tricky concurrent feature, check it with FDR, then implement in Go.

---

## Channels in the Go Runtime

A `chan T` in Go is a pointer to an `hchan` struct (defined in `runtime/chan.go`). Simplified:

```go
type hchan struct {
    qcount   uint           // number of elements in buffer
    dataqsiz uint           // buffer capacity
    buf      unsafe.Pointer // ring buffer
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint           // send index into buf
    recvx    uint           // receive index into buf
    recvq    waitq          // queue of receivers waiting
    sendq    waitq          // queue of senders waiting
    lock     mutex
}
```

Key points:

- **Buffer is a ring buffer.** Indices `sendx` and `recvx` track where the next send and next receive go.
- **Waiting goroutines queue.** When a receive happens on an empty channel, the goroutine is parked on `recvq`. When a sender arrives, it pops the receiver off and wakes it.
- **A single lock protects the channel.** This is a real `runtime.mutex`, fast but contended under heavy concurrent access.

### Send fast path

1. Acquire lock.
2. If a receiver is waiting (`recvq` non-empty), copy the value directly to the receiver's stack, wake the receiver, release lock.
3. Else if buffer has space, copy to `buf[sendx]`, increment `qcount`, release lock.
4. Else (full), park this goroutine on `sendq`, release lock.

### Receive fast path

1. Acquire lock.
2. If buffer has elements, take `buf[recvx]`, decrement `qcount`. Also wake a waiting sender if any. Release lock.
3. Else if a sender is waiting, copy directly from sender's stack, wake sender, release lock.
4. Else park on `recvq`, release lock.

### Direct send (unbuffered channels)

For unbuffered channels with a waiting receiver, the runtime *copies the value directly from the sender's stack to the receiver's stack* without going through the buffer. This is faster than the buffered path because there is no allocation.

### Why channels are slower than mutexes

Each channel operation involves a lock acquire / release plus possibly a goroutine park or wake. A mutex `Lock()` / `Unlock()` is one lock-pair. Channel operations are at least one lock-pair plus more bookkeeping.

Approximate latencies on modern hardware:

| Operation | Latency |
|---|---|
| Atomic add | ~5 ns |
| Mutex lock/unlock (uncontended) | ~20 ns |
| Channel send (uncontended, buffered) | ~80 ns |
| Channel send (unbuffered, with waiting receiver) | ~200 ns |
| Channel send (waking parked goroutine) | ~500 ns |

These numbers are from `BenchmarkChan` in the Go runtime tests; your results vary with hardware.

---

## Select Implementation

A `select` is more complex than a single channel operation. The runtime must:

1. Evaluate all case channels and values.
2. Lock all channels in a deterministic order (to avoid deadlock).
3. Check if any case is immediately ready.
4. If multiple are ready, pick uniformly at random.
5. If none, register on all channels' wait queues.
6. Unlock all.
7. Sleep.
8. When woken (by some channel becoming ready), remove from all *other* channels' wait queues.
9. Execute the chosen case.

The locking-all-channels step costs O(n) where n is the number of cases. For small n (typical use, 2–4 cases) this is fast. For large n, `select` becomes expensive.

### `reflect.Select`

When the number of cases is dynamic, you use `reflect.Select`:

```go
cases := []reflect.SelectCase{...}
chosen, value, ok := reflect.Select(cases)
```

This is implemented in pure Go on top of the same primitives but pays reflection overhead. Use sparingly; prefer fixed-arity `select` where possible.

### Default case

```go
select {
case v := <-ch:
    ...
default:
    ...
}
```

The default case fires if no other case is immediately ready. It does *not* register on wait queues; the goroutine does not sleep. Useful for non-blocking sends and receives.

---

## Closing, Nil, and Reflect.Select

### Close semantics

`close(ch)` sets `ch.closed = 1`, then wakes all goroutines on `recvq` (they receive zero value with `ok == false`) and all goroutines on `sendq` (they panic). Closing is broadcast.

After close:

- Receive returns immediately with zero value, `ok == false`.
- Send panics.
- `len(ch)` and `cap(ch)` still work.
- A closed channel cannot be re-opened.

### Nil channels

A nil channel never sends and never receives — it blocks forever.

```go
var ch chan int // nil

ch <- 1 // blocks forever
<-ch    // blocks forever

select {
case <-ch:  // never fires (ch is nil)
case <-other:
    ...
}
```

The runtime treats nil channels in `select` as permanently blocked cases. Useful for dynamically disabling cases:

```go
var sendCh chan<- int

if shouldSend {
    sendCh = real
}

select {
case sendCh <- v:  // only fires if sendCh is not nil
case <-quit:
    return
}
```

### `reflect.Select` with directional channels

```go
cases := []reflect.SelectCase{
    {Dir: reflect.SelectRecv, Chan: reflect.ValueOf(ch1)},
    {Dir: reflect.SelectSend, Chan: reflect.ValueOf(ch2), Send: reflect.ValueOf(42)},
    {Dir: reflect.SelectDefault},
}
chosen, recv, recvOK := reflect.Select(cases)
```

Useful when the number or type of channels is unknown at compile time. Costs more than fixed `select`.

---

## Channel Performance Numbers

Benchmarks from Go 1.22 on a typical x86 server, single-threaded:

| Operation | Time per op |
|---|---|
| `make(chan int, 1)` | ~50 ns |
| `make(chan struct{})` | ~40 ns |
| Send on buffered channel (uncontended) | ~70 ns |
| Receive from buffered channel (uncontended) | ~70 ns |
| Send + recv pair on unbuffered (cross-goroutine) | ~300 ns |
| `select` with 2 cases, one ready | ~110 ns |
| `select` with 4 cases, one ready | ~150 ns |
| `select` with 16 cases, one ready | ~400 ns |
| `close(ch)` | ~40 ns |

Under contention (many goroutines hammering the same channel) numbers degrade significantly — the channel's lock becomes the bottleneck.

For high-throughput pipelines, consider:

- Batching (`chan []T` instead of `chan T`).
- Sharding (multiple channels, one per producer).
- Atomics or shared buffers (escape CSP).

---

## Summary

Process algebras provide formal foundations for reasoning about concurrent programs. CSP, CCS, ACP, π-calculus, and join calculus are members of the family; CSP and π-calculus are most directly visible in Go.

Go's channels are a pragmatic CSP implementation: typed, first-class, optionally buffered, dynamically created. The runtime backs them with an `hchan` struct and a lock; send/receive cost around 100 ns uncontended, more under load.

`select` is CSP's external choice operator, implemented as a multi-channel wait with deterministic locking order, uniform random tie-breaking, and a default-case escape hatch. `reflect.Select` enables dynamic arity at reflection cost.

Closed channels broadcast; nil channels block forever; both behaviours have idiomatic uses in `select` patterns.

For the deepest formal treatment, FDR allows refinement checking of CSP-M specifications. For most Go code, this is overkill — but knowing it exists is part of the senior toolkit.
