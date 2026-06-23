# Lock-Free vs Wait-Free — Find the Bug

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Bug Pattern 1: CAS Loop Mislabelled Wait-Free](#bug-pattern-1-cas-loop-mislabelled-wait-free)
3. [Bug Pattern 2: Hidden Mutex Inside "Lock-Free"](#bug-pattern-2-hidden-mutex-inside-lock-free)
4. [Bug Pattern 3: Channel Claimed Non-Blocking](#bug-pattern-3-channel-claimed-non-blocking)
5. [Bug Pattern 4: Bounded Retry Mislabelled Wait-Free](#bug-pattern-4-bounded-retry-mislabelled-wait-free)
6. [Bug Pattern 5: Helping Without a Bound](#bug-pattern-5-helping-without-a-bound)
7. [Bug Pattern 6: Mixed Class Claimed Uniform](#bug-pattern-6-mixed-class-claimed-uniform)
8. [Bug Pattern 7: Read of Non-Atomic Field in Seqlock](#bug-pattern-7-read-of-non-atomic-field-in-seqlock)
9. [Bug Pattern 8: Lock-Free Stack with ABA Risk](#bug-pattern-8-lock-free-stack-with-aba-risk)
10. [Bug Pattern 9: Wait-Free Claim with Allocation in the Hot Path](#bug-pattern-9-wait-free-claim-with-allocation-in-the-hot-path)
11. [Bug Pattern 10: Wait-Free Read with Blocking Write Misclassified](#bug-pattern-10-wait-free-read-with-blocking-write-misclassified)
12. [Bug Pattern 11: Spinlock Claimed Lock-Free](#bug-pattern-11-spinlock-claimed-lock-free)
13. [Bug Pattern 12: Wait-Free Across GC Pauses](#bug-pattern-12-wait-free-across-gc-pauses)
14. [Diagnostic Checklist](#diagnostic-checklist)

---

## How to Use This File

Each bug pattern below is a real misclassification you will encounter in code reviews, design docs, and library documentation. The pattern is:

- *The buggy code or claim.* Often verbatim from real codebases (with names changed).
- *Why it is wrong.* What progress class the code actually delivers.
- *How to fix.* Either correct the claim or fix the code.

Read each pattern, then try to spot the same pattern in your own codebase. The point of this file is to make you a good reviewer, not just a good implementer.

---

## Bug Pattern 1: CAS Loop Mislabelled Wait-Free

### The buggy claim

```go
// WaitFreeCounter is a wait-free counter.
type WaitFreeCounter struct {
    n atomic.Int64
}

func (c *WaitFreeCounter) Add(delta int64) {
    for {
        old := c.n.Load()
        if c.n.CompareAndSwap(old, old+delta) {
            return
        }
    }
}
```

### Why it is wrong

The CAS loop has no static bound on iterations. Under contention, one goroutine can in principle retry forever. The algorithm is *lock-free*, not wait-free. Renaming the type to `WaitFreeCounter` does not change the progress class — code does not honour comments.

### The fix

Two options:

1. *Use `c.n.Add(delta)` directly.* The dedicated `Add` is wait-free per call (one instruction). Rename the type accordingly, drop the loop.
2. *Keep the loop and rename the type to `LockFreeCounter`.* Honest is better than aspirational.

```go
// LockFreeCounter is lock-free: under contention, individual operations
// may retry without bound, but the system as a whole always makes progress.
type LockFreeCounter struct { ... }

// Or, if you want wait-free:

// WaitFreeCounter uses atomic.Int64.Add, which is one hardware instruction.
type WaitFreeCounter struct {
    n atomic.Int64
}
func (c *WaitFreeCounter) Add(delta int64) {
    c.n.Add(delta)
}
```

---

## Bug Pattern 2: Hidden Mutex Inside "Lock-Free"

### The buggy claim

```go
// LockFreeMap is a lock-free concurrent map.
type LockFreeMap struct {
    m  map[string]int
    mu sync.RWMutex
}

func (m *LockFreeMap) Get(k string) (int, bool) {
    m.mu.RLock()
    defer m.mu.RUnlock()
    v, ok := m.m[k]
    return v, ok
}

func (m *LockFreeMap) Put(k string, v int) {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.m[k] = v
}
```

### Why it is wrong

`sync.RWMutex` is a blocking primitive. Adding "LockFree" to the type name is marketing, not engineering. A reader who calls `Get` while a writer holds `Lock` waits. That is the definition of blocking.

### The fix

Either:

1. *Rename honestly.* `MutexMap` or `RWMutexMap`. The implementation is fine; the name lies.
2. *Implement actually lock-free.* Use `atomic.Pointer[map[string]int]` with copy-on-write writes. Reads are wait-free; writes are `O(map size)` blocking.

```go
type CoWMap struct {
    p atomic.Pointer[map[string]int]
    mu sync.Mutex
}
func (m *CoWMap) Get(k string) (int, bool) {
    p := m.p.Load()
    v, ok := (*p)[k]
    return v, ok
}
func (m *CoWMap) Put(k string, v int) {
    m.mu.Lock()
    defer m.mu.Unlock()
    old := m.p.Load()
    next := make(map[string]int, len(*old)+1)
    for kk, vv := range *old {
        next[kk] = vv
    }
    next[k] = v
    m.p.Store(&next)
}
```

Now the read path is wait-free per call (one atomic load plus a map read). Document accordingly.

---

## Bug Pattern 3: Channel Claimed Non-Blocking

### The buggy claim

```go
// NonBlockingQueue is a non-blocking queue backed by a buffered channel.
type NonBlockingQueue[T any] struct {
    ch chan T
}

func (q *NonBlockingQueue[T]) Push(v T) {
    q.ch <- v
}

func (q *NonBlockingQueue[T]) Pop() T {
    return <-q.ch
}
```

### Why it is wrong

A buffered channel blocks the sender when full and the receiver when empty. Channels are internally mutex-protected. The "NonBlocking" name is wrong.

If the author meant "non-blocking under no contention," that is true of *any* mutex-protected primitive — uncontended is fast. The name implies a stronger guarantee than the implementation delivers.

### The fix

Either:

1. *Rename.* `BufferedQueue` or `ChanQueue`.
2. *Use a `select` with `default` for the non-blocking variant.*

```go
func (q *Queue[T]) TryPush(v T) bool {
    select {
    case q.ch <- v:
        return true
    default:
        return false
    }
}
```

The `TryPush` is wait-free *per call*: one attempt, one outcome. But it can drop messages.

---

## Bug Pattern 4: Bounded Retry Mislabelled Wait-Free

### The buggy claim

```go
// WaitFreeUpdate updates the slot atomically, bounded by 16 retries.
func WaitFreeUpdate(s *atomic.Int64, transform func(int64) int64) error {
    for i := 0; i < 16; i++ {
        old := s.Load()
        if s.CompareAndSwap(old, transform(old)) {
            return nil
        }
    }
    return errContended
}
```

### Why it is wrong

Wait-free requires every operation to *complete* in bounded steps — not just *terminate* in bounded steps. This function terminates in bounded steps but can terminate with failure (`errContended`). The formal progress class is *bounded lock-free*, not wait-free.

The distinction matters in design reviews. A wait-free interface guarantees the caller will get a successful result. A bounded-lock-free interface tells the caller "you might need to retry."

### The fix

Either:

1. *Rename and document.* `BoundedUpdate` with a comment: "Bounded but not wait-free; can return errContended after 16 retries."
2. *Make it actually wait-free.* For a single counter, use `s.Add(delta)`. For more complex updates, you need helping — and you need to confirm the helping bound.

---

## Bug Pattern 5: Helping Without a Bound

### The buggy claim

```go
// WaitFreeQueue with a "helping" mechanism.
type WaitFreeQueue struct {
    pending atomic.Pointer[node]
    // ...
}

func (q *WaitFreeQueue) Enqueue(v int) {
    n := &node{value: v}
    q.pending.Store(n)
    for {
        // help any pending operation
        p := q.pending.Load()
        if p == nil {
            return
        }
        q.doActual(p)
    }
}
```

### Why it is wrong

The "helping" loop has no static bound. If new operations keep arriving, an arriving thread can loop forever helping. That is *unbounded helping*, which makes the algorithm lock-free (or worse) but not wait-free.

A real wait-free algorithm caps the helping work per call. Kogan-Petrank uses a phase counter: arriving threads help operations with phase strictly less than their own, and there are at most `N` such operations.

### The fix

Add a phase counter and bound the work:

```go
func (q *WaitFreeQueue) Enqueue(v int, tid int) {
    n := &node{value: v}
    phase := q.phase.Add(1)
    n.phase = phase
    q.announce[tid].Store(n)

    for tid := 0; tid < N; tid++ {
        p := q.announce[tid].Load()
        if p == nil || p.done.Load() || p.phase >= phase {
            continue
        }
        q.completeOne(p)
    }
}
```

Now the helping loop runs at most `N` times per call. The algorithm has a per-call step bound of `O(N)`, which is the wait-free property.

---

## Bug Pattern 6: Mixed Class Claimed Uniform

### The buggy claim

```go
// LockFreeRegistry registers services.
type LockFreeRegistry struct {
    fast atomic.Pointer[map[string]*Service]
    mu   sync.Mutex
    dirty map[string]*Service
}

func (r *LockFreeRegistry) Lookup(name string) *Service {
    m := r.fast.Load()
    if s, ok := (*m)[name]; ok {
        return s
    }
    r.mu.Lock()
    defer r.mu.Unlock()
    return r.dirty[name]
}

func (r *LockFreeRegistry) Register(name string, s *Service) {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.dirty[name] = s
    // periodic promotion logic omitted
}
```

### Why it is wrong

The type's docstring says "lock-free." `Register` is blocking (mutex). `Lookup` is wait-free *if the key is in the fast map* and blocking otherwise. The class is *mixed*, not uniform.

Documentation that ignores mixed classes confuses callers. A reader of `Lookup`'s docstring should know whether their call will block.

### The fix

Document per-method, not per-type:

```go
// Registry stores services.
//
// Progress classes:
//   Lookup (hot key):  wait-free (one atomic load, one map lookup)
//   Lookup (miss):     blocking (mutex-protected dirty map)
//   Register:          blocking (mutex-protected)
type Registry struct { ... }
```

The type itself is no longer claimed to be "lock-free." Each method's class is honest about which paths block.

---

## Bug Pattern 7: Read of Non-Atomic Field in Seqlock

### The buggy claim

```go
type Seqlock struct {
    seq atomic.Uint64
    x, y, z int64 // protected by seq
}

func (s *Seqlock) Read() (int64, int64, int64) {
    for {
        s1 := s.seq.Load()
        if s1&1 != 0 {
            continue
        }
        x, y, z := s.x, s.y, s.z // racy
        s2 := s.seq.Load()
        if s1 == s2 {
            return x, y, z
        }
    }
}
```

### Why it is wrong

In Go, a plain read of `s.x` concurrent with a plain write is a data race. The Go memory model gives no guarantee about what value is read. The race detector flags this. The seqlock pattern as written in C/C++ relies on memory-fence semantics that Go does not provide for non-atomic types.

The author may think the seqlock pattern is wait-free *and* race-free; it is neither.

### The fix

Either:

1. *Use atomic loads for the protected fields.*

```go
type Seqlock struct {
    seq atomic.Uint64
    x, y, z atomic.Int64
}

func (s *Seqlock) Read() (int64, int64, int64) {
    for {
        s1 := s.seq.Load()
        if s1&1 != 0 {
            continue
        }
        x := s.x.Load()
        y := s.y.Load()
        z := s.z.Load()
        s2 := s.seq.Load()
        if s1 == s2 {
            return x, y, z
        }
    }
}
```

2. *Wrap the protected state in a single atomic.Pointer.*

```go
type State struct{ x, y, z int64 }
type Seqlock struct {
    p atomic.Pointer[State]
}
func (s *Seqlock) Read() State { return *s.p.Load() }
func (s *Seqlock) Write(v State) { s.p.Store(&v) }
```

The second pattern is simpler in Go and gets the same wait-free read property.

---

## Bug Pattern 8: Lock-Free Stack with ABA Risk

### The buggy claim

```go
// LockFreeStack of int64.
type LockFreeStack struct {
    head atomic.Pointer[node]
}
type node struct {
    value int64
    next  *node
}

func (s *LockFreeStack) Pop() (int64, bool) {
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

### Why it is wrong (in C; less wrong in Go)

In C/C++ with manual memory management, this Pop is vulnerable to the ABA problem: T1 reads `head = A`, computes `next = A.next = B`. T2 pops A, pops B, frees both, pushes a new node back at the same address A, with a different `next`. T1 resumes, CAS sees head == A and succeeds, but `next` points to garbage.

In Go, the GC saves you: as long as T1 holds a reference to `A` in its local `top`, `A` cannot be reused. But the pattern is fragile — if you later optimise by using a pool of pre-allocated nodes, the ABA vulnerability returns.

### The fix

For Go: leave it alone but document the dependency on GC. For a pooled variant: tag the head pointer with a version counter (a 128-bit double-word CAS or a tagged pointer).

```go
// Note: relies on Go's GC to prevent ABA. If you pool nodes,
// add a version counter (see 02-aba-problem).
```

The relevance to this folder: the Pop above is *lock-free*. ABA is a *correctness* bug. The two concerns are orthogonal — fixing ABA does not change the progress class, and changing the progress class (say, to wait-free) does not eliminate ABA. Know which problem you are solving.

---

## Bug Pattern 9: Wait-Free Claim with Allocation in the Hot Path

### The buggy claim

```go
// WaitFreeRingBuffer (allegedly).
type WaitFreeRingBuffer struct {
    head atomic.Uint64
    tail atomic.Uint64
    buf  []*item // pointers
}

func (r *WaitFreeRingBuffer) Push(v int) bool {
    h := r.head.Load()
    t := r.tail.Load()
    if h-t == uint64(len(r.buf)) {
        return false
    }
    r.buf[h&mask] = &item{value: v} // allocation
    r.head.Store(h + 1)
    return true
}
```

### Why it is wrong

The allocation `&item{value: v}` calls into the Go runtime allocator. Under normal load, allocation is fast; under high allocation rate, the runtime may trigger GC, which stops the world. The "wait-free per call" claim ignores the allocator and the GC.

For audio or hard-real-time, this is fatal. The function's worst-case latency is dominated by the worst-case GC pause, which can be milliseconds.

### The fix

Pre-allocate or use a value type:

```go
type WaitFreeRingBuffer struct {
    head atomic.Uint64
    tail atomic.Uint64
    buf  []item // values, not pointers
}

func (r *WaitFreeRingBuffer) Push(v int) bool {
    h := r.head.Load()
    t := r.tail.Load()
    if h-t == uint64(len(r.buf)) {
        return false
    }
    r.buf[h&mask] = item{value: v}
    r.head.Store(h + 1)
    return true
}
```

No allocation in the hot path. The wait-free claim is now defensible against the allocator (still vulnerable to GC pauses, but those affect every goroutine equally).

---

## Bug Pattern 10: Wait-Free Read with Blocking Write Misclassified

### The buggy claim

```go
// WaitFreeConfig is wait-free. Reads and writes are both wait-free.
type WaitFreeConfig struct {
    p  atomic.Pointer[Config]
    mu sync.Mutex
}

func (c *WaitFreeConfig) Load() *Config {
    return c.p.Load()
}

func (c *WaitFreeConfig) Reload() {
    c.mu.Lock()
    defer c.mu.Unlock()
    newCfg := readFromDisk()
    c.p.Store(newCfg)
}
```

### Why it is wrong

`Reload` takes `c.mu`. Two concurrent reloaders serialise on the mutex. The class is *blocking*, not wait-free. Only `Load` is wait-free.

### The fix

Document per-method:

```go
// Config holds a pointer to the live configuration.
//
// Progress classes:
//   Load:   wait-free (one atomic load)
//   Reload: blocking (mutex serialises concurrent reloads)
type Config struct { ... }
```

The implementation is fine; the docstring lies. Fixing the docstring fixes the bug.

---

## Bug Pattern 11: Spinlock Claimed Lock-Free

### The buggy claim

```go
// SpinLock is a lock-free spin lock.
type SpinLock struct {
    held atomic.Bool
}

func (s *SpinLock) Lock() {
    for !s.held.CompareAndSwap(false, true) {
        // spin
    }
}

func (s *SpinLock) Unlock() {
    s.held.Store(false)
}
```

### Why it is wrong

A spinlock is a *lock*. It blocks waiters. The fact that it spins on an atomic rather than parking does not change the progress class. Calling it lock-free conflates "implemented with atomics" with "lock-free as a progress class."

Lock-free, formally, means no thread can be permanently blocked by another. A spinlock's holder can be descheduled, and waiters spin forever. That is the definition of blocking.

### The fix

Rename:

```go
// SpinLock is a busy-wait mutex. It is blocking, not lock-free —
// the name refers to the wait strategy, not the progress class.
type SpinLock struct { held atomic.Bool }
```

Or use `sync.Mutex` and avoid the entire trap.

---

## Bug Pattern 12: Wait-Free Across GC Pauses

### The buggy claim

A blog post or design doc says:

"Our metric counter is wait-free, so we can sample it from the audio callback without risk of stutter."

### Why it is wrong

The audio callback in Go runs on a goroutine, which is subject to GC pauses. Even if the counter's `Add` is wait-free in the formal sense (one instruction), the *calling goroutine* can be paused mid-callback by the GC. The wait-free property is preserved at the data structure level but violated at the system level.

For audio in particular, this is fatal. A 1-millisecond GC pause is an audible glitch.

### The fix

Either:

1. *Move the audio callback out of Go.* Run the audio thread as a real OS thread with real-time priority, using cgo to access shared wait-free state.
2. *Accept the glitch.* For non-critical applications (a UI sound effect rather than music production), a glitch is tolerable.

The point: wait-free at the algorithm level does not imply latency-bounded at the application level when the language has a stop-the-world GC. Be precise about which property you are claiming.

---

## Diagnostic Checklist

When you see a "wait-free" or "lock-free" claim in code, run this checklist:

1. **Is there a `for` loop with a CAS inside and no exit condition other than CAS success?** If yes, the algorithm is at best lock-free, not wait-free.
2. **Is there a mutex anywhere in the type, even one labelled "internal" or "cold"?** If yes, the type has blocking paths. Mixed class.
3. **Are channels used inside the type?** Channels are blocking primitives. The type has blocking paths.
4. **Does the claim cite an integer bound `B`?** A wait-free claim without a bound is suspicious. Look for `O(N)` or `O(1)`.
5. **If helping is used, is the help loop bounded statically?** Unbounded helping is unbounded retries — not wait-free.
6. **Are there allocations in the hot path?** Allocations call into the runtime. The wait-free claim covers the algorithm; the allocator is a separate axis.
7. **Are there pointer dereferences that could read stale memory across GC?** Unlikely in Go (the GC ensures liveness), but worth a thought for cgo and unsafe code.
8. **Is the claim per-method or per-type?** Per-type claims are almost always wrong for non-trivial types. Per-method is more honest.
9. **Does the test suite exercise contention?** A single-threaded test cannot verify the progress class.
10. **Does the test suite measure tail latency?** Throughput tests hide the lock-free / wait-free gap.

A claim that survives all ten questions is probably honest. A claim that fails any one is suspect. A claim that fails three or more is almost certainly wrong.

The most valuable habit in this space is *skepticism*. Wait-free is a strong claim. The math behind it is unforgiving. When someone says "wait-free," the right response is "show me the bound."
