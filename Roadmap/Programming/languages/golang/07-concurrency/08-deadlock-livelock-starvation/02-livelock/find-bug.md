# Livelock — Find the Bug

Each snippet below is a working Go program (or a fragment of one) that contains a livelock-related bug or a livelock-prone pattern. Read the code, identify the bug, then read the explanation. Try to spot the bug *before* reading the answer.

## Table of Contents
1. [Bug 1: The Innocent CAS Counter](#bug-1-the-innocent-cas-counter)
2. [Bug 2: TryLock with a Fixed Sleep](#bug-2-trylock-with-a-fixed-sleep)
3. [Bug 3: Polite Mutex Dance](#bug-3-polite-mutex-dance)
4. [Bug 4: Exponential Back-Off Without Jitter](#bug-4-exponential-back-off-without-jitter)
5. [Bug 5: Two Goroutines Yielding to Each Other](#bug-5-two-goroutines-yielding-to-each-other)
6. [Bug 6: The "Helpful" runtime.Gosched](#bug-6-the-helpful-runtimegosched)
7. [Bug 7: Seeded Same Rand](#bug-7-seeded-same-rand)
8. [Bug 8: Optimistic Update with No Bound](#bug-8-optimistic-update-with-no-bound)
9. [Bug 9: Snapshot Loop](#bug-9-snapshot-loop)
10. [Bug 10: Leader Election Without Random Timeout](#bug-10-leader-election-without-random-timeout)
11. [Bug 11: A Worker Pool that Self-Conflicts](#bug-11-a-worker-pool-that-self-conflicts)
12. [Bug 12: Retry with Logarithmic Backoff That Isn't](#bug-12-retry-with-logarithmic-backoff-that-isnt)
13. [Bug 13: The CAS-And-Sleep Combo](#bug-13-the-cas-and-sleep-combo)
14. [Bug 14: Recursive Retry on Conflict](#bug-14-recursive-retry-on-conflict)

---

## Bug 1: The Innocent CAS Counter

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var counter atomic.Int64
    var wg sync.WaitGroup

    for i := 0; i < 5000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 100; j++ {
                for {
                    old := counter.Load()
                    if counter.CompareAndSwap(old, old+1) {
                        break
                    }
                }
            }
        }()
    }
    wg.Wait()
    fmt.Println(counter.Load())
}
```

### What's wrong?

The CAS loop on a single hot counter with 5000 goroutines is the textbook CAS-loop livelock. Each round, only one of the 5000 attempts succeeds; the other 4999 retry. The program *will* eventually finish (lock-free guarantees that), but most CPU is wasted on failed CAS.

### Fix

Use the dedicated atomic operation:

```go
counter.Add(1)
```

`atomic.Int64.Add` compiles to a single `LOCK XADD` (on x86) — one round trip to the cache line per increment, no retry. Throughput goes from "barely usable" to "near hardware-limited."

If the update were not a simple increment (so you actually need CAS), the fixes are sharding or a `sync.Mutex` for the heavy-contention case.

---

## Bug 2: TryLock with a Fixed Sleep

```go
package main

import (
    "sync"
    "time"
)

var mu sync.Mutex

func doWorkPolitely() {
    for {
        if mu.TryLock() {
            defer mu.Unlock()
            // critical section
            return
        }
        time.Sleep(time.Millisecond)
    }
}
```

### What's wrong?

`time.Sleep(time.Millisecond)` is a *constant* wait. Two goroutines hitting this pattern at the same time will retry at the same instant 1 ms later. They re-collide on every millisecond tick.

This is the polite-people analogy in code form.

### Fix

Add jitter:

```go
time.Sleep(time.Duration(rand.Int63n(int64(time.Millisecond))))
```

Better: just use `mu.Lock()`. `sync.Mutex` parks losers in a FIFO queue with bounded delay; there is no livelock between newcomers and waiters.

Even better: question why `TryLock` is in the design at all. Most uses of `TryLock` are mistakes. The legitimate ones are rare (lock-acquisition timeouts where you also have a non-blocking fallback path).

---

## Bug 3: Polite Mutex Dance

```go
func transferA(a, b *sync.Mutex) {
    for {
        a.Lock()
        if b.TryLock() {
            // do work
            b.Unlock()
            a.Unlock()
            return
        }
        a.Unlock()
        // back off
        time.Sleep(10 * time.Millisecond)
    }
}

func transferB(a, b *sync.Mutex) {
    for {
        b.Lock()
        if a.TryLock() {
            // do work
            a.Unlock()
            b.Unlock()
            return
        }
        b.Unlock()
        time.Sleep(10 * time.Millisecond)
    }
}
```

### What's wrong?

`transferA` acquires `a` then tries `b`; `transferB` acquires `b` then tries `a`. They never deadlock (because the holder of one always releases before retrying), but they livelock — both repeatedly acquire one and fail the other, then sleep the same 10 ms and repeat.

### Fix

Two options:

1. **Lock ordering.** Both functions acquire in the same order — say, by address: `if uintptr(unsafe.Pointer(a)) < uintptr(unsafe.Pointer(b)) { ... }` — and then use plain `Lock()` on both. No retry loop, no livelock.

2. **Jitter.** Add `time.Duration(rand.Int63n(10_000_000))` to the sleep. Less elegant; still livelock-prone at very high contention.

The first is strictly better. Avoid back-off-and-retry mutex patterns unless you have no alternative.

---

## Bug 4: Exponential Back-Off Without Jitter

```go
func retry(op func() error) error {
    backoff := 100 * time.Millisecond
    for attempt := 0; attempt < 5; attempt++ {
        if err := op(); err == nil {
            return nil
        }
        time.Sleep(backoff)
        backoff *= 2
    }
    return errors.New("max attempts exceeded")
}
```

### What's wrong?

Exponential back-off with no jitter. Two goroutines that fail at the same time will retry at the same time on every subsequent attempt — they wait 100 ms, then 200 ms, then 400 ms, all in lockstep. If they collide initially, they keep colliding.

This is the canonical retry-storm pattern. The fact that it is "exponential" does not save it; symmetric backs-off preserve the symmetric collision.

### Fix

Add full jitter:

```go
sleep := time.Duration(rand.Int63n(int64(backoff)))
time.Sleep(sleep)
backoff *= 2
```

Or use `cenkalti/backoff`, which jitters by default.

---

## Bug 5: Two Goroutines Yielding to Each Other

```go
type Ready struct{ atomic.Bool }

var a, b Ready

func partA() {
    for {
        if a.Load() == b.Load() {
            // we are the same as the other; yield by flipping
            a.Store(!a.Load())
        } else {
            // we are different; do work
            return
        }
        time.Sleep(time.Millisecond)
    }
}

func partB() {
    for {
        if a.Load() == b.Load() {
            b.Store(!b.Load())
        } else {
            return
        }
        time.Sleep(time.Millisecond)
    }
}
```

### What's wrong?

Both goroutines try to make themselves *different* from the other. If they start equal, both flip — and end up equal again. Both observe equality, both flip, repeat.

This is a textbook livelock with two parties symmetrically reacting.

### Fix

Break the symmetry:

```go
func partA() {
    for {
        if a.Load() == b.Load() {
            a.Store(!a.Load())          // only A flips
        } else {
            return
        }
        time.Sleep(time.Duration(rand.Int63n(int64(time.Millisecond))))
    }
}

func partB() {
    // B never flips; waits for A.
    for a.Load() == b.Load() {
        time.Sleep(time.Millisecond)
    }
}
```

Asymmetric: A flips, B observes. No more livelock.

---

## Bug 6: The "Helpful" runtime.Gosched

```go
func busyWait(cond *atomic.Bool) {
    for !cond.Load() {
        runtime.Gosched()
    }
}
```

### What's wrong?

This is not strictly livelock — there is only one goroutine in the loop. But it is a busy-wait that the runtime cannot park, and combined with another goroutine spinning the same way, it is a livelock recipe.

`runtime.Gosched` does not park the goroutine; it just hints "I am willing to give up the CPU." The goroutine is immediately runnable again. With `GOMAXPROCS=1` this is benign (the other goroutine gets a chance); with multiple CPUs the calling goroutine just keeps spinning on its core.

### Fix

Use a primitive that *parks* the goroutine:

```go
// channel-based:
<-ready

// or sync.Cond:
mu.Lock()
for !ready { cond.Wait() }
mu.Unlock()
```

`Gosched` is rarely the right answer. The Go runtime is preemptive since 1.14; you do not need to manually yield in normal application code.

---

## Bug 7: Seeded Same Rand

```go
package main

import (
    "math/rand"
    "sync"
    "time"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            r := rand.New(rand.NewSource(42))  // BUG: same seed
            for attempt := 0; attempt < 10; attempt++ {
                time.Sleep(time.Duration(r.Int63n(int64(time.Millisecond))))
                // try something
            }
        }()
    }
    wg.Wait()
}
```

### What's wrong?

All five goroutines seed with `42`. They produce the same "random" sequence. The jitter is deterministic and identical across goroutines — all five retry at the same moments. The jitter does nothing.

### Fix

Different seeds, or use the global `rand` (Go 1.20+ seeds it automatically), or use `math/rand/v2`:

```go
import "math/rand/v2"

sleep := time.Duration(rand.Int64N(int64(time.Millisecond)))
```

`math/rand/v2` does not require seeding and is goroutine-safe with per-goroutine state.

---

## Bug 8: Optimistic Update with No Bound

```go
type Counter struct {
    mu sync.RWMutex
    v  int
}

func (c *Counter) IncIfLessThan(max int) bool {
    for {
        c.mu.RLock()
        v := c.v
        c.mu.RUnlock()
        if v >= max {
            return false
        }
        c.mu.Lock()
        if c.v != v {
            c.mu.Unlock()
            continue  // someone else updated, retry
        }
        c.v++
        c.mu.Unlock()
        return true
    }
}
```

### What's wrong?

The retry loop has no upper bound. Under heavy contention, `IncIfLessThan` may loop forever as other goroutines keep updating `v` between the read and the write.

This is a poorly designed optimistic update — it would be simpler and faster with a single write lock.

### Fix

Either bound the retries:

```go
for attempt := 0; attempt < 10; attempt++ {
    // ... try once ...
}
return false // or panic, or surface an error
```

Or use a single write lock from the start:

```go
func (c *Counter) IncIfLessThan(max int) bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.v >= max {
        return false
    }
    c.v++
    return true
}
```

The second is simpler and avoids the livelock entirely.

---

## Bug 9: Snapshot Loop

```go
type State struct {
    version atomic.Uint64
    a, b    atomic.Int64
}

func (s *State) ReadConsistent() (int64, int64) {
    for {
        v1 := s.version.Load()
        a := s.a.Load()
        b := s.b.Load()
        v2 := s.version.Load()
        if v1 == v2 {
            return a, b
        }
    }
}
```

### What's wrong?

If a writer continuously increments `version`, `a`, and `b` faster than the reader can complete the four loads, the reader will never see `v1 == v2`. Livelock.

### Fix

Bound the retries and fall back to a lock:

```go
for attempt := 0; attempt < 100; attempt++ {
    // ... try ...
}
// fall back to locked read
s.mu.Lock()
defer s.mu.Unlock()
return s.a.Load(), s.b.Load()
```

Or rearchitect using MVCC — wrap the whole state in an immutable struct and atomically swap the pointer on each update. The reader loads the pointer once and reads a frozen snapshot.

---

## Bug 10: Leader Election Without Random Timeout

```go
type Node struct {
    id int
    isLeader atomic.Bool
}

func (n *Node) tick(peers []*Node) {
    for {
        leaderExists := false
        for _, p := range peers {
            if p.isLeader.Load() {
                leaderExists = true
                break
            }
        }
        if !leaderExists {
            n.isLeader.Store(true)
        } else if n.isLeader.Load() {
            // duplicate leaders? demote ourselves.
            n.isLeader.Store(false)
        }
        time.Sleep(150 * time.Millisecond)
    }
}
```

### What's wrong?

Without randomised timeouts, two nodes can both see "no leader" at the same tick, both promote, both see a duplicate at the next tick, both demote. Livelock cycle.

This is the Raft-style election bug.

### Fix

Randomise the election timeout:

```go
sleep := 150*time.Millisecond +
    time.Duration(rand.Int63n(int64(150*time.Millisecond)))
time.Sleep(sleep)
```

Now node A and node B observe at different times, and the first to observe "no leader" promotes itself; the second observes a leader and stays passive.

---

## Bug 11: A Worker Pool that Self-Conflicts

```go
type Pool struct {
    jobs chan func()
    mu   sync.Mutex
    busy bool
}

func (p *Pool) Submit(j func()) {
    for {
        p.mu.Lock()
        if !p.busy {
            p.busy = true
            p.mu.Unlock()
            j()
            p.mu.Lock()
            p.busy = false
            p.mu.Unlock()
            return
        }
        p.mu.Unlock()
        time.Sleep(time.Millisecond)  // BUG: no jitter
    }
}
```

### What's wrong?

A "single-worker" pool where submitters poll for the `busy` flag, with no jitter. Many submitters synchronise on the millisecond tick.

### Fix

Use a channel:

```go
type Pool struct { jobs chan func() }

func NewPool() *Pool {
    p := &Pool{jobs: make(chan func(), 1)}
    go func() {
        for j := range p.jobs {
            j()
        }
    }()
    return p
}

func (p *Pool) Submit(j func()) {
    p.jobs <- j  // blocks if full; no spinning
}
```

The channel parks waiters. No spin loop, no livelock.

---

## Bug 12: Retry with Logarithmic Backoff That Isn't

```go
for attempt := 0; attempt < 10; attempt++ {
    if try() {
        return
    }
    // "logarithmic" backoff
    sleep := time.Duration(math.Log(float64(attempt+1))) * time.Millisecond
    time.Sleep(sleep)
}
```

### What's wrong?

Several:

1. `math.Log(1) = 0`, `math.Log(2) ≈ 0.69`, `math.Log(3) ≈ 1.1`. The sleeps are 0 ns, 0 ns, 1 ns, ... essentially nothing for the first few attempts.
2. No jitter.
3. The formula is opaque — nobody knows what it is supposed to do.

### Fix

Use exponential back-off with full jitter:

```go
base := 100 * time.Millisecond
sleep := time.Duration(rand.Int63n(int64(base << attempt)))
time.Sleep(sleep)
```

Or use `cenkalti/backoff` with documented parameters.

---

## Bug 13: The CAS-And-Sleep Combo

```go
for {
    old := counter.Load()
    if counter.CompareAndSwap(old, old+1) {
        return
    }
    time.Sleep(time.Microsecond)  // "give others a chance"
}
```

### What's wrong?

Combining CAS retry with `time.Sleep` is the worst of both worlds:

- CAS already retries quickly; the `Sleep` adds latency.
- Sleep without jitter does not break collision.
- `time.Microsecond` is below the resolution of most schedulers — actual sleep is much longer (often 1+ ms).

### Fix

Just use `counter.Add(1)`. If you must use CAS (because the update is more complex), drop the sleep — it does not help. If contention is heavy, switch to a `sync.Mutex`.

---

## Bug 14: Recursive Retry on Conflict

```go
func update(key string, fn func(v Value) Value) error {
    old, err := store.Get(key)
    if err != nil {
        return err
    }
    new := fn(old)
    if err := store.CompareAndSwap(key, old, new); err == ErrConflict {
        return update(key, fn)  // recurse on conflict
    } else if err != nil {
        return err
    }
    return nil
}
```

### What's wrong?

Two problems:

1. No bound on recursion — under heavy contention, this can recurse until stack overflow.
2. No back-off between attempts — pure busy-retry.

### Fix

Convert to an iterative loop with bounded attempts, exponential back-off, and jitter:

```go
func update(ctx context.Context, key string, fn func(v Value) Value) error {
    const maxAttempts = 10
    base := 1 * time.Millisecond
    for attempt := 0; attempt < maxAttempts; attempt++ {
        old, err := store.Get(key)
        if err != nil {
            return err
        }
        new := fn(old)
        err = store.CompareAndSwap(key, old, new)
        if err == nil {
            return nil
        }
        if err != ErrConflict {
            return err
        }
        sleep := time.Duration(rand.Int63n(int64(base << attempt)))
        select {
        case <-time.After(sleep):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return errors.New("update: max attempts exceeded")
}
```

This iterative form is bounded, jittered, and context-cancellable. No livelock, no stack overflow, no surprise.

---

## Summary

The patterns to recognise:

- **CAS loop on a single hot atomic** → use the dedicated atomic op, shard, or fall back to a mutex.
- **`TryLock` in a retry loop with no jitter** → either use plain `Lock()` or add jitter (better: rethink the design).
- **Two locks acquired in opposite orders with retry** → lock ordering by ID or address.
- **Exponential back-off without jitter** → add jitter.
- **Same seed across goroutines** → use `math/rand/v2` or seed differently.
- **Unbounded retry loops** → add a maximum attempt count and context cancellation.
- **Snapshot loops** → bound retries; consider MVCC.
- **Symmetric leader election** → randomised timeouts.

When in doubt: jitter, bound, and use the right primitive.
