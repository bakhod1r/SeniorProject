# The `hchan` Struct — Senior

[← Back to index](index.md)

## Table of Contents
1. [What This Page Adds](#what-this-page-adds)
2. [`waitq` and `sudog` in Detail](#waitq-and-sudog-in-detail)
3. [The Per-P `sudog` Cache](#the-per-p-sudog-cache)
4. [`gopark` and `goready` — the Parking Primitives](#gopark-and-goready-the-parking-primitives)
5. [The Runtime Mutex Up Close](#the-runtime-mutex-up-close)
6. [Lock Order and Deadlock Avoidance](#lock-order-and-deadlock-avoidance)
7. [Cache-Line Layout of `hchan`](#cache-line-layout-of-hchan)
8. [Compiler Lowering of `<-` and `select`](#compiler-lowering-of--and-select)
9. [The `block` Parameter and `select` Integration](#the-block-parameter-and-select-integration)
10. [Race Detector Hooks](#race-detector-hooks)
11. [Why `closed` Is a `uint32`](#why-closed-is-a-uint32)
12. [Stack Growth Interactions](#stack-growth-interactions)
13. [Preemption While Parked](#preemption-while-parked)
14. [Memory Model Guarantees Provided by `hchan`](#memory-model-guarantees-provided-by-hchan)
15. [When a Channel Is GC'd](#when-a-channel-is-gcd)
16. [Sizes, Alignment, and Cross-Architecture Notes](#sizes-alignment-and-cross-architecture-notes)
17. [Anti-Patterns the Layout Discourages](#anti-patterns-the-layout-discourages)
18. [What to Read Next](#what-to-read-next)

---

## What This Page Adds

Middle showed *what* `chansend` and `chanrecv` do under the lock. This page goes one layer down: the `waitq`/`sudog` machinery, the runtime mutex implementation, cache-line considerations, and what the compiler emits for the `<-` operator in different contexts. We touch the boundary with the scheduler — but stay focused on `hchan` itself.

---

## `waitq` and `sudog` in Detail

`waitq` is defined in `runtime/chan.go`:

```go
type waitq struct {
    first *sudog
    last  *sudog
}
```

A FIFO doubly-ish-linked list. Each `sudog`'s `next`/`prev` fields chain them together within the `waitq`. Operations are O(1):

```go
func (q *waitq) enqueue(sgp *sudog) {
    sgp.next = nil
    x := q.last
    if x == nil {
        sgp.prev = nil
        q.first = sgp
        q.last = sgp
        return
    }
    sgp.prev = x
    x.next = sgp
    q.last = sgp
}

func (q *waitq) dequeue() *sudog {
    for {
        sgp := q.first
        if sgp == nil { return nil }
        y := sgp.next
        if y == nil {
            q.first = nil
            q.last = nil
        } else {
            y.prev = nil
            q.first = y
            sgp.next = nil // mark removed
        }
        // Skip already-handled sudogs from a select.
        if sgp.isSelect && !sgp.g.selectDone.CompareAndSwap(0, 1) {
            continue
        }
        return sgp
    }
}
```

The dequeue loop is interesting: when a `sudog` belongs to a `select`, another channel may have already woken its goroutine. The `selectDone` flag (atomic on the G) lets exactly one channel claim the wakeup.

`sudog` is defined in `runtime/runtime2.go`:

```go
type sudog struct {
    g *g

    next *sudog
    prev *sudog
    elem unsafe.Pointer

    acquiretime int64
    releasetime int64
    ticket      uint32

    isSelect bool
    success  bool

    parent   *sudog
    waitlink *sudog
    waittail *sudog
    c        *hchan
}
```

Roles of each field:

- `g`: the goroutine that owns this `sudog`.
- `next`/`prev`: chain inside a `waitq`.
- `elem`: pointer to the user-space data buffer. For senders, the source; for receivers, the destination.
- `acquiretime`/`releasetime`: profiling support (block profile).
- `ticket`: used by `sync.Cond`'s `notifyList` (not by channels).
- `isSelect`: true if this `sudog` was created by a `select` statement.
- `success`: set by the waker to true (operation succeeded) or false (channel was closed while waiting).
- `parent`, `waitlink`, `waittail`: chain in the G's own list of waiting sudogs (`g.waiting`).
- `c`: pointer back to the `hchan` we are parked on.

A goroutine can have several `sudog`s alive simultaneously only while it is inside `select`. Outside of select, exactly one `sudog` is enqueued and `g.waiting` points to it.

---

## The Per-P `sudog` Cache

Allocating a `sudog` on every parking event would be wasteful. The runtime maintains a per-P cache (`p.sudogcache`, capacity ~128), and a central `sched.sudogcache` for spill/refill.

`acquireSudog` flow:

```go
func acquireSudog() *sudog {
    mp := acquirem()
    pp := mp.p.ptr()
    if len(pp.sudogcache) == 0 {
        // Refill from central.
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
    releasem(mp)
    return s
}
```

`releaseSudog` zeroes the relevant fields and pushes the `sudog` back onto the local cache, spilling to the central cache when local is full.

So in steady state, channel-heavy programs never `new(sudog)`. The fast path is a slice pop on the local P.

---

## `gopark` and `goready` — the Parking Primitives

`gopark` is in `runtime/proc.go`:

```go
func gopark(unlockf func(*g, unsafe.Pointer) bool,
            lock unsafe.Pointer,
            reason waitReason, traceReason traceBlockReason, traceskip int) {
    mp := acquirem()
    gp := mp.curg
    status := readgstatus(gp)
    if status != _Grunning && status != _Gscanrunning {
        throw("gopark: bad g status")
    }
    mp.waitlock = lock
    mp.waitunlockf = unlockf
    gp.waitreason = reason
    mp.waittraceblockreason = traceReason
    mp.waittraceskip = traceskip
    releasem(mp)
    // can't do anything that might move the G between Ms here
    mcall(park_m)
}
```

`mcall(park_m)` switches to the M's system stack and calls `park_m`, which:

1. Atomically transitions `gp` to `_Gwaiting`.
2. Calls the supplied `unlockf` — for channels this is `chanparkcommit`, which releases `c.lock`.
3. If `unlockf` returns true, schedules another goroutine on this M (`schedule()`).

`goready` is the wakeup:

```go
func goready(gp *g, traceskip int) {
    systemstack(func() {
        ready(gp, traceskip, true)
    })
}
```

`ready` flips the G back to `_Grunnable` and puts it on a runqueue. The scheduler will pick it up on the next pass.

For `hchan`, the relevant fact is the contract: `gopark` happens **inside** the lock; the `unlockf` releases the lock **after** the G is officially parked. Doing the unlock too early would allow another goroutine to immediately try to wake us before we are in `_Gwaiting`, which would be a lost wake-up.

---

## The Runtime Mutex Up Close

`mutex` is in `runtime/lock_*.go` — there are platform-specific implementations:

- `lock_futex.go` (Linux): futex-based.
- `lock_sema.go` (most other platforms): semaphore-based.

The structure is tiny:

```go
type mutex struct {
    key uintptr
}
```

`lock(l *mutex)` and `unlock(l *mutex)` are the operations. The fast path (`mutex_unlocked` value of `key`) is a single CAS. The slow path on Linux:

```go
// Pseudocode:
for spins := 0; spins < 4; spins++ {
    runtime.procyield(30)
    if l.key == mutex_unlocked && cas(&l.key, mutex_unlocked, mutex_locked) {
        return
    }
}
for spins := 0; spins < 1; spins++ {
    runtime.osyield()
    // try CAS again
}
// Park on futex.
atomic.Xadd(&l.key, +1)
futexsleep(&l.key, ...)
```

Brief spinning before parking. The expectation is that channel critical sections are *very* short, so spinning often succeeds.

A subtle effect: a heavily contended channel can cause many futex wake-ups, which are visible in `perf` as kernel time. This is why ultra-hot channels sometimes perform worse than equivalent sharded designs.

---

## Lock Order and Deadlock Avoidance

A `select` may involve multiple channels. To take their locks safely, the runtime sorts them by pointer address and locks in that order:

```go
// In runtime/select.go, sellock():
for _, cas := range cases {
    sg := &scases[cas]
    if sg.c != lastc && lastc != nil {
        unlock(&lastc.lock)
    }
    if sg.c != lastc {
        lock(&sg.c.lock)
    }
    lastc = sg.c
}
```

(Actually: the cases are sorted by channel pointer, and channels are locked once even if multiple cases share a channel.)

This is the classic deadlock-avoidance technique: a global total order on lockable objects.

Single-channel `chansend`/`chanrecv` never have to think about lock order — there is exactly one lock.

A runtime-internal rank system (`lockRankHchan`) is used in race-detector / lock-order-violation builds to catch accidental nested locks. Channels rank below most other runtime locks, so taking another runtime lock while holding `c.lock` is generally forbidden. The constraint from the source comment — "do not change another G's status while holding this lock" — falls out of this: `goready` may take other locks, which would violate rank.

---

## Cache-Line Layout of `hchan`

Modern CPUs use cache lines of 64 bytes. `hchanSize` ~96 means the struct straddles two cache lines on amd64. The field layout intentionally groups together the most-frequently-touched fields:

```
Offset  Field
0       qcount        \
8       dataqsiz      |  often read together
16      buf           |
24      elemsize      |
28      closed        |
32      elemtype      |
40      sendx         |  written by senders
48      recvx         /  written by receivers
56      recvq         \
72      sendq         |  modified during park/unpark
88      lock          /
```

(Offsets approximate, may shift across versions.)

Notice that `sendx` and `recvx` are on the same cache line. Under a pattern where one goroutine sends and another receives, both cores write fields in the same cache line, causing **cache-line bouncing** ("false sharing within the same struct, intentional sharing of variables that conflict"). This is a known cost.

The runtime does not pad `hchan` to separate these fields. The decision is implicit: for most channels the throughput is not high enough for false sharing to matter, and padding would bloat memory. Performance-critical concurrent queues built outside the runtime (e.g., `lock-free MPMC` queues in third-party libraries) often pad to one field per cache line.

---

## Compiler Lowering of `<-` and `select`

The compiler is in `cmd/compile/internal/`. The relevant files are:

- `walk/walk.go` and `walk/expr.go`: lower `<-ch` and `ch <- v` to runtime calls.
- `walk/select.go`: rewrite `select` statements.
- `ssagen/ssa.go`: emit SSA for channel operations.

For `ch <- v`:

```go
// Source
ch <- v

// After walk:
runtime.chansend1(ch, &v_temp)   // where v_temp = v, address-taken
```

For `<-ch`:

```go
v := <-ch
// becomes
var v T
runtime.chanrecv1(ch, &v)
```

For `v, ok := <-ch`:

```go
var v T
ok := runtime.chanrecv2(ch, &v)
```

For `select`, the rewrite is more elaborate. A two-case `select`:

```go
select {
case v := <-ch1:
    handleA(v)
case ch2 <- x:
    handleB()
}
```

becomes, roughly:

```go
var cases [2]runtime.scase
cases[0].c = ch1
cases[0].elem = unsafe.Pointer(&v)
cases[1].c = ch2
cases[1].elem = unsafe.Pointer(&x)
order := /* shuffled indices */
chosen, recvOK := runtime.selectgo(&cases[0], &order[0], pc0, ncases, ncases, false)
switch chosen {
case 0:
    handleA(v)
case 1:
    handleB()
}
```

The compiler does the per-case wrapping; `selectgo` does the locking, parking, and choice. The `block bool` parameter to `chansend`/`chanrecv` is used internally by `selectgo` when polling cases.

---

## The `block` Parameter and `select` Integration

`chansend` and `chanrecv` take a `block` parameter. When `block == false` (used by `select` polling), they return `false` instead of parking. The fast paths at the top take advantage of this:

```go
// chansend, top of function:
if !block && c.closed == 0 && full(c) {
    return false
}
```

`selectgo` calls `chansend` with `block == false` for each case in a first pass; if no case is ready, it constructs `sudog`s, queues them on every case's channel, and parks once. When woken, it walks the wait list and removes the not-chosen `sudog`s.

This is the only path that takes `c.lock` for "polling" purposes — and even then, the fast `full()` check avoids the lock when possible.

---

## Race Detector Hooks

When you build with `-race`, the runtime injects calls into the race detector. In `chan.go`:

```go
if raceenabled {
    racereadpc(c.raceaddr(), callerpc, abi.FuncPCABIInternal(chansend))
}
```

The `raceaddr()` method returns a stable address representing the channel — used by ThreadSanitizer's vector clocks. A send is a "release" event on this address; a receive is an "acquire" event. This is what gives the race detector the necessary happens-before edges across channel operations.

For zero-element or zero-buffer channels (where `buf` is set to `c.raceaddr()`), the buffer pointer itself serves as the race address. Cute trick: one field, two purposes.

---

## Why `closed` Is a `uint32`

A bool would have sufficed semantically. The runtime uses `uint32` because:

- Atomic word operations on `uint32` are universally available.
- Some fast paths read `closed` without taking the lock (using `atomic.Load(&c.closed)`).
- `bool` is implementation-defined size (1 byte) and would not be atomically aligned to a useful word.

Both `closechan` (write `1`) and `chansend`/`chanrecv` (read in fast paths) treat the field as an atomic word.

---

## Stack Growth Interactions

A goroutine's stack can grow (and rarely shrink). The runtime relocates the stack contents and updates pointers into the stack. `hchan` is on the heap, so it does not move — but pointers stored inside a `sudog` may point into a goroutine's stack:

- `sudog.elem` for a sender points at the source variable (on the sender's stack).
- `sudog.elem` for a receiver points at the destination variable (on the receiver's stack).

If the goroutine's stack is shrunk while its `sudog` is in a wait queue, those pointers must be updated. This is one of the responsibilities of `scanstack`: it walks `g.waiting` and adjusts `sudog.elem` to follow the moved stack.

The constraint cited in the `hchan.lock` comment — do not change another G's status while holding the lock — exists because stack shrinking acquires the channel lock for the duration of pointer adjustment. Calling `goready` (which can trigger schedule, which can trigger stack scan, which can want to take `c.lock`) inside the channel critical section would deadlock.

---

## Preemption While Parked

A parked goroutine on a channel is in `_Gwaiting` state. The runtime does not preempt waiting goroutines — there is no need; they consume no CPU. Async preemption (`SIGURG`) only affects `_Grunning` goroutines.

What if a parked goroutine has been waiting "too long"? Nothing happens automatically. Channels do not time out. To bound waiting time, code must combine the channel with a timer via `select`:

```go
select {
case v := <-ch:
    ...
case <-time.After(time.Second):
    return errors.New("timeout")
}
```

`time.After` returns a channel from a timer; when the timer fires, the runtime closes it (effectively making it readable). The parked `select` wakes up and chooses the timer case.

---

## Memory Model Guarantees Provided by `hchan`

The Go Memory Model says:

> A send on a channel happens before the corresponding receive from that channel completes.

This is implemented inside `chansend`/`chanrecv` via the lock acquisition order and the race-detector annotations. From the program's view, anything written before `ch <- v` is visible after `<-ch`:

```go
x := 42
ch <- 1   // release
// other goroutine:
<-ch       // acquire
// x is guaranteed to be 42 here, even without explicit sync.
```

Mechanically, this works because both `chansend` and `chanrecv` take `c.lock`, and the lock's release/acquire pair provides the necessary memory barriers. On platforms with weak memory models (arm64), the `lock_*` implementation uses load-acquire and store-release for `key`.

For unbuffered channels, the rendezvous itself is the synchronization point. For buffered channels, the receive of the *k*-th element synchronizes with the send of the *k*-th element — not with any other send.

---

## When a Channel Is GC'd

A channel is just a heap object. It is GC'd when no reachable variable holds a `*hchan` pointing to it. References to a channel include:

- Stack variables.
- Struct/map/slice fields.
- The `c` field of any live `sudog` (goroutines parked on the channel).

The last point is important: if goroutines are parked on a channel and no other references exist to that channel, the channel **stays alive** because the parked goroutines (themselves reachable as scheduler runqueue entries and `allgs`) hold pointers to it. So you cannot "leak away" a channel that has waiting goroutines: it leaks *with* them.

After `close(c)`, parked receivers wake (with zero value, ok=false), parked senders panic. If no goroutines park later, the channel will be collected when the last reference drops.

---

## Sizes, Alignment, and Cross-Architecture Notes

Approximate `hchanSize` per platform:

| GOARCH | Pointer size | Approx. `hchanSize` |
|---|---|---|
| amd64 | 8 | 96 B |
| arm64 | 8 | 96 B |
| 386 | 4 | 60 B |
| arm | 4 | 60 B |

The `uint16 elemsize` field is followed by `uint32 closed`, then `*_type elemtype` — careful packing keeps alignment tight. Verify on your platform:

```go
package main

import (
    "fmt"
    "unsafe"
)

// Cannot reflect on hchan directly. But on a struct mirror:
type hchanMirror struct {
    qcount   uint
    dataqsiz uint
    buf      unsafe.Pointer
    elemsize uint16
    closed   uint32
    elemtype unsafe.Pointer
    sendx    uint
    recvx    uint
    recvq    [2]unsafe.Pointer
    sendq    [2]unsafe.Pointer
    lock     uintptr
}

func main() {
    fmt.Println(unsafe.Sizeof(hchanMirror{}))
}
```

On amd64 this prints `96`. Numbers may shift slightly across Go versions; the layout was tweaked in Go 1.19 to better fit cache lines but kept the same size.

---

## Anti-Patterns the Layout Discourages

Now that you have seen the layout, several common "I'll just write my own channel" attempts become questionable:

- **A channel of huge elements**: e.g., `chan [4096]byte`. Each send is a 4 KB `typedmemmove`. Pass `*[4096]byte` instead.
- **A million-entry buffered channel**: allocates a huge contiguous slab upfront. Use a goroutine + smaller batches.
- **Lots of channels sharing one element**: each is its own `hchan` with its own lock. Consider a single fan-out goroutine.
- **`select` with hundreds of cases**: each case allocates a `sudog` on every park; locking all involved channels is O(cases). Use a single channel with a tagged union.
- **Tightly polling `select { default: }`**: defeats the parking design; better to block on a real channel.

`hchan` is optimized for the common cases: one or a few elements buffered, a handful of producers/consumers, short bursts. Push past those scales and the design starts to bite.

---

## What to Read Next

- **`professional.md`** — Walk the full `runtime/chan.go` source with line references, GC interaction details, and version-by-version evolution.
- **`specification.md`** — The formal invariants `hchan` maintains and the user-facing contract these invariants imply.
- **`02-runtime-behavior/`** — `gopark`/`goready` paths in depth, async preemption interactions.
- **`03-buffer-mechanics/`** — Deeper ring buffer analysis (e.g., what if `dataqsiz` were a power of two and we used `&` instead of `if`?).
- **`04-send-receive-flow/`** — Step-by-step flowcharts for send and receive in every scenario.
