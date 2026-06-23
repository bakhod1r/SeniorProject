# Concurrency and Contention — Senior Level

> **Roadmap:** [Performance](../README.md) → Concurrency and Contention
> *The middle page taught you to find a lock and shrink its critical section. This page is about why adding cores stops helping — and sometimes starts hurting. The bottleneck is no longer your code; it's the cache-coherence fabric, the scheduler, and the silicon underneath, and the only way to reason about it is to model the cost of coordination itself.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Universal Scalability Law — Why Throughput Retrogrades](#the-universal-scalability-law--why-throughput-retrogrades)
4. [Cache Coherence Is the Root Cost — MESI and the Contended Atomic](#cache-coherence-is-the-root-cost--mesi-and-the-contended-atomic)
5. [True vs False Sharing — and the Cost of a Fence](#true-vs-false-sharing--and-the-cost-of-a-fence)
6. [Atomics and Lock-Free in Depth — CAS, ABA, Memory Ordering](#atomics-and-lock-free-in-depth--cas-aba-memory-ordering)
7. [When Lock-Free Actually Wins vs a Good Mutex](#when-lock-free-actually-wins-vs-a-good-mutex)
8. [NUMA — When Sharing Across Sockets Collapses](#numa--when-sharing-across-sockets-collapses)
9. [Scheduler Effects — Go's GMP, Work Stealing, Oversubscription](#scheduler-effects--gos-gmp-work-stealing-oversubscription)
10. [Advanced Patterns — RCU, Seqlocks, Per-CPU, Sharding, Flat Combining](#advanced-patterns--rcu-seqlocks-per-cpu-sharding-flat-combining)
11. [Diagnosing Contention — Mutex/Block Profiles, `perf c2c`, `perf lock`](#diagnosing-contention--mutexblock-profiles-perf-c2c-perf-lock)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Scalability engineering at the hardware and runtime level — modeling the cost of coordination so you can predict, and not just measure, where parallelism stops paying.**

By the middle level you can spot a hot lock in a mutex profile and tighten its critical section. That gets you a long way. The senior jump is qualitative: you stop asking "which lock is slow?" and start asking "what is the *shape* of this system's scalability curve, and what physical mechanism sets its ceiling?" Because the curve is never a straight line. Add cores and at first throughput rises; then it flattens; and past some point it *retrogrades* — eight cores deliver less than four. That retrograde is not a bug in your code. It is the cost of keeping caches coherent across a contended cache line, paid in hundreds of cycles per coordination event, multiplied by every core that touches the line.

This page is about that physical layer. We fit the **Universal Scalability Law** to real measurements so you can predict the optimal core count *before* you provision a 64-vCPU box. We trace a single contended atomic down to the **MESI** state transitions and the cache-line transfers it forces. We price the `LOCK` prefix, the memory fence, the CAS, and the ABA problem. We look at why a "lock-free" queue often loses to a well-engineered mutex, why crossing a **NUMA** socket boundary can 3x your memory latency, and how Go's **GMP** scheduler quietly decides whether your goroutines park or spin. Throughout, the discipline is the same as the rest of [Performance](../README.md): measure honestly, model the cost, and never add a core (or a thread, or an atomic) on faith.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — mutexes vs RWMutex, lock granularity, deadlock/livelock, channels vs shared memory, Amdahl's Law as a first-order model.
- **Required:** You can read a CPU profile and a mutex/block profile, and you know what a cache line is (64 bytes on x86-64/ARM64).
- **Helpful:** You've felt a service scale *worse* after you added more workers, and didn't have a model that explained it.
- **Helpful:** Comfort reading a few lines of x86-64 assembly (`lock cmpxchg`, `mfence`) and basic `perf` output.

---

## The Universal Scalability Law — Why Throughput Retrogrades

Amdahl's Law (middle.md) tells you a serial fraction caps speedup. It is optimistic: it assumes the only cost of parallelism is the serial work itself. Real systems pay a *second* tax — **coherency / crosstalk** — that *grows* with the number of workers, because workers must coordinate with each other, not just queue behind a serial section. Neil Gunther's **Universal Scalability Law (USL)** captures both:

```
              N
C(N) = ───────────────────────────
        1 + α(N − 1) + β·N(N − 1)
```

- `C(N)` = relative capacity (throughput) at `N` workers, normalized so `C(1) = 1`.
- `α` (**contention**) = the serial fraction — Amdahl's term. Cost grows linearly with `N`.
- `β` (**coherency**) = the crosstalk / coherence cost — pairwise coordination. Cost grows as `N²`.

The `β·N²` term is the whole story of this page. When `β = 0`, USL collapses to Amdahl. When `β > 0`, `C(N)` does not merely flatten — it has a **maximum** and then **decreases**. That is *retrograde scaling*: past a point, each added worker spends more on coherence traffic than it contributes in work.

**The optimal worker count** is where `dC/dN = 0`:

```
N_max = sqrt( (1 − α) / β )
```

This is the single most actionable number in capacity planning for a contended service. If your fit gives `α = 0.03, β = 0.0001`, then `N_max ≈ sqrt(0.97 / 0.0001) ≈ 98` — scale past ~98 workers and you *lose* throughput. A tiny `β` matters enormously because it is multiplied by `N²`.

**Fitting α and β to measured data.** This is real engineering, not theory. Procedure:

1. Measure throughput at several worker counts: `N = 1, 2, 4, 8, 16, 32, 48, 64`. Use a steady-state load, identical per-request work, warmed caches/JIT.
2. Normalize: `C(N) = throughput(N) / throughput(1)`.
3. Fit the two-parameter model by nonlinear least squares (R's `usl` package, Python `scipy.optimize.curve_fit`, or Gunther's own tooling). Equivalently, linearize: define *efficiency* `C(N)/N` and regress the "deviation from linearity" `N/C(N) − 1` against `N`.

```python
import numpy as np
from scipy.optimize import curve_fit

N  = np.array([1, 2, 4, 8, 16, 32, 48, 64])
C  = np.array([1, 1.9, 3.6, 6.3, 9.8, 12.5, 12.1, 10.9])  # measured, normalized

def usl(n, alpha, beta):
    return n / (1 + alpha*(n-1) + beta*n*(n-1))

(alpha, beta), _ = curve_fit(usl, N, C, bounds=(0, [1, 1]))
n_max = np.sqrt((1 - alpha) / beta)
print(f"alpha={alpha:.4f} beta={beta:.6f} N_max={n_max:.1f}")
# alpha=0.0250 beta=0.000420 N_max≈48.4  → matches the C=12.5 peak at N=32–48
```

The data above *peaks* near `N = 32` and is already retrograde at `N = 64` — exactly the signature of nonzero `β`. The fit tells you the peak is ~48 and quantifies *why*: `β = 4.2e-4` is the coherence cost per pair of workers fighting over shared state.

> **Key insight:** Amdahl explains why speedup flattens; the USL's `β·N²` term explains why it *reverses*. If you ever see throughput drop as you add cores, you are not looking at a scheduling glitch — you are looking at coherency cost, and the fix is to lower `β` (reduce shared mutable state), not to add hardware.

What lowers `β`? Everything in the rest of this page: removing false sharing, sharding hot state, using per-CPU data, replacing a global counter with a contended-atomic-free design. What lowers `α`? Shrinking critical sections. They are different problems with different fixes, and the USL is how you tell which one is killing you.

---

## Cache Coherence Is the Root Cost — MESI and the Contended Atomic

A multicore CPU is a distributed system. Each core has private L1/L2 caches; they share an L3. When two cores read and write the *same* 64-byte cache line, the hardware must keep them consistent — that is the **cache coherence protocol**, and on x86 it is a variant of **MESI**. Every cache line, in every core's cache, is in one of four states:

| State | Meaning | Can read? | Can write? |
|---|---|---|---|
| **M** odified | This core has the only copy, and it's dirty | yes | yes |
| **E** xclusive | This core has the only copy, clean (matches memory) | yes | yes (→ M) |
| **S** hared | Multiple cores may hold a clean copy | yes | no (must invalidate others first) |
| **I** nvalid | This core's copy is stale/absent | no | no |

The rule that costs you money: **a core cannot write a line unless it holds it in M or E.** To write a line that other cores hold in S, it must first send an invalidation (a *Request For Ownership*) over the interconnect, wait for every other core to drop the line to I, and only then transition to M. To *read* a line another core holds in M, it must force that core to write back / share, transitioning M→S.

Now consider a "contended atomic" — say an atomic counter incremented by many cores:

```
Core 0: line in M (just wrote it)
Core 1: wants to increment → its copy is I
   1. Core 1 issues RFO for the line
   2. Core 0's copy: M → I, line transferred to Core 1
   3. Core 1: I → M, performs the increment
Core 2: wants to increment → repeat, bouncing the line off Core 1
```

The line **ping-pongs** between caches. Each transfer is not a local L1 hit (~4 cycles) — it is a *cross-core cache-line transfer*: tens of cycles if the line comes from a sibling core sharing L3, **hundreds of cycles** if it must traverse the interconnect, and *worse across sockets* (next section). This is why a single contended atomic counter — code that looks trivially cheap — can become the dominant cost in a 32-core service. Each `atomic.Add` is not "one instruction"; it is "acquire the line in M, which may cost 100–300 cycles of coherence traffic under contention."

```go
// The classic scaling killer: one global atomic counter, N goroutines.
var ops int64
func worker() { for { atomic.AddInt64(&ops, 1) /* ... */ } }
// At N=1 this is ~5 ns/op. At N=32 it can be 100+ ns/op — not because the ADD
// got slower, but because the cache line bounces across 32 cores. Pure β.
```

The hardware mechanism is the same whether you write Go's `atomic.AddInt64`, Java's `AtomicLong.incrementAndGet`, or C++'s `std::atomic<long>::fetch_add`. The contended cache line is language-agnostic; it is silicon.

> **Key insight:** A contended atomic is expensive not because the *instruction* is slow but because it forces a cache line into Modified state on one core, invalidating every other core's copy. The cost is the coherence traffic, and it scales with the number of contending cores — this *is* the USL's `β` term, made physical.

---

## True vs False Sharing — and the Cost of a Fence

Coherence traffic comes in two flavors, and only one is a real data dependency.

**True sharing:** two cores genuinely read/write the same variable. The ping-pong is inherent; the only fix is algorithmic (shard the variable, use per-CPU data, batch updates).

**False sharing:** two cores touch *different* variables that happen to live on the *same 64-byte cache line*. There is no logical dependency, but the hardware tracks coherence at cache-line granularity, so writing one variable invalidates the other core's copy of the unrelated variable. Pure waste.

```go
// FALSE SHARING: two counters, adjacent in memory → same cache line.
type Counters struct {
    a int64  // written by goroutine A
    b int64  // written by goroutine B  — invalidates A's line on every write
}
// Fix: pad so each counter owns its own cache line.
type PaddedCounters struct {
    a int64
    _ [56]byte  // pad: 8 (a) + 56 = 64 bytes → b starts a new line
    b int64
    _ [56]byte
}
```

The measured effect is dramatic and counterintuitive: padding — *wasting* 56 bytes per counter — can make the program **5–10x faster** under contention, because it eliminates coherence traffic that was invisible in the source. Java offers `@Contended` (with `-XX:-RestrictContended`) to do the padding for you; C++ exposes `std::hardware_destructive_interference_size` (the cache-line size for padding apart) and `std::hardware_constructive_interference_size` (for packing together).

```java
@jdk.internal.vm.annotation.Contended
static volatile long counterA;   // JVM pads it onto its own cache line
```

**The cost of a memory fence.** Atomics don't only move cache lines; depending on the memory model they also emit *barriers* that constrain instruction and store-buffer reordering. On x86 (a strong, TSO model), most atomics are nearly free *in barrier terms*: plain loads are acquire, plain stores are release, and only a full **sequentially-consistent** operation needs a real fence. A sequentially-consistent store compiles to a locked instruction or an explicit `mfence`, draining the store buffer — **~20–100 cycles** depending on store-buffer occupancy:

```asm
; C++  std::atomic<int> x;  x.store(1, std::memory_order_seq_cst);  on x86-64:
mov     dword ptr [x], 1
mfence                       ; ~20-100 cycles: drains the store buffer

; vs  x.store(1, std::memory_order_release);   — NO fence on x86:
mov     dword ptr [x], 1     ; a plain store IS a release on TSO
```

On weakly-ordered ARM64 the picture differs: acquire/release are not free — they compile to `ldar`/`stlr` (load-acquire / store-release) instructions, and seq-cst adds `dmb ish` data-memory barriers. This is why memory-ordering choices that are "free" on x86 carry real cost on ARM (and why x86-tuned lock-free code sometimes regresses on Graviton/Apple Silicon).

> **Key insight:** False sharing is true coherence cost paid for a *false* logical dependency — the fix is padding, not algorithm change. And the cost of a fence is model-dependent: nearly free on x86 TSO, a real instruction (`dmb`) on ARM. Always know which memory model your hot path will actually run on.

---

## Atomics and Lock-Free in Depth — CAS, ABA, Memory Ordering

**Compare-And-Swap (CAS)** is the primitive under nearly all lock-free code: atomically, "if `*addr == expected`, set `*addr = new` and return true; else return false." It compiles to a single locked instruction:

```asm
; C++  std::atomic<long>::compare_exchange_weak  on x86-64:
lock cmpxchg qword ptr [rdi], rsi   ; the LOCK prefix asserts cache-line ownership
                                    ; ~15-25 cycles uncontended;
                                    ; 100-300+ cycles under heavy contention
```

The **`LOCK` prefix** is the whole cost. On modern x86 it does not lock the bus (that would be catastrophic); it locks the *cache line* via the coherence protocol — exactly the M-state acquisition from the MESI section. Uncontended, `lock cmpxchg` is ~15–25 cycles. Under contention it inherits the full cache-line-transfer cost, and worse: a CAS *loop* (the standard lock-free idiom) spins, and every failed iteration is a wasted RFO that re-bounces the line.

```go
// Lock-free increment via CAS loop. Each iteration acquires the line in M.
for {
    old := atomic.LoadInt64(&v)
    if atomic.CompareAndSwapInt64(&v, old, old+1) { break }
    // CAS failed → someone else won → retry → another cache-line bounce
}
// Under high contention this can do MORE coherence traffic than a mutex,
// because failed CAS retries keep re-acquiring the contended line.
```

**The ABA problem.** CAS checks the *value*, not whether it *changed and changed back*. Thread 1 reads value `A`; before its CAS, Thread 2 changes `A→B→A`. Thread 1's CAS succeeds — the value is `A` again — but the world underneath may have changed (the node it pointed to was freed and reallocated). This corrupts lock-free stacks/queues built on pointer CAS. Fixes:

- **Tagged pointers / version counters:** CAS a `(pointer, counter)` pair (double-width CAS, `lock cmpxchg16b` on x86-64) so any reuse bumps the counter.
- **Hazard pointers** or **epoch-based reclamation:** prevent freeing memory another thread might still CAS against — the hard part of lock-free isn't the algorithm, it's *safe memory reclamation*.

**Memory ordering — the three orderings you actually use:**

| Ordering | Guarantees | x86 cost | ARM64 cost |
|---|---|---|---|
| `relaxed` | Atomicity only; no ordering vs other vars | plain `lock` op | plain atomic |
| `acquire` (load) / `release` (store) | A release-store *happens-before* the acquire-load that reads it → publishes a payload safely | free (TSO) | `ldar` / `stlr` |
| `seq_cst` | Single global total order across all seq-cst ops | `mfence` / locked op | `dmb ish` |

The canonical pattern is **acquire/release for publication**: write the data, then `release`-store a "ready" flag; the reader `acquire`-loads the flag and is guaranteed to see the data. You almost never need `seq_cst` — it is the default in C++ and Java precisely because it's the *safest*, but it is also the most expensive, and senior code downgrades to acquire/release where the algorithm allows.

```cpp
std::atomic<bool> ready{false};
Data payload;
// producer:
payload = compute();
ready.store(true, std::memory_order_release);   // publishes payload
// consumer:
while (!ready.load(std::memory_order_acquire)) {}  // sees payload once true
use(payload);
```

In Java the same is expressed with `VarHandle` (`setRelease` / `getAcquire`) or `volatile` (which is seq-cst); Go's `sync/atomic` gives you sequentially-consistent atomics only — there is no relaxed/acquire/release knob, a deliberate simplicity choice that occasionally leaves performance on the table versus C++/Java.

> **Key insight:** A CAS loop is not automatically faster than a lock — under contention each failed retry is another cache-line bounce, and you still have to solve safe memory reclamation (ABA). Lock-free buys you *progress guarantees* and *no scheduler interaction*, not free performance.

---

## When Lock-Free Actually Wins vs a Good Mutex

Lock-free is fashionable and frequently wrong. A well-implemented mutex is genuinely fast and has properties naive lock-free code lacks. Where each wins:

**A good mutex wins when:**
- Contention is low. An uncontended mutex acquire is a single CAS on the fast path (~15–25 cycles) — same as a lock-free CAS — and far simpler. Go's `sync.Mutex`, Java's biased/lightweight locks, and `std::mutex` over a futex all have a near-free fast path.
- The critical section is non-trivial. Lock-free shines for tiny operations (counter, single pointer swap); for anything substantial, the lock's cost is amortized and lock-free becomes infeasible.
- Fairness or simplicity matters. Mutexes can be made fair (Go's mutex has a starvation mode that hands the lock to a waiting goroutine after 1 ms); fair lock-free is brutally hard.

**Lock-free wins when:**
- You need **progress guarantees**: a thread holding a mutex that gets preempted (or page-faults, or is descheduled by the OS) blocks *everyone*. Lock-free's whole point is that no single thread's stall halts the system — essential in real-time, interrupt handlers, and signal handlers where you *cannot* block.
- Contention is moderate *and* the operation is a single-word atomic. A sharded/striped counter (next sections) beats a mutex by avoiding the lock entirely.
- You're avoiding the **lock convoy** and the **parking cost**: a contended mutex that puts threads to sleep pays a syscall (futex wait) and a context switch (~1–5 μs) on every contended acquire/release; lock-free spins in user space and avoids that.

The honest middle ground that most real systems should reach for first: **don't go lock-free, go contention-free.** Shard the hot state so cores rarely touch the same line at all. A per-CPU counter array summed on read beats both a global mutex and a global atomic, because it removes contention rather than making it cheaper.

> **Key insight:** "Lock-free" is a correctness/progress property, not a speed property. Before reaching for a lock-free queue, ask whether you can make the contention *disappear* via sharding — that beats both the mutex and the lock-free version, and it's far easier to get right.

---

## NUMA — When Sharing Across Sockets Collapses

On a single-socket machine, all cores share one memory controller and one L3; the coherence costs above are bounded. On a **multi-socket** (or multi-die, like AMD's chiplets) machine, memory is **Non-Uniform**: each socket has its own memory controller and *local* DRAM. Accessing your socket's local memory is fast; accessing the *other* socket's memory crosses the inter-socket interconnect (Intel UPI, AMD Infinity Fabric):

| Access | Approximate latency |
|---|---|
| L1 hit | ~1 ns (4 cycles) |
| L3 hit (local) | ~15 ns |
| Local DRAM | ~80–100 ns |
| **Remote DRAM (other socket)** | **~120–200 ns (1.5–2x local)** |
| **Remote cache (coherence miss to other socket)** | **~200–300+ ns** |

The killer is not just remote *data* — it's remote *coherence*. A cache line contended across sockets must bounce over the interconnect on every transfer. The same atomic counter that costs ~100 cycles within a socket can cost ~300+ cycles when the contending cores live on different sockets. This is why a service that scales fine to 16 cores on one socket can *collapse* at 32 cores spanning two sockets — you crossed a NUMA boundary and every shared line now pays interconnect latency.

**Placement is the fix:**

```bash
numactl --hardware                       # show NUMA topology, node distances
numactl --cpunodebind=0 --membind=0 ./app   # pin to node 0: local memory only
```

- **First-touch allocation:** Linux allocates a page on the NUMA node of the thread that *first writes* it. So *initialize data on the thread that will use it*, not all on the main thread — otherwise all your "thread-local" arrays sit in node 0's memory and every other node pays remote latency.
- **Thread + memory affinity:** pin worker threads to cores and their data to the same node (`numactl`, `sched_setaffinity`, `libnuma`). Go has no first-class NUMA API; large Go services often run *one process per NUMA node* and shard work across them rather than fighting the scheduler.
- **Avoid cross-socket shared mutable state entirely.** Per-node sharded structures turn a NUMA problem back into a single-socket coherence problem.

> **Key insight:** NUMA turns "shared mutable state is expensive" into "shared mutable state across sockets is catastrophic." Naive sharing that's merely slow on one socket *collapses* across two. Pin threads and memory to the same node, initialize data where it's used, and shard per-node.

---

## Scheduler Effects — Go's GMP, Work Stealing, Oversubscription

Coordination cost isn't only hardware — the runtime scheduler decides whether a blocked worker *spins* (burning a core but staying warm) or *parks* (freeing the core but paying a syscall + context switch to wake). Getting this wrong manufactures contention that no profiler attributes to your locks.

**Go's GMP model:**
- **G** = goroutine (cheap, ~2 KB initial stack).
- **M** = OS thread (the actual kernel-scheduled entity).
- **P** = processor / scheduling context; there are exactly `GOMAXPROCS` of them. A G must hold a P (via an M) to run Go code.

Each P has a **local run queue** (256 goroutines) plus a shared **global run queue**. When a P's local queue empties, it **work-steals** half of another P's queue — keeping cores busy without a global lock on the common path. This is why Go scales well by default: scheduling is mostly P-local, contention-free.

```go
runtime.GOMAXPROCS(0)   // read current P count (defaults to runtime.NumCPU())
```

Where it goes wrong:

- **`GOMAXPROCS` mismatch in containers.** Go ≤1.24 defaults `GOMAXPROCS` to the *host* CPU count, ignoring the cgroup CPU quota. On a 64-core host with a 4-CPU limit, Go spawns 64 Ps competing for 4 cores' worth of CFS time → massive context-switch thrashing and tail-latency blowup. Fix: set `GOMAXPROCS` to the quota (the `automaxprocs` library, or Go 1.25+ which reads the cgroup). This is one of the most common production Go performance bugs.
- **Thread oversubscription.** More runnable threads than cores means the OS time-slices them; every slice is a context switch (~1–5 μs) plus cold caches (TLB + L1/L2 reload — often the bigger cost). A thread pool sized to `2 × cores` "to be safe" can be *slower* than `1 × cores` for CPU-bound work. Size pools to cores for CPU-bound work; oversubscribe only for I/O-bound work where threads block.
- **Parking vs spinning.** When a goroutine blocks on a contended mutex, the runtime spins briefly (cheap, stays warm) then parks via a futex (frees the P, but waking later costs a syscall + reschedule + cold cache). Go's runtime tunes this; in your own code, a tight spin-wait on a multi-tenant machine *steals* cycles from the very thread holding the lock — the classic spinlock-in-userspace anti-pattern. Prefer `sync.Mutex` (which spins *then* parks) over hand-rolled spins.

Java's analog: the ForkJoinPool / common pool also work-steals; `Thread.onSpinWait()` (→ `pause` on x86, `yield`/`isb` on ARM) hints the CPU during a spin to reduce power and contention. Virtual threads (Project Loom) move Java toward Go's M:N model, parking cheaply on blocking I/O.

> **Key insight:** The scheduler decides whether a blocked worker burns a core (spin) or frees it but pays to wake (park) — and oversubscription multiplies context-switch and cache-reload cost. In containers, the single highest-impact fix is matching `GOMAXPROCS` (or the thread-pool size) to the *cgroup quota*, not the host core count.

---

## Advanced Patterns — RCU, Seqlocks, Per-CPU, Sharding, Flat Combining

When contention is the bottleneck, the senior toolkit is about *removing* it, not making locks faster.

**Sharded / striped structures.** Split one hot variable into `K` independent ones (one per shard, padded to a cache line), so cores hit different lines. Java's `LongAdder` is the canonical example: instead of one contended `AtomicLong`, it keeps a per-thread-ish cell array and sums on `sum()`. Writes are contention-free; reads pay an O(K) sum. Use it for monotonic counters where exact instantaneous reads don't matter.

```java
LongAdder hits = new LongAdder();
hits.increment();   // hits a thread-local cell — no global cache-line bounce
long total = hits.sum();   // O(cells), reads all shards
```

**Per-CPU data.** The extreme of sharding: one instance per core, accessed without any atomic on the write path (the Linux kernel's `percpu` variables, or `restartable sequences` in userspace). Reads aggregate across CPUs. Zero coherence traffic on writes — the gold standard for stats counters.

**RCU (Read-Copy-Update).** For read-mostly data (config, routing tables): readers take *no lock and no atomic* — they just dereference the current pointer, paying nothing on the read path. A writer makes a *copy*, mutates it, and atomically swaps the pointer; old readers keep using the old copy until they finish (a *grace period*), after which the old copy is freed. Readers are effectively free; the cost moves entirely to the (rare) writer and the reclamation machinery. Ubiquitous in the Linux kernel; available in userspace via `liburcu`.

**Seqlocks (sequence locks).** For small, frequently-read, occasionally-written data (e.g., a timestamp or a coordinate pair): a writer bumps a sequence counter (odd = write in progress), writes, bumps again (even). A reader reads the counter, reads the data, re-reads the counter; if it changed or was odd, it retries. Readers never block writers and take no lock — but readers may *spin/retry* under write pressure, so it's for read-heavy, write-rare data only.

**Flat combining.** Counterintuitive but powerful under *high* contention: instead of every thread fighting for the lock, threads publish their operation to a shared list; *one* thread becomes the "combiner," acquires the lock once, and executes everyone's operations in a batch. This trades many contended lock acquisitions for one, and exploits cache locality (the combiner has the data hot). It can beat lock-free structures when contention is extreme because it eliminates the cache-line ping-pong of many CASs.

The selection logic: **read-mostly → RCU or seqlock; write-heavy counter → sharded/per-CPU; extreme contention on a complex structure → flat combining; everything else → a plain mutex with a small critical section.**

> **Key insight:** The best contention fix is to stop sharing the line. Sharding, per-CPU data, and RCU all attack `β` directly by ensuring cores rarely touch the same cache line — which beats any amount of cleverness in making a *contended* operation cheaper.

---

## Diagnosing Contention — Mutex/Block Profiles, `perf c2c`, `perf lock`

You cannot fix what you cannot attribute. The senior diagnostic stack moves from "which lock" down to "which cache line."

**Go mutex and block profiles** answer "where do goroutines wait?":

```go
runtime.SetMutexProfileFraction(1)   // sample every contended mutex event
runtime.SetBlockProfileRate(1)       // sample every blocking event (chan, select, mutex)
// then: go tool pprof http://.../debug/pprof/mutex
//       go tool pprof http://.../debug/pprof/block
```

- **mutex profile** = time spent *waiting to acquire* a mutex → true lock contention.
- **block profile** = time blocked on any sync primitive (channel send/recv, select, `WaitGroup`) → often reveals an under-provisioned channel or a serialization point you didn't see as a "lock."

Java's analog: async-profiler with `-e lock` (lock contention profiling) and JFR's `jdk.JavaMonitorEnter` events.

**`perf c2c` — cache-to-cache, the false-sharing finder.** This is the tool that *names the contended cache line* and shows which CPUs and which source-level fields are fighting over it:

```bash
perf c2c record -- ./app
perf c2c report -NN -d lcl     # shows HITM (hit-modified) events per cache line
# Look for high "HITM" (a load that hit a line Modified in ANOTHER core's cache):
#   each HITM is a cross-core coherence miss — the physical signature of (false) sharing.
#   The report breaks down the offending cache line by byte offset → which fields collide.
```

A high **HITM** (load-that-hit-modified-remotely) count on a single cache line, with two different *fields* of a struct at different offsets, is the unambiguous fingerprint of **false sharing** — go add padding. If it's the *same* field, it's true sharing — go shard or remove the contention.

**`perf lock` — kernel-level lock contention:**

```bash
perf lock record -- ./app
perf lock report      # contended kernel locks: wait time, acquisitions, contention count
perf lock contention  # (newer perf) live contention view
```

**Top-down complements:** rising `context-switches` and high `cpu-migrations` in `perf stat` point at oversubscription/scheduler thrash; a high *stalled-cycles-backend* with lots of LLC misses points at coherence/NUMA traffic.

```bash
perf stat -e context-switches,cpu-migrations,cache-misses,LLC-load-misses ./app
```

> **Key insight:** Climb the abstraction ladder: mutex/block profile → *which lock or channel*; `perf lock` → *which kernel lock*; `perf c2c` → *which cache line and which fields*. False sharing is invisible to every profiler except `perf c2c`, which is why it's the senior's secret weapon — a high remote-HITM count on one line is contention you'd otherwise never find in the source.

---

## Mental Models

- **A multicore CPU is a distributed system.** Cores coordinate over a coherence fabric with real latency. Every "shared variable" is a tiny distributed-consensus problem, and the USL's `β·N²` term is the cost of that consensus growing with the number of participants.

- **The cache line is the unit of contention, not the variable.** The hardware tracks coherence per 64-byte line. Two unrelated variables on one line contend as if they were the same variable (false sharing); one variable split across cache lines doesn't contend at all (sharding). Reason in cache lines.

- **Amdahl explains the plateau; the USL explains the cliff.** If throughput merely flattens, you have a serial section (`α` — shrink the critical section). If it *retrogrades*, you have coherency cost (`β` — stop sharing the line). The fixes are different; the USL tells you which you have.

- **Lock-free is a progress guarantee, not a speed guarantee.** It buys you "no single stalled thread halts the system," at the cost of solving ABA and safe memory reclamation. Often the right answer is neither lock nor lock-free, but *contention-free* (sharding).

- **The scheduler decides spin-or-park, and the memory model decides fence-or-free.** Both are invisible in your source and both dominate under contention. Know your runtime (GMP, `GOMAXPROCS` vs cgroup) and your memory model (x86 TSO vs ARM weak) before you tune.

---

## Common Mistakes

1. **Adding cores/workers to a retrograde system.** If you're past `N_max`, more workers *lose* throughput. Fit the USL; if `β` is the problem, hardware makes it worse, not better. Reduce shared mutable state instead.

2. **Treating a contended atomic as "one cheap instruction."** Under contention `atomic.Add` / `fetch_add` / `incrementAndGet` costs 100–300 cycles of cache-line transfer, not the ~5 cycles of the uncontended op. A global atomic counter is a classic scaling killer — shard it (`LongAdder`, per-CPU cells).

3. **Ignoring false sharing.** Two hot fields on one cache line silently cost a 5–10x slowdown that no ordinary profiler shows. Pad hot, independently-written fields to cache-line boundaries; verify with `perf c2c`.

4. **Reaching for lock-free reflexively.** A CAS loop under contention can do *more* coherence traffic than a mutex (every failed retry re-bounces the line), and you still must solve ABA/reclamation. Default to a mutex with a tiny critical section; go lock-free only for progress guarantees or proven single-word hotspots.

5. **Using `seq_cst` everywhere.** It's the default because it's safest, but it emits the most expensive fences (`mfence`/`dmb`). Downgrade to acquire/release for publication patterns where the algorithm allows — especially on ARM, where the difference is real instructions.

6. **Letting `GOMAXPROCS` (or thread-pool size) default to host cores in a container.** A 4-CPU-quota pod running 64 Ps thrashes on context switches. Match the scheduler width to the cgroup quota (`automaxprocs` / Go 1.25+).

7. **Sharing mutable state across NUMA sockets.** A line contended across sockets costs interconnect latency on every transfer — a service that's fine at 16 cores on one socket can collapse at 32 across two. Pin threads + memory to a node, first-touch where used, shard per-node.

8. **Oversubscribing threads for CPU-bound work.** `2 × cores` "to be safe" multiplies context switches and cache reloads. Size to `cores` for CPU-bound; oversubscribe only for blocking I/O.

---

## Test Yourself

1. Write the USL formula and explain what `α` and `β` physically represent. Why does nonzero `β` cause *retrograde* scaling, and how do you compute the optimal worker count?
2. Trace, in MESI states, what happens when two cores on the same socket repeatedly increment the same atomic counter. Where does the cost come from?
3. What is false sharing, why does padding a struct *waste memory to gain speed*, and which single tool reliably detects it?
4. Explain the ABA problem in a CAS-based lock-free stack and name two ways to fix it.
5. When does a well-engineered mutex beat a lock-free structure? When does lock-free genuinely win?
6. Why can a service that scales to 16 cores on one socket collapse at 32 cores across two sockets? What's the fix?
7. A Go service in a 4-CPU-quota container shows huge tail latency and high context-switch counts under load. What's the most likely cause and the fix?

<details>
<summary>Answers</summary>

1. `C(N) = N / (1 + α(N−1) + β·N(N−1))`. `α` is the **contention/serial** fraction (Amdahl's term, cost grows ∝ N); `β` is the **coherency/crosstalk** cost of pairwise coordination (cost grows ∝ N²). Because the `β·N²` term grows faster than the `N` numerator, `C(N)` reaches a maximum and then *decreases* — retrograde scaling. Optimal count: `N_max = sqrt((1 − α) / β)`.
2. Core A holds the line in **M** after writing. Core B's copy is **I**; to increment it issues a Request-For-Ownership, forcing A's line **M→I** and transferring the line to B, which goes **I→M** and writes. Then A wants it back → repeat. The line **ping-pongs** between caches; the cost is the cross-core cache-line transfer (tens of cycles within L3, hundreds across the interconnect), not the ADD itself.
3. False sharing = two *different* variables on the same 64-byte cache line, so writing one invalidates the other core's copy despite no logical dependency. Padding moves each hot variable to its own line, eliminating that coherence traffic — wasting ~56 bytes to remove 5–10x of coherence cost. `perf c2c` (look for high remote-HITM on one line, with colliding fields at different byte offsets) reliably detects it.
4. ABA: Thread 1 reads pointer `A`; Thread 2 pops `A`, pushes `B`, then pushes `A` again (reusing freed memory); Thread 1's CAS sees `A` and succeeds, but the structure underneath changed → corruption. Fixes: (a) tagged pointer / version counter via double-width CAS (`cmpxchg16b`) so reuse bumps the tag; (b) safe memory reclamation — hazard pointers or epoch-based reclamation — so memory isn't freed while another thread might CAS it.
5. A mutex wins under low contention (uncontended acquire is one CAS, ~15–25 cycles), for non-trivial critical sections, and when you need fairness/simplicity. Lock-free wins when you need **progress guarantees** (a preempted/page-faulted thread mustn't halt everyone — real-time, signal handlers), and for proven single-word hotspots where it avoids the futex/park syscall. Often best of all: make contention *disappear* via sharding.
6. Crossing a socket boundary makes shared cache lines bounce over the inter-socket interconnect (UPI/Infinity Fabric) — remote coherence misses cost ~200–300+ cycles vs ~100 within a socket, and remote DRAM is 1.5–2x local. Fix: pin threads and their memory to the same NUMA node (`numactl`/affinity), use first-touch initialization on the using thread, and shard state per-node so lines stay socket-local.
7. Go (≤1.24) defaults `GOMAXPROCS` to the **host** core count, ignoring the cgroup quota → 64 Ps fighting for 4 CPUs of CFS time, thrashing on context switches. Fix: set `GOMAXPROCS` to the quota via `automaxprocs` (or upgrade to Go 1.25+, which reads the cgroup limit).

</details>

---

## Cheat Sheet

```
UNIVERSAL SCALABILITY LAW
  C(N) = N / (1 + α(N−1) + β·N(N−1))
  α = contention (serial, ∝N) ; β = coherency (crosstalk, ∝N²)
  N_max = sqrt((1−α)/β)              optimal worker count (peak throughput)
  retrograde scaling ⇒ β>0 ⇒ reduce SHARED STATE, not add cores
  fit:  scipy curve_fit(usl, N, C)  or  R `usl` package

CACHE COHERENCE (MESI)  — cost is the cache-line transfer, not the instruction
  M/E = exclusive (can write) ; S = shared (read-only) ; I = stale
  contended atomic → line ping-pongs → 100–300 cycles cross-core
  L1 ~4cy | L3 ~15ns | local DRAM ~90ns | REMOTE DRAM ~150ns | remote HITM ~300cy

SHARING
  cache line = 64B = unit of contention
  false sharing = different vars, same line → PAD to 64B  (Go [56]byte, Java @Contended)
  true sharing  = same var → SHARD / per-CPU / RCU

ATOMICS / MEMORY ORDER (x86 TSO vs ARM weak)
  lock cmpxchg  ~15–25cy uncontended, 100–300+ contended (LOCK = own cache line)
  relaxed: atomicity only | acq/rel: publish (free x86 / ldar-stlr ARM)
  seq_cst: global order, mfence(x86)/dmb(ARM) ~20–100cy — avoid if acq/rel suffices
  ABA → tagged ptr (cmpxchg16b) or hazard ptrs / epoch reclamation

SCHEDULER (Go GMP)
  G=goroutine M=thread P=ctx(=GOMAXPROCS); P-local runq + work stealing
  CONTAINER BUG: GOMAXPROCS=host cores ≠ cgroup quota → use automaxprocs / Go1.25+
  CPU-bound → pool=cores ; I/O-bound → oversubscribe ; mutex spins THEN parks

DIAGNOSE
  Go: SetMutexProfileFraction / SetBlockProfileRate → pprof mutex|block
  perf c2c report -d lcl     → remote-HITM per line = (false) sharing  ⭐
  perf lock contention       → kernel lock waits
  perf stat -e context-switches,cpu-migrations,LLC-load-misses
```

---

## Summary

- **The USL is the model that explains retrograde scaling.** `C(N) = N / (1 + α(N−1) + β·N(N−1))`: `α` is the serial fraction (Amdahl), `β` is coherency cost that grows as `N²` and *reverses* throughput past `N_max = sqrt((1−α)/β)`. Fit it to measured data to find the optimal core count and to tell an `α` problem from a `β` problem.
- **Cache coherence is the physical root of `β`.** A contended atomic forces a cache line into Modified state on one core, invalidating all others; the line ping-pongs at 100–300 cycles per transfer. The cost is coherence traffic, not the instruction — and it's language-agnostic silicon.
- **The cache line is the unit of contention.** False sharing (unrelated fields, one line) costs 5–10x and is invisible except to `perf c2c`; fix with padding. True sharing needs algorithmic change (sharding, per-CPU, RCU).
- **Atomics and lock-free are subtle.** `lock cmpxchg` owns a cache line; CAS loops re-bounce it on every retry; ABA demands tagged pointers or safe reclamation; memory ordering is free on x86 TSO but real instructions on ARM. Lock-free buys *progress*, not speed — prefer a small-critical-section mutex or, better, *contention-free* sharding.
- **NUMA turns expensive into catastrophic.** Cross-socket coherence pays interconnect latency on every transfer; pin threads + memory per node, first-touch where used, shard per-node.
- **The scheduler and the container shape contention.** GMP work-stealing scales by default, but a `GOMAXPROCS` that ignores the cgroup quota thrashes; oversubscription multiplies context-switch and cache-reload cost. Match scheduler width to the quota; size CPU-bound pools to cores.

You now reason about parallelism as a cost model — coordination has a price set by silicon, and the USL, MESI, and the scheduler tell you what that price is *before* you provision hardware. The next layer — [professional.md](professional.md) — is about operating these decisions across a fleet: capacity models, contention SLOs, and regression-guarding concurrency at organizational scale.

---

## Further Reading

- *Guerrilla Capacity Planning* — Neil Gunther. The origin and derivation of the Universal Scalability Law, with worked fitting examples.
- *The Art of Multiprocessor Programming* — Herlihy & Shavit. The canonical treatment of CAS, lock-free/wait-free structures, ABA, and progress guarantees.
- Ulrich Drepper, *What Every Programmer Should Know About Memory* — caches, MESI, false sharing, and NUMA from first principles.
- *C++ Concurrency in Action* (2nd ed.) — Anthony Williams. The clearest practical guide to `std::atomic` and the C++ memory model (relaxed/acquire-release/seq-cst).
- Paul McKenney, *Is Parallel Programming Hard, And, If So, What Can You Do About It?* — RCU, hazard pointers, per-CPU data, and memory ordering, from the Linux RCU maintainer (free PDF).
- `perf c2c` documentation and Joe Mario's "C2C — False Sharing Detection in Linux Perf" — using HITM events to find contended cache lines.
- The Go runtime scheduler design docs (`src/runtime/proc.go` comments) and the `automaxprocs` README — GMP, work stealing, and the container `GOMAXPROCS` problem.

---

## Related Topics

- [junior.md](junior.md) — what a race condition and a mutex are, the first model of shared state.
- [middle.md](middle.md) — lock granularity, RWMutex, deadlock/livelock, Amdahl's Law as the first scaling model.
- [professional.md](professional.md) — operating concurrency at fleet scale: capacity models, contention SLOs, regression-guarding parallel code.
- [04 — CPU-Bound Optimization › Senior](../04-cpu-bound-optimization/senior.md) — the single-core counterpart: when the bottleneck is compute and cache behavior, not coordination.
- [03 — Latency and Throughput › Senior](../03-latency-and-throughput/senior.md) — Little's Law and the throughput·latency·concurrency triangle that USL capacity feeds into.
