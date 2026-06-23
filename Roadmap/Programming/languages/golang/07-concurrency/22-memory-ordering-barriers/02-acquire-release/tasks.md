---
layout: default
title: Tasks
parent: Acquire Release
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/02-acquire-release/tasks/
---

# Acquire / Release — Tasks

Hands-on exercises for practicing acquire/release publication patterns in Go. Solve each on paper, then in code, then verify with `go test -race`.

## Task 1: Safe Flag Publication (Junior)

**Problem:** Implement a `Flag` type. One goroutine sets the flag; many goroutines wait for it to be set. Use `atomic.Bool`.

**Skeleton:**

```go
type Flag struct {
    set atomic.Bool
}

func (f *Flag) Set()        { f.set.Store(true) }
func (f *Flag) IsSet() bool { return f.set.Load() }
func (f *Flag) Wait() {
    for !f.set.Load() {
        runtime.Gosched()
    }
}
```

**Test:**

```go
func TestFlag(t *testing.T) {
    var f Flag
    done := make(chan struct{})
    go func() {
        time.Sleep(10 * time.Millisecond)
        f.Set()
        close(done)
    }()
    f.Wait()
    if !f.IsSet() {
        t.Error("flag not set")
    }
    <-done
}
```

Run with `go test -race`.

---

## Task 2: Lazy Singleton (Junior)

**Problem:** Implement a thread-safe lazy singleton for a `*Config` struct using `sync.Once`.

**Skeleton:**

```go
var (
    once   sync.Once
    config *Config
)

func GetConfig() *Config {
    once.Do(func() {
        config = loadConfig()
    })
    return config
}
```

**Test:** verify 10 concurrent calls all return the same pointer.

---

## Task 3: Safe Pointer Publication (Junior-Middle)

**Problem:** Implement a `Container[T]` that holds a pointer set once, then read many times.

**Skeleton:**

```go
type Container[T any] struct {
    val atomic.Pointer[T]
}

func (c *Container[T]) Set(v *T) { c.val.Store(v) }
func (c *Container[T]) Get() *T  { return c.val.Load() }
```

**Test:** confirm that after Set, any concurrent Get sees the new pointer (not stale nil).

---

## Task 4: Read-Mostly Cache (Middle)

**Problem:** Implement a string-to-int cache where reads are wait-free and writes are infrequent.

**Skeleton:**

```go
type Cache struct {
    data atomic.Pointer[map[string]int]
    mu   sync.Mutex
}

func (c *Cache) Get(k string) (int, bool) {
    m := c.data.Load()
    if m == nil { return 0, false }
    v, ok := (*m)[k]
    return v, ok
}

func (c *Cache) Set(k string, v int) {
    c.mu.Lock()
    defer c.mu.Unlock()
    old := c.data.Load()
    n := map[string]int{}
    if old != nil {
        for kk, vv := range *old {
            n[kk] = vv
        }
    }
    n[k] = v
    c.data.Store(&n)
}
```

**Test:** stress test with 16 goroutines reading and 4 writing for 1 second. Verify no races.

---

## Task 5: Worker Pool with Graceful Shutdown (Middle)

**Problem:** Implement a pool of N worker goroutines that processes jobs from a channel. Shutdown waits for all workers to finish current jobs.

**Skeleton:**

```go
type Pool struct {
    jobs chan Job
    wg   sync.WaitGroup
    stop chan struct{}
    once sync.Once
}

func NewPool(n int, jobCap int) *Pool {
    p := &Pool{
        jobs: make(chan Job, jobCap),
        stop: make(chan struct{}),
    }
    for i := 0; i < n; i++ {
        p.wg.Add(1)
        go p.worker()
    }
    return p
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for {
        select {
        case <-p.stop:
            return
        case j := <-p.jobs:
            process(j)
        }
    }
}

func (p *Pool) Submit(j Job) bool {
    select {
    case p.jobs <- j:
        return true
    case <-p.stop:
        return false
    }
}

func (p *Pool) Stop() {
    p.once.Do(func() { close(p.stop) })
    p.wg.Wait()
}
```

**Test:** submit 1000 jobs across 4 producers, then Stop. Verify all jobs processed.

---

## Task 6: Single-Flight Cache (Middle-Senior)

**Problem:** Implement a cache where concurrent identical requests for the same key collapse into a single upstream fetch.

**Skeleton:**

```go
type SingleFlight struct {
    mu      sync.Mutex
    pending map[string]*pendingCall
    cache   map[string]string
}

type pendingCall struct {
    done chan struct{}
    val  string
    err  error
}

func (sf *SingleFlight) Get(k string, fetch func() (string, error)) (string, error) {
    sf.mu.Lock()
    if v, ok := sf.cache[k]; ok {
        sf.mu.Unlock()
        return v, nil
    }
    if p, ok := sf.pending[k]; ok {
        sf.mu.Unlock()
        <-p.done
        return p.val, p.err
    }
    p := &pendingCall{done: make(chan struct{})}
    if sf.pending == nil { sf.pending = map[string]*pendingCall{} }
    sf.pending[k] = p
    sf.mu.Unlock()
    
    p.val, p.err = fetch()
    
    sf.mu.Lock()
    if sf.cache == nil { sf.cache = map[string]string{} }
    if p.err == nil {
        sf.cache[k] = p.val
    }
    delete(sf.pending, k)
    sf.mu.Unlock()
    
    close(p.done)
    return p.val, p.err
}
```

**Test:** 100 concurrent calls for the same key; fetch should run exactly once.

---

## Task 7: Atomic Counter Snapshot (Senior)

**Problem:** Track a counter that can be atomically reset on read.

**Skeleton:**

```go
type ResettableCounter struct {
    n atomic.Int64
}

func (c *ResettableCounter) Inc() { c.n.Add(1) }

func (c *ResettableCounter) SnapshotAndReset() int64 {
    return c.n.Swap(0)
}
```

**Test:** verify no Inc calls are lost during concurrent SnapshotAndReset.

---

## Task 8: Promise/Future (Senior)

**Problem:** Implement a write-once, read-many "promise" with cancellation.

**Skeleton:**

```go
type Promise[T any] struct {
    val   T
    err   error
    done  chan struct{}
    once  sync.Once
}

func NewPromise[T any]() *Promise[T] {
    return &Promise[T]{done: make(chan struct{})}
}

func (p *Promise[T]) Resolve(v T) {
    p.once.Do(func() {
        p.val = v
        close(p.done)
    })
}

func (p *Promise[T]) Reject(err error) {
    p.once.Do(func() {
        p.err = err
        close(p.done)
    })
}

func (p *Promise[T]) Await(ctx context.Context) (T, error) {
    select {
    case <-p.done:
        return p.val, p.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

**Test:** spawn N goroutines awaiting the same promise; verify all get the same value.

---

## Task 9: Lock-Free Stack (Senior)

**Problem:** Implement a Treiber stack with Push and Pop using atomic.Pointer + CAS.

**Skeleton:**

```go
type Stack[T any] struct {
    head atomic.Pointer[node[T]]
}

type node[T any] struct {
    val  T
    next *node[T]
}

func (s *Stack[T]) Push(v T) {
    n := &node[T]{val: v}
    for {
        n.next = s.head.Load()
        if s.head.CompareAndSwap(n.next, n) {
            return
        }
    }
}

func (s *Stack[T]) Pop() (T, bool) {
    for {
        top := s.head.Load()
        if top == nil {
            var zero T
            return zero, false
        }
        if s.head.CompareAndSwap(top, top.next) {
            return top.val, true
        }
    }
}
```

**Test:** stress with many concurrent Push and Pop; verify no values lost or duplicated.

---

## Task 10: Sharded Counter (Senior)

**Problem:** Build a counter that scales to many CPUs without contention.

**Skeleton:**

```go
type ShardedCounter struct {
    shards []paddedInt64
}

type paddedInt64 struct {
    n atomic.Int64
    _ [56]byte
}

func NewShardedCounter() *ShardedCounter {
    return &ShardedCounter{shards: make([]paddedInt64, 64)}
}

func (c *ShardedCounter) Inc() {
    idx := getProcID() % 64
    c.shards[idx].n.Add(1)
}

func (c *ShardedCounter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].n.Load()
    }
    return s
}
```

**Test:** benchmark uncontended Inc against `atomic.Int64.Add` at GOMAXPROCS=16.

---

## Task 11: Seqlock (Senior-Professional)

**Problem:** Implement a seqlock for fast reads with occasional writes.

**Skeleton:**

```go
type Seqlock struct {
    seq atomic.Uint64
    mu  sync.Mutex
    x, y atomic.Int64
}

func (s *Seqlock) Write(xv, yv int64) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.seq.Add(1)
    s.x.Store(xv)
    s.y.Store(yv)
    s.seq.Add(1)
}

func (s *Seqlock) Read() (int64, int64) {
    for {
        v1 := s.seq.Load()
        if v1%2 != 0 { continue }
        x := s.x.Load()
        y := s.y.Load()
        v2 := s.seq.Load()
        if v1 == v2 {
            return x, y
        }
    }
}
```

**Test:** stress with 1 writer, 8 readers; verify readers see consistent pairs.

---

## Task 12: Event Subscriber (Professional)

**Problem:** Implement a publish-subscribe bus with lock-free subscribe/unsubscribe and publish.

**Skeleton:**

```go
type Bus[T any] struct {
    subs atomic.Pointer[[]chan<- T]
    mu   sync.Mutex
}

func (b *Bus[T]) Subscribe(ch chan<- T) {
    b.mu.Lock()
    defer b.mu.Unlock()
    old := b.subs.Load()
    var n []chan<- T
    if old != nil { n = append(n, *old...) }
    n = append(n, ch)
    b.subs.Store(&n)
}

func (b *Bus[T]) Publish(v T) {
    subs := b.subs.Load()
    if subs == nil { return }
    for _, ch := range *subs {
        select {
        case ch <- v:
        default:
        }
    }
}
```

**Test:** subscribe many channels; publish; verify each receives.

---

## Task 13: Rate Limiter (Professional)

**Problem:** Token-bucket rate limiter with no contention on read path.

**Skeleton:** see professional.md Appendix DX.

**Test:** measure ops/sec at high concurrency; should remain wait-free.

---

## Task 14: Concurrent LRU Cache (Professional)

**Problem:** Implement a sharded LRU cache.

**Skeleton:** use a fixed number of shards, each with its own mutex, map, and LRU list.

**Test:** verify correctness under stress, then benchmark scaling.

---

## Task 15: MPSC Queue (Professional)

**Problem:** Implement Vyukov's MPSC queue.

**Skeleton:** see professional.md Appendix BL.

**Test:** verify FIFO order, wait-free producers, lock-free consumer.

---

## Test Harness Template

For all tasks, use this template:

```go
package main_test

import (
    "sync"
    "testing"
)

func TestStress(t *testing.T) {
    // setup
    var wg sync.WaitGroup
    const N = 64
    for i := 0; i < N; i++ {
        wg.Add(1)
        go func(seed int) {
            defer wg.Done()
            for j := 0; j < 10000; j++ {
                // exercise the structure
            }
        }(i)
    }
    wg.Wait()
    // assert invariants
}
```

Run with `go test -race -count=10`.

---

## Conclusion

These tasks cover the main acquire/release patterns in Go. Solve them; benchmark them; reason about their happens-before chains. By the end, the patterns will be second nature.

End of tasks.md.
