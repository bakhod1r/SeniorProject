# Semaphore — Hands-On Tasks

> **Topic:** [Semaphore](README.md)

---

## Introduction

A semaphore is a counting primitive that gates access to a finite number of permits. Unlike a mutex, which is binary and has an owner, a semaphore allows up to N concurrent holders and has no ownership concept — any thread may release a permit, even one it never acquired. That asymmetry is the source of both the semaphore's power (rate limiting, resource pooling, bulkheads, signaling between unrelated threads) and its danger (over-release, lost permits, drift in pool sizes).

This task file walks you from the most basic counting-semaphore mechanics — "limit concurrency to N" — through fair vs unfair queueing, weighted permits, async cancellation, backpressure, and into production-grade patterns: connection pools, bulkheads, multi-tenant fairness, and adaptive rate limiters. The capstone projects ask you to build small but complete subsystems: a SQL connection pool, an outbound-HTTP bulkhead, and a rate-limiting middleware. Each is a real component you would find in a backend service, scaled down to a few hundred lines so you can finish it in a sitting.

Work in whatever language you are sharpening (Go, Java, Python, C#, Rust), but try to do at least one task in a language whose semaphore implementation you have never opened. The semantics of `Semaphore.acquire` in Java, `asyncio.Semaphore` in Python, and a buffered channel-as-semaphore in Go are subtly different — internalizing those differences is half the point.

Rules of engagement:

- Reproduce every bug before you "fix" it. Acquired-but-never-released permits are notoriously easy to claim you fixed and notoriously hard to actually fix.
- Always measure permit balance at the end of a test. `available_permits == initial_permits` is the cheapest correctness check you have.
- For every blocking acquire, ask: "what happens if the holder dies before release?" If the answer is "the pool leaks", you have not finished the task.
- Prefer try-with-resources, `defer`, `using`, or `finally` for release. Manual release on every code path is a recipe for permit leaks.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Sample Solutions](#sample-solutions)
- [Related Topics](#related-topics)

---

## Warm-Up

### Task 1: Concurrency-limited rate limiter

**Problem.** Write a function `fetch_all(urls, max_concurrent)` that downloads a list of URLs but never has more than `max_concurrent` HTTP requests in flight at once. Use a semaphore — not a thread pool, not a worker queue — to enforce the limit.

**Constraints.**
- The semaphore is the only concurrency-limit mechanism. Spawn one goroutine/thread/task per URL.
- Total wall-clock time for 100 URLs with `max_concurrent=10` and 200 ms per request should be roughly `100/10 * 0.2 = 2 s`, not 20 s and not 0.2 s.
- Permits must be released on both success and error paths.

**Hints.**
- In Go, model the semaphore as a buffered channel of `struct{}` with capacity `max_concurrent`.
- In Python, use `asyncio.Semaphore` and `async with`.
- In Java, use `java.util.concurrent.Semaphore` and `try { acquire(); ... } finally { release(); }`.

**Self-check.**
- At the end, log `available_permits`. It must equal `max_concurrent`.
- Inject a fake URL that raises an exception; the rest must still complete and the final count must still be balanced.

---

### Task 2: Bounded buffer with semaphore + mutex

**Problem.** Implement a fixed-capacity producer/consumer queue using two semaphores (`empty_slots`, `full_slots`) and a mutex to protect the underlying ring buffer. Producers block when the buffer is full; consumers block when empty.

**Constraints.**
- Buffer capacity is `N`. Initialize `empty_slots = N`, `full_slots = 0`.
- A producer does: acquire `empty_slots`, lock mutex, push, unlock mutex, release `full_slots`. A consumer does the symmetric dance.
- Do not use a condition variable. Pure semaphores.

**Hints.**
- The acquire order matters. Acquire the resource semaphore first, then the mutex. Reversing causes deadlock when the buffer is full.
- Hold the mutex for the smallest possible critical section.

**Self-check.**
- Run 4 producers and 4 consumers, each doing 10 000 items. Final buffer must be empty and total produced must equal total consumed.
- Sum of `empty_slots + full_slots` should always equal `N` at any quiescent moment.

---

### Task 3: Java `Semaphore` with N=3

**Problem.** Spin up 10 worker threads that each call a "print to a shared printer" routine that takes 100 ms. Use `Semaphore(3)` so that at most 3 workers can be printing simultaneously. Print the timestamp and worker ID at acquire and release.

**Constraints.**
- All 10 threads must eventually complete.
- Use `tryAcquire(timeout)` for one of the threads with a 50 ms timeout to demonstrate the timeout branch.
- Use `try/finally` for release.

**Hints.**
- `Semaphore(3, true)` enables fair (FIFO) ordering. Try both fair and unfair and observe acquire order in the logs.

**Self-check.**
- Count concurrent holders by incrementing/decrementing an `AtomicInteger` inside the critical section; it should never exceed 3.

---

### Task 4: Python `threading.Semaphore` for a shared resource

**Problem.** Simulate a parking lot with 4 spots. Spawn 12 "car" threads; each acquires a spot, parks for a random 200–500 ms, then leaves. Log entries and exits.

**Constraints.**
- Use `threading.Semaphore(4)`.
- Use `with sem:` (context manager) so release is automatic.
- Show that the 5th car waits until one of the first 4 leaves.

**Hints.**
- Add a small `time.sleep(random.uniform(0.2, 0.5))` per car. The log will show "car 5 entered" only after "car X left".

**Self-check.**
- Print `sem._value` at quiescence — should be 4. (Yes, you are reading a private attribute; this is the simplest balance check available in Python.)

---

### Task 5: Go semaphore-as-channel

**Problem.** Implement `Sem` as a thin wrapper over a buffered channel: `Acquire`, `Release`, `TryAcquire`. Use it to limit a worker pool processing items from a slice to `N=5` concurrent workers.

**Constraints.**
- The channel has capacity `N`. `Acquire` sends an empty struct, `Release` receives one.
- `TryAcquire` returns `false` immediately if no permit is available (use `select` with `default`).
- No additional mutex.

**Hints.**
```go
type Sem chan struct{}

func New(n int) Sem { return make(Sem, n) }
func (s Sem) Acquire()    { s <- struct{}{} }
func (s Sem) Release()    { <-s }
func (s Sem) TryAcquire() bool {
    select {
    case s <- struct{}{}: return true
    default:              return false
    }
}
```

**Self-check.**
- After the pool drains, `len(sem)` must be 0.
- `TryAcquire` after all permits are taken must return `false` without blocking.

---

### Task 6: Over-release bug (intentional)

**Problem.** Reproduce a permit-inflation bug. Start with `Semaphore(3)`. Have one worker call `release()` twice in a row (a typo: `release; release;` where the second release was supposed to be on a different semaphore). Demonstrate that subsequent `acquire` calls now allow 4 holders.

**Constraints.**
- Use the language's plain semaphore (Java `Semaphore`, Python `threading.Semaphore`, etc.).
- Add an `AtomicInteger` "in-flight" counter; assert it never exceeds 3. Watch the assertion fail.

**Hints.**
- Java `Semaphore` does not bound the permit count, so `release()` can drive it arbitrarily high. This is by design — and that design is exactly why over-release is so dangerous.
- Python's `BoundedSemaphore` raises `ValueError` on over-release; `Semaphore` does not. Try both.

**Self-check.**
- After the buggy run, query `available_permits`. It should equal 4, not 3 — proof of the leak in the wrong direction (inflation).
- Switch to `BoundedSemaphore` or a custom guard and rerun; the second release should throw.

---

### Task 7: Signaling vs mutual exclusion

**Problem.** Use a `Semaphore(0)` purely as a one-shot signal. Thread A does work, then `release()`s; Thread B `acquire()`s, then proceeds. Generalize to "Thread B waits until Thread A has released 5 times".

**Constraints.**
- No `wait/notify`, no condition variables. Only the semaphore.
- Thread B should not busy-wait.

**Hints.**
- This is the textbook semaphore-as-signal pattern. It works because a semaphore's `release` always succeeds (no blocking), so Thread A can signal before Thread B has even started.

**Self-check.**
- Reverse the order: start Thread B first, then Thread A. B should still wait until A has signaled 5 times.

---

## Core

### Task 8: Producer/consumer with two semaphores

**Problem.** Build a multi-producer, multi-consumer queue of fixed capacity using exactly two semaphores (`empty`, `full`) and one mutex. Run with 3 producers, 3 consumers, capacity 8, and 100 000 items. Verify FIFO is preserved per-producer (but not globally — that is a different problem).

**Constraints.**
- Same as Task 2 but with multiple producers and consumers and an order-preservation check per producer.
- Each producer assigns a monotonically increasing sequence number; consumers append `(producer_id, seq)` to a per-producer log; final per-producer logs must be strictly increasing.

**Hints.**
- The mutex protects the ring buffer. The semaphores synchronize across the producer/consumer boundary.
- Use a deque for the buffer to make popping from the head O(1).

**Self-check.**
- For each producer ID, the consumed sequence numbers must be sorted ascending.
- Sum of all consumed items equals sum of all produced items.

---

### Task 9: Weighted permits

**Problem.** Implement a `WeightedSemaphore(total)` that supports `acquire(n)` and `release(n)` where `n` is a positive integer. Use it to model an "8 GB memory budget" where each task knows its memory cost and acquires that many permits.

**Constraints.**
- Acquiring `n > available` must block until enough permits are returned.
- `acquire(n)` for `n > total` must throw immediately.
- Spawn tasks of various weights (256 MB, 1 GB, 4 GB) and run 50 of them; verify the in-flight memory sum never exceeds 8 GB.

**Hints.**
- Underlying state is `available: int`, a mutex, and a condition variable.
- Wake up all waiters on release (or smarter: wake the front waiter if it fits; otherwise leave it).

**Self-check.**
- Run a stress test with random weights for 60 s; the maximum observed in-flight sum must equal `total` (you should be saturating it) but never exceed.
- At end of run, `available == total`.

---

### Task 10: Fair vs unfair experiment

**Problem.** Take Java's `Semaphore` (or any language's fair/unfair variant). Build a benchmark where 16 threads repeatedly acquire 1 permit, hold for 1 ms, then release. Run for 30 s in fair mode and 30 s in unfair mode. Report total throughput and the standard deviation of per-thread acquisition counts.

**Constraints.**
- Same workload, same hardware, only the fairness flag changes.
- Record per-thread acquire counts.

**Hints.**
- Fair mode trades throughput for predictability. Expect fair mode to be 2–5× slower but with near-identical per-thread counts. Unfair mode is faster but one or two threads may dominate.

**Self-check.**
- In fair mode, max/min per-thread acquire count ratio should be near 1.0.
- In unfair mode, the ratio is often 3× or worse.

---

### Task 11: Async semaphore with cancellation

**Problem.** In Python's `asyncio` (or C#'s `SemaphoreSlim`, or Kotlin coroutines), build a task that acquires a semaphore, awaits a long operation, then releases. Trigger task cancellation while the acquire is pending and again while the long op is running. Verify no permit is leaked in either case.

**Constraints.**
- Use `async with sem:` (Python) — it is cancellation-safe.
- Then deliberately write the non-context-manager version (`await sem.acquire(); ...; sem.release()`) and demonstrate the leak when cancellation happens between `acquire` and the `release`.

**Hints.**
- The crux is whether the cleanup runs on cancellation. Context managers run `__aexit__`; raw `await acquire()` followed by code does not.
- Use `try/finally` in the raw version to fix the leak.

**Self-check.**
- After each cancellation experiment, log `sem._value` — must equal initial.

---

### Task 12: "First N readers" pattern

**Problem.** A publish/subscribe channel has many subscribers, but only the first N to read each message should process it; the rest skip. Implement with a `Semaphore(N)` reset per message and `tryAcquire`.

**Constraints.**
- For each message, exactly N (or fewer, if subscribers are slow) subscribers process it; the others see `tryAcquire == false` and skip.
- The semaphore is reset (re-initialized to N permits) before each message broadcast.

**Hints.**
- The trick is the reset. The cleanest way is to allocate a fresh `Semaphore(N)` per message.
- Avoid `drainPermits` + `release(N)` — that has a race window.

**Self-check.**
- For 1000 messages with 50 subscribers and N=10, exactly 10 000 process events should fire.

---

### Task 13: Resource pool with permit return

**Problem.** Implement a generic `Pool<T>` (e.g., DB connections, byte buffers) backed by a semaphore that gates `acquire()` and a thread-safe stack/queue that holds idle resources. `acquire()` returns a `Lease<T>` that releases on close/dispose.

**Constraints.**
- `acquire()` blocks if no permits available.
- `Lease.close()` puts the resource back into the idle list and releases the permit. Double-close must be a no-op (or throw, your choice — document it).
- Resources are created lazily up to `max`; the semaphore enforces `max`.

**Hints.**
- Use try-with-resources / `using` / `defer lease.Close()` at every call site.
- Track "leased" count separately for debugging.

**Self-check.**
- After every test, `leased == 0` and `idle_count + leased == created`.
- Permits available equals `max - leased` always.

---

### Task 14: Backpressure with TryAcquire + drop

**Problem.** Build an event-handler that receives events from an upstream firehose. Cap concurrent processing at N with a semaphore; if no permit is available, drop the event and increment a `dropped` counter. Expose the drop rate.

**Constraints.**
- Use non-blocking `tryAcquire()` only. Never block the upstream.
- Track `accepted`, `dropped`, and `in_flight` atomically.

**Hints.**
- This is the load-shedding pattern. It is preferable to queueing because queues hide latency growth.
- Add a 1 s metric flush that logs `(accepted, dropped, in_flight)` and resets.

**Self-check.**
- Under sustained overload, `accepted + dropped == received` and `in_flight <= N` at all times.

---

### Task 15: Permit-leak fault injection

**Problem.** Take any of the previous solutions and inject a fault: the worker throws an exception after `acquire` but before the protected operation. Confirm the permit leaks; then refactor with `try/finally` (or `defer`) so it does not.

**Constraints.**
- Reproduce the leak first, with assertions failing.
- Then fix, with assertions passing.

**Hints.**
- The simplest leak is `sem.acquire(); doWork(); sem.release();` where `doWork` throws.
- The fix is `sem.acquire(); try { doWork(); } finally { sem.release(); }`.

**Self-check.**
- Run 1000 iterations with 10% fault rate; final `available_permits == initial` in the fixed version, but is steadily decreasing in the buggy version.

---

### Task 16: Reentrant semaphore (or not)

**Problem.** Investigate whether your language's semaphore is reentrant. Have the same thread `acquire()` twice in a row, on a `Semaphore(1)`. Does it deadlock? Does it succeed (consuming 2 permits)? Document the behavior.

**Constraints.**
- Use Java `Semaphore`, Python `threading.Semaphore`, Go channel-sem. Compare.
- Then build a *reentrant* counting semaphore — one that tracks per-thread acquire counts and allows the same thread to re-enter without consuming additional permits.

**Hints.**
- Most semaphores are not reentrant. `Semaphore(1).acquire(); Semaphore(1).acquire()` on the same thread blocks forever (Java) or deadlocks (Go channel).
- Reentrant counting semaphores are unusual; for mutual exclusion use a reentrant mutex instead.

**Self-check.**
- For Java `Semaphore(1)`, the second acquire on the same thread should block (verify with a timed `tryAcquire`).

---

### Task 17: Semaphore for rate-per-second (not concurrency)

**Problem.** Build a "100 requests per second" rate limiter using a semaphore that is replenished by a background ticker. Each call `acquire()`s one permit; the ticker releases up to 100 permits per second (without exceeding a max-burst cap).

**Constraints.**
- Burst cap = 200. Steady state = 100 permits/sec.
- The ticker runs every 10 ms and releases 1 permit, up to the cap.
- Callers use `tryAcquire(timeout)` so they fail fast under sustained overload.

**Hints.**
- This is a leaky-bucket / token-bucket variant where the semaphore *is* the bucket.
- Be careful not to over-release past `burst_cap`. Use `BoundedSemaphore` or check before release.

**Self-check.**
- Hammer with 10 000 requests; over a 60 s window the average accepted rate should be 100/s ± 5%.

---

## Advanced

### Task 18: Connection pool with semaphore + healthcheck

**Problem.** Build a DB connection pool: `max_size` connections, semaphore gates `acquire`, on lease return run a quick health-check (a `SELECT 1`); if it fails, discard the connection and decrement the "created" counter so a fresh one can be opened.

**Constraints.**
- Use a real DB driver or simulate with a `Connection` struct that has a `healthy` bool you toggle.
- Permit accounting must stay correct across both happy path and connection-discarded path.
- Add a `maxIdleTime` that closes connections idle longer than 5 min.

**Hints.**
- The naive bug: discard a bad connection and forget to allow a new one to be created. Result: permit usable but no connection to back it. Either always create-on-demand inside the lease or maintain a separate `created` counter.
- The healthcheck must not hold the pool mutex.

**Self-check.**
- After 10 000 lease cycles with 5% simulated unhealthy connections, `available_permits + leased_count == max_size`. `created <= max_size`.

---

### Task 19: Bulkhead via semaphore

**Problem.** Two upstream tenants (A and B) share a service. Each gets its own bulkhead semaphore of size 50, with a global semaphore of size 80 as a hard cap. A burst from A must not be able to starve B.

**Constraints.**
- A request from tenant X must acquire both the per-tenant semaphore *and* the global semaphore (acquire global first to avoid a deadlock).
- If either acquisition times out, fail fast.
- Add metrics: per-tenant queue depth, rejections, throughput.

**Hints.**
- Acquire order matters for fairness: acquire the broader one first.
- Document why 50 + 50 > 80 is intentional — the global cap forces fairness when both tenants try to use their full allotment.

**Self-check.**
- Saturate tenant A. Tenant B's latency should stay near baseline; B's rejections should stay at zero up to its 50-permit limit.

---

### Task 20: Adaptive concurrency limiter

**Problem.** Implement an AIMD (additive-increase, multiplicative-decrease) controller that adjusts the semaphore's permit count based on observed latency. Start at 10 permits. Every 1 s: if p95 latency < target, increase by 1 (up to a cap); if p95 > target, halve.

**Constraints.**
- The semaphore must support dynamic resize: `setPermits(n)` that releases or "consumes" extra permits.
- Decreases should not yank permits from current holders; instead, mark "owed" permits and decrement as holders release.
- Acquire latency must be tracked per request.

**Hints.**
- Reducing permits from above is delicate. The cleanest design is a separate `target` integer and a `current` integer; releases go to a no-op until `current <= target`.
- See Netflix's "concurrency-limits" library for inspiration.

**Self-check.**
- Inject latency that grows with concurrency; the controller should oscillate around a stable equilibrium and never exceed a defined max.

---

### Task 21: Multi-tenant fair scheduling (DRF / weighted)

**Problem.** Extend the bulkhead to support weighted permits per tenant: tenant A has weight 2, tenant B has weight 1, total semaphore size 30. Under contention, A:B should approach 2:1 throughput.

**Constraints.**
- Use weighted-fair queueing: when permits free, pick the tenant with the lowest virtual time.
- Implement with a priority queue of waiters keyed by virtual time.

**Hints.**
- Virtual time = work_done / weight. The tenant with the smallest virtual time gets served next.
- This is essentially deficit round-robin in semaphore form.

**Self-check.**
- Run with 100 reqs/s from each tenant, target throughput 60/s. A should get ~40/s, B should get ~20/s.

---

### Task 22: Read-heavy semaphore with batched acquires

**Problem.** A vectorized batch operation acquires `k` permits at once (one per element). For high `k`, naive `for i in k: acquire()` causes pathological waiting. Implement `acquire(k)` that atomically waits for `k` permits.

**Constraints.**
- The acquire either gets all `k` permits at once or none and waits.
- Avoid the "thundering herd" where waking up one waiter starves another with smaller `k`.

**Hints.**
- Use a condition variable: `while (available < k) wait()`; on release, `notifyAll` so smaller waiters also get a chance.
- Beware lost wakeups if you `notify` instead of `notifyAll`.

**Self-check.**
- Mix `acquire(1)` and `acquire(10)` waiters; both should eventually progress, no starvation.

---

### Task 23: Cross-process semaphore

**Problem.** Build a cross-process counting semaphore using Redis (`INCR` / `DECR` with a max cap). Two processes share a budget of 100 outbound HTTP connections.

**Constraints.**
- `acquire`: `INCR counter`; if value > 100, `DECR` and retry/wait.
- `release`: `DECR counter`. Use Lua scripting so the increment-and-check is atomic.
- Add a TTL-based safety net: if a process dies holding permits, they must auto-release within 30 s.

**Hints.**
- The simplest TTL design: each acquire creates a `permit:<uuid>` key with TTL 30 s and the holder must `PEXPIRE` it every 10 s to keep it alive. On expiration, a janitor decrements.
- A real implementation uses Redis streams or Redlock.

**Self-check.**
- Run two processes, each spinning up 100 workers. Total in-flight requests across processes must never exceed 100.

---

### Task 24: Semaphore as completion barrier

**Problem.** A parent task spawns N children and must wait for all to finish. Implement with `Semaphore(0)`: each child `release()`s on completion; the parent `acquire(N)` (or N times) to wait. Compare to using a `CountDownLatch` / `sync.WaitGroup`.

**Constraints.**
- The parent must not know in advance how long each child takes.
- Try both: parent does `for i in N: acquire()` and parent does a hypothetical `acquire(N)` if available.

**Hints.**
- This is one of the textbook uses of semaphore-as-signal.
- The semaphore-as-barrier approach is more flexible than `WaitGroup` because it supports `acquire(N)` (wait for any N out of M children).

**Self-check.**
- Total wall time equals the max child time, not the sum.

---

### Task 25: Detecting stuck holders

**Problem.** Add instrumentation: every `acquire` records `(thread_id, timestamp)`; every `release` clears it. A background watchdog logs any holder whose duration exceeds 1 s, including their stack trace.

**Constraints.**
- The recording must be cheap (microseconds) — no synchronous I/O on the hot path.
- The watchdog runs every 500 ms.

**Hints.**
- Java: `Thread.getStackTrace()` on the holder's thread.
- Go: this is harder because you cannot easily get a goroutine's stack from outside; record the call site at acquire time (file:line via `runtime.Caller`).

**Self-check.**
- Deliberately introduce a `time.sleep(2 * time.Second)` between acquire and release; watchdog must log it within ~500 ms.

---

## Capstone

### Capstone 1: SQL connection pool with weighted permits

**Problem.** Design and build a SQL connection pool that supports both regular and "long-running analytical" queries. The pool has 20 connections total. Regular queries take 1 permit; analytical queries declare an estimated cost and acquire 4 permits. Acquire has a configurable timeout. Connections are health-checked on return; bad ones are discarded and replaced.

**Constraints.**
- Use a weighted semaphore (see Task 9).
- `acquire(weight, timeout)` returns a `Lease` with `query(sql)` and `close()`.
- A `Stats` struct reports: `created`, `leased`, `idle`, `waiting`, `acquire_p95_ms`, `discarded_unhealthy`.
- Cap analytical queries to at most 2 concurrent (separate semaphore) so they cannot monopolize the pool.
- Implement a graceful shutdown that drains in-flight leases up to a max wait, then force-closes.

**What "done" looks like.**
- Unit tests pass with both a mock connection and a real SQLite or Postgres.
- Stress test: 50 client threads, mix of regular and analytical, for 60 s, ends with `leased == 0`, `created <= 20`, no leaked permits.
- A chaos test that randomly kills 5% of connections mid-query still terminates cleanly.
- Documentation explains the deadlock-avoidance order between the global semaphore and the analytical sub-semaphore.

---

### Capstone 2: Bulkhead for outbound HTTP

**Problem.** Build a wrapper around an HTTP client (`reqwest`, `axios`, `OkHttp`, etc.) that enforces per-host concurrency limits using semaphores, with a global cap that prevents any one host from monopolizing the connection budget.

**Constraints.**
- Global semaphore size 100. Per-host semaphore size 20. Per-host map is lazily created.
- Acquire order: global first, then per-host. Release in reverse.
- Both acquires use a timeout; failure returns a `BulkheadRejected` error.
- Add circuit-breaker semantics: if a host fails 5 times in 10 s, all subsequent acquires for that host fail-fast for 30 s.
- Metrics per host: in-flight, queue depth (= waiters), rejections.

**What "done" looks like.**
- Test with a fake upstream that returns 200 OK for some hosts and 500 for one host; verify the bad host gets isolated and does not consume the global budget.
- Load test with 500 concurrent requests across 10 hosts; total in-flight never exceeds 100; per-host never exceeds 20.
- Document the failure modes: what happens if a request is cancelled mid-flight, if the host map grows unboundedly (LRU eviction), and if the per-host semaphore is contested at shutdown.

---

### Capstone 3: Rate-limiting middleware

**Problem.** Implement an HTTP-server middleware (or any RPC interceptor) that combines token-bucket rate limiting (per-API-key) with concurrency limiting (per-endpoint) using semaphores.

**Constraints.**
- Per-API-key: 100 requests/sec, burst 200.
- Per-endpoint: at most 50 concurrent in-flight.
- Reject with HTTP 429 and a `Retry-After` header on rate-limit failure.
- Reject with HTTP 503 and a JSON body on concurrency-limit failure.
- Cleanly handle key-map eviction (LRU, 10 000 entries).
- Expose Prometheus-style metrics: `rate_limited_total{key}`, `concurrency_rejected_total{endpoint}`, `inflight{endpoint}`.

**What "done" looks like.**
- Integration test with a fake handler that sleeps 50 ms: hammer with 1 000 req/s from 5 keys; verify rejection counts match expectations within ±5%.
- Memory usage stays flat over a 10-minute run with rotating keys.
- A "fuzz" test that randomly chooses endpoints, keys, and bursts confirms no permits leak (final `available == initial` per endpoint).
- Document the design choice: why a semaphore for concurrency and a token bucket for rate, and what would change if both became semaphores.

---

### Capstone 4: Stress-test harness with leak detection

**Problem.** Build a generic harness that takes any semaphore-based component and runs a configurable workload (concurrency, rate, fault injection rate, cancellation rate) for a configurable duration, then asserts permit balance at the end.

**Constraints.**
- The harness must work against an interface like `Acquire() Lease; Release(Lease)`.
- It must produce a report: throughput, p50/p95/p99 acquire latency, permit balance, exception count.
- Inject faults: 1% of operations throw mid-critical-section; 1% are cancelled.

**What "done" looks like.**
- Wire it up to the Capstones 1, 2, and 3.
- For each, run a 5-minute soak; report shows zero permit leaks (final balance matches initial) and bounded latency.

---

### Capstone 5: Visualization of semaphore state

**Problem.** Build a small TUI or web dashboard that subscribes to events from one of the capstone components (acquire, release, reject) and renders, in real time, the in-flight count, queue depth, recent acquire latencies, and rejection rate.

**Constraints.**
- Subscribers receive events over a channel (Go) / queue (Java/Python). The instrumented component should not block on slow subscribers; drop events instead.
- Update rate ~10 Hz.

**What "done" looks like.**
- Watching the dashboard while running a synthetic load makes the system's behavior obvious: you can *see* the in-flight count plateau at the cap and queue depth start to climb.
- Use it to demo Capstones 1, 2, and 3 to a teammate.

---

## Sample Solutions

### Sample Solution: Task 1 (Go)

```go
package main

import (
    "fmt"
    "net/http"
    "sync"
    "time"
)

func fetchAll(urls []string, maxConcurrent int) {
    sem := make(chan struct{}, maxConcurrent)
    var wg sync.WaitGroup
    for _, u := range urls {
        u := u
        wg.Add(1)
        go func() {
            defer wg.Done()
            sem <- struct{}{}        // acquire
            defer func() { <-sem }() // release on every path

            resp, err := http.Get(u)
            if err != nil {
                return
            }
            resp.Body.Close()
        }()
    }
    wg.Wait()

    if len(sem) != 0 {
        panic(fmt.Sprintf("permit leak: %d", len(sem)))
    }
}

func main() {
    urls := []string{ /* ... */ }
    start := time.Now()
    fetchAll(urls, 10)
    fmt.Println("done in", time.Since(start))
}
```

Notes: `defer` guarantees release on every code path including panics. The `len(sem) == 0` check is the cheapest leak detector available.

---

### Sample Solution: Task 9 (Python, weighted semaphore)

```python
import threading

class WeightedSemaphore:
    def __init__(self, total: int):
        self._total = total
        self._available = total
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)

    def acquire(self, n: int):
        if n > self._total:
            raise ValueError(f"requested {n} > total {self._total}")
        with self._cond:
            while self._available < n:
                self._cond.wait()
            self._available -= n

    def release(self, n: int):
        with self._cond:
            self._available += n
            if self._available > self._total:
                raise ValueError("over-release")
            self._cond.notify_all()

    def available(self) -> int:
        with self._lock:
            return self._available
```

Notes: `notify_all` because a small `acquire(1)` waiter may fit even when a larger waiter still cannot. With `notify` only, you can deadlock if the head waiter cannot proceed but a smaller waiter could.

---

### Sample Solution: Task 13 (Java, resource pool)

```java
public final class Pool<T> implements AutoCloseable {
    private final Semaphore permits;
    private final Deque<T> idle = new ArrayDeque<>();
    private final Supplier<T> factory;
    private final Consumer<T> destroyer;
    private int created = 0;
    private final int max;

    public Pool(int max, Supplier<T> factory, Consumer<T> destroyer) {
        this.max = max;
        this.permits = new Semaphore(max, true); // fair
        this.factory = factory;
        this.destroyer = destroyer;
    }

    public Lease<T> acquire(long timeoutMs) throws InterruptedException, TimeoutException {
        if (!permits.tryAcquire(timeoutMs, TimeUnit.MILLISECONDS)) {
            throw new TimeoutException();
        }
        T resource;
        synchronized (this) {
            resource = idle.pollLast();
            if (resource == null) {
                resource = factory.get();
                created++;
            }
        }
        return new Lease<>(resource, this);
    }

    void releaseResource(T r, boolean healthy) {
        synchronized (this) {
            if (healthy) {
                idle.push(r);
            } else {
                destroyer.accept(r);
                created--;
            }
        }
        permits.release();
    }

    @Override
    public void close() {
        synchronized (this) {
            for (T r : idle) destroyer.accept(r);
            idle.clear();
        }
    }

    public static final class Lease<T> implements AutoCloseable {
        private final T value;
        private final Pool<T> pool;
        private boolean closed = false;
        Lease(T value, Pool<T> pool) { this.value = value; this.pool = pool; }
        public T get() { return value; }
        public void markBad() { /* set a flag for release */ }
        @Override public void close() {
            if (closed) return;
            closed = true;
            pool.releaseResource(value, /* healthy = */ true);
        }
    }
}
```

Notes: the permit count and the `created` counter are tracked separately. The fair `Semaphore(max, true)` prevents starvation under heavy contention at the cost of throughput.

---

### Sample Solution: Task 19 (Bulkhead, Python asyncio)

```python
import asyncio
from collections import defaultdict

class Bulkhead:
    def __init__(self, global_size: int, per_tenant_size: int):
        self.global_sem = asyncio.Semaphore(global_size)
        self.per_tenant_size = per_tenant_size
        self.tenant_sems: dict[str, asyncio.Semaphore] = defaultdict(
            lambda: asyncio.Semaphore(per_tenant_size)
        )

    async def run(self, tenant: str, coro, timeout: float = 1.0):
        # Acquire order: global first, then per-tenant.
        try:
            await asyncio.wait_for(self.global_sem.acquire(), timeout)
        except asyncio.TimeoutError:
            raise BulkheadRejected("global timeout")
        try:
            try:
                await asyncio.wait_for(self.tenant_sems[tenant].acquire(), timeout)
            except asyncio.TimeoutError:
                raise BulkheadRejected(f"tenant {tenant} timeout")
            try:
                return await coro
            finally:
                self.tenant_sems[tenant].release()
        finally:
            self.global_sem.release()

class BulkheadRejected(Exception):
    pass
```

Notes: nested `try/finally` to release exactly the resources that were acquired. The acquire order (global first) guarantees there is no circular wait between two tenants.

---

If you can do all of these tasks — including reproducing the bugs in the warm-up and finishing at least one of the capstones with leak-detection passing under fault injection — you have the working knowledge to reach for a semaphore exactly when one is needed, and not when a mutex, channel, or `WaitGroup` would be the better tool.

## Related Topics

- [Mutex](../01-mutex/README.md) — binary, ownership-bearing cousin of the semaphore.
- [Condition Variables](../03-condition-variables/README.md) — the building block underneath most counting-semaphore implementations.
- [Read-Write Locks](../04-read-write-locks/README.md) — specialized for asymmetric reader/writer workloads.
- [Channels](../05-channels/README.md) — Go-style message passing; a buffered channel is a semaphore in disguise.
- [Producer/Consumer Patterns](../../03-patterns/01-producer-consumer/README.md) — the canonical semaphore use case.
- [Rate Limiting / Token Bucket](../../03-patterns/05-rate-limiting/README.md) — how semaphores relate to time-based throttling.
- [Bulkhead Pattern](../../../../../system-design/resilience-patterns/bulkhead/README.md) — the resilience pattern Capstone 2 builds.
