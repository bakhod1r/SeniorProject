# ThreadSanitizer (TSan) — Senior Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → ThreadSanitizer (TSan)
> *The middle page taught you to read a TSan report and fix the race it names. This page is about the detector itself: the vector clocks behind "happens-before," the four shadow cells that decide whether two accesses are a race, the memory models that define what a race even *is*, and the false negatives that mean a clean TSan run is necessary but never sufficient.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Happens-Before vs Lockset: Two Theories of a Race](#core-concept-1--happens-before-vs-lockset-two-theories-of-a-race)
5. [Core Concept 2 — Vector Clocks and Epochs](#core-concept-2--vector-clocks-and-epochs)
6. [Core Concept 3 — The Shadow State: Four Cells per Location](#core-concept-3--the-shadow-state-four-cells-per-location)
7. [Core Concept 4 — Synchronization Edges: What Establishes Order](#core-concept-4--synchronization-edges-what-establishes-order)
8. [Core Concept 5 — Memory Models: What Counts as a Race](#core-concept-5--memory-models-what-counts-as-a-race)
9. [Core Concept 6 — Cost, Shadow Mapping, and the History Horizon](#core-concept-6--cost-shadow-mapping-and-the-history-horizon)
10. [Core Concept 7 — False Negatives: What TSan Cannot See](#core-concept-7--false-negatives-what-tsan-cannot-see)
11. [Core Concept 8 — False Positives, Annotations, and "Benign" Races](#core-concept-8--false-positives-annotations-and-benign-races)
12. [Core Concept 9 — Deadlock Detection and Tool Comparison](#core-concept-9--deadlock-detection-and-tool-comparison)
13. [Real-World Examples](#real-world-examples)
14. [Mental Models](#mental-models)
15. [Common Mistakes](#common-mistakes)
16. [Test Yourself](#test-yourself)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The detection algorithm and the memory models it enforces — what a senior reasons about when a race report is wrong, missing, or unreproducible.**

By the middle level you can build with `-fsanitize=thread`, read the "WARNING: ThreadSanitizer: data race" report, follow the two stack traces, and fix the unprotected access. That makes you effective in a debugging session. The senior jump is different: you now reason about *why the detector behaves the way it does* — why happens-before has almost no false positives but silently misses races on interleavings that didn't run, why a `relaxed` atomic can hide a real ordering bug TSan calls clean, why a report disappears when you add a print statement, and why "it's a benign race" is almost always wrong in C++.

To make those calls you have to understand the machinery: the **vector clocks** that encode happens-before, the small fixed set of **shadow cells** each memory word carries, the **sync objects** whose clocks propagate order across threads, and the **history horizon** beyond which TSan has simply forgotten. Each of those has direct consequences for what a green run proves (less than people think), how much CPU and RAM you pay (5–15× and 5–10×), and how you reproduce a one-in-ten-thousand race. This page is that layer.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — building with `-fsanitize=thread`, reading the report, fixing a basic race with a mutex or atomic.
- **Required:** You can reason about a C++ or Go program's threading: mutexes, condition variables, atomics, thread create/join, and (Go) goroutines and channels.
- **Helpful:** A working memory of the C/C++11 memory model — `memory_order_seq_cst`, `acquire`, `release`, `relaxed` — even if only at the "I've used `std::atomic`" level.
- **Helpful:** You've felt a Heisenbug: a race that vanishes under a debugger or extra logging. That intuition is what this page formalizes.

---

## Glossary

| Term | Meaning |
|---|---|
| **Data race** | Two accesses to the same memory location, at least one a write, from different threads, not ordered by synchronization. In C/C++ this is **undefined behavior**. |
| **Happens-before (HB)** | A partial order on events. If A happens-before B, they are ordered (no race). If neither orders the other, they are *concurrent*. |
| **Vector clock (VC)** | A per-thread array of logical timestamps; comparing two VCs decides whether two events are HB-ordered or concurrent. |
| **Epoch** | A compact `(thread-id, clock)` pair — one component of a vector clock, the most recent event by one thread. |
| **Lockset** | The Eraser algorithm's state: the set of locks held during every access to a location. An empty intersection over time flags a candidate race. |
| **Shadow memory** | Out-of-band metadata TSan keeps for every application memory word, recording recent accesses. |
| **Shadow cell** | One slot of shadow state for a word: `{thread-id, epoch, offset/size, is-write}`. TSan keeps ~4 per word. |
| **SyncClock / SyncVar** | TSan's per-sync-object vector clock (one per mutex, atomic, channel, etc.) that carries HB order between threads. |
| **ThreadState** | TSan's per-thread vector clock plus its current epoch. |
| **TLB / shadow mapping** | The fixed arithmetic map from an application address to its shadow address (`Shadow = (Addr & mask) * 4 + offset`). |
| **History (trace)** | A ring buffer per thread of recent accesses, used to *reconstruct the second stack trace* in a report. |

---

## Core Concept 1 — Happens-Before vs Lockset: Two Theories of a Race

There are two classic families of dynamic race detectors, and the difference between them is the single most important thing a senior understands about TSan, because it explains exactly what a clean run does and does not prove.

**Lockset (Eraser, 1997).** The idea: a correctly synchronized location is always accessed under *some common lock*. For each location, track the set of locks held during every access. Start with "all locks possible," and on each access intersect with the locks currently held. If the set ever becomes empty — there is no single lock that consistently guards this location — flag it. Lockset is a *generalizing* detector: it reasons about the discipline, not the specific run, so it can warn about a race even on an interleaving that didn't happen this time. The price is **false positives**: it doesn't understand happens-before order, so it flags code that is actually safe via fork/join, condition variables, or any synchronization that isn't a lock.

**Happens-before (Lamport, 1978; TSan v2).** The idea: a race is *two unordered accesses*. Build the happens-before partial order from the program's actual synchronization events, then for two conflicting accesses ask: does one happen-before the other? If yes, safe. If they're concurrent (neither orders the other), it's a race. **TSan version 2 is a pure happens-before detector built on vector clocks.** It understands *every* synchronization primitive that creates an edge — locks, atomics, thread create/join, Go channels — not just locks. That gives it **near-zero false positives**: if TSan says "race," there genuinely was no ordering between those two accesses *on the run you observed*.

The catch is the flip side: happens-before is sound *only for the interleaving that executed*.

> **Key insight:** A happens-before detector reports a race only if the two unordered accesses *actually occurred close enough together in this run* to be compared. If a different thread schedule would have made them concurrent but *this* schedule serialized them by luck, TSan sees them as ordered and says nothing. Lockset would have flagged the missing lock regardless; happens-before will not. This is why a green TSan run is **necessary but never sufficient** — it proves the schedules you exercised were race-free, not that the program is.

Some detectors are **hybrid** (e.g., the original Helgrind, and academic detectors like FastTrack's predecessors) — combining lockset's generalization with happens-before's precision to catch more while filtering some false positives. TSan deliberately chose pure happens-before because, at Google scale, false positives are worse than false negatives: an engineer who sees one bogus report stops trusting the tool. The bet is "report only true races, and recover the missed ones with coverage, repetition, and stress."

---

## Core Concept 2 — Vector Clocks and Epochs

The mechanism behind happens-before is the **vector clock**. Each thread `T` maintains a vector clock — conceptually an array indexed by thread id, where `VC_T[U]` is "the latest event of thread `U` that `T` knows happens-before `T`'s current point."

The rules are short:

- **Local step:** when thread `T` performs an event, it increments its own component: `VC_T[T]++`. That new value `(T, VC_T[T])` is an **epoch** — a single thread's logical timestamp.
- **Release (e.g., unlock, atomic store-release, channel send):** the thread copies its current VC *into* the sync object's clock (component-wise max). It is "publishing" everything it has done so far.
- **Acquire (e.g., lock, atomic load-acquire, channel receive):** the thread takes the component-wise **max** of its own VC and the sync object's VC. It is "absorbing" everything the publisher had done.
- **Ordering test:** event A (epoch `(Ta, ca)`) happens-before event B (with clock `VC_B`) iff `VC_B[Ta] >= ca`. Two accesses are a **race** iff *neither* happens-before the other.

A worked example — the canonical lock-protected handoff:

```
Thread A                         Mutex M (SyncClock)      Thread B
VC_A = [A:1, B:0]
write x   (epoch A:2)
VC_A = [A:2, B:0]
unlock(M):  M.clock = max(M, VC_A) = [A:2, B:0]   ──release──▶
                                                  ◀──acquire── lock(M):
                                  VC_B = max([A:0,B:1], [A:2,B:0]) = [A:2, B:1]
                                                            read x  (epoch B:2)
                                                            test: write x was A:2;
                                                            VC_B[A] = 2 >= 2  ✓ ordered → NO RACE
```

Now delete the mutex. Thread B's clock never absorbs `A:2`, so at the read `VC_B[A] = 0 < 2`: the write is **not** ordered before the read, the read is not ordered before the write — they are concurrent — **race**.

> **Key insight:** Happens-before is *exactly* "did an acquire on this thread ever absorb a release that came after the other thread's write?" Every synchronization primitive TSan understands is, internally, just a release into a clock or an acquire from one. Once you see locks, atomics, joins, and channels as release/acquire pairs over vector clocks, the entire detector — and every race it does or doesn't report — becomes mechanical.

Storing a full vector clock per thread is fine (a few thousand threads × a few KB), but storing one per *memory location* would be ruinous. The breakthrough that made TSan v2 (and FastTrack, the algorithm it's related to) practical is the observation that *most accesses are by a single thread under a clear ordering*, so a location rarely needs a full VC — usually just an **epoch** (one `(tid, clock)` pair) suffices. That insight drives the shadow state.

---

## Core Concept 3 — The Shadow State: Four Cells per Location

TSan keeps **shadow memory** for every application word — out-of-band metadata describing recent accesses. The default layout keeps **four shadow cells** per 8-byte application word. Each cell is a compact 64-bit record:

```
Shadow cell (conceptually):
  ┌──────────┬──────────────┬──────────────┬─────────┐
  │ TID      │ epoch/clock  │ offset+size  │ is-write│
  └──────────┴──────────────┴──────────────┴─────────┘
   thread id   per-thread     which bytes     read or
               logical time   of the word     write
```

On **every** memory access, TSan's instrumentation (injected by the compiler at `-fsanitize=thread`) runs a function like `__tsan_read4` / `__tsan_write8`. That function:

1. Forms the new cell from the current thread's `ThreadState` (its tid + current epoch + the access's offset/size + is-write).
2. Walks the (up to four) existing cells for that word.
3. For each existing cell, checks whether it **conflicts**: different thread, overlapping bytes, at least one a write. If so, it does the **happens-before test** — is the old cell's epoch ordered before the current thread's clock? If *ordered*, no race (just an update). If *unordered*, **report a race**.
4. Stores the new cell, **evicting** one of the four (pseudo-randomly) if all slots are full.

Two consequences fall straight out of "four cells, with eviction":

- **Only the last ~4 accesses to a word are remembered.** A read by T1, then T2, then T3, then T4, then T5 evicts T1's cell. If T6 races with T1's original access but T1's cell is gone, the race against *that specific prior access* can't be detected (though a race with a surviving cell still is). This is one face of the **history horizon**.
- **The check is O(cells) = O(4) per access** — constant, which is what keeps the slowdown to single-digit multiples rather than catastrophic.

The use of a single **epoch** per cell (rather than a full vector clock) is the key compression. A cell says "thread T did this at its local time c." To test order against the *current* thread's full vector clock `VC_cur`, TSan asks `VC_cur[T] >= c`. That's an O(1) comparison, and it's exactly the FastTrack-style optimization: full VCs live on threads and sync objects; locations carry only epochs.

> **Key insight:** The shadow state is the whole performance/coverage trade in one structure. Four cells means constant-time checks (cheap) but a finite memory of recent accesses (lossy). A race is detected only if *both* conflicting accesses are simultaneously represented — one in a live shadow cell, one as the current access — and unordered by their clocks. Widening the history (more cells, more `history_size`) catches more but costs RAM and time. There is no free "remember everything."

---

## Core Concept 4 — Synchronization Edges: What Establishes Order

TSan only avoids a false positive when it can *see* the synchronization that orders two accesses. Internally, every such primitive is a release into a clock or an acquire from one. Knowing precisely which primitives TSan intercepts — and which it can't — is the core senior skill, because every false positive is "TSan didn't see this edge" and every false negative around sync is "this edge didn't exist."

**C/C++ primitives TSan intercepts (via interceptors in its runtime):**

| Primitive | Release side | Acquire side |
|---|---|---|
| `pthread_mutex` / `std::mutex` | `unlock` | `lock` |
| `pthread_create` | parent before create | child at entry |
| `pthread_join` | child at exit | parent after join |
| `std::atomic` (non-relaxed) | store-release / RMW-release | load-acquire / RMW-acquire |
| `pthread_cond` / `condition_variable` | signal/broadcast (+ mutex) | wait return (+ mutex) |
| `sem_post` / `sem_wait` | `sem_post` | `sem_wait` |

**Atomics carry their memory order into the clock logic.** This is critical and easy to miss:

```cpp
std::atomic<int> flag{0};
int data = 0;

// Producer
data = 42;                                   // plain write
flag.store(1, std::memory_order_release);    // RELEASE → publishes VC into flag's clock

// Consumer
while (flag.load(std::memory_order_acquire) != 1) {}  // ACQUIRE → absorbs producer's VC
int x = data;                                // plain read — ORDERED after data=42, no race
```

TSan models the release-store as a release into the atomic's SyncClock and the acquire-load as an acquire from it, so the plain `data` accesses are correctly ordered. Change either to `memory_order_relaxed` and TSan establishes *no edge* — `data = 42` and `x = data` become concurrent, and TSan reports a race. (Whether that "race" is real depends on the model; see the next section.)

**Go primitives** (Go's race detector *is* TSan, linked into the runtime): the Go memory model defines the edges and the runtime calls into TSan at each:

- **Channel send/receive** — a send happens-before the corresponding receive completes; for unbuffered channels, the receive happens-before the send completes. These are release/acquire pairs.
- **`sync.Mutex` / `RWMutex`** — unlock releases, lock acquires (the *n*-th unlock happens-before the (*n*+1)-th lock).
- **`sync.WaitGroup`** — `wg.Done()` calls happen-before the `wg.Wait()` that they unblock.
- **`go` statement** — the `go f()` happens-before the start of `f`.
- **`sync.Once`** — the single `f()` happens-before any `Do(f)` returns.

```go
// Classic Go race the detector catches because there is NO edge:
var data int
go func() { data = 42 }()   // goroutine start is ordered AFTER `go`, but...
fmt.Println(data)            // ...nothing orders this read after the write → RACE
```

```go
// Fixed with a channel edge:
var data int
done := make(chan struct{})
go func() { data = 42; close(done) }()  // close = release
<-done                                   // receive = acquire → ordered → no race
fmt.Println(data)
```

> **Key insight:** TSan's correctness rests entirely on *interception*. If synchronization happens through a mechanism TSan can't see — inline assembly, a raw `futex` syscall, a memory-mapped hardware register, a custom lock built on `relaxed` atomics, or a fence it doesn't model — TSan establishes no edge and will report a **false positive** (or, worse, the missing real edge masks a genuine bug). The fix is to *tell* TSan about the edge with annotations, not to disable the tool.

---

## Core Concept 5 — Memory Models: What Counts as a Race

A race detector can't be more precise than the memory model it enforces. Two models matter.

**The C/C++11 model.** A data race is **undefined behavior** — full stop. The standard says: if two accesses conflict (same location, one a write, different threads) and are not ordered by happens-before, the program has UB, meaning the compiler and CPU may do *anything*. This is not pedantry. A racy `int` read isn't guaranteed to be a torn-but-plausible value; the compiler may have hoisted it out of a loop, materialized it twice with different values, or assumed the race can't happen and optimized accordingly. TSan implements exactly this definition: it flags conflicting accesses unordered by HB.

The memory orders form the synchronization vocabulary TSan understands:

| `memory_order` | Meaning | TSan edge? |
|---|---|---|
| `seq_cst` | Total order across all seq-cst ops + acq/rel | Yes (acquire+release) |
| `acquire` | This load synchronizes-with a release that stored the value | Yes (acquire) |
| `release` | This store synchronizes-with an acquire that reads the value | Yes (release) |
| `acq_rel` | RMW that both acquires and releases | Yes (both) |
| `relaxed` | Atomicity only — **no** ordering with other locations | **No HB edge** |
| `consume` | Dependency-ordered (rarely implemented; treated ~acquire) | Treated as acquire |

The dangerous one is `relaxed`. A `relaxed` atomic guarantees the *atomic* itself isn't torn, but creates **no happens-before edge** for *other* memory. So:

```cpp
std::atomic<bool> ready{false};
int payload = 0;

// Thread 1
payload = 99;
ready.store(true, std::memory_order_relaxed);   // relaxed: no release!

// Thread 2
if (ready.load(std::memory_order_relaxed))      // relaxed: no acquire!
    use(payload);                                // payload access is UNORDERED → real race on payload
```

TSan **correctly reports a race on `payload`** here — the `relaxed` ops establish no edge, so the plain accesses are concurrent. Good. But the subtler failure is the reverse: code that *relies* on a `relaxed` atomic for ordering it doesn't provide. The `payload` race is a true race TSan flags. What TSan *cannot* tell you is whether you *intended* `relaxed` to order something and were wrong on a weak-memory CPU (ARM, POWER) where the reordering actually manifests — that's a correctness bug in your *use* of the model, and if no two plain accesses are concurrent on the observed run, TSan stays silent.

> **Key insight:** TSan enforces the *data-race* clause of the memory model, not the *full* model. It catches "you forgot to synchronize." It does **not** catch "you synchronized with the wrong memory order such that an allowed reordering breaks your invariant." Lock-free code built on `relaxed`/`acquire`/`release` can be racy-free by TSan and still wrong on hardware — which is why correct lock-free code needs a model proof (or tools like CDSChecker/GenMC), not just a green TSan.

**The Go memory model** is simpler and stricter by construction: ordinary Go has no `relaxed` — `sync/atomic` operations are sequentially consistent with respect to each other, and the model is defined entirely in terms of happens-before edges from goroutine creation, channel ops, mutexes, `WaitGroup`, and `Once`. Go's race detector therefore maps cleanly onto TSan's HB engine, and "the program is data-race-free" is a meaningful, model-backed statement. (The 2022 revision of the Go memory model tightened atomics to be explicitly seq-cst, removing a prior ambiguity.)

---

## Core Concept 6 — Cost, Shadow Mapping, and the History Horizon

TSan is the most expensive of the sanitizers, and the costs are structural, not incidental.

**Time: ~5–15× CPU.** Every memory access becomes a call into `__tsan_readN` / `__tsan_writeN`, which forms a cell, walks four cells, and does HB comparisons. Memory-access-heavy code sits at the high end. The instrumentation is unavoidable — you can't sample races the way you sample a profiler, because the *one* unsampled access might be the racing one.

**Memory: ~5–10×, driven by shadow mapping.** TSan reserves a vast shadow region and maps each application word to its shadow by fixed arithmetic. On x86-64 Linux the classic scheme is roughly:

```
Shadow(addr)  = (addr & 0x7fffffffffff) * kShadowCnt   (with a fixed offset)
               where kShadowCnt = 4 cells/word
```

So the shadow is about **4× the application's mapped memory** for the cells, plus a **meta region** (~2×) for sync-object clocks and other metadata — which is why the rule of thumb is "TSan needs ~5–8× the address space, and binaries refuse to run if they can't reserve it." This is also why **TSan cannot coexist with ASan or MSan**: each owns the same low/high address ranges for its own shadow, and the fixed mappings collide. You pick exactly one shadow-based sanitizer per build.

```bash
# Mutually exclusive — this is an error, not a combination:
clang -fsanitize=thread,address foo.c    # rejected
```

**The history horizon — and `history_size`.** TSan keeps a per-thread **trace** (a ring buffer of recent accesses) so that when a race is found, it can reconstruct the *second* stack trace — "previous write of size 4 at 0x… by thread T2" with a full call stack. That history is finite. Past the horizon, the *prior* access is forgotten and the report degrades to "[failed to restore the stack]" — or the race against a long-ago access isn't detected at all.

```bash
# Trade memory for a longer history (deeper lookback for the 2nd stack):
TSAN_OPTIONS="history_size=7" ./app     # 0..7; each step ~doubles the per-thread trace
TSAN_OPTIONS="history_size=7 verbosity=1" ./app
```

`history_size` ranges 0–7; each increment roughly doubles the per-thread trace buffer (more RAM) and lengthens how far back TSan can recover the second access's stack. Deep call stacks make this worse: each remembered access stores a stack, so deep stacks fill the trace faster, shortening the effective horizon.

> **Key insight:** Two distinct things expire with "history." (1) The **four shadow cells** per word — only the last ~4 accesses to a location are even *comparable*, so a race against an evicted access is simply never tested. (2) The **per-thread trace** (`history_size`) — used only to *symbolize the second stack* in a report. Bumping `history_size` improves report quality and slightly extends detectability of older accesses, but the fundamental "only recent accesses are remembered" limit comes from the shadow cells and is a deliberate cost ceiling. You can buy more memory; you can't buy infinite memory.

---

## Core Concept 7 — False Negatives: What TSan Cannot See

A pure happens-before detector has a precise, well-understood blind spot, and a senior must be able to enumerate it — because "TSan was clean" is a claim people over-trust.

**1. Races that need an interleaving that didn't happen.** This is the big one. TSan analyzes the *single schedule that executed*. If two accesses *could* be concurrent under some schedule but this run happened to serialize them (a thread was slow, the OS scheduled them apart, a lock was contended in the lucky order), TSan sees them as ordered and reports nothing. The race is real; the run just didn't expose it.

```cpp
// Whether TSan sees this race depends on timing:
int counter = 0;
// T1: counter++;     // read-modify-write, no lock
// T2: counter++;
// If T1 fully completes before T2 starts on this run, the accesses look ordered
// (same word, but the runtime's scheduling serialized them) and TSan may stay silent.
// Run it 10,000× under load and the racing interleaving eventually appears.
```

The mitigations are all about *exercising more schedules*:

- **Repetition + stress.** Run the test thousands of times, under load, on many cores. CI that runs the TSan suite once proves almost nothing for rare races.
- **`TSAN_OPTIONS=...` doesn't add schedules, but the runtime can be nudged.** Go's `GOMAXPROCS` and adding `runtime.Gosched()`/yields in tests perturb timing.
- **Deterministic / controlled schedulers.** [`rr`](https://rr-project.org/) records and *replays* an exact interleaving, so once you catch a race you can reproduce it deterministically (rr defaults to a single-core schedule, which paradoxically *reduces* concurrency — useful for replay, not discovery). **Interleaving explorers** that systematically permute schedules (controlled-concurrency testing, à la older CHESS/coyote-style tools) attack the discovery problem directly.

**2. Races against accesses below the shadow horizon.** As in Concept 6: a conflict with an access that has already been evicted from the four shadow cells, or fallen out of the per-thread trace, won't be reported.

**3. Synchronization TSan can't see — masking real races.** The mirror image of the false-positive case. If TSan *thinks* there's an edge that doesn't really order things — e.g., your custom lock happens to do an `acquire`/`release` pair around the critical section that TSan models as ordering, but the real ordering bug is elsewhere — the spurious edge can hide a genuine race. More commonly: code only *runs* under one configuration, so a race that only occurs with a different number of worker threads or a feature flag set is never instrumented.

**4. Code that never executed.** TSan is dynamic. An unexercised branch, an error path, a rarely-hit shutdown sequence — if it didn't run, it wasn't checked. This is the same coverage gap every dynamic tool has, which is why TSan pairs naturally with [coverage-guided dynamic analysis](../05-coverage-guided-dynamic-analysis/senior.md) and fuzzing: drive more code, under TSan, to expand what's been observed.

> **Key insight:** The false-negative profile is the inverse of the false-positive one. Lockset over-reports because it generalizes beyond the run; happens-before under-reports because it *only* knows the run. TSan deliberately chose under-reporting (trustworthy reports) and pushes the burden of *coverage* onto you. The discipline that turns TSan from "ran clean once" into "credible evidence" is: high coverage × many repetitions × varied schedules × stress, plus deterministic replay (`rr`) to nail repros once found.

---

## Core Concept 8 — False Positives, Annotations, and "Benign" Races

A pure HB detector's false positives are *always* the same root cause: **synchronization TSan didn't observe.** The correct response is to make the edge visible, not to suppress the report blindly.

**Sources of false positives:**

- **Hand-rolled synchronization** — a spinlock built on a `relaxed` flag, a custom barrier, a lock-free ring buffer using non-atomic data with manual fences.
- **Lock-free structures with non-atomic payload** — the control word is atomic, but TSan can't infer that it orders the (non-atomic) payload unless the atomic uses acquire/release it can model.
- **Memory reuse without synchronization** — an allocator or object pool hands a freed block to a new thread; TSan sees the old and new uses as concurrent because the pool's internal ordering is invisible to it.
- **Custom thread pools** — work handed to a worker via a queue TSan doesn't recognize as establishing happens-before.

**Annotations** tell TSan about edges it can't see. The dynamic annotations (from `<sanitizer/tsan_interface.h>` and the older `dynamic_annotations.h`) inject release/acquire into TSan's clocks at points you specify:

```cpp
#include <sanitizer/tsan_interface.h>

// Tell TSan: everything before this point on THIS thread happens-before
// any matching __tsan_acquire(&token) on another thread.
producer_side() {
    build_payload();
    __tsan_release(&token);     // release edge on `token`
    publish(token);
}
consumer_side() {
    Token t = receive();
    __tsan_acquire(&token);     // acquire edge on `token` → orders build_payload before us
    consume_payload();
}
```

```cpp
// Higher-level form (from dynamic_annotations.h), same semantics:
ANNOTATE_HAPPENS_BEFORE(&obj);   // release
ANNOTATE_HAPPENS_AFTER(&obj);    // acquire
```

The Go equivalents live in `runtime` for the standard library's own primitives; user code expresses edges through real channels/mutexes rather than annotations.

**Suppressions** silence reports without changing the program — a blunter tool, for third-party code you can't annotate:

```bash
# tsan.supp
race:SomeThirdPartyLib::buggyButWontFix
deadlock:legacy_module.cc
called_from_lib:libuntouchable.so

TSAN_OPTIONS="suppressions=tsan.supp" ./app
```

**"Benign races" — the trap.** People label a race "benign" when the racy value is "just a stats counter" or "a best-effort cache." The blocking-bit suppression `ANNOTATE_BENIGN_RACE(&x, "stats")` exists for this. **In C/C++ this reasoning is almost always wrong**, because a data race is *undefined behavior*, and the compiler is licensed to do far more than "produce a slightly stale value." It can:

- **Tear** the access (especially >word-size, or on misaligned/odd types).
- **Re-load** a value it "knows" can't change, materializing two different values from one read.
- **Invent writes** (e.g., speculative store, or rewrite `x = x` patterns) that another thread observes.
- **Optimize away the check** entirely, assuming the race can't occur.

```cpp
// "Benign" stats counter — UB in C++, NOT actually safe:
long hits;                       // plain long
void on_hit() { hits++;          // racy RMW: lost updates AND UB
}
// The fix is cheap and removes the UB:
std::atomic<long> hits{0};
void on_hit() { hits.fetch_add(1, std::memory_order_relaxed); }  // atomic, no HB needed → correct
```

> **Key insight:** In C/C++ the right replacement for a "benign race" is almost never a suppression — it's a `std::atomic` with `memory_order_relaxed`. Relaxed gives you atomicity (no tearing, no UB) at essentially the cost of a plain access, *without* claiming ordering you don't need. The only genuinely benign races are in languages where the model defines racy access (e.g., Java's `int`/`boolean` are guaranteed not to tear), and even there it's usually a smell. Treat every TSan report as real until you've proven the edge exists.

---

## Core Concept 9 — Deadlock Detection and Tool Comparison

**Deadlock detection.** Beyond data races, TSan ships a **lock-order / deadlock detector**. It tracks the order in which locks are acquired and builds a lock-order graph; a cycle in that graph (lock A then B on one path, B then A on another) is a potential AB-BA deadlock — reported *even if the deadlock didn't actually occur on this run*, because inconsistent lock ordering is the defect regardless.

```
WARNING: ThreadSanitizer: lock-order-inversion (potential deadlock)
  Cycle in lock order graph: M1 => M2 => M1
  Mutex M2 acquired here while holding mutex M1 in thread T1:
    #0 pthread_mutex_lock
    #1 transfer(Account&, Account&) bank.cc:42
  Mutex M1 previously acquired by the same thread here:
    ...
  Mutex M1 acquired here while holding mutex M2 in thread T2:   ← opposite order
    ...
```

```bash
TSAN_OPTIONS="detect_deadlocks=1 second_deadlock_stack=1" ./app
# second_deadlock_stack=1 → also show where the *other* lock was taken (costs memory)
```

The deadlock detector is *not* happens-before-limited the way race detection is — it generalizes over lock order, so it can warn about a deadlock that never happened, more like a lockset-style analysis. That makes it valuable but also a source of occasional false positives (e.g., when a consistent global order *is* enforced by a mechanism TSan can't see).

**Tool comparison.** TSan is not the only race detector; the trade-offs map directly onto its design:

| Tool | Technique | Slowdown | Recompile? | Notes |
|---|---|---|---|---|
| **TSan** | Pure happens-before (vector clocks), compile-time instrumentation | ~5–15× | **Yes** (`-fsanitize=thread`) | Near-zero false positives; needs source/IR; one shadow sanitizer at a time |
| **Helgrind** (Valgrind) | Happens-before (historically hybrid) | ~20–100× | No (binary DBI) | No rebuild; far slower; works on any binary incl. closed-source |
| **DRD** (Valgrind) | Happens-before, lighter than Helgrind | ~20–50× | No | Lower memory than Helgrind; good for many-thread programs |
| **Go `-race`** | TSan engine, linked into the Go runtime | ~2–20× | Yes (`go test -race`) | First-class; the runtime feeds every channel/mutex/goroutine edge to TSan |

The defining axes: TSan needs to **recompile** (it instruments at the IR level via the compiler) but is *much* faster and more precise because the compiler knows exactly which accesses are interesting and the runtime intercepts every primitive. Valgrind's Helgrind/DRD need **no rebuild** (pure dynamic binary instrumentation) — invaluable for a binary you can't recompile — at a 2–10× *higher* slowdown and historically more false positives. Go's `-race` is just TSan with the Go runtime wired in, which is why Go's race detector "just works" with channels and goroutines: the runtime publishes every HB edge to the same vector-clock engine described above.

> **Key insight:** The recompile-vs-DBI choice is the real fork. If you own the source, TSan (or Go `-race`) wins on speed and precision — use it as the default. Reach for Helgrind/DRD only when you must analyze a binary you cannot rebuild, and budget for the order-of-magnitude-higher slowdown. For lock-order bugs specifically, TSan's built-in deadlock detector covers the common AB-BA case without a separate tool.

---

## Real-World Examples

**Example 1 — A Go data race report (the standard output you'll triage).**

```
==================
WARNING: DATA RACE
Write at 0x00c0000b4010 by goroutine 8:
  main.(*Counter).Inc()
      /app/counter.go:14 +0x44
  main.worker()
      /app/main.go:27 +0x6c

Previous read at 0x00c0000b4010 by goroutine 7:
  main.(*Counter).Value()
      /app/counter.go:19 +0x3a
  main.main()
      /app/main.go:33 +0x118

Goroutine 8 (running) created at:
  main.main()
      /app/main.go:25 +0xd0
Goroutine 7 (finished) created at:
  main.main()
      /app/main.go:31 +0xf4
==================
Found 1 data race(s)
exit status 66
```

Read it as vector clocks: goroutine 8's *write* and goroutine 7's *read* touch the same address, and the two goroutines' clocks have no edge between these events (no channel/mutex/`WaitGroup` ordered them) — concurrent, therefore a race. The fix is to add an edge: guard `Counter` with a `sync.Mutex`, or make the field `atomic.Int64`. Note `exit status 66` — Go's race detector exits non-zero when a race is found, which is what makes `go test -race` fail CI.

**Example 2 — A C++ report and the `relaxed` subtlety.**

```
WARNING: ThreadSanitizer: data race (pid=4711)
  Write of size 4 at 0x7b0400000040 by thread T2:
    #0 worker(void*) ring.cc:58 (app+0x4c1a)
  Previous atomic read of size 4 at 0x7b0400000040 by thread T1:
    #0 worker(void*) ring.cc:44 (app+0x4b80)
  Location is heap block of size 64 at 0x7b0400000040 allocated by main thread:
    #0 operator new ...
  SUMMARY: ThreadSanitizer: data race ring.cc:58 in worker(void*)
```

Here a lock-free ring buffer stored the *payload* with a plain write but the *index* with a `memory_order_relaxed` store. Because `relaxed` creates no release edge, the consumer's read of the payload is unordered against the producer's write — a genuine race. The fix is to publish the index with `memory_order_release` and consume it with `memory_order_acquire`, which establishes the edge that orders the payload accesses. This is the textbook case where TSan being clean *after* the fix actually means something — but only because the edge is now real, not because the bug was "rare."

**Example 3 — A false positive from a custom thread pool, fixed by annotation.**

A worker pool passes a `Task*` via a queue synchronized with a futex TSan doesn't model. TSan reports a race between the producer filling the task and the worker reading it. The pool's author adds:

```cpp
void enqueue(Task* t) {
    fill(t);
    __tsan_release(t);            // publish: everything before HB the matching acquire
    futex_push(queue, t);
}
Task* dequeue() {
    Task* t = futex_pop(queue);
    __tsan_acquire(t);            // absorb the producer's writes
    return t;
}
```

After annotating, TSan models the real edge, the false positive disappears, and — importantly — TSan can now still catch a *genuine* race elsewhere in the task lifecycle, which a blanket suppression would have hidden.

---

## Mental Models

- **A race is two unordered events; TSan is a machine for asking "is there an edge?"** Every synchronization primitive is a release into a clock or an acquire from one. The detector reduces "data race" to a single vector-clock comparison: `VC_current[other_tid] >= other_epoch`. If yes, ordered; if no, race.

- **Happens-before knows the run; lockset knows the discipline.** TSan chose happens-before — near-zero false positives, but it only sees the schedule that executed. That's why a green run proves "these schedules were clean," not "the program is race-free," and why coverage × repetition × stress is the other half of the tool.

- **The four shadow cells *are* the memory/coverage trade-off.** Constant-time checks (cheap) bought with a finite memory of recent accesses (lossy). A race is found only when both conflicting accesses are simultaneously represented and unordered. You can buy more history with RAM; you can't buy infinite.

- **TSan enforces the no-data-race clause, not the whole memory model.** It catches missing synchronization. It does *not* catch using the wrong `memory_order` such that a *permitted* reordering breaks your lock-free invariant. Relaxed atomics are the danger zone — atomic enough to silence TSan, not ordered enough to be correct.

- **Every TSan false positive is "an edge it couldn't see."** Custom locks, lock-free non-atomic payloads, memory reuse, futex queues. The cure is an annotation that makes the edge visible — `__tsan_release`/`__tsan_acquire` — not a suppression that blinds the tool to everything at that site.

---

## Common Mistakes

1. **Trusting a single green TSan run.** Happens-before only sees the interleaving that ran. Rare races need thousands of repetitions under load, varied core counts, and stress. CI that runs the TSan suite once is theater for any non-trivial concurrency.

2. **Calling a race "benign" in C/C++ and suppressing it.** A data race is UB; the compiler may tear, re-load, invent, or optimize-away. Replace the racy plain access with `std::atomic<T>` + `memory_order_relaxed` — atomicity without false ordering claims — instead of `ANNOTATE_BENIGN_RACE`.

3. **Assuming `relaxed` atomics are "fine because they're atomic."** Relaxed gives atomicity but *no* happens-before for other memory. It silences TSan on the atomic itself while leaving (or creating) real ordering bugs on the data it was meant to publish — and those manifest on weak-memory CPUs TSan can't model.

4. **Trying to combine TSan with ASan or MSan.** They claim overlapping shadow address ranges with fixed mappings; the build is rejected. Run separate builds — one per shadow-based sanitizer.

5. **Suppressing a false positive instead of annotating the edge.** A `race:` suppression blinds TSan to *all* races at that location, including future real ones. Prefer `__tsan_release`/`__tsan_acquire` (or `ANNOTATE_HAPPENS_BEFORE/AFTER`) so TSan models the real synchronization and keeps detecting genuine bugs.

6. **Ignoring the history horizon when a report says "[failed to restore the stack]."** The second access fell out of the per-thread trace. Bump `history_size` (0–7, each step ~2× RAM) to recover the stack — but remember the four-shadow-cell limit means very old accesses may not be detected at all.

7. **Forgetting that Go `-race` *is* TSan.** Its costs (~2–20×, big memory), blind spots (interleavings not run), and guarantees (model-backed HB) are the same. "It passed `go test -race`" carries exactly the same caveats as a clean C++ TSan run.

---

## Test Yourself

1. TSan v2 is a *pure happens-before* detector. Contrast that with lockset (Eraser) on the two axes that matter: false positives and what each can detect about races that didn't occur on this run.
2. Two threads access the same word with no synchronization, but on this run thread A fully finished before thread B started. Does TSan report a race? Why, in vector-clock terms?
3. A C++ producer does `payload = x; flag.store(1, relaxed);` and the consumer does `if (flag.load(relaxed)) use(payload);`. Does TSan flag a race, and where? What's the correct fix?
4. Explain the four-shadow-cell design. What does it buy you, and what specific class of race does it make undetectable?
5. Why can't you build with `-fsanitize=thread,address`? Name the underlying resource conflict.
6. A report ends with "[failed to restore the stack]" for the previous access. What ran out, and what option do you change?
7. You found a rare data race once. How do you (a) reproduce it deterministically and (b) increase the odds of hitting it again in CI?

<details>
<summary>Answers</summary>

1. **Happens-before** has **near-zero false positives** (it only flags accesses genuinely unordered on the observed run) but **misses races that need an interleaving that didn't happen** — it reasons only about the schedule that ran. **Lockset** has **more false positives** (it doesn't understand non-lock synchronization like fork/join or condvars, so it flags safe code) but **generalizes**: it can flag a missing-lock discipline even on a run where the race didn't manifest. TSan chose HB because at scale, trustworthy reports beat exhaustive ones.

2. **No race reported.** In vector-clock terms, because A's access and B's access were serialized by the runtime/scheduler on this run, B's clock effectively reflects A's epoch (or there's simply no concurrent overlap in the shadow comparison), so the HB test finds them ordered. The race is real but *latent* — only a different interleaving would expose it. This is the canonical false negative.

3. **Yes — a race on `payload`.** `memory_order_relaxed` creates no release/acquire edge, so the producer's plain write to `payload` and the consumer's plain read are concurrent. Fix: `flag.store(1, memory_order_release)` and `flag.load(memory_order_acquire)`, which establishes the happens-before edge ordering the `payload` accesses.

4. Each application word keeps up to **four shadow cells**, each a compact `{tid, epoch, offset/size, is-write}`. Using a single **epoch** (not a full vector clock) per cell makes the per-access check **O(4) = constant time** — the key to single-digit slowdown. The cost: only the **last ~4 accesses** to a word are remembered (older ones are evicted), so a race against an **evicted prior access** is never tested — a false negative tied to the history horizon.

5. TSan and ASan (and MSan) each reserve overlapping ranges of the address space for their **shadow memory** using **fixed address mappings** (TSan needs ~5–8× the address space). The mappings collide, so they're **mutually exclusive** — one shadow-based sanitizer per build. Run separate builds.

6. The **per-thread trace / history buffer** ran out — the previous access fell beyond the lookback horizon, so TSan can't symbolize its stack. Increase **`history_size`** (`TSAN_OPTIONS="history_size=7"`, range 0–7, each step roughly doubles the trace and the RAM). Note this improves *report quality* and slightly extends detectability, but the four-shadow-cell limit still bounds how far back a race can be detected at all.

7. (a) Record and replay with **`rr`** (`rr record ./app` then `rr replay`) to get a deterministic, byte-for-byte reproduction of the exact interleaving. (b) Run the TSan test **thousands of times under load**, vary **core count / `GOMAXPROCS`**, add scheduler perturbation (yields, `runtime.Gosched()`), and stress the system so more interleavings are explored; consider a controlled-concurrency / interleaving explorer to systematically permute schedules.

</details>

---

## Cheat Sheet

```
DETECTION MODEL
  TSan v2 = PURE happens-before, vector clocks (FastTrack-style epochs)
  race := two accesses, same loc, ≥1 write, different threads, UNORDERED by HB
  HB test := VC_current[other_tid] >= other_epoch  → ordered (safe) else RACE
  near-zero false positives; MISSES races on interleavings that didn't run

SHADOW STATE
  4 cells/word: {tid, epoch, offset+size, is-write}; O(4) check per access
  eviction → only last ~4 accesses remembered (history horizon → false negatives)
  shadow ≈ 4× app mem (cells) + ~2× meta; needs ~5–8× address space
  CANNOT combine with ASan/MSan (overlapping fixed shadow mappings)

SYNC EDGES (release → acquire)
  C++: mutex unlock→lock; create→child; child-exit→join; atomic release→acquire
       relaxed = NO edge (atomic only)
  Go : send→recv (chan close→recv); unlock→lock; Done→Wait; `go`→f start; Once
  unseen sync (futex/asm/custom lock) → FALSE POSITIVE → annotate the edge

OPTIONS (TSAN_OPTIONS=...)
  history_size=0..7          deeper 2nd-stack lookback (~2× RAM per step)
  halt_on_error=1            stop at first race (default: keep going)
  detect_deadlocks=1         lock-order-inversion (AB-BA) detector
  second_deadlock_stack=1    show the other lock's acquire site
  suppressions=tsan.supp     race:/deadlock:/called_from_lib: rules
  exitcode=66 / Go exit 66   non-zero on race → fails CI

ANNOTATIONS (make an unseen edge visible — prefer over suppression)
  __tsan_release(&x) / __tsan_acquire(&x)        low-level HB edge
  ANNOTATE_HAPPENS_BEFORE/AFTER(&x)              same, higher level
  "benign race" in C/C++ ≈ always wrong (UB) → use atomic<T> + relaxed instead

REPRO RARE RACES
  green run ≠ race-free → coverage × repetitions × stress × varied cores
  rr record / rr replay  → deterministic replay once caught
  interleaving explorers → systematically permute schedules

TOOL CHOICE
  own source → TSan / go test -race (fast, precise, recompile)
  can't rebuild → Valgrind Helgrind/DRD (no recompile, ~2–10× slower, more FPs)
```

---

## Summary

- **TSan v2 is a pure happens-before detector built on vector clocks.** A race is two conflicting accesses unordered by HB; the check reduces to one epoch comparison, `VC_current[other_tid] >= other_epoch`. This gives **near-zero false positives** at the cost of **missing races on interleavings that didn't run** — the deliberate inverse of lockset's "more false positives but generalizes."
- **The detector's memory is four shadow cells per word**, each carrying a compact `{tid, epoch, offset/size, is-write}`. Single epochs (not full VCs) make checks constant-time; eviction means only the last ~4 accesses are remembered, the structural source of the **history horizon** and a class of false negatives.
- **Every synchronization primitive is a release into a clock or an acquire from one** — mutexes, thread create/join, non-relaxed atomics, and Go's channels/`WaitGroup`/`Once`. TSan is only correct for edges it can *intercept*; an unseen edge (futex, inline asm, custom lock) yields a false positive, fixed by `__tsan_release`/`__tsan_acquire`, not a suppression.
- **TSan enforces the no-data-race clause of the C/C++11 and Go memory models, not the full model.** `relaxed` atomics establish no HB edge — atomic enough to silence TSan, not ordered enough to be correct on weak-memory hardware. A "benign race" in C/C++ is almost always wrong because data races are UB; the fix is usually `std::atomic` + `memory_order_relaxed`.
- **Costs are structural:** ~5–15× CPU, ~5–10× memory, ~5–8× address space — which is why TSan can't coexist with ASan/MSan. `history_size` trades RAM for deeper second-stack recovery.
- **A green run is necessary, not sufficient.** Credible evidence comes from coverage × repetition × varied schedules × stress, with `rr` for deterministic replay once a race is caught. For binaries you can't recompile, Helgrind/DRD trade an order of magnitude of speed for needing no rebuild.

You now reason about TSan as an *algorithm with a precise blind spot* rather than a black box that "finds races." The next layer — [professional.md](professional.md) — is about operating that algorithm across a codebase and CI fleet: gating policy, suppression hygiene, flake budgets, and making rare races reproducible at scale.

---

## Further Reading

- *ThreadSanitizer – data race detection in practice* — Serebryany & Iskhodzhanov (WBIA 2009). The TSan design paper: shadow state, happens-before, and the engineering trade-offs.
- *FastTrack: Efficient and Precise Dynamic Race Detection* — Flanagan & Freund (PLDI 2009). The epoch-vs-vector-clock optimization that makes per-location state cheap.
- *Time, Clocks, and the Ordering of Events in a Distributed System* — Leslie Lamport (1978). The origin of happens-before and the logical-clock reasoning the whole detector rests on.
- [The C++ memory model (cppreference: `std::memory_order`)](https://en.cppreference.com/w/cpp/atomic/memory_order) — `seq_cst`/`acquire`/`release`/`relaxed` and exactly what each orders.
- [The Go Memory Model](https://go.dev/ref/mem) — the happens-before edges Go's `-race` detector enforces (incl. the 2022 atomics revision).
- [Clang ThreadSanitizer manual](https://clang.llvm.org/docs/ThreadSanitizer.html) and the [TSan flags wiki](https://github.com/google/sanitizers/wiki/ThreadSanitizerFlags) — every `TSAN_OPTIONS` knob and annotation interface.
- [`rr` — record and deterministic replay](https://rr-project.org/) — reproducing a rare race once you've caught it.
- See [professional.md](professional.md) for CI gating, suppression management, and operating TSan across a fleet.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/senior.md) — the memory-error sibling; shares the shadow-memory design and the "one shadow sanitizer per build" constraint.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/senior.md) — the other half of "data races are UB"; catches the UB TSan's model presupposes.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/senior.md) — driving more code and more schedules under TSan to shrink its false-negative window.
- [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/senior.md) — invariants that catch concurrency bugs TSan's HB model can't express.
- [Language Internals → Concurrency](../../../language-internals/concurrency-async-parallel/concurrency/) — the memory models, atomics, and scheduling TSan reasons about from the inside.
