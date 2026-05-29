# Mutex — Interview Questions

> **Topic:** [Mutex](README.md)

---

## Introduction

This document collects interview questions about mutexes that range from
warm-up conceptual probes to deep systems-design and coding rounds. The goal is
not to memorize answers, but to build a mental model strong enough to reason
about any new mutex question on the spot.

A mutex looks trivial from the outside (one bit of state, two operations) yet
sits at the heart of every concurrent program. Interviewers know this. They
will probe your understanding of the kernel-user boundary, the memory model,
fairness, contention behavior, and the subtle UB hiding behind innocent
patterns like "I just forgot to unlock on one branch." Senior interviews push
into design territory: sharded locks, hand-over-hand traversal, lock-free
alternatives, and the trade-offs between blocking and spinning.

Use this file as a practice deck. Read the question, answer it out loud, then
read the model answer. For coding questions, write the code on paper or a
plain editor before looking at the solution. For tricky questions, force
yourself to articulate *why* the naive reasoning is wrong.

---

## Table of Contents

1. [Conceptual / Foundational](#conceptual--foundational)
2. [Language-Specific](#language-specific)
   - [C / C++](#c--c)
   - [Go](#go)
   - [Java](#java)
   - [Python](#python)
   - [Rust](#rust)
3. [Tricky / Trap](#tricky--trap)
4. [System / Design Scenarios](#system--design-scenarios)
5. [Coding Questions](#coding-questions)
6. [Behavioral](#behavioral)
7. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
8. [Cheat Sheet](#cheat-sheet)
9. [Further Reading](#further-reading)
10. [Related Topics](#related-topics)

---

## Conceptual / Foundational

### Q: What is a mutex and what problem does it solve?

A mutex (mutual exclusion lock) is a synchronization primitive that guarantees
at most one thread can hold the lock at any moment. It solves the problem of
data races on shared mutable state: when two threads read-modify-write the
same memory without coordination, the result is undefined. A mutex serializes
the conflicting accesses, turning concurrent operations into a sequence of
critical sections. Conceptually it is a one-slot semaphore plus ownership
tracking, but most real implementations are tuned much further than that
suggests — they batch wakeups, spin briefly before sleeping, and integrate
with the kernel scheduler through a futex.

### Q: Walk through what `lock()` and `unlock()` actually do under the hood.

`lock()` attempts an atomic compare-and-swap (CAS) on a state word from
`unlocked` to `locked`. On success you hold the lock — that is the fast path,
which is uncontended and typically takes a single atomic instruction.
On failure, the thread either spins for a short period (hoping the holder
releases soon) or escalates to a kernel wait via a futex/`WaitOnAddress`-style
call. `unlock()` stores `unlocked` back to the state word and, if any waiters
are recorded, wakes one (or all). The release also publishes a memory barrier
so writes inside the critical section become visible to the next acquirer.

### Q: What is a critical section and what are the rules for one?

A critical section is the code between `lock` and `unlock` that touches the
shared state. Rules: keep it short, do not call unbounded I/O inside it, do
not call user-supplied callbacks (they may try to re-lock or call into your
API recursively), do not acquire other locks in unpredictable orders, and
make sure every exit path — return, exception, panic — releases the lock.
Violating any of these turns a correctness primitive into a latency,
deadlock, or UB hazard.

### Q: Why is unlocking a mutex twice undefined behavior?

Mutex state is a small state machine: unlocked → locked → unlocked. A second
unlock from the same thread (or any thread) transitions an already-unlocked
mutex, which most implementations do not check for performance reasons. Worse,
if another thread has since acquired the lock, the spurious unlock corrupts
its state — it may wake waiters who then race the legitimate owner, or
release a futex word it never owned. Some debug builds catch this with an
assertion; release builds happily corrupt state and crash much later in
unrelated code.

### Q: What is an RAII guard and why is it the recommended pattern?

An RAII guard is an object whose constructor acquires a lock and whose
destructor releases it. The lock lifetime is tied to scope, so every exit
path — normal return, early return, exception, panic — runs the destructor
and releases the lock. This eliminates an entire class of bugs where a
programmer forgets to unlock on one branch. C++ uses `std::lock_guard` and
`std::unique_lock`; Rust returns a `MutexGuard` from `lock()`; Go uses
`defer mu.Unlock()` as the idiomatic equivalent. Anywhere RAII is unavailable,
you must hand-audit every control-flow path through the critical section.

### Q: What is a reentrant (recursive) mutex and when do you want one?

A reentrant mutex allows the thread that already holds the lock to acquire
it again without deadlocking; it maintains a counter and only truly releases
on the matching number of unlocks. You want one when calling into code that
may legitimately re-enter the locked region — for example, a class method
that calls another public method of the same class. However, the broader
software-engineering view is that needing recursion usually signals an
unclear locking contract: who owns what, and for how long. Most well-designed
systems avoid recursive locks and refactor the code so the locked function
does not call the locking function.

### Q: How does a spinlock differ from a mutex, and when do you choose each?

A spinlock burns CPU in a tight loop checking the lock state until it
becomes free; a mutex eventually puts the waiter to sleep in the kernel.
Spinlocks win when the critical section is extremely short (a few
instructions) and contention is moderate — you avoid a kernel transition,
which costs hundreds of nanoseconds. Mutexes win when critical sections are
long or contention is high — sleeping waiters let other work run on the
CPU. Most modern mutexes are *adaptive*: they spin briefly first, then fall
back to sleeping. Pure user-mode spinlocks are dangerous in preemptive
systems because the holder can be descheduled while spinners burn cores.

### Q: What is the difference between a mutex and a semaphore?

A mutex enforces exclusive access — one holder — and has the concept of
ownership: the thread that locked must unlock. A counting semaphore tracks
*N* permits and any thread can `wait` (acquire) or `signal` (release); it has
no notion of owner. A binary semaphore looks like a mutex but lacks
ownership, so it can be used for cross-thread signaling (one thread waits,
another posts). Mixing them up is a classic bug: a "mutex" with no ownership
is just a binary semaphore, which means recursive acquire, unlock-from-other-
thread, and priority-inheritance behavior all change.

### Q: What does fair vs unfair mutex mean?

A fair mutex grants the lock in FIFO order of arrival: the longest waiter
acquires next. An unfair (or *barging*) mutex lets newly arriving threads
grab the lock ahead of waiters that were already sleeping. Unfair mutexes
have higher throughput because they minimize cache misses and avoid waking
threads only to make them wait again, but they can starve unlucky waiters.
Java's `ReentrantLock` exposes both modes; Go's `sync.Mutex` is unfair in the
fast path but has a *starvation mode* that activates after a waiter has waited
more than 1ms, switching to FIFO until throughput recovers. Pure FIFO is
rarely the right default in user code.

### Q: What is priority inversion and how do mutexes mitigate it?

Priority inversion happens when a low-priority thread holds a lock that a
high-priority thread needs, while a medium-priority thread runs and prevents
the low-priority holder from finishing. The high-priority thread is blocked
indirectly by the medium one. Real-time systems mitigate this with priority
inheritance (the holder temporarily inherits the highest waiter's priority)
or priority ceiling (the lock has a static high priority and any acquirer
inherits it). The classic Mars Pathfinder incident was a priority inversion
on a pipe mutex; the fix was enabling priority inheritance on that mutex.

### Q: What is a futex and how does it relate to mutexes?

A futex (fast userspace mutex) is a Linux kernel primitive that lets userspace
implement locks with no syscall on the fast path. Userspace performs the
atomic CAS itself; only if it fails does it call `futex(WAIT)` to sleep on
the address, and the releaser calls `futex(WAKE)` to wake sleepers. The
mutex algorithm lives entirely in libc/userspace, with the kernel only
handling the slow path. Windows has `WaitOnAddress`/`WakeByAddressSingle`,
macOS has `__ulock_wait`/`__ulock_wake`. Without futexes, every lock
acquisition would syscall, costing hundreds of nanoseconds even uncontended.

### Q: What is lock convoy and how does it form?

A lock convoy happens when many threads pile up on the same mutex, and the
order in which they wake and rerun keeps recreating the convoy: the waker
runs briefly, releases, the next waiter wakes after a context switch,
arrives at the lock when others have already piled on again. Throughput
collapses because the CPU spends its time in context switches and cache
warm-up rather than actual work. Symptoms: low CPU utilization on a hot
path, high context-switch counts, and queue length growing on one lock.
Fixes include sharding the lock, reducing critical-section length,
switching to lock-free structures, or using adaptive/unfair locks that
avoid waking waiters unnecessarily.

### Q: What happens if you call `unlock()` from a thread that does not hold the lock?

For POSIX `pthread_mutex_t` of type `NORMAL` it is undefined behavior;
`ERRORCHECK` returns `EPERM`; `RECURSIVE` returns `EPERM`. For Go
`sync.Mutex` it panics with `sync: unlock of unlocked mutex` if the mutex
is actually unlocked, but if another thread happens to hold it, the
unlock incorrectly releases the other thread's critical section. For
Java `ReentrantLock` it throws `IllegalMonitorStateException`. For Rust
`std::sync::Mutex` you cannot do it — `unlock` is the destructor of the
returned guard, which only the locking thread holds. The lesson: ownership
is a property of the lock contract, and the compiler enforces it only in
languages with linear/affine types.

### Q: Explain the memory-model contribution of mutex acquire and release.

`lock()` performs an *acquire* operation: subsequent reads and writes in
program order cannot be reordered before it. `unlock()` performs a *release*:
prior reads and writes cannot be reordered after it. Together they establish
happens-before: everything before `unlock` in thread A is visible to
everything after the matching `lock` in thread B. This is why a mutex
"publishes" your writes — without those barriers, another thread could
acquire the lock and still read stale values from its own CPU cache.

### Q: What is the cost of an uncontended vs contended mutex acquisition?

Uncontended: typically 10-30 nanoseconds — one atomic CAS, one branch, no
syscall. Contended without kernel sleep (brief spin succeeds): 50-500
nanoseconds depending on cache state and adaptive-spin tuning. Contended
with kernel sleep: 1-10 microseconds for the futex wait/wake plus
scheduling latency, sometimes more under load. The takeaway: a hot mutex
moves your performance regime from "memory speed" to "scheduler speed,"
which is roughly 100x slower. This is why you measure contention before
optimizing.

---

## Language-Specific

### C / C++

### Q: What is the difference between `pthread_mutex_t` default initialization, `PTHREAD_MUTEX_INITIALIZER`, and `pthread_mutex_init`?

`PTHREAD_MUTEX_INITIALIZER` is a static initializer for file-scope or
zero-attribute mutexes — equivalent to default `pthread_mutex_init(m, NULL)`.
Dynamic initialization via `pthread_mutex_init` lets you pass attributes
selecting the mutex type (`NORMAL`, `ERRORCHECK`, `RECURSIVE`),
process-shared flag, robustness, and protocol (`PRIO_INHERIT`,
`PRIO_PROTECT`). Forgetting to call `init` on a heap-allocated mutex (and
not using the static initializer) leaves it in an undefined state — first
`lock` is UB. Always pair `init` with `destroy` on dynamic mutexes.

### Q: When should you use `std::lock_guard` vs `std::unique_lock` vs `std::scoped_lock`?

`std::lock_guard<M>` is the simplest RAII wrapper: acquire on construction,
release on destruction; cannot be moved or unlocked early. Use it for plain
critical sections. `std::unique_lock<M>` is movable, can defer locking,
adopt an already-locked mutex, and unlock/relock during its lifetime — needed
when working with `std::condition_variable`. `std::scoped_lock<M1, M2, ...>`
locks multiple mutexes deadlock-free using the same algorithm as
`std::lock`; use it whenever you need two or more locks in one critical
section.

### Q: What does `std::shared_mutex` give you and what are its trade-offs?

`std::shared_mutex` supports two modes: exclusive (`lock`/`unlock`) for
writers and shared (`lock_shared`/`unlock_shared`) for readers. Many readers
can hold it concurrently; a writer excludes everyone. Use it when reads
vastly outnumber writes and each read does significant work (parsing,
copying, walking a structure). Trade-offs: the implementation has more
internal state and atomic operations than a plain mutex, so for short
read-only critical sections it can be *slower* than `std::mutex`. Also,
default policy may starve writers under sustained read load.

### Q: What happens if a C++ destructor runs while a mutex is locked?

If the destructor is the `lock_guard` destructor, the mutex is released
normally. If it is the destructor of the mutex *itself* while still locked,
the behavior is undefined — `std::mutex::~mutex()` requires the mutex be
unlocked. This typically happens when a containing object is destroyed while
another thread still holds the lock; the bug shows up as crashes, deadlocks,
or memory corruption far from the actual misuse. Always ensure the lifetime
of the mutex outlives every thread that might touch it.

### Q: Why is `pthread_mutex_t` not safe to copy?

It contains kernel-tracked state (futex word, owner TID on robust mutexes,
internal lists) that is referred to by address. Copying the bytes produces
two independent mutex objects that share none of that state but that
identical-looking debuggers can confuse for one. Most usefully, after copy,
the new mutex is in an unspecified state — even initialization may not have
been propagated. The same rule applies to `std::mutex`, which is explicitly
non-copyable and non-movable.

### Q: How do you implement try-acquire with timeout in C++?

`std::timed_mutex` and `std::recursive_timed_mutex` support
`try_lock_for(duration)` and `try_lock_until(time_point)`. They return `true`
on success, `false` on timeout. With a plain `std::mutex` you only have
`try_lock` (no waiting) and `lock` (wait forever). When you need a timeout
and only have a plain mutex, you typically wrap it in a condition variable
pattern or switch to `std::timed_mutex`. POSIX equivalents are
`pthread_mutex_timedlock` (with `CLOCK_REALTIME` by default — beware clock
jumps) and `pthread_mutex_clocklock` (POSIX 2017, lets you pick `MONOTONIC`).

### Go

### Q: How does `sync.Mutex` differ from a typical pthread mutex internally?

Go's `sync.Mutex` is a 8-byte struct with `state` (int32) and `sema`
(uint32). The fast path is a single atomic CAS on `state`. Contended waiters
park on a runtime semaphore tied to `sema`. It is unfair by default: a
newly arriving goroutine may steal the lock from a waiter. After a waiter
has waited more than 1 millisecond, the mutex enters *starvation mode*,
which is FIFO; once the waiter queue empties or a wait completes quickly,
it returns to normal mode. There is no recursive acquisition — locking
twice from the same goroutine deadlocks.

### Q: What is the idiom for ensuring `Unlock` runs on every path in Go?

`defer mu.Unlock()` immediately after `mu.Lock()`. The defer runs on
function exit regardless of which return, panic, or runtime error
terminates the function. The trap is using `defer` deep in a long function
where the lock is held longer than necessary, or forgetting `defer` and
manually unlocking on each return — the latter is fragile because adding
a new early return without unlocking introduces a leak. For very short
critical sections in hot paths, manual unlock can be measurably faster than
defer (the runtime overhead has shrunk substantially in recent Go versions,
but it is still nonzero).

### Q: When should you use `sync.RWMutex` instead of `sync.Mutex`?

When reads vastly outnumber writes *and* each read holds the lock for long
enough to amortize the higher acquisition cost. `sync.RWMutex` has more
atomic ops on its slow path, so for trivial critical sections (a few
field loads) `sync.Mutex` is faster even under heavy read concurrency.
Benchmark before switching. Also note: `sync.RWMutex` does not promote
read locks to write locks — you must release the read lock first, which
opens a race window unless you redesign the access pattern.

### Q: What happens if you pass a struct containing `sync.Mutex` by value?

The mutex is copied. The copy is a fresh, independent mutex with its own
state — so two goroutines may end up locking different mutexes thinking they
are protecting the same data. Worse, copying a *locked* mutex produces a
copy that is permanently locked (no one will ever unlock the copy).
`go vet` catches obvious cases via the `copylocks` analyzer. The rule is:
once a struct contains a `sync.Mutex`, pass it by pointer everywhere, and
make the field unexported so callers cannot accidentally copy through
embedding.

### Q: Can you acquire `sync.Mutex` recursively from the same goroutine?

No. `sync.Mutex` is not reentrant — a second `Lock()` from the goroutine
that already holds it will deadlock. Go made this deliberate choice: the
runtime cannot cheaply identify the calling goroutine (no first-class
goroutine ID exposed to user code), and the Go team views recursive locks
as a code-smell that hides unclear ownership. If you need reentrancy,
restructure: split the locked function into a public method that locks and
a private method that assumes the lock is held.

### Q: How does `sync.Mutex` interact with `runtime.Gosched` and goroutine parking?

When a goroutine cannot acquire the lock on the fast path, it enters the
slow path: it spins for a few iterations using `runtime_canSpin`, then
parks via `runtime_SemacquireMutex`. Parking is cooperative — the goroutine
is removed from the run queue and the M (OS thread) is freed to run other
work. On `Unlock`, the runtime calls `runtime_Semrelease` to wake one
waiter. Because the runtime schedules goroutines, lock convoys in Go often
look like high goroutine counts in the `semacquire` state in `pprof`.

### Java

### Q: What is the difference between `synchronized` and `ReentrantLock`?

`synchronized` is a language keyword that uses the JVM's *monitor* per
object — it is reentrant, releases automatically on scope exit (including
exception), and the JIT can optimize it (lock elision, biased locking on
older JVMs, lock coarsening). `ReentrantLock` is a library class that
exposes more features: optional fairness, interruptible acquisition,
`tryLock` with timeout, multiple `Condition` objects per lock, and
non-block-structured locking (lock in one method, unlock in another).
The trade-off is that `ReentrantLock` requires manual `try/finally` to
release; forgetting causes lock leaks.

### Q: When would you use `ReentrantReadWriteLock` over `ReentrantLock`?

When you have a read-heavy workload where reads do nontrivial work and
writers are rare. `ReentrantReadWriteLock` permits many concurrent readers
or one exclusive writer. It supports both fair and unfair modes and
downgrading (write lock → read lock) but not upgrading (read → write
would deadlock). Trade-off: the implementation is more complex than
`ReentrantLock`, so short read sections often run faster on the simpler
lock. For most workloads `StampedLock` (optimistic read mode) outperforms
`ReentrantReadWriteLock`.

### Q: What does `StampedLock` add over `ReentrantReadWriteLock`?

`StampedLock` provides three modes: write, read, and *optimistic read*.
The optimistic read returns a stamp without actually acquiring anything;
the reader does its work and then validates the stamp — if no writer
intervened, the work is valid; otherwise, it falls back to acquiring a
real read lock and retrying. For low-contention reads, this is dramatically
faster than `ReentrantReadWriteLock`. Caveats: `StampedLock` is not
reentrant, not `Condition`-aware, and you must remember to validate
stamps and avoid reading inconsistent state during the optimistic phase.

### Q: How does biased locking work and why was it deprecated?

Biased locking was an optimization where a `synchronized` block was
"biased" to the first thread that acquired it; subsequent acquisitions
by the same thread required no CAS — just a quick header check. It
helped single-threaded code that used `synchronized` defensively (e.g.
`StringBuffer`, `Hashtable`). Modern JVMs deprecated and removed it
(JEP 374) because most code now uses concurrent collections that avoid
`synchronized`, and the bookkeeping cost of revoking bias under
contention often dominated the savings.

### Q: What is `IllegalMonitorStateException` and what causes it?

Thrown when you call `wait`, `notify`, or `notifyAll` on an object whose
monitor you do not own, or when you call `ReentrantLock.unlock()` on a
lock you do not hold. The typical cause is forgetting that `wait` must be
called inside a `synchronized` block on the same object; another is
calling `unlock` from a different thread than the one that locked.
Always pair `lock` and `unlock` in the same `try/finally` block.

### Python

### Q: What is the difference between `threading.Lock` and `threading.RLock`?

`Lock` is non-reentrant: the thread that holds it cannot acquire it again
without deadlocking (it does not track owner, so technically any thread
can release it). `RLock` (reentrant lock) tracks owner and a recursion
count: the holding thread may acquire it any number of times and must
release it the same number of times. `RLock` is slower because of the
bookkeeping, so prefer `Lock` unless you have a real need for reentrancy.

### Q: Does the GIL make Python locks unnecessary?

No. The GIL ensures only one thread executes Python bytecode at a time,
but a single Python operation may not be atomic — for example,
`counter += 1` decomposes into load, add, store, and the interpreter can
release the GIL between bytecodes (modulo specifics of newer Pythons
with per-interpreter GIL or free-threaded mode). For any read-modify-write
or compound invariant across multiple objects, you still need a `Lock` or
`RLock`. Some single-bytecode operations on built-in types are atomic
(e.g. `dict.setdefault`, `list.append`) but relying on those couples your
code to implementation details.

### Q: What is the cost of acquiring a `threading.Lock` in CPython?

CPython's lock is implemented over `pthread_mutex_t` (Linux/macOS) or a
Windows critical section. An uncontended acquire is hundreds of
nanoseconds — slower than C because of the interpreter overhead around
the call. Under contention, the cost is dominated by the GIL: releasing
the lock requires giving up and reacquiring the GIL on the waiting
thread's wake-up, which costs microseconds. For a hot critical section
this can dominate, which is part of why CPU-bound multi-threading in
Python rarely scales.

### Q: How does `asyncio.Lock` differ from `threading.Lock`?

`asyncio.Lock` is for coroutines, not threads. Its `acquire` is a
coroutine that awaits when the lock is held; releasing wakes one waiter
via the event loop. It assumes a single thread runs the loop, so it does
not use OS-level synchronization. Calling `threading.Lock.acquire()` on
the event-loop thread blocks the entire loop, which is almost always
wrong in an asyncio program. The two locks are not interchangeable.

### Q: What is the recommended way to ensure release in Python?

Use the context manager: `with lock: ...`. The `__exit__` runs on any
exit — normal, exception, generator close — so the lock is always
released. Avoid the bare pattern `lock.acquire(); try: ... finally:
lock.release()` because it is noisier and easy to break when adding
new code paths. The same rule applies to `RLock`, `Semaphore`,
`Condition`, and `asyncio.Lock` (with `async with`).

### Rust

### Q: How does `std::sync::Mutex<T>` differ from a C++ `std::mutex`?

Rust's `Mutex<T>` wraps the protected data inside the lock itself.
`lock()` returns a `MutexGuard<T>` that derefs to `&mut T`; releasing the
lock happens via the guard's `Drop`. There is no way to access the
protected data without acquiring the lock, and no way to forget to
release. Rust also tracks poisoning: if a thread panics while holding the
mutex, subsequent `lock()` calls return `Err(PoisonError)`, signaling
that invariants may be broken.

### Q: What is mutex poisoning and how do you handle it?

Poisoning is Rust's safety net for panics inside critical sections.
When a thread panics while holding a `Mutex` or `RwLock`, the lock
becomes *poisoned*: future `lock()` calls return
`Err(PoisonError<MutexGuard<T>>)`. You can choose to bail out, propagate
the panic, or recover the data via `err.into_inner()` if you can prove
the invariants are still valid. Many crates (`parking_lot`) skip
poisoning for performance and simplicity. Use poisoning when invariants
could realistically be left broken by a panic mid-critical-section.

### Q: When should you use `parking_lot::Mutex` instead of `std::sync::Mutex`?

`parking_lot::Mutex` is smaller (one byte vs the OS-dependent size of
`std`), faster on the uncontended fast path, has adaptive spinning, and
supports both fair and unfair modes. It does not poison. Use it when you
need maximum performance, particularly in hot paths or many short-lived
locks. `std::sync::Mutex` has caught up significantly in recent Rust
versions on Linux (using futex directly), but `parking_lot` is often
still measurably faster.

### Q: How do `Mutex<T>` and `RwLock<T>` interact with `Send` and `Sync`?

`Mutex<T>` is `Sync` if and only if `T: Send`. The lock provides exclusive
access through a `MutexGuard`, so even non-`Sync` types can be shared
across threads when wrapped in a `Mutex`. `RwLock<T>` requires `T: Send +
Sync` because read guards expose `&T` to multiple threads concurrently.
This is one of the clearest examples of how Rust's type system encodes
synchronization rules — you cannot write a data race that compiles
(within safe code) when using these primitives correctly.

### Q: What is the difference between `Arc<Mutex<T>>` and `Mutex<Arc<T>>`?

`Arc<Mutex<T>>` is the common pattern: shared ownership of a single mutex
protecting shared data. Each thread holds an `Arc` clone; `lock()` gives
exclusive access to the data. `Mutex<Arc<T>>` is rarer: each thread has
its own mutex around its own `Arc`, sharing only the underlying data —
useful when you want to swap the inner `Arc` atomically (the protected
state is an immutable snapshot, and updates create a new `Arc`).

### Q: How do you implement try-lock with timeout in Rust?

`std::sync::Mutex` only exposes `lock` (blocking) and `try_lock` (no
wait). For a timeout you typically use `parking_lot::Mutex::try_lock_for`
or `tokio::sync::Mutex` with `timeout`. Implementing it yourself requires
a condition variable around your own state word, which is rarely worth
the effort. The interview signal here: do not roll your own timed lock
on a hot path — reach for a library that already supports it.

---

## Tricky / Trap

### Q: A function locks a mutex, does some work, then returns early on an error. Is this safe?

It depends on the language and pattern. In Rust with `MutexGuard`, yes —
`Drop` unlocks on every exit. In C++ with `std::lock_guard`, yes. In Go
with `defer mu.Unlock()`, yes. In Go *without* defer, no — the early
return leaks the lock. In Java with `synchronized`, yes; with
`ReentrantLock` only if you used `try/finally`. The trap is mixing styles:
`Lock(); doWork(); if err return err; Unlock()` is the classic
forgotten-unlock bug. The naive "it returned an error, no harm done" is
wrong because the lock stays held forever, eventually deadlocking later
acquirers.

### Q: Two functions each acquire mutex A and mutex B, but in different order. What happens?

Classic deadlock. Thread 1 in function f locks A then waits for B;
thread 2 in function g locks B then waits for A. Both wait forever.
The naive reaction — "just be careful" — does not scale. The standard
fix is a global lock-ordering policy: every code path that needs both
locks must acquire them in the same order (say, by address, by name,
by some derived rank). C++ `std::lock(a, b)` and `std::scoped_lock`
do this for you via an internal try-and-back-off algorithm. The
deeper fix is often to redesign so the two locks become one or to
isolate state so two locks are never needed at once.

### Q: You forgot `defer mu.Unlock()` after an `if err return` branch. What is the impact?

The lock stays held until the goroutine exits — which may be never if
it is a long-lived worker. Every subsequent caller of any function that
takes this mutex blocks forever. The symptom is often a sudden
production hang where one error case triggered the leak; the goroutines
pile up in `semacquire` state. Diagnosis: `pprof` goroutine dump shows
many goroutines stuck on the same `runtime_SemacquireMutex` call.
Prevention: always `defer mu.Unlock()` immediately after `mu.Lock()`,
or use `go vet` plus reviewer discipline. The naive belief "we'll catch
it in tests" usually fails because the bug only fires on the rare error
path.

### Q: Why does `sync.RWMutex` sometimes perform worse than `sync.Mutex` with many short reads?

Because RWMutex has to maintain reader counts (an atomic add on
acquire, atomic subtract on release, plus more atomic ops to handle
writer arrival). Each operation invalidates cache lines on other cores.
With dozens of CPUs hammering the same RWMutex on a short read, the
atomic operations themselves bottleneck — the cache line carrying the
counters bounces between cores. A plain `sync.Mutex` is a single CAS
that produces the same cache-line bouncing but with less work per
acquisition. For very short critical sections (sub-microsecond), the
mutex wins. The naive reasoning "many readers should scale" misses
that the synchronization primitive itself is the bottleneck.

### Q: You put a `sync.Mutex` in a struct passed by value to a function. What breaks?

The function operates on a copy of the mutex, separate from the original.
Any locking inside the function locks the copy; the original is
unaffected. If multiple goroutines call the function with copies of the
same struct, each sees its own mutex — no exclusion across copies. If
the struct was already locked at the time of the copy, the copy is
permanently locked. Detection: `go vet` flags this as `copylocks`.
The naive intuition "a mutex is just a field, copying should work" misses
that mutex state is identity-based, not value-based.

### Q: How do you detect a lock convoy in production?

Look for: low CPU utilization on a hot path despite high request rate,
high `voluntary_ctxt_switches` per second on worker threads, growing
queue length in front of one specific lock, and `pprof` showing many
goroutines/threads stuck in lock-wait state. Linux `perf sched` or
`bpftrace` scripts on `futex` syscalls can identify which lock is
convoying. Once you have the lock, the fixes are: shorten the critical
section, shard the lock across multiple instances, replace with
lock-free data structure, or switch to an unfair adaptive lock if
fairness is creating the convoy.

### Q: Is `mu.Lock(); defer mu.Unlock()` followed by a goroutine call inside the critical section safe?

Sort of, but watch the lock scope. The lock is held until the *enclosing*
function returns, not until the goroutine completes. The goroutine runs
asynchronously and may acquire the same lock — which deadlocks if the
mutex is non-reentrant. The naive reading "I started a goroutine, it
will do its own locking" works only if the spawn is at the end of the
critical section, or if the spawned goroutine does not need this lock.
Otherwise refactor to release the lock before spawning or pass an
immutable snapshot into the goroutine.

### Q: A reader thread holds an RWMutex read lock and then tries to acquire the write lock to "upgrade". What happens?

Deadlock. Every standard RWMutex (Go, Java, Rust) forbids lock upgrade:
the writer would need exclusive access, but the upgrading reader
already counts as a reader. If you release the read lock first and
then acquire the write lock, another writer can intervene, and the
state you read may be stale by the time you write. The correct pattern
is: acquire write lock, recheck state, then write. Or use `StampedLock`
in Java which supports `tryConvertToWriteLock`. The naive
"locks are nested, upgrade should work" is wrong.

### Q: You wrap a public API with `mu.Lock()` and one of the methods calls another public method. What happens?

If the mutex is non-reentrant, you deadlock as soon as method A (holds
the lock) calls method B (tries to acquire it). If reentrant, the call
succeeds but the lock is held longer than intended, and the inner
method runs under the outer one's lock — which may break invariants the
caller expects to hold only across the inner call. The right fix is
usually to split each public method into a thin public wrapper that
locks and a private worker that assumes the lock is held; the worker
calls other workers, never wrappers. The naive "use a recursive mutex"
hides the design problem.

### Q: A user reports the program freezes randomly. `top` shows zero CPU. What is the most likely mutex bug?

Deadlock: two or more threads each hold a lock that another needs,
or one thread tries to acquire a lock it already holds in a
non-reentrant mutex. The all-zero-CPU signature distinguishes deadlock
from livelock (where threads spin doing no useful work). Diagnose with
a stack dump (`jstack`, `gdb thread apply all bt`, `pprof` goroutine
dump): look for two or more threads in lock-wait state on different
locks held by each other. The naive guess "an infinite loop" predicts
high CPU; deadlock predicts zero.

### Q: Why is acquiring a mutex inside a signal handler dangerous?

Signal handlers run on whichever thread receives the signal, possibly
preempting code that already holds the mutex. If the handler tries to
acquire it, you deadlock the thread against itself (non-reentrant) or
corrupt state (reentrant but the interrupted critical section is now
half-done). POSIX explicitly says only async-signal-safe functions may
be called from a signal handler, and `pthread_mutex_lock` is not on
that list. The standard workaround is `self-pipe` or `signalfd` — the
handler writes a byte; the main loop reads and acquires the lock
normally.

### Q: Is it safe to call `pthread_mutex_destroy` on a locked mutex?

No. POSIX says results are undefined. The mutex may be in the middle of
a futex wait or have waiters parked on it; destroying it tears down
state another thread is using. The destroy should happen after every
thread has stopped using it, which often means joining the threads
first. In Rust this is enforced by the type system (you cannot drop a
`Mutex` while a `MutexGuard` exists); in C/C++ it is the programmer's
responsibility. The naive "I'm shutting down, doesn't matter" wrong
because the shutdown path is often where this bug hides until it
crashes occasionally.

### Q: Two threads each call `mu.Lock()` and one of them is GC'd while holding the lock (in a managed language). What happens?

The lock is leaked — no one will ever call `Unlock` on it. In Java
and Go this typically means leaked goroutines/threads waiting forever
on `mu`; the holder, being GC'd, is also gone. In Rust this cannot
happen for `MutexGuard` because the guard drops when the holder is
dropped, which releases the lock. The naive expectation "GC will
release the lock" is false: the runtime does not know to call
`Unlock` on objects holding owned locks.

### Q: A condition variable wait is followed by `mu.Lock()`. Is that correct?

No. `cond.Wait()` atomically unlocks the mutex and parks the thread; on
wake-up, it re-acquires the mutex before returning. So the mutex must
already be held when you call `Wait`, and it is held again when `Wait`
returns. Calling `mu.Lock()` after `Wait` deadlocks the thread against
itself. The naive intuition "I need to re-lock after waiting" misses
that `Wait` already does it. Always recheck the predicate after `Wait`
returns to handle spurious wake-ups.

---

## System / Design Scenarios

### Q: Design a thread-safe LRU cache.

Start with a `HashMap<K, Node>` plus a doubly linked list ordered by
access time. The simplest design is a single mutex around both
structures: every `get` and `put` locks, finds/inserts the node, moves
it to the head, evicts the tail if over capacity. This works but the
lock becomes the bottleneck under contention. Next level: shard the
cache into N independent caches by `hash(key) % N`, each with its own
lock — common in production caches (Guava, Caffeine use this). Each
shard has small contention; the overall throughput scales nearly
linearly with shards until you hit memory bandwidth. Advanced
designs use lock-free queues for the LRU bookkeeping (e.g., Caffeine's
ring-buffer approach) so reads only contend on the hash map.

### Q: Design a hand-over-hand locked linked list.

Each node has its own mutex. To traverse, lock node 1, lock node 2,
unlock node 1, lock node 3, unlock node 2, etc. — like hands on a
rope. To insert between A and B, hold locks on both A and B while
splicing. The point is fine-grained locking: many concurrent
traversals or modifications can proceed as long as they are on
different segments. Trade-offs: locking and unlocking every node
costs cycles; cache-line bouncing on the lock words is non-trivial.
Pure lock-free linked lists (Harris/Michael) often outperform
hand-over-hand for read-heavy workloads.

### Q: Design a sharded counter for high-write throughput.

A single atomic counter or a mutex-protected integer becomes a
serialization point — every increment contends on one cache line.
Solution: split the counter into N shards (one per CPU or a power-of-
two like 32 or 64), each in its own cache line (padded to avoid false
sharing). Increments hit a shard chosen by thread ID or hashed key.
Reads sum the shards. This trades read precision (the total is
slightly stale across shards) and read cost (O(N)) for write
scalability that grows linearly with shard count. Java's `LongAdder`
implements this pattern; Go has no built-in but it is trivial to
implement.

### Q: Design a thread-safe object pool.

Naive: one mutex around a stack of free objects. Acquire pops, release
pushes. Problems: heavy contention on the lock, and the stack is a
contended cache line. Better: per-thread (or per-CPU) free lists with
a shared overflow pool. Each thread tries its local pool first;
if empty, takes from the shared pool under a lock or via a lock-free
algorithm. On release, push to local pool; if local pool is full,
batch-flush to shared. This is what `sync.Pool` in Go does with
P-local pools plus a victim cache. It scales near-linearly and rarely
touches the shared structure.

### Q: Design a producer-consumer queue with bounded capacity.

Classic: a fixed-size circular buffer protected by a mutex, with two
condition variables — `not_full` and `not_empty`. Producers wait on
`not_full` when the queue is full and signal `not_empty` after
pushing; consumers wait on `not_empty` and signal `not_full` after
popping. The mutex serializes accesses; the condvars handle blocking.
Trade-offs: under heavy contention, the single mutex bottlenecks. For
high throughput, use lock-free MPMC queues (LMAX Disruptor, Vyukov's
queues) which avoid the lock entirely. The mutex-based design is
simpler, easier to verify, and adequate for most workloads.

### Q: Design a read-mostly configuration store.

The data changes rarely (config reload) but is read on every request.
A read-write lock works but read-acquire still hits a contended cache
line. Better pattern: copy-on-write with an atomic pointer. Reads do
a single atomic load of the pointer to the current config snapshot —
no locking, no cache-line bouncing. Writes build a new snapshot,
swap the pointer atomically, and let the old one be garbage-
collected (or reference-counted). This is the *RCU* pattern at user
level, used by Linux kernel, Java's `volatile` references, Go's
`atomic.Pointer`, Rust's `arc-swap`.

### Q: How would you protect a thread-safe counter with strict serialization but high throughput?

Strict serialization means every increment must be ordered globally
(no sharded counter). The best you can do is reduce the cost per
increment: use a single atomic word with `fetch_add` — no mutex
needed at all. Even under heavy contention, a single CPU-level atomic
on a cache line is roughly 10-20ns per increment plus contention cost.
If you must use a mutex (e.g., the increment is conditional on other
state), shorten the critical section to a single atomic operation and
use try-lock + spin instead of full mutex when the section is just a
few instructions.

### Q: Walk through how you would diagnose and fix a hot mutex in production.

Step 1: confirm with metrics — high lock wait time, low CPU utilization,
high context-switch rate. Step 2: identify the lock — `pprof` mutex
profile in Go, `async-profiler` lock profile in Java, `perf lock` on
Linux. Step 3: read the critical section — is it doing I/O? Allocating?
Holding locks across user code? Step 4: shorten the critical section
or move work out of it. Step 5: if still hot, shard the lock by key
or per-CPU. Step 6: if still hot, switch to a lock-free structure or
RCU pattern. Step 7: re-measure. The order matters: most "hot mutex"
issues fix in step 4.

---

## Coding Questions

### Q: Implement `TryLock` with exponential backoff in Go.

```go
package main

import (
    "math/rand"
    "sync"
    "time"
)

// TryLockBackoff attempts to acquire mu, retrying with exponential
// backoff up to maxWait. Returns true if acquired.
func TryLockBackoff(mu *sync.Mutex, maxWait time.Duration) bool {
    deadline := time.Now().Add(maxWait)
    backoff := 100 * time.Nanosecond
    for {
        if mu.TryLock() {
            return true
        }
        if time.Now().After(deadline) {
            return false
        }
        // Sleep with jitter to avoid thundering herd.
        jitter := time.Duration(rand.Int63n(int64(backoff)))
        time.Sleep(backoff + jitter)
        backoff *= 2
        if backoff > 10*time.Millisecond {
            backoff = 10 * time.Millisecond
        }
    }
}
```

Discussion: Go added `TryLock` in 1.18 — the documentation explicitly
warns that its use is almost always a sign of a deeper bug. Backoff
with jitter prevents synchronized retry storms. Cap the backoff so
latency stays bounded.

### Q: Implement a reentrant mutex from scratch on top of a non-reentrant primitive.

```go
package main

import (
    "runtime"
    "sync"
    "sync/atomic"
)

// ReentrantMutex tracks the owning goroutine ID and a recursion count.
// In real code, goroutine IDs are not exposed; this uses a synthetic
// per-goroutine TLS via runtime.Callers as illustration only.
type ReentrantMutex struct {
    mu     sync.Mutex
    owner  atomic.Int64
    depth  int
}

func goid() int64 {
    // Illustrative: real implementations use runtime/debug.Stack parsing
    // or a CGO TLS trick. Do not use this in production.
    var pcs [1]uintptr
    runtime.Callers(1, pcs[:])
    return int64(pcs[0])
}

func (m *ReentrantMutex) Lock() {
    id := goid()
    if m.owner.Load() == id {
        m.depth++
        return
    }
    m.mu.Lock()
    m.owner.Store(id)
    m.depth = 1
}

func (m *ReentrantMutex) Unlock() {
    id := goid()
    if m.owner.Load() != id {
        panic("unlock from non-owner")
    }
    m.depth--
    if m.depth == 0 {
        m.owner.Store(0)
        m.mu.Unlock()
    }
}
```

Discussion: this is the standard pattern. The hard part in Go is
identifying the calling goroutine cheaply — production-quality libraries
use a hack that the runtime team strongly discourages, which is part of
why Go's stdlib does not ship a reentrant mutex.

### Q: Implement a simple RWMutex from atomics.

```go
package main

import (
    "runtime"
    "sync/atomic"
)

// SimpleRWMutex packs reader count and writer flag in one word.
// Bits: high bit = writer present, low 31 bits = reader count.
type SimpleRWMutex struct {
    state atomic.Uint32
}

const writerBit = uint32(1) << 31

func (m *SimpleRWMutex) RLock() {
    for {
        s := m.state.Load()
        if s&writerBit == 0 && m.state.CompareAndSwap(s, s+1) {
            return
        }
        runtime.Gosched()
    }
}

func (m *SimpleRWMutex) RUnlock() {
    m.state.Add(^uint32(0)) // subtract 1
}

func (m *SimpleRWMutex) Lock() {
    for {
        if m.state.CompareAndSwap(0, writerBit) {
            return
        }
        runtime.Gosched()
    }
}

func (m *SimpleRWMutex) Unlock() {
    m.state.Store(0)
}
```

Discussion: this is a spin-based RWMutex. It is correct but starves
writers under sustained reads, has no fairness, and burns CPU instead
of parking waiters. Real implementations use OS futexes and a more
complex state word that tracks waiting writers.

### Q: Implement a sharded mutex for a hashmap.

```go
package main

import (
    "hash/fnv"
    "sync"
)

const numShards = 32

type ShardedMap struct {
    shards [numShards]struct {
        mu sync.RWMutex
        m  map[string]string
        _  [40]byte // padding to avoid false sharing on 64-byte cache lines
    }
}

func NewShardedMap() *ShardedMap {
    s := &ShardedMap{}
    for i := range s.shards {
        s.shards[i].m = make(map[string]string)
    }
    return s
}

func (s *ShardedMap) shard(key string) int {
    h := fnv.New32a()
    h.Write([]byte(key))
    return int(h.Sum32()) % numShards
}

func (s *ShardedMap) Get(key string) (string, bool) {
    sh := &s.shards[s.shard(key)]
    sh.mu.RLock()
    v, ok := sh.m[key]
    sh.mu.RUnlock()
    return v, ok
}

func (s *ShardedMap) Set(key, value string) {
    sh := &s.shards[s.shard(key)]
    sh.mu.Lock()
    sh.m[key] = value
    sh.mu.Unlock()
}
```

Discussion: sharding distributes contention. The number of shards
should be tuned (16-128 is common); too few does not help, too many
wastes memory and cache. Padding prevents false sharing between
adjacent shards' lock words.

### Q: Implement deadlock-free acquisition of two mutexes.

```go
package main

import (
    "sync"
    "unsafe"
)

// LockBoth acquires a and b in a globally consistent order (by address)
// so two callers using opposite-order arguments do not deadlock.
func LockBoth(a, b *sync.Mutex) {
    if uintptr(unsafe.Pointer(a)) < uintptr(unsafe.Pointer(b)) {
        a.Lock()
        b.Lock()
    } else if uintptr(unsafe.Pointer(a)) > uintptr(unsafe.Pointer(b)) {
        b.Lock()
        a.Lock()
    } else {
        // Same mutex passed twice — sync.Mutex is not reentrant.
        a.Lock()
    }
}

func UnlockBoth(a, b *sync.Mutex) {
    if a == b {
        a.Unlock()
        return
    }
    a.Unlock()
    b.Unlock()
}
```

Discussion: address-based ordering is canonical for ad-hoc pairs.
C++ uses `std::lock(a, b)` with a try-and-back-off algorithm that
avoids holding either lock during the acquisition handshake.

### Q: Implement a fair ticket-based mutex.

```go
package main

import (
    "runtime"
    "sync/atomic"
)

// TicketMutex is a FIFO mutex: each Lock takes a ticket; the holder
// is whoever has the next ticket. Pure spin; not production-grade.
type TicketMutex struct {
    next    atomic.Uint64
    serving atomic.Uint64
}

func (m *TicketMutex) Lock() {
    my := m.next.Add(1) - 1
    for m.serving.Load() != my {
        runtime.Gosched()
    }
}

func (m *TicketMutex) Unlock() {
    m.serving.Add(1)
}
```

Discussion: this is a textbook ticket lock — strict FIFO, simple,
fair. Real implementations park waiters instead of spinning, which
requires a per-ticket wake-up mechanism (one futex per ticket or a
queue of waiters).

### Q: Implement a CountdownLatch using only a mutex and condvar.

```go
package main

import (
    "sync"
)

type CountDownLatch struct {
    mu    sync.Mutex
    cond  *sync.Cond
    count int
}

func NewCountDownLatch(n int) *CountDownLatch {
    l := &CountDownLatch{count: n}
    l.cond = sync.NewCond(&l.mu)
    return l
}

func (l *CountDownLatch) CountDown() {
    l.mu.Lock()
    if l.count > 0 {
        l.count--
        if l.count == 0 {
            l.cond.Broadcast()
        }
    }
    l.mu.Unlock()
}

func (l *CountDownLatch) Wait() {
    l.mu.Lock()
    for l.count > 0 {
        l.cond.Wait()
    }
    l.mu.Unlock()
}
```

Discussion: the predicate is `count == 0`. Always loop on the
predicate after `Wait` to handle spurious wake-ups and multiple
waiters waking together. The mutex protects the counter; the condvar
signals state changes.

---

## Behavioral

### Q: Tell me about a time you debugged a deadlock in production.

Strong answers walk through: how the deadlock manifested (frozen
service, zero CPU on workers), how you diagnosed (stack dumps,
identifying lock-order cycle), the fix (lock ordering, lock
elimination, or design change), and what you put in place to prevent
recurrence (static analysis, runtime detector, code review checklist).
Weak answers say "we added a recursive mutex." Show you understood the
root cause.

### Q: Describe a time you replaced a lock with a lock-free data structure.

Strong answers explain the original bottleneck (mutex profile showing
heavy contention), why lock-free was the right alternative (workload
shape, hardware), what you used (atomic operations, RCU, lock-free
queue), and how you verified correctness (TLA+ model, stress tests,
race detector). Include the trade-offs you accepted — lock-free code
is harder to maintain and easier to write wrong.

### Q: Tell me about a time a junior developer added a recursive mutex to "fix" a deadlock.

This question probes how you handle anti-patterns introduced by others.
Strong answers: you identified the deeper design issue (unclear
ownership, public methods calling public methods), worked with them
to refactor (split into lock-and-call-private worker), and turned the
debugging session into a learning opportunity. Avoid blaming;
explain how you taught the principle.

### Q: How do you decide when to use a mutex vs a channel in Go?

Strong answers cite the Go proverb "share memory by communicating"
but acknowledge it is not universal. Channels are great for ownership
transfer and coordination; mutexes are great for protecting shared
state that many goroutines read and write. Pick the one that makes
the data flow clearest. Anyone who insists "always use channels" or
"always use mutexes" is missing the nuance.

### Q: Describe a time you made a piece of code thread-safe.

Walk through: the original state (single-threaded), why it needed to be
concurrent (scaling, asynchronous I/O), how you analyzed shared state,
what synchronization you added (mutex, atomics, channels, copy-on-
write), and how you verified (race detector, load tests). Bonus
points for explaining what you chose *not* to make concurrent (kept
single-threaded for simplicity).

### Q: How do you write tests for concurrency code?

Strong answers: use the race detector (`go test -race`, TSan), write
tests that hammer the code with many goroutines, use fuzz testing
with concurrent goroutines, model-check critical algorithms (TLA+,
SPIN), and accept that 100% confidence is impossible — concurrent
bugs are probabilistic. Include monitoring in production to catch
escaped bugs.

### Q: Tell me about a time you misused a mutex and what you learned.

Authentic answers are valued here — interviewers know everyone has
done it. Common stories: forgot defer, locked a copy, deadlocked
on two locks, used a mutex when atomic would do, or made a
critical section too long. The lesson should generalize — a coding
standard, a code-review habit, a tool you adopted.

### Q: How do you onboard a new engineer to concurrent code?

Walk through your approach: pair programming on the concurrent
sections, recommended reading (Mike Bostock on concurrency, "The Art
of Multiprocessor Programming"), starting with read-only walkthroughs
before changes, code-review focus on locking patterns, and gradually
giving them ownership of a small concurrent module. Emphasize
psychological safety — concurrency is hard, and asking questions is
healthy.

---

## What I'd Ask a Candidate Now

### Q: Walk me through what happens at the CPU level when you acquire an uncontended mutex.

Looking for: atomic CAS issued, cache line transitions to modified
state on the acquiring core, memory barrier prevents reordering, no
syscall, branch predicts forward, total cost in the tens of
nanoseconds. A weak answer just says "it locks." A strong answer
mentions cache coherence and the futex contract.

### Q: Show me a real lock convoy in code you have seen, and tell me how you fixed it.

Looking for: a concrete story with numbers (latency, throughput
before and after), how the convoy was diagnosed, and which of the
standard fixes (shorten, shard, replace, switch fairness) was
appropriate and why. Bonus: explain what you considered but rejected.

### Q: When would you choose `RWMutex` over `Mutex`, and when have you been wrong?

Looking for: clear understanding that RWMutex is not always faster, a
specific case where they benchmarked and switched (or stayed), and
the trade-off model (read-to-write ratio, critical section length,
contention level). Anyone who answers "reads are more common than
writes" without measurement is parroting.

### Q: How does your team prevent forgotten unlocks?

Looking for: tooling (linters, vet, RAII), conventions
(`defer mu.Unlock()` immediately after lock), reviewer focus, and
maybe runtime guards. Weak: "we just review carefully." Strong: a
checklist plus tools that catch the common cases.

### Q: Have you ever needed a reentrant mutex? Tell me about it.

Looking for: skepticism. Most real production code does not need
reentrant locks; needing one is usually a design smell. Strong
candidates explain how they tried to refactor first and only used
recursion when the alternative was worse. Weak: "we just use
recursive locks everywhere."

### Q: Describe how `sync.Mutex` behaves under starvation.

Looking for: knowledge of the 1ms threshold, the switch to FIFO,
the cost (slower under low contention because barging is disallowed),
and why this matters for tail latency. Weak: "it's fair." Strong:
"unfair by default, starvation mode kicks in after 1ms wait."

### Q: How would you build a lock that supports priority inheritance?

Looking for: understanding that priority inheritance requires the
kernel to know about waiters' priorities, hence `PTHREAD_PRIO_INHERIT`
must be set at init and the OS scheduler must support it. Bonus
points for mentioning the Mars Pathfinder case and futex2's planned
PI support on Linux.

---

## Cheat Sheet

| Question Theme | Quick Answer |
|----------------|--------------|
| What is a mutex? | Primitive ensuring at most one thread in critical section. |
| Fast path | One atomic CAS, no syscall, ~20ns. |
| Slow path | Futex wait/wake, kernel transition, ~1-10us. |
| Fair vs unfair | Unfair = barging, higher throughput; fair = FIFO, lower starvation risk. |
| Spinlock vs mutex | Spin for very short sections; mutex for longer or high contention. |
| Reentrant | Same thread may relock; needs ownership tracking; usually a code smell. |
| Convoy | Many threads pile on one lock; throughput collapses. |
| RWMutex | Many readers OR one writer; only wins for long read sections. |
| Copy of mutex | Always wrong — fresh independent state. |
| Forgot unlock | Lock leaks forever; later acquirers deadlock. |
| Double unlock | UB in C, panic in Go, exception in Java. |
| Unlock from wrong thread | UB in C `NORMAL`, error in `ERRORCHECK`, panic/exception in others. |
| Lock ordering | Acquire by global order (address, name, rank) to prevent deadlock. |
| Priority inversion | Holder is low-pri, waiter high-pri, mid-pri runs and blocks both. |
| Mitigation | Priority inheritance or priority ceiling. |
| Memory model | Lock = acquire fence, unlock = release fence; establishes happens-before. |
| Sharded lock | N locks by hash; reduces contention; bounded read cost. |
| Copy-on-write / RCU | Best for read-mostly with rare writes; no read locking. |
| Diagnosing hot mutex | Profile, shorten section, shard, lock-free, RCU — in that order. |
| Pattern in C++ | `std::lock_guard`, `std::unique_lock`, `std::scoped_lock`. |
| Pattern in Go | `defer mu.Unlock()` immediately after `mu.Lock()`. |
| Pattern in Java | `synchronized` or `try { lock.lock(); ... } finally { lock.unlock(); }`. |
| Pattern in Python | `with lock:` context manager. |
| Pattern in Rust | `let g = mu.lock().unwrap();` — guard released on drop. |

---

## Further Reading

- "The Art of Multiprocessor Programming" — Herlihy & Shavit
- "Is Parallel Programming Hard, And, If So, What Can You Do About It?" — Paul McKenney
- Ulrich Drepper, "Futexes Are Tricky"
- Russ Cox, "Memory Models" series (research.swtch.com)
- "C++ Concurrency in Action" — Anthony Williams
- "Java Concurrency in Practice" — Brian Goetz
- Go source: `src/sync/mutex.go` and `src/sync/rwmutex.go`
- Rust documentation for `std::sync::Mutex` and `parking_lot`
- LWN articles on futex and priority inheritance
- The Mars Pathfinder priority-inversion post-mortem
- Cliff Click, "A Lock-Free Wait-Free Hash Table"
- Daniel Lemire, "Performance of Atomic Operations"

---

## Related Topics

- [Mutex (this topic README)](README.md)
- [Concurrency Primitives](../README.md)
- [Atomics and Memory Ordering](../02-atomics/README.md)
- [Condition Variables](../03-condition-variables/README.md)
- [Semaphores](../04-semaphores/README.md)
- [Read-Write Locks](../05-rwlock/README.md)
- [Lock-Free Data Structures](../../03-lock-free/README.md)
- [Deadlock Detection and Prevention](../../04-deadlock/README.md)
- [Memory Models](../../../memory-models/README.md)
- [Go sync package internals](../../../languages/golang/15-go-source-reading/03-runtime-source/README.md)
