# Mutexes — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Anatomy of `sync.Mutex`](#anatomy-of-syncmutex)
3. [The State Word: Bits and Their Meaning](#the-state-word-bits-and-their-meaning)
4. [`Lock` Path: Fast, Slow, Park](#lock-path-fast-slow-park)
5. [`Unlock` Path: Hand-off and Wakeup](#unlock-path-hand-off-and-wakeup)
6. [Normal vs Starvation Mode](#normal-vs-starvation-mode)
7. [`RWMutex` Internals](#rwmutex-internals)
8. [`semacquire` and the Sudog Treap](#semacquire-and-the-sudog-treap)
9. [Why No Reentrancy](#why-no-reentrancy)
10. [OS-Level Primitives: futex, ulock](#os-level-primitives-futex-ulock)
11. [Memory-Model Effects of Lock/Unlock](#memory-model-effects-of-lockunlock)
12. [Worst-Case Behaviour and Pathologies](#worst-case-behaviour-and-pathologies)
13. [Summary](#summary)

---

## Introduction

This file is the runtime view. We open `runtime/sema.go`, `sync/mutex.go`, and `sync/rwmutex.go` and walk through what actually happens when you call `Lock`. None of this is required to *use* mutexes correctly; all of it helps when:

- Reading mutex profiles whose call stacks dive into runtime functions.
- Designing very-low-latency code where every nanosecond counts.
- Debugging hangs that look like deadlocks but are actually starvation.
- Writing custom synchronisation primitives.

References:
- `src/sync/mutex.go` — the mutex itself, ~250 lines.
- `src/sync/rwmutex.go` — the RW mutex.
- `src/runtime/sema.go` — semaphore-based parking, used by Mutex/RWMutex/WaitGroup.
- `src/runtime/lock_futex.go` / `lock_sema.go` — the OS-specific primitives.

---

## Anatomy of `sync.Mutex`

```go
// src/sync/mutex.go
type Mutex struct {
    state int32
    sema  uint32
}
```

That is the entire data structure. Two 32-bit fields — total size 8 bytes (depending on alignment).

- `state` is a packed bitfield: locked, woken, starving, plus a count of waiting goroutines.
- `sema` is a runtime semaphore handle, used to park goroutines that are waiting.

There is no constructor. The zero value is unlocked, no waiters, normal mode, sema unallocated. `Lock`'s first call may lazily initialise the sema.

---

## The State Word: Bits and Their Meaning

The 32-bit `state` is interpreted as:

```
 31                                                 3 2 1 0
+-----------------------------------------------------+-+-+-+
| number of waiters (29 bits)                         |S|W|L|
+-----------------------------------------------------+-+-+-+
   L = mutexLocked      bit 0   -- 1 if locked
   W = mutexWoken       bit 1   -- 1 if a waiter has been signalled
   S = mutexStarving    bit 2   -- 1 if the mutex is in starvation mode
   waiters count = state >> 3
```

Constants in `sync/mutex.go`:

```go
const (
    mutexLocked      = 1 << iota // 1
    mutexWoken                   // 2
    mutexStarving                // 4
    mutexWaiterShift = iota      // 3
)
```

To increase the waiter count by 1: `atomic.AddInt32(&m.state, 1<<mutexWaiterShift)`.

The choice of packing all this state into one word is critical: it lets `Lock` and `Unlock` use a single CAS in the fast path.

---

## `Lock` Path: Fast, Slow, Park

### Fast path (uncontended)

```go
func (m *Mutex) Lock() {
    if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        return
    }
    m.lockSlow()
}
```

Single CAS. Cost: ~25ns on x86-64. This is the common case under low contention.

### Slow path (`lockSlow`)

When the CAS fails, the goroutine enters `lockSlow`, which is roughly:

```go
func (m *Mutex) lockSlow() {
    var (
        waitStartTime int64
        starving       bool
        awoke          bool
        iter           int
        old            = m.state
    )
    for {
        // 1) Try to spin if it makes sense.
        if old&(mutexLocked|mutexStarving) == mutexLocked && runtime_canSpin(iter) {
            // try to set woken bit so Unlock doesn't wake another
            if !awoke && old&mutexWoken == 0 && old>>mutexWaiterShift != 0 &&
                atomic.CompareAndSwapInt32(&m.state, old, old|mutexWoken) {
                awoke = true
            }
            runtime_doSpin()
            iter++
            old = m.state
            continue
        }

        // 2) Build the new state we want to install.
        new := old
        if old&mutexStarving == 0 {
            new |= mutexLocked    // optimistically take the lock if free
        }
        if old&(mutexLocked|mutexStarving) != 0 {
            new += 1 << mutexWaiterShift // increment waiter count
        }
        if starving && old&mutexLocked != 0 {
            new |= mutexStarving // we're entering starvation mode
        }
        if awoke {
            new &^= mutexWoken // clear the woken bit we set
        }

        // 3) CAS the new state.
        if atomic.CompareAndSwapInt32(&m.state, old, new) {
            if old&(mutexLocked|mutexStarving) == 0 {
                break // got the lock
            }
            // 4) Otherwise we're queued. Park.
            queueLifo := waitStartTime != 0
            if waitStartTime == 0 {
                waitStartTime = runtime_nanotime()
            }
            runtime_SemacquireMutex(&m.sema, queueLifo, 1)
            // 5) Woken up. Decide if we need to enter starvation.
            starving = starving || runtime_nanotime()-waitStartTime > starvationThresholdNs
            // 6) Re-attempt or take direct hand-off.
            old = m.state
            if old&mutexStarving != 0 {
                // Direct hand-off: we own the lock now.
                delta := int32(mutexLocked - 1<<mutexWaiterShift)
                if !starving || old>>mutexWaiterShift == 1 {
                    delta -= mutexStarving
                }
                atomic.AddInt32(&m.state, delta)
                break
            }
            awoke = true
            iter = 0
        } else {
            old = m.state
        }
    }
}
```

Steps:
1. Spin a few times if a CPU is available and the lock might soon be free.
2. Build the new state word with our intent (take, queue, starve).
3. CAS it in.
4. If we queued, sleep on the semaphore.
5. When woken, check whether the lock was handed to us directly (starvation mode) or we have to compete again.

`starvationThresholdNs = 1e6` (1 ms) — once a waiter has been waiting that long, it sets `mutexStarving` to switch the lock into starvation mode.

### Why spin?

Spinning before parking is a throughput win when:
- More than one P (logical CPU) is available.
- The lock-holding goroutine is actively running (not preempted).
- The lock is held briefly.

`runtime_canSpin(iter)` enforces these conditions and limits to ~30 spins.

---

## `Unlock` Path: Hand-off and Wakeup

### Fast path

```go
func (m *Mutex) Unlock() {
    new := atomic.AddInt32(&m.state, -mutexLocked)
    if new != 0 {
        m.unlockSlow(new)
    }
}
```

Subtract the locked bit atomically. If the new state is 0 (no waiters, not woken, not starving), we're done.

### Slow path

```go
func (m *Mutex) unlockSlow(new int32) {
    if (new+mutexLocked)&mutexLocked == 0 {
        fatal("sync: unlock of unlocked mutex")
    }
    if new&mutexStarving == 0 {
        // Normal mode: maybe wake a waiter.
        old := new
        for {
            if old>>mutexWaiterShift == 0 || old&(mutexLocked|mutexWoken|mutexStarving) != 0 {
                return // no waiters or another goroutine already woke one
            }
            new := (old - 1<<mutexWaiterShift) | mutexWoken
            if atomic.CompareAndSwapInt32(&m.state, old, new) {
                runtime_Semrelease(&m.sema, false, 1)
                return
            }
            old = m.state
        }
    } else {
        // Starvation mode: hand the lock directly to the front waiter.
        runtime_Semrelease(&m.sema, true, 1)
    }
}
```

Two distinct behaviours:
- Normal mode: wake one waiter; new arrivals may barge ahead.
- Starvation mode: the woken waiter is *guaranteed* to get the lock without competing.

The `handoff` parameter to `runtime_Semrelease` tells the runtime to bypass the "scheduling" decision and grant the lock immediately.

### Panic on extra unlock

If `Unlock` is called on a mutex that is already unlocked, `(new + mutexLocked) & mutexLocked == 0` (the bit was 0 even before subtraction), and the runtime calls `fatal("sync: unlock of unlocked mutex")`. That is a non-recoverable panic.

---

## Normal vs Starvation Mode

### Normal mode (default)

Goroutines compete fairly with no FIFO guarantee. A goroutine entering `Lock` may snatch the mutex from a parked waiter that was about to be woken. This is good for throughput because the running CPU continues running, avoiding context switches.

But: a slow waiter might lose every race and starve.

### Starvation mode (triggered after 1ms wait)

When a waiter has been waiting > 1ms, it sets `mutexStarving` on its next attempt. From then on:

- `Unlock` performs *direct hand-off*: the waiter at the front of the queue gets the lock without competing.
- New arrivals don't try the fast path — they queue.
- The mutex stays in starvation mode until the last waiter (the one whose wait time is < 1ms or who finds the queue empty) clears the bit.

Throughput drops slightly because of forced hand-offs and context switches. Latency becomes bounded.

### Diagram

```
Time →  ──────────────────────────────────────►

normal mode:     [----- holder ------][G1 takes][----][G2 takes]
                                       waiter Q (LIFO-ish, may be skipped)

→ a waiter has been parked > 1ms
starvation mode: [----- holder -----][hands off to front-of-queue][----]
                                      strict FIFO
```

### When to care

If your service has bimodal latency (most calls fast, some unexpectedly slow), suspect starvation. Profile, look for very long park durations, and consider sharding the lock or shrinking the critical section.

---

## `RWMutex` Internals

```go
// src/sync/rwmutex.go
type RWMutex struct {
    w           Mutex        // held if there are pending writers
    writerSem   uint32       // semaphore for writers waiting
    readerSem   uint32       // semaphore for readers waiting
    readerCount atomic.Int32 // number of pending readers (negative if writer)
    readerWait  atomic.Int32 // number of departing readers
}

const rwmutexMaxReaders = 1 << 30
```

### `RLock`

```go
func (rw *RWMutex) RLock() {
    if rw.readerCount.Add(1) < 0 {
        // A writer is pending; wait.
        runtime_SemacquireRWMutexR(&rw.readerSem, false, 0)
    }
}
```

Increment `readerCount`. If it's negative, a writer is queued — block on the reader semaphore.

### `RUnlock`

```go
func (rw *RWMutex) RUnlock() {
    if r := rw.readerCount.Add(-1); r < 0 {
        rw.rUnlockSlow(r)
    }
}
```

Decrement. If still negative (writer waiting) and we are the last reader, signal the writer.

### `Lock`

```go
func (rw *RWMutex) Lock() {
    rw.w.Lock() // block other writers
    r := rw.readerCount.Add(-rwmutexMaxReaders) + rwmutexMaxReaders
    // r is the number of active readers
    if r != 0 && rw.readerWait.Add(r) != 0 {
        runtime_SemacquireRWMutex(&rw.writerSem, false, 0)
    }
}
```

Two-step: take the writer mutex (excludes other writers), then signal pending writer status by subtracting `rwmutexMaxReaders` from `readerCount` (making it negative). Wait for active readers to drain.

### `Unlock`

```go
func (rw *RWMutex) Unlock() {
    r := rw.readerCount.Add(rwmutexMaxReaders)
    for i := 0; i < int(r); i++ {
        runtime_Semrelease(&rw.readerSem, false, 0)
    }
    rw.w.Unlock()
}
```

Restore `readerCount` to positive, wake any pending readers, release the writer mutex.

### Cost summary

```
RLock/RUnlock     : 2 atomic ops (uncontended)
Lock/Unlock       : Mutex + ≥ 2 atomic ops + maybe park
```

This is why `RWMutex` is slower per-op than `Mutex`. The win comes only when readers actually run in parallel.

---

## `semacquire` and the Sudog Treap

When a goroutine parks on a mutex, the runtime allocates a `sudog` (a small struct linking goroutine to wait reason) and inserts it into a treap (tree + heap) keyed by the semaphore address. This is in `runtime/sema.go`.

The treap is *global*: one shared structure indexed by the address of any `sema uint32` in the program. Each leaf node holds a linked list of waiters for that specific address.

When `Semrelease` is called, the runtime finds the treap node for the address and pops one (or all, if `handoff`) waiter, marking the goroutine runnable.

Implications:
- The first `Lock` on a mutex with a waiter may pay a small treap-insertion cost. Subsequent waiters on the same mutex append to a list and avoid the treap walk.
- The treap is protected by `semaroots[].lock` — a runtime mutex itself. Heavy contention on many different mutexes can briefly hit this root lock, but in practice Go shards the treap by address hash so this is rarely visible.

---

## Why No Reentrancy

Russ Cox documented the rationale in <https://github.com/golang/go/issues/4373> and elsewhere. The key argument:

A reentrant lock pretends that a function call inside another function is "the same code path," but it's not — invariants between lock acquisitions may not hold. Reentrant locking encourages the writer to assume "I have the lock, so the data is consistent," when in fact the outer function may be in the middle of a multi-step update that hasn't finished.

Non-reentrant mutexes force you to either:
1. Refactor so each method uses one explicit lock acquisition, or
2. Pass an "I already hold the lock" hint via an unexported `xxxLocked` method.

Both are clearer than the alternative. As a result, Go has no reentrant mutex in `sync`, and every attempt at one is rejected.

The runtime *could* implement reentrancy by storing the goroutine ID in the state word, but the Go team has consistently said no.

---

## OS-Level Primitives: futex, ulock

When `Semacquire` actually parks the goroutine, the OS kernel may or may not be involved.

### Linux: futex

`runtime/lock_futex.go` uses the Linux `futex(2)` syscall. The kernel provides a primitive: "if `*addr == val`, sleep until someone wakes us." Go's runtime is built on top.

A parked goroutine puts itself in a waiter list and parks the *M* (OS thread) on the futex. When `Semrelease` runs, it does `futex_wake` to nudge the kernel, which wakes the M. The M then unparks the goroutine and schedules it.

Cost of a futex wakeup: a few microseconds of system call + scheduling.

### macOS: __ulock_wait

Same idea, different syscall. `__ulock_wait` and `__ulock_wake` (private but stable).

### Windows: WaitOnAddress / WakeByAddressSingle

Same model, different name.

### When the OS isn't involved

If the wait is brief, Go spins in user space and never calls the kernel. This is why uncontended Mutex ops are so cheap.

---

## Memory-Model Effects of Lock/Unlock

Per the Go Memory Model (<https://go.dev/ref/mem>):

> For any sync.Mutex or sync.RWMutex variable l and n < m, call n of l.Unlock() is synchronized before call m of l.Lock() returns.

In plain English: writes performed before `Unlock` are visible to whatever reads after the next `Lock`. This is why the mutex is sufficient for ordering — you don't need explicit barriers.

For RWMutex:

> For any call to l.RLock on a sync.RWMutex variable l, there is an n such that the l.RLock is synchronized after the n'th call to l.Unlock and the matching l.RUnlock is synchronized before the n+1'th call to l.Lock.

I.e., reads inside an RLock-RUnlock window see all writes from the previous writer Lock-Unlock cycle.

This guarantee is *the* reason mutexes work without your code needing memory barriers.

---

## Worst-Case Behaviour and Pathologies

### Thundering herd

When `Unlock` wakes one waiter (normal mode), only that waiter is unparked. There's no thundering herd — the runtime is intentional about waking just enough.

### Convoying

A short critical section under heavy load can produce a "convoy": every goroutine queues, gets handed the lock, runs, releases, and the next goroutine immediately takes its place. Throughput becomes serialised. The cure is to reduce contention (sharding, atomics) or to allow more parallelism (RWMutex if reads dominate).

### Priority inversion

Less of an issue in user-space goroutines because Go has no goroutine priorities. In kernel mutexes, priority inversion (low-priority holder, high-priority waiter, medium running) can be a concern. With Go, all goroutines are equal in the scheduler's eyes.

### Lock spinning livelock

If two goroutines repeatedly spin and one keeps barging ahead, the parked waiter could starve in normal mode. The 1ms threshold for starvation mode prevents indefinite starvation but allows up to 1ms of unfairness.

### False sharing

If two unrelated mutexes share a cache line, a write to one invalidates the cache line for the other, slowing both. Pad mutex-bearing structs to 64 bytes (`_ [64]byte` field) or place hot mutexes far apart in memory.

---

## Summary

`sync.Mutex` is 8 bytes of state and a small amount of state-machine logic. Most calls take ~25ns and never touch the kernel. Under contention, Go's runtime adaptively spins, parks, and prefers throughput unless a waiter has waited > 1ms — then it switches to strict FIFO to bound latency. `sync.RWMutex` uses a writer mutex plus two semaphores and counter pairs to coordinate readers and writers.

The runtime guarantees the Go Memory Model: writes before `Unlock` are visible after the next `Lock`. This is the foundation everything else builds on.

You don't need to know any of this to write correct Go. But when you read a stack trace dropping into `runtime.semacquire`, or see "sync: unlock of unlocked mutex" in production, this knowledge tells you exactly what the runtime is doing and why.
