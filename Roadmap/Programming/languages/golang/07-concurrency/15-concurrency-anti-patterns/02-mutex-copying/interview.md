---
layout: default
title: Interview
parent: Mutex Copying
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 6
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/02-mutex-copying/interview/
---

# Mutex Copying — Interview Questions

A graded set of 35 questions. Difficulty levels: J (junior), M (middle), S (senior), P (professional). Each question is followed by the expected answer and grading rubric.

---

## Q1 (J): What is a sync.Mutex?

**Expected answer**: `sync.Mutex` is a mutual exclusion primitive in Go. It has two methods, `Lock` and `Unlock`. While one goroutine holds the lock, any other goroutine calling `Lock` blocks until `Unlock` is called. It serialises access to shared state.

**Rubric**: Mention "mutual exclusion," "Lock/Unlock," "blocks/serialises."

---

## Q2 (J): Why is copying a sync.Mutex dangerous?

**Expected answer**: A `sync.Mutex` contains internal state (a state word and a semaphore field). Copying duplicates the state, producing two independent mutexes. Goroutines locking the original do not coordinate with goroutines locking the copy. The mutex no longer protects the shared data.

**Rubric**: Mention "independent mutexes," "no coordination," "fails to protect."

---

## Q3 (J): What does this code print?

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}

func main() {
    c := Counter{}
    for i := 0; i < 1000; i++ {
        c.Inc()
    }
    fmt.Println(c.n)
}
```

**Expected answer**: `0`. Each `Inc` call has a value receiver, so it operates on a copy of `c`. The original `c.n` is never modified.

**Rubric**: Identify "value receiver," "copy," "original unchanged."

---

## Q4 (J): How do you fix the previous code?

**Expected answer**: Change the receiver to a pointer: `func (c *Counter) Inc()`.

**Rubric**: Identify pointer receiver as the fix.

---

## Q5 (J): What tool catches mutex copy bugs at compile time?

**Expected answer**: `go vet` — specifically the `copylocks` analyser. It is part of the default vet pass.

**Rubric**: Name "go vet" or "copylocks."

---

## Q6 (J): Will the race detector catch a value-receiver mutex bug?

**Expected answer**: Not directly. The race detector catches data races (concurrent unsynchronised access). With a value receiver, each goroutine writes to its own copy, so the *struct* is not racy. But if the underlying data is shared (e.g., a map header), the race detector will catch races on that data. The structural mistake — the value receiver — is caught by vet, not race.

**Rubric**: Distinguish race-catches-data-races from vet-catches-structural-mistakes.

---

## Q7 (J): What does this code print?

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func main() {
    c := &Counter{}
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.mu.Lock()
            c.n++
            c.mu.Unlock()
        }()
    }
    wg.Wait()
    fmt.Println(c.n)
}
```

**Expected answer**: `100`. The mutex is correctly acquired through the pointer; all goroutines coordinate.

**Rubric**: Identify "100" and that the pointer fixes the coordination.

---

## Q8 (J): What does `go vet ./...` report for this code?

```go
type Cache struct {
    mu   sync.Mutex
    data map[string]string
}

func (c Cache) Get(k string) string {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.data[k]
}
```

**Expected answer**: `Get passes lock by value: Cache contains sync.Mutex`. The value receiver copies the Cache.

**Rubric**: Identify the copylocks diagnostic.

---

## Q9 (M): What is `sync.Locker`?

**Expected answer**: An interface in `sync` with `Lock()` and `Unlock()` methods. Types like `*sync.Mutex` and `*sync.RWMutex` satisfy it. Allows generic locker-handling code.

**Rubric**: Define the interface and name implementers.

---

## Q10 (M): Why does `*sync.Mutex` satisfy `sync.Locker` but `sync.Mutex` (value) does not?

**Expected answer**: `Lock` and `Unlock` are defined with pointer receivers on `*sync.Mutex`. The method set of `T` (value) does not include pointer-receiver methods; only `*T`'s method set does.

**Rubric**: Cite the method-set rule.

---

## Q11 (M): What is the noCopy idiom?

**Expected answer**: A zero-sized struct with `Lock()` and `Unlock()` methods (both no-ops). Embedding or naming a `noCopy` field in your type makes it appear to vet as a Locker-containing type, triggering the `copylocks` check. At runtime, the methods do nothing.

**Rubric**: Identify the structure, the purpose, and the lack of runtime effect.

---

## Q12 (M): When should you use a noCopy field?

**Expected answer**: When your type does NOT already contain a `sync.Mutex` (or other Locker) but should not be copied — for example, when it holds a unique resource, a self-referential pointer, or an identity. Types that already contain a `sync.Mutex` automatically trigger `copylocks`; they do not need `noCopy`.

**Rubric**: Identify the "no Locker already" case.

---

## Q13 (M): What does this code do?

```go
type T struct {
    mu sync.Mutex
}

func process(items []T) {
    for _, t := range items {
        t.mu.Lock()
        // ...
        t.mu.Unlock()
    }
}
```

**Expected answer**: It iterates the slice with a value-copy `t`. Each iteration locks a copy of `items[i]`, not `items[i]` itself. The mutex on the original element is never touched. Vet flags the range copy.

**Rubric**: Identify the range-copies-value problem.

---

## Q14 (M): How do you fix Q13?

**Expected answer**: Use indexed access:
```go
for i := range items {
    items[i].mu.Lock()
    // ...
    items[i].mu.Unlock()
}
```
Or take a pointer:
```go
for i := range items {
    t := &items[i]
    t.mu.Lock()
    // ...
    t.mu.Unlock()
}
```

**Rubric**: Show indexed access or `&items[i]`.

---

## Q15 (M): What does this code print?

```go
type Counter struct {
    sync.Mutex
    n int
}

func main() {
    a := Counter{}
    b := a
    a.Lock()
    a.n++
    a.Unlock()
    b.Lock()
    b.n++
    b.Unlock()
    fmt.Println(a.n, b.n)
}
```

**Expected answer**: `1 1`. Each Counter has its own n field and its own mutex. After the copy, modifying a does not affect b and vice versa. (Vet flags the `b := a` copy.)

**Rubric**: Identify the field copies and the independent counters.

---

## Q16 (M): Why might tests miss a mutex copy bug?

**Expected answer**: Tests often run with low concurrency, sequentially, or with deterministic timing. Mutex copy bugs may manifest only at higher concurrency or under specific timing. Race detector samples and may miss rare races. Vet catches the structural mistake without running the code, which is why CI should include vet.

**Rubric**: Mention concurrency level, timing, sampling, and the role of vet.

---

## Q17 (M): What is the difference between `sync.Mutex` and `sync.RWMutex`?

**Expected answer**: `sync.Mutex` allows one goroutine at a time. `sync.RWMutex` allows multiple readers concurrently but only one writer (and no readers when a writer is active or pending). RWMutex is for read-dominant workloads; the overhead is higher than Mutex for write-heavy or balanced workloads.

**Rubric**: Distinguish the access patterns and when each is appropriate.

---

## Q18 (M): What does this code print?

```go
type Box struct {
    mu sync.Mutex
    v  int
}

func main() {
    b := &Box{v: 1}
    b2 := *b // copy through dereference
    b.mu.Lock()
    b.v = 2
    b.mu.Unlock()
    fmt.Println(b.v, b2.v)
}
```

**Expected answer**: `2 1`. `b2 := *b` copies the Box (and the mutex). The lock on `b` does not affect `b2`. The write to `b.v` does not propagate to `b2.v`. (Vet flags the copy.)

**Rubric**: Identify the dereference copy.

---

## Q19 (M): When does `sync.Cond.Wait` panic?

**Expected answer**: If called without the associated lock `L` held. (The runtime checks this via the `copyChecker` and the lock state.) Also if called on a copied `Cond` (the `copyChecker` field's self-pointer test panics).

**Rubric**: Identify "must hold L" and the copy check.

---

## Q20 (S): Describe the internal layout of sync.Mutex.

**Expected answer**: Two fields: `state int32` and `sema uint32`. Total size 8 bytes. The state word packs lock state (locked, woken, starving) and waiter count. The sema word is used as the parking key for the runtime semaphore (goroutines park keyed by &mutex.sema).

**Rubric**: Identify both fields, their roles, and the size.

---

## Q21 (S): What does the runtime do when a goroutine blocks on Lock?

**Expected answer**: After failing the fast-path CAS, the goroutine attempts to spin briefly (if allowed by runtime_canSpin). If spinning does not succeed, it increments the waiter count in `state` and calls `runtime_SemacquireMutex(&m.sema, ...)`, which puts the goroutine to sleep, keyed by the address of the sema field. When unlocker calls Semrelease, the runtime wakes a goroutine parked at that address.

**Rubric**: Mention CAS, spin, park, Semacquire/Semrelease, key-by-address.

---

## Q22 (S): What is starvation mode in sync.Mutex?

**Expected answer**: When a waiter has waited >1ms, the mutex enters starvation mode. In this mode, the unlocker hands the lock directly to the front-of-queue waiter rather than letting new contenders race for it. Ensures fairness at the cost of throughput.

**Rubric**: Mention 1ms threshold, direct handoff, fairness vs throughput.

---

## Q23 (S): Explain why a mutex copy bug may produce neither panic nor visible misbehaviour.

**Expected answer**: If the copy happens after a Lock and the copy is then Lock/Unlocked in balanced sequences, each mutex's invariants are locally consistent. No fatal panic. But the data the mutexes "protect" is no longer coordinated; data races may occur. The race detector may or may not catch them due to sampling. The bug is silent until it manifests as logical errors (incorrect counts, missing updates) or rare races.

**Rubric**: Identify locally consistent invariants, the silent failure mode, and the role of -race.

---

## Q24 (S): How does the Go memory model interact with copied mutexes?

**Expected answer**: The model guarantees happens-before from Unlock to subsequent Lock on the *same mutex*. A copy is not the same mutex (different address). The happens-before relation does not bridge copies. Writes performed under one mutex's Lock are not guaranteed visible to readers locking the copy. This is the formal source of the resulting data race.

**Rubric**: Quote the happens-before clause and explain why copy breaks it.

---

## Q25 (S): Why does the copylocks analyser flag generic functions in recent Go versions but not older?

**Expected answer**: In Go 1.18+, generics introduced type parameters. The analyser instantiates generic functions in recent versions, applying the check to each instantiation. Older versions ran the analyser on the un-instantiated body, where `T` was `any`, so the check could not proceed.

**Rubric**: Identify generics introduction and instantiation analysis.

---

## Q26 (S): What is the difference between block profile and mutex profile?

**Expected answer**: Block profile records all events that block goroutines (channels, time.Sleep, mutex acquisitions). Mutex profile is mutex-specific, with different accounting: the unlocker is "blamed" with the wait time experienced by other goroutines on the same mutex. For lock-focused analysis, use mutex profile.

**Rubric**: Distinguish coverage and accounting.

---

## Q27 (S): How would you build a Counter type that cannot be copied at compile time?

**Expected answer**:
```go
type Counter struct {
    _ noCopy
    n int64
}

type noCopy struct{}
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```
Or embed a `sync.Mutex` directly (which has the same effect). Vet flags any copy of `Counter`. Constructor returns `*Counter`.

**Rubric**: Demonstrate `noCopy` or `sync.Mutex` embedding plus pointer constructor.

---

## Q28 (S): What does this code do under -race?

```go
type Cache struct {
    sync.RWMutex
    data map[string]int
}

func (c Cache) Get(k string) int {
    c.RLock()
    defer c.RUnlock()
    return c.data[k]
}

func (c *Cache) Set(k string, v int) {
    c.Lock()
    defer c.Unlock()
    c.data[k] = v
}

func main() {
    c := &Cache{data: map[string]int{}}
    go c.Set("x", 1)
    fmt.Println(c.Get("x"))
}
```

**Expected answer**: The race detector reports a data race on the map. `Get` has a value receiver, so it operates on a copy of the RWMutex; the RLock on the copy does not coordinate with the Lock on the original. Vet flags the value receiver.

**Rubric**: Identify the copy in Get, the resulting race, and that vet would have caught it.

---

## Q29 (S): How would you migrate a value-typed public API to pointer-typed?

**Expected answer**: Audit all callers. Change methods to pointer receivers. Change constructors to return *T. Change function parameters and returns from T to *T. Update map/channel element types. Update slice iteration to use indexed access. Run vet after each change. Update documentation. Add tests. Consider a deprecation cycle if external callers exist.

**Rubric**: List the audit and refactor steps in roughly this order.

---

## Q30 (S): What runtime tools help diagnose mutex copy bugs?

**Expected answer**: `go vet` catches structural copies. `go test -race` catches resulting data races at runtime. `runtime.SetMutexProfileFraction` + `go tool pprof` reveals contention (or, in copy-bug cases, suspicious lack of contention combined with high CPU in Lock/Unlock symbols). `runtime/trace` shows per-goroutine blocking behaviour.

**Rubric**: Name vet, race, mutex profile, trace.

---

## Q31 (P): At what point should a service switch from `sync.Mutex` to a sharded mutex?

**Expected answer**: When the mutex profile shows the lock dominating CPU% (typically >10%) or p99 lock acquire latency exceeds the service's latency budget. At ~10s of thousands of operations per second on a single mutex, contention becomes significant. Sharding splits the data across N mutexes (typically 2-4x the goroutine count); each shard has independent contention.

**Rubric**: Identify the profile-driven trigger and the sharding strategy.

---

## Q32 (P): When is `sync.Map` preferable to `map+sync.RWMutex`?

**Expected answer**: When the workload is one-write-many-read (keys are written once and then read repeatedly) or when writers are disjoint (different goroutines write different keys). For balanced or write-heavy workloads, `map+RWMutex` typically wins. Always benchmark.

**Rubric**: Identify the two specialised patterns and the need to benchmark.

---

## Q33 (P): What are the failure modes of distributed locking?

**Expected answer**: TTL expiration during long work (lock taken by another process); network partition (multiple holders); clock skew between processes and lock service; service downtime; lock-release race conditions (Unlock by previous holder). Fencing tokens (monotonic IDs validated by storage) provide the best protection against partitions. Without fencing, distributed locks are best-effort.

**Rubric**: Name partition, TTL, clock skew, and fencing tokens.

---

## Q34 (P): How should mutex contention be monitored in production?

**Expected answer**: Enable mutex profiling at process startup (low sampling rate, e.g., 1 in 1000). Expose `/debug/pprof/mutex` on an admin port. Ship continuous profiles to a centralised pprof viewer (Pyroscope, Parca, etc.). Track Prometheus metrics: lock acquire duration histograms, goroutine count, scheduler latency. Set alerts on CPU% in lock symbols, p99 acquire >Xms, sudden goroutine spikes.

**Rubric**: Name profiling, continuous capture, metrics, and alerts.

---

## Q35 (P): Design a thread-safe LRU cache that minimises mutex contention.

**Expected answer**: Shard the cache by key hash (e.g., 64 shards). Each shard has its own `sync.Mutex` and an LRU list. For very high traffic, consider per-key lock objects (token bucket), or accept eventual consistency and use atomic.Pointer to swap immutable snapshots. The exact choice depends on workload mix.

Sample structure:
```go
type LRU[K comparable, V any] struct {
    shards [64]*shard[K, V]
}

type shard[K comparable, V any] struct {
    mu    sync.Mutex
    list  *list.List
    items map[K]*list.Element
    cap   int
}
```

Each shard's mutex is independent; access spreads across shards. Production libraries: `github.com/dgraph-io/ristretto`, `github.com/hashicorp/golang-lru`.

**Rubric**: Identify sharding, per-shard locks, and reference production-grade libraries.

---

## Q36 (S): What is the impact of putting a `sync.Mutex` in a map value?

```go
var registry = map[string]Counter{}
```

**Expected answer**: Map values are not addressable. You cannot call pointer-receiver methods on `registry["x"]`. Even with value-receiver methods, every map index expression copies the Counter. The mutex in the map is effectively dead. Use `map[string]*Counter`.

**Rubric**: Identify addressability and the copy semantics.

---

## Q37 (S): How does sync.Pool handle the no-copy rule?

**Expected answer**: `sync.Pool` itself has a `noCopy` field. Items stored in the pool are interfaces (`any`); if the stored value is a struct-with-Mutex, the pool's `Get` and `Put` operate on the value through the interface, which holds a pointer to the heap-allocated value. Direct copies of the pool's `Pool` struct are flagged by vet. Pool items SHOULD always be pointers to avoid hidden copy issues.

**Rubric**: Identify noCopy on Pool, the interface boxing, and the recommendation to store pointers.

---

## Q38 (P): A service uses `sync.RWMutex` and has high read latency spikes during writes. Diagnose and fix.

**Expected answer**: Writers block all readers (and all readers must finish before writers proceed). If writes are slow, readers queue up during the write. Fix: move the write off-lock. For example, build a new snapshot off-lock, then atomically swap via `atomic.Pointer[T]`. Readers see a consistent (slightly stale) snapshot via lock-free load.

**Rubric**: Identify the writer-blocks-readers issue and the COW solution.

---

## Q39 (S): Why does `defer mu.Unlock()` immediately after `mu.Lock()` follow good practice?

**Expected answer**: It ensures Unlock runs even if the function panics or returns early. Pairing them directly avoids forgotten Unlocks. Some performance-critical code avoids defer due to its ~50 ns overhead, but for most cases the safety wins.

**Rubric**: Identify panic safety, early return safety, and the cost trade-off.

---

## Q40 (S): What does this code do?

```go
type T struct {
    mu sync.Mutex
    n  int
}

func main() {
    var t T
    ch := make(chan T, 1)
    ch <- t
    received := <-ch
    received.mu.Lock()
    received.n = 1
    received.mu.Unlock()
    fmt.Println(t.n)
}
```

**Expected answer**: Prints `0`. Two copies occur (`ch <- t` and `<-ch`). Modifications to `received.n` do not affect `t.n`. Vet flags both copies. Use `chan *T` to share state.

**Rubric**: Identify both channel copies and the resulting independent state.

---

## End of interview questions

Total: 40 graded questions covering all levels. Use as a study guide or interview rubric.
