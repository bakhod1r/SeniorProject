# Channel Runtime Behaviour — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `sudog` Struct and Allocator](#the-sudog-struct-and-allocator)
3. [`chansend` Walkthrough at Source Level](#chansend-walkthrough-at-source-level)
4. [`chanrecv` Walkthrough at Source Level](#chanrecv-walkthrough-at-source-level)
5. [`selectgo` Internals](#selectgo-internals)
6. [Lock Acquisition Order in `selectgo`](#lock-acquisition-order-in-selectgo)
7. [Memory Model Implications](#memory-model-implications)
8. [Scheduler Interactions](#scheduler-interactions)
9. [Cross-Stack Writes and the GC](#cross-stack-writes-and-the-gc)
10. [Performance Characterisation](#performance-characterisation)
11. [Pathologies and Worst Cases](#pathologies-and-worst-cases)
12. [Summary](#summary)

---

## Introduction

At the senior level you are expected to read `runtime/chan.go` and `runtime/select.go` and not just understand the control flow, but explain to other engineers why each decision was made. This page is the systematic walkthrough that turns "I have read the source" into "I can defend each line."

We assume you have read the junior and middle pages. Pseudocode here matches the actual source modulo small simplifications. References use Go 1.22 line numbers approximately; the structure has been stable since at least Go 1.16.

---

## The `sudog` Struct and Allocator

A `sudog` ("pseudo-G") represents a goroutine parked on a synchronisation primitive — channel, mutex, condvar, wait-group. Multiple sudogs can exist per goroutine (e.g., when a goroutine is parked on several channels in a `select`). The struct is defined in `runtime/runtime2.go`:

```go
type sudog struct {
    g *g                 // the parked goroutine

    next *sudog          // doubly linked
    prev *sudog
    elem unsafe.Pointer  // address of the data element (sender's value, receiver's destination)

    acquiretime int64    // for blocked-sync profiling
    releasetime int64
    ticket      uint32   // semroot treap insertion
    isSelect    bool     // part of a select
    success     bool     // true if recv/send completed, false on close
    parent      *sudog   // semaRoot treap parent
    waitlink    *sudog   // g.waiting list
    waittail    *sudog
    c           *hchan   // channel back-pointer
}
```

Size: ~88 bytes on 64-bit. There is a per-P cache of sudogs to avoid hitting the central allocator on hot paths:

```go
// runtime/proc.go
func acquireSudog() *sudog {
    mp := acquirem()
    pp := mp.p.ptr()
    if len(pp.sudogcache) == 0 {
        lock(&sched.sudoglock)
        for len(pp.sudogcache) < cap(pp.sudogcache)/2 && sched.sudogcache != nil {
            s := sched.sudogcache
            sched.sudogcache = s.next
            s.next = nil
            pp.sudogcache = append(pp.sudogcache, s)
        }
        unlock(&sched.sudoglock)
        if len(pp.sudogcache) == 0 {
            pp.sudogcache = append(pp.sudogcache, new(sudog))
        }
    }
    n := len(pp.sudogcache)
    s := pp.sudogcache[n-1]
    pp.sudogcache[n-1] = nil
    pp.sudogcache = pp.sudogcache[:n-1]
    if s.elem != nil {
        throw("acquireSudog: found s.elem != nil")
    }
    releasem(mp)
    return s
}
```

Two-tier cache:

1. Per-P slice `pp.sudogcache`, no lock needed. Refilled in bulk from the central cache.
2. Central freelist `sched.sudogcache`, behind `sched.sudoglock`.

This means a channel operation on a hot path that parks (and so allocates a sudog) is essentially a slice pop. No GC allocation in the common case.

### `g.waiting` chain

A goroutine in a `select` will be on multiple channels' wait queues, hence multiple sudogs. They are linked through `sudog.waitlink` starting at `g.waiting`. When the goroutine wakes via one channel, the runtime walks `g.waiting`, removing each sudog from its respective wait queue. This cleanup must happen with each channel's lock held — hence the `selectgo` post-wake loop also acquires locks in `lockorder`.

---

## `chansend` Walkthrough at Source Level

We walk through `runtime.chansend` line by line, focusing on the parts not covered in middle.

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    if c == nil {
        if !block {
            return false
        }
        gopark(nil, nil, waitReasonChanSendNilChan, traceBlockForever, 2)
        throw("unreachable")
    }
```

`gopark` with `nil` `unlockf` and `nil` lock pointer means: park without any cleanup. The goroutine never wakes (since nobody can call `goready` on it — there is no channel to signal). This is intentional: it lets `select` use `nil` channels as "disabled cases" by parking on them but never expecting them to fire.

```go
    if debugChan {
        print("chansend: chan=", c, "\n")
    }

    if raceenabled {
        racereadpc(c.raceaddr(), callerpc, abi.FuncPCABIInternal(chansend))
    }

    // Fast path: check for failed non-blocking operation without acquiring the lock.
    if !block && c.closed == 0 && full(c) {
        return false
    }
```

The non-blocking fast path. `full(c)` is:

```go
func full(c *hchan) bool {
    if c.dataqsiz == 0 {
        // Unbuffered: full iff no receiver waiting.
        return c.recvq.first == nil
    }
    // Buffered: full iff qcount == dataqsiz.
    return c.qcount == c.dataqsiz
}
```

Reading `c.recvq.first` and `c.qcount` without the lock is racy. The runtime accepts the race: for non-blocking, a stale "full" reading is harmless (the default fires instead of the operation). The race detector (raceread above) does not complain because the runtime marks this specific access as "happens-before" via the channel's race lock.

```go
    var t0 int64
    if blockprofilerate > 0 {
        t0 = cputicks()
    }

    lock(&c.lock)
```

Block profiling instrumentation. `t0` is the start time; after parking, the runtime records the time spent. This is what `runtime/pprof` block profile reports.

```go
    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("send on closed channel"))
    }

    if sg := c.recvq.dequeue(); sg != nil {
        // Found a waiting receiver. We pass the value directly to it,
        // bypassing the channel buffer (if any).
        send(c, sg, ep, func() { unlock(&c.lock) }, 3)
        return true
    }

    if c.qcount < c.dataqsiz {
        // Space is available in the channel buffer. Enqueue the element to send.
        qp := chanbuf(c, c.sendx)
        if raceenabled {
            racenotify(c, c.sendx, nil)
        }
        typedmemmove(c.elemtype, qp, ep)
        c.sendx++
        if c.sendx == c.dataqsiz {
            c.sendx = 0
        }
        c.qcount++
        unlock(&c.lock)
        return true
    }
```

The buffer-copy path uses `typedmemmove`, which:

- Copies `elemtype.size` bytes.
- Invokes the GC write barrier if `elemtype.kind` indicates pointers.
- Is open-coded for common element sizes; uses a loop for larger types.

`c.sendx` and `c.recvx` are not atomic — they are protected by `c.lock`.

```go
    if !block {
        unlock(&c.lock)
        return false
    }

    // Block on the channel. Some receiver will complete our operation for us.
    gp := getg()
    mysg := acquireSudog()
    mysg.releasetime = 0
    if t0 != 0 {
        mysg.releasetime = -1
    }
    mysg.elem = ep
    mysg.waitlink = nil
    mysg.g = gp
    mysg.isSelect = false
    mysg.c = c
    gp.waiting = mysg
    gp.param = nil
    c.sendq.enqueue(mysg)
    atomic.Store8(&gp.parkingOnChan, 1)
    gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanSend, traceBlockChanSend, 2)
```

The atomic store of `gp.parkingOnChan = 1` is read by the stack scanner during GC. If the scanner sees this flag, it knows the goroutine may be in the middle of a channel parking, and uses a special protocol to safely read `gp.waiting`. Without this, the GC could race against the channel runtime.

`gopark`'s third argument `chanparkcommit` is the unlock function:

```go
func chanparkcommit(gp *g, chanLock unsafe.Pointer) bool {
    gp.activeStackChans = true
    atomic.Store8(&gp.parkingOnChan, 0)
    unlock((*mutex)(chanLock))
    return true
}
```

Critical sequence:

1. Set `activeStackChans = true` — the GC will use the sudog-aware path.
2. Clear `parkingOnChan`.
3. Unlock the channel.

After step 3, other goroutines can observe the sudog in the wait queue. They will not see a half-formed state because steps 1–2 ran while the lock was still held.

```go
    KeepAlive(ep)

    // Someone woke us up.
    if mysg != gp.waiting {
        throw("G waiting list is corrupted")
    }
    gp.waiting = nil
    gp.activeStackChans = false
    closed := !mysg.success
    gp.param = nil
    if mysg.releasetime > 0 {
        blockevent(mysg.releasetime-t0, 2)
    }
    mysg.c = nil
    releaseSudog(mysg)
    if closed {
        if c.closed == 0 {
            throw("chansend: spurious wakeup")
        }
        panic(plainError("send on closed channel"))
    }
    return true
}
```

Post-wake: assert consistency, release the sudog, decide whether we were woken by a receiver (`success=true`) or by `closechan` (`success=false`). If closed, panic.

`KeepAlive(ep)` exists to prevent the compiler from optimising away the `ep` pointer before the runtime is done with it. While parked, the receiver writes through `ep`. Without `KeepAlive`, the GC could conclude `ep`'s underlying storage is dead.

---

## `chanrecv` Walkthrough at Source Level

`chanrecv` is symmetric. Highlights:

```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    if c == nil {
        ...
    }

    // Fast path.
    if !block && empty(c) {
        if atomic.Load(&c.closed) == 0 {
            return
        }
        // Channel closed since the empty check; treat as closed-and-empty.
        if empty(c) {
            if ep != nil {
                typedmemclr(c.elemtype, ep)
            }
            return true, false
        }
    }
```

The "fast non-blocking + closed" two-step is interesting. Reading `c.closed` and `empty(c)` separately means the channel could close *between* the two reads. The runtime is robust to that: it re-checks `empty(c)` after the closed load. If the channel was open at the first check, the call returns `(false, false)` — accurate at the moment of the check. If it was closed and still empty, return `(true, false)`. The race is benign because the result is consistent with *some* serialisation of operations.

```go
    var t0 int64
    if blockprofilerate > 0 {
        t0 = cputicks()
    }

    lock(&c.lock)

    if c.closed != 0 {
        if c.qcount == 0 {
            ...
            unlock(&c.lock)
            if ep != nil {
                typedmemclr(c.elemtype, ep)
            }
            return true, false
        }
        // The channel has been closed, but the channel's buffer has data.
        // Fall through to the buffer-drain path.
    } else {
        // Just found waiting sender with not closed.
        if sg := c.sendq.dequeue(); sg != nil {
            // Found a waiting sender. If buffer is size 0, receive value
            // directly from sender. Otherwise, receive from head of queue
            // and add sender's value to the tail of the queue (both map
            // to the same buffer slot because the queue is full).
            recv(c, sg, ep, func() { unlock(&c.lock) }, 3)
            return true, true
        }
    }

    if c.qcount > 0 {
        // Receive directly from queue.
        qp := chanbuf(c, c.recvx)
        ...
        if ep != nil {
            typedmemmove(c.elemtype, ep, qp)
        }
        typedmemclr(c.elemtype, qp)
        c.recvx++
        if c.recvx == c.dataqsiz {
            c.recvx = 0
        }
        c.qcount--
        unlock(&c.lock)
        return true, true
    }
```

Notice the asymmetry: `chansend` panics on closed channel before checking `recvq`. `chanrecv` allows draining the buffer even if closed. The semantic difference: a closed channel still delivers buffered values. This is by design.

```go
    if !block {
        unlock(&c.lock)
        return false, false
    }

    // No sender available: block on this channel.
    gp := getg()
    mysg := acquireSudog()
    ...
    c.recvq.enqueue(mysg)
    atomic.Store8(&gp.parkingOnChan, 1)
    gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanReceive, traceBlockChanRecv, 2)

    // Someone woke us up.
    ...
    success := mysg.success
    ...
    return true, success
}
```

Note `chanrecv` returns `(true, success)`. The `selected` is always `true` once we have decided to either succeed or block-and-succeed. `success=false` means the goroutine was woken by `closechan`, in which case `ep` has been cleared to the zero value.

---

## `selectgo` Internals

`selectgo` is the most intricate function in the channel runtime. The signature:

```go
func selectgo(cas0 *scase, order0 *uint16, pc0 *uintptr, nsends, nrecvs int, block bool) (int, bool)
```

- `cas0`: pointer to an array of `scase` structs (cases).
- `order0`: pointer to scratch space of 2 × ncases uint16; first half is pollorder, second half is lockorder.
- `pc0`: PC array for the race detector.
- `nsends`, `nrecvs`: counts of send-cases and receive-cases. First `nsends` entries are sends, then receives.
- `block`: false if a `default` clause exists.

`scase` is small:

```go
type scase struct {
    c    *hchan
    elem unsafe.Pointer
}
```

### Pollorder shuffle

```go
norder := 0
for i := range scases {
    cas := &scases[i]
    if cas.c == nil {
        cas.elem = nil
        continue
    }
    j := fastrandn(uint32(norder + 1))
    pollorder[norder] = pollorder[j]
    pollorder[j] = uint16(i)
    norder++
}
pollorder = pollorder[:norder]
```

In-place Fisher-Yates with `fastrandn` for the random source. Nil channels are skipped — they correspond to "disabled" select cases. The shuffle pass is O(ncases) and rejection-free.

### Lockorder sort

The cases are sorted by `hchan` pointer address. The runtime uses an inline heap-sort:

```go
for i := range lockorder {
    j := i
    c := scases[pollorder[i]].c
    for j > 0 && scases[lockorder[(j-1)/2]].c.sortkey() < c.sortkey() {
        k := (j - 1) / 2
        lockorder[j] = lockorder[k]
        j = k
    }
    lockorder[j] = uint16(pollorder[i])
}
for i := len(lockorder) - 1; i >= 0; i-- {
    o := lockorder[i]
    c := scases[o].c
    lockorder[i] = lockorder[0]
    j := 0
    for {
        k := j*2 + 1
        if k >= i {
            break
        }
        if k+1 < i && scases[lockorder[k]].c.sortkey() < scases[lockorder[k+1]].c.sortkey() {
            k++
        }
        if c.sortkey() < scases[lockorder[k]].c.sortkey() {
            lockorder[j] = lockorder[k]
            j = k
            continue
        }
        break
    }
    lockorder[j] = o
}
```

`sortkey()` returns the channel address as `uintptr`. Heap-sort gives O(n log n) with no allocation.

### `sellock` and `selunlock`

```go
func sellock(scases []scase, lockorder []uint16) {
    var c *hchan
    for _, o := range lockorder {
        c0 := scases[o].c
        if c0 != c {
            c = c0
            lock(&c.lock)
        }
    }
}

func selunlock(scases []scase, lockorder []uint16) {
    for i := len(lockorder) - 1; i >= 0; i-- {
        c := scases[lockorder[i]].c
        if i > 0 && c == scases[lockorder[i-1]].c {
            continue
        }
        unlock(&c.lock)
    }
}
```

Two notes:

- Duplicate channels (e.g., a select with `case <-ch:` and `case ch <- v:` on the same channel) lock only once.
- Unlock is in reverse order. This is irrelevant for correctness (mutex unlock order doesn't matter for futexes), but matches conventional unwind semantics.

### Pass 1: poll for ready case

```go
var casi int
var cas *scase
var caseReleaseTime int64 = -1
var sg *sudog

for _, casei := range pollorder {
    casi = int(casei)
    cas = &scases[casi]
    c := cas.c
    if casi >= nsends {
        sg = c.sendq.dequeue()
        if sg != nil {
            goto recv
        }
        if c.qcount > 0 {
            goto bufrecv
        }
        if c.closed != 0 {
            goto rclose
        }
    } else {
        if raceenabled {
            racereadpc(c.raceaddr(), casePC(casi), chansendpc)
        }
        if c.closed != 0 {
            goto sclose
        }
        sg = c.recvq.dequeue()
        if sg != nil {
            goto send
        }
        if c.qcount < c.dataqsiz {
            goto bufsend
        }
    }
}
```

For each case (in shuffled order), check if it can proceed. The first hit is taken via `goto`.

### Pass 2: park if no case ready

```go
if !block {
    selunlock(scases, lockorder)
    casi = -1
    goto retc
}

// Enqueue on all channels.
gp := getg()
nextp := &gp.waiting
for _, casei := range lockorder {
    casi = int(casei)
    cas = &scases[casi]
    c := cas.c
    sg := acquireSudog()
    sg.g = gp
    sg.isSelect = true
    sg.elem = cas.elem
    sg.releasetime = 0
    if t0 != 0 {
        sg.releasetime = -1
    }
    sg.c = c
    *nextp = sg
    nextp = &sg.waitlink

    if casi < nsends {
        c.sendq.enqueue(sg)
    } else {
        c.recvq.enqueue(sg)
    }
}

// Park.
gp.param = nil
gp.parkingOnChan.Store(true)
gopark(selparkcommit, nil, waitReasonSelect, traceBlockSelect, 1)
gp.activeStackChans = false
```

A sudog is allocated for each case. They are linked via `gp.waiting → sudog.waitlink → ...`. All sudogs share the same `g`. The goroutine then parks; `selparkcommit` unlocks all channel locks in `lockorder`.

```go
func selparkcommit(gp *g, _ unsafe.Pointer) bool {
    gp.activeStackChans = true
    gp.parkingOnChan.Store(false)
    var lastc *hchan
    for sg := gp.waiting; sg != nil; sg = sg.waitlink {
        if sg.c != lastc && lastc != nil {
            unlock(&lastc.lock)
        }
        lastc = sg.c
    }
    if lastc != nil {
        unlock(&lastc.lock)
    }
    return true
}
```

Unlocks in `gp.waiting` order, deduplicating consecutive identical channels.

### Pass 3: wake and clean up

```go
// On wake-up, gp.param == nil if closed, or the firing sudog otherwise.
sellock(scases, lockorder)
gp.selectDone.Store(0)
sg = (*sudog)(gp.param)
gp.param = nil

casi = -1
cas = nil
caseSuccess = false
sglist = gp.waiting

// Clear all the elem before unlinking from gp.waiting.
for sg1 := gp.waiting; sg1 != nil; sg1 = sg1.waitlink {
    sg1.isSelect = false
    sg1.elem = nil
    sg1.c = nil
}
gp.waiting = nil

for _, casei := range lockorder {
    k := &scases[casei]
    if sg == sglist {
        casi = int(casei)
        cas = k
        caseSuccess = sglist.success
        if sglist.releasetime > 0 {
            caseReleaseTime = sglist.releasetime
        }
    } else {
        c := k.c
        if casei < uint16(nsends) {
            c.sendq.dequeueSudoG(sglist)
        } else {
            c.recvq.dequeueSudoG(sglist)
        }
    }
    sgnext = sglist.waitlink
    sglist.waitlink = nil
    releaseSudog(sglist)
    sglist = sgnext
}

if cas == nil {
    goto retc
}
```

The runtime walks the `gp.waiting` list. The sudog matching the woken one (set by the waker via `gp.param = unsafe.Pointer(sg)`) corresponds to the winning case. All *other* sudogs are removed from their channel queues. Each is released to the per-P cache.

The `dequeueSudoG` removes a specific sudog from a waitq (not just the head). This is O(1) because the waitq is doubly linked and we have a direct pointer.

---

## Lock Acquisition Order in `selectgo`

This is the deadlock-avoidance trick:

**Claim**: Two goroutines G1 and G2 running concurrent `select`s on overlapping channel sets {A, B, C} and {B, A, D} respectively cannot deadlock.

**Proof sketch**:

- G1 sorts {A, B, C} by address → some order O1.
- G2 sorts {B, A, D} by address → some order O2.
- O1 and O2 are sub-sequences of the global address-sorted order of {A, B, C, D}.
- Therefore both G1 and G2 acquire shared locks (here: A and B) in the same order.
- No cyclic wait can form on shared locks.

In particular: G1 cannot hold A and wait for B while G2 holds B and waits for A, because both would acquire min(A, B) first.

The unique-locks-only invariant is preserved by the duplicate-skip in `sellock`. If two cases use the same channel (e.g., a select that both sends and receives on the same channel), the runtime locks it once.

### Why not use a global "select lock"?

A global lock would serialise all `select` statements in the program. That would be a major scalability problem. The address-sort gives a per-channel lock with no global contention.

### Cost of the sort

For a select with k cases:

- Shuffle: O(k).
- Sort: O(k log k).
- Lock acquisition: O(k).
- Poll: O(k).

For k = 4, the sort is 8 comparisons + swaps. For k = 16, ~64. For k = 100 (extreme), ~700. The constant per operation is small; in practice the sort is dominated by the lock acquisitions.

---

## Memory Model Implications

The Go Memory Model (<https://go.dev/ref/mem>) says:

> A send on a channel is synchronized before the completion of the corresponding receive from that channel.

Translation: if goroutine G1 writes to memory, then sends on `ch`, then goroutine G2 receives from `ch`, then reads the same memory — G2 will observe G1's write.

The runtime implementation backs this via the `c.lock` mutex:

- `chansend` acquires `c.lock`, writes (to buffer or directly to receiver's stack), releases.
- `chanrecv` acquires `c.lock`, reads the buffer or already-written value, releases.
- Lock release happens-before the next lock acquire (mutex semantics).
- The processor and compiler honour this: any store before the unlock is visible to loads after the next lock.

### Special case: close happens-before receive of closed-channel zero value

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

Implementation: `closechan` holds `c.lock` while setting `closed = 1`. Subsequent `chanrecv` acquires `c.lock` and sees the closed flag. The lock pair establishes happens-before.

For parked receivers woken by close: they release `c.lock` as part of `chanparkcommit`, then are re-acquired by the close path; the close drain's `goready` and the receiver's wake-up share a wake-up barrier (the `casgstatus` from `_Gwaiting` to `_Grunnable` is a release in the C++/Go memory model sense).

### Special case: kth send happens-before (k+C)th receive

> The kth send on a channel with capacity C is synchronized before the completion of the (k+C)th receive from that channel.

This is buffer-specific. The implementation guarantee comes from:

- The kth send writes into the buffer slot at index `(k-1) mod C` (under the lock).
- The (k+C)th receive reads from that same slot (under the lock).
- Between the two, no other receive can have read this slot (it would have to wait for `qcount < C` first — i.e., for a send to fill it).

So the same slot is the synchronisation point, mediated by the lock.

### Direct hand-off and happens-before

For unbuffered hand-off: the sender writes into `sg.elem` (the receiver's stack frame) under `c.lock`. The receiver, after `gopark` returns, reads from its destination. The sequence is:

1. Sender: acquire `c.lock`.
2. Sender: write to `sg.elem` via `typedmemmove`.
3. Sender: `goready(receiver)`.
4. Sender: release `c.lock`.
5. Receiver: wakes (via scheduler), proceeds.

Step 3 is the wake. It involves a status transition from `_Gwaiting` to `_Grunnable` on the receiver. The transition is via atomic CAS on `gp.atomicstatus`. The atomic CAS is a release on the sender's side and an acquire on the receiver's side when it later runs. This is the synchronisation edge that makes the write visible.

In practice the lock release at step 4 is also a synchronisation edge — the receiver's wakeup will go through some lock acquisition (run-queue manipulation) that happens-after the sender's lock release.

---

## Scheduler Interactions

### Park and run-queue churn

When a goroutine parks via `gopark`, the M (OS thread) does not block. The M's `g0` runs `schedule()`, which finds a new runnable goroutine — from the local run queue, then global, then work-stealing, then netpoll. Typical latency: ~50–200 ns from `gopark` to running the next G.

When the parked goroutine is later woken via `goready`, it is placed on the *waker's* P run queue with the `next` flag set, meaning it goes to the head, not the tail. Rationale: the woken goroutine often has hot cache (it was just touched by the waker), and running it soon improves L1/L2 hit rate.

### Wakeup of an idle P

If all Ps are running other goroutines, the woken G simply sits on the run queue. If a P is idle, `wakep` (inside `goready`) wakes it via `startm` or signals an idle M.

### `select` waking and the per-P queue

`select` adds another wrinkle: the woken G's home P might be different from the waker's P. If the waker P has its run queue full, the G is pushed to the global run queue, and any idle M will steal it.

### Park latency under high contention

If many goroutines park on the same channel and one is woken, the waker does the `goready`. If the waker's P is full of other work, the woken G may wait in the run queue for tens of microseconds. This is typically the bottleneck for high-fanout `close` operations.

---

## Cross-Stack Writes and the GC

Direct hand-off writes from one goroutine's stack into another's. Stacks in Go are managed: they can grow (copying to a new region), shrink, and are scanned during GC.

The runtime invariants that make this safe:

1. **Parked goroutines have pinned stacks.** A parked goroutine's stack does not move while parked. This is enforced by checks in `copystack`: if `gp.activeStackChans` is set, `copystack` will not relocate the stack (it would invalidate the cross-stack `sg.elem` pointer).

2. **GC write barriers honour element type.** `typedmemmove` consults the element type's GC mask. For a type with pointers, the write barrier records the cross-stack write so the GC sees it.

3. **`KeepAlive` on the source pointer.** The sender, after `gopark` returns, calls `KeepAlive(ep)`. This is a no-op at runtime but prevents the compiler from concluding that `ep` is dead before the receiver read it. Without `KeepAlive`, the GC could potentially scavenge the source memory.

### `activeStackChans`

The flag `g.activeStackChans` is the keystone. Set by `chanparkcommit` and `selparkcommit`, cleared after the post-park cleanup. While set, the GC scanner uses a special path: it scans the `g.waiting` list of sudogs to know about all live cross-stack pointers.

If `activeStackChans` were missing, two specific things could go wrong:

- `copystack` could move the receiver's stack while a sender is mid-write — silent corruption.
- The GC could miss a pointer in `sg.elem` and free its underlying object.

---

## Performance Characterisation

### Numbers (rough, x86_64, Go 1.22)

| Scenario | Latency |
|---|---|
| Buffered send/recv, no contention, no park | 30–50 ns |
| Unbuffered direct hand-off, both goroutines on same P | 100–200 ns |
| Unbuffered direct hand-off, cross-P | 200–500 ns |
| Send/recv that parks, immediate wake | 1–3 μs |
| Send/recv that parks, cross-M scheduling | 3–10 μs |
| `close(ch)` waking 100 receivers | 10–50 μs |
| `select` with 4 cases, immediately ready | 60–80 ns |
| `select` with 4 cases, parks | 2–5 μs |

The above assumes the host system is otherwise idle. Under load (CPU saturation), parking latencies easily 10x.

### Bottleneck analysis

The hot-path channel op is gated by:

1. Acquiring `c.lock` (CAS, ~3 ns uncontended).
2. Computing the decision (a few branches, ~5 ns).
3. `typedmemmove` or queue manipulation (10–50 ns depending on element size).
4. Releasing `c.lock` (atomic store, ~3 ns).

For unbuffered hand-off, add the cross-stack `typedmemmove` and the `goready` (~50 ns).

For parking, the dominant cost is the M-level scheduling: `mcall(park_m)` + `schedule()` + later `goready` + run queue insertion. Hundreds of ns to single μs.

### Why batch sends are faster

Each `ch <- v` is one lock-unlock pair. Sending 1000 values through a channel is 1000 lock-unlock pairs. If you can batch into groups of 100 (send a slice or struct), you save 99% of the lock overhead. This is the basis for many channel-optimisation patterns: "send chunks, not items."

---

## Pathologies and Worst Cases

### `c.lock` thrash

Many goroutines spinning on `c.lock` (contended futex). Each must acquire to make progress. Symptoms: high CPU on `runtime.lock2`, low throughput.

Mitigation: shard channels, batch operations, switch to a lock-free data structure (rare).

### Goroutine pile-up on `recvq`

If senders close the channel and receivers were also producing in a tight loop, you may have hundreds of parked receivers. `close` wakes them all, generating a thundering herd. Each wakes, runs briefly (perhaps to log "done"), exits.

Mitigation: usually fine, but for very large N consider not closing — let the receivers detect end-of-input via another signal.

### Sudog leak

If a goroutine is parked on a channel and the channel is then garbage collected (no references), the parked goroutine is also unreachable. Go's GC detects this and... does nothing. The goroutine remains parked forever; the sudog is held alive by the goroutine; both leak.

The canonical example: a `time.After(d)` that never fires because nothing reads it, in a long-lived goroutine. Use `time.NewTimer` with explicit `Stop` for these cases.

### `select` with many cases on the same channel

```go
select {
case <-ch:
case <-ch:
case <-ch:
}
```

Pathological but technically legal. `selectgo` will lock `ch` once (deduplication in `sellock`), poll once per case (all see the same state), and proceed with the first ready case. Cost is wasted CPU but not incorrect.

### Closing a channel with parked senders

Senders panic on wake-up. Each panic, if not recovered, terminates a goroutine. If those goroutines are critical (e.g., serving requests), this is a crash.

Common in code where senders close before all senders are done:

```go
// BUG: multiple senders, one closes early
for _, item := range items {
    go func(it Item) {
        ch <- process(it)
    }(item)
}
close(ch) // before goroutines have all sent → panic when they try to send to closed channel
```

Mitigation: `sync.WaitGroup` before close, or close from a single coordinator.

---

## Summary

At the senior level, the channel runtime is a coordinated dance between `chansend`, `chanrecv`, `closechan`, and `selectgo`, with `gopark`/`goready` as the underlying parking primitives and the `sudog` allocator handling per-P caching of wait nodes.

The performance and correctness story has three pillars:

1. **The channel lock.** Short critical sections, futex-based, protects all channel state. The lock pair (send → recv) is what gives the Go Memory Model its happens-before.
2. **Direct hand-off.** Cross-stack copy under the lock, skipping the buffer. This is the latency optimisation that makes channels viable as a primary synchronisation primitive.
3. **`selectgo` lock ordering.** Sort by channel address; lock in that order; deadlock-free no matter how many selects overlap.

The professional level extends this to runtime source line numbers, ABI considerations, and the full spec/HACKING.md cross-references.
