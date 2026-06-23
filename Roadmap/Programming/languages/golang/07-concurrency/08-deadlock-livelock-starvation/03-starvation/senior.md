# Starvation — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Scheduler-Level Starvation in the GMP Model](#scheduler-level-starvation-in-the-gmp-model)
3. [Priority Inversion](#priority-inversion)
4. [Anti-Starvation Priority Queues](#anti-starvation-priority-queues)
5. [Weighted Fair Queueing](#weighted-fair-queueing)
6. [Designing Cancellable Locks](#designing-cancellable-locks)
7. [Production Diagnosis Playbook](#production-diagnosis-playbook)
8. [Summary](#summary)

---

## Introduction

The middle level handed you the runtime's built-in protections. This file is about what is *not* handled automatically and how to engineer your own fairness when the workload demands it. We will:

- Examine the GMP scheduler's work-stealing rules and the edge cases where they fail to redistribute load.
- Walk through priority inversion: a low-priority goroutine holding a lock a high-priority goroutine needs.
- Design two production-grade anti-starvation priority queues: aging and multi-level feedback.
- Discuss weighted fair queueing for multi-tenant systems.
- Build a cancellable lock that surfaces "I waited too long" as `context.Canceled`.
- Run through the playbook a senior on-call engineer follows when latency tails blow up.

By the end you will have the building blocks to extend Go's concurrency primitives when fairness becomes a product requirement.

---

## Scheduler-Level Starvation in the GMP Model

### Recap of GMP

- **G** — goroutine. The unit of scheduling.
- **M** — machine (OS thread). The unit of execution.
- **P** — processor. The unit of scheduling capacity. There are `GOMAXPROCS` of them.

Each P owns a local run queue (LRQ) of runnable goroutines. There is also a global run queue (GRQ). Ms grab a P, run goroutines from the local queue, occasionally check the global queue, and steal from other Ps' local queues when their own is empty.

### How starvation can happen at the scheduler level

#### 1. Tight pure-CPU loops (pre-1.14)

A goroutine that never makes a function call, never sends/receives on a channel, never allocates, never touches a lock — call it a "leaf goroutine" — gave the runtime no opportunity to insert a preemption check. On Go 1.13 and earlier, such a loop ran until it voluntarily yielded (effectively forever for `for { x++ }`).

If `GOMAXPROCS=1` and one such loop existed, every other goroutine was starved. If `GOMAXPROCS>1`, only goroutines on the same P were starved, and work-stealing would eventually rebalance — but the leaf goroutine still owned its P forever.

#### 2. Local-queue domination

A P with a long local queue keeps running its own goroutines. Other Ps with empty queues steal half the LRQ of the busiest P. But the running goroutine on the busy P is *not* in the queue and cannot be stolen. If that goroutine is long-running, only its P serves it; other Ps may sit idle.

In practice this is rarely a starvation source because work-stealing kicks in quickly. It can matter in carefully tuned benchmarks.

#### 3. GRQ starvation

The Go scheduler checks the GRQ periodically (every `schedtick`) but not on every iteration. A goroutine on the GRQ can wait several "ticks" before being picked up by an M. Under heavy local work this is invisible; under steady-state load with mixed sources, GRQ goroutines can lag.

#### 4. NetPoller integration

A goroutine waking from `netpoll` is placed onto a P's queue. Which P? The runtime tries to put it on a P that needs work; if all Ps are busy, the goroutine waits in a system-wide queue. Under heavy CPU load, a netpoll-readiness can be delayed beyond expected response times.

### Async preemption (Go 1.14+) in depth

Russ Cox and Austin Clements implemented async preemption in Go 1.14:

- The runtime sends a `SIGURG` to the M running a goroutine that has exceeded its 10 ms time-slice.
- The signal handler in the runtime checks if the goroutine is at a safe point (no pointer in registers that the GC cannot scan).
- If safe, it switches the goroutine to a state where the scheduler can pick it up; the goroutine resumes later.

Effects:

- A tight `for { ... }` is preempted within ~10 ms.
- Other goroutines on the same P get CPU time.
- The leaf-goroutine starvation problem is gone.

Caveats:

- The 10 ms slice is best-effort. Under heavy CPU contention it can stretch.
- Some operations (assembly without safe points, foreign calls) are not preemptible; they finish first.
- The signal is `SIGURG` on Unix, which may interfere with programs that use `SIGURG` for their own purposes. Rare.

### Why GOMAXPROCS=1 still hides starvation in tests

When `GOMAXPROCS=1`, there is only one P and one M can run at a time. All scheduling is on that single P. This amplifies any fairness bug — a tight loop blocks everything else — but also serialises everything, hiding races. Always test with `GOMAXPROCS >= 2` (ideally `runtime.NumCPU()`) for fairness questions.

---

## Priority Inversion

### Definition

Priority inversion is a failure mode in priority-based scheduling: a low-priority task `L` holds a resource `R` that a high-priority task `H` needs. As long as `L` does not release `R`, `H` waits. The system has effectively demoted `H` to `L`'s priority.

If a *medium-priority* task `M` exists that does not need `R` but does compete with `L` for CPU, then `M` may preempt `L`, extending `L`'s critical section indefinitely. `H` waits behind `L`, who waits behind `M`. This is the classic *unbounded* priority inversion.

### Priority inversion in Go

Go has no first-class goroutine priorities. Every goroutine is "the same priority" to the scheduler. So priority inversion in Go is always *application-level*: you, the developer, have created a priority distinction (e.g., "premium users vs. free users", "interactive requests vs. background jobs") and built a queue or lock that respects it.

Where it bites:

- A shared `sync.Mutex` between a high-priority worker pool and a low-priority background scrubber. The scrubber grabs the lock; the high-priority workers wait. The fact that they are high-priority is meaningless because the lock has no notion of priority.
- A `chan Job` consumed by a worker pool that picks the next job by priority but where any worker can become "stuck" on a long-running low-priority job for the duration of that job.

### Mitigation patterns

**1. Don't share locks between priorities.** Easier said than done, but often achievable: split the underlying data into per-priority shards, or replicate enough state that the high-priority path does not need the same lock.

**2. Priority inheritance (manual).** If a high-priority goroutine is waiting for a lock held by a low-priority goroutine, "boost" the holder until it releases. In Go, you cannot boost the OS scheduler's priority of a goroutine, but you can:

- Set a flag the holder polls.
- Have the holder shorten its critical section when the flag is set.
- Have the holder hand off pending work to a fast path.

**3. Yield-on-contention.** A long-running low-priority job can periodically check "is anyone waiting?" and yield the lock to let waiters proceed.

```go
type YieldingMutex struct {
    inner   sync.Mutex
    waiters atomic.Int64
}

func (m *YieldingMutex) Lock() {
    m.waiters.Add(1)
    m.inner.Lock()
    m.waiters.Add(-1)
}

func (m *YieldingMutex) Unlock() { m.inner.Unlock() }

func (m *YieldingMutex) WaitingCount() int64 { return m.waiters.Load() }
```

The low-priority worker checks `WaitingCount()` periodically and releases the lock when it sees waiters:

```go
for batch := range bigJob {
    process(batch)
    if mu.WaitingCount() > 0 {
        mu.Unlock()
        runtime.Gosched()
        mu.Lock()
    }
}
```

This is *cooperative* priority inversion mitigation. It only works if the holder is well-behaved.

**4. Read/write split.** If the high-priority path only reads, use `sync.RWMutex`. The high-priority reader can join the lock with other readers while the low-priority writer waits — exactly the inverse of normal RWMutex starvation. Use with care.

---

## Anti-Starvation Priority Queues

A pure priority queue (heap by priority) starves low-priority items if high-priority items keep arriving. Two patterns to fix this.

### Pattern 1: Aging

Every item is enqueued with `priority` and `enqueueTime`. When ordering, use an *effective priority* that grows with wait time:

```go
type Item struct {
    Payload   any
    Priority  int       // 0 = highest
    EnqueueAt time.Time
}

func (q *AgingQueue) effective(it *Item) int {
    age := time.Since(it.EnqueueAt)
    // Every 100 ms of waiting reduces effective priority value by 1.
    bonus := int(age / (100 * time.Millisecond))
    if bonus > it.Priority {
        bonus = it.Priority
    }
    return it.Priority - bonus
}
```

Order the heap by `effective`. An item with priority 5 that has waited 500 ms competes as priority 0. No item can wait longer than `5 * 100 ms = 500 ms` behind high-priority items.

Concrete bound: with `K` priority levels and aging rate of `R`, an item waits at most `K * R` behind higher-priority items (plus actual service time). You pick `R` to match your latency SLA.

Implementation skeleton:

```go
type AgingQueue struct {
    mu    sync.Mutex
    items []*Item // unsorted; we scan
    nonEmpty *sync.Cond
}

func (q *AgingQueue) Push(it *Item) {
    q.mu.Lock()
    q.items = append(q.items, it)
    q.mu.Unlock()
    q.nonEmpty.Signal()
}

func (q *AgingQueue) Pop() *Item {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 {
        q.nonEmpty.Wait()
    }
    bestIdx := 0
    for i := 1; i < len(q.items); i++ {
        if q.effective(q.items[i]) < q.effective(q.items[bestIdx]) {
            bestIdx = i
        }
    }
    it := q.items[bestIdx]
    q.items[bestIdx] = q.items[len(q.items)-1]
    q.items = q.items[:len(q.items)-1]
    return it
}
```

This is O(N) per pop; fine for small queues. For larger queues, periodically resort or use a more sophisticated structure (a heap with periodic rebuilding when the aging shifts ordering significantly).

### Pattern 2: Multi-Level Feedback (MLFQ)

Maintain several FIFO queues, one per priority class. Dispatcher serves them in round-robin with weights:

```go
type MLFQ struct {
    queues []chan Item // index 0 = highest priority
    quotas []int       // how many items to drain per round at each level
}

func (q *MLFQ) Dispatch(ctx context.Context, out chan<- Item) {
    for {
        for i, ch := range q.queues {
            for n := 0; n < q.quotas[i]; n++ {
                select {
                case it := <-ch:
                    select {
                    case out <- it:
                    case <-ctx.Done():
                        return
                    }
                case <-ctx.Done():
                    return
                default:
                    // empty at this level; move on
                    break
                }
            }
        }
    }
}
```

With `quotas = [4, 2, 1]` the dispatcher serves up to 4 high-priority items, then up to 2 medium, then up to 1 low, then repeats. Low-priority items are not starved; they get 1/7 of throughput at steady state.

This pattern is simpler to reason about than aging and easier to tune. Trade-off: priority granularity is fixed to the number of queues.

---

## Weighted Fair Queueing

In a multi-tenant system, fairness is *between tenants*, not between priority classes. Two tenants `A` and `B` both submit work; we want each to get a guaranteed share of throughput.

### Naive round-robin

```go
tenants := []chan Job{aQueue, bQueue, cQueue}
for {
    for _, t := range tenants {
        select {
        case j := <-t:
            workers <- j
        default:
        }
    }
}
```

Problems: spins when all empty; gives each tenant equal share regardless of priority; tenants with light load skip their slot and tenants with heavy load do not benefit.

### Deficit Round Robin (DRR)

Each tenant has a deficit counter and a quantum:

```go
type Tenant struct {
    queue   chan Job
    deficit int
    quantum int
}

func DRR(tenants []*Tenant, out chan<- Job) {
    for {
        progress := false
        for _, t := range tenants {
            t.deficit += t.quantum
            for {
                select {
                case j := <-t.queue:
                    cost := j.Cost()
                    if cost > t.deficit {
                        // not enough deficit; put back
                        t.queue <- j
                        break
                    }
                    t.deficit -= cost
                    out <- j
                    progress = true
                    continue
                default:
                }
                break
            }
        }
        if !progress {
            // all empty; wait
            select {
            case <-anyReady(tenants):
            }
        }
    }
}
```

DRR is O(1) per dispatch (amortised) and gives each tenant a share proportional to its quantum. If tenant A has quantum 100 and tenant B has quantum 50, A gets 2/3 of capacity and B gets 1/3.

DRR handles variable-cost jobs: a long job consumes its deficit and the tenant must wait several rounds before sending another long job. Short jobs let a tenant burst.

### Application: rate limiter

A multi-tenant rate limiter built with DRR ensures no tenant starves the others. A noisy tenant fills its own queue but the dispatcher only drains its quantum-worth per round; quiet tenants always get their share.

---

## Designing Cancellable Locks

`sync.Mutex.Lock` is not cancellable. A goroutine parked there ignores `ctx.Done()`. For a senior system you often need a lock you can cancel.

### Channel-based lock

```go
type CtxMutex struct {
    sem chan struct{}
}

func NewCtxMutex() *CtxMutex {
    return &CtxMutex{sem: make(chan struct{}, 1)}
}

func (m *CtxMutex) Lock(ctx context.Context) error {
    select {
    case m.sem <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (m *CtxMutex) Unlock() {
    <-m.sem
}
```

A single-slot buffered channel acts as a binary semaphore. The `select` adds cancellation.

### Properties

- **Cancellable.** Yes, by `ctx.Done()`.
- **Fair?** Not strictly. The runtime picks pseudo-randomly among parked senders. Adequate for most use.
- **Cost.** A `chan struct{}` is more expensive than `sync.Mutex` (channel send/recv vs. CAS). For high-frequency uncontended locks, prefer `sync.Mutex`. For locks where cancellation matters and contention is moderate, this pattern is excellent.

### FIFO cancellable lock

If you need both FIFO fairness *and* cancellation:

```go
type FIFOMutex struct {
    mu      sync.Mutex
    held    bool
    waiters []chan struct{}
}

func (m *FIFOMutex) Lock(ctx context.Context) error {
    m.mu.Lock()
    if !m.held {
        m.held = true
        m.mu.Unlock()
        return nil
    }
    ch := make(chan struct{})
    m.waiters = append(m.waiters, ch)
    m.mu.Unlock()

    select {
    case <-ch:
        return nil
    case <-ctx.Done():
        // remove ourselves from waiters; if we were already signalled, hand off.
        m.mu.Lock()
        for i, w := range m.waiters {
            if w == ch {
                m.waiters = append(m.waiters[:i], m.waiters[i+1:]...)
                m.mu.Unlock()
                return ctx.Err()
            }
        }
        // We were already signalled but cancelled in the race. Hand off to next.
        m.mu.Unlock()
        m.Unlock()
        return ctx.Err()
    }
}

func (m *FIFOMutex) Unlock() {
    m.mu.Lock()
    if len(m.waiters) == 0 {
        m.held = false
        m.mu.Unlock()
        return
    }
    next := m.waiters[0]
    m.waiters = m.waiters[1:]
    m.mu.Unlock()
    close(next)
}
```

Cost: O(N) waiter list operations on cancel. For small N this is fine. For large N use a doubly linked list or an `intrusive` structure where each waiter knows its own slot.

### When this matters

- API handler that wants to free a client connection if the upstream lock is slow.
- Background job that should abort if shutdown is requested.
- Test code that needs a deterministic timeout instead of `time.Sleep` plus checks.

---

## Production Diagnosis Playbook

A senior engineer on call sees p99 latency triple at 03:14 UTC. Steps:

### Step 1: Confirm the signal

Look at p50, p90, p99, p99.9. A starvation event typically:

- Leaves p50 unchanged.
- Lifts p99 by 5-50x.
- Pushes p99.9 to or past timeout limits.

If p50 is also up, it is likely overall overload, not starvation.

### Step 2: Locate the resource

Pull mutex and block profiles from a representative node:

```
go tool pprof http://node:6060/debug/pprof/mutex
(pprof) top10
(pprof) list <function>
```

The function consuming the most wait time is the suspect. Look at the stack trace: is it a single lock or many?

### Step 3: Confirm fairness or unfairness

- For a `sync.Mutex`: count how often `mutexStarving` was set (visible via `GODEBUG=schedtrace=1000` or custom instrumentation). A frequently-starving mutex means heavy contention; the runtime is handling it but the cost is throughput.
- For a `sync.RWMutex`: instrument writer wait time. If max writer wait is >> max reader wait, you have writer starvation.
- For a worker pool: log queue depth per priority. A queue that never drains is a starved class.

### Step 4: Identify the cause

Common causes in production:

- A long-running operation moved inside a critical section. Look at recent deploys.
- A traffic shift that increased read:write ratio on an `RWMutex`-fronted resource.
- A burst of a particular tenant or request type that overwhelmed a shared queue.
- A goroutine in a tight loop on Go pre-1.14 (rare nowadays).
- GC pauses lengthening the effective critical section.

### Step 5: Mitigate

Order of preference:

1. **Roll back the offending change.** If a recent deploy caused it, this is the fastest win.
2. **Shrink the critical section.** Move work outside the lock.
3. **Add back-pressure.** Bound a queue; reject excess instead of queuing.
4. **Split the resource.** Shard the data so multiple locks share the load.
5. **Switch lock type.** `RWMutex` ↔ `Mutex`, or to a custom anti-starvation primitive.
6. **Increase capacity.** More replicas, more workers, more queue depth (cautiously).

### Step 6: Postmortem

The starvation event itself is rarely a one-off. Document:

- The exact symptom (p99 latency series).
- The contributing change.
- The mechanism (which lock, which queue, which pattern).
- The fix.
- The detection: how would we have caught this earlier? Add a metric, an alert, a load test.

The diagnostic skill is *recognising* starvation. The engineering skill is *building systems where the next starvation event is impossible by construction*.

---

## Summary

At senior level, starvation moves from "use the built-in primitives correctly" to "design your own primitives when the built-ins do not match the workload". Scheduler-level starvation is mostly handled by Go 1.14+ async preemption, but priority inversion, multi-tenant fairness, and cancellation are application concerns. The toolkit:

- Aging or MLFQ for prioritised work that must not starve low-priority items.
- DRR for multi-tenant fairness with proportional shares.
- Channel-based or FIFO locks when cancellation matters.
- Yield-on-contention for cooperative priority inversion mitigation.
- A production playbook that confirms the signal, locates the resource, identifies the cause, and mitigates in a known order.

Continue to [professional.md](professional.md) for the runtime sources behind async preemption and the bit-level state changes of `sync.Mutex` starvation mode.
