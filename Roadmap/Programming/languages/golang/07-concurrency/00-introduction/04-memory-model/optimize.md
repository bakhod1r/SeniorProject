# Memory Model — Optimization Exercises

> Each exercise presents synchronised code that is correct but slow. Identify the bottleneck and optimise.

---

## Exercise 1 — Mutex for a single counter

**Baseline.**

```go
type Counter struct {
    mu sync.Mutex
    n  int64
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}
```

Under contention, mutex acquisition costs ~20 ns. Under high contention, more.

**Goal.** Reduce overhead.

**Solution.**

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc() { c.n.Add(1) }
```

Atomic increment: ~5 ns. 4x faster uncontended, much faster under contention.

---

## Exercise 2 — Map with RWMutex

**Baseline.**

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]string
}

func (c *Cache) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.m[k]
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.m[k] = v
}
```

Under read-heavy workload, this is good. Under balanced or write-heavy: contention on the writer lock.

**Goal.** Reduce contention.

**Solution: shard the map.**

```go
const shards = 32

type ShardedCache struct {
    shards [shards]struct {
        mu sync.RWMutex
        m  map[string]string
    }
}

func (c *ShardedCache) shardFor(k string) *struct {
    mu sync.RWMutex
    m  map[string]string
} {
    h := fnv.New32a()
    h.Write([]byte(k))
    return &c.shards[h.Sum32()%shards]
}
```

Different keys land in different shards. Contention drops 32x.

---

## Exercise 3 — `sync.Map` vs sharded mutex

`sync.Map` is optimised for read-mostly + sticky keys (keys that persist for the lifetime of the cache).

**Use `sync.Map` when:**
- Many concurrent reads of mostly-stable keys.
- The set of keys does not churn much.

**Use sharded mutex when:**
- Keys come and go frequently.
- Writes are common.
- You need typed values (sync.Map uses `interface{}`).

Benchmark both for your workload to decide.

---

## Exercise 4 — Cache line padding

**Baseline.**

```go
type Counters struct {
    a int64
    b int64
}

var c Counters
// goroutine 1: atomic.AddInt64(&c.a, 1) in a loop
// goroutine 2: atomic.AddInt64(&c.b, 1) in a loop
```

Both fields likely share a cache line. Every write invalidates the other core's cache line. Cache line ping-pongs; throughput drops 5–10x.

**Goal.** Eliminate false sharing.

**Solution: pad each counter.**

```go
type PaddedInt64 struct {
    v int64
    _ [56]byte // pad to 64-byte cache line
}

type Counters struct {
    a PaddedInt64
    b PaddedInt64
}
```

Now each counter is on its own cache line. Cores can write without invalidation.

---

## Exercise 5 — `atomic.Value` overhead

**Baseline.**

```go
var cfg atomic.Value
cfg.Store(&Config{...})

func get() *Config {
    return cfg.Load().(*Config)
}
```

The `.Load().(*Config)` type assertion has overhead (~5 ns) on each call.

**Goal.** Eliminate type assertion.

**Solution: `atomic.Pointer[Config]`.**

```go
var cfg atomic.Pointer[Config]
cfg.Store(&Config{...})

func get() *Config {
    return cfg.Load()
}
```

Type-safe via generics. Faster, more readable.

---

## Exercise 6 — Per-goroutine accumulation

**Baseline.**

```go
var total atomic.Int64

func work() {
    for i := 0; i < 1_000_000; i++ {
        total.Add(int64(compute(i)))
    }
}
```

Multiple goroutines doing this contend heavily on `total`'s cache line.

**Goal.** Eliminate cross-goroutine contention.

**Solution: per-goroutine accumulation, combine at end.**

```go
func work(wg *sync.WaitGroup, results []int64, idx int) {
    defer wg.Done()
    var local int64
    for i := 0; i < 1_000_000; i++ {
        local += int64(compute(i))
    }
    results[idx] = local
}

// Caller:
results := make([]int64, runtime.NumCPU())
var wg sync.WaitGroup
for i := 0; i < runtime.NumCPU(); i++ {
    wg.Add(1)
    go work(&wg, results, i)
}
wg.Wait()
var total int64
for _, r := range results {
    total += r
}
```

Per-goroutine work has no contention. Final combine is O(NumCPU), trivial.

If `results` entries share cache lines, pad them.

---

## Exercise 7 — Read-mostly with `atomic.Pointer`

**Baseline.**

```go
type Config struct { /* ... */ }
var (
    mu  sync.RWMutex
    cfg *Config
)

func get() *Config {
    mu.RLock()
    defer mu.RUnlock()
    return cfg
}
```

Even with `RWMutex`, each read has ~40 ns overhead.

**Goal.** Lock-free reads.

**Solution.**

```go
var cfg atomic.Pointer[Config]

func get() *Config { return cfg.Load() }
func set(c *Config) { cfg.Store(c) }
```

Reads are ~1 ns. Treat the returned `*Config` as immutable.

---

## Exercise 8 — `sync.Pool` for buffers

**Baseline.**

```go
http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    buf := make([]byte, 0, 4096)
    encode(&buf, data)
    w.Write(buf)
})
```

Each request: 4 KB allocation. At 10 000 req/sec: 40 MB/sec to GC.

**Goal.** Reuse buffers.

**Solution: `sync.Pool`.**

```go
var pool = sync.Pool{
    New: func() interface{} {
        b := make([]byte, 0, 4096)
        return &b
    },
}

http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    bp := pool.Get().(*[]byte)
    defer func() { *bp = (*bp)[:0]; pool.Put(bp) }()
    encode(bp, data)
    w.Write(*bp)
})
```

Allocations drop dramatically; GC pressure falls.

---

## Exercise 9 — Channel vs mutex for state machine

**Baseline.**

```go
type State struct {
    mu sync.Mutex
    s  int
}

func (s *State) Transition(next int) bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    if isValidTransition(s.s, next) {
        s.s = next
        return true
    }
    return false
}
```

Mutex per transition. Hot path on a server.

**Goal.** Faster.

**Solution: atomic CAS.**

```go
type State struct {
    s atomic.Int32
}

func (s *State) Transition(next int32) bool {
    for {
        cur := s.s.Load()
        if !isValidTransition(int(cur), int(next)) {
            return false
        }
        if s.s.CompareAndSwap(cur, next) {
            return true
        }
    }
}
```

CAS loop is faster uncontended; under heavy contention, may livelock briefly. Trade-off.

---

## Exercise 10 — `sync.Once` vs flag check

**Baseline.**

```go
var done int32

func ensureInit() {
    if atomic.LoadInt32(&done) == 0 {
        if atomic.CompareAndSwapInt32(&done, 0, 1) {
            initialize()
        }
    }
}
```

Two atomic operations per call. Hot path.

**Goal.** Faster after init.

**Solution: `sync.Once` has a fast path with a single relaxed read (since Go 1.19).**

```go
var once sync.Once

func ensureInit() {
    once.Do(initialize)
}
```

After init, `once.Do` returns after a single atomic load — ~1 ns. Faster than the manual version. Plus correctness guarantees.

---

## Exercise 11 — Spinning vs parking

**Baseline.**

```go
var ready atomic.Bool

go func() {
    for !ready.Load() {
        runtime.Gosched()
    }
    proceed()
}()
```

Polling. Wastes CPU.

**Goal.** Park until ready.

**Solution: channel.**

```go
done := make(chan struct{})

go func() {
    <-done
    proceed()
}()

// ... later ...
close(done)
```

Parks the goroutine. Wakes when closed. No CPU waste.

---

## Exercise 12 — `RWMutex` for read-mostly with rare writes

**Baseline.**

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]string
}
```

Mutex for read-mostly cache. Readers contend.

**Goal.** Allow reader parallelism.

**Solution A: `RWMutex`.**

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]string
}

func (c *Cache) Get(k string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.m[k]
}
```

Multiple readers proceed in parallel.

**Solution B: `sync.Map`.**

If keys are sticky, `sync.Map` has lock-free reads for stable keys.

**Solution C: COW.**

`atomic.Pointer[map[string]string]` with copy-on-write semantics. Best for very rare writes.

Choose based on workload.

---

## Exercise 13 — Mutex profile analysis

Take a service with measurable lock contention. Enable mutex profiling:

```go
runtime.SetMutexProfileFraction(1)
```

Capture profile:

```bash
go tool pprof http://localhost:6060/debug/pprof/mutex
```

Identify the mutex with the most contention. Refactor:

- Shard the data.
- Replace `Mutex` with `RWMutex` if read-heavy.
- Reduce critical section size.
- Use `sync.Map` if applicable.

**Goal.** Concrete optimisation based on data.

---

## Exercise 14 — `sync.Map` writeback contention

`sync.Map` is great for read-mostly, but writes still contend on its internal mutex.

**Baseline.**

```go
var m sync.Map
// Many concurrent writes:
m.Store(key, value)
```

**Goal.** Reduce write contention.

**Solution.**

If writes are dominant, sharded mutex maps win:

```go
type ShardedMap struct {
    shards [32]struct {
        mu sync.Mutex
        m  map[string]string
    }
}
```

`sync.Map` is for read-mostly; not for write-mostly.

---

## Exercise 15 — `atomic.Int64` vs lock-free counter array

**Baseline.**

```go
var n atomic.Int64
// 16 goroutines doing n.Add(1) in a tight loop
```

Cache line bouncing dominates throughput.

**Goal.** Scale linearly with cores.

**Solution: per-goroutine counters, combine on read.**

```go
type Counter struct {
    shards [16]struct {
        n atomic.Int64
        _ [56]byte
    }
}

func (c *Counter) Inc() {
    idx := goroutineID() % 16 // see notes below
    c.shards[idx].n.Add(1)
}

func (c *Counter) Load() int64 {
    var total int64
    for i := range c.shards {
        total += c.shards[i].n.Load()
    }
    return total
}
```

Each goroutine hits its own shard. Reads sum all shards.

The `goroutineID()` call is the tricky part — Go does not expose goroutine IDs publicly. Workarounds:

- Use a goroutine-local pseudo-ID from `runtime.LockOSThread` + thread ID.
- Use a `sync.Pool` to give each goroutine a unique shard.
- Use a random shard per increment (some loss of monotonicity).

Production code: `github.com/uber-go/atomic` and similar libraries implement this.

---

## Closing

Memory-model optimization patterns:

1. **Atomics over mutexes** for single primitives.
2. **`sync.RWMutex`** for read-heavy workloads.
3. **Sharded mutexes** for high contention.
4. **`sync.Map`** for read-mostly with sticky keys.
5. **`atomic.Pointer[T]`** for immutable hot data.
6. **`sync.Pool`** for hot allocations.
7. **Per-goroutine accumulation** for hot counters.
8. **Cache line padding** to eliminate false sharing.
9. **COW** for read-mostly with rare writes.
10. **`sync.Once`** for one-time init.

Measure first. Each optimisation has trade-offs. The standard library's primitives are well-tuned for typical cases; reach for them before custom designs.

Profile with `pprof -mutex`, `pprof -block`, and trace. Trust the data; the optimisations that look promising in theory may not pay off in practice for your workload.
