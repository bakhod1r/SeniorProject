# Broadcast Pattern — Tasks

A graded set of exercises, from "see close-to-broadcast working" through "build a full pub/sub library." Each task lists requirements, hints, and a self-check. Solutions are not given — the point is to write and run them yourself, ideally with `-race` enabled.

## Table of Contents
1. [Task 1: Close-to-Broadcast](#task-1-close-to-broadcast)
2. [Task 2: Counted Wake-Up](#task-2-counted-wake-up)
3. [Task 3: Minimal Hub](#task-3-minimal-hub)
4. [Task 4: Dynamic Subscribe and Unsubscribe](#task-4-dynamic-subscribe-and-unsubscribe)
5. [Task 5: Drop-on-Overflow](#task-5-drop-on-overflow)
6. [Task 6: Topic-Based Pub/Sub](#task-6-topic-based-pubsub)
7. [Task 7: Slow-Subscriber Eviction](#task-7-slow-subscriber-eviction)
8. [Task 8: sync.Cond Gate](#task-8-synccond-gate)
9. [Task 9: Replay Buffer](#task-9-replay-buffer)
10. [Task 10: Coalescing Hub](#task-10-coalescing-hub)
11. [Task 11: Sharded Hub](#task-11-sharded-hub)
12. [Task 12: WebSocket Fan-Out Simulator](#task-12-websocket-fan-out-simulator)
13. [Task 13: Benchmarks](#task-13-benchmarks)

---

## Task 1: Close-to-Broadcast

**Goal.** Demonstrate that `close(done)` wakes every blocked receiver at once.

**Requirements.**
- Spawn N=5 worker goroutines.
- Each blocks on `<-done`.
- After 100 ms, close `done`.
- Each worker prints its ID and exits.
- Main waits for all of them via `sync.WaitGroup`.

**Hints.**
- Use `chan struct{}` for `done`.
- `time.Sleep` is fine for the wait — we are not testing precision.
- The output order is non-deterministic; that is expected.

**Self-check.**
- Run with `go run -race`. No data race?
- Increase N to 1000. Still works in ~milliseconds?
- Try calling `close(done)` twice. Does it panic?

---

## Task 2: Counted Wake-Up

**Goal.** Prove that all goroutines really wake up.

**Requirements.**
- N=100 goroutines wait on `done`.
- Use `atomic.Int32` to count wake-ups.
- After close, assert the counter equals N.
- Repeat 1000 times. Always N.

**Hints.**
- `var got atomic.Int32; got.Add(1)`.
- Use `sync.WaitGroup` to wait for all.
- Reset `got` and `done` per iteration; do not reuse a closed channel.

**Self-check.**
- Print `runtime.NumGoroutine()` before and after — should match.
- If you forget `wg.Wait()`, what does the test show? (Race, intermittent failure.)

---

## Task 3: Minimal Hub

**Goal.** Build the simplest hub: one publisher, many subscribers, one event type.

**Requirements.**
- `type Hub struct { ... }` exposing `Subscribe() <-chan string`, `Publish(string)`, `Close()`.
- Internally one goroutine reads from a `publish` channel and forwards to every subscriber channel.
- All subscribers must be registered *before* the hub starts.
- After `Close()`, every subscriber channel is closed.

**Hints.**
- The hub goroutine does `for msg := range h.publish { for _, s := range h.subs { s <- msg } }`.
- After the range loop, close every subscriber channel.

**Self-check.**
- Subscribe 3, publish 5 strings, close. Each subscriber received exactly 5 strings, then `ok=false`.
- Run with `-race`.
- Add a slow subscriber (sleep 100 ms per receive). Note how it slows the hub for everyone — that is the slow-subscriber problem.

---

## Task 4: Dynamic Subscribe and Unsubscribe

**Goal.** Allow subscribing and unsubscribing at any time, safely.

**Requirements.**
- `Subscribe()` returns a struct with `C() <-chan string` and `Unsubscribe()`.
- `Subscribe`, `Unsubscribe`, and `Publish` are all safe to call concurrently.
- `Unsubscribe` is idempotent (calling it twice is fine).

**Hints.**
- Use `sync.RWMutex`. Publish takes RLock; the others take Lock.
- Subscriber map: `map[*subscription]struct{}` for O(1) delete.
- Use `sync.Once` on the unsubscribe function to make it idempotent.

**Self-check.**
- 10 subscribers, 1000 publishes, randomly subscribe/unsubscribe during publish. No panics, no `goleak`.
- After unsubscribe, no further events arrive (the channel sees `ok=false`).

---

## Task 5: Drop-on-Overflow

**Goal.** Implement `DropNewest` and `DropOldest` policies.

**Requirements.**
- Each subscriber has a buffer of size B (configurable).
- For `DropNewest`: when buffer is full, the new event is dropped for that subscriber.
- For `DropOldest`: when buffer is full, remove the oldest event in the buffer and enqueue the new one.
- Hub remains fast even with a stuck subscriber.

**Hints.**
- `DropNewest`: `select { case s.ch <- v: default: }`.
- `DropOldest`: retry loop with non-blocking send and non-blocking receive to drop one.
- Add a `Stats()` method returning total drops per subscription.

**Self-check.**
- One subscriber that never reads, one that reads fast. Send 1000 events.
- With `DropNewest`, fast subscriber sees ~1000; slow subscriber holds only the first B events.
- With `DropOldest`, fast subscriber sees ~1000; slow subscriber holds only the *last* B events.

---

## Task 6: Topic-Based Pub/Sub

**Goal.** Add named topics.

**Requirements.**
- `Subscribe(topic string)` and `Publish(topic string, v T)`.
- A subscriber only receives events for its topic.
- Publishing to an unknown topic is a silent no-op.
- The library is generic: `TopicHub[T]`.

**Hints.**
- `map[string]*Hub[T]` underneath. Lazy-create on first subscribe.
- One RWMutex on the outer map; each Hub has its own internal sync.

**Self-check.**
- 3 topics, 2 subscribers each. Publish 5 to each topic. Each subscriber sees only its topic's events.
- Subscribe to a topic, publish to it, unsubscribe. Publish again. No leak (use `goleak`).

---

## Task 7: Slow-Subscriber Eviction

**Goal.** Disconnect subscribers that consistently can't keep up.

**Requirements.**
- Add a third policy: `Eject`.
- When delivery fails (buffer full), close that subscriber's channel and remove from the map.
- The subscriber sees `ok=false` and knows it was kicked.
- Provide a stat: how many ejections have happened.

**Hints.**
- Eject is just `DropNewest` plus a removal step.
- Be careful with locks — the publish loop holds `RLock`, but evict needs `Lock`. Either upgrade (release RLock first, then Lock) or defer the eviction to after publish.

**Self-check.**
- One subscriber that never reads, B=4 events to overflow. The fifth send triggers eviction.
- Subscriber observes `ok=false` from `<-sub.C()`.
- Stats report ejection count = 1.

---

## Task 8: sync.Cond Gate

**Goal.** Build the same "wake all" pattern with `sync.Cond` instead of channels.

**Requirements.**
- `type Gate struct { ... }` exposing `Wait()` and `Open()`.
- `Wait()` blocks until `Open()` is called.
- All goroutines blocked in `Wait()` wake up after `Open()`.
- `Open()` is idempotent: second call is a no-op.

**Hints.**
- `sync.NewCond(&mu)`. Inside `Wait`, lock `mu`, loop on `!open`, call `cond.Wait()`.
- `Open` locks, sets `open=true`, unlocks, calls `cond.Broadcast()`.

**Self-check.**
- 100 waiters, one Open. All 100 print "go!" once.
- Compare with the `close(done)` equivalent. Which is shorter? Which integrates with `ctx`?

---

## Task 9: Replay Buffer

**Goal.** Let late subscribers see the most recent K events.

**Requirements.**
- `SubscribeWithReplay(k int)` returns a snapshot of the last `k` events plus a live subscription.
- Hub retains the last K events under lock.
- Replay snapshot and live subscription are consistent: every event published after subscribe is delivered live; the replay is up to and including the most recent publish before subscribe.

**Hints.**
- Ring buffer of size K, or a slice trimmed on overflow.
- Snapshot under the same lock that admits new subscribers.

**Self-check.**
- Publish 10 events, then subscribe with replay=5. Snapshot has events 5..9.
- Publish 3 more. Live receives events 10..12. No duplicates, no gaps.

---

## Task 10: Coalescing Hub

**Goal.** "Latest wins" semantics. Useful for state snapshots.

**Requirements.**
- Each subscriber has a slot, not a buffer. `Publish(v)` overwrites the slot.
- Subscriber's `Receive()` returns the latest value or blocks if no fresh value.
- If 100 publishes happen between two receives, the subscriber sees only the latest.

**Hints.**
- Per-subscriber `latestOnly` struct with mutex, a `pending T`, a `has bool`, and a `ready chan struct{}` of capacity 1.
- `Set(v)` updates `pending`, optionally signals on `ready`. `Take()` clears and returns.

**Self-check.**
- Publish "v1", "v2", "v3" rapidly. Subscriber reads once → gets "v3".
- After reading, publish "v4". Next read returns "v4".

---

## Task 11: Sharded Hub

**Goal.** Horizontal scaling of broadcast.

**Requirements.**
- `ParallelHub[T]` with K internal hubs. Each subscriber is assigned a shard (hash by ID).
- `Publish(v)` writes to all K shards in parallel.
- Throughput scales linearly with K up to GOMAXPROCS.

**Hints.**
- Use an `errgroup.Group` or `sync.WaitGroup` to wait for all K publishes.
- Subscriber count per shard is `total/K` on average.

**Self-check.**
- Benchmark `BenchmarkPublish` with K=1, 2, 4, 8, 16. Plot ops/sec.
- The curve should rise until it plateaus at GOMAXPROCS or downstream bottleneck.

---

## Task 12: WebSocket Fan-Out Simulator

**Goal.** Realistic end-to-end exercise.

**Requirements.**
- Simulate 1000 "WebSocket clients" as goroutines, each subscribed to a hub.
- A publisher generates 100 events/sec.
- Each client logs the events to its own slice.
- 50% of clients are "slow" (10 ms processing time); the rest are fast (no sleep).
- Use `DropNewest` to ensure fast clients are not stalled.
- After 5 seconds, the publisher stops; assert fast clients have ≥450 events and slow clients have some events with reasonable variance.

**Hints.**
- Use `context.WithTimeout(ctx, 5*time.Second)` to drive the test.
- Per-client buffer 64 is enough.
- Add a metrics struct to track drops per subscriber.

**Self-check.**
- The hub should not slow down to 10ms/event because of slow clients.
- Drop count for slow clients should be roughly `(slow_time - buffer * receive_time) * publish_rate`.
- No `goleak`.

---

## Task 13: Benchmarks

**Goal.** Measure your Hub's performance.

**Requirements.**
- Implement `BenchmarkPublishSubscribers/N=10`, `N=100`, `N=1000`, `N=10000`.
- Each subscriber drains as fast as possible.
- Report ops/sec.
- Also benchmark `BenchmarkPublishWithBlock` and `BenchmarkPublishWithDrop` to compare policies.

**Hints.**
- `b.RunParallel` is not directly useful; you want single-publisher throughput.
- Set up subscribers before `b.ResetTimer()`.
- Use `b.ReportAllocs()` to track allocation per publish.

**Self-check.**
- At N=10, expect ~1 µs per publish.
- At N=10,000, expect ~1 ms per publish.
- Linear scaling? If sub-linear, your Hub has contention.
- Memory allocations per publish should be 0 once steady-state — no per-publish `make`, no per-publish `append`.

---

## Bonus: Polish and Document

Once your hub passes Task 12 and the benchmarks look reasonable, treat it as a real library:

- Write doc comments for every exported function. Cover: concurrency, lifecycle, ordering, error policy.
- Add a `README.md` with an example.
- Add a `CHANGELOG.md` even if it has one entry.
- Wire CI to run `go test -race ./...` on every push.
- Run `go vet`, `staticcheck`, and `golangci-lint`.
- Publish the module on a public repo with semantic versioning.

A real library is the difference between "I read about pub/sub" and "I have built and shipped pub/sub." Aim for the second.

---

## Hints If You Are Stuck

- **"My test panics with 'send on closed channel'."** A subscriber goroutine is sending to a channel only the hub should send to. Or the hub is sending after Close. Trace closing carefully — only the hub closes subscriber channels.
- **"My hub deadlocks under load."** You are holding a Mutex while sending on a subscriber channel. Use RWMutex and read-lock only.
- **"goleak fails."** Some goroutine is still alive. Common culprits: subscriber goroutines waiting on a closed channel that you forgot to close; hub goroutine blocked on a send to a slow subscriber.
- **"Race detector finds a data race on my subscriber map."** You are mutating the map without holding the write lock, or iterating it under no lock at all.
- **"Slow subscriber stalls the hub even with DropNewest."** Your delivery is not using `select default`. Re-check the policy implementation.

Solutions to all of these are explicit in the middle.md, senior.md, and find-bug.md files. If you cannot make progress in 30 minutes, look there.
