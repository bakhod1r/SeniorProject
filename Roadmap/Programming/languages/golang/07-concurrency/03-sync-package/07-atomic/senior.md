# sync/atomic — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Lock-Free Programming with Atomics](#lock-free-programming-with-atomics)
3. [The ABA Problem](#the-aba-problem)
4. [Refcounting and Use-After-Free](#refcounting-and-use-after-free)
5. [Hazard Pointers and Epoch-Based Reclamation](#hazard-pointers-and-epoch-based-reclamation)
6. [Lock-Free Stack and Queue](#lock-free-stack-and-queue)
7. [Per-CPU Counters and Sharding](#per-cpu-counters-and-sharding)
8. [Atomic with Interface Values](#atomic-with-interface-values)
9. [Double-Word CAS and Tagged Pointers](#double-word-cas-and-tagged-pointers)
10. [Spin-Lock Implementation](#spin-lock-implementation)
11. [Designing Your Own Concurrent Type](#designing-your-own-concurrent-type)
12. [Summary](#summary)

---

## Introduction

The senior level is where you build concurrent data structures from atomics rather than consuming them. You can read the source of `sync.Once`, `sync.Map`, and `runtime.mcache` and explain what each atomic op is doing. You know the ABA problem cold and can describe two ways to avoid it. You can spot a lock-free design that has a use-after-free bug masquerading as a race.

The material here is what you would defend on a staff-level interview or in a design review for a high-throughput service.

---

## Lock-Free Programming with Atomics

A data structure is **lock-free** if no thread can be permanently blocked by another thread's failure, suspension, or delay. The classic definition: in any execution, at least one thread makes progress in a bounded number of steps. (Wait-free is stronger: every thread makes progress.)

Lock-free does not mean "faster than locks." It means "robust against thread suspension." A thread suspended by the OS scheduler while holding a mutex blocks all waiters; a thread suspended in the middle of a CAS loop does not block anyone. For latency-sensitive systems (real-time, kernel code, signal handlers) this property is critical. For application code, lock-free is sometimes faster, often equivalent, and occasionally slower than a well-implemented mutex.

### The CAS loop, generalised

Almost every lock-free algorithm follows the same pattern:

```
1. Read the current state.
2. Compute a new state based on the read.
3. CAS the state from old to new.
4. If CAS fails, go to 1.
```

The correctness argument: when the CAS succeeds, no other thread changed the state between steps 1 and 3 (because the CAS validated the value). So the new state is a valid successor of the state we read.

The risk: if step 2 is expensive and contention is high, you burn CPU on retries. Most lock-free algorithms keep step 2 short.

### Memory ordering for lock-free in Go

Go atomics are sequentially consistent. This makes lock-free reasoning easier than in C++ — you do not have to choose between `relaxed`, `acquire`, `release`, `acq_rel`, `seq_cst`. Every atomic op is `seq_cst`.

The cost: Go does not let you elide barriers that other languages would. On ARM, this is a real performance cost. On x86, the difference is mostly noise. Pragmatically, write the algorithm cleanly and let the runtime do the right thing.

---

## The ABA Problem

**The ABA problem** is the classic lock-free bug. A thread reads value `A`, gets descheduled, and resumes later. In the meantime, another thread changed the value to `B` and back to `A`. The first thread's CAS succeeds — but the world it returns to is not the world it left.

### A concrete example: stack pop

```go
type Node struct {
    value int
    next  *Node
}

type Stack struct {
    head atomic.Pointer[Node]
}

// BUGGY pop — vulnerable to ABA
func (s *Stack) Pop() (int, bool) {
    for {
        top := s.head.Load()
        if top == nil {
            return 0, false
        }
        next := top.next
        if s.head.CompareAndSwap(top, next) {
            return top.value, true
        }
    }
}
```

Sounds correct. Read the head, set the head to `top.next`. Now imagine:

1. Thread T1 reads `head = A`, plans to CAS `head` from `A` to `A.next = B`.
2. T1 is descheduled.
3. T2 pops `A`, pops `B`, pushes a new node `C`, and somehow pushes the same pointer `A` back (perhaps `A` was freed and reallocated).
4. T2 leaves the stack as `head = A → C → ...` (where `A.next` is now `C`, not `B`).
5. T1 resumes. Its CAS sees `head == A` and succeeds, setting `head = B`. But `B` is no longer reachable. `C` is leaked or worse, freed.

The CAS validated the pointer but not the surrounding state. The ABA problem.

### Why Go is partially insulated

In Go, `A` cannot be "freed and reallocated as the same pointer" because the garbage collector keeps `A` alive as long as anything references it. T1's local `top` variable keeps `A` reachable, so `A` cannot be GC'd. T2 cannot recycle `A`'s address until T1 lets go.

This means the *classic* C-style ABA bug — pointer reuse after free — does not happen with plain Go pointers. The garbage collector solves it.

### Where ABA still bites in Go

1. **Object pools.** If you use `sync.Pool` or your own free list, you explicitly recycle objects. The GC does not protect you; you bypassed it.

```go
var pool = sync.Pool{New: func() any { return &Node{} }}
// Pop a node, return to pool, another goroutine pops it again — ABA possible.
```

2. **Integer indices.** If you use atomic integer indices (e.g., into an array) as your "pointer," there is no GC protection. An index can take value `5`, then `8`, then `5` again, fooling the CAS.

3. **Tagged pointers (when used).** A `uintptr` that encodes (index, generation) where the generation wraps around can hit ABA.

4. **Recycled structs with same content.** Even with GC, if you mutate a `Node` in place after pop and push, T1 may see "the same Node pointer with different next" — not classic ABA but a related freshness bug.

### Mitigations

1. **Use the GC.** In Go, prefer reachable pointers over indices. The GC is your hazard pointer.

2. **Generation counters.** Pair the pointer with a counter that increments on every modification. The CAS validates both.

```go
type Tagged struct {
    Ptr *Node
    Gen uint64
}
var head atomic.Pointer[Tagged]
```

The pair is two words; Go's `atomic.Pointer[T]` handles it as a single pointer (8 bytes). Each push creates a new `Tagged` with `Gen+1`. ABA would require the same `(Ptr, Gen)` pair to recur, which counters reaching 2^64 prevents in practice.

3. **Hazard pointers.** Each thread declares "I am currently reading pointer X." Reclamation defers freeing X until no thread declares it. Complex; covered below.

4. **Epoch-based reclamation.** Group threads into "epochs." A reclaimer waits until all threads have moved past the epoch in which the object was unlinked. Simpler than hazard pointers; less precise.

---

## Refcounting and Use-After-Free

A reference-counted shared object:

```go
type Buffer struct {
    refs atomic.Int64
    data []byte
}

func NewBuffer(data []byte) *Buffer {
    return &Buffer{refs: atomic.Int64{}, data: data}
    // refs starts at 0; caller adds 1 by convention, or the constructor does it
}

func (b *Buffer) Acquire() *Buffer {
    b.refs.Add(1)
    return b
}

func (b *Buffer) Release() {
    if b.refs.Add(-1) == 0 {
        b.free()
    }
}
```

This looks simple. It is also full of subtle bugs.

### Bug 1: Spurious resurrection

```go
// In some goroutine, the last reference is dropped:
b.Release() // refs goes 1 -> 0, calls free()
// Meanwhile, another goroutine has a "stale" pointer to b
other.Acquire() // refs goes 0 -> 1
// But b is already freed.
```

The `Acquire` after the final `Release` is a use-after-free. Refcounting requires the invariant: **a goroutine that holds a reference must already have incremented the count.** The first `Acquire` (which goes from 0 to 1) is dangerous because by then the object might be gone.

The standard fix is the "weak reference" / "borrowed reference" distinction. You only call `Acquire` on an object you got from a source that holds a reference (e.g., a global registry that itself holds a reference). The CAS-based check:

```go
func (b *Buffer) TryAcquire() bool {
    for {
        n := b.refs.Load()
        if n == 0 {
            return false // already in destruction
        }
        if b.refs.CompareAndSwap(n, n+1) {
            return true
        }
    }
}
```

`TryAcquire` returns false if the count is already zero. But this still races with `free()`. The fix is to either:

- Atomically transition from N to N+1, ensuring N > 0. (Above.)
- Use the GC. (Go's preferred mechanism.)

### Bug 2: Decrement order with destruction

```go
func (b *Buffer) Release() {
    if b.refs.Add(-1) == 0 {
        b.free()
    }
}
```

After `Add(-1)` returns 0, no other goroutine should have a reference. But what if another goroutine holds a *raw* pointer (not via `Acquire`)? It can call `Release` again, taking the count to -1, and the second goroutine never sees `0`. Or it can read `b.data` while `free()` is destroying it.

Refcounting requires discipline:
- Every pointer holder must have a corresponding refcount.
- The first refcount is granted at object creation.
- Pointers are passed by `Acquire`-ing or by transferring ownership.

This discipline is hard to enforce in Go. The GC enforces a similar discipline automatically. Most Go code should use the GC instead of manual refcounting unless there is a specific resource-management reason (file handles, GPU buffers, network connections to close exactly once).

### When refcounting in Go makes sense

- Wrapping a non-GC resource (file, socket, foreign-allocated memory). The refcount controls when to `Close`/`free`.
- Implementing copy-on-write semantics where the cost of copy is bounded by refcount.
- Building primitives like `sync.Pool` internals.

For most concurrent code, the GC is the right answer.

---

## Hazard Pointers and Epoch-Based Reclamation

These are advanced reclamation schemes for lock-free data structures that recycle memory. They are rarely needed in Go because the GC does the work, but worth understanding.

### Hazard pointers

Each thread has a small set of "hazard pointers" — slots that announce "I am currently reading object X." Before a thread dereferences a pointer it loaded from a shared structure, it writes the pointer into its hazard slot. After it is done, it clears the slot.

A reclaimer that wants to free `X` first scans all hazard slots. If any slot contains `X`, the reclaimer keeps `X` on a deferred-free list. Eventually all hazards clear and `X` can be freed.

This is precise: the reclaimer never frees something a thread is using. Cost: every dereference does an extra atomic store. Implementation: significant complexity. Use case: kernel data structures, embedded systems.

### Epoch-based reclamation

Threads enter and leave "epochs." A global epoch counter advances when all threads have observed the current epoch. Reclaimers defer freeing objects until two or three epoch advances have happened — by then no thread can still be in the epoch when the object was unlinked.

Cheaper than hazard pointers per access (no extra atomic store on every read). Less precise — objects sit on the deferred-free list longer.

### Why this matters for Go

When you implement a lock-free data structure in Go that uses object pooling (sync.Pool, free list), you are implicitly doing your own reclamation. The GC's stop-the-world (or its concurrent equivalent) provides epoch-like guarantees for tracing. But if you bypass the GC by recycling objects, you need to think about hazard pointers or epochs to avoid ABA / use-after-free.

The pragmatic Go answer: do not bypass the GC unless you have measured that the GC is the bottleneck. The GC handles reclamation correctly; you almost certainly will not.

---

## Lock-Free Stack and Queue

### Lock-free stack (Treiber stack)

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

In Go, because the GC keeps `top` alive while `Pop`'s local variable holds it, the classic ABA bug does not bite. But if you reuse `Node` structs via a pool, ABA returns.

Performance: under low contention, this stack is fast. Under high contention, the CAS retries dominate and a mutex-guarded slice is often faster. Benchmark before adopting.

### Lock-free queue (Michael-Scott)

The Michael-Scott queue is the standard textbook lock-free MPMC queue. Implementation in Go is non-trivial; it requires a dummy head node and CAS on both head and tail. Subtle issues:

- Tail can "lag" the actual end; a helping technique advances it.
- Reclamation requires hazard pointers or GC.
- In Go with GC, easier to use a channel.

For most Go use cases, a buffered channel is the right concurrent queue. The runtime's channel implementation is highly optimised. Build your own lock-free queue only when you have measured that channels are insufficient.

### When to choose a lock-free structure in Go

- **Channels are too slow for the workload.** Rare. Channels handle ~10M ops/sec.
- **You need to share with non-Go code.** Lock-free shared memory queues for IPC.
- **You need wait-freedom guarantees** that channels cannot provide.
- **The data structure does not fit channel semantics** (e.g., a multiset, a priority queue).

For 99% of Go concurrent code, the answer is `chan` or `sync.Mutex + slice/map`.

---

## Per-CPU Counters and Sharding

A counter incremented by many goroutines suffers from cache-line contention. Every `Add` requires the cache line to be exclusive to the current CPU. When 16 CPUs are all hammering one counter, the line bounces between caches and throughput collapses.

The fix is **sharding**: one counter per CPU (or per shard), incremented locally, summed on read.

```go
type ShardedCounter struct {
    shards [64]struct {
        v atomic.Int64
        _ [56]byte // padding to fill a cache line
    }
}

func (c *ShardedCounter) Add(n int64) {
    shard := goroutineShard() // hash of goroutine id mod 64
    c.shards[shard].v.Add(n)
}

func (c *ShardedCounter) Load() int64 {
    var total int64
    for i := range c.shards {
        total += c.shards[i].v.Load()
    }
    return total
}
```

Trade-off: `Add` is fast and contention-free; `Load` is now O(shards). For metrics counters incremented millions of times per second and read every few seconds, this is a great trade. For counters read every increment, sharding is the wrong choice.

### Cache-line padding

A modern x86 cache line is 64 bytes. If two atomic variables share a cache line, they suffer **false sharing** — even if they are touched by different goroutines, the line ping-pongs between caches. The `[56]byte` padding above ensures each shard sits alone on its line.

Go does not have a built-in `CacheLinePad`. The runtime uses unexported padding tricks. For user code, the explicit byte array works.

### Selecting the shard

`goroutineShard()` needs to map a goroutine to a shard. Naively, you could use the goroutine ID. Go does not expose goroutine IDs publicly. Alternatives:

- A CPU ID would be ideal but unavailable in Go (no `sched_getcpu` analogue exposed).
- Hash a per-goroutine variable. `runtime_procPin()` (unexported) can pin to a P.
- Round-robin via an atomic counter. Each goroutine atomically increments to claim a shard. This adds one atomic to setup, which is fine for long-lived goroutines.

In practice, libraries like `xsync` or `cmap` use unsafe tricks to read the current P's index. For an application metric counter, a simple `runtime.NumCPU()` shards with a hash of any per-goroutine value is enough.

### Production examples

- The runtime's `mstats` counters are sharded per-P.
- `expvar.Map` is not sharded; high-contention metrics need a different abstraction.
- Prometheus client libraries use sharded counters internally for high-throughput counters.

---

## Atomic with Interface Values

`atomic.Value` accepts any single concrete type. A common requirement: store one of several types behind an interface.

```go
type Event interface{ Kind() string }
type LoginEvent struct{ ... }
type LogoutEvent struct{ ... }

var current atomic.Value
current.Store(LoginEvent{})  // type fixed as LoginEvent
current.Store(LogoutEvent{}) // panic
```

Fix: store the interface explicitly, by wrapping in a struct or using a typed pointer.

### Wrapping in a struct

```go
type EventBox struct{ E Event }
var current atomic.Value
current.Store(EventBox{E: LoginEvent{}})  // type fixed as EventBox
current.Store(EventBox{E: LogoutEvent{}}) // OK — same type
```

The runtime sees the type as `EventBox`. The interface field inside is free to vary.

### `atomic.Pointer[T]` to interface

```go
var current atomic.Pointer[Event]
e := Event(LoginEvent{})
current.Store(&e)
```

Awkward — pointer to interface. Workable but unusual.

### Wrapping with a concrete struct holding an `any`

```go
type Wrapper struct{ V any }
var current atomic.Pointer[Wrapper]
current.Store(&Wrapper{V: LoginEvent{}})
current.Store(&Wrapper{V: LogoutEvent{}})
```

This is the most flexible option. The wrapper struct gives `atomic.Pointer[T]` a concrete type; the `any` field accepts anything.

### Interfaces and atomic safety

A Go interface value is two words (type pointer + data pointer). Writing to an interface is not atomic. Reading is not atomic. If two goroutines race on an interface assignment, the race detector flags it.

`atomic.Value` solves this by serialising stores through one atomic pointer to an internal struct. Reads load the pointer atomically and then dereference. The atomic-ness applies to the whole interface value because the value is hidden behind a pointer.

---

## Double-Word CAS and Tagged Pointers

Some lock-free algorithms need to CAS two words together — a pointer plus a counter or tag. x86 offers `CMPXCHG16B` for this; not all platforms do, and Go does not expose it.

### Workaround 1: Pack into a uintptr

If your pointer has spare bits (e.g., always 8-byte aligned, so the low 3 bits are zero), pack a small counter into them:

```go
type Tagged uintptr

func pack(ptr *Node, tag uint8) Tagged {
    return Tagged(uintptr(unsafe.Pointer(ptr)) | uintptr(tag))
}

func unpack(t Tagged) (*Node, uint8) {
    return (*Node)(unsafe.Pointer(uintptr(t) &^ 0x7)), uint8(uintptr(t) & 0x7)
}
```

`unsafe.Pointer` tricks; the Go GC may not handle this gracefully because the bit-packed pointer is no longer a valid Go pointer. Avoid unless absolutely necessary.

### Workaround 2: Allocate a Tagged struct

```go
type Tagged struct {
    Ptr *Node
    Tag uint64
}
var head atomic.Pointer[Tagged]
```

Each update allocates a new `Tagged`. The atomic op is on the `*Tagged`, which is one word. The GC keeps old `Tagged`s alive as long as anyone references them.

This adds allocation per update — fine for low-frequency updates, bad for hot paths. Object pooling reintroduces ABA risk.

### Workaround 3: 64-bit pointer + 64-bit counter via int64

If you can encode the pointer as a 32-bit index into an array (you control the array size) and the counter into the other 32 bits:

```go
type indexed atomic.Uint64

func pack(idx, gen uint32) uint64 { return uint64(gen)<<32 | uint64(idx) }
func unpack(v uint64) (idx, gen uint32) { return uint32(v), uint32(v >> 32) }
```

Used in some intrusive lock-free implementations. Limits address space; not generic.

In Go, the typical answer is "use the GC and avoid the need for tagged pointers." The cases where you really need double-word CAS are rare; mostly they involve interfacing with C or implementing something the standard library does not.

---

## Spin-Lock Implementation

You should almost never implement your own spin-lock in Go — `sync.Mutex` is fast and well-tested. But understanding the implementation deepens your model of atomics.

```go
type SpinLock struct {
    locked atomic.Int32
}

func (l *SpinLock) Lock() {
    for !l.locked.CompareAndSwap(0, 1) {
        runtime.Gosched() // yield to other goroutines
    }
}

func (l *SpinLock) Unlock() {
    l.locked.Store(0)
}
```

The CAS loop is the lock. `Gosched` prevents pure busy-wait. Problems:

- **No fairness.** A goroutine may starve while others keep grabbing the lock.
- **No parking.** If the lock is held for milliseconds, the spinning goroutine wastes CPU.
- **No interaction with the scheduler.** `sync.Mutex` integrates with the runtime to park on long waits.

Real-world spin-locks (e.g., in OS kernels) are used because the lock is held for nanoseconds and parking would be more expensive than spinning. In Go application code, this almost never applies.

### Why `sync.Mutex` wins

The Go `sync.Mutex` is implemented in `runtime/sema.go` and uses:
- A fast-path atomic CAS for uncontended acquisition.
- A slow-path that spins briefly (up to ~30 iterations) on multi-core machines.
- Parking via `semroot` (a hash table of futex-like wait queues) for long waits.
- Starvation protection: a waiter that has waited > 1 ms gets handoff priority.

Reimplementing this correctly is a nontrivial project. Stick with `sync.Mutex` unless you have a measured reason to deviate.

---

## Designing Your Own Concurrent Type

Pattern: a type that internally uses atomics to expose a thread-safe API.

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc()        { c.n.Add(1) }
func (c *Counter) Add(d int64) { c.n.Add(d) }
func (c *Counter) Value() int64 { return c.n.Load() }
func (c *Counter) Reset() int64 { return c.n.Swap(0) }
```

Rules:

1. **Encapsulate the atomic.** No exported atomic fields. The type exposes operations, not state.
2. **Choose meaningful method names.** `Inc` and `Add` are clear. `Add` returning the new value is convention.
3. **Methods take pointer receivers.** Atomics are not safe to copy.
4. **Document the synchronisation policy.** "All methods are safe for concurrent use" or similar.
5. **Pair with a `noCopy` if you have multiple atomic fields.** Catches accidental copies via `go vet`.

```go
type State struct {
    _ noCopy // see sync/atomic source
    running atomic.Bool
    count   atomic.Int64
}
```

The Go convention for `noCopy`:

```go
type noCopy struct{}
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```

`go vet` and `staticcheck` flag copies of structs containing `noCopy`. The atomic types include a `noCopy` already; using them as fields is enough for vet to flag copies of the outer struct.

### Avoid leaking atomics across API boundaries

```go
// BAD
func (c *Counter) Atomic() *atomic.Int64 { return &c.n }

// GOOD
func (c *Counter) Value() int64 { return c.n.Load() }
```

Exposing the underlying atomic lets callers bypass your invariants. Once you publish the pointer, you cannot change the internal representation without breaking them.

---

## Summary

Senior-level atomic mastery:

- **Lock-free patterns**: CAS loops, Treiber stack, Michael-Scott queue. Know when to use them and when channels are better.
- **ABA problem**: classical bug; mostly defused by Go's GC, returns when you pool or use integer tags.
- **Refcounting**: rarely the right answer in Go; the GC is. When required, watch for spurious resurrection and over-decrement.
- **Sharding for contention**: per-CPU counters with cache-line padding. The standard answer for hot metrics.
- **Atomic with interfaces**: wrap in a concrete struct or use `atomic.Pointer[Wrapper{V: any}]`.
- **Tagged pointers and double-word CAS**: rare; in Go the answer is usually to allocate fresh structs and rely on the GC.
- **Designing concurrent types**: encapsulate atomics, use pointer receivers, embed `noCopy`, document policy.

The professional level descends to the hardware: how atomics map to `LOCK CMPXCHG`, load-linked/store-conditional, cache coherence protocols (MESI), and the runtime's role in compiling Go atomic ops to platform instructions.
