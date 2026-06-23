# sync/atomic — Interview Questions

## Junior Level

### Q1. Why does `counter++` from multiple goroutines lose increments?

**Answer.** `counter++` is not one machine instruction. The compiler emits at least three: load the current value, increment, store. Two goroutines can each load the same value, each increment locally, and each store the same result. One increment is lost. Run with `go run -race` and the race detector flags both lines.

The fix: use `atomic.Int64.Add(1)`, which compiles to a single CPU instruction (`LOCK XADDQ` on x86) that is atomic — no other CPU can interleave between the load, the add, and the store.

---

### Q2. What are the five core operations in `sync/atomic`?

**Answer.**

1. **Load** — atomic read.
2. **Store** — atomic write.
3. **Add** — atomic read-modify-write that adds a delta; returns the new value.
4. **Swap** — sets the value, returns the previous one.
5. **CompareAndSwap** — if current equals `old`, set to `new` and return `true`; else return `false`.

`Add` is for counters. `Swap` is for "take value and reset." `CompareAndSwap` (CAS) is the foundation of lock-free programming.

---

### Q3. When would you use `atomic` instead of `sync.Mutex`?

**Answer.** When you need to synchronise access to a *single* variable with one of the five primitive operations. Counter, boolean flag, configuration pointer. Atomic is faster (≈ 2 ns vs ≈ 20 ns uncontended) and never deadlocks.

The moment you need to update two related variables together, or run any branching logic in a critical section, switch to `sync.Mutex`. Two atomic operations are not equivalent to one atomic transaction.

---

### Q4. What is the Go 1.19 typed atomic API, and why is it preferred?

**Answer.** Go 1.19 added struct types: `atomic.Bool`, `atomic.Int32`, `atomic.Int64`, `atomic.Uint32`, `atomic.Uint64`, `atomic.Uintptr`, `atomic.Pointer[T]`. Instead of:

```go
var x int64
atomic.AddInt64(&x, 1)
```

you write:

```go
var x atomic.Int64
x.Add(1)
```

Reasons to prefer it:

1. **Cannot mix atomic and non-atomic access.** The underlying field is unexported.
2. **Alignment handled automatically.** `atomic.Int64` is 8-byte aligned on 32-bit platforms, eliminating the old "place 64-bit fields first" trap.
3. **Type-safe pointers.** `atomic.Pointer[T]` avoids `unsafe.Pointer` casts.
4. **Reads more naturally.** `count.Add(1)` is clearer than `atomic.AddInt64(&count, 1)`.

The legacy free functions remain for backwards compatibility but should not appear in new code.

---

### Q5. Write a stop-flag pattern with `atomic.Bool`.

**Answer.**

```go
var stop atomic.Bool

go func() {
    for !stop.Load() {
        doWork()
    }
}()

// later
stop.Store(true)
```

The worker polls the flag each iteration. The main goroutine sets the flag with one atomic store. Within microseconds, the worker observes the change and exits.

A common follow-up: "Why not just close a channel?" Closing a channel works too and integrates with `select`. The atomic version is shorter for the simple poll loop. Both are correct.

---

## Middle Level

### Q6. Explain Go's memory model for atomics.

**Answer.** Since Go 1.19, the memory model formally states that all atomic operations behave as if executed in some sequentially consistent order. This is the strongest commonly used memory model: every goroutine agrees on the same total order of atomic operations.

Two implications:

1. If atomic operation B observes the value written by atomic operation A, then A is *synchronised before* B. Everything that happened-before A in its goroutine (including non-atomic writes) is visible to anything that happens-after B in B's goroutine.

2. Two atomic operations on different variables, performed in source order by one goroutine, appear in that order to every other goroutine. No relaxed ordering, no acquire-only or release-only.

This matches Java's `volatile` (Java 5+) and C++'s `memory_order_seq_cst`.

---

### Q7. Why is alignment a concern with 64-bit atomics?

**Answer.** A 64-bit atomic instruction requires the target memory address to be 8-byte aligned. On 64-bit platforms (amd64, arm64), the compiler aligns all 64-bit values to 8 bytes automatically — no concern.

On 32-bit platforms (386, arm, mips), `int64` fields may be 4-byte aligned. Calling `atomic.AddInt64(&s.field, 1)` on a misaligned address **crashes**:

```
unaligned 64-bit atomic operation
```

Historical fix: put 64-bit fields first in the struct, where alignment propagates from the struct's allocation. Fragile — anyone reordering fields breaks the program on 32-bit hardware.

Modern fix: use `atomic.Int64`. The struct contains a zero-sized `align64` marker that the compiler treats specially to force 8-byte alignment regardless of position. The Go 1.19 typed API removes this trap entirely.

---

### Q8. Difference between `atomic.Pointer[T]` and `atomic.Value`?

**Answer.** Both atomically store a value. The differences:

| | `atomic.Pointer[T]` | `atomic.Value` |
|---|---|---|
| Type safety | Compile-time (generic) | Runtime (panics on type mismatch) |
| Go version | 1.19+ | 1.0+ |
| Stores | A `*T` | Any single concrete type |
| Nil | Allowed | First Store cannot be nil; later mismatches panic |
| Pattern | Strongly typed config swap | Dynamic-typed cases (rare) |

For new code, `atomic.Pointer[T]` wins on every axis except age. Use `atomic.Value` only when you genuinely need runtime polymorphism (e.g., storing different concrete types behind an interface, where the type-fixed nature of `Pointer[T]` is too restrictive).

---

### Q9. Show the copy-on-write configuration pattern.

**Answer.**

```go
type Config struct {
    Endpoint string
    Timeout  time.Duration
}

var current atomic.Pointer[Config]

// initialisation
current.Store(&Config{Endpoint: "https://api.example.com", Timeout: 5 * time.Second})

// reload — always build a fresh struct
func reload(c Config) {
    current.Store(&c)
}

// reader — load, never mutate
func handle() {
    cfg := current.Load()
    if cfg == nil {
        return
    }
    use(cfg.Endpoint, cfg.Timeout)
}
```

Critical: **never mutate the struct after `Store`.** Once published, treat it as immutable. Any mutation is a race with active readers.

The pattern enables lock-free reads at the cost of one allocation per reload. For a config that reloads every few seconds and is read millions of times, this is an enormous win.

---

### Q10. When does a CAS loop make sense, and when is it the wrong tool?

**Answer.**

Use a CAS loop when the new value depends *non-trivially* on the old value. Example: max-update.

```go
for {
    old := x.Load()
    if new <= old { return }
    if x.CompareAndSwap(old, new) { return }
}
```

Do **not** use CAS for `+delta`. Use `Add`. It is one instruction; the CAS loop is at minimum two (a load and a CAS) plus a branch.

Do **not** use CAS for unconditional set. Use `Store`. A CAS with `_` for old is misleading and slower.

Do **not** use CAS when contention is so high that retries dominate. A mutex with proper parking is fairer than a starvation-prone CAS spin.

---

### Q11. What is false sharing? How do you fix it?

**Answer.** **False sharing** is when two variables sit on the same CPU cache line and are written by different cores. The cache-coherence protocol (MESI) treats the line as a single unit: every write by one core invalidates the line in the other core's cache, even though the cores are touching different variables. Throughput drops dramatically.

Fix: pad the variables so each occupies its own cache line (64 bytes on x86, sometimes 128 on M1/POWER):

```go
type Shard struct {
    v atomic.Int64
    _ [56]byte // pad to 64 bytes
}
shards := [16]Shard{}
```

Now each shard's `atomic.Int64` lives alone on its cache line. Writing one shard does not invalidate any other.

This is the foundation of sharded counters: per-CPU counters that scale because there is no cache-line contention.

---

## Senior Level

### Q12. What is the ABA problem?

**Answer.** The ABA problem is a classic lock-free bug. Thread T1 reads value `A` from a shared location. T1 gets descheduled. Threads T2-Tn modify the location to `B`, then back to `A`. T1 resumes and performs a CAS expecting `A`; the CAS succeeds because the value is `A` again. But the world T1 thought it understood (based on observing `A` originally) has changed.

Classical example: a lock-free stack pop. T1 reads the head pointer `A`, plans to set head to `A.next = B`. T2 pops `A`, pops `B`, pushes a new node which happens to be reused storage at address `A` with a different `next`. T1's CAS succeeds but corrupts the stack.

In Go, the GC keeps `A` alive as long as T1 holds a reference, preventing pointer reuse. Classical ABA is mostly defused. ABA returns when:

- You use `sync.Pool` or another free list to recycle objects.
- You use integer indices or tags instead of GC-tracked pointers.
- You explicitly invalidate something the GC would have kept alive.

Mitigations: generation counters paired with pointers, hazard pointers, epoch-based reclamation, or simply relying on the GC.

---

### Q13. Implement a lock-free stack in Go.

**Answer.**

```go
type Node struct {
    value any
    next  *Node
}

type Stack struct {
    head atomic.Pointer[Node]
}

func (s *Stack) Push(v any) {
    n := &Node{value: v}
    for {
        n.next = s.head.Load()
        if s.head.CompareAndSwap(n.next, n) {
            return
        }
    }
}

func (s *Stack) Pop() (any, bool) {
    for {
        top := s.head.Load()
        if top == nil {
            return nil, false
        }
        if s.head.CompareAndSwap(top, top.next) {
            return top.value, true
        }
    }
}
```

Discussion points:

1. **ABA safety.** Go's GC keeps `top` alive as long as `Pop`'s local variable references it. Without the GC (in C, say), `top` could be freed and reused, breaking the pop.

2. **Performance vs mutex.** Under low contention, the lock-free stack is competitive. Under high contention, CAS retries multiply; a mutex-guarded slice can outperform.

3. **Memory ordering.** Go's atomics are sequentially consistent, so the loads and CASes are properly ordered with respect to each other. No additional fences needed.

In production, prefer a buffered channel or a mutex-guarded slice unless profiling shows the stack is the bottleneck.

---

### Q14. How do you build a high-throughput sharded counter?

**Answer.**

```go
const shardCount = 64

type Counter struct {
    shards [shardCount]struct {
        v atomic.Int64
        _ [56]byte // cache-line padding
    }
}

func (c *Counter) Add(n int64) {
    idx := shardIndex() // hash of goroutine to [0, shardCount)
    c.shards[idx].v.Add(n)
}

func (c *Counter) Load() int64 {
    var total int64
    for i := range c.shards {
        total += c.shards[i].v.Load()
    }
    return total
}
```

Trade-offs:

- **Add is contention-free.** Each goroutine hits one shard; cache-line padding eliminates false sharing.
- **Load is O(shardCount).** Acceptable for metrics scraped every few seconds; bad for counters read on every increment.
- **Sum is not atomic.** The total is approximate: between summing shard 5 and shard 6, shard 5 may have advanced.

For a Prometheus counter scraped every 15 s, this is the right design. For an in-flight-request gauge that must always read precisely, prefer one atomic with sharding only if profiling demands it.

### Choosing the shard

Go does not expose the current CPU or P. Options:
- Hash a per-goroutine identifier (no public API; some libraries dig into runtime internals via `go:linkname`).
- Round-robin via an atomic claim: each goroutine atomically increments to pick a shard at start.
- Use a thread-local-style trick with `runtime.LockOSThread` (heavy-handed).

For application metrics, picking a shard by hash of a per-goroutine value or even by request ID is usually sufficient.

---

### Q15. Why does `atomic.Value` use procPin during the first store?

**Answer.** `atomic.Value` stores a Go interface, which is two words: a type pointer and a data pointer. The first `Store` needs to atomically set both. The implementation uses a sentinel value (`^uintptr(0)`) for the type pointer to mark "store in progress":

1. CAS the type pointer from `nil` to the sentinel.
2. Store the data pointer.
3. Store the real type pointer (publishing the value).

During steps 2 and 3, the goroutine is holding a "lock" — the sentinel. If it gets descheduled here, concurrent readers see the sentinel and have to spin.

To bound this duration, `Store` calls `runtime_procPin()` before the CAS, which prevents the runtime from descheduling the goroutine until `runtime_procUnpin()` is called. Steps 2 and 3 are short enough that pinning does not hurt; without pinning, the worst-case wait for readers could be milliseconds.

Subsequent stores (after the first) only update the data pointer (since the type is already published), which is a single `StorePointer`. No pin needed.

`atomic.Pointer[T]` does not need any of this — it stores one word, atomically, with no special handling.

---

### Q16. Compare `sync.Once` and a hand-rolled atomic CAS for one-time initialisation.

**Answer.**

`sync.Once`:

```go
var once sync.Once
once.Do(func() { /* init */ })
```

Hand-rolled CAS:

```go
var done atomic.Int32
if done.CompareAndSwap(0, 1) {
    /* init */
}
```

Difference: `sync.Once` *waits* for the initialiser to finish if another goroutine is currently running it. The CAS-only version does not — the second goroutine sees `done == 1` and proceeds, possibly before init has completed.

`sync.Once` uses an atomic flag for the fast path (`done` is checked first) and a mutex + Cond for the slow path (waiters block). Built on top of the same primitives but with the correct waiting semantics.

For "run exactly once and wait for completion," use `sync.Once`. For "run at most once, do not wait," use the bare CAS pattern. The latter is rare.

---

## Professional Level

### Q17. What CPU instruction does `atomic.Int64.Add(1)` compile to on x86?

**Answer.** `LOCK XADDQ` (Lock-prefixed Exchange-And-Add, 64-bit). One instruction. The implementation in `runtime/internal/atomic/asm_amd64.s`:

```asm
TEXT ·Xadd64(SB), NOSPLIT, $0-24
    MOVQ ptr+0(FP), BX
    MOVQ delta+8(FP), AX
    MOVQ AX, CX
    LOCK
    XADDQ AX, 0(BX)
    ADDQ  CX, AX
    ...
```

The `LOCK` prefix forces atomicity at the cache-coherence level. `XADD` reads `*BX`, adds `AX`, stores the sum back to `*BX`, and leaves the *old* value in `AX`. The `ADDQ CX, AX` step adds `delta` back to recover the new value (since `Add` returns the new total, not the previous).

In optimised builds, the Go compiler recognises `atomic.Int64.Add` as an intrinsic and emits the assembly directly inline — no function call overhead. The cost: ~3-5 ns uncontended.

---

### Q18. Why does ARM64 need a load-linked / store-conditional loop for CAS?

**Answer.** ARM has a weak memory model and uses an exclusive-monitor mechanism for atomicity rather than a bus lock. The pattern:

```asm
again:
    LDAXR (R0), R3       // load-acquire exclusive, arms monitor
    CMP R1, R3
    BNE fail
    STLXR R2, (R0), R4   // store-release exclusive, returns success in R4
    CBNZ R4, again       // retry on failure
```

`LDAXR` reads the location and marks the cache line as "exclusive monitor armed" for this CPU. `STLXR` stores only if the monitor is still armed (no other CPU wrote in the meantime).

The retry is necessary because:
- Another CPU may have written between the LDAXR and STLXR (legitimate failure — like a normal CAS failure).
- The OS kernel preempting the thread also clears the monitor (spurious failure).

ARMv8.1 added direct atomic instructions (`CAS`, `LDADD`, `SWP`) that do not need LL/SC. Go uses them when available (controlled by build flags). The performance becomes comparable to x86's single-instruction atomics.

---

### Q19. Explain the cost of sequential consistency on ARM vs x86.

**Answer.** On x86 (Total Store Order), sequential consistency requires almost no extra work:
- Atomic loads: same as `MOV`. (TSO already provides load ordering.)
- Atomic stores: `XCHG` (implicit lock prefix, acts as a full barrier).
- RMW: `LOCK`-prefixed instruction.

The only TSO reordering that matters is "store followed by later load to a different address" — which the LOCK prefix prevents for atomic ops.

On ARM64 (weak memory model), every atomic needs an explicit barrier:
- Load: `LDAR` (load-acquire) instead of `LDR`.
- Store: `STLR` (store-release) instead of `STR`.
- RMW: LL/SC with acquire/release semantics, or LSE atomic with implicit barriers.

The barriers cost a few cycles each. Sequential consistency requires both acquire and release on every op, which on ARM is roughly 2x the cost of a non-atomic access plus a barrier.

In absolute terms: ~3-5 ns on x86, ~5-10 ns on ARM. Both are negligible for application code; matters only at hundreds of millions of ops per second.

---

### Q20. How does the race detector know an atomic operation is "safe"?

**Answer.** The race detector is built on ThreadSanitizer. It instruments every memory access. For each access it records:

- Address.
- Read or write.
- Goroutine identity.
- Vector clock — the goroutine's view of all goroutines' progress.

When goroutine A does an atomic store, TSan records "this address's clock includes A's clock." When goroutine B does an atomic load and sees A's value, "B's clock now includes A's clock" (via the synchronised-before edge).

If B subsequently reads a non-atomic variable that A wrote before its atomic store, TSan sees that B's clock dominates A's write — happens-before is satisfied, no race reported. If B accesses something *neither* of them synchronised, vector clocks remain unordered, and TSan flags a race.

If you mix atomic and non-atomic access on the same address (e.g., `atomic.StoreInt64(&x, 1)` and `_ = x`), TSan considers the non-atomic access racy. The Go 1.19 typed API prevents this by hiding the underlying field.

---

### Q21. When would you opt out of `sync/atomic` in favour of `runtime/internal/atomic`?

**Answer.** Never, in normal application code. `runtime/internal/atomic` is internal to the standard library; importing it from user code requires `//go:linkname` hacks and is not API-compatible across Go versions.

In rare cases, runtime contributors or low-level library authors use it because:

- It has additional ops (`Cas64`, `Xadd8`, etc.) the public API does not expose.
- The compiler intrinsifies it more aggressively in runtime code.
- The runtime needs to call atomics from contexts where `sync/atomic` cannot run (signal handlers, before the GC is ready).

For all other purposes, `sync/atomic` is the right import.

---

### Q22. Show a minimal lock-free MPMC queue. What are the pitfalls?

**Answer.** The Michael-Scott queue is the textbook lock-free MPMC FIFO. Sketch:

```go
type node struct {
    value any
    next  atomic.Pointer[node]
}

type Queue struct {
    head atomic.Pointer[node] // dummy head
    tail atomic.Pointer[node]
}

func New() *Queue {
    n := &node{}
    q := &Queue{}
    q.head.Store(n)
    q.tail.Store(n)
    return q
}

func (q *Queue) Enqueue(v any) {
    n := &node{value: v}
    for {
        tail := q.tail.Load()
        next := tail.next.Load()
        if tail != q.tail.Load() {
            continue
        }
        if next == nil {
            if tail.next.CompareAndSwap(nil, n) {
                q.tail.CompareAndSwap(tail, n)
                return
            }
        } else {
            // help advance tail
            q.tail.CompareAndSwap(tail, next)
        }
    }
}

func (q *Queue) Dequeue() (any, bool) {
    for {
        head := q.head.Load()
        tail := q.tail.Load()
        next := head.next.Load()
        if head != q.head.Load() {
            continue
        }
        if head == tail {
            if next == nil {
                return nil, false
            }
            q.tail.CompareAndSwap(tail, next)
            continue
        }
        v := next.value
        if q.head.CompareAndSwap(head, next) {
            return v, true
        }
    }
}
```

Pitfalls:

1. **Dummy head node.** Required so head and tail never point at nil.
2. **Tail "helping."** Enqueuer that finds tail behind helps advance it before retrying.
3. **ABA.** With GC, mostly OK. With pooling, requires hazard pointers or generation counters.
4. **Memory ordering.** Go's seq-cst guarantees ordering for free; in C++ you must choose memory orders carefully.
5. **Performance.** Often slower than a buffered Go channel under realistic workloads. Channels are highly optimised in the runtime.

In Go, use a buffered channel unless profiling proves it inadequate.

---

### Q23. How would you implement a refcounted resource with safe Close?

**Answer.**

```go
type Resource struct {
    refs atomic.Int64
    closed atomic.Bool
    // ... underlying resource ...
}

func New() *Resource {
    r := &Resource{}
    r.refs.Store(1) // creator holds one ref
    return r
}

func (r *Resource) Acquire() bool {
    for {
        n := r.refs.Load()
        if n == 0 {
            return false // already closed
        }
        if r.refs.CompareAndSwap(n, n+1) {
            return true
        }
    }
}

func (r *Resource) Release() {
    if r.refs.Add(-1) == 0 {
        if r.closed.CompareAndSwap(false, true) {
            r.cleanup()
        }
    }
}
```

Discussion:

1. **`Acquire` uses CAS, not `Add(1)`,** to atomically check that the count is non-zero before incrementing. `Add(1)` would resurrect a count-zero (closing) resource.

2. **`Release` triggers cleanup at exactly zero,** using a separate `closed` flag with CAS to ensure cleanup happens exactly once even if the count somehow re-enters zero (should not happen with correct usage, but defensive).

3. **Caveats.** This pattern is delicate. In Go, the GC handles most resource lifetime needs. Use refcounting only when you need *deterministic* cleanup (file handle, GPU buffer, network connection) and the GC's eventual collection is not acceptable.

4. **Alternative.** A `sync.WaitGroup` plus a sentinel close, or a channel-based design where the owning goroutine closes after all readers ack. Often simpler than manual refcounting.

---

### Q24. A coworker writes `atomic.Pointer[Config]` for a hot-reload config and proudly tells you readers never block. They then add `cfg.Load().Endpoints = append(cfg.Load().Endpoints, "x")` in the reload handler. What is wrong?

**Answer.** Two bugs:

1. **Mutation after publication.** Once `Store` publishes the `*Config`, the struct it points to is shared with all live readers. Calling `append` (or any field write) is a data race. Active readers may see the half-mutated struct. The race detector flags it on the first concurrent test.

2. **Double `Load` is racy.** `cfg.Load().Endpoints = append(cfg.Load().Endpoints, "x")` calls `Load` twice. Between the two calls, another reload may have replaced the config. The append modifies one struct while assigning to a different one — possibly the wrong one — or to a struct that has just gone out of scope.

Correct pattern: copy-on-write.

```go
old := cfg.Load()
newCfg := *old
newCfg.Endpoints = append([]string(nil), old.Endpoints...)
newCfg.Endpoints = append(newCfg.Endpoints, "x")
cfg.Store(&newCfg)
```

Allocate a fresh struct, copy the slice (to avoid sharing the underlying array), modify the copy, publish atomically. Readers of the old config continue safely; new readers see the new config.

---

### Q25. Staff-level: when would Go's atomics not be the right primitive at all?

**Answer.** Several scenarios:

1. **Multi-variable transactional updates.** Use a mutex. Two atomics cannot be combined into one atomic.

2. **High-fanout signalling (1 producer, N consumers).** Use a channel or `sync.Cond`. Atomic is for state, not events.

3. **Throughput-bound counter at extreme rates.** A single atomic counter caps at the cache-line-bouncing rate (~50M-100M ops/sec). Beyond that, shard.

4. **Communicating data, not state.** Use channels. Atomic operates on a single word; data flow benefits from buffering, backpressure, and `select`.

5. **Cross-process / cross-machine synchronisation.** `sync/atomic` works within one Go process. For cross-process, use OS futexes (rare in Go), shared memory with platform atomics, or a coordination service.

6. **Rate limiting under heavy contention.** Token-bucket algorithms using atomic CAS work but starve. A leaky-bucket with channel-based ticking is fairer.

7. **Code that needs to be readable by non-experts.** A `sync.Mutex` around a struct field is universally understood. A CAS loop is not.

The signature question: "Is the synchronisation about a single primitive value, or about a piece of program logic?" Atomic excels at the former and fails at the latter.
