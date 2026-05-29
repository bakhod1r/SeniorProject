# Shared-Memory Concurrency — Hands-On Tasks

> **Topic:** [Shared-Memory Concurrency](README.md)

---

## Introduction

This file is a structured set of exercises that take you from "I have heard
of a mutex" to "I can reason about lock-free queues, memory ordering, and
false sharing under load." Every task is small enough to fit into one or two
focused sessions, and they build on one another. You should attempt each
problem first without reading the hints — even five minutes of struggle on
the buggy counter teaches more than a clean walkthrough.

How to use this file: read the task, write code, run it (under a race
detector or thread sanitizer whenever possible), and only then check the
hints. Mark the self-check boxes when you can explain the result to someone
else, not when the program merely compiles. The sample solutions are
intentionally sparse — they appear only where the canonical answer is more
instructive than your first attempt would be.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Related Topics](#related-topics)

---

## Warm-Up

These tasks rebuild the mental model. They are short, but each one
introduces a primitive or a failure mode that you will reuse for the rest of
the file.

### Task 1: The naive counter race

**Problem.** Write a program in Go (or C with pthreads) that spawns 8
goroutines/threads, each of which increments a shared `int64` counter one
million times using a plain `counter++`. Print the final value. Run it ten
times and record the spread of results.

**Constraints.**
- Do not use any synchronization primitive.
- Use the same counter type and the same loop body in every thread.
- Run under `go run -race` (Go) or `clang -fsanitize=thread` (C).

**Hints (try without first).**
- The expected value is 8,000,000. Almost no run will produce that.
- The race detector should print a `DATA RACE` report. Read it carefully —
  it tells you the two stacks that touched the same address.
- The reason this loses updates is that `x++` decomposes into load, add,
  store. Two threads can load the same value before either stores back.

**Self-check.**
- [ ] You can explain why the result varies between runs.
- [ ] You can point at the exact instructions in the disassembly that race.
- [ ] You can describe what the race detector reported and why.

---

### Task 2: Fix the counter with a mutex

**Problem.** Take the program from Task 1 and add a single mutex around the
increment. Measure the time it takes for all threads to finish. Compare it
to the racy version.

**Constraints.**
- Use one mutex shared by all threads.
- Do not change the number of threads or iterations.
- Report wall-clock time, not CPU time.

**Hints (try without first).**
- The mutex serializes the critical section, so the running time will be
  roughly N times worse than a single-threaded loop.
- If your mutex version is faster than the racy one, something is wrong:
  most likely the racy version's compiler hoisted the load out of the loop.
- Try moving the mutex acquire/release outside the loop and observe the
  speed-up — then explain why that defeats the whole exercise.

**Self-check.**
- [ ] You can describe the throughput cost of serializing every increment.
- [ ] You understand the difference between fine-grained and coarse-grained
  locking from real measurements.

---

### Task 3: Implement an atomic counter

**Problem.** Replace the mutex from Task 2 with an atomic add
(`sync/atomic.AddInt64` in Go, `__atomic_fetch_add` in C, or
`AtomicLong#incrementAndGet` in Java). Re-run the benchmark and compare
against both the racy version and the mutex version.

**Constraints.**
- Use the strongest memory order (sequentially consistent) for the first
  attempt.
- Then re-run with a relaxed order and compare results and timing.
- Do not introduce a mutex anywhere in the code.

**Hints (try without first).**
- Atomic add on x86 maps to `LOCK XADD`. On ARM it maps to an LL/SC loop or
  the new LSE atomics.
- A single atomic counter under high contention is still slow because the
  cache line bounces between cores.
- Sequentially consistent and relaxed are indistinguishable for a single
  counter you only read at the end. The difference matters when other
  variables depend on the increment being visible.

**Self-check.**
- [ ] You can explain when relaxed ordering is safe and when it is not.
- [ ] You can describe what `LOCK XADD` does at the cache-coherence level.

---

### Task 4: Read the race detector output

**Problem.** Take the racy program below, compile it with `-race`, and write
a paragraph explaining the report.

```go
package main

import (
	"fmt"
	"sync"
)

var ready bool
var data int

func main() {
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		data = 42
		ready = true
	}()
	go func() {
		defer wg.Done()
		for !ready {
		}
		fmt.Println(data)
	}()
	wg.Wait()
}
```

**Constraints.**
- Do not fix the program. Only analyze the report.
- Identify both racing accesses and the stacks where they occur.

**Hints (try without first).**
- There are two races here: on `ready` and on `data`. The detector should
  show both.
- The "spin until ready" pattern is broken even without the race detector:
  the compiler can hoist the load of `ready` out of the loop.
- A correct version uses atomics or a channel.

**Self-check.**
- [ ] You can identify which line each report points to.
- [ ] You can describe how to fix the program in two different ways.

---

### Task 5: Java synchronized block

**Problem.** Write a Java class `BankAccount` with a balance and methods
`deposit(long)` and `withdraw(long)`. Make the methods thread-safe using a
`synchronized` block (not `synchronized` on the method signature). Verify
correctness with 16 threads doing one million operations each.

**Constraints.**
- Use a private final `Object lock = new Object();` field, not `this`.
- `withdraw` must refuse to go negative.
- Total balance at the end must equal the sum of all deposits minus
  successful withdrawals.

**Hints (try without first).**
- Locking on `this` is dangerous because external code can also lock on your
  object and create surprising deadlocks.
- The check-then-act in `withdraw` must be inside the synchronized block,
  not split across it.
- Add a `getBalance()` method and decide whether it also needs the lock
  (yes, for visibility, even if "just reading").

**Self-check.**
- [ ] Your test produces the same total on every run.
- [ ] You can articulate why locking on `this` is a code smell.

---

### Task 6: Condition variable wait/notify in C

**Problem.** Write a C program with one producer thread and one consumer
thread sharing a single-slot buffer (one `int` plus a "full" flag). Use a
`pthread_mutex_t` and a single `pthread_cond_t` to make the producer wait
when full and the consumer wait when empty.

**Constraints.**
- Producer puts the values 1..1000 into the buffer, in order.
- Consumer prints them and checks the order.
- Use `pthread_cond_wait` inside a `while` loop, not an `if`.

**Hints (try without first).**
- `pthread_cond_wait` releases the mutex while sleeping and re-acquires it
  on wake-up. Drawing this on paper helps.
- Spurious wake-ups are real. The `while` loop re-checks the condition.
- A single condition variable is enough for one-slot, but two would be
  cleaner for a bounded buffer (see Task 7).

**Self-check.**
- [ ] You always print 1..1000 in order.
- [ ] You can explain what would break if you used `if` instead of `while`.

---

### Task 7: Memory order intuition check

**Problem.** Without running code, predict the possible outputs of this
two-thread program under sequentially consistent, acquire/release, and
relaxed ordering:

```
// Thread 1            // Thread 2
x = 1;                 r1 = y;
y = 1;                 r2 = x;
```

All variables start at zero. Both writes use the same memory order; both
reads use the same memory order. Enumerate which `(r1, r2)` pairs are
possible in each model.

**Constraints.**
- Use only the C/C++ memory model wording.
- Show your reasoning, not just the answer.

**Hints (try without first).**
- Under SC, the only forbidden outcome is `(1, 0)` — no, wait: re-check.
- Under release/acquire, store-store reordering on Thread 1 is forbidden,
  but load-load reordering on Thread 2 is not.
- Under relaxed, anything goes including `(1, 0)`.

**Self-check.**
- [ ] You have written down all four `(r1, r2)` outcomes for each model.
- [ ] You can name a real CPU where the relaxed behavior is observable.

---

## Core

These tasks form the working vocabulary of a backend engineer who has to
ship correct concurrent code. Expect each one to take longer than a Warm-Up
task and to produce something you would keep in a snippets folder.

### Task 8: Bounded buffer with mutex and two condition variables

**Problem.** Implement a thread-safe bounded buffer of capacity N in C
(pthreads) or Java. Provide `put(x)` that blocks when full and `take()`
that blocks when empty. Use a mutex and two condition variables — one for
"not full," one for "not empty."

**Constraints.**
- Capacity is a constructor argument.
- Use a ring buffer for storage.
- Test with multiple producers and multiple consumers.

**Hints (try without first).**
- Use `pthread_cond_signal` (not broadcast) when waking the "other side"
  after a single operation.
- The wait must be in a `while` loop. Always.
- Keep the count in a separate variable rather than computing it from
  head/tail — it makes the wait conditions trivial.

**Self-check.**
- [ ] No deadlock with any combination of producer/consumer counts.
- [ ] No spurious data corruption under TSan.

**Sample Solution.**

```c
typedef struct {
    int *buf;
    size_t cap, head, tail, count;
    pthread_mutex_t mu;
    pthread_cond_t  not_full;
    pthread_cond_t  not_empty;
} bounded_t;

void bb_put(bounded_t *b, int x) {
    pthread_mutex_lock(&b->mu);
    while (b->count == b->cap)
        pthread_cond_wait(&b->not_full, &b->mu);
    b->buf[b->tail] = x;
    b->tail = (b->tail + 1) % b->cap;
    b->count++;
    pthread_cond_signal(&b->not_empty);
    pthread_mutex_unlock(&b->mu);
}

int bb_take(bounded_t *b) {
    pthread_mutex_lock(&b->mu);
    while (b->count == 0)
        pthread_cond_wait(&b->not_empty, &b->mu);
    int x = b->buf[b->head];
    b->head = (b->head + 1) % b->cap;
    b->count--;
    pthread_cond_signal(&b->not_full);
    pthread_mutex_unlock(&b->mu);
    return x;
}
```

---

### Task 9: Read-write lock for a read-heavy workload

**Problem.** Build a thread-safe in-memory key-value store that uses an
RWLock (`sync.RWMutex` in Go, `pthread_rwlock_t` in C, or
`ReentrantReadWriteLock` in Java). Benchmark 95% reads / 5% writes against
the same store guarded by a plain mutex.

**Constraints.**
- 16 worker threads, mixed read/write operations.
- Keys are short strings; values are small structs.
- Measure throughput (operations per second), not latency.

**Hints (try without first).**
- RWLocks shine only when reads are the vast majority and the read critical
  section is long enough to amortize the lock cost.
- Many RWLock implementations are writer-starvation-prone. Read the docs.
- For tiny critical sections, a plain mutex often beats an RWLock because
  RWLock bookkeeping is heavier.

**Self-check.**
- [ ] You produced a graph (or table) of throughput vs read ratio.
- [ ] You can articulate when an RWLock is the wrong choice.

---

### Task 10: False-sharing benchmark

**Problem.** Allocate an array of 8 `int64` counters. Spawn 8 threads, each
incrementing one counter in a tight loop. Measure throughput. Then pad each
counter to 64 bytes and re-measure. Report the speed-up.

**Constraints.**
- Use C or Go. No mutexes, no atomics if you can avoid it — but you must
  prevent the compiler from optimizing the loop away.
- Pin threads to CPUs if your platform allows.
- Use `perf stat` or equivalent to confirm cache-coherence traffic.

**Hints (try without first).**
- The unpadded version pays for cache-line ping-pong: every increment
  invalidates the line on the other cores.
- A typical Intel cache line is 64 bytes; Apple Silicon uses 128. Check
  before padding.
- Expect a 3x-10x speed-up depending on hardware.

**Self-check.**
- [ ] You measured a real speed-up.
- [ ] You can read the `LLC-load-misses` or equivalent counter.

---

### Task 11: Double-checked singleton with volatile (Java)

**Problem.** Implement a lazy singleton in Java using the double-checked
locking idiom. Demonstrate that without `volatile` on the instance field,
another thread can observe a partially-constructed object.

**Constraints.**
- Use `synchronized (Singleton.class)` for the inner lock.
- The instance field must be `private static volatile`.
- Write a small driver that hammers `getInstance()` from 100 threads.

**Hints (try without first).**
- The bug without `volatile` is that the JIT can reorder "construct object"
  and "publish reference," letting another thread see a non-null reference
  pointing at an uninitialized object.
- Reproducing the bug deterministically is hard; the goal is to understand
  why the bug is possible, not necessarily to trigger it.
- In Java 5+, `volatile` provides the release/acquire semantics needed.

**Self-check.**
- [ ] You can explain the publication race in your own words.
- [ ] You know that the modern preferred idiom is the holder pattern.

---

### Task 12: Reproduce the ABA problem with CAS

**Problem.** Implement a Treiber-style stack with `compare-and-swap` and
construct a scenario where ABA causes data loss. Push A, B, C; have Thread 1
read "top = A" and pause; have Thread 2 pop A, pop B, push A back; have
Thread 1 resume and CAS "top from A to B." Show that B is now linked into a
broken state.

**Constraints.**
- Use C or C++ with `std::atomic`. Java's GC hides ABA, so it does not
  count here.
- The node allocator should reuse freed addresses — otherwise ABA cannot
  happen.
- Print the stack contents after each operation to make the corruption
  visible.

**Hints (try without first).**
- ABA happens when an address is freed and re-allocated between read and
  CAS. The CAS sees the same pointer value but a different logical object.
- Solutions include tagged pointers (counter in low bits) and hazard
  pointers.
- Tagged pointers are the easiest fix on 64-bit platforms because pointers
  only use 48 bits.

**Self-check.**
- [ ] You can articulate why this is invisible in garbage-collected
  languages — until you reuse object IDs.
- [ ] You know at least two ABA mitigations.

**Sample Solution.**

```c
// Treiber stack with tagged pointer to defeat ABA.
typedef struct node { int v; struct node *next; } node_t;
typedef struct { node_t *ptr; uint64_t tag; } tagged_t;
_Atomic tagged_t top;

void push(int v) {
    node_t *n = malloc(sizeof *n);
    n->v = v;
    tagged_t old, new;
    do {
        old = atomic_load(&top);
        n->next = old.ptr;
        new.ptr = n;
        new.tag = old.tag + 1;
    } while (!atomic_compare_exchange_weak(&top, &old, new));
}

int pop(void) {
    tagged_t old, new;
    do {
        old = atomic_load(&top);
        if (!old.ptr) return -1;
        new.ptr = old.ptr->next;
        new.tag = old.tag + 1;
    } while (!atomic_compare_exchange_weak(&top, &old, new));
    int v = old.ptr->v;
    free(old.ptr);   // still has lifetime issues; see hazard pointers
    return v;
}
```

---

### Task 13: Peterson's algorithm

**Problem.** Implement Peterson's mutual exclusion algorithm for two
threads in C using only loads, stores, and a memory fence. No `LOCK`
prefix, no `pthread_mutex`. Use it to protect a shared counter and verify
correctness.

**Constraints.**
- Two threads only.
- `flag[0]`, `flag[1]`, and `turn` must be plain integers, but accessed
  through `atomic_store_explicit` with `memory_order_seq_cst` (or you must
  insert explicit fences).
- Show what happens if you weaken the fences to release/acquire only.

**Hints (try without first).**
- Peterson's is interesting precisely because it is incorrect on hardware
  with relaxed memory ordering unless you insert the right fences.
- The store to `flag[i]` must be visible before the load of `flag[1-i]`,
  which is why you need a store-load fence.
- This is more pedagogy than production: real systems use hardware atomics.

**Self-check.**
- [ ] Your implementation has zero races under TSan.
- [ ] You can name the exact fence and the exact pair of accesses it
  protects.

**Sample Solution.**

```c
atomic_bool flag[2];
atomic_int  turn;

void lock(int i) {
    int j = 1 - i;
    atomic_store(&flag[i], true);
    atomic_store(&turn, j);
    while (atomic_load(&flag[j]) && atomic_load(&turn) == j) {
        // spin
    }
}

void unlock(int i) {
    atomic_store(&flag[i], false);
}
```

---

### Task 14: Try-lock with exponential backoff

**Problem.** Wrap a CAS-based spinlock with a try-lock API. If acquisition
fails, sleep for a backoff interval that doubles each retry up to a cap.
Benchmark under contention against a blind spinlock.

**Constraints.**
- The backoff cap is configurable; pick something like 1 ms.
- Acquisition must give up after a configurable total time (return false).
- Use `nanosleep` (C) or `time.Sleep` (Go).

**Hints (try without first).**
- Blind spinning burns CPU and worsens contention because spinning threads
  hold the cache line.
- Exponential backoff with jitter is what real systems use.
- A try-lock with a timeout is the building block for "lease" patterns and
  deadlock avoidance.

**Self-check.**
- [ ] Under heavy contention, your backoff version uses less CPU.
- [ ] You can describe how this maps onto network retry strategies.

---

### Task 15: Reentrant mutex from scratch

**Problem.** Implement a reentrant mutex in C on top of a non-reentrant
mutex plus a thread-id field and a recursion count. Verify it works for
nested calls from the same thread and blocks calls from other threads.

**Constraints.**
- Use `pthread_self()` for the owner identity.
- Must handle the "owner releases when count drops to zero" case correctly.
- Do not use `PTHREAD_MUTEX_RECURSIVE` — write it yourself.

**Hints (try without first).**
- Reads of the owner field must happen while holding the inner mutex, or
  you need to make the owner atomic.
- A non-owning thread must not see itself as the owner just because it lost
  a race on the read.
- Once you have built it, ask: would I want this in production? (Usually
  no — reentrant mutexes hide bad lock design.)

**Self-check.**
- [ ] Recursion counts correctly under stress.
- [ ] You can name reasons reentrant mutexes are an anti-pattern in many
  designs.

---

## Advanced

By now you should be comfortable writing correct code with mutexes,
condition variables, and atomics. The Advanced track is where you start
reasoning about lock-free progress guarantees, memory reclamation, and
formal verification.

### Task 17: Michael-Scott lock-free MPMC queue

**Problem.** Implement the Michael-Scott two-lock-free queue (single linked
list with head and tail pointers, each updated by CAS). Support multiple
producers and multiple consumers.

**Constraints.**
- Use C or C++ with `std::atomic`.
- Use a dummy node so the list is never empty.
- Handle the "tail lagging" case (tail not pointing at the actual last
  node) correctly.

**Hints (try without first).**
- The trick is that `enqueue` does two CAS operations: one to link the new
  node, one to swing tail. The second CAS may fail and is helped by other
  threads.
- ABA on `head` is real. You need tagged pointers or hazard pointers.
- The original paper is short and worth reading line-by-line:
  Michael and Scott, PODC 1996.

**Self-check.**
- [ ] Your implementation runs under TSan with no warnings.
- [ ] You can explain the role of every CAS in the algorithm.
- [ ] You can describe the memory reclamation strategy you used.

---

### Task 18: Hand-rolled spinlock with exponential backoff and pause

**Problem.** Implement a spinlock in C using `_Atomic int`. In the spin
loop, issue the architecture-specific pause instruction (`_mm_pause` on
x86, `__yield` on ARM) and apply exponential backoff. Benchmark against
`pthread_mutex_t` under varying contention.

**Constraints.**
- The lock should be a single int: 0 = unlocked, 1 = locked.
- Use `compare_exchange_weak` in the acquire loop.
- Use `memory_order_acquire` on acquire and `memory_order_release` on
  release.

**Hints (try without first).**
- `pause` reduces power and improves spin-wait throughput on
  hyper-threaded cores.
- Test-and-test-and-set (read first, then CAS) reduces coherence traffic
  compared to pure test-and-set.
- Spinlocks are fast for very short critical sections (less than ~1 μs).
  Beyond that, mutexes are better because they let the OS schedule
  something else.

**Self-check.**
- [ ] You can show a contention regime where your spinlock wins.
- [ ] You can show a regime where the mutex wins.

---

### Task 19: RCU read-mostly counter (simplified)

**Problem.** Implement a tiny RCU (Read-Copy-Update) scheme for a single
pointer-to-counter. Readers dereference the pointer and increment the
counter locally; updaters allocate a new counter object, atomically swap
the pointer, and then wait for all readers to leave their critical
sections before freeing the old object.

**Constraints.**
- Use a per-thread "in critical section" flag instead of full RCU's
  grace-period detection — simplification is fine.
- Readers' critical sections must be wait-free.
- Demonstrate that no reader ever observes a freed pointer.

**Hints (try without first).**
- The point of RCU is that readers pay almost nothing — no atomic, no
  fence on x86.
- The cost is amortized on the updater, who must wait for all readers to
  reach a quiescent state.
- This pattern is everywhere in the Linux kernel.

**Self-check.**
- [ ] No use-after-free under TSan.
- [ ] You measured reader throughput and showed it is essentially free.

---

### Task 20: TLA+ specification for Peterson

**Problem.** Write a TLA+ specification for Peterson's algorithm and use
TLC to verify mutual exclusion and progress. Then break one rule (e.g.
remove the turn assignment) and watch TLC produce a counter-example.

**Constraints.**
- Use the TLA+ Toolbox or `tlapm` from the command line.
- Express mutual exclusion as an invariant.
- Express progress (no thread waits forever if it wants the lock) as a
  temporal property.

**Hints (try without first).**
- Peterson's is the canonical TLA+ teaching example for a reason: it is
  small enough to model exhaustively.
- TLC will visit a few thousand states. The specification fits on one
  screen.
- The book "Specifying Systems" by Lamport is the reference.

**Self-check.**
- [ ] TLC reports "No error found" for the correct version.
- [ ] You broke the spec and got a useful counter-example trace.

---

### Task 21: perf c2c on a false-sharing example

**Problem.** Build the unpadded version of Task 10 on Linux and run
`perf c2c record` followed by `perf c2c report`. Identify the cache line
that is being shared, and the source code lines that touch it.

**Constraints.**
- You need a kernel with `perf c2c` support (most distros ship it).
- Pin the workload to specific cores to make the report cleaner.
- Capture for at least 30 seconds of steady-state load.

**Hints (try without first).**
- `perf c2c` is specifically designed for cache-line contention analysis.
- The "HITM" column (hit-modified) tells you which cache line bounced
  between cores.
- The report links HITMs back to source lines.

**Self-check.**
- [ ] You can point to the contended cache line in the report.
- [ ] You can explain why padding eliminates the HITMs.

---

## Capstone

The Capstone tasks are deliberately open-ended. They are not small
exercises — they are the kind of problem you would be asked to design in a
senior interview or actually ship. Each one should take a few days, and the
"What done looks like" paragraph replaces the self-check.

### Task 25: Thread-safe LRU cache at 5M qps

**Problem.** Design and implement a thread-safe LRU cache that supports
five million operations per second on a 16-core machine. Your starting
point is a `HashMap` + doubly-linked list, but the naive implementation
will not hit the target. You must measure, profile, and iterate.

**Constraints.**
- Read/write mix is 90/10.
- Working-set size: one million entries; key and value are 64 bytes each.
- Operations: `get(k)`, `put(k, v)`, `evict()` (called by background).

**What done looks like.** You have a benchmark harness that produces a
reproducible throughput number on a known machine. You have at least three
implementations: a single-mutex baseline, a sharded version, and a more
sophisticated lock-free or RCU-style version. For each, you measured
throughput, P50/P99 latency, and CPU utilization, and you can articulate
why each design hits the regime it does. You have written down the
trade-offs (memory overhead, eviction accuracy, code complexity) and made
a recommendation for production with caveats. Bonus points if you noticed
that strict LRU is rarely worth the cost compared to approximated LRU
(CLOCK or W-TinyLFU).

---

### Task 26: Per-CPU counter aggregator

**Problem.** Implement a counter that supports millions of concurrent
increments per second by maintaining one counter per CPU and exposing a
single "summary" read. Increments must be wait-free; the summary read can
be slower.

**Constraints.**
- Use `sched_getcpu()` (Linux) or equivalent to find the local CPU.
- Pad each per-CPU counter to a cache line to avoid false sharing.
- Reads of the summary must be eventually consistent: they may briefly
  undercount, but cannot overcount.

**What done looks like.** A library with a `Counter::inc()` that compiles
down to about ten instructions on x86, no atomic operations on the hot
path (just a non-atomic add to a per-CPU slot), and a `Counter::read()`
that walks all CPUs. You have benchmarked it against a single atomic
counter and shown an order-of-magnitude throughput improvement. You can
explain the migration hazard (a thread can be preempted between reading
its CPU id and incrementing) and how you handled it (typically: it is OK
because over-count and under-count cancel statistically, or you use a
restartable sequence). You discuss the trade-off honestly: per-CPU
counters trade read latency for write throughput, which is the right call
for metrics and the wrong call for, e.g., enforcement of a hard quota.

---

### Task 27: Port a contended data structure to lock-free

**Problem.** Take an existing mutex-protected data structure from your own
codebase (or pick one from the standard library — `sync.Map` in Go, or
`ConcurrentHashMap` in Java's pre-Java-8 form) and rewrite it as lock-free
or wait-free. Measure throughput, latency tails, and CPU usage before and
after.

**Constraints.**
- The lock-free version must pass every test that the original passed.
- It must use a well-understood reclamation scheme (RCU, hazard pointers,
  or epoch-based).
- The benchmark must show contention and not just single-threaded speed.

**What done looks like.** A pull request (real or simulated) that
replaces the mutex-protected version with the lock-free one, accompanied
by a one-page write-up of the benchmark, the failure modes you considered
(memory reclamation, ABA, progress guarantees), and a recommendation for
when this complexity is worth it. You should be able to defend the
rewrite in a code review: lock-free code is harder to maintain, so the
performance win has to be real and the test coverage has to be thorough.
You also document the memory order on every atomic operation and explain
why each one is the minimum required.

---

If you can do all of these, you have the shared-memory foundation that a
strong senior engineer would expect.

---

## Related Topics

- [Junior level](junior.md) — the absolute basics of shared memory.
- [Middle level](middle.md) — practical use of synchronization primitives.
- [Senior level](senior.md) — design and trade-offs of shared-memory
  concurrency.
- [Professional level](professional.md) — performance, scalability, and
  cross-system implications.
- [Interview questions](interview.md) — typical questions on
  shared-memory concurrency in interviews.
