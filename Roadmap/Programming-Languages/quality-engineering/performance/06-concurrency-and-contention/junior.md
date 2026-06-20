# Concurrency and Contention — Junior Level

> **Roadmap:** [Performance](../README.md) → Concurrency and Contention
> *You have eight CPU cores and a slow program. The obvious fix — "split the work across all eight" — is right about half the time. The other half, you add seven more threads and the program gets slower. This page is about telling the two cases apart.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Concurrency Is Not Parallelism](#core-concept-1--concurrency-is-not-parallelism)
5. [Core Concept 2 — Contention: The One Checkout Lane](#core-concept-2--contention-the-one-checkout-lane)
6. [Core Concept 3 — Amdahl's Law: The Serial Part Caps You](#core-concept-3--amdahls-law-the-serial-part-caps-you)
7. [Core Concept 4 — When Concurrency Actually Helps](#core-concept-4--when-concurrency-actually-helps)
8. [Core Concept 5 — The Cost of a Lock, and Why You Hold It Briefly](#core-concept-5--the-cost-of-a-lock-and-why-you-hold-it-briefly)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Does adding threads actually make my program faster — and why so often it doesn't?**

Modern machines are wide. Your laptop has 8 or 12 cores; a server might have 64 or 128. The promise is intoxicating: if one core can do the work in 80 seconds, surely 8 cores can do it in 10. So you reach for goroutines, threads, a worker pool — and discover the program is now 9.5 seconds, or 60 seconds, or *exactly as slow as before*. The cores sit mostly idle. Where did the speedup go?

It went into **waiting**. The moment two threads need the same thing at the same time — the same lock, the same counter, the same database connection, the same disk — only one can have it, and the rest queue up. That queueing is **contention**, and it is the single biggest reason "just add more threads" fails to make code faster. Concurrency gives you the *potential* for speedup; contention is the tax that eats it.

This page is deliberately about *performance*, not *correctness*. A separate, equally important topic is whether your concurrent code produces the *right answer* (data races, deadlocks — Go's `go test -race` is your friend there). Here we assume the answer is correct and ask only: **is it faster, and by how much, and why not more?**

> **The mindset shift:** stop thinking "more threads = more speed." Start thinking "threads can only run in parallel where the work is *independent*; the instant they share something, they take turns, and taking turns is serial." Your speedup is capped by how much of the work is genuinely independent — not by how many cores you own.

---

## Prerequisites

- **Required:** You can write and run a program with multiple threads or goroutines (examples use **Go**: goroutines, `sync.Mutex`, `sync.WaitGroup`).
- **Required:** You know roughly what a CPU core is and that a machine has more than one.
- **Helpful:** You've tried to speed something up with a worker pool and been disappointed by the result.
- **Helpful:** You've heard the words "lock," "mutex," or "race condition" without a clear picture of what they cost.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Concurrency** | *Structuring* a program as many independent tasks that can make progress in overlapping time periods. A design property. |
| **Parallelism** | *Actually* running multiple tasks at the same instant on multiple cores. A runtime property. |
| **Thread / goroutine** | A unit of work the scheduler can run. Goroutines are Go's cheap threads. |
| **Core** | A physical execution unit. One core runs one thing at a time. |
| **Shared resource** | Anything two tasks both need: a lock, a counter, a connection, a file, a CPU core. |
| **Lock / mutex** | A gate that lets only one task into a section of code at a time. Protects shared data; serialises whoever wants it. |
| **Contention** | When multiple tasks compete for one shared resource and have to wait their turn. |
| **Critical section** | The code *inside* a lock — the part only one task may run at once. |
| **Speedup** | How many times faster the parallel version is vs the single-threaded one. 8 cores, perfect → 8×. |
| **Serial fraction** | The portion of the work that *cannot* be parallelised and must run one-at-a-time. |

---

## Core Concept 1 — Concurrency Is Not Parallelism

These two words get used interchangeably, and that confusion is the source of most "why isn't it faster" surprises. They are different things.

- **Concurrency** is about *structure*: breaking a program into independent tasks that *could* run in overlapping time. A single-core machine can be concurrent — it just rapidly switches between tasks, giving the *illusion* of simultaneity.
- **Parallelism** is about *execution*: literally running tasks at the same instant, which requires multiple cores.

Rob Pike's line is the canonical one: *concurrency is dealing with many things at once; parallelism is doing many things at once.* Concurrency is a way to **organise** work; parallelism is a way to **execute** it faster.

Here is why this matters for speed. Concurrency is *necessary* for parallel speedup — you can't run things in parallel if you never split the work — but it is **not sufficient**. You can write perfectly concurrent code that runs no faster, because:

```go
// Concurrent in structure — but does this run in PARALLEL?
var wg sync.WaitGroup
for i := 0; i < 8; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        doWork()
    }()
}
wg.Wait()
```

Whether these 8 goroutines actually run on 8 cores at once depends on (a) how many cores the runtime is allowed to use (`GOMAXPROCS`, which defaults to the number of CPUs) and (b) whether the work is independent enough to *stay* on separate cores instead of piling up on a shared resource. If `doWork()` spends its whole time grabbing the same lock, you have 8 concurrent goroutines and *zero* parallel speedup — they take turns.

> **Key insight:** Concurrency is a design choice you make in your code; parallelism is a runtime outcome you can only *hope* for. Splitting work into goroutines is the price of admission, not the prize. The prize — actual speedup — only arrives if the split work can run *without waiting on each other*.

---

## Core Concept 2 — Contention: The One Checkout Lane

Picture a supermarket with ten shoppers and **one open checkout lane**. It does not matter that there are ten shoppers ready to go — they finish at the rate of one lane. Adding more shoppers does not add throughput; it just makes the queue longer. The cashier (the shared resource) is the bottleneck, and everyone else waits.

This is **contention**, and a lock is exactly that one checkout lane. When many threads need the same lock, only one holds it; the rest **block** — they stop doing useful work and wait in line.

Watch it happen. Here is a counter that 8 goroutines hammer, protected by a single mutex:

```go
type Counter struct {
    mu sync.Mutex
    n  int64
}

func (c *Counter) Inc() {
    c.mu.Lock()         // ← the checkout lane. Only one goroutine past here at a time.
    c.n++               // critical section — trivially fast
    c.mu.Unlock()
}
```

Now run `Inc()` millions of times across 8 goroutines. You added 8× the workers — but every single one must pass through `c.mu.Lock()`, one at a time. The increment itself takes nanoseconds; the *waiting in line* to get the lock dominates. On a contended counter like this, the 8-goroutine version is frequently **slower** than the 1-goroutine version, because now you also pay the cost of goroutines fighting over the lock (cache-line ping-pong, scheduler wakeups) on top of zero parallelism in the critical section.

A rough, illustrative scaling curve for "all threads hit one lock constantly":

| Goroutines | Naive expectation | Reality (heavy contention) |
|---|---|---|
| 1 | 1.0× (baseline) | 1.0× |
| 2 | 2.0× | ~0.9× |
| 4 | 4.0× | ~0.7× |
| 8 | 8.0× | ~0.6× |

The numbers go the *wrong direction* because the lock is a single lane and the extra threads add only coordination overhead.

> **Key insight:** Throughput is capped by your most-contended shared resource, not by how many threads you start. One lock that everybody needs makes your program effectively single-threaded *inside that lock* — plus the overhead of the fight. Find the one lane everyone's queuing for; that's your real bottleneck.

---

## Core Concept 3 — Amdahl's Law: The Serial Part Caps You

Almost no real program is 100% parallelisable. There's always a chunk that *must* run one-at-a-time: reading the input, the contended lock, writing the final result, the part you didn't bother to split. **Amdahl's Law** is the simple, brutal arithmetic of what that serial chunk does to your speedup.

The intuition, no formula needed: *the time the serial part takes is a floor you can never get below, no matter how many cores you throw at the parallel part.*

Suppose your job is 80 seconds of work, and **20% of it is serial** (16 seconds that can't be split) while **80% is perfectly parallelisable** (64 seconds). What's the best you can do?

- The 64 parallel seconds, on infinite cores, approach **0**.
- The 16 serial seconds stay **16** — forever.
- So the absolute best total is **16 seconds**: a maximum speedup of **5×**, even on a thousand cores.

That's the whole lesson. Just 20% serial work caps you at 5×. Here's the curve:

| Cores | Speedup with 20% serial |
|---|---|
| 1 | 1.0× |
| 2 | 1.7× |
| 4 | 2.5× |
| 8 | 3.3× |
| 16 | 4.0× |
| ∞ | **5.0× (the ceiling)** |

Notice the brutal **diminishing returns**: going from 1→2 cores buys you 0.7×; going from 8→16 cores buys you another 0.7× but costs you *eight more cores*. The serial fraction quietly eats every additional core.

> **Key insight:** Your speedup ceiling is set by the *serial fraction*, not the core count. Before you add cores, ask "what percent of this work genuinely cannot run in parallel?" If it's 20%, you'll never beat 5× — so adding the 9th, 17th, 33rd core is mostly wasted money. The highest-leverage performance work is often *shrinking the serial part*, not adding parallel capacity.

---

## Core Concept 4 — When Concurrency Actually Helps

Concurrency is a tool, and like any tool it fits some jobs and ruins others. The decisive question is always: **what is the work actually waiting on?**

**It helps — CPU-bound work that splits into independent pieces.** Resizing 10,000 images, hashing a million records, summing a huge array in chunks. Each piece needs a core and nothing else; give it 8 cores and you get close to 8× (minus the serial fraction from Concept 3). This is the textbook win.

```go
// Independent CPU work — scales well across cores
results := make([]int, len(items))
var wg sync.WaitGroup
for i := range items {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        results[i] = expensiveCompute(items[i]) // writes its OWN slot — no shared lock
    }(i)
}
wg.Wait()
```

Each goroutine writes its own `results[i]` slot, so there's no contention — this is the good case.

**It helps — overlapping I/O waits.** Fetching 50 URLs, each taking 200ms of *network waiting*. Done serially: 10 seconds. Done concurrently: each request mostly *waits*, and waiting is free — the CPU is idle anyway, so 50 requests overlap their waits and finish in ~200ms. Concurrency here isn't using more cores; it's using the *idle time during waiting*. Huge win, even on a single core.

**It does NOT help — already saturated on one resource.** If your 50 requests all hit *one* database that can only handle so many queries per second, concurrency doesn't speed them up — they queue at the database (Concept 2's checkout lane, again). You're not I/O-*latency* bound, you're I/O-*throughput* bound on a single backend. Adding client threads just lengthens the queue.

**It does NOT help — tiny tasks dominated by coordination.** Spawning a goroutine, scheduling it, and synchronising the result has a cost (call it a few hundred nanoseconds to a microsecond). If each task is *also* only a few hundred nanoseconds of work, you spend more time coordinating than computing. Summing a 100-element array across 8 goroutines is *slower* than a plain loop, every time.

> **Key insight:** Concurrency converts **independent work** and **idle waiting** into speed. It cannot speed up work that's serialised on a shared resource, and it actively *hurts* when the per-task work is smaller than the cost of handing it off. Match the tool to the bottleneck: parallelise CPU work that's truly independent; overlap I/O that's truly waiting; do *neither* when one resource is already the limit.

---

## Core Concept 5 — The Cost of a Lock, and Why You Hold It Briefly

A lock has two distinct costs, and conflating them hides the real problem.

1. **The uncontended cost** — taking a lock nobody else wants. This is cheap: a single atomic CPU instruction, tens of nanoseconds. If your lock is rarely contended, this cost is negligible and you should not worry about it.

2. **The contended cost** — the *waiting* when someone else holds the lock. This is the expensive one, and it scales with **how long the holder keeps the lock**, multiplied by **how many threads are waiting**. This is where programs die.

The single most effective lock-performance rule follows directly: **hold the lock for as short a time as possible.** Everyone waiting is stuck for exactly as long as the current holder dawdles inside the critical section. Do slow things *outside* the lock.

Here is the classic mistake — doing expensive work *while holding* the lock:

```go
// BAD: the slow call happens INSIDE the critical section.
// Every other goroutine waits for the network round-trip.
func (c *Cache) GetSlow(key string) string {
    c.mu.Lock()
    defer c.mu.Unlock()
    val := fetchFromNetwork(key)  // 50ms!  Lock held for 50ms.
    c.data[key] = val
    return val
}
```

While one goroutine sits in `fetchFromNetwork` for 50ms, *every* other goroutine that wants this lock is frozen. Eight goroutines, and you've serialised 50ms apiece — 400ms of pure waiting.

The fix: do the slow work **outside** the lock, and only hold it for the fast map write:

```go
// BETTER: the 50ms network call is OUTSIDE the lock.
// The lock is held only for the nanosecond-scale map write.
func (c *Cache) GetFast(key string) string {
    val := fetchFromNetwork(key)  // 50ms, but NO lock held
    c.mu.Lock()
    c.data[key] = val             // microseconds, lock held briefly
    c.mu.Unlock()
    return val
}
```

Now the lock is held for microseconds, not milliseconds — contention collapses. (A correctness-minded version would also avoid duplicate fetches, but that's the *right-answer* topic; the *fast* lesson is simply: shrink the critical section.)

> **Key insight:** The cost of a lock is dominated by the *duration of the critical section* under contention, not by the act of locking itself. A lock held for nanoseconds is nearly free even with many waiters; a lock held across a network call or disk read is a global stop sign. Optimise locks by making them *brief*, not by making them *fewer* — and never put I/O inside one.

---

## Real-World Examples

**1. The worker pool that got slower at 16 workers.** A team parallelises a data-import job with a configurable worker count. At 4 workers it's 3× faster — great. At 16 workers it's *slower than 4*. Profiling shows every worker, after processing a record, takes a single mutex to update a shared progress counter and a shared `map[string]int` of stats. The actual processing parallelises fine; the shared counter is the one checkout lane, and 16 workers spend their time queueing for it. Fix: each worker keeps a *local* counter and merges once at the end — contention vanishes, and 16 workers finally beat 4.

**2. The API that flew with concurrency.** A service that aggregates data from 6 downstream APIs serially takes 6 × 150ms = 900ms per request. Switching to 6 concurrent goroutines (each waiting on its own independent endpoint) drops it to ~160ms — the waits overlap. This is the I/O-overlap win: no extra cores needed, because the goroutines spend their time *waiting*, and waits are free to overlap. (Note the contrast with example 1 — here the resources are *independent*, so concurrency works.)

**3. The "parallel" sum that was pure overhead.** A junior dev parallelises summing a 200-element slice across 8 goroutines to "use all the cores." It runs ~20× *slower* than a plain `for` loop. Each goroutine does ~25 additions (nanoseconds) but costs hundreds of nanoseconds to spawn and synchronise. The coordination overhead dwarfs the work. The lesson: parallelism has a fixed setup cost; the work per task must be *large enough* to pay it back.

---

## Mental Models

- **The checkout lane.** A lock is one open checkout. Ten shoppers (threads) don't make checkout faster — they make the queue longer. Throughput is set by the number of *lanes* (independent resources), not the number of *shoppers* (threads).

- **The serial floor.** Amdahl's Law: the serial part is a floor under your runtime. Pour in infinite cores and the parallel part evaporates, but the floor stays. Your speedup can never sink below that floor — count it before you buy cores.

- **Waiting is free, work is not.** I/O concurrency wins because *waiting* (network, disk) costs no CPU, so many waits overlap for free. CPU concurrency wins only when there's a free *core* to do the work. Ask: is my task *waiting* or *working*? That tells you which kind of concurrency to reach for.

- **The lock as a stop sign.** Everyone wanting the lock is frozen for exactly as long as the holder lingers. Hold it for a nanosecond, traffic flows; hold it across a 50ms network call, you've built a traffic jam. Keep the critical section tiny.

---

## Common Mistakes

1. **Assuming threads add linearly to speed.** 8 threads almost never means 8× faster. The serial fraction (Amdahl) and the most-contended shared resource set a ceiling far below the core count. Measure the real speedup curve; don't assume it.

2. **One global lock everyone needs.** A single mutex guarding a shared counter, cache, or map turns your "parallel" code serial *inside that lock*, plus overhead. It's the one checkout lane. Shard the data, use per-worker locals, or atomics — give each shopper their own lane.

3. **Holding a lock during I/O.** A network call or disk read inside a critical section freezes every waiter for the full duration. Do slow work *outside* the lock; hold it only for the fast in-memory update.

4. **Parallelising tiny tasks.** If a task is smaller than the cost of spawning and synchronising it, concurrency loses every time. Batch tiny tasks into larger chunks so each goroutine does enough work to justify its setup cost.

5. **Throwing threads at an I/O-throughput bottleneck.** If 50 requests all hit one database maxed at 100 QPS, adding client goroutines just lengthens the queue at the database. You're saturated on *one resource* — more threads don't create more database capacity.

6. **Confusing "it's correct" with "it's fast."** `go test -race` passing means no data races — it says *nothing* about speed. A correct concurrent program can still be slower than the serial one. Correctness and performance are separate questions; verify both.

---

## Test Yourself

1. In one sentence each, distinguish *concurrency* from *parallelism*. Can a single-core machine be concurrent? Parallel?
2. You start 8 goroutines, each spending most of its time taking the same `sync.Mutex`. Roughly what speedup over 1 goroutine should you expect, and why?
3. A job is 90% parallelisable and 10% serial. What is its maximum possible speedup, on infinitely many cores? What does that tell you about buying a 64-core machine?
4. You parallelise 50 HTTP fetches and they get much faster, but parallelising a 100-element sum makes it slower. Explain both outcomes with one principle.
5. A cache method holds its mutex across a 50ms network call. Why is this a performance disaster under load, and what's the fix?
6. Your import job is fastest at 4 workers and slower at 16. Name the single most likely cause and one fix.

<details>
<summary>Answers</summary>

1. **Concurrency** is *structuring* work as independent tasks that can overlap in time (a design property); **parallelism** is *actually executing* tasks at the same instant on multiple cores (a runtime property). A single-core machine *can* be concurrent (it time-slices between tasks) but *cannot* be parallel (only one thing runs at a time).
2. Roughly **1× or even less** — no real speedup, possibly a slowdown. All 8 goroutines must pass through the one lock one-at-a-time (the critical section is serial), and you've added the overhead of them fighting over it. The lock is the single checkout lane.
3. Best case is **10×** (the 10% serial work is a floor you can't get below; the 90% approaches zero). It tells you a 64-core machine is mostly wasted here — you'll never beat 10×, and you hit diminishing returns long before 64 cores. Shrinking the serial 10% would raise the ceiling more than adding cores.
4. **The work per task must exceed the coordination cost, and concurrency only helps independent work or overlapping waits.** The 50 fetches mostly *wait* on independent network endpoints, so their waits overlap for free. The 100-element sum is tiny work per goroutine — spawning and synchronising costs more than the additions, so overhead dominates.
5. Under load, every other goroutine wanting that lock is frozen for the full 50ms; with 8 waiters that's 400ms of pure queueing. The fix: do the network call **outside** the lock and hold the lock only for the fast in-memory write (microseconds).
6. **Contention on a shared resource** — most likely a single mutex guarding a shared counter/map that every worker hits. Fix: give each worker a *local* accumulator and merge once at the end (or shard the lock / use atomics), so workers stop queueing for one lane.

</details>

---

## Cheat Sheet

```
CONCURRENCY vs PARALLELISM
  concurrency = STRUCTURE (independent tasks that can overlap)   — a design choice
  parallelism = EXECUTION (tasks running at the same instant)    — a runtime outcome
  concurrency is necessary for parallel speedup, NOT sufficient

WHY MORE THREADS != MORE SPEED
  throughput is capped by the MOST-CONTENDED shared resource
  one lock everyone needs = one checkout lane = effectively serial

AMDAHL'S LAW (the serial floor)
  serial fraction caps speedup no matter how many cores
  20% serial  → max  5x   (even on infinite cores)
  10% serial  → max 10x
  → shrinking the serial part often beats adding cores

WHEN CONCURRENCY HELPS
  YES  independent CPU work (own data, no shared lock)  → near-linear
  YES  overlapping I/O waits (waiting is free)          → big win, even 1 core
  NO   saturated on ONE resource (1 DB at max QPS)      → just lengthens queue
  NO   tiny tasks < coordination cost                   → overhead dominates

LOCK COST
  uncontended take  = cheap  (~tens of ns, ignore it)
  contended wait    = expensive, scales with (hold time x waiters)
  RULE: hold the lock BRIEFLY. Never do I/O inside a critical section.
  move slow work OUTSIDE; hold only for the fast in-memory update

CORRECTNESS != SPEED
  go test -race  → checks for data races, NOT performance
```

---

## Summary

- **Concurrency is not parallelism.** Concurrency is structuring work into independent tasks (a design choice); parallelism is running them at once on multiple cores (a runtime outcome). Splitting into goroutines is the *price of admission* to speedup, not the speedup itself.
- **Contention is why "add more threads" fails.** When many threads need one shared resource — a lock, a counter, a connection — they queue, one at a time, like ten shoppers at one checkout. Your throughput is capped by the most-contended resource, not the core count.
- **Amdahl's Law sets a hard ceiling.** The serial fraction of the work is a floor you can never get below. 20% serial means a maximum 5× speedup *on infinite cores* — so shrinking the serial part is often higher-leverage than adding cores.
- **Concurrency helps independent CPU work and overlapping I/O waits;** it does nothing for work saturated on one resource, and it actively hurts when per-task work is smaller than the cost of handing it off.
- **A lock's real cost is the duration it's held under contention.** Taking an uncontended lock is cheap; making everyone wait while you hold it across a network call is a disaster. Hold locks *briefly*; keep slow work outside the critical section.

You now have the intuition: parallel speedup is *earned*, not given by core count. Everything deeper in this section — measuring scaling curves, lock convoying, false sharing, scheduler effects — is about finding *exactly which shared resource* is eating your gains and *how much* serial work is hiding in your "parallel" code.

---

## Further Reading

- *Concurrency Is Not Parallelism* — Rob Pike's talk. The foundational distinction, in 30 minutes.
- *Systems Performance* — Brendan Gregg. The USE method (Utilisation, Saturation, Errors) for spotting contended resources.
- [Go Memory Model](https://go.dev/ref/mem) and the `sync` package docs — what `Mutex`, `WaitGroup`, and atomics actually guarantee.
- *Amdahl's Law* — read the one-paragraph statement; the arithmetic is simpler than its reputation.
- The [middle.md](middle.md) of this topic, which adds scaling-curve measurement, lock convoying, `sync.RWMutex` vs `Mutex`, sharding, and the Universal Scalability Law (Amdahl plus a *coherency* penalty that bends the curve back down).

---

## Related Topics

- [03 — Latency and Throughput](../03-latency-and-throughput/junior.md) — Little's Law ties concurrency, latency, and throughput together; contention shows up as rising latency.
- [04 — CPU-Bound Optimization](../04-cpu-bound-optimization/junior.md) — the kind of independent CPU work that parallelises *well*, before you reach for threads.
- [middle.md](middle.md) — measuring the scaling curve, lock convoying, sharding strategies, and where Amdahl stops being optimistic.
