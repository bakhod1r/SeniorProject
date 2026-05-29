# Sliding Window — Senior Level

## Table of Contents

1. [Introduction](#introduction)
2. [Production Use Cases](#production-use-cases)
3. [Rate Limiting — Sliding Window Counter](#rate-limiting--sliding-window-counter)
4. [Online Metric Aggregation](#online-metric-aggregation)
5. [Anomaly Detection on Time Series](#anomaly-detection-on-time-series)
6. [Log and Event Throttling](#log-and-event-throttling)
7. [Sliding Windows in Stream Processing](#sliding-windows-in-stream-processing)
8. [Distributed Sliding Windows](#distributed-sliding-windows)
9. [Code: Sliding-Window Rate Limiter](#code-sliding-window-rate-limiter)
10. [Capacity Planning](#capacity-planning)
11. [Observability](#observability)
12. [Failure Modes](#failure-modes)
13. [Summary](#summary)

---

## Introduction

> Focus: "Where does this pattern actually live in production?" and "How do I run one across multiple machines?"

Sliding-window algorithms leave the textbook the moment you build any system that processes a stream of events: requests, log lines, telemetry samples, packets, financial trades. The exact same expand/shrink discipline you used on a string in junior.md now runs over a timeline, partitioned across worker nodes, with strict latency budgets and `at-least-once` delivery guarantees.

Senior engineers are expected to know:

- The three or four canonical production shapes (rate limit, metric aggregation, anomaly detection, throttling).
- How sliding windows interact with stream processors (Flink, Kafka Streams, Beam, Spark Structured Streaming).
- How to run a window across shards and merge partial state.
- How to bound memory and reason about correctness under late events.

---

## Production Use Cases

| Domain | What the window holds | What it computes |
|--------|------------------------|------------------|
| API gateway | Recent requests per principal | Allow/deny decision (rate limiter) |
| Observability | Recent latency samples | p50/p95/p99, average, std-dev |
| Fraud detection | Recent transactions per card | Count, distinct merchants, sum |
| Telemetry | Recent log lines per source | Throttle, deduplicate, alert |
| Network IDS | Recent packets per src-IP | Detect SYN floods, port scans |
| Stock market | Recent trades | Moving average, VWAP, volatility |
| ML serving | Recent prediction inputs | Drift detection, feedback loop |
| Spam filtering | Recent emails per sender | Block excessive senders |

In every case the underlying algorithm is "expand, maintain summary, possibly shrink", but the window state and the eviction policy differ.

---

## Rate Limiting — Sliding Window Counter

The simplest production sliding-window algorithm is the **sliding-window counter** for API rate limiting. Compared with fixed-window counters, it avoids the burstiness at window boundaries (you cannot get `2 * limit` requests in the two seconds straddling minute boundaries).

Three common variants:

1. **Sliding window log.** Keep a sorted list of timestamps per principal. Drop entries older than `now - W`. Reject if `len(list) >= limit`. Memory: O(limit) per principal — expensive at scale.
2. **Sliding window counter.** Track two adjacent fixed buckets and weight the previous one by overlap fraction. Cheap, slightly approximate. The most common production choice.
3. **Token bucket.** Strictly equivalent to a continuous sliding window of token credits — see [rate-limiting-throttling](../../) skill.

The approximate counter has well-bounded error: for window `W` and bucket size `b = W`, the worst-case overcount is the rate during the previous bucket, which never exceeds `limit`.

See [middle.md](./middle.md) for the algorithmic template; here we focus on operational concerns.

---

## Online Metric Aggregation

Observability stacks like Prometheus, Datadog, and Honeycomb maintain sliding windows of recent samples to compute percentile metrics over the "last N minutes".

**Naive approach.** Keep a list of all samples in `[now - W, now]`, sort and pick percentiles on query. Memory is proportional to traffic — fine for small services, ruinous at high QPS.

**Production approach.** Use a streaming approximate quantile sketch — t-digest, q-digest, HDR histogram, or KLL sketch — and slide it forward. These structures maintain quantiles within bounded error using `O(log n)` or `O(1/eps)` memory, independent of the sample count.

For "last N samples" (count window rather than time window) HDR histogram with a ring of buckets and per-bucket histograms is the standard pattern: each bucket holds one second of samples; querying p99 over 5 minutes merges 300 buckets.

**Tradeoffs**:

- **Tumbling buckets** (one histogram per second) are easy to evict but produce stepped percentiles.
- **Sliding buckets** (continuous merge of partial buckets) are smoother but harder to implement.
- **Hopping windows** (1-minute window emitted every 10 seconds) are the standard compromise.

---

## Anomaly Detection on Time Series

Two common sliding-window flavors:

1. **Z-score over a window.** Maintain `mean` and `std-dev` of the last `W` samples; flag points more than `k * std-dev` away from `mean`. Use Welford's online algorithm to update both in O(1) per insert (and one matching delete).
2. **EWMA (exponentially weighted moving average).** Not strictly a sliding window — it gives recent samples exponentially more weight, with no hard cutoff. Cheaper than a true sliding window because there is no need to remember which samples to expire.

The interesting engineering question is **what to do with late or out-of-order events**. Real streams have clock skew and retries; samples arrive minutes after their event time. Strategies:

- **Watermarks** (Flink, Beam). Define a watermark: a guarantee that no event older than `t - delta` will arrive. Emit the window when watermark passes its right edge.
- **Allowed lateness**. Buffer the window for an extra `L` seconds; reprocess if a late event arrives.
- **Dual stream**. Emit a preliminary result, then re-emit a corrected one when allowed lateness expires. Downstream consumers handle the update.

---

## Log and Event Throttling

A high-traffic service that logs `ERROR` on every retry can drown the logger. The standard production trick is a sliding-window deduplicator:

- Hash the error signature (class + message template, *not* the rendered message).
- For each signature, maintain a small count + earliest-seen timestamp.
- If count exceeds a threshold within `W` seconds, suppress further messages and emit a single "suppressed N similar errors" line at window close.

The implementation is exactly the variable-size template, with the invariant "window age ≤ W". State: hash map of `signature -> (count, firstSeen)`. Eviction is by timestamp rather than by index.

Same pattern shows up in:

- Slack/Discord channel throttling.
- Push-notification deduplication.
- Email digest assembly.
- Webhook delivery batching.

---

## Sliding Windows in Stream Processing

Stream processors give sliding windows first-class semantics. Three vocabulary terms you must know:

| Window type | Behavior | Example |
|-------------|----------|---------|
| **Tumbling** | Fixed-size, non-overlapping | "Count per minute, emitted once at end of minute" |
| **Sliding** | Fixed-size, overlapping | "1-minute window emitted every 10 seconds" — same as **hopping** in some frameworks |
| **Session** | Variable-size, gap-driven | "Group events with < 30s idle gap" |
| **Global** | Single window covering all of time | Needs explicit triggers to emit anything |

Most production "sliding" pipelines are actually hopping windows (Flink/Beam call them sliding; Kafka Streams calls them hopping). True per-event sliding windows are rare at scale because each event would trigger an emit.

**Key correctness concept: event time vs processing time.** Sliding windows defined on **event time** survive clock skew, retries, and out-of-order arrival; windows on **processing time** are trivial to implement but lie when the stream is delayed. Production systems almost always use event time + watermarks.

**Per-key state.** A sliding window on user IDs is not one window — it is N windows (one per active user). The state store grows with active key count. Bound this with TTLs and "active key" sketches (HyperLogLog of seen keys).

---

## Distributed Sliding Windows

A single-node sliding window over a stream of millions of events per second is impossible. Production systems shard the stream by key and run **N local windows**, then optionally merge.

### Pattern 1 — Shard by key, no merge

Each shard's window covers only its own keys. Sufficient when queries are also per-key (rate limit by user ID, throttle by error signature).

- **Sharding:** consistent hash on the key (see [05-hash-tables/senior.md](../05-hash-tables/senior.md)).
- **Failure handling:** when a shard goes down, you lose its window — accept brief over-limits or replay from the source-of-truth log.
- **Re-sharding** is the hard part: window state cannot move atomically. Production systems freeze the shard, snapshot state, copy, then unfreeze.

### Pattern 2 — Local windows + central merge

Each shard maintains a *partial* aggregate; a central coordinator merges them periodically.

- **Mergeable aggregates** are critical. `sum` and `count` merge trivially. `max` and `min` merge. `mean` requires `(sum, count)`. `std-dev` requires Welford's combine formula. `median` does **not** merge — use a t-digest, which does.
- **Approximate distinct** uses HyperLogLog (mergeable). Exact distinct does not scale.
- **Approximate top-k** uses Count-Min Sketch (mergeable). Exact top-k does not.

### Pattern 3 — Two-tier sliding

- Edge layer: fine-grained per-instance windows, mostly to enforce local limits cheaply.
- Aggregation layer: coarse merged windows for global decisions, refreshed at a slower cadence.

Used in: Cloudflare rate limiting, AWS Shield, large multi-region deployments. The local layer absorbs spikes and pays approximate global enforcement.

---

## Code: Sliding-Window Rate Limiter

The sliding-window counter algorithm: track count in the current and previous fixed bucket, weight the previous one by the fraction of the window it still occupies.

### Go

```go
package ratelimit

import (
    "sync"
    "time"
)

// SlidingWindow is an approximate sliding-window rate limiter.
// It tracks counts in the current and previous fixed bucket and
// linearly interpolates the previous bucket's contribution.
// Memory: O(1) per principal.
// Error bound: <= one full window of overcount during boundary cross.
type SlidingWindow struct {
    mu       sync.Mutex
    window   time.Duration // size of each fixed bucket
    limit    int           // max events per window
    counts   map[string]*bucketPair
}

type bucketPair struct {
    curStart time.Time
    cur      int
    prev     int
}

func NewSlidingWindow(window time.Duration, limit int) *SlidingWindow {
    return &SlidingWindow{
        window: window,
        limit:  limit,
        counts: make(map[string]*bucketPair),
    }
}

// Allow records an attempt for the principal and returns whether it is allowed.
func (s *SlidingWindow) Allow(principal string, now time.Time) bool {
    s.mu.Lock()
    defer s.mu.Unlock()

    bp, ok := s.counts[principal]
    if !ok {
        bp = &bucketPair{curStart: now.Truncate(s.window)}
        s.counts[principal] = bp
    }
    s.rollover(bp, now)

    // Fraction of the previous bucket still inside [now - window, now].
    elapsed := now.Sub(bp.curStart)
    prevWeight := float64(s.window-elapsed) / float64(s.window)
    if prevWeight < 0 {
        prevWeight = 0
    }
    estimated := float64(bp.cur) + float64(bp.prev)*prevWeight
    if estimated+1 > float64(s.limit) {
        return false
    }
    bp.cur++
    return true
}

// rollover advances the current bucket forward to "now".
// Skipping more than one window resets both counts.
func (s *SlidingWindow) rollover(bp *bucketPair, now time.Time) {
    curEnd := bp.curStart.Add(s.window)
    if now.Before(curEnd) {
        return
    }
    if now.Before(curEnd.Add(s.window)) {
        bp.prev = bp.cur
        bp.cur = 0
        bp.curStart = curEnd
        return
    }
    bp.prev = 0
    bp.cur = 0
    bp.curStart = now.Truncate(s.window)
}
```

### Java

```java
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

public class SlidingWindowLimiter {

    private static class BucketPair {
        Instant curStart;
        int cur;
        int prev;
    }

    private final Duration window;
    private final int limit;
    private final Map<String, BucketPair> counts = new HashMap<>();

    public SlidingWindowLimiter(Duration window, int limit) {
        this.window = window;
        this.limit = limit;
    }

    public synchronized boolean allow(String principal, Instant now) {
        BucketPair bp = counts.computeIfAbsent(principal, k -> {
            BucketPair fresh = new BucketPair();
            fresh.curStart = truncate(now);
            return fresh;
        });
        rollover(bp, now);

        Duration elapsed = Duration.between(bp.curStart, now);
        double prevWeight = Math.max(
            0,
            1.0 - (double) elapsed.toNanos() / window.toNanos()
        );
        double estimated = bp.cur + bp.prev * prevWeight;
        if (estimated + 1 > limit) return false;
        bp.cur++;
        return true;
    }

    private void rollover(BucketPair bp, Instant now) {
        Instant curEnd = bp.curStart.plus(window);
        if (now.isBefore(curEnd)) return;
        if (now.isBefore(curEnd.plus(window))) {
            bp.prev = bp.cur;
            bp.cur = 0;
            bp.curStart = curEnd;
        } else {
            bp.prev = 0;
            bp.cur = 0;
            bp.curStart = truncate(now);
        }
    }

    private Instant truncate(Instant t) {
        long nanos = t.toEpochMilli() * 1_000_000L;
        long bucket = window.toNanos();
        return Instant.ofEpochSecond(0, (nanos / bucket) * bucket);
    }
}
```

### Python

```python
from dataclasses import dataclass
from threading import Lock
from time import time


@dataclass
class _BucketPair:
    cur_start: float
    cur: int = 0
    prev: int = 0


class SlidingWindowLimiter:
    """Approximate sliding-window rate limiter.

    Memory: O(1) per principal.
    Error bound: at most one bucket of overcount near boundaries.
    """

    def __init__(self, window_seconds: float, limit: int):
        self._window = window_seconds
        self._limit = limit
        self._counts: dict[str, _BucketPair] = {}
        self._lock = Lock()

    def allow(self, principal: str, now: float | None = None) -> bool:
        now = now if now is not None else time()
        with self._lock:
            bp = self._counts.get(principal)
            if bp is None:
                bp = _BucketPair(cur_start=(now // self._window) * self._window)
                self._counts[principal] = bp
            self._rollover(bp, now)

            elapsed = now - bp.cur_start
            prev_weight = max(0.0, 1.0 - elapsed / self._window)
            estimated = bp.cur + bp.prev * prev_weight
            if estimated + 1 > self._limit:
                return False
            bp.cur += 1
            return True

    def _rollover(self, bp: _BucketPair, now: float) -> None:
        cur_end = bp.cur_start + self._window
        if now < cur_end:
            return
        if now < cur_end + self._window:
            bp.prev = bp.cur
            bp.cur = 0
            bp.cur_start = cur_end
            return
        bp.prev = 0
        bp.cur = 0
        bp.cur_start = (now // self._window) * self._window
```

---

## Capacity Planning

For a sliding-window service, capacity is dominated by:

1. **Active key count.** Per-principal state — even one entry per key is `O(active keys)`. At 10M active keys with 100 bytes each, that is 1 GB of state per instance. Decide whether you can shard.
2. **Eviction frequency.** TTL or LRU on inactive keys reclaims memory. Pick a TTL slightly larger than your window: a 1-minute window with 5-minute TTL is a sane default.
3. **Lock contention.** A single global mutex (as in the sample code) caps you at ~1M ops/sec; for higher throughput, stripe locks per key prefix (see [concurrency-patterns](../../) skill).
4. **State checkpointing.** If the window is critical (rate limiting fraud), persist state at intervals. Trade-off: checkpoint frequency vs replay-from-log RTO.
5. **Memory amplification at boundaries.** The dual-bucket counter doubles memory briefly when a new bucket starts. Plan for 2x worst case.

---

## Observability

| Metric | What it tells you | Typical alert |
|--------|--------------------|---------------|
| `window_size_active` | Number of active keys (windows) being maintained | > 80% memory budget |
| `window_eviction_rate` | Keys expiring per second | Compare to insertion rate |
| `window_age_seconds_p99` | Oldest sample still in window | > configured W (sign of clock skew) |
| `window_late_event_count` | Events arriving after watermark | Spike => upstream lag |
| `rate_limit_decision_count{allowed,denied}` | Throughput vs denials | Denied/allowed ratio shifts |
| `merge_latency_ms` | Time to merge sharded windows | > SLA |
| `state_checkpoint_lag_seconds` | Time since last persisted snapshot | > RTO target |

For rate limiters specifically also emit per-principal denial counts (sampled to avoid cardinality explosion) — they are the strongest signal of abuse or misconfiguration.

---

## Failure Modes

| Failure | Symptom | Mitigation |
|---------|---------|------------|
| Clock skew between shards | Window edges disagree, inconsistent rate limiting | Use NTP + tolerate small drift; never use wall clock for ordering |
| Late events past watermark | Wrong percentiles, missed alerts | Set allowed-lateness; emit corrections; monitor `late_event_count` |
| Hot key | One principal monopolizes shard | Sub-shard hot keys (consistent hash with virtual nodes) |
| State unbounded | Memory OOM | TTL on inactive keys; cap with LRU |
| Restart loss | Window resets to empty, briefly miscounts | Periodic checkpoints to durable store; replay last `W` from log |
| Cross-shard burst | Per-shard limits add up to more than global | Two-tier limiter or central token issuer |
| Watermark stuck | No windows ever emit | Side-input timer to force emit; alert on `watermark_lag` |
| Merge skew | Late shards delay merged window | Set per-shard deadline; emit best-effort with `partial=true` flag |

---

## Summary

At senior level, sliding window stops being an interview trick and becomes a shape your services have all over them: rate limiters, percentile monitors, throttlers, fraud detectors, stream aggregators. The implementation surface is the same expand/shrink discipline you saw in junior.md, but production adds: distributed sharding, mergeable aggregate state, event-time semantics with watermarks, late-event tolerance, eviction policies, and observability. Pick aggregates that **merge** (sum, count, max, t-digest, HyperLogLog, Count-Min) so your windows scale horizontally; bound memory with TTLs; and never trust wall-clock equality across shards. The pattern is the same; the operational concerns are everything.
