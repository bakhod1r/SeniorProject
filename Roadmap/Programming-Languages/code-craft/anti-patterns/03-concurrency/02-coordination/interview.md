# Coordination Anti-Patterns — Interview Q&A

> **Category:** [Concurrency Anti-Patterns](../README.md) → **Coordination** — *two or more lock holders that fail to make progress together.*
> **Covers (collectively):** Lock Ordering Inconsistency → Deadlock · Holding a Lock During I/O · Wrong Lock Granularity

A bank of 60+ interview questions spanning recognition, prevention, debugging, and the runtime cost of contention. Each answer models the reasoning a strong candidate gives — including the trade-offs, because coordination problems almost never have a free fix. Examples are Go and Java first, with a Python/GIL note where it changes the answer. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Prevention, Avoidance, Detection & Lock Hierarchies](#senior--prevention-avoidance-detection--lock-hierarchies)
4. [Professional / Deep — Contention Cost, Convoys, Mutex Internals](#professional--deep--contention-cost-convoys-mutex-internals)
5. [Code-Reading — Spot the Deadlock / Lock-Across-I/O](#code-reading--spot-the-deadlock--lock-across-io)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [How to Talk About Coordination in Interviews](#how-to-talk-about-coordination-in-interviews)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, recognition, and the "why is it bad" reasoning.

**Q1. Name the three coordination anti-patterns and give a one-line symptom for each.**

<details><summary>Answer</summary>

- **Lock Ordering Inconsistency → Deadlock** — two code paths acquire the same two locks in opposite orders; each holds one and waits forever for the other.
- **Holding a Lock During I/O** — a thread takes a lock, then makes a network/DB/disk call while still holding it, so the lock's hold time is the I/O latency multiplied across every contending caller.
- **Wrong Lock Granularity** — one giant lock that serializes everything (no parallelism), or so many tiny locks that the locking overhead and new deadlock surface cost more than the work.

The common thread: these are *coordination* failures — the locking is "correct" in the narrow sense (no data race) yet the threads still fail to make progress together, or make it far too slowly.
</details>

**Q2. What is a critical section?**

<details><summary>Answer</summary>

A critical section is a region of code that accesses shared mutable state and must not be executed by more than one thread at a time, or the state becomes inconsistent. A lock (mutex) enforces this: only the holder may be inside the section. The whole craft of these anti-patterns is sizing and ordering critical sections correctly — keep them **as small as possible** (so contention is low and I/O isn't inside them) but **as large as necessary** (so a multi-field invariant stays consistent). Too small breaks correctness; too large kills throughput.
</details>

**Q3. What is a deadlock, in one sentence, and what makes it different from a normal slow program?**

<details><summary>Answer</summary>

A deadlock is a state in which a set of threads are each blocked waiting for a resource held by another thread in the set, so none of them can ever proceed — it is permanent, not slow. A slow program eventually finishes; a deadlocked one never does, and it usually consumes *zero* CPU while doing it (the threads are parked, not spinning). That "hung but idle" signature — CPU near zero, throughput zero, threads all in a wait state — is the classic fingerprint.
</details>

**Q4. Show the smallest possible deadlock in Go.**

<details><summary>Answer</summary>

```go
var muA, muB sync.Mutex

func f1() { muA.Lock(); muB.Lock(); /* ... */ muB.Unlock(); muA.Unlock() }
func f2() { muB.Lock(); muA.Lock(); /* ... */ muA.Unlock(); muB.Unlock() }
```

If `f1` and `f2` run concurrently, `f1` can grab `muA` and `f2` can grab `muB` before either takes the second lock. Now `f1` waits for `muB` (held by `f2`) and `f2` waits for `muA` (held by `f1`) — neither will ever release. The bug is the **inconsistent acquisition order**, not the locks themselves. (Go's runtime detects only the all-goroutines-blocked case — `fatal error: all goroutines are asleep - deadlock!`; a two-lock cycle where other goroutines still run is *not* detected.)
</details>

**Q5. Why is "holding a lock during a network call" dangerous even if the code is otherwise correct?**

<details><summary>Answer</summary>

Because the lock is held for the duration of an operation whose latency you do not control. A local computation under a lock might take microseconds; a network call takes milliseconds to *seconds*, and can hang until a timeout. Every other thread that needs that lock is blocked for that entire time, so one slow dependency turns into a queue of stalled threads — latency multiplied by contention. Worse, if the remote call can itself trigger a callback that needs the same lock, you deadlock; and a hung connection with no timeout means the lock is held *forever*. The fix is almost always: copy the data you need, release the lock, then do the I/O.
</details>

**Q6. What does "lock granularity" mean?**

<details><summary>Answer</summary>

Granularity is *how much state one lock protects and for how long*. **Coarse-grained**: one lock guards a whole data structure or object — simple and easy to reason about, but every operation serializes through it. **Fine-grained**: many locks each guard a small piece (e.g. one lock per hash-table bucket, or per row) — more parallelism, but more locks to acquire, more memory, more chances to acquire them in the wrong order (deadlock), and the per-lock overhead can dominate when the protected work is tiny. Right granularity protects the smallest *consistent* unit of state and no more.
</details>

**Q7. Does a deadlock corrupt data?**

<details><summary>Answer</summary>

No — and that's a useful distinction from a data race. A deadlock is a *liveness* failure: the locks did their job (mutual exclusion held), so the protected state is consistent; the threads simply never make progress. A data race is a *safety* failure: state is read/written without coordination and can be corrupted. This matters in diagnosis — a deadlocked process is "stuck but clean," so once you break the cycle (restart, or a timeout fires) the state is usually fine; a race leaves you with silently wrong data and no clean recovery.
</details>

**Q8. What's the difference between a deadlock, a livelock, and starvation?**

<details><summary>Answer</summary>

- **Deadlock** — threads are blocked forever waiting on each other; CPU near zero.
- **Livelock** — threads are *active* but make no progress because they keep reacting to each other (e.g. both detect contention, both back off, both retry, repeat); CPU is busy, throughput is zero.
- **Starvation** — a thread *could* run but is perpetually denied the resource because others keep winning it (an unfair lock, or a low-priority thread behind a stream of high-priority ones).

All three are liveness failures. Deadlock is the frozen one, livelock the busy-but-stuck one, starvation the unfair one.
</details>

**Q9. Why are these bugs so hard to reproduce?**

<details><summary>Answer</summary>

Because they depend on *timing* — a specific interleaving of when each thread acquires which lock. A lock-ordering deadlock only manifests when two threads reach the contended pair within the same narrow window; most runs, one finishes before the other starts, and everything looks fine. Add a debugger, a log line, or a single-core test box and the timing shifts, so the bug hides exactly when you look for it (a Heisenbug). The lock-during-I/O cost only shows up under *concurrent load* hitting a *slow* dependency — invisible at low traffic. This is why these are caught by reasoning, stress tests, and tooling, not by a quick unit test.
</details>

**Q10. If two threads only ever need one lock at a time, can they deadlock on those locks?**

<details><summary>Answer</summary>

No. A lock-ordering deadlock requires *holding one lock while waiting for another* — the "hold and wait" condition. If every thread acquires at most one lock at a time (take it, do the work, release it, then take the next), there is no cycle of waits to form, so this class of deadlock is structurally impossible. This is exactly why "hold only one lock at a time" is the simplest deadlock-prevention rule, and why people reach for it before the more elaborate global-ordering scheme. (You can still get *other* liveness problems — contention, starvation — but not a two-lock deadlock.)
</details>

**Q11. What is the GIL, and how does it change this conversation in Python?**

<details><summary>Answer</summary>

CPython's Global Interpreter Lock allows only one thread to execute Python bytecode at a time. Two consequences for this topic: (1) it does **not** save you from deadlock — your own `threading.Lock` objects acquired in inconsistent order still deadlock exactly as in Java or Go, because the GIL is about bytecode execution, not your application locks. (2) It *does* cap the *benefit* of fine-grained locking for CPU-bound work — since pure-Python code can't run in parallel anyway, splitting one lock into many rarely buys throughput; the win shows up mainly for I/O-bound threads (which release the GIL during the call) or with multiprocessing / C extensions / the free-threaded build. So in Python, "wrong granularity" is more often "you locked at all when the GIL or a different model would do."
</details>

---

## Intermediate / Middle

> When it creeps in, what to do instead, and the trade-offs.

**Q12. What is the standard fix for a lock-ordering deadlock?**

<details><summary>Answer</summary>

Impose a **global, total order** on lock acquisition and acquire locks only in that order, everywhere. If every code path takes `muA` before `muB`, the opposite-order acquisition that creates the cycle can't exist, so no deadlock. When the locks are on dynamic objects (e.g. transferring between two accounts), order by a stable key — account ID, memory address, or a per-object sequence number — and lock the lower one first. Document the order so it survives the next edit; an undocumented ordering rule decays the moment someone adds a third lock. Alternatives when ordering is impractical: hold only one lock at a time, use a single coarser lock, use lock-free structures, or use `tryLock` with a timeout and back off.
</details>

**Q13. Show the classic "transfer between two accounts" deadlock and the ordered fix.**

<details><summary>Answer</summary>

The bug — `transfer(a, b)` and `transfer(b, a)` running concurrently lock in opposite orders:

```java
void transfer(Account from, Account to, long amt) {
    synchronized (from) {
        synchronized (to) { from.debit(amt); to.credit(amt); }
    }
}
```

The fix — always lock the lower id first, so both calls take the same order:

```java
void transfer(Account from, Account to, long amt) {
    Account first  = from.id < to.id ? from : to;
    Account second = from.id < to.id ? to   : from;
    synchronized (first) {
        synchronized (second) { from.debit(amt); to.credit(amt); }
    }
}
```

Edge case: if `from.id == to.id` it's the same account — special-case it so you don't try to lock the same monitor twice and reason yourself into a self-transfer bug. If two distinct accounts can share an id (they shouldn't), add a tie-breaker lock to keep the order total.
</details>

**Q14. Walk through the "copy, release, then do I/O" refactor.**

<details><summary>Answer</summary>

Bad — the HTTP call runs while the lock is held, so every other writer waits on the network:

```go
func (c *Cache) Refresh(key string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    v := httpGet(key)        // network call under the lock — blocks all others
    c.data[key] = v
}
```

Good — read what you need under the lock (or nothing), release, do the I/O unlocked, then re-lock only to publish the result:

```go
func (c *Cache) Refresh(key string) {
    v := httpGet(key)        // no lock held during the slow part
    c.mu.Lock()
    c.data[key] = v          // lock held only for the fast map write
    c.mu.Unlock()
}
```

Trade-off: the unlocked window means two callers can both fetch `key` concurrently (redundant work, and a possible "last writer wins" race on the value). If that matters, add single-flight / request coalescing, or store a per-key "in progress" marker — but you still don't hold the global lock across the network.
</details>

**Q15. After "copy-then-I/O," two threads might do the same expensive fetch. Is that acceptable?**

<details><summary>Answer</summary>

It's a deliberate trade and often fine: you've swapped *guaranteed* serialization for *occasional* duplicate work. If the fetch is idempotent and cheap-ish, a rare double-fetch beats blocking every thread for the whole I/O latency. When duplication is expensive or unsafe (it costs money, hits a rate limit, or the writes aren't idempotent), add **single-flight**: the first caller for a key does the work and others wait on its result (Go's `golang.org/x/sync/singleflight`, or a per-key future/promise). The point of the anti-pattern fix is *don't hold the lock across I/O* — not *never coordinate* — so layering single-flight on top is the mature answer.
</details>

**Q16. Is finer-grained locking always faster?**

<details><summary>Answer</summary>

No — this is the most common over-correction. Finer locks help only when there's real contention *and* the protected work is large enough to dwarf the locking overhead. Costs that finer granularity adds: each lock has acquisition/release overhead and memory; an operation spanning multiple fine locks must acquire several (more overhead, more cache traffic); and multiple locks reintroduce **lock ordering** problems you didn't have with one. If operations are short or contention is low, one coarse lock is faster *and* simpler. Profile first: split a lock only when the profiler shows threads actually waiting on it, and split along the axis where independent operations touch disjoint state.
</details>

**Q17. How do you choose the right lock granularity?**

<details><summary>Answer</summary>

Match the lock to the smallest unit of state that must stay *mutually consistent*, and let the access pattern guide splitting. Steps: (1) Start coarse — correctness first, one lock. (2) Measure — if a profiler/contention profile shows threads blocked on that lock under load, you have a granularity problem worth fixing. (3) Split along natural independence — per-bucket in a hash map, per-shard, per-row, per-connection — so operations on different keys don't contend. (4) Never split below the consistency boundary: if two fields must change together to preserve an invariant, they share a lock. The mantra: *as coarse as correctness demands, as fine as contention requires.*
</details>

**Q18. What is lock striping?**

<details><summary>Answer</summary>

Lock striping is a middle ground between one global lock and one-lock-per-element: you create a fixed array of N locks and map each element to a stripe, e.g. `lock = stripes[hash(key) % N]`. Operations on keys in different stripes proceed in parallel; only same-stripe collisions serialize. Java's pre-Java-8 `ConcurrentHashMap` used 16 segment locks this way. Benefits: bounded lock count (memory and ordering stay manageable) with most of the parallelism of per-element locks. Caveat: an operation that must atomically touch keys in *different* stripes has to lock multiple stripes — in a consistent order — which reintroduces ordering discipline, and computing aggregate state (like `size()`) requires acquiring or snapshotting all stripes.
</details>

**Q19. What's the difference between a mutex and a read-write lock, and when does RWLock help?**

<details><summary>Answer</summary>

A mutex grants exclusive access to one holder for any operation. A read-write lock (`sync.RWMutex` in Go, `ReentrantReadWriteLock` in Java) distinguishes *shared* read access (many readers concurrently) from *exclusive* write access (one writer, no readers). It helps when the workload is **read-heavy with infrequent writes** — many readers stop blocking each other. It *doesn't* help, and often hurts, when writes are frequent (writers still serialize and now also block all readers) or when critical sections are tiny (RWLock bookkeeping is heavier than a plain mutex, so a cheap mutex or an atomic / copy-on-write value can beat it). Measure the read:write ratio before reaching for it.
</details>

**Q20. How does `defer mu.Unlock()` in Go interact with lock-during-I/O bugs?**

<details><summary>Answer</summary>

`defer` is great for *not forgetting* to unlock, but it extends the hold to the end of the *function*, which silently encourages holding the lock across everything in between — including I/O. A function that does `mu.Lock(); defer mu.Unlock()` and then makes a network call holds the lock for the whole call by construction. The fix is to scope the lock tighter: either unlock explicitly right after the critical section (no `defer`), or extract the critical section into its own small function so `defer` covers only that. `defer`'s convenience and the lock-during-I/O anti-pattern pull in opposite directions; prefer a small, obvious critical section over a function-wide `defer`.
</details>

**Q21. What are the warning signs in code review that someone holds a lock too long?**

<details><summary>Answer</summary>

Look inside any locked region for: a network/RPC/HTTP client call, a DB query, file or disk I/O, a channel send/receive or another blocking wait, a call into *another* subsystem's method (which might itself lock — deadlock risk), logging that hits I/O, sleeping, or any unbounded loop. Each of these makes the hold time data- or latency-dependent. Also flag a function-wide `defer unlock` (Go) or a method-level `synchronized` (Java) wrapping a long body. The review question: *"What is the longest this lock can be held, and does any line inside depend on something I don't control?"*
</details>

**Q22. A method is `synchronized` and calls another `synchronized` method on a different object. What should worry you?**

<details><summary>Answer</summary>

Nested locking across objects is exactly the setup for a lock-ordering deadlock: object A's `synchronized` method calls into object B's `synchronized` method while holding A's monitor, so the order is A-then-B. If anywhere else in the system a path locks B then calls into A, you have the opposite order and a latent cycle. The danger is that the second lock is acquired *invisibly* by a method call — you don't see a `lock` statement, just an innocuous call. This is why "calling foreign/alien methods while holding a lock" is a classic Goetz warning: you can't see what locks the callee takes, so you can't reason about ordering. Prefer to release the lock before calling out, or pass copied data.
</details>

**Q23. Java: is `synchronized` reentrant? Why does that matter here?**

<details><summary>Answer</summary>

Yes — `synchronized` (and `ReentrantLock`) is reentrant: a thread that already holds a monitor can re-acquire it without blocking on itself. This matters because a `synchronized` method calling another `synchronized` method *on the same object* won't self-deadlock — a real risk with a non-reentrant lock. It does **not** save you across *different* objects/locks (that's the ordering problem), and it can mask design issues by letting deeply nested same-object locking "just work." Go's `sync.Mutex` is **not** reentrant: re-locking a mutex you already hold on the same goroutine deadlocks immediately, which surfaces accidental re-entry as a hard failure rather than hiding it.
</details>

**Q24. Should you use `tryLock` with a timeout to "fix" deadlocks?**

<details><summary>Answer</summary>

`tryLock`/timed acquisition (Java `tryLock(timeout)`, or `select` with a timeout in Go) is a *detection-and-recovery* tactic, not a structural fix. If you can't acquire the second lock within the timeout, you release the first and retry (with backoff/randomization), so a deadlock self-resolves. Use it when a global lock order is genuinely impractical (locks chosen dynamically across subsystems). Costs: you must handle the failure path on every acquisition, retries add latency and can livelock without randomized backoff, and the timeout value is a guess. Prefer ordered acquisition where you can; reach for timed `tryLock` when you can't, and treat it as the fallback it is.
</details>

---

## Senior — Prevention, Avoidance, Detection & Lock Hierarchies

> Strategy, debugging in production, and refactoring contended paths.

**Q25. What are the four Coffman conditions for deadlock?**

<details><summary>Answer</summary>

All four must hold simultaneously for a deadlock to be possible:

1. **Mutual exclusion** — at least one resource is held in a non-shareable mode.
2. **Hold and wait** — a thread holds at least one resource while waiting to acquire others.
3. **No preemption** — a resource can't be forcibly taken; it's released only voluntarily by its holder.
4. **Circular wait** — a cycle of threads exists, each waiting for a resource held by the next.

The practical value is that **breaking any one** prevents deadlock — so deadlock-prevention strategies map directly onto negating a specific condition.
</details>

**Q26. Map each common deadlock-prevention technique to the Coffman condition it breaks.**

<details><summary>Answer</summary>

- **Lock-free / immutable data, single-writer designs** → break *mutual exclusion* (no exclusive lock to contend on).
- **Acquire all locks at once, or hold only one lock at a time** → break *hold-and-wait* (never hold one while requesting another).
- **`tryLock` + timeout/back-off; abort-and-retry; transaction rollback** → introduce *preemption* (the system can reclaim a held lock by aborting the holder).
- **Global lock ordering / lock hierarchy** → break *circular wait* (a total order makes a cycle impossible).

Most application code breaks *circular wait* (ordering) because it's the cheapest and most local to enforce; databases break *no preemption* (the deadlock detector aborts a victim transaction).
</details>

**Q27. Distinguish deadlock prevention, avoidance, and detection.**

<details><summary>Answer</summary>

- **Prevention** — design so a deadlock *cannot* occur by statically negating a Coffman condition (e.g. enforce a global lock order, or never hold two locks). Cheap at runtime, requires discipline; this is what almost all application code uses.
- **Avoidance** — at runtime, only grant a lock request if the resulting state is still "safe" (no possible future cycle). The Banker's Algorithm is the textbook example; it needs each thread's maximum resource claims in advance, which is rarely practical in general software, so it's mostly academic / special-purpose (some RTOS, resource managers).
- **Detection (and recovery)** — allow deadlocks to happen, run a detector that finds wait-for cycles, then recover by aborting a victim. Databases do exactly this (a deadlock detector kills the cheapest transaction with a "deadlock victim" error). Choose based on cost: prevention for code you control, detection for systems where requests are dynamic and a clean rollback exists.
</details>

**Q28. What is a lock hierarchy / lock leveling, and how do you enforce it?**

<details><summary>Answer</summary>

A lock hierarchy assigns every lock a **level** (a number) and mandates that a thread may only acquire a lock of a *strictly higher* level than any lock it already holds. This makes a total order explicit and machine-checkable, so circular wait is impossible. Enforcement options: a thread-local stack of currently-held levels that asserts the ordering invariant on each acquire (fail fast in tests if violated); custom `ReentrantLock` wrappers in Java; or a runtime/instrumentation layer (the Linux kernel's `lockdep` does exactly this). The key is converting an informal "always lock A before B" convention — which silently rots as code changes — into an *enforced, testable* rule that breaks loudly the first time someone violates it.
</details>

**Q29. How do you debug a deadlock in production?**

<details><summary>Answer</summary>

Capture the *thread state at the moment of the hang*, because the stacks tell you who holds what and who's waiting on what.

- **Java:** take a thread dump (`jstack <pid>`, `kill -3`, or via JMX). The JVM explicitly reports `Found one Java-level deadlock` and prints the cycle, listing which thread owns which monitor and which it's blocked on.
- **Go:** if *all* goroutines are blocked, the runtime panics with the deadlock error and a full dump. Otherwise send `SIGQUIT` or set `GOTRACEBACK=all` to dump every goroutine's stack; the `runtime/pprof` goroutine profile or the block profiler shows where goroutines are parked.
- **General:** confirm the signature (CPU near zero, no progress), then read the stacks to find the wait-for cycle; the fix is almost always to impose or repair lock ordering on the two sites involved. Then reproduce under stress with race/lock detectors to confirm.
</details>

**Q30. You profile a hot path and the bottleneck is lock contention. What's your decision tree?**

<details><summary>Answer</summary>

(1) **Reduce time under the lock first** — pull any I/O, allocation, or computation that doesn't need the lock outside the critical section; this often removes the contention with zero structural risk. (2) **Reduce the need for the lock** — can the state be immutable, thread-local, or sharded so threads touch disjoint data? Can it be an atomic or a lock-free structure? (3) **Split the lock** — if a single lock guards independent sub-states, give each its own lock (or stripe). (4) **Change the read/write balance** — read-heavy → RWMutex or copy-on-write; write-heavy → consider a queue / single-writer actor so writers don't contend at all. At each step, re-measure; contention fixes routinely *move* the bottleneck rather than removing it, and finer locks add their own costs.
</details>

**Q31. A lock is heavily contended but each critical section is tiny. What now?**

<details><summary>Answer</summary>

Tiny-but-hot is the signature where you should *stop adding locks* and change the model. Options in order of preference: (1) **Atomics / lock-free** — if the protected state is a single counter or pointer, a `sync/atomic` op or `AtomicLong`/`LongAdder` removes the lock entirely; `LongAdder` even spreads a hot counter across cells to kill cache contention. (2) **Sharding / per-CPU or per-thread accumulation** — each thread updates its own slot, aggregate on read. (3) **Reduce the call rate** — batch updates so you take the lock once per N operations. Splitting the lock finer here usually backfires: the work is already smaller than the lock overhead, so you're adding cost, not parallelism. This is the *over-fine* end of wrong granularity.
</details>

**Q32. How do you prevent deadlock? Give the full menu, ranked.**

<details><summary>Answer</summary>

In rough order of how often they're the right answer:

1. **Hold only one lock at a time** — if you can restructure to never nest locks, the problem is gone. Simplest and best when feasible.
2. **Global lock ordering** — acquire all locks in one documented, total order (by id/address/level). The workhorse for code that genuinely needs multiple locks.
3. **A single coarser lock** — collapse the two locks into one if the extra parallelism wasn't paying off anyway. Trades throughput for guaranteed no-cycle.
4. **Lock-free / immutable / message-passing** — eliminate the shared lock entirely (channels in Go, actors, copy-on-write, atomics). Removes mutual exclusion as a condition.
5. **`tryLock` + timeout/backoff** — detection-and-recovery when ordering is impossible because locks are chosen dynamically across subsystems.

Name the trade-off for whichever you pick — there's no free option here.
</details>

**Q33. How do you refactor a contended path that holds a lock across a DB query?**

<details><summary>Answer</summary>

Separate the *decision* from the *I/O* from the *commit*. (1) Under the lock, read the minimal state you need to decide what to do and copy it out; release the lock. (2) Run the DB query / RPC with **no lock held** and a real timeout. (3) Re-acquire the lock only to apply the result, and **re-validate** the state you copied — it may have changed while you were unlocked (the optimistic-concurrency pattern: check a version/sequence number and retry if it moved). The hard part is step 3's staleness: the lock-free window is exactly where another thread can mutate things, so either the operation must be idempotent/commutative, or you need a version check + retry, or single-flight to dedupe. Holding the lock across the query "solves" staleness by serializing everything — at the cost this anti-pattern is about.
</details>

**Q34. Two locks that are *always* taken together — should you merge them?**

<details><summary>Answer</summary>

Usually yes. If every critical section that takes lock A also takes lock B (and vice versa), the second lock buys no extra parallelism — you've paid for two acquisitions, double the deadlock surface, and double the memory to get the behavior of one lock. Merge them into a single lock guarding the combined state; it's faster and removes any ordering question between them. The exception is when there exist *other* paths that take only A or only B independently — then the split does enable parallelism on those paths, and you keep both (with a documented order for the combined path). The test: are there operations that need exactly one of the two? If not, merge.
</details>

**Q35. What is the relationship between lock granularity and Amdahl's Law?**

<details><summary>Answer</summary>

Amdahl's Law says the speedup from parallelism is capped by the fraction of work that remains *serial*. A lock turns its critical section into serial work — only one thread runs it at a time — so the time spent holding locks (summed across the program) is a hard ceiling on scalability. Coarse locks enlarge that serial fraction (more code serialized), so throughput plateaus and even *declines* as you add cores (they queue on the lock). Reducing granularity, shortening hold time, and removing locks (lock-free, sharding) all shrink the serial fraction, which is the only way to raise the Amdahl ceiling. So "wrong granularity" isn't just slow — it sets a mathematical limit on how many cores you can ever usefully employ.
</details>

**Q36. When is one big lock actually the right call?**

<details><summary>Answer</summary>

When contention is low, the protected operations are short, the data structure is small or rarely accessed, or correctness depends on many fields changing together. A single lock is the simplest thing that's correct: no ordering rules, no deadlock between sub-locks, trivial to reason about and review. Premature fine-graining is a real anti-pattern — you pay complexity and new deadlock risk for parallelism you may not need. The senior move is to *start* with one lock, ship it, measure, and split only the locks the profiler proves are contended. "Make it correct, then make it fast, and only where the data says to."
</details>

**Q37. Your service deadlocks only under high load in production but never in tests. Why, and what do you do?**

<details><summary>Answer</summary>

Because the deadlock needs two threads to hit the contended lock pair in the same narrow window — vanishingly rare at test concurrency, increasingly likely as load (and thus the number of simultaneous in-flight requests on those locks) rises. Tests run with low parallelism and predictable timing, so the bad interleaving almost never occurs. What to do: (1) Capture a thread dump *from the hung production process* to identify the exact cycle. (2) Reproduce with a **stress/concurrency test** that hammers the two paths from many threads, ideally with injected jitter, plus race/lock detectors (Go `-race`, Java thread-dump-on-monitor-deadlock, `jcstress`). (3) Fix structurally with lock ordering or by removing the nested lock — don't just bump a timeout. Load-dependent hangs are the textbook fingerprint of a latent ordering bug.
</details>

---

## Professional / Deep — Contention Cost, Convoys, Mutex Internals

> Runtime, memory ordering, and the hardware reality under the lock.

**Q38. What actually happens, at the hardware/OS level, when a lock is contended?**

<details><summary>Answer</summary>

An uncontended lock is cheap: typically a single atomic compare-and-swap (CAS) on the lock word, which succeeds and the thread proceeds — no kernel involved. Contention is where the cost explodes. The CAS fails, and a modern mutex usually **spins** briefly (optimistic that the holder releases soon — adaptive spinning), burning CPU and bouncing the lock's cache line between cores (cache-coherence traffic, the real hidden cost). If the lock stays held, the thread **parks** — a syscall (`futex` on Linux) that deschedules it, costing a context switch (microseconds, ~thousands of cycles) and later another to wake it. So contention cost = wasted spin cycles + cache-line ping-pong + context switches, which is why a contended lock can be orders of magnitude slower than an uncontended one even though "the code under the lock didn't change."
</details>

**Q39. What is a lock convoy?**

<details><summary>Answer</summary>

A lock convoy happens when many threads repeatedly contend for the same lock and the OS scheduler interacts badly with the lock's wakeup policy: a thread releases the lock, a waiting thread is woken and scheduled, but by the time it runs another thread has already grabbed and released the lock — and the woken thread, having paid a context switch, finds itself at the back of the line again. Throughput collapses because the system spends its time context-switching and handing the lock around fairly rather than doing work; the threads move in lockstep like a convoy of cars at a toll booth. Cures: reduce hold time so the lock is rarely contended, use a lock with better (sometimes *unfair*) handoff that lets a running thread re-acquire, replace the lock with a lock-free structure or per-thread accumulation, or reduce the number of threads contending.
</details>

**Q40. Why can an *unfair* lock outperform a *fair* one?**

<details><summary>Answer</summary>

A fair lock hands ownership to the longest-waiting thread (FIFO). That's just, but it forces a context switch on every handoff: the current holder must wake a parked waiter even if the holder (or a still-running thread) could have re-acquired and made progress immediately. An unfair lock (the default for Java's `ReentrantLock` and intrinsic `synchronized`, and Go's mutex in its normal mode) lets a thread that's *already running* barge in and re-acquire, avoiding the wakeup and keeping the cache hot — much higher throughput under contention. The cost is potential starvation: a unlucky waiter can be skipped repeatedly. Go's mutex hedges with a "starvation mode" that flips to FIFO after a waiter has waited >1 ms, getting unfair throughput with a fairness backstop.
</details>

**Q41. Does holding a lock guarantee memory visibility, and how does that connect to granularity?**

<details><summary>Answer</summary>

Yes — and this is why you can't *always* shrink critical sections freely. Acquiring a lock establishes a *happens-before* edge: writes made by the previous holder before releasing are visible to the next thread after it acquires (Java Memory Model, Go memory model, C++ acquire/release semantics). So a lock provides both mutual exclusion *and* a memory barrier. The granularity connection: if you split one lock into two, operations that used to be ordered through a single happens-before chain may no longer be — you can shrink a critical section into incorrectness by breaking the visibility guarantee a wider lock provided. Sizing locks isn't only about contention; the critical section must still cover every set of reads/writes that must be seen atomically and in order.
</details>

**Q42. How does false sharing relate to fine-grained locking?**

<details><summary>Answer</summary>

False sharing is when two independent variables (e.g. two separate locks, or a lock and the data it guards) sit on the *same CPU cache line* (~64 bytes). Even though threads touch *different* variables, the cache-coherence protocol invalidates the whole line on every write, so the cores ping-pong the line back and forth — you get contention costs with no logical contention. Fine-grained locking can *create* this: an array of stripe locks packed tightly means acquiring stripe 3 thrashes the line holding stripes 0–7. The fix is padding/alignment so each hot lock (and each per-thread counter) occupies its own cache line (Java `@Contended`, Go padding structs). It's a reminder that "more locks for more parallelism" can be silently undone by the cache.
</details>

**Q43. Compare the cost models of a mutex, an RWLock, and an atomic for protecting a single counter.**

<details><summary>Answer</summary>

For a single counter, ranked cheapest-first under contention:

- **Atomic** (`atomic.AddInt64`, `AtomicLong`): one CAS/fetch-add, no parking, no critical section — best for a single word. Under heavy contention the single cache line still ping-pongs; `LongAdder`/striped counters fix that by spreading across lines.
- **Mutex**: cheap when uncontended (a CAS), but adds park/unpark and a full critical section when contended — overkill for one increment, and it serializes reads too.
- **RWLock**: the *worst* choice for a counter — its read/write bookkeeping is heavier than a plain mutex, and a counter is mostly writes anyway, so the "many readers" benefit never applies.

The lesson: match the primitive to the operation. RWLock pays off only for genuinely read-mostly *compound* state; for a single value, atomics win.
</details>

**Q44. What does Go's `-race` detector actually catch, and what does it miss regarding these anti-patterns?**

<details><summary>Answer</summary>

The race detector instruments memory accesses and flags *data races* — concurrent unsynchronized access where at least one is a write — by tracking happens-before relationships at runtime. It's excellent for the *Shared State* category. For *Coordination* anti-patterns it's largely **blind**: a lock-ordering deadlock involves *correctly synchronized* accesses (no data race — the locks work), so `-race` won't report it; holding a lock during I/O is also race-free, just slow. Go's runtime catches only the *total* deadlock (all goroutines blocked). So these need different tools: thread/goroutine dumps and wait-for-cycle analysis for deadlocks, the **block** and **mutex** profilers (`runtime/pprof` block/mutex profiles) for contention and lock-during-I/O hotspots. Knowing which tool catches which class is itself a senior signal.
</details>

**Q45. How do databases handle deadlock, and what can application code learn from it?**

<details><summary>Answer</summary>

Databases (Postgres, MySQL/InnoDB, SQL Server) use **detection and recovery**, not prevention: they let transactions take row/page locks freely, maintain a wait-for graph, and when a cycle forms, a background detector picks a **victim** (usually the cheapest to roll back) and aborts it with a "deadlock detected" error; the application retries the transaction. They can do this because a transaction has a clean rollback point — they break the *no-preemption* Coffman condition. The lessons for application code: (1) acquire row locks in a consistent order (e.g. `SELECT ... FOR UPDATE ... ORDER BY id`) to *prevent* the cycle in the first place; (2) keep transactions short — don't hold DB locks across application-side I/O (the same anti-pattern, one layer down); (3) make operations retryable, because even with care, deadlocks can occur and the correct response is a bounded retry. See [transaction isolation](../../../../../Backend/distributed-systems/README.md) for the broader concurrency-control picture.
</details>

**Q46. Reentrant vs. non-reentrant locks — what's the deep trade-off?**

<details><summary>Answer</summary>

A reentrant lock tracks the owning thread and a hold count, letting the holder re-acquire (incrementing the count) and requiring matching releases. Pro: composability — a `synchronized` method can call another method on the same object without self-deadlock, which is essential for OO code where methods call methods. Con: it *hides* re-entry, so accidental recursion into a critical section "works" and can mask a design where you didn't realize you were re-locking; it also slightly increases lock cost (owner/count bookkeeping). Non-reentrant locks (Go's `sync.Mutex`) are cheaper and force you to confront re-entry as an immediate deadlock — which is arguably safer because it surfaces the design issue. Neither prevents *cross-lock* ordering deadlock; reentrancy only concerns re-acquiring the *same* lock.
</details>

---

## Code-Reading — Spot the Deadlock / Lock-Across-I/O

> You're shown a snippet; identify the anti-pattern and state the fix.

**Q47. Spot the problem and fix it (Go).**

```go
func (s *Store) Update(id string, v Value) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    if err := s.db.Exec("UPDATE ... WHERE id=$1", id); err != nil { // DB call under lock
        return err
    }
    s.cache[id] = v
    return nil
}
```

<details><summary>Answer</summary>

**Holding a Lock During I/O.** The DB query runs while `s.mu` is held (and `defer` keeps it held until return), so every other goroutine calling `Update`/reading the cache is blocked for the full query latency — under load this serializes the whole store behind the database. Fix: do the I/O outside the lock, then take the lock only to update the in-memory cache:

```go
func (s *Store) Update(id string, v Value) error {
    if err := s.db.Exec("UPDATE ... WHERE id=$1", id); err != nil {
        return err
    }
    s.mu.Lock()
    s.cache[id] = v
    s.mu.Unlock()
    return nil
}
```

If concurrent updaters of the same `id` could clobber each other, add a version check or per-id single-flight — but the global lock still doesn't span the query.
</details>

**Q48. Spot the problem (Java).**

```java
class Account {
    final Object lock = new Object();
    void transferTo(Account other, long amt) {
        synchronized (lock) {
            synchronized (other.lock) {
                this.balance -= amt;
                other.balance += amt;
            }
        }
    }
}
```

<details><summary>Answer</summary>

**Lock Ordering Inconsistency → Deadlock.** `a.transferTo(b)` locks `a.lock` then `b.lock`; `b.transferTo(a)` running concurrently locks `b.lock` then `a.lock` — opposite order, classic two-lock cycle. Fix: impose a total order by a stable key (object identity hash or an explicit account id) and always lock the lower one first:

```java
void transferTo(Account other, long amt) {
    Account lo = System.identityHashCode(this) <= System.identityHashCode(other) ? this : other;
    Account hi = lo == this ? other : this;
    synchronized (lo.lock) {
        synchronized (hi.lock) { this.balance -= amt; other.balance += amt; }
    }
}
```

(Identity-hash collisions are rare but possible; production code uses a unique account id, or a tie-breaker "ordering lock," to keep the order strictly total.)
</details>

**Q49. Is there a deadlock here (Go)?**

```go
func process(jobs <-chan Job, mu *sync.Mutex, out chan<- Result) {
    for j := range jobs {
        mu.Lock()
        out <- compute(j)   // blocking channel send while holding the lock
        mu.Unlock()
    }
}
```

<details><summary>Answer</summary>

**Holding a lock across a blocking operation** — and it can deadlock. The send `out <- ...` blocks until a receiver is ready; if the consumer of `out` ever needs `mu` (directly, or indirectly) before it can receive, you have a cycle: this goroutine holds `mu` waiting to send, the consumer waits for `mu` before it can receive. Even without that cycle, holding `mu` across a blocking send needlessly serializes all workers behind channel backpressure. Fix: compute under the lock only if `compute` touches shared state, then release *before* sending:

```go
for j := range jobs {
    mu.Lock()
    r := compute(j)
    mu.Unlock()
    out <- r            // block on the channel with no lock held
}
```
</details>

**Q50. Name the granularity problem (Java).**

```java
class Registry {
    private final Map<String, Conn> conns = new HashMap<>();
    public synchronized Conn get(String k) { return conns.get(k); }
    public synchronized void put(String k, Conn c) { conns.put(k, c); }
    public synchronized int size() { return conns.size(); }
    public synchronized void ping(String k) { conns.get(k).ping(); } // ping() does network I/O
}
```

<details><summary>Answer</summary>

Two problems. (1) **Holding a lock during I/O** — `ping()` makes a network call while `synchronized` holds the single monitor, so every `get`/`put`/`size`/`ping` blocks for the network duration. (2) **Wrong (too coarse) granularity** — one monitor serializes all map operations even on different keys. Fix: use `ConcurrentHashMap` for lock-striped map access (no method-level monitor needed for get/put), and for `ping`, look up the connection under the (now fine) lock, release, then call `ping()` unlocked:

```java
private final Map<String, Conn> conns = new ConcurrentHashMap<>();
public Conn get(String k) { return conns.get(k); }
public void put(String k, Conn c) { conns.put(k, c); }
public int size() { return conns.size(); }
public void ping(String k) {
    Conn c = conns.get(k);          // concurrent, fine-grained
    if (c != null) c.ping();        // network call with no lock held
}
```
</details>

**Q51. Spot the subtle deadlock (Java callback).**

```java
class EventBus {
    private final List<Listener> listeners = new ArrayList<>();
    synchronized void register(Listener l) { listeners.add(l); }
    synchronized void publish(Event e) {
        for (Listener l : listeners) l.onEvent(e); // calls user code while holding the lock
    }
}
```

<details><summary>Answer</summary>

**Holding a lock while calling an alien (foreign) method** — a deadlock and reentrancy hazard. `publish` holds the `EventBus` monitor while invoking `l.onEvent`, which is *arbitrary user code*. If a listener calls back into `bus.register(...)` (same monitor — works only because `synchronized` is reentrant) or, worse, acquires *its own* lock that another thread holds while that thread is trying to `publish`, you get a lock-ordering deadlock across the bus lock and the listener's lock. Fix: don't hold the lock across the callback — snapshot the listeners under the lock, release, then notify:

```java
void publish(Event e) {
    List<Listener> snapshot;
    synchronized (this) { snapshot = new ArrayList<>(listeners); }
    for (Listener l : snapshot) l.onEvent(e);   // no lock held during callbacks
}
```
</details>

**Q52. Which anti-pattern, and is it actually wrong (Go)?**

```go
type Counter struct {
    mu sync.Mutex
    n  int64
}
func (c *Counter) Inc() { c.mu.Lock(); c.n++; c.mu.Unlock() }
```

<details><summary>Answer</summary>

Borderline **too-fine / wrong-primitive granularity** under contention — though it's *correct*. Protecting a single `int64` with a mutex works, but if `Inc` is hot and called from many goroutines, the mutex park/unpark and cache-line bouncing dominate a one-instruction increment. Prefer an atomic:

```go
type Counter struct{ n atomic.Int64 }
func (c *Counter) Inc() { c.n.Add(1) }
```

If even the single atomic's cache line is contended at extreme rates, shard into per-CPU/per-goroutine counters and sum on read (the `LongAdder` idea). Note the inverse: if the counter is *not* hot, the mutex version is perfectly fine and arguably clearer — don't optimize uncontended locks.
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q53. How do you prevent deadlock?**

<details><summary>Answer</summary>

There's no single answer — name the menu and the trade-offs (this is what separates a strong candidate from "use a global lock order"):

- **Global lock ordering** — acquire locks in one documented total order; breaks circular wait. The default for code that needs multiple locks.
- **Hold only one lock at a time** — restructure so locks never nest; breaks hold-and-wait. Simplest when feasible.
- **A single coarser lock** — collapse the locks; trades parallelism for guaranteed no cycle.
- **Lock-free / immutable / channels-actors** — remove the shared lock; breaks mutual exclusion.
- **`tryLock` + timeout/backoff** — detection-and-recovery for when ordering is impractical; breaks no-preemption.

The senior answer ties each to a Coffman condition and says *which* you'd use *when* — global ordering for owned code, detection for databases, message-passing to avoid the locks entirely.
</details>

**Q54. Is finer-grained locking always faster?**

<details><summary>Answer</summary>

No. It only helps when there's *real* contention and the protected work is large relative to lock overhead. Finer locks add per-lock acquisition cost, more memory, cache traffic (and false sharing), and — critically — reintroduce **lock ordering** problems and deadlock surface you didn't have with one lock. For short critical sections or low contention, one coarse lock is faster *and* simpler. Past a point you also hit the *over-fine* failure: the locks cost more than the work they protect. Profile, then split only the locks shown to be contended, along the axis of genuinely independent state.
</details>

**Q55. Why is holding a lock during a network call dangerous?**

<details><summary>Answer</summary>

Because you've made the lock's hold time equal to a latency you don't control. A network call is milliseconds-to-seconds (and can hang to a timeout, or forever without one), and *every* thread needing that lock is blocked for that entire window — so one slow dependency converts into a pile-up of stalled threads, and tail latency multiplies by contention. Two extra hazards: if the remote side can call back into code that needs the same lock you deadlock; and a connection with no timeout holds the lock indefinitely, which looks exactly like a deadlock in production. The cure is structural: copy what you need, release the lock, do the I/O, re-lock briefly to publish.
</details>

**Q56. What are the four conditions for deadlock?**

<details><summary>Answer</summary>

The **Coffman conditions**, all of which must hold at once: **mutual exclusion** (a resource is held non-shareably), **hold and wait** (a thread holds one resource while requesting another), **no preemption** (resources are released only voluntarily), and **circular wait** (a cycle of threads each waiting on the next). The reason interviewers love this: breaking *any one* prevents deadlock, so the follow-up is "which one does your fix break?" — global ordering breaks circular wait, single-lock-at-a-time breaks hold-and-wait, `tryLock`/abort breaks no-preemption, lock-free breaks mutual exclusion.
</details>

**Q57. "We added more locks and it got slower." How is that possible?**

<details><summary>Answer</summary>

Several ways, all real. (1) **Overhead exceeds work** — if critical sections are tiny, acquiring several fine locks costs more than the protected operation. (2) **False sharing** — packed locks share a cache line, so independent acquisitions thrash it between cores. (3) **More acquisitions per operation** — an op that now spans three fine locks does three lock/unlock cycles plus ordering, versus one before. (4) **New contention hotspots** — splitting can concentrate traffic onto one "hot" sub-lock. (5) **Convoys / scheduling effects** — more locks, more park/unpark churn. Finer locking is a *measured* optimization, not a reflex; without a contention profile it's as likely to regress as to help.
</details>

**Q58. Can you deadlock with a single lock?**

<details><summary>Answer</summary>

With a single *non-reentrant* lock, yes — by re-acquiring it on the same thread: a function locks `mu`, then calls another function that locks `mu` again; with Go's `sync.Mutex` (non-reentrant) the second `Lock()` blocks forever waiting for the first to release, which it never will. With a *reentrant* lock (Java `synchronized`/`ReentrantLock`) that specific self-deadlock can't happen. You can also "deadlock" a single lock by acquiring it and then blocking forever on something else (a channel/condition that's never signaled) while holding it — technically a hang, not a classic cycle, but the same frozen symptom. So "only one lock" rules out the *ordering* cycle, not every liveness failure.
</details>

**Q59. Channels in Go avoid locks — so they can't deadlock, right?**

<details><summary>Answer</summary>

Wrong — channels are a synchronization primitive and deadlock just as readily. An unbuffered send blocks until someone receives; if no goroutine ever receives (or two goroutines each wait to receive from the other before sending), all goroutines block and Go panics with `all goroutines are asleep - deadlock!`. Channels move you *away* from shared-memory lock-ordering bugs, but they introduce their own coordination cycles (send/receive dependencies, forgotten `close`, full buffered channels). "Don't communicate by sharing memory; share memory by communicating" changes the *shape* of the deadlock, not the possibility. The discipline of ordering and avoiding hold-and-wait applies to channel dependencies too.
</details>

**Q60. The database has a deadlock detector — so why should application code bother preventing deadlock?**

<details><summary>Answer</summary>

Because the DB only detects deadlocks among *its own* row/page locks; it knows nothing about your application-level mutexes, distributed locks, or the cycle that spans a DB lock *and* an in-process lock. It also recovers by **aborting a victim transaction**, which is correct but not free — the application must catch the deadlock error and retry, and frequent victims mean wasted work and latency spikes. So you still (1) order your DB lock acquisition (`SELECT ... FOR UPDATE ... ORDER BY id`) to avoid creating cycles, (2) keep transactions short and never hold DB locks across app-side I/O, and (3) order your in-process locks yourself, because no detector covers those. Detection is a safety net, not a substitute for prevention.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q61. One-line cure for each of the three?**

<details><summary>Answer</summary>

Lock-ordering deadlock → acquire all locks in one global order (or hold just one). Lock-during-I/O → copy data, release the lock, then do the I/O. Wrong granularity → start coarse, profile, split only the locks shown to be contended.
</details>

**Q62. The four Coffman conditions, in four words?**

<details><summary>Answer</summary>

Mutual-exclusion, hold-and-wait, no-preemption, circular-wait. Break any one → no deadlock.
</details>

**Q63. The fastest tell of a deadlock in monitoring?**

<details><summary>Answer</summary>

Throughput drops to zero while CPU sits near zero and thread/goroutine count stays pinned — hung but idle.
</details>

**Q64. Prevention vs. detection in one line?**

<details><summary>Answer</summary>

Prevention designs the cycle out (lock ordering); detection lets it happen and aborts a victim (databases). Application code prevents; databases detect.
</details>

**Q65. When does an RWLock beat a mutex?**

<details><summary>Answer</summary>

Read-heavy, write-rare, non-trivial critical sections. For a single value or write-heavy traffic, a mutex or atomic wins.
</details>

**Q66. Why doesn't Go's `-race` catch deadlocks?**

<details><summary>Answer</summary>

It detects *data races* (unsynchronized access); a deadlock is *correctly* synchronized code that never progresses — no race to find. Use goroutine dumps and the block/mutex profilers instead.
</details>

**Q67. Does the GIL prevent Python deadlocks?**

<details><summary>Answer</summary>

No. The GIL serializes bytecode, not your `threading.Lock`s; inconsistent lock order deadlocks in Python exactly as in Java or Go.
</details>

**Q68. Coarse vs. fine locking in one sentence?**

<details><summary>Answer</summary>

As coarse as correctness demands, as fine as contention requires — and not one lock finer.
</details>

**Q69. The single best way to avoid lock-ordering deadlock?**

<details><summary>Answer</summary>

Hold only one lock at a time; if you can't, acquire them in a documented global order.
</details>

---

## How to Talk About Coordination in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the failure mode, not the label.** Don't just say "deadlock" — say *"two threads each hold one lock and wait for the other; it's permanent and shows as a hung-but-idle process."* The mechanism is the signal.
- **Always name the trade-off.** Every fix here costs something: ordering needs discipline and documentation, copy-then-I/O opens a staleness window, finer locks add overhead and new deadlock surface. "It depends, and here's on what" beats absolutism.
- **Map fixes to Coffman conditions.** Saying "global ordering breaks circular wait; lock-free breaks mutual exclusion" demonstrates you understand *why* the fix works, not just that it does.
- **Insist on measuring before optimizing granularity.** "I'd start with one lock, ship it, then split only what the contention profile proves is hot" is a senior signal; reflexive fine-graining is a juniorism.
- **Show how you'd debug it in prod.** Thread/goroutine dumps, the wait-for cycle, block/mutex profilers, stress tests with jitter — this proves you've actually chased one, not just read about it.
- **Don't claim a primitive is a silver bullet.** Channels, RWLocks, the GIL, and DB deadlock detectors all have boundaries; knowing where each *doesn't* help is the deeper answer.
- **Use a concrete story.** "Our service deadlocked only at peak; the jstack dump showed a cache lock and a metrics lock taken in opposite orders on two paths — we leveled the locks and it never recurred" lands harder than any definition.

---

## Summary

- The three coordination anti-patterns are **liveness** failures, not correctness failures: the locking is race-free, yet threads fail to progress together (**deadlock**), or progress far too slowly (**lock-during-I/O**, **wrong granularity**).
- **Deadlock** needs all four Coffman conditions; breaking any one prevents it. In practice you break *circular wait* with a documented **global lock order** (or avoid *hold-and-wait* by holding one lock at a time); databases break *no-preemption* via detect-and-abort.
- **Holding a lock during I/O** multiplies an uncontrolled latency across every contending thread — the cure is structural: copy under the lock, release, do the I/O, re-lock briefly to publish, adding single-flight or version checks if the unlocked window matters.
- **Granularity** is a measured trade: too coarse caps scalability (Amdahl's serial fraction); too fine adds overhead, false sharing, and new ordering bugs. Start coarse, profile, and split only proven hotspots — finer is not automatically faster.
- The deep layer is the *cost of contention itself*: cache-line ping-pong, park/unpark context switches, convoys, and the fairness-vs-throughput trade. Locks also provide memory visibility (happens-before), so you can't shrink a critical section into incorrectness.
- The strongest answers lead with the **mechanism and cost**, name the **trade-off**, map cures to **Coffman conditions**, and **measure before** optimizing granularity.

---

## Related Topics

- [`junior.md`](junior.md) — recognize each coordination failure and why it's hard to reproduce.
- [`middle.md`](middle.md) — lock ordering, copy-then-I/O, and sizing locks; the everyday countermoves.
- [`senior.md`](senior.md) — prevention vs. detection, lock hierarchies, debugging a deadlock in prod.
- [`professional.md`](professional.md) — contention cost, convoys, mutex internals, memory ordering.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — practice the diagnosis and the fix.
- [Synchronization Misuse](../01-synchronization/interview.md) — double-checked locking, volatile misuse, race-prone lazy init.
- [Shared State](../README.md) — unprotected shared mutable state, busy-waiting, unbounded thread-per-request (see the chapter overview).
- [Async Anti-Patterns](../../04-async/README.md) — the single-threaded event-loop sibling chapter (async deadlocks).
- [Concurrency Anti-Patterns (chapter)](../README.md) — how all nine relate, rooted in shared mutable state.
- [Clean Code → Concurrency](../../../clean-code/11-concurrency/README.md) — positive patterns: keep critical sections small, prefer immutability.
- [Clean Code → Immutability](../../../clean-code/14-immutability/README.md) — the structural cure that removes the shared writes (and the locks) entirely.
- [Distributed Systems](../../../../../Backend/distributed-systems/README.md) — coordination, locking, and deadlock at the network scale.
