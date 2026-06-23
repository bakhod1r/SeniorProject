---
layout: default
title: Decision Tree — Interview
parent: Decision Tree
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/04-decision-tree/interview/
---

# Decision Tree — Interview

[← Back](../)

These questions are taken from real Go-heavy interview rotations: backend systems at infrastructure shops, observability vendors, exchange engines, container platforms. The pattern is always the same: the interviewer describes a small task in two or three sentences, and you have ten to twenty seconds to name the primitive and another minute to defend the choice. A wrong defense is more disqualifying than a wrong answer — picking a mutex when a channel is cleaner is forgivable; picking a channel and claiming it is "thread-safe by virtue of message passing" without explaining what that means is not.

For each question, the model answer below names the primitive, the reason, and the alternative an interviewer might push back with.

## Counter and flag scenarios

### Q1. "Count the number of bytes processed by a fleet of worker goroutines. The total is read by a metrics goroutine every second."

**Primitive:** `atomic.Int64`.

**Why:** Single 64-bit value, one operation (add) from many writers, one operation (load) from one reader. Atomic Add and Load are wait-free; mutex would force every writer to serialize on a single hot lock and a buffered-channel-of-deltas would add allocation and a goroutine for no benefit.

**Push-back:** "What if I need to reset it to zero atomically each second?" Use `Swap(0)` to read-and-reset in a single operation; do not use `Load` followed by `Store(0)` because that loses any increments that landed between the two.

### Q2. "A goroutine sets a `shutdown` flag; many other goroutines check it in their hot loop."

**Primitive:** `chan struct{}` closed by the setter, with `<-done` (non-blocking via `select`) checked by the consumers.

**Why:** Channel close is broadcast — every consumer sees it, no matter how many. `atomic.Bool` works for the flag itself, but the moment one consumer also wants to *wait* for shutdown rather than poll, you need a channel anyway. Combining both is worse than picking the channel from the start.

**Push-back:** "What about `context.Context`?" `ctx.Done()` is the channel, wrapped. In a production codebase the answer is almost always context, not a raw channel — but the underlying primitive is the channel close.

### Q3. "Track the maximum latency observed across a request burst."

**Primitive:** `atomic.Int64` with a CAS loop.

**Why:** The update is "load current max, compare with my sample, if larger swap in." That is the textbook CAS pattern. A mutex works but adds 50–100 ns of contention per sample; the CAS retries are essentially free when concurrent writers rarely collide.

```go
for {
    cur := maxLatency.Load()
    if sample <= cur {
        break
    }
    if maxLatency.CompareAndSwap(cur, sample) {
        break
    }
}
```

**Push-back:** "Wouldn't a `sync.Mutex` be simpler?" Yes, by two lines. Benchmark it. Under sustained contention CAS wins; under cold contention they tie. The CAS form is also the only one that scales to a histogram of percentiles without rewriting.

## Fan-out and fan-in scenarios

### Q4. "Process a slice of 10,000 URLs in parallel with at most 50 in flight, return the first error."

**Primitive:** `errgroup.Group` with `SetLimit(50)`.

**Why:** Three requirements in one sentence — bounded parallelism, error short-circuit, wait for completion. `errgroup` is the only primitive in the standard library family that gives all three. Anything else is a hand-roll.

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(50)
for _, u := range urls {
    u := u
    g.Go(func() error { return fetch(ctx, u) })
}
return g.Wait()
```

**Push-back:** "Why not a buffered channel of tokens plus a `WaitGroup`?" That is what `errgroup.SetLimit` does under the hood, plus error short-circuit, plus context cancellation. Reimplementing it by hand is what a junior engineer does to demonstrate understanding; in production code you cite the package.

### Q5. "Fan in from 10 goroutines, each producing roughly 1000 events, into a single consumer that writes to a file."

**Primitive:** A single shared `chan Event` (buffered, maybe 1024) plus a `sync.WaitGroup` for producer completion, then close.

**Why:** Channels collapse N producers into 1 consumer without any extra logic. The WaitGroup tells the closer that all producers are done so the consumer can drain and exit.

```go
events := make(chan Event, 1024)
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for _, e := range produce() {
            events <- e
        }
    }()
}
go func() { wg.Wait(); close(events) }()
for e := range events {
    writeToFile(e)
}
```

**Push-back:** "What if writing to the file blocks?" Then the channel buffer fills and producers back-pressure. That is the correct behavior — better than dropping events or growing an unbounded queue.

### Q6. "Implement a `Limiter.Wait(ctx)` that allows N operations per second."

**Primitive:** `golang.org/x/time/rate.Limiter`, which is built on `atomic` and `time.Now()`.

**Why:** Do not write a rate limiter from scratch in an interview unless asked to implement one. If asked to *use* one, name the package. If asked to implement one, describe a token bucket: a float64 of available tokens, replenished as `(now - last)*ratePerSecond`, decremented by 1 on each call, with `time.After` or `ctx.Done()` for the wait. The synchronization primitive is `sync.Mutex` around the bucket state.

### Q7. "Wait for any one of three RPCs to succeed."

**Primitive:** `select` over three channels, each fed by an RPC goroutine.

```go
type result struct{ data []byte; err error }
ch := make(chan result, 3)
for _, addr := range addrs {
    addr := addr
    go func() { d, e := rpc(addr); ch <- result{d, e} }()
}
r := <-ch
```

**Why:** First one wins; the other two complete in the background and their results are GC'd. If you must cancel the losers, use `context.WithCancel` and call `cancel()` after the first result.

**Push-back:** "What about goroutine leaks?" The channel is buffered to capacity 3 so late senders never block. The receivers are GC'd after the channel goes out of scope.

## Bounded-buffer and queue scenarios

### Q8. "Implement a job queue: producers enqueue, N workers dequeue and process."

**Primitive:** Buffered `chan Job`.

**Why:** The buffered channel is itself the bounded queue. Workers `range` over it; producers send. No mutex, no condition variable.

```go
jobs := make(chan Job, 100)
for i := 0; i < numWorkers; i++ {
    go func() { for j := range jobs { process(j) } }()
}
```

**Push-back:** "What if I need to peek at the queue or shut workers down gracefully?" Close the channel from the producer side after the last job; workers exit naturally when `range` ends. For peek, you have picked the wrong data structure — use a deque protected by a mutex and a `sync.Cond`.

### Q9. "Bounded producer/consumer where the producer should block if the consumer is more than 100 items behind."

**Primitive:** Buffered channel with capacity 100.

**Why:** This is literally what a buffered channel is. When the buffer is full, the next `<-` send blocks until a receive frees a slot.

**Push-back:** "Could I use a `sync.Cond` for finer control?" You could; you would also be writing 30 lines instead of 1, and the result would be slower and have at least one bug.

### Q10. "Implement a priority queue where higher-priority items are processed first."

**Primitive:** `container/heap.Interface` protected by a `sync.Mutex` and signaled by a `sync.Cond`.

**Why:** A channel cannot reorder items; FIFO is its only ordering. The moment you need priority, you need a real heap. The mutex protects the heap; the Cond signals consumers when the heap goes from empty to non-empty.

**Push-back:** "Could I use multiple channels, one per priority?" Yes, if the priorities are a small fixed set (high, normal, low). `select` over them with weighted polling. For arbitrary numeric priorities, you need the heap.

## Snapshot, publish, and config scenarios

### Q11. "A config struct is read by many goroutines on every request; it is reloaded by an admin every few minutes."

**Primitive:** `atomic.Pointer[Config]` with copy-on-write.

**Why:** Reads outnumber writes by millions to one. Atomic load of a pointer is one instruction; mutex acquisition is dozens. Writes replace the entire config (new pointer) — no in-place mutation.

```go
var cfg atomic.Pointer[Config]
func Get() *Config { return cfg.Load() }
func Reload(new *Config) { cfg.Store(new) }
```

**Push-back:** "What about `sync.RWMutex`?" RWMutex still requires every reader to do an atomic increment on the reader count — that's a CAS on a hot cache line and shows up in benchmarks at high read rates. Atomic pointer is strictly cheaper and is the canonical Go idiom for read-mostly snapshots.

### Q12. "A routing table with 10,000 entries, updated 10 times per second, read 100,000 times per second."

**Primitive:** `map[string]Route` published via `atomic.Pointer[map[string]Route]` with copy-on-write on update.

**Why:** Same as Q11 but the snapshot is a map. The full map is copied on each update — that costs O(10000) for the update but lets reads remain at one atomic load + one map lookup.

**Push-back:** "What about `sync.Map`?" `sync.Map` is documented for "entries written once and read many times" or "disjoint key sets." This is not that — every entry can be rewritten. The atomic-pointer-over-immutable-map pattern is faster.

### Q13. "Lazy initialization of a database connection pool."

**Primitive:** `sync.Once`.

**Why:** Exactly-once initialization is the canonical use of `sync.Once.Do`. Do not roll a double-checked lock with `atomic.Bool` — the spec handles panic propagation and memory ordering correctly; your version probably will not.

**Push-back:** "What about `sync.OnceValue` (Go 1.21+)?" If you need the result of the initialization, yes — `sync.OnceValue` is the better idiom. `Do` is for side-effecting init that does not return a value.

## Wait-for-N scenarios

### Q14. "Wait for 50 goroutines to all finish."

**Primitive:** `sync.WaitGroup`.

**Why:** Textbook use of WaitGroup: known count, all goroutines call `Done`, parent calls `Wait`.

**Push-back:** "What if one of them might fail?" Then `errgroup.Group`. WaitGroup has no error path.

### Q15. "Wait for any of 5 goroutines to signal a condition, then proceed."

**Primitive:** A single `chan struct{}` (capacity 1) and a `sync.Once` to guarantee the first signal wins.

```go
signal := make(chan struct{}, 1)
var once sync.Once
for i := 0; i < 5; i++ {
    go func() {
        if condition() {
            once.Do(func() { close(signal) })
        }
    }()
}
<-signal
```

**Why:** Close-as-broadcast plus Once for idempotency.

### Q16. "Block until a queue has at least one element, with a timeout."

**Primitive:** `select` with `<-queueChan` and `<-time.After(d)`.

**Why:** Channels and `select` make timeouts trivial. A `sync.Cond.Wait` has no built-in timeout — emulating one requires a goroutine that calls `Broadcast` after the timeout, which is uglier than the channel form.

## Read-mostly and shared-state scenarios

### Q17. "Cache that grows monotonically (entries never evicted), accessed by many goroutines."

**Primitive:** `sync.Map`.

**Why:** The first of the two documented use cases for `sync.Map`: "entry for a given key is only ever written once but read many times." This is exactly that.

### Q18. "Cache with TTL eviction, accessed by many goroutines."

**Primitive:** `map[string]entry` protected by `sync.RWMutex`.

**Why:** Entries are written, expired, re-written — not the `sync.Map` use case. Take the lock on read (RLock if dominantly reads) and on eviction-write.

### Q19. "Per-CPU counter accumulated into a global periodically."

**Primitive:** A slice of `atomic.Int64`, one per goroutine or shard, aggregated periodically.

**Why:** Sharded counters reduce cache-line contention to near zero. Each writer touches only its own shard's cache line; the aggregator pays one full sweep periodically.

```go
const shards = 64
var counters [shards]struct {
    v atomic.Int64
    _ [56]byte // pad to 64-byte cache line
}
func incr() { counters[shardID()].v.Add(1) }
```

### Q20. "Many goroutines append to a shared log; order does not matter."

**Primitive:** Buffered `chan LogEntry` to a single writer goroutine.

**Why:** Serializing through one writer avoids any locking on the destination. The channel buffer absorbs bursts.

**Push-back:** "What about a mutex around `append`?" Works for low rates; at 100K+ entries/sec the lock becomes the bottleneck and the channel wins because the writer can batch I/O.

## sync.Cond and waiter-set scenarios

### Q21. "Producer-consumer where consumers wait when the buffer is empty and producers wait when full."

**Primitive:** Bounded `chan` is enough; if you must hand-roll, use a mutex with two `sync.Cond` variables (notFull, notEmpty).

**Why:** Channel does both signals for free. Cond is only needed when the underlying data structure is not a queue (e.g., heap, ring with peek).

### Q22. "Notify all goroutines waiting on a snapshot becoming non-nil."

**Primitive:** `chan struct{}` closed when the snapshot is ready.

**Why:** Close-as-broadcast is exactly this. No Cond needed.

```go
ready := make(chan struct{})
// Setter:
snapshot = build()
close(ready)
// Waiters:
<-ready
useSnapshot()
```

### Q23. "Dynamic set of waiters that come and go; each is woken when the version number changes and then re-checks its own per-waiter predicate."

**Primitive:** `sync.Cond` with `Broadcast`.

**Why:** This is the canonical Cond use case — broadcast to an unknown, dynamic set of waiters, each of which re-evaluates a predicate after wakeup. Channels can not broadcast to N receivers (a send delivers to exactly one).

### Q24. "Bounded semaphore: at most 10 concurrent operations."

**Primitive:** Buffered `chan struct{}` of capacity 10, acquired with `ch <- struct{}{}`, released with `<-ch`. Or `golang.org/x/sync/semaphore` if weighted.

**Why:** The simplest pattern in Go. The buffered channel *is* the semaphore.

## Stop, cancel, and timeout scenarios

### Q25. "Cancel a long-running operation from the outside."

**Primitive:** `context.Context` with `WithCancel` or `WithTimeout`.

**Why:** Context is the standardized cancellation primitive. The function takes `ctx context.Context` as its first parameter and checks `ctx.Done()` in `select` or at safe interruption points.

### Q26. "Run a function with a 2-second deadline."

**Primitive:** `context.WithTimeout`.

**Push-back:** "What if the function does not take a context?" Wrap it in a goroutine that writes to a result channel, then `select` between that channel and `ctx.Done()`. The original function will keep running — that is a goroutine leak you must accept or fix at the source.

### Q27. "Graceful shutdown: stop accepting new work, finish in-flight work, then exit."

**Primitive:** Close a `done chan struct{}`; new work goroutines check `select { case <-done: return; default: enqueue() }`. Use a `WaitGroup` to wait for in-flight work to drain.

## Atomic-vs-mutex micro-scenarios

### Q28. "Increment one of two counters depending on a runtime condition."

**Primitive:** Two `atomic.Int64`s.

**Why:** Each is independent; no invariant binds them.

### Q29. "Maintain a counter and a timestamp of the last update, both readable together."

**Primitive:** `atomic.Pointer[struct{ Count int64; LastUpdate time.Time }]`.

**Why:** Two values that must move together. Two separate atomics would let a reader observe a count from one moment and a timestamp from another. Packing into a single struct behind one pointer gives a consistent snapshot. A mutex around both also works and is simpler if writes are not hot.

### Q30. "Bool flag that controls whether a feature is enabled, flipped by an admin endpoint."

**Primitive:** `atomic.Bool`.

**Why:** One value, one operation type from many readers and an occasional write. The simplest possible primitive.

### Q31. "Two flags that must always be flipped together (a 'feature is enabled' bit and a 'rollout percentage')."

**Primitive:** `atomic.Pointer[FeatureFlag]` where `FeatureFlag` is a struct of both fields.

**Why:** They must be consistent. Two atomics permit observing the new bool with the old percentage. One pointer to an immutable struct guarantees the snapshot.

## Cancellation, lifecycle, and gotcha scenarios

### Q32. "I have a function with a `for { select { ... } }` loop and want to make it cancellable."

**Primitive:** Add a `case <-ctx.Done(): return` to the select.

**Why:** Context cancellation is the standard pattern. Every long-running select should have a `ctx.Done()` arm. The function signature should take `ctx context.Context` as its first parameter.

```go
func worker(ctx context.Context, jobs <-chan Job) {
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-jobs:
            process(j)
        }
    }
}
```

**Push-back:** "What if the job processing itself doesn't honor context?" Then the worker can be stuck inside `process(j)` even after cancellation. The fix is to pass `ctx` into `process` and have it check periodically.

### Q33. "A goroutine reads from a channel that the producer might close. How do I avoid a panic on send to a closed channel?"

**Primitive:** The receiver detects close via the second return value: `v, ok := <-ch`. If `ok` is false, the channel is closed and drained.

For the sender side, the rule is: *the sender closes the channel, never the receiver.* If multiple goroutines might send, use a `sync.Once` to ensure exactly one close, or restructure so that one orchestrator owns the close.

```go
v, ok := <-ch
if !ok {
    return // channel closed
}
```

### Q34. "I have a `sync.RWMutex` and a goroutine that calls `RLock`, then while holding it, calls another function that also calls `RLock`. Is that safe?"

**Answer:** No. `sync.RWMutex` is not re-entrant in Go. Two RLock calls from the same goroutine while a writer is waiting can deadlock — the second RLock waits for the writer, the writer waits for the first RLock to be released.

**Fix:** restructure so the inner function takes an already-locked precondition (e.g., a private method that assumes the lock is held), or rethink whether recursive locking is needed.

### Q35. "A goroutine writes to a buffered channel; nobody is reading. The goroutine eventually blocks. Is that a leak?"

**Answer:** Yes, if the goroutine will never make progress. A goroutine blocked on a channel send (or receive) that will never be matched is leaked — it sits in memory forever.

**Fix:** the standard pattern is `select { case ch <- v: case <-ctx.Done(): return }`. Either the send completes or the context cancels and the goroutine exits cleanly.

### Q36. "How do I implement a graceful shutdown that waits for in-flight work but rejects new work?"

**Primitive:** A closed `done` channel for "rejecting new work" + `sync.WaitGroup` for "wait for in-flight."

```go
type Server struct {
    done chan struct{}
    wg   sync.WaitGroup
    once sync.Once
}

func (s *Server) Submit(job Job) error {
    select {
    case <-s.done:
        return errors.New("shutting down")
    default:
    }
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        process(job)
    }()
    return nil
}

func (s *Server) Shutdown() {
    s.once.Do(func() { close(s.done) })
    s.wg.Wait()
}
```

**Push-back:** "There is a race between checking `<-s.done` and calling `s.wg.Add(1)`." Yes. The fix is to take a mutex around both operations, or to use `errgroup` which handles this internally.

### Q37. "I want to time out a single channel receive."

**Primitive:** `select` with `<-time.After(duration)`.

```go
select {
case v := <-ch:
    return v, nil
case <-time.After(2 * time.Second):
    return zero, errors.New("timeout")
}
```

**Push-back:** "What if I'm timing out in a loop? `time.After` allocates a timer each iteration that won't be GC'd until it fires." Use `time.NewTimer` with explicit `Stop`/`Reset`, or restructure to use a single `context.WithTimeout` outside the loop.

## Closing thoughts

The interviewer is looking for two things:

1. Does the candidate name the right primitive within a few seconds?
2. Can they articulate *why* the alternatives are worse for this specific case?

The decision tree is the framework. The reasons are: "shared state vs signal," "one writer or many," "read-mostly or write-mostly," "values that must move together or independently." If you can talk through those four questions for any scenario, the primitive falls out and the interview is essentially over.

A note on whiteboard style: when you name the primitive, *immediately* sketch the smallest possible code skeleton — three or four lines — and explain it. Interviewers grade on the cognitive economy of the answer: a candidate who reaches for the right primitive and can write the canonical idiom from memory has demonstrated production fluency. A candidate who names the primitive but cannot write the boilerplate has memorized the answer.

And a final piece of meta-advice: do not be afraid to say "this is the kind of code I would not write from scratch — I'd use `errgroup`." Citing the right standard-library or `x/sync` package is itself a senior signal. The interview is not a coding test; it is an evaluation of your judgement about what existing tools to use.
