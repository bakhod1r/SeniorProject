# Producer–Consumer — Practice Tasks

> Hands-on tasks to build real fluency with the **Producer–Consumer** pattern — from a hand-rolled bounded buffer to lock-free ring buffers and graceful shutdown. Each task lists a goal, requirements, hints, and a solution sketch. See [Junior](junior.md) · [Middle](middle.md) · [Senior](senior.md) · [Professional](professional.md).

---

## Table of Contents

1. [Task 1 — Hand-Rolled Bounded Buffer](#task-1)
2. [Task 2 — Two-Condition Lock Version](#task-2)
3. [Task 3 — Worker Pool with Poison-Pill Shutdown](#task-3)
4. [Task 4 — Go Fan-Out / Fan-In Pipeline](#task-4)
5. [Task 5 — `offer` with Timeout (Load Shedding)](#task-5)
6. [Task 6 — Batching Consumer with `drainTo`](#task-6)
7. [Task 7 — Multi-Producer Channel Close](#task-7)
8. [Task 8 — Backpressure Demonstration](#task-8)
9. [Task 9 — Dead-Letter Queue for Poison Messages](#task-9)
10. [Task 10 — Minimal Lock-Free Ring Buffer (SPSC)](#task-10)
11. [How to Practice](#how-to-practice)

---

## Task 1 — Hand-Rolled Bounded Buffer

**Goal:** Implement `BoundedBuffer<T>` with `synchronized` + `wait`/`notifyAll`.

**Requirements:**
- `put(T)` blocks while full; `take()` blocks while empty. FIFO order.
- Backing store is a fixed-size ring buffer (`Object[]`, head/tail/count).
- Pass a stress test: 4 producers + 4 consumers, 1,000,000 items, conservation (in == out).

**Hints:** Guard both waits in `while`. Call `notifyAll` after every state change. Null out the slot on `take` to help GC.

<details><summary>Solution sketch</summary>

Two `synchronized` methods. `put`: `while (count == cap) wait();` then write at `tail`, advance, `count++`, `notifyAll()`. `take`: `while (count == 0) wait();` then read `head`, null the slot, advance, `count--`, `notifyAll()`. Conservation test: an `AtomicLong` produced vs consumed, asserted equal after a `CountDownLatch` on all threads.
</details>

---

## Task 2 — Two-Condition Lock Version

**Goal:** Rewrite Task 1 with `ReentrantLock` + `notFull`/`notEmpty` conditions; use targeted `signal`.

**Requirements:**
- `notFull.await()` in `put`, `notEmpty.await()` in `take`, each in a `while`.
- After a `put`, `notEmpty.signal()`; after a `take`, `notFull.signal()`.
- Explain in a comment why `signal` (not `signalAll`) is correct here.

**Hints:** Lock in a `try`/`finally` so `unlock()` always runs.

<details><summary>Solution sketch</summary>

`signal` is safe because every thread waiting on `notFull` can genuinely proceed once one slot frees (same for `notEmpty`) — there's no mixed-waiter problem, since the two conditions partition producers from consumers. This is exactly `ArrayBlockingQueue`'s design.
</details>

---

## Task 3 — Worker Pool with Poison-Pill Shutdown

**Goal:** 1 producer, N consumers over a `BlockingQueue`, shut down with poison pills.

**Requirements:**
- A unique sentinel `POISON`. Producer enqueues all work, then **N** pills.
- Each consumer loops `take()`; on `POISON`, breaks. Prove no consumer hangs and no real item is lost.

**Hints:** Pills go in *after* all real work. One pill per consumer, not one total.

<details><summary>Solution sketch</summary>

```java
for (int i = 0; i < N; i++) queue.put(POISON);
// consumer: Item it = queue.take(); if (it == POISON) break; else process(it);
```
Join all consumer threads; assert processed count equals produced count.
</details>

---

## Task 4 — Go Fan-Out / Fan-In Pipeline

**Goal:** A pipeline `generate → workers → collect` using bounded channels.

**Requirements:**
- Bounded `jobs` channel; `runtime.NumCPU()` worker goroutines.
- Results merged into one `results` channel, closed exactly once after all workers finish.
- `context.Context` cancellation aborts cleanly.

**Hints:** Use a `sync.WaitGroup` over workers; one goroutine does `wg.Wait(); close(results)`.

<details><summary>Solution sketch</summary>

Producer `for range inputs { select { case jobs<-x: case <-ctx.Done(): return } }`, then `close(jobs)`. Workers `for j := range jobs { select { case results<-f(j): case <-ctx.Done(): return } }`. Closer goroutine: `go func(){ wg.Wait(); close(results) }()`.
</details>

---

## Task 5 — `offer` with Timeout (Load Shedding)

**Goal:** Add a non-blocking-ish `offer(T, Duration)` returning `false` on timeout.

**Requirements:**
- Producer that uses `offer` increments a `rejected` counter instead of blocking forever.
- Under a deliberately slow consumer, show the rejected count rising — controlled load shedding.

**Hints:** Use `notFull.awaitNanos(remaining)` and recompute remaining time in the loop.

<details><summary>Solution sketch</summary>

`long deadline = nanoTime()+unit; while (full) { long rem = deadline - nanoTime(); if (rem <= 0) return false; notFull.awaitNanos(rem); }` then enqueue and return true. This is the [Balking](../11-balking/junior.md) alternative to blocking.
</details>

---

## Task 6 — Batching Consumer with `drainTo`

**Goal:** Make the consumer amortize a costly downstream call by batching.

**Requirements:**
- Consumer blocks for the first item with `take()`, then `drainTo(batch, 255)`.
- Simulate a 5 ms "flush" (DB round-trip) per batch; compare throughput vs per-item flush.

**Hints:** `drainTo` does not block — it grabs whatever is available right now.

<details><summary>Solution sketch</summary>

Per-item: throughput ≈ 1/5ms = 200/s. Batched (256): ≈ 256/5ms ≈ 51,000/s. The win is amortizing the fixed flush cost across the batch.
</details>

---

## Task 7 — Multi-Producer Channel Close

**Goal:** Safely close a Go channel with multiple producers.

**Requirements:**
- M producer goroutines writing to one channel; trigger a close-on-write panic deliberately, then fix it.
- The fix: a `WaitGroup` over producers and a single closer goroutine.

**Hints:** The rule is "the producer closes" — but with many producers, none of them may close; a coordinator does, after all finish.

<details><summary>Solution sketch</summary>

Buggy: each producer calls `close(ch)` on finish → second close panics, and a write after close panics. Fixed: `var pwg sync.WaitGroup` incremented per producer; `go func(){ pwg.Wait(); close(ch) }()`.
</details>

---

## Task 8 — Backpressure Demonstration

**Goal:** Empirically show bounded vs unbounded behavior under overload.

**Requirements:**
- Producer 10× faster than consumer. Run with a bounded queue (cap 100) and an unbounded one.
- Log queue depth over time. Show bounded depth plateaus at 100 (producer blocks); unbounded depth grows without limit (toward OOM).

**Hints:** Sample `queue.size()` on a timer. Cap the unbounded run's runtime so you don't actually crash your machine.

<details><summary>Solution sketch</summary>

Bounded: depth saturates at 100, producer's effective rate drops to the consumer's rate — that's backpressure. Unbounded: linear growth at (producer − consumer) rate; extrapolate to the OOM point.
</details>

---

## Task 9 — Dead-Letter Queue for Poison Messages

**Goal:** Stop one always-failing item from causing head-of-line blocking.

**Requirements:**
- Consumer retries an item up to 3 times; on repeated failure, moves it to a `deadLetter` queue and continues.
- Prove the pipeline keeps draining despite a permanently-failing item.

**Hints:** Track an attempt count per item (a wrapper record). Never block the main queue on a failing item.

<details><summary>Solution sketch</summary>

Wrap items as `Attempt(item, tries)`. On failure with `tries < 3`, re-enqueue; else `deadLetter.put(item)`. Measure throughput with and without the dead-letter path to see head-of-line blocking disappear.
</details>

---

## Task 10 — Minimal Lock-Free Ring Buffer (SPSC)

**Goal:** Build a single-producer/single-consumer lock-free ring buffer.

**Requirements:**
- Power-of-two capacity; `volatile long head, tail`; index = `seq & (cap-1)`.
- No locks. Producer advances `tail` after writing; consumer advances `head` after reading.
- Stress test correctness; observe throughput vs `ArrayBlockingQueue`.

**Hints:** Publish the write with the `volatile` `tail` store (the memory barrier). For a real one you'd pad `head`/`tail` to separate cache lines to avoid false sharing.

<details><summary>Solution sketch</summary>

Producer: `if (tail - head == cap) return false; buf[tail & mask] = x; tail = tail + 1; // volatile store publishes`. Consumer: `if (head == tail) return null; x = buf[head & mask]; head = head + 1;`. This is the conceptual core of the Disruptor's SPSC path; see [Professional](professional.md).
</details>

---

## How to Practice

- **Do Tasks 1→3 in order** — hand-rolled, then library, then shutdown. Don't skip the hand-rolled buffer; it cements the two rules (`while`, `notifyAll`).
- **Run everything under a race/stress harness.** Java: stress with millions of items and a global timeout. Go: always `go test -race`.
- **Assert conservation, not just "it ran."** Items in must equal items out plus items dropped. A green run that loses items silently is the trap.
- **Force the failure modes deliberately** (Tasks 7, 8, 9). Triggering the close-panic, the OOM trajectory, and head-of-line blocking *on purpose* is how you learn to recognize them in production.
- **Profile Task 6 and Task 10.** Batching and lock-free are the two biggest performance levers; measure the actual numbers so the orders-of-magnitude claims become real to you.
- **Re-implement one task in a second language** (Java ↔ Go) to internalize that the shape is identical and only the constants differ.
