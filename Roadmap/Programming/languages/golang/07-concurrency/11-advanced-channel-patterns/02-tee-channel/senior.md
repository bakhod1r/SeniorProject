# Tee-Channel — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Internal Mechanics of the Nil-Channel Trick](#internal-mechanics-of-the-nil-channel-trick)
3. [Fairness, Scheduling, and `select` Bias](#fairness-scheduling-and-select-bias)
4. [Tee Under High Throughput](#tee-under-high-throughput)
5. [Lock-Free Multi-Output Variants](#lock-free-multi-output-variants)
6. [Tee in a Streaming System](#tee-in-a-streaming-system)
7. [Exactly-Once vs At-Least-Once Semantics](#exactly-once-vs-at-least-once-semantics)
8. [Observability and Drop Accounting](#observability-and-drop-accounting)
9. [Choosing Between Tee, Hub, and Ring Buffer Fanout](#choosing-between-tee-hub-and-ring-buffer-fanout)
10. [Production Failure Modes](#production-failure-modes)
11. [Summary](#summary)

---

## Introduction

At senior level the question is not "how does tee work" or "which variant should I pick" but "what are the failure modes when I run this at production scale, and how do I reason about them?"

Tee is built from primitives — `select`, `chan`, `close` — whose semantics are well-defined but subtle under load. This file unpacks the parts the middle-level summary glossed over: runtime mechanics of `select`, fairness guarantees (and lack thereof), throughput ceilings, integration with non-channel back-ends (ring buffers, message brokers), and the operational behaviour you should expect when tee is in the hot path of a high-volume pipeline.

---

## Internal Mechanics of the Nil-Channel Trick

A `select` statement compiles to a call into `runtime.selectgo` (see `src/runtime/select.go`). At call time the runtime:

1. Walks the list of cases.
2. For each case, evaluates the channel expression. **A `nil` channel produces an entry with no ready slot and no pending slot; it is effectively pruned.**
3. Performs a lock-acquisition pass over the *non-nil* channels in pseudo-random order.
4. If any channel has a ready send/receive partner, that case is taken immediately.
5. If none is ready, the goroutine is parked on the wait-queues of all non-nil channels.

The key consequence: setting a channel variable to `nil` between iterations is *not* a runtime hack; it is the documented and supported way to dynamically remove a case from a `select` without rewriting the statement.

The cost is a single pointer write. There is no allocation, no lock, no scheduling.

The alternative — restructuring the code to use two different `select` statements ("first send is one select, second send is another") — would compile to two distinct `selectgo` calls and prevent the runtime from atomically considering both branches as ready in the first iteration. The nil-channel form is strictly more efficient.

### Compiler-level note

`go build -gcflags="-m"` rarely tells you much about `select` cases; they live in the runtime, not the compiler's inliner. To understand performance, profile with `go test -bench=. -benchmem` and `go tool pprof` against a tee benchmark. The hot path is `runtime.selectgo` and `runtime.chansend`.

---

## Fairness, Scheduling, and `select` Bias

`select` picks uniformly at random among ready cases. The implementation uses a Knuth shuffle on the case order each call. This means:

- Over a long run, both outputs receive the value "first" roughly half the time.
- For any *single* value, which output gets it first is unpredictable.
- There is no static priority; you cannot rely on declaration order.

If you need priority — "always prefer the audit branch when both are ready" — you must encode it explicitly. The idiom:

```go
// Priority: try outA first; if it would block, fall through to select.
select {
case <-done:
    return
case outA <- v:
    // delivered to A first
default:
    // A would block; fair race for who gets it first
    select {
    case <-done:
        return
    case outA <- v:
    case outB <- v:
    }
}
```

This form gives `outA` a head start when it is ready, while still preventing the goroutine from blocking on a slow `outA` if `outB` is also ready. The asymmetry is documented and intentional.

A subtler fairness concern: if one consumer is *always* faster, the symmetric tee will tend to deliver to it first in each iteration. The second send then waits for the slower consumer. Over time, the system reaches steady state at the slower consumer's rate. There is no bias accumulating against either branch; the only "bias" is that both branches are always served, in some order, before the next value is read.

---

## Tee Under High Throughput

Channel operations in Go cost on the order of 50–100 ns each on commodity x86_64 hardware. A symmetric tee performs:

- 1 receive from `in`
- 2 sends (one per output), each going through `selectgo`

Add scheduling overhead and goroutine wake-up costs. A realistic budget is **150–250 ns per value** for the tee itself, end-to-end, when both consumers are CPU-bound and ready. That is roughly **4–6 million values/sec** through a single tee, with one CPU core dedicated to the tee goroutine and one to each consumer.

Bottlenecks at higher rates:

1. **Goroutine wake-up storms.** Every send wakes the consumer goroutine. If consumers re-park immediately (because their next operation also blocks), you incur two scheduler transitions per value.
2. **Cache line bouncing.** A channel's `hchan` struct lives in one cache line; sender and receiver write to the same lines. Under heavy contention this becomes a memory-system bottleneck.
3. **GC pressure from payload values.** Tee allocates nothing per value, but the channel runtime copies the value twice (once in, once out times two outputs = three copies). For 4 KB payloads at 1 M/sec you are moving 12 GB/sec of bytes — measurable.

Mitigations:

- **Buffer aggressively for batch-oriented pipelines.** A 1024-deep buffer turns each operation into an amortised lock acquisition rather than a per-value scheduler transition.
- **Send pointers, not values, for payloads larger than a cache line.** Trade aliasing risk for throughput.
- **Place the tee on a dedicated `runtime.LockOSThread()` goroutine** if you need predictable latency under load. Rarely needed; verify with `pprof` first.
- **Replace tee with a lock-free ring fanout when throughput exceeds 10 M/sec.** See the next section.

A 4 M/sec tee is more than sufficient for almost every workload short of a market-data fanout or a network packet capture pipeline.

---

## Lock-Free Multi-Output Variants

Past a few million events per second, the channel-based tee hits its ceiling. The alternative is a single producer, multiple consumer (SPMC) ring buffer where each consumer maintains its own read cursor.

```text
+----------------+
|     ring       |   producer writes monotonically
|  [.][.][.][.] |   producers' write cursor: W
+----------------+
       ^   ^
       |   |
       A   B    consumers' read cursors RA, RB
                each consumer reads independently
                slowest consumer determines when W
                can wrap and reclaim slots
```

Sketch:

```go
type Ring[T any] struct {
    buf    []T
    mask   uint64
    w      atomic.Uint64
    ra, rb atomic.Uint64
}

func (r *Ring[T]) Publish(v T) {
    // Wait until slowest consumer has caught up to within capacity.
    for {
        wpos := r.w.Load()
        slow := min(r.ra.Load(), r.rb.Load())
        if wpos-slow < uint64(len(r.buf)) {
            r.buf[wpos&r.mask] = v
            r.w.Store(wpos + 1)
            return
        }
        runtime.Gosched()
    }
}

func (r *Ring[T]) ConsumeA() (T, bool) {
    for {
        pos := r.ra.Load()
        if pos < r.w.Load() {
            v := r.buf[pos&r.mask]
            r.ra.Store(pos + 1)
            return v, true
        }
        return *new(T), false
    }
}
```

Properties:

- Throughput is bounded by atomic counter writes (~5 ns) and a single load, often above 100 M/sec on modern CPUs.
- Backpressure is naturally preserved: the producer waits for the slowest consumer.
- Each new consumer adds one atomic counter; no goroutine hop on the hot path.
- Memory: `O(capacity * sizeof(T))`, fixed at startup.

Caveats:

- Spin-waiting wastes CPU; use exponential backoff or `runtime.Gosched()` between spins.
- Cancellation is awkward; you typically add a sentinel value or a separate done flag.
- Wrong size = problems. Power-of-two `len(buf)` enables fast masking.
- For mixed-pace consumers a small SPMC ring is *worse* than tee because the fast consumer spins on `w.Load()` after every read.

This is library-level work. Crank's `disruptor-go` and `smallnest/ringbuffer` implement variants. Use only if you have measured channel-based tee as the bottleneck. Otherwise the operational simplicity of channels beats the throughput of a ring.

---

## Tee in a Streaming System

Tee fits into Go-internal pipelines naturally. Tee across *distributed* systems requires a different vocabulary:

- **Kafka with two consumer groups** is the canonical distributed tee. Group A and group B each see every message. Throughput, durability, and per-consumer-group offset tracking come for free. The Go-side tee at most copies one local stream into both groups' producers.
- **NATS subjects with multiple subscribers** are similar but in-memory.
- **AWS Kinesis fanout** lets multiple stream consumers read the same shard.

When tee straddles the local/distributed boundary, the Go-side tee usually feeds a write to a broker:

```go
toKafka, toIndex := Tee(ctx, events)
g.Go(func() error { return shipToKafka(ctx, toKafka) })
g.Go(func() error { return updateIndex(ctx, toIndex) })
```

The tee goroutine is local; the actual duplication of work across machines happens downstream via the broker's own fanout. This is the canonical hybrid pattern.

Failure modes specific to the hybrid:

- **Kafka write blocks.** Producer librdkafka may apply backpressure; the tee's `outA` send blocks; symmetric tee then blocks `outB`. If the index branch must proceed during Kafka outages, you need the lossy asymmetric variant on the Kafka branch with monitoring.
- **Index falls behind Kafka.** Same shape, reversed.
- **Both branches partition independently.** Allowed by tee; ensure the consumer side handles out-of-order delivery if your business contract requires synchronised state.

---

## Exactly-Once vs At-Least-Once Semantics

Tee is at-least-once on `in` close; at-most-once-per-output on `done` cancellation. Let us unpack:

### Clean shutdown (close `in`)

The `for v := range in` loop drains every value. For each value, the inner loop iterates exactly twice, delivering to both outputs. **Both outputs receive exactly the same number of values as `in` sent. No duplication, no loss.**

### Cancellation (close `done`)

If the inner loop is between sends when `done` fires:

- 0 sends done so far: neither output receives `v`. Outputs are equal in count.
- 1 send done: `outA` received `v`; `outB` did not. Outputs differ by 1.
- 2 sends done: both received `v`; the loop already exited normally.

So **cancellation may produce a one-value discrepancy** between outputs. This matters for some consumers:

- A consumer that just logs values does not care.
- A consumer that maintains an aggregate (count, sum) sees a 1-off skew if checked precisely at shutdown.
- A consumer that does idempotent upsert into a database does not care.
- A consumer that does non-idempotent writes (append-only log) is at risk if the producer is restarted and replays — but the issue then is replay, not tee.

To eliminate the skew, defer cancellation until `in` is drained:

```go
func DrainThenCancel[T any](src <-chan T) (
    in <-chan T, cancel func(),
) {
    out := make(chan T)
    done := make(chan struct{})
    cancelOnce := sync.OnceFunc(func() { close(done) })

    go func() {
        defer close(out)
        for {
            select {
            case <-done:
                return
            case v, ok := <-src:
                if !ok {
                    return
                }
                select {
                case <-done:
                    return
                case out <- v:
                }
            }
        }
    }()
    return out, cancelOnce
}
```

The point: tee's cancellation contract is correct for the common case (drop in-flight is acceptable). When it is not, you wrap the input with a stage that delays cancellation.

---

## Observability and Drop Accounting

A tee in production should be visible. Suggested instrumentation:

- **Counters**: `tee.in.values`, `tee.out_a.values`, `tee.out_b.values`. In a strict tee, all three should match within one value (the difference is in-flight). A persistent drift on one output is a sign of a stuck consumer.
- **Counter**: `tee.dropped` if using the lossy variant. Alert on rate, not absolute count.
- **Gauge**: `tee.buffer_a.depth`, `tee.buffer_b.depth` for buffered variants. Rising depth means the consumer is falling behind.
- **Histogram**: `tee.deliver_latency_seconds` measuring time from receive on `in` to second successful send. Tail latency here equals the slow consumer's pacing.

Implementation note: do not measure inside the tee body if you care about performance. Sample (1-in-N) or measure end-to-end via consumer-side timestamps embedded in payloads.

For Prometheus, register the metrics at startup and update them inside the tee goroutine via local atomics that are batch-flushed every N values to reduce contention.

---

## Choosing Between Tee, Hub, and Ring Buffer Fanout

Practical decision table:

| Property | Tee | Hub | SPMC ring |
|----------|-----|-----|-----------|
| N (consumers) | 2 | any | any |
| Dynamic subscribe | no | yes | usually no |
| Per-consumer overflow policy | manual via variant | yes | manual |
| Throughput ceiling | ~5 M/sec | ~2 M/sec | 50+ M/sec |
| Lock-free | yes | no (RWMutex) | yes |
| Code size | ~15 lines | ~200 lines | ~100 lines + atomics |
| Operability | excellent | good | requires care |

Decision flow:

1. N=2 and N is fixed → **tee**.
2. N=3 and rare to grow → **chained tee** (2 tees, depth 1).
3. N variable, subscribers come and go → **hub**.
4. Throughput exceeds 5 M/sec → **SPMC ring**, only after measurement.

The choice is rarely tee vs hub on first principles; it is "we built tee, it now needs to grow, do we extend or rewrite?" Tee is so cheap that extending is usually fine; you only rewrite once the dynamism or throughput pressures justify the operational complexity of a hub.

Cross-reference: [`05-concurrency-patterns/06-broadcast-pattern/senior.md`](../../05-concurrency-patterns/06-broadcast-pattern/senior.md) covers the sharded hub implementation.

---

## Production Failure Modes

A non-exhaustive list of how tee misbehaves in production, in rough order of frequency:

### 1. One consumer leaks goroutines, slows over time, eventually stalls everything

Symptom: latency on a different service goes up. Cause: a downstream service paged on tee slowness blocks both branches. Fix: lossy asymmetric tee on the suspect branch, with drop counter and alerts. Capacity-plan based on burst, not steady-state.

### 2. Producer cancels via context but consumers never see EOF

Cause: tee's goroutine exited on `ctx.Done()` but its `defer close(out1)` does not run because the producer goroutine panicked. Fix: install `recover` in the producer that closes its own output channel before crashing; tee will see `range in` exit and close cleanly.

### 3. Memory grows unboundedly

Cause: buffered tee with a buffer too large; consumer permanently slower than producer. Fix: shrink buffer; switch to lossy if the slow consumer is acceptable to drop from; otherwise re-architect the slow consumer.

### 4. Inconsistent value counts between two sinks

Cause: cancellation mid-flight, or the lossy variant in use without monitoring. Fix: drain-on-shutdown wrapper; ensure cancellation only fires after `in` is closed.

### 5. Tee goroutine pinned to one core under load

Cause: heavy tee on a single goroutine processing 5 M/sec; that goroutine is the bottleneck. Fix: shard the input across multiple tees by hash, or move to SPMC ring.

### 6. `panic: send on closed channel` inside tee

Cause: someone outside cast the directional output back to bidirectional and closed it. Fix: do not do that. Audit channel types.

### 7. Deadlock at shutdown

Cause: shutdown sequence closes `done` then waits for consumers, but consumers wait for EOF on outputs that only close once the tee goroutine exits, which is blocked on a send because there is no buffer and `<-done` is selected against an already-in-progress send. (Rare; modern tee implementations defer close before any send.) Fix: ensure `defer close(...)` is the first line in the goroutine body.

---

## Composing Tee With Other Combinators at Scale

In a large pipeline, tee rarely stands alone. Senior-level skill is recognising the natural compositions and the load they put on the runtime.

### Tee + orDone on consumers

```go
a, b := Tee(done, in)
for v := range orDone(done, a) { /* consume A */ }
```

`orDone` adds one goroutine per call. In a pipeline with 10 tees and 20 consumers, the goroutine count is 10 (tees) + 20 (orDones) + 20 (consumers) = 50, plus the producer chain. This is fine. The point is to know the order of magnitude so you can spot leaks.

### Tee + errgroup

Each `g.Go(...)` is one goroutine. Tee's internal goroutine is separate (it does not return an error). Lifecycle is governed by the context. Cancellation flows from any error to all goroutines via the shared ctx. The combination is idiomatic and operationally clean.

### Tee + bridge

`bridge` (the next combinator in this directory) flattens a `chan chan T` into a `chan T`. Composing tee after bridge is natural for pipelines that have sub-streams per partition. Memory and goroutine cost are additive.

### Tee + rate-limiter

If you place a rate limiter on one branch, that branch becomes the slow one and paces the producer. Tee + rate-limiter is the right pattern for "log every event but only ship 100/sec to the slow sink." The rate-limited branch effectively becomes the lossy variant via the limiter's drop policy.

---

## Memory Behaviour Under Sustained Load

A tee in steady state has constant memory: one goroutine stack (2-8 KB), two channels (a few hundred bytes), plus whatever the buffer holds (`buf * sizeof(T)`). No allocations per value.

Under burst load, what can grow:

- The output channel buffer, up to its capacity.
- Each consumer's downstream state.
- Goroutine stacks of consumers, if they recurse deeply.

The tee itself does not grow. If your process memory grows when tee is in the path, the cause is downstream. Use `pprof heap` to confirm; the tee's bytes should be negligible.

GC interaction:

- Values transiting tee are short-lived. They allocate (if at all) in the producer, transit two channels, and become garbage in the consumer.
- For pointer payloads, the lifetime is bounded by the slowest consumer. A slow consumer that pins many large values delays GC of those objects.
- A buffered tee holds references to buffered values until consumed; large buffers + large payloads = sustained memory.

Tune `GOGC` and `GOMEMLIMIT` based on the slowest-consumer-bound working set, not on tee itself.

---

## Race Conditions to Watch For

Tee is mutex-free, so the obvious race conditions don't apply. The subtle ones:

### Aliased payload mutation

Both consumers receive the same pointer or slice header. If one mutates, the other observes. `go test -race` catches concurrent writes but not the design-level race of "we both expected to own this object."

### External close of an output

If a misbehaving caller closes an output channel from outside, the next send from inside tee panics. `-race` won't catch this; it is a data-flow bug, not a memory race.

### Done channel closed twice

Closing a closed channel panics. If multiple goroutines call `close(done)`, you need `sync.Once`:

```go
var once sync.Once
shutdown := func() { once.Do(func() { close(done) }) }
```

`-race` will not catch double-close until it actually happens at runtime.

### Subscriber/output mismatch

A consumer reading from `a` while another reads from `b` is fine. A consumer that *occasionally* drains from `a` and *occasionally* from `b` (e.g., a unified select) does not break tee, but does change the semantics: each value's "first" delivery is now ambiguous from the consumer's perspective.

---

## Tee in Long-Running Daemons

Many tee uses are in services that run for months. Long-tail concerns:

- **Goroutine leak.** A tee goroutine leaked at startup is invisible until the process is restarted. Periodic goroutine-count check is a useful canary.
- **Memory creep.** A buffered tee whose consumer is gradually slower over time accumulates memory at the rate of the consumer's lag. If lag is bounded, fine; if not, OOM eventually.
- **Cancellation forgotten.** A tee whose `done` is never closed and whose `in` never closes runs forever. Wire `done` to `signal.Notify`-driven shutdown.
- **`runtime.GC` and pacer.** Heavy tee throughput drives short-lived allocations through the GC; tuning `GOGC` may help.
- **Profiling under load.** `pprof` itself adds load. In hot paths, sample sparingly.

A daemon with a healthy tee shows:
- Constant goroutine count over time.
- Constant memory after warmup.
- Throughput matching the slowest consumer.
- No "send on closed channel" panics in logs.

If any of these drift, investigate.

---

## Summary

Senior-level tee is the same fifteen lines you wrote at junior, plus everything you learned about how the runtime executes them and what happens when production traffic exposes their bounds.

The key insights:

- The nil-channel trick is not magic; it is a documented runtime feature with one-pointer-write cost.
- `select` fairness is uniform but unpredictable per-value; deterministic priority requires explicit `default`-fallthrough.
- Tee tops out around 5 M/sec on commodity hardware; past that, SPMC rings or a sharded hub are better tools.
- Cancellation is at-most-once on each output; if exactness matters, wrap the input to drain before cancelling.
- Composition with `orDone`, `errgroup`, and `bridge` is additive in goroutines and natural in semantics.
- Memory is constant in time for the tee itself; growth is always downstream.
- Observability is the difference between "tee works in dev" and "tee is operable in prod" — instrument it.

Tee is not a deep pattern. It is a tiny composition of primitives. Senior mastery is about knowing exactly which primitive limits exactly which production scenario, and reaching for the right alternative without overshooting.
