---
layout: default
title: Decision Tree — Junior
parent: Decision Tree
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/04-decision-tree/junior/
---

# Decision Tree — Junior

[← Back](../)

Go gives you a small toolbox for concurrency: goroutines, channels, `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup`, `sync.Once`, `sync.Cond`, the `sync/atomic` package, and a handful of helpers from `golang.org/x/sync` (`errgroup`, `semaphore`, `singleflight`). The question every engineer faces on every PR is: *given this specific task, which primitive should I reach for first?* The decision tree below answers that question. It is not a flowchart you memorize; it is a sequence of questions you ask yourself, in order, until the primitive falls out.

This page walks the tree branch by branch, with a concrete code example for each terminal node. Read the tree once front to back, then bookmark this page and re-read the branch that matches whatever you are about to write.

## The tree

```
START: what are you synchronizing?
│
├─ A single value (counter, flag, pointer)?
│   └─→ Go to BRANCH 1: ATOMICS
│
├─ A shared mutable data structure (map, slice, custom struct)?
│   └─→ Go to BRANCH 2: SHARED STATE
│
├─ A signal that something happened ("done", "ready", "shutdown")?
│   └─→ Go to BRANCH 3: SIGNALING
│
├─ A bounded queue (producers and consumers exchanging items)?
│   └─→ Go to BRANCH 4: BOUNDED QUEUE
│
├─ Coordination across N tasks (wait for them all, wait for any, bound concurrency)?
│   └─→ Go to BRANCH 5: COORDINATION
│
├─ Initialization that must happen exactly once?
│   └─→ Go to BRANCH 6: ONCE
│
└─ Publishing a snapshot to many readers?
    └─→ Go to BRANCH 7: SNAPSHOT PUBLICATION


BRANCH 1: ATOMICS
│
├─ Is the value a single integer or boolean?
│   ├─ Increment/decrement?     →  atomic.Int64.Add
│   ├─ Boolean flag?            →  atomic.Bool.Store/Load
│   ├─ Max or min tracking?     →  atomic.Int64 with CAS loop
│   └─ Counter sharded by CPU?  →  []atomic.Int64 with shardID()
│
└─ Is the value a pointer to a struct?
    └─ Atomic publish/swap?     →  atomic.Pointer[T]


BRANCH 2: SHARED STATE
│
├─ Read-mostly (reads >> writes)?
│   ├─ State is small + immutable on update?    →  atomic.Pointer[T] (copy-on-write)
│   └─ State is large, mutated in place?         →  sync.RWMutex
│
├─ Mixed reads/writes, single small struct?     →  sync.Mutex
│
├─ Map with disjoint key access or write-once?   →  sync.Map
│
├─ Map with concurrent same-key updates?         →  sharded map[K]V + sync.Mutex
│
└─ Predicate-driven wait on the state?           →  sync.Mutex + sync.Cond


BRANCH 3: SIGNALING
│
├─ One-shot signal to ≥1 waiters?               →  close(chan struct{})
├─ Send a value once?                            →  chan T (capacity 1)
├─ Continuous stream of events to one consumer?  →  chan T
├─ Cancellation with deadline/timeout?           →  context.Context
└─ Broadcast to dynamic, growing set of waiters? →  sync.Cond.Broadcast (rare)


BRANCH 4: BOUNDED QUEUE
│
├─ FIFO order, no priorities?                    →  buffered chan T
├─ Priority order?                                →  container/heap + sync.Mutex + sync.Cond
└─ LIFO order (stack)?                            →  []T + sync.Mutex (channels are FIFO only)


BRANCH 5: COORDINATION
│
├─ Wait for N known goroutines to finish?       →  sync.WaitGroup
├─ Wait for N, propagate errors, cancel on fail? →  errgroup.WithContext
├─ Bounded parallelism on a slice?               →  errgroup + SetLimit(N)
├─ Weighted resource (some tasks "bigger")?      →  semaphore.NewWeighted
└─ Race: any one of N succeeds?                  →  chan result (buffered to N)


BRANCH 6: ONCE
│
├─ Side-effecting init?                          →  sync.Once.Do
├─ Initialization returning a value?              →  sync.OnceValue (Go 1.21+)
└─ Initialization returning value + error?       →  sync.OnceValues (Go 1.21+)


BRANCH 7: SNAPSHOT PUBLICATION
│
├─ One writer, many readers, full replace?      →  atomic.Pointer[T]
├─ Snapshot includes a map?                      →  atomic.Pointer[map[K]V] (immutable after store)
└─ Need versioned subscriptions?                 →  atomic.Pointer + chan for stream
```

The rest of this page walks each branch with a runnable example. Start from the top; do not skip ahead.

## Branch 1: Atomics

The question that lands you here: "I have one small value (an int, a bool, a pointer) and multiple goroutines touch it."

### 1a. Increment a counter

The textbook case. Many writers, occasional reads, one logical value.

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

func main() {
    var requests atomic.Int64

    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            requests.Add(1)
        }()
    }
    wg.Wait()
    fmt.Println("total:", requests.Load()) // 1000
}
```

`atomic.Int64.Add` is one CPU instruction (a locked XADD on x86-64). It does not block, does not allocate, and is safe for any number of concurrent callers.

**Do not** reach for a mutex here. A mutex would serialize all 1000 goroutines through one lock; the atomic does not. For a single value, an atomic is always cheaper than a mutex.

### 1b. Boolean flag

A flag that one goroutine sets and many others read.

```go
var ready atomic.Bool

func setupComplete() { ready.Store(true) }

func waitForReady() {
    for !ready.Load() {
        time.Sleep(10 * time.Millisecond)
    }
    // proceed
}
```

This works, but the spin-wait is wasteful. If your readers need to *block* until the flag is set, switch to a closed channel (Branch 3). The atomic.Bool is correct when readers want to *poll* (e.g., in a hot loop where they check the flag every iteration without blocking).

### 1c. Max tracking with CAS

You want to record the maximum value seen across many goroutines.

```go
var maxLatency atomic.Int64

func recordLatency(ns int64) {
    for {
        cur := maxLatency.Load()
        if ns <= cur {
            return
        }
        if maxLatency.CompareAndSwap(cur, ns) {
            return
        }
        // CAS failed: another goroutine updated maxLatency between
        // our Load and CompareAndSwap. Retry.
    }
}
```

The pattern: Load, decide, CAS. If the CAS fails, another goroutine moved the value; retry with the new value. Under contention, the retry loop runs a few times before succeeding; in practice the cost is well under a microsecond.

This same shape works for any "conditionally update a single value" — minimum, sum-of-positives, exponential moving average, etc.

### 1d. Sharded counter (preview of advanced atomics)

If a counter is *extremely* hot — incremented from every goroutine on every CPU — even a plain atomic suffers from cache-line bouncing. Each Add invalidates the cache line on every other core, so every increment costs a cache line round-trip.

The fix is sharding:

```go
const shards = 64

type ShardedCounter struct {
    shards [shards]struct {
        v atomic.Int64
        _ [56]byte // pad to 64-byte cache line
    }
}

func (s *ShardedCounter) Add(n int64) {
    s.shards[shardID()].v.Add(n)
}

func (s *ShardedCounter) Load() int64 {
    var total int64
    for i := range s.shards {
        total += s.shards[i].v.Load()
    }
    return total
}

func shardID() int {
    // Cheap thread-local hash. In practice, runtime.procPin() or a TLS slot.
    // For demo: use a random shard.
    return int(time.Now().UnixNano()) & (shards - 1)
}
```

Each goroutine writes only its own shard's cache line; reads pay an O(shards) sweep. This is the canonical pattern for counters in tracing, metrics, and request stats.

For most code, you do not need sharding. Reach for it only when a profiler shows a plain atomic as the bottleneck.

### 1e. Atomic pointer for publishing a struct

When the "one value" is itself a struct, use `atomic.Pointer[T]`:

```go
type Config struct {
    Timeout time.Duration
    MaxConn int
}

var current atomic.Pointer[Config]

func init() {
    current.Store(&Config{Timeout: 5 * time.Second, MaxConn: 10})
}

func Reload(c *Config) { current.Store(c) }
func Get() *Config     { return current.Load() }
```

Every reader gets a consistent snapshot of *all fields* of the struct because they share one pointer load. This is the cleanest way to publish multi-field state to many readers, and it is the foundation of Branch 7.

## Branch 2: Shared State

The question that lands you here: "I have a data structure (map, slice, struct with many fields) that multiple goroutines read and write."

### 2a. Read-mostly small struct → atomic.Pointer with copy-on-write

If reads >> writes and the struct is small, treat the struct as immutable and swap the pointer:

```go
type Settings struct {
    LogLevel string
    Tracing  bool
    Region   string
}

var settings atomic.Pointer[Settings]

func init() {
    settings.Store(&Settings{LogLevel: "info", Tracing: false, Region: "us-east"})
}

func UpdateLogLevel(level string) {
    for {
        old := settings.Load()
        next := *old // copy
        next.LogLevel = level
        if settings.CompareAndSwap(old, &next) {
            return
        }
    }
}

func GetSettings() *Settings { return settings.Load() }
```

Readers do a single atomic load — nanoseconds. Writers pay a CAS retry loop and allocate a new struct, which is fine if writes are rare.

### 2b. Read-mostly large struct or in-place updates → sync.RWMutex

If the struct is too large to copy on every write, or writes mutate it in place:

```go
type UserSession struct {
    UserID    string
    LoginTime time.Time
    Cart      []Item // grows over time, mutated in place
    Prefs     map[string]string
}

type SessionStore struct {
    mu       sync.RWMutex
    sessions map[string]*UserSession
}

func (s *SessionStore) Get(id string) *UserSession {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.sessions[id]
}

func (s *SessionStore) Add(id string, sess *UserSession) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.sessions[id] = sess
}

func (s *SessionStore) UpdateCart(id string, item Item) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if sess, ok := s.sessions[id]; ok {
        sess.Cart = append(sess.Cart, item)
    }
}
```

`RLock` allows many concurrent readers; `Lock` is exclusive. Use `RWMutex` when reads dominate by at least 5:1; for balanced workloads, plain `sync.Mutex` has lower overhead.

### 2c. Mixed reads/writes → sync.Mutex

For a small struct with no read/write imbalance:

```go
type RateLimiter struct {
    mu     sync.Mutex
    tokens float64
    last   time.Time
}

func (r *RateLimiter) Allow() bool {
    r.mu.Lock()
    defer r.mu.Unlock()

    now := time.Now()
    r.tokens += now.Sub(r.last).Seconds() * 10.0 // 10 tokens per second
    if r.tokens > 100 {
        r.tokens = 100
    }
    r.last = now

    if r.tokens >= 1 {
        r.tokens--
        return true
    }
    return false
}
```

Plain `sync.Mutex` is the default. Reach for `RWMutex` only when measurements show the lock as a bottleneck and reads dominate.

### 2d. Disjoint-key map access → sync.Map

When goroutines mostly touch *different* keys (think per-connection state, per-user cache), `sync.Map` shines:

```go
var connections sync.Map // key: string (connID), value: *Connection

func RegisterConnection(id string, c *Connection) {
    connections.Store(id, c)
}

func GetConnection(id string) (*Connection, bool) {
    v, ok := connections.Load(id)
    if !ok {
        return nil, false
    }
    return v.(*Connection), true
}
```

`sync.Map` is also the right choice for "write once, read many times" caches:

```go
var dnsCache sync.Map // host -> []net.IP

func Lookup(host string) ([]net.IP, error) {
    if ips, ok := dnsCache.Load(host); ok {
        return ips.([]net.IP), nil
    }
    ips, err := net.LookupIP(host)
    if err != nil {
        return nil, err
    }
    dnsCache.Store(host, ips)
    return ips, nil
}
```

(`sync.Map.LoadOrStore` is the right choice if you want to avoid duplicate work when multiple goroutines miss the cache simultaneously — see Branch 6 and `singleflight`.)

### 2e. Concurrent same-key map updates → sharded mutex map

When many goroutines write to the *same* keys and `sync.Map` does not apply:

```go
const numShards = 32

type ShardedMap struct {
    shards [numShards]struct {
        mu sync.Mutex
        m  map[string]int
    }
}

func New() *ShardedMap {
    s := &ShardedMap{}
    for i := range s.shards {
        s.shards[i].m = make(map[string]int)
    }
    return s
}

func (s *ShardedMap) shard(key string) *struct {
    mu sync.Mutex
    m  map[string]int
} {
    h := fnv32(key)
    return &s.shards[h%numShards]
}

func (s *ShardedMap) Get(key string) (int, bool) {
    sh := s.shard(key)
    sh.mu.Lock()
    defer sh.mu.Unlock()
    v, ok := sh.m[key]
    return v, ok
}

func (s *ShardedMap) Set(key string, val int) {
    sh := s.shard(key)
    sh.mu.Lock()
    defer sh.mu.Unlock()
    sh.m[key] = val
}

func fnv32(s string) uint32 {
    h := uint32(2166136261)
    for i := 0; i < len(s); i++ {
        h ^= uint32(s[i])
        h *= 16777619
    }
    return h
}
```

Each shard has its own lock. Operations on different keys (hashed to different shards) proceed in parallel; operations on the same shard serialize. With 32 shards and uniform key distribution, contention drops by ~32x compared to a single global mutex.

### 2f. Wait for a predicate on the state → sync.Cond

The rare case where Cond is the right tool: multiple consumers wait for the state to satisfy a predicate, and the predicate must be re-checked after each wakeup.

```go
type BoundedSet struct {
    mu    sync.Mutex
    cond  *sync.Cond
    items map[string]bool
    cap   int
}

func NewBoundedSet(cap int) *BoundedSet {
    b := &BoundedSet{items: make(map[string]bool), cap: cap}
    b.cond = sync.NewCond(&b.mu)
    return b
}

func (b *BoundedSet) Add(item string) {
    b.mu.Lock()
    defer b.mu.Unlock()
    for len(b.items) >= b.cap {
        b.cond.Wait() // releases mu, waits, re-acquires mu
    }
    b.items[item] = true
    b.cond.Signal()
}

func (b *BoundedSet) Remove(item string) {
    b.mu.Lock()
    defer b.mu.Unlock()
    delete(b.items, item)
    b.cond.Signal()
}
```

Pay attention to the `for` loop around `Wait()`. `Wait` can return spuriously (or because of `Broadcast` when the predicate is not yet satisfied), so the predicate must be re-checked. This is the single most common bug with `sync.Cond` — using `if` instead of `for`.

`sync.Cond` is rarely the best answer. Before reaching for it, ask: "could this be a channel?" Usually yes. Cond justifies itself only when (a) the data structure cannot be expressed as a channel (e.g., a heap, a multi-key map) AND (b) waiters have per-waiter predicates that channels cannot encode.

## Branch 3: Signaling

The question that lands you here: "I need to tell other goroutines that an event happened."

### 3a. One-shot signal to many → close a channel

The simplest, most useful pattern in Go concurrency:

```go
type Service struct {
    shutdown chan struct{}
}

func New() *Service { return &Service{shutdown: make(chan struct{})} }

func (s *Service) Stop() { close(s.shutdown) }

func (s *Service) worker(id int) {
    for {
        select {
        case <-s.shutdown:
            fmt.Printf("worker %d exiting\n", id)
            return
        case <-time.After(1 * time.Second):
            // do work
        }
    }
}
```

`close(s.shutdown)` unblocks every goroutine reading from `s.shutdown` — broadcast for free. Once closed, every subsequent receive returns immediately with the zero value. You can have ten thousand workers all watching `<-shutdown`; one `close` notifies them all in O(1) wakeup operations.

**Do not** try to `close` twice. That panics. Use `sync.Once` if multiple paths might trigger shutdown:

```go
type Service struct {
    shutdown chan struct{}
    once     sync.Once
}

func (s *Service) Stop() { s.once.Do(func() { close(s.shutdown) }) }
```

### 3b. Send one value → buffered channel of 1

A goroutine produces a single value; the consumer wants it when it's ready.

```go
result := make(chan int, 1) // buffered so the goroutine can exit even if no receiver yet
go func() {
    answer := computeExpensiveThing()
    result <- answer
}()

ans := <-result
fmt.Println("got:", ans)
```

Capacity 1 means the sender can always send without blocking, even if the receiver has not arrived. Capacity 0 (unbuffered) would force the sender and receiver to rendezvous, which is fine if both are guaranteed to run but causes deadlocks if the receiver has already given up.

### 3c. Stream of events → channel

A producer sends a sequence of events; a consumer processes them in order:

```go
events := make(chan Event, 100) // buffer absorbs bursts

// Producer
go func() {
    for {
        e := readNextEvent()
        events <- e
    }
}()

// Consumer
for e := range events {
    process(e)
}
```

For one producer, one consumer, in-order processing: channel. The buffer size is a back-pressure parameter — too small and the producer blocks frequently; too large and you queue up too much under load.

### 3d. Cancellation with deadline → context.Context

For any operation that should be cancellable from the outside, use `context.Context`:

```go
func fetchAll(ctx context.Context, urls []string) ([]Response, error) {
    responses := make([]Response, len(urls))
    for i, u := range urls {
        ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
        defer cancel()

        resp, err := fetch(ctx, u)
        if err != nil {
            return nil, err
        }
        responses[i] = resp
    }
    return responses, nil
}

func fetch(ctx context.Context, url string) (Response, error) {
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return Response{}, err
    }
    defer resp.Body.Close()
    // ... parse ...
}
```

`context.Context` is the standardized cancellation primitive in Go. Every function that can block — RPC client, database query, file read — should accept a `ctx context.Context` as its first parameter. The underlying mechanism is a closed channel (`ctx.Done()`), but you should rarely touch that directly; let the helpers handle it.

### 3e. Broadcast to dynamic waiter set → sync.Cond.Broadcast (rare)

The one legitimate Cond use case in signaling:

```go
type VersionedConfig struct {
    mu      sync.Mutex
    cond    *sync.Cond
    config  *Config
    version int
}

func (v *VersionedConfig) WaitForVersionAtLeast(minVersion int) *Config {
    v.mu.Lock()
    defer v.mu.Unlock()
    for v.version < minVersion {
        v.cond.Wait()
    }
    return v.config
}

func (v *VersionedConfig) Update(c *Config) {
    v.mu.Lock()
    v.config = c
    v.version++
    v.mu.Unlock()
    v.cond.Broadcast() // wake all waiters; each re-checks its own minVersion
}
```

Each waiter has a *different* predicate (`v.version >= myMinVersion`). A closed channel cannot encode per-waiter predicates. This is the canonical Cond justification.

In nine out of ten cases where you reach for Cond, a closed channel will be cleaner.

## Branch 4: Bounded Queue

The question that lands you here: "Producers and consumers exchange items; the queue has a maximum size."

### 4a. FIFO → buffered channel

The simplest case. A buffered channel *is* a bounded FIFO queue.

```go
type WorkerPool struct {
    jobs chan Job
    wg   sync.WaitGroup
}

func NewPool(workers, queueSize int) *WorkerPool {
    p := &WorkerPool{jobs: make(chan Job, queueSize)}
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for j := range p.jobs {
                j.Process()
            }
        }()
    }
    return p
}

func (p *WorkerPool) Submit(j Job) { p.jobs <- j }

func (p *WorkerPool) Shutdown() {
    close(p.jobs)
    p.wg.Wait()
}
```

Producer sends with `p.jobs <- j`; consumers receive with `for j := range p.jobs`. When the buffer fills, the producer blocks — back-pressure for free. When the channel is closed, the range loops exit naturally — shutdown for free.

### 4b. Priority queue → heap + mutex + cond

Channels are FIFO. The moment you need priority ordering, you need a heap:

```go
import "container/heap"

type Task struct {
    Priority int
    Payload  []byte
    index    int
}

type taskHeap []*Task

func (h taskHeap) Len() int            { return len(h) }
func (h taskHeap) Less(i, j int) bool  { return h[i].Priority > h[j].Priority } // max-heap
func (h taskHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i]; h[i].index = i; h[j].index = j }
func (h *taskHeap) Push(x interface{}) { *h = append(*h, x.(*Task)) }
func (h *taskHeap) Pop() interface{} {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[:n-1]
    return x
}

type PQ struct {
    mu     sync.Mutex
    cond   *sync.Cond
    heap   taskHeap
    closed bool
}

func NewPQ() *PQ {
    pq := &PQ{}
    pq.cond = sync.NewCond(&pq.mu)
    return pq
}

func (pq *PQ) Push(t *Task) {
    pq.mu.Lock()
    heap.Push(&pq.heap, t)
    pq.mu.Unlock()
    pq.cond.Signal()
}

func (pq *PQ) Pop() (*Task, bool) {
    pq.mu.Lock()
    defer pq.mu.Unlock()
    for len(pq.heap) == 0 && !pq.closed {
        pq.cond.Wait()
    }
    if pq.closed && len(pq.heap) == 0 {
        return nil, false
    }
    return heap.Pop(&pq.heap).(*Task), true
}

func (pq *PQ) Close() {
    pq.mu.Lock()
    pq.closed = true
    pq.mu.Unlock()
    pq.cond.Broadcast()
}
```

This is genuine Cond use: the heap requires mutex protection, consumers wait on a predicate (`len(heap) > 0 || closed`), and signaling on push wakes one consumer.

### 4c. LIFO (stack) → slice + mutex

A channel cannot be a stack. If you need LIFO:

```go
type Stack struct {
    mu    sync.Mutex
    items []Item
}

func (s *Stack) Push(item Item) {
    s.mu.Lock()
    s.items = append(s.items, item)
    s.mu.Unlock()
}

func (s *Stack) Pop() (Item, bool) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if len(s.items) == 0 {
        return Item{}, false
    }
    last := len(s.items) - 1
    item := s.items[last]
    s.items = s.items[:last]
    return item, true
}
```

If consumers need to *wait* when the stack is empty, add a `sync.Cond`. Otherwise the `Pop` simply returns `false`.

## Branch 5: Coordination

The question that lands you here: "I have N goroutines and need to coordinate their start, completion, or concurrency."

### 5a. Wait for N goroutines → sync.WaitGroup

The textbook fan-out / fan-in:

```go
func processAll(items []Item) {
    var wg sync.WaitGroup
    for _, it := range items {
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            process(it)
        }(it)
    }
    wg.Wait()
}
```

`Add` before spawning; `Done` in `defer` on every goroutine; `Wait` blocks until the counter hits zero. WaitGroup gives no information about success or failure — every spawned goroutine must call `Done` exactly once.

**Pitfall:** calling `Add` *inside* the goroutine is a race against `Wait`. Always call `Add` from the spawning goroutine before the `go` statement.

### 5b. Wait + error propagation → errgroup

The moment any goroutine can fail, switch from WaitGroup to errgroup:

```go
import "golang.org/x/sync/errgroup"

func processAll(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, it := range items {
        it := it
        g.Go(func() error {
            return process(ctx, it)
        })
    }
    return g.Wait()
}
```

`g.Go(fn)` spawns a goroutine. The first `fn` to return a non-nil error cancels the group's context (which propagates to all in-flight `process(ctx, ...)` calls if they respect the context). `g.Wait()` returns the first such error.

### 5c. Bounded parallelism → errgroup.SetLimit

If you have 10,000 items and do not want to spawn 10,000 goroutines:

```go
func processAll(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(50) // at most 50 in flight
    for _, it := range items {
        it := it
        g.Go(func() error {
            return process(ctx, it)
        })
    }
    return g.Wait()
}
```

`g.Go` blocks if there are already 50 active goroutines. This is the standard pattern for crawling, batch processing, or any "do work over a large collection" task.

### 5d. Weighted resources → semaphore

When tasks consume different amounts of a shared resource (e.g., memory):

```go
import "golang.org/x/sync/semaphore"

func processAll(ctx context.Context, items []Item, maxMem int64) error {
    sem := semaphore.NewWeighted(maxMem)
    var wg sync.WaitGroup
    errCh := make(chan error, len(items))

    for _, it := range items {
        it := it
        weight := int64(it.MemoryMB)
        if err := sem.Acquire(ctx, weight); err != nil {
            return err
        }
        wg.Add(1)
        go func() {
            defer sem.Release(weight)
            defer wg.Done()
            if err := process(ctx, it); err != nil {
                errCh <- err
            }
        }()
    }
    wg.Wait()
    close(errCh)
    var firstErr error
    for e := range errCh {
        if firstErr == nil {
            firstErr = e
        }
    }
    return firstErr
}
```

The weighted semaphore is overkill if every task has weight 1; in that case `errgroup.SetLimit` is simpler.

### 5e. Race: first to succeed → buffered result channel

```go
func raceFetch(ctx context.Context, urls []string) ([]byte, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel() // ensures losing goroutines exit

    type result struct {
        data []byte
        err  error
    }
    ch := make(chan result, len(urls)) // buffered so late senders don't block

    for _, u := range urls {
        u := u
        go func() {
            d, e := fetch(ctx, u)
            ch <- result{d, e}
        }()
    }

    var lastErr error
    for i := 0; i < len(urls); i++ {
        r := <-ch
        if r.err == nil {
            return r.data, nil
        }
        lastErr = r.err
    }
    return nil, lastErr
}
```

Buffer the channel to `len(urls)` so late senders can send without blocking, then drain in the receiver loop. The `defer cancel()` propagates context cancellation to the losing fetchers so they stop their work.

## Branch 6: Once

The question that lands you here: "Some initialization must happen exactly once, even if many goroutines reach the code simultaneously."

### 6a. Side-effecting init → sync.Once

```go
var (
    dbOnce sync.Once
    db     *sql.DB
    dbErr  error
)

func DB() (*sql.DB, error) {
    dbOnce.Do(func() {
        db, dbErr = sql.Open("postgres", os.Getenv("DATABASE_URL"))
        if dbErr == nil {
            dbErr = db.Ping()
        }
    })
    return db, dbErr
}
```

`sync.Once.Do` guarantees `f` runs exactly once across all callers and across the lifetime of the program. Subsequent calls block until the first call completes, then return without invoking `f`.

### 6b. Init returning a value → sync.OnceValue (Go 1.21+)

```go
var DB = sync.OnceValue(func() *sql.DB {
    db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
    if err != nil {
        log.Fatalf("db: %v", err)
    }
    return db
})

// Usage:
// db := DB()
```

The returned function is goroutine-safe; the inner function runs exactly once.

### 6c. Init returning value + error → sync.OnceValues

```go
var loadConfig = sync.OnceValues(func() (*Config, error) {
    f, err := os.Open("config.json")
    if err != nil {
        return nil, err
    }
    defer f.Close()
    var c Config
    if err := json.NewDecoder(f).Decode(&c); err != nil {
        return nil, err
    }
    return &c, nil
})

func Config() (*Config, error) { return loadConfig() }
```

Both the value and the error are memoized; future calls return the same pair without re-running the function.

## Branch 7: Snapshot publication

The question that lands you here: "I publish a snapshot of state; many readers consume it; updates replace it entirely."

### 7a. Single struct snapshot → atomic.Pointer

(Covered in Branch 1e and Branch 2a; this is the same primitive.)

```go
type Quote struct {
    Symbol string
    Bid    float64
    Ask    float64
    Time   time.Time
}

var latest atomic.Pointer[Quote]

func Publish(q *Quote) { latest.Store(q) }
func Latest() *Quote   { return latest.Load() }
```

Readers get a single consistent struct in one atomic operation. The struct itself is treated as immutable after `Store` — never mutate fields of a `latest.Load()` result; build a new struct and `Store` it.

### 7b. Map snapshot → atomic.Pointer over an immutable map

```go
type RouteTable map[string]*Route

var routes atomic.Pointer[RouteTable]

func init() {
    initial := make(RouteTable)
    routes.Store(&initial)
}

func Lookup(path string) (*Route, bool) {
    m := *routes.Load()
    r, ok := m[path]
    return r, ok
}

func Reload(newTable RouteTable) {
    routes.Store(&newTable)
}
```

The map is read-only after `Store`. Reloads rebuild the entire map. For 10,000-entry tables reloaded once a minute, the rebuild cost is irrelevant; lookups are at the speed of a normal map plus one atomic load.

### 7c. Versioned subscriptions → atomic.Pointer + chan

When readers need both "the current snapshot" and "every future update":

```go
type Broker struct {
    latest atomic.Pointer[Quote]

    mu   sync.Mutex
    subs []chan Quote
}

func (b *Broker) Latest() *Quote { return b.latest.Load() }

func (b *Broker) Subscribe() <-chan Quote {
    ch := make(chan Quote, 8)
    b.mu.Lock()
    b.subs = append(b.subs, ch)
    b.mu.Unlock()
    if q := b.latest.Load(); q != nil {
        ch <- *q // deliver current snapshot immediately
    }
    return ch
}

func (b *Broker) Publish(q Quote) {
    b.latest.Store(&q)
    b.mu.Lock()
    defer b.mu.Unlock()
    for _, s := range b.subs {
        select {
        case s <- q:
        default: // drop if subscriber is slow
        }
    }
}
```

The atomic pointer holds the "current" snapshot for pull-style reads. The slice of channels delivers updates push-style. Slow subscribers get their updates dropped — a deliberate design choice — to keep the publisher fast.

## Walking the tree end-to-end: a worked example

Suppose you are writing a service that:

1. Accepts incoming HTTP requests.
2. Counts requests for `/metrics`.
3. Reads a config that the operator reloads occasionally.
4. Caches responses keyed by request URL (write-once per URL).
5. Forwards events to a background writer.
6. Should shut down gracefully when the operator sends a signal.

Walk the tree for each concern:

1. **Request counter** → Branch 1a → `atomic.Int64`.
2. **Config snapshot** → Branch 2a / 7a → `atomic.Pointer[Config]`.
3. **URL cache (write-once)** → Branch 2d → `sync.Map`.
4. **Event forwarding** → Branch 4a → buffered `chan Event`.
5. **Shutdown** → Branch 3a → `close(chan struct{})`.

The complete sketch:

```go
type Server struct {
    requests atomic.Int64
    config   atomic.Pointer[Config]
    cache    sync.Map // url -> *Response
    events   chan Event
    shutdown chan struct{}
    once     sync.Once
    wg       sync.WaitGroup
}

func NewServer(initialConfig *Config) *Server {
    s := &Server{
        events:   make(chan Event, 1024),
        shutdown: make(chan struct{}),
    }
    s.config.Store(initialConfig)

    s.wg.Add(1)
    go s.eventWriter()
    return s
}

func (s *Server) eventWriter() {
    defer s.wg.Done()
    for {
        select {
        case <-s.shutdown:
            // drain remaining events
            for {
                select {
                case e := <-s.events:
                    s.writeEvent(e)
                default:
                    return
                }
            }
        case e := <-s.events:
            s.writeEvent(e)
        }
    }
}

func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {
    s.requests.Add(1)
    cfg := s.config.Load()

    if cached, ok := s.cache.Load(r.URL.Path); ok {
        // write cached response
        writeResponse(w, cached.(*Response))
        return
    }

    resp := computeResponse(r, cfg)
    s.cache.Store(r.URL.Path, resp)
    writeResponse(w, resp)

    select {
    case s.events <- Event{URL: r.URL.Path}:
    default:
        // events buffer full; drop and count
    }
}

func (s *Server) Stop() {
    s.once.Do(func() {
        close(s.shutdown)
        s.wg.Wait()
    })
}
```

Five distinct concerns, five different primitives, each justified by the question the decision tree asked. No mutexes; the only "lock" is the implicit per-key locking inside `sync.Map`. Every primitive carries its weight.

## The most common mistakes (and how the tree prevents them)

Looking at hundreds of concurrent-Go pull requests, the same shapes of bugs recur. The decision tree corrects each one by asking a specific question early.

### Mistake 1: Channel-of-1 as a flag

```go
type Server struct {
    ready chan struct{}
}

func (s *Server) markReady() { s.ready <- struct{}{} }
func (s *Server) isReady() bool {
    select {
    case <-s.ready:
        return true
    default:
        return false
    }
}
```

This is wrong. Once `<-s.ready` consumes the value, the channel is empty again and `isReady` returns `false`. The author meant to signal "ready forever," but the primitive does not do that. The fix is *close* the channel, not send on it. Branch 3a tells you this immediately.

```go
type Server struct {
    ready chan struct{}
}

func (s *Server) markReady() { close(s.ready) }
func (s *Server) isReady() bool {
    select {
    case <-s.ready:
        return true // close is broadcast, can be read many times
    default:
        return false
    }
}
```

### Mistake 2: Goroutine + channel for what should be an atomic

```go
type Counter struct {
    add chan int64
}

func New() *Counter {
    c := &Counter{add: make(chan int64, 64)}
    go func() {
        var total int64
        for d := range c.add {
            total += d
        }
    }()
    return c
}

func (c *Counter) Add(n int64) { c.add <- n }
```

This is a goroutine, a channel, and... no way to read the counter. The author forgot the read path because the architecture is wrong. Branch 1a directly answers: counter → atomic.Int64. Two lines, no goroutine, no leak.

### Mistake 3: Mutex around an immutable struct

```go
type Config struct {
    mu      sync.Mutex
    timeout time.Duration
    region  string
}

func (c *Config) Timeout() time.Duration {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.timeout
}
```

If the config is reloaded by replacing the entire struct, the mutex is unnecessary; replace with `atomic.Pointer[Config]` (Branch 7a). If the config is mutated field by field, the mutex is justified — but ask yourself why; usually the right answer is "build a new struct and swap it atomically."

### Mistake 4: sync.WaitGroup with no error handling

```go
var wg sync.WaitGroup
for _, item := range items {
    wg.Add(1)
    go func(item Item) {
        defer wg.Done()
        if err := process(item); err != nil {
            log.Printf("error: %v", err) // logged and lost
        }
    }(item)
}
wg.Wait()
return nil // even if every item failed
```

The function returns `nil` regardless of failures. Branch 5b says: as soon as any goroutine can fail, switch from WaitGroup to errgroup. WaitGroup has no error path; using it where errors matter is throwing information away.

### Mistake 5: sync.Cond with `if`, not `for`

```go
c.cond.L.Lock()
if !ready {
    c.cond.Wait()
}
c.cond.L.Unlock()
```

`Wait` can return spuriously. The Go specification is explicit: "Because c.L is not locked while Cond is waiting, the caller typically cannot assume that the condition is true when Wait returns. Instead, the caller should Wait in a loop." Always:

```go
for !ready {
    c.cond.Wait()
}
```

### Mistake 6: Reading without synchronization

```go
type Status struct {
    mu     sync.Mutex
    online bool
}

func (s *Status) GoOnline()  { s.mu.Lock(); s.online = true; s.mu.Unlock() }
func (s *Status) IsOnline() bool {
    return s.online // no lock!
}
```

Writes are synchronized; reads are not. This is a race — caught by `-race` instantly. The fix: either lock on the read too, or use an `atomic.Bool` that needs no lock.

The decision tree's question "is this single primitive sufficient?" usually catches this. If you have a mutex on one path and not the other, one of them is wrong.

## Cheat sheet (printable, one page)

```
WHAT             →   PRIMITIVE
─────────────────────────────────────────────────────
counter          →   atomic.Int64
flag (poll)      →   atomic.Bool
flag (block)     →   chan struct{} (close to signal)
pointer publish  →   atomic.Pointer[T]
small struct RW  →   sync.Mutex
many-read struct →   sync.RWMutex
read-mostly cfg  →   atomic.Pointer[Config]
disjoint key map →   sync.Map
hot-key map      →   sharded map + sync.Mutex
shutdown signal  →   close(chan struct{})
cancellation     →   context.Context
bounded queue    →   buffered chan T
priority queue   →   container/heap + Mutex + Cond
wait for N       →   sync.WaitGroup
wait + error     →   errgroup.WithContext
bounded parallel →   errgroup.SetLimit
weighted limit   →   semaphore.NewWeighted
once init        →   sync.Once / OnceValue
cache stampede   →   x/sync/singleflight
```

## Common-sense rules

Even before reaching for any primitive, ask:

1. *Do I actually need concurrency here?* Most code is sequential and that is fine. Adding goroutines because "Go has goroutines" is a frequent mistake.
2. *Can this be one goroutine instead of N?* A single writer goroutine simplifies all synchronization on the destination — no shared state, no locks. This is the "share memory by communicating" mantra applied.
3. *Do I have a benchmark or only an intuition?* "I think mutex is slow here" is not data. Run `go test -bench`, look at the numbers, then choose. Many "obvious" optimizations make code slower or no faster.
4. *Will the next maintainer understand this?* The cleverest primitive is the one nobody else can debug. Plain `sync.Mutex` is almost always more maintainable than a hand-rolled `atomic.Pointer` CAS loop, even when slightly slower.

## Practice exercises

To internalize the tree, write the code for each scenario before reading any of the deeper pages (`tasks.md`, `find-bug.md`, `optimize.md`). The goal is recall speed; you should be able to name the primitive within five seconds and write the canonical idiom within thirty.

### Exercise 1

You have a fleet of 100 worker goroutines all processing items from a shared queue. Each worker should exit when a global shutdown signal fires. Which primitive(s) and what is the shape of the code?

*Answer:* a buffered `chan Item` for the queue, a `chan struct{}` for shutdown (closed to broadcast), and a `select` in each worker between `<-shutdown` and `item := <-queue`. Branch 3a + Branch 4a.

### Exercise 2

You have a config struct loaded at startup and reloaded every 60 seconds by an admin endpoint. It is read on every request (~10K req/sec). Which primitive?

*Answer:* `atomic.Pointer[Config]`. Reads are one atomic load; writes are rare. Branch 7a.

### Exercise 3

You need to call 50 external APIs in parallel, with a global concurrency cap of 10, and you want the first error to stop the rest. Which primitive?

*Answer:* `errgroup.WithContext` + `g.SetLimit(10)`. Branch 5c.

### Exercise 4

A function should compute and cache an expensive value the first time it is called, and return the cached value on subsequent calls. Multiple goroutines may call it concurrently. Which primitive?

*Answer:* `sync.OnceValue` (or `sync.Once` with package-level variables). Branch 6.

### Exercise 5

You need a thread-safe queue that returns items in priority order (smallest first). Which primitives?

*Answer:* `container/heap.Interface` + `sync.Mutex` + `sync.Cond`. Branch 4b. Channels cannot reorder by priority.

### Exercise 6

You want to broadcast a single value (e.g., "the latest weather measurement") to many readers, where new readers should see the most recent value and then receive every subsequent update. Which primitives?

*Answer:* `atomic.Pointer[Reading]` for the latest, plus per-subscriber buffered `chan Reading` for streams. Branch 7c.

### Exercise 7

Two atomic counters, "requests" and "bytes received," need to be readable as a consistent snapshot. Which primitive?

*Answer:* not two separate atomics. Pack into one struct and use `atomic.Pointer[stats]`, or guard both with one `sync.Mutex`. Branch 1e / 2c.

### Exercise 8

You want to enforce that at most 10 concurrent operations can use a shared resource. The remaining operations should queue. Which primitive?

*Answer:* buffered `chan struct{}` of capacity 10, or `semaphore.NewWeighted(10)`. Acquire by sending; release by receiving. Branch 5d.

### Exercise 9

A goroutine should periodically wake up, do some work, and go back to sleep — unless a cancellation arrives, in which case it exits. Which primitives?

*Answer:* `time.NewTicker` + `context.Context`, composed in a `select`:

```go
ticker := time.NewTicker(d)
defer ticker.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-ticker.C:
        doWork()
    }
}
```

### Exercise 10

Many goroutines write log lines to a shared file. Order does not matter; throughput does. Which primitive?

*Answer:* buffered `chan LogEntry` to a single writer goroutine. The writer can batch I/O. Branch 4a.

## A debugging mindset for concurrent code

When concurrent code misbehaves, the first instinct of new Go engineers is to add more primitives. "If a mutex isn't enough, maybe a Cond will help." This is almost always the wrong direction. The right direction is:

1. **Read the data flow.** Trace which goroutine writes each variable and which goroutines read it. If a variable is written by N goroutines, ask whether you can reduce that to one.
2. **Eliminate sharing where possible.** A copy-per-goroutine of small state often outperforms shared state with synchronization, simply because the synchronization overhead disappears.
3. **Identify ownership boundaries.** Every mutable variable should have one clear owner — one goroutine or one struct method — that is responsible for mutating it. Other goroutines either ask the owner to mutate (via channel) or get an immutable snapshot.
4. **Re-walk the decision tree once.** Often the right answer is *demoting* the primitive (channel → atomic, mutex → atomic.Pointer) rather than promoting it. The heavier primitive was a symptom that the design forced too much sharing.

This is the lens through which experienced Go engineers approach concurrent code. The tree is a tool; the underlying skill is recognizing the shape of the problem.

## Closing notes on style

Concurrent Go has a distinctive aesthetic. Code that looks "clean" to a senior Go engineer:

- Has very few mutexes; the ones it has are unexported fields with `// guards: X, Y` comments next to them.
- Uses channels for data flow, not for signaling individual events.
- Treats `context.Context` as a required first parameter of every function that can block.
- Avoids `sync.Cond` unless the data structure truly requires it.
- Wraps fan-out + error propagation in `errgroup`, not hand-rolled WaitGroup + channel.
- Stores published state in `atomic.Pointer[T]` over an immutable snapshot.
- Closes channels from one place (often the producer side) and never twice.
- Defines a clear ownership story for every shared variable.

If your code does not match this aesthetic, that is fine — but on a code review, expect questions about each deviation. The decision tree is the framework for answering those questions confidently.

## Quick reference: which primitive defaults to what

When you have ten seconds to choose:

- **One number** → `atomic.Int64` or `atomic.Uint64`.
- **One boolean** → `atomic.Bool` for polling, `chan struct{}` (closed) for blocking.
- **One pointer to a struct** → `atomic.Pointer[T]`.
- **A struct with several fields, mostly read** → `atomic.Pointer[T]` over an immutable copy.
- **A struct with several fields, balanced** → `sync.Mutex`.
- **A map with disjoint keys** → `sync.Map`.
- **A map with same-key contention** → sharded `map[K]V` + `sync.Mutex` per shard.
- **A bounded FIFO queue** → buffered `chan T`.
- **A priority queue** → `container/heap` + `sync.Mutex` + `sync.Cond`.
- **Wait for N goroutines** → `sync.WaitGroup` (no errors) or `errgroup.Group` (errors).
- **Bound concurrency** → `errgroup.SetLimit` or buffered `chan struct{}` tokens.
- **Once-only init** → `sync.OnceValue` or `sync.Once`.
- **Cancellation** → `context.Context`.
- **Cache stampede** → `singleflight.Group`.

If your situation doesn't match any of these, walk the full tree above; you are likely in a corner case where the default doesn't apply. Most code does match one of these defaults exactly.

## One more worked example: cache with TTL and stampede protection

Combine several branches into one realistic component: a TTL cache with stampede protection.

Requirements:

1. Get a value by key. If cached and not expired, return it.
2. If not cached (or expired), call the loader function — but only once even if many goroutines miss simultaneously (Branch 6 stampede protection via `singleflight`).
3. Many goroutines read concurrently (Branch 2b — RWMutex over the map).
4. Periodic eviction sweep (a goroutine that ticks).
5. Graceful shutdown (Branch 3a — close a done channel).

```go
import (
    "sync"
    "time"
    "golang.org/x/sync/singleflight"
)

type entry struct {
    value   interface{}
    expires time.Time
}

type Cache struct {
    mu    sync.RWMutex
    items map[string]entry
    sf    singleflight.Group

    done chan struct{}
    once sync.Once
}

func New() *Cache {
    c := &Cache{
        items: make(map[string]entry),
        done:  make(chan struct{}),
    }
    go c.sweepLoop()
    return c
}

func (c *Cache) Get(key string, ttl time.Duration, load func() (interface{}, error)) (interface{}, error) {
    c.mu.RLock()
    e, ok := c.items[key]
    c.mu.RUnlock()
    if ok && time.Now().Before(e.expires) {
        return e.value, nil
    }
    v, err, _ := c.sf.Do(key, func() (interface{}, error) {
        val, err := load()
        if err != nil {
            return nil, err
        }
        c.mu.Lock()
        c.items[key] = entry{value: val, expires: time.Now().Add(ttl)}
        c.mu.Unlock()
        return val, nil
    })
    return v, err
}

func (c *Cache) sweepLoop() {
    ticker := time.NewTicker(1 * time.Minute)
    defer ticker.Stop()
    for {
        select {
        case <-c.done:
            return
        case <-ticker.C:
            now := time.Now()
            c.mu.Lock()
            for k, e := range c.items {
                if now.After(e.expires) {
                    delete(c.items, k)
                }
            }
            c.mu.Unlock()
        }
    }
}

func (c *Cache) Close() {
    c.once.Do(func() { close(c.done) })
}
```

Five primitives, each justified:

- `sync.RWMutex` — many reads, occasional writes (Branch 2b).
- `singleflight.Group` — stampede protection on miss.
- `chan struct{}` (closed by `Close`) — shutdown signal for sweeper (Branch 3a).
- `sync.Once` — make `Close` idempotent (Branch 6).
- `time.Ticker` — periodic sweep.

No mutexes are nested. No goroutines leak. The sweep goroutine exits promptly when `Close` is called. The cache is safe to use from many goroutines.

This is the typical shape of a well-designed concurrent component: small, each primitive answers a specific question, and the answers compose without surprises. If your component needs three primitives, you have three questions you should be able to articulate; if you cannot, the design is wrong.

## What to internalize

Do not try to remember the tree. Try to remember the questions:

1. *Am I synchronizing state, signaling an event, or coordinating goroutines?*
2. *How many writers? How many readers?*
3. *Is this one-shot or repeated?*
4. *Bounded or unbounded?*
5. *Do multiple values need to move together?*

If those questions become reflexive, the primitive falls out and you do not need a tree at all. The page above is scaffolding to get there. Re-read it for the next ten concurrent PRs you write or review; by the eleventh you will be answering automatically.

The decision tree is not the goal. The goal is to never spend a minute wondering "which primitive should I use?" — because the question has already been asked and answered before you reach for the keyboard.
