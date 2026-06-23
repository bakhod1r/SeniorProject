# Leader/Followers — Tasks

> Hands-on tasks for the Leader/Followers concurrency pattern. Build the loop, the promotion protocol, and the scale-out forms. See [junior.md](junior.md) and [middle.md](middle.md) first.

## Table of Contents

1. [Task 1 — Minimal Leader/Followers Loop](#task-1--minimal-leaderfollowers-loop)
2. [Task 2 — The Promotion Protocol](#task-2--the-promotion-protocol)
3. [Task 3 — Echo Server over a Shared Selector](#task-3--echo-server-over-a-shared-selector)
4. [Task 4 — Clean Shutdown](#task-4--clean-shutdown)
5. [Task 5 — Leader-Starvation Detector](#task-5--leader-starvation-detector)
6. [Task 6 — Promote-Before-Process Assertion Harness](#task-6--promote-before-process-assertion-harness)
7. [Task 7 — Context-Switch Benchmark vs Queue Pool](#task-7--context-switch-benchmark-vs-queue-pool)
8. [Task 8 — Sharded Leader/Followers](#task-8--sharded-leaderfollowers)
9. [Task 9 — Mid-Flight Connection Registration](#task-9--mid-flight-connection-registration)
10. [Task 10 — Fairness with a FIFO Follower Queue](#task-10--fairness-with-a-fifo-follower-queue)
11. [How to Practice](#how-to-practice)

---

## Task 1 — Minimal Leader/Followers Loop

**Goal.** Implement the four-step loop: become leader → select → promote → process.

**Requirements.**
- One `ReentrantLock` + `Condition` + a `leaderPresent` boolean.
- Exactly one thread in `selector.select()` at a time.
- Promote *before* processing; `signal()` exactly one follower.

**Hints.** Use a `while (leaderPresent) condition.await()` guard. Remove the `SelectionKey` from `selectedKeys()` once claimed.

**Solution sketch.**
```java
while (running) {
    becomeLeader();        // lock; while(leaderPresent) await(); leaderPresent=true; unlock
    var keys = leaderSelect();   // selector.select(); drain+remove ready keys
    promote();             // lock; leaderPresent=false; signal(); unlock
    for (var k : keys) dispatch(k);
}
```

## Task 2 — The Promotion Protocol

**Goal.** Extract the promotion protocol into its own class so the loop reads as four named verbs.

**Requirements.** A `Promotion` class exposing `acquireLeadership()`, `releaseAndPromote()`, `shutdownWakeAll()`. The lock, condition, and flag are private to it.

**Hints.** Keep the critical section to flag-flip + signal only — never hold the lock across `select()` or a handler.

**Solution sketch.** `acquireLeadership` does the while-await-claim; `releaseAndPromote` does clear-flag + `signal()`; `shutdownWakeAll` does `signalAll()`. The loop becomes self-documenting.

## Task 3 — Echo Server over a Shared Selector

**Goal.** A working echo server: many client connections, a 4-thread Leader/Followers pool, each readable event echoes the bytes back.

**Requirements.** Accept connections (register OP_READ), read on readable, write the same bytes back. Non-blocking channels.

**Hints.** The accept handler must register the new channel and `selector.wakeup()` the leader. Echo handler must handle partial reads/writes.

**Solution sketch.** Two `EventHandler`s: `AcceptHandler` (registers OP_READ) and `EchoHandler` (read → write). The pool dispatches by `key.attachment()`.

## Task 4 — Clean Shutdown

**Goal.** Stop all threads gracefully.

**Requirements.** A `volatile boolean running`. `shutdown()` sets it false, `signalAll()`s the followers, and `selector.wakeup()`s the blocked leader. All threads exit their loop and join.

**Hints.** This is the *only* place `signalAll()` is legitimate — followers must observe `running == false`. The leader is in `select()`, so a flag alone won't wake it; `wakeup()` is required.

**Solution sketch.** In `becomeLeader`'s while-loop, also check `running`; return early if shutting down. After the loop, `join()` all threads.

## Task 5 — Leader-Starvation Detector

**Goal.** Detect when the pool has no follower available (LEADER + PROCESSING == N).

**Requirements.** An `AtomicInteger processing`. Increment before dispatch, decrement after. Expose a gauge; log a warning when `processing == poolSize - 1` (leader is the Nth, nobody to promote).

**Hints.** Track this in the loop, not in the lock — it's diagnostic, not correctness-critical.

**Solution sketch.** When `promote()` signals but no follower waits, increment a `missedPromotions` counter. A rising counter = chronic starvation = pool too small or handlers too slow.

## Task 6 — Promote-Before-Process Assertion Harness

**Goal.** A test that fails if a refactor ever processes before promoting.

**Requirements.** Inject a recorder that logs the order of `promote` and `process` calls per iteration. Assert `promote` precedes `process` every time.

**Hints.** Use poolSize = 2 with a deliberately slow handler; assert the *other* thread becomes leader and calls `select()` *during* the slow handler.

**Solution sketch.** Have the slow handler block on a latch; from the test thread, assert the second thread has entered `select()` (became leader) before releasing the latch. If promotion happened after processing, the second thread would still be a follower — test fails.

## Task 7 — Context-Switch Benchmark vs Queue Pool

**Goal.** Empirically show Leader/Followers does fewer context switches per request than a queue-based pool for short handlers.

**Requirements.** Same handler, same load, two designs. Measure voluntary+involuntary context switches (`pidstat -w` or `/proc/<pid>/status`).

**Hints.** Use a sub-microsecond CPU-bound handler. Pin threads. Warm up the JIT. Report ctx-switches/request, not just latency.

**Solution sketch.** Expect ~0 ctx-switches/req for L/F vs ~1/req for the queue pool. Then swap in a *blocking* handler and watch L/F's advantage invert (leader starvation) — proving the precondition.

## Task 8 — Sharded Leader/Followers

**Goal.** Scale past promotion-lock saturation by sharding the handle set.

**Requirements.** M selectors, M pools of N/M threads each. Hash each connection to a shard at accept time; pin it there for life.

**Hints.** Each shard is an independent Leader/Followers with its own lock — no cross-shard lock. `registerInterest` must `wakeup()` the target shard's leader.

**Solution sketch.** `shard = floorMod(channel.hashCode(), M)`. Route accept → shard. Tune M so threadsPerShard keeps each token below saturation (often 2–4).

## Task 9 — Mid-Flight Connection Registration

**Goal.** Let a handler register a brand-new connection while the leader is blocked in `select()`.

**Requirements.** A thread-safe pending-registration queue drained by the leader before `select()`; `selector.wakeup()` to unblock the current leader so it picks up the new interest.

**Hints.** You cannot register on a `Selector` from another thread while it's mid-`select()` without `wakeup()`. Drain pending registrations at the top of `leaderSelect()`.

**Solution sketch.** `register()` enqueues + `wakeup()`. `leaderSelect()` polls the queue, registers each, then `select()`s.

## Task 10 — Fairness with a FIFO Follower Queue

**Goal.** Prevent one thread from repeatedly re-winning leadership (starvation convoy).

**Requirements.** Replace the single condition with an explicit FIFO queue of waiting followers; promote the *head* of the queue.

**Hints.** This mirrors ACE's FIFO `ACE_Token`. Each follower enqueues itself and waits on its own condition/latch; `promote()` dequeues the head and signals only it.

**Solution sketch.** A `Deque<Condition>` (or per-thread latches). `acquireLeadership` enqueues self, awaits its own condition. `promote` polls the head and signals it. Strict FIFO → no starvation.

## How to Practice

- **Build Task 1 first, then layer.** Tasks 2–4 turn the toy into a server you can `telnet` into. Don't skip the echo server — it makes the abstraction concrete.
- **Always verify the invariant.** Task 6 is the most important test you'll write: it catches the single most common Leader/Followers bug (promote-after-process).
- **Measure, don't assume (Task 7).** The pattern's entire justification is performance. If your benchmark doesn't show fewer context switches, you don't have a use case for it.
- **Scale only when forced (Task 8).** Reach for sharding only after a benchmark shows the single promotion lock saturating — premature sharding adds imbalance for no gain.
- **Compare against the alternatives.** After each task, ask: would [Half-Sync/Half-Async](../08-half-sync-half-async/junior.md) be simpler here? Often the honest answer is yes — and recognizing that is the skill.
