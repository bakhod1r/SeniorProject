---
layout: default
title: Sequential Consistency — Interview
parent: Sequential Consistency
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/03-sequential-consistency/interview/
---

# Sequential Consistency — Interview Questions

This page collects interview questions on sequential consistency in Go, organised by difficulty level. Each question is followed by a model answer.

---

## Junior Level (1–10)

### Q1: What is sequential consistency?

**A:** Sequential consistency is a property of memory operations where every read and write appears to happen one at a time, in some global order. Each goroutine's operations appear in this order in the same sequence as the source code.

### Q2: What does it mean for a program to be "data-race-free"?

**A:** A program is data-race-free if no two goroutines access the same memory location concurrently with at least one write, without a happens-before edge between them. In other words: every access to shared memory is properly synchronised.

### Q3: What does Go guarantee about race-free programs (Go 1.19+)?

**A:** Go guarantees that race-free programs behave as if executed under sequential consistency. This is called SC-DRF (Sequential Consistency for Data-Race-Free programs).

### Q4: How do you start a goroutine in Go?

**A:** With the `go` keyword followed by a function call: `go f()` or `go func() { ... }()`.

### Q5: Why is `var done bool; go func() { done = true }(); for !done {}` incorrect?

**A:** It's a data race. The compiler may hoist the read out of the loop, causing it to spin forever. Use `atomic.Bool` instead.

### Q6: What is `atomic.Pointer[T]` used for?

**A:** Atomic operations on typed pointers. Useful for publishing a struct atomically (the publication pattern).

### Q7: What's the simplest fix for a race on a shared bool flag?

**A:** Use `atomic.Bool` with `Load()` and `Store()`.

### Q8: How do you run the race detector?

**A:** `go test -race ./...` or `go run -race main.go`.

### Q9: What happens if you have a data race in your Go program?

**A:** Undefined behaviour. The program may produce any output, crash, or behave inconsistently. Go provides no guarantees.

### Q10: Which Go version added typed atomic types like `atomic.Bool`?

**A:** Go 1.19 (August 2022).

---

## Middle Level (11–25)

### Q11: Explain the publication pattern with atomics.

**A:** A writer prepares data, then atomically stores a flag or pointer. A reader atomically loads the flag/pointer, then reads the data. The atomic load/store creates a happens-before edge, ensuring the reader sees the writer's data.

### Q12: What is happens-before?

**A:** A partial order on memory operations. If A happens-before B, then B may observe A's effects. Constructed from per-goroutine program order plus synchronisation edges (channels, mutexes, atomics, etc.).

### Q13: Compare Go's `sync/atomic` with C++'s `std::atomic`.

**A:** Go's atomics are always sequentially consistent (SC). C++'s std::atomic supports five memory orders (relaxed, acquire, release, acq_rel, seq_cst). C++ default is seq_cst.

### Q14: What is the store-buffer litmus test?

**A:** A two-thread test: thread A writes x=1 then reads y; thread B writes y=1 then reads x. Under SC, both reads cannot return 0 simultaneously. Under x86 TSO (without fences), both can return 0.

### Q15: What is false sharing?

**A:** When two atomics on the same cache line are written by different goroutines, the line bounces between cores. Performance degrades. Fix: pad to 64 bytes between atomics.

### Q16: What's the difference between `sync.Mutex` and `sync/atomic`?

**A:** Mutex protects multi-step critical sections; can block. Atomic protects single-word state; never blocks. Atomics are usually faster for single-variable updates; mutex is simpler for compound state.

### Q17: When would you use `atomic.Pointer[T]` over `sync.RWMutex` for a config?

**A:** When reads vastly outnumber writes. `atomic.Pointer.Load` is essentially free; `RWMutex.RLock+RUnlock` is ~50ns even uncontended.

### Q18: What is the IRIW litmus test?

**A:** Independent Reads of Independent Writes: four threads, two writers (each writes to a different location) and two readers (each reads both locations). Under SC, the readers must agree on the global order of writes. Under acq-rel, they may not.

### Q19: Why does Go not expose `memory_order_relaxed`?

**A:** Simplicity. The Go team chose to provide only SC, accepting the modest performance cost in exchange for a simpler model with fewer bug surfaces.

### Q20: What does the race detector do?

**A:** Dynamically tracks memory accesses and happens-before edges using vector clocks. Reports any access pair that lacks a happens-before relation.

### Q21: How does `sync.Once` work?

**A:** It uses an atomic flag (`done`) and a mutex. Fast path: atomic Load of `done`; if non-zero, return. Slow path: take the mutex, re-check, run the function, set `done` atomically.

### Q22: What's the cost of an SC atomic store on x86?

**A:** Approximately 10 ns (one `XCHG` or `LOCK`-prefixed instruction).

### Q23: What's the cost on ARM64?

**A:** Approximately 10–20 ns (`STLR` instruction with implicit fence).

### Q24: What is the ABA problem?

**A:** In lock-free CAS, the value being swapped may match the expected value (A) but have changed in between (A → B → A). The CAS succeeds, but the data structure may be corrupted. Fix: tagged pointers or hazard pointers.

### Q25: When do you need cache-line padding?

**A:** When two atomic variables on the same cache line are written by different goroutines. Pad to 64 bytes to eliminate false sharing.

---

## Senior Level (26–40)

### Q26: State Lamport's 1979 definition of sequential consistency.

**A:** "The result of any execution is the same as if the operations of all the processors were executed in some sequential order, and the operations of each individual processor appear in this sequence in the order specified by its program."

### Q27: Explain how ARMv8.0 provides SC via LDAR/STLR.

**A:** LDAR is load-acquire: subsequent operations cannot reorder before it. STLR is store-release: prior operations cannot reorder after it. Together, the pair provides SC for synchronising operations (RCsc semantics).

### Q28: What is RCsc vs RCpc?

**A:** Release Consistency with sequentially-consistent (RCsc) synchronising operations: all observers agree on the order. Release Consistency with processor-consistent (RCpc): each processor sees a consistent order, but observers may differ.

### Q29: What does `runtime/internal/atomic.Xadd64` look like on x86?

**A:** `LOCK XADDQ AX, [memory]`. The `LOCK` prefix ensures atomicity and acts as a full memory barrier.

### Q30: How does the Go runtime's scheduler use SC?

**A:** Goroutine state transitions use SC CAS operations on the goroutine's `atomicstatus`. The run queue uses SC atomic indices. Work stealing uses SC CAS on remote P's queue.

### Q31: Implement a Treiber stack in Go.

**A:**

```go
type node struct {
    val  int
    next *node
}

type Stack struct {
    head atomic.Pointer[node]
}

func (s *Stack) Push(v int) {
    n := &node{val: v}
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}

func (s *Stack) Pop() (int, bool) {
    for {
        old := s.head.Load()
        if old == nil {
            return 0, false
        }
        if s.head.CompareAndSwap(old, old.next) {
            return old.val, true
        }
    }
}
```

ABA is a concern in C/C++ but mitigated in Go by the GC.

### Q32: When would a sharded counter outperform a single atomic counter?

**A:** Under high concurrent contention. A single counter's cache line bounces between cores; sharding spreads accesses across 64+ cache lines. Throughput scales nearly linearly with cores.

### Q33: Compare Go's memory model with Java's.

**A:** Both provide SC-DRF. Java's `volatile` is per-field; Go's atomics are per-type wrapper. Java has bounded behaviour for racy code; Go has UB. Both have race detectors (Go's is more widely used).

### Q34: What is RVWMO?

**A:** RISC-V Weak Memory Order. The default RISC-V memory model permits all four reorderings. Atomic ops with `aqrl` flags provide SC.

### Q35: How does cgo interact with Go's memory model?

**A:** Cgo calls cross into C, which has its own memory model. C `<stdatomic.h>` atomics with `memory_order_seq_cst` align with Go's SC. Plain C reads/writes do not synchronise with Go.

### Q36: Why is `time.Sleep` not a memory barrier?

**A:** Sleeping does not flush memory. Writes remain in their buffers; reordering is unaffected. Use explicit synchronisation primitives instead.

### Q37: Explain epoch-based reclamation.

**A:** A memory-reclamation scheme for lock-free structures. Each thread enters an epoch when starting an operation. Freeing memory waits until all threads have advanced past the relevant epoch.

### Q38: What is multicopy atomicity?

**A:** The property that stores from one core become visible to all others simultaneously. ARMv8 has it; pre-v8 did not. x86 always had it. Required for SC.

### Q39: Why does Go's compiler emit `XCHG` instead of `MOV + MFENCE` for SC stores on x86?

**A:** `XCHG` is faster on most microarchitectures. The implicit LOCK prefix on `XCHG` with memory operand provides the same barrier semantics as `MFENCE` but with less overhead.

### Q40: How would you debug a race condition that the race detector doesn't catch?

**A:** Run with `-cpu=1,2,4,8 -count=1000` to expose schedule-dependent races. Add stress tests with high concurrency. Use logging to trace memory access patterns. Consult senior engineers; sometimes the race is in design, not implementation.

---

## Professional / Staff Level (41–50)

### Q41: Articulate the Adve-Boehm argument for SC-DRF.

**A:** Sarita Adve and Hans Boehm (CACM 2010) argued that:
1. Programmers naturally reason in SC.
2. SC-DRF gives a "free lunch": race-free programs cost no more than racy ones to compile with SC guarantees, because the compiler can use weaker fences in race-free regions.
3. Race detection scales to large codebases.
4. Hardware can implement SC efficiently.

The Go team adopted this argument in 2022.

### Q42: Explain Russ Cox's reasoning for choosing SC over acq-rel.

**A:** Russ Cox argued:
- Existing Go code already assumed SC (effectively).
- SC is simpler to teach and review.
- Performance impact is modest (5-15% on real workloads).
- C++ programmers misuse acq-rel; the bug surface is larger.

The decision was made for community-scale simplicity.

### Q43: Compare TSO and RMO formally.

**A:** TSO (Total Store Order, x86) permits one reordering: store-load. All others are forbidden. RMO (Relaxed Memory Order, ARM pre-v8.3 / RISC-V) permits all four: LL, LS, SS, SL. RMO requires more fences for SC.

### Q44: What would it take to add `LoadRelaxed` to Go?

**A:** Several steps: write a proposal with use cases and performance evidence; gather community discussion; prototype implementation; demonstrate benefits; design review with Go team; if accepted, implement and test across all architectures; ship in a release; update documentation. The bar is high; rejected proposals exist.

### Q45: How would you formally verify a Go lock-free algorithm?

**A:** Several approaches:
- Hand proof against the memory model (correctness arguments).
- TLA+ specification with model checking (small but precise).
- Coq/Lean mechanisation (rigorous but laborious).
- Testing with stress + race detector (practical, not exhaustive).

For mission-critical code, combine multiple methods.

### Q46: What is the "out-of-thin-air" problem?

**A:** A pathological behaviour where a read returns a value that no thread ever wrote. Possible in some memory models with relaxed atomics. Forbidden in Java by spec; in C++/Go, racy code has UB so it's vacuously absent.

### Q47: Explain how the Linux Kernel Memory Model differs from Go's.

**A:** LKMM (Linux Kernel) is more elaborate because it preserves kernel idioms predating formal models. Includes control dependencies, data dependencies, and explicit fence macros (`smp_mb`, `smp_wmb`, etc.). Go's model is simpler: SC for atomics, no manual fences exposed.

### Q48: How would Go's memory model interact with persistent memory?

**A:** Persistent memory adds durability: a stored value may sit in cache before reaching persistent media. Go's current model says nothing about durability. Future extensions could add atomic-durable operations. Until then, use `msync` via cgo for persistent atomicity.

### Q49: What is the future of memory models in Go?

**A:** Conservative additions only:
- Possible: `atomic.Float64`, more generic operations.
- Unlikely: relaxed orderings, persistent memory extensions, inter-process atomics.
- Definitely not: linearizability, pluggable models.

The Go team values stability.

### Q50: If you could change one thing about Go's memory model, what would it be?

**A:** Personal opinions vary. Common suggestions:
- Add `atomic.Float64`.
- Expose explicit fences for advanced use cases.
- Add relaxed atomics for high-throughput counters.

Counter-argument: any change adds complexity. The current model serves the community well. "Don't break it."

---

## Behavioral / System Design Questions

### Q51: Walk me through how you'd profile a Go service with atomic contention.

**A:**
1. Capture a CPU profile with pprof.
2. Look for `runtime/internal/atomic.*` in the top functions.
3. Identify the variable.
4. Capture a mutex profile if mutexes are also hot.
5. Hypothesise: contention, false sharing, or hot path.
6. Apply mitigation: sharding, padding, batching.
7. Re-profile to confirm.

### Q52: Describe a memory-model bug you have debugged.

**A:** [Personal answer expected. Example: "A flag set by one goroutine, read by another, without synchronisation. The reader spun forever because the compiler hoisted the read. Fixed with `atomic.Bool`. Detected by `-race` in CI."]

### Q53: How would you teach SC to a junior engineer?

**A:** Start with the publication pattern. Show the broken version (plain bool). Run `-race`; show the report. Fix with `atomic.Bool`. Discuss the happens-before edge. Then introduce `atomic.Pointer[T]` for struct publication. Avoid formalism initially; use intuition and examples.

### Q54: How would you design a concurrent in-memory cache for read-mostly access?

**A:**
- Reads: lock-free via `atomic.Pointer[map[K]V]`.
- Writes: copy-on-write under a mutex.
- Periodic snapshots for monitoring.
- Cache-line padding if metric counters are hot.

### Q55: Why might channels be slower than atomics for some use cases?

**A:** Channels involve goroutine scheduling, mutex acquisition, and queue management. For simple flag-style signalling, atomics are 10-100× faster. For complex message passing, channels are more appropriate.

---

## Closing

These 55 questions cover the spectrum from junior to staff level. A candidate should answer most questions at their target level confidently.

For interviewers: use these as starting points, then probe deeper based on responses. Look for not just correct answers but reasoning quality.

For interviewees: review these before interviews. Practice explaining your reasoning aloud.

End.

---

## Appendix: Code-Reading Questions

These questions involve reading and analysing Go code.

### Q56: Find the bug.

```go
var counter int64

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter++
        }()
    }
    wg.Wait()
    fmt.Println(counter)
}
```

**A:** `counter++` is not atomic. Multiple goroutines race. Final value is unpredictable. Fix with `atomic.Int64` and `counter.Add(1)`.

### Q57: Is this code correct?

```go
var ready atomic.Bool
var data int

func writer() {
    data = 42
    ready.Store(true)
}

func reader() {
    if ready.Load() {
        fmt.Println(data)
    }
}
```

**A:** Yes (assuming writer and reader are separate goroutines and the SC store/load create the happens-before edge). The reader sees `data == 42` if it observes `ready == true`.

### Q58: Is this code correct?

```go
var ready atomic.Bool
var data int

func writer() {
    data = 42
    ready.Store(true)
    data = 43 // ← Note this
}

func reader() {
    if ready.Load() {
        fmt.Println(data)
    }
}
```

**A:** No. After `ready.Store(true)`, the reader may observe `ready == true` and read either 42 or 43 from `data`. The race on `data` is now possible because the publication doesn't make `data` immutable.

### Q59: Find the false sharing.

```go
type Counters struct {
    A atomic.Int64
    B atomic.Int64
    C atomic.Int64
    D atomic.Int64
}
```

**A:** If different goroutines write to different fields, they share a cache line (4 × 8 bytes = 32 bytes; cache line is 64 bytes, so all four fit). Fix: pad each field.

```go
type Counters struct {
    A atomic.Int64; _ [56]byte
    B atomic.Int64; _ [56]byte
    C atomic.Int64; _ [56]byte
    D atomic.Int64; _ [56]byte
}
```

### Q60: What's wrong with this singleton?

```go
type Singleton struct{ Name string }

var instance *Singleton
var mu sync.Mutex

func Get() *Singleton {
    if instance == nil {
        mu.Lock()
        if instance == nil {
            instance = &Singleton{Name: "default"}
        }
        mu.Unlock()
    }
    return instance
}
```

**A:** The first `if instance == nil` is a racy read. Concurrent with `instance = &Singleton{...}`, this is UB. Fix: use `atomic.Pointer[Singleton]` for `instance`.

---

## Appendix: Design Questions

These questions probe design judgement.

### Q61: Design a thread-safe configuration loader.

**A:**
```go
type Loader[T any] struct {
    cur atomic.Pointer[T]
}

func (l *Loader[T]) Load() *T { return l.cur.Load() }

func (l *Loader[T]) Update(t *T) { l.cur.Store(t) }
```

Reads are lock-free. Updates atomic. SC ensures consistency.

### Q62: Design a metric counter for 1M req/sec.

**A:** Sharded counter:
```go
type Counter struct {
    shards [64]struct {
        n atomic.Int64
        _ [56]byte
    }
}

func (c *Counter) Inc(g int) { c.shards[g%64].n.Add(1) }

func (c *Counter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].n.Load()
    }
    return s
}
```

64 shards with cache-line padding. Scales to many cores.

### Q63: Design a graceful shutdown signal.

**A:**
```go
type Shutdown struct {
    requested atomic.Bool
}

func (s *Shutdown) Request() { s.requested.Store(true) }
func (s *Shutdown) Wait() {
    for !s.requested.Load() {
        runtime.Gosched()
    }
}

// or using context.Context for cancellation:
ctx, cancel := context.WithCancel(context.Background())
// signal: cancel()
// check: <-ctx.Done()
```

Context is preferred for blocking; atomic.Bool for fast polling.

### Q64: Design a lock-free SPSC queue.

**A:**
```go
type SPSC struct {
    buf  []int64
    head atomic.Int64
    _    [56]byte
    tail atomic.Int64
    _    [56]byte
}

func (q *SPSC) Push(v int64) bool {
    h := q.head.Load()
    if h-q.tail.Load() >= int64(len(q.buf)) {
        return false
    }
    q.buf[h%int64(len(q.buf))] = v
    q.head.Store(h + 1)
    return true
}

func (q *SPSC) Pop() (int64, bool) {
    t := q.tail.Load()
    if t == q.head.Load() {
        return 0, false
    }
    v := q.buf[t%int64(len(q.buf))]
    q.tail.Store(t + 1)
    return v, true
}
```

Cache-line padded indices. SC ensures slot value visibility.

### Q65: Design a rate limiter.

**A:**
```go
type RateLimiter struct {
    tokens   atomic.Int64
    rate     int64 // per second
    lastSec  atomic.Int64
}

func (r *RateLimiter) Allow() bool {
    now := time.Now().Unix()
    last := r.lastSec.Load()
    if now > last {
        if r.lastSec.CompareAndSwap(last, now) {
            r.tokens.Store(r.rate)
        }
    }
    n := r.tokens.Add(-1)
    if n < 0 {
        r.tokens.Add(1)
        return false
    }
    return true
}
```

CAS-based refill; atomic decrement for token consumption.

---

## Appendix: Take-Home Project Suggestions

For interviewers wanting to give a take-home test:

### Project 1: implement a lock-free counter (junior)

Provide skeleton; ask candidate to fill in atomic operations, write tests, run `-race`.

### Project 2: implement copy-on-write map (middle)

Read-mostly map with `atomic.Pointer[map[K]V]` and CAS-loop updates. Benchmark vs `sync.RWMutex`.

### Project 3: implement Michael-Scott queue (senior)

Two-pointer lock-free queue. Argue correctness. Handle ABA.

### Project 4: implement RCU-style configuration (senior)

Read-copy-update for hot config reload. Compare GC behaviour with and without explicit reclamation.

### Project 5: implement a memory-model formal model (professional)

Choose a small subset of Go's memory model. Formalise in TLA+ or Coq. Verify a simple algorithm.

These projects test different levels of understanding.

---

## Appendix: Tips for Candidates

### Before the interview

- Review Go's memory model document.
- Read Russ Cox's blog posts.
- Practice the publication pattern from memory.
- Run `go test -race` on your own code.

### During the interview

- Explain your reasoning aloud.
- Draw happens-before edges if helpful.
- Acknowledge what you don't know.
- Ask clarifying questions about requirements.

### After the interview

- Reflect on questions you fumbled.
- Read up on those topics.
- Practice answering similar questions aloud.

The goal is not memorisation; it's deep understanding. Interviewers can tell the difference.

---

## Closing

These interview questions cover SC in Go from every level. Use them to prepare, to interview, or to self-assess.

Good luck.

End.

