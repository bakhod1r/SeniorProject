# Streaming Pipeline Backpressure Lab

> Build a Kafka → processor → sink pipeline where the sink is *slower* than the
> source, then watch what decides the outcome: with backpressure the system
> degrades gracefully; without it, lag grows unbounded and the process OOMs. The
> bottleneck is the teacher — find where the pipeline stops absorbing load and
> make it choose to slow down instead of die.

| | |
|---|---|
| **Tier** | Lab (data-systems) |
| **Primary domain** | Stream processing / flow control |
| **Skills exercised** | Backpressure, bounded vs unbounded queues, Go channels, batching/micro-batching, consumer lag, Kafka rebalancing (`max.poll.interval.ms`), load shedding, `franz-go`, `pprof` |
| **Interview sections** | 11 (messaging), 13 (distributed systems), 2 (concurrency) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own a stream processor that reads events from Kafka, transforms each one, and
writes the result to a downstream sink — a rate-limited DB or an HTTP service that
caps out at, say, **2,000 writes/s**. Upstream is bursty and can deliver **8,000+
events/s** for minutes at a time. Today the pipeline "works" in the demo and then
falls over in production: during a downstream slowdown, memory climbs, the pod
gets OOM-killed, the consumer is evicted from the group, and you discover the lag
graph only after the pager goes off.

The root question of this lab is not "how do I make it faster" — the sink is slow
by definition. It's **what happens to the imbalance**. Every byte the source
produces faster than the sink can absorb has to go *somewhere*: into a bounded
queue (and then backpressure stalls the source), into an unbounded queue (and
then it lives in your heap until the OOM killer reclaims it), or on the floor
(load shedding). You will build the pipeline, run the source faster than the sink
for 30+ minutes, and produce numbers showing which policy degrades gracefully and
which collapses.

## 2. Goals / Non-goals

**Goals**
- Build a Kafka → processor → sink pipeline and run it under **sustained**
  source-over-sink imbalance, not a momentary burst.
- Demonstrate the **unbounded-queue → OOM** failure mode end to end, with a heap
  profile, then fix it with a bounded queue and show the difference.
- Show that a **pull-based** Kafka consumer backpressures *for free* (poll pace
  follows processing pace) and contrast it with a **push** pipeline that needs an
  explicit bounded buffer to get the same property.
- Quantify the throughput / latency / ordering trade-offs of batching the sink and
  parallelizing the sink workers.
- Use **consumer lag** as the single health signal, and prove you can keep a slow
  consumer from being evicted by `max.poll.interval.ms`.

**Non-goals**
- Exactly-once delivery — that's the Kafka EOS lab (`labs/01`). Here at-least-once
  is fine; correctness focus is *flow control*, not dedup.
- A stream framework (Flink/Beam). Build the flow control yourself so you see the
  queues.
- Autoscaling the sink. The sink is a fixed, slow dependency on purpose — you
  don't get to make it faster.

## 3. Functional requirements

1. A **source/producer** (`cmd/producer`) emits events to topic `events` at a
   configurable, fixed rate (open-model — *not* "as fast as the consumer drains")
   so imbalance is something you dial in, not an accident.
2. A **processor consumer** (`cmd/processor`) reads `events`, applies a cheap
   transform, and writes to a sink. It exposes the internal queue as a swappable
   component with three modes by flag:
   - `bounded` — a Go channel of fixed capacity `N`; full channel blocks the poll
     loop (this is the backpressure path).
   - `unbounded` — an append-only slice/list buffer that never blocks the source
     (this is the OOM path).
   - `pull` — no internal buffer; the poll loop only fetches the next batch when
     the sink is ready (Kafka-native backpressure).
3. A **sink** (`cmd/sink` or an in-process client) that is **deliberately slow and
   rate-limited** — a token-bucket-throttled HTTP endpoint or a DB with an
   enforced max write rate. It supports `single` and `batch` write modes.
4. A **chaos hook** (`cmd/chaos`) that injects a mid-run **downstream stall**
   (drop the sink rate from 2,000/s to 200/s for 90 s, then restore) and can pause
   the sink entirely.
5. A **policy switch** so the same imbalance can be resolved by `buffer`,
   `shed` (drop with a counter), or `slow-source` (signal the producer to back
   off) — for direct comparison.

## 4. Load & data profile

- **Source rate:** 8,000 events/s sustained; sink ceiling 2,000 writes/s →
  a **4× sustained imbalance**. Run ≥ 30 minutes continuous.
- **Burst model:** baseline at 1,500/s (below sink ceiling, lag should be flat),
  then step to 8,000/s for the imbalance windows.
- **Message size:** 512 B events (the heap math has to be visible — at 8,000/s an
  unbounded buffer accreting un-drained events grows ~4 MB/s of payload alone,
  more with per-event Go overhead).
- **Downstream stall:** injected at T+10 min, sink drops to 200/s for 90 s, then
  recovers. Observe lag growth during, recovery time after.
- **Generator:** `cmd/producer` is deterministic given a seed; rate is the dial.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Consumer lag at steady state (source < sink ceiling) | **Bounded and flat** — not monotonically rising |
| Consumer lag under sustained 4× imbalance, `bounded`/`pull` | Rises, but at a rate explained by the imbalance; producer is backpressured; **memory stays flat** |
| Process RSS ceiling (`bounded`/`pull`, full 30-min run) | **< 512 MB**, stable — no monotonic heap growth |
| Process RSS (`unbounded`, same run) | Expected to climb monotonically → **OOM**; capture the heap profile at the cliff |
| End-to-end p99 (produce → sink-acked) at 80% of sink ceiling | **< 2 s** |
| Recovery after 90 s downstream stall | Lag returns to its pre-stall band within **< 5 min** of sink recovery |
| Consumer eviction by `max.poll.interval.ms` | **Zero** evictions across the run; prove the poll loop never stalls longer than the interval |

> The point is not a magic lag number — it's that **memory is bounded** and the
> system's response to overload is a *decision* (slow / shed / buffer), not a
> crash.

## 6. Architecture constraints & guidance

- 3-broker Kafka (KRaft, no ZooKeeper) via `docker-compose`. Topic `events` with
  enough partitions to let you scale processor parallelism (start at 12).
- Go client: `twmb/franz-go` — its manual `PollFetches` loop gives you direct
  control over *when* you fetch, which is the whole point of the `pull` mode.
- Model the internal queue explicitly as a **Go channel** for `bounded` mode: a
  buffered channel *is* a bounded blocking queue, and a full channel stalling the
  poll goroutine *is* backpressure. Make the capacity a flag.
- The slow sink must enforce its rate **server-side** (token bucket), so the
  processor cannot cheat by writing faster than the contract allows.
- Instrument with Prometheus + `pprof`: poll rate, sink write rate, in-flight
  queue depth, consumer-group lag (`kafka_consumergroup_lag`), p50/p99/p999
  end-to-end, and **`go_memstats_heap_inuse_bytes`** + live `pprof` heap.

## 7. Data model

```
event:   { id uint64, key uint64, payload []byte (512 B), ts int64 }

internal queue (bounded):    chan event, cap = N           // blocking buffer = backpressure
internal queue (unbounded):  []event, append-only          // OOM trap; never blocks source
pull mode:                   no queue; fetch next batch only when sink drained

sink contract:  rate-limited writer, single or batch(size B), returns ack/err
lag signal:     per-partition (log-end-offset − committed-offset), summed
```

The `bounded` channel and the `unbounded` slice are intentionally the *same logical
component* with different capacity semantics, so the only variable across runs is
"does the queue push back."

## 8. Interface contract

- `GET /metrics` → Prometheus exposition (lag, queue depth, write rate, heap, p99).
- `GET /debug/pprof/...` → live heap/goroutine profiles (the `unbounded` autopsy).
- Processor flags: `-queue=bounded|unbounded|pull`, `-queue-cap`, `-sink-mode=single|batch`,
  `-batch-size`, `-batch-linger`, `-sink-workers`, `-policy=buffer|shed|slow-source`,
  `-max-poll-interval`.
- Producer flags: `-rate`, `-msg-size`, `-seed`.
- Sink flags: `-rate-limit`, `-stall-rate`, `-stall-at`, `-stall-for`.

## 9. Key technical challenges

- **Where does the imbalance go.** At 4× sustained, the difference between source
  and sink must accumulate somewhere. Naming that "somewhere" — bounded queue,
  heap, or dropped — is the entire lab. A bounded channel converts "too much data"
  into "a slower poll loop"; an unbounded buffer converts it into RSS.
- **Pull naturally backpressures, push does not.** A `franz-go` poll loop that
  only fetches after the sink accepts the previous batch self-throttles: the
  consumer simply polls slower, lag rises in Kafka (cheap, on disk), and memory
  stays flat. A push pipeline with an unbounded internal channel removes that
  property — Kafka hands you data as fast as it can and you hoard it in RAM.
- **The slow consumer gets evicted.** If batching/blocking makes a single
  `PollFetches`→process cycle exceed `max.poll.interval.ms` (default 300,000 ms),
  Kafka assumes the consumer is dead, **rebalances it out**, and its partitions
  move — making the remaining consumers even more overloaded. You must keep the
  poll cadence inside the interval (smaller fetch batches, decouple processing from
  the poll goroutine, or tune the interval) and prove zero evictions.
- **Batching vs latency vs ordering.** Micro-batching the sink (write 200 events
  per call) multiplies effective sink throughput but adds linger latency and
  couples a whole batch's fate. Parallelizing sink workers raises throughput but
  **breaks per-key ordering** unless you partition work by key. You can't have
  max throughput, min latency, and total ordering at once — measure the corners.
- **Choosing the overload policy.** Buffering defers the problem (and costs
  memory/latency); shedding keeps the system alive but loses data; slowing the
  source preserves data but pushes the backpressure all the way upstream. Each is
  right for a different SLA. Defend your default.

## 10. Experiments to run (break it / tune it)

Record before/after numbers and attach a graph for each:

1. **Unbounded vs bounded under sink slowdown.** Run the 4× imbalance for 30 min
   in `unbounded` mode → *measure*: heap-inuse over time, the OOM cliff, and a
   `pprof` heap snapshot showing where the bytes live. Repeat in `bounded`
   (cap = 10,000) → *measure*: RSS stays flat, producer send rate gets throttled,
   lag rises on the broker instead of in RAM. Show both curves on one axis.

2. **Pull vs push backpressure.** `pull` mode (fetch only when sink ready) vs
   `unbounded` push → *measure*: poll rate vs sink rate coupling, end-to-end p99,
   and heap. Show that pull keeps memory flat by *converting overload into lag*.

3. **Sink batch-size sweep.** `batch-size` ∈ {1, 50, 200, 1000} at fixed source
   rate → *measure*: effective sink throughput, end-to-end p99, and per-batch
   linger. Find the knee where bigger batches stop adding throughput and only add
   latency.

4. **Sink parallelism vs ordering.** `sink-workers` ∈ {1, 4, 16}, first round-robin
   (fast, unordered) then key-partitioned (ordered per key) → *measure*: sink
   throughput gain, and **count per-key ordering violations** in each mode. Quantify
   the ordering tax of the safe variant.

5. **Inject a downstream stall.** During a steady run, drop the sink to 200/s for
   90 s → *measure*: lag growth slope during the stall, peak lag, and **recovery
   time** to the pre-stall band after the sink returns. Do it once `bounded` and
   once `unbounded` and compare what each does with the backlog.

6. **Evict the consumer via `max.poll.interval.ms`.** Deliberately make one
   process cycle exceed the interval (huge batch + slow sink, low interval) →
   *measure*: confirm the rebalance/eviction, partition migration, and the lag
   spike on the surviving consumers. Then apply the fix (bound fetch size /
   decouple processing / raise interval) and prove **zero** evictions over 30 min.

7. **Policy comparison: shed vs buffer vs slow-source.** Same 4× imbalance, three
   policies → *measure*: events dropped (shed), memory + p99 (buffer), and
   upstream producer send-rate reduction + zero loss (slow-source). Tabulate which
   SLA each policy satisfies.

## 11. Milestones

1. Compose cluster up; producer + processor + slow rate-limited sink; Prometheus +
   a Grafana board for lag / queue-depth / write-rate / heap.
2. `unbounded` mode imbalance run → reproduce the OOM with a heap profile
   (experiment 1, the failure case).
3. `bounded` channel + `pull` mode → flat memory under the same load
   (experiments 1, 2).
4. Sink batching + parallelism with the ordering counter (experiments 3, 4).
5. Downstream stall + `max.poll.interval` eviction + policy comparison
   (experiments 5–7); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] A 30-min `unbounded` run that **OOMs (or would, capped)**, with a `pprof`
      heap profile naming where the bytes accumulate.
- [ ] The same load in `bounded`/`pull` with **flat RSS < 512 MB** and a
      backpressured producer — both curves on one chart.
- [ ] Sink batch-size knee curve (throughput vs p99) plotted.
- [ ] Parallel-sink ordering experiment: throughput gain **and** a per-key
      ordering-violation count for round-robin vs key-partitioned.
- [ ] Downstream-stall run: lag growth + **recovery within < 5 min** of sink
      restore, graphed.
- [ ] A reproduced consumer eviction by `max.poll.interval.ms`, then a fixed run
      with **zero** evictions over 30 min.
- [ ] Policy table (shed / buffer / slow-source) with the SLA each one satisfies.
- [ ] Every number is reproducible from a committed command + config.

## 13. Stretch goals

- **Credit-based flow control:** give the source a credit window the sink
  replenishes as it drains (reactive-streams style), and compare with the implicit
  channel backpressure.
- **Adaptive batching:** size the sink batch from observed lag/latency instead of a
  fixed `batch-size`, and show it beats any single static size across the burst.
- **Spill-to-disk buffer:** when the bounded queue is full, overflow to a
  bounded on-disk segment instead of blocking or shedding; measure the
  latency/durability trade.
- **Lag-driven autoscale:** scale processor instances on consumer lag and show the
  rebalance cost vs the throughput recovered.
- **Priority shedding:** shed low-value events first under overload and keep p99
  for the high-value class.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Failure mode | Reproduces the OOM | Profiles it, names where the heap goes, and ties it to the missing bound |
| Backpressure model | Uses a bounded channel | Articulates pull-vs-push and *why* bounded queues convert overload into lag, not RAM |
| Batching | Shows batching raises throughput | Finds the knee and recommends a batch size for a stated p99 SLO |
| Concurrency vs ordering | Notices parallel sink reorders | Partitions by key, measures the ordering tax, picks deliberately |
| Lag & rebalancing | Knows lag is the health signal | Prevents `max.poll.interval` eviction with evidence; explains the eviction's cascade |
| Overload policy | Picks one of shed/buffer/slow-source | Tabulates all three against SLAs and defends a default |
| Communication | Clear findings note | Could defend every curve and the OOM autopsy to a staff panel |

## 15. References

- Kafka docs: consumer `max.poll.interval.ms`, `max.poll.records`, fetch sizing,
  incremental cooperative rebalancing.
- *Designing Data-Intensive Applications* — Ch. 11 (stream processing, backpressure).
- Reactive Streams spec — credit-based (demand) backpressure as a contrast model.
- `twmb/franz-go` — manual `PollFetches` loop and pause/resume for pull-rate control.
- Go: buffered channels as bounded queues; `pprof` heap profiling; `runtime/metrics`.
- See also: `Interview Question/11-messaging-and-event-streaming/` and
  `Interview Question/02-concurrency/`.
