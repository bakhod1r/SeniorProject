# Memory Fences — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing with Acquire / Release / Seq_cst](#designing-with-acquire--release--seq_cst)
3. [Mapping C++ `std::memory_order` to Go](#mapping-c-stdmemory_order-to-go)
4. [Java `volatile`, `VarHandle`, and Go](#java-volatile-varhandle-and-go)
5. [FFI Concerns — Crossing the Cgo Boundary](#ffi-concerns--crossing-the-cgo-boundary)
6. [Lock-Free Algorithm Correctness Proofs](#lock-free-algorithm-correctness-proofs)
7. [Where the Standard Library Hides Fences](#where-the-standard-library-hides-fences)
8. [Real-World Porting Stories](#real-world-porting-stories)
9. [When Sequential Consistency Is Too Strong](#when-sequential-consistency-is-too-strong)
10. [Self-Assessment Checklist](#self-assessment-checklist)
11. [Summary](#summary)

---

## Introduction
> Focus: "I am designing or porting a lock-free structure. How do I reason about the minimum ordering I need, and how does Go's choice of seq_cst affect performance?"

At senior level you stop using fences and start thinking in fences. The four orderings (relaxed, acquire, release, seq_cst) become tools you actively pick from when reading C++ or Rust code, even though when writing Go you can only spend the strongest. You start to design lock-free structures with explicit happens-before edges; you read papers like Michael & Scott's 1996 queue and understand what each barrier line is doing.

This file is for engineers who:

- Port lock-free code from C++ or Rust into Go.
- Build cross-language libraries that connect Go to C through Cgo.
- Read runtime source to understand performance characteristics.
- Diagnose subtle reordering bugs on ARM after a Linux server migration to Graviton or Ampere.

We assume mastery of `middle.md`. We will go deeper into the four orderings, look at C++ and Java equivalents, walk through Michael & Scott's queue with explicit ordering annotations, and end with real-world porting bugs.

---

## Designing with Acquire / Release / Seq_cst

When designing a lock-free structure, the question is *which* fence is needed at each step. In Go the answer is always "seq_cst — that is what you get." But to reason about correctness it helps to use the minimum-needed ordering as your design language, then ask "is Go's stronger choice an acceptable cost?"

### The mental procedure

Walk through the algorithm. At each atomic operation, ask:

1. **What state must be visible to others after this point?** That gives you a release requirement on a store.
2. **What state must I be sure I see after I cross this point?** That gives you an acquire requirement on a load.
3. **Does correctness depend on a total order across multiple variables?** If yes, you need seq_cst.

If the answer to (3) is no for any individual fence, that fence could be acquire or release in a language that lets you choose. In Go, the fence becomes seq_cst anyway. The exercise is still useful because it tells you whether moving to a hypothetical relaxed-ordering language would be safe.

### Example: a single-producer single-consumer ring buffer

A SPSC ring buffer is the simplest lock-free structure with non-trivial ordering. Its correctness depends on two atomic indices: a write index (touched only by the producer) and a read index (touched only by the consumer).

```go
type Ring[T any] struct {
    buf   []T
    write atomic.Uint64
    read  atomic.Uint64
}

func (r *Ring[T]) Push(v T) bool {
    w := r.write.Load()
    rd := r.read.Load() // acquire — see consumer's latest progress
    if w-rd >= uint64(len(r.buf)) {
        return false
    }
    r.buf[w%uint64(len(r.buf))] = v
    r.write.Store(w + 1) // release — publish the slot
    return true
}

func (r *Ring[T]) Pop() (T, bool) {
    rd := r.read.Load()
    w := r.write.Load() // acquire — see producer's latest progress
    var zero T
    if rd == w {
        return zero, false
    }
    v := r.buf[rd%uint64(len(r.buf))]
    r.read.Store(rd + 1) // release — free the slot
    return v, true
}
```

In a language with acquire/release, you would mark each atomic precisely:

- Producer's `Load(read)` is acquire — it must not move below the buffer write.
- Producer's `Store(write)` is release — it must not move above the buffer write.
- Consumer's `Load(write)` is acquire — it must not move below the buffer read.
- Consumer's `Store(read)` is release — it must not move above the buffer read.

Go's choice of seq_cst is strictly stronger than these. It pays for it on weak hardware: each `Load` on ARM is `LDAR` rather than the cheaper `LDR`; each `Store` is `STLR` rather than `STR`. The cost is measurable but typically small — a few extra cycles per operation. For most applications, accepting the extra cost is preferable to writing the algorithm in C.

### Example: where seq_cst earns its keep

Consider a "test-and-set spinlock" using a single bool. With release/acquire it is correct:

```
Lock:    while CAS(locked, false, true) fails: spin
Unlock:  store_release(locked, false)
```

The release on unlock pairs with the acquire CAS that succeeds at the next lock acquisition. Pure release/acquire is enough.

Consider a *fair* spinlock with two counters (ticket lock). It still only needs release/acquire because the ordering is between specific atomic variables.

Now consider a sequence-locked data structure with multiple unrelated atomic flags. If correctness requires "every thread sees the same global order of these flags," you need seq_cst. The most familiar example is the IRIW test from `middle.md`: with release/acquire on different variables, two observers can disagree about the order of two stores. Go's seq_cst forbids this.

In your own designs, ask: "does any correctness argument I make involve two different atomic variables on the writer side?" If yes, you need seq_cst. If you only ever order within one variable's history, release/acquire is enough — but Go gives you seq_cst regardless.

---

## Mapping C++ `std::memory_order` to Go

C++ exposes six memory orderings; Go offers one. The mapping when reading C++ code:

| C++ ordering | Go equivalent | Behaviour |
|---|---|---|
| `memory_order_relaxed` | No equivalent; closest is `sync/atomic` (which is seq_cst, stronger) | Atomic but no ordering. |
| `memory_order_consume` | No equivalent | Deprecated even in C++; treat as acquire. |
| `memory_order_acquire` | `Load`-side fence; provided by every `sync/atomic` load | One-way fence stopping later ops moving above. |
| `memory_order_release` | `Store`-side fence; provided by every `sync/atomic` store | One-way fence stopping earlier ops moving below. |
| `memory_order_acq_rel` | For RMW ops (CAS, Add); provided by every `sync/atomic` RMW | Combined acquire + release. |
| `memory_order_seq_cst` | What Go always uses | Full fence, global total order. |

When you port C++ code that uses `memory_order_relaxed` to Go, the literal translation is the strongest order — Go atomics. Two implications:

1. **Correctness is preserved.** Stronger orderings cannot make a program less correct in well-formed lock-free code.
2. **Performance may drop on weak hardware.** A relaxed counter increment becomes a fenced one. On x86 the cost is small; on ARM it can be visible.

If the original C++ code uses `memory_order_relaxed` for a statistics counter on a hot path and you measure 5–10% throughput drop after porting to Go on ARM, that's likely the cost of the implicit fence promotion. The fix in pure Go is to shard the counter so that contention dominates the fence cost only at sum-up time.

### Example port

C++:

```cpp
std::atomic<int> counter{0};
counter.fetch_add(1, std::memory_order_relaxed); // hot path
int snapshot = counter.load(std::memory_order_relaxed); // observability
```

Go equivalent:

```go
var counter atomic.Int64
counter.Add(1)
snapshot := counter.Load()
```

The Go version is correct and slightly more expensive. If the cost matters, shard the counter:

```go
var counters [128]struct {
    v atomic.Int64
    _ [56]byte
}

func incr() {
    counters[goroutineID()%128].v.Add(1)
}

func snapshot() int64 {
    var sum int64
    for i := range counters {
        sum += counters[i].v.Load()
    }
    return sum
}
```

Now each increment hits a different cache line and the fence cost is unloaded; the global counter is only summed when an observer wants it.

---

## Java `volatile`, `VarHandle`, and Go

Java's `volatile` keyword has a confusing history. In the original Java memory model it provided weak guarantees; since Java 5 (JSR-133) it became:

- Reads of a `volatile` field act as acquire loads.
- Writes of a `volatile` field act as release stores.

In other words, post-JSR-133 `volatile` in Java is roughly equivalent to a release/acquire pair in C++ — and that maps to Go's `sync/atomic` if you accept Go's promotion to seq_cst.

Java 9 added `VarHandle`, which gives explicit access to the four orderings:

- `getAcquire` / `setRelease`
- `getOpaque` / `setOpaque` (similar to relaxed)
- `getVolatile` / `setVolatile` (seq_cst)
- `getPlain` / `setPlain` (no ordering — equivalent to a regular field read in single-threaded code)

A Go `atomic.Int64.Load()` corresponds to `VarHandle.getVolatile` — full seq_cst. A Go `atomic.Int64.Store(v)` corresponds to `setVolatile`.

The takeaway: when porting Java code that uses `volatile` to Go, replace each `volatile` field with the matching `atomic.*` typed value. The semantics line up: Java's `volatile` is at most seq_cst, Go's atomic is exactly seq_cst, so behaviour is preserved.

C# is similar: the `volatile` keyword and `Volatile.Read`/`Volatile.Write` give release/acquire; `Interlocked.*` gives full barriers. Go's atomics correspond to the `Interlocked` family.

---

## FFI Concerns — Crossing the Cgo Boundary

When Go calls into C through Cgo, the C code may use `atomic_int` with relaxed semantics, may write to shared memory without any atomic, or may use compiler-specific intrinsics like `__sync_fetch_and_add`. The fence guarantees you have on the Go side do not automatically extend.

### The rules at the boundary

1. **A Cgo call is itself a function call boundary.** The Go compiler treats it as opaque — it cannot reorder Go memory operations across the Cgo call. That gives you a compile-time fence at the call site.
2. **The C code's memory model is C's, not Go's.** If C writes to a variable with `memory_order_relaxed`, a Go reader after the Cgo call cannot assume seq_cst ordering on that variable.
3. **Shared memory between Go and C is the responsibility of whoever writes the protocol.** If Go and C both write to the same `int*`, both sides must use compatible atomics.

### Practical recipe

When designing a Go/C shared structure:

- Use C11 `_Atomic` types with `memory_order_seq_cst` on the C side. They match Go's atomics one-to-one.
- Or use `__sync_*` legacy GCC builtins; they are seq_cst by default and were the only option before C11.
- Or use `__atomic_*` builtins (GCC 4.7+) with explicit `__ATOMIC_SEQ_CST`. Same semantics.

The reverse — Go writes a value, C reads it — also requires the C reader to use a fenced load. If C reads with a plain assignment, you have a race no matter what Go does.

### Reading C code at the boundary

When you find C code that does `__atomic_load_n(&flag, __ATOMIC_RELAXED)`, treat the Go side as if it had no acquire fence for that variable — Go cannot supply ordering the C side did not establish. If correctness on the Go side relies on synchronisation, either change the C ordering or add an explicit synchronising operation (e.g., a mutex around both languages' accesses).

This is one of the few places where the absence of explicit fences in Go works against you. There is no `atomic.Fence()` you can call after the Cgo return to force a synchronising barrier. The workaround is to do an unrelated atomic operation right after — for example, `atomic.LoadInt64(&someDummy)` — which acts as a full fence on the Go side. Document the trick if you use it; it is fragile.

---

## Lock-Free Algorithm Correctness Proofs

Let us walk through one classic algorithm — Michael & Scott's lock-free queue (1996) — and annotate each atomic operation with what fence Go provides and what fence the original C version expected.

### The algorithm

```go
type node struct {
    value int
    next  atomic.Pointer[node]
}

type Queue struct {
    head atomic.Pointer[node]
    tail atomic.Pointer[node]
}

func New() *Queue {
    sentinel := &node{}
    q := &Queue{}
    q.head.Store(sentinel)
    q.tail.Store(sentinel)
    return q
}

func (q *Queue) Enqueue(v int) {
    n := &node{value: v}
    for {
        tail := q.tail.Load()           // L1 — acquire
        next := tail.next.Load()        // L2 — acquire
        if tail != q.tail.Load() {      // L3 — consistency check
            continue
        }
        if next == nil {
            if tail.next.CompareAndSwap(nil, n) { // C1 — acq_rel CAS
                q.tail.CompareAndSwap(tail, n)    // C2 — acq_rel CAS (help)
                return
            }
        } else {
            q.tail.CompareAndSwap(tail, next)     // C3 — help advance
        }
    }
}

func (q *Queue) Dequeue() (int, bool) {
    for {
        head := q.head.Load()           // L4 — acquire
        tail := q.tail.Load()           // L5 — acquire
        next := head.next.Load()        // L6 — acquire
        if head != q.head.Load() {      // L7 — consistency check
            continue
        }
        if head == tail {
            if next == nil {
                return 0, false
            }
            q.tail.CompareAndSwap(tail, next) // help
        } else {
            v := next.value
            if q.head.CompareAndSwap(head, next) { // C4 — acq_rel CAS
                return v, true
            }
        }
    }
}
```

### Annotating the ordering needs

In the original Michael & Scott paper and in subsequent C++ implementations, the necessary orderings are:

- L1, L2, L4, L5, L6: acquire loads. They must not allow later operations to move above them — in particular, the dereferences of the loaded pointers must observe the writer's published state.
- C1 (the producer's CAS that links the new node): acquire/release CAS. The release publishes the node's fields; the acquire ensures the read of `tail.next` is consistent.
- C2, C3, C4: acquire/release CAS for the same reason.

In Go, every atomic is seq_cst, so every operation is strictly stronger than required. The algorithm is correct in Go without any modification. The performance cost relative to a hypothetical Go with release/acquire is small for this algorithm because the dominant cost is the CAS contention, not the fence semantics.

### What goes wrong without fences

If you implement the same algorithm but read `tail.next` non-atomically:

```go
for {
    tail := q.tail.Load()
    next := tail.next   // plain read — NO FENCE
    // ...
}
```

The compiler may hoist this read out of the loop. The CPU on ARM may serve a stale value from the local cache before the matching release from the producer is observed. The algorithm silently produces incorrect results. On x86 it may pass thousands of tests because of TSO; on ARM it will fail within seconds under load.

### Verifying with the race detector

Run the queue under `-race`. The race detector implements vector-clock happens-before tracking that mirrors Go's memory model. If any atomic call is missing or any field is read non-atomically, the detector will tag the operation with a clear stack trace. Make race-clean queues the gating criterion before any benchmarking.

---

## Where the Standard Library Hides Fences

Most Go programmers will never write an atomic directly. They use the higher-level primitives:

| Primitive | Underlying fence |
|---|---|
| `sync.Mutex.Lock` | CAS-acquire on the state word |
| `sync.Mutex.Unlock` | Atomic store-release on the state word; CAS only if waiters |
| `sync.RWMutex.RLock` | Atomic add on reader count + CAS |
| `sync.WaitGroup.Done` | Atomic add on counter; Wait blocks via semaphore |
| `sync.Once.Do` | Atomic load + double-checked CAS |
| `sync.Map.Load` | Atomic pointer load |
| `sync.Map.Store` | CAS on the entry pointer |
| `chan send` / `chan recv` | Internal lock + memory model edge |
| `context.Cancel` | Channel close + atomic state |

Reaching for any of these gives you correct ordering at no cognitive cost. The reason "use channels and mutexes" is the right Go advice for 95% of cases is that those primitives have correct fence usage baked in by experts.

When you do go below those primitives — usually because measurement shows a mutex is a bottleneck — be ready to spend twice the design effort. Lock-free code is roughly twice as hard to get right.

---

## Real-World Porting Stories

### Bug 1: Apache Kafka, Java to native

Kafka's storage engine relied on `volatile` writes that, in old JVMs, were not seq_cst. When the team explored porting parts to native code, an early Rust prototype with `Ordering::Relaxed` reproduced behaviour Kafka's Java had implicitly relied on. Fixing it required moving to `Ordering::SeqCst` for the relevant writes — a ~2% throughput drop in microbenchmarks that did not show up in end-to-end tests.

Lesson: when porting concurrent code across languages, the conservative default (seq_cst) is almost always right at first. Optimise weaker orderings only after the port is proved correct.

### Bug 2: Go on Graviton, missing atomic

A Go service that had been running fine on x86 EC2 instances was migrated to Graviton (Arm64). Within hours, a sporadic crash in a custom metrics cache appeared. Investigation found a struct field updated by one goroutine and read by another with plain field access — no atomic. On x86 TSO had hidden the bug for two years. On Graviton's weak model it surfaced.

The fix was a one-line change to wrap the field in `atomic.Pointer[Metric]`. The lesson is universal: x86 hides reordering bugs that ARM exposes. Run your tests on ARM if you ever plan to deploy there, and run them with `-race`.

### Bug 3: Cgo callback with relaxed atomic

A Go library wrapped a C SDK that wrote completion flags using `__atomic_store_n(..., __ATOMIC_RELAXED)`. The Go side observed the flag through `atomic.Bool.Load`. On x86 it worked. On ARM the Go side sometimes saw `true` for the flag but stale completion data.

The root cause was that the C side's relaxed store did not pair with any release fence. The Go side's `Load` is acquire, but acquire only pairs with release, not with relaxed. Fix: change the C side to `__ATOMIC_RELEASE` for the flag store. Two characters of C code change.

### Bug 4: Java to Go port

A team ported a stream-processing library from Java to Go. The original Java code had a "weakly volatile" field accessed via `getOpaque` (Java's relaxed-equivalent). The Go port used `atomic.Int64.Load`. The Go version was several percent slower on a tight inner loop because of the stronger fence.

The team accepted the loss as the cost of using a high-level language. The alternative — sharding the counter or going to unsafe pointer + assembly — was not worth the maintenance burden.

---

## When Sequential Consistency Is Too Strong

It is rare in production Go for seq_cst to be the actual performance bottleneck. The two cases where it is:

1. **A heavily contended counter on ARM.** The fence cost compounds with cache-line bouncing. Solution: shard the counter; aggregate on read.
2. **A lock-free queue with a deep call stack of atomic loads per operation.** Each load adds a fence; on ARM the cost may make a mutex-based queue competitive again. Solution: redesign to amortise atomic operations (batching, work-stealing) or accept the cost.

Outside of these, the cost of Go's seq_cst is a few cycles per atomic, which is invisible against the typical workload. The simplicity of "all atomics are seq_cst" pays for itself many times over in avoided bugs.

If you really, really need weaker ordering — for example, a high-frequency metrics increment where you do not care about cross-variable ordering — the escape hatch is to write the operation in assembly using `runtime/internal/atomic` patterns. This is a rabbit hole. Do not go there until profiling shows the fence is the bottleneck and a sharded counter cannot be made to work.

---

## Self-Assessment Checklist

- [ ] I can pick acquire/release/seq_cst for each operation in a lock-free design, even though Go will hand me seq_cst regardless.
- [ ] I can read C++ code with `std::memory_order_*` annotations and translate it to Go.
- [ ] I understand Java's `volatile` post-JSR-133 and its mapping to Go.
- [ ] I know how to design a Cgo boundary so that both sides agree on ordering.
- [ ] I can walk through Michael & Scott's queue and explain why each atomic is needed.
- [ ] I have a mental list of standard-library primitives and what fence each emits.
- [ ] I have at least one porting-bug story I can tell from memory.

---

## Summary

At senior level, fences become a design language. You read C++ code with `memory_order_acquire` annotations and translate them mentally to Go; you port Java code with `volatile` fields and reach for `atomic.*` types; you cross the Cgo boundary aware that Go's seq_cst stops at the function call. You can walk through Michael & Scott's queue and tag each atomic with the fence semantics the algorithm requires. You have collected — or will collect — porting bugs that arise when x86's TSO hid a reordering that ARM's weak model exposes. Most of the time, Go's choice of seq_cst for all atomics is exactly what you want: it is correct on every platform, the performance cost is small, and the time you save not designing per-fence ordering is reinvested in actually shipping software.
