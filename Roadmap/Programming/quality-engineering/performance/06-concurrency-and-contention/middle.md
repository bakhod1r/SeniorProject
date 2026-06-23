# Concurrency and Contention — Middle Level

> **Roadmap:** [Performance](../README.md) → Concurrency and Contention
> *The junior page said "add threads to go faster." This page explains why the speedup curve bends, then flattens, then sometimes falls — and how to read a mutex profile, shrink a critical section, and stop two cores from fighting over one cache line.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Amdahl's Law — the Ceiling on Parallel Speedup](#amdahls-law--the-ceiling-on-parallel-speedup)
4. [The Universal Scalability Law — Why Throughput Peaks, Then Drops](#the-universal-scalability-law--why-throughput-peaks-then-drops)
5. [Lock Contention, Mechanically](#lock-contention-mechanically)
6. [Reducing Contention — the Toolbox](#reducing-contention--the-toolbox)
7. [False Sharing — Two Variables, One Cache Line, a War](#false-sharing--two-variables-one-cache-line-a-war)
8. [Lock-Free Basics — Atomics and CAS](#lock-free-basics--atomics-and-cas)
9. [Measuring Contention](#measuring-contention)
10. [Worked Example — A Sharded Counter](#worked-example--a-sharded-counter)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Why does adding cores stop helping — and how do I find and remove the contention that caused it?**

At the junior level, parallelism is addition: split the work across `N` workers, finish in `1/N` of the time. That model is useful until the first time you double the cores and the program gets *slower*. Then it's worse than useless — it tells you to do more of the thing that's hurting you.

The middle-level model is subtractive. Real speedup is bounded by the part of the work that *cannot* run in parallel (Amdahl's Law), and then eroded further by the cost of coordination — locks, cache-line bouncing, scheduler churn — that grows *with* the number of workers (the Universal Scalability Law). Past some core count, that coordination cost outweighs the marginal work each new core does, and the throughput curve turns over and falls.

This page is about *contention*: the performance tax cores pay to share state. We'll quantify the ceilings, then make them concrete with the mechanics of a blocked thread, the standard contention-reduction patterns (shrink, shard, go per-core, go lock-free), the cache-line trap of false sharing, and — most importantly — the profiles (`go tool pprof` mutex/block, `perf lock`) that tell you *which* lock is the problem instead of guessing.

> This is the **scaling** angle, not the **correctness** angle. A program can be perfectly race-free and still scale terribly. We assume your locks are correct; we ask whether they're cheap.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can describe a goroutine/thread, a mutex, and a data race.
- **Required:** You can run a benchmark and read a throughput number (ops/sec). See [02 — Benchmarking](../02-benchmarking-and-microbenchmarks/middle.md).
- **Helpful:** A rough mental picture of a CPU cache line (~64 bytes) and that cores have private L1/L2 caches.
- **Helpful:** You've at least once watched CPU sit near-idle while a "parallel" program crawled.

---

## Amdahl's Law — the Ceiling on Parallel Speedup

Split a job into a fraction `p` that can run in parallel and a fraction `(1 - p)` that is inherently serial. With `N` workers, the parallel part finishes in `p/N` of its original time; the serial part doesn't shrink at all. The total time becomes `(1 - p) + p/N`, so speedup is:

```
                1
S(N) =  ─────────────────────
         (1 - p) + p / N
```

Plug in numbers and the ceiling appears immediately. Suppose **90%** of the work parallelizes (`p = 0.9`):

| Cores `N` | Speedup `S(N)` | Efficiency `S/N` |
|---|---|---|
| 1  | 1.00× | 100% |
| 2  | 1.82× | 91%  |
| 4  | 3.08× | 77%  |
| 8  | 4.71× | 59%  |
| 16 | 6.40× | 40%  |
| 32 | 7.80× | 24%  |
| ∞  | **10.0×** | 0% |

Sixteen cores buy you 6.4×, not 16×, and the *thirty-second* core barely moves the needle. The hard limit as `N → ∞` is `1 / (1 - p) = 1 / 0.1 = 10×`. You can never beat that, no matter how many cores you rent, because the 10% serial part is always there.

The serial fraction is unforgiving. Worked the other way: to hit a **20× speedup**, you need `1 - p ≤ 1/20`, i.e. **`p ≥ 0.95`** *and* infinite cores. To get 20× with a realistic 64 cores requires `p ≈ 0.992` — losing even 1% to serialization caps you well below target.

> **Key insight:** The first lever in parallel performance isn't "more cores," it's **shrinking the serial fraction**. A 5%-serial program is *fundamentally* limited to 20×; buying cores past the knee of its curve is spending money to raise efficiency from bad to worse. Find what's serial — often a shared lock, a single queue, a global counter — before you scale out.

---

## The Universal Scalability Law — Why Throughput Peaks, Then Drops

Amdahl is optimistic: it assumes the only cost of going parallel is the serial fraction. Real systems pay *two* extra taxes, and Gunther's **Universal Scalability Law (USL)** names both. Relative to single-worker throughput, capacity at `N` workers is:

```
                       N
 C(N) =  ────────────────────────────────
          1 + α·(N − 1) + β·N·(N − 1)
```

- **α (contention)** — the serial/queueing term, the same idea as Amdahl's `(1 - p)`: workers waiting their turn at a shared resource. With `β = 0`, USL *is* Amdahl.
- **β (coherency)** — the term Amdahl ignores: the cost of keeping shared state *consistent* across workers. Cache-coherence traffic, lock-state synchronization, cross-core invalidations. Critically, this grows as `N·(N − 1)` — roughly `N²` — because every worker may have to coordinate with every other.

The `β·N²` term is what makes scaling *curves down*. Adding work scales linearly (the `N` on top), contention costs scale linearly, but coherency cost scales **quadratically**. Past a point, each new worker adds more coordination cost than it adds capacity, and total throughput **peaks, then declines**:

```
throughput
   │                 ╭───╮            β > 0: peaks then DROPS
   │              ╭──╯    ╰──╮
   │           ╭──╯          ╰───╮
   │        ╭──╯                  ╰────
   │     ╭──╯  ··········· linear (ideal)
   │  ╭──╯  ····
   │╭─╯··
   └──────────────────────────────────  cores
        N*  ← peak; adding cores past here HURTS
```

The peak is at `N* = sqrt((1 − α) / β)`. For example, with `α = 0.03` and `β = 0.0005`, `N* = sqrt(0.97 / 0.0005) ≈ 44` cores — beyond which a *negative-return* regime begins. This is not theoretical: it's the database that gets slower under more connections, the cache that thrashes harder with more clients, the lock that costs more to acquire than the work it protects.

> **Key insight:** Amdahl tells you the *ceiling*; USL tells you there's a *cliff*. If your scaling curve bends down instead of flattening, you have a non-zero **β** — coherency cost — and the cure is not fewer waits (α) but *less shared mutable state* (β): sharding, per-core data, immutability. Fit your benchmark data to the USL to estimate α and β and predict where your peak is.

---

## Lock Contention, Mechanically

"The lock is contended" is a vague complaint until you know what a blocked thread actually *does*. When thread B tries to acquire a mutex thread A holds, one of two things happens:

- **Spin (busy-wait):** B loops, re-checking the lock, burning a CPU core doing nothing. Cheap if the wait is nanoseconds (A is about to release); catastrophic if it's microseconds (B wastes a whole core). Modern mutexes spin *briefly* then fall back to sleeping.
- **Park (sleep):** B is descheduled by the runtime/OS; its core is freed for other work. But waking it later costs a **context switch** — typically **1–5 µs** of pure overhead (save/restore registers, scheduler bookkeeping, and a cold cache when B resumes on a different core).

A context switch sounds tiny until you count them. A lock taken 200,000 times/sec under contention, each acquisition forcing a park/unpark pair, is ~400,000 context switches/sec — possibly milliseconds of CPU per second *spent purely on scheduling*, plus the cache pollution that doesn't show up in any single switch's cost.

Worse is **lock convoying**. Picture threads arriving at a lock faster than the critical section drains. They form a queue. Each holder, on release, wakes the next waiter — but that waiter was *asleep*, so it pays a context switch and a cache miss before it can even start the (tiny) protected work. The lock now spends most of its time in handoff overhead, the queue never empties, and *throughput collapses while CPU looks busy*. Convoying turns a fast critical section into a slow conveyor belt: the bottleneck is the handoff, not the work. It's the human-visible face of a high USL **α**.

> **Key insight:** A contended lock doesn't just make threads *wait* — it converts useful work into *scheduling and cache-coherency overhead*. The CPU can be pinned at 100% while almost none of those cycles do your work. "High CPU" and "doing work" are not the same thing under contention.

---

## Reducing Contention — the Toolbox

There is no single fix; there's a ladder, roughly from least to most invasive. Climb only as far as your profile forces you.

**1. Shrink the critical section.** The cheapest win. Do everything you can *outside* the lock — compute, allocate, format — and hold it only for the irreducible shared mutation.

```go
// BAD: expensive work done while holding the lock
mu.Lock()
result := expensiveTransform(input) // 50µs, needs no shared state!
cache[key] = result
mu.Unlock()

// GOOD: lock held only for the map write
result := expensiveTransform(input)
mu.Lock()
cache[key] = result
mu.Unlock()
```

If the critical section is 50× shorter, the lock can serve ~50× more callers before it becomes the bottleneck. This single move often deletes a contention problem.

**2. Shard / stripe the lock.** One lock for a whole map serializes *all* access. Split the data into `K` shards, each with its own lock; a key maps to a shard by hash. Now `K` operations on different shards proceed in parallel. This trades a little memory and the loss of "lock the whole thing atomically" for a `K`× drop in contention. (Java's old `ConcurrentHashMap` used exactly this lock-striping idea.)

**3. Per-core / per-goroutine state, then merge.** The strongest pattern: give each worker its *own* unshared accumulator, so the hot path takes *no* lock at all, then combine the partials at read time. A per-worker counter incremented millions of times with zero coordination, summed once when someone asks — this drives both α and β toward zero. (This is the [worked example](#worked-example--a-sharded-counter) below; Java's `LongAdder` is exactly this pattern productized.)

**4. Read-write locks — and their limit.** A `sync.RWMutex` lets *many* readers proceed concurrently, serializing only writers. Great for read-heavy data that changes rarely. But know the limits: (a) RW locks have **higher per-acquire overhead** than a plain mutex, so for short critical sections under low contention they can be *slower*; (b) every `RLock` still **writes to the lock's shared reader-count**, so under heavy read traffic the lock itself becomes a false-sharing/coherency hotspot — readers contend on the bookkeeping even though they don't contend on the data. RW locks help when reads are frequent *and* the protected work is substantial.

**5. Go lock-free.** Replace the lock with a single atomic operation (next section). Highest performance, highest difficulty — reserve it for proven hotspots.

> **Key insight:** The ladder is ordered for a reason. *Shrink* and *shard* solve most real contention with low risk. *Per-core-then-merge* is the senior default for counters and aggregates. Lock-free is a last resort, not a starting point — it's where subtle bugs live.

---

## False Sharing — Two Variables, One Cache Line, a War

Cores don't synchronize *bytes*; they synchronize **cache lines** (64 bytes on x86/ARM). When core A writes any byte in a line, the coherence protocol (MESI) **invalidates that whole line** in every other core's cache. The next core to touch *anything* in that line eats a cache miss and must re-fetch.

Now suppose two unrelated counters, each updated by a different core, happen to sit *in the same 64-byte line*:

```go
type Counters struct {
    a int64 // updated only by goroutine 1
    b int64 // updated only by goroutine 2
} // a and b are 8 bytes apart → SAME cache line
```

There is no shared variable, no lock, no logical contention — and yet every increment of `a` invalidates the line holding `b`, forcing goroutine 2's next write to re-fetch, which invalidates `a`, and so on. The line *ping-pongs* between cores' caches across the slow interconnect. This is **false sharing**: contention with no shared data, purely an accident of memory layout. It can make a "parallel" loop *slower* than the single-threaded version, and it's invisible in source — you have to know the layout.

The fix is **padding**: push each hot variable onto its own cache line.

```go
type Counters struct {
    a int64
    _ [56]byte // pad: 8 (a) + 56 = 64 → b starts a fresh line
    b int64
    _ [56]byte
}
```

Go offers `golang.org/x/sys/cpu.CacheLinePad` for this; Java has `@Contended` (with `-XX:-RestrictContended`). The cost is 56 wasted bytes per counter — trivially worth it for a hot field. Per-core sharded arrays are the classic false-sharing trap: an `[]int64` of per-core counters packs ~8 counters per line, so neighboring cores fight even though each "owns" its slot. Pad each slot to a full line.

> **Key insight:** False sharing is contention the language *cannot see and the profiler barely shows* — it looks like memory-bandwidth or just "slow," not like a lock. When per-core/sharded state scales worse than expected, suspect the cache line before the algorithm. Pad hot, independently-written fields to 64 bytes.

---

## Lock-Free Basics — Atomics and CAS

An **atomic** operation completes indivisibly with respect to other cores — no lock, no possibility of a half-done state. For a simple counter, an atomic add *is* the whole fix:

```go
var n atomic.Int64
n.Add(1)          // atomic increment, no mutex, no parking
total := n.Load() // atomic read
```

Atomics are implemented as single CPU instructions (e.g. `LOCK XADD`) and skip the entire park/unpark machinery — no context switches, no convoy. For one shared integer they are dramatically faster than a mutex under contention.

The general primitive is **compare-and-swap (CAS)**: "set `x` to `new`, but *only if* `x` still equals `old`; tell me whether it worked." It's the building block for lock-free updates of anything you can read-modify-write:

```go
for {
    old := x.Load()
    newVal := old + delta // or any pure transform
    if x.CompareAndSwap(old, newVal) {
        break // success
    }
    // someone else changed x; loop and retry with the fresh value
}
```

Each iteration optimistically computes the new value, then commits only if nobody interfered. Under low contention this almost always succeeds first try. But CAS is **not free under high contention**: many cores retrying the same CAS create a coherency storm — the same `β·N²` cliff — where most CPU is spent on *failed* attempts. Atomic-on-a-single-shared-word does not escape USL; it just lowers the constant. (CAS also has the ABA hazard, where a value changes `A → B → A` and CAS wrongly succeeds — a correctness concern handled with versioned pointers/hazard pointers, deferred to [senior.md](senior.md).)

> **Key insight:** Atomics replace a *lock* with a *single instruction*, removing parking and convoying — a big win for one shared word. But a single hot atomic is *still* shared mutable state, still subject to the coherency cliff. The scalable answer to a hot counter is usually **per-core counters merged on read**, not one global atomic.

---

## Measuring Contention

You cannot fix contention you haven't located. Guessing which lock is hot is how seniors waste afternoons. Measure.

**Go — mutex and block profiles.** The runtime can sample where goroutines *wait*:

```go
runtime.SetMutexProfileFraction(5) // sample 1/5 of mutex contention events
runtime.SetBlockProfileRate(1)     // sample blocking (chan/select/lock) events
```

```bash
# from a running pprof endpoint, or a saved profile:
go tool pprof http://localhost:6060/debug/pprof/mutex   # WHERE lock contention happens
go tool pprof http://localhost:6060/debug/pprof/block   # WHERE goroutines block (incl. chans)
# (pprof) top      → functions ranked by contention/blocking time
# (pprof) list Foo → annotated source: which exact line waits
```

The **mutex profile** ranks call sites by total time spent *contending* for mutexes; the **block profile** is broader (channels, selects, `Cond`, `WaitGroup`, locks). The mutex profile answers "which lock?"; the block profile answers "where do goroutines stall?"

**Java.** `LockSupport`/thread states via JFR (`jdk.JavaMonitorEnter` events) and async-profiler in `lock` mode show monitor contention with stack traces. JMC visualizes the worst monitors.

**Linux — `perf lock` and counters.** OS-level, language-agnostic:

```bash
perf lock record ./app   # then:
perf lock report         # contended locks, wait time, contention count
perf stat -e context-switches,cpu-migrations ./app   # the symptoms of contention
```

A high `context-switches` rate with low useful throughput is the fingerprint of lock convoying. `cpu-migrations` (a thread bouncing between cores) hints at cache-cold restarts.

> **Key insight:** "Slow" plus "CPU not saturated" → look at the **block/mutex profile** (you're *waiting*). "Slow" plus "CPU saturated but throughput won't rise with cores" → look at **context-switch/coherency** counters and suspect convoying or false sharing (you're *coordinating*). The profile picks the chapter; don't read all of them blind.

---

## Worked Example — A Sharded Counter

A request handler increments a global counter on every call. Under load it stops scaling — `pprof` mutex profile points the finger straight at `Inc`.

**Before — one mutex, fully serialized:**

```go
type Counter struct {
    mu sync.Mutex
    n  int64
}
func (c *Counter) Inc()  { c.mu.Lock(); c.n++; c.mu.Unlock() }
func (c *Counter) Get() int64 { c.mu.Lock(); defer c.mu.Unlock(); return c.n }
```

Every goroutine serializes on `c.mu`. The critical section is one instruction, but the *handoff* (acquire/park/wake) dwarfs it — textbook convoying. Throughput is essentially flat regardless of cores; USL **α** is near 1.

**After — per-shard counters, padded, merged on read:**

```go
const shards = 64 // ≥ GOMAXPROCS

type pad struct {
    n int64
    _ [56]byte // pad to a full 64-byte cache line: kills false sharing
}
type Counter struct{ s [shards]pad }

func (c *Counter) Inc() {
    i := runtime_procPin() % shards // pick a shard by current P; cheap, no lock
    runtime_procUnpin()
    atomic.AddInt64(&c.s[i].n, 1)   // contention only among goroutines on the SAME shard
}
func (c *Counter) Get() (sum int64) {
    for i := range c.s {
        sum += atomic.LoadInt64(&c.s[i].n) // merge: read all shards once
    }
    return
}
```

(In real code use a simpler shard selector — e.g. a fast thread-local hash; `procPin` is illustrative.) Increments now spread across 64 independent, cache-line-isolated atomics: low collision probability, no parking, no convoy, no false sharing. Reads pay `O(shards)` — fine, since reads are rare relative to writes.

**Illustrative scaling (writes/sec, 8 cores):**

| Cores | Single mutex | Sharded + padded |
|---|---|---|
| 1 | 60 M | 58 M |
| 2 | 35 M *(↓)* | 110 M |
| 4 | 22 M *(↓↓)* | 210 M |
| 8 | 15 M *(↓↓↓)* | 390 M |

The single-mutex version *gets slower* as cores increase — the convoy/coherency cliff (high **β**) made visible. The sharded version scales near-linearly because there's almost nothing shared to coordinate. This is the whole page in one table: the fix for "scaling falls off a cliff" is to *remove the shared mutable state*, not to optimize the lock around it.

> **Key insight:** This is `LongAdder`'s entire strategy: trade a slightly more expensive *read* (sum the shards) for an almost-free, contention-free *write*. For write-heavy, read-rarely counters and aggregates, it's the default — not the exception.

---

## Mental Models

- **Amdahl is the ceiling; USL is the cliff.** Amdahl says speedup tops out at `1/(1−p)`. USL adds that, with coherency cost (β), the curve doesn't just flatten — it *turns over and falls*. If your throughput drops with more cores, you don't need fewer waits, you need less shared mutable state.

- **A lock converts work into overhead.** Under contention, CPU cycles don't disappear — they're spent parking, waking, and re-warming caches instead of doing your work. 100% CPU is not the same as 100% useful.

- **Cores share cache lines, not variables.** The hardware's unit of sharing is the 64-byte line. Two logically independent fields in one line contend as if they were the same variable. False sharing is "contention by accident of layout."

- **The contention ladder: shrink → shard → per-core → lock-free.** Climb only as far as the profile forces. Most problems die at "shrink the critical section" or "shard the lock." Per-core-then-merge is the senior default for counters. Lock-free is the top rung, not the bottom.

- **Profile picks the chapter.** Waiting (CPU idle) → block/mutex profile. Coordinating (CPU busy, no scaling) → context-switch counters, suspect convoy/false sharing. Don't optimize a lock the profile never named.

---

## Common Mistakes

1. **"Add more cores / goroutines."** Past the knee of the curve, more workers raise contention and coherency cost faster than they add capacity — and with non-zero β, *reduce* total throughput. Find the serial/shared bottleneck first.

2. **Doing expensive work inside the critical section.** Allocating, computing, formatting, or doing I/O while holding the lock multiplies its hold time and the convoy. Compute outside; lock only for the shared mutation.

3. **One global lock (or one global atomic) for a hot counter.** Even a single atomic is shared mutable state subject to the coherency cliff. Shard it; merge on read.

4. **Reaching for `RWMutex` reflexively.** Its per-acquire cost is higher than a plain mutex, and the reader-count bookkeeping is itself a coherency hotspot. It pays off only when reads are *frequent and substantial* and writes rare.

5. **Ignoring false sharing in per-core arrays.** A tight `[]int64` of per-core slots packs ~8 to a line, so "independent" cores fight over the line. Pad each hot slot to 64 bytes.

6. **Optimizing the lock you *assume* is hot.** Without a mutex/block profile or `perf lock`, you'll tune the wrong one. Measure which call site actually contends.

7. **Treating lock-free as automatically faster.** Under high contention, CAS-retry storms hit the same `β·N²` cliff as a lock — and the code is far harder to get right. It lowers the constant, not the asymptotic class.

---

## Test Yourself

1. With 95% of work parallelizable (`p = 0.95`), what is the maximum speedup with infinite cores? With 16 cores?
2. In the USL, what does the **β** term model, why does it scale ~`N²`, and what real-world failure does it predict that Amdahl cannot?
3. A thread blocks on a held mutex. Describe what physically happens and where the time goes — spin vs park, and the cost of each.
4. What is lock convoying, and why can it pin CPU at 100% while throughput collapses?
5. Two unrelated counters updated by two different cores make a parallel loop slower than single-threaded. No lock is involved. What's happening and how do you fix it?
6. Why is "one global atomic counter" not the scalable answer to a hot counter, and what is?
7. You run a Go service: it's slow, but CPU is only 30%. Which profile do you pull, and what are you looking for?

<details>
<summary>Answers</summary>

1. `S(∞) = 1/(1−p) = 1/0.05 = 20×`. With 16 cores: `1 / (0.05 + 0.95/16) = 1 / (0.05 + 0.0594) ≈ 9.1×`.
2. **β** is the *coherency* term — the cost of keeping shared state consistent across workers (cache-coherence traffic, lock-state sync). It scales `N·(N−1) ≈ N²` because each worker may coordinate with every other. It predicts that throughput **peaks then falls** with more cores — a cliff Amdahl (which only flattens) cannot model.
3. The thread either **spins** (busy-waits, burning a core — cheap only for nanosecond waits) or **parks** (sleeps, freeing its core but costing a ~1–5 µs context switch to wake, plus a cold cache on resume). Modern mutexes spin briefly, then park.
4. Threads arrive at a lock faster than the (short) critical section drains, forming a queue. Each release wakes a *sleeping* waiter, which pays a context switch + cache miss before doing tiny work. Handoff overhead dominates; the queue never empties; throughput collapses while CPU stays busy doing scheduling.
5. **False sharing:** the two counters share a 64-byte cache line, so each write invalidates the other core's copy, ping-ponging the line across the interconnect. Fix: **pad** each counter to its own cache line (56 bytes of padding after an `int64`, or `cpu.CacheLinePad` / Java `@Contended`).
6. A single atomic is still *one shared word* — under many cores it triggers a CAS-retry/coherency storm, the same `β·N²` cliff. The scalable answer is **per-core/per-goroutine counters incremented locally, summed on read** (the `LongAdder` pattern).
7. The **block profile** (and mutex profile). CPU-idle-but-slow means goroutines are *waiting*; you're looking for the call sites with the most blocking/contention time — likely a hot lock or a serializing channel.

</details>

---

## Cheat Sheet

```
THE TWO CEILINGS
  Amdahl  S(N) = 1 / ((1−p) + p/N)     ceiling = 1/(1−p)   (flattens)
  USL     C(N) = N / (1 + α(N−1) + β·N(N−1))               (peaks then DROPS)
          α = contention (serial/queue)   β = coherency (shared-state sync, ~N²)
          peak at N* = sqrt((1−α)/β)       β>0 ⇒ negative returns past N*

WHAT A CONTENDED LOCK COSTS
  spin   busy-wait, burns a core      good only for nanosecond waits
  park   sleep + wake = 1–5µs ctx switch + cold cache
  convoy arrivals > drain rate → handoff dominates → CPU 100%, throughput ↓

CONTENTION LADDER (climb only as far as the profile forces)
  1 shrink critical section  do expensive work OUTSIDE the lock
  2 shard / stripe locks     K shards by hash → K× parallel
  3 per-core state + merge    local writes (no lock), sum on read  ← LongAdder
  4 RWMutex                  reads≫writes & substantial work only (higher overhead)
  5 lock-free (atomic/CAS)   single instruction; CAS storms still hit β cliff

FALSE SHARING
  cores sync 64-byte LINES, not variables
  two hot fields in one line ping-pong across cores → pad to 64B
  Go: cpu.CacheLinePad   Java: @Contended

MEASURE (don't guess the hot lock)
  Go   SetMutexProfileFraction / SetBlockProfileRate
       go tool pprof .../mutex   (which lock)   .../block (where it stalls)
  Java JFR jdk.JavaMonitorEnter; async-profiler -e lock
  OS   perf lock record/report; perf stat -e context-switches,cpu-migrations

DIAGNOSE
  slow + CPU idle      → waiting    → block/mutex profile
  slow + CPU busy, no scaling → coordinating → ctx-switches; convoy/false-sharing
```

---

## Summary

- **Amdahl's Law** caps speedup at `1/(1−p)`: a 5%-serial program can never exceed 20×, no matter the core count. Shrinking the serial fraction beats buying cores.
- The **Universal Scalability Law** adds a coherency term **β** that scales ~`N²`, so real throughput doesn't merely flatten — it **peaks at `N* = sqrt((1−α)/β)` and then falls**. A down-bending scaling curve means too much shared mutable state, not too few cores.
- A contended lock converts work into **overhead**: spinning burns cores, parking costs 1–5 µs context switches, and **convoying** can pin CPU at 100% while throughput collapses.
- Reduce contention up a ladder: **shrink** the critical section, **shard/stripe** locks, go **per-core then merge** (the `LongAdder` pattern), use **RWMutex** only for read-heavy substantial work, and reach for **lock-free atomics/CAS** last.
- **False sharing** is contention by accident of memory layout — two hot fields in one 64-byte line ping-pong across cores. Pad hot, independently-written fields to a cache line.
- **Measure before you cut.** Go's mutex/block profiles, `perf lock`, and context-switch counters tell you *which* lock is hot and *whether* you're waiting or coordinating. Guessing is how seniors waste afternoons.

---

## Further Reading

- *Guerrilla Capacity Planning* — Neil Gunther. The source of the Universal Scalability Law; how to fit α and β to real measurements.
- *The Art of Multiprocessor Programming* — Herlihy & Shavit. The canonical treatment of locks, CAS, lock-free structures, and the costs underneath them.
- *Systems Performance* — Brendan Gregg. `perf`, context switches, CPU saturation vs utilization, and reading scaling behaviour from counters.
- Go blog & docs — `sync`, `sync/atomic`, and the pprof mutex/block profiles (`runtime.SetMutexProfileFraction`, `SetBlockProfileRate`).
- Java docs — `java.util.concurrent`, `LongAdder`, and `@Contended` for cache-line isolation.

---

## Related Topics

- [junior.md](junior.md) — goroutines/threads, mutexes, and why naive parallelism stops helping.
- [senior.md](senior.md) — fitting the USL to data, memory-ordering and the ABA problem, lock-free queues, and NUMA effects.
- [../03-latency-and-throughput/middle.md](../03-latency-and-throughput/middle.md) — Little's Law and how concurrency, latency, and throughput trade off.
- [../05-memory-and-allocation-profiling/middle.md](../05-memory-and-allocation-profiling/middle.md) — cache behaviour and the allocation cost that often hides behind "concurrency overhead."
