# Mutex — Hands-On Tasks

> **Topic:** [Mutex](README.md)

---

## Introduction

A mutex is the simplest synchronization primitive a working engineer touches every day, and the primitive that creates the most production fires when it is misused.

The exercises below take you from "I can guard a counter" to "I can design a thread-safe LRU at five million queries per second and explain why a perf lock report shows my hot path is bouncing between cores."

The progression mirrors what good senior engineers actually develop in their careers: first the reflex of recognizing critical sections, then the discipline of lock ordering, then the awareness of contention as a measurable cost, then the architectural skill of choosing the right granularity for the workload.

The tasks are arranged in four bands — Warm-Up, Core, Advanced, and Capstone — so that you build the mental model in layers.

The Warm-Up tier exists so that the muscle memory of acquiring and releasing a mutex becomes second nature in C++, Go, Python, Java, and Rust.

This matters because every language defines a slightly different default (reentrant or not, fair or not, scoped guard or manual unlock) and you need a feel for those defaults before you can debug a real program.

For example, a Python `threading.Lock` is non-reentrant but `threading.RLock` is; a Java `synchronized` block is implicitly reentrant; a Go `sync.Mutex` is non-reentrant by deliberate design.

Knowing the default for the language at hand is a foundational skill.

The Core tier moves you into the patterns you actually see in production: try-with-backoff, read-write locks for cache workloads, lock-ordering disciplines that prevent dining philosophers and deadlock, and a hand-rolled reentrant mutex so the concept of ownership tracking stops being mysterious.

By the end of Core you should be able to read a `sync.Mutex` source from the Go runtime (or `parking_lot::Mutex` from Rust, or `pthread_mutex_t` from glibc) and follow the slow path through to the futex syscall.

The Advanced tier pushes you under the abstraction: sharded mutexes for hash maps, hand-over-hand locking for fine-grained linked structures, futex syscall observation via `strace`, contention profiling with `perf lock` and Go's block profile, priority inversion that you can reproduce on Linux, and a head-to-head benchmark of a lock-free Treiber stack against a mutex-protected stack so you stop assuming "lock-free is always faster."

The Advanced tier is where you cross from "user of mutexes" to "person who can debug a production incident involving lock contention." You will write your own adaptive spinning mutex and a sequence lock, and you will see firsthand why both exist in the kernel.

The Capstone tier asks you to make architecture-scale decisions: a thread-safe LRU under five million queries per second, the surgical refactor of a "god mutex" service into fine-grained ownership, a small static linter that catches lock-order violations across a Go codebase, a two-phase locking transaction engine, and a distributed mutex built on Redis or etcd.

These are portfolio-grade problems and they will take you weekends, not afternoons. Treat them seriously: design, measure, document.

Complete the bands in order. Run each program under a sanitizer or race detector where one exists (`-fsanitize=thread`, `go test -race`, `cargo +nightly miri`), measure before you optimize, and write down what you observe before you read the sample solutions.

A note on tooling. ThreadSanitizer (TSAN) finds data races by instrumenting memory accesses; Go's race detector is a port of TSAN. Helgrind and DRD are Valgrind-based and substantially slower but they also catch ordering errors. Each has blind spots: TSAN misses races that the test inputs do not exercise; Helgrind reports false positives on some custom synchronization. Knowing the limits of your tools is part of the skill.

A note on benchmarking. Throughput numbers without a description of the benchmark are useless. Always report: thread count, CPU model, operating system, language and runtime version, the access pattern (uniform, Zipfian, sequential), and the measurement window. A "two million ops per second" claim is meaningless without that context.

A note on style. Many of the tasks ask you to "write a small README" or "document the lock-ordering invariants." This is not busywork — articulating the invariants is the actual senior-engineer deliverable. Code without documented invariants is a future production incident waiting to happen.

## Table of Contents

- [Warm-Up](#warm-up)
  - [Task 1: The Race That Sells Negative Tickets](#task-1-the-race-that-sells-negative-tickets)
  - [Task 2: Scoped Unlock in C++, Go, Python, Java, Rust](#task-2-scoped-unlock-in-c-go-python-java-rust)
  - [Task 3: The Forgotten Unlock on the Error Path](#task-3-the-forgotten-unlock-on-the-error-path)
  - [Task 4: Double-Lock Disaster (Intentional Bug)](#task-4-double-lock-disaster-intentional-bug)
  - [Task 5: Mutex Granularity and the Single-Counter Bottleneck](#task-5-mutex-granularity-and-the-single-counter-bottleneck)
  - [Task 6: Mutex vs Atomic Counter Microbenchmark](#task-6-mutex-vs-atomic-counter-microbenchmark)
  - [Task 7: A Logger That Interleaves Its Lines](#task-7-a-logger-that-interleaves-its-lines)
  - [Task 7b: The Forgotten Initialization Race](#task-7b-the-forgotten-initialization-race)
- [Core](#core)
  - [Task 8: TryLock With Exponential Backoff](#task-8-trylock-with-exponential-backoff)
  - [Task 9: A Reentrant Mutex From Scratch](#task-9-a-reentrant-mutex-from-scratch)
  - [Task 10: Dining Philosophers With Lock Ordering](#task-10-dining-philosophers-with-lock-ordering)
  - [Task 11: RWMutex Read-Heavy Cache](#task-11-rwmutex-read-heavy-cache)
  - [Task 12: Deadlock Reproduction and Git Bisect](#task-12-deadlock-reproduction-and-git-bisect)
  - [Task 13: Recursive Lock Counter](#task-13-recursive-lock-counter)
  - [Task 14: Condition Variable on Top of Mutex](#task-14-condition-variable-on-top-of-mutex)
  - [Task 15: Bounded Channel via Mutex Plus Condition](#task-15-bounded-channel-via-mutex-plus-condition)
  - [Task 16: Reader-Writer Fairness Stress Test](#task-16-reader-writer-fairness-stress-test)
  - [Task 17: Detecting Lock Order at Runtime](#task-17-detecting-lock-order-at-runtime)
- [Advanced](#advanced)
  - [Task 18: Sharded Mutex Hash Map](#task-18-sharded-mutex-hash-map)
  - [Task 19: Hand-Over-Hand Locked Linked List](#task-19-hand-over-hand-locked-linked-list)
  - [Task 20: Observe the Futex Syscall via strace](#task-20-observe-the-futex-syscall-via-strace)
  - [Task 21: Profile Lock Contention With perf lock or pprof block](#task-21-profile-lock-contention-with-perf-lock-or-pprof-block)
  - [Task 22: Priority Inversion Reproduction](#task-22-priority-inversion-reproduction)
  - [Task 23: Lock-Free Treiber Stack vs Mutex Stack Benchmark](#task-23-lock-free-treiber-stack-vs-mutex-stack-benchmark)
  - [Task 24: Adaptive Spin-Then-Block Mutex](#task-24-adaptive-spin-then-block-mutex)
  - [Task 25: Sequence Locks for a Read-Mostly Counter](#task-25-sequence-locks-for-a-read-mostly-counter)
- [Capstone](#capstone)
  - [Task 26: Thread-Safe LRU Under 5M QPS](#task-26-thread-safe-lru-under-5m-qps)
  - [Task 27: Refactor a God Mutex Service to Fine-Grained Locks](#task-27-refactor-a-god-mutex-service-to-fine-grained-locks)
  - [Task 28: A Lock-Ordering Linter for a Go Codebase](#task-28-a-lock-ordering-linter-for-a-go-codebase)
  - [Task 29: Build a Two-Phase Locking Transaction Engine](#task-29-build-a-two-phase-locking-transaction-engine)
  - [Task 30: Distributed Mutex via Redis or etcd](#task-30-distributed-mutex-via-redis-or-etcd)
- [Related Topics](#related-topics)

---

## Warm-Up

The Warm-Up tier exists to build muscle memory. None of the tasks here require deep thought; they require that you write the code, run the race detector, and feel the failure mode in your hands. Allocate about three to five hours for the entire tier and resist the temptation to skip ahead. The skill of "noticing immediately that this read-modify-write needs a mutex" is built only by writing many small examples and seeing them break.

Pick two languages: your strongest and one you find unfamiliar. Implement each task in both. The cross-language exercise teaches you what is universal (every mutex serializes the critical section) and what is idiomatic (RAII guards in C++ and Rust, `defer` in Go, context managers in Python, `synchronized` blocks in Java). When you finish the tier, you should be able to write a correct critical section in any of the five languages without looking up syntax.

### Task 1: The Race That Sells Negative Tickets

**Problem.** You are given a single integer `tickets` that starts at one hundred. Spawn one thousand worker threads (or goroutines, or coroutines). Each one loops one thousand times and, in each iteration, reads `tickets`, checks that it is greater than zero, and decrements it. Run the program without any mutex. Observe and record the final value of `tickets`. Then introduce a mutex around the read-check-decrement triple and confirm that the final value never goes below zero across one hundred runs.

**Constraints.** Implement once in your strongest language and once in a language whose memory model you find unfamiliar. Run under the appropriate race detector (`-fsanitize=thread`, `go test -race`, `RUSTFLAGS=-Zsanitizer=thread`). Do not use atomics — the point is to feel the mutex. Do not use a channel-based solution in Go for this task; we are practicing mutexes specifically.

**Hints.** The unsynchronized version will almost certainly report a final value below zero. The bug is a classic read-modify-write race: two threads both observe `tickets == 1`, both pass the check, both decrement, and you end up at minus one. The fix is to take the lock before the read. Pay attention to what the race detector tells you: the report should name the read and the write sites and the goroutines or threads involved. Read the entire report — it is the single most useful debugging artifact for concurrency bugs.

**Self-check.** Can you explain why moving the lock acquisition between the read and the decrement does not fix the bug? Can you sketch a thread interleaving diagram that lands on minus three? What is the maximum negative value you can produce with N threads, and how would you derive that bound formally?

---

### Task 2: Scoped Unlock in C++, Go, Python, Java, Rust

**Problem.** Implement a tiny bank-transfer function in five languages: C++ with `std::lock_guard`, Go with `defer mu.Unlock()`, Python with `with lock:`, Java with a `synchronized` block, and Rust with the RAII guard returned by `Mutex::lock()`. The function takes two accounts and an amount, and transfers money atomically with respect to balance reads.

**Constraints.** No manual `unlock()` calls outside of Go. In Go, the `defer` must come on the line after the lock. Each implementation must compile and pass a small unit test that confirms total balance is conserved. The function must release the lock even when the transfer raises an "insufficient funds" error.

**Hints.** The shape of the function should be nearly identical across languages — that is the entire point of RAII guards and `defer`. Note where Rust's guard ownership forces you to drop the guard explicitly if you want to release early. In C++ a `std::scoped_lock` is the modern choice over `std::lock_guard` for multi-mutex acquisition because it uses deadlock-avoiding lock ordering internally.

**Self-check.** Which of these five idioms still releases the lock if the body panics or throws? Which release the lock if the function returns early via an error? In Go, what is the cost of `defer` and when (if ever) does it matter?

---

### Task 3: The Forgotten Unlock on the Error Path

**Problem.** Write a C program (or any language without RAII) that takes a `pthread_mutex_t`, validates an input, returns early on validation failure, and only unlocks on the success path. Run it under a checker (`helgrind`, `tsan`) and observe what happens when the validation fails for one in ten inputs.

**Constraints.** No `goto cleanup` pattern in the first version. After observing the failure, refactor to use `goto cleanup` (the classic Linux kernel pattern) and verify that the leak goes away.

**Hints.** The forgotten unlock will cause the next thread to block forever, which `helgrind` and operating-system thread dumps will surface as "thread waiting on mutex held by terminated thread." If the thread does not terminate but simply moves on holding the lock, future critical sections will deadlock silently.

**Self-check.** Why do high-quality C codebases (the Linux kernel, PostgreSQL) almost universally adopt the `goto cleanup` pattern? What would the equivalent failure mode look like in Java if you used a manual `lock()`/`unlock()` pair instead of `synchronized`?

---

### Task 4: Double-Lock Disaster (Intentional Bug)

**Problem.** Write a function `transfer(from, to, amount)` that locks `from.mu`, then calls a helper `debit(from, amount)` which also locks `from.mu`. Use a non-reentrant mutex (C++ `std::mutex`, Go `sync.Mutex`, Rust `std::sync::Mutex`). Run it. Observe the deadlock or undefined behavior. Then fix the bug in two different ways: pass an already-locked precondition to the helper, or switch to a reentrant mutex.

**Constraints.** Reproduce the hang under a debugger, attach with `gdb` or `dlv`, and print the stack trace of the hung thread. The trace should show the inner `lock()` waiting on the same mutex held by the outer caller.

**Hints.** In C++ this is undefined behavior with `std::mutex` and a well-defined recursive count with `std::recursive_mutex`. In Go and Rust it is a guaranteed deadlock. The "fix by precondition" approach is preferred in modern codebases because reentrant mutexes hide more bugs than they solve.

**Self-check.** Name three reasons style guides at large companies (Google C++, the Go authors) discourage reentrant mutexes. Could you write a documentation comment that makes the "already locked" precondition unambiguous?

---

### Task 5: Mutex Granularity and the Single-Counter Bottleneck

**Problem.** Build a tiny event counter struct with three integer fields — `requests`, `errors`, and `latency_sum`. Version A protects all three with a single mutex. Version B has one mutex per field. Hammer both versions from eight threads for ten seconds and compare throughput.

**Constraints.** Use a steady-state benchmark (Go's `testing.B`, C++ Google Benchmark, Criterion in Rust). Measure both the median and the ninety-ninth percentile of operation latency.

**Hints.** Version B will be faster only if your workload actually accesses the three fields independently. If every operation touches all three, Version B is strictly slower due to extra lock acquisitions and worse cache behavior. Try a third variant with one mutex per field padded to a full cache line and compare.

**Self-check.** Why might Version B sometimes be slower even when the workload is independent? (Think about cache line bouncing and the cost of three uncontended mutex acquisitions versus one.)

---

### Task 6: Mutex vs Atomic Counter Microbenchmark

**Problem.** Implement a counter incremented one hundred million times from four threads. Compare three implementations: `std::mutex` plus plain `int`, `std::atomic<int>` with `fetch_add(1, std::memory_order_relaxed)`, and one atomic per thread followed by a final reduction. Repeat the experiment with eight, sixteen, and thirty-two threads and plot the curves.

**Constraints.** Pin threads to cores where possible. Report nanoseconds per increment. Use a benchmark harness that warms up the cache before timing (Google Benchmark, Criterion, or `testing.B`). Pad each per-thread atomic to a full cache line to avoid false sharing in the sharded version.

**Hints.** The mutex version will be roughly an order of magnitude slower than the single atomic, which will be an order of magnitude slower than the sharded version. The sharded version is the basis for many real-world high-throughput counters such as eBPF's `BPF_MAP_TYPE_PERCPU_ARRAY` and Prometheus's per-CPU counters.

**Self-check.** What memory order would you need if the counter were used to gate access to another piece of data? Why does the sharded version still need a memory fence at the reduction step? At what thread count does the single atomic stop scaling, and why?

---

### Task 7: A Logger That Interleaves Its Lines

**Problem.** Write a logger that writes complete lines to stderr from many threads. First implement it without a mutex around the `write` call. Observe interleaved output. Then add a mutex and verify each line is atomic.

**Constraints.** The lines must be at least eighty characters long so the interleaving is obvious even on systems where `PIPE_BUF` guarantees small atomic writes. Run the test by piping stderr to a file and grepping for malformed lines (a line that does not match the expected format implies torn output).

**Hints.** The fix is one mutex around the write. Bonus question: why does writing to a file opened with `O_APPEND` give you atomic writes for short messages even without a user-space lock? (Hint: the kernel takes an inode lock for the duration of the write, but only for writes up to `PIPE_BUF` size and on certain filesystems.)

**Self-check.** What is `PIPE_BUF` on your platform? What happens if your log line exceeds it? How does Go's `log.Logger` solve this problem internally — does it lock, or does it rely on `write()` atomicity?

---

### Task 7b: The Forgotten Initialization Race

**Problem.** Write a singleton that lazily initializes an expensive object on first use. The naive version reads a flag, initializes if false, sets the flag. Run it from sixteen threads. Observe two threads racing into initialization. Then fix it three different ways: with `sync.Once` in Go (or `std::call_once` in C++, `OnceLock` in Rust, double-checked locking in Java with `volatile`), with a static initializer at package or module load time, and with a mutex around the entire access (the simplest correct fix).

**Constraints.** Each fix must pass a race-detector run. Time each approach: the `Once` variant should be approximately free after the first call.

**Hints.** Double-checked locking without a memory barrier is the most-cited textbook example of a broken pattern. In Java, the `volatile` keyword on the singleton field is required. In C++ before C++11, double-checked locking was effectively impossible to write correctly without compiler intrinsics. `std::call_once` and `sync.Once` exist because the standard library authors chose to encapsulate this difficulty rather than ask every user to get it right.

**Self-check.** Why does double-checked locking without a barrier expose the partially constructed object? Trace through the steps: thread A allocates, writes the pointer, then runs the constructor. Thread B reads the pointer (non-null) and uses the object before A's constructor stores complete. Where does the data race manifest?

---

## Core

The Core tier introduces the patterns you will encounter in actual systems: backoff strategies, reentrancy, lock ordering, reader-writer locks, condition variables, bounded queues, fairness considerations, and runtime lock-order detection. Each task is meant to take between one and three hours; the tier as a whole is the largest part of this document and represents roughly two weekends of focused work.

The unifying theme is "you understand why you would choose this primitive in production." A senior engineer does not just know that `sync.RWMutex` exists; they know when it helps, when it hurts, and what its fairness policy is in their specific runtime. By the end of this tier you will have written your own reentrant mutex, your own bounded blocking queue, and your own lock-order detector — so the standard library implementations stop being magic.

### Task 8: TryLock With Exponential Backoff

**Problem.** Build a worker that, for each unit of work, tries to acquire a mutex. If the mutex is busy, it backs off for one millisecond, then two, then four, capped at one hundred. After ten failures it gives up and reports the work as deferred. Then expose a metric — number of acquisitions on first try, number after backoff, number deferred — and write a unit test that injects a holder thread to force each branch.

**Constraints.** Use `std::mutex::try_lock` in C++, `sync.Mutex.TryLock` in Go 1.18 or later, `lock.acquire(blocking=False)` in Python, `tryLock()` in Java, `try_lock()` in Rust. Add jitter to the backoff. Make the jitter "full jitter" in the AWS Architecture Blog sense: a uniformly random sleep in `[0, current_backoff]`, not `current_backoff + uniform(0, jitter_amount)`.

**Hints.** Exponential backoff with jitter is the textbook way to avoid synchronized retry storms. Without jitter, two waiters can ping-pong and effectively serialize. Note also that `TryLock` is intentionally rare in well-written code; the Go authors went back and forth before adding it because it tempts engineers to write busy-wait loops. Treat it as a tool for explicit best-effort or for breaking a potential deadlock, not as a general locking strategy.

**Self-check.** Why is the deferred-work counter itself a candidate for a separate counter (atomic, not mutexed)? What changes if the workload is bursty rather than steady? Under a steady workload, how does your average latency change as the contention increases — is it linear, sublinear, or superlinear?

---

### Task 9: A Reentrant Mutex From Scratch

**Problem.** Implement a reentrant mutex on top of a regular mutex plus a thread-id field plus a recursion counter. The `lock()` method acquires the inner mutex if and only if the current thread does not already hold it; otherwise it increments the counter. The `unlock()` method decrements the counter and releases the inner mutex when the counter reaches zero.

**Constraints.** Cover the case where `unlock()` is called by a thread that does not own the mutex — it must panic or return an error. Write tests for nested locking from the same thread and contention from different threads.

**Hints.** You need a way to read the current thread id cheaply: `std::this_thread::get_id()`, `gettid()`, `goroutine_id` is hard in Go so use a token-based API instead. In Rust, use `std::thread::current().id()`. Beware: storing the owner field outside the inner mutex requires careful memory ordering — use an atomic for the owner.

**Self-check.** What is the worst-case behavior of your reentrant mutex if a thread takes the lock, panics, and the panic unwinds past your `unlock`? Did you reset the owner field correctly?

---

### Task 10: Dining Philosophers With Lock Ordering

**Problem.** Implement the classic five-philosopher problem. Each philosopher needs two forks (mutexes) to eat. Naive code that locks "left then right" deadlocks under contention. Fix it by enforcing a total order on the forks: always lock the lower-numbered fork first. As a second variant, fix it by introducing a waiter (a single coordination mutex) that allows at most four philosophers to attempt to eat at once. Compare throughput.

**Constraints.** Run for thirty seconds with no progress meter. If no philosopher has eaten in five seconds, declare the run a deadlock. Confirm that the naive version deadlocks within a few seconds and the lock-ordered version never does. Each philosopher must eat at least one hundred times during the thirty-second window — that is your liveness check.

**Hints.** Lock ordering is the foundational deadlock-avoidance technique. The same idea generalizes to "always acquire the account with the lower id first" in bank transfers. The waiter approach is a form of resource limitation that breaks the "hold and wait" precondition of deadlock by capping concurrent acquirers.

**Self-check.** Sketch the wait-for graph that forms during a naive run. Where is the cycle? Why does total ordering on resources prevent any cycle? Coffman's four conditions for deadlock are mutual exclusion, hold-and-wait, no preemption, and circular wait — which one does each fix attack?

---

### Task 11: RWMutex Read-Heavy Cache

**Problem.** Build a cache that maps strings to JSON blobs. Ninety-five percent of operations are reads, five percent are writes. Implement two versions: one with a plain mutex and one with a read-write mutex. Benchmark them under sixteen threads. Then sweep the read percentage from fifty to ninety-nine and plot throughput.

**Constraints.** Use `std::shared_mutex` in C++, `sync.RWMutex` in Go, `RwLock` in Rust. Report throughput and the p99 latency of reads under contention. Each "read" should compute a small hash of the value so the compiler does not optimize the read away.

**Hints.** RWMutex shines when the critical section is long enough that the bookkeeping overhead is amortized. For very short critical sections, a plain mutex can be faster because RWMutex implementations carry more state. Note that Go's `sync.RWMutex` has a particular property: once a writer calls `Lock`, new readers are blocked, even if existing readers still hold the read lock. This prevents writer starvation but means high read concurrency does not always translate to higher throughput.

**Self-check.** Under what workload does an RWMutex perform worse than a plain mutex? What changes if writes are not five percent but fifty percent? Why does the crossover point depend on critical section length?

---

### Task 12: Deadlock Reproduction and Git Bisect

**Problem.** Take a small Go service that locks two mutexes in inconsistent order across two functions. Reproduce the deadlock. Then make a series of ten commits, some of which fix and re-break the order. Use `git bisect run` with a script that runs the service under load and checks for a hang to find the first broken commit.

**Constraints.** The bisect script must time out after thirty seconds and return exit code zero for "good" and one for "bad." Write the script so it is deterministic — bisect needs deterministic verdicts.

**Hints.** Build the deadlock reproducer so that it hangs in under five seconds when the bug is present. Use `runtime.Stack` or `pprof.Lookup("goroutine")` to dump goroutine traces on timeout. The dumped trace makes the diagnosis instant: you will see one goroutine waiting on mutex A while holding B, another waiting on B while holding A.

**Self-check.** What kinds of bugs is `git bisect` poor at finding? (Flaky bugs, bugs that depend on timing across multiple commits, bugs introduced by a merge.)

---

### Task 13: Recursive Lock Counter

**Problem.** Extend Task 9 to expose a method that returns the current recursion depth. Use it to write an assertion that fires if a function expects to be called at depth zero but is instead called nested. Add a second assertion that fires if the recursion depth exceeds a configurable maximum (default eight) — this catches accidental infinite recursion through a locked call chain.

**Constraints.** The assertion must be cheap enough to leave in production. The depth read must be safe to call without taking the outer mutex. The maximum-depth check should fire with a meaningful error that names the locked-call chain.

**Hints.** Because the depth is only meaningful to the owning thread, you can store it in a thread-local or read it after confirming ownership. Capturing the call chain cheaply is the interesting subproblem; consider storing function names in a per-thread ring buffer maintained by RAII guards in debug builds.

**Self-check.** Could two different reentrant mutex instances interfere if they both use a thread-local for their depth? How would you isolate them? What is the runtime cost of your assertion per `lock()` call?

---

### Task 14: Condition Variable on Top of Mutex

**Problem.** Implement a one-shot event: a thread calls `wait()` and blocks until another thread calls `signal()`. Build it from a mutex and a condition variable. Then build it again from only a mutex (using a flag and a tight `while (!flag) sleep(1ms)` loop) and compare CPU usage.

**Constraints.** The condition variable version must use `while (!flag) cv.wait(lock)` — not `if`, because of spurious wakeups.

**Hints.** Spinning on a flag is sometimes called a "spinlock disguised as a flag." It uses one hundred percent of a core and is a common junior mistake. The condition variable version sleeps until woken. Read POSIX's `pthread_cond_wait` man page after this task — the spurious-wakeup language is direct and clarifying.

**Self-check.** Why is the predicate check inside a `while` rather than an `if`? Look up spurious wakeups.

---

### Task 15: Bounded Channel via Mutex Plus Condition

**Problem.** Build a thread-safe bounded queue with a mutex and two condition variables — one for "not full" and one for "not empty." Producers wait on "not full" when the queue is at capacity; consumers wait on "not empty" when the queue is empty. Then build a benchmark that varies the queue capacity from one to one thousand and measures throughput; identify the knee in the curve.

**Constraints.** Capacity is a constructor argument. The queue must work under multiple producers and multiple consumers. Test with eight of each and a capacity of sixteen. Support a `Close()` operation that wakes all waiters and causes subsequent producers and consumers to fail.

**Hints.** Always re-check the predicate after waking — a producer might have been notified that the queue is "not full" but lost the race to another producer. The `Close()` operation must hold the mutex while setting the closed flag and must broadcast on both condition variables.

**Self-check.** What happens if you use one condition variable for both "not full" and "not empty"? (It still works but causes spurious wakeups; this is the textbook reason to use two.) Compare against Go's `chan` — your implementation will be slower; can you explain why?

---

### Task 16: Reader-Writer Fairness Stress Test

**Problem.** Take your RWMutex from Task 11. Set up a workload of one writer and sixteen readers, where each reader takes the read lock for one millisecond every millisecond. Measure how long the writer waits to acquire the write lock.

**Constraints.** Test with three implementations: the language standard library, a "reader-preference" implementation you write yourself, and a "writer-preference" implementation you write yourself.

**Hints.** Reader-preference RWMutex can starve writers. Writer-preference can starve readers. Most standard libraries pick a compromise — Go's `sync.RWMutex` blocks new readers once a writer is waiting.

**Self-check.** Which preference would you pick for a config-reload pattern where reads happen on every request and writes happen rarely? Why?

---

### Task 17: Detecting Lock Order at Runtime

**Problem.** Build a small `OrderedMutex` wrapper that records, per-thread, the sequence of mutex ids it currently holds. On every `lock()`, assert that the new id is strictly greater than the largest currently held id (lock ordering). On violation, panic with the offending order. Then extend the wrapper to record, globally, the pairwise order of every two-mutex acquisition observed; on a new acquisition, check whether the reverse order has ever been observed and panic if so.

**Constraints.** The wrapper must add no observable overhead when assertions are compiled out. In production, it can be a no-op. The global order table can be a `map[pair{a,b}]bool` guarded by an internal mutex (yes, you are using a mutex to detect lock-order violations on other mutexes — that is fine because the internal mutex is never held concurrently with the others).

**Hints.** This is the kernel-style "lockdep" idea, in miniature. Real lockdep also tracks classes of locks and the historical order across all threads. Read the kernel documentation at `Documentation/locking/lockdep-design.txt` after this task — it is a deep rabbit hole and worth the time.

**Self-check.** Why is per-thread tracking insufficient to catch all deadlocks? (Two threads can each lock in a "locally" valid order but globally form a cycle.) Sketch a case lockdep would catch but yours would not. What is the false-positive rate of pure global pairwise tracking?

---

## Advanced

The Advanced tier pushes you under the abstraction. Up to this point you have used mutexes; now you will look at how they are implemented, how the operating system supports them via futex syscalls, how contention shows up in profilers, how the Linux scheduler interacts with priority, and how lock-free alternatives compare. Plan on three to four hours per task — these are not "type along" exercises, they require reading documentation, capturing profiles, and writing benchmark harnesses.

You will need a Linux machine for several of these tasks (Task 20 on futex, Task 21 on `perf lock`, Task 22 on priority inversion). If you only have macOS, you can do the equivalent work with `dtrace` and `os_unfair_lock`, but the canonical references are Linux and the Linux ecosystem.

### Task 18: Sharded Mutex Hash Map

**Problem.** Build a concurrent hash map with sixteen shards, each guarded by its own mutex. Hash the key, take the shard's mutex, perform the operation. Compare throughput against a single-mutex map under sixty-four threads. Then sweep the shard count across 1, 4, 16, 64, 256, and plot throughput as a function of shards.

**Constraints.** Choose the shard count as a power of two and use a fast hash (xxHash, fxhash, or Go's `runtime.memhash`). Resize within a shard, not across shards. Pad each shard's mutex to a full cache line — sixty-four bytes on x86_64 — to avoid false sharing between adjacent shards.

**Hints.** Sixteen shards is the magic number used by Java's old `ConcurrentHashMap` and many production caches. Beyond a few dozen shards, the contention reduction plateaus and the memory overhead grows. Without padding, two shards whose mutexes share a cache line will effectively contend even when their keys do not collide, because the cache coherence protocol invalidates the line on every write.

**Self-check.** How would you implement `len()` on a sharded map? Does it need a consistent snapshot, or is "approximate" good enough? Sketch how you would do iteration — Java's `ConcurrentHashMap` iterators are "weakly consistent." What does that mean and why is it the right choice?

---

### Task 19: Hand-Over-Hand Locked Linked List

**Problem.** Implement a sorted singly linked list with fine-grained locking. Each node owns its own mutex. To traverse, you lock node N, then lock node N+1, then release node N. This "hand-over-hand" pattern allows multiple traversals to make progress concurrently.

**Constraints.** Support `insert`, `delete`, and `contains`. Use a sentinel head node so the empty-list case is uniform. Verify correctness with a multi-threaded torture test.

**Hints.** The release-then-reacquire pattern is forbidden — you must hold the predecessor's lock until you have the successor's lock. Otherwise another thread can splice in between you.

**Self-check.** Hand-over-hand is rarely faster than a single mutex for short lists. Why? When does it become a win?

---

### Task 20: Observe the Futex Syscall via strace

**Problem.** Take a Linux x86_64 program with two threads contending on a mutex. Run it under `strace -f -e trace=futex`. Read the output. Identify the `FUTEX_WAIT` and `FUTEX_WAKE` calls. Then run the program with one thread (no contention) and confirm that no futex syscalls appear at all. As an extension, count how many `FUTEX_WAIT` calls occur per second under increasing thread counts, and explain the curve.

**Constraints.** Use a `pthread_mutex_t` directly. Higher-level wrappers (Go's runtime, Rust's `parking_lot`) hide or replace the futex pattern and obscure the lesson. On macOS or Windows, the equivalent primitives are `os_unfair_lock` and `SRWLOCK`/`WaitOnAddress`; you can repeat the exercise with `dtrace` or ETW, but the canonical version is Linux futex.

**Hints.** The fast path of a `pthread_mutex_t` is a single atomic compare-and-swap in user space. Only when contention is observed does it call `futex(FUTEX_WAIT)` to suspend. The futex address is the address of the mutex itself; the kernel hashes it into a wait queue. Read Ulrich Drepper's "Futexes Are Tricky" paper after this task — it is the canonical reference.

**Self-check.** Why is "no syscall on the fast path" the key performance property of modern mutexes? What would performance look like if every `lock()` were a syscall? Sketch the state transitions of the futex word: zero means unlocked, one means locked with no waiters, two means locked with waiters. Why does the unlock path need the third state?

---

### Task 21: Profile Lock Contention With perf lock or pprof block

**Problem.** Take a workload from Task 18 with deliberately too few shards (two shards under sixty-four threads). Profile it with `perf lock record` and `perf lock report` on Linux, or with Go's block profile (`runtime.SetBlockProfileRate`). Identify the hot lock. Increase shards to sixteen. Re-profile and confirm the contention drops.

**Constraints.** Capture both before and after profiles. Save them. The "before" profile should attribute roughly all the wait time to two mutexes; the "after" should spread it across sixteen.

**Hints.** Go's pprof block profile reports time spent blocked on synchronization primitives. The Linux `perf lock` subsystem requires `CONFIG_LOCKSTAT` in the kernel and uses tracepoints. The output is verbose but readable.

**Self-check.** Block profiling adds overhead. What sampling rate would you use in production? What is the tradeoff?

---

### Task 22: Priority Inversion Reproduction

**Problem.** On Linux with real-time priorities (`SCHED_FIFO`), construct the classic three-priority scenario: a low-priority thread holds a mutex, a medium-priority thread runs CPU-bound forever, and a high-priority thread blocks on the mutex. Without priority inheritance, the high-priority thread waits indefinitely because the low-priority holder never gets scheduled. Instrument with `perf sched` or `bpftrace` to show the scheduling timeline.

**Constraints.** Requires `CAP_SYS_NICE` or root. Use `pthread_mutexattr_setprotocol` to switch to `PTHREAD_PRIO_INHERIT` and confirm the inversion disappears. Pin all three threads to a single CPU; otherwise the inversion does not manifest reliably because the holder runs on a different core.

**Hints.** This is the bug that famously stalled the Mars Pathfinder mission. Priority inheritance boosts the holder's priority to the highest waiter's priority for the duration of the critical section. Read the JPL post-mortem after this task — it is a canonical example of why a "rare-edge-case timing bug" can become a million-dollar problem in production.

**Self-check.** What is priority ceiling, and how does it compare to priority inheritance? Why do most user-space mutexes not implement either? Why is priority inversion not really a problem in CFS (the default Linux scheduler) but a critical concern under `SCHED_FIFO`?

---

### Task 23: Lock-Free Treiber Stack vs Mutex Stack Benchmark

**Problem.** Implement two stacks: one protected by a single mutex, one using the Treiber lock-free algorithm (CAS on the head pointer). Benchmark `push`/`pop` from four, eight, sixteen, and thirty-two threads.

**Constraints.** Use `std::atomic<Node*>` with `compare_exchange_weak` in C++, or `sync/atomic.Pointer` in Go, or `crossbeam` in Rust. Mind the ABA problem: use tagged pointers, hazard pointers, or epoch-based reclamation.

**Hints.** The lock-free version is not magically faster. Under low contention it can be slower because of cache line bouncing. Under high contention it scales better, but the gap closes as thread count grows because of cache-coherence traffic.

**Self-check.** Sketch an ABA scenario where a `pop` on the Treiber stack returns a stale node. How does tagging the head pointer with a generation count prevent it?

---

### Task 24: Adaptive Spin-Then-Block Mutex

**Problem.** Build a mutex that spins for a short, adaptive count before falling back to a futex wait. Tune the spin count based on observed contention — if most acquisitions resolve in a few spins, increase the spin budget; if not, drop to zero.

**Constraints.** Use `__builtin_ia32_pause()` or the language's spin-hint intrinsic inside the spin loop. Compare against `std::mutex` on a workload with very short critical sections.

**Hints.** Adaptive spinning is what `parking_lot::Mutex` (Rust) and the Linux kernel's `mutex_lock_slowpath` do internally. The spin budget should be on the order of the cost of a context switch — a few microseconds.

**Self-check.** Spinning is bad when the holder is descheduled. Why? How would you detect that the holder is not running?

---

### Task 25: Sequence Locks for a Read-Mostly Counter

**Problem.** Implement a sequence lock (seqlock) for a multi-word data structure (say a sixty-four-byte struct). Writers increment a sequence counter, write the data, increment again. Readers read the sequence, read the data, re-read the sequence; if the two reads differ or the sequence is odd, they retry. Compare throughput against `RWMutex` on a workload of one writer and sixteen readers.

**Constraints.** No reader ever blocks. Writers are mutually excluded by an inner mutex. The data must be aligned to a cache line. Use acquire/release fences correctly: the reader must do a load-acquire on the second sequence read so the data reads cannot be reordered after it; the writer must do a store-release on the post-write sequence increment.

**Hints.** Seqlocks are used in the Linux kernel for `jiffies`, system time, and `/proc/uptime` — places where many readers and one writer coexist. The Linux implementation is in `include/linux/seqlock.h` and is worth reading after you have written your own.

**Self-check.** Seqlocks have a torn-read problem if the data is more than one cache line and the reader does not retry. What memory ordering do you need on the sequence reads to make this work correctly? Why are seqlocks not appropriate for data that contains pointers the reader will dereference?

---

## Capstone

The Capstone tier asks you to apply everything from the previous three tiers to problems that have no single right answer. Each task takes a weekend to a week of focused effort and produces an artifact you can show in a senior-engineer interview: a benchmarked LRU cache, a refactored service, a static analyzer, or a transaction engine. The constraints on each capstone are deliberately tight — you cannot half-finish them and call it done; the design notes are as important as the code.

Treat the capstones as portfolio work. Write a real README. Capture profiles. Articulate the alternatives you considered. If you cannot explain in two paragraphs why your chosen design beats the obvious alternatives, you have not finished the task.

### Task 26: Thread-Safe LRU Under 5M QPS

**Problem.** Design and build an LRU cache that can sustain five million `get`/`put` operations per second on a single sixty-four-core machine. The cache holds one million entries. Hit ratio in production is roughly ninety percent. You will be evaluated on both throughput and the ninety-ninth percentile latency.

**What 'done' looks like.** A submission is "done" when: the cache is implemented in a single language of your choice (C++, Go, or Rust recommended); it includes a load generator that produces a Zipfian access pattern with the specified hit ratio; it passes a one-hour soak test under load without memory growth; it includes a profile showing where time is spent; and it includes a written design note (one to two pages) explaining the locking strategy, the choice of shard count, how the LRU recency list is maintained (per-shard or global), how eviction is triggered, and the tradeoffs you considered. A bonus is an analysis of how the design would change at fifty million QPS — the answer is "you stop using LRU and switch to a probabilistic algorithm like CLOCK-Pro or TinyLFU."

**Sample Solutions.**

*Solution A — Sharded LRU with per-shard mutex.* A reasonable baseline architecture is sixty-four shards, each containing a hash map and a doubly linked list, each guarded by its own mutex. A `get` hashes, takes the shard's lock, looks up the entry, moves it to the head of the list, and returns. A `put` does the same plus eviction if the shard is at capacity divided by sixty-four.

*Solution B — CLOCK approximation.* A second sample design replaces the linked list with a CLOCK approximation: each entry has a single reference bit, set on `get`, and a per-shard hand sweeps and clears the bit, evicting entries whose bit is already clear. CLOCK trades exact recency for one fewer pointer dereference per `get` and is the choice of Memcached and many production caches.

*Solution C — Segmented LRU.* A third sample design is segmented LRU (S-LRU): two LRU lists per shard, with promotion from "probationary" to "protected" on the second access. S-LRU resists scan flooding — a one-time pass over a million unrelated keys does not evict the genuinely hot ones.

*Solution D — Epoch-based reclamation.* A fourth design ditches the per-shard lock for the read path entirely and uses an epoch-based reclamation scheme; reads are fully wait-free, writes still take a per-shard lock. This is the design used by Caffeine in Java and `evmap` in Rust.

**Constraints.** Show measurements, not just code. Use `perf stat` or equivalent to report cycles per operation, cache misses, and branch misses. Report ninety-fifth, ninety-ninth, and ninety-ninth point nine percentile latencies.

**Hints.** A single global mutex will saturate at well under one million QPS on this workload. A sharded approach (sixty-four or one hundred twenty-eight shards) is the standard pattern. The recency list is the hard part because every `get` touches it; consider per-shard recency lists and tolerating slight global inaccuracy. Watch for false sharing between shard metadata structures.

**Self-check.** What is the maximum throughput a single-mutex implementation can achieve on your hardware? How close does your sharded version get to ideal linear scaling? Where does it depart from linear, and why? What would change in your design if the workload were instead "ten percent hits, ninety percent misses"?

---

### Task 27: Refactor a God Mutex Service to Fine-Grained Locks

**Problem.** You are given a Go service of roughly two thousand lines that has a single `sync.Mutex` protecting all of its state — users, sessions, billing, rate-limit counters. The mutex is held for the entire duration of every request handler. Refactor the service so each subsystem has its own mutex, and document the lock-ordering invariants you introduce.

**What 'done' looks like.** "Done" is when: each subsystem (users, sessions, billing, rate-limit) has its own mutex; no handler holds more than one mutex at a time except where the invariant explicitly allows it; the documented lock order is enforced by a runtime assertion in debug builds (see Task 17); all existing tests pass; the race detector is clean; a benchmark shows at least a three-times throughput improvement on a mixed workload of reads and writes; and the diff is broken into reviewable commits, each of which compiles and tests green.

**Sample Solutions.**

*Solution A — One mutex per struct field.* Too granular, hurts cache locality, and introduces more lock acquisitions than the throughput win is worth. Worth implementing once just to confirm the antipattern.

*Solution B — One mutex per subsystem.* Each subsystem exposes a small interface (`Users`, `Sessions`, `Billing`, `RateLimit`) and owns its mutex internally. Handlers compose subsystem calls; the only place lock order matters is the small set of cross-subsystem operations like "charge a user and decrement their session credits," which adopt the order `users.mu` then `billing.mu` and never the reverse.

*Solution C — Actor model.* No shared mutable state in handlers at all. Model the service as an actor where each subsystem is a goroutine that owns its state and exposes a channel-based API. This trades mutex contention for channel send-receive cost and is the choice of services where the maintenance burden of lock discipline outweighs the throughput hit.

**Constraints.** No behavior changes visible to clients. The refactor must be safe to roll out behind a feature flag. Each commit must be independently bisectable.

**Hints.** Start by drawing the data ownership graph. Look for read-mostly state that can move to an RWMutex. Look for state that is per-request and does not need a lock at all. The hardest cases are operations that touch multiple subsystems atomically — they need either a defined lock order or a transactional abstraction.

**Self-check.** What is the single most important invariant in your final design? If a new engineer joins the team, what is the one-page document that prevents them from re-introducing the god mutex?

---

### Task 28: A Lock-Ordering Linter for a Go Codebase

**Problem.** Build a small static analysis tool (a `go/analysis.Analyzer` plugin) that reads a Go codebase, identifies all `sync.Mutex` and `sync.RWMutex` fields, builds a graph of which mutex acquires which other mutex (across function calls), and reports any cycles as potential deadlocks.

**What 'done' looks like.** "Done" is when: the analyzer compiles as a `go vet` plugin and runs on the standard library without crashing; it correctly reports a cycle on a hand-crafted test input that locks A-then-B in one function and B-then-A in another; it ignores false positives where the order is the same; it has at least ten unit tests; and it is documented with a short README explaining the limitations (no support for interface method calls, no support for mutexes acquired via reflection, no analysis across package boundaries unless source is available).

**Sample Solutions.**

*Solution A — Instance-level SCC.* The simplest viable solution treats each mutex field as an "edge source" and each downstream mutex acquisition (within the same function or via a direct, non-interface call) as an "edge target," then runs Tarjan's strongly-connected-components on the resulting graph. Any SCC of size greater than one is a cycle to report.

*Solution B — Lock-class lifted analysis.* A more sophisticated solution lifts the analysis to lock classes rather than instances — two `sync.Mutex` fields of the same name in different shards of a sharded map should be treated as the same class for ordering purposes.

*Solution C — Path-sensitive SSA analysis.* The most thorough solution integrates with the SSA pass for the `ssa.Function.Blocks` to detect lock acquisitions inside conditionals and report only paths where the cycle is truly reachable.

Each of these sample solutions has well-known false-positive and false-negative profiles you should articulate in the README.

**Constraints.** Use `golang.org/x/tools/go/analysis` and the `ssa` package, not raw AST parsing. The tool should run in under five seconds on a one-hundred-thousand-line codebase.

**Hints.** This is essentially a "callgraph plus mutex acquisition states" analysis. Start with a single function, identify all `.Lock()` and `.Unlock()` calls, build a per-function acquisition trace, then chain them across calls.

**Self-check.** What patterns will your analyzer miss? List at least three. (Dynamic dispatch through interfaces, mutex acquisitions inside goroutines started by the analyzed function, mutexes acquired via reflection.)

---

### Task 29: Build a Two-Phase Locking Transaction Engine

**Problem.** Implement a small in-memory key-value store that supports multi-key transactions with strict two-phase locking (S2PL). Each transaction acquires locks on all keys it touches and holds them until commit. Detect deadlocks via wait-for-graph cycle detection and abort the youngest transaction in the cycle.

**What 'done' looks like.** "Done" is when: the store supports `BEGIN`, `GET`, `PUT`, `COMMIT`, `ABORT`; transactions are correctly serializable under a TPC-C-like workload of one hundred warehouses; the deadlock detector identifies and aborts cycles within fifty milliseconds; throughput is at least ten thousand transactions per second on a single machine; and a torture test of ten thousand concurrent transactions causes no data corruption, no permanent deadlocks, and no leaked locks.

**Sample Solutions.**

*Solution A — Wait-for-graph cycle detection.* A baseline design uses a hash map of "lock entries," each containing a list of holders, a list of waiters, and a per-entry mutex. A transaction calls `lock(key, mode)` which either grants immediately or adds the transaction to the waiter list and blocks on a per-transaction condition variable. Deadlock detection runs on a separate goroutine every fifty milliseconds, walks the global wait-for graph (built from the waiter lists), runs DFS to find cycles, and signals the youngest victim's condition variable with an abort flag.

*Solution B — WAIT-DIE policy.* A second design replaces the periodic detector with a `WAIT-DIE` policy: when transaction T1 tries to acquire a lock held by T2, if T1 is older, it waits; if T1 is younger, it dies. WAIT-DIE prevents deadlock without explicit detection but causes more aborts under contention.

*Solution C — WOUND-WAIT policy.* A third design adopts WOUND-WAIT (the older transaction aborts the younger holder). It tends to abort fewer transactions than WAIT-DIE because the holder is typically further along.

Each scheme has different abort-rate and starvation properties under skewed workloads — write up which you chose and why.

**Constraints.** Implement shared (read) and exclusive (write) locks. Lock upgrade from shared to exclusive must be supported and must not deadlock if only one transaction is upgrading.

**Hints.** Strict 2PL is the textbook foundation of every relational database's transaction manager. The wait-for graph is constructed lazily on suspicion of deadlock — running cycle detection on every wait would be too expensive.

**Self-check.** Why is "abort the youngest" the conventional choice for deadlock victim selection? What are the alternatives, and what do they trade off?

---

### Task 30: Distributed Mutex via Redis or etcd

**Problem.** Build a distributed mutex usable from many processes across a network. Implement two backends: Redis with the Redlock algorithm and etcd with leases. The API on the client side is `Acquire(key, ttl) (release func(), err error)`. Provide a small demo of two processes competing for the same lock.

**What 'done' looks like.** "Done" is when: both backends pass a torture test where one hundred competing processes attempt to acquire the same lock and exactly one succeeds at a time; the lock is released automatically if the holder crashes (via TTL on Redis, lease expiry on etcd); the implementation includes a `Refresh` hook for long critical sections; the README documents the well-known failure modes of Redlock (Martin Kleppmann's critique) and how etcd's lease mechanism sidesteps them by providing a single authoritative source of truth; and a load test demonstrates the lock granting at least one thousand acquisitions per second per backend.

**Sample Solutions.**

*Solution A — Redlock on Redis.* The Redlock approach acquires a key on a majority of N independent Redis instances with `SET key value NX PX ttl`; the value is a random token unique per acquisition. Release is a Lua script that checks the token before deleting (otherwise a delayed release from a previous holder could delete a successor's lock).

*Solution B — etcd lease + transactional put.* The etcd approach creates a lease, then attempts to put a key with that lease and a `CreateRevision == 0` predicate, then watches for the key to be deleted. If the holder process dies, the lease expires and the key is removed automatically.

*Solution C — ZooKeeper ephemeral sequential.* Create an ephemeral sequential znode, then check whether your znode has the lowest sequence; if so, you hold the lock, otherwise watch the next-lower sequence. This is the recipe in the ZooKeeper documentation.

Each approach has different failure semantics, particularly around partition tolerance — articulate which one you would deploy and why.

**Constraints.** Network partitions must not result in two holders. The implementation must handle clock skew within reasonable bounds. The release call must be idempotent.

**Hints.** Read Martin Kleppmann's "How to do distributed locking" and Salvatore Sanfilippo's response before you write any code. The argument is subtle and informs design choices. The fundamental tension is between safety (no two holders) and liveness (always one holder when contended).

**Self-check.** Under what failure scenario does Redlock grant the same lock to two clients? Under what scenario does etcd? Which is more likely in practice, and how would your application handle it?

---

If you can do all of these, you have the mutex foundation that a strong senior engineer would expect.

## Related Topics

- [Mutex — Specification](specification.md)
- [Mutex — Junior](junior.md)
- [Mutex — Middle](middle.md)
- [Mutex — Senior](senior.md)
- [Mutex — Professional](professional.md)
- [Mutex — Optimize](optimize.md)
- [Mutex — Find the Bug](find-bug.md)
- [Mutex — Interview](interview.md)
- [Semaphore](../02-semaphore/README.md)
- [Condition Variable](../03-condition-variable/README.md)
- [Read-Write Lock](../04-rwlock/README.md)
- [Spinlock](../05-spinlock/README.md)
- [Atomic Operations](../../03-atomics/README.md)
- [Memory Model](../../04-memory-model/README.md)
- [Deadlock Detection](../../05-deadlock/README.md)
