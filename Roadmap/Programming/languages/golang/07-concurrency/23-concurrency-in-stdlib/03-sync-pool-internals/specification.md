---
layout: default
title: sync.Pool Internals — Specification
parent: sync.Pool Internals
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/03-sync-pool-internals/specification/
---

# sync.Pool Internals — Specification

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [The `sync.Pool` Godoc](#the-syncpool-godoc)
3. [The Two-Generation Victim Cache Proposal](#the-two-generation-victim-cache-proposal)
4. [Runtime Cleanup Hook Contract](#runtime-cleanup-hook-contract)
5. [Memory Model Guarantees of Get and Put](#memory-model-guarantees-of-get-and-put)
6. [`poolDequeue` Algorithm Reference](#pooldequeue-algorithm-reference)
7. [Type Layout Constraints](#type-layout-constraints)
8. [References](#references)

---

## Introduction

This file collects the *normative* statements about `sync.Pool` — the godoc, the design CL, the runtime hook contract, and the memory model implications — and pairs them with line citations into the Go source tree (`go1.22`). It is the file you consult when a code reviewer or interviewer says "but the docs say…" and you want to be sure.

All citations are paraphrased for brevity and clarity; the original sources are linked at the bottom.

---

## The `sync.Pool` Godoc

The package documentation in `src/sync/pool.go:1-58` says, in essence:

> Pool is a set of temporary objects that may be individually saved and retrieved.
>
> Any item stored in the Pool may be removed automatically at any time without notification. If the Pool holds the only reference when this happens, the item might be deallocated.
>
> A Pool is safe for use by multiple goroutines simultaneously.
>
> Pool's purpose is to cache allocated but unused items for later reuse, relieving pressure on the garbage collector. That is, it makes it easy to build efficient, thread-safe free lists. However, it is not suitable for all free lists.
>
> An appropriate use of a Pool is to manage a group of temporary items silently shared among and potentially reused by concurrent independent clients of a package. Pool provides a way to amortize allocation overhead across many clients.
>
> An example of good use of a Pool is in the fmt package, which maintains a dynamically-sized store of temporary output buffers. The store scales under load (when many goroutines are actively printing) and shrinks when quiescent.
>
> On the other hand, a free list maintained as part of a short-lived object is not a suitable use for a Pool, since the overhead does not amortize well in that scenario. It is more efficient to have such objects implement their own free list.

The key normative phrases:

| Phrase | Meaning for users |
|--------|-------------------|
| "may be removed automatically at any time" | You cannot use a Pool as durable storage. Anything you `Put` may be gone before your next `Get`. |
| "if the Pool holds the only reference when this happens, the item might be deallocated" | The GC is the agent that removes items. You must not keep references after `Put`. |
| "safe for use by multiple goroutines simultaneously" | All methods (`Get`, `Put`) are concurrent-safe. |
| "scales under load… shrinks when quiescent" | Per-P caching makes scaling automatic; GC handles shrinking. |
| "not suitable for all free lists" | Short-lived per-object free lists do better with a hand-rolled list. |

### The `New` field

`src/sync/pool.go:48-58`:

> New optionally specifies a function to generate a value when Get would otherwise return nil. It may not be changed concurrently with calls to Get.

This makes `New` a *one-shot configuration field*. The usual pattern:

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}
```

If `New` is nil, `Get` returns `nil` when the pool is empty.

### `Get` and `Put` signatures

```go
func (p *Pool) Get() any
func (p *Pool) Put(x any)
```

The `any` (formerly `interface{}`) typing forces a type assertion at the call site. There is no generic `sync.Pool[T]` (yet); a proposal (issue 47657) exists but has not landed.

---

## The Two-Generation Victim Cache Proposal

The 2-cache design was introduced in Go 1.13 via CL 166961, which closes issue 22950 (*sync: Pool does not shrink well under load*).

### The problem before Go 1.13

Before 1.13, `runtime_registerPoolCleanup` simply *cleared* every pool's local on every GC. The effect: a program that allocated heavily, GC'd, then immediately allocated again, would see a giant allocation cliff because every pooled object had just been thrown away. In a tight server loop with frequent GCs, the pool delivered close to zero benefit.

From the CL description:

> Currently, every Pool is completely cleared at the start of each GC. This is a problem for heavy users of Pool, because it causes an allocation spike immediately after every GC, which hurts both CPU (re-allocation cost) and tail latency (the spike concentrates work).
>
> This CL fixes the problem by introducing a *victim cache*: instead of clearing the pool at the start of a GC, we shift its contents into a victim cache and clear the victim cache from the *previous* GC. Items in the victim cache survive one full GC cycle before being released.

### Lifecycle in the 2-cache scheme

```
Time:        GC0 -------- GC1 -------- GC2 -------- GC3
local:       A      put→  B      put→  C      put→  D
victim:      -            A            B            C
released:    -            -            A            B
```

A value `Put` during the GC0→GC1 window:
- Lives in `local` until GC1
- Is moved to `victim` at GC1
- Is released at GC2 (replaced by the next generation)

So pooled items survive **between 1 and 2 GC cycles** depending on when they entered the pool. Frequent users of `Get` will refresh the local cache before GC2, so in practice the steady-state hit rate is high.

### Source reference

`src/sync/pool.go:268-303` (`poolCleanup`):

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

This is the entire GC integration. It runs *with the world stopped*, so no synchronization is needed inside the function itself.

---

## Runtime Cleanup Hook Contract

The hook is registered via `runtime_registerPoolCleanup`, declared in `src/sync/pool.go:312`:

```go
//go:linkname poolCleanup
func poolCleanup()

func init() {
    runtime_registerPoolCleanup(poolCleanup)
}
```

The runtime side, in `src/runtime/mgc.go`, declares:

```go
// sync_runtime_registerPoolCleanup is called by sync.init.
//go:linkname sync_runtime_registerPoolCleanup sync.runtime_registerPoolCleanup
func sync_runtime_registerPoolCleanup(f func()) {
    poolcleanup = f
}
```

And `clearpools` (in `src/runtime/mgc.go`) calls `poolcleanup` once per GC cycle, with the world stopped.

### Contract summary

| Aspect | Requirement |
|--------|-------------|
| When called | Once per GC cycle, with the world stopped. |
| What it must not do | Allocate; block; call any runtime function that can stop the world (re-entrancy). |
| What it must do | Mutate pool state to drop one generation of cached items. |
| Goroutine identity | Runs on the GC's coordinator thread, not on any user goroutine. |

The "must not allocate" rule is why `poolCleanup` walks pool linked lists rather than constructing new slices: any allocation during a stop-the-world phase would deadlock.

---

## Memory Model Guarantees of Get and Put

The Go memory model says nothing directly about `sync.Pool` — there is no entry in <https://go.dev/ref/mem>. But the implementation establishes the following observable guarantees:

1. **`Put(x)` happens-before any subsequent `Get` that returns `x`.** This is established by the atomic CAS on `poolDequeue.headTail` (release-store on Put-side push, acquire-load on Get-side pop) and, for the local-private slot, by the fact that `pin()` disables preemption so the producer and consumer are the same goroutine.

2. **Putting `x` does *not* prevent `x` from being collected.** If you keep no other reference and the next `Get` returns a different value, `x` may have been freed.

3. **Concurrent `Put` from different goroutines does not require external synchronization.** All necessary CAS and atomic operations live inside the pool.

4. **There is no FIFO or LIFO ordering guarantee.** A `Get` may return the most recently `Put` value, an older value, a `victim` value, or a freshly `New`-constructed value. The user must not depend on which.

---

## `poolDequeue` Algorithm Reference

The ring buffer in `src/sync/poolqueue.go` is a *single-producer, multi-consumer* lock-free queue. The producer (owner of the `P`) pushes to the head; consumers (the owner popping or other Ps stealing) pop from either end.

### Packed head/tail

`src/sync/poolqueue.go:13-31`:

```go
type poolDequeue struct {
    // headTail packs together a 32-bit head index and a 32-bit
    // tail index. Both are indexes into vals modulo len(vals)-1.
    //
    // tail = index of oldest data in queue
    // head = index of next slot to fill
    //
    // Slots in the range [tail, head) are owned by consumers.
    // A consumer continues to own a slot outside this range until
    // it nils the slot, at which point ownership passes to the producer.
    headTail atomic.Uint64

    vals []eface
}
```

The `unpack` and `pack` helpers (lines 33-45):

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
    return (uint64(head) << dequeueBits) | uint64(tail&mask)
}
```

This trick — encoding two 32-bit counters into a single 64-bit atomic word — lets the dequeue update both indices with a single CAS, which is cheaper and simpler than two separate atomics.

### `pushHead`

`pushHead` is called only by the producer. It can be lock-free without contention because it is the sole writer of `head`. It loads `headTail`, checks fullness, writes the new value to `vals[head%n]`, and stores the incremented head:

```go
func (d *poolDequeue) pushHead(val any) bool {
    ptrs := d.headTail.Load()
    head, tail := d.unpack(ptrs)
    if (tail+uint32(len(d.vals)))&(1<<dequeueBits-1) == head {
        // Queue is full.
        return false
    }
    slot := &d.vals[head&uint32(len(d.vals)-1)]
    // ... write val into slot ...
    d.headTail.Add(1 << dequeueBits)
    return true
}
```

### `popHead`

`popHead` is called only by the producer (the owner of the P) to pop from the same end it pushes to — LIFO from the producer's viewpoint. It CAS's the head down, then clears the slot.

### `popTail`

`popTail` is called by *consumers* (stealers from other Ps). It CAS's the tail up. Multiple stealers may race; only one wins. The slot is cleared after the successful CAS, transferring ownership back to the producer.

This is the only function with real contention; it is also rarely called in well-tuned applications.

---

## Type Layout Constraints

### `poolLocal` padding

`src/sync/pool.go:74-78`:

```go
type poolLocal struct {
    poolLocalInternal

    // Prevents false sharing on widespread platforms with
    // 128 mod (cache line size) = 0 .
    pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}
```

The pad ensures `poolLocal` is a multiple of 128 bytes, the worst case adjacent-line prefetcher cache footprint on Intel CPUs (two consecutive 64-byte lines). Without this, two Ps' locals could share a single L2 line and cause RFO ping-pong on every `Put`.

### `poolDequeue.vals` length

`vals` is always a power of two so that `head&uint32(len(vals)-1)` is a bit-and instead of a modulo. The smallest size is 8; the largest is 2^30.

---

## References

- `src/sync/pool.go` (Go 1.22 source)
- `src/sync/poolqueue.go` (Go 1.22 source)
- `src/runtime/mgc.go` — `clearpools` and `poolcleanup`
- Go issue 22950: <https://github.com/golang/go/issues/22950>
- CL 166961: <https://go-review.googlesource.com/c/go/+/166961>
- Dmitry Vyukov's original "non-blocking concurrent queue" — the inspiration for `poolDequeue`: <https://www.1024cores.net/home/lock-free-algorithms/queues/non-intrusive-mpsc-node-based-queue>
- Bryan C. Mills, *Rethinking Classical Concurrency Patterns* (GopherCon 2018) — discusses Pool tradeoffs
- Issue 47657 (generic Pool proposal): <https://github.com/golang/go/issues/47657>
