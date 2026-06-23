---
layout: default
title: Professional
parent: Batching
grand_parent: Production Patterns
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/03-batching/professional/
---

# Batching — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Internals of Go Channels and Batchers](#internals-of-go-channels-and-batchers)
3. [Ring Buffers and Lock-Free Accumulators](#ring-buffers-and-lock-free-accumulators)
4. [NUMA-Aware Batching](#numa-aware-batching)
5. [The Kafka Producer Internals](#the-kafka-producer-internals)
6. [The Postgres COPY Protocol](#the-postgres-copy-protocol)
7. [The librdkafka Buffer Pool](#the-librdkafka-buffer-pool)
8. [Memory Allocation Patterns](#memory-allocation-patterns)
9. [CPU Cache Behavior](#cpu-cache-behavior)
10. [Profiling a Batcher](#profiling-a-batcher)
11. [Persistent Buffers](#persistent-buffers)
12. [Group Commit and WAL Batching](#group-commit-and-wal-batching)
13. [io_uring and Modern I/O Batching](#io_uring-and-modern-io-batching)
14. [Building a Lock-Free Batcher](#building-a-lock-free-batcher)
15. [Benchmarking Methodology](#benchmarking-methodology)
16. [Frontier Research](#frontier-research)
17. [Summary](#summary)

---

## Introduction

Senior batching is about architecture. Professional batching is about internals: how do channels work in Go's runtime, what does the Kafka producer actually do, why does Postgres COPY out-perform multi-row INSERT by 10x, when does NUMA awareness matter, what does a lock-free MPMC queue buy you?

This file dives deep. It assumes you have:

- Built and shipped a production batcher.
- Used pprof and traced GC behaviour.
- Read at least one of: Go runtime source, Linux kernel network stack, Postgres internals.
- Comfortable with assembler-level reasoning when needed.

If those do not describe you, the senior file is the right level. Come back here when you want to understand *why* the layers below behave the way they do.

After this file you will:

- Know what `make(chan T, n)` allocates, how send and receive interact with the runtime scheduler, and what bottlenecks emerge at extreme scale.
- Be able to implement a lock-free MPMC ring buffer batcher and reason about its correctness.
- Understand NUMA effects on accumulators and when CPU pinning helps.
- Know what Kafka's `linger.ms` and `batch.size` parameters do internally and what the producer does between user code and the broker.
- Understand Postgres' COPY protocol and why it bypasses parser overhead.
- Profile a batcher down to the function call and the allocation.
- Discuss persistent buffers and write-ahead logs.

---

## Internals of Go Channels and Batchers

A Go channel is a small struct (`runtime.hchan`) with a buffer, a lock, a pair of wait queues (senders and receivers), and metadata. When you `make(chan T, n)`:

1. The runtime allocates an `hchan` struct plus space for `n` elements.
2. The `dataqsiz` field is set to `n`.
3. The `closed` flag is 0.
4. The wait queues are empty.

A send (`ch <- v`) does:

1. Lock `hchan.lock`.
2. Check if a receiver is waiting. If yes, copy directly to the receiver's stack and unblock it.
3. Otherwise, if buffer has space, copy into the buffer and increment `sendx`.
4. Otherwise, block: enqueue this goroutine on the senders' wait queue, park.
5. Unlock.

A receive is the mirror image.

For a batcher, the send is on the hot path. The interesting cases:

- **Buffer not full, no receiver waiting**: send copies to buffer, ~50 ns. Common in steady state.
- **Buffer full, receiver waiting**: send copies directly to receiver, ~70 ns (direct hand-off).
- **Buffer full, no receiver**: send blocks. Park the goroutine, schedule another. ~1 µs of overhead plus wait time.

The runtime's `chansend` and `chanrecv` are in `runtime/chan.go`. Reading these (~500 lines) gives you the floor on channel performance.

### Implications for Batchers

- Steady-state channel cost: ~100 ns per send-receive pair.
- Channel lock contention: under heavy load (many producers), the lock is held briefly but frequently. At 10M sends/s, the lock is taken 10M times.
- The lock is per-channel. Multiple channels are independent.

### When Channels Bottleneck

Roughly 10M sends/s is the channel ceiling on a single channel on modern hardware. Beyond that, lock contention dominates. Solutions:

- **Sharded channels**: hash producer to one of N channels, each with its own consumer.
- **Lock-free queue**: replace `chan T` with a lock-free MPMC queue (CAS-based).
- **Per-CPU channels**: one channel per goroutine, scheduled to one CPU.

For 99.9% of batchers, channels are not the bottleneck. The sink is.

## Ring Buffers and Lock-Free Accumulators

A ring buffer is a fixed-size circular array with head and tail pointers. The classic data structure for high-throughput queues.

### Single-Producer, Single-Consumer (SPSC)

```go
type SPSCRing[T any] struct {
    buf  []T
    head atomic.Uint64
    tail atomic.Uint64
}

func (r *SPSCRing[T]) Push(v T) bool {
    h := r.head.Load()
    t := r.tail.Load()
    if h-t >= uint64(len(r.buf)) {
        return false // full
    }
    r.buf[h%uint64(len(r.buf))] = v
    r.head.Store(h + 1)
    return true
}

func (r *SPSCRing[T]) Pop() (T, bool) {
    var zero T
    t := r.tail.Load()
    h := r.head.Load()
    if t == h {
        return zero, false // empty
    }
    v := r.buf[t%uint64(len(r.buf))]
    r.tail.Store(t + 1)
    return v, true
}
```

Lock-free, ~5 ns per op. Limit: one producer, one consumer.

### MPMC

Multi-producer, multi-consumer ring buffers are harder. Vyukov's MPMC ring buffer is a standard. Each slot has a sequence number; producers CAS the sequence to claim a slot; consumers CAS to release.

Implementation is ~30 lines of subtle code. Performance: ~20-50 ns per op.

For Go batchers, MPMC rings are rarely needed. Channels handle 10M ops/s, which covers almost everything.

### When to Reach for Lock-Free

- Channel contention measurable in profiles (>10% time in `runtime.chansend`).
- Trading systems or HFT (microseconds matter).
- Interfacing with C code that uses ring buffers.

For everything else: `chan T`.

### The Disruptor Pattern

LMAX's Disruptor is a ring buffer with batched producer/consumer barriers. It batches naturally: a consumer reads `[old_tail, new_head)` as a slice, not one item at a time. Many Java implementations; Go versions exist (`smallnest/queue`).

A Disruptor-style batcher would have the consumer read N items at a time directly from the ring, avoiding the slice copy. ~2x faster than channel for high throughput.

## NUMA-Aware Batching

On NUMA (Non-Uniform Memory Access) systems, accessing memory on a different socket is 2-3x slower than local. A multi-socket box has multiple NUMA nodes; goroutines that bounce between sockets pay this cost.

For batchers handling > 100K ops/s, NUMA effects can matter. Strategies:

- **Pin goroutines to a node**: `runtime.LockOSThread` + `sched_setaffinity`.
- **Per-node batchers**: one batcher per NUMA node; producers route to local.
- **Per-node memory pools**: `sync.Pool` is per-P, naturally somewhat NUMA-friendly.

Verify with `numactl --membind` and benchmarks. Often the speedup is 20-30%. Sometimes the code complexity isn't worth it.

For laptop or single-socket cloud VM, NUMA is irrelevant.

## The Kafka Producer Internals

A Kafka producer's life is more complex than "send a message". Internals:

### Per-Topic Per-Partition Buffer

The producer maintains a per-topic-partition buffer. Records are appended; the buffer is flushed when full (`batch.size`) or after `linger.ms`.

### Sender Thread

A separate thread (in Java; goroutine in Go clients) polls the buffer, builds produce requests, sends them.

### Compression

The buffer is compressed (gzip, snappy, zstd) before sending. Compression amortises the per-record header overhead.

### Acks

`acks=0`: producer doesn't wait. Fastest, no durability.
`acks=1`: leader acks after writing to local log. Default. Some durability.
`acks=all`: leader waits for replicas to ack. Strongest durability.

### Retries

`retries` and `retry.backoff.ms` control transient failures. Idempotence prevents duplicates via producer IDs.

### Putting It Together

```
Application: client.Produce(record)
  |
  v
Producer: append to partition buffer
  |
  v
Sender thread: poll buffers, build request when ready
  |
  v
Compression: compress batch
  |
  v
Network: send to broker
  |
  v
Broker: append to log, replicate, ack
  |
  v
Sender thread: invoke callback with success/failure
  |
  v
Application: callback fires
```

Notice: 4+ layers of batching/coordination between user code and durable storage. Each is tuned. If you write your own batcher in front of this, understand which of these you are duplicating.

### Reading librdkafka

`librdkafka` (the C library, also wrapped by `confluent-kafka-go`) has ~30K lines. The batching logic is in `rdkafka_partition.c` and `rdkafka_request.c`. Worth reading once.

## The Postgres COPY Protocol

Postgres has three insert paths:

1. INSERT (single row).
2. Multi-row INSERT (rows in one query).
3. COPY FROM (streaming bulk insert).

COPY is the fastest by 5-10x. Why?

### What INSERT Does

Each INSERT goes through:

- Parse SQL text.
- Plan the query.
- Execute: row by row, check constraints, write to heap, write to indexes.
- Generate WAL records.
- Commit (fsync WAL).

For 1000 rows, this is 1000 parse, 1000 plan, 1000 execute. With multi-row, it is 1 parse, 1 plan, 1000 execute.

### What COPY Does

COPY streams binary or text data through a dedicated protocol:

- One COPY FROM ... command sets up the stream.
- Rows arrive over the protocol as binary data.
- Server inserts directly into heap, bypassing parser.
- Constraint checks deferred until end (for non-deferred, checked per row but in tight loop).
- WAL written in larger chunks.

Result: per-row cost drops dramatically. A bulk insert of 1M rows takes 5 seconds via INSERT, 1 second via COPY.

### Binary vs Text Format

Binary format: rows encoded in Postgres' binary protocol. Smaller, faster to parse.
Text format: rows as tab-separated values. Easier to debug, slower.

Use binary for production batchers.

### pgx CopyFrom

`pgx.CopyFromRows` builds a binary stream from `[][]any` and sends it. Behind the scenes:

- Opens a COPY FROM session.
- Encodes each value using type-specific binary encoders.
- Streams chunks (default 65 KB) to the server.
- Closes the session.

The Go client is doing the protocol work; the server is doing the bulk insert work. Both sides have minimal per-row CPU compared to INSERT.

### Caveats

- COPY does not support ON CONFLICT.
- COPY does not return identifiers (no RETURNING).
- COPY locks tables differently (some metadata access is blocked during long COPY).

For idempotent inserts: temp table + INSERT SELECT ON CONFLICT. The COPY into the temp table is fast; the INSERT SELECT picks up.

## The librdkafka Buffer Pool

librdkafka uses a custom buffer pool to avoid allocation churn. Each record is wrapped in an `rd_kafka_msg_t`; the pool reuses these.

Reading `rdkafka_msg.c`: the pool is per-thread, with a fast path that avoids malloc. Allocation is amortised across millions of records.

For Go batchers: `sync.Pool` plays a similar role but is GC-aware (objects may be reclaimed). For raw speed, manual pools work too.

## Memory Allocation Patterns

A high-throughput batcher's allocations come from:

1. The item value itself (heap or stack).
2. The buffer slice (one alloc on first append; grows as needed).
3. The copy at flush time (`make + copy`).
4. The flushed batch's escape to the sink (often heap).
5. Serialisation (gzipping, marshalling).

To minimise allocations:

- Pre-allocate the buffer with full capacity.
- Use `sync.Pool` for flush slices.
- Use `*bytes.Buffer` from a pool for serialisation.
- Avoid `interface{}` and reflection in hot paths.
- Pre-allocate item structs in pools if pointer-shaped.

Profile with `-memprofile` to find the actual sources. Common surprises:

- Channel sends of large structs copy on every send. Use pointers.
- Closures capture variables; capture only what is needed.
- Logging (e.g., `log.Printf("%v", batch)`) can be a huge allocator.

## CPU Cache Behavior

A modern CPU has L1 (~32 KB), L2 (~256 KB), L3 (~8 MB) caches. Cache lines are 64 bytes.

For a batcher:

- The buffer slice header is 24 bytes (ptr, len, cap). Fits in one cache line.
- A batch of 1000 items at 100 bytes each is 100 KB — fits in L2.
- A batch of 1M items at 100 bytes each is 100 MB — exceeds L3, hits main memory.

Cache effects make small batches faster *per item* than huge batches. There is a "cache knee" at ~64 KB-ish batch size where staying in L2 is fast. Going beyond means main-memory bandwidth dominates.

For most batchers, the network and disk dominate, and cache effects are noise. For in-memory transforms (combiners), cache fit matters.

### False Sharing

Two atomic variables in the same cache line cause "false sharing": cache invalidation between cores even though the data is logically independent.

Fix: pad fields to cache-line boundaries. Go's `runtime.padding` package or manual `_ [56]byte` arrays after small atomics.

For a batcher's counters (enqueued, flushed_ok, etc), padding helps when these are read from many cores simultaneously. Usually negligible; check with profile.

## Profiling a Batcher

A real profiling session:

```go
// In main:
import _ "net/http/pprof"
go http.ListenAndServe("localhost:6060", nil)
```

Then:

```bash
# CPU profile, 30 seconds
go tool pprof -seconds=30 -http=:8080 localhost:6060/debug/pprof/profile

# Heap profile
go tool pprof -http=:8080 localhost:6060/debug/pprof/heap

# Goroutines
go tool pprof -http=:8080 localhost:6060/debug/pprof/goroutine
```

Look for:

- Top CPU consumers: should be sink-related (network, serialisation), not batcher overhead.
- Allocation hotspots: should be at flush boundaries (the `make + copy`), not per-item.
- Goroutine count: small and stable.

If CPU is in `runtime.chansend` more than the sink: contention; consider sharding.

If heap is dominated by item structs: items live too long; reduce buffer size or flush faster.

If goroutine count is growing: leak; investigate.

### Trace

`go tool trace` shows scheduling, GC, syscalls. Useful for understanding pause behaviour.

Capture:

```bash
curl localhost:6060/debug/pprof/trace?seconds=10 > trace.out
go tool trace trace.out
```

Look for: GC pauses correlated with flushes (item ref pressure), long syscalls (slow sink), scheduling gaps (blocked goroutines).

## Persistent Buffers

For high-value data, in-memory buffers risk loss on crash. Persistent buffers store items on disk before flushing to the downstream sink.

### Design

```
producer -> in-memory queue -> disk log (WAL) -> in-memory queue -> sink
```

The disk log is the durability boundary. Items committed to the log are durable; the sink flush is just a propagation step.

### Implementations

- **BadgerDB**: embedded key-value store with WAL semantics.
- **bbolt**: B-tree-based KV store.
- **Custom log file**: append-only, fsync on commit.

### Trade-Offs

- Pro: zero loss on crash (with synchronous fsync).
- Con: disk I/O cost; usually limits throughput to 10K-100K records/s.
- Con: state to manage (rotation, compaction, recovery).

For most application-level batchers, in-memory + upstream-replay is preferred. Persistent buffers are for edge cases (constrained networks, regulatory requirements).

### Vector and Fluent Bit

These telemetry shippers support disk buffers natively. Configuration: `disk.max_size`, `disk.directory`. The application sends events to the shipper (often via Unix socket); the shipper buffers, ships to the downstream. Crash recovery from the disk buffer.

## Group Commit and WAL Batching

Inside Postgres, MySQL, and other databases: group commit is a batching mechanism for WAL fsync.

### Postgres Group Commit

Parameters:

- `commit_delay`: how long to wait for siblings (microseconds).
- `commit_siblings`: minimum siblings before waiting.

When a transaction commits, it waits `commit_delay` if `commit_siblings` other transactions are in progress. The WAL fsync amortises across them.

Default: off (`commit_delay = 0`). For very write-heavy workloads, setting `commit_delay = 100-1000 µs` and `commit_siblings = 5` can improve throughput.

### MySQL Group Commit

Similar but tunable via `binlog_group_commit_sync_delay` and `innodb_flush_log_at_trx_commit`.

### The Pattern

Two layers of batching:

- App-level: batch INSERTs.
- DB-level: batch fsyncs.

Both contribute to throughput. Tuning the DB-level requires DBA knowledge.

## io_uring and Modern I/O Batching

Linux's `io_uring` (since 5.1, mature in 5.10+) lets applications submit batches of I/O operations to the kernel via a ring buffer.

For batchers:

- One `io_uring_submit` can carry many writes.
- Completion is signalled via a completion ring.
- Reduces syscalls dramatically.

Go libraries: `github.com/iceber/iouring-go`. Use cases: high-throughput log writers, custom databases.

Most batchers do not need io_uring. The bottleneck is upstream (sink latency), not syscall count. If profiling shows syscalls dominating, look at io_uring.

## Building a Lock-Free Batcher

For extreme throughput (>10M items/s), a lock-free batcher uses MPMC ring buffers.

```go
type LFBatcher[T any] struct {
    ring    *vyukov.MPMC[T]
    sink    Sink[T]
    maxSize int
    quit    atomic.Bool
}

func (b *LFBatcher[T]) Add(v T) bool { return b.ring.Enqueue(v) }

func (b *LFBatcher[T]) run() {
    buf := make([]T, 0, b.maxSize)
    for !b.quit.Load() {
        for len(buf) < b.maxSize {
            v, ok := b.ring.Dequeue()
            if !ok {
                break
            }
            buf = append(buf, v)
        }
        if len(buf) > 0 {
            _ = b.sink.Write(context.Background(), buf)
            buf = buf[:0]
        } else {
            runtime.Gosched()
        }
    }
}
```

Caveats:

- No time trigger (would require atomic timestamps).
- Spins if empty (consumes CPU). Real implementations adaptive-spin then park.
- Drop on overflow (no backpressure).

For 99.99% of Go batchers, channel-based is the right choice. Lock-free is for HFT and database internals.

## Benchmarking Methodology

Reliable benchmarks of batchers require:

### Warm Up

```go
for i := 0; i < 10000; i++ {
    b.Add(i)
}
// Discard timing of warm-up.
b.WaitForDrain()
```

### Steady State

Measure steady-state throughput, not startup:

```go
start := time.Now()
for i := 0; i < N; i++ {
    b.Add(i)
}
b.WaitForDrain()
elapsed := time.Since(start)
ops := float64(N) / elapsed.Seconds()
```

### Multiple Producers

Real load is multi-producer:

```go
var wg sync.WaitGroup
for w := 0; w < numWorkers; w++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        for i := 0; i < N/numWorkers; i++ {
            b.Add(Item{ID: id*1e9 + i})
        }
    }(w)
}
wg.Wait()
```

### GC Disabled

For peak measurements, disable GC:

```bash
GOGC=off go test -bench .
```

Note: this hides real-world GC pressure. Re-enable for production-realistic.

### Histogram, not Average

Latency: emit a histogram (use `hdrhistogram` library). The average lies; p99 tells truth.

### Multiple Runs

Run 10 times; report median. Single-run results are noise.

### Compare Apples to Apples

Batched vs unbatched must use the same sink, same hardware, same inputs.

## Frontier Research

Areas of active research:

- **Adaptive batch sizing with ML**: Bandit algorithms tune `MaxBatchSize` online.
- **Coalescing in service meshes**: Istio/Envoy can batch outbound calls; research on optimal policies.
- **Hierarchical batching**: Multi-level amortisation in disaggregated storage.
- **Persistent batchers with NVMe**: Trade RAM for SSD without losing throughput.
- **DPDK batching**: Userspace networking; bypasses kernel for ultra-low-latency.

For most engineers, today's tools are enough. Stay aware of frontier work for the next 5 years.

---

## A Real Distributed Pipeline Walkthrough

Imagine a service handling 1M events/s, sharded across 10 instances, writing to Kafka, then consumed and written to Postgres.

### Stage 1: HTTP Ingestion (10 instances)

Each instance:
- Receives 100K req/s.
- Validates payload.
- Batches into Kafka producer.
- Returns 202.

Per-instance: 10 cores, 1 batcher feeding Kafka.

### Stage 2: Kafka Brokers (3 brokers, 30 partitions)

Each broker:
- Accepts produce requests.
- Appends to partition logs.
- Replicates to 2 other brokers.
- Acks.

Produce throughput: 1M records/s across 30 partitions = 33K/s per partition.

### Stage 3: Consumer Service (5 instances)

Each instance:
- Consumes from 6 partitions.
- Decodes records.
- Batches into Postgres CopyFrom.

Per-instance: 200K events/s. Postgres can sustain this with CopyFrom (1M rows/s capacity).

### Stage 4: Postgres (1 primary, 2 replicas)

Primary handles all writes. Replicas serve reads.

Per-write: COPY of 1000 rows in ~20 ms. 50 batches/s = 50K rows/s. Below capacity.

### End-to-End Latency

- API ingress to Kafka: ~5 ms (batcher's MaxBatchDelay).
- Kafka produce to consume: ~50 ms (consumer poll interval).
- Consume to Postgres: ~50 ms (consumer batcher's MaxBatchDelay).
- Postgres COPY: ~20 ms.

End-to-end p99: ~200 ms. SLA: 500 ms. Comfortable.

### Failure Modes

- HTTP instance crash: Kafka has 7-day retention; events not lost. New instance picks up new traffic.
- Kafka broker crash: replicas continue; broker rejoins.
- Consumer instance crash: another consumer takes over the partitions.
- Postgres replica crash: failover via Patroni or similar.

Each layer's batching makes the system efficient; each layer's redundancy makes it reliable.

## A Real Distributed Pipeline Walkthrough (cont): Capacity Planning

### Estimated Resource Use

- HTTP ingestion: 10 instances * 10 cores = 100 cores; 100 GB RAM.
- Kafka: 3 brokers * 8 cores = 24 cores; 3 * 64 GB RAM.
- Consumer: 5 instances * 8 cores = 40 cores; 40 GB RAM.
- Postgres: 1 primary + 2 replicas * 32 cores = 96 cores; 3 * 256 GB RAM.

Total: 260 cores, 1.3 TB RAM. Cost: $2-5K/month on cloud.

Without batching, the same throughput would require 10-50x more compute. Batching is what makes this affordable.

## Inside Memcached: Multi-Get and Batching

Memcached supports `get k1 k2 k3 k4`. The server returns each value separately. The client batches keys to reduce round-trips.

Internally, the server processes each key independently but in one TCP message. Per-call cost amortised.

### Implications

If a batcher reads from Memcached, batch the get calls. ~10x speedup typical.

### Pipelined Get

Some clients use pipelined gets: send multiple `get k` commands without waiting for responses. The server processes in order; client matches responses.

Similar throughput to multi-get; different shape.

## Inside Redis Pipelining

Redis supports pipelining: send multiple commands in one packet; receive multiple responses.

```go
pipe := client.Pipeline()
pipe.Set(ctx, "k1", "v1", 0)
pipe.Set(ctx, "k2", "v2", 0)
cmds, _ := pipe.Exec(ctx)
```

Behind the scenes: one TCP write, one TCP read. Server processes each command; client matches responses to commands.

Throughput: 10-100x single-command.

### Use With Batcher

A Redis sink:

```go
func (s *RedisSink) Write(ctx context.Context, batch []Item) error {
    pipe := s.client.Pipeline()
    for _, item := range batch {
        pipe.Set(ctx, item.Key, item.Value, item.TTL)
    }
    _, err := pipe.Exec(ctx)
    return err
}
```

Pipelining + batching = max throughput for Redis sinks.

## Inside Cassandra Batching

Cassandra has `BEGIN BATCH ... APPLY BATCH` syntax. The driver sends multiple writes in one frame.

Unlike Postgres or Redis, Cassandra's batching is mostly latency-focused, not throughput. Large batches can stress the coordinator node.

Recommendation: small batches (5-100 statements) for related rows in the same partition. Larger across partitions is an anti-pattern.

## Inside DynamoDB BatchWriteItem

DynamoDB caps at 25 items per BatchWriteItem call. On partial success, some items are unprocessed; client retries them.

### Sink Wrapper

```go
func (s *DynamoSink) Write(ctx context.Context, batch []Item) error {
    for i := 0; i < len(batch); i += 25 {
        end := i + 25
        if end > len(batch) {
            end = len(batch)
        }
        // Build BatchWriteItem request from batch[i:end].
        // Handle UnprocessedItems by retrying.
    }
    return nil
}
```

Our batcher's `MaxBatchSize` should be a multiple of 25 (or 25 itself) to align.

## Inside BigQuery Streaming Inserts

BigQuery's `insertAll` accepts up to 500 rows per call (or 10 MB).

Throughput: 100K rows/s/table.

Idempotency: each row has an `insertId`; duplicates dropped.

### Sink Wrapper

```go
func (s *BQSink) Write(ctx context.Context, batch []Event) error {
    rows := make([]*bigquery.RowInserter, len(batch))
    // ... build rows ...
    return s.table.Inserter().Put(ctx, rows)
}
```

For high throughput: multiple inserters per table (BigQuery handles parallelism).

## A Closing Thought: The Discipline of Batching

After 5000 lines, what is the lesson?

Batching is one of the few "free" performance wins in software engineering. It is also one of the easiest to get wrong.

The discipline:
- Measure first. Profile. Find the per-call cost.
- Design deliberately. Both triggers. Bounded queue. Graceful shutdown.
- Observe rigorously. Four metrics, alerts, runbooks.
- Operate carefully. Drain on SIGTERM. Chaos test. Document.

A batcher is not a "set and forget" component. It evolves with the workload. Tuning is an ongoing conversation with the system.

Engineers who internalise this become the people their team consults when "the system is slow but I don't know why". The answer is, often, in how data flows from one component to another, and the batchers along the way.

## Reading Recommendations

For deeper study:

- "Designing Data-Intensive Applications" by Martin Kleppmann: data flow, batching, streaming.
- "Systems Performance" by Brendan Gregg: profiling, tracing, observability.
- The Go runtime source: `runtime/chan.go`, `runtime/proc.go`, `runtime/time.go`.
- LMAX Disruptor papers: lock-free queues.
- Postgres source: WAL, checkpoint, replication, query planner.
- Kafka source: producer, consumer, broker.
- The OpenTelemetry SDK source: production-grade batchers.
- Brendan Gregg's tools: flame graphs, profiling.

Read code more than blog posts. The truth is in the source.

## Detailed Failure Mode Analysis

For the production batcher above, let us enumerate failure modes.

### Failure: Sink returns transient error

Behavior: `flushFail` counter increments. The batch is logged but not retried.

Mitigation: wrap the Sink in a `RetryingSink` decorator.

### Failure: Sink panics

Behavior: the flushWorker goroutine dies. No `recover` in flushWorker. Pending and future batches are not flushed.

Mitigation: add `recover` in flushWorker:

```go
func (b *Batcher[T]) flushWorker(id int) {
    defer func() {
        if r := recover(); r != nil {
            b.cfg.Logger.Error("flush worker panic", "worker", id, "panic", r)
            // Restart self.
            go b.flushWorker(id)
        }
    }()
    for job := range b.flushReq { ... }
}
```

### Failure: Multiple flushWorkers panic

Behavior: all die; no flushes possible. `b.flushReq` fills; run loop blocks on handoff.

Mitigation: supervisor goroutine that restarts flushWorkers.

### Failure: `b.flushReq` fills

Behavior: run loop blocks on `b.flushReq <- job`. Producers' `Add` blocks on the input channel.

Mitigation: monitor `len(b.flushReq)`. Alert at 80%. The right answer is to scale flushers or fix the sink.

### Failure: Input channel `b.in` fills

Behavior: `Add` blocks (or returns `ctx.Err()` with timeout). Producers slowed.

Mitigation: alert on `queue_depth > 80%`. Investigate downstream.

### Failure: Shutdown timeout

Behavior: items in `b.in` and `buf` are lost; `flushReq` may have unsent batches; `droppedOnShutdown` counter does not capture all losses.

Mitigation: longer shutdown context; or accept the trade-off and document.

### Failure: Race in Add-during-shutdown

The double-check pattern in `Add` should handle it: `closeCh` check first, then send. But a sufficiently-quick race could still panic.

Mitigation: ensure orchestrator stops producers before calling Shutdown. The race exists but is bounded.

### Failure: GC pause during flush

Behavior: flush latency spikes. Other goroutines waited too. Producers see brief stall.

Mitigation: tune `GOMEMLIMIT`; profile and reduce allocations.

### Failure: Network partition

Behavior: sink calls time out. flushFail accumulates. eventually circuit breaker opens (if present).

Mitigation: circuit breaker + DLQ + retry strategy.

### Failure: Hard process kill (SIGKILL)

Behavior: everything in memory is gone. `b.in` items, `buf` items, in-flight batches, all lost.

Mitigation: upstream replay (Kafka with retention) or persistent buffer (disk WAL).

## A Detailed Walk-Through: Implementing the Complete Production Batcher

Putting everything from junior, middle, senior, and professional together. The final code:

```go
package batcher

import (
    "context"
    "errors"
    "log/slog"
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

var ErrClosed = errors.New("batcher: closed")

type Sink[T any] interface {
    Write(ctx context.Context, batch []T) error
}

type Config[T any] struct {
    Name          string
    MaxBatchSize  int
    MaxBatchDelay time.Duration
    QueueDepth    int
    FlushTimeout  time.Duration
    Flushers      int
    Sink          Sink[T]
    Logger        *slog.Logger
}

func (c *Config[T]) validate() error {
    if c.Sink == nil {
        return errors.New("batcher: Sink is required")
    }
    if c.MaxBatchSize <= 0 {
        return errors.New("batcher: MaxBatchSize must be positive")
    }
    if c.MaxBatchDelay <= 0 {
        return errors.New("batcher: MaxBatchDelay must be positive")
    }
    if c.QueueDepth <= 0 {
        c.QueueDepth = 1024
    }
    if c.FlushTimeout <= 0 {
        c.FlushTimeout = 5 * time.Second
    }
    if c.Flushers <= 0 {
        c.Flushers = 1
    }
    if c.Logger == nil {
        c.Logger = slog.Default()
    }
    return nil
}

type flushJob[T any] struct {
    batch  []T
    reason string
}

type Batcher[T any] struct {
    cfg       Config[T]
    in        chan T
    flushReq  chan flushJob[T]
    done      chan struct{}
    closeOnce sync.Once
    closeCh   chan struct{}
    pool      sync.Pool

    enqueued          atomic.Int64
    flushedOK         atomic.Int64
    flushedFail       atomic.Int64
    droppedOnShutdown atomic.Int64
}

func New[T any](cfg Config[T]) (*Batcher[T], error) {
    if err := cfg.validate(); err != nil {
        return nil, err
    }
    b := &Batcher[T]{
        cfg:      cfg,
        in:       make(chan T, cfg.QueueDepth),
        flushReq: make(chan flushJob[T], cfg.Flushers*2),
        done:     make(chan struct{}),
        closeCh:  make(chan struct{}),
        pool: sync.Pool{
            New: func() interface{} {
                s := make([]T, 0, cfg.MaxBatchSize)
                return &s
            },
        },
    }
    go b.run()
    for i := 0; i < cfg.Flushers; i++ {
        go b.flushWorker(i)
    }
    return b, nil
}

func (b *Batcher[T]) Add(ctx context.Context, item T) error {
    select {
    case <-b.closeCh:
        return ErrClosed
    default:
    }
    select {
    case b.in <- item:
        b.enqueued.Add(1)
        return nil
    case <-ctx.Done():
        return ctx.Err()
    case <-b.closeCh:
        return ErrClosed
    }
}

func (b *Batcher[T]) TryAdd(item T) bool {
    select {
    case <-b.closeCh:
        return false
    default:
    }
    select {
    case b.in <- item:
        b.enqueued.Add(1)
        return true
    default:
        return false
    }
}

func (b *Batcher[T]) run() {
    defer func() {
        if r := recover(); r != nil {
            b.cfg.Logger.Error("batcher run loop panic", "panic", r)
        }
        close(b.flushReq)
    }()

    buf := make([]T, 0, b.cfg.MaxBatchSize)
    var timer *time.Timer
    var timerC <-chan time.Time

    handoff := func(reason string) {
        if len(buf) == 0 {
            return
        }
        ptr := b.pool.Get().(*[]T)
        batch := (*ptr)[:0]
        batch = append(batch, buf...)
        select {
        case b.flushReq <- flushJob[T]{batch: batch, reason: reason}:
        case <-b.closeCh:
            // Drop on close-during-handoff; should be rare.
        }
        buf = buf[:0]
        if timer != nil {
            timer.Stop()
            timer = nil
            timerC = nil
        }
    }

    armTimer := func() {
        if timer == nil {
            timer = time.NewTimer(b.cfg.MaxBatchDelay)
            timerC = timer.C
        }
    }

    for {
        select {
        case item, ok := <-b.in:
            if !ok {
                handoff("shutdown")
                b.droppedOnShutdown.Add(int64(len(buf)))
                return
            }
            buf = append(buf, item)
            if len(buf) == 1 {
                armTimer()
            }
            if len(buf) >= b.cfg.MaxBatchSize {
                handoff("size")
            }
        case <-timerC:
            handoff("time")
        }
    }
}

func (b *Batcher[T]) flushWorker(id int) {
    for job := range b.flushReq {
        ctx, cancel := context.WithTimeout(context.Background(), b.cfg.FlushTimeout)
        err := b.cfg.Sink.Write(ctx, job.batch)
        cancel()
        if err != nil {
            b.flushedFail.Add(int64(len(job.batch)))
            b.cfg.Logger.Error("flush failed", "worker", id, "size", len(job.batch), "reason", job.reason, "err", err)
        } else {
            b.flushedOK.Add(int64(len(job.batch)))
        }
        // Return slice to pool.
        job.batch = job.batch[:0]
        b.pool.Put(&job.batch)
    }
    close(b.done)
}

func (b *Batcher[T]) Shutdown(ctx context.Context) error {
    b.closeOnce.Do(func() {
        close(b.closeCh)
        close(b.in)
    })
    select {
    case <-b.done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

type Stats struct {
    Enqueued          int64
    FlushedOK         int64
    FlushedFail       int64
    DroppedOnShutdown int64
    QueueDepth        int
}

func (b *Batcher[T]) Stats() Stats {
    return Stats{
        Enqueued:          b.enqueued.Load(),
        FlushedOK:         b.flushedOK.Load(),
        FlushedFail:       b.flushedFail.Load(),
        DroppedOnShutdown: b.droppedOnShutdown.Load(),
        QueueDepth:        len(b.in),
    }
}

// Compile-time check.
var _ runtime.Func // keep import
```

This is approximately 200 lines and implements:

- Both triggers (size, time).
- Pipeline architecture (1+ flush workers).
- Per-flush context with timeout.
- Defensive copy via sync.Pool.
- Idempotent shutdown.
- Per-Add context.
- Try-add for non-blocking.
- Atomic stats counters.
- Panic recovery.
- Generic over T.

Use this as the starting point for any production batcher. Add retries, metrics, tracing as decorators around the Sink.

## Batcher Patterns Outside Go

For context, how do other languages handle this?

### Java

`java.util.concurrent.LinkedBlockingQueue` plus a worker pool. `ScheduledExecutorService` for time triggers.

Spring Batch is a heavy-weight framework for batch jobs (mostly nightly, not micro-batching).

### Rust

`tokio::sync::mpsc::channel`, `tokio::time::interval` for time triggers. Very similar pattern to Go.

### Python

`asyncio.Queue`, `asyncio.create_task` for periodic flush. The GIL limits throughput but the shape is the same.

### Node.js

EventEmitters + timers. Bulk write to Redis or Kafka via libraries.

### Erlang/OTP

`gen_server` with a state and timeout. Idiomatic; the BEAM scheduler is light.

The pattern is universal. Each language has idioms; the algorithm is the same.

## Hot Reload of Batcher Configuration

Production batchers need config changes without restart. Common need: dial `MaxBatchSize` up after a sink upgrade.

### Atomic Pointer Pattern

```go
type Batcher[T any] struct {
    cfg atomic.Pointer[Config]
}

func (b *Batcher[T]) UpdateConfig(c *Config) {
    b.cfg.Store(c)
}

func (b *Batcher[T]) run() {
    for {
        c := b.cfg.Load()
        // ... use c.MaxBatchSize, c.MaxBatchDelay
    }
}
```

Run loop reads config on each iteration. The atomic store is lock-free; the load is lock-free.

For `time.Ticker` interval, you cannot directly swap. Track `lastInterval`; if config changes, stop old ticker and start new:

```go
if c.MaxBatchDelay != lastInterval {
    ticker.Stop()
    ticker = time.NewTicker(c.MaxBatchDelay)
    lastInterval = c.MaxBatchDelay
}
```

### Sources of Config

- HTTP endpoint (`POST /config`).
- Etcd / Consul watch.
- File reload on SIGHUP.
- Environment variable poll (less common).

For Kubernetes services, ConfigMap mount + SIGHUP is standard.

## A Note on Versioning the Batcher Library

If you maintain a batcher library used across teams:

### Public API Stability

Method signatures, error types, configuration struct fields: stable.

Removing a field is a breaking change. Adding a field (with sensible default) is not.

### Internal Evolution

The run loop, the flush strategy, the metric internals: can change between minor versions.

### Deprecation Policy

When deprecating an API, mark with `// Deprecated:` comment and keep it working for at least 6 months.

When removing, bump major version.

### Backward Compatibility

A user upgrading from v1.5 to v1.6 should not have to change code. From v1.x to v2.0: expect changes; provide migration guide.

## A Final Comparison: Three Real-World Batcher Architectures

Let us compare three batchers in production at scale.

### Architecture A: Stripe-Style Payment Auditor

Stripe-style: every API call's audit event must be durable. Used in financial services.

- Per-tenant batchers (large fleet).
- Postgres COPY backend.
- Single flusher per batcher (strict ordering).
- MaxBatchSize 500, MaxBatchDelay 100 ms.
- DLQ to S3.
- Drain timeout 60 s on shutdown.
- 99.999% durability SLO.

### Architecture B: Datadog-Style Metrics Pipeline

Aggregate metrics from millions of agents.

- Per-tenant batchers (high cardinality).
- HTTP bulk endpoint.
- Many flushers per batcher (idempotent metrics).
- MaxBatchSize 5000, MaxBatchDelay 5 s.
- Drop on overflow.
- 99% durability SLO (metrics are aggregate; some loss tolerated).

### Architecture C: Game Server-Style State Replicator

Replicate player state to a central server.

- One batcher per game server.
- gRPC streaming.
- MaxBatchSize 100, MaxBatchDelay 50 ms.
- Retry on transient.
- Drain immediately on player disconnect.
- 99.9% durability.

### Common Patterns

All three:
- Both triggers.
- Bounded queues.
- Reason-tagged metrics.
- Graceful shutdown.
- Per-tenant or per-source isolation.

### Differences

The trade-offs reflect domain requirements:
- Stripe: durability > latency.
- Datadog: throughput > per-item.
- Game server: latency > throughput.

Same pattern, different tunings. The architectural choice is in the *configuration*, not the algorithm.

## Detailed Investigation: Why Are My Goroutines Leaking?

A real diagnostic walk.

### Symptom

`runtime.NumGoroutine()` shows 50000 and rising. Heap memory growing.

### Capture

```bash
curl localhost:6060/debug/pprof/goroutine?debug=1 > goroutines.txt
```

Grep for repeated stacks: `sort | uniq -c | sort -rn | head`.

### Common Pattern

```
50000 goroutines:
    runtime.gopark
    runtime.chanrecv
    main.consumer (line 42)
```

50000 goroutines blocked on the same `<-ch`. The channel never closes.

### Root Cause

Likely: producer goroutines that spawn for each request and forget to terminate. Or: a goroutine waiting on a context that never cancels.

### Fix

Audit goroutine lifecycles. Every `go f()` should have an end condition: context cancel, channel close, exit signal.

For batchers specifically: ensure the run loop's exit is reachable. Test that `Shutdown` truly terminates the goroutine.

## Detailed Investigation: Why Is My CPU 100%?

### Symptom

CPU is pinned at 100%; throughput is the same.

### Capture

```bash
go tool pprof -seconds=30 localhost:6060/debug/pprof/profile
```

In pprof: `top`, `web`.

### Common Causes

1. **Tight spin loop**: `for { check() }` without sleep.
2. **GC overload**: `runtime.gcMark*` in top. Reduce allocations.
3. **Channel contention**: many producers; channel lock bouncing.
4. **Lock contention**: mutex profile via `pprof.Lookup("mutex")`.

### Fix Each

1. Add `runtime.Gosched()` or use a blocking primitive.
2. `sync.Pool`, pre-allocation, fewer allocations.
3. Shard channels.
4. Reduce critical section, use atomic, or shard.

## Detailed Investigation: Why Is My Memory High?

### Symptom

Heap memory growing without bound.

### Capture

```bash
go tool pprof -inuse_space localhost:6060/debug/pprof/heap
```

`top`, `web` again.

### Common Causes

1. **Unbounded buffer**: input channel without cap.
2. **Goroutine leak**: each holds stack memory.
3. **Slice escape**: slices that should be on stack escaping to heap.
4. **Pool not draining**: items pooled but never reused.

### Fix Each

1. Bound the channel.
2. Audit goroutines as above.
3. Profile with `-alloc_space`; check escape analysis output.
4. Reduce pool reservation; ensure `Put` is called.

## A Final Look at the Run Loop With All Optimisations

The "professional" run loop with every optimisation we've discussed:

```go
func (b *Batcher[T]) run() {
    defer close(b.done)
    defer func() {
        if r := recover(); r != nil {
            b.cfg.Logger.Error("panic", "panic", r)
        }
    }()

    runtime.LockOSThread() // pin to OS thread
    defer runtime.UnlockOSThread()

    buf := make([]T, 0, b.cfg.MaxBatchSize)
    var timer *time.Timer
    var timerC <-chan time.Time

    flush := func(reason string) {
        if len(buf) == 0 {
            return
        }
        batch := batchPool.Get().([]T)[:0]
        batch = append(batch, buf...)
        b.flushReq <- flushJob[T]{batch: batch, reason: reason}
        buf = buf[:0]
        if timer != nil {
            timer.Stop()
            timer = nil
            timerC = nil
        }
    }

    armTimer := func() {
        if timer == nil {
            timer = time.NewTimer(b.cfg.MaxBatchDelay)
            timerC = timer.C
        }
    }

    for {
        // Bulk-drain channel.
        select {
        case item, ok := <-b.in:
            if !ok {
                flush("shutdown")
                return
            }
            buf = append(buf, item)
            if len(buf) == 1 {
                armTimer()
            }
            // Try to grab more without blocking.
            for len(buf) < b.cfg.MaxBatchSize {
                select {
                case more, ok := <-b.in:
                    if !ok {
                        flush("shutdown")
                        return
                    }
                    buf = append(buf, more)
                default:
                    goto checkSize
                }
            }
        checkSize:
            if len(buf) >= b.cfg.MaxBatchSize {
                flush("size")
            }
        case <-timerC:
            flush("time")
        }
    }
}
```

Optimisations applied:

- `runtime.LockOSThread` for scheduler stability.
- `sync.Pool` for batch slices.
- `time.Timer` for precise time trigger (not `time.Ticker`).
- Bulk drain on each wake (multi-item per select).
- Reason-tagged flush via channel.
- Pipeline architecture (flushReq channel).
- Panic recovery.

Result: ~50% less CPU than the naive run loop at high throughput.

## Reading Real Production Code Critically

When reading a production batcher (yours or someone else's), questions to ask:

1. What are the triggers? All present?
2. What is the backpressure policy?
3. What does shutdown do? Is there a deadline?
4. How are errors handled?
5. What metrics are emitted?
6. How is it tested?
7. What was the last bug? What did it teach the team?

If any answer is unclear, the batcher has technical debt. Add to the backlog.

## Documentation for Batchers

Every batcher in production should have:

### A README

- Purpose: what does it batch?
- Configuration: what knobs?
- Metrics: what to monitor?
- Alerts: what should page?
- Runbook: how to respond to common failures?

### A Design Document

- The shape of the implementation (channel vs lock-free vs mutex).
- The trade-offs considered.
- The rejected alternatives.

### A Test Suite

- Unit tests for each trigger.
- Integration tests with real sink.
- Chaos tests for failure modes.
- Load tests for capacity.

Without these artifacts, the batcher is a black box that breaks at 3 AM and no one knows how to fix it.

## Production Best Practices Summary

After everything, here are the principles:

1. **Both triggers**: size and time.
2. **Defensive copy**: never share buffer with sink.
3. **Bounded queue**: surface backpressure.
4. **Graceful shutdown**: with deadline.
5. **Reason-tagged metrics**: size, time, shutdown.
6. **Retry layer**: classify errors; backoff with jitter.
7. **Dead-letter queue**: for permanent failures.
8. **Per-flush timeout**: don't hang forever.
9. **Idempotent shutdown**: safe to call twice.
10. **Test under load**: not just unit tests.

These are not optional. A production batcher missing any of these has a known failure mode in its future.

## What Makes a Batcher Great

After 4000+ lines, what separates a good batcher from a great one?

- **Operability**: someone other than the author can run it.
- **Observability**: failures are visible before they cause outages.
- **Predictability**: behavior under load is documented and verified.
- **Recoverability**: failures lead to recovery, not data loss.
- **Documentation**: a 3 AM engineer can fix it.

Greatness is rarely in the code. It is in the artifacts around the code: tests, metrics, alerts, runbooks, design docs.

## A Detailed Look at Distributed Tracing for Batchers

Tracing across a batcher's async boundary requires careful instrumentation.

### Per-Item Tracing

Each item's `Add` is wrapped in a span:

```go
ctx, span := tracer.Start(ctx, "batcher.Add")
defer span.End()
item.TraceCtx = span.SpanContext()
batcher.Add(ctx, item)
```

The item carries its trace context.

### Per-Batch Tracing

The flush creates a new span. Link to all items' spans:

```go
batchCtx, batchSpan := tracer.Start(context.Background(), "batcher.Flush")
defer batchSpan.End()
links := make([]trace.Link, len(batch))
for i, item := range batch {
    links[i] = trace.Link{SpanContext: item.TraceCtx}
}
// Set links via tracer API
sink.Write(batchCtx, batch)
```

The flush span has many links; the trace UI renders fan-in.

### Sampling

Tracing every item is expensive. Sample 1% with tail sampling:

```go
sampler := sdktrace.TraceIDRatioBased(0.01)
provider := sdktrace.NewTracerProvider(
    sdktrace.WithSampler(sampler),
    ...
)
```

Or use tail sampling at the collector (Tempo, Jaeger Agent).

### Span Attributes

Useful attributes:

- `batcher.name`: which batcher.
- `batch.size`: how many items.
- `batch.reason`: trigger reason.
- `flush.duration`: flush time.
- `sink.error`: error if any.

These make traces filterable.

## Inside Linux Memory Management

For batchers using large buffers, kernel memory management matters.

### Page Allocation

Go's allocator gets memory from the OS via `mmap`. Pages are 4 KB; huge pages 2 MB.

For a batcher holding 100 MB: 25K small pages or 50 huge pages.

### Memory Mapping

Anonymous mmap returns zero-filled pages on first access (copy-on-write from a global zero page).

For a pre-allocated buffer: first writes incur page faults (~1 µs each). After warmup, zero overhead.

For huge pages (`madvise(MADV_HUGEPAGE)`): one page fault per 2 MB instead of per 4 KB. Faster startup for large buffers.

### Swap

If the system swaps, performance dies. Configure for no swap on production (`vm.swappiness=0`).

### Memory Pressure

The kernel kills processes under OOM. The batcher's memory should be bounded; otherwise the OOM killer picks the largest process.

Set `cgroup` memory limits in Kubernetes. Prefer the batcher dying explicitly (via Go's `GOMEMLIMIT`) to surprise OOM kills.

## Profile-Guided Optimisation Details

Go 1.21 PGO. The compiler uses profile to:
- Inline more aggressively.
- Devirtualise interface calls (when one implementation dominates).
- Re-order branches based on frequency.

Typical gain: 2-7%.

### Workflow

1. Build initial binary: `go build -o app`.
2. Run with profile capture: `go run -cpuprofile=cpu.pprof main.go`.
3. Copy cpu.pprof to source dir as `default.pgo`.
4. Rebuild: `go build -o app`.

The compiler picks up `default.pgo` automatically.

For long-running batchers, capture profile from production. Update profile periodically (every few months).

## A Real Optimisation Story

A team optimised a batcher from 10K/s to 100K/s. The journey:

### Baseline (10K/s)

- Channel-based, MaxBatchSize=100, MaxBatchDelay=100ms.
- Sink: HTTP POST per batch.
- json.Marshal serialisation.
- No retries.

### Step 1: Profile (no change)

Top: json.Marshal 40%, http.Client.Do 30%, runtime stuff 30%.

### Step 2: easyjson (15K/s, +50%)

Replace json.Marshal with easyjson. Top: now json gone from top 10.

### Step 3: sync.Pool for batch slices (18K/s, +20%)

Eliminate per-flush slice allocation.

### Step 4: Larger MaxBatchSize (40K/s, +120%)

MaxBatchSize 100 -> 1000. Larger batches; sink throughput up.

### Step 5: gzip compression (50K/s, +25%)

Compress before send. Network bandwidth was the limit; gzip 5x reduced bytes.

### Step 6: HTTP/2 (55K/s, +10%)

Reuse one connection across many requests.

### Step 7: Pipeline architecture (75K/s, +35%)

3 flush workers. Run loop no longer blocks on flush.

### Step 8: Sharded input (100K/s, +33%)

4 channels by hash(item.UserID % 4). Reduced channel contention.

### Summary

10x improvement through 8 changes. Each measured. Each addressed a specific bottleneck shown by profiles.

This is the senior+professional engineer's journey for a single component.

## A Detailed Comparison: Library vs Custom Batcher

When to use a library vs build your own.

### Libraries

- `github.com/sourcegraph/conc/iter`: simple iterators with batching.
- `github.com/grafana/regexp`: not a batcher; mentioned because it shows how to write performance-critical Go.
- `github.com/golang-batch/batcher`: a basic batcher library.

### When to Use a Library

- Standard use case (size + time triggers, channel-based).
- Want maintenance from the community.
- No special integration needs.

### When to Build Your Own

- Special triggers (byte size, per-tenant).
- Tight coupling with downstream (custom retry, custom DLQ).
- Performance requirements that the library does not meet.

### A Hybrid

Use a library as the core, wrap with custom decorators. Most production batchers are this shape.

## Real-Time vs Best-Effort Batching

A spectrum of guarantees.

### Real-Time

- Tight latency bounds (sub-ms).
- Strict scheduling (RT priority).
- No GC pauses (custom allocator or off-heap).
- No retries (fail fast).

Examples: trading, control systems, robotics.

### Soft Real-Time

- Loose latency bounds (10-100 ms).
- Best-effort scheduling.
- GC tolerated.
- Bounded retries.

Examples: video conferencing, game servers, ad serving.

### Best-Effort

- No specific latency requirements.
- Standard Go runtime.
- Liberal retries.

Examples: audit logs, ETL, metrics.

Your batcher's tuning differs by class. For best-effort: simplicity. For real-time: every detail matters.

## A High-Performance Logger Walkthrough

Consider zerolog or zap. They are themselves batchers (kind of):

- Per-call: format the log line into a buffer.
- The buffer is shared (sync.Pool).
- Periodically: flush the buffer to disk.

The batching is implicit, but the principles are the same:

- Pool buffers.
- Defer allocation.
- Bulk writes.

For very high log rates (10K+ lines/s), zerolog can sustain it with minimal overhead.

## A Real Failure: Buffer Bloat at Scale

A failure mode from a real incident.

### Setup

Service had a batcher with `MaxBatchSize = 10000` and `MaxBatchDelay = 60s`. Aggressive amortisation.

### The Problem

Postgres slowed by 10x for 5 minutes (storage issue). Flush durations jumped from 100 ms to 1 s. Then 2 s.

The batcher's input channel filled. Producers blocked. HTTP timeouts cascaded.

Within minutes, every Go service in the fleet was queueing requests behind blocked batchers.

### Root Cause

`MaxBatchDelay = 60s` was too long. When the sink slowed, the batcher waited 60s per batch instead of 1s. The buffer never drained.

### Fix

`MaxBatchDelay = 5s`. With faster flushes, the batcher catches up sooner.

Also: tighter pool timeouts so producers fail fast instead of blocking on `Add`.

### Lesson

`MaxBatchDelay` is not just a latency knob — it is a *recovery* knob. Long delays mean long recovery from sink slowness.

For most production batchers, MaxBatchDelay between 100 ms and 5 s. Beyond 5 s only for tolerated-latency workloads (overnight ETL).

## Inside Postgres' Buffer Manager

Postgres' shared_buffers is a fixed-size cache of disk pages. Bulk INSERTs interact with it.

### Read-Then-Write

When a row is inserted, Postgres reads the target page (heap), modifies it, writes back.

If the page is in shared_buffers: fast (~1 µs).
If not: disk read (~100 µs on SSD).

For COPY-heavy workloads, target pages are usually warm.

### Dirty Page Eviction

shared_buffers cannot grow. When full, dirty pages are evicted to disk.

If the bgwriter (background writer) cannot keep up, foreground queries block on eviction.

Tuning: increase shared_buffers (25% of RAM), tune bgwriter (`bgwriter_lru_maxpages`, `bgwriter_delay`).

### Checkpoint Storms

A checkpoint flushes all dirty pages. Postgres does this every `checkpoint_timeout` (5 min default) or when WAL exceeds `max_wal_size`.

During a checkpoint, foreground queries slow due to disk contention.

For audit log workloads, longer checkpoints (`checkpoint_timeout = 30 min`) reduce frequency.

### Implications for Batchers

A bursty batcher can fill the WAL faster than the checkpointer drains. Solutions:
- Larger `max_wal_size`.
- Tune `checkpoint_completion_target` to spread writes.
- Add WAL space.

## Inside Postgres' Vacuum

Updates and deletes leave "dead tuples" — old versions of rows. Vacuum reclaims space.

### Autovacuum

Runs in the background. Triggers based on dead tuple count.

For INSERT-heavy workloads (audit logs), few dead tuples. Autovacuum is rare.

For UPDATE/DELETE-heavy workloads, autovacuum can be busy. Tune `autovacuum_max_workers`, `autovacuum_vacuum_cost_limit`.

### Implications for Batchers

A batcher doing INSERT ON CONFLICT DO UPDATE creates dead tuples. Significant updates = significant vacuum work.

Alternatives:
- Periodic table swap (write to staging, then RENAME).
- Partitioned tables (drop old partitions instead of vacuuming).

## Inside Postgres' MVCC

Multi-version concurrency control: each row has version metadata (xmin, xmax). Reads see the version visible to their snapshot.

### COPY Path

COPY rows are inserted with `xmin = current transaction`. Other transactions see them only after commit.

### Snapshot Isolation

A transaction starts with a snapshot. It sees rows committed before snapshot start.

For long-running queries vs concurrent COPY: the query sees the pre-COPY state.

### Implications

For analytical queries reading audit logs being written: consistent snapshot. No "torn write" issues.

## A Deep Dive on `select` Statement Cost

Go's `select` is more expensive than a simple channel op. Let us measure.

### Single Case Select

```go
select {
case <-ch:
}
```

Essentially equivalent to `<-ch`. ~30-50 ns.

### Two-Case Select With One Ready

```go
select {
case <-ch1:
case <-ch2:
}
```

The runtime locks both channels, checks both, picks one. ~70-100 ns.

### Two-Case Select With None Ready (Blocking)

The goroutine parks on both. ~150-200 ns to park; microseconds to wake.

### N-Case Select

Each additional case adds ~30-50 ns to the steady-state cost. For N=10 select, hundreds of ns.

### Default Case (Non-Blocking)

```go
select {
case <-ch:
default:
}
```

Same cost as no-default-blocking, but does not park. ~50-80 ns.

### Implications for Batchers

The standard batcher select has 2 cases (input + ticker). ~100 ns per iteration.

For 10M iterations/s: 1 second of CPU. The select is the bottleneck at this throughput.

Mitigations:
- Reduce select cases.
- Process multiple items per iteration (one select, many appends).
- Lock-free queue (avoids select).

For typical batchers (< 1M items/s), select cost is negligible.

## Bulk Append in the Run Loop

Instead of one append per item, bulk receive and append:

```go
for {
    select {
    case item := <-b.in:
        buf = append(buf, item)
        // Try to grab more without blocking.
    drain:
        for len(buf) < b.maxSize {
            select {
            case more := <-b.in:
                buf = append(buf, more)
            default:
                break drain
            }
        }
        if len(buf) >= b.maxSize {
            flush()
        }
    case <-ticker.C:
        if len(buf) > 0 { flush() }
    }
}
```

Each "wake" of the run loop drains as much as is available, then either flushes or waits.

Reduces select overhead by amortising across multiple items.

### When To Use

For ultra-high-throughput. The drain loop adds complexity.

For typical: one item per select iteration is fine.

## Performance Anti-Patterns

Things that look fast but aren't.

### Anti-Pattern A: Slice Growing in Hot Loop

```go
buf := []int{}
for _, v := range source {
    buf = append(buf, v)
}
```

Each append may realloc + copy. For 1M items, multiple reallocs.

Fix: pre-size `buf := make([]int, 0, expectedSize)`.

### Anti-Pattern B: Map Growth

```go
m := map[string]int{}
for k, v := range source {
    m[k] = v
}
```

Map grows via resize-copy. For 1M entries, many resizes.

Fix: pre-size `m := make(map[string]int, expectedSize)`.

### Anti-Pattern C: Reflection in Hot Path

`reflect.ValueOf(item).Field(0)` is ~50 ns. Many fields, many calls = milliseconds.

Fix: code-gen accessors, or use generics.

### Anti-Pattern D: Channel of Pointers to Stack Values

```go
ch := make(chan *int)
x := 5
ch <- &x // &x escapes to heap because of channel
```

Channels force heap allocation for pointer receives.

Fix: use values where possible.

### Anti-Pattern E: Defer in Hot Loop

```go
for _, item := range source {
    func() {
        defer cleanup()
        process(item)
    }()
}
```

Defer has ~30-50 ns overhead. For 1M iterations, 30-50 ms.

Fix: hoist cleanup out of the loop.

### Anti-Pattern F: Capturing Loop Variable

```go
for i, item := range items {
    go func() { _ = items[i] }() // <-- in pre-1.22, i is shared
}
```

Pre-Go 1.22, `i` is shared. Go 1.22+ fixes per-iteration scoping.

For Add-style batchers, this is a non-issue (no per-iteration goroutine).

## Reading Kafka's Sender Goroutine

In franz-go, the sender (`internal/sticky.go` and `pkg/kgo/sink.go`) runs per-broker:

1. Wait for produce records to be ready (sized or lingered).
2. Build a produce request: for each topic-partition, include records up to limits.
3. Compress.
4. Send to broker.
5. On response, fire callbacks per record.

### Per-Broker Sticky Partitioning

If you don't specify a partition, franz-go uses sticky partitioning: all records to one partition until full, then rotate. This maximises batch size per partition.

### Idempotent Producer

`enable.idempotence=true` (default in newer versions):
- Producer ID assigned by broker.
- Each record has a producer ID + sequence number.
- Broker dedupes on (producer ID, sequence).

Allows retries without duplicates. Lower throughput due to coordination overhead.

### Transactional Producer

Beyond idempotent, transactional producer guarantees atomicity across partitions and topics. Used for read-modify-write to Kafka.

Implementation: a coordinator broker manages transaction state. Pre-commit fence + commit message.

Application-level: `client.BeginTransaction()`, send records, `CommitTransaction()`.

For ETL pipelines that consume from Kafka, process, write to Kafka with exactly-once: use transactional producer with idempotent consumer.

## A Note on `runtime.Gosched`

`runtime.Gosched()` yields the current goroutine. Useful in spin loops:

```go
for !done() {
    runtime.Gosched()
}
```

Without Gosched, a tight spin loop on one P starves other goroutines on that P.

For lock-free batchers (spinning until ring has data), Gosched is the spin-back.

Alternative: `time.Sleep(0)` is similar but goes through the runtime's sleep path. Gosched is preferred for tight loops.

## Memory Barriers in Go

Go's memory model is described in `go.dev/ref/mem`. For batchers:

- Channel send/receive synchronises memory.
- `sync.Mutex.Unlock` happens-before `sync.Mutex.Lock`.
- `atomic` operations have specific semantics; `atomic.Store` followed by `atomic.Load` synchronises.

For lock-free batchers, careful use of `atomic` is required. Go's atomics are sequentially consistent by default; that is stronger than needed but easier to reason about.

For weaker memory ordering (acquire-release), use Go's `sync/atomic` package since 1.19, which has Load/Store with no fence options — but the standard ones include necessary fences.

## Generics in Hot Paths

Go 1.18+ generics. For batchers, `Batcher[T any]` avoids the `interface{}` boxing.

### Cost

Generic functions are specialised per type at compile time. No runtime overhead.

The compiler generates one copy per "GC shape" (size class + pointer pattern). For `Batcher[int64]` and `Batcher[string]`, two copies.

### Limitations

Cannot use methods on type parameters without constraints. For sinks, the constraint is `Sink[T any]` interface.

### When to Use

For library-style batchers reused across types: generics. For one-off batchers: concrete types.

## Reading Real Production Code: HashiCorp's Memberlist Batching

HashiCorp's `memberlist` (gossip protocol) batches network messages:

- Per-peer outbound queue.
- Coalesces multiple messages into one UDP packet.
- Acks batched.

Code: `github.com/hashicorp/memberlist`. Reading shows another shape of batching — for low-latency UDP.

## Reading Real Production Code: Caddy's HTTP/3 Send Coalescing

Caddy's HTTP/3 implementation coalesces small writes:

- Connection has a write buffer.
- Writes accumulate until 1500 bytes (MTU) or 1 ms passes.
- Flush to UDP.

Similar to TCP Nagle but for QUIC.

## Reading Real Production Code: Cassandra's Java Driver

Cassandra's Java driver batches:
- Per-connection request batching (multiple queries in one frame).
- Driver-side throttling (max in-flight).
- Per-coordinator routing.

Not directly Go but conceptually similar.

## Inside `io_uring` for Batch I/O

Linux 5.1+ provides `io_uring` for batched async I/O. From a Go batcher perspective:

### Setup

```go
import "github.com/iceber/iouring-go"

iour, _ := iouring.New(1024) // 1024 entry submission queue
defer iour.Close()
```

### Submit Batched Writes

```go
var requests []iouring.PrepRequest
for i, batch := range batches {
    requests = append(requests,
        iouring.Write(fds[i], batch, uint64(i)))
}
ch, _ := iour.SubmitRequests(requests, nil)
```

One submission carries many writes. The kernel processes them asynchronously.

### Wait for Completions

```go
for i := 0; i < len(requests); i++ {
    res := <-ch
    if res.Err != nil {
        // handle
    }
}
```

### Throughput

For thousands of small writes: io_uring is 2-10x faster than per-write syscall.

For larger writes (network sinks): not much advantage; one write is fine.

### Use Cases

- Custom databases (we batch writes to many files).
- Log shippers (many output destinations).
- Network proxies (many connections).

For typical app-level batchers writing to one downstream: io_uring is overkill.

## Custom Codecs for Hot Paths

For the hot serialisation path:

### Pre-Calculated Sizes

If item size is known, pre-allocate the buffer:

```go
size := 0
for _, item := range batch {
    size += sizeOf(item)
}
buf := make([]byte, 0, size)
for _, item := range batch {
    buf = encode(buf, item)
}
```

Avoids reallocations.

### Code-Gen

`go:generate` to produce type-specific encoders. Used by `easyjson`, `vtprotobuf`, `gogoproto`.

Hand-written codec for hot types: faster still. Trade-off: maintenance.

### Zero-Copy

For binary protocols, pass `unsafe.Pointer` to fields:

```go
binary.LittleEndian.PutUint64(buf, *(*uint64)(unsafe.Pointer(&item.ID)))
```

Skips type conversion. Microseconds saved per call; over 1M calls, milliseconds.

Use only when profile shows codec as hot.

## Building a Lock-Free MPMC Ring Buffer in Go

A complete implementation based on Vyukov's design:

```go
package lockfree

import (
    "runtime"
    "sync/atomic"
)

type slot[T any] struct {
    seq atomic.Uint64
    val T
}

type Ring[T any] struct {
    buf      []slot[T]
    mask     uint64
    head     atomic.Uint64 // producer
    _pad1    [56]byte
    tail     atomic.Uint64 // consumer
    _pad2    [56]byte
}

func NewRing[T any](size uint64) *Ring[T] {
    if size & (size - 1) != 0 {
        panic("size must be power of 2")
    }
    r := &Ring[T]{
        buf:  make([]slot[T], size),
        mask: size - 1,
    }
    for i := range r.buf {
        r.buf[i].seq.Store(uint64(i))
    }
    return r
}

func (r *Ring[T]) Enqueue(v T) bool {
    var s *slot[T]
    pos := r.head.Load()
    for {
        s = &r.buf[pos & r.mask]
        seq := s.seq.Load()
        diff := int64(seq) - int64(pos)
        if diff == 0 {
            if r.head.CompareAndSwap(pos, pos+1) {
                break
            }
        } else if diff < 0 {
            return false // full
        } else {
            pos = r.head.Load()
        }
    }
    s.val = v
    s.seq.Store(pos + 1)
    return true
}

func (r *Ring[T]) Dequeue() (T, bool) {
    var zero T
    var s *slot[T]
    pos := r.tail.Load()
    for {
        s = &r.buf[pos & r.mask]
        seq := s.seq.Load()
        diff := int64(seq) - int64(pos+1)
        if diff == 0 {
            if r.tail.CompareAndSwap(pos, pos+1) {
                break
            }
        } else if diff < 0 {
            return zero, false // empty
        } else {
            pos = r.tail.Load()
        }
    }
    val := s.val
    s.seq.Store(pos + r.mask + 1)
    return val, true
}
```

### Properties

- Multi-producer, multi-consumer.
- Lock-free (CAS-based).
- O(1) Enqueue and Dequeue.
- ~20-50 ns per op.
- Cache-friendly (slot includes its sequence number).

### Use With a Batcher

```go
type LFBatcher[T any] struct {
    ring    *Ring[T]
    sink    Sink[T]
    maxSize int
    quit    chan struct{}
}

func (b *LFBatcher[T]) Add(v T) bool {
    return b.ring.Enqueue(v)
}

func (b *LFBatcher[T]) run() {
    buf := make([]T, 0, b.maxSize)
    backoff := 0
    for {
        select {
        case <-b.quit:
            return
        default:
        }
        for len(buf) < b.maxSize {
            v, ok := b.ring.Dequeue()
            if !ok {
                break
            }
            buf = append(buf, v)
        }
        if len(buf) > 0 {
            b.sink.Write(context.Background(), buf)
            buf = buf[:0]
            backoff = 0
        } else {
            backoff++
            if backoff > 100 {
                runtime.Gosched() // yield CPU
                backoff = 0
            }
        }
    }
}
```

### Throughput

Microbenchmark: ~10-20 M items/s. ~5x faster than `chan T`.

### Why Not Use This Always

- No backpressure (drop on full).
- No close semantics (must coordinate via `quit` channel).
- No select integration (must combine with timer manually).
- Memory usage: pre-allocates the ring.

For 99% of batchers: channel. For 1% (extreme throughput, willing to manage complexity): ring buffer.

## A Survey of Production Batchers in the Wild

A look at production batchers and their key choices.

### Datadog Agent

- Aggregates metrics from local processes.
- Per-metric-name combiner.
- 10 second flush interval.
- HTTP POST to Datadog API.
- Retry on 5xx; DLQ on 4xx.

### Fluentd / Fluent Bit

- Tag-based routing.
- Configurable buffer (memory or disk).
- Per-output flush interval.
- Backpressure to upstream sources.

### Vector

- Composable pipelines.
- Memory + disk buffer.
- Per-sink batching.
- Adaptive concurrency (built-in adaptive sizer).

### Prometheus Remote Write

- Per-target queue.
- 500 samples or 5s.
- Retries with exponential backoff.
- Drop on overflow.

### Elasticsearch Beats

- File tailers + buffers.
- Bulk indexing.
- Per-output backpressure.

### Common Themes

- Configurable size and time triggers.
- Retry layer.
- Backpressure or drop.
- Per-output / per-tenant separation.
- Metrics: rate, batch size, latency.

The pattern repeats. The variations are in:
- Disk buffer (yes/no).
- Adaptive sizing (yes/no).
- Multi-output fan-out (some/all).
- Configuration model (file/env/runtime).

## Performance Measurement Protocol

A reproducible performance measurement.

### Setup

1. Dedicated machine (no other workloads).
2. CPU governor: `performance`.
3. Disable swap.
4. Fix `GOMAXPROCS`.
5. Warm up: drive 1M items through.

### Measurement Run

1. Drive load (target rate or open-loop).
2. Record:
   - Throughput (items/s).
   - p50, p99, p99.9 latency.
   - CPU %.
   - Memory MB.
   - GC count and total pause.
3. Run 10 times.
4. Discard outliers (top, bottom 10%).
5. Report median and standard deviation.

### Comparison Run

For A/B comparison:
1. Run A.
2. Run B.
3. Run A again.
4. Run B again.

Alternation reduces time-of-day effects.

Use `benchstat` to compute statistical significance.

### Reporting

A good report includes:
- Hardware (CPU, RAM, NIC).
- Go version.
- Sink characteristics (latency, throughput ceiling).
- Number of producers.
- Item size and shape.
- Each run's results.
- Statistical analysis.

Without this, "X is faster than Y" is opinion.

## Inside Postgres' Group Commit

`commit_delay` and `commit_siblings` configure group commit.

### Mechanics

When a transaction commits:
1. WAL record is written to the WAL buffer.
2. If `commit_delay > 0` and at least `commit_siblings` other transactions are in progress: wait `commit_delay` µs.
3. Issue `fsync` on the WAL file.
4. Acknowledge commit.

If many transactions commit during the delay window, they all share the one fsync.

### Numbers

Default: `commit_delay = 0` (no group commit). Each commit fsyncs independently. On SSD, ~100 µs/commit. Throughput ~10K commits/s.

With `commit_delay = 1000` and `commit_siblings = 5`: groups of 5+ transactions share fsync. Throughput up to 50K commits/s.

### Application Interaction

With a batcher that does multi-row INSERT and group commit on the server: throughput stacks. App-level batching amortises parsing; server-level group commit amortises fsync.

Both can be tuned independently. For audit-log workloads, both should be on.

### Counter: `synchronous_commit = off`

If durability is best-effort, set `synchronous_commit = off`. Commits return without fsync; pending WAL is async-flushed.

Risk: up to ~200 ms of recent commits can be lost on power failure.

For metrics, OK. For audit logs, no.

## Inside Postgres' Logical Replication

For change-data-capture (CDC) batchers, logical replication is the upstream.

### How It Works

Postgres records logical changes (INSERT, UPDATE, DELETE) in WAL with a "decoded" format. Replication clients connect and stream these changes.

A CDC batcher consumes the stream, batches changes, writes to downstream.

### Tools

- `pgoutput`: built-in plugin since Postgres 10.
- `wal2json`: external plugin, JSON output.
- `Debezium`: streaming framework.

### Implications for Batchers

CDC batchers have ordering requirements: changes must be applied in WAL order. Single-flusher mode.

Throughput: limited by Postgres' WAL generation rate. Typically 10K-100K changes/s per node.

## Disruptor Pattern in Go

LMAX's Disruptor is a ring buffer with sequence-based slot ownership. Producers and consumers progress without locking.

```go
type Disruptor[T any] struct {
    ring    []T
    mask    uint64
    cursor  atomic.Uint64 // producer write cursor
    barrier atomic.Uint64 // consumer read cursor
}
```

Producer:
1. Claim slot at `cursor.Add(1) - 1`.
2. Write to `ring[seq & mask]`.
3. Set sequence (announce slot ready).

Consumer:
1. Read available range `[lastConsumed+1, cursor]`.
2. Process slice in bulk.
3. Update `barrier`.

The consumer reads many slots at once — naturally batched.

For Go batchers, the Disruptor pattern is:

```go
for {
    available := d.cursor.Load()
    if available > lastConsumed {
        batch := d.ring[lastConsumed+1 : available+1]
        sink.Write(ctx, batch)
        d.barrier.Store(available)
        lastConsumed = available
    }
    runtime.Gosched()
}
```

Avoids the channel hop. Bulk-reads slots into the sink.

Drawbacks: spinning consumer (CPU). No native shutdown. Complex to get right.

For ultra-high-throughput: real win. For typical: overkill.

## The Sequence Lock Pattern

For very small data structures that are read often and written rarely:

```go
type seqlocked struct {
    seq atomic.Uint64
    val Item
}

func (s *seqlocked) Read() Item {
    for {
        s1 := s.seq.Load()
        v := s.val
        s2 := s.seq.Load()
        if s1 == s2 && s1%2 == 0 {
            return v
        }
        // Retry
    }
}

func (s *seqlocked) Write(v Item) {
    s.seq.Add(1)
    s.val = v
    s.seq.Add(1)
}
```

Used in Linux kernel for shared time stamps. For batchers, not directly applicable but a good pattern to know.

## Read-Copy-Update (RCU) for Configuration

A batcher's config (MaxBatchSize, MaxBatchDelay) might be updated at runtime. RCU lets readers proceed without locks:

```go
type Config struct {
    MaxBatchSize  int
    MaxBatchDelay time.Duration
}

type Batcher struct {
    cfg atomic.Pointer[Config]
}

func (b *Batcher) UpdateConfig(c *Config) {
    b.cfg.Store(c) // atomic swap
}

func (b *Batcher) run() {
    for {
        cfg := b.cfg.Load() // lock-free read
        // ... use cfg.MaxBatchSize, cfg.MaxBatchDelay ...
    }
}
```

The run loop sees an immutable snapshot; updates are atomic.

For batchers with dynamic config (adaptive sizing), this pattern avoids locks.

## Reading Real Kernel Code: TCP Send

A read of Linux's TCP send path.

When `write()` is called on a TCP socket:

1. `sys_write` -> `vfs_write` -> `tcp_sendmsg`.
2. `tcp_sendmsg` appends data to the socket's send buffer.
3. If the buffer is below the send window: data is queued in `sk_write_queue`.
4. `tcp_push` schedules a packet send.
5. The packet is built, checksummed, handed to the IP layer.
6. The IP layer routes, the device driver transmits.

Key observations:

- TCP buffers writes. Multiple small writes can coalesce into one packet (Nagle).
- The send window limits in-flight data. Receiver advertises via ACKs.
- Congestion control (Reno, CUBIC, BBR) shapes send rate to avoid loss.

### Implications for Batchers

- Small writes are fine: TCP coalesces them. But syscalls cost (~500 ns each).
- One big write per batch saves syscalls. Use `bufio.Writer` or pre-build a single buffer.
- Disable Nagle (`TCP_NODELAY`) for latency; leave on for throughput.
- Increase send buffer size for high-bandwidth links: `setsockopt SO_SNDBUF`.

## A Memory Profile Walk

A real memory profile of a batcher.

### Capture

```bash
curl localhost:6060/debug/pprof/heap > heap.pprof
go tool pprof -inuse_space heap.pprof
```

`-inuse_space` shows current memory; `-alloc_space` shows cumulative.

### Typical Output

```
top10
       flat  flat%   sum%        cum   cum%
   100MB  40%   40%    100MB   40%  encoding/json.Marshal
    50MB  20%   60%     50MB   20%  bytes.NewBuffer
    30MB  12%   72%     30MB   12%  *batcher.Batcher.run
    20MB   8%   80%     20MB    8%  sync.poolCleanup
    ...
```

### Interpreting

- `encoding/json.Marshal` 100 MB: serialisation allocates a lot. Reuse buffers or switch encoders.
- `bytes.NewBuffer` 50 MB: probably part of JSON or HTTP. Reuse via `sync.Pool`.
- `batcher.run` 30 MB: the batch slice. Tunable via MaxBatchSize or pool.

Fix the biggest, profile again, repeat.

### Allocation Profile vs In-Use

In-use shows live objects; allocation shows total allocated over time. Both useful.

For GC pressure, `-alloc_space` shows the source. For memory leaks, `-inuse_space` shows what won't free.

## Hardware-Aware Batch Sizing

For the truly performance-obsessed: how does hardware shape batch size?

### CPU Cache

L1: 32 KB per core. L2: 256 KB-1 MB per core. L3: 8-32 MB per socket.

For batch in-memory work (combining, sorting, filtering), staying in L2 is fast. Beyond L3, main memory is 10x slower.

Items per batch for L2 fit: 256 KB / 64 byte item = 4000 items.

For 64 KB cache lines, structure items to fit; avoid cross-cache-line atomic ops.

### TLB

The Translation Lookaside Buffer caches virtual-to-physical address mappings. Linux's default page size is 4 KB; TLB has ~64 entries; covers 256 KB of memory.

For batches > 256 KB, TLB misses add ~30 ns per miss.

Mitigation: huge pages (2 MB) cover more memory per TLB entry. Linux `madvise(MADV_HUGEPAGE)` opts in.

### Cache Line False Sharing

Two atomic variables in the same 64-byte cache line: every update to one invalidates the other on remote cores.

Pad fields:

```go
type counters struct {
    a atomic.Int64
    _ [56]byte
    b atomic.Int64
    _ [56]byte
}
```

For per-batcher counters accessed by many cores, padding matters.

### Branch Prediction

Modern CPUs predict branches. A consistently-taken branch is ~free; an unpredictable branch is ~10 ns penalty.

For the run loop's `select`, the size check is predictable (rarely true). The branch prediction is good.

For per-item validation that has 99% "valid" rate, predictable. For 50/50 validation, unpredictable; consider branchless code.

### SIMD

AVX-512 instructions process 64 bytes at a time. For per-item ops on small fixed structures, SIMD speeds things up.

Go's stdlib doesn't expose SIMD directly. Third-party libraries (`internal/runtime/maps`, klauspost/cpuid + asm) do.

For ultra-high-throughput batchers, SIMD is part of the toolkit. For typical: optional.

## Detailed Read of gRPC Batching

gRPC supports streaming. For batchers, a client-streaming or bidirectional-streaming RPC is the natural fit:

```proto
service Events {
    rpc Ingest(stream Event) returns (Ack);
}
```

Client:

```go
stream, _ := client.Ingest(ctx)
for _, e := range batch {
    stream.Send(e)
}
ack, _ := stream.CloseAndRecv()
```

Server receives the stream, processes each event, returns one Ack at the end.

### Versus Unary RPC

For 1000 events:
- Unary: 1000 RPCs. Each is one round-trip. Total time = 1000 * RTT.
- Streaming: 1 RPC. Events flow over one TCP stream. Total time = N * processing + RTT.

For an RTT of 5 ms and 50 µs/event processing: unary 5 s; streaming 60 ms. 80x faster.

### Versus Batched Unary

For 1000 events batched into 10 unary RPCs of 100 events each:
- 10 RPCs * 10 ms each = 100 ms.

Still slower than streaming (60 ms), but close. For most cases, batched unary is simpler and good enough.

### When Streaming Is The Answer

- Long-lived connections amortise TLS handshake.
- Server-side processing can pipeline (overlap with reads).
- Per-event latency matters.

### When Not

- Bursty traffic with idle gaps: streaming connection idles.
- Connection-per-stream overhead exceeds benefit.

## Detailed Read of HTTP/2 Multiplexing

HTTP/2 carries multiple concurrent streams over one TCP connection. For batchers sending many small batches, HTTP/2 amortises the TCP overhead.

### Go's `http.Client`

Set `Transport` to enable HTTP/2:

```go
client := &http.Client{
    Transport: &http2.Transport{
        ReadIdleTimeout: 30 * time.Second,
    },
}
```

### Stream Concurrency

By default, HTTP/2 allows ~100 concurrent streams per connection. For a batcher with 100 concurrent flushes, one connection suffices.

### Flow Control

HTTP/2 has per-stream flow control. The receiver advertises a window; sender cannot exceed it.

For large bodies, increase window:

```go
http2.Transport{InitialConnReadBufferSize: 1 << 20} // 1 MB
```

### When HTTP/2 Helps

- Many concurrent batchers feeding the same endpoint.
- Small-to-medium batches.

### When It Does Not

- Single large batch per second: TCP overhead is amortised anyway.
- gRPC: uses HTTP/2 transparently; you get the benefit for free.

## Detailed Read of `database/sql` Transaction Handling

The `database/sql` package is the standard interface to SQL databases. Its connection pool and transaction handling affect batchers.

### Connection Pool

`*sql.DB` is a pool of `*sql.Conn`. The pool's `Get` returns a connection; `Put` returns it.

Config:
- `MaxOpenConns`: hard cap on simultaneous connections.
- `MaxIdleConns`: keep this many idle.
- `ConnMaxLifetime`: rotate connections after this duration.
- `ConnMaxIdleTime`: close idle connections after this duration.

For a batcher: set MaxOpenConns to at least N+headroom, where N is the number of concurrent flushes.

### Connection Lifecycle

A connection is acquired for the duration of an `Exec`, `Query`, or transaction. The pool may keep a hot connection for low latency.

### Implicit Transactions

`db.Exec` runs in an implicit transaction (autocommit). Each Exec is one round-trip.

For a multi-row INSERT, the entire batch is one Exec, one transaction.

### Explicit Transactions

```go
tx, _ := db.Begin()
tx.Exec(...)
tx.Commit()
```

For batched updates, an explicit transaction allows multiple Execs to commit atomically. Useful for cross-table consistency.

### Prepared Statements

```go
stmt, _ := db.Prepare("INSERT ... VALUES ($1, $2, $3)")
stmt.Exec(v1, v2, v3)
```

The Prepare costs one round-trip; subsequent Execs reuse the plan. For repeated batches, prepare once and reuse.

`sql.Stmt` is tied to a connection. If the pool gives a different connection, the Stmt is rebound. Internally, sql handles this transparently but with overhead.

### Connection Affinity for COPY

COPY operates on a specific connection. If you Acquire from a pool and CopyFrom, the connection is dedicated for the duration. Other queries cannot use it concurrently.

For high-throughput COPY: pool size >= number of concurrent COPYs.

## Inside `sync.Pool` Lifecycle

A closer look at how `sync.Pool` interacts with GC.

### Per-P Storage

`sync.Pool` has private and shared per-P storage:

```
P0: private | shared (queue)
P1: private | shared
...
```

`Get`:
1. Pop from current P's private. Fast path.
2. Pop from current P's shared.
3. Steal from other Ps' shared.
4. Pop from victim cache (previous GC cycle).
5. Call `New` to create.

`Put`:
1. Push to current P's private.
2. Else push to current P's shared.

### GC and the Victim Cache

After each GC, the pool's "current" cache becomes the "victim" cache. Next GC, the victim is dropped (cleared).

So a pooled object survives ~2 GC cycles. Long-lived pools work but reset every GC.

### When `New` Is Called

If the pool is empty after Get tried all paths, `New` is called. With high allocation rate (low cache hit), `New` becomes the bottleneck.

For batchers, this matters when:
- Pool is small (only a few items).
- GC is frequent (every few seconds), clearing the pool.

Mitigations:
- Pre-warm: call Get and Put N times at startup.
- Reduce GC frequency: GOGC=200, GOMEMLIMIT, or memory ballast.
- Use manual free list instead of sync.Pool.

## Inside Linux Filesystem and Disk

For batchers writing to disk (audit logs, persistent buffers), the kernel's page cache and disk scheduling matter.

### Page Cache

When you `write()` to a file, the kernel copies your data into the page cache. Disk write happens later (asynchronously).

Throughput: write to page cache is ~5-10 GB/s on a single CPU. Disk write is 100-500 MB/s on SSD.

If you don't fsync, your data may not be on disk after `write` returns.

### `fsync` and `fdatasync`

`fsync(fd)` waits for all data and metadata to be on disk. On SSD, ~100 µs. On HDD, ~10 ms.

`fdatasync(fd)` skips metadata (faster). Same data guarantee.

For batched fsync (one fsync per N writes), throughput is 100 fsyncs/s on HDD, 10000+ on SSD.

### Direct I/O

`O_DIRECT` bypasses the page cache. Useful for self-managed buffers (databases).

For application batchers, almost never used. Page cache is your friend.

### File Sync at Shutdown

At process exit, the kernel does NOT fsync open files. Pending writes can be lost on power failure.

Always `Close()` files, which implicitly flushes. For critical data, `fsync` after writes.

## The Cost of Logging

A batcher with `log.Printf` per item:

```
log.Printf("added item %d for user %s", id, user)
```

Each call:
- Format string (~100 ns).
- Write to log file (~500 ns to page cache).
- If many goroutines log concurrently: lock contention on the log file's mutex (~1 µs each).

At 1M items/s, logging is 1+ second of CPU per second. Big problem.

### Sampling

```go
if rand.Intn(1000) < 1 { // 0.1%
    log.Printf(...)
}
```

Logs 1 in 1000 events. Enough for debugging; trivial cost.

### Structured Logging

```go
slog.Info("added", "id", id, "user", user)
```

Faster than fmt-based Printf. Avoids string concatenation.

### Replace With Metrics

For per-item counts, use a Prometheus counter. Per-event "logged" is bad design.

For exceptional events (errors, panics), log normally.

## Profiling Real Workloads: A Case Study

A real production debugging session.

### The Problem

Service had p99 latency of 800 ms; SLO 200 ms. Throughput stable at 50K req/s. Capacity unchanged from last week. What changed?

### Initial Investigation

`flush_duration` p99 was 700 ms — much of the latency was in the sink. But sink latency hadn't changed in monitoring.

### Tracing

Enabled OpenTelemetry tracing. Looked at a slow request:

```
span: HTTP /event           dur=805ms
  span: batcher.Add         dur=750ms  <-- weird
    span: chan_send         dur=750ms  <-- very weird
  span: response            dur=2ms
```

The Add call was blocking on the channel send for 750 ms. Producer was waiting for space.

### Queue Depth

`queue_depth` was at 95% of cap for the last 30 minutes. Producers were nearly blocking.

But arrival rate was the same as before. Why was the channel full?

### Sink Latency Hypothesis

`flush_duration` p50 was actually 50 ms (up from 5 ms). The p99 was 700 ms (up from 50). The sink had slowed.

### Root Cause

Postgres replication lag was high. Streaming replication had fallen behind by 5 minutes. The primary's write throughput had dropped because WAL fsyncs were waiting for replicas.

### Fix

The DBA increased `max_wal_senders` and tuned replication. WAL flow caught up; primary throughput recovered; batcher caught up; producers unblocked.

### Lessons

- Symptom (high API latency) was many hops from root cause (PG replication).
- Tracing showed the actual blocked call.
- Metrics confirmed: queue_depth was the canary.
- `flush_duration` p50 vs p99 was the diagnostic: sink slowdown.

This is what professional-level batcher operations looks like.

## Concurrent Hash Maps for Per-Tenant Batchers

For per-tenant batchers, the map of buffers is read and written by the run loop. Concurrent access from producers (for hints) needs synchronisation.

Options:

### `sync.Map`

```go
var bufs sync.Map
b, _ := bufs.LoadOrStore(tenant, &tenantState{})
```

Optimised for "load-heavy, store-rare" workloads. For "write per item", not ideal.

### Sharded `map[K]V` with `[]sync.Mutex`

```go
type ShardedMap struct {
    shards [16]struct {
        mu sync.Mutex
        m  map[string]*tenantState
    }
}
```

16-way sharding. Cross-shard concurrency. Per-tenant access takes its shard's lock.

Best for write-heavy multi-tenant workloads.

### `xsync.MapOf`

`github.com/puzpuzpuz/xsync/v3` provides a lock-free concurrent map. ~2x faster than sync.Map for write-heavy. Worth trying if your profile shows map operations.

## Custom Memory Allocators

For ultra-high-throughput, Go's GC and allocator can be the bottleneck. Custom approaches:

### Arena Allocators (Go 1.20+ Experimental)

```go
import "arena"

a := arena.NewArena()
defer a.Free()
items := arena.MakeSlice[Item](a, 1000, 1000)
```

Allocate in an arena; free everything at once at end. Reduces GC pressure for short-lived data.

Experimental; may be removed. Use cautiously.

### Manual Free Lists

```go
type freeList struct {
    items []*Item
}

func (f *freeList) Get() *Item {
    if len(f.items) == 0 {
        return new(Item)
    }
    item := f.items[len(f.items)-1]
    f.items = f.items[:len(f.items)-1]
    return item
}

func (f *freeList) Put(item *Item) {
    *item = Item{} // zero out
    f.items = append(f.items, item)
}
```

Like `sync.Pool` but no GC interaction. Useful for items with predictable lifetimes.

### Slab Allocation

For fixed-size items, a slab allocator: pre-allocate a large array, index slot positions.

```go
type Slab[T any] struct {
    arr  []T
    free []int
}

func (s *Slab[T]) Allocate() *T {
    if len(s.free) == 0 {
        s.arr = append(s.arr, *new(T))
        return &s.arr[len(s.arr)-1]
    }
    i := s.free[len(s.free)-1]
    s.free = s.free[:len(s.free)-1]
    return &s.arr[i]
}
```

For 1M items, 1 array of 1M elements; allocate is index lookup. Very fast, predictable memory.

## The Cost of `interface{}` and Interfaces

A method call on a concrete type: direct, ~2 ns.

A method call on an interface: indirect via itab (interface table), ~5 ns.

For 1M ops/s, the difference is 3 ms/s. Not huge but measurable.

For 10M ops/s, 30 ms/s. Adds up.

`interface{}` (`any`) also forces heap allocation for non-pointer values. A `chan any` with int values allocates one int per send.

For hot paths, use concrete types or generics. Reserve interfaces for boundary contracts.

## Profile-Guided Optimisation (Go 1.21+)

Go 1.21 introduced PGO. Capture a CPU profile, feed it to the compiler:

```bash
go build -pgo=default.pgo ./...
```

The compiler uses the profile to make better inlining decisions. Typical gain: 2-7%.

For a CPU-bound batcher, worth trying. Capture profile from production-realistic load.

## Disk-Backed Batchers with mmap

For ultra-high-throughput with durability, mmap the buffer to a file.

```go
fd, _ := syscall.Open("/var/lib/batcher/buf", syscall.O_RDWR|syscall.O_CREAT, 0644)
mem, _ := syscall.Mmap(fd, 0, size, syscall.PROT_READ|syscall.PROT_WRITE, syscall.MAP_SHARED)
```

Writes to `mem` go to the page cache; the OS eventually flushes to disk.

For crash-safe writes: `msync(addr, MS_SYNC)` after each write. ~10 µs per msync; slower than RAM but faster than file write.

For batchers handling regulated audit logs, this is a path. Complex; usually use a database or Kafka instead.

## TigerBeetle's I/O Batching

TigerBeetle (financial database) batches at multiple levels.

### Application Level

Up to 8190 transfers per batch. Each transfer is 128 bytes; batch is ~1 MB.

### State Machine Level

The batch is applied via a deterministic state machine: read accounts, validate, update, log.

### I/O Level

The state machine's output (log writes, account updates) is batched into 4 MB write requests, written via `io_uring`.

### Replication Level

The batch is replicated to 2 follower nodes via UDP. Acks are batched.

Result: 1M+ transfers/second on commodity hardware. Each layer of batching contributes.

Read TigerBeetle's blog and source for a state-of-the-art Go-adjacent (Zig) example.

## The 100 Microsecond Batcher

Building a batcher with 100 µs `MaxBatchDelay` is at the edge of what Go can do reliably.

### Constraints

- Go's scheduler latency: typically < 50 µs but spikes possible.
- GC pauses: < 100 µs with modern runtime; spikes during heavy alloc.
- Network: even local TCP is 100-500 µs round-trip.

### Strategies

- Pin the run loop to a dedicated core (LockOSThread + affinity).
- Use a lock-free queue to avoid scheduler involvement.
- Use a pre-allocated buffer pool.
- Disable Nagle.
- Use io_uring for batched writes.

### Realistic Targets

At 100 µs, the batcher can flush ~10000 times per second. Items per batch depend on arrival rate. At 1M items/s, 100 items/batch — small.

### Use Cases

- Trading systems: latency matters more than throughput; batching is for amortising network overhead.
- Real-time bidding: 10 ms total budget for an entire trade decision.
- Game servers: low-latency state replication.

For these, every microsecond is engineered. Go is on the edge of what is workable; many use C/Rust.

## Building a Latency-Aware Batcher

A batcher that prioritises latency over throughput:

```go
type LatencyAwareBatcher struct {
    in       chan Item
    sink     Sink[Item]
    deadline time.Duration // strict per-batch deadline
    quit     chan struct{}
}

func (b *LatencyAwareBatcher) run() {
    for {
        select {
        case item := <-b.in:
            // Open a batch with strict deadline.
            buf := []Item{item}
            deadline := time.NewTimer(b.deadline)
            for {
                select {
                case <-deadline.C:
                    // Time's up; flush.
                    b.sink.Write(context.Background(), buf)
                    deadline.Stop()
                    goto outer
                case nextItem := <-b.in:
                    buf = append(buf, nextItem)
                case <-b.quit:
                    return
                }
            }
        outer:
        case <-b.quit:
            return
        }
    }
}
```

This collects items until the strict deadline, then flushes. No size cap; latency strictly bounded.

For HFT-style workloads where every item is time-critical, this shape applies.

## A Look at Common Production Bugs at Scale

Bugs that only show up at extreme throughput.

### Bug A: Atomic Counter Overflow

```go
var count atomic.Int32
count.Add(1) // 2^31 max, overflows after ~2B ops
```

For 1M ops/s, overflow in ~35 minutes. Use `atomic.Int64`.

### Bug B: Time-Based Hash Collisions

```go
key := fmt.Sprintf("%d", time.Now().UnixNano())
```

`UnixNano` has 1 ns resolution. At 1M ops/s, collisions every microsecond. Combine with monotonic counter for uniqueness.

### Bug C: Slice Header Aliasing in Goroutines

```go
buf := make([]int, 1000)
for i := 0; i < 10; i++ {
    go process(buf[i*100:(i+1)*100])
}
```

All goroutines see the same underlying array. If they write, they corrupt. Copy per goroutine.

### Bug D: GC Pressure From Map Resizing

```go
m := map[string]int{}
for i := 0; i < 1e7; i++ {
    m[key(i)] = i
}
```

The map resizes ~30 times (doubling). Each resize copies all entries. Pre-size:

```go
m := make(map[string]int, 1e7)
```

### Bug E: Goroutine Leak Via Channels

```go
go func() {
    result := <-ch // blocks forever if no one sends
}()
```

If the caller forgets to send, the goroutine leaks. Always use ctx in selects.

### Bug F: Context Leak

```go
ctx, _ := context.WithTimeout(parent, 5*time.Second)
sink.Write(ctx, batch)
```

The cancel function is discarded. Timer leaks. Always:

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
sink.Write(ctx, batch)
```

### Bug G: Time-Of-Check Time-Of-Use

```go
if !bsp.closed { // check
    bsp.batch = append(bsp.batch, item) // use
}
```

Between check and use, another goroutine sets `closed = true` and clears `batch`. Race.

Use channels or mutexes to make check+use atomic.

### Bug H: Disk Filling From DLQ

A DLQ written to local file with no rotation grows unbounded. Use logrotate or a size-limited writer.

### Bug I: TLS Handshake Per Flush

Without keep-alive, each flush is a new TLS handshake. ~100 ms per flush, vs 5 ms with keep-alive.

Configure HTTP client for keep-alive (`Transport.MaxIdleConnsPerHost`).

### Bug J: Pool Connection Exhaustion

```go
pool, _ := pgxpool.New(ctx, dsn) // default MaxConns
```

Default `MaxConns` is `runtime.NumCPU()` (often 8). For 100 concurrent flushes, 92 wait.

Set explicitly: `MaxConns = 50` or more.

## Static Analysis for Batchers

Tools to catch bugs at compile time.

### `go vet`

Built into the Go toolchain. Catches obvious bugs (shadowed variables, lock copy).

```bash
go vet ./...
```

### `staticcheck`

`honnef.co/go/tools/cmd/staticcheck`. Stricter than `go vet`. Catches:

- Inefficient channel operations.
- Nil pointer dereferences.
- Unused code.

Run in CI.

### `ineffassign`

Finds assigned-but-unused variables. Catches "I forgot to use the result".

### `errcheck`

Finds ignored error returns. Important for sink writes.

### Custom Linters

For batcher-specific patterns, write custom linters with `golangci-lint`. Example: check that every `time.NewTicker` is followed by a `defer ticker.Stop()`.

## Compiler Optimisations

Go's compiler does some optimisations relevant to batchers.

### Escape Analysis

```go
func foo() *Item {
    item := &Item{} // escapes to heap
    return item
}
```

Returning a pointer escapes. Local values that don't escape stay on the stack.

Check with `go build -gcflags="-m"`:

```
./main.go:5:13: &Item{} escapes to heap
```

For batchers, items entering a channel typically escape. Cannot avoid; channel implementations require heap allocation.

### Inlining

Small functions are inlined. Check with `-gcflags="-m"`. Methods called via interface cannot be inlined.

For hot paths, prefer concrete types over interfaces.

### Dead Code Elimination

Unused functions and variables are removed at link time. Affects binary size but not performance directly.

## Special Optimisations: Vectorisation

For batchers that do CPU work on items (serialisation, hashing, compression), SIMD helps.

### Hash Functions

Built-in `hash/fnv` is byte-by-byte. SIMD-accelerated hashes (xxh3, t1ha) are 5-10x faster.

```go
import "github.com/zeebo/xxh3"
h := xxh3.Hash(data)
```

For per-item hashing (sharding, partitioning), this matters.

### Serialisation

`vtprotobuf` generates SIMD-friendly marshallers for protobuf. ~2x faster than the standard `proto.Marshal`.

JSON: `simdjson-go` parses 1-2 GB/s on modern CPUs. ~5x faster than encoding/json. But generates only.

### Compression

Standard `compress/gzip` is slow. Libraries:

- `github.com/klauspost/compress/gzip`: 2x faster than stdlib via SIMD.
- `github.com/klauspost/compress/zstd`: 5x faster.

For batchers compressing before send, switching libraries gives 2-5x CPU win.

### Memory Copies

`memmove` is SIMD-optimised in the Go runtime. Big copies are fast.

For very small structs (16-32 bytes), copy cost is dominated by setup, not bytes. Hard to optimise further.

## Cgo Considerations

Sometimes you need to call C from Go (e.g., librdkafka, libpq).

### Cgo Cost

A Go->C call costs ~200-1000 ns vs ~5-10 ns for a Go call. The cgo thread must transition.

For a batcher calling C per flush (e.g., `librdkafka.produce`), this is fine. Per-item C calls are too expensive.

### Threading Model

Cgo runs on its own OS thread (M). If you make many concurrent C calls, you spawn many Ms.

`runtime.LockOSThread()` ties a goroutine to an M, useful for thread-local C state.

### Memory Ownership

Go's GC does not manage C memory. Passing slices to C: ensure the slice's lifetime exceeds the C call (`C.GoString` + `runtime.KeepAlive`).

## Topology-Aware Batching

A multi-socket server has NUMA nodes. Memory access cross-socket is 2x latency.

### Per-Node Batchers

Run one batcher per NUMA node. Producers route to local. Each batcher's resources are on the local node.

### When to Care

- High-end servers (32+ cores across multiple sockets).
- Throughput > 5M items/s.
- Profile shows cross-socket memory access dominating.

### When Not

- Single-socket VMs (most cloud).
- Profile shows network/sink dominating.

## Capacity Math for Cache-Friendly Batchers

A 64 KB L2 cache fits ~1000 items of 64 bytes. Once buffer exceeds 64 KB, spills to L3.

If `MaxBatchSize * sizeof(Item) > L2`, expect cache-miss latency.

Tuning: keep batches in L2 if possible. For 64-byte items, `MaxBatchSize <= 1000` is cache-friendly.

For typical workloads, network/sink dominates. Cache effects 5-10%. Tune sink first.

## Microbenchmarking Methodology

A reliable benchmark requires care.

### Reproducibility

- Dedicated machine.
- Disable CPU frequency scaling (`cpupower frequency-set -g performance`).
- Fix `GOMAXPROCS`.
- Warm up.

### Outputs

- Throughput (items/s).
- Latency histogram (`hdrhistogram`).
- CPU usage (`pprof`).
- Memory usage.
- Allocations/op.

### Tools

- `go test -bench .`
- `benchstat` for comparison.
- `pprof`.
- `wrk`/`vegeta` for HTTP load.

End-to-end load tests in staging are the truth. Microbenchmarks miss interactions.

## How Postgres Schedules Bulk Inserts

A look at the server side of a COPY FROM operation.

### Process Architecture

Postgres uses one backend process per connection. Each connection's queries run in that process; concurrent connections run in parallel.

For a COPY FROM:

1. The backend reads from the client's socket (the COPY stream).
2. As rows arrive, the backend parses, validates, and inserts.
3. Indexes are updated per row.
4. WAL records accumulate in the WAL buffer.
5. At commit, the WAL buffer is fsync'd to disk.

### Index Update Cost

For each row inserted, every secondary index is updated. With 5 indexes, each row triggers 5 B-tree inserts.

For a 1000-row COPY: 5000 index inserts. Most fit in shared_buffers (cache). Misses go to disk.

Tuning: `shared_buffers` should be ~25% of RAM. `effective_cache_size` should match available memory.

### WAL Cost

Each row's WAL record is 30-100 bytes (more for wider rows). 1000 rows = 30-100 KB of WAL.

WAL fsync at commit: ~100 µs on SSD. Amortised across the whole COPY.

### Vacuum Interaction

Bulk INSERTs create dead tuples (e.g., from ON CONFLICT DO NOTHING). Vacuum reclaims space.

For COPY-only workloads, dead tuples are minimal. Autovacuum handles it.

### Parallel COPY?

Postgres 14+ supports parallel COPY. Multiple worker processes ingest concurrently. Useful for very large batches.

## A Closer Look at Memory Allocators

Go's allocator (in `runtime/malloc.go`) is a thread-cached size-class allocator. Each goroutine has a per-P cache (`mcache`); allocations smaller than 32 KB hit the cache; larger go to the central allocator.

### Size Classes

Small allocations are rounded up to the next size class (8, 16, 24, ..., 32 KB). For a 100-byte allocation, the actual size is 112 bytes (next class).

For a batcher's items: typical 64-128 bytes -> 1 class. Pool can reuse efficiently.

### Allocation Cost

- Per-P cache hit: ~10 ns.
- Per-P cache miss: ~50 ns (refill from central).
- Large allocation (> 32 KB): ~200 ns.

For a batcher allocating per item: 10 M items/s * 10 ns = 100 ms CPU/s. Significant.

With pool: zero allocations in steady state.

### Pointer-Free Items

Items without pointers (no slices, no maps, no interface) can use the "non-scanning" allocator path. GC skips them entirely.

For a high-throughput batcher, prefer pointer-free items:

```go
type Item struct {
    UserID [16]byte  // fixed-size byte array, not string
    Action [16]byte
    TS     int64
}
```

vs

```go
type Item struct {
    UserID string  // pointer-shaped
    Action string
    TS     time.Time
}
```

The former is allocation-friendly; the latter has GC scan cost.

## Detailed Look at the OpenTelemetry Batch Span Processor

`sdk/trace/batch_span_processor.go` (otel-go). Let us walk through it.

### Config

```go
type BatchSpanProcessorOptions struct {
    MaxQueueSize       int            // default 2048
    MaxExportBatchSize int            // default 512
    ScheduledDelay     time.Duration  // default 5s
    ExportTimeout      time.Duration  // default 30s
    BlockOnQueueFull   bool           // default false (drop)
}
```

### State

```go
type batchSpanProcessor struct {
    e        sdktrace.SpanExporter
    o        BatchSpanProcessorOptions
    queue    chan sdktrace.ReadOnlySpan
    dropped  uint32
    batch    []sdktrace.ReadOnlySpan
    timer    *time.Timer
    stopCh   chan struct{}
    stopWait sync.WaitGroup
    stopOnce sync.Once
}
```

### OnEnd

Called when a span ends:

```go
func (bsp *batchSpanProcessor) OnEnd(s sdktrace.ReadOnlySpan) {
    select {
    case bsp.queue <- s:
    default:
        atomic.AddUint32(&bsp.dropped, 1)
    }
}
```

Drop oldest on overflow. Counts drops.

### processQueue

The run loop:

```go
func (bsp *batchSpanProcessor) processQueue() {
    defer bsp.stopWait.Done()
    bsp.timer = time.NewTimer(bsp.o.ScheduledDelay)
    for {
        select {
        case <-bsp.stopCh:
            // drain and exit
            return
        case <-bsp.timer.C:
            bsp.exportSpans(reasonTime)
            bsp.timer.Reset(bsp.o.ScheduledDelay)
        case sd := <-bsp.queue:
            bsp.batch = append(bsp.batch, sd)
            if len(bsp.batch) >= bsp.o.MaxExportBatchSize {
                if !bsp.timer.Stop() {
                    <-bsp.timer.C
                }
                bsp.exportSpans(reasonSize)
                bsp.timer.Reset(bsp.o.ScheduledDelay)
            }
        }
    }
}
```

Key:
- One goroutine, channel-based.
- `time.Timer` (not Ticker) with explicit Reset.
- Drain-after-Stop pattern (`if !bsp.timer.Stop() { <-bsp.timer.C }`).

### exportSpans

```go
func (bsp *batchSpanProcessor) exportSpans(reason string) error {
    if len(bsp.batch) == 0 {
        return nil
    }
    ctx, cancel := context.WithTimeout(context.Background(), bsp.o.ExportTimeout)
    defer cancel()
    err := bsp.e.ExportSpans(ctx, bsp.batch)
    bsp.batch = bsp.batch[:0]
    return err
}
```

Per-flush ctx with timeout. Batch reset by reslice. Errors returned (the caller logs).

### Shutdown

```go
func (bsp *batchSpanProcessor) Shutdown(ctx context.Context) error {
    var err error
    bsp.stopOnce.Do(func() {
        close(bsp.stopCh)
        bsp.stopWait.Wait() // wait for processQueue to exit
        // Drain queue.
        for sd := range bsp.queue {
            bsp.batch = append(bsp.batch, sd)
        }
        if err = bsp.exportSpans(reasonShutdown); err != nil {
            return
        }
        err = bsp.e.Shutdown(ctx)
    })
    return err
}
```

Idempotent (sync.Once). Drain after run loop exits.

### Lessons

- Drop-on-overflow is fine for telemetry; not for audit logs.
- `time.Timer` with explicit Reset for precise time triggers.
- Cap (MaxQueueSize=2048) is conservative; many products override.
- Drop counter (`bsp.dropped`) exposed via stats.

Reading this code makes the patterns concrete. ~300 lines of production-quality Go.

## Inside Linux's `epoll` and Go's `netpoll`

Go's `net` package uses `epoll` on Linux (`kqueue` on BSD, `IOCP` on Windows) for non-blocking I/O.

### Send Path

When you `net.Conn.Write(b)`:

1. Go's runtime issues a `write` syscall.
2. If the socket buffer has space: write succeeds immediately, return.
3. If buffer full: kernel returns `EAGAIN`. Go parks the goroutine, registers interest with `epoll`.
4. When `epoll` reports writable: Go schedules the goroutine to retry.

For a batcher sending to a network sink, the write path is mostly fast (TCP buffers absorb bursts). Occasional slow writes happen during network congestion or downstream backpressure.

### Polling Cost

`epoll_wait` is called by Go's runtime ~once per scheduler tick. Adding more goroutines waiting for I/O adds linear overhead to `epoll_wait` (depending on the number of ready FDs).

For a batcher with 4 flush workers: 4 sockets registered. Negligible.

### SO_KEEPALIVE

If the sink's connection idles long, intermediate routers (NAT, load balancers) may close it. Set:

```go
conn.SetKeepAlive(true)
conn.SetKeepAlivePeriod(30 * time.Second)
```

For connection pools, the pool typically handles this.

### TCP_NODELAY

Disable Nagle's algorithm for latency-sensitive batchers:

```go
tcpConn.SetNoDelay(true)
```

For throughput-sensitive batchers, leave Nagle on.

## Go Scheduler and Batchers

Go's scheduler is M:N: M OS threads, N goroutines.

### Run Loop Scheduling

The batcher's run loop parks on `select` when no work. Wake latency ~1 µs.

### Preemption

Since Go 1.14, long-running goroutines can be preempted at safe points. Flush taking 100 ms can be preempted.

### `GOMAXPROCS`

Default: number of cores. Usually fine.

### CPU Affinity

For tight latency requirements:

```go
runtime.LockOSThread()
unix.SchedSetaffinity(0, &cpuSet)
```

Use sparingly.

## Garbage Collection Strategies

### Allocation Rate

100K items/s * 100 bytes = 10 MB/s allocation. GC triggers periodically.

With `sync.Pool`: ~0 MB/s steady-state.

### GC Pauses

< 100 µs in Go 1.20+. For sub-ms latency batchers, tune `GOMEMLIMIT`.

### Memory Ballast

Allocate large unused slice; heap grows; GC less frequent.

```go
ballast := make([]byte, 1<<30) // 1 GB
runtime.KeepAlive(ballast)
```

`GOMEMLIMIT` since 1.19 is the modern alternative.

## Microbenchmarks: Channel vs Lock-Free

Sample benchmark results (Intel Xeon, Go 1.21):

```
BenchmarkChannelSPSC-8           10000000   100 ns/op
BenchmarkChannelMPSC-8            5000000   200 ns/op
BenchmarkChannelMPMC-8            2000000   500 ns/op
BenchmarkLockFreeSPSC-8          50000000    25 ns/op
BenchmarkLockFreeMPSC-8          20000000    50 ns/op
BenchmarkLockFreeMPMC-8           5000000   200 ns/op
```

(SPSC=single producer single consumer, MPSC=multi/single, MPMC=multi/multi)

Lock-free is 4-10x faster at the cost of:

- Complexity (50 vs 5 lines of code).
- No backpressure semantics (spin or sleep when full).
- No close semantics (must signal with a separate flag).
- No `select` integration (must combine with timer manually).

For the typical batcher: channel-based, simpler, faster to develop and maintain.

## Profile-Driven Optimisation: A Worked Example

Real story: an audit log batcher at 30K req/s, CPU at 60%, need to handle 100K req/s.

### Initial Profile

```
runtime.chansend          22%
encoding/json.Marshal     18%
runtime.malloc            12%
crypto/tls.write          10%
syscall.Syscall           8%
runtime.findrunnable      6%
runtime.scheduler         5%
... (rest)               19%
```

### Diagnoses

- 22% in `chansend`: channel contention.
- 18% in `json.Marshal`: slow serialisation.
- 12% in `malloc`: high allocation rate.

### Fixes

#### Fix 1: Reduce serialisation cost

Replace `encoding/json` with `easyjson`. Generates type-specific marshallers, no reflection.

Result: 18% -> 7% in serialisation. Throughput +15%.

#### Fix 2: Reduce allocations

- `sync.Pool` for batch slices.
- Reuse JSON buffers.
- Items by-value instead of by-pointer where small.

Result: 12% -> 4% in malloc. Throughput +10%.

#### Fix 3: Reduce channel contention

- Shard the input channel into 4 channels (hash by item.UserID % 4).
- Per-shard run loop.

Result: 22% -> 8% in chansend. Throughput +20%.

#### Combined

After all three: 60% CPU at original throughput; can sustain 90K req/s (3x). Hit the 100K req/s target with 75% CPU.

### Lessons

- Profile first. Each fix targets a real hot spot.
- Three changes; three measurable wins.
- The biggest gain was channel sharding, not what you might guess.

## A Different Profile

A different service: 5K req/s, latency p99 100 ms (target: 50 ms).

### Profile

```
syscall.Syscall6 (network write)   60%
crypto/tls.write                   15%
runtime.netpoll                    8%
encoding/json.Marshal              5%
... (rest)                        12%
```

### Diagnosis

Sink-bound. The batcher is fine; the network call is slow.

### Fixes

- Investigate downstream. Is the sink at its capacity?
- Reduce per-flush latency: smaller batches (faster downstream response), more concurrent flushes.
- TLS tuning: session resumption, larger buffers.
- Network: keepalive, larger TCP send buffer.

In this case, no batcher-level optimisation helps. The fix is upstream of the wire.

## Persistent Buffers: An Implementation

A simple persistent batcher using BadgerDB:

```go
type PersistentBatcher struct {
    db       *badger.DB
    in       chan Item
    sink     Sink[Item]
    maxSize  int
    maxDelay time.Duration
}

func (p *PersistentBatcher) Add(item Item) error {
    // First, persist to BadgerDB.
    key := []byte(uuid.New().String())
    val, _ := json.Marshal(item)
    err := p.db.Update(func(txn *badger.Txn) error {
        return txn.Set(key, val)
    })
    if err != nil {
        return err
    }
    // Then enqueue for flush.
    p.in <- Item{ID: string(key), Body: item}
    return nil
}

func (p *PersistentBatcher) run() {
    buf := []Item{}
    keys := [][]byte{}
    ticker := time.NewTicker(p.maxDelay)
    flush := func() {
        if len(buf) == 0 {
            return
        }
        if err := p.sink.Write(ctx, buf); err != nil {
            // Items still in BadgerDB; retry on next run.
            return
        }
        // Flush succeeded; delete from BadgerDB.
        p.db.Update(func(txn *badger.Txn) error {
            for _, k := range keys {
                txn.Delete(k)
            }
            return nil
        })
        buf = buf[:0]
        keys = keys[:0]
    }
    for {
        select {
        case item := <-p.in:
            buf = append(buf, item.Body)
            keys = append(keys, []byte(item.ID))
            if len(buf) >= p.maxSize {
                flush()
            }
        case <-ticker.C:
            flush()
        }
    }
}
```

On startup, drain remaining items from BadgerDB:

```go
func (p *PersistentBatcher) recover() {
    p.db.View(func(txn *badger.Txn) error {
        it := txn.NewIterator(badger.DefaultIteratorOptions)
        defer it.Close()
        for it.Rewind(); it.Valid(); it.Next() {
            item := it.Item()
            val, _ := item.ValueCopy(nil)
            var ev Item
            json.Unmarshal(val, &ev)
            p.in <- Item{ID: string(item.Key()), Body: ev}
        }
        return nil
    })
}
```

### Throughput

BadgerDB sync writes: 10-50K writes/s. The persistent batcher's `Add` is limited to this.

For higher throughput, use BadgerDB's async mode (Set with `WithSync(false)`); but then crash-safety is lost.

### Trade-offs

- Pro: items persist before flush. Crash-safe.
- Con: 10-100x throughput hit vs in-memory.
- Con: storage growth; manage retention.

Use only when in-memory loss is unacceptable and upstream replay is impossible.

## Microbenchmarks: Channel vs Lock-Free

A close look at what `linger.ms` and `batch.size` do in librdkafka and franz-go.

### State Machine

For each partition the producer has a buffer. The buffer holds records. Each record has a serialised size.

States:
- **Empty**: no records.
- **Accumulating**: records being added.
- **Ready**: the buffer has been "sealed" (full or linger expired).

Transition Accumulating -> Ready:
- Buffer's serialised size >= `batch.size`: size trigger.
- Time since first record >= `linger.ms`: time trigger.
- Manual flush: explicit trigger.

Once Ready, the buffer is queued for sending. A sender goroutine drains the queue, builds produce requests, sends.

### Buffer Management

Buffers are allocated from a memory pool. The pool's total size is bounded by `buffer.memory` (default 32 MB in librdkafka).

If the pool is exhausted, producer's `Produce` calls block (or return error if non-blocking). This is the producer-side backpressure.

### Batch Construction

A produce request can carry many batches (one per partition). The sender:

1. Picks records up to per-partition `batch.size`.
2. Compresses if `compression.type != none`.
3. Builds a binary protocol message with batch headers.
4. Sends to the partition's leader broker.

### Compression Trade-offs

- `none`: fastest CPU, biggest wire bytes.
- `snappy`: fast CPU (~500 MB/s decompress), moderate size (typical 2-3x).
- `lz4`: similar to snappy.
- `gzip`: slow CPU (~50 MB/s), great size (5-10x).
- `zstd`: tunable; level 1 similar to lz4, level 9 similar to gzip but faster.

Typical choice: `zstd` for new deployments. `snappy` for older clusters.

### Acks and Retries

- `acks=0`: producer doesn't wait. Fastest, no durability.
- `acks=1`: leader acks after local write. Moderate.
- `acks=all`: leader waits for all in-sync replicas. Strongest.

For audit logs: `acks=all`. For metrics: `acks=1` is often acceptable.

`retries` and `retry.backoff.ms` handle transient errors. With `enable.idempotence=true`, retries are safe (no duplicates).

### When to Wrap With An App-Level Batcher

When the application has cross-partition combining (e.g., dedupe across partitions), per-partition Kafka batching cannot help.

When the application produces at a rate where Kafka's internal linger does not fully amortise: e.g., 1 record/s per partition; linger.ms of 5 does not help if records arrive every second.

Otherwise, rely on Kafka's batching.

## Reading Postgres Source for COPY

To understand why COPY is fast, read the Postgres source.

### Entry Point

`src/backend/commands/copy.c` is the COPY implementation. The `CopyFrom` function handles `COPY ... FROM ...`.

### Bulk Insert Path

Within `CopyFrom`:

1. Open the relation (table).
2. Set up MVCC snapshot.
3. For each row:
   - Read row from input stream.
   - Parse fields (binary or text format).
   - Insert into heap.
   - Insert into indexes.
   - Generate WAL record.
4. After all rows, commit.

The key optimisation: index inserts and WAL records are deferred until end-of-batch where possible. Constraint checks are streamed alongside rows.

### Binary vs Text

Text format: each value parsed as a string, converted to internal type. ~5 µs per field.

Binary format: each value read directly into internal type representation. ~1 µs per field.

For 3-column rows of typical types: text format is ~15 µs per row, binary ~3 µs per row.

### WAL Behavior

Each row's WAL record is appended to the WAL buffer. At commit, the buffer is fsynced.

For COPY, the WAL buffer can hold many rows. One fsync amortises across them all.

### Comparison to Multi-Row INSERT

Multi-row INSERT:

1. Parse SQL.
2. Plan query.
3. For each VALUES row:
   - Parse the row's values.
   - Insert.
   - Index.
   - WAL.

Multi-row INSERT has parser and planner overhead per call but no per-row parse. COPY skips parser entirely.

For 1000 rows:

- Single INSERTs: 50 ms (50 µs * 1000).
- Multi-row INSERT: 5 ms (1 ms parse + 4 ms execute).
- COPY: 1 ms.

These numbers depend on schema, indexes, and hardware, but the *ratio* is consistent: COPY 5x faster than multi-INSERT, multi-INSERT 10x faster than single.

## Postgres Server Tuning for Batchers

Server-side knobs that affect batcher throughput:

### `synchronous_commit`

- `on` (default): every commit waits for WAL fsync.
- `local`: commit waits for local fsync only (in replication: don't wait for standbys).
- `remote_write`: waits for standby to receive (but not fsync).
- `off`: commit returns immediately; WAL fsync is asynchronous. Risk of recent commits lost on crash.

For audit logs that *must* be durable: `on`. For high-throughput metrics: `off` can 10x throughput at the cost of up to 200 ms data loss on crash.

### `commit_delay` and `commit_siblings`

When a transaction commits, wait up to `commit_delay` µs if `commit_siblings` other transactions are in progress. Amortises fsync.

Set `commit_delay = 1000` (1 ms) and `commit_siblings = 5`: writes with 5+ concurrent transactions wait 1 ms to batch fsyncs. Improves throughput when many transactions concurrent.

### `wal_buffers`

WAL buffer size. Default 1/32 of shared_buffers, capped at 16 MB. For COPY-heavy workloads, larger buffers (32-64 MB) reduce WAL writes.

### `checkpoint_timeout` and `max_wal_size`

Checkpoints write all dirty buffers to disk. Less frequent checkpoints = better throughput but longer recovery.

For COPY-heavy workloads:

- `checkpoint_timeout = 30min`.
- `max_wal_size = 32GB`.

### `effective_io_concurrency`

For SSDs, set to 200-1000. Tells Postgres to prefetch aggressively.

These are DBA-level tuning. Read Postgres docs for full context.

## Memory Subsystem and Batchers

A modern CPU has a hierarchy of caches: L1 (~32 KB per core, ~1 ns), L2 (~256 KB per core, ~3 ns), L3 (~8 MB shared, ~10 ns), main memory (~100 ns).

For a batcher, where does data live?

### Items in the Input Channel

The channel's internal buffer is on the heap. For a 1024-slot channel of 8-byte items, that is 8 KB — fits in L1 of the producer's and consumer's cores.

If producer and consumer are on different cores, the buffer's cache line bounces between them: write by producer invalidates consumer's copy; read by consumer invalidates producer's copy. Each bounce is ~100 ns.

For 10M items/s, 10M bounces/s = 1 second of cache-coherence traffic per second. The buffer is the contention point.

Mitigations:
- One producer, one consumer: clear ownership, less bouncing.
- Per-producer channels with a single consumer: producer owns its channel; consumer fan-ins.
- Lock-free queues with per-slot owners: each slot has a sequence number; producer claims, consumer releases.

### Items in the Buffer Slice

The batcher's slice is allocated on the heap. The slice header is on the run loop's stack; the backing array on the heap.

For a `MaxBatchSize = 100` slice of 64-byte items, the array is 6400 bytes — fits in L1.

For `MaxBatchSize = 1000`, the array is 64 KB — exceeds L1, fits in L2.

For `MaxBatchSize = 100000`, the array is 6.4 MB — exceeds L3, main memory.

Cache-friendly batches (fit in L2) are processed 2-5x faster than cache-unfriendly. There is a "cache knee" in the batch-size curve.

### Items Being Serialised

A typical serialiser (encoding/json) reads each item, writes its bytes into a buffer. Both reads and writes have spatial locality if the buffer fits in cache.

For a 1 MB serialisation buffer, it fits in L2. For a 100 MB buffer, it spills to main memory and serialisation slows.

This is why incremental serialisation (one item at a time, into a fixed-size network send buffer) is often as fast as bulk serialisation (full batch in memory).

### False Sharing

If two counters are adjacent in memory (same cache line), updating one invalidates the other. Both readers and writers fight.

Fix: pad to cache-line boundaries.

```go
type paddedCounter struct {
    v   atomic.Int64
    _   [56]byte // total 64 bytes
}

type Batcher struct {
    enqueued    paddedCounter
    flushedOK   paddedCounter
    flushedFail paddedCounter
}
```

Without padding, three atomics in one cache line: contention every increment.

For high-throughput counters, padding matters. For low-throughput, ignore.

## A Deep Dive Into Go Runtime Internals for Batchers

This section is for the engineer who wants to understand what their batcher costs at the runtime level. We will trace every nanosecond from the moment a producer calls `Add` until the sink starts the network write.

### Phase 1: Producer Call

```go
b.Add(item)
```

What happens on x86-64 Go 1.21:

- Stack frame setup: ~2 ns.
- Method dispatch (interface call): ~5-10 ns. For concrete types, ~2 ns.
- Argument copy: depends on item size.

Total: 5-20 ns before any batcher logic runs.

### Phase 2: Inside Add

```go
func (b *Batcher) Add(item Item) {
    b.in <- item
}
```

The channel send:

- Lock acquire: ~10 ns uncontended, ~100 ns under contention.
- Buffer check: ~3 ns.
- Memmove of item into buffer: depends on size (5-50 ns for typical items).
- Increment counters: ~3 ns.
- Lock release: ~5 ns.

Total: ~25-80 ns for a buffered, uncontended channel.

### Phase 3: Run Loop Wake

The select sees the receive case ready:

- Lock acquire on receive: ~10 ns.
- Memmove from buffer to local: same as before.
- Decrement counters: ~3 ns.
- Wake potential sender: if a producer is parked, wake it (~500 ns).
- Lock release: ~5 ns.

Total: ~30-100 ns receive.

### Phase 4: Append to Buffer

```go
buf = append(buf, item)
```

- Capacity check: ~2 ns.
- Memmove into slot: 5-50 ns.
- Increment length: ~1 ns.

Total: ~10-60 ns.

### Phase 5: Size Trigger Check

```go
if len(buf) >= b.maxSize { ... }
```

- 2 loads, 1 compare, 1 branch: ~5 ns.

### Phase 6: Flush Setup

```go
batch := make([]Item, len(buf))
copy(batch, buf)
buf = buf[:0]
```

- Allocation: ~30-100 ns for cap-aligned small allocs, more for large.
- Memmove: O(N) where N is batch size. For 100 items of 64 bytes: ~10 ns (one cache line) plus memmove overhead.
- Slice reslice: ~1 ns.

Total: ~50-200 ns for typical batches; more for large ones.

### Phase 7: Sink Call

```go
b.sink.Write(ctx, batch)
```

- Method dispatch: ~5 ns for concrete, ~10 ns for interface.
- Then it is up to the sink. A typical Postgres COPY:
  - Acquire connection from pool: 5-100 ns (uncontended) or microseconds (contended).
  - Send COPY command: 1-2 ms (network round-trip).
  - Stream rows: 1 ms per 1000 rows.
  - Ack: 1-2 ms.

The sink dominates by orders of magnitude.

### Summary of Per-Item Cost

In steady state, per item (not counting sink):

- Add: ~50 ns.
- Receive in run loop: ~40 ns.
- Append: ~20 ns.
- Per-batch overhead amortised across items: ~1 ns/item.

Total batcher overhead: ~100-150 ns per item. At 10M items/s, that is 1-1.5 seconds of CPU per second — *single core*. So at extreme throughput, the batcher itself is a bottleneck around 10M items/s.

### When This Matters

For 99.99% of batchers: never. Throughput ceiling is 10M items/s on one core; few services hit it.

For HFT, in-process telemetry, custom databases: matters. Lock-free queues, custom scheduling, NUMA awareness all come into play.

## Inside Go's Channel Implementation

Let us read `runtime/chan.go` and understand what happens during a send.

### The `hchan` Struct

```go
type hchan struct {
    qcount   uint           // total data in the queue
    dataqsiz uint           // size of the circular queue
    buf      unsafe.Pointer // points to an array of dataqsiz elements
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint   // send index
    recvx    uint   // receive index
    recvq    waitq  // list of recv waiters
    sendq    waitq  // list of send waiters
    lock     mutex
}
```

For a buffered channel: a circular array of element slots plus head/tail indices. For unbuffered: only the wait queues matter.

### Send Path (Simplified)

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool) bool {
    if c == nil {
        if !block { return false }
        gopark(nil, nil, ...) // park forever (nil channel)
    }
    lock(&c.lock)
    if c.closed != 0 {
        unlock(&c.lock)
        panic("send on closed channel")
    }
    // Fast path: a receiver is waiting.
    if sg := c.recvq.dequeue(); sg != nil {
        send(c, sg, ep, ...) // direct copy to receiver's stack
        unlock(&c.lock)
        return true
    }
    // Buffer has space.
    if c.qcount < c.dataqsiz {
        qp := chanbuf(c, c.sendx)
        typedmemmove(c.elemtype, qp, ep)
        c.sendx++
        if c.sendx == c.dataqsiz { c.sendx = 0 }
        c.qcount++
        unlock(&c.lock)
        return true
    }
    // Block.
    if !block { unlock(&c.lock); return false }
    // Enqueue self on sendq, park.
    sg := acquireSudog()
    sg.elem = ep
    sg.g = getg()
    c.sendq.enqueue(sg)
    gopark(chanparkcommit, unsafe.Pointer(&c.lock), ...)
    // After unpark:
    releaseSudog(sg)
    return true
}
```

Key observations:

- The lock is held briefly. Acquire, check, release. ~30-50 ns under no contention.
- Direct hand-off (receiver waiting): copy goes from sender's stack to receiver's stack. No buffer involved. ~70 ns.
- Buffered send: copy into the buffer. Increment `sendx`. ~50 ns.
- Blocked send: enqueue on sendq, park goroutine. Wakes when receiver dequeues. Microseconds, not nanoseconds.

### Implications for Batchers

A batcher's `Add` is a channel send. Steady-state cost: ~50-100 ns. At 10M items/s, the channel itself is 500 ms-1000 ms of CPU per second — at the limit of a single channel.

For comparison: the run loop's `select` adds another ~30 ns; `append` to the buffer is ~5 ns. The channel dominates.

### `select` Implementation

A `select` with N cases:

1. Lock all channels' locks (in address order to prevent deadlock).
2. Check each case for readiness.
3. If any ready, pick one randomly, unlock others, return.
4. If none ready, enqueue on each, unlock all, park.
5. On wake, dequeue from others.

The lock-all step is O(N). For 2 cases (input + ticker), it is fast. For 10 cases, it is slower.

### When Channel Performance Bottlenecks

Symptoms:

- `go tool pprof` shows `runtime.chansend` in top 5 functions.
- Throughput plateaus despite reducing other overhead.
- Adding goroutines does not help.

Mitigations:

- **Sharded channels**: many channels, one consumer per shard. The lock-contention is per-channel.
- **Batched send**: send a slice of items per channel op, not one item.
- **Lock-free queue**: replace channel with Vyukov-style MPMC ring. Last resort.

For 99.9% of batchers, none of these apply. The sink dominates.

## Inside `time.NewTicker`

Tickers are managed by the runtime timer heap (in `runtime/time.go`).

### The Timer Heap

A per-P (per processor) heap of pending timers. Each P checks its heap at safe points; expired timers fire by sending on their channel.

For a ticker with interval D:

- Heap entry created on `NewTicker`.
- When timer fires, the runtime sends current time on `t.C` (non-blocking; the channel is buffered 1).
- The timer is reinserted with `prev_fire + D`.

This means ticker uses 0 goroutines. The runtime drives it.

### Drift

If the consumer is busy, multiple intended-fires coalesce into one. The runtime queues at most one tick at a time. After consumer wakes, the next tick is scheduled relative to the *now-current* time, not the missed schedule. Some drift accumulates but is bounded.

### Stop

`ticker.Stop()` removes the heap entry. Without Stop, the entry remains until the ticker is GC'd; but the runtime keeps a reference, so the ticker is never GC'd. Forgetting Stop is a real leak.

### Reading the Source

`runtime/time.go` has the timer code. Look for `addtimer`, `deltimer`, `runtimer`. About 1000 lines; the ticker subset is ~200.

## Inside `sync.Pool`

`sync.Pool` is the standard tool for per-CPU object reuse. The implementation in `sync/pool.go` is ~500 lines.

### Per-P Storage

Each P (GOMAXPROCS goroutines worth of state) has a local pool. `Get` first checks local, then peers, then the global pool.

### GC Interaction

After each GC, half of the pool is cleared. This prevents indefinite growth but means pools cannot be relied on for "permanent" caches.

### Use in Batchers

For batch slices:

```go
var batchPool = sync.Pool{
    New: func() interface{} {
        return make([]Item, 0, defaultCap)
    },
}

func flush(buf []Item) {
    batch := batchPool.Get().([]Item)[:0]
    batch = append(batch, buf...)
    defer batchPool.Put(batch)
    sink.Write(batch)
}
```

Per-flush allocation is replaced by pool get/put (~30 ns each).

### Caveat: Item Lifetimes

If the sink stores the batch beyond `Write`'s return, do not return it to the pool. The pool assumes ownership transfers back.

## Inside `pgx.CopyFrom`

The CopyFrom path in pgx (file `pgconn/pgconn.go` and `pgtype/`).

### What Happens

1. `conn.CopyFrom(ctx, table, cols, source)`.
2. pgx sends `COPY table (cols) FROM STDIN BINARY` to Postgres.
3. Postgres responds `CopyInResponse`.
4. pgx writes a 11-byte binary signature: `PGCOPY\n\xff\r\n\0`.
5. For each row from `source.Next()`:
   - Read row values from source.
   - Encode each value in binary (~10-100 ns per value depending on type).
   - Write to a 65 KB buffer.
   - When buffer fills, send a `CopyData` message to Postgres.
6. After all rows, send the trailer `\xff\xff` and `CopyDone`.
7. Postgres acks; CopyFrom returns row count.

### Why It Is Fast

- Binary encoding is faster than SQL parsing.
- Streaming: server consumes as data arrives; client can pipeline.
- Single transaction; one WAL commit.
- No query plan caching needed.

### Comparing Throughputs

For a 3-column row with int64, text(100), timestamptz:

- INSERT: ~50 µs per row (including parse, plan).
- Multi-row INSERT (100 rows): ~3 µs per row.
- COPY FROM: ~1 µs per row.

COPY is roughly 3x faster than multi-row INSERT and 50x faster than single-row INSERT.

### Batch Size Tuning

Postgres can handle COPY batches of any size; the bottleneck is the server's WAL fsync. For 100 rows per second sustained, batch size 100 is fine. For 100K rows/s, batch size 10K-100K maximises throughput.

The TCP send buffer also matters: 65 KB is a reasonable chunk; smaller wastes packets; larger may not improve.

## Inside the Kafka Producer

Reading the franz-go source (`pkg/kgo/`):

### `Produce` Path

1. `client.Produce(ctx, record, callback)`.
2. The record is added to a per-partition buffer.
3. If the buffer reaches `batch.size`, it is "sealed" (immutable) and queued for sending.
4. If `linger.ms` elapses with non-empty buffer, it is sealed.
5. A sender goroutine drains the queue, builds produce requests, sends.

### Compression

Sealed batches are compressed (gzip, snappy, zstd, lz4). franz-go does this in the sender goroutine.

### Retries

If a produce request fails, franz-go retries based on `RequestRetries`. Idempotent producers (`enable.idempotence`) use sequence numbers to dedupe.

### Acks

`acks=all` is the default. The broker waits for all in-sync replicas before acking. Throughput is ~half of `acks=1`.

### Why "linger.ms" Is Important

Without linger, every produce call triggers a network round-trip. With linger.ms=5, multiple records within 5 ms are batched. For high-throughput producers, linger.ms=5 doubles throughput at the cost of 5 ms latency.

## Memory Layout Optimisation

For ultra-high-throughput batchers, struct layout matters.

### Item Struct

```go
type Item struct {
    UserID    [16]byte // 16
    Action    [16]byte // 32
    Timestamp int64    // 40
    Payload   [64]byte // 104
}
```

`unsafe.Sizeof(Item{}) == 104`. Aligned to 8 bytes, the struct is 104 bytes — does not fit in one 64-byte cache line.

If we split:

```go
type ItemHot struct { // 64 bytes, fits one cache line
    UserID    [16]byte
    Action    [16]byte
    Timestamp int64
    Pad       [24]byte
}

type ItemCold struct { // payload, allocated separately
    Payload [64]byte
}
```

The "hot" part fits in one cache line; scanning a slice of items hits each in one cache load. The cold part is dereferenced only when needed.

For batchers that do bulk scanning (e.g., per-tenant routing), this can speed things up 2x.

### Slice Header

```go
type slice struct {
    array unsafe.Pointer // 8
    len   int            // 16
    cap   int            // 24
}
```

24 bytes. A `[][]Item` (slice of slices) has each inner slice's header on the heap. For 1000 sub-buffers, that is 24 KB of slice headers plus the actual data.

Implication: per-tenant batchers with thousands of tenants have non-trivial overhead just in slice headers. Use `sync.Pool` for sub-buffers if memory is tight.

## Detailed CPU Profile Walkthrough

A real `pprof` session on a batcher under load.

### Setup

```go
import _ "net/http/pprof"
go http.ListenAndServe("localhost:6060", nil)
```

### Capture

```bash
go tool pprof -seconds=30 -http=:8080 localhost:6060/debug/pprof/profile
```

### Top View

In a healthy batcher, top functions are:

1. `syscall.Syscall6` (network I/O to sink): 30-50%.
2. `runtime.netpoll` (network polling): 5-10%.
3. `crypto/tls.write` (TLS): 5-10%.
4. `encoding/json.Marshal` (serialisation): 5-15%.
5. `runtime.chansend`: 1-5%.
6. `runtime.selectgo`: 1-3%.

If anything in the runtime layer is in the top 3, there is a bottleneck:

- `runtime.findrunnable`: scheduler overload; too many goroutines.
- `runtime.gcAssistAlloc`: GC overload; reduce allocations.
- `runtime.mutex_lock`: lock contention; sharding or atomics.

### Flame Graph

The flame graph shows call stacks. Look for:

- Wide bases: time spent at a level. Sink calls usually dominate.
- Tall stacks: deep call chains. May indicate inefficient code paths.

### Allocation Profile

```bash
go tool pprof -http=:8080 localhost:6060/debug/pprof/heap
```

Top allocators in a healthy batcher:

1. `make([]Item, ...)`: batch allocations on flush. Reduce with sync.Pool.
2. `runtime.newobject`: misc allocations. Profile shows which type.
3. `encoding/json.Marshal`: serialisation buffers. Reuse.

Top in an unhealthy batcher:

- Allocations in the run loop's hot path: indicates a forgotten optimisation.
- Per-Add allocations: items escape to heap unnecessarily.

### Goroutine Profile

```bash
curl localhost:6060/debug/pprof/goroutine?debug=1
```

A healthy batcher:

- 1 main goroutine.
- 1 run loop goroutine.
- N flush worker goroutines.
- M producer goroutines (depends on workload).

Anomalies:

- Goroutines stuck in `chan send`: backpressure (probably fine).
- Goroutines stuck in `select` with same stack: leaked goroutines.
- Growing goroutine count: leak.

## Practical Lock-Free Batcher

A working lock-free batcher using `lockfree` library. Pseudocode:

```go
import "github.com/scryner/lfreequeue"

type LFBatcher[T any] struct {
    q       *lfreequeue.Queue
    sink    Sink[T]
    maxSize int
    quit    atomic.Bool
}

func (b *LFBatcher[T]) Add(v T) {
    b.q.Enqueue(v)
}

func (b *LFBatcher[T]) run() {
    buf := make([]T, 0, b.maxSize)
    for !b.quit.Load() {
        v, ok := b.q.Dequeue()
        if !ok {
            if len(buf) > 0 {
                b.sink.Write(context.Background(), buf)
                buf = buf[:0]
            }
            runtime.Gosched()
            continue
        }
        buf = append(buf, v.(T))
        if len(buf) >= b.maxSize {
            b.sink.Write(context.Background(), buf)
            buf = buf[:0]
        }
    }
}
```

Throughput vs channel-based: ~2x in microbenchmarks. Latency: slightly higher (Gosched-based spinning).

For most workloads, channels win on overall code clarity and feature completeness. Lock-free is for the 0.1%.

## io_uring for Batched I/O

Linux 5.1+ provides `io_uring` for asynchronous I/O via a ring buffer:

```c
// Simplified pseudocode
struct io_uring ring;
io_uring_queue_init(64, &ring, 0);

// Submit a batch of writes
for (int i = 0; i < n; i++) {
    sqe = io_uring_get_sqe(ring);
    io_uring_prep_write(sqe, fd, buf+i, sz);
}
io_uring_submit(ring);

// Wait for completions
for (int i = 0; i < n; i++) {
    io_uring_wait_cqe(ring, &cqe);
    io_uring_cqe_seen(ring, cqe);
}
```

One `io_uring_submit` syscall covers many writes. Massively reduces per-write overhead.

Go libraries:

- `github.com/iceber/iouring-go`
- `github.com/godzie44/go-uring`

Use case: high-throughput log writers, custom databases, network proxies. For batchers writing to remote sinks, the bottleneck is usually network latency, not syscall count; io_uring is overkill.

## Garbage Collector Interactions

Go's GC is concurrent but not free. A batcher with high allocation rate stresses it.

### GC Triggers

GC runs when heap doubles. With `GOGC=100` (default), if you allocate 100 MB, GC runs after 200 MB. Lowering `GOGC` makes GC more frequent (less peak memory, more CPU); raising it does the opposite.

### Pause Time

A typical GC pause is < 100 µs on modern hardware. For low-latency batchers, this matters; for typical batchers, it does not.

### Reducing Pressure

- Use sync.Pool for hot allocations.
- Reuse buffer slices.
- Avoid `interface{}` where possible (forces allocation).
- Avoid maps with frequent resize.

Profile with `go tool pprof -alloc_space` and `go tool trace` to see GC pauses.

### Tuning `GOGC` and `GOMEMLIMIT`

For batchers with predictable memory:

- `GOGC=50`: more frequent GC, lower peak memory.
- `GOMEMLIMIT=2GiB`: cap memory; GC triggers earlier.

Useful for tight memory budgets. Profile both to find the sweet spot.

## OpenTelemetry's Batch Processor

Reading `sdk/trace/batch_span_processor.go`:

### Configuration

- `MaxQueueSize`: queue depth.
- `MaxExportBatchSize`: batch size.
- `ScheduledDelay`: time trigger.
- `ExportTimeout`: per-flush timeout.

Defaults: 2048, 512, 5s, 30s.

### Architecture

- One goroutine, channel-based queue.
- Drop oldest on overflow.
- Synchronous flush.
- Reason-tagged exports.
- Shutdown drains with deadline.

### Lessons

- Drop oldest is a reasonable default for telemetry; not appropriate for audit logs.
- 5s is conservative; many products override to 1s.
- Shutdown with 30s deadline is generous; align with your service's shutdown SLA.

### Customisation

Implement `sdktrace.SpanProcessor` if the built-in does not fit. You can layer a retry decorator, a circuit breaker, etc.

## Custom Scheduling

For ultra-low latency batching, custom scheduling helps:

### Goroutine Pinning

```go
runtime.LockOSThread()
```

Pins the goroutine to an OS thread; that thread is dedicated to this goroutine. Prevents preemption.

### CPU Affinity

```go
import "golang.org/x/sys/unix"
var set unix.CPUSet
set.Set(coreID)
unix.SchedSetaffinity(0, &set)
```

Pin OS thread to a specific CPU core. Reduces cache misses (the thread always runs on the same cache).

### Real-Time Scheduling

```go
unix.SchedSetscheduler(0, unix.SCHED_FIFO, &unix.SchedParam{Priority: 1})
```

Set the thread to real-time priority. Linux schedules it ahead of normal threads.

Use with caution: a poorly-behaved RT thread can starve the system.

## When Optimisations Don't Help

A senior pattern: spend hours optimising the run loop, discover the sink is 99% of the time.

Always profile before optimising. The biggest gain is often in:

- Sink-side configuration (pool size, query plans, batch_size).
- Network configuration (TCP keepalive, send buffer).
- Hardware (faster disk, more cores).

Application-level micro-optimisations are the last 10-20%. Get the architecture right first.

## Frontier Topics

What we did not cover but exists:

### eBPF for Telemetry

eBPF lets you observe and modify a running process. Custom probes can track batch sizes, flush timings, lock contention, without changing app code. Used in Cilium, Pixie, Parca.

### Custom Schedulers

Some HFT shops write custom userspace schedulers in C, leaving Go's runtime for parts that don't need to be ultra-fast. Mostly proprietary.

### NIC Offload

Modern NICs can offload TLS, compression, even sending. `SO_ZEROCOPY` on Linux. Useful for very high-throughput streams.

### Persistent Memory

NVMe-attached persistent memory (Optane, DCPMM) blurs RAM and disk. Batchers could checkpoint into PM at near-RAM speeds.

These are advanced topics. Most Go engineers never need them.

## Summary

Professional batching is about depth: knowing what `chan T` allocates, what Kafka does between `Produce` and durable storage, why Postgres COPY beats INSERT, when NUMA matters, how to profile down to allocations.

You now have the toolkit to:

- Diagnose any batcher's performance limits.
- Make informed choices about lock-free vs channel-based.
- Tune database-side batching (group commit, WAL).
- Read and reason about real Kafka, Postgres, and OpenTelemetry source.

The middle and senior files give you the patterns. This file gives you the *understanding* behind the patterns. Both are required for staff-level engineering on data plane systems.
