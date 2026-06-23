# Buffered vs Unbuffered Channels — Senior Level

## Table of Contents
1. [Mindset Shift](#mindset-shift)
2. [The Go Memory Model and Channels](#the-go-memory-model-and-channels)
3. [Happens-Before Reasoning](#happens-before-reasoning)
4. [Synchronisation Semantics in Detail](#synchronisation-semantics-in-detail)
5. [Capacity as a Design Variable](#capacity-as-a-design-variable)
6. [Channel Ownership Discipline](#channel-ownership-discipline)
7. [Leak Prevention Architecture](#leak-prevention-architecture)
8. [Avoiding the "Hidden Async" Pathology](#avoiding-the-hidden-async-pathology)
9. [Channels vs Mutex vs Atomic](#channels-vs-mutex-vs-atomic)
10. [Channels in API Boundaries](#channels-in-api-boundaries)
11. [Testability and Determinism](#testability-and-determinism)
12. [Refactoring Patterns](#refactoring-patterns)
13. [Anti-Patterns Reviewers Reject](#anti-patterns-reviewers-reject)
14. [Summary](#summary)
15. [Self-Assessment](#self-assessment)

---

## Mindset Shift

By senior level, channels are not a feature you reach for; they are a *vocabulary* you use to describe concurrent designs. You stop thinking "should this be buffered?" and start thinking:

- *What synchronisation contract is this channel part of?*
- *Who owns its lifecycle and who can close it without panic?*
- *What is the worst-case backlog, and what happens at the cliff?*
- *Could a goroutine I am about to spawn outlive the channel it depends on?*

The senior decisions are about *systems-level* concerns: leaks, fairness, observability, maintainability across teams, and how the code behaves when shoved through the next refactor. Buffered-vs-unbuffered is a small operator's choice; what you are picking is the synchronisation profile of an entire subsystem.

---

## The Go Memory Model and Channels

Go's memory model gives channels two specific guarantees you can program against:

1. **A send on a channel happens before the corresponding receive completes.**
2. **A receive on a closed channel happens after every send that ever happened on it.**

Concretely:

```go
var x int
ch := make(chan struct{})

go func() {
    x = 42         // (W)
    close(ch)      // (S)
}()

<-ch               // (R)
fmt.Println(x)     // observes 42, guaranteed
```

The close (S) happens-before the receive (R), and the write (W) happens-before the close (S). Therefore (W) happens-before the print. Without that chain, the read of `x` would be racy.

For unbuffered channels, the same rule holds in the form: send happens before receive *completes*. For buffered channels, send happens before *the matching receive*. The "matching" word is critical — values pair up in FIFO order, not by goroutine identity.

The memory model also tells you what is *not* guaranteed:

- A send happens before *that send's matching receive*. It does *not* happen before *every later receive*. Two receives that happen after the same send are not ordered relative to each other except via further synchronisation.
- A close happens before any receive that returns the zero-`!ok` form. But close does *not* synchronise with sends made on *other* channels.

These distinctions matter when you write lock-free designs that lean on channel ordering.

---

## Happens-Before Reasoning

When reviewing channel-using code, mentally tag each interesting operation and draw arrows:

```
goroutine A                   goroutine B
  set x = 1   (a1)
  ch <- v     (a2) ─────────► <-ch         (b1)
                              read x       (b2)
                              ch2 <- 7     (b3) ────► <-ch2  (...)
```

Read happens-before transitively: `a1 → a2 → b1 → b2`. So in goroutine B, after the receive, you may read `x` and observe `1`. *Provided no other goroutine wrote `x` later*.

This visualisation is the heart of senior-level review. If a colleague says "but `x` is shared, isn't that a race?" your response is to point at the arrows: each shared read is *downstream* of a send that observed the corresponding write.

For buffered channels, the chain still works, but the receive is paired with a specific send by FIFO order:

```
A: ch <- 1   (a1)
A: ch <- 2   (a2)
B: <-ch  →   (b1)  // pairs with a1
B: <-ch  →   (b2)  // pairs with a2
```

So `b1` is downstream of `a1` only, not `a2`. If some shared write happened *between* `a1` and `a2` in A, B's first receive does not observe it.

---

## Synchronisation Semantics in Detail

### Unbuffered: full handshake

A send on an unbuffered channel transfers the value *and* synchronises the two goroutines at that instant. After the send returns, the sender knows the receiver has the value. After the receive returns, the receiver knows the sender's earlier writes are visible. This is **rendezvous synchronisation**.

### Buffered: half handshake

A send on a buffered channel with room *does not synchronise the sender with any specific receiver*. It synchronises with whichever receiver eventually drains that slot. The sender knows nothing about timing on the other side after returning from the send.

This means:

```go
ch := make(chan int, 1)
ch <- 1
// Receiver may not yet have run.
fmt.Println("sent")  // does not imply anyone has read 1
```

Senior heuristic: if your reasoning needs "and now the other side definitely has it," you wanted unbuffered.

### Closed channel as broadcast

A `close(stopCh)` wakes up every parked receiver simultaneously. They each receive the zero value with `ok == false`. There is no value loss because there is no value — close is a synchronisation event, not a transfer.

```go
stopCh := make(chan struct{})

for i := 0; i < N; i++ {
    go func() {
        select {
        case <-stopCh:
            // every goroutine reaches this branch when close runs
            return
        case <-work:
            // ...
        }
    }()
}

close(stopCh) // broadcast cancel
```

The cost of close is O(number of waiting receivers) — fine for normal counts.

---

## Capacity as a Design Variable

Senior code treats capacity as something you derive, not pick.

### Heuristic 1: capacity ≈ producer-consumer rate ratio × scheduling jitter

If the producer makes 1000 values/sec and the consumer drains at 950/sec on average with 50 ms of GC jitter, the burst absorbed is roughly `(1000 - 950) × 0.05 ≈ 2.5`. Capacity 4–8 is enough; capacity 1000 hides ten seconds of work.

### Heuristic 2: capacity bounded by memory budget

If each `T` is 16 KB and you allow at most 1 MB of in-flight queue, your cap is 64. Encode this in a constant:

```go
const maxInFlightMemBytes = 1 << 20
const inFlightCap         = maxInFlightMemBytes / int(unsafe.Sizeof(T{}))
```

A reviewer who reads `make(chan T, inFlightCap)` immediately understands the rationale.

### Heuristic 3: capacity 0 is a synchronisation contract

When you make a channel unbuffered, you are saying "there is *no* slack between producer and consumer." That contract is sometimes a feature: it forces the producer to wait, which is sometimes exactly the rate-limiting you want.

### Heuristic 4: capacity = N for "done with N tasks"

```go
results := make(chan Result, N)
for i := 0; i < N; i++ {
    go func(i int) {
        results <- compute(i)
    }(i)
}
for i := 0; i < N; i++ {
    handle(<-results)
}
```

The capacity equals the producer count, so producers never block. No close needed because the receive count is known.

---

## Channel Ownership Discipline

A channel has three rights that need to be assigned:

| Right | Held by |
|-------|---------|
| Send | One or more producers |
| Receive | One or more consumers |
| Close | Exactly one party (often a coordinator) |

A senior reviewer reads code and immediately asks: *"who closes this?"* If the answer is "I'm not sure" or "the consumer," there is probably a bug.

Two clean ownership patterns dominate production code:

### Pattern A: producer owns

```go
func source() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < 10; i++ {
            out <- i
        }
    }()
    return out
}
```

The producer is the only sender and closer. The function returns a `<-chan int`, which means consumers literally cannot close it.

### Pattern B: coordinator owns close

```go
type pipeline struct {
    in   chan int
    once sync.Once
}

func (p *pipeline) Close() {
    p.once.Do(func() { close(p.in) })
}
```

When close has to be triggered externally (e.g. by a shutdown signal), wrap it in a `sync.Once` so accidental double-close becomes a no-op rather than a panic.

---

## Leak Prevention Architecture

A goroutine leak through a channel is the most common bug at senior scale. Three structural rules prevent most of them:

### Rule 1: every goroutine has an exit channel

```go
func worker(jobs <-chan Job, done <-chan struct{}) {
    for {
        select {
        case j, ok := <-jobs:
            if !ok { return }
            handle(j)
        case <-done:
            return
        }
    }
}
```

If a goroutine has only one channel it listens to and that channel never closes, the goroutine leaks. Always pair work channels with a `done` or context for cancellation.

### Rule 2: the function that spawns is responsible for the wait

```go
func RunBatch(jobs []Job) error {
    in := make(chan Job)
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range in {
                handle(j)
            }
        }()
    }

    for _, j := range jobs {
        in <- j
    }
    close(in)
    wg.Wait() // RunBatch does not return until everyone has stopped
    return nil
}
```

Senior code rarely has a "fire and forget" goroutine in the middle of a longer function. If one is needed, it is documented as such and given an explicit way to terminate.

### Rule 3: "select on send" for shutdown-aware producers

```go
for _, j := range jobs {
    select {
    case in <- j:
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

A blocking send into a half-shut-down system is a leak waiting to happen. Send via `select` so cancellation interrupts the send.

---

## Avoiding the "Hidden Async" Pathology

A classic senior-level bug: a function takes a channel argument, the channel is buffered behind the scenes, the function's API silently changes from "synchronous" to "asynchronous" depending on the caller. Reviewers cannot tell from the signature.

```go
// API stays the same...
func enqueue(ch chan<- Job, j Job) {
    ch <- j
}
// ...but call sites differ wildly:

unbuf := make(chan Job)
enqueue(unbuf, j) // synchronous handoff

buf := make(chan Job, 1024)
enqueue(buf, j)   // returns immediately while buffer fills
```

Two cures:

1. **Hide the channel behind a typed wrapper** that documents its semantics:

   ```go
   type Queue struct {
       ch chan Job
   }

   func NewSyncQueue() *Queue   { return &Queue{ch: make(chan Job)}    }
   func NewAsyncQueue() *Queue  { return &Queue{ch: make(chan Job, 1024)} }

   func (q *Queue) Enqueue(j Job) { q.ch <- j }
   ```

2. **Make the call site explicit**: never accept a `chan T` parameter without documenting what semantics the caller is buying into. If the API really is "synchronous handoff," the channel should be unbuffered and the doc comment should say so.

---

## Channels vs Mutex vs Atomic

Channels are not the only synchronisation primitive in Go, and at the senior level you must know when to *not* use them.

| Need | Best tool |
|------|-----------|
| One goroutine waits for one event | unbuffered `chan struct{}`, closed once |
| Many goroutines wait for one event | `chan struct{}` closed once (broadcast) |
| Bounded pipeline of values | buffered channel |
| Single shared counter | `sync/atomic` |
| Shared map / slice protected for read & write | `sync.RWMutex` |
| Many one-time computations cached | `sync.Once`, `singleflight` |
| Wait for N goroutines to finish | `sync.WaitGroup` |
| Coordinate "done" lifecycle in deep call stacks | `context.Context` |
| Low-latency producer-consumer hot path | mutex + condvar or atomic + spin (microbenchmarked) |

The famous Go proverb is "don't communicate by sharing memory; share memory by communicating." That is *direction*, not *dogma*. A counter incremented from 50 goroutines is best done with `atomic.AddInt64`. A small map read 10× per request and updated 1× per minute is best done with `RWMutex`. Reaching for a channel for those is overengineering.

A senior heuristic: channels are great when the dominant operation is a *transfer of value or control*. They are poor when the dominant operation is *counting, sharing, or guarding*.

### Rough cost comparison

For a single send-receive pair on word-sized data, on modern hardware:

| Operation | Approximate cost |
|-----------|------------------|
| `atomic.AddInt64` | ~3–5 ns |
| `sync.Mutex` lock/unlock | ~15–25 ns |
| Channel send + receive (uncontended) | ~80–120 ns |
| Channel send + receive (contended) | ~200–500 ns |

These are not numbers to micro-optimise to. They are numbers that tell you channels are roughly an order of magnitude more expensive per operation than atomics. Do not use channels for *high-frequency* counters; use them for *transfer-of-control*.

---

## Channels in API Boundaries

Returning a channel from an exported function is a strong API choice — it commits the caller to a particular concurrency model.

### When it works

```go
func Subscribe(topic string) <-chan Event
```

Caller can `range` and let the returned channel define the loop body. Idiomatic in pub/sub, watch APIs, etc.

### When it does not

```go
func Get(key string) <-chan Value // ???
```

A one-shot lookup wrapped in a channel just adds noise. Return `(Value, error)` directly.

### Composition

If your function returns a channel, document:

- Direction (`<-chan T` already enforces this, but commentary helps).
- Whether the channel will close, and on what condition.
- Whether the caller can stop iteration (typically by passing a `context.Context`).
- Buffering: implicit guarantees about backpressure.

A function whose returned channel never closes is, in practice, a leak hazard, because callers using `range` will block forever. Either it must close, or the function must accept a `Context` so the caller can cancel.

---

## Testability and Determinism

Channels make code more testable than locks because they linearise events. You can:

- Inject a fake clock or fake channel and observe sends/receives in deterministic order.
- Race-detect obvious bugs (`go test -race`).
- Use buffered test channels of size 1 to capture "did this fire?" without timing assumptions:

  ```go
  fired := make(chan struct{}, 1)
  thingThatShouldFire(func() { fired <- struct{}{} })
  select {
  case <-fired:
  case <-time.After(time.Second):
      t.Fatal("did not fire within 1s")
  }
  ```

For unit-testing pipeline stages, prefer to pass channels in via parameters so you can substitute test channels. Avoid hidden global channels: they break determinism.

A senior debugging tactic: when a test hangs intermittently, dump goroutines on timeout (`t.Fatal` after a bounded `select`). The dump usually points straight at the channel operation that lost its partner.

---

## Refactoring Patterns

### From "share memory + lock" to "communicate"

Before:

```go
var mu sync.Mutex
var queue []Job

func enqueue(j Job) {
    mu.Lock()
    queue = append(queue, j)
    mu.Unlock()
}
func worker() {
    for {
        mu.Lock()
        if len(queue) == 0 {
            mu.Unlock()
            time.Sleep(10 * time.Millisecond) // ugly busy-wait
            continue
        }
        j := queue[0]
        queue = queue[1:]
        mu.Unlock()
        handle(j)
    }
}
```

After:

```go
jobs := make(chan Job, 16)

func enqueue(j Job) { jobs <- j }
func worker() {
    for j := range jobs {
        handle(j)
    }
}
```

Two-thirds shorter. No busy wait. Backpressure is automatic.

### From "channel everywhere" to "atomic for counters"

Before:

```go
done := make(chan int)
go func() {
    for ev := range stream {
        if matches(ev) {
            done <- 1
        }
    }
    close(done)
}()
total := 0
for v := range done {
    total += v
}
```

After:

```go
var total atomic.Int64
go func() {
    for ev := range stream {
        if matches(ev) {
            total.Add(1)
        }
    }
}()
// ... wait via WaitGroup, then read total.Load()
```

Channels were doing the work of an atomic counter — slowly.

### From "buffered to mask deadlock" to "real flow control"

Before:

```go
out := make(chan Event, 10000) // hopes to mask the slow consumer
```

After:

```go
out := make(chan Event, 16) // measured burst
// + drop policy if buffer full:
select {
case out <- ev:
default:
    metrics.Drop.Inc()
}
```

Bounded buffer, explicit overflow policy, observable failure mode.

---

## Anti-Patterns Reviewers Reject

- **Capacity that is a magic number** with no comment, no constant, no measured rationale.
- **Channels passed bidirectional in function parameters.** Use `chan<- T` or `<-chan T`.
- **Channels closed by consumers**, especially in fan-in setups. The result is panic on the next send.
- **Goroutines without exit channels** that read from one channel only — a leak waiting for a slow producer.
- **Channels used for shared counters**, where atomic would be both faster and clearer.
- **Public APIs that return a channel that never closes** without taking a `context.Context`.
- **`select` with a `default` case used to "make sends non-blocking" without an overflow strategy.** The dropped values are silently lost.
- **`time.Sleep`-based polling on a channel** instead of `range` or `select`.

---

## Summary

Senior-level mastery of buffered vs unbuffered is mostly mastery of *what you are guaranteeing*. Unbuffered means "we synchronise here." Buffered means "we tolerate up to N values of slack, and at the cliff the producer waits." Use the memory model to reason about visibility of shared writes — the happens-before chain is the formal tool. Treat capacity as a measured parameter with documented justification. Make exactly one goroutine the closer. Pair every long-running consumer with an exit channel or context. Mix channels with mutexes and atomics deliberately, picking each for its strength. The hard part is not knowing the syntax, it is knowing the *contract* a channel imposes on the rest of your system.

---

## Self-Assessment

- [ ] I can draw the happens-before arrows for any code I write that uses a channel.
- [ ] I can explain why "capacity = 1000" is almost always a smell.
- [ ] I have refactored at least one piece of code from "channel for counting" to "atomic counter" or vice versa.
- [ ] I can articulate the ownership of every channel I review: who sends, who closes, who receives.
- [ ] I have written a multi-producer fan-in with a coordinator that closes the merge channel safely.
- [ ] I always pair my workers with a cancellation channel or context.
- [ ] I treat `chan T` in a function parameter as a smell and turn it into directional types.
- [ ] I document, in code or comments, the buffering semantics of every public channel-returning API.
