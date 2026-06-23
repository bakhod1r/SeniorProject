# Mutex and Block Profiling — Find the Bug

A collection of realistic contention bugs. For each: the symptom, the (subtle) cause, and the fix. Reading them in order builds the intuition you need to diagnose lock and channel pathologies in the wild.

---

## Bug 1: The global lock pretending to be small

```go
var (
    mu      sync.Mutex
    counter int64
)

func Inc() {
    mu.Lock()
    counter++
    mu.Unlock()
}
```

**Symptom.** At low load, fine. At 50k QPS across 16 cores, p99 latency triples and CPU plateaus at ~400% (instead of 1600%).

**Cause.** Even though the critical section is a single increment, the cache line holding the mutex word bounces across all 16 cores. Cores spend most of their time spinning on the lock acquire path.

**Fix.** Replace with an atomic counter:

```go
var counter atomic.Int64

func Inc() { counter.Add(1) }
```

The mutex profile for this code goes from "biggest stack" to zero.

---

## Bug 2: The `defer mu.Unlock()` that holds for too long

```go
func (s *Store) Save(k string, v Value) error {
    s.mu.Lock()
    defer s.mu.Unlock()

    s.cache[k] = v
    return s.persistToDisk(k, v) // 20 ms of I/O while holding the lock
}
```

**Symptom.** Mutex profile shows `Store.Save` at the top by `cum`. Goroutine count grows when a disk spike happens.

**Cause.** `defer` runs at function return. The lock is held for the entire `persistToDisk` call — 20 ms during which nothing else can `Save` or `Load`.

**Fix.** Split the critical section:

```go
func (s *Store) Save(k string, v Value) error {
    s.mu.Lock()
    s.cache[k] = v
    s.mu.Unlock()

    return s.persistToDisk(k, v)
}
```

Or restructure so persistence is async (the `cache` mutation completes immediately; a background goroutine flushes).

---

## Bug 3: The `RWMutex` write that starves all readers

```go
type Config struct {
    mu     sync.RWMutex
    flags  map[string]bool
}

func (c *Config) Get(k string) bool {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.flags[k]
}

func (c *Config) Reload(path string) error {
    c.mu.Lock()
    defer c.mu.Unlock()
    return loadFromFile(path, c.flags) // 200 ms — disk read + parse
}
```

**Symptom.** A new top-of-profile mutex stack appears whenever `Reload` runs. P99 latency of `Get` spikes to ~200 ms during the reload window.

**Cause.** `RWMutex` is write-preferring: once a writer waits, new readers block too. With `Reload` holding the write lock for 200 ms, every concurrent `Get` waits.

**Fix.** Build the new state outside the lock; swap atomically:

```go
type Config struct {
    flags atomic.Pointer[map[string]bool]
}

func (c *Config) Get(k string) bool {
    return (*c.flags.Load())[k]
}

func (c *Config) Reload(path string) error {
    fresh := make(map[string]bool)
    if err := loadFromFile(path, fresh); err != nil {
        return err
    }
    c.flags.Store(&fresh)
    return nil
}
```

Readers no longer lock at all. The mutex profile loses the writer stack entirely.

---

## Bug 4: The unbuffered channel that ties two goroutines

```go
results := make(chan Result)

go func() {
    for r := range results {
        save(r) // 5 ms each
    }
}()

for _, item := range items {
    r := process(item) // 1 ms each
    results <- r       // blocks waiting for save
}
```

**Symptom.** Total throughput is ~200 items/sec instead of ~1000. Block profile shows the producer waiting on `chan send`.

**Cause.** The unbuffered channel forces a rendezvous: the producer sleeps until the consumer is ready. Two goroutines run sequentially despite being on different cores.

**Fix.** Buffer the channel:

```go
results := make(chan Result, 1024)
```

Or scale the consumer:

```go
for i := 0; i < runtime.GOMAXPROCS(0); i++ {
    go func() { for r := range results { save(r) } }()
}
```

The block profile delay on `chan send` drops to near zero once the consumer keeps up.

---

## Bug 5: The lock initialised in a struct copy

```go
type Worker struct {
    mu   sync.Mutex
    jobs []Job
}

func newWorker() Worker { return Worker{} } // returns by value!

func main() {
    w := newWorker()
    go w.run()         // w is a COPY; the mu inside the copy is a separate mutex
    submit(&w)         // submitter writes to a different mutex
}
```

**Symptom.** Sporadic data races reported by `-race`. The mutex profile shows two distinct stacks both calling `Lock` on what looks like the same field.

**Cause.** Copying a struct containing a `sync.Mutex` produces two independent locks. `go vet` warns about this; ignored warnings bite.

**Fix.** Return a pointer, or embed correctly:

```go
func newWorker() *Worker { return &Worker{} }
```

`go vet ./...` catches this with the `copylocks` check.

---

## Bug 6: The `time.After` in a tight loop

```go
for {
    select {
    case msg := <-msgs:
        handle(msg)
    case <-time.After(100 * time.Millisecond):
        idle()
    }
}
```

**Symptom.** Block profile shows huge `time.After` delay. Memory profile shows `runtime.startTimer` allocations growing without bound.

**Cause.** Each iteration creates a fresh timer. If `msgs` fires first (the common case), the timer is not stopped and lives until it expires (100 ms later). With messages every 1 ms, that's 100 outstanding timers at any time, all parked on the same code path.

**Fix.** Reuse a single timer:

```go
t := time.NewTimer(100 * time.Millisecond)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(100 * time.Millisecond)

    select {
    case msg := <-msgs:
        handle(msg)
    case <-t.C:
        idle()
    }
}
```

Go 1.23+ fixed the leak side of this, but the redundant allocations remain.

---

## Bug 7: The `sync.Map` used as a write-heavy map

```go
var m sync.Map

// 8 goroutines, each Store() 10^6 keys
for i := 0; i < 8; i++ {
    go func(i int) {
        for j := 0; j < 1_000_000; j++ {
            m.Store(fmt.Sprintf("%d-%d", i, j), j)
        }
    }(i)
}
```

**Symptom.** Mutex profile shows `sync.Map.Store` calling `(*Map).dirtyLocked` and contending. Throughput is roughly 1/3 of a plain mutex-protected map.

**Cause.** `sync.Map` is optimised for read-mostly access. The dirty side is mutex-protected; under heavy writes, you pay the dirty-promotion overhead constantly.

**Fix.** Use a sharded plain map:

```go
type ShardedMap struct {
    shards [32]struct {
        mu sync.Mutex
        m  map[string]int
    }
}
```

Profiles show the contention dropping by ~16× (32 shards, ~8 active producers).

---

## Bug 8: The forgotten `Unlock` on the error path

```go
func (s *Store) Update(k string) error {
    s.mu.Lock()
    v, err := s.fetch(k)
    if err != nil {
        return err   // missing s.mu.Unlock()!
    }
    s.cache[k] = v
    s.mu.Unlock()
    return nil
}
```

**Symptom.** After the first error, all subsequent calls block forever on `s.mu.Lock()`. Block profile shows infinite-delay stacks.

**Cause.** Early return leaves the lock held.

**Fix.** Always `defer` immediately after `Lock`:

```go
func (s *Store) Update(k string) error {
    s.mu.Lock()
    defer s.mu.Unlock()

    v, err := s.fetch(k)
    if err != nil {
        return err
    }
    s.cache[k] = v
    return nil
}
```

This is the one place `defer mu.Unlock()` is uncontroversial — error-path correctness matters more than the small overhead.

---

## Bug 9: The `sync.Cond` with the missed signal

```go
type Queue struct {
    mu    sync.Mutex
    cond  *sync.Cond
    items []Item
}

func (q *Queue) Push(it Item) {
    q.mu.Lock()
    q.items = append(q.items, it)
    q.mu.Unlock()
    q.cond.Signal() // signal after unlocking
}

func (q *Queue) Pop() Item {
    q.mu.Lock()
    defer q.mu.Unlock()
    if len(q.items) == 0 {     // not a loop!
        q.cond.Wait()
    }
    it := q.items[0]
    q.items = q.items[1:]
    return it
}
```

**Symptom.** Block profile shows `Cond.Wait` with absurd delays. Occasionally `Pop` panics on an empty slice.

**Cause.** Two bugs intertwined: (a) `if` instead of `for` lets a spurious wakeup proceed past the wait; (b) signalling after unlock means another goroutine can drain the queue between the signal and the wait.

**Fix.** Use `for` and signal under the lock:

```go
func (q *Queue) Push(it Item) {
    q.mu.Lock()
    q.items = append(q.items, it)
    q.cond.Signal()
    q.mu.Unlock()
}

func (q *Queue) Pop() Item {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 {
        q.cond.Wait()
    }
    it := q.items[0]
    q.items = q.items[1:]
    return it
}
```

Better, replace the whole structure with a buffered channel — it does the same thing with no foot-guns.

---

## Bug 10: The "thundering herd" on cache miss

```go
var (
    mu    sync.Mutex
    cache = map[string]Value{}
)

func Get(k string) Value {
    mu.Lock()
    if v, ok := cache[k]; ok {
        mu.Unlock()
        return v
    }
    mu.Unlock()

    v := expensiveCompute(k) // 100 ms

    mu.Lock()
    cache[k] = v
    mu.Unlock()
    return v
}
```

**Symptom.** Block profile shows hundreds of goroutines all running `expensiveCompute` for the same `k` at the same time. CPU briefly saturates after every cache miss.

**Cause.** Multiple readers miss simultaneously, all kick off compute, all eventually store the same value.

**Fix.** Use `golang.org/x/sync/singleflight`:

```go
import "golang.org/x/sync/singleflight"

var g singleflight.Group

func Get(k string) Value {
    mu.Lock()
    if v, ok := cache[k]; ok { mu.Unlock(); return v }
    mu.Unlock()

    v, _, _ := g.Do(k, func() (any, error) {
        v := expensiveCompute(k)
        mu.Lock()
        cache[k] = v
        mu.Unlock()
        return v, nil
    })
    return v.(Value)
}
```

Now only one goroutine per `k` does the compute; the others wait on its result.

---

## Bug 11: The metrics map that became the bottleneck

```go
var (
    mu      sync.Mutex
    metrics = map[string]int64{}
)

func Inc(label string) {
    mu.Lock()
    metrics[label]++
    mu.Unlock()
}
```

**Symptom.** Mutex profile attributes 30% of total contention to `Inc`. Service has 50 known label values, called millions of times per second.

**Cause.** A single mutex serialises every metric increment across all goroutines and all labels.

**Fix (Stage 1).** Preallocate atomic counters at startup:

```go
type counters struct {
    byLabel map[string]*atomic.Int64
}

func newCounters(labels []string) *counters {
    c := &counters{byLabel: make(map[string]*atomic.Int64, len(labels))}
    for _, l := range labels {
        c.byLabel[l] = new(atomic.Int64)
    }
    return c
}

func (c *counters) Inc(label string) {
    c.byLabel[label].Add(1)
}
```

The map is read-only after init; the atomic is per-label. Contention vanishes.

**Fix (Stage 2).** For very-high-cardinality, dynamic labels: shard or use the Prometheus client-library counters, which already do this internally.

---

## Bug 12: The `select` with the never-ready case

```go
for {
    select {
    case msg := <-fast:
        handleFast(msg)
    case msg := <-slow:
        handleSlow(msg)
    }
}
```

`fast` produces 10k/sec; `slow` produces 10/sec.

**Symptom.** Block profile shows the `select` with significant delay. CPU is fine.

**Cause.** `select` chooses randomly among ready cases. If `fast` is ready 99% of the time, `slow` still gets fair scheduling — but the for-loop iteration spends most of its time *parked* between `fast` messages.

**Cause (real).** This is usually a misread of the profile. The block delay on `select` *is* the goroutine being parked while waiting for *any* case to become ready — which is what you want it to do.

**Fix.** None needed if behaviour is correct. If you misdiagnosed and assumed `select` was the bottleneck, look at *why* both channels are empty — the upstream is the actual cause.

Lesson: block profile entries are not always bugs. Distinguish "I'm waiting because I have nothing to do" (healthy) from "I'm waiting because somebody else is hogging the resource" (bug).

---

## Bug 13: The atomic pointer used like a mutex

```go
var current atomic.Pointer[State]

func update(f func(*State)) {
    s := current.Load()
    f(s)                          // mutates *s in place!
    current.Store(s)
}
```

**Symptom.** Mutex profile empty (no locks). Data races reported by `-race`. Field values flicker between updates.

**Cause.** `atomic.Pointer[T]` swaps the *pointer* atomically, not the *pointed-to* value. Mutating through the loaded pointer is unsynchronised.

**Fix.** Build a new value, swap:

```go
func update(f func(*State)) {
    for {
        old := current.Load()
        newVal := *old        // copy
        f(&newVal)
        if current.CompareAndSwap(old, &newVal) {
            return
        }
    }
}
```

This is a CAS loop; under heavy contention, the retry tail adds CPU but no mutex profile entries.

---

## 14. Summary

Contention bugs in Go fall into a few families: oversized critical sections (defer + I/O, write under read lock), wrong primitive (`sync.Map` vs sharded, mutex vs atomic), missed protocol (Cond without loop, signal-after-unlock), channel misuse (unbuffered with imbalanced rates, leaked timers), and reporting misreads (healthy block delay misread as bug). Recognising the pattern from a profile shape is most of the work — fixes are usually straightforward once the diagnosis is right.

---

## Further reading
- `go vet` `copylocks` check: https://pkg.go.dev/cmd/vet
- `golang.org/x/sync/singleflight`: https://pkg.go.dev/golang.org/x/sync/singleflight
- "The Go Memory Model": https://go.dev/ref/mem
- Common Go mistakes: https://100go.co/
