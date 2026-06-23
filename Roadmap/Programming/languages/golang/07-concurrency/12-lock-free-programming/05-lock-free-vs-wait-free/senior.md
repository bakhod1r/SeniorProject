# Lock-Free vs Wait-Free — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Herlihy 1991 in Detail](#herlihy-1991-in-detail)
3. [Consensus Numbers and the Hierarchy](#consensus-numbers-and-the-hierarchy)
4. [The Universal Construction](#the-universal-construction)
5. [Helping in Depth](#helping-in-depth)
6. [Memory Reclamation in Wait-Free Code](#memory-reclamation-in-wait-free-code)
7. [Linearisability vs Progress](#linearisability-vs-progress)
8. [Sequence Locks as a Hybrid](#sequence-locks-as-a-hybrid)
9. [Hardware Reality](#hardware-reality)
10. [Design Trade-offs at Staff Level](#design-trade-offs-at-staff-level)
11. [The Honest Senior Position](#the-honest-senior-position)
12. [Designing Concurrent Types](#designing-concurrent-types)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

A senior engineer working on concurrent systems must be able to do three things that no amount of reading at junior or middle level prepares you for. First, defend a progress-class decision in a design review, where a colleague will ask "why isn't this wait-free?" and you must answer rigorously. Second, read a research paper that claims wait-free and decide whether the claim survives contact with real Go and a real Linux kernel. Third, draw the line — confidently — between cases where wait-free is genuinely required and cases where someone is pattern-matching on a buzzword.

This file develops all three. We work through Herlihy's 1991 paper at the level of mechanism, walk through the Universal Construction as an existence proof, sketch the helping pattern with enough detail to be dangerous, and then arrive at the honest senior position: *in Go, wait-free is rarely worth the complexity*. The position is not "wait-free is bad" — it is the strongest progress guarantee available, and it matters in the right setting. The position is that "the right setting" is not your service.

---

## Herlihy 1991 in Detail

Maurice Herlihy's *Wait-Free Synchronization* (ACM TOPLAS, 1991) is the paper. Three of its contributions are worth carrying around.

### Contribution 1: the progress definitions

Herlihy crystallised four distinct progress guarantees that earlier papers had been mixing up.

**Wait-free.** Every process completes any operation in a bounded number of its own steps, regardless of other processes' relative speeds or failures.

**Lock-free.** At each point in time, *some* process completes an operation in a bounded number of steps. Equivalently: in any infinite execution, infinitely many operations complete.

**Obstruction-free** (added later, Herlihy-Luchangco-Moir 2003). A process running in isolation completes its operation in a bounded number of steps. Allows livelock under contention.

**Blocking.** A process can be made to wait an unbounded amount of time for another process to perform an action.

The framing matters because each rung names a different *adversary*. Wait-free survives an adversary that can pause arbitrary other threads. Lock-free survives that adversary on a system-wide basis but allows it to victimise individuals. Obstruction-free survives only an adversary that pauses *all* other threads. Blocking survives no adversary.

### Contribution 2: the impossibility result

Herlihy proved that no wait-free implementation of a queue, stack, or other "useful" object exists using only atomic registers (plain reads and writes). The intuition is that two threads contending on a shared register cannot agree on an order — they cannot reach *consensus* — using only loads and stores.

The consequence is that you need stronger primitives. CAS is the most powerful primitive practically available. Once you have CAS, you can implement any wait-free object (Contribution 3). Without it, most interesting wait-free objects are impossible.

### Contribution 3: the universality of CAS

The same paper introduced the *universal construction*: a recipe that, given CAS, transforms any sequential specification of an object into a wait-free implementation. The construction is correct but performs poorly; its purpose is to demonstrate *existence*. We discuss it in section below.

### What survived 35 years

Herlihy's definitions are exactly the ones used today. The impossibility result still anchors why we need CAS in our processors. The universal construction is taught but not used; in its place sit hand-crafted wait-free algorithms for specific objects (counters, queues, deques, hash tables) that pay much less per operation.

The senior takeaway from the paper itself: the progress hierarchy is a *formal* hierarchy with precise definitions, not a marketing taxonomy. When you classify an algorithm, you are making a falsifiable claim. Treat it that way.

---

## Consensus Numbers and the Hierarchy

A primitive's *consensus number* is the maximum number of threads for which it can solve binary consensus. The notion is from Herlihy 1991 and gives a clean way to compare primitives.

| Primitive | Consensus number |
|-----------|------------------|
| Atomic read/write register | 1 |
| Test-and-set (single bit) | 2 |
| Fetch-and-add | 2 |
| 2-process consensus object | 2 |
| `n`-thread queue, stack, set | 2 |
| Read-modify-write (general atomic RMW returning old value) | 2 |
| Compare-and-swap (CAS) | infinity |
| Load-linked / store-conditional (LL/SC) | infinity |

The infinity row is the one that matters. CAS can solve consensus for any number of threads, which is why every wait-free universal construction is built on it. Without CAS (or LL/SC), most wait-free objects are flatly impossible. With CAS, all of them exist — at least in principle.

### Implication 1: why `atomic.Add` cannot be the foundation

`atomic.Add` has consensus number 2. You can use it for a counter that is wait-free per call, but you cannot build a wait-free queue from `atomic.Add` alone — two threads with only `Add` can solve their own consensus, but three cannot.

### Implication 2: why CAS is everywhere

Every modern ISA exposes a primitive of consensus number infinity. x86 has `LOCK CMPXCHG` (CAS) and `LOCK CMPXCHG16B` (double-word CAS). ARMv7 and below have LL/SC (`LDREX`/`STREX`). ARMv8 has both LL/SC and CAS (`CAS`/`CASP`). RISC-V has LL/SC.

Without CAS or LL/SC, the wait-free universe collapses. The reason is consensus.

### Implication 3: the role of fences

Fences and barriers do not change consensus numbers; they only constrain memory ordering. Adding a memory fence to a primitive does not let it solve a harder consensus problem. This is sometimes confusing — fences feel powerful — but for the *progress* hierarchy they are inert.

---

## The Universal Construction

Herlihy's universal construction (1991, refined 1993) is the existence proof that any object can be made wait-free.

### The setup

Given:
- A *sequential specification* of the object (a description of its operations and their effects on a sequential state).
- A CAS primitive.
- Up to `N` threads.

The construction produces an implementation in which every operation is *linearisable* and *wait-free*.

### The mechanism in one paragraph

Each thread maintains an *announcement* of its next operation. The shared state is a *single CAS-protected pointer* to the head of a linked list of operation records, each linked in linearisation order. To perform an operation, a thread (a) announces its request, (b) attempts to CAS its request onto the head of the list, and (c) replays the entire list locally to compute the state and the return value. Helpers ensure that an announced operation eventually reaches the list within `O(N)` steps of being announced.

### Why it is wait-free

The bound on per-operation steps is `O(N)`: at most `N` other threads can race to the head ahead of you, and after `N` rounds of helping, every announced operation has been linked.

### Why nobody uses it

The cost is dominated by *replaying the entire list locally* to compute state. Every operation pays `O(M)` per call where `M` is the number of operations applied to the object so far. Periodic garbage-collection / log truncation reduces this to `O(N)` amortised, but the constants are enormous compared to a hand-tuned algorithm.

For a counter, the universal construction is millions of times slower than `atomic.Add`. For a queue, it is hundreds of times slower than Michael-Scott. The construction is a *proof tool*, not an engineering tool.

### The senior takeaway

The universal construction tells you: *if* your design needs wait-free, you can always achieve it. The interesting question is therefore not "can we?" but "what is the cheapest specialised algorithm?" — and the answer for most objects is "we don't have one, and the lock-free version is good enough."

---

## Helping in Depth

Helping is the structural mechanism that turns lock-free designs into wait-free ones. The pattern recurs across wait-free queues, stacks, hash tables, and counters.

### The pattern

1. Each operation has an *operation descriptor*: a record describing what the thread wants to do.
2. A thread *announces* its descriptor before touching the data structure.
3. Other threads, when performing their own operations, scan the announcements and help complete any pending ones.
4. The progress argument: because every arriving thread helps at least one pending operation, no pending operation can sit unprocessed for more than `N` arrivals.

### Per-thread vs per-operation announcements

Two common designs.

**Per-thread.** A fixed array of `N` slots, one per thread. Thread `i` writes into slot `i`. Simple but bounds the number of threads at compile time.

**Per-operation.** A dynamic linked list of descriptors. More flexible but introduces its own memory-reclamation problem (when can a descriptor be freed?).

The Kogan-Petrank queue uses per-thread slots with a phase counter for fairness. Most modern wait-free designs use per-operation descriptors with epochs or hazard pointers for reclamation.

### Phase / round counters

To ensure fairness, helpers must process *older* pending operations before newer ones. The standard mechanism is a monotonically increasing phase number. When thread T arrives, it bumps the global phase, reads its own phase `P`, and is obliged to help every announced operation with phase `< P`. The bound on the number of operations T helps is `N`, because at any moment at most `N` operations can have lower phase numbers (one per thread).

### What helping costs

The cost is real and unavoidable. Each operation pays:
- `O(N)` cache reads to scan the announcement table on entry.
- `O(N)` worst-case CAS attempts to apply pending operations.
- Memory traffic for descriptor allocation and the phase counter.

In aggregate, a wait-free design typically pays 4-10x the per-operation cost of an equivalent lock-free design under low contention, and 1.5-3x under high contention. The gap is widest where it would be most attractive — when the lock-free version retries the most, the wait-free version's overhead is amortised but still substantial.

### A worked sketch: wait-free Fetch-Add (FAA)

A wait-free FAA built on CAS, using helping, illustrates the pattern. We do not reproduce a full correctness proof here; the goal is to show the *shape*.

```go
package waitfreefaa

import "sync/atomic"

const N = 16 // bound the thread count

type announce struct {
    delta  int64
    pending atomic.Bool
    result atomic.Int64
}

type Counter struct {
    value     atomic.Int64
    announcements [N]announce
}

// Each thread is assigned an id 0..N-1.
func (c *Counter) Add(id int, delta int64) int64 {
    a := &c.announcements[id]
    a.delta = delta
    a.pending.Store(true)

    for i := 0; i < N; i++ {
        other := &c.announcements[i]
        if !other.pending.Load() {
            continue
        }
        for {
            old := c.value.Load()
            new := old + other.delta
            if c.value.CompareAndSwap(old, new) {
                other.result.Store(new)
                other.pending.Store(false)
                break
            }
            if !other.pending.Load() {
                break
            }
        }
    }

    return a.result.Load()
}
```

This sketch elides the proof of wait-freedom — in particular, the inner loop is technically unbounded — but it shows the bones: announcement, scan, CAS-or-help, read back. The cost per call is `O(N)` even with no contention, because every call scans the table. That is why nobody writes this: `atomic.AddInt64` is one instruction and already wait-free, with consensus number 2 sufficing for a single counter.

### When helping pays its way

Helping is worth the overhead in exactly two settings.

**Setting 1: the bound is required.** Hard real-time, safety-critical, or fault-tolerant systems where the worst-case per-operation latency is an SLA, not a hope.

**Setting 2: the lock-free version starves too often.** This is rare in well-mixed contention but can occur in pathological schedules — for example, a high-priority thread that keeps preempting a low-priority thread mid-CAS. Even here, the typical fix is *priority inheritance* on a mutex, not a wait-free redesign.

If you are not in one of those settings, do not pay for helping.

---

## Memory Reclamation in Wait-Free Code

Lock-free and wait-free algorithms share a problem: when can you free an unlinked node? In Go the GC saves you for the common cases; in C/C++ you need hazard pointers, epoch-based reclamation, or reference counting. But even in Go, wait-free designs introduce a *new* reclamation problem: when is an operation descriptor done with?

### The descriptor lifetime problem

A descriptor is alive while its operation is pending. Once the operation completes, the descriptor is "done." But helpers may still be reading the descriptor at the moment it transitions to "done." If you reuse the descriptor's memory immediately, helpers will see stale or corrupted state.

### Solutions

**Solution 1: never reuse.** Allocate a new descriptor for every operation; let the GC collect it. Simple and correct in Go. Costs allocation traffic, but the GC handles it.

**Solution 2: per-thread descriptor pool.** Each thread owns a small pool of descriptors and recycles them. The thread must verify that all helpers have observed "done" before reusing a descriptor. This typically requires a per-helper acknowledgement or a phase counter.

**Solution 3: epoch-based reclamation.** Each descriptor is tagged with the global epoch at which it was allocated. Memory is freed only after the global epoch advances enough that no thread can still be inside an operation that observed the descriptor.

For a Go implementation, Solution 1 is almost always the right choice. The GC pause is usually shorter than the helping overhead saved.

### A note on GC pauses and wait-freedom

A GC pause that stops all goroutines is technically a violation of wait-freedom in the strict sense: a paused thread is not making progress. In practice, Go's STW pauses are short and global, so the *application-visible* progress class is unaffected — the algorithm is wait-free among scheduler-running goroutines, and the GC freezes everyone equally.

If you genuinely need wait-free with respect to GC pauses, you need a manual-memory-management language. Go is not the right tool for that requirement.

---

## Linearisability vs Progress

A common confusion: linearisability is a *correctness* property and orthogonal to progress.

**Linearisable.** Every operation appears to take effect at some single instant between its invocation and its return. Equivalent to "the concurrent execution is equivalent to some sequential execution consistent with the per-thread order of invocations."

**Sequentially consistent.** A weaker property: the execution is equivalent to *some* sequential ordering, but not necessarily one consistent with real-time.

**Progress (blocking / obstruction-free / lock-free / wait-free).** A claim about *when* operations complete, not whether they are correct.

An algorithm can be linearisable and blocking (a mutex-protected counter), linearisable and wait-free (`atomic.Add`), or even non-linearisable and wait-free (some relaxed-consistency designs).

When you read a paper, parse the two claims separately. "Wait-free linearisable queue" makes two assertions. "Wait-free" is the progress claim; "linearisable" is the correctness claim. Both must be checked independently.

For Go application code, linearisability is almost always what you want — the API consumer expects "if I call `Push(v)` before `Pop()`, I see `v`." Non-linearisable APIs surprise everyone and rarely pay off.

---

## Sequence Locks as a Hybrid

Sequence locks (seqlock) are a clever hybrid: writers serialise via a mutex, readers are wait-free (or lock-free, depending on interpretation), and the design is correct only when readers can detect mid-write states and retry.

```go
type Seqlock[T any] struct {
    seq   atomic.Uint64 // odd = writer in progress; even = stable
    value T              // protected by the convention
    mu    sync.Mutex
}

func (s *Seqlock[T]) Read() T {
    for {
        s1 := s.seq.Load()
        if s1&1 != 0 {
            continue // writer in progress; retry
        }
        v := s.value // racy by Go's memory model
        s2 := s.seq.Load()
        if s1 == s2 {
            return v
        }
    }
}

func (s *Seqlock[T]) Write(v T) {
    s.mu.Lock()
    s.seq.Add(1)   // now odd
    s.value = v
    s.seq.Add(1)   // now even, one higher than before
    s.mu.Unlock()
}
```

The `Read` is *lock-free* in the formal sense: it can retry forever under a continuous stream of writers. It is *not* wait-free. The `Write` is blocking (mutex-protected). The whole construct is interesting because the *read path* tolerates writer suspension — a sleeping writer makes `Read` retry, but `Read` itself never blocks.

Two important caveats. First, the read of `s.value` in `Read` is technically a data race by Go's memory model (the seqlock pattern requires atomic loads of the value bytes or appropriate fences). The textbook seqlock in Go must use `atomic.Pointer` or similar to satisfy the memory model — see the `04-memory-fences` subsection for details.

Second, seqlocks are useful only when the protected value is read far more often than written and when the value is large enough that copying it is cheap relative to a mutex acquisition. For small values, `atomic.Pointer` swap is simpler.

---

## Hardware Reality

The progress hierarchy assumes an abstract machine. Real CPUs add wrinkles.

### Cache coherence is the bottleneck

Every CAS, every atomic add, every mutex acquisition contends for the same cache line. Cache-line bouncing dominates throughput at scale. Wait-free does not help here; it spreads the cost more evenly but does not reduce aggregate cache traffic.

### NUMA effects

On multi-socket systems, atomic operations cross sockets. Cross-socket atomics are 5-20x slower than intra-socket. Lock-free and wait-free both suffer; sharding (per-socket counters) helps.

### Hyper-threading

Two logical threads on the same physical core compete for the same execution units. Lock-free designs that retry frequently waste a lot of execution-unit bandwidth on the other hyper-thread. Wait-free designs that do `O(N)` work per call also waste bandwidth, but predictably.

### Transactional memory

Intel TSX and IBM POWER's HTM offer hardware *speculative* execution of multiple operations. Speculative successes are fast; aborts retry. TSX is therefore lock-free in the formal sense, not wait-free — speculation can abort indefinitely. It is interesting because it makes lock-free designs cheaper in the common case while leaving the worst case unchanged.

Go does not expose TSX. For Go, the practical baseline is `LOCK XADD`, `LOCK CMPXCHG`, and the goroutine scheduler.

### The bottom line for senior decisions

The progress hierarchy gives you a *formal* tool to reason about adversarial scheduling. Hardware adds a *practical* dimension that the hierarchy does not capture: cache traffic, NUMA, hyper-threading. Even a wait-free algorithm with a beautiful `O(N)` step bound can be limited by cache-coherence physics. Always benchmark on the target hardware.

---

## Design Trade-offs at Staff Level

When a staff engineer asks "should this be wait-free?", the productive response is to ask back: *what failure mode are we trying to rule out?*

### Failure mode 1: thread suspension freezes others

The lock-free guarantee already rules this out. Wait-free is overkill.

### Failure mode 2: one thread starves while others race ahead

Lock-free permits this; wait-free rules it out. Now ask: *how bad is the starvation in practice?* On the Go scheduler with reasonable contention, starvation lasts tens of microseconds at most, not seconds. If the answer is "we measured p99 latency at 100 microseconds and the SLA is 1 millisecond," lock-free is fine. If the answer is "we measured p99 at 10 milliseconds and the SLA is 1 millisecond," wait-free or *fewer threads on the hot path* is the fix.

### Failure mode 3: priority inversion

A high-priority thread waits for a low-priority thread to finish a critical section. A real problem with mutexes on RTOS, less so with the Go scheduler (which does not have user-controlled priorities). Wait-free and lock-free both eliminate priority inversion at the data-structure level; the OS still has its own scheduling.

### Failure mode 4: a thread crashes mid-operation

If a thread can permanently fail mid-operation (a real concern in language runtimes and OS kernels), only wait-free survives — and even wait-free requires the helping mechanism to be tolerant of "the originator never returned." Few Go programs face this failure mode; the language abstracts goroutine crashes through `recover` and treats `panic` as a fatal condition.

### Failure mode 5: hard real-time deadlines

If "operation X must complete in under Y microseconds, always," then wait-free is the *minimum* you need — and even wait-free is not sufficient on a non-RT kernel. Hard real-time on Go is essentially unsupported; if you have this requirement, you are using the wrong stack.

### The decision matrix

| Failure mode | Mutex | Lock-free | Wait-free |
|---------------|-------|-----------|-----------|
| One thread blocks others | Vulnerable | Safe | Safe |
| Individual starvation | Possible | Possible | Safe |
| Priority inversion (on RTOS) | Possible | Safe | Safe |
| Mid-operation crash | Stuck | Possibly stuck | Safe |
| Hard real-time bound | Fails | Fails | Possibly OK |

In Go, the practical concerns are usually rows 1 and (sometimes) 2. Lock-free handles row 1; wait-free is needed only when row 2 *actually bites you in production*, which is rare.

---

## The Honest Senior Position

After all the theory, the honest position for a senior engineer working in Go is:

**Wait-free is rarely worth the complexity in Go.**

Three reasons.

### Reason 1: the Go scheduler is fair enough

Goroutines are preempted on a 10ms tick (and at various safe points). The scheduler does not let any goroutine starve indefinitely under normal load. Lock-free starvation, where it occurs, is microseconds, not seconds. For application code, this is below the noise floor of every other latency source (GC, syscalls, network).

### Reason 2: wait-free is slow in steady state

The helping mechanism costs `O(N)` per call. For most Go programs, the *common case* dominates total cost. Paying a 5x steady-state tax to bound a worst case that never bites is a bad trade.

### Reason 3: most Go workloads are not real-time

Real-time means *correctness* depends on timing. A web service has SLAs but no hard deadlines; a missed p99 is unfortunate, not catastrophic. The only Go workloads that are genuinely hard-real-time are control loops in embedded systems (rare) and the Go runtime itself (where the team uses wait-free where they must).

### What "rarely" means

Concretely, in a typical year of Go service work, the number of cases where wait-free is the right tool is zero or one. The number of cases where lock-free is the right tool is single-digit. The number of cases where a mutex is the right tool is hundreds or thousands.

If you are reaching for wait-free, ask whether you are over-engineering. The signal that you are not is when you can name the SLA in milliseconds, the failure mode it precludes, and the measurement that showed the lower-rung tool failing.

### The exceptions

There are real exceptions, and a senior engineer should be able to name them.

- **Audio synthesis / DSP.** A buffer underrun is audible. The audio thread runs wait-free.
- **Hard-real-time control loops.** Robotics, anti-lock brakes, pacemakers. Not Go territory in practice, but the principle is general.
- **Trading-system inner loops.** A 99.99th-percentile tail of 100 microseconds matters when your SLA is single-digit microseconds. Often wait-free, often not in Go.
- **The Go runtime itself.** The scheduler, garbage collector, and `runtime/poll` use wait-free primitives where necessary to avoid stalling the world.
- **Signal handlers.** A signal handler may run while a goroutine holds a mutex. Wait-free communication between handler and main thread is required to avoid deadlock.

If your problem is in this list, study the wait-free literature and pick a published algorithm. If your problem is not in this list, you almost certainly want lock-free or a mutex.

---

## Designing Concurrent Types

When you build a new concurrent type, follow this discipline.

### Step 1: write the sequential spec first

Describe what the type does in single-threaded terms. The progress class is a *property of the concurrent implementation*, not a property of the spec.

### Step 2: choose the weakest progress class that meets requirements

Default to mutex. Step up only when you can justify it: measured contention, fault tolerance, real-time deadline. Each step up the hierarchy buys a specific property; do not pay for one you do not use.

### Step 3: document the class per operation

A type can mix progress classes across operations. Document each.

```go
// Counter is a thread-safe counter.
//
// Progress class:
//   Add:   wait-free (single atomic increment)
//   Load:  wait-free (single atomic load)
//   Reset: blocking (mutex-protected)
type Counter struct { ... }
```

### Step 4: test under contention

Single-threaded tests cannot distinguish progress classes. Stress tests with `b.RunParallel`, `GOMAXPROCS=N` for several `N`, and a tail-latency histogram are required to verify your claims.

### Step 5: bound retries if latency is bounded

If your SLA caps p99 at `T` microseconds, your CAS loops cannot retry without bound. Pick a retry cap and a fallback path. The result is *not* wait-free, but it is *bounded*, which is what real systems need.

### Step 6: do not over-claim

If your read path is wait-free but the write path is mutex-protected, the *type* is mixed, not wait-free. Be precise. Reviewers will catch over-claims.

---

## Self-Assessment

- [ ] I can state and motivate Herlihy's 1991 progress definitions.
- [ ] I know the consensus number of `atomic.Add` (2) and CAS (infinity) and can explain the consequences.
- [ ] I can sketch the universal construction and explain why it is unusable in practice.
- [ ] I can describe the helping pattern, including phase counters and bounded help.
- [ ] I can identify the memory-reclamation problem unique to wait-free descriptors.
- [ ] I can separate linearisability (correctness) from progress class (timing).
- [ ] I can explain how a seqlock fits the hierarchy: lock-free read, blocking write.
- [ ] I know how cache coherence, NUMA, and hyper-threading complicate the abstract hierarchy.
- [ ] I can defend "wait-free is rarely worth the complexity in Go" with three reasons.
- [ ] I can list the five failure modes and which progress class precludes each.
- [ ] I can design a concurrent type that documents per-operation progress class.
- [ ] I never confuse "wait-free" with "lock-free" in conversation, design docs, or code comments.

---

## Summary

Herlihy's 1991 paper established the four-rung progress hierarchy, proved that wait-free objects are impossible with only atomic registers (hence the need for CAS), and introduced the universal construction as an existence proof. Consensus numbers classify primitives by the size of consensus they can solve: atomic registers (1), `atomic.Add` (2), CAS (infinity). Wait-free implementations of useful objects rely on helping mechanisms, in which arriving threads complete a bounded number of announced pending operations before doing their own. The helping cost is real, typically `O(N)` per call, and shows up as 2-10x steady-state overhead versus the lock-free equivalent. In Go, the practical answer for almost every concurrent type is "use a mutex" or "use `atomic.Add` and friends." Lock-free designs (Treiber stack, Michael-Scott queue) are appropriate when measured contention demands it; wait-free designs are reserved for hard-real-time, fault-tolerant, or safety-critical systems where the bounded worst-case latency is part of the specification. The honest senior position is that wait-free is rarely worth the complexity in Go, and pretending otherwise signals lack of measurement discipline. See Herlihy 1991 *Wait-Free Synchronization* (ACM TOPLAS) for the definitions, Herlihy 1993 for the universal construction, Kogan-Petrank 2011 for the reference wait-free queue, and Herlihy-Shavit *The Art of Multiprocessor Programming* (2nd ed., chapters 3 and 5) for the canonical pedagogical treatment.
