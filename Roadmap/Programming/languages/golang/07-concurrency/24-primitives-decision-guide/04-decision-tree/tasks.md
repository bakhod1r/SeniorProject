---
layout: default
title: Decision Tree — Tasks
parent: Decision Tree
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/04-decision-tree/tasks/
---

# Decision Tree — Tasks

[← Back](../)

Ten mini-scenarios. For each, the task is the same: pick a primitive and implement it. The "primitive" line names the answer; the "implementation" block is what you should write before reading further. Do not memorize the implementations — close the page, write your own, then diff.

## Task 1 — Process counter visible to monitoring

**Scenario:** A server processes incoming requests. Each handler increments a counter; a `/metrics` endpoint reads it.

**Primitive:** `atomic.Int64`.

**Implementation:**

```go
type Server struct {
    requests atomic.Int64
}

func (s *Server) handle(req *Request) {
    s.requests.Add(1)
    // ... handle request ...
}

func (s *Server) metricsHandler(w http.ResponseWriter, _ *http.Request) {
    fmt.Fprintf(w, "requests=%d\n", s.requests.Load())
}
```

**Why not a channel?** A channel of increment-events forces every handler through a single consumer goroutine and adds allocation. Atomic Add is one CPU instruction.

**Why not a mutex?** A mutex around the int64 works, but adds an unnecessary lock acquisition on every request. Atomic is strictly cheaper for a single-value update.

## Task 2 — Fan-out HTTP fetches with bounded concurrency

**Scenario:** Given 1000 URLs, fetch them all in parallel but cap concurrent requests at 20. Return the first error if any.

**Primitive:** `errgroup.Group` with `SetLimit(20)`.

**Implementation:**

```go
func fetchAll(ctx context.Context, urls []string) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(20)

    results := make([]Response, len(urls))
    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            resp, err := fetch(ctx, u)
            if err != nil {
                return err
            }
            results[i] = resp
            return nil
        })
    }
    return g.Wait()
}
```

**Why not buffered channel + WaitGroup?** That is what `errgroup.SetLimit` does internally, with the bonus of error short-circuit and context cancellation. Reimplementing it is busywork.

## Task 3 — Lazy initialization of an expensive client

**Scenario:** A database client takes 200 ms to construct. Some request paths never need it. Only construct it on first use; subsequent users must wait if construction is in progress.

**Primitive:** `sync.OnceValue` (Go 1.21+) or `sync.Once` (any version).

**Implementation:**

```go
var dbClient = sync.OnceValue(func() *DBClient {
    return newDBClient()
})

func handler(w http.ResponseWriter, r *http.Request) {
    client := dbClient() // blocks all callers until first init completes
    client.Query(...)
}
```

**Why not `atomic.Pointer[DBClient]` with a CAS init?** That pattern requires double-checked locking to handle concurrent first-time callers without constructing twice. `sync.OnceValue` handles it correctly, including panic propagation.

## Task 4 — Bounded job queue with N workers

**Scenario:** Queue accepts up to 100 pending jobs; 8 workers consume them. Producer should block if the queue is full.

**Primitive:** Buffered `chan Job`.

**Implementation:**

```go
type Pool struct {
    jobs chan Job
    wg   sync.WaitGroup
}

func NewPool(workers, queueDepth int) *Pool {
    p := &Pool{jobs: make(chan Job, queueDepth)}
    p.wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func() {
            defer p.wg.Done()
            for j := range p.jobs {
                process(j)
            }
        }()
    }
    return p
}

func (p *Pool) Submit(j Job) { p.jobs <- j } // blocks if full
func (p *Pool) Shutdown()    { close(p.jobs); p.wg.Wait() }
```

**Why not a `[]Job` with a mutex and cond?** The buffered channel encapsulates the bounded queue, producer blocking, consumer signaling, and shutdown semantics in 5 lines. The hand-rolled version is 30 lines and has at least one bug.

## Task 5 — Read-mostly config snapshot

**Scenario:** A config struct is read on every request. A background goroutine reloads it from disk every 30 seconds.

**Primitive:** `atomic.Pointer[Config]`.

**Implementation:**

```go
type Config struct {
    Timeout time.Duration
    MaxConn int
}

var current atomic.Pointer[Config]

func Get() *Config { return current.Load() }

func reloadLoop(ctx context.Context) {
    t := time.NewTicker(30 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            c, err := loadFromDisk()
            if err != nil {
                log.Printf("reload failed: %v", err)
                continue
            }
            current.Store(c)
        }
    }
}

func init() {
    c, _ := loadFromDisk()
    current.Store(c)
}
```

**Why not `sync.RWMutex`?** Atomic load is one instruction; RWMutex.RLock involves a CAS on a shared cache line. At 100K+ reads/sec the difference shows.

## Task 6 — Wait for first successful RPC out of three

**Scenario:** Issue an RPC to three replicas in parallel; return as soon as one succeeds; cancel the others.

**Primitive:** Goroutines + buffered result channel + `context.WithCancel`.

**Implementation:**

```go
func firstSuccess(ctx context.Context, replicas []string) ([]byte, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    type result struct {
        data []byte
        err  error
    }
    results := make(chan result, len(replicas))
    for _, r := range replicas {
        r := r
        go func() {
            d, e := rpc(ctx, r)
            select {
            case results <- result{d, e}:
            case <-ctx.Done():
            }
        }()
    }

    var lastErr error
    for i := 0; i < len(replicas); i++ {
        r := <-results
        if r.err == nil {
            return r.data, nil
        }
        lastErr = r.err
    }
    return nil, lastErr
}
```

**Why a buffered channel?** Capacity equal to the number of replicas guarantees late senders never block, so they can exit cleanly even after the receiver has returned. With an unbuffered channel and a `cancel()` before the senders complete, the senders would leak unless they also `select`ed on `ctx.Done()`.

## Task 7 — Per-key serialization

**Scenario:** Many goroutines update records keyed by string ID. Updates to the same key must serialize; updates to different keys must parallelize.

**Primitive:** `sync.Map[string, *sync.Mutex]` (or a sharded `map[string]*sync.Mutex` protected by a meta-mutex).

**Implementation:**

```go
type KeyLocker struct {
    locks sync.Map // key string -> *sync.Mutex
}

func (k *KeyLocker) Lock(key string) func() {
    m, _ := k.locks.LoadOrStore(key, &sync.Mutex{})
    mu := m.(*sync.Mutex)
    mu.Lock()
    return mu.Unlock
}

// Usage:
unlock := keyLocker.Lock(recordID)
defer unlock()
mutateRecord(recordID)
```

**Why `sync.Map`?** Per-key access is exactly the "disjoint key sets" use case the godoc lists. Different goroutines mostly touch different keys, so contention on a single global lock would be the bottleneck.

**Gotcha:** This map grows monotonically. For unbounded key spaces, add a periodic sweep that deletes locks not currently held — but that itself requires care; consult `golang.org/x/sync/singleflight` for a related pattern that handles cleanup.

## Task 8 — Producer-consumer with priority

**Scenario:** Producers enqueue tasks with priorities; consumers must dequeue highest-priority first.

**Primitive:** `container/heap.Interface` + `sync.Mutex` + `sync.Cond`.

**Implementation:**

```go
type PriorityQueue struct {
    mu    sync.Mutex
    cond  *sync.Cond
    heap  taskHeap // implements heap.Interface
}

func New() *PriorityQueue {
    pq := &PriorityQueue{}
    pq.cond = sync.NewCond(&pq.mu)
    return pq
}

func (pq *PriorityQueue) Push(t Task) {
    pq.mu.Lock()
    heap.Push(&pq.heap, t)
    pq.mu.Unlock()
    pq.cond.Signal()
}

func (pq *PriorityQueue) Pop() Task {
    pq.mu.Lock()
    defer pq.mu.Unlock()
    for pq.heap.Len() == 0 {
        pq.cond.Wait()
    }
    return heap.Pop(&pq.heap).(Task)
}
```

**Why Cond and not channel?** Channels are FIFO; they cannot reorder by priority. The heap reorders. The Cond is the right primitive to wake a consumer when the heap goes from empty to non-empty.

## Task 9 — Broadcast a value to all current and future subscribers

**Scenario:** A weather service publishes the current temperature. Subscribers join at any time and should immediately see the latest value; thereafter they should receive every update.

**Primitive:** `atomic.Pointer[Snapshot]` for the latest value + per-subscriber `chan Snapshot` for the stream.

**Implementation:**

```go
type Broker struct {
    latest atomic.Pointer[Temp]

    mu   sync.Mutex
    subs []chan Temp
}

func (b *Broker) Latest() *Temp { return b.latest.Load() }

func (b *Broker) Subscribe() <-chan Temp {
    ch := make(chan Temp, 8)
    b.mu.Lock()
    b.subs = append(b.subs, ch)
    b.mu.Unlock()
    if t := b.latest.Load(); t != nil {
        ch <- *t // deliver current snapshot immediately
    }
    return ch
}

func (b *Broker) Publish(t Temp) {
    b.latest.Store(&t)
    b.mu.Lock()
    defer b.mu.Unlock()
    for _, s := range b.subs {
        select {
        case s <- t:
        default: // drop if subscriber is slow
        }
    }
}
```

**Why not a single shared channel?** A send delivers to *one* receiver, not all. Broadcasting to N requires either N channels or `sync.Cond` (and Cond does not carry data).

## Task 10 — Graceful shutdown of a worker pool

**Scenario:** Workers process jobs from a channel. On shutdown, stop accepting new jobs, drain the queue, then exit.

**Primitive:** Close the jobs channel + `sync.WaitGroup` for worker completion.

**Implementation:**

```go
type Pool struct {
    jobs chan Job
    wg   sync.WaitGroup
}

func (p *Pool) Start(n int) {
    p.wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer p.wg.Done()
            for j := range p.jobs { // exits when channel closed and drained
                process(j)
            }
        }()
    }
}

func (p *Pool) Submit(j Job) error {
    select {
    case p.jobs <- j:
        return nil
    default:
        return errors.New("queue full")
    }
}

func (p *Pool) Shutdown() {
    close(p.jobs) // no more sends allowed; workers drain remaining
    p.wg.Wait()   // wait for all workers to finish
}
```

**Why this combo?** Channel close gives "no more work" broadcast; `range` naturally drains and exits. WaitGroup tells the orchestrator the pool is fully quiesced. No `sync.Cond`, no `context.Done` needed for this specific shape — though both would also work if the requirements were different (e.g., abort in-flight work instead of draining).

## How to use this page

Pick a task at random. Write the implementation from a blank page. Run the tests below (you can sketch them yourself — they are short). Then compare with the reference implementation. Note where you reached for a heavier primitive than necessary; the next time the same scenario appears in production code, you will catch it in your own review.
