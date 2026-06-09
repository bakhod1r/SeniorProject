# Shared State Anti-Patterns — Interview Q&A

> **Category:** [Concurrency Anti-Patterns](../README.md) → **Shared State** — *mutable data crosses threads without protection, or with the wrong protection.*
> **Covers (collectively):** Shared Mutable State Without Protection · Busy Waiting / Spin Loop · Thread-Per-Request Without Bounds

A bank of 60+ interview questions and answers on the shared-state family of concurrency bugs — data races, polling vs. blocking, and unbounded concurrency. Examples are in **Go** and **Java** primarily, with a **Python GIL** note where it matters. Each answer models the reasoning a strong candidate gives, trade-offs included. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Architecture & Capacity](#senior--architecture--capacity)
4. [Professional / Deep — Hardware, Scheduling, Queueing](#professional--deep--hardware-scheduling-queueing)
5. [Code-Reading — Diagnose the Snippet](#code-reading--diagnose-the-snippet)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [How to Talk About Concurrency in Interviews](#how-to-talk-about-concurrency-in-interviews)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, recognition, and the "why is it dangerous" reasoning.

**Q1. Name the three shared-state anti-patterns and give a one-line symptom for each.**

<details><summary>Answer</summary>

- **Shared Mutable State Without Protection** — two or more threads/goroutines read and write the same variable with no lock or channel; works 99% of the time, then silently corrupts.
- **Busy Waiting / Spin Loop** — `while (!done) {}` burns a CPU core polling a flag instead of blocking until the event happens.
- **Thread-Per-Request Without Bounds** — a fresh OS thread (or goroutine) per incoming request, with no cap; under load the scheduler thrashes or memory exhausts.

The common thread: each is a failed way of *coordinating access to mutable state across parallel execution*. The first corrupts state, the second wastes the CPU waiting on state, the third floods the machine with workers contending for state.
</details>

**Q2. What is a data race, precisely?**

<details><summary>Answer</summary>

A data race is when **two or more threads access the same memory location concurrently, at least one access is a write, and there is no synchronization (happens-before relationship) ordering them.** All three conditions are required: concurrent + same location + ≥1 write + unordered. In most memory models (Go, C/C++, Java for non-`volatile` fields) a data race is **undefined behavior** — not merely "you might read a stale value," but "the compiler and CPU were allowed to assume this never happens," so results can be arbitrary. The fix is to introduce ordering: a mutex, an atomic, a channel send/receive, or by not sharing the data at all.
</details>

**Q3. What's the difference between a data race and a race condition?**

<details><summary>Answer</summary>

They overlap but aren't synonyms. A **data race** is the specific low-level event above: unsynchronized concurrent access with a write. A **race condition** is the broader logical bug where *correctness depends on timing/interleaving* — the program can produce the wrong answer depending on who goes first. You can have a race condition with *no* data race: e.g. a check-then-act across two separately-atomic operations (`if !exists(k) { put(k,v) }`) where each call is individually thread-safe but the gap between them lets two threads both pass the check. Removing data races (add locks) does not automatically remove race conditions (you must also widen the critical section to cover the whole invariant).
</details>

**Q4. Why is shared mutable state without protection so dangerous if the code "works on my machine"?**

<details><summary>Answer</summary>

Because the failure is **intermittent and timing-dependent**, so absence of a crash is not evidence of correctness. On your laptop the threads happen to interleave benignly; in production — different core count, load, scheduler, CPU memory ordering — the bad interleaving finally occurs, perhaps once in 10,000 runs. You can't reproduce it with an ordinary unit test because the test would have to *encode the exact interleaving* to trigger it. Worse, since a race is undefined behavior, the symptom can be far from the cause: a torn read here surfaces as a corrupted map three functions away. This is why the cure is structural (eliminate sharing, or add real synchronization) and the detection tool is a race detector, not eyeballing.
</details>

**Q5. Show the classic `counter++` race in Go and explain why it loses increments.**

<details><summary>Answer</summary>

```go
var counter int
var wg sync.WaitGroup
for i := 0; i < 1000; i++ {
    wg.Add(1)
    go func() { defer wg.Done(); counter++ }() // RACE
}
wg.Wait()
fmt.Println(counter) // almost never 1000
```

`counter++` is not atomic — it compiles to **read, add one, write back** (three steps). Two goroutines can both read `41`, both compute `42`, and both write `42`; one increment is lost. With 1000 goroutines you reliably end up below 1000. Fixes: `atomic.AddInt64(&counter, 1)` for a plain counter, a `sync.Mutex` around the increment, or restructure so each goroutine returns its own count and you sum the results. `go run -race` flags this instantly.
</details>

**Q6. Show the same race in Java and the two standard fixes.**

<details><summary>Answer</summary>

```java
class Counter {
    private int n = 0;
    void inc() { n++; }        // RACE: read-modify-write, not atomic
    int get() { return n; }
}
```

Two fixes:

```java
// 1. Lock the read-modify-write:
synchronized void inc() { n++; }
synchronized int get() { return n; }

// 2. Use an atomic and skip the lock entirely:
private final AtomicInteger n = new AtomicInteger();
void inc() { n.incrementAndGet(); }
int get() { return n.get(); }
```

Note that making `n` merely `volatile` is **not** enough: `volatile` gives visibility and ordering for a *single* read or write, but `n++` is still three operations, so two threads still lose increments. `volatile` fixes "stale value" bugs, not "lost update" bugs.
</details>

**Q7. What does `volatile` (Java) / `atomic` actually guarantee, and what does it not?**

<details><summary>Answer</summary>

`volatile` in Java guarantees **visibility** (a write is seen by other threads on their next read) and **ordering** (it acts as a memory barrier, preventing reordering across it). It does **not** provide **atomicity of compound operations** — `volatile` `n++`, `if (flag) flag = false`, and `x = x + 1` are all still races. Atomics (`AtomicInteger`, `atomic.Int64`) add atomic read-modify-write (`incrementAndGet`, `compareAndSet`) on top of that. The rule of thumb: use `volatile`/atomic load-store only for a **single independent flag or counter**; the moment correctness spans more than one variable or a read-then-write, you need a lock or a CAS loop.
</details>

**Q8. What is busy waiting, and why is it usually wrong?**

<details><summary>Answer</summary>

Busy waiting (a spin loop) is repeatedly checking a condition in a tight loop instead of blocking until it becomes true:

```go
for !done { } // burns a whole CPU core doing nothing useful
```

It's usually wrong because it **wastes a CPU core**, starves other runnable work, drains battery, and on a single-core / GOMAXPROCS=1 setting can *deadlock* — the spinning thread never yields, so the thread that would set `done` never runs. The right tool wakes you *on the event*: a condition variable, a channel, a `WaitGroup`, a semaphore, or a `Future`. You should block (park) the thread so the OS can schedule real work, and be woken when the state actually changes.
</details>

**Q9. What's the channel-based fix for "wait until a worker finishes" in Go?**

<details><summary>Answer</summary>

Don't poll a `done` flag — block on a channel that the worker closes or sends to:

```go
done := make(chan struct{})
go func() {
    work()
    close(done) // signal completion
}()
<-done // blocks here, zero CPU, woken when closed
```

The receiving goroutine is parked by the runtime and consumes no CPU until `close(done)` makes the receive return. For "wait for N workers," use `sync.WaitGroup` (`wg.Add(n)`, each worker `wg.Done()`, the waiter `wg.Wait()`). Both express "wake me on the event" instead of "ask repeatedly."
</details>

**Q10. What is thread-per-request, and why is it tempting?**

<details><summary>Answer</summary>

Thread-per-request handles each incoming request by spawning a dedicated thread (or, in Go, a goroutine): `for conn := accept(); go handle(conn)`. It's tempting because it's the **simplest possible model** — the code reads top-to-bottom synchronously, each request gets its own isolated stack, and you never reason about callbacks or state machines. The problem is the *unbounded* version: with no cap, a traffic spike or slow downstream causes threads/goroutines to pile up faster than they drain, and you exhaust memory (each OS thread is ~1 MB of stack) or drown the scheduler in context switches. The model is fine; the missing piece is a *bound*.
</details>

**Q11. Roughly how much does an OS thread cost versus a goroutine?**

<details><summary>Answer</summary>

An **OS thread** reserves on the order of **~1 MB** of stack (often the default on Linux), plus kernel bookkeeping, and switching between them is a kernel-mode context switch costing ~1 µs and trashing CPU caches. So tens of thousands of threads is already painful, and the JVM thread-per-request model historically caps out in the low thousands. A **goroutine** starts at ~**2–8 KB** of stack that grows on demand, is scheduled in user space by the Go runtime (M:N onto a small pool of OS threads), and switches far more cheaply. That's why Go can run *millions* of goroutines — but cheap is not free (see Q33), so even goroutines must be bounded under load.
</details>

**Q12. What is the simplest way to "protect" shared state — and what's the catch?**

<details><summary>Answer</summary>

The simplest *real* fix is often to **not share it** rather than to lock it. Pass data by value, give each worker its own copy, or confine the mutable state to a single goroutine/thread that owns it. A `sync.Mutex` around every access also works, but it's a heavier tool: you must remember to lock *every* access (one missed read reintroduces the race), you risk deadlock and contention, and the lock becomes a bottleneck. The catch with locking is that it's *opt-in and easy to forget*; the catch with not-sharing is that it sometimes requires restructuring data flow. Prefer eliminating sharing; lock what genuinely must be shared.
</details>

**Q13. Why can't you reproduce most data races with a normal unit test?**

<details><summary>Answer</summary>

Because the bug only manifests under a *specific interleaving* of thread execution that the scheduler produces non-deterministically. A normal test runs the code once, the threads happen to interleave benignly, the test passes — and it passes the next thousand times too, right until production hits the bad ordering. To trigger it on demand you'd have to control the scheduler to force the harmful interleaving, which ordinary tests don't do. That's why you instead use a **race detector** (`go test -race`, Java's tooling / `jcstress`, ThreadSanitizer), which watches *every* memory access and reports a race the instant it sees unsynchronized concurrent access — even on an interleaving that didn't actually corrupt anything this run.
</details>

---

## Intermediate / Middle

> Detection, the safer patterns, and the trade-offs between them.

**Q14. What is "confinement" and how does it eliminate the need for locks?**

<details><summary>Answer</summary>

Confinement means a piece of mutable state is **only ever accessed by one thread/goroutine**, so there's no concurrent access and therefore no possible data race — no lock required. Forms: **stack confinement** (the data is a local variable, never escaping the function); **thread/goroutine confinement** (one owner goroutine holds the state and others communicate with it by message); and **ownership transfer** (a value is handed off via a channel and the sender stops touching it). Go's idiom "don't communicate by sharing memory; share memory by communicating" is exactly goroutine confinement plus ownership transfer. The win: correctness by construction, not by remembering to lock.
</details>

**Q15. Channels vs. mutexes in Go — when do you reach for which?**

<details><summary>Answer</summary>

Use a **mutex** when you're protecting *state* — a cache, a counter, a map — where threads need shared mutable access to the same in-memory structure and the critical sections are short. Use a **channel** when you're transferring *ownership of data* or *coordinating* between goroutines — a pipeline stage handing work to the next, a worker pool pulling jobs, fan-in/fan-out, or signaling completion/cancellation. The Go proverb captures the bias ("share memory by communicating"), but the team's own guidance is pragmatic: a `sync.Mutex` guarding a struct field is often simpler and faster than wrapping it in a goroutine + channel. Rule of thumb: *moving data* → channel; *guarding data in place* → mutex.
</details>

**Q16. Condition variable vs. spin loop — what's the difference and when is each appropriate?**

<details><summary>Answer</summary>

A **spin loop** polls in a tight CPU-burning loop; a **condition variable** lets a thread *block* (the OS deschedules it) until another thread signals the condition changed, then wakes it. The condvar is almost always correct: it consumes zero CPU while waiting and wakes promptly on `signal`/`broadcast`. Pattern (always check the predicate in a `while`, never `if`, to handle spurious wakeups):

```java
synchronized (lock) {
    while (!ready) lock.wait();  // releases lock, parks thread, re-acquires on wake
    consume();
}
```

A spin is only appropriate in narrow cases: extremely short, *known-microsecond* waits on multiprocessor hardware where the cost of parking + waking exceeds the spin (see Q31), and even then you bound it and fall back to parking.
</details>

**Q17. What is a worker pool, and what problem does it solve?**

<details><summary>Answer</summary>

A worker pool is a **fixed (or bounded) set of long-lived workers** that pull tasks from a shared queue, instead of spawning a new thread/goroutine per task. It directly cures unbounded thread-per-request: concurrency is capped at the pool size, so memory and scheduler load stay bounded regardless of arrival rate; excess work waits in the queue (and you can bound the queue too, shedding load when it's full). It also amortizes worker creation cost. In Go:

```go
jobs := make(chan Job, 100)
for i := 0; i < runtime.NumCPU(); i++ {  // bounded workers
    go func() { for j := range jobs { process(j) } }()
}
```

In Java you'd use a `ThreadPoolExecutor` / `Executors.newFixedThreadPool(n)` with a bounded queue and an explicit rejection policy.
</details>

**Q18. How do you bound concurrency in Go without a full worker pool?**

<details><summary>Answer</summary>

Use a **counting semaphore implemented as a buffered channel** — a "token bucket" of slots. You keep the simple goroutine-per-request shape but cap how many run at once:

```go
sem := make(chan struct{}, 100) // at most 100 concurrent
for req := range requests {
    sem <- struct{}{}            // acquire (blocks when full)
    go func(r Req) {
        defer func() { <-sem }() // release
        handle(r)
    }(req)
}
```

Acquiring a token blocks once 100 are in flight, applying natural backpressure. `golang.org/x/sync/semaphore` and `errgroup.Group.SetLimit` provide the same with nicer ergonomics and error propagation. This is the minimal-change fix when "just spawn a goroutine" was *almost* right.
</details>

**Q19. What is backpressure and why does it matter for thread-per-request?**

<details><summary>Answer</summary>

Backpressure is the system **pushing back on producers when it can't keep up** — blocking, queuing with a bound, or rejecting — instead of accepting unbounded work. It matters because unbounded thread-per-request has *no* backpressure: the server accepts every request and spawns a worker, so when demand exceeds capacity, work accumulates until the machine falls over (OOM, GC death spiral, scheduler collapse) and *all* requests fail, including ones it could have served. A bounded pool with a bounded queue provides backpressure: once full, new requests block or get a fast `503`, which keeps the served fraction healthy and lets clients retry/shed. Failing fast and partially beats failing slowly and totally.
</details>

**Q20. A read-heavy shared map is contended under a single mutex. What are your options?**

<details><summary>Answer</summary>

Several, in rough order of escalation: (1) **`sync.RWMutex`** — many concurrent readers, exclusive writers; helps when reads vastly outnumber writes and the critical section is long enough to amortize the heavier RWMutex bookkeeping. (2) **`sync.Map`** (Go) / `ConcurrentHashMap` (Java) — purpose-built concurrent maps; `sync.Map` is tuned for write-once-read-many or disjoint-key access, `ConcurrentHashMap` uses lock striping for general concurrent use. (3) **Sharding / lock striping** — split the map into N shards each with its own lock, so unrelated keys don't contend. (4) **Copy-on-write / immutable snapshot** — readers get a lock-free immutable map, writers swap in a new version via an atomic pointer. Measure first: an `RWMutex` can be *slower* than a plain `Mutex` for short critical sections because of its extra accounting.
</details>

**Q21. How do you detect these problems before production?**

<details><summary>Answer</summary>

- **Data races:** run with a race detector — `go test -race` / `go run -race` (instruments memory accesses; ~5–10× slower, run it in CI), Java's `jcstress` for stress-testing memory-model assumptions and ThreadSanitizer for native code. Treat any race report as a release blocker.
- **Busy waiting:** CPU profiling (`pprof`, async-profiler) shows a hot spin loop as a function pegging a core doing no work; a core stuck at 100% with no throughput is the tell.
- **Unbounded threads:** monitor goroutine/thread count (`runtime.NumGoroutine`, JMX thread count) and watch for unbounded growth; a goroutine-count graph that only goes up is a leak or an unbounded spawn.

The race detector is the highest-leverage tool here — it finds the undefined-behavior bugs that no amount of testing reliably reproduces.
</details>

**Q22. Does adding a lock around each access guarantee correctness?**

<details><summary>Answer</summary>

No — it removes *data races* but not necessarily *race conditions*. If your invariant spans multiple operations, locking each one individually still lets another thread interleave between them. Classic example: `if (!map.containsKey(k)) map.put(k, v);` with a thread-safe map still double-inserts, because the gap between the (atomic) `containsKey` and the (atomic) `put` is unprotected. Correctness requires the lock to cover the *whole invariant* — the entire check-then-act — as one critical section (or use an atomic compound primitive like `putIfAbsent` / `computeIfAbsent`). Locking the wrong granularity is its own anti-pattern; the lock must match the unit of consistency, not the unit of access.
</details>

**Q23. Show the check-then-act race and fix it in Java.**

<details><summary>Answer</summary>

```java
// RACE CONDITION even with a thread-safe map:
if (!cache.containsKey(k)) {        // thread A and B both see false
    cache.put(k, expensiveLoad(k)); // both compute and store
}
```

Two threads both pass the check and both run `expensiveLoad`. Fix with an atomic compound operation that closes the gap:

```java
cache.computeIfAbsent(k, key -> expensiveLoad(key)); // atomic check-and-insert
```

`ConcurrentHashMap.computeIfAbsent` guarantees the mapping function runs at most once per absent key, holding the bin lock across check-and-act. The general lesson: prefer a single atomic operation that expresses the whole invariant over two individually-safe calls with a window between them.
</details>

**Q24. Why is `time.Sleep` in a polling loop still busy waiting (sort of), and what's better?**

<details><summary>Answer</summary>

`for !done { time.Sleep(10 * time.Millisecond) }` is *less* harmful than a tight spin — it yields the CPU between checks — but it's still a poll, and it trades CPU for **latency and wasted wakeups**. You pay up to one full sleep interval of latency after the event occurs, and you wake repeatedly to re-check even when nothing changed. Tuning the interval just moves the pain: short → more CPU/wakeups, long → more latency. The better tool blocks on the event itself — a channel receive, `sync.Cond`, or a `WaitGroup` — giving you *zero* idle CPU *and* immediate wakeup. Sleep-polling is acceptable only when you genuinely can't get an event to wait on (e.g. polling an external resource that offers no notification).
</details>

**Q25. What's wrong with a goroutine leak, and how does it relate to unbounded spawning?**

<details><summary>Answer</summary>

A goroutine leak is a goroutine that **blocks forever and never exits** — typically stuck sending/receiving on a channel no one will ever touch, often because the consumer returned early (timeout, error) without draining. It relates to unbounded spawning because both manifest as *monotonically growing goroutine count*: unbounded spawn creates them faster than they finish; a leak creates them and they never finish. Both exhaust memory eventually. The cures rhyme: bound concurrency, and make every goroutine's exit *guaranteed* — use `context` for cancellation, ensure channels get closed/drained, and never start a goroutine without knowing how it stops. "How does this goroutine end?" should always have an answer.
</details>

**Q26. Immutability as a concurrency tool — how does it help here?**

<details><summary>Answer</summary>

If shared data is **immutable**, there's no write after publication, so the data-race condition ("at least one write") can never be met — unlimited threads can read it lock-free, forever, safely. This is why functional and actor-style systems lean on immutable values: you eliminate a whole class of bugs by construction rather than guarding against them. The pattern for mutable-looking state is **copy-on-write**: never mutate in place; produce a new immutable version and publish it via a single atomic pointer swap, so readers always see a complete, consistent snapshot. The cost is allocation/GC pressure from copying, which is usually a fine trade for read-heavy data. (See [Clean Code → Immutability](../../../clean-code/14-immutability/).)
</details>

**Q27. What's the difference between blocking and parking a thread?**

<details><summary>Answer</summary>

They're often used interchangeably, but precisely: **parking** is the act of the runtime/OS *descheduling* a thread so it consumes no CPU until woken (`LockSupport.park` in Java, the Go scheduler moving a goroutine off its OS thread on a channel block). **Blocking** is the higher-level concept of "this operation can't proceed yet, so the caller waits" — which is *implemented* by parking. The contrast that matters for this topic is parking vs. **spinning**: a spinning thread "waits" while still running on the CPU; a parked thread waits while off the CPU. The cost trade-off — park/unpark involves a syscall and a scheduler round-trip (~1 µs), spinning wastes cycles but reacts instantly — is exactly the adaptive-locking question in Q31.
</details>

---

## Senior — Architecture & Capacity

> System-level cures, capacity math, and the C10k lineage.

**Q28. Contrast the Actor model and CSP. How do they attack shared mutable state?**

<details><summary>Answer</summary>

Both **eliminate shared mutable state by replacing it with message passing**, but they differ in what's named. In the **Actor model** (Erlang, Akka), each actor owns private state no one else can touch, has a mailbox, and processes one message at a time — you address *the actor* (by identity/PID) and send it a message. In **CSP** (communicating sequential processes — the Go heritage via Hoare), processes are anonymous and you name *the channel*; synchronization happens at the rendezvous of send and receive. Practically: actors decouple sender and receiver in time (async mailbox, location transparency, supervision trees), while CSP channels are about composing pipelines of processes. Both make the single-writer principle structural: state has one owner, mutated only by serialized messages, so there's nothing to lock.
</details>

**Q29. What is the single-writer principle and why is it powerful?**

<details><summary>Answer</summary>

The single-writer principle says: **let exactly one thread own and mutate a given piece of state; everyone else communicates with that owner.** It's powerful because it removes write-write and read-write contention entirely for that state — the owner never needs a lock for its own data, mutations are naturally serialized, and you reason about that state as if single-threaded. It underlies actors, CSP-style "owner goroutine + channel," the LMAX Disruptor (single writer to the ring buffer hits millions of ops/sec lock-free), and database write paths. The trade-off is that the single writer can become a throughput ceiling, so you partition state across multiple single-writers (sharding) when one isn't enough. "Don't share writable state; designate an owner" is the senior reframing of the whole category.
</details>

**Q30. What was the C10k problem and how does it inform modern server design?**

<details><summary>Answer</summary>

C10k (Dan Kegel, ~1999) was the challenge of handling **10,000 concurrent connections on one server**. The thread-per-connection model couldn't: 10,000 threads × ~1 MB stacks is ~10 GB of RAM, and the scheduler drowns in context switches — connection handling scaled with *connection count* rather than *active work*. The fix was **event-driven, non-blocking I/O** with readiness notification (`epoll`/`kqueue`) on a small thread pool, so one thread multiplexes thousands of mostly-idle connections. This is the direct ancestor of Node's event loop, Nginx, Netty, and Go's runtime (which gives you the *thread-per-request programming model* on top of an *epoll event loop underneath* — you write blocking-looking goroutine code, the runtime multiplexes it). The lesson that informs design today: **scale with the amount of work, not the number of connections**, and never let concurrency be unbounded by client count.
</details>

**Q31. Apply Little's Law to size a worker pool / connection pool.**

<details><summary>Answer</summary>

Little's Law: **L = λ × W** — the average number of in-flight requests (L) equals arrival rate (λ) times average time in system (W). It directly sizes concurrency. Example: 2,000 requests/sec, each holding a worker for 50 ms (0.05 s) → L = 2000 × 0.05 = **100 concurrent requests** in flight on average, so you need ~100 workers (plus headroom for variance) to keep up without queue growth. If you only provision 50, the queue grows without bound (you're under capacity) and latency explodes. Flip it to find max throughput from a fixed pool: with 100 workers and W = 50 ms, λ_max = L / W = 100 / 0.05 = **2,000 req/s**. This is the senior answer to "how big should the pool be?" — measure W, know your λ, compute L; don't guess.
</details>

**Q32. How do you choose a pool size for CPU-bound vs. I/O-bound work?**

<details><summary>Answer</summary>

The bottleneck differs, so the sizing rule differs. **CPU-bound** work: the pool size should be ≈ **number of cores** (`runtime.NumCPU()`, `Runtime.availableProcessors()`); more threads than cores just adds context-switch overhead and cache thrash without doing more work — they can't run in parallel anyway. **I/O-bound** work: threads spend most of their time *waiting* (network, disk), so you want **many more than cores** to keep the CPU busy while others block — sized by Little's Law from the wait time (a useful starting heuristic: `cores × (1 + wait_time/compute_time)`). Mixed workloads should be split into separate pools so a slow I/O class can't starve CPU work. And always **bound** the I/O pool — "lots more than cores" is not "unbounded."
</details>

**Q33. "Goroutines are cheap, so why bound them?" — give the senior answer.**

<details><summary>Answer</summary>

Cheap is not free, and the goroutine itself is rarely the scarce resource — what it *holds* is. Each goroutine handling a request typically grabs a DB connection, a file handle, memory buffers, or a downstream RPC slot; a million goroutines means a million attempts to grab those *bounded* resources, so you move the exhaustion from "stack memory" to "connection pool / file descriptors / downstream service." Unbounded goroutines also defeat **backpressure**: the system accepts work it can't complete, latency climbs, and you get a death spiral instead of graceful degradation. And the runtime scheduler, GC, and stack-growth machinery do have per-goroutine cost at the millions scale. So bounding isn't about goroutine cost — it's about *protecting the constrained resources behind them and preserving backpressure*. The bound should reflect the narrowest downstream limit.
</details>

**Q34. How do you make a contended hot path scale without one giant lock?**

<details><summary>Answer</summary>

Reduce or eliminate the sharing rather than just shrinking the critical section. Techniques, roughly in order: **shard/stripe** the state so unrelated keys hit different locks (kills false contention between independent work); **per-CPU / thread-local accumulation** with periodic merge (e.g. sharded counters summed on read — great for write-heavy metrics); **read-mostly snapshots** via copy-on-write + atomic pointer swap so readers are lock-free; **lock-free structures** (CAS-based queues/stacks) where the access pattern fits; and the structural cure, **single-writer** — funnel all mutation through one owner goroutine so there's no lock at all. Always profile first: contention shows up as threads parked on the same lock (`pprof` block/mutex profiles, `perf` lock contention). The biggest wins usually come from *not sharing*, not from a cleverer lock.
</details>

**Q35. When is shared mutable state with locks actually the right choice over channels/actors?**

<details><summary>Answer</summary>

When the state is genuinely shared, the critical sections are short, and message-passing would add overhead or obscure the code. A `sync.Mutex` guarding a small in-memory cache or counter is simpler, lower-latency, and easier to reason about than spinning up an owner goroutine and routing every access through a channel — the channel adds an allocation, a context switch, and indirection for no benefit. Channels/actors win when you're *transferring ownership*, building *pipelines*, or coordinating across *failure/cancellation* boundaries; locks win for *in-place shared data with short critical sections*. The senior signal is rejecting dogma ("always use channels") and choosing by the shape of the access. Go's own standard library is full of `sync.Mutex`.
</details>

**Q36. How does cancellation/timeout fit into bounding concurrency?**

<details><summary>Answer</summary>

Bounding the *number* of workers is necessary but not sufficient — you also need to bound how *long* each holds its slot, or one slow downstream call ties up the whole pool indefinitely (the bound becomes useless). Propagate a **`context.Context` with a deadline** (Go) or an interruptible/timeout-aware call (Java `Future.get(timeout)`, structured concurrency) through every blocking operation, so a stuck request releases its worker, connection, and memory instead of pinning them. This is the difference between a pool that degrades gracefully under a slow dependency and one that fully stalls: timeouts convert "wait forever" into "fail fast, free the slot, shed load." Bounding concurrency and bounding latency are two halves of the same capacity-protection mechanism.
</details>

---

## Professional / Deep — Hardware, Scheduling, Queueing

> Memory hardware, scheduler internals, and the math behind the cures.

**Q37. What is false sharing, and why does it slow down code with no logical contention?**

<details><summary>Answer</summary>

False sharing happens when two threads update **different variables that happen to live on the same CPU cache line** (typically 64 bytes). There's no logical contention — they touch distinct data — but the cache-coherence protocol (MESI) operates at cache-line granularity, so each write *invalidates the whole line* in the other core's cache, forcing it to refetch. The two cores ping-pong the line back and forth across the interconnect, and throughput collapses even though the algorithm is "lock-free" and "independent." Classic case: an array of per-thread counters packed contiguously. The fix is **padding/alignment** so each hot variable sits on its own cache line (Java's `@Contended` / manual padding, Go struct padding, `cache_line_size`-aligned allocation). It's a top "my lock-free code is mysteriously slow" answer.
</details>

**Q38. Show false sharing concretely and the padding fix.**

<details><summary>Answer</summary>

```go
// FALSE SHARING: counters[0] and counters[1] share a 64-byte cache line.
// Two goroutines each hammering its own index still ping-pong the line.
type counters struct { a, b int64 }

// FIX: pad so each counter occupies its own cache line.
type paddedCounters struct {
    a int64
    _ [56]byte // 8 (int64) + 56 = 64 bytes → next field on a new line
    b int64
    _ [56]byte
}
```

In Java the equivalent is `@jdk.internal.vm.annotation.Contended` (or `@sun.misc.Contended`) on the field, which the JVM pads automatically. The general principle: **hot, independently-written fields accessed by different cores must not share a cache line.** This only matters on genuinely hot paths; padding everything wastes memory and cache. Measure with `perf c2c` / hardware counters before padding.
</details>

**Q39. Spin vs. park: how do real lock implementations decide, and why?**

<details><summary>Answer</summary>

Production locks **adaptively spin a little, then park.** The reasoning is a cost comparison: parking (descheduling + later waking) costs a syscall and a scheduler round-trip (~1 µs) plus cache effects; spinning wastes CPU but reacts in nanoseconds. If the lock is held only briefly (microseconds), a short spin lets you grab it without ever paying the park/unpark cost — *cheaper to burn a few hundred cycles than to context-switch*. If it's held long, spinning would waste an entire timeslice, so you park. So implementations spin for a **bounded** number of iterations (often informed by whether the lock holder is currently running on another core), then fall back to parking. Go's `sync.Mutex` does exactly this (active spinning under conditions, then semaphore park); the JVM does adaptive/biased-then-spin-then-park. The takeaway: bounded spinning is a legitimate *optimization inside a blocking primitive* — not the same thing as a naive busy-wait loop in application code.
</details>

**Q40. So — is busy waiting *ever* the right answer?**

<details><summary>Answer</summary>

Yes, in narrow, expert contexts: a **bounded** spin is correct when the expected wait is shorter than the cost of parking and waking (sub-microsecond), on a **multiprocessor** where the thread you're waiting on can run on another core simultaneously (spinning on a uniprocessor just starves the very thread you need). Examples: the spin phase inside an adaptive mutex (Q39), spinlocks in kernel/interrupt context where you *can't* sleep, lock-free CAS retry loops, and ultra-low-latency systems (HFT, the LMAX Disruptor busy-spins a consumer to shave microseconds off wakeup latency, trading a dedicated core for determinism). The disqualifiers: unbounded spins, spinning while holding nothing useful for milliseconds, and spinning on a single core. The application-code `for !done {}` is almost never in the legitimate set — that's the anti-pattern.
</details>

**Q41. Does Python's GIL eliminate data races?**

<details><summary>Answer</summary>

No. The Global Interpreter Lock serializes execution of *bytecode* — only one thread runs Python bytecode at a time — which makes a *single* bytecode operation effectively atomic. But it does **not** make *compound* operations atomic, because the interpreter can release the GIL **between** bytecodes (every few instructions / on I/O). So `counter += 1` is still a race: it's `LOAD`, `ADD`, `STORE`, and a thread switch can land between `LOAD` and `STORE`, losing updates exactly like Go/Java. Same for `list += [x]` followed by a length check, or check-then-act on a dict. You still need `threading.Lock` for compound invariants. The GIL also doesn't help with C-extension data structures or shared state across processes. And the free-threaded builds (PEP 703, removing the GIL) make this even more explicit. The GIL prevents *interpreter-internal* corruption and limits true parallelism — it is not a correctness substitute for synchronization.
</details>

**Q42. Why does an unbounded queue in front of a worker pool *not* save you?**

<details><summary>Answer</summary>

Because an unbounded queue converts a **throughput problem into a latency-and-memory problem**, which is worse. By Little's Law, if arrival rate λ exceeds service rate µ, the queue length grows without bound; an unbounded queue happily absorbs that growth, so memory climbs until OOM, *and* every queued item's wait time grows unboundedly — by the time a request is serviced, the client has long since timed out, so you do work whose result no one wants (congestion collapse). A **bounded** queue forces the decision early: when full, you apply backpressure or shed load (reject with `503`), keeping latency bounded and the served fraction healthy. This is why `Executors.newFixedThreadPool` (which uses an *unbounded* `LinkedBlockingQueue`) is a footgun — you want a bounded queue with an explicit `RejectedExecutionHandler`. Unbounded queues hide overload instead of handling it.
</details>

**Q43. What does queueing theory say about running a pool near 100% utilization?**

<details><summary>Answer</summary>

Don't. For a queueing system, the average wait time scales roughly as **1 / (1 − ρ)** where ρ is utilization — so latency stays modest up to ~70–80% utilization, then climbs to a *vertical asymptote* as ρ → 1. Pushing a pool to 95% utilization to "use the hardware fully" multiplies queue wait and tail latency catastrophically: the difference between ρ=0.8 and ρ=0.95 is a ~4× jump in expected wait, and variance (the p99) is far worse. This is why capacity planning targets utilization in the 50–70% range and why autoscaling triggers well below saturation. It also reframes the thread-per-request cure: you don't size the pool to *just* meet average demand (ρ≈1), you leave headroom so the system stays on the flat part of the curve. Saturation is where latency goes nonlinear.
</details>

**Q44. How does the Go scheduler turn thread-per-request into something sustainable, and where are its limits?**

<details><summary>Answer</summary>

Go's runtime is an **M:N scheduler**: M goroutines multiplexed onto N OS threads (N≈`GOMAXPROCS`), with a work-stealing run queue per processor (P). When a goroutine blocks on a channel or runtime-aware I/O, the scheduler parks it and runs another on the same OS thread — so you get the simple synchronous *programming model* of thread-per-request over an *event-loop-like* execution model, sidestepping C10k. Limits: (1) a goroutine making a **blocking syscall** (or calling into cgo) parks a whole OS thread, and the runtime spins up another to keep cores busy — many concurrent blocking syscalls *can* balloon OS-thread count; (2) goroutines that don't hit a scheduling point can delay others (largely mitigated by async preemption since Go 1.14); (3) the resources goroutines *hold* (Q33) are still bounded. So the runtime makes goroutine count cheap, but it doesn't make the *downstream* unbounded — you still cap concurrency at the real bottleneck.
</details>

**Q45. What memory-ordering guarantee actually makes a channel send/lock safe to rely on?**

<details><summary>Answer</summary>

The **happens-before** relationship the language's memory model establishes. In Go, "a send on a channel happens-before the corresponding receive completes," and unlocking a mutex happens-before a subsequent lock — so any writes a goroutine made *before* the send/unlock are guaranteed visible to the goroutine that does the receive/lock. In Java, the JMM gives the same via `volatile` writes/reads, lock release/acquire, and `Thread.start`/`join`. This is *why* passing data through a channel or guarding it with a mutex is safe and a bare shared variable is not: the synchronization primitive doesn't just provide mutual exclusion, it inserts the **memory barrier** that orders the writes and forces cache visibility. Without an established happens-before edge, the compiler and CPU are free to reorder and cache, and you get a data race. "Synchronization = mutual exclusion + a happens-before edge" is the deep mental model.
</details>

---

## Code-Reading — Diagnose the Snippet

> You're shown a snippet; name the anti-pattern(s) and state the fix.

**Q46. What's wrong, and how do you fix it?**

```go
func main() {
    m := map[string]int{}
    for i := 0; i < 100; i++ {
        go func(k string) { m[k]++ }(fmt.Sprint(i)) // concurrent map writes
    }
    time.Sleep(time.Second)
}
```

<details><summary>Answer</summary>

**Shared Mutable State Without Protection** — 100 goroutines write the same `map` with no synchronization. Go maps are explicitly not safe for concurrent writes; the runtime will often `fatal error: concurrent map writes` and crash (and `m[k]++` is a non-atomic read-modify-write besides). Also note the **`time.Sleep` as synchronization** smell. Fixes: guard the map with a `sync.Mutex` (lock around `m[k]++`), or use `sync.Map`, or — better — give each goroutine its own result and merge, and replace the `Sleep` with a `sync.WaitGroup`:

```go
var mu sync.Mutex
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func(k string) { defer wg.Done(); mu.Lock(); m[k]++; mu.Unlock() }(fmt.Sprint(i))
}
wg.Wait()
```
</details>

**Q47. What's wrong, and how do you fix it?**

```java
class Worker {
    private boolean stopped = false;       // not volatile
    public void stop() { stopped = true; }
    public void run() { while (!stopped) { doWork(); } }  // may loop forever
}
```

<details><summary>Answer</summary>

Two issues. First, **Busy Waiting**-adjacent: `while (!stopped)` spins (though here it does `doWork()` each pass, so it's a poll loop on a flag). Second and worse, a **visibility bug**: `stopped` is not `volatile`, so the writing thread's `stop()` may never become visible to the running thread — the JIT can hoist the read out of the loop and spin forever. Fix: make the flag `volatile` (cheap, correct for a single flag):

```java
private volatile boolean stopped = false;
```

If the loop has nothing to do but wait for the flag (no `doWork`), don't poll at all — block on a `CountDownLatch`, `BlockingQueue.take()`, or interrupt the thread (`Thread.interrupt()` + check `isInterrupted()`), which wakes it from a blocking call immediately.
</details>

**Q48. What's wrong, and how do you fix it?**

```go
func serve(l net.Listener) {
    for {
        conn, _ := l.Accept()
        go handle(conn) // unbounded: one goroutine per connection, no cap
    }
}
```

<details><summary>Answer</summary>

**Thread-Per-Request Without Bounds.** A connection flood (or slow `handle` calls) spawns goroutines without limit; each likely grabs a DB connection / buffers / downstream slot, so you exhaust the *real* bottleneck and lose backpressure. Fix: bound concurrency with a semaphore (buffered channel) or a worker pool.

```go
sem := make(chan struct{}, 1000) // cap in-flight handlers
for {
    conn, err := l.Accept()
    if err != nil { return }      // also: stop swallowing the error
    sem <- struct{}{}             // blocks when at capacity → backpressure
    go func(c net.Conn) { defer func() { <-sem }(); handle(c) }(conn)
}
```

Add a `context` deadline inside `handle` so a slow request releases its slot (Q36).
</details>

**Q49. What's wrong, and how do you fix it?**

```java
class Latch {
    private boolean ready = false;
    void await() { while (!ready) { } }   // spin
    synchronized void signal() { ready = true; }
}
```

<details><summary>Answer</summary>

**Busy Waiting** — `await()` spins a full core checking `ready`, and (separately) `ready` isn't `volatile`, so the spin may never observe the write. Replace the spin with a real blocking primitive. The idiomatic fix is a `CountDownLatch` (or `wait`/`notify` with a `while` predicate):

```java
class Latch {
    private final CountDownLatch ready = new CountDownLatch(1);
    void await() throws InterruptedException { ready.await(); } // parks, zero CPU
    void signal() { ready.countDown(); }                        // wakes the waiter
}
```

`await()` now parks the thread until `signal()` fires — no CPU burned, immediate wakeup, and the latch handles the memory barrier for you.
</details>

**Q50. What's wrong, and how do you fix it?**

```python
import threading
total = 0
def add():
    global total
    for _ in range(100_000):
        total += 1   # GIL does NOT make this safe
threads = [threading.Thread(target=add) for _ in range(4)]
[t.start() for t in threads]; [t.join() for t in threads]
print(total)  # rarely 400_000
```

<details><summary>Answer</summary>

**Shared Mutable State Without Protection**, and a trap for people who think the **GIL** saves them. `total += 1` is `LOAD`/`ADD`/`STORE`; the interpreter can release the GIL between bytecodes, so increments are lost and the total comes out under 400,000. The GIL makes a *single* bytecode atomic, not a compound `+=`. Fix with a lock (or, for a pure counter, have each thread return a local count and sum them):

```python
lock = threading.Lock()
def add():
    global total
    for _ in range(100_000):
        with lock:
            total += 1
```

For CPU-bound counting, threads won't even run in parallel under the GIL — `multiprocessing` or summing per-thread locals is the better design.
</details>

**Q51. What's wrong, and how do you fix it?**

```go
func loadConfig() *Config {
    if cfg == nil {           // two goroutines both see nil
        cfg = parse(file)     // both parse, one wins, racy publish of *Config
    }
    return cfg
}
var cfg *Config
```

<details><summary>Answer</summary>

A **race-prone lazy init** built on **unprotected shared state** — concurrent callers race on `cfg`, may both run `parse`, and the publication of the `*Config` pointer is itself a data race (a reader can see a non-nil pointer to a partially-initialized struct). Fix with `sync.Once`, which guarantees the initializer runs exactly once and establishes the happens-before edge so the result is safely published:

```go
var (
    cfg     *Config
    cfgOnce sync.Once
)
func loadConfig() *Config {
    cfgOnce.Do(func() { cfg = parse(file) })
    return cfg
}
```

(This is the boundary with the [Synchronization Misuse](../01-synchronization/) category — the cure is the same `Once` idiom.)
</details>

**Q52. Spot the subtle bug.**

```go
sem := make(chan struct{}, 100)
for _, r := range requests {
    sem <- struct{}{}
    go func() {
        defer func() { <-sem }()
        handle(r)              // BUG: closure captures loop variable r
    }()
}
```

<details><summary>Answer</summary>

Two things. The intended fix (bounded concurrency) is correct, but there's a **loop-variable capture bug**: the goroutine closes over `r`, which the loop mutates, so multiple goroutines may all process the *last* request and skip others — a classic shared-mutable-state-via-closure race (pre-Go 1.22 semantics). Fix by passing `r` as an argument: `go func(r Req) { defer func(){<-sem}(); handle(r) }(r)`. (Go 1.22+ makes each iteration's `r` a fresh variable, fixing this by default — but interviewers expect you to *name* it and not rely on the version.) The lesson: bounding concurrency and capturing loop state correctly are independent concerns; get both right.
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q53. Explain Go's mantra "Don't communicate by sharing memory; share memory by communicating."**

<details><summary>Answer</summary>

It means: instead of multiple goroutines reaching into the *same* mutable variable and coordinating with locks ("communicate by sharing memory"), **pass the data between goroutines over channels so that at any moment only one goroutine owns it** ("share memory by communicating"). Ownership transfers with the message, so there's no concurrent access to guard — correctness by confinement, not by locking. It's a *default bias*, not an absolute law: the Go team itself says use a `sync.Mutex` when you're guarding small shared state in place — the mantra is about *transferring* data and *coordinating*, not a ban on locks. The deep point it encodes is the single-writer principle: give state an owner.
</details>

**Q54. Is busy waiting ever the right thing to do?**

<details><summary>Answer</summary>

Rarely, and only **bounded**. A short spin beats parking when the expected wait is shorter than the ~1 µs park/unpark cost, on a multiprocessor where the awaited thread runs on another core — which is exactly why production mutexes spin briefly before parking, why spinlocks exist in kernel/interrupt contexts that can't sleep, and why ultra-low-latency systems (the LMAX Disruptor, HFT) busy-spin to shave wakeup latency, sacrificing a core for determinism. It is *never* right as an unbounded application-level `for !done {}` on a flag, especially on a single core where it can deadlock by starving the writer. So: bounded spin as an optimization inside a primitive = fine; naive spin loop in app code = the anti-pattern.
</details>

**Q55. "Goroutines are basically free — why not just spawn one per request and forget about pools?"**

<details><summary>Answer</summary>

Because the goroutine is the cheap part; what it *holds* is not. A goroutine per request that each opens a DB connection, file descriptor, or downstream RPC turns a request flood into a *connection/FD/downstream* flood — you've just moved the exhaustion point. Unbounded spawning also destroys backpressure: you accept work you can't finish, latency climbs past client timeouts, and you get congestion collapse instead of graceful shedding. And at the millions scale the scheduler, GC, and stack growth do cost. So bound it — a semaphore or pool sized to the *narrowest real bottleneck* — which keeps the simple goroutine-per-request shape while protecting the scarce resource. "Cheap" justifies *thousands*, not *unbounded*.
</details>

**Q56. Does Python's GIL mean Python programmers can ignore thread safety?**

<details><summary>Answer</summary>

No — a persistent myth. The GIL serializes *bytecode*, making a single op atomic, but it releases between bytecodes (and on I/O), so any **compound** operation (`x += 1`, check-then-act on a dict/list, multi-step invariants) still races and loses updates. You need `threading.Lock` for compound state exactly as in Java/Go. What the GIL *does* do is (a) prevent corruption of interpreter-internal structures and (b) prevent true CPU parallelism of Python bytecode — which is a *performance* limitation, not a *correctness* guarantee. And free-threaded CPython (PEP 703) removes the GIL entirely, making explicit locking unavoidable. "The GIL makes Python thread-safe" confuses "one bytecode at a time" with "my multi-step logic is atomic."
</details>

**Q57. What is false sharing, and why is it surprising?**

<details><summary>Answer</summary>

False sharing is a performance collapse caused by two threads writing **different** variables that share one **CPU cache line** (~64 bytes). It's surprising because there's *no logical contention* — the algorithm is correct, lock-free, and the threads touch disjoint data — yet it can be many times slower than the contended single-lock version. The cause is hardware: cache coherence works at cache-line granularity, so each write invalidates the whole line in the other core's cache and the line ping-pongs across the interconnect. It's surprising because the bug is invisible in the source; you only see it with hardware counters / `perf c2c`. The fix is padding/alignment so hot independently-written fields live on separate lines (`@Contended` in Java, struct padding in Go). It's the canonical "my lock-free code is mysteriously slow" answer.
</details>

**Q58. If a program passes `go test -race`, is it guaranteed race-free?**

<details><summary>Answer</summary>

No. The race detector only reports races on **interleavings that actually occurred during the run** — it instruments observed memory accesses and flags unsynchronized concurrent access *it saw*. A race on a code path your test didn't exercise, or an interleaving that didn't happen this time, goes undetected. So `-race` has **no false positives** (every report is a real race) but **can have false negatives** (a clean run doesn't prove safety). The practical implication: run `-race` against *realistic, high-coverage, stressed* workloads in CI, not a trivial happy-path test — and even then treat it as "no race *found*," not "no race *exists*." Combine with code review and design that avoids sharing in the first place.
</details>

**Q59. Your service has plenty of CPU and memory headroom but tail latency is terrible under load. Could it be a concurrency anti-pattern?**

<details><summary>Answer</summary>

Very plausibly. Idle CPU/memory with bad p99 points away from raw resource exhaustion and toward **contention or queueing**: a hot lock everyone parks on (so cores sit idle waiting, not working), an unbounded queue letting wait time grow without bound while throughput stays flat, false sharing wrecking a "lock-free" hot path, or a pool running near 100% utilization where the 1/(1−ρ) curve has gone vertical. Diagnose with a **mutex/block profile** (Go `pprof`, JFR lock events) to find contention, check queue depths and utilization against Little's Law, and look for a single core pegged at 100% (a spin loop) amid idle others. "Resources free but latency bad" is the signature of a coordination/queueing problem, not a capacity one.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q60. Three conditions for a data race?**

<details><summary>Answer</summary>

Concurrent access · to the same memory location · at least one is a write · with no synchronization ordering them. (Remove any one and it's not a data race.)
</details>

**Q61. One-line cure for each of the three anti-patterns?**

<details><summary>Answer</summary>

Shared mutable state → don't share it (confine / channel / immutable) or lock it correctly. Busy waiting → block on the event (channel / condvar / latch), don't poll. Thread-per-request → bound it (worker pool / semaphore) with backpressure.
</details>

**Q62. `volatile` fixes which bug and not which?**

<details><summary>Answer</summary>

Fixes **visibility/ordering** of a single read or write (a flag becomes seen by other threads). Does *not* fix **atomicity of compound ops** — `volatile x++` is still a lost-update race.
</details>

**Q63. Channel or mutex: moving data vs. guarding data?**

<details><summary>Answer</summary>

Moving/transferring ownership or coordinating → channel. Guarding small shared state in place with short critical sections → mutex. Don't be dogmatic.
</details>

**Q64. Little's Law, and what it sizes?**

<details><summary>Answer</summary>

L = λ × W (in-flight = arrival rate × time in system). Sizes worker/connection pools: provision ≈ L (plus headroom) to keep up without unbounded queue growth.
</details>

**Q65. Why bound goroutines if they're cheap?**

<details><summary>Answer</summary>

The goroutine is cheap; the DB connection / file descriptor / downstream slot it holds is not. Bounding protects the real bottleneck and preserves backpressure.
</details>

**Q66. The single-writer principle in one line?**

<details><summary>Answer</summary>

Give each piece of mutable state one owner that serializes all mutation; everyone else sends it messages. No sharing → no lock → no race.
</details>

**Q67. What does `go test -race` prove and not prove?**

<details><summary>Answer</summary>

Proves a race *exists* for any race it reports (no false positives); does *not* prove race-freedom (false negatives on unexercised interleavings).
</details>

**Q68. False sharing in one sentence?**

<details><summary>Answer</summary>

Distinct variables on the same cache line ping-pong between cores under writes — no logical contention, real slowdown; fix with padding.
</details>

**Q69. Unbounded queue in front of a pool — good idea?**

<details><summary>Answer</summary>

No. It turns overload into unbounded latency + OOM (congestion collapse). Bound the queue and shed load when full.
</details>

**Q70. The deep model of what "synchronization" buys you?**

<details><summary>Answer</summary>

Mutual exclusion *plus* a happens-before edge — the memory barrier that makes one thread's prior writes visible and ordered to the next. That's why a channel/lock is safe and a bare variable isn't.
</details>

---

## How to Talk About Concurrency in Interviews

A few habits separate a strong answer from a textbook recital:

- **Distinguish the failure modes precisely.** Data race ≠ race condition; visibility bug ≠ atomicity bug; cheap ≠ free. Interviewers probe exactly these confusions, and naming the distinction signals depth.
- **Lead with "eliminate the sharing," then "synchronize what's left."** The senior instinct is confinement, immutability, and single-writer *before* reaching for a lock. Locks are the fallback, not the first move.
- **Always bound, always backpressure.** For any "handle many requests" question, the missing word is usually *bounded* — pool, semaphore, bounded queue, timeout. Say it unprompted.
- **Bring numbers.** Little's Law to size a pool, 1/(1−ρ) for why you don't run at 100%, ~1 MB thread vs. ~KB goroutine, the 64-byte cache line. Concrete math beats hand-waving.
- **Reach for the right tool to *detect*.** `go test -race`, mutex/block profiles, goroutine-count graphs, `perf c2c`. Knowing how you'd *find* the bug is as convincing as knowing the fix.
- **Refuse dogma.** "Always use channels," "the GIL makes Python safe," "always early-return on a flag" are juniorisms. Calibrate: channels for moving data, mutexes for guarding it; bounded spins are legitimate inside primitives.
- **Trace it to a real incident.** "We had a goroutine-per-request handler that OOM'd under a downstream slowdown; we capped it with `errgroup.SetLimit` and added a context deadline" lands harder than a definition.

---

## Summary

- The three shared-state anti-patterns are three failed ways to coordinate mutable state across parallel execution: **Shared Mutable State Without Protection** (data races / corruption), **Busy Waiting** (burning a core polling instead of blocking on the event), and **Thread-Per-Request Without Bounds** (unbounded concurrency that exhausts the real bottleneck and kills backpressure).
- The junior bar is recognizing them and explaining *why* a race is undefined behavior you can't reliably reproduce. The middle bar is the safer patterns and their trade-offs: confinement, channels vs. mutexes, condvars vs. spins, worker pools, semaphores, and `computeIfAbsent`-style atomic compound ops. The senior bar is architecture and capacity: actor/CSP, the single-writer principle, C10k, and Little's-Law pool sizing. The professional bar is the hardware and math underneath: false sharing, adaptive spin-then-park, goroutine vs. thread cost, the M:N scheduler, queueing theory, and happens-before memory ordering.
- The strongest answers **eliminate sharing before synchronizing it**, **bound concurrency with backpressure** by default, **bring concrete numbers**, and **refuse dogma** (channels vs. locks by access shape; the GIL is not thread safety; bounded spinning is legitimate inside a primitive).
- Recurring curveballs hinge on one insight each: the Go mantra is "give state an owner," busy-waiting is only ever *bounded*, goroutines are cheap-not-free, the GIL serializes bytecode-not-compound-ops, and false sharing is a hardware cost invisible in the source.

---

## Related Topics

- [`junior.md`](junior.md) — recognize the race, the spin, and the unbounded spawn.
- [`middle.md`](middle.md) — detection (`-race`, profiles) and the safer patterns.
- [`senior.md`](senior.md) — actor/CSP, single-writer, capacity sizing, contended hot paths.
- [`professional.md`](professional.md) — false sharing, spin-vs-park, scheduling, queueing, memory ordering.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — practice the diagnosis and the fix.
- [Concurrency Anti-Patterns](../README.md) — the parent category and how these relate to the other six.
- [Synchronization Misuse](../01-synchronization/) — `volatile`, atomics, and correct lazy init (`sync.Once`).
- [Coordination](../02-coordination/) — lock ordering, holding locks across I/O, and lock granularity.
- [Clean Code → Immutability](../../../clean-code/14-immutability/) — the structural cure: data that can't be mutated can't race.
- [Refactoring](../../../refactoring/) — extracting owners and pipelines from tangled shared state.
- [Distributed Systems](../../../../../Backend/distributed-systems/README.md) — the same coordination problems at the network scale.