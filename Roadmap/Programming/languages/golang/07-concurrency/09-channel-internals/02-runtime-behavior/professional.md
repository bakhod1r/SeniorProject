# Channel Runtime Behaviour — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Reading `runtime/chan.go`](#reading-runtimechango)
3. [`hchan.lock` Is a Spin-Then-Park Mutex](#hchanlock-is-a-spin-then-park-mutex)
4. [Full Lock Ordering Story in `selectgo`](#full-lock-ordering-story-in-selectgo)
5. [`acquireSudog` Per-P Cache and Central Free List](#acquiresudog-per-p-cache-and-central-free-list)
6. [GC and Cross-Stack Pointers in Detail](#gc-and-cross-stack-pointers-in-detail)
7. [The Race Detector Hooks](#the-race-detector-hooks)
8. [Block Profiling Hooks](#block-profiling-hooks)
9. [Performance Numbers (Measured)](#performance-numbers-measured)
10. [Failure Modes in Production](#failure-modes-in-production)
11. [Runtime Invariants and Assertions](#runtime-invariants-and-assertions)
12. [How to Read a Stack Trace That Ends in `runtime.chan*`](#how-to-read-a-stack-trace-that-ends-in-runtimechan)
13. [Summary](#summary)

---

## Introduction

The professional view sits in the runtime source. We name files, give approximate line numbers, explain why certain assertions exist, walk through the lock ordering proof, and provide tools for diagnosing channel-related production issues from stack traces and profiles alone.

Source references are to Go 1.22 (`go1.22.x`). Line numbers drift across releases; function names and structure have been stable since Go 1.18.

Files of interest:

- `src/runtime/chan.go` — `chansend`, `chanrecv`, `closechan`, `makechan`, the `send`/`recv` helpers.
- `src/runtime/select.go` — `selectgo`, `sellock`, `selunlock`, sort/shuffle code.
- `src/runtime/runtime2.go` — type definitions: `hchan`, `sudog`, `waitq`, `mutex`.
- `src/runtime/proc.go` — `gopark`, `goready`, `acquireSudog`, `releaseSudog`, `park_m`, `wakep`.
- `src/runtime/lock_futex.go` — Linux futex-based `mutex`.
- `src/runtime/lock_sema.go` — Other-OS semaphore-based `mutex`.

---

## Reading `runtime/chan.go`

The file is ~840 lines. Layout:

```
//   makechan  - allocate
//   chansend  - send
//   chanrecv  - receive
//   closechan - close
//   ...helpers: send, recv, full, empty, chanbuf, sortkey
//   waitq operations: enqueue, dequeue
```

Read order recommendation:

1. `hchan` struct (in `chan.go` near the top).
2. `makechan` to see how the struct is initialised.
3. `chansend` from top to bottom.
4. `chanrecv` from top to bottom.
5. `send` and `recv` helpers.
6. `closechan`.

After this, `runtime/select.go` will be readable end-to-end.

`HACKING.md` in the runtime source tree includes the high-level scheduler invariants that channel ops depend on. Required reading.

---

## `hchan.lock` Is a Spin-Then-Park Mutex

The `hchan.lock` is `runtime.mutex`, not `sync.Mutex`. Definition in `runtime/runtime2.go`:

```go
type mutex struct {
    // Empty struct if lockRankCrash, but generally:
    // futex-based: 4-byte futex value
    // sema-based: opaque pointer to sudog list
    lockRankStruct
    key uintptr
}
```

### Linux: futex-based

From `runtime/lock_futex.go`:

```go
func lock2(l *mutex) {
    gp := getg()
    if gp.m.locks < 0 {
        throw("runtime·lock: lock count")
    }
    gp.m.locks++

    // Speculative grab for lock.
    v := atomic.Xchg(key32(&l.key), mutex_locked)
    if v == mutex_unlocked {
        return
    }

    // Wait was already non-zero, so try to spin-then-park.
    wait := v

    spin := 0
    if ncpu > 1 {
        spin = active_spin
    }
    for {
        // Try for lock, spinning.
        for i := 0; i < spin; i++ {
            for l.key == mutex_unlocked {
                if atomic.Cas(key32(&l.key), mutex_unlocked, wait) {
                    return
                }
            }
            procyield(active_spin_cnt)
        }
        // Try for lock, rescheduling.
        for i := 0; i < passive_spin; i++ {
            for l.key == mutex_unlocked {
                if atomic.Cas(key32(&l.key), mutex_unlocked, wait) {
                    return
                }
            }
            osyield()
        }
        // Sleep.
        v = atomic.Xchg(key32(&l.key), mutex_sleeping)
        if v == mutex_unlocked {
            return
        }
        wait = mutex_sleeping
        futexsleep(key32(&l.key), mutex_sleeping, -1)
    }
}
```

Behaviour:

- Fast path: `Xchg` with `mutex_locked`. If the previous value was `mutex_unlocked`, we have the lock — single instruction.
- Slow path: spin a few times (`active_spin = 4`), each spin doing `procyield(active_spin_cnt = 30)`. About 120 PAUSE/yield instructions total, less than 1 μs.
- Then passive spin: `osyield` (sched_yield) once.
- Then sleep on the futex.

For channel ops, the critical section is so short that contention almost always resolves in the spin phase. Only under heavy contention does the futex wake/sleep come into play.

### macOS: semaphore-based

From `runtime/lock_sema.go`: similar structure, but uses Mach `semaphore_wait` instead of futex. Slightly higher per-op cost.

### Why not `sync.Mutex`?

`sync.Mutex` is implemented on top of `runtime.mutex`. Using `sync.Mutex` inside the channel would add one level of indirection and waste a few bytes per channel for the state word. The runtime's own `mutex` is the minimum primitive.

The runtime mutex also has different memory-ordering guarantees that the runtime relies on (specifically, it is implemented in assembly on some arches and has tighter integration with the scheduler).

---

## Full Lock Ordering Story in `selectgo`

### The invariant

For any set of channels {C1, ..., Ck} involved in concurrently-executing select statements, all select statements lock them in the same global order: increasing by `uintptr(c)` address.

### Why it works

This is the classic "lock hierarchy" pattern: if there is a total order on locks and every code path that holds multiple locks acquires them in that order, deadlock is impossible.

Proof: assume two select statements G1 and G2 are deadlocked, each holding some locks and waiting on another. G1 holds A, waits B. G2 holds B, waits A. But both sort their channels by address. If `addr(A) < addr(B)`, both would acquire A first. So G1 acquires A, G2 waits for A — no deadlock, G2 waits for G1 to release A. The cycle cannot exist.

### Caveat: ordering must be canonical

The address-sort is *not* the only valid ordering. The runtime could equally have used an ID-based sort, or hash. The requirement is *global consistency*: every place that locks multiple channels uses the same order.

The runtime adheres to this in:

- `selectgo`'s `sellock`/`selunlock`.
- Nowhere else, because no other runtime function locks multiple `hchan` simultaneously.

### What about user code that locks multiple channels?

User code cannot lock an `hchan` directly. The only path is through `chansend`/`chanrecv`/`closechan`/`selectgo`. Of these, only `selectgo` touches multiple channels under lock. So the invariant is fully enforced by the runtime.

### Cost in cycles

For k cases:

- Address-sort heap-sort: O(k log k) comparisons, each comparing two uintptrs. ~5 ns per comparison.
- Lock acquisition: k uncontended CASes, ~3 ns each.
- Polling pass: k iterations, each checking a few hchan fields. ~10 ns per iteration.

For k = 4: ~60 ns sort + 12 ns locks + 40 ns poll = ~110 ns. Plus the actual channel op cost (~50 ns).

For k = 16: ~300 ns + 48 ns + 160 ns = ~500 ns.

In benchmarks, a 16-way select on cheap channels runs in ~600 ns (matches the estimate). Adding 16 more cases doubles to ~1.2 μs.

### Duplicate channel handling

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
```

If the same channel appears in two cases (e.g., one send and one receive on the same `ch`), it sits adjacent in `lockorder` (after sort). The dedup `if c0 != c` ensures it is locked only once. Without this, we would `lock` a held mutex — undefined behaviour.

The receive of a duplicate channel can compete with the send of the same channel — both are checked in the poll. The result is that a `select { case ch <- v: case <-ch: }` on a 1-buffered channel will most likely take the receive (because the send-side case requires the buffer to be non-full and the receive-side requires it to be non-empty; the loop picks whichever fires).

---

## `acquireSudog` Per-P Cache and Central Free List

From `runtime/proc.go`:

```go
func acquireSudog() *sudog {
    // Delicate dance: the runtime knows that we won't preempt with
    // mp.p == nil, so allocate one new sudog here outside the
    // critical region for an idle P at the cost of the global lock.
    mp := acquirem()
    pp := mp.p.ptr()
    if len(pp.sudogcache) == 0 {
        lock(&sched.sudoglock)
        // First, try to grab a batch from central cache.
        for len(pp.sudogcache) < cap(pp.sudogcache)/2 && sched.sudogcache != nil {
            s := sched.sudogcache
            sched.sudogcache = s.next
            s.next = nil
            pp.sudogcache = append(pp.sudogcache, s)
        }
        unlock(&sched.sudoglock)
        // If the central cache is empty, allocate a new one.
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

- `pp.sudogcache`: a slice on the P, size up to `cap`. Default cap is 128.
- Refill triggers a `sched.sudoglock` acquisition and a bulk transfer.
- The central `sched.sudogcache` is a singly-linked list of sudogs.
- `new(sudog)` is the GC-allocated path; used only when both caches are exhausted.

### `releaseSudog`

```go
func releaseSudog(s *sudog) {
    if s.elem != nil {
        throw("runtime: sudog with non-nil elem")
    }
    if s.isSelect {
        throw("runtime: sudog with non-false isSelect")
    }
    if s.next != nil {
        throw("runtime: sudog with non-nil next")
    }
    if s.prev != nil {
        throw("runtime: sudog with non-nil prev")
    }
    if s.waitlink != nil {
        throw("runtime: sudog with non-nil waitlink")
    }
    if s.c != nil {
        throw("runtime: sudog with non-nil c")
    }
    gp := getg()
    if gp.param != nil {
        throw("runtime: releaseSudog with non-nil gp.param")
    }
    mp := acquirem()
    pp := mp.p.ptr()
    if len(pp.sudogcache) == cap(pp.sudogcache) {
        // Transfer half of local cache to the central cache.
        var first, last *sudog
        for len(pp.sudogcache) > cap(pp.sudogcache)/2 {
            n := len(pp.sudogcache)
            p := pp.sudogcache[n-1]
            pp.sudogcache[n-1] = nil
            pp.sudogcache = pp.sudogcache[:n-1]
            if first == nil {
                first = p
            } else {
                last.next = p
            }
            last = p
        }
        lock(&sched.sudoglock)
        last.next = sched.sudogcache
        sched.sudogcache = first
        unlock(&sched.sudoglock)
    }
    pp.sudogcache = append(pp.sudogcache, s)
    releasem(mp)
}
```

The assertions are critical: a sudog with leftover state would corrupt the next user of it. The assertions are how the runtime catches "we forgot to clear field X" bugs early.

### Implication: no per-op allocation

A channel op that parks does:

1. `acquireSudog` — slice pop, no allocation, ~10 ns.
2. ... op ...
3. `releaseSudog` — slice push, no allocation, ~10 ns.

No GC pressure unless the per-P cache empties. The half-refill keeps amortised lock cost low even under churn.

---

## GC and Cross-Stack Pointers in Detail

### The problem

During direct hand-off, the sender writes from its own stack into the receiver's stack:

```
[ Sender stack ]                    [ Receiver stack ]
| ...           |                   | ...             |
| v = 42        | -- write -->      | x ← ?           |
| ...           |                   | ...             |
```

The receiver's `x` lives at some address `&x` in the receiver's stack. The sender's sudog stored `sg.elem = &x`. The sender does `*sg.elem = 42`.

But Go stacks can move (grow / shrink). If the receiver's stack moved between the time the sudog was set up and the sender's write, the write would corrupt unrelated memory.

### The solution

When the receiver parks, `chanparkcommit` sets `gp.activeStackChans = true`. The garbage collector's stack-mover (`copystack` in `runtime/stack.go`) checks this flag:

```go
// runtime/stack.go (simplified)
func copystack(gp *g, newsize uintptr) {
    if gp.activeStackChans {
        // Special case: this goroutine is parked on a channel and
        // there might be a sudog pointing into its stack. We must
        // update the sudog's elem pointer if we move the stack.
        adjustSudogs(gp, &adjinfo)
    }
    // ... normal stack copy ...
}
```

`adjustSudogs` walks `gp.waiting` (the linked list of sudogs the goroutine is parked on) and adjusts each `sg.elem` by the same delta as the stack move. Result: the sender's write still hits the right address, post-move.

This is one of the most delicate corners of the runtime. The invariants:

1. `gp.activeStackChans` is true iff `gp.waiting != nil` and the sudogs may have elem pointers into the goroutine's stack.
2. `gp.activeStackChans` is set under the channel lock (in `chanparkcommit`) and cleared by the wake-up path before any further user code runs.
3. `copystack` checks `activeStackChans` and uses `adjustSudogs` to fix up.

### Write barriers

The element type may contain pointers. The runtime's `typedmemmove` knows the type and invokes the GC write barrier as needed. The write barrier records the source/destination pair so the GC's tri-color invariant is preserved.

For pointer-free types (e.g., `chan int`), no write barrier is needed; `memmove` is a plain copy.

### Why not just disable stack-move while parked?

Possible but wasteful. Stacks need to grow if the goroutine, on wake-up, calls a function that overflows. Disabling growth means pre-allocating max-size stacks. The adjust-sudogs approach lets stacks remain dynamic.

---

## The Race Detector Hooks

When compiled with `-race`, the runtime instruments channel ops:

```go
// In chansend
if raceenabled {
    racereadpc(c.raceaddr(), callerpc, abi.FuncPCABIInternal(chansend))
}
// ...
if raceenabled {
    racenotify(c, c.sendx, nil)
}
```

`raceaddr` is `unsafe.Pointer(&c.buf[0])` for buffered, or a special token for unbuffered. The race runtime treats this address as the "channel handle" for happens-before tracking.

- `chansend` issues a `racewrite` on the channel handle.
- `chanrecv` issues a `raceread` on the channel handle.
- The race detector's algorithm establishes happens-before: every send happens-before its matching receive.

`racenotify(c, idx, nil)` is called when copying to or from buffer slot `idx`. It tells the race detector to synchronise on `&c.buf[idx]`. This is how the race detector recognises that two goroutines accessing the same buffer slot (the Nth send and the Nth receive) synchronise via the channel.

For closed channels, the race detector synchronises on `c.raceaddr()` as well — close happens-before all subsequent receives.

### Direct hand-off and race

For the direct hand-off path, the runtime issues `racesync` calls in `send` and `recv` so the race detector sees both goroutines synchronise on the channel. The sender's pre-send writes are happens-before the receiver's post-receive reads, even though no buffer slot is involved.

### Overhead

The race detector adds significant cost: typically 2–10x slowdown for channel-heavy code. Acceptable for tests, never for production.

---

## Block Profiling Hooks

`runtime.SetBlockProfileRate(rate int)` enables block profiling. The runtime samples blocking events; the profile shows where goroutines park.

In `chansend`:

```go
var t0 int64
if blockprofilerate > 0 {
    t0 = cputicks()
}
// ...
mysg.releasetime = 0
if t0 != 0 {
    mysg.releasetime = -1
}
// ...
if mysg.releasetime > 0 {
    blockevent(mysg.releasetime-t0, 2)
}
```

`releasetime = -1` is a sentinel: "record release time when this is woken." After `gopark` returns, if `releasetime > 0`, the runtime records the block duration via `blockevent`. The 2 is the caller skip count for the stack trace.

Costs: with `BlockProfileRate=1`, every blocking event is recorded — significant overhead. Production usage: `BlockProfileRate=100000` (sample 1 in 100k) or higher.

### Mutex profiling

`SetMutexProfileFraction` is similar but for mutexes. Channels are not technically mutexes for profile purposes — they show up under "select" and "chan send/recv" labels in the block profile.

---

## Performance Numbers (Measured)

Reference benchmark (`runtime/chan_test.go`):

```go
func BenchmarkChanProdCons10(b *testing.B) {
    benchmarkChanProdCons(b, 10, 0)
}

func benchmarkChanProdCons(b *testing.B, chanSize, localWork int) {
    const CallsPerSched = 1000
    procs := 2
    N := int32(b.N / CallsPerSched)
    c := make(chan bool, procs*chanSize)
    for p := 0; p < procs; p++ {
        go func() {
            ...
        }()
    }
    ...
}
```

Approximate results on a modern x86_64 server (Go 1.22, GOMAXPROCS=8):

| Bench | ns/op |
|---|---|
| `BenchmarkChanProdConsWork0-8` (chan size 0, no work) | 350 |
| `BenchmarkChanProdConsWork0-8` (chan size 10) | 180 |
| `BenchmarkChanProdConsWork0-8` (chan size 100) | 140 |
| `BenchmarkSelectUncontended-8` | 35 |
| `BenchmarkChanContended-8` (high contention) | 800 |
| `BenchmarkChanCreation-8` | 90 |
| `BenchmarkChanClosed-8` (recv on closed chan) | 6 |

Recv-on-closed is nearly free because it hits the closed-and-empty fast path without locking (after one atomic load).

### Channel vs Mutex

For a simple counter:

```
Mutex Lock/Unlock pair, contended:      ~25 ns
Channel send/recv pair, no park:         ~70 ns
Channel send/recv pair, parks:           ~3 μs
atomic.AddInt64:                         ~3 ns
```

A channel is roughly 3x a mutex when there is no park, ~120x when there is. Atomics are 10–30x faster than either, where applicable.

### When parking dominates

Realistic scenario: a worker pool with N workers and one channel. If workers are slower than the producer, each `send` parks once. Cost per send: ~3 μs. Throughput cap: ~300k sends/sec/CPU. To exceed this, batch or shard.

### Direct hand-off vs buffered

Two-goroutine ping-pong:

| Channel type | ns per round-trip |
|---|---|
| Unbuffered | 220 |
| Buffered, capacity 1 | 240 |
| Buffered, capacity 10 | 280 |
| Buffered, capacity 100 | 320 |

Direct hand-off (unbuffered) is the fastest for strict ping-pong. The slowdown with capacity comes from more buffer index manipulation and worse cache behaviour as the buffer grows.

---

## Failure Modes in Production

### Symptom: high goroutine count, growing

Stack profile shows hundreds or thousands of goroutines parked in `runtime.chanrecv1` or `runtime.gopark` with reason `chan receive` / `chan send`.

Cause: a channel was never closed, or never had a producer/consumer. The goroutines parked on it are leaked.

Diagnosis:

```bash
curl http://localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt
grep -B2 'chanrecv' goroutines.txt | head -50
```

The stack will show your application code and the channel address (in `chanrecv` arg 0). Look up the channel; if it should have closed by now, audit the producer.

### Symptom: occasional `send on closed channel` panic

Cause: a goroutine that closes the channel races with a goroutine that sends. Classic multi-producer scenario.

Diagnosis: panic stack trace points at the offending send line. Audit the close site. If multiple senders exist, the close should happen *after all senders are done* — usually via `sync.WaitGroup`.

Mitigation:

```go
var wg sync.WaitGroup
ch := make(chan T)
for i := 0; i < N; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for x := range source {
            ch <- transform(x)
        }
    }()
}
go func() {
    wg.Wait()
    close(ch)
}()
```

### Symptom: select biases toward one case

Cause: the cases are not biased by `selectgo` (it shuffles), but the *readiness* of the channels can be biased. If channel A always has data when the select runs, and channel B occasionally does, A will always be selected — even though they would tie if both had data.

Diagnosis: look at the channel buffer depths over time. If A is constantly at capacity and B at empty-ish, the select sees A as ready more often. This is correct behaviour, not a bug.

### Symptom: latency spike under load

Channel-based queueing serialises through `c.lock`. Under heavy load, `c.lock` becomes the bottleneck — every operation must acquire it, every wakeup must too. Profile shows time in `runtime.lock2` or `runtime.futex`.

Mitigation: shard channels. Split one channel into N; route by hash of the message. Each shard has its own lock.

### Symptom: deadlock during shutdown

Goroutines block forever waiting on a channel that nobody else is reading or closing.

```bash
SIGQUIT (or kill -3) → goroutine dump
```

The dump shows every parked goroutine with its stack. Channels parked on `chanrecv` or `chansend` indicate the leak.

---

## Runtime Invariants and Assertions

`runtime/chan.go` has several `throw()` calls that crash the program if invariants are violated. They are not user-facing panics — they indicate a runtime or compiler bug, or undefined behaviour from `unsafe`.

| Assertion | Triggered by |
|---|---|
| `"chansend: bad sudog elem"` | A parked sender's sudog.elem was non-nil on wake-up. Should be nil (receiver cleared it). |
| `"chansend: spurious wakeup"` | Sender woken with `success=false` but channel is not closed. Should never happen — indicates queue corruption. |
| `"runtime: sudog with non-nil elem"` | A sudog being released still has elem set. Indicates leak of the elem from prior use. |
| `"runtime: sudog with non-nil c"` | A sudog being released still references a channel. Should have been cleared on wake. |
| `"G waiting list is corrupted"` | `gp.waiting` does not match the sudog we expected. Concurrency bug. |
| `"gopark: bad g status"` | Goroutine status not `_Grunning` at gopark entry. Scheduler bug. |

These assertions exist because the runtime cannot recover from a corrupted sudog or queue. Crashing with a clear message is preferable to silent data corruption.

---

## How to Read a Stack Trace That Ends in `runtime.chan*`

Stack traces from `pprof/goroutine?debug=2` or panic dumps show every running goroutine. Channel-related entries to recognise:

### Parked sender

```
goroutine 42 [chan send]:
runtime.gopark(0x...)
        /usr/local/go/src/runtime/proc.go:374 +0xd6
runtime.chansend(0xc0000b8000, 0xc0000a0010, 0x1, 0x...)
        /usr/local/go/src/runtime/chan.go:259 +0x3b5
runtime.chansend1(0xc0000b8000, 0xc0000a0010)
        /usr/local/go/src/runtime/chan.go:144 +0x1d
main.producer(...)
        /home/user/app/main.go:42 +0x60
```

Interpretation: goroutine 42 is parked in `chansend` after step (H) — `gopark`. The channel buffer is full (or unbuffered with no receiver). The application line is `main.go:42`.

### Parked receiver

```
goroutine 43 [chan receive]:
runtime.gopark(0x...)
        /usr/local/go/src/runtime/proc.go:374 +0xd6
runtime.chanrecv(0xc0000b8000, 0xc0000a0020, 0x1)
        /usr/local/go/src/runtime/chan.go:577 +0x596
runtime.chanrecv1(0xc0000b8000, 0xc0000a0020)
        /usr/local/go/src/runtime/chan.go:441 +0x18
main.consumer(...)
        /home/user/app/main.go:55 +0x80
```

Receiver parked on `recvq`. The channel pointer `0xc0000b8000` is shared with goroutine 42 above — they are paired but neither is making progress (maybe a closed-vs-not-closed bug; maybe a deadlock).

### Parked on select

```
goroutine 44 [select]:
runtime.gopark(0x...)
        /usr/local/go/src/runtime/proc.go:374 +0xd6
runtime.selectgo(0xc000051f60, 0xc000051f44, 0x1, 0x0, 0x2, 0x1)
        /usr/local/go/src/runtime/select.go:328 +0x7bc
main.worker(...)
        /home/user/app/main.go:78 +0x100
```

Parked inside `selectgo` — waiting on multiple channels, no case ready, no default.

### Parked on nil channel

```
goroutine 45 [chan receive (nil chan)]:
runtime.gopark(0x...)
        /usr/local/go/src/runtime/proc.go:374 +0xd6
runtime.chanrecv(0x0, 0xc0000a0030, 0x1)
        /usr/local/go/src/runtime/chan.go:558 +0x1e9
runtime.chanrecv1(0x0, 0xc0000a0030)
        /usr/local/go/src/runtime/chan.go:441 +0x18
main.maybeListen(...)
        /home/user/app/main.go:90 +0x40
```

The first arg to `chanrecv` is `0x0` — a nil channel. This goroutine will block forever.

### Distinguishing forever-blocked from soon-to-wake

Both `forever` and short-wait look the same in the stack. The `[chan receive]` annotation in the goroutine state doesn't say which. To distinguish, look at the channel address; trace it back to its use site; check whether anyone is sending or about to close.

The Go runtime's deadlock detector ("all goroutines are asleep — deadlock!") fires only when *every* goroutine is parked. In a real server, there is usually at least one HTTP handler running, so the detector doesn't fire.

---

## Summary

The professional view of channel runtime behaviour is the runtime source itself plus the tooling to diagnose what goes wrong:

- `runtime/chan.go` implements the four primary functions in ~840 lines.
- `c.lock` is a spin-then-park futex mutex with a few hundred ns of critical-section cost.
- `selectgo` sorts channels by address to lock them deadlock-free, then shuffles for fair polling.
- `sudog` allocation uses a per-P cache; no GC allocation on hot paths.
- The runtime's cross-stack-write safety relies on `activeStackChans` and `adjustSudogs` during stack copy.
- The race detector and block profiler hook in at well-defined points.
- Failure modes (leaks, panics, lock contention) are diagnosable from goroutine dumps and pprof.

After reading this page plus `runtime/chan.go` and `runtime/select.go`, you should be able to explain to any colleague what happens, byte by byte, when their channel op runs — and you should be able to read a goroutine dump and call out the bug.

The specification page that follows lists the formal guarantees the runtime makes (and which the language spec rests on).
