# Atomic Operations — Hands-On Tasks

> **Topic:** [Atomic Operations](README.md)

---

## Introduction

Atomic operations are the lowest-level building blocks of lock-free concurrency.
They give you indivisible read-modify-write primitives such as `load`,
`store`, `fetch_add`, and `compare_and_swap` (CAS), backed by hardware
instructions like x86 `LOCK CMPXCHG` or ARM `LDXR/STXR`. Unlike mutexes,
atomics do not block — instead, threads cooperate via memory ordering and
retry loops to make consistent progress.

This tasks file walks you through atomics from the perspective of a working
backend engineer: you will write counters and CAS loops, build lock-free
stacks and queues, hunt the ABA problem, fix it with tagged pointers, and
finally design a wait-free SPSC ring buffer that runs at hardware speed.
You will measure throughput at 1/4/16/64 threads, observe cache-line
contention, see what false sharing does to your benchmarks, and understand
why `LongAdder` beats `AtomicLong` under heavy contention.

The exercises cover three languages — C++ (`std::atomic`), Java
(`java.util.concurrent.atomic`), and Go (`sync/atomic`) — and one
verification tool (Rust `loom`). The goal is not to memorize APIs but to
build correct mental models for memory ordering, ABA, hazard pointers, and
contention curves. Every task lists explicit constraints, hints, and a
self-check so you can grade your own solution before moving on.

Spend roughly 6-10 hours on the Warm-Up tier, 12-18 hours on Core,
20-30 hours on Advanced, and 20-30 hours on the Capstone. Treat the
benchmarks as data-collection exercises — record numbers, draw conclusions,
and revisit them after each refactor.

## Table of Contents

- [Warm-Up](#warm-up)
  - [Task 1: Atomic counter incremented from four threads](#task-1-atomic-counter-incremented-from-four-threads)
  - [Task 2: Java `AtomicInteger` parity with `synchronized`](#task-2-java-atomicinteger-parity-with-synchronized)
  - [Task 3: Write your own CAS loop](#task-3-write-your-own-cas-loop)
  - [Task 4: `fetch_add` micro-benchmark](#task-4-fetch_add-micro-benchmark)
  - [Task 5: Relaxed vs sequentially-consistent counter](#task-5-relaxed-vs-sequentially-consistent-counter)
  - [Task 6: Reproduce a torn read of a 64-bit `long`](#task-6-reproduce-a-torn-read-of-a-64-bit-long)
  - [Task 7: Atomic boolean flag handshake](#task-7-atomic-boolean-flag-handshake)
- [Core](#core)
  - [Task 8: Treiber lock-free stack](#task-8-treiber-lock-free-stack)
  - [Task 9: Spinlock from `atomic_flag`](#task-9-spinlock-from-atomic_flag)
  - [Task 10: Tagged pointer to defeat ABA](#task-10-tagged-pointer-to-defeat-aba)
  - [Task 11: Cache-line padding for the counter](#task-11-cache-line-padding-for-the-counter)
  - [Task 12: Weak CAS retry loop](#task-12-weak-cas-retry-loop)
  - [Task 13: Double-checked locking with `volatile`](#task-13-double-checked-locking-with-volatile)
  - [Task 14: Sequence counter using `seq_cst`](#task-14-sequence-counter-using-seq_cst)
  - [Task 15: Lock-free counter with backoff](#task-15-lock-free-counter-with-backoff)
- [Advanced](#advanced)
  - [Task 16: Michael-Scott MPMC queue](#task-16-michael-scott-mpmc-queue)
  - [Task 17: Epoch-based reclamation toy](#task-17-epoch-based-reclamation-toy)
  - [Task 18: Lock-free LRU cache](#task-18-lock-free-lru-cache)
  - [Task 19: `LongAdder` vs `AtomicLong` benchmark](#task-19-longadder-vs-atomiclong-benchmark)
  - [Task 20: SPSC ring buffer](#task-20-spsc-ring-buffer)
  - [Task 21: Verify with Rust `loom`](#task-21-verify-with-rust-loom)
  - [Task 22: False-sharing investigation](#task-22-false-sharing-investigation)
- [Capstone](#capstone)
  - [Capstone 1: Wait-free SPSC bounded queue](#capstone-1-wait-free-spsc-bounded-queue)
  - [Capstone 2: Sharded `LongAdder` equivalent for Go](#capstone-2-sharded-longadder-equivalent-for-go)
  - [Capstone 3: Contention curve benchmark suite](#capstone-3-contention-curve-benchmark-suite)
- [Sample Solutions](#sample-solutions)
- [Related Topics](#related-topics)

---

## Warm-Up

### Task 1: Atomic counter incremented from four threads

**Problem.** Write a program in C++ (or your language of choice) that spawns
four threads. Each thread increments a shared counter one million times.
After all threads join, print the final value.

**Constraints.**
- Implement two versions: one with a plain `long` (race condition) and one
  with `std::atomic<long>`.
- Use `fetch_add(1, std::memory_order_relaxed)` in the atomic version.
- Do not introduce any locks.

**Hints.**
- Plain `long`: you will see values like `2_345_678` instead of `4_000_000`.
- `std::atomic<long>::fetch_add` lowers to a single `LOCK XADD` on x86_64.
- Use `std::thread` and `.join()` — do not use detached threads.

**Self-check.**
- Atomic version always reports exactly `4_000_000`.
- Plain `long` version is non-deterministic and usually less.
- `objdump -d` shows `lock xadd` (or `lock add`) for the atomic path.

### Task 2: Java `AtomicInteger` parity with `synchronized`

**Problem.** Rewrite Task 1 in Java twice: once using
`AtomicInteger.incrementAndGet`, once using a `synchronized` block over an
`int` field. Compare throughput on 1, 2, 4, and 8 threads.

**Constraints.**
- Use `ExecutorService` with a fixed thread pool.
- Run each configuration three times, take the median.
- Increment 10 million times per thread.

**Hints.**
- Use `System.nanoTime()` around the `invokeAll` call.
- JIT warm-up matters — run a 1M-iteration warm-up phase before measurement.
- Java atomics ultimately use `Unsafe.compareAndSwapInt` (or VarHandle CAS
  on JDK 9+), which on x86 lowers to `LOCK CMPXCHG`.

**Self-check.**
- Both versions produce the correct sum.
- `AtomicInteger` is faster than `synchronized` for low contention.
- At very high contention (e.g. 32 threads pinned to 4 cores), the gap
  narrows — both end up serializing on cache-line traffic.

### Task 3: Write your own CAS loop

**Problem.** Implement `fetchAdd(int delta)` yourself on top of a raw
`compare_exchange_strong` (or Java `compareAndSet`) — without calling
`fetch_add`. Use it from four threads.

**Constraints.**
- The function signature: `long my_fetch_add(std::atomic<long>& a, long delta)`.
- Spin on CAS failure; do not block, sleep, or yield.
- Return the previous value of the counter (matching `fetch_add` semantics).

**Hints.**
- Pattern: `do { old = a.load(); } while (!a.compare_exchange_strong(old, old + delta));`
- `compare_exchange_strong` updates `old` in place on failure — no extra
  `load` needed in the retry.
- Track the average number of retries per thread under contention; print
  the histogram.

**Self-check.**
- Returns the same sequence of pre-increment values as `fetch_add` would.
- Final counter value equals `threads * iterations * delta`.
- Retry count grows roughly linearly with thread count.

### Task 4: `fetch_add` micro-benchmark

**Problem.** Measure throughput of `fetch_add(1)` under increasing
contention. Plot operations-per-second against thread count.

**Constraints.**
- Test 1, 2, 4, 8, 16, 32 threads on a multi-core machine.
- Each thread runs for 5 seconds, counting how many `fetch_add` calls it
  performs against a single shared atomic.
- Use `std::memory_order_relaxed`.

**Hints.**
- Pin threads to cores using `pthread_setaffinity_np` (Linux) or
  `thread_affinity_policy` (macOS) for reproducible numbers.
- Sum the per-thread counts at the end — do not increment a shared metric.
- Expect throughput to *decrease* with more threads above a point: the
  cache line ping-pongs between cores.

**Self-check.**
- Throughput curve peaks around 1-2 threads and degrades from there.
- At 32 threads on a 8-core box, total ops/sec can be lower than 1 thread.
- `perf stat` shows large `cache-misses` and `LLC-load-misses` counts.

### Task 5: Relaxed vs sequentially-consistent counter

**Problem.** Repeat Task 4 with two memory orderings: `memory_order_relaxed`
and `memory_order_seq_cst`. Compare throughput.

**Constraints.**
- Same threads, same duration, only the ordering changes.
- Report the percentage difference at each thread count.

**Hints.**
- On x86, `seq_cst` `fetch_add` is the same instruction (`LOCK XADD`) as
  relaxed — the difference is in what the compiler can reorder around it.
- On ARM, `seq_cst` adds `DMB ISH` fences; the difference becomes visible.
- Inspect generated assembly with `g++ -O2 -S` or `clang -O2 -S`.

**Self-check.**
- On x86, difference is within noise (under 5%).
- On ARM (e.g. M1, Raspberry Pi 4), `seq_cst` is measurably slower.
- Final counter value is identical regardless of ordering.

### Task 6: Reproduce a torn read of a 64-bit `long`

**Problem.** On a 32-bit platform (or in 32-bit mode), demonstrate that a
non-atomic `long long` write can be observed as two halves — a *torn read*.

**Constraints.**
- Use `gcc -m32` (or run inside a 32-bit Docker container).
- One writer thread alternates the value between `0x0000000000000000` and
  `0xFFFFFFFFFFFFFFFF`. A reader thread checks that the value is always
  one of those two — never `0x00000000FFFFFFFF` or `0xFFFFFFFF00000000`.
- Use `volatile long long`, not `std::atomic<long long>`.

**Hints.**
- On 32-bit x86, a 64-bit store compiles to two 32-bit stores.
- The reader may interleave between them and observe a torn value.
- Repeat with `std::atomic<long long>` and verify the tear disappears
  (the compiler emits `cmpxchg8b`).

**Self-check.**
- `volatile` version eventually prints a torn value (often within seconds).
- `std::atomic` version never prints a torn value.
- The fix on a 64-bit platform is naturally aligned — no `cmpxchg8b` needed.

### Task 7: Atomic boolean flag handshake

**Problem.** Implement a one-shot handshake between two threads using a
single `std::atomic<bool>`: thread A sets the flag, thread B spins until it
sees `true`, then both exit.

**Constraints.**
- No condition variables, no mutexes.
- Use `memory_order_release` on the store and `memory_order_acquire` on
  the load.
- Print a "before" and "after" message from each thread proving order.

**Hints.**
- The release/acquire pair establishes a happens-before edge: writes that
  A made before the flag store are visible to B after it sees `true`.
- Use `std::this_thread::yield()` in the spin loop to be polite.
- For a fully-blocking variant, see `std::atomic<T>::wait` (C++20).

**Self-check.**
- B never exits before A's `store(true)` has happened.
- "Before" lines always print before "after" lines on the same thread.
- A non-atomic `bool` version may hang forever due to compiler hoisting.

---

## Core

### Task 8: Treiber lock-free stack

**Problem.** Implement Treiber's lock-free stack: a singly-linked list with
a single atomic head pointer. Provide `push(T)` and `pop() -> optional<T>`.

**Constraints.**
- `head` is a `std::atomic<Node*>`.
- `push` creates a new node, sets its `next` to the current head, then CAS
  the head to the new node — retry on failure.
- `pop` reads the head, reads `head->next`, then CAS the head to `next`.
- For now, *leak the popped nodes* — we will fix reclamation later.

**Hints.**
- The push loop: `do { newNode->next = head.load(); } while (!head.compare_exchange_weak(newNode->next, newNode));`
- The pop loop: read `old = head.load(); if (!old) return nullopt; next = old->next; if (head.compare_exchange_weak(old, next)) return old->value;`
- Use `memory_order_acquire` on loads, `memory_order_release` on the CAS
  success path.

**Self-check.**
- Two threads each pushing N items result in a stack of size 2N.
- Concurrent push/pop never crashes, never loses an item that completed,
  never duplicates one.
- Replace `compare_exchange_weak` with `compare_exchange_strong`; throughput
  changes — explain which one is faster on your CPU and why.

### Task 9: Spinlock from `atomic_flag`

**Problem.** Build a minimal spinlock using `std::atomic_flag`. Expose
`lock()` and `unlock()`. Use it to protect a `std::vector<int>` accessed by
four pushing threads.

**Constraints.**
- `lock`: `while (flag.test_and_set(std::memory_order_acquire)) { /* spin */ }`.
- `unlock`: `flag.clear(std::memory_order_release)`.
- Add a TTAS (test-test-and-set) variant: poll `test()` first to avoid
  cache-line invalidation storms.

**Hints.**
- A naked TAS spinlock keeps the cache line in `Modified` state on the
  spinning core, evicting it from the owner — very slow under contention.
- TTAS spins in `Shared` state, only escalating to TAS when the lock looks
  free.
- Add `__builtin_ia32_pause()` (or `std::this_thread::yield`) inside the
  spin loop.

**Self-check.**
- Vector contents are not corrupted; final size equals 4 * iterations.
- TTAS variant has measurably higher throughput than naked TAS.
- A 5-thread version on a 4-core box benefits noticeably from `pause`.

### Task 10: Tagged pointer to defeat ABA

**Problem.** Demonstrate the ABA problem in your Treiber stack from Task 8,
then fix it using a tagged pointer (sometimes called a *versioned pointer*).

**Constraints.**
- Force ABA: thread T1 reads head = A, gets descheduled. T2 pops A, pushes
  C, pushes A back. T1 wakes and the CAS succeeds even though the stack
  shape has changed.
- Fix: change `head` to a `struct { Node* ptr; uint64_t tag; }` and use
  `std::atomic<...>` with double-width CAS (`cmpxchg16b` on x86_64).
- Each successful `push` increments the tag.

**Hints.**
- Use `alignas(16)` and `__attribute__((aligned(16)))` to make the struct
  16-byte aligned so `cmpxchg16b` works.
- Compile with `-mcx16` on GCC/Clang.
- An alternative is to steal the top 16 bits of the pointer for the tag
  (only safe with x86_64 user-space addresses).

**Self-check.**
- The reproduction test fails (data corruption) without tagging and passes
  with tagging.
- `objdump` shows `lock cmpxchg16b` in the tagged version.
- The tag never wraps within a realistic benchmark — explain how big it
  needs to be for safety.

### Task 11: Cache-line padding for the counter

**Problem.** Take Task 4's contended counter benchmark and add cache-line
padding. Measure the difference.

**Constraints.**
- Define `struct alignas(64) PaddedCounter { std::atomic<long> value; char pad[64 - sizeof(long)]; };`
- Allocate one padded counter *per thread* (an array of N entries).
- Sum them at the end to get the global count.

**Hints.**
- On x86_64, cache lines are 64 bytes; on Apple M1, 128 bytes.
- Without padding, two atomics in adjacent memory locations false-share
  the same cache line, causing invalidations.
- This is the core idea behind `LongAdder`.

**Self-check.**
- Per-thread padded counters scale almost linearly — 4 threads is ~4x
  throughput of 1 thread.
- A non-padded array shows scaling close to flat or even negative.
- `perf c2c` (Linux) confirms reduced HITM events with padding.

### Task 12: Weak CAS retry loop

**Problem.** Convert a CAS loop using `compare_exchange_strong` to one using
`compare_exchange_weak`. Explain when each is appropriate.

**Constraints.**
- Implement `atomic_max` (set `a` to `max(a, candidate)`) using both.
- Benchmark on ARM (if available) and x86.
- Comment on why `weak` is preferred inside loops.

**Hints.**
- `compare_exchange_strong` is allowed to retry internally to mask spurious
  failures on platforms like ARM LL/SC; `weak` may fail spuriously even
  when values match.
- On x86, `strong` and `weak` compile identically.
- On ARM, `weak` avoids an extra retry inside the implementation since
  your outer loop already handles it.

**Self-check.**
- Both implementations are correct (final value is the max of all candidates).
- `weak` version on ARM has measurably fewer instructions in the hot path.
- On x86, the two assemble identically (verify with `-S`).

### Task 13: Double-checked locking with `volatile`

**Problem.** Implement double-checked locking for lazy singleton init in
Java. First do it incorrectly with a plain field, then fix it with
`volatile`.

**Constraints.**
- Class `Config` with `getInstance()` returning a singleton.
- Run 8 threads racing to call `getInstance()` from a cold start.
- Add a sleep inside the constructor so the race window is wide.

**Hints.**
- Without `volatile`, the JIT can reorder the assignment so other threads
  see a non-null reference to a partially-constructed object.
- With `volatile`, the JMM (Java Memory Model) guarantees the constructor
  completes before the reference is published.
- On JDK 9+, prefer `Holder` idiom (lazy class init) — no explicit volatile.

**Self-check.**
- The broken version occasionally returns an object with default-valued
  fields under load (proves the race).
- The `volatile` version always returns a fully-initialized object.
- The `Holder` version is simpler and has equivalent semantics.

### Task 14: Sequence counter using `seq_cst`

**Problem.** Implement a monotonic sequence number generator that hands out
unique IDs across threads.

**Constraints.**
- Single shared `std::atomic<uint64_t>` with `memory_order_seq_cst`.
- Each thread requests 1M IDs.
- After the run, sort all returned IDs and check they form `[1, N]`.

**Hints.**
- `fetch_add(1)` is the canonical pattern.
- Make sure no ID is skipped, returned twice, or returned as 0.
- For massive scale (10⁹+ IDs/sec), use a sharded scheme — see Capstone 2.

**Self-check.**
- All IDs are unique and form a complete contiguous range.
- Throughput matches the single-counter result from Task 4 — your generator
  is no faster than a contended `fetch_add`.
- Switching to `relaxed` produces the same correctness result (a counter
  needs no inter-counter ordering) but may run a hair faster on ARM.

### Task 15: Lock-free counter with backoff

**Problem.** Add exponential backoff to your CAS-based counter from Task 3
and measure the effect on throughput under high contention.

**Constraints.**
- On CAS failure, spin for `2^k` `pause` instructions, where `k` doubles
  up to a cap (e.g. 1024).
- Reset the counter on success.
- Run with 32 threads.

**Hints.**
- Backoff helps when many threads collide — they spread out in time and
  reduce the collision rate.
- Too much backoff hurts low-contention workloads.
- Compare against the no-backoff version from Task 3 and the `fetch_add`
  baseline from Task 4.

**Self-check.**
- Backoff improves throughput at 32 threads vs. no backoff.
- Backoff is slower than `fetch_add` regardless — hardware atomics win.
- Average retry count per thread drops with backoff enabled.

---

## Advanced

### Task 16: Michael-Scott MPMC queue

**Problem.** Implement the Michael-Scott two-lock-free queue: linked list
with separate head and tail pointers, both atomic.

**Constraints.**
- `enqueue(T)`: build a new node, CAS into `tail->next`, then advance tail.
- `dequeue() -> optional<T>`: read head, read head->next, CAS head to next.
- Use a sentinel dummy node so head and tail are never null.
- Leak popped nodes for now — see Task 17 for reclamation.

**Hints.**
- The dequeue must handle the case where tail lags behind (another thread
  paused mid-enqueue) — advance tail on behalf of the slow thread.
- Be careful with the order: read `tail`, then read `tail->next`, then
  decide what to do. Re-check that `tail` is still current.
- The original paper is "Simple, Fast, and Practical Non-Blocking and
  Blocking Concurrent Queue Algorithms" by Michael and Scott (1996).

**Self-check.**
- Concurrent enqueue + dequeue from 4 producers and 4 consumers produces
  all items, none lost, none duplicated.
- Order within each producer is preserved (FIFO per producer).
- Throughput exceeds a mutex-protected `std::queue` at 4+ threads.

### Task 17: Epoch-based reclamation toy

**Problem.** Add epoch-based reclamation (EBR) to the Michael-Scott queue
so popped nodes are eventually freed without use-after-free risk.

**Constraints.**
- Maintain a global epoch counter.
- Each thread has a "local epoch" that it sets on entry to the queue
  operation and clears on exit.
- Nodes retired in epoch E can be freed only when all threads have moved
  past epoch E.

**Hints.**
- Start with three epochs (current, current-1, current-2) and a per-epoch
  garbage list.
- A thread that's been at epoch `E-2` for a while gets nudged to advance
  (in practice it advances on the next op).
- Implementations to study: `crossbeam-epoch` in Rust, Folly's `IndexedMemPool`.

**Self-check.**
- Long-running test (millions of ops, 8 threads) does not leak memory and
  does not crash under AddressSanitizer.
- Memory usage stays bounded — the garbage list shrinks as epochs advance.
- Without EBR, the same workload would either leak unboundedly or crash.

### Task 18: Lock-free LRU cache

**Problem.** Design a lock-free LRU cache for a fixed capacity N. Reads
must not block; writes may use limited synchronization.

**Constraints.**
- Use an atomic hash map for lookups (e.g. junction's `LeapfrogMap`, or
  build a simple linear-probing one).
- For LRU ordering, use a per-entry atomic timestamp updated on access.
- Eviction picks the entry with the smallest timestamp.

**Hints.**
- True lock-free LRU is hard; this is a best-effort approximation.
- A common simplification: use a *sampled* eviction (pick 5 random entries,
  evict the oldest) — see Redis's `allkeys-lru` policy.
- Reads update the timestamp with a relaxed store; writes use a real CAS.

**Self-check.**
- Read-heavy workload (95% reads) shows near-linear scaling.
- The cache never holds more than N entries at any sampled moment.
- Hit rate is competitive with a mutex-protected `LinkedHashMap`-based LRU.

### Task 19: `LongAdder` vs `AtomicLong` benchmark

**Problem.** Benchmark Java's `LongAdder` against `AtomicLong` for an
update-heavy workload at increasing thread counts.

**Constraints.**
- Use JMH or carefully hand-rolled microbenchmarks.
- Thread counts: 1, 2, 4, 8, 16, 32.
- Two scenarios: pure increment, and `sum()` once per 10k increments.

**Hints.**
- `LongAdder` keeps a cell per CPU; under contention each thread updates
  its own cell, then `sum()` aggregates.
- `AtomicLong` serializes on one cache line.
- The crossover point (where `LongAdder` overtakes `AtomicLong`) is usually
  around 2-4 threads.

**Self-check.**
- `AtomicLong` is faster at 1 thread (no aggregation overhead).
- `LongAdder` is much faster (5-20x) at 16-32 threads.
- The `sum()` scenario narrows the gap; explain why.

### Task 20: SPSC ring buffer

**Problem.** Implement a Single-Producer Single-Consumer (SPSC) lock-free
ring buffer using two atomic indices (head, tail) and a fixed-size array.

**Constraints.**
- Capacity is a compile-time power of two.
- Producer writes `tail`, reads `head`; consumer writes `head`, reads `tail`.
- `enqueue` returns false if full; `dequeue` returns nullopt if empty.
- Use `memory_order_acquire`/`release` exclusively — no `seq_cst`.

**Hints.**
- Pad `head` and `tail` to separate cache lines.
- The producer caches the consumer's `head` locally to reduce reloads.
- See LMAX Disruptor and `rigtorp::SPSCQueue` for reference designs.

**Self-check.**
- Throughput at >100M ops/sec on a modern x86 core.
- Single producer + single consumer never corrupts the queue.
- Adding a second producer breaks invariants — this is intentional, it's
  SPSC.

### Task 21: Verify with Rust `loom`

**Problem.** Reimplement your Task 9 spinlock (or Task 20 SPSC queue) in
Rust and verify it with the `loom` model checker.

**Constraints.**
- Use `loom::sync::atomic::{AtomicBool, AtomicUsize}` instead of
  `std::sync::atomic`.
- Write a `loom::model(|| { ... })` test that spawns 2 threads and
  exercises the critical paths.
- `loom` will explore *all* possible thread interleavings exhaustively.

**Hints.**
- Start small — `loom` blows up quickly with more threads or longer
  programs.
- If a panic is found, `loom` prints a deterministic replay.
- Read the `loom` README and `crossbeam`'s tests for examples.

**Self-check.**
- The correct version passes; intentionally-broken versions (e.g. using
  `Relaxed` where `Acquire`/`Release` is needed) fail with a clear trace.
- `cargo test --release` runs the loom suite in under 60 seconds for a
  2-thread spinlock test.
- The trace makes the bug obvious — store/load reorder, missed CAS, etc.

### Task 22: False-sharing investigation

**Problem.** Build two versions of a per-thread counter array — one packed,
one padded to cache-line boundaries. Use Linux `perf` to identify and
quantify the false-sharing penalty.

**Constraints.**
- Array of 8 `std::atomic<long>` counters; each thread increments its own.
- Packed version is just `std::atomic<long> counters[8]`.
- Padded version uses `alignas(64)` and per-counter padding.

**Hints.**
- `perf stat -e cache-misses,cache-references` shows the cache-miss rate.
- `perf c2c record` (Linux 4.10+) identifies false-sharing hotspots.
- VTune's "Memory Access" analysis has similar capabilities on Intel.

**Self-check.**
- Packed version throughput is 3-10x worse than padded under 8 threads.
- `perf c2c` highlights `counters[i].value` as a hot false-shared line in
  the packed version.
- After padding, the same workload completes in a fraction of the time.

---

## Capstone

### Capstone 1: Wait-free SPSC bounded queue

**Problem.** Design and implement a *wait-free* SPSC bounded queue. Wait-free
means every operation completes in a bounded number of steps regardless of
contention. (SPSC makes this tractable.)

**What "done" looks like.**
- Public API: `bool try_push(T)`, `optional<T> try_pop()`, both `noexcept`.
- Backing storage is a fixed-capacity array (power of two).
- No locks, no `compare_exchange`, no unbounded retry loops.
- Throughput target: ≥100M ops/sec on a single producer + single consumer
  pinned to two cores of a modern x86 CPU.
- Latency target: p99 round-trip latency under 200 ns (producer enqueues a
  timestamp, consumer reads it).
- Includes a test that pushes 10⁹ items through the queue without loss or
  reorder, with separate producer and consumer threads.
- Includes a benchmark harness with results and a brief discussion of
  cache-line layout choices.

**Hints.**
- The key trick: each side stores a cached copy of the *other* side's
  index. The producer only re-reads the consumer's head when its cached
  copy says the queue looks full; same for the consumer.
- Use `memory_order_acquire` on the load of the opposite index and
  `memory_order_release` on the store of your own.
- Pad head, tail, and the cached copies to separate cache lines.
- Initialize the array with a sentinel value or use placement-new on slots.
- For the latency test, use `__rdtsc` (x86) or `mach_absolute_time` (macOS).

### Capstone 2: Sharded `LongAdder` equivalent for Go

**Problem.** Go's standard library has `atomic.Int64` and `atomic.AddInt64`
but no `LongAdder`. Build one.

**What "done" looks like.**
- Public API: `(*Adder).Add(int64)`, `(*Adder).Sum() int64`,
  `(*Adder).Reset()`.
- Internally, an array of cells, one per logical CPU (use
  `runtime.NumCPU` at construction time, ignoring goroutine migration).
- Each goroutine picks a cell using a hash of its goroutine ID or a
  `runtime_procPin`-style hint. On contention, hop to a neighboring cell.
- Each cell is on its own 64-byte cache line (use `[7]int64` padding around
  the actual value).
- `Sum()` walks all cells and sums them — caller's responsibility to
  understand that this is a snapshot, not a transactional total.
- A JMH-style benchmark (use `testing.B` and `b.RunParallel`) showing
  this beats `atomic.AddInt64` at GOMAXPROCS ≥ 4.

**Hints.**
- There is no stable way to get the current goroutine ID; use
  `runtime/internal/sys` (private) or a pseudo-random index from a
  per-goroutine `*rand.Rand`.
- Alternatively, use `procPin` (requires `//go:linkname`) — a real
  production project might just take the linter complaint and ship.
- Padding: `type cell struct { _ [7]int64; v int64 }` works on amd64.
- Run with `-race` to confirm no data races, then with `-bench=.` to
  measure throughput.

### Capstone 3: Contention curve benchmark suite

**Problem.** Build a benchmark suite that measures throughput of four
counter implementations under increasing contention. Plot the results,
explain the inflection points.

**What "done" looks like.**
- Four implementations: mutex-protected `int`, `std::atomic<long>` with
  `fetch_add`, padded per-thread counter array, your wait-free counter
  from Capstone 2 (port back to C++ if needed).
- Thread counts: 1, 4, 16, 64 (with extra points if you have a big-core
  machine).
- Pin threads to cores, repeat each measurement 5 times, report median +
  std deviation.
- Output a CSV file and a `gnuplot`/`matplotlib` script that produces a
  PNG comparing the four lines.
- A short write-up (this can be a code comment block or a separate `.md`
  in the same folder) explaining: where each implementation crosses,
  why, what cache effects dominate, and what you'd choose at each scale.

**Hints.**
- The interesting region is usually 2-16 threads — that's where serialization
  on a single cache line starts to dominate.
- Mutex is consistently worst above 1 thread; `fetch_add` is best at 1
  thread but tanks under contention; padded scales until you run out of
  CPUs; sharded wait-free is fastest under heavy contention.
- Use `taskset` (Linux) or `cpuset` (FreeBSD/macOS) to pin threads.
- Watch for "throughput collapse" — beyond a certain thread count, total
  throughput can *decrease*. Mark that point on your plot.

---

## Sample Solutions

### Sample Solution: Task 1 (Atomic counter, C++)

```cpp
#include <atomic>
#include <iostream>
#include <thread>
#include <vector>

int main() {
    std::atomic<long> counter{0};
    constexpr int kThreads = 4;
    constexpr int kIters = 1'000'000;

    std::vector<std::thread> ts;
    for (int i = 0; i < kThreads; ++i) {
        ts.emplace_back([&] {
            for (int j = 0; j < kIters; ++j) {
                counter.fetch_add(1, std::memory_order_relaxed);
            }
        });
    }
    for (auto& t : ts) t.join();
    std::cout << "counter = " << counter.load() << "\n";
    return 0;
}
```

Output is always `4000000`. Switching `std::atomic<long>` to a plain `long`
produces nondeterministic, smaller values.

### Sample Solution: Task 8 (Treiber stack, C++)

```cpp
template <typename T>
class TreiberStack {
    struct Node { T value; Node* next; };
    std::atomic<Node*> head_{nullptr};
public:
    void push(T value) {
        auto* n = new Node{std::move(value), nullptr};
        n->next = head_.load(std::memory_order_relaxed);
        while (!head_.compare_exchange_weak(
                  n->next, n,
                  std::memory_order_release,
                  std::memory_order_relaxed)) {
            // n->next has been updated in place
        }
    }
    std::optional<T> pop() {
        Node* old = head_.load(std::memory_order_acquire);
        while (old) {
            Node* next = old->next;
            if (head_.compare_exchange_weak(
                    old, next,
                    std::memory_order_acquire,
                    std::memory_order_acquire)) {
                T v = std::move(old->value);
                // NOTE: leaks `old` — see Task 17 for safe reclamation.
                return v;
            }
        }
        return std::nullopt;
    }
};
```

This stack is correct under concurrent push, correct under push/pop with
no concurrent pops between hazardous reads, but has both the ABA problem
(fixed in Task 10) and the memory reclamation problem (fixed in Task 17).

### Sample Solution: Task 20 (SPSC ring buffer, C++)

```cpp
template <typename T, size_t Capacity>
class SPSCQueue {
    static_assert((Capacity & (Capacity - 1)) == 0, "power of two");
    alignas(64) std::atomic<size_t> head_{0};   // consumer side
    alignas(64) std::atomic<size_t> tail_{0};   // producer side
    alignas(64) T buffer_[Capacity];

public:
    bool try_push(T v) {
        const size_t t = tail_.load(std::memory_order_relaxed);
        const size_t h = head_.load(std::memory_order_acquire);
        if (t - h == Capacity) return false;     // full
        buffer_[t & (Capacity - 1)] = std::move(v);
        tail_.store(t + 1, std::memory_order_release);
        return true;
    }

    std::optional<T> try_pop() {
        const size_t h = head_.load(std::memory_order_relaxed);
        const size_t t = tail_.load(std::memory_order_acquire);
        if (h == t) return std::nullopt;          // empty
        T v = std::move(buffer_[h & (Capacity - 1)]);
        head_.store(h + 1, std::memory_order_release);
        return v;
    }
};
```

Cache lines are explicitly padded; the producer and consumer never write
to the same line. With `Capacity = 1024`, this hits >100M ops/sec on a
single producer/consumer pair on a recent x86 CPU.

### Sample Solution: Capstone 2 sketch (Go sharded adder)

```go
package adder

import (
    "runtime"
    "sync/atomic"
)

type cell struct {
    _ [7]int64
    v int64
}

type Adder struct {
    cells []cell
    mask  uint64
}

func New() *Adder {
    n := nextPow2(runtime.NumCPU() * 2)
    return &Adder{cells: make([]cell, n), mask: uint64(n - 1)}
}

func (a *Adder) Add(delta int64, hint uint64) {
    i := hint & a.mask
    atomic.AddInt64(&a.cells[i].v, delta)
}

func (a *Adder) Sum() int64 {
    var s int64
    for i := range a.cells {
        s += atomic.LoadInt64(&a.cells[i].v)
    }
    return s
}

func nextPow2(n int) int {
    p := 1
    for p < n {
        p <<= 1
    }
    return p
}
```

Callers provide a `hint` — usually a hashed goroutine identifier or a
process-local counter that monotonically advances. Under
`b.RunParallel` with `GOMAXPROCS=8`, this typically reaches 5-10x the
throughput of a single `atomic.AddInt64`.

---

Take your time with each task — the goal is to build durable intuition,
not to rush through. Re-run benchmarks on different hardware; revisit
older tasks once you've finished an advanced one. When you can explain
why a lock-free queue is faster than a mutex queue at exactly 7 cores
but not at 2, you have understood atomics at the level a backend engineer
needs.

## Related Topics

- [Atomic Operations — README](README.md)
- [Mutex, RWMutex, Semaphore](../01-mutex/README.md)
- [Condition Variables](../02-condition-variable/README.md)
- [Memory Barriers and Fences](../05-memory-barrier/README.md)
- [Channels (Go)](../06-channels/README.md)
- [Concurrency Models](../../01-models/README.md)
- [Memory Management](../../../memory-management/README.md)
- [Performance Engineering](../../../../quality-engineering/performance/README.md)
