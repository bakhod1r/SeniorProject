# sync.Pool — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The On-Disk Layout: `poolLocal` and `poolLocalInternal`](#the-on-disk-layout-poollocal-and-poollocalinternal)
3. [`poolDequeue` and `poolChain`: a Lock-Free MPSC Ring](#pooldequeue-and-poolchain-a-lock-free-mpsc-ring)
4. [`Pool.Get` Step by Step](#poolget-step-by-step)
5. [`Pool.Put` Step by Step](#poolput-step-by-step)
6. [Victim Cache Internals](#victim-cache-internals)
7. [Runtime Hooks: `poolCleanup` and the GC](#runtime-hooks-poolcleanup-and-the-gc)
8. [Memory Model and Happens-Before](#memory-model-and-happens-before)
9. [False Sharing, Padding, and Cache Lines](#false-sharing-padding-and-cache-lines)
10. [Profiling and Tracing at the Runtime Level](#profiling-and-tracing-at-the-runtime-level)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

At professional level we open `src/sync/pool.go` and `src/sync/poolqueue.go` and explain what is actually there. The aim is not to memorise the source, but to understand the data structures and invariants well enough to:

- Diagnose pool performance bugs that show up only at >10 M ops/sec.
- Predict pool behaviour under pathological scheduling (e.g. forced P migration).
- Reason about the memory model implications of pool operations relative to surrounding code.
- Read a profile, identify pool-related hot spots, and decide whether they are fixable.

This file references Go 1.21 internals. Names and details have shifted across versions; the structure has been stable since Go 1.13 (victim cache introduction).

---

## The On-Disk Layout: `poolLocal` and `poolLocalInternal`

`sync.Pool` holds two fields that point into a per-P array:

```go
type Pool struct {
    noCopy noCopy

    local     unsafe.Pointer // pointer to [P]poolLocal
    localSize uintptr        // number of Ps the array was sized for

    victim     unsafe.Pointer // victim cache, same shape as local
    victimSize uintptr

    New func() any
}
```

`local` is allocated lazily on the first `Get` or `Put`. Its size matches `runtime.GOMAXPROCS(0)`. If `GOMAXPROCS` changes, the next pool operation may re-allocate.

Each per-P element:

```go
type poolLocal struct {
    poolLocalInternal
    pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}

type poolLocalInternal struct {
    private any         // can be used only by the P that owns it
    shared  poolChain   // local P can push/pop both ends; foreign Ps can pop tail
}
```

Two zones:

- **`private`**: a single object accessible only by the P that owns the `poolLocal`. The fast slot.
- **`shared`**: a `poolChain` of objects accessible to the local P (both head and tail) and foreign Ps (tail only, for stealing).

The `pad [...]byte` field pads each `poolLocal` to a cache-line boundary. This prevents **false sharing** — two Ps' pool slots accidentally sitting on the same cache line and forcing cache-coherence traffic on every store.

---

## `poolDequeue` and `poolChain`: a Lock-Free MPSC Ring

The `shared` field is a `poolChain`, which is a doubly-linked list of `poolDequeue` nodes. Each `poolDequeue` is a fixed-size circular buffer using atomic indices.

```go
type poolDequeue struct {
    headTail atomic.Uint64 // packed (head, tail) indices
    vals     []eface
}
```

`headTail` is a single 64-bit word holding two 32-bit indices. This packing is essential: head/tail must be modified atomically together to maintain consistency.

### Operations

- `pushHead(v)`: only the owner P calls this. Increments head. No CAS needed — single writer to head.
- `popHead()`: only the owner P calls this. Decrements head. Used by the owner in LIFO order.
- `popTail()`: any P may call. CAS on the tail half of `headTail`. Used for stealing.

### Why two-ended?

- The owner P pushes and pops the head — LIFO for cache locality. The most recently pushed object is likely still in the L1 cache.
- Foreign Ps pop the tail — FIFO from the steal point of view. Steals get the oldest items, less likely to be hot in any P's cache.

### Growing the chain

When a `poolDequeue` fills up, the owner allocates a new, larger one and links it as a new head of the `poolChain`. The old dequeue stays in the chain; foreign Ps continue to drain it via the tail. Eventually the old dequeue empties and is dropped from the chain.

This design avoids reallocating items as the pool grows; it just adds capacity.

---

## `Pool.Get` Step by Step

```go
func (p *Pool) Get() any {
    if race.Enabled { /* race instrumentation */ }
    l, pid := p.pin()             // pins to current P, returns *poolLocal + P id
    x := l.private
    l.private = nil
    if x == nil {
        x, _ = l.shared.popHead()
        if x == nil {
            x = p.getSlow(pid)
        }
    }
    runtime_procUnpin()
    if x == nil && p.New != nil {
        x = p.New()
    }
    return x
}
```

Step by step:

1. **`p.pin()`**: prevents the goroutine from migrating between Ps for the duration of the operation. Returns the local `poolLocal` for the current P.
2. **`l.private`**: take the private slot. If non-nil, we are done — fast path, ~5 ns.
3. **`l.shared.popHead()`**: same P's shared queue, LIFO. Still lock-free.
4. **`p.getSlow(pid)`**: try to steal from other Ps' shared queues (via `popTail`), then from the victim cache.
5. **Unpin** — the goroutine can migrate again.
6. **`p.New()`**: last resort. Runs in the calling goroutine, no pin.

### Why unpin before `New`?

`New` may do significant work (allocate, format, even block). Keeping the P pinned would prevent other goroutines on this P from running. So the pool unpins first, then calls `New`.

### `getSlow` in detail

```go
func (p *Pool) getSlow(pid int) any {
    size := runtime_LoadAcquintptr(&p.localSize)
    locals := p.local
    // Try to steal one item from any other P's shared queue.
    for i := 0; i < int(size); i++ {
        l := indexLocal(locals, (pid+i+1) % int(size))
        if x, _ := l.shared.popTail(); x != nil {
            return x
        }
    }
    // Then try the victim cache.
    size = atomic.LoadUintptr(&p.victimSize)
    if uintptr(pid) >= size {
        return nil
    }
    locals = p.victim
    l := indexLocal(locals, pid)
    if x := l.private; x != nil {
        l.private = nil
        return x
    }
    for i := 0; i < int(size); i++ {
        l := indexLocal(locals, (pid+i) % int(size))
        if x, _ := l.shared.popTail(); x != nil {
            return x
        }
    }
    // Mark victim as empty so future calls skip it.
    atomic.StoreUintptr(&p.victimSize, 0)
    return nil
}
```

Two passes: first the live pool, then the victim. The victim is consulted only after the live pool is fully drained. After the victim is also empty, it is marked empty so subsequent calls skip the work.

---

## `Pool.Put` Step by Step

```go
func (p *Pool) Put(x any) {
    if x == nil { return }
    if race.Enabled { /* race instrumentation */ }
    l, _ := p.pin()
    if l.private == nil {
        l.private = x
    } else {
        l.shared.pushHead(x)
    }
    runtime_procUnpin()
}
```

Three lines of substance:

1. **Pin** to current P.
2. **If the private slot is empty**, store there. The next `Get` on this P will take it. Fastest case.
3. **Else** push to the shared queue's head.

There is no eviction or sizing — `Put` always succeeds (the shared queue grows as needed). The pool's only size feedback is GC.

### Why no contention on `Put`?

Both private and shared-head are P-local; only the owning P writes. No CAS, no atomics on the fast path. This is why `sync.Pool` can absorb 100 M `Put`/sec on a multi-core machine.

---

## Victim Cache Internals

`victim` and `victimSize` mirror `local` and `localSize`. The shift happens in `poolCleanup`:

```go
func poolCleanup() {
    // Called during STW phase of GC.
    for _, p := range allPools {
        p.victim = p.local
        p.victimSize = p.localSize
        p.local = nil
        p.localSize = 0
    }
    oldPools, allPools = allPools, nil
}
```

`allPools` is a runtime-wide registry of every `sync.Pool` instance that has had at least one `Put` since the last cleanup. The cleanup walks all of them, shifts main → victim, and clears main.

The next GC's cleanup will overwrite victim with whatever has accumulated in main since then. So:

```
state          live              victim
after GC 1     empty             previous live
populate ...   N items           previous live
after GC 2     empty             N items (was live)
populate ...   M items           N items
after GC 3     empty             M items (N items dropped)
```

Each item lives at most one GC cycle in victim before being dropped (i.e., across one full GC). Items in live get one GC of grace by being shifted to victim.

### Why two tiers?

A single-tier design would lose every item on every GC. Workloads that allocate just before GC and then need objects just after GC would see 100% miss rate. The victim cache catches those.

A three-tier design would hold more memory across more GCs and offer diminishing returns. Two tiers is the empirically-tuned sweet spot.

---

## Runtime Hooks: `poolCleanup` and the GC

`poolCleanup` is registered via `runtime_registerPoolCleanup`:

```go
// In sync/pool.go's init:
runtime_registerPoolCleanup(poolCleanup)
```

The runtime calls `poolCleanup` during GC's STW phase, before mark begins. STW is held for the duration; pool operations are blocked. In modern Go, STW pauses are microseconds; pool cleanup is a small part.

### Implications for STW

- Adding more pools does not significantly extend STW. Cleanup iterates over `allPools` and zeros pointers — a tight loop.
- A pool with millions of items in its shared queues does not slow cleanup. The cleanup just changes pointers; items are reclaimed by the sweeper in parallel.
- The cost of pool cleanup grows linearly with the number of pools, not items. Hundreds of pools per process is fine; tens of thousands might add measurable STW.

### Why is `poolCleanup` not called more aggressively?

The pool could in principle shed items on memory pressure (e.g., when the OS reports low memory). The Go team has discussed this; the design choice is to keep the pool's behaviour predictable and tied to a single signal (GC).

---

## Memory Model and Happens-Before

The Go memory model says that `Put(x)` and the subsequent `Get` that returns `x` synchronise — writes to `x` before `Put` happen before reads after `Get`. This is exactly what you would expect, and is necessary for `sync.Pool` to be useful.

### What synchronises with what?

- `pushHead` (the `Put` write) releases.
- `popHead`, `popTail` (the `Get` read) acquires.
- The atomic update to `headTail` carries the synchronisation.

You can rely on:

```go
buf.WriteString("hello")
bufPool.Put(buf)
// ---- happens-before ----
buf2 := bufPool.Get().(*bytes.Buffer)
// buf2 might be buf; if so, "hello" is observable
```

If `Get` returns the same buffer, writes done before `Put` are visible. If `Get` returns a different buffer or calls `New`, no synchronisation is established with the original writes — but you should not be reading the old buffer anyway.

### What does *not* synchronise

The memory model does *not* guarantee:

- Order of `Put`s by different goroutines.
- Visibility of a `Put` to the very next `Get` if they cross Ps.

Do not use `sync.Pool` as a communication primitive. It is for object reuse only.

---

## False Sharing, Padding, and Cache Lines

Modern CPUs serve memory in cache lines (typically 64 bytes; some are 128). If two pieces of data on different threads share a cache line, every write by one thread invalidates the other's view, causing cache-coherence traffic. This is **false sharing**.

`sync.Pool` mitigates this with explicit padding:

```go
type poolLocal struct {
    poolLocalInternal
    pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}
```

Each `poolLocal` is sized to a multiple of 128 bytes — twice the typical cache line, to be safe against ARM and some Intel CPUs with 128-byte coherence units. P0's `poolLocal` and P1's `poolLocal` therefore sit on separate cache lines and do not interfere.

This padding is invisible to users but is the reason `sync.Pool` scales linearly to dozens of cores. Without it, contention would be severe.

### When false sharing still matters

If you build a custom pool with sharded slots, you need the same padding. A naive `[]shard` array where each `shard` is < 64 bytes will suffer false sharing. Always pad.

---

## Profiling and Tracing at the Runtime Level

### `go test -run none -bench Benchmark -benchmem -cpuprofile cpu.prof`

The CPU profile shows time inside `sync.(*Pool).Get`, `Put`, and `getSlow`. Hot pools typically show:

- `Pool.Get`: ~5-20 ns inclusive.
- `Pool.Put`: ~3-15 ns inclusive.
- `Pool.getSlow`: visible only if cache misses are common, indicating low hit rate.

If `getSlow` is hot, your pool is failing to retain items between `Get`s — either GC fires too often (lower `GOGC`?) or `Put` rate is lower than `Get` rate. Investigate.

### `runtime/trace` (`go test -trace trace.out`)

The trace shows STW pauses, including the time spent in `poolCleanup`. For a service with 50 pools, `poolCleanup` typically takes < 10 us. If you see longer pauses, count your pools.

### Allocator profile (`-memprofile`)

Look at allocations attributed to `Pool.Get`. Two patterns:

- Allocations inside `New`: the pool is missing.
- Allocations *after* `Get`: the pooled object is escaping (e.g., your `Reset` is incomplete, or you are returning a slice that aliases the pool).

### `runtime.MemStats` over time

Watch `HeapAlloc`, `NumGC`, and `PauseTotalNs`. A working pool should reduce all three relative to a no-pool baseline.

---

## Self-Assessment

- [ ] I can sketch `poolLocal` and `poolDequeue` from memory.
- [ ] I can explain why the private slot exists separate from the shared queue.
- [ ] I can describe the LIFO/FIFO asymmetry between local pops and foreign pops.
- [ ] I know that `poolCleanup` runs during STW and is registered via `runtime_registerPoolCleanup`.
- [ ] I can explain the role of cache-line padding in `poolLocal`.
- [ ] I can read a CPU profile and identify whether `getSlow` is a hot spot.
- [ ] I can describe the happens-before relationship between a `Put` and a subsequent `Get` of the same object.

---

## Summary

`sync.Pool`'s machinery is precise: a per-P `poolLocal` with a private slot for the fastest case, a `poolChain` of `poolDequeue` nodes for the shared case, atomic `headTail` updates for lock-free coordination, and cache-line padding to prevent false sharing. `Get` tries private → shared head → other Ps' shared tails → victim cache → `New`, in that order. `Put` is pinless after the initial pin and never blocks. Cleanup runs once per GC during STW: live becomes victim, victim is dropped.

This design hits the sweet spot for the workload it targets: anonymous, interchangeable, temporary objects with high `Put`/`Get` rates from many cores. It does not size, evict on demand, or expose metrics — those concerns deliberately live in user code or wrappers.

Knowing the internals does not change how you use `sync.Pool` 99% of the time. It changes what you do when the profile points to it, when contention shows up at 100 cores, when GC pauses unexpectedly include pool cleanup time, and when you need to argue for or against pooling a particular type. That is what professional means.
