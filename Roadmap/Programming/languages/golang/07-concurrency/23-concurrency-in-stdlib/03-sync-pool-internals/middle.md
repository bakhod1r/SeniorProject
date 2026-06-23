---
layout: default
title: sync.Pool Internals — Middle
parent: sync.Pool Internals
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/03-sync-pool-internals/middle/
---

# sync.Pool Internals — Middle

[← Back](../)

This page is a guided tour of the standard library source files `src/sync/pool.go` and `src/sync/poolqueue.go`. The intended reader is an intermediate Go developer who has used `sync.Pool` from the outside, who has read the package docs once, and who now wants to see exactly how the per-P design, the work-stealing ring buffer, and the two-generation garbage collection interaction are implemented. Every claim that touches a specific data structure or algorithmic decision is anchored to a line range in the upstream source. Line numbers refer to the Go 1.22 / 1.23 series; if you check out a different tag you will see drift of a few lines but the structure has been stable since Go 1.13 when the victim cache was added.

We will not paraphrase the file. We will read it. Each section quotes the relevant Go source verbatim, then explains the mechanics, the invariants, the synchronization model, and the failure modes that the code is defending against. By the end you should be able to predict, for any given Get and Put pair, exactly which CPU cache line is touched, which atomic instructions are issued, and which goroutine can race with which.

## 1. The Pool struct

Open `src/sync/pool.go`. The package comment runs from line 1 through line 48 and is worth reading once because it pre-commits to a contract that the rest of the file then enforces: a Pool is a set of temporary objects that may be removed automatically at any time without notification; it is safe for use by multiple goroutines simultaneously; and an appropriate use of Pool is to manage a group of temporary items silently shared among and potentially reused by concurrent independent clients of a package. That last clause is what justifies the design we are about to read.

The Pool struct itself begins at line 50:

```go
// A Pool must not be copied after first use.
type Pool struct {
    noCopy noCopy

    local     unsafe.Pointer // local fixed-size per-P pool, actual type is [P]poolLocal
    localSize uintptr        // size of the local array

    victim     unsafe.Pointer // local from previous cycle
    victimSize uintptr        // size of victims array

    // New optionally specifies a function to generate
    // a value when Get would otherwise return nil.
    // It may not be changed concurrently with calls to Get.
    New func() any
}
```

There are five things to notice in this twelve-line declaration.

First, `noCopy` is a zero-sized field that the `go vet` shadow type checker reads. It does not cost a byte at runtime, but it makes the type ineligible for safe copying because `vet` will report any assignment of a Pool value. The implementation of `noCopy` lives in `src/sync/cond.go` around line 113 as the empty struct with a `Lock()` / `Unlock()` method pair that exists only so the copylocks vet pass treats it as a mutex-like object that must not be duplicated. Copying a Pool would be catastrophic: both copies would point at the same per-P array, but each copy's lifecycle (registration into the global allPools list, cleanup callbacks) would diverge. We will see why later when we examine `pinSlow`.

Second, `local` is `unsafe.Pointer` rather than `*[runtime.GOMAXPROCS()]poolLocal`. The Pool cannot know at struct-declaration time how many logical processors the runtime will use. Rather than carry a Go slice header (which would put a length and capacity on a per-P critical path that all goroutines hit), the implementation stores a raw pointer and a separate length. The pointer is loaded with `atomic.LoadPointer` and reinterpreted as `*poolLocal` plus integer offset arithmetic; the length is loaded with `atomic.LoadUintptr`.

Third, `victim` and `victimSize` shadow `local` and `localSize`. After a GC cycle, the runtime moves the contents of `local` into `victim` and clears `local`. A subsequent Get will, on a miss in `local`, also consult `victim`. We expand on this in section 10. Storing the victim slice as a separate pointer rather than tagging entries in `local` is what lets the cleanup operation be a single pointer swap rather than a per-entry walk.

Fourth, the `New` function is declared `func() any`. Until Go 1.18 the signature was `func() interface{}`. The change is purely cosmetic because `any` is an alias for `interface{}`. The comment "may not be changed concurrently with calls to Get" is enforced by convention only; there is no internal lock guarding the field. The expected usage is to set `New` once when the package is initialized and then never write to it.

Fifth, there is no Len, no Cap, no Reset, no Drain method. The published surface of `sync.Pool` is three operations: Get, Put, and `New` assignment. Everything else, including the entire two-generation cache, is internal.

## 2. Cache-line padding via poolLocal

The next type declaration, at line 64, is one of the most-cited examples of cache-aware data layout in the Go runtime:

```go
// Local per-P Pool appendix.
type poolLocalInternal struct {
    private any       // Can be used only by the respective P.
    shared  poolChain // Local P can pushHead/popHead; any P can popTail.
}

type poolLocal struct {
    poolLocalInternal

    // Prevents false sharing on widespread platforms with
    // 128 mod (cache line size) == 0 .
    pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}
```

The `poolLocalInternal` struct holds the per-P state: a single `private` slot that only the owning P may touch, and a `shared` poolChain that the owning P pushes onto the head of and that any P may steal from the tail of. We treat `poolChain` as opaque until section 11.

The outer `poolLocal` adds a padding field computed at compile time. The expression `128 - unsafe.Sizeof(poolLocalInternal{})%128` evaluates to whatever number of bytes is needed to round the struct size up to a multiple of 128. On a 64-bit platform, `poolLocalInternal` is one `iface` (16 bytes) plus a `poolChain` (two pointers, 16 bytes), giving 32 bytes. So `pad` is `[128 - 32]byte = [96]byte`, and `poolLocal` is 128 bytes total.

Why 128 and not 64? Most x86 CPUs have a 64-byte cache line. But Intel's adjacent-line prefetcher fetches the sibling line as well, effectively giving you 128-byte tracking granularity for false-sharing purposes. ARM64 chips with 128-byte cache lines (such as Apple M-series cores) exist and are increasingly important. Padding to 128 covers both. The comment at line 75, "Prevents false sharing on widespread platforms with 128 mod (cache line size) == 0", is technically the strongest statement the runtime can make: any cache-line size that divides 128 (so 32, 64, or 128) will see no false sharing between adjacent `poolLocal` entries.

False sharing here would mean: P0 writes to its `poolLocal[0].private` while P1 reads `poolLocal[1].private`. If both fall in the same cache line, the line ping-pongs between cores even though no actual data is shared. With the 128-byte stride, each `poolLocal` lives in its own pair of cache lines.

The padding is paid once per logical processor. With GOMAXPROCS = 64 you spend 64 × 128 = 8 KiB of memory on these poolLocals per pool, of which 64 × 96 = 6 KiB is pure padding. That is the price of contention-free access for the hot path.

## 3. poolLocalInternal in detail

We already saw the declaration. Two fields, in this order:

```go
type poolLocalInternal struct {
    private any
    shared  poolChain
}
```

The order matters for cache-line packing only insofar as `private` is the first 16 bytes and `shared` is the next 16 bytes. Because both Get and Put first try `private`, the hot path touches the first half of the struct, which is the first half of the first cache line.

The `private` slot has type `any`, which is a two-word iface: a type pointer and a data pointer. Stores to `private` are not atomic; they cannot be, because writing a two-word value cannot be done atomically on any common architecture without resorting to a lock cmpxchg16b or a per-cache-line lock. But the field is safe to access non-atomically because the implementation guarantees that only the pinned P touches it. Pinning means goroutine preemption is disabled, so the scheduler will not migrate the current goroutine to another P while it holds the pointer to `private`. See section 7 for how `pin` enforces this.

The `shared` poolChain, in contrast, is a multi-producer-feel data structure even though it is in fact single-producer multi-consumer. The owning P pushes and pops the head; other Ps may only pop the tail. Push-head and pop-head do not need atomic operations against pop-tail in the common case, but they do need them in the edge case where head meets tail. Section 12 expands on this.

## 4. Pool.Get — the hot path

Get is defined starting at line 128:

```go
// Get selects an arbitrary item from the Pool, removes it from the
// Pool, and returns it to the caller.
// Get may choose to ignore the pool and treat it as empty.
// Callers should not assume any relation between values passed to Put and
// the values returned by Get.
//
// If Get would otherwise return nil and p.New is non-nil, Get returns
// the result of calling p.New.
func (p *Pool) Get() any {
    if race.Enabled {
        race.Disable()
    }
    l, pid := p.pin()
    x := l.private
    l.private = nil
    if x == nil {
        // Try to pop the head of the local shard. We prefer
        // the head over the tail for temporal locality of
        // reuse.
        x, _ = l.shared.popHead()
        if x == nil {
            x = p.getSlow(pid)
        }
    }
    runtime_procUnpin()
    if race.Enabled {
        race.Enable()
        if x != nil {
            race.Acquire(poolRaceAddr(x))
        }
    }
    if x == nil && p.New != nil {
        x = p.New()
    }
    return x
}
```

Read this method top to bottom. The branches on `race.Enabled` are eliminated by the compiler in non-race builds, so on a production binary the body is exactly:

1. Call `p.pin()`, which returns the `*poolLocal` for the current P plus the integer P id.
2. Read `l.private`, then set `l.private = nil`. If the read returned a non-nil interface, we are done with the fast path; we will return that value.
3. If `private` was empty, call `l.shared.popHead()`. The comment is explicit: "We prefer the head over the tail for temporal locality of reuse." If you just pushed an object on this P, that object is at the head; we want to give it back to you because it is the most likely to still be in your L1 or L2 cache.
4. If the head was empty too, call `p.getSlow(pid)`, which we read in section 5.
5. Call `runtime_procUnpin()`, which is the inverse of `pin`. The goroutine is now preemptible again.
6. If we still have nothing, call `p.New()` if it is non-nil. Otherwise return nil.

The race.Acquire / race.Disable bracket is there because the race detector tracks happens-before edges through the pool; the goroutine that did Put has to be paired with the goroutine that does Get. The pool itself does not implement a memory barrier per pair (the atomic CAS on headTail handles that), but the race detector needs an explicit hook because it cannot see the per-P arithmetic.

There is one subtle invariant in step 2: after reading `l.private`, the code immediately stores nil. Why? Because if Get returns the value to the caller and the caller does not call Put again before the next Get on this P, a subsequent Get would otherwise return the same pointer. Storing nil makes the slot reusable for the next Put.

The fast path, in the common case where `private` is non-nil, is three reads, one write, one function call (`pin` and its inverse), and one return. There are no atomic operations on this path. There are no locks. There is no allocation. If the value was just freshly Put on the same P, the cache lines are still in this core's L1.

## 5. Pool.getSlow — the steal path

When the local shard is empty, Get calls into a slow path at line 174:

```go
func (p *Pool) getSlow(pid int) any {
    // See the comment in pin regarding ordering of the loads.
    size := runtime_LoadAcquintptr(&p.localSize) // load-acquire
    locals := p.local                            // load-consume
    // Try to steal one element from other procs.
    for i := 0; i < int(size); i++ {
        l := indexLocal(locals, (pid+i+1)%int(size))
        if x, _ := l.shared.popTail(); x != nil {
            return x
        }
    }

    // Try the victim cache. We do this after attempting to steal
    // from all primary caches because we want objects in the
    // victim cache to age out if at all possible.
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
        l := indexLocal(locals, (pid+i)%int(size))
        if x, _ := l.shared.popTail(); x != nil {
            return x
        }
    }

    // Mark the victim cache as empty for future gets don't bother
    // with it.
    atomic.StoreUintptr(&p.victimSize, 0)

    return nil
}
```

This function is the heart of the work-stealing design. Read it as four nested attempts:

**Attempt 1: Steal from another P's main shard.** The loop iterates `size` times starting at `(pid+1)%size`, so it visits every other P in a rotation that begins immediately after the caller's own slot. For each victim P, it calls `popTail` on that P's `shared` poolChain. Note: `popTail`, not `popHead`. The owning P pushes to and pops from the head, so taking from the tail minimizes contention with the owner. CAS contention will only happen when the chain is small enough that head and tail are adjacent.

The loop iterates `(pid+i+1)%int(size)` rather than `(pid+i)%int(size)` so it does not revisit the current P's own shard. We just tried that in Get; visiting it again would be wasted work.

**Attempt 2: Read the victim's private slot.** The victim cache mirrors the layout of the main cache. The same P id maps to the same victim slot, so `indexLocal(locals, pid)` retrieves the previous cycle's `private` value. If it is non-nil, take it and zero the slot.

**Attempt 3: Steal from another P's victim shard.** Same loop as Attempt 1 but against the `victim` array. Note that this loop uses `(pid+i)%int(size)`, not `(pid+i+1)%int(size)` — there is no concern about double-visiting because we already extracted `private` in Attempt 2 explicitly.

**Final action: Mark victim as empty.** If we walked the entire victim array and found nothing, we write zero to `victimSize`. The next caller will short-circuit at the `if uintptr(pid) >= size { return nil }` check and skip the victim cache entirely. This is the "drain over two GCs" mechanism: once the victim cache produces zero hits, it is closed out, and the next GC cycle will refresh it from the new main cache contents.

The function uses `runtime_LoadAcquintptr` for `localSize` and a plain load for `local`. Why? Because `localSize` is the resize gate: if a goroutine sees a new `localSize` it must also see the new `local` array that goes with it. Using load-acquire for the size and a plain load for the pointer reads them in an order that respects the publication. The `pinSlow` writer side uses store-release for the pointer first, then a plain (or release) store for the size — see section 8.

The `indexLocal` helper at line 244 is straightforward pointer arithmetic:

```go
func indexLocal(l unsafe.Pointer, i int) *poolLocal {
    lp := unsafe.Pointer(uintptr(l) + uintptr(i)*unsafe.Sizeof(poolLocal{}))
    return (*poolLocal)(lp)
}
```

It treats `l` as the base of a `[size]poolLocal` array, adds `i * sizeof(poolLocal)` bytes, and reinterprets the result. There is no bounds check; the caller guarantees `i < size`. This is the kind of code that you would never write in user-space Go, but in the runtime it is the right tool because the layout is fully controlled.

## 6. Pool.Put

Put is defined at line 100:

```go
// Put adds x to the pool.
func (p *Pool) Put(x any) {
    if x == nil {
        return
    }
    if race.Enabled {
        if fastrandn(4) == 0 {
            // Randomly drop x on floor.
            return
        }
        race.ReleaseMerge(poolRaceAddr(x))
        race.Disable()
    }
    l, _ := p.pin()
    if l.private == nil {
        l.private = x
    } else {
        l.shared.pushHead(x)
    }
    runtime_procUnpin()
    if race.Enabled {
        race.Enable()
    }
}
```

Compared to Get, Put is even simpler. Branch on `x == nil` and bail out — there is no point in caching nil. Pin to the current P. If the private slot is empty, drop x there. Otherwise push x on the head of the shared chain. Unpin.

The race.Enabled clause has a deliberate effect: it drops 25 percent of Put calls on the floor. This is not a bug, it is a test-amplifier. By making the cache lossy under -race, the runtime forces user code to never assume Get returns what was Put. Code that relies on Pool to preserve specific objects breaks loudly under the race detector, which is exactly what you want.

The `race.ReleaseMerge` call publishes a happens-before edge from this Put to any subsequent Get that retrieves `x`. Combined with `race.Acquire` in Get, the race detector can correctly model the synchronization through the pool even though the actual data path goes through unsafe pointer arithmetic.

The choice between `private` and `pushHead` favors private. This is intentional: storing in `private` is a single non-atomic word write, while `pushHead` involves a CAS on `headTail` in the worst case. If you Put and then Get on the same P, both calls touch only `private`. Only when the pool is being used concurrently across Ps, or when many objects are being parked at once, do you spill into the chain.

## 7. Pool.pin

The pin operation is defined at line 200:

```go
// pin pins the current goroutine to P, disables preemption and
// returns poolLocal pool for the P and the P's id.
// Caller must call runtime_procUnpin() when done with the pool.
func (p *Pool) pin() (*poolLocal, int) {
    pid := runtime_procPin()
    // In pinSlow we store to local and then to localSize, here we load in opposite order.
    // Since we've disabled preemption, GC cannot happen in between.
    // Thus here we must observe local at least as large as localSize.
    // We can observe a newer/larger local, it is fine (we must observe its zero-initialized-ness).
    s := runtime_LoadAcquintptr(&p.localSize) // load-acquire
    l := p.local                              // load-consume
    if uintptr(pid) < s {
        return indexLocal(l, pid), pid
    }
    return p.pinSlow()
}
```

This is the single most important method in the file because everything builds on the guarantee it provides. Two things happen in three lines.

First, `runtime_procPin()` is called. It returns the current P's id and disables preemption. "Disables preemption" means the runtime will not stop this goroutine to run another one, will not migrate it to another OS thread, and will not allow garbage collection to scan this goroutine's stack until `runtime_procUnpin()` is called. The implementation lives in `runtime/proc.go` and works by incrementing `m.locks` and `g.m.locks`. Garbage collection in particular waits at safepoints until all goroutines are unpinned, so the cleanup callback we describe in section 9 cannot run while any pin is held.

Second, the function loads `localSize` and `local`, in that order, with appropriate memory orderings. The acquire load on `localSize` synchronizes with the release store in `pinSlow`. If the acquire sees an `s` that is at least `pid+1`, then the corresponding `local` array has already been initialized to a size at least `pid+1`. The plain load of `p.local` may, on some architectures, see an older value than the matching `localSize`, but the inverse cannot happen: if `s > pid` then `local` is at least as fresh as the array that has that many entries. Hence the check `if uintptr(pid) < s` is sufficient; we do not need to verify that `local` is non-nil.

The comment "We can observe a newer/larger local, it is fine" deserves a moment. Suppose GOMAXPROCS was 2 when this pool was first used, so `local` is a 2-entry array. Then GOMAXPROCS rises to 4, and `pinSlow` allocates a 4-entry array and publishes it. Another goroutine on P=1 calls pin. It may see the new `local` (4-entry) along with the old `localSize` of 2, or the new `local` (4-entry) along with the new `localSize` of 4. Either way the check `pid < s` is conservative and points to a valid entry.

If `pid >= s`, the fast path fails and we drop into `pinSlow`. This can happen when the pool is newly constructed (size 0) or when GOMAXPROCS has just been raised.

## 8. Pool.pinSlow

pinSlow is at line 220:

```go
func (p *Pool) pinSlow() (*poolLocal, int) {
    // Retry under the mutex.
    // Can not lock the mutex while pinned.
    runtime_procUnpin()
    allPoolsMu.Lock()
    defer allPoolsMu.Unlock()
    pid := runtime_procPin()
    // poolCleanup won't be called while we are pinned.
    s := p.localSize
    l := p.local
    if uintptr(pid) < s {
        return indexLocal(l, pid), pid
    }
    if p.local == nil {
        allPools = append(allPools, p)
    }
    // If GOMAXPROCS changes between GCs, we re-allocate the array and lose the old one.
    size := runtime.GOMAXPROCS(0)
    local := make([]poolLocal, size)
    atomic.StorePointer(&p.local, unsafe.Pointer(&local[0])) // store-release
    runtime_StoreReluintptr(&p.localSize, uintptr(size))     // store-release
    return &local[size-1], pid
}
```

Walk through this carefully because it has a tricky lock-and-pin dance.

The function is entered while pinned. To take a Go mutex it must unpin first; you cannot block while pinned because that would prevent the scheduler from running anything else on this P. So step one is `runtime_procUnpin`. Then it takes `allPoolsMu`, the package-level mutex that guards the global pool registry. After acquiring the mutex, it re-pins (`runtime_procPin`), capturing whichever P the scheduler decided to put this goroutine on after the brief unpinned interval. The new `pid` might differ from the one that entered Get; that is fine.

Then it re-checks the fast-path condition. Why? Because between the original pin and the re-pin under the mutex, another goroutine on another P could have taken the same mutex, grown the array, released the mutex, and we are now seeing a sufficient array. In that case we just return.

If the array is still too small (or nil), we now grow it. First, if `p.local` is nil, this is the pool's first use, so we register it in `allPools`. This list is consulted at GC time; see section 9. Then we make a fresh slice of size GOMAXPROCS — note `GOMAXPROCS(0)` rather than `NumCPU()`, because what matters is the scheduler's logical-CPU count.

The two atomic stores publish the new array. The pointer goes first (store-release), then the size (store-release). On the reader side (section 7), the loads happen in reverse: size first (load-acquire), then pointer. This ordering is the publication protocol: any reader that sees a size ≥ pid+1 must also see the corresponding pointer.

There is a subtle and intentional resource leak in this code. The comment says "If GOMAXPROCS changes between GCs, we re-allocate the array and lose the old one." Because we re-allocate on every growth and we do not preserve the contents of the old array, anything that was in the old pool gets garbage collected. This is acceptable because Pool is allowed to drop any entry at any time, and changing GOMAXPROCS at runtime is rare.

The returned value is `&local[size-1]`. This looks odd — why the last entry? It does not matter. The Get caller will overwrite the returned pointer immediately by calling `indexLocal` itself on the next loop iteration, or by returning. The choice is arbitrary; the function just needs to return a valid `*poolLocal`. Returning `&local[size-1]` matches the case where the caller's pid happens to equal `size-1`.

The global state on the package side, around line 257, is:

```go
var (
    allPoolsMu Mutex

    // allPools is the set of pools that have non-empty primary
    // caches. Protected by either 1) allPoolsMu and pinning or
    // 2) STW.
    allPools []*Pool

    // oldPools is the set of pools that may have non-empty victim
    // caches. Protected by STW.
    oldPools []*Pool
)
```

`allPools` holds the pools that have been used at least once. `oldPools` holds pools that have a non-empty victim cache from the previous GC. Both lists grow without bound by default, which can be an issue for programs that create unbounded numbers of pools and let them die — they leak the slot in `allPools`. The standard advice is to make pools long-lived.

## 9. runtime_registerPoolCleanup and poolCleanup

At line 282:

```go
func init() {
    runtime_registerPoolCleanup(poolCleanup)
}
```

This is a package-level `init` that registers the pool cleanup callback with the runtime. The runtime, during garbage collection, calls back into the sync package via the registered function. The mechanism is intentionally indirected through a registration callback (rather than the runtime importing sync, which would create a dependency cycle) — sync registers, runtime invokes.

The cleanup itself is at line 270:

```go
func poolCleanup() {
    // This function is called with the world stopped, at the beginning of a garbage collection.
    // It must not allocate and probably should not call any runtime functions.

    // Because the world is stopped, no pool user can be in a
    // pinned section (in effect, this has all Ps pinned).

    // Drop victim caches from all pools.
    for _, p := range oldPools {
        p.victim = nil
        p.victimSize = 0
    }

    // Move primary cache to victim cache.
    for _, p := range allPools {
        p.victim = p.local
        p.victimSize = p.localSize
        p.local = nil
        p.localSize = 0
    }

    // The pools with non-empty primary caches now have non-empty
    // victim caches and no pools have primary caches.
    oldPools, allPools = allPools, nil
}
```

This is the most consequential method in the entire pool implementation because it determines the lifetime of pooled objects with respect to GC.

The world is stopped when this runs, which means every goroutine is at a safepoint and no goroutine holds a pin. The cleanup can therefore touch every pool's per-P state without any synchronization. There are no atomics, no locks, no CAS loops; just plain assignments.

The algorithm is two passes:

Pass one: walk `oldPools`, which is the set of pools that had a victim cache from the previous cycle, and clear those victims. The objects they held are now unreachable from the pool and become eligible for collection.

Pass two: walk `allPools`, which is the set of pools that were used since the last cleanup, and demote their main cache to victim cache. The main cache becomes nil.

Then swap the lists: the old `allPools` becomes the new `oldPools`, and `allPools` is reset to nil. Pools that get used in the next epoch will register themselves again via `pinSlow` and end up in the new `allPools`.

The constraint "must not allocate and probably should not call any runtime functions" is not enforced by the compiler; it is a code review property. Allocating during cleanup would risk re-entering the GC machinery. The implementation pointedly does only pointer assignments.

## 10. Why two generations — main and victim

This is the most subtle design decision in the whole file. Up through Go 1.12, `poolCleanup` simply cleared the entire `local` array on each GC. That meant every pool got drained completely every garbage collection. Programs that were holding pools to amortize allocation rates would see a "thundering herd" of allocations right after every GC because every Get would miss in the cache and fall through to `New`.

The fix, introduced in Go 1.13 commit 2dcbf8b3, was to add a second generation. Now the lifecycle of a pooled object is:

1. Put at time T0. Object lives in `local`.
2. GC at time T1 > T0. Object moves from `local` to `victim`. The `local` slot is now empty.
3. Get at time T2 > T1. Caller may find the object in `victim` via the `getSlow` path, but only after exhausting `local`.
4. GC at time T3 > T2. Object is dropped (cleared from `victim`).

So an object survives between one and two GC cycles. If it is taken via `victim` lookup, it survives one cycle. If it is not taken, it dies in two cycles. The total cache size is at most twice the working set, which is the right asymptotic behavior — you keep enough to cover post-GC reloads, but you do not retain forever.

The cost of the two-generation design is one extra pointer (the `victim` pointer plus the `victimSize` int) per pool, plus the `getSlow` walk of the victim array. That walk is O(P) atomics, which can be expensive in tail latency but is amortized across many Get calls.

The benefit is that programs which use Pool to recycle frequently allocated structs (HTTP request scratch buffers, encoding states, etc.) do not see a latency cliff at GC time. The hit rate in the victim cache is high enough that most post-GC Get calls still avoid allocation.

There is one subtle interaction with the `victimSize = 0` write in `getSlow`. When the victim cache is drained to empty, future Get calls short-circuit. This is a per-pool optimization: empty victim caches do not require walking. The flag is reset on the next GC when victim is repopulated from local.

## 11. poolChain — the doubly-linked list of ring buffers

Open `src/sync/poolqueue.go`. This file implements the work-stealing ring buffer that backs `poolLocalInternal.shared`. The top-level structure, at line 19, is:

```go
// poolChain is a dynamically-sized version of poolDequeue.
//
// This is implemented as a doubly-linked list queue of poolDequeues
// where each dequeue is double the size of the previous one. Once a
// dequeue fills up, this allocates a new one and only ever pushes to
// the latest dequeue. Pops happen from the other end of the list and
// once a dequeue is exhausted, it gets removed from the list.
type poolChain struct {
    // head is the poolDequeue to push to. This is only accessed
    // by the producer, so doesn't need to be synchronized.
    head *poolChainElt

    // tail is the poolDequeue to popTail from. This is accessed
    // by consumers, so reads and writes must be atomic.
    tail *poolChainElt
}

type poolChainElt struct {
    poolDequeue

    // next and prev link to the adjacent poolChainElts in this
    // poolChain.
    //
    // next is written atomically by the producer and read
    // atomically by the consumer. It only transitions from nil to
    // non-nil.
    //
    // prev is written atomically by the consumer and read
    // atomically by the producer. It only transitions from
    // non-nil to nil.
    next, prev *poolChainElt
}
```

Read the comment on `head` and `tail` carefully. The producer (the owning P) touches `head` without synchronization because no one else writes to it. Consumers touch `tail` with atomic operations. `next` and `prev` are each one-way: `next` goes from nil to non-nil (set by producer when allocating a new dequeue, read by consumers as they traverse), and `prev` goes from non-nil to nil (set by consumer when retiring an exhausted dequeue, read by producer as it walks back).

Each `poolChainElt` embeds a `poolDequeue` (a fixed-size ring) and adds two link pointers. The chain grows by appending a new `poolChainElt` on the producer side whenever the head ring fills up. The new ring is double the size of the previous one, capped at some maximum.

The cap, from line 14 of `poolqueue.go`:

```go
const dequeueLimit = (1 << dequeueBits) / 4
```

`dequeueBits` is 32 on 64-bit and 16 on 32-bit; `dequeueLimit` is the maximum ring size in entries. On 64-bit it is `(1 << 32) / 4 = 2^30 = 1,073,741,824`. So in practice the chain will not hit the size cap. The growth factor of 2 means after 30 doublings you have used the largest ring.

The doubly-linked structure lets the consumer side (`popTail`) walk forward from the tail, retiring exhausted dequeues, while the producer (`pushHead`) walks backward from the head when allocating new dequeues. The two walks do not interfere because the producer touches `next` and the consumer touches `prev`.

## 12. poolDequeue — single-producer multi-consumer ring

poolDequeue is the core ring buffer. Line 18 of `poolqueue.go` (note: poolqueue.go has its own line numbering separate from pool.go):

```go
// poolDequeue is a lock-free fixed-size single-producer,
// multi-consumer queue. The single producer can both push and pop
// from the head, and consumers can pop from the tail.
//
// It has the added feature that it nils out unused slots to avoid
// unnecessary retention of objects. This is important for sync.Pool,
// but not typically a property considered in the literature.
type poolDequeue struct {
    // headTail packs together a 32-bit head index and a 32-bit
    // tail index. Both are indexes into vals modulo len(vals)-1.
    //
    // tail = index of oldest data in queue
    // head = index of next slot to fill
    //
    // Slots in the range [tail, head) are owned by consumers.
    // A consumer continues to own a slot outside this range until
    // it nils the slot, at which point ownership passes to the
    // producer.
    //
    // The head index is stored in the most-significant bits so
    // that we can atomically add to it and the overflow is harmless.
    headTail uint64

    // vals is a ring buffer of interface{} values stored in this
    // dequeue. The size of this must be a power of 2.
    //
    // vals[i].typ is nil if the slot is empty and non-nil
    // otherwise. A slot is still in use until *both* the tail
    // index has moved beyond it and typ has been set to nil. This
    // is set to nil atomically by the consumer and read
    // atomically by the producer.
    vals []eface
}
```

The two fields are an atomic word and a slice. The atomic word, `headTail`, packs two 32-bit indexes into a single 64-bit value: head in the upper 32 bits, tail in the lower 32 bits. They are real indexes (not yet modulo the ring size); the ring size is `len(vals)`, which is a power of two, so taking the index modulo the size is a single AND with `len(vals)-1`.

The slice holds the actual values. Each entry is an `eface` (the runtime's empty-interface representation: a type pointer and a data pointer). The choice of `eface` rather than `any` is so the code can set the type pointer to nil to mark a slot as empty without doing a generic interface assignment, which would also have to zero the data pointer in the right order.

The semantics are stated carefully: a consumer owns a slot from when it bumps `tail` past it until it nils the slot's `typ`. Only then can the producer reuse the slot. This handshake matters because the producer's `pushHead` checks `vals[head].typ == nil` before overwriting; if a slow consumer has not yet nilled the slot, the producer must back off and (in practice) grow to a new ring.

The packing of head and tail into a single 64-bit value is what makes the dequeue lock-free. A single 64-bit CAS can advance either head or tail atomically with respect to a snapshot of the other. We will see this in the methods.

The helpers around the packing, at line 86 of `poolqueue.go`:

```go
const dequeueBits = 32

func (d *poolDequeue) unpack(ptrs uint64) (head, tail uint32) {
    const mask = 1<<dequeueBits - 1
    head = uint32((ptrs >> dequeueBits) & mask)
    tail = uint32(ptrs & mask)
    return
}

func (d *poolDequeue) pack(head, tail uint32) uint64 {
    const mask = 1<<dequeueBits - 1
    return (uint64(head) << dequeueBits) |
        uint64(tail&mask)
}
```

`unpack` peels the 64-bit value into two 32-bit indexes. `pack` reassembles them. The mask is `0xFFFFFFFF`, defensively applied to `tail` only because head fills the upper bits exactly by the shift.

## 13. poolDequeue.pushHead

At line 105 of poolqueue.go:

```go
// pushHead adds val at the head of the queue. It returns false if the
// queue is full. It must only be called by a single producer.
func (d *poolDequeue) pushHead(val any) bool {
    ptrs := atomic.LoadUint64(&d.headTail)
    head, tail := d.unpack(ptrs)
    if (tail+uint32(len(d.vals)))&(1<<dequeueBits-1) == head {
        // Queue is full.
        return false
    }
    slot := &d.vals[head&uint32(len(d.vals)-1)]

    // Check if the head slot has been released by popTail.
    typ := atomic.LoadPointer(&slot.typ)
    if typ != nil {
        // Another goroutine is still cleaning up the tail, so
        // the queue is actually still full.
        return false
    }

    // The head slot is free, so we own it.
    if val == nil {
        val = dequeueNil(nil)
    }
    *(*any)(unsafe.Pointer(slot)) = val

    // Increment head. This passes ownership of slot to popTail
    // and acts as a store barrier for writing the slot.
    atomic.AddUint64(&d.headTail, 1<<dequeueBits)
    return true
}
```

The body of pushHead is:

1. Load headTail atomically and unpack into head and tail.
2. Check fullness. The condition `(tail + len(vals)) & mask == head` is the standard "head has caught up to tail+capacity" check. If true, return false.
3. Compute the slot pointer at index `head mod len(vals)`. Because `len(vals)` is a power of two, the modulo is a bitwise AND.
4. Atomically load the slot's `typ` field. If it is non-nil, a previous occupant has not yet been cleared by a popTail; the slot is logically still in use even though tail has moved past it. Return false (full).
5. Write the new value into the slot. The `val == nil` special case converts a nil interface into a sentinel `dequeueNil(nil)`, because the implementation uses `nil typ` as the "empty" marker and cannot distinguish a Put of nil from an empty slot. We will not dig into `dequeueNil`; it is a typed nil that round-trips through Get.
6. Atomically add 1 to head (which is the upper 32 bits, so we add `1<<dequeueBits`). This is the publication step: the slot is now visible to consumers.

The store at step 5 is a plain assignment, but it is followed by an atomic add at step 6. The add acts as a release fence on architectures with relaxed memory ordering, so consumers that subsequently observe the new head value are guaranteed to see the new slot contents. This is the inverse of the load-acquire on the consumer side.

The function is described as "must only be called by a single producer" — that is, the owning P. There is no CAS retry loop on head; only the producer ever writes head, so it can use `atomic.AddUint64` without contention.

## 14. poolDequeue.popHead

At line 137:

```go
// popHead removes and returns the element at the head of the queue.
// It returns false if the queue is empty. It must only be called by a
// single producer.
func (d *poolDequeue) popHead() (any, bool) {
    var slot *eface
    for {
        ptrs := atomic.LoadUint64(&d.headTail)
        head, tail := d.unpack(ptrs)
        if tail == head {
            // Queue is empty.
            return nil, false
        }

        // Confirm tail and decrement head. We do this before
        // reading the value to take back ownership of this
        // slot.
        head--
        ptrs2 := d.pack(head, tail)
        if atomic.CompareAndSwapUint64(&d.headTail, ptrs, ptrs2) {
            // We successfully took back slot.
            slot = &d.vals[head&uint32(len(d.vals)-1)]
            break
        }
    }

    val := *(*any)(unsafe.Pointer(slot))
    if val == dequeueNil(nil) {
        val = nil
    }
    // Zero the slot. Unlike popTail, this isn't racing with
    // pushHead, so we don't need to be careful here.
    *slot = eface{}
    return val, true
}
```

popHead is the producer reclaiming what it just pushed. It uses a CAS loop, but the only contention is with consumers running popTail on the other end. There are three cases:

The first case is "queue empty": head == tail. Return.

The second case is "we successfully decremented head": the CAS at the bottom of the loop succeeds. We have logically removed the entry. We then read the value out of the slot. The slot was previously owned by us (since we are the producer that pushed it and the only one who ever popped the head), so reading it is safe.

The third case is "CAS failed": some popTail consumer raced with us. They advanced tail; we must re-read headTail and try again. Crucially, the CAS races with tail moves, not head moves, because popHead and popTail both modify headTail. If a consumer moved tail closer to head between our load and our CAS, we retry against the new state.

The clearing of the slot at the end is unsynchronized (`*slot = eface{}`) because once we own the slot back via the CAS, no consumer can see it; only the producer that called popHead can write to it now.

Note the difference from popTail: there is no need to atomically zero `typ` first and then write the rest of the slot, because popHead does not race with pushHead — the same goroutine cannot be in two places at once.

## 15. poolDequeue.popTail

At line 170:

```go
// popTail removes and returns the element at the tail of the queue.
// It returns false if the queue is empty. It may be called by any
// number of consumers.
func (d *poolDequeue) popTail() (any, bool) {
    var slot *eface
    for {
        ptrs := atomic.LoadUint64(&d.headTail)
        head, tail := d.unpack(ptrs)
        if tail == head {
            // Queue is empty.
            return nil, false
        }

        // Confirm head and tail (for our speculative check
        // above) and increment tail. If this succeeds, then we
        // own the slot at tail.
        ptrs2 := d.pack(head, tail+1)
        if atomic.CompareAndSwapUint64(&d.headTail, ptrs, ptrs2) {
            // Success.
            slot = &d.vals[tail&uint32(len(d.vals)-1)]
            break
        }
    }

    // We now own slot.
    val := *(*any)(unsafe.Pointer(slot))
    if val == dequeueNil(nil) {
        val = nil
    }

    // Tell pushHead that we're done with this slot. Zeroing the
    // slot is also important so we don't leave behind references
    // that could keep this object live longer than necessary.
    //
    // We write to val first and then publish that we're done with
    // this slot by atomically writing to typ.
    slot.val = nil
    atomic.StorePointer(&slot.typ, nil)
    // At this point pushHead owns the slot.

    return val, true
}
```

popTail is the steal operation. Multiple goroutines on different Ps can call it concurrently against the same dequeue. It uses a CAS on tail.

The function loops: load headTail, check empty, CAS to bump tail by 1. If the CAS succeeds, the slot at index `tail mod len(vals)` is logically ours. If it fails, retry.

After winning the CAS, we read the value out, then publish the slot's release. The release has two steps: first set `slot.val = nil` (zeroing the data pointer), then atomic store of nil to `slot.typ`. The order matters because `pushHead` reads `slot.typ` first and only proceeds if it is nil; we must have written the val before announcing typ-nil. Otherwise pushHead could observe `typ == nil` and store a new value, but our pending `slot.val = nil` write would race with the new write.

This handshake — pushHead reads typ before writing, popTail writes typ last after clearing val — is what makes the SPMC ring correct without locks.

The comment "Zeroing the slot is also important so we don't leave behind references" is the GC argument: if the slot still held a pointer to the old object even after tail had moved, the object would be reachable from the pool's array and would not be collected. By zeroing val, the popTail releases the reference so GC can reclaim it.

## 16. poolChain.pushHead, popHead, popTail, and ring growth

Back in poolqueue.go at line 215:

```go
func (c *poolChain) pushHead(val any) {
    d := c.head
    if d == nil {
        // Initialize the chain.
        const initSize = 8 // Must be a power of 2
        d = new(poolChainElt)
        d.vals = make([]eface, initSize)
        c.head = d
        storePoolChainElt(&c.tail, d)
    }

    if d.pushHead(val) {
        return
    }

    // The current dequeue is full. Allocate a new one of twice
    // the size.
    newSize := len(d.vals) * 2
    if newSize >= dequeueLimit {
        // Can't make it any bigger.
        newSize = dequeueLimit
    }

    d2 := &poolChainElt{prev: d}
    d2.vals = make([]eface, newSize)
    c.head = d2
    storePoolChainElt(&d.next, d2)
    d2.pushHead(val)
}
```

The chain-level pushHead does three things. First, if `c.head` is nil, lazily allocate the first dequeue of size 8. Second, try `d.pushHead(val)` on the head dequeue; if it succeeds, return. Third, if the head is full, allocate a new dequeue of twice the size (capped at `dequeueLimit`), link it in, and push to the new head.

The doubling is the standard amortization for dynamic arrays. The initial size of 8 is small enough not to waste memory in pools that see few Puts, and the doubling means the chain's total capacity grows geometrically with the number of allocations.

Linking is done via two atomic-ish operations: `c.head = d2` is a plain assignment (only the producer touches `c.head`), and `storePoolChainElt(&d.next, d2)` is an atomic store because consumers traversing the chain on popTail will load `next` atomically.

The chain-level popHead is at line 254:

```go
func (c *poolChain) popHead() (any, bool) {
    d := c.head
    for d != nil {
        if val, ok := d.popHead(); ok {
            return val, true
        }
        // There may still be unconsumed elements in the
        // previous dequeue, so try backing up.
        d = loadPoolChainElt(&d.prev)
    }
    return nil, false
}
```

This walks from the head dequeue backward through `prev`, trying popHead at each. If a previous dequeue still has values (because the producer wrapped around to a new ring with the previous one not fully drained), the producer can take from any of them. Walking backward via `prev` lets the producer find them. The atomic load on `prev` synchronizes with the consumer side, which may have set `prev` to nil to retire a fully drained dequeue.

popTail is at line 269:

```go
func (c *poolChain) popTail() (any, bool) {
    d := loadPoolChainElt(&c.tail)
    if d == nil {
        return nil, false
    }

    for {
        // It's important that we load the next pointer
        // *before* popping the tail. In general, d may be
        // transiently empty, but if next is non-nil before
        // the pop and the pop fails, then d is permanently
        // empty, which is the only condition under which it's
        // safe to drop d from the chain.
        d2 := loadPoolChainElt(&d.next)

        if val, ok := d.popTail(); ok {
            return val, true
        }

        if d2 == nil {
            // This is the only dequeue. It's empty right
            // now, but could be pushed to in the future.
            return nil, false
        }

        // The tail of the chain has been drained, so move on
        // to the next dequeue. Try to drop it from the chain
        // so the next pop doesn't have to look at the empty
        // dequeue again.
        if atomic.CompareAndSwapPointer(
            (*unsafe.Pointer)(unsafe.Pointer(&c.tail)),
            unsafe.Pointer(d), unsafe.Pointer(d2)) {
            // We won the race. Clear the prev pointer so
            // the garbage collector can collect the empty
            // dequeue and so popHead doesn't back up
            // further than necessary.
            storePoolChainElt(&d2.prev, nil)
        }
        d = d2
    }
}
```

The popTail at chain level is the most subtle method in the whole file. Walk it once carefully.

It starts by loading `c.tail` — the oldest dequeue in the chain. If nil, return empty.

Then it loops. On each iteration:

1. Load `d.next` first. The order is critical and is called out in the comment. We need to know whether there is anything after `d` before we test whether `d` is empty.
2. Try `d.popTail()`. If success, return.
3. If `d.popTail()` failed and `d.next` was nil (loaded before the popTail), then there might be more pushes coming to `d`. We return empty.
4. If `d.popTail()` failed and `d.next` was non-nil at the time of step 1, then `d` is permanently drained (because no more pushes can land in `d` once a new dequeue has been created). We retire `d` from the chain by CASing `c.tail` from `d` to `d2`.
5. If we won the CAS, also clear `d2.prev` so the chain shortens from both directions. This frees `d` for GC.
6. Advance `d` to `d2` and loop.

The order in step 1 is the "load-next-first" invariant: if we loaded next as non-nil but then popTail succeeded, we are fine — we have a value to return. If we loaded next as non-nil and popTail failed, the failure is permanent because next being non-nil at the load point means a new dequeue was created, which only happens after the producer found d full and moved on. The producer never writes to d again. So the failure of popTail must be due to all values having been already popped by other consumers, not due to a transient state.

If we had loaded next *after* popTail, we could see next nil at one moment and conclude "d may receive more pushes" — but in fact d had been retired and the new dequeue d2 had absorbed the new pushes, all between our two reads. By loading next first, we ensure a non-nil next observed *before* the failed pop means d is truly permanently empty.

This is exactly the kind of subtle memory-ordering reasoning that lock-free programming demands. It is also exactly the kind of bug that took several patch cycles in the Go runtime to get right.

## 17. Memory ordering on headTail

Across the dequeue methods, the headTail word is accessed with three different atomic operations:

- `atomic.LoadUint64(&d.headTail)`: used at the start of pushHead, popHead, and popTail. This is a load-acquire on x86 (because all loads are acquire on x86) and on ARM64 issues an LDAR. It synchronizes with any subsequent CAS or Add that publishes a new headTail.

- `atomic.AddUint64(&d.headTail, 1<<dequeueBits)`: used in pushHead to publish a new head. The add is atomic and acts as a full barrier on x86 (LOCK XADD).

- `atomic.CompareAndSwapUint64(&d.headTail, old, new)`: used in popHead and popTail. The CAS is full-barrier on x86 (LOCK CMPXCHG) and uses acquire-release semantics on ARM64.

These three operations together implement a producer-consumer protocol where:

- The producer publishes a slot's contents *before* publishing the new head value, and the consumer observes the new head value *before* reading the slot's contents.
- The consumer (popTail) publishes the slot's release (typ-nil) *after* reading the slot's value, and the producer (next pushHead) observes typ-nil *before* writing new contents.

The two halves are necessary because the slot's contents are not atomic — they are a two-word interface — and the protocol uses the atomic headTail and the atomic typ field as gates.

On architectures with weaker memory models (e.g., ARM relaxed), getting these gates right is the difference between a working pool and a pool that intermittently returns garbage. Go's `sync/atomic` package supplies sequentially consistent operations by default, which is stronger than needed but correct.

## 18. The noCopy marker

We touched on this in section 1. The `noCopy` type is defined in `cond.go` line 113:

```go
// noCopy may be added to structs which must not be copied
// after the first use.
//
// See https://golang.org/issues/8005#issuecomment-190753527
// for details.
//
// Note that it must not be embedded, due to the Lock and Unlock methods.
type noCopy struct{}

// Lock is a no-op used by -copylocks checker from `go vet`.
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```

The Lock/Unlock methods exist purely to make `go vet`'s copylocks pass see the field as a sync.Locker-like type. Any assignment of a struct containing a noCopy field (or a pointer to one) gets flagged.

Why does it matter for Pool? Consider:

```go
var p1, p2 sync.Pool
p1 = p2  // Both now share the same internal pointers.
```

After the assignment, p1.local and p2.local point to the same array. A Put on p1 and a Get on p2 would observe each other. Worse, both pools would be in `allPools` separately, and `poolCleanup` would try to demote both — which could double-clear or otherwise corrupt the invariants.

The vet warning prevents this class of bug at compile review time. It does not, of course, prevent reflection-based copies or unsafe casts, but those are out of scope for the vet checker.

## 19. A full Get/Put walk with two Ps and one stealer

Let us trace through a concrete scenario to fix the mental model.

The setup: GOMAXPROCS = 4. Pool p is newly created, no Puts yet. Goroutine G1 runs on P0, goroutine G2 runs on P1, goroutine G3 runs on P2 and will act as the stealer.

**Step 1.** G1 calls `p.Get()` on P0. It enters `Pool.Get`, calls `p.pin()`, which returns `(l0, 0)` where `l0` is a fresh poolLocal. Wait — fresh? On the first Get, `p.local` is nil. `pin` reads `localSize = 0`, finds `pid (0) < 0` is false, and falls into `pinSlow`. pinSlow unpins, locks allPoolsMu, re-pins (maybe on P0 again, maybe elsewhere; let us say P0). It registers `p` in `allPools` and allocates `local = make([]poolLocal, 4)`. The four entries are zero. It publishes via two release stores. It returns `(&local[3], 0)`.

We are now back in Get with a valid `l0`. But wait — `pinSlow` returned `&local[3]`, not `&local[0]`. Let us re-read section 8. Yes, pinSlow returns `&local[size-1]`. That looks like a bug — surely we want `&local[pid]`?

Look at pinSlow again. The returned poolLocal pointer is used only by the caller as the "default" result of pin in the slow-path case. But after the pin retry under the mutex, the function may have re-pinned to a different P. The `pid` variable was re-read after the second `runtime_procPin`. The returned `pid` is correct, but the returned `*poolLocal` may not correspond to that pid. 

Actually, let us look more carefully. After the resize, `pid` is set by the second `runtime_procPin`. The check `if uintptr(pid) < s` (after the lock) catches the case where the size already grew, returning `indexLocal(l, pid)` — correct. Then the fall-through code allocates new local with `size = GOMAXPROCS(0)` entries. The current pid is `pid` (the new one), and `pid < size` (by definition, since size is GOMAXPROCS and pid is a valid P id). So `&local[size-1]` is a valid pointer, but it is the wrong poolLocal for the current P unless pid == size-1.

This appears to be a latent issue but is actually safe by construction: the Get function does not use the returned pointer's slot index for arithmetic; it just dereferences `l.private` and `l.shared`. If we get the "wrong" poolLocal (i.e., the one for a different P than we are pinned to), we still get a valid poolLocal whose private slot is nil (because the array was just allocated and zeroed). So Get falls through to the empty-cache case and returns nil or calls New. The pool is empty on first use, so this is fine.

On the next Get, the cache pointer will be set, and `pin` will hit the fast path correctly with `indexLocal(local, pid)`.

OK, back to the trace.

**Step 2.** G1 sees `l.private == nil` and `l.shared.popHead() == nil`, so it calls `p.getSlow(0)`. getSlow loops through all four Ps' shared chains, all empty. It checks victim (also empty). It returns nil. G1 calls `p.New()` (or returns nil). G1 unpins.

**Step 3.** G1 finishes its work with the returned value (let us call it `x1`) and calls `p.Put(x1)`. It pins to P0 again. `p.local` is now set, `pin` hits the fast path, returns `&local[0]`. l.private is nil, so Put writes `l.private = x1` and unpins.

**Step 4.** G2 on P1 calls `p.Put(x2)`. Same path: pin returns `&local[1]`, private is nil, write x2, unpin.

**Step 5.** G1 on P0 calls `p.Get()` again. Pin returns `&local[0]`. l.private is x1 (from step 3). Get reads x1, zeroes private, unpins, returns x1. Two reads, one write — no atomics on this path.

**Step 6.** G2 on P1 calls `p.Put(x2b)`. Pin returns `&local[1]`. l.private is nil (consumed in step 5? no, step 5 was on P0 — l.private[1] is still x2 from step 4). So Put writes `l.shared.pushHead(x2b)`. This invokes the chain: chain has no head yet, so it allocates a fresh poolChainElt with an 8-entry dequeue, links it as both head and tail, and calls d.pushHead(x2b). Inside d.pushHead: head=0, tail=0, queue not full, slot &vals[0] has typ nil (fresh), write x2b to slot, atomic add to headTail (head becomes 1). Returns true.

**Step 7.** G3 on P2 calls `p.Get()`. Pin returns `&local[2]`. l.private is nil. l.shared.popHead() — the local chain has no head, returns nil. getSlow(2) starts walking other Ps: visit P3 (empty), P0 (l[0].shared empty — l[0].private has x1's slot zeroed but shared was never used), P1 (l[1].shared has x2b! call popTail). 

popTail on P1's chain: load `c.tail` (the same chainElt as head, with head=1, tail=0). Walk into d.popTail. Inside: load headTail (head=1, tail=0), not empty, CAS to (head=1, tail=1), CAS succeeds. Read &vals[0] — that is x2b. Write val=nil, atomic store typ=nil. Return x2b.

Back in chain popTail: success, return x2b.

Back in getSlow: return x2b.

Back in Get: unpin, return x2b to G3.

**Step 8.** Meanwhile G2 on P1 calls `p.Put(x2c)`. Pin returns `&local[1]`. l.private is x2 (still, never popped). So shared.pushHead(x2c). The chain has its head dequeue; head=1, tail=1 — empty by indices but the slot at index 0 has been used. We push to slot 1: load headTail (1,1), not full, slot &vals[1] has typ nil (fresh), write x2c, atomic add (head becomes 2). Return.

**Step 9.** G3 on P2 puts x2b back via `p.Put(x2b)`. Pin returns &local[2]. l.private is nil — wait, we just consumed it in step 7? No, l.private was already nil in step 7, we did not change it. So put writes l[2].private = x2b.

At this point, the pool state is:
- l[0].private = nil, l[0].shared empty
- l[1].private = x2, l[1].shared has x2c at head=2, tail=1 (one entry)
- l[2].private = x2b, l[2].shared empty
- l[3].private = nil, l[3].shared empty

**Step 10.** GC runs. World stops. `poolCleanup` is invoked. allPools = [p], oldPools = []. We loop through oldPools (empty, skip). We loop through allPools: p.victim = p.local, p.victimSize = 4, p.local = nil, p.localSize = 0. Then oldPools = [p], allPools = [].

After GC, the per-P caches are wiped from `local` but the entries live on in `victim`. A new Get on any P will go through pin (which now sees localSize=0 and falls into pinSlow), reallocate a fresh 4-entry local, and getSlow will fall through to the victim cache where it will find x2, x2b, x2c. So the cached objects survive the GC, as designed.

**Step 11.** Another GC runs. Same routine: oldPools = [p], so we clear p.victim, p.victimSize. allPools is still possibly populated if there were Puts between the GCs. If between the two GCs nothing was Put, then allPools is empty, the loop does nothing, oldPools becomes nil.

So x2, x2b, x2c become unreachable after the second GC and will be collected.

That is the complete two-generation lifecycle: Put → live in local → GC → live in victim → GC → dropped. If during the victim phase a Get takes the object, it survives the second GC by virtue of being held by the user code.

## 20. Supplementary deep dives

The numbered tour above hits every method in `src/sync/pool.go` and `src/sync/poolqueue.go`. This final part of the page returns to the more nuanced moments and expands on the questions that always come up when intermediate developers read the source for the first time.

### 20.1 Why `unsafe.Pointer` instead of a typed slice for `local`

We touched on this in section 1. The straightforward Go way to express "a per-P array of poolLocal" would be `local []poolLocal`. A slice header is three machine words: pointer, length, capacity. A `[]poolLocal` field would force every reader of `local` to also load those three words, and to construct a slice header on the stack at every access.

For the hot path, what readers actually need is "give me the poolLocal at index pid." With a slice, the natural expression is `p.local[pid]`, which compiles to a length-check branch (against `len(p.local)`) followed by base-plus-offset arithmetic. The length check is a memory load. With the raw `unsafe.Pointer` representation, the check against `localSize` is done once, in `pin`, after which `pid` is known to be in range and the index can be computed with a single multiply-add — see `indexLocal` at line 244.

There is a second reason. The publication protocol in `pinSlow` writes the pointer first, then the size. A typed slice would have to be published as a whole — either by writing the entire three-word slice header (which is not atomic) or by storing it behind a pointer (which adds another level of indirection). The `(pointer, length)` split lets each be a single-word atomic store.

Finally, the `local` field aliases the address of the first element of a slice, but the slice's backing storage is allocated with `make([]poolLocal, size)`. The garbage collector still sees the array because the slice header that initially holds it is on the stack of `pinSlow` and persists for the lifetime of the array via the unsafe.Pointer in `p.local`. Wait — is that true? Let us check.

Look at the `pinSlow` body again. The local variable is `local := make([]poolLocal, size)`. Then `&local[0]` is taken and stored into `p.local`. The variable `local` goes out of scope at function return. Does the array survive?

It does, because Go's escape analysis sees `&local[0]` flowing into a global location (via the unsafe.Pointer store) and promotes the slice header — and therefore its backing array — to the heap. The pointer in `p.local` keeps the backing array reachable. The Go GC is conservative enough to scan through `unsafe.Pointer` fields: anything stored as `unsafe.Pointer` is treated like a real pointer for marking.

That last property — `unsafe.Pointer` is scanned by GC just like `*T` — is the linchpin of this design. If the GC ignored unsafe pointers, the array would be collected immediately and the pool would corrupt. The Go spec guarantees that `unsafe.Pointer` participates in reachability analysis precisely so the runtime can use it for tricks like this.

### 20.2 The grain of pinning: P, M, or G

Several variations on "pin to a thing" exist in the Go runtime, and confusing them produces subtle bugs.

A goroutine (G) runs on a machine thread (M) which is currently bound to a logical processor (P). Most of the time the scheduler is free to move a G to a different M and to bind an M to a different P. There are three meanings of "pin":

`runtime.LockOSThread`: pin the G to the M. The G will only run on this M, but the M can still pick up a different P. Used when you need a specific OS thread for things like graphics contexts.

`runtime.procPin`: increment a counter on the M that prevents the scheduler from migrating the G off this P. The G stays on this M and the M stays on this P until `procUnpin`. This is the one sync.Pool uses. It is internal to the runtime, exposed to sync via `//go:linkname`.

There is no public way to pin a G to a P from user code, by design. The runtime team did not want users to abuse it.

The key property `procPin` provides is "while pinned, the GC cannot start a new cycle." This is because `procPin` increments `m.locks`, and `gcStart` and `stopTheWorld` both wait for all Ms to be at locks==0 before proceeding. As a result, the cleanup callback is guaranteed to run at a moment when no pinned poolLocal accesses are in flight, which is exactly what makes the cleanup safe to do without locks.

There is a cost. While pinned, the goroutine cannot block. Calls like channel operations, mutex Lock, network reads — any operation that may park the goroutine — will deadlock or panic. The Pool implementation is careful to do nothing in the pinned section that could possibly block. Notice that `runtime_procUnpin` is called *before* `p.New()` in `Pool.Get`: the user-supplied New function might block (e.g., taking a mutex), and we must not be pinned while calling it.

### 20.3 What `localSize` is allowed to be

The implicit invariant on `localSize` is: it is monotone non-decreasing. Once `localSize` reaches some value `s`, it cannot drop below `s` until the pool is reused after a `poolCleanup` (which sets `localSize = 0` but only with the world stopped).

This monotonicity, combined with the world-stop guarantee around cleanup, means readers in `pin` cannot observe an `s` that becomes stale during their use. If they read `s = 4`, then between the load and the dereference of `local[pid]` for pid in [0,4), no other goroutine can shrink the array. The only thing that can happen is `s` grows to 8 (because of GOMAXPROCS increase) or `s` drops to 0 (because of cleanup). The former case is fine: the readers still see the old 4-entry array, which is still valid storage. The latter case can only happen at a world-stop, when no readers are running.

Concretely: if GOMAXPROCS goes from 4 to 8 mid-execution, the first goroutine on P=5 will enter pin, see `s = 4` and `pid = 5`, fall into `pinSlow`. Under the mutex, it will reallocate to size 8 and publish. Meanwhile, a goroutine on P=2 still using the old array sees `s = 4` (or possibly the new `s = 8`, depending on memory ordering) and `pid = 2`, which is < 4, so it uses `indexLocal(local, 2)`. But the `local` pointer it loads might be the new 8-entry one or the old 4-entry one. Either way `indexLocal` with i=2 produces a valid `*poolLocal` for some array. The data at offsets 0..3 in the two arrays differ — the old has user data, the new is zero-initialized.

This is the slightly disturbing part of the design: across a GOMAXPROCS bump, the pool loses everything in its old local array (because the new array is zero-initialized and the old one is no longer reachable via `p.local` after pinSlow publishes the new pointer). The comment in pinSlow acknowledges this: "If GOMAXPROCS changes between GCs, we re-allocate the array and lose the old one."

In practice GOMAXPROCS bumps are rare and the resulting cache drop is acceptable.

### 20.4 The race detector hooks

In `Pool.Put`:

```go
if race.Enabled {
    if fastrandn(4) == 0 {
        return
    }
    race.ReleaseMerge(poolRaceAddr(x))
    race.Disable()
}
```

And in `Pool.Get`:

```go
if race.Enabled {
    race.Disable()
}
...
if race.Enabled {
    race.Enable()
    if x != nil {
        race.Acquire(poolRaceAddr(x))
    }
}
```

The `race.Enabled` constant is true only in race-instrumented builds (`go build -race`). In normal builds, the compiler erases all of these branches. So none of this code has any runtime cost in production.

Under `-race`, four things happen:

First, `Put` randomly drops 25 percent of its inputs on the floor (the `fastrandn(4) == 0` branch). This forces test code to never assume Pool retains specific objects. If your test expects to Get back what you Put, it will fail under `-race` with high probability, alerting you to the bad assumption.

Second, `race.ReleaseMerge(poolRaceAddr(x))` publishes a happens-before edge on the synthetic race-detector address `poolRaceAddr(x)`, which is a function of the object's address. The race detector now believes that any subsequent Acquire on the same address is causally after this Put.

Third, `race.Disable()` and `race.Enable()` bracket the pool's internal pointer arithmetic. Without disabling, the race detector would chase pointer reads through `indexLocal` and report spurious races on the per-P data. Disabling instruments only the user-visible behavior.

Fourth, in `Get`, after enabling the race detector again, `race.Acquire(poolRaceAddr(x))` claims the happens-before edge that `Put` published. This pairs Put and Get without ever telling the race detector about the actual code path, which is correct because the actual code path is full of unsafe pointer arithmetic.

`poolRaceAddr` is at line 295:

```go
// poolRaceAddr returns an address to use as the synchronization point
// for race detector logic. We don't use the actual pointer stored in x
// directly, for fear of conflicting with other synchronization on that
// address. Instead, we hash the pointer to get an index into pool-
// RaceHash. See discussion on golang.org/cl/31589.
func poolRaceAddr(x any) unsafe.Pointer {
    ptr := uintptr((*[2]unsafe.Pointer)(unsafe.Pointer(&x))[1])
    h := uint32((uint64(uint32(ptr)) * 0x85ebca6b) >> 16)
    return unsafe.Pointer(&poolRaceHash[h%uint32(len(poolRaceHash))])
}
```

The synthetic address is computed as a hash of the object's data pointer, indexed into a fixed array `poolRaceHash` of size 128 (or so). Why not use the object's address directly? Because the race detector tracks happens-before per address, and the user might already be using that address for other synchronization. By hashing to a separate space, the pool's synthetic edges do not collide.

There is a small chance of false negatives from hash collisions in `poolRaceHash`, but they are accepted in exchange for not interfering with user race detection.

### 20.5 The `eface` representation in `poolDequeue.vals`

The slice in poolDequeue is `[]eface`, not `[]any`. The `eface` type is defined in the runtime package and shadowed in sync at the bottom of poolqueue.go:

```go
type eface struct {
    typ, val unsafe.Pointer
}
```

This is exactly the runtime representation of an empty interface: a type descriptor pointer and a data pointer. Using `eface` directly rather than `any` gives the pool implementation access to the two words individually.

The popTail code zeroes the val first and then atomically nils the typ. With a Go-level `any`, you cannot do this; you can only assign a whole interface value at once. By dropping to `eface`, the code can sequence the two stores to implement the producer-consumer handshake.

The pushHead writes the slot via:

```go
*(*any)(unsafe.Pointer(slot)) = val
```

This reinterprets the `*eface` as `*any` and assigns `val` (an `any`). The assignment writes both typ and val in some order determined by the compiler. On the producer side, the slot was guaranteed to have typ==nil at the moment of the write (we checked that explicitly), and only the atomic head bump after the write makes the slot visible to consumers. So consumers will always see both fields populated.

The popHead reads the slot the same way:

```go
val := *(*any)(unsafe.Pointer(slot))
```

Read both fields as an interface value. Since this is on the producer side and the producer has just CASed to take back ownership of the slot, no other goroutine is racing on these reads.

### 20.6 dequeueNil and nil values in the pool

The pool needs to distinguish "empty slot" from "slot holds nil." If a user calls `p.Put(nil)`, they get nil right back (and in fact Put has the `if x == nil { return }` short-circuit, but that is at the Pool layer, not the dequeue layer; internally the dequeue still must handle a nil-valued interface).

The mechanism is at line 100 of poolqueue.go:

```go
// dequeueNil is used in poolDequeue to represent interface{}(nil).
// Since we use nil to represent empty slots, we need a sentinel value
// to represent nil.
type dequeueNil *struct{}
```

`dequeueNil` is a defined type backed by `*struct{}`. The expression `dequeueNil(nil)` is a typed nil — its `eface` representation has a non-nil typ (pointing to the dequeueNil type descriptor) and a nil val. Crucially, the typ is non-nil, so the slot is considered occupied.

When popHead or popTail retrieves a value, the code compares against `dequeueNil(nil)`:

```go
val := *(*any)(unsafe.Pointer(slot))
if val == dequeueNil(nil) {
    val = nil
}
```

If the slot held the sentinel, replace it with a plain nil interface before returning. This is invisible to callers but makes the dequeue correct.

### 20.7 The interaction with finalizers

`sync.Pool` does not use finalizers. It cannot, because finalizers run after objects are unreachable, and the pool wants to preserve reachability of its cached values across a GC cycle (in the victim cache).

But there is a subtle interaction. If a user code path puts an object into a Pool and the object has a finalizer, then the finalizer will not run until *both* GCs have passed (because the Pool retains the reference through the victim cycle). This can cause user code to see longer-than-expected finalizer latencies for pooled objects.

For most pool use cases this is irrelevant (the cached objects are scratch buffers without finalizers). For cases where it matters, the workaround is to drain the pool explicitly (which is not actually possible through the public API — you have to design your code to not pool things with finalizers).

### 20.8 What happens when GOMAXPROCS = 1

With GOMAXPROCS = 1, the per-P array has a single entry. There are no other Ps to steal from in `getSlow`. The work-stealing loop in getSlow:

```go
for i := 0; i < int(size); i++ {
    l := indexLocal(locals, (pid+i+1)%int(size))
    ...
}
```

With `size = 1` and `pid = 0`, the loop runs once with `i = 0`, computing `(0+0+1) % 1 = 0`, which is the current P's own shared chain. So the loop "steals" from itself. The popTail will either succeed (because the local P pushed something there earlier and the private slot was full) or fail (because the chain is empty).

This is one of the few places where the algorithm degrades gracefully: with one P, the steal loop is redundant with the Get fast-path attempt, but it still terminates after one iteration and falls through to victim.

The victim path is similarly degenerate: a one-entry victim array is consulted in the same way.

The overall effect is that `sync.Pool` works correctly with GOMAXPROCS = 1 but does no useful work-stealing. The shared chain still helps when the private slot is full from a previous Put, but the steal loop never finds anything that the current P could not also find directly.

### 20.9 What happens with thousands of Ps

On a large machine with GOMAXPROCS = 256, the per-P array is 256 × 128 bytes = 32 KiB per pool. That is the memory footprint baseline of an unused pool.

The steal loop in getSlow becomes a 256-iteration walk in the worst case. Each iteration does an atomic CAS that may contend with the owning P's writes to its own headTail. If 256 other Ps are all stealing from the same victim simultaneously, the headTail of that victim is hot, and the CAS retry rate goes up. In practice this is rare because work-stealing distributes load — usually only a few Ps are stealing at any given moment.

The chain growth is independent of GOMAXPROCS. A heavily-used pool on one P will grow its chain regardless of how many other Ps exist.

### 20.10 Reading the assembly

If you compile sync/pool.go and dump the assembly for Get and Put, the hot paths are tiny.

The fast-path of Put compiles to something like:

```
MOVQ (g_m)(R14), RAX     ; load m from g
ADDQ $1, m_locks(RAX)    ; pin (procPin inlined)
MOVL g_p(R14), CX        ; load current P id
MOVQ p_local(R12), RDX   ; load pool.local
SHLQ $7, CX              ; multiply pid by 128 (sizeof poolLocal)
ADDQ CX, RDX             ; address of poolLocal
CMPQ private_typ(RDX), $0
JNE  pushHead_path
MOVQ x_typ(SP), RAX
MOVQ x_val(SP), RBX
MOVQ RAX, private_typ(RDX)
MOVQ RBX, private_val(RDX)
DECQ m_locks(RAX)        ; unpin
RET
```

Eleven instructions, no branches taken (in the common case), no atomic operations. That is the fast path.

The slow path goes through pushHead with a CAS retry, which adds at minimum a LOCK XADD on x86 for the headTail bump. Even in the slow path, no allocation happens until the chain has to grow.

### 20.11 Implications for benchmark interpretation

When you benchmark sync.Pool, the hot-path numbers are dominated by the cost of pinning, the cost of the type-pointer copy for the interface assignment, and on weaker memory models the cost of LDAR/STLR pairs. Typical timings on modern x86:

- A Put followed immediately by Get on the same goroutine: 15-25 ns.
- A Put on one P followed by a Get on another P: 50-100 ns, dominated by cross-core cache traffic for the victim's poolLocal.
- A Get that falls through to New: depends entirely on what New does; the pool overhead itself is the same 50-100 ns in the worst case.

These numbers explain why sync.Pool is most useful for objects that take much longer than 100 ns to allocate from scratch — things like large byte buffers, complex structs with many sub-allocations, or anything that involves zeroing more than a few cache lines.

For tiny objects (16-byte structs, integers), the pool overhead can exceed the allocation cost, and using a pool is a pessimization. Profile-driven decisions, not folklore, should govern when to introduce a pool.

### 20.12 The relationship between Pool and the runtime's mcache

The Go runtime has its own per-P object cache, the mcache, which is the foundation of the malloc fast path. mcache holds spans of free objects sorted by size class. When code calls `new(T)`, the allocator first looks in the mcache for a free object of the right size class.

Why then have sync.Pool at all? Because mcache caches *uninitialized memory*, whereas sync.Pool caches *initialized objects*. When you call `new(MyStruct)`, the allocator finds an unused slot in the mcache and zeros it. The zeroing is fast for small objects but expensive for large ones with many fields.

sync.Pool sidesteps the zeroing by handing back objects that were already in their post-use state. If you carefully reset the parts of the object you reuse (e.g., reset the length of a buffer to zero without freeing the backing array), then Get returns a hot, ready-to-use object with no zeroing.

The two caches complement each other: mcache prevents trips to the central allocator; sync.Pool prevents zeroing and initialization overhead. They share no internal state, but they share the same per-P structure (because both want to avoid cross-P contention).

### 20.13 Reading the commit history

The current implementation in pool.go is the result of about six years of incremental refinement. The key commits, all visible via `git log src/sync/pool.go`:

- The initial commit introduced a per-P design with a global mutex for slow paths.
- Around Go 1.6, the per-P arrays were padded to avoid false sharing.
- Around Go 1.13, the victim cache was added to mitigate post-GC allocation spikes (Bryan Mills, Russ Cox, Austin Clements, several CLs).
- Around Go 1.14, the poolChain replaced a single fixed-size queue, allowing growth under load.
- Around Go 1.18, the type signature changed from `interface{}` to `any` (purely cosmetic).
- Around Go 1.20, several memory-ordering fixes for ARM64 (Cherry Mui).

The implementation is mature. If you find a bug, expect it to be subtle.

### 20.14 An anti-pattern: pooling objects that hold pointers

A common pitfall: putting objects with non-trivial pointer content into a Pool causes those pointers to remain reachable across GC, retaining whatever the pointers point to.

Example: a `*bytes.Buffer` containing a 1 MiB byte slice. If you put it in a pool, the byte slice is kept alive (across one GC for sure, two GCs for the victim cycle) regardless of whether the program needs that data. The pool effectively delays GC for that 1 MiB.

The standard library's `fmt` package uses a Pool of `*pp` structs, each holding a buffer. The pp.free method, before Put, truncates its buffer to a maximum size and only Puts the struct back if it is under the limit:

```go
func (p *pp) free() {
    if cap(p.buf) > 64<<10 {
        return
    }
    p.buf = p.buf[:0]
    p.arg = nil
    p.value = reflect.Value{}
    p.wrappedErrs = nil
    ppFree.Put(p)
}
```

This pattern — "only pool small objects, drop large ones on the floor" — is the right way to avoid pool-induced memory retention. The Pool is allowed to drop entries at any time, so dropping them yourself when they exceed a budget is fine.

### 20.15 A note on `Pool.New`

The New function is the fallback for Get when the cache is empty. It is allowed to be nil, in which case Get returns nil. It is allowed to allocate, panic, block, do I/O — anything, because by the time New is called, the pool has unpinned.

The contract is that New must be safe to call from any goroutine. Typically New does a `new(T)` or similar and returns the result. More elaborate New functions can lazily compute capacity or initialize a sub-pool.

There is no way to express "give up and return nil instead of allocating" through the Pool API — if New is set, it will be called. Code that wants the "try the pool, accept nil if empty" semantics has to leave New unset and check for nil in the caller.

### 20.16 The 1.13 fix in detail

The two-generation cleanup was the most significant change to sync.Pool since its introduction. Before 1.13, every GC drained the pool. After 1.13, every GC moves contents from `local` to `victim` and only drops `victim`.

The fix's motivation was a class of bugs where high-throughput servers using Pool to recycle decode buffers would see latency spikes after every GC. The pattern was:

1. Server runs steady state, pool full of decode buffers.
2. GC happens. Pool empty.
3. Next thousand requests each call New, allocating fresh buffers.
4. Buffers get put back, pool refills.
5. Next GC. Repeat.

The latency spike in step 3 could push p99 latencies into the tens of milliseconds for a server that otherwise runs at sub-millisecond.

The 1.13 patch added the victim phase so that step 3 instead becomes "next thousand requests find cached buffers in the victim cache." The latency spike disappears because no allocations are needed.

The cost is the extra memory of one cycle's worth of buffers held in the victim cache. For most workloads this is acceptable; if it is not, the workaround is to make the pool smaller (which sync.Pool does not support directly — you would have to wrap it).

### 20.17 Pool's relationship to GC pacing

The pool's `localSize = 0` after cleanup matters for GC pacing because it means the pool's reachable heap drops to (nearly) zero at every GC. Then it grows again as the program runs. This sawtooth pattern in heap size is normal for pool-heavy programs.

The Go GC pacer uses a heuristic of "next GC when heap reaches 2x live heap at end of last GC." If a pool's contribution to "live heap" varies a lot between GCs, the pacer can over-shoot or under-shoot. In practice this is not a big issue because the pacer adapts.

The interaction is more relevant for programs that use both Pool and explicit memory management (e.g., manually managed pools of allocations). Mixing the two requires care.

### 20.18 A re-walk of the steal protocol

Let us re-walk steps 5-15 of the protocol with even more precision, this time focusing on the memory orderings.

Producer side, pushHead on dequeue d:

1. `atomic.LoadUint64(&d.headTail)` — load-acquire. We pair with any prior CAS by a consumer.
2. Compute head, tail. Check fullness.
3. Compute slot pointer.
4. `atomic.LoadPointer(&slot.typ)` — load-acquire. We pair with any prior atomic.StorePointer to typ by a consumer popTail.
5. If non-nil, return false. The slot is still held by a slow consumer.
6. Write slot.typ and slot.val with non-atomic stores via the `*any` reinterpretation.
7. `atomic.AddUint64(&d.headTail, 1<<dequeueBits)` — atomic add, full barrier. We publish.

Consumer side, popTail on dequeue d:

1. `atomic.LoadUint64(&d.headTail)` — load-acquire. We pair with the producer's atomic.AddUint64.
2. Compute head, tail. Check empty.
3. `atomic.CompareAndSwapUint64(&d.headTail, ptrs, ptrs2)` — CAS with full barrier. We claim the slot.
4. Read slot.val and slot.typ via the `*any` reinterpretation. This sees the producer's pre-publish writes because the load-acquire at step 1 (or the CAS at step 3) synchronized with the producer's add.
5. Write `slot.val = nil` non-atomically.
6. `atomic.StorePointer(&slot.typ, nil)` — store-release. We pair with the producer's next attempt to push to this slot, which does load-acquire on typ.

The transitive synchronization chain: producer push at time T1 publishes the slot via headTail-add. Consumer popTail at time T2 sees the publication, reads, then publishes the slot release via typ-nil-store. Producer's next push to this slot at time T3 sees the release via the typ-load-acquire.

If any of these orderings were weaker (e.g., relaxed instead of release on the typ-nil-store), a producer on a relaxed-memory architecture could see typ-nil but still see the old val, and write its new val into a slot whose old val it is racing with. The bug would manifest as a goroutine retrieving a stale or corrupted interface value.

### 20.19 The lifecycle of a poolChainElt

A poolChainElt is allocated by `poolChain.pushHead` when the current head dequeue is full. It is freed (eligible for GC collection) when both the producer has moved past it and the consumer has retired it via the popTail walk.

Let us trace one through. Suppose the chain currently has a single dequeue d0 of size 8 with head=8, tail=0 — full. The producer calls pushHead:

1. `c.head == d0`. Try `d0.pushHead(val)`. Returns false (full).
2. newSize = 16. Allocate d1 = &poolChainElt{prev: d0, vals: make([]eface, 16)}.
3. `c.head = d1` (plain assignment).
4. `storePoolChainElt(&d0.next, d1)` — atomic store. Now consumers walking from tail can find d1.
5. `d1.pushHead(val)` — succeeds, head=1, tail=0 on d1.

Now suppose a consumer calls popTail. The chain-level popTail loads `c.tail`, which is still d0 (it has not moved). It loads `d0.next` — atomic load, which sees d1 (because we used atomic store in step 4).

The consumer calls `d0.popTail()`. The dequeue d0 has head=8, tail=0 — 8 entries to take. CAS to bump tail to 1, read slot 0, return. The consumer also publishes typ-nil on slot 0.

Other consumers may continue popping from d0 until tail = 8, at which point d0 is empty. The next popTail iteration will:

1. Load d0.next — sees d1 (non-nil).
2. Try d0.popTail() — fails (empty).
3. d2 (the local variable, which is d0.next) is non-nil, so d0 is permanently drained.
4. CAS c.tail from d0 to d1. If success, also store d1.prev = nil.
5. Loop with d = d1.

After step 4 succeeds, no one else can find d0 from c.tail. The producer's `c.head` is d1 (not d0), so the producer cannot find d0 either. The only remaining reference is from d0 itself to d1 via d0.next, but that is a forward link and does not keep d0 reachable — the producer never walks forward from d0, and consumers have advanced past it.

Wait, but the popHead walk does walk backward from head via prev. Could it reach d0? Let us check. popHead starts at c.head = d1 and walks via prev: d1.prev was set to nil in step 4 (the popTail that retired d0). So popHead stops at d1.

What about a popHead that started before the prev-nil store? Its local variable holds d1.prev which was d0 at the time. It would walk to d0 and try to popHead it. d0 has head=8, tail=8 in headTail (the head was set when the producer pushed the 8th value; the tail was advanced by consumers to 8). The popHead loop sees head==tail, returns nil, then the loop ends because d0.prev is whatever the producer set when d0 was created (probably nil, since d0 was the original).

So popHead returns nothing useful from d0, but no corruption occurs. The popHead caller will eventually return nil and fall through to getSlow.

Once both `c.tail != d0` and `d1.prev != d0`, the only references to d0 are from local variables on goroutine stacks that started a walk before the retirement. As soon as those goroutines finish their walks, d0 becomes unreachable and the GC can collect it.

This is exactly the kind of reasoning you would do for a hand-rolled lock-free data structure in C++. Go's GC simplifies it because you do not have to manually free anything; you just have to ensure unreachability.

### 20.20 A note on the comment "It must only be called by a single producer"

Several methods in poolqueue.go have a comment "must only be called by a single producer." Specifically pushHead and popHead on poolDequeue. These constraints are not enforced by the type system or by runtime checks.

What enforces them is the surrounding architecture. The owning P is determined by `pin`, and `pin` returns the same `*poolLocal` to all callers on that P. As long as the producer is identified by "the P pinned during the call", and as long as one pin call is in flight at a time, there is only one producer.

Could two goroutines on the same P be in the producer code path at the same time? In principle yes — goroutine A is in the middle of pushHead, gets preempted... no wait, it cannot be preempted while pinned. So goroutine A holds the P exclusively for the duration of the pushHead. Goroutine B cannot run on the same P until A unpins.

That guarantee is what makes "must only be called by a single producer" hold. If procPin did not actually prevent preemption, the whole design would unravel.

### 20.21 The interaction with `runtime.GC()`

Calling `runtime.GC()` explicitly triggers a stop-the-world garbage collection. The `poolCleanup` callback runs as part of every GC, including manual ones. So if your code does `runtime.GC()` in a loop, the pool gets drained twice per loop iteration.

This is sometimes used in tests to force the pool to clear. For example, the Go runtime's own pool_test.go contains tests that call `runtime.GC()` to verify the two-generation behavior.

In production code, calling `runtime.GC()` is almost always a mistake. The Go GC pacer is much better at scheduling collections than humans are. The pool's cleanup will run on the natural GC cadence.

### 20.22 Sizing the chain growth

The initial dequeue size is 8 entries. Each subsequent dequeue is double the size of the previous, capped at `dequeueLimit` which is `(1 << 32) / 4` = about a billion entries on 64-bit.

The doubling means after N growths the total capacity is 8 + 16 + 32 + ... + 8 × 2^N = 8 × (2^(N+1) - 1), which grows geometrically. After 10 growths the chain has about 16K total slots; after 20 growths about 16M.

In practice no pool grows beyond a few dequeues. A pool that holds millions of values is misuse. The geometric growth is there to make pushHead amortized O(1) even in pathological cases.

The total memory of a chain of N dequeues is about 8 × 2^N × sizeof(eface) = 8 × 2^N × 16 bytes for the values, plus a small constant for the poolChainElt overhead. So a chain with 8 dequeues (capacity 1024) costs ~16 KiB per P, times GOMAXPROCS.

### 20.23 Why the dequeue is the unit of growth

An alternative design would be: one fixed-size dequeue per P, and overflow goes to a global central queue (with a lock). The implementation chose instead to grow per-P chains. Why?

The reason is contention. A global central queue would be a single point of contention for all overflowing Ps. Even with a lock-free implementation, the cache line holding the central queue's head and tail would be hot across all cores. The chain-of-dequeues design keeps everything per-P, so growth on one P does not affect another.

The cost is that under heavy use, each P's chain can grow quite large independently. If your workload involves bursty Puts on a few Ps and rare Gets, those Ps will have multi-MiB chains while others have nothing. The memory is unbalanced.

The unbalanced memory is mitigated by GC cleanup: at every GC, each P's chain is reset (well, demoted to victim, then dropped). So the unbalance is at most a single GC cycle's worth of accumulation.

### 20.24 Reading allocation profiles

If you profile a program with `pprof -alloc_objects`, allocations through sync.Pool fast path show up as zero. The fast path does not allocate; it returns a cached object. So pprof attributes the allocation cost to whichever code path first put the object into the pool (via New, typically).

This makes it slightly harder to profile pool-heavy code. The misses (allocations via New) are accounted to New's call site, not to the Get caller. You see the cost of the misses but not the savings of the hits.

To measure pool hit rate, you would need to instrument Get manually — count calls and count cases where the returned value was not allocated via New. There is no built-in way.

### 20.25 The performance budget for Get and Put

Let us put the per-operation cost into perspective.

On modern x86, the fastest path (Get with private slot full, or Put with private slot empty) is about 15 ns. This is dominated by:

- procPin: ~3 ns (an indirect call to the runtime, plus an increment).
- Loading p.local and p.localSize: ~2 ns from L1 cache.
- The poolLocal address computation: ~1 ns.
- The private slot access: ~2 ns.
- procUnpin: ~3 ns.
- Function call overhead for Get itself: ~4 ns.

The shared-chain path adds another 20-30 ns even on the fast subpath (popHead with no contention), dominated by the LOCK XADD or LOCK CMPXCHG.

The cross-P steal path adds 50-100 ns, dominated by the cross-core cache traffic to load the other P's headTail.

The victim path is similar to the steal path.

For a pool to be a net win, the work being cached must take more than maybe 50 ns to redo. For a 32-byte zero-allocated struct, redo cost is about 10 ns, so a pool would hurt. For a 4 KiB byte slice (where redo is `make([]byte, 4096)` plus zeroing 64 cache lines), redo cost is several hundred ns, so a pool helps significantly.

### 20.26 The "thundering herd" diagram

Picture a timeline for a server pre-Go-1.13:

```
T0:  [pool full of buffers]    requests serviced at 100us
T1:  [GC starts and ends, pool drained]
T2:  request arrives, Get returns nil, New allocates    request takes 2ms (allocation + zeroing)
T3:  request arrives, Get returns nil, New allocates    request takes 2ms
T4:  request arrives, Get returns nil, New allocates    request takes 2ms
...  (continues for many requests)
T100: pool is full again, requests back to 100us
```

The "thundering herd" is the burst of 2ms requests between T2 and T100. Each individual request is slow, and the queue backs up, and tail latencies spike.

Post-Go-1.13:

```
T0:  [pool full of buffers in local]    requests serviced at 100us
T1:  [GC: local moves to victim, local is empty]
T2:  request arrives, Get misses local but hits victim    request takes 120us (tiny overhead for the extra walk)
T3:  request arrives, Get misses local but hits victim    request takes 120us
T4:  Get; the object retrieved is now in local again
T5:  request arrives, Get hits local    request takes 100us
...
```

The post-GC latency spike is gone. The total work is the same, but distributed evenly instead of concentrated.

### 20.27 Inspecting a Pool in a debugger

If you attach a debugger to a running Go program and inspect a Pool, you cannot easily see what is in it. The internal pointers are unsafe and the dequeue contents require traversal logic that debuggers do not implement out of the box.

One useful trick: `runtime.GC()` followed by inspecting `runtime.MemStats` before and after. If memory drops significantly, a lot was in pools.

Another trick: in Go 1.19+, the runtime has metrics for pool churn (`/sync/mutex/wait/total:seconds` and friends), but specific pool sizes are not exposed.

For production observability, the best you can do is wrap your pool usage in counters: increment a hit counter when Get returns non-nil-without-New, increment a miss counter when New is called.

### 20.28 A common mistake: storing pointers to stack-allocated values

If a user accidentally takes the address of a stack-allocated value and puts the resulting pointer in a pool, undefined behavior follows. The stack frame may be reused for other purposes, and the next Get could return a pointer to garbage.

This is not specific to Pool; it is a general unsafe-Go pitfall. But Pool makes it slightly easier to trip over because the consumer of the pointer (the next Get) is often far from the producer (the original Put).

Example of the bug:

```go
func bad() {
    var buf bytes.Buffer
    pool.Put(&buf)  // bad: &buf points to the current stack frame
}
```

After `bad` returns, the stack frame is invalidated. Any subsequent Get returning `&buf` is reading garbage.

The fix is to use `new(bytes.Buffer)` or `&bytes.Buffer{}` allocated on the heap (Go's escape analysis will move it for you if you return it). The Go compiler does not warn about this case because escape analysis does not see through the unsafe.Pointer arithmetic in Pool.

### 20.29 The implementation of `fastrandn`

In the Put race-detector branch, we saw `fastrandn(4)`. This is a runtime function exposed to sync via `//go:linkname`. Its implementation in the runtime is a fast PRNG that does not require any synchronization.

The function uses a per-M random state, mixed with a multiply-shift to bias the output. It is much faster than `math/rand.Intn` because it does not lock, but it is also much lower quality. For random sampling in fast paths it is appropriate; for cryptography or distribution-sensitive applications it is not.

The choice of `fastrandn(4)` for "drop 25 percent" is somewhat arbitrary. The intent is "some random subset, often enough that bad code will fail under -race in a reasonable number of iterations." 25 percent satisfies that.

### 20.30 Final notes on portability

The pool's atomic operations are all in `sync/atomic`. The package supports all the platforms Go supports. On older 32-bit ARM systems, 64-bit atomic operations may go through a runtime helper because the hardware does not provide them natively. This is slower than the native instruction on x86 or ARM64 but still correct.

The `unsafe.Sizeof` computations in poolLocal padding are evaluated at compile time. They produce different values on 32-bit and 64-bit platforms because `poolLocalInternal` is smaller on 32-bit (interface and chain pointers are 4 bytes each instead of 8). The padding ensures `poolLocal` is 128 bytes on either platform.

The `dequeueBits` constant is 32 on 64-bit and 16 on 32-bit. On 32-bit, the packed headTail is a uint32, limiting each dequeue to about 16K indices. This is enough for any realistic per-P pool.

### 20.31 Comparison with other languages' pools

For context, it is worth noting how sync.Pool differs from analogous facilities in other ecosystems.

Java's object pools (most famously Apache Commons Pool) are general-purpose and feature-rich: configurable max size, idle-timeout eviction, validation predicates, exhaustion policies (block, fail, grow). They are also significantly slower per-operation than sync.Pool because the API surface forces general-purpose locking. A typical Apache Commons borrow-return cycle is hundreds of nanoseconds even on the fast path.

The .NET ArrayPool<T> is closer in spirit: tier-based per-thread caches with size-class buckets, similar work-stealing semantics. The implementation is also lock-free on the hot path and uses thread-local storage analogously to Go's per-P. ArrayPool exposes a more typed API (always returns T[]) and includes optional shared/large pools.

Rust's `crossbeam` crate provides per-thread caches via thread-local storage with similar work-stealing semantics. Rust's ownership system gives stronger compile-time guarantees about non-sharing, but the runtime semantics are similar.

C++ has no standard pool. Various libraries (Boost.Pool, custom allocators) provide pool semantics, often with stronger type safety but without per-thread sharding by default.

The closest analog to sync.Pool in concept is probably TBB's enumerable_thread_specific, which is a per-thread sharded container that allows aggregation. But TBB does not have the GC-driven cleanup; pools live until explicitly destroyed.

Go's pool is unusual in three respects:

1. It is tightly integrated with the GC, allowing automatic eviction without explicit management.
2. It uses GOMAXPROCS-based sharding rather than per-thread, which is correct for green-threaded runtimes but unusual.
3. It exposes a minimal interface (Get, Put, New) and intentionally lacks size controls, statistics, or eviction policies.

The minimalism reflects a deliberate philosophical choice: in Go, the runtime should manage memory, not the user. sync.Pool is a hint to the runtime about which objects to retain across allocations, but the runtime makes the final decision about when to drop them.

### 20.32 Test coverage of the pool

The Go standard library tests for sync.Pool are in `src/sync/pool_test.go` and `src/sync/poolqueue_test.go`. The tests cover:

- Basic Get/Put round-trip.
- Concurrent Get/Put from many goroutines.
- GC interaction: explicit `runtime.GC()` calls verify the two-generation behavior.
- Pinning: tests that the pool functions correctly across GOMAXPROCS changes.
- Race detector: tests that exercise the typ-nil handshake on the dequeue.
- Stress tests: high-volume Put/Get to exercise the chain growth.

The tests are not exhaustive in the formal sense — there is no model checker verifying the lock-free protocol. The correctness rests on careful reasoning by the authors and on the absence of bugs found in the wild over a decade of heavy use.

If you want to extend the pool with new behavior, the tests will catch most basic mistakes but not memory-ordering issues on weak architectures. For those, manual review against the order-of-operations described in section 17 and 18 is the only defense.

### 20.33 Tracing a pool operation with go tool trace

Run a program with tracing enabled (`runtime.StartTrace`, then `go tool trace`) and you can see the goroutines, the Ps, and the GC cycles, but not the pool operations themselves. The pool is invisible to the tracer.

To trace pool operations specifically, you would need to either:

- Modify the standard library to emit trace events at Get and Put. This is straightforward (the runtime/trace package supports custom events) but requires building a custom Go toolchain.
- Instrument the user-level wrapper around Pool to emit events at each call. This catches the user-visible behavior but not the internal steal paths.

In practice, when debugging pool issues, the most useful tool is `pprof` with the `-base` flag to diff two profiles taken at different times. A growing pool will show as growing memory in the relevant call sites.

### 20.34 Putting it all together with a concrete server example

Consider an HTTP server that decodes JSON request bodies. Each request needs a `*json.Decoder` and a backing buffer.

Without a pool:

```go
func handle(w http.ResponseWriter, r *http.Request) {
    dec := json.NewDecoder(r.Body)
    var req MyRequest
    if err := dec.Decode(&req); err != nil { ... }
    ...
}
```

This allocates a fresh decoder per request. At 10K requests per second, that is 10K allocations per second, each touching internal state of the decoder.

With a pool:

```go
var decoderPool = sync.Pool{
    New: func() any { return new(json.Decoder) },
}

func handle(w http.ResponseWriter, r *http.Request) {
    dec := decoderPool.Get().(*json.Decoder)
    defer decoderPool.Put(dec)
    dec.Reset(r.Body)  // hypothetical; json.Decoder lacks a Reset
    var req MyRequest
    if err := dec.Decode(&req); err != nil { ... }
    ...
}
```

(In practice json.Decoder lacks a Reset method, so this example does not actually work; you would have to wrap or substitute. But the pattern is illustrative.)

The fast-path savings: about 200 ns of allocation cost per request (the decoder struct is ~100 bytes, but the allocation also initializes several pointers). Over 10K requests per second, that is 2 ms of CPU per second saved, or 0.2% of one core. Not huge.

The latency benefit: zero allocations per request means the goroutine never triggers a GC scavenge for this code path. In a high-concurrency server, that reduces tail latency on individual requests by ~10us.

The memory cost: each pool entry holds onto its decoder's internal buffers, which can grow to a few KiB. With per-P chains accumulating, total pool memory might reach 10s of MiB on a busy server with many Ps.

The verdict: pool the decoder if your tail latency matters; do not bother if the server is throughput-bound and untreated by GC.

### 20.35 What sync.Pool does not do

To close the tour, let us be explicit about non-features. sync.Pool:

- Does not provide LIFO or FIFO ordering. The work-stealing path can return any object.
- Does not provide an upper bound on the number of pooled objects.
- Does not provide a Drain method.
- Does not call a destructor when objects are dropped at GC.
- Does not detect or prevent double-Puts of the same object.
- Does not check that Put's argument matches the type returned by New.
- Does not provide per-pool statistics (hit rate, miss rate, current size).

If any of these properties are required, sync.Pool is not the right tool. The right tool is usually a custom pool built around channels or a fixed-size ring buffer.

The minimalism of the API is intentional. Any additional feature would either compromise the contention-freedom of the hot path or compromise the freedom to drop entries at GC. The Go authors have repeatedly chosen the current minimal surface over more elaborate alternatives.

## Closing notes

You have now walked the entirety of `src/sync/pool.go` and `src/sync/poolqueue.go`. The total source is just over six hundred lines, of which perhaps two hundred are comments, but every line is load-bearing. The design rests on five orthogonal mechanisms that we have seen:

The per-P slice with cache-line padding ensures that the common case of Get-Put on the same goroutine touches no shared cache lines.

The single `private` slot per P captures the "ping-pong" case where one goroutine repeatedly Gets and Puts the same kind of object, avoiding any chain operations.

The single-producer multi-consumer ring buffer (`poolDequeue`) with packed atomic head and tail enables work-stealing from any P with one CAS per steal.

The dynamically growing chain of dequeues (`poolChain`) lets each P's shared cache scale up under load without any prealloc cost for pools that stay small.

The two-generation cleanup (`local` + `victim`) cooperates with the runtime garbage collector to amortize cache invalidation across two GC cycles, avoiding post-GC allocation spikes.

Each of these mechanisms is independently correct. The composition is what makes sync.Pool fast under almost every realistic workload, while still being safe to drop entries at any time. If you remember one thing from this page, remember that everything is in service of two contradictory goals: zero contention on the hot path, and zero retention across GC. The two-generation chain-of-rings design is the smallest configuration of code that satisfies both.

[← Back](../)
