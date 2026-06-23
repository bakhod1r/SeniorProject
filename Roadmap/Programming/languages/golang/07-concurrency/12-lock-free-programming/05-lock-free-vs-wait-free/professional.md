# Lock-Free vs Wait-Free — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Hard Real-Time Systems](#hard-real-time-systems)
3. [Fault-Tolerant Systems](#fault-tolerant-systems)
4. [Kernel and Runtime Code](#kernel-and-runtime-code)
5. [Signal Handlers](#signal-handlers)
6. [Trading and Low-Latency Networking](#trading-and-low-latency-networking)
7. [FPGA / Custom Hardware](#fpga-custom-hardware)
8. [Wait-Free in the Go Runtime](#wait-free-in-the-go-runtime)
9. [Compromises and Bounded Lock-Free](#compromises-and-bounded-lock-free)
10. [Verification and Proof Obligations](#verification-and-proof-obligations)
11. [Case Studies](#case-studies)
12. [Summary](#summary)

---

## Introduction

The professional file is for the engineer who is *deciding* whether a wait-free guarantee is required. By this point you know the definitions, the hierarchy, the universal construction, and the cost of helping. What remains is the production question: in which industries, on which hardware, under which regulatory pressure does the wait-free guarantee earn its complexity?

The answer is a small list. Hard real-time. Fault tolerance. Some kernel and runtime code. Signal handlers. The hottest paths of latency-bound trading systems. Custom hardware. Outside this list, the wait-free claim is decoration. Inside it, getting the claim wrong is dangerous.

We work through each setting concretely, name the standard solutions, and identify where Go is and is not the right tool.

---

## Hard Real-Time Systems

A hard real-time system has *correctness deadlines*: missing a deadline is a failure of the system, not a degradation. Examples include anti-lock braking systems, pacemakers, industrial control loops, and audio synthesis at sample-accurate timing.

### Why wait-free matters here

In hard real-time, every operation in the critical path must complete in a bounded number of steps. A lock-free CAS loop with no bound on retries can, in the adversarial case, miss the deadline. The bound is the SLA.

### Audio synthesis: the prototypical wait-free use case

An audio callback runs every ~5 milliseconds (at 48kHz with 256-sample buffers). If the callback does not fill the buffer in time, the speaker plays silence — a click or pop. Any communication between the audio thread and the rest of the program must be wait-free.

```go
// A wait-free single-producer single-consumer ring buffer.
// Used by the audio callback to receive control messages from the UI thread.
type SPSCRing[T any] struct {
    buf  []T
    mask uint64
    head atomic.Uint64 // writer
    tail atomic.Uint64 // reader
}

func NewSPSCRing[T any](sizePow2 int) *SPSCRing[T] {
    size := 1 << sizePow2
    return &SPSCRing[T]{
        buf:  make([]T, size),
        mask: uint64(size - 1),
    }
}

func (r *SPSCRing[T]) Push(v T) bool {
    h := r.head.Load()
    t := r.tail.Load()
    if h-t == uint64(len(r.buf)) {
        return false // full
    }
    r.buf[h&r.mask] = v
    r.head.Store(h + 1)
    return true
}

func (r *SPSCRing[T]) Pop() (T, bool) {
    var zero T
    t := r.tail.Load()
    h := r.head.Load()
    if h == t {
        return zero, false
    }
    v := r.buf[t&r.mask]
    r.tail.Store(t + 1)
    return v, true
}
```

`Push` and `Pop` are wait-free per call: each runs in `O(1)` instructions with no retry. The SPSC discipline (exactly one producer, exactly one consumer) is what makes the design simple.

### The catch: Go is rarely the right language for hard real-time

The Go scheduler can preempt your goroutine at function-call safe points and at the 10ms preemption tick. The garbage collector can stop the world for several milliseconds. Neither is acceptable for sub-millisecond audio.

In practice, professional audio code runs in C, Rust, or even hand-written assembly, with the audio callback on a real-time-priority OS thread. Go is occasionally used for the UI and orchestration around such systems, but not for the hot path.

The wait-free *data structure* is necessary but not sufficient. You also need a real-time OS scheduler and a language with predictable allocation. Go provides neither.

---

## Fault-Tolerant Systems

A fault-tolerant system continues operating when components fail. In the context of progress hierarchies, "component" means "thread or process," and "fail" means "stops making progress."

### Why wait-free implies fault tolerance

A wait-free algorithm guarantees that every non-failed thread completes its operations in a bounded number of its own steps, regardless of what other threads do — including never running again. A frozen thread is, formally, identical to a thread that runs infinitely slowly. Wait-free survives both.

Lock-free is weaker. It survives a frozen thread holding no critical resource — but if the frozen thread held a CAS-targeted location's "intent" (an operation descriptor for example), other threads can be stuck completing that operation if the helping mechanism is incomplete.

Blocking algorithms fail badly under thread freeze. A frozen mutex holder blocks every waiter forever.

### Where this matters in production

**Distributed in-memory state shared across thread-local caches.** Some database engines and trading systems use shared-memory data structures where a process crash (manifesting as a frozen thread to the survivor) must not deadlock the survivors.

**Userspace network drivers (DPDK, kernel-bypass).** The hot path runs on dedicated cores with no preemption; if a thread crashes mid-operation, the others must continue without intervention.

**Co-resident tenants on a shared cache.** A cooperative cache shared by mutually distrusting processes cannot use locks — a malicious or buggy tenant could hold a lock forever. Wait-free is the formal requirement.

### Go's position

Go programs almost never face this failure model. Goroutines do not crash independently; an uncaught panic terminates the process. Process-level fault tolerance is achieved by running multiple processes and using OS-level isolation, not by sharing wait-free data structures.

The one exception is Go programs that run inside larger fault-tolerant systems (network appliances, embedded gateways). There, the *process* must continue if one of its peers crashes, and the inter-process IPC may rely on wait-free shared memory. But this is rare.

---

## Kernel and Runtime Code

Operating system kernels and language runtimes face a uniquely strict environment. The kernel's scheduler cannot rely on itself for progress — it *is* the scheduler. A runtime's garbage collector cannot rely on user goroutines being responsive, because the GC may be running while user code is paused.

### Why wait-free is necessary in some kernel paths

Consider a Linux kernel that needs to log a tracepoint event from inside an interrupt handler. The interrupt may have preempted a thread that holds the log buffer's mutex. If the log path is mutex-based, the interrupt deadlocks the kernel. The kernel uses a *wait-free* per-CPU ring buffer for `printk` and related paths.

Other examples:
- *Read-copy-update (RCU)* for read-heavy kernel data structures. Readers are wait-free; writers serialise and wait for a grace period.
- *Lockless allocators* for memory allocation under interrupt context.
- *Per-CPU counters* for statistics. Wait-free because they are touched from interrupts.

### The Go runtime

The Go runtime uses a mixture of strategies, with wait-free paths where the runtime cannot afford to block:

- *`mcache` per-P allocators* — wait-free `Get` on the fast path.
- *`mheap.lock` spans* — mutex-protected slow path; the fast path is per-P and wait-free.
- *`mstats` accounting* — atomic adds, wait-free.
- *Scheduler queues* — partly lock-free, partly mutex-protected.
- *Stack growth* — careful coordination; cannot block in arbitrary user code.
- *GC mark queue* — work-stealing deques per worker, mostly lock-free.

The runtime team writes wait-free code where it is necessary and lock-free code where it is sufficient. Application code should not imitate the runtime; the runtime has different constraints.

---

## Signal Handlers

A POSIX signal handler runs in the context of an interrupted thread. The handler may execute while the thread holds a mutex. If the handler tries to acquire the same mutex, the program deadlocks. Hence the rule: only *async-signal-safe* functions are legal inside a handler.

### Wait-free as a sufficient condition

A wait-free data structure is, by definition, never blocked by another thread's state. A signal handler can therefore communicate with the main program through wait-free shared state without risk of deadlock.

The classic Unix pattern is a single byte written to a self-pipe, picked up by the main loop. The pipe write is async-signal-safe and (within a single byte) effectively wait-free. More complex IPC requires a wait-free ring or a `sig_atomic_t` flag.

### Go's situation

Go's signal handling is mediated by the runtime. User code does not run inside a signal handler in the POSIX sense; instead, the runtime translates signals into channel sends. The channel itself is mutex-protected, so the *runtime* handles the wait-free / async-signal-safe constraint, and user code interacts with signals through ordinary blocking primitives.

This means Go programmers usually do not need to worry about wait-free in signal context — the runtime has done it. Exceptions: low-level cgo code, code that registers its own signal handlers via raw syscall, and a few profiling paths.

---

## Trading and Low-Latency Networking

High-frequency trading systems have tail-latency SLAs measured in microseconds. The 99.99th percentile of message handling can be the difference between profit and loss.

### Wait-free in the hot path

For a market-data fan-out from a single exchange feed to dozens of strategy threads, a typical design is:

1. The feed handler thread reads packets from a kernel-bypass NIC.
2. It writes each tick into a wait-free SPMC (single-producer, multi-consumer) ring buffer.
3. Each strategy thread reads from the ring, processes the tick, and updates its book.

The SPMC ring is wait-free per push and per pop because the bound on tail latency is a hard SLA. The throughput cost is acceptable because the bound matters more than the average.

### Disruptor pattern (LMAX)

The LMAX Disruptor (Martin Thompson, 2011) is the canonical wait-free SPMC / MPSC ring for trading systems. It pre-allocates slots, uses memory barriers carefully, and avoids the cache contention of a CAS-based queue by partitioning the writer's claim from the reader's consume. The original is Java; ports exist for Go (and C++ and Rust).

The key insight: a wait-free *single-producer* ring is much simpler than a multi-producer one. If you can make your design single-producer (by funneling all producers through one writer thread), you get wait-free almost for free.

### Where Go is and is not used

Go is used for the *control plane* of many trading systems — strategy configuration, order management, post-trade reconciliation. It is rarely used for the *data plane*, where microsecond tails matter and the JVM, C++, or Rust are typical choices.

Within Go, the wait-free pattern is sometimes applied to metric collection and to the inter-thread fan-out *between* logically related services on the same machine. A wait-free counter or ring is a reasonable Go construct for these uses.

---

## FPGA / Custom Hardware

FPGAs implement data structures directly in hardware. Lock-free and wait-free distinctions remain, but the implementation costs flip.

### Hardware atomic primitives

A custom FPGA design can implement a wait-free queue trivially: dedicate a hardware enqueue port and a hardware dequeue port, with explicit handshake signals. There is no scheduler to fight with, no preemption, no contention beyond what the wire allows.

### Where Go integrates

Go programs interact with FPGAs through PCIe-mapped memory, DMA, or a kernel driver. From Go's perspective, the FPGA looks like a wait-free coprocessor — read and write operations to the mapped region complete in bounded time (set by the bus).

Wait-free Go code communicating with an FPGA over PCIe is rare but real. Designs include packet classifiers in network appliances, machine learning accelerators, and crypto offload.

The lesson is that wait-free is a *property* you can buy by spending hardware. Software wait-freedom is hard because software shares CPU. Hardware wait-freedom is easy because hardware can be dedicated.

---

## Wait-Free in the Go Runtime

The Go runtime contains a handful of wait-free paths. Studying them is the most concrete way to see wait-free engineering in Go.

### `sync.Once.Do` steady state

```go
// Sketch (real implementation in sync/once.go).
type Once struct {
    done atomic.Uint32
    m    Mutex
}

func (o *Once) Do(f func()) {
    if o.done.Load() == 1 {
        return // wait-free fast path
    }
    o.doSlow(f) // mutex-protected slow path
}
```

After the first call completes, every subsequent call sees `done == 1` in one atomic load. That is wait-free per call. The first call is blocking.

### `runtime.gopark` accounting

The scheduler's accounting for goroutine state transitions uses atomic ops carefully placed so that the hot path (a yielding goroutine) does not contend with other goroutines. The result is wait-free transitions in the common case.

### `runtime.GC()` write barriers

The garbage collector's write barrier executes on every pointer write during a GC cycle. It must be wait-free or the program would stall every write. The barrier is a small atomic op that adds the written pointer to a per-goroutine queue.

### `time.Now()` on most platforms

`time.Now` reads from a kernel-provided vDSO page that is updated by the kernel and observed by user space without a syscall. The user-space read is wait-free.

### `runtime/poll` event readiness flags

The netpoller marks readiness flags atomically. The reader's check is wait-free; the actual wait happens through the scheduler on a separate path.

### What you learn

The runtime team uses wait-free where it must — performance-critical paths that cannot tolerate any contention or mutex acquisition. Elsewhere, the runtime uses mutexes (notably `runtime.lock`) and accepts the cost. The discipline is *measure first, choose the weakest tool that meets the requirement, and document it*. The same discipline applies to application code.

---

## Compromises and Bounded Lock-Free

In practice, the right answer at the boundary between lock-free and wait-free is often *bounded* lock-free: a lock-free algorithm with a hard cap on retries and a fallback path.

### The pattern

```go
const maxRetries = 16

func (s *Slot) Update(transform func(int64) int64) error {
    for i := 0; i < maxRetries; i++ {
        old := s.value.Load()
        new := transform(old)
        if s.value.CompareAndSwap(old, new) {
            return nil
        }
    }
    return errContended
}
```

This is *not* wait-free in the formal sense — there are conditions under which no operation completes. But it is *bounded*, which is what real systems care about. The caller decides what to do when contention exceeds the cap: retry later, fall back to a mutex, shed load, alert the operator.

### When bounded lock-free is the right answer

- The SLA caps per-operation latency.
- The fallback path is acceptable (the caller can handle `errContended`).
- True wait-free is too complex or too slow.
- The contention cap is rarely hit in practice; the cap is for safety, not throughput.

### When it is not

- The contention cap is hit often enough that the fallback path's latency dominates the SLA. In that case, the fallback path is the real algorithm and the lock-free top is window dressing.
- The caller cannot handle an `errContended` return (the operation must succeed). In that case, you need either an unbounded lock-free design or a wait-free design.

Bounded lock-free is a pragmatic middle ground. It shows up in trading systems, real-time pipelines, and the inner loops of database engines. It is rarely the *publishable* design, but it is often the *shipped* design.

---

## Verification and Proof Obligations

A wait-free claim is falsifiable. Senior engineers should know how to verify or refute one.

### Step 1: identify the bound

Every wait-free algorithm has an integer `B`, usually a function of the thread count `N`, that bounds per-operation steps. Find it in the documentation or derive it from the code. If you cannot, the claim is unfounded.

### Step 2: check the loop structure

Every loop in the algorithm must have a static bound on iterations. Look for `for { ... CompareAndSwap ... }` with no exit condition other than CAS success — that is the lock-free signature, not wait-free.

### Step 3: check the helping invariant

If the algorithm uses helping, verify that:
- Every pending operation is observed by every arriving thread.
- Every arriving thread helps at least one pending operation when ones exist.
- The number of operations a thread can help is bounded.

### Step 4: check memory reclamation

A wait-free algorithm that uses operation descriptors must explain when descriptors are reclaimed. In Go, GC handles most reclamation, but the algorithm must still avoid using a descriptor after it has been marked done if subsequent helpers read it.

### Step 5: test under adversarial schedule

Empirical confirmation: a stress test where one or two goroutines are deliberately slowed (`runtime.Gosched`, busy-wait, smaller `GOMAXPROCS`) and the per-goroutine completion counts are measured. A wait-free algorithm produces a near-flat distribution. A lock-free algorithm produces a skewed distribution.

### Tools

- Go's race detector (`-race`) verifies data-race freedom but not progress.
- The `testing` package's `-cpu` and `-parallel` flags help vary contention.
- External tools: TLA+ for formal proofs (rare in Go), Datarace for runtime checking.

Most wait-free claims in published Go code go unverified. A senior engineer should verify before trusting.

---

## Case Studies

### Case study 1: a metric counter

A metric counter incremented millions of times per second across hundreds of goroutines. The natural choice is `atomic.Int64.Add` — wait-free, single instruction, simplest possible. No mutex, no CAS loop. Sharding (per-CPU counters summed at read) is the next step if the single counter saturates.

This is the *common* case. Wait-free comes for free because the operation is a single atomic.

### Case study 2: a job queue

Web service worker pool: enqueue jobs from request handlers, dequeue from workers. Realistic load: 10k jobs/second, contention low to moderate. The right choice is *a buffered channel* — blocking, but throughput is more than adequate. Lock-free queues, let alone wait-free ones, are over-engineering.

This is also the common case. Mutex-equivalent primitives suffice.

### Case study 3: a real-time control loop

Robotics control: read sensors, compute, send actuator commands, every 1ms. The actuator command must arrive within 1ms or the system fails. The communication path between the control thread and the actuator driver must be wait-free.

This case justifies wait-free. The solution is an SPSC ring buffer, statically allocated, with a real-time-priority OS thread on the control side. Go is *not* the right language here; the real-time scheduling and absence of GC pauses are essential, and Go provides neither.

### Case study 4: a feed handler in a trading system

Market data fan-out from a single feed to ten strategy threads. Each strategy must see every tick with sub-microsecond latency. The natural choice is a wait-free SPMC ring (Disruptor-style), and the implementation language is typically C++ or Rust.

Go might be used for adjacent components — order management, position tracking, post-trade — but not for the feed handler itself.

### Case study 5: a configuration hot reload

A long-running service that periodically reloads its configuration. The hot path is `Load`; the cold path is `Reload`. Choice: `atomic.Pointer[Config]` for reads (wait-free), and a mutex around the reload logic (blocking). Readers see either the old or the new config; never a torn read.

This is a common Go pattern. Wait-free reads, blocking writes, perfectly aligned with the workload.

### Case study 6: a fan-out broadcast

A service that pushes events to N subscribers. If N is small (single digits), per-subscriber channels are fine. If N is large (hundreds), the broadcast cost dominates and a wait-free SPMC ring is sometimes used. In Go this is rare; the usual pattern is to push to a single hot queue and let subscribers poll, which trades off some latency for simplicity.

---

## Summary

The wait-free guarantee earns its complexity in a small, well-defined set of settings: hard real-time control loops (rarely Go), fault-tolerant inter-process IPC (occasionally Go), operating-system kernel paths and language runtime internals (the Go runtime uses wait-free where necessary), signal handlers (mediated in Go by the runtime), the hot paths of low-latency trading systems (rarely Go), and custom hardware integrations (occasionally Go). Outside these settings, the wait-free claim is decoration; pursue lock-free or mutex-based designs instead. The pragmatic middle ground is *bounded lock-free*: a hard retry cap with a fallback path, which is not formally wait-free but matches real-world SLAs.

A wait-free claim is falsifiable: it requires a documented bound, statically bounded loops, a helping invariant when helping is used, and a memory-reclamation discipline. Senior engineers should verify before trusting.

The Go runtime is the best in-tree example of disciplined wait-free engineering. Its `sync.Once` fast path, write barrier, scheduler accounting, and netpoller readiness flags are all wait-free by design. Application code should not imitate the runtime; the runtime faces different constraints.

The professional position: wait-free is a tool for a small list of problems. Memorise the list. When you face a problem on it, study the literature, pick a published algorithm, and verify the bound. When you do not, default to lock-free or mutex, and document your choice.

See Herlihy 1991 *Wait-Free Synchronization* for the foundational paper, the LMAX Disruptor whitepaper for the canonical SPMC wait-free ring, and the Go runtime source for working wait-free Go code.
