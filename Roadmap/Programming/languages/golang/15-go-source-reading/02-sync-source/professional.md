# `sync` — Source Walkthrough

> Target: `go1.22`+. Files: `src/sync/{mutex,rwmutex,waitgroup,once,oncefunc,pool,map,cond,runtime,runtime2}.go`. Excerpts marked `// from sync/<file>, simplified` — fields renamed where helpful, race-detector annotations folded into their own section, panic-on-misuse branches elided unless they illuminate the algorithm.

---

## 1. Reading order

```
runtime.go       linkname bridge to runtime semaphores + scheduler
mutex.go         base primitive; everything else uses it
rwmutex.go       Mutex + atomic counter for readers
waitgroup.go     atomic 64-bit state + runtime semaphore
once.go          atomic fast path + Mutex slow path
oncefunc.go      generics over Once
cond.go          Locker + runtime notifyList
pool.go          per-P sharded free list; GC hook
map.go           atomic.Pointer[readOnly] + dirty fallback
```

Read bottom-up: every primitive collapses into "atomic state machine + one call into the runtime."

---

## 2. The runtime bridge

`sync` does not implement parking. `sync/runtime.go` reaches into `runtime` via `go:linkname`:

```go
// from sync/runtime.go, simplified (one //go:linkname per func; omitted for brevity)

func runtime_Semacquire(s *uint32)
func runtime_SemacquireMutex(s *uint32, lifo bool, skipframes int)
func runtime_SemacquireRWMutexR(s *uint32, lifo bool, skipframes int)
func runtime_SemacquireRWMutex(s *uint32, lifo bool, skipframes int)
func runtime_Semrelease(s *uint32, handoff bool, skipframes int)

func runtime_notifyListAdd(l *notifyList) uint32
func runtime_notifyListWait(l *notifyList, t uint32)
func runtime_notifyListNotifyOne(l *notifyList)
func runtime_notifyListNotifyAll(l *notifyList)

func runtime_canSpin(i int) bool
func runtime_doSpin()
func runtime_nanotime() int64

func runtime_registerPoolCleanup(cleanup func())
func runtime_procPin() int
func runtime_procUnpin()
```

`sync` owns the state (`uint32` semaphore, `notifyList`, `state64`); `runtime` owns parking, waking, scheduler interaction. The `Mutex`/`RWMutex` variants of `Semacquire` differ only in profiler accounting and the `lifo` flag — `pprof` attributes mutex contention to the right call site.

---

## 3. `Mutex` — `mutex.go`

### 3.1 State

```go
// from sync/mutex.go, simplified

type Mutex struct {
    state int32 // locked | woken | starving | (waiterShift)
    sema  uint32
}

const (
    mutexLocked           = 1 << 0
    mutexWoken            = 1 << 1
    mutexStarving         = 1 << 2
    mutexWaiterShift      = 3
    starvationThresholdNs = 1e6 // 1 ms
)
```

One `int32`: lock bit, "woken" hint to suppress duplicate wakes, starvation flag, 29-bit waiter count.

### 3.2 `Lock` — fast path

```go
// from sync/mutex.go, simplified

func (m *Mutex) Lock() {
    if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        if race.Enabled { race.Acquire(unsafe.Pointer(m)) }
        return
    }
    m.lockSlow()
}
```

One CAS, ~5 ns uncontended. `lockSlow` is a separate function so the fast path stays inlinable.

### 3.3 `lockSlow` — spin, park, maybe starve

```go
// from sync/mutex.go, simplified (race annotations elided)

func (m *Mutex) lockSlow() {
    var waitStartTime int64
    starving, awoke := false, false
    iter := 0
    old := m.state
    for {
        if old&(mutexLocked|mutexStarving) == mutexLocked && runtime_canSpin(iter) {
            if !awoke && old&mutexWoken == 0 && old>>mutexWaiterShift != 0 &&
                atomic.CompareAndSwapInt32(&m.state, old, old|mutexWoken) {
                awoke = true
            }
            runtime_doSpin(); iter++; old = m.state
            continue
        }
        new := old
        if old&mutexStarving == 0          { new |= mutexLocked }
        if old&(mutexLocked|mutexStarving) != 0 { new += 1 << mutexWaiterShift }
        if starving && old&mutexLocked != 0     { new |= mutexStarving }
        if awoke                                { new &^= mutexWoken }
        if atomic.CompareAndSwapInt32(&m.state, old, new) {
            if old&(mutexLocked|mutexStarving) == 0 { break } // acquired
            queueLifo := waitStartTime != 0
            if waitStartTime == 0 { waitStartTime = runtime_nanotime() }
            runtime_SemacquireMutex(&m.sema, queueLifo, 1)
            starving = starving || runtime_nanotime()-waitStartTime > starvationThresholdNs
            old = m.state
            if old&mutexStarving != 0 { // direct handoff from Unlock
                delta := int32(mutexLocked - 1<<mutexWaiterShift)
                if !starving || old>>mutexWaiterShift == 1 { delta -= mutexStarving }
                atomic.AddInt32(&m.state, delta)
                break
            }
            awoke = true; iter = 0
        } else {
            old = m.state
        }
    }
}
```

- **Spin gate.** `runtime_canSpin(iter)` returns false after 4 iterations, on uniprocessors, or when `GOMAXPROCS == 1`.
- **Starvation threshold.** A waiter queued > 1 ms sets `mutexStarving` on its next CAS. `Unlock` then hands the lock directly to the front-of-queue waiter; new arrivals cannot steal it.
- **LIFO re-park.** `queueLifo = waitStartTime != 0` puts a re-parking waiter at the head of the wait queue, bounding tail latency.

### 3.4 `Unlock` — fast path and handoff

```go
// from sync/mutex.go, simplified (race annotations elided)

func (m *Mutex) Unlock() {
    new := atomic.AddInt32(&m.state, -mutexLocked)
    if new != 0 { m.unlockSlow(new) }
}

func (m *Mutex) unlockSlow(new int32) {
    if (new+mutexLocked)&mutexLocked == 0 { fatal("sync: unlock of unlocked mutex") }
    if new&mutexStarving == 0 {
        for old := new; ; {
            if old>>mutexWaiterShift == 0 ||
                old&(mutexLocked|mutexWoken|mutexStarving) != 0 { return }
            new = (old - 1<<mutexWaiterShift) | mutexWoken
            if atomic.CompareAndSwapInt32(&m.state, old, new) {
                runtime_Semrelease(&m.sema, false, 1)
                return
            }
            old = m.state
        }
    } else {
        // Starving: leave mutexLocked set; handoff=true schedules the woken
        // waiter on the current P without going through the global runq.
        runtime_Semrelease(&m.sema, true, 1)
    }
}
```

---

## 4. `RWMutex` — `rwmutex.go`

### 4.1 State

```go
// from sync/rwmutex.go, simplified

const rwmutexMaxReaders = 1 << 30

type RWMutex struct {
    w           Mutex  // serialises writers
    writerSem   uint32 // writer parks here waiting for readers
    readerSem   uint32 // readers park here when writer is pending
    readerCount atomic.Int32 // >0 active readers; <0 writer pending
    readerWait  atomic.Int32 // readers a pending writer still waits for
}
```

Encoding: `readerCount > 0` means N readers active, no writer pending. Negative means a writer is pending; the real reader count is `readerCount + rwmutexMaxReaders`. One atomic load tells a reader whether to fast-path or park.

### 4.2 `RLock` / `RUnlock`

```go
// from sync/rwmutex.go, simplified (race annotations elided)

func (rw *RWMutex) RLock() {
    if rw.readerCount.Add(1) < 0 {
        runtime_SemacquireRWMutexR(&rw.readerSem, false, 0)
    }
}

func (rw *RWMutex) RUnlock() {
    if r := rw.readerCount.Add(-1); r < 0 { rw.rUnlockSlow(r) }
}

func (rw *RWMutex) rUnlockSlow(r int32) {
    if r+1 == 0 || r+1 == -rwmutexMaxReaders {
        fatal("sync: RUnlock of unlocked RWMutex")
    }
    if rw.readerWait.Add(-1) == 0 {
        runtime_Semrelease(&rw.writerSem, false, 1)
    }
}
```

Uncontended `RLock` is one atomic increment, ~3 ns. Readers do not touch `w`; reader goroutines on different cores do not serialise on the writer mutex.

### 4.3 `Lock` / `Unlock`

```go
// from sync/rwmutex.go, simplified (race annotations elided)

func (rw *RWMutex) Lock() {
    rw.w.Lock() // exclude other writers
    // Flip readerCount negative; r = active reader count when we flipped.
    r := rw.readerCount.Add(-rwmutexMaxReaders) + rwmutexMaxReaders
    if r != 0 && rw.readerWait.Add(r) != 0 {
        runtime_SemacquireRWMutex(&rw.writerSem, false, 0)
    }
}

func (rw *RWMutex) Unlock() {
    r := rw.readerCount.Add(rwmutexMaxReaders) // allow readers again
    if r >= rwmutexMaxReaders { fatal("sync: Unlock of unlocked RWMutex") }
    for i := 0; i < int(r); i++ {
        runtime_Semrelease(&rw.readerSem, false, 0)
    }
    rw.w.Unlock()
}
```

`r` snapshots the reader count when the writer flipped the sign. Each in-flight `RUnlock` decrements `readerWait`; the last one releases `writerSem`. Writer `Unlock` wakes every parked reader in a loop with `w` still held — readers cannot race back in before everyone is queued.

---

## 5. `WaitGroup` — `waitgroup.go`

### 5.1 State

```go
// from sync/waitgroup.go, simplified (go1.22)

type WaitGroup struct {
    noCopy noCopy
    state  atomic.Uint64 // hi 32: counter; lo 32: waiter count
    sema   uint32
}
```

Counter and waiter count packed into one 64-bit atomic word; the pre-1.20 12-byte alignment dance is gone.

### 5.2 `Add` / `Wait`

```go
// from sync/waitgroup.go, simplified (race annotations elided)

func (wg *WaitGroup) Add(delta int) {
    state := wg.state.Add(uint64(delta) << 32)
    v := int32(state >> 32) // counter
    w := uint32(state)      // waiters

    if v < 0 { panic("sync: negative WaitGroup counter") }
    if w != 0 && delta > 0 && v == int32(delta) {
        panic("sync: WaitGroup misuse: Add called concurrently with Wait")
    }
    if v > 0 || w == 0 { return }
    // v == 0 and w > 0: wake every waiter.
    if wg.state.Load() != state {
        panic("sync: WaitGroup misuse: Add called concurrently with Wait")
    }
    wg.state.Store(0) // reset for reuse
    for ; w != 0; w-- { runtime_Semrelease(&wg.sema, false, 0) }
}

func (wg *WaitGroup) Wait() {
    for {
        state := wg.state.Load()
        if int32(state>>32) == 0 { return }
        if wg.state.CompareAndSwap(state, state+1) {
            runtime_Semacquire(&wg.sema)
            if wg.state.Load() != 0 {
                panic("sync: WaitGroup is reused before previous Wait has returned")
            }
            return
        }
    }
}
```

`Done()` is `Add(-1)`. The post-wake `wg.state.Load() != 0` check catches `Add(N)` for a new round called before every prior waiter has returned — surfaces the bug instead of corrupting the count.

---

## 6. `Once`, `OnceFunc`, `OnceValue`

### 6.1 `Once.Do`

```go
// from sync/once.go, simplified

type Once struct {
    done atomic.Uint32 // hot field first
    m    Mutex
}

func (o *Once) Do(f func()) {
    if o.done.Load() == 0 {
        o.doSlow(f)
    }
}

func (o *Once) doSlow(f func()) {
    o.m.Lock()
    defer o.m.Unlock()
    if o.done.Load() == 0 {
        defer o.done.Store(1)
        f()
    }
}
```

`done` is first in the struct so the compiler emits a single load with no offset — the whole reason for the layout. Double-checked locking inside `doSlow` covers callers that lost the CAS. `defer o.done.Store(1)` flips the bit *after* `f` returns; if `f` panics, `done` stays 0 and `Do` retries on the next call.

### 6.2 `OnceFunc` / `OnceValue` — `oncefunc.go`

```go
// from sync/oncefunc.go, simplified (go1.21+)

func OnceValue[T any](f func() T) func() T {
    var (
        once   Once
        valid  bool
        p      any
        result T
    )
    g := func() {
        defer func() { p = recover(); if !valid { panic(p) } }()
        result = f()
        f = nil // free closure capture
        valid = true
    }
    return func() T {
        once.Do(g)
        if !valid { panic(p) } // re-panic on every subsequent call
        return result
    }
}
```

Behavioural change vs raw `Once`: a panic in `f` is cached and re-raised on every later call. `f = nil` after success drops the closure capture (GC-heap wins when `f` retained large state). `OnceFunc` and `OnceValues[T1, T2]` follow the same shape with zero and two result slots.

---

## 7. `Pool` — `pool.go`

### 7.1 Shape

```go
// from sync/pool.go, simplified

type Pool struct {
    noCopy noCopy

    local     unsafe.Pointer // *[P]poolLocal, one per P
    localSize uintptr

    victim     unsafe.Pointer // previous GC cycle's local
    victimSize uintptr

    New func() any
}

type poolLocalInternal struct {
    private any        // owner-only
    shared  poolChain  // lock-free deque
}

type poolLocal struct {
    poolLocalInternal
    pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte // cache-line pad
}
```

```
Pool.local --> [ P0 | P1 | P2 | P3 | ... | Pn-1 ]   one poolLocal per P
                  |
                  +-- private: single slot, accessed only by Pi's goroutine
                  +-- shared:  poolChain deque
                               head (owner LIFO) <--+--> tail (thieves FIFO)
```

`pad` rounds each `poolLocal` to a cache line; without it adjacent Ps would false-share and erase the locality win.

### 7.2 `Get` / `Put`

```go
// from sync/pool.go, simplified (race annotations elided)

func (p *Pool) Get() any {
    l, pid := p.pin() // runtime_procPin; pid stable until unpin
    x := l.private
    l.private = nil
    if x == nil {
        x, _ = l.shared.popHead()  // local LIFO
        if x == nil { x = p.getSlow(pid) } // steal peers + check victim
    }
    runtime_procUnpin()
    if x == nil && p.New != nil { x = p.New() }
    return x
}

func (p *Pool) getSlow(pid int) any {
    size := atomic.LoadUintptr(&p.localSize)
    locals := p.local
    for i := 0; i < int(size); i++ { // steal peers' tails (FIFO)
        l := indexLocal(locals, (pid+i+1)%int(size))
        if x, _ := l.shared.popTail(); x != nil { return x }
    }
    // Victim cache: previous GC's pool, same scan shape.
    size = atomic.LoadUintptr(&p.victimSize)
    if uintptr(pid) >= size { return nil }
    locals = p.victim
    l := indexLocal(locals, pid)
    if x := l.private; x != nil { l.private = nil; return x }
    for i := 0; i < int(size); i++ {
        l := indexLocal(locals, (pid+i)%int(size))
        if x, _ := l.shared.popTail(); x != nil { return x }
    }
    atomic.StoreUintptr(&p.victimSize, 0)
    return nil
}

func (p *Pool) Put(x any) {
    if x == nil { return }
    l, _ := p.pin()
    if l.private == nil { l.private = x } else { l.shared.pushHead(x) }
    runtime_procUnpin()
}
```

Three-tier lookup: private → local shared (LIFO) → peers' shared (FIFO steal) → victim cache → `New`. `runtime_procPin` keeps `pid` stable under preemption.

### 7.3 GC integration

```go
// from sync/pool.go, simplified

var (
    allPoolsMu Mutex
    allPools   []*Pool
    oldPools   []*Pool
)

func poolCleanup() { // called by runtime at STW phase of GC
    for _, p := range oldPools {
        p.victim = nil; p.victimSize = 0
    }
    for _, p := range allPools {
        p.victim = p.local; p.victimSize = p.localSize
        p.local = nil;      p.localSize = 0
    }
    oldPools, allPools = allPools, nil
}

func init() { runtime_registerPoolCleanup(poolCleanup) }
```

Two-generation strategy: items survive one GC cycle in the victim cache before being dropped. Hot pools see no measurable miss rate; cold pools release memory within two cycles. `init` is the only caller of `runtime_registerPoolCleanup` — completes the bidirectional bridge.

---

## 8. `Map` — `map.go`

### 8.1 Shape

```go
// from sync/map.go, simplified

type Map struct {
    mu     Mutex
    read   atomic.Pointer[readOnly] // hot, lock-free reads
    dirty  map[any]*entry           // protected by mu
    misses int                      // protected by mu
}

type readOnly struct {
    m       map[any]*entry
    amended bool // dirty has keys not in m
}

type entry struct {
    p atomic.Pointer[any] // value, or expunged sentinel
}

var expunged = unsafe.Pointer(new(any))
```

```
   Load(k):  atomic.Load(&read) --> readOnly.m[k] --> entry.p --> value   (hit: no mu)
                                       |
                                  miss + read.amended:
                                       v
                            mu.Lock(); dirty[k] -> entry.p; misses++
                            if misses >= len(dirty): promote dirty -> read
```

### 8.2 `Load` / `Store`

```go
// from sync/map.go, simplified

func (m *Map) Load(key any) (value any, ok bool) {
    read := m.loadReadOnly()
    e, ok := read.m[key]
    if !ok && read.amended {
        m.mu.Lock()
        read = m.loadReadOnly() // re-check after acquiring mu
        e, ok = read.m[key]
        if !ok && read.amended {
            e, ok = m.dirty[key]
            m.missLocked()
        }
        m.mu.Unlock()
    }
    if !ok { return nil, false }
    return e.load()
}

func (m *Map) missLocked() {
    m.misses++
    if m.misses < len(m.dirty) { return }
    m.read.Store(&readOnly{m: m.dirty}) // promote
    m.dirty = nil
    m.misses = 0
}

func (m *Map) Store(key, value any) {
    read := m.loadReadOnly()
    if e, ok := read.m[key]; ok && e.tryStore(&value) {
        return // CAS on entry.p; no mutex
    }
    m.mu.Lock()
    read = m.loadReadOnly()
    if e, ok := read.m[key]; ok {
        if e.unexpungeLocked() { m.dirty[key] = e }
        e.storeLocked(&value)
    } else if e, ok := m.dirty[key]; ok {
        e.storeLocked(&value)
    } else {
        if !read.amended { // first new key after promotion
            m.dirtyLocked() // snapshot read into dirty
            m.read.Store(&readOnly{m: read.m, amended: true})
        }
        m.dirty[key] = newEntry(value)
    }
    m.mu.Unlock()
}
```

Reads against keys present in `read` cost one atomic load + one map lookup. Writes against existing keys are a CAS on `entry.p`. Only new keys, deletes, and promotions touch `mu`. The `expunged` sentinel handles "deleted while in dirty"; `Store` of an expunged key reverses it via `unexpungeLocked`.

### 8.3 Promotion invariant

```
read.amended == false  =>  read.m is the complete key set; dirty is nil
read.amended == true   =>  some keys live only in dirty
misses >= len(dirty)   =>  promote: read <- dirty; dirty <- nil; misses <- 0
```

`sync.Map` is tuned for caches and disjoint-key write patterns; use `sync.RWMutex` over a regular map for everything else (per the package comment).

---

## 9. `Cond` — `cond.go`

```go
// from sync/cond.go, simplified

type Cond struct {
    noCopy  noCopy
    L       Locker
    notify  notifyList
    checker copyChecker
}

func (c *Cond) Wait() {
    c.checker.check()
    t := runtime_notifyListAdd(&c.notify) // ticket while L is still held
    c.L.Unlock()
    runtime_notifyListWait(&c.notify, t)  // park on the ticket
    c.L.Lock()
}

func (c *Cond) Signal()    { c.checker.check(); runtime_notifyListNotifyOne(&c.notify) }
func (c *Cond) Broadcast() { c.checker.check(); runtime_notifyListNotifyAll(&c.notify) }
```

`runtime_notifyListAdd` allocates a monotonically increasing ticket while `L` is held; `runtime_notifyListWait` parks on that ticket after `L` is released. The two-step protects against a "Signal called between Unlock and park" race — the runtime knows the ticket exists and wakes a goroutine that has not finished parking yet.

`copyChecker` is one `uintptr` initialised to its own address; any later call sees a different self-address if the `Cond` was value-copied, and panics. No allocation.

---

## 10. Race-detector annotations

Every primitive interleaves `race.Acquire`/`race.Release`; they are no-ops when `-race` is off (`if race.Enabled` gates them; the compiler strips both sides). Pattern:

- `Lock`/`RLock`/`Semacquire`-style → `race.Acquire(addr)` before returning to user code; `Unlock`/`RUnlock`/`Semrelease`-style → `race.Release(addr)` before the wake.
- `Pool.Put` → `race.ReleaseMerge`; `Pool.Get` → `race.Acquire` only if a value was returned. `Pool.Put` also drops ~25% of items under `-race` (`fastrandn(4) == 0`) to flush retention bugs.
- `RWMutex` acquires/releases against *both* `readerSem` and `writerSem` so the happens-before edge is recorded whichever path was taken.
- `race.Disable`/`race.Enable` wrap internal bookkeeping (e.g., `RWMutex.Unlock`'s wake loop) so internal reads don't trip spurious reports.

---

## 11. Shared types — `runtime2.go`

```go
// from sync/runtime2.go, simplified

type notifyList struct {
    wait   uint32         // next ticket
    notify uint32         // next to notify
    lock   uintptr        // runtime mutex (not sync.Mutex)
    head   unsafe.Pointer // *sudog parked list
    tail   unsafe.Pointer
}

type noCopy struct{}
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```

`notifyList`'s field order *must* match `runtime/sema.go`'s definition — `go:linkname` is layout-coupled, silent drift breaks `Cond`. Reviews of either file are paired.

`noCopy` is zero-size; `go vet`'s `copylocks` check rejects value-copies of any struct that embeds it. Zero runtime cost, catches the highest-frequency `sync` misuse at compile time.

---

## 12. Cross-references

- `Mutex.lockSlow` is the only place that uses `runtime_canSpin`/`runtime_doSpin`/`runtime_nanotime`. Every other primitive uses only the `Semacquire`/`Semrelease` subset.
- `Pool` is the only primitive using `runtime_procPin`/`runtime_procUnpin` and the only one with a GC-time hook (`runtime_registerPoolCleanup`).
- `Cond` is the only primitive that uses `notifyList` — the ticket protocol is what makes `Wait`/`Signal` race-safe.
- `Map`, `Once`, `OnceFunc`/`OnceValue` make no direct runtime calls. `Map` is "Mutex + `atomic.Pointer[readOnly]`"; `Once` is "atomic + `Mutex`".

The runtime surface for the entire `sync` package fits in one screen (§2). Everything else is atomic state machines around it.

---

## Further reading

- `src/sync/mutex.go` — top of file has the canonical commit message explaining starvation mode (Dmitry Vyukov, 2016).
- `src/sync/map.go` — package-level comment is the design rationale; mandatory before reaching for `sync.Map`.
- `src/sync/pool.go` — comments on `poolChain` describe the lock-free deque (Bryan Mills, 2019).
- `src/runtime/sema.go` — the runtime side of every `Semacquire`/`Semrelease`.
- `src/runtime/proc.go` — `canSpin`/`doSpin` and the goroutine parking machinery.
- Dmitry Vyukov, "Go's work-stealing scheduler" — same deque shape as `Pool`'s `shared`.
- Russ Cox, `go:linkname` reference notes — why `sync`/`runtime` use it and why nothing else should.
