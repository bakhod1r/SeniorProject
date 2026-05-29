# Monotonic Queue — Senior Level

## Table of Contents

1. [Introduction](#introduction)
2. [Streaming Sliding-Window Aggregates](#streaming-sliding-window-aggregates)
3. [Rate Limiting with Window Extremes](#rate-limiting-with-window-extremes)
4. [Financial Telemetry: Rolling High and Low](#financial-telemetry-rolling-high-and-low)
5. [Network Jitter and Latency Tracking](#network-jitter-and-latency-tracking)
6. [Distributed Sliding-Window Aggregation](#distributed-sliding-window-aggregation)
7. [Memory-Constrained Approximation](#memory-constrained-approximation)
8. [Observability](#observability)
9. [Concurrency](#concurrency)
10. [Failure Modes](#failure-modes)
11. [Summary](#summary)

---

## Introduction

> Focus: "How do production systems use a monotonic deque, and what breaks at scale?"

At the algorithmic level a monotonic deque is a textbook sliding-window-max gadget. In production, the same structure shows up wherever a service needs to maintain a rolling extremum over a recent time window — and the engineering questions are no longer about correctness but about throughput, concurrency, memory bounds, and what to do when the window does not fit in memory.

This document is about those engineering questions. The classic O(n) algorithm is given; what changes is the surrounding system.

---

## Streaming Sliding-Window Aggregates

Stream processors compute aggregates over the most recent `W` events or the last `T` seconds. Cheap aggregates (sum, count) are easy via a running counter. Expensive aggregates — max, min, percentiles — need a structure.

**Max / min:** Monotonic deque. Each event is pushed once, popped at most once -> amortized O(1) per event. Memory bounded by `W`.

**Median / percentiles:** Monotonic deque cannot help — these are *order statistics*, not extremes. Common approximations:
- **t-digest** (concentrated near tails, used by Datadog, Elasticsearch percentile metrics)
- **HDR histogram** (fixed-resolution bucketing, common in Java services)
- **Indexed skip list with lazy deletion** when exact percentiles are required and W is small

**When monotonic deque is the right call:**
- Rolling max bid in an ad auction over the last 5 seconds
- Rolling high-water mark of queue depth for backpressure decisions
- Rolling peak request rate for rate-limit decision

The structure becomes interesting once events have **timestamps that may not be evenly spaced**. Expiration is no longer "index < i - k + 1"; it is "timestamp < now - window_duration." The data is still indices (or pointers to ring-buffer entries), but the expiration predicate is wall-clock-based.

```text
struct Event { time_ms, value }
deque<EventRef> dq  // ordered by enqueue time

on new event e:
    while dq not empty and dq.front().time_ms < e.time_ms - WINDOW_MS:
        dq.pop_front()
    while dq not empty and dq.back().value < e.value:
        dq.pop_back()
    dq.push_back(e)
    current_max = dq.front().value
```

Two subtleties at this scale:

1. **Out-of-order events.** If event timestamps can arrive late, you must either (a) buffer briefly and sort before feeding into the deque, or (b) accept that the rolling max is approximated by the order of arrival. Real stream processors (Apache Flink, Kafka Streams) deal with this via *watermarks* and *event-time windows*.
2. **Window slides by time, not by event count.** Multiple events may expire on a single push if there has been a long gap. The amortization still holds — each event is popped at most once across the whole stream.

---

## Rate Limiting with Window Extremes

A simple **fixed-window rate limit** ("max 100 req/s per user") suffers from edge-bursting: a client can send 100 at 0.99 s and another 100 at 1.01 s. A **sliding-window rate limit** keeps a structure of timestamps over the last `T` seconds.

For counting requests, a simple ring buffer or token bucket is enough. The monotonic-deque flavour appears when the limit is **max over a sliding window** rather than count — for example, "the largest payload size received in the last 10 seconds should not exceed X" or "the highest concurrency burst in the last minute should not exceed Y."

**Pattern:** A monotonic deque keyed on (timestamp, value). On each event:

1. Drop expired entries from the front.
2. Drop dominated entries from the back.
3. Push the new (timestamp, value).
4. Read `dq.front().value` as the current rolling max.
5. Compare against threshold.

This is O(1) amortized per event regardless of the window size — important when the limiter is in the hot path of every request.

**Comparison to alternatives:**

| Structure | Time per request | Memory | Notes |
|-----------|-----------------|--------|-------|
| Counting Bloom filter | O(k) hashes | Small, fixed | Approximate count, no extreme |
| Sliding-window log | O(log W) per check | O(W) | Exact but heavy |
| Monotonic deque | O(1) amortized | O(W) worst-case, often << W | Best for rolling extreme |
| Token bucket | O(1) | O(1) | Different semantics (rate, not extreme) |

When a service must enforce "tell me the largest request in the last 10 s in 50 ns," monotonic deque is the right answer — bounded memory, single-allocation friendly, no hashing.

---

## Financial Telemetry: Rolling High and Low

Market data feeds publish tick-level price updates. Trading systems and risk engines maintain:

- **Rolling N-second high** (e.g., 30-second high for a breakout signal)
- **Rolling N-second low** (e.g., for stop-loss adjustment)
- **Rolling range** = high - low (volatility proxy)

Implementation in a colocated trading server:

- One decreasing deque for the high, one increasing deque for the low.
- Each tick: O(1) amortized push and expiration on both.
- Per-symbol; multiplied by tens of thousands of symbols.

**Latency budget:** sub-microsecond per update. Implications:

- **Pre-allocate.** Use a ring-buffer-backed deque (head and tail indices into a fixed array) to avoid any per-tick allocation. The window is bounded by `max events per second * window seconds`, which is known in advance.
- **Cache layout.** Pack (timestamp, value) into a struct sized to a cache line stride. Sequential traversal stays L1-resident.
- **Branch prediction.** The back-pop loop usually does 0 or 1 iteration; arrange code so the no-pop path is the fall-through branch.
- **NUMA awareness.** Keep the per-symbol deque on the same NUMA node as the feed handler thread.

The algorithm is unchanged; the engineering is in keeping the constant factor low.

---

## Network Jitter and Latency Tracking

Jitter is the variation in packet arrival times. A common metric:

> jitter = max(arrival_delta) - min(arrival_delta) over the last N packets

Two monotonic deques — one for max delta, one for min delta — give exact jitter over the last `N` packets in O(N) total across all packets in a stream.

This is run inside VoIP encoders, video streaming clients, and time-sensitive networking (TSN) endpoints. Memory is O(N) but typical N is 128 or 256, so it fits easily in a flow-table entry.

Alternative: maintain only summary statistics (Welford's algorithm for variance). Faster and lower memory, but loses the exact min/max which the deque preserves.

---

## Distributed Sliding-Window Aggregation

When the stream is sharded across nodes — e.g., a Kafka topic with many partitions, or a Flink keyed-stream — the monotonic deque lives **per key, per partition**. Cross-partition aggregation is a separate stage.

**Flink pattern:**

```text
stream
  .keyBy(userId)
  .window(SlidingProcessingTimeWindows.of(Time.seconds(60), Time.seconds(5)))
  .aggregate(MonotonicMaxAggregator)
```

A custom `AggregateFunction` whose accumulator is a monotonic deque is roughly:

- `createAccumulator()` -> new empty deque
- `add(value, acc)` -> push with maintenance
- `getResult(acc)` -> `acc.front()`
- `merge(a, b)` -> non-trivial — see below

**Merging two monotonic deques is hard.** The natural merge is "append one to the other and re-establish the invariant," which can be O(n + m). For windowed aggregations where Flink expects associative, commutative aggregators, this nondeterminism is acceptable because the result must be deterministic but the path is not.

**Alternative:** Use a *segment-tree-of-monotonic-deques* or a *re-aggregating tree* — these enable O(log W) merge at the cost of higher memory. Most production systems sidestep the problem entirely by **never merging windows**: each tumbling sub-window is computed independently and a final reduce step combines extrema with a trivial `max` or `min`.

**Cross-partition rollup:**

```text
local max per partition -> shuffle by key -> global max via simple reduce
```

The monotonic deque lives only at the leaf. The cross-partition step is a stateless `max` reducer because the leaf already collapsed the window to a single value.

---

## Memory-Constrained Approximation

When `W` is gigantic (e.g., "rolling max over the last 24 hours of a 1 Mpps stream"), an exact deque holds up to `W` entries — too much.

Approximation options:

- **Probabilistic dropping.** Each event has probability `1/q` of being considered; the deque tracks `W/q` entries. Bias toward the truth but with sampling variance.
- **Time-bucketed coarsening.** Slice the window into B buckets, each carrying a per-bucket max. The rolling max is the max of B values. Memory O(B); accuracy is bounded by the bucket size.
- **Count-min sketch + heavy hitters.** For top-k tracking (not pure max). Different problem.
- **Hierarchical deques.** A small deque over recent fine-grained events plus a coarser deque over time-bucket maxima. Bounded memory, exact for the recent window and accurate for the older window.

The classic monotonic-deque algorithm assumes the window fits. If it does not, you are no longer doing exact extrema — and that is acceptable for most monitoring use cases. Be explicit about the trade.

---

## Observability

Metrics you should export for a production deque used in the hot path:

| Metric | Type | Why |
|--------|------|-----|
| `deque_size` | Gauge | Spot leaks (monotonic growth = expiration bug) |
| `deque_pushes_total` | Counter | Throughput |
| `deque_pops_back_total` | Counter | Maintenance cost |
| `deque_pops_front_total` | Counter | Expiration rate; should track throughput closely |
| `deque_max_size` | Histogram | Capacity planning |
| `op_latency_p99_us` | Histogram | Latency budget |
| `expirations_per_event` | Histogram | Detects time-clustered bursts |

Alert thresholds:

- `deque_size` > `expected_window_count * 2` for > 1 minute -> expiration broken or window misconfigured.
- `deque_pops_back_total / deque_pushes_total` close to 1 -> monotone input; deque is effectively a single cell. Cheap, but inspect data.
- `op_latency_p99_us` > 5x baseline -> watch for allocation churn or GC.

For the streaming flavour, also track:
- Late-arriving event count
- Watermark gap between event time and processing time

---

## Concurrency

The textbook deque is **single-writer**. Most production usages keep it that way — one thread per partition or per symbol — because shared deques across threads need locking that costs more than the deque ops themselves.

**Patterns:**

1. **Sharded by key.** Partition input by hash(key); each shard owns its own deque on its own thread.
2. **Single-writer, multiple-reader.** The writing thread updates the deque; readers read a snapshot. The deque holds a `current_max` field updated atomically after each push; readers read just that field.
3. **Lock-free via copy-on-write.** Each update rebuilds a small slice of the deque; readers hold a pointer to the previous version. Memory pressure is real; reserve for read-heavy paths.
4. **Locked.** Wrap with a mutex. Acceptable when contention is low and the hot path is elsewhere.

**Anti-pattern:** Two threads pushing to the same deque protected by a mutex on a per-symbol path. The mutex cost dominates; just shard.

---

## Failure Modes

| Mode | Symptom | Cause | Mitigation |
|------|---------|-------|-----------|
| Unbounded growth | RSS climbs, OOM eventually | Expiration predicate has a bug (e.g., wrong window length) | Add `deque_size` gauge with alert; cap at `max_expected * 2` with logging |
| Clock skew | Front-pop never fires | Source timestamps are in the future relative to local clock | Validate timestamps against local clock; reject or correct |
| Long pause inside back-pop loop | Single-event latency spike | Adversarial input pattern (monotone increasing) | Acceptable amortized; for hard real-time, cap the per-event work and defer the rest |
| Wrong direction | Reported "max" is actually min | Increasing instead of decreasing invariant | Add a sanity check: `dq.front() >= dq.back()` for max; assert in dev builds |
| Per-event allocation | Throughput halved by GC pressure | Using `LinkedList` in Java or `list` for `popleft` in Python | Use `ArrayDeque` / `collections.deque` |
| Concurrent corruption | Random crashes under load | Two threads writing the same deque | Shard by key |
| Stale snapshot | Reader sees a max from before expiration | Reader read `dq.front()` after expiration logically happened but before the front-pop | Update `current_max` atomically *after* maintenance; readers use the atomic field |

---

## Summary

In production, the monotonic deque is the cheapest exact structure for a rolling max or min over a sliding window. Its O(1) amortized cost and bounded memory make it attractive in latency-sensitive paths: market data, ad auctions, rate limiting, jitter tracking, queue-depth backpressure.

The engineering work is in the surroundings: pre-allocated ring-buffer backing, careful expiration predicates for wall-clock windows, sharding for concurrency, observability for misconfiguration, and approximation strategies when the window does not fit in memory. The algorithm itself does not change — the constant factor, the placement in the system, and the failure modes do.

Senior decisions to make explicit when proposing a monotonic deque:

- Is the window count-based or time-based? Affects expiration predicate and memory bound.
- Is the input single-threaded, sharded, or shared? Decides whether locking is needed.
- Does it fit in memory? If not, name the approximation up front.
- What is the observability story? At minimum: size gauge, push/pop counters, latency histogram.
- What is the failure plan? Define "deque too big" as a recoverable state, not a silent leak.
