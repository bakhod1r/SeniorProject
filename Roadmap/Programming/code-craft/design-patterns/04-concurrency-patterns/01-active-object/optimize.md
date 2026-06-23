# Active Object — Optimization Walkthroughs

> Ten before/after optimizations for Active Objects, each with the problem, the
> change, why it's faster, and the trade-off. Read
> [professional.md](professional.md) first for the cost model and benchmark traps.

## Table of Contents

1. [Optimization 1: Bound the queue (correctness → also stops GC death)](#optimization-1-bound-the-queue)
2. [Optimization 2: Batch with `drainTo`](#optimization-2-batch-with-drainto)
3. [Optimization 3: Swap to an MPSC queue](#optimization-3-swap-to-an-mpsc-queue)
4. [Optimization 4: Stop blocking on every `get()`](#optimization-4-stop-blocking-on-every-get)
5. [Optimization 5: Shard the hot object](#optimization-5-shard-the-hot-object)
6. [Optimization 6: Amortize a fixed cost (one fsync per batch)](#optimization-6-amortize-a-fixed-cost)
7. [Optimization 7: Move blocking I/O off the AO thread](#optimization-7-move-blocking-io-off-the-ao-thread)
8. [Optimization 8: Dispatcher multiplexing (millions of AOs, few threads)](#optimization-8-dispatcher-multiplexing)
9. [Optimization 9: Reduce per-request allocation](#optimization-9-reduce-per-request-allocation)
10. [Optimization 10: Eliminate false sharing on queue indices](#optimization-10-eliminate-false-sharing)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Bound the queue

**Before / problem.** `newSingleThreadExecutor()` with fire-and-forget submits.
Under a load spike the unbounded `LinkedBlockingQueue` grows; the heap fills with
pending `FutureTask` nodes; GC pauses lengthen, then the JVM enters a death spiral
and OOMs. "Throughput" looked fine right up to the crash because enqueue is cheap.

**After.**
```java
new ThreadPoolExecutor(1, 1, 0, MILLISECONDS,
    new ArrayBlockingQueue<>(10_000),
    new ThreadPoolExecutor.AbortPolicy());
```

**Why faster / better.** Bounding caps memory, which keeps the live set small and GC
cheap. More importantly it forces `λ ≤ service rate` (Little's Law): producers feel
backpressure instead of feeding an infinite backlog, so latency stays flat instead of
growing unboundedly.

**Trade-off.** Producers now get rejected (or blocked) under overload — you must
handle that (retry, shed, degrade). That's the point: visible backpressure beats an
invisible memory bomb.

---

## Optimization 2: Batch with `drainTo`

**Before / problem.** The scheduler takes and processes one request per loop. Each
iteration pays fixed overhead (lock acquire/release, a method dispatch, possibly a
flush). At high request rates the fixed cost dominates.

**After.**
```java
List<Req> batch = new ArrayList<>(1024);
Req first = queue.take();            // block for at least one
batch.add(first);
queue.drainTo(batch, 1023);          // grab everything else ready, no extra blocking
for (Req r : batch) servant.apply(r);
```

**Why faster.** One lock acquisition and one loop overhead amortized across up to 1024
requests. Per-op fixed cost drops by ~1/B. Under burst load this is often a 2–10×
throughput win for cheap requests.

**Trade-off.** Slightly higher latency for the *first* request in an idle period
(none — `take` returns immediately) but the batch is built only from already-ready
items, so added latency is negligible. Bigger batches help throughput but increase
worst-case latency for the last item in a batch.

---

## Optimization 3: Swap to an MPSC queue

**Before / problem.** `LinkedBlockingQueue` uses two locks and allocates a node per
item; `ArrayBlockingQueue` uses one lock for both producers and the consumer. An
Active Object is **many producers, one consumer (MPSC)** — a general-purpose queue
makes producers contend with each other on a lock and with the consumer on the same
structure.

**After.** Use a lock-free MPSC queue (e.g. JCTools `MpscArrayQueue`, or a Disruptor
ring buffer): producers CAS a slot, the single consumer reads without locking at all.

**Why faster.** Eliminates consumer-side locking entirely and reduces producer
contention to a single CAS. Under high producer counts this can multiply throughput
and slash tail latency; the consumer never blocks on a lock it should own alone.

**Trade-off.** External dependency / more complex code; bounded ring requires a sizing
decision; you give up `BlockingQueue`'s convenient blocking semantics (you implement
park/backoff yourself).

---

## Optimization 4: Stop blocking on every `get()`

**Before / problem.**
```java
account.deposit(100).get();          // blocks the caller every time
account.withdraw(40).get();          // ...serializing caller + AO again
```
The pattern's whole benefit — submit-and-continue — is thrown away. The caller pays
queue overhead *and* round-trip latency, effectively turning the Active Object into a
slow synchronous call.

**After.** Fire requests, collect futures, await once at the end — or compose with
`CompletableFuture`:
```java
List<Future<?>> fs = new ArrayList<>();
fs.add(account.deposit(100));
fs.add(account.withdraw(40));
for (var f : fs) f.get();            // one barrier, not N round trips
```

**Why faster.** Requests pipeline through the queue back-to-back; the caller overlaps
its own work with the AO's execution instead of ping-ponging. Latency hidden, not
added.

**Trade-off.** Code that needs each result immediately can't pipeline — but most
mutators don't. Reserve blocking `get()` for genuine data dependencies.

---

## Optimization 5: Shard the hot object

**Before / problem.** One Active Object owns the whole keyspace. One core is pinned at
100%; the other 7 sit idle. The single thread is the throughput ceiling.

**After.** N single-thread Active Objects, each owning `floorMod(key.hashCode(), N)`.
```java
int s = Math.floorMod(key.hashCode(), shards.length);
return shards[s].submit(() -> servants[s].op(key));
```

**Why faster.** Disjoint keys now run in parallel across N cores — near-linear scaling
for uniform key distributions. You broke the single-thread ceiling by partitioning,
not by adding threads to one servant (which would be a data race).

**Trade-off.** Cross-key operations lose the global serialization and now need a saga
or coordinator. Hot-key skew (one dominant key) still bottlenecks on one shard. Stable
affinity is mandatory.

---

## Optimization 6: Amortize a fixed cost

**Before / problem.** A durable log Active Object `fsync`s after every write. An fsync
is ~1 ms, so the object caps at ~1000 writes/s regardless of CPU.

**After.** Batch (Opt 2) and fsync **once per batch**:
```java
for (WriteReq r : batch) servant.append(r);   // in-memory
servant.fsync();                               // ONE flush for the whole batch
for (WriteReq r : batch) r.future.complete(null);
```

**Why faster.** Per-op durability cost becomes `fsync_time / B`. Batch 1000 writes per
fsync → ~1,000,000 writes/s at the same durability guarantee. This single change is
often a **100–1000×** win — it's why every serious write-ahead log uses single-writer
+ group commit.

**Trade-off.** A write isn't durable until its batch's fsync completes, so worst-case
durability latency rises to the batch interval. Group commit trades a little latency
for enormous throughput.

---

## Optimization 7: Move blocking I/O off the AO thread

**Before / problem.** A 500 ms HTTP call runs on the single AO thread; every queued
request stalls behind it (head-of-line blocking). p99 latency explodes.

**After.** Do only the in-memory state change on the AO thread; offload I/O to an
async client / separate pool; stitch with a future:
```java
toCF(ao.submit(() -> { servant.update(r); return r.url(); }))
    .thenCompose(httpClient::getAsync);     // I/O off the serialization thread
```

**Why faster.** The AO thread spends microseconds (state mutation) instead of
milliseconds (I/O), so queue residence time and tail latency collapse. The one
serialization thread is no longer the place slow operations sit.

**Trade-off.** More moving parts (a second executor / async client) and you must
reason about ordering between the fast AO step and the async I/O completion.

---

## Optimization 8: Dispatcher multiplexing

**Before / problem.** One OS thread per Active Object. With 100k Active Objects that's
100k threads — far more than cores, drowning in context switches and stack memory.

**After.** A small dispatcher pool (e.g. 2× cores). Each Active Object's mailbox is
scheduled onto *one* dispatcher thread at a time; it drains a bounded batch, then
yields so others get a turn. (This is how Akka runs millions of actors on a few
threads; Go's runtime does the equivalent for goroutines.)

**Why faster.** Threads ≈ cores → minimal context-switching and stack overhead, while
the per-Active-Object single-thread guarantee is preserved (at most one dispatcher
runs a given AO at once).

**Trade-off.** A throughput knob to tune (messages per scheduling turn): too small =
overhead, too large = fairness/latency problems. Implementation complexity rises;
prefer an existing actor runtime over hand-rolling.

---

## Optimization 9: Reduce per-request allocation

**Before / problem.** Every call allocates a lambda capture, a `FutureTask`, and (for
`LinkedBlockingQueue`) a queue node. At millions of ops/s this is GC pressure that
shows up as allocation-rate-driven young-GC churn.

**After.** Use an array-backed queue (no per-item node), reuse request objects via a
pool or a pre-sized ring (Disruptor pre-allocates slots), and prefer method references
over capturing lambdas where the capture is the only allocation.

**Why faster.** Lower allocation rate → fewer/shorter young GCs → less CPU stolen from
the consumer and lower tail latency. Pre-allocated ring slots can reach near-zero
steady-state allocation.

**Trade-off.** Object pooling adds complexity and footguns (reuse-before-done bugs);
only worth it on a proven hot path. Measure allocation rate first — don't pool
speculatively.

---

## Optimization 10: Eliminate false sharing

**Before / problem.** The queue's producer counter, head index, and tail index sit on
the same cache line. Producers (many cores) and the consumer (one core) write
different fields but share the line, so it ping-pongs between caches — every write
invalidates the others' copies.

**After.** Pad hot fields onto separate cache lines (`@jdk.internal.vm.annotation.
Contended`, or manual padding; the Disruptor and JCTools do this). Keep producer-side
and consumer-side indices on distinct lines.

**Why faster.** Each core mutates its own cache line without invalidating others →
fewer coherence transactions, lower latency under high core counts. On a 16-core box
this can be a large tail-latency win for a contended queue.

**Trade-off.** Wastes some cache/memory (padding) and is JVM/version-specific
(`@Contended` requires `-XX:-RestrictContended` or internal access). Only matters at
high producer-core counts; pointless on 2–4 cores.

---

## Optimization Tips

- **Profile before optimizing.** Use the cost model in
  [professional.md](professional.md#performance-queue-mechanics--contention): is your
  bottleneck enqueue contention, park/unpark, servant work, or GC? Each points to a
  different optimization above.
- **Correctness optimizations come first.** Bounding the queue (Opt 1) isn't really
  "performance" — it's survival — but it also fixes the GC death spiral, so do it
  before anything else.
- **The two biggest wins are usually Opt 5 (shard) and Opt 6 (batch/amortize).**
  Sharding breaks the parallelism ceiling; batching kills fixed per-op costs. Reach
  for these before micro-tuning queues.
- **Don't benchmark with blocking `get()` or an unbounded queue** — those traps make
  Active Object look slower (or faster) than it is. See
  [professional.md → Microbenchmark Anatomy](professional.md#microbenchmark-anatomy).
- **Match the queue to the access pattern.** Active Object is MPSC; a queue tuned for
  MPSC (Opt 3) beats a general one. This is often the cheapest big win after bounding.
- **Mind the latency/throughput trade.** Batching and group commit (Opt 2, 6) raise
  throughput by adding a little latency. Make that trade deliberately, against your
  SLO — don't batch a latency-critical path blindly.
- **Stop optimizing one Active Object when you should be sharding.** If a single
  object is your ceiling, no queue tweak saves you — partition the state (Opt 5).
