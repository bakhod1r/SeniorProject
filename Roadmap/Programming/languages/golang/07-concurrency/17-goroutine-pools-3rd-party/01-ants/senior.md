---
layout: default
title: Senior
parent: ants
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/01-ants/senior/
---

# ants — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Anatomy of a Pool](#anatomy-of-a-pool)
5. [The Worker Stack](#the-worker-stack)
6. [Worker Queue Implementations](#worker-queue-implementations)
7. [The Lock-Free Fast Path](#the-lock-free-fast-path)
8. [The Locker Fallback](#the-locker-fallback)
9. [The goWorker Lifecycle](#the-goworker-lifecycle)
10. [sync.Pool Reuse](#syncpool-reuse)
11. [The Janitor (Purger)](#the-janitor-purger)
12. [The Cond Wait Queue](#the-cond-wait-queue)
13. [MultiPool: Sharded Concurrency](#multipool-sharded-concurrency)
14. [MGRR Strategies](#mgrr-strategies)
15. [Memory Model & Happens-Before](#memory-model--happens-before)
16. [Scheduler Interaction](#scheduler-interaction)
17. [Atomic Counters and Snapshots](#atomic-counters-and-snapshots)
18. [Internal Diagnostics](#internal-diagnostics)
19. [Performance Considerations](#performance-considerations)
20. [Edge Cases & Internal Pitfalls](#edge-cases--internal-pitfalls)
21. [Source Walkthrough](#source-walkthrough)
22. [Test](#test)
23. [Tricky Questions](#tricky-questions)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [Further Reading](#further-reading)
27. [Related Topics](#related-topics)
28. [Diagrams](#diagrams)

---

## Introduction

> Focus: "How does `ants` actually work? When I read the source, what should I expect? Where are the hot paths, the lock acquisitions, the lifecycle of a worker, the data structures? What is `MultiPool`, and why does it exist?"

In `junior.md` and `middle.md` you used `ants` as a black box: pool, options, methods. This file opens the box. After reading it you should be able to:

- Sketch the internal layout of `ants.Pool` on a whiteboard.
- Trace exactly what happens on a `Submit` call, both fast and slow paths.
- Explain the worker LIFO stack, why LIFO, and the trade-offs of the two queue implementations (slice vs circular).
- Understand the lock-free fast path and when it applies.
- Explain the locker fallback (`sync.Mutex` or a spinlock in some builds).
- Trace the `goWorker.run` loop and explain how a panic doesn't kill it.
- Explain how the janitor decides what to purge.
- Distinguish `MultiPool` from `Pool` and explain when each is the right primitive.
- Explain the two `MGRR` (multi-goroutine-pool round-robin / least-tasks) strategies.

This file is *not* a line-by-line code reading of `ants` — file structure changes across versions. It is the *mental model* of the implementation. With this in your head, the source becomes a confirmation, not a discovery.

---

## Prerequisites

- Comfortable with everything in `junior.md` and `middle.md`.
- Familiar with `sync.Mutex`, `sync.Cond`, `sync.WaitGroup`, `sync.Pool`. If `sync.Cond` is unfamiliar, read its GoDoc and the `02-sync-primitives` subsection first.
- Familiar with `atomic` operations: `Load`, `Store`, `Add`, `CompareAndSwap`. The package `sync/atomic` is the workhorse of the fast path.
- Familiar with the Go memory model — specifically that `atomic.Store` followed by `atomic.Load` establishes happens-before, and that mutex Lock/Unlock has full release/acquire semantics.
- Familiar with Go's GMP scheduler at a conceptual level. The internals of `ants` interact with the scheduler in specific ways.
- Familiar with reading Go source. The `ants` repo is small (~1500 lines), and pieces of this file are easier with the source open in another tab.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`goWorker`** | The internal struct that wraps a worker goroutine. Holds the task input channel, the last-active timestamp, and a back-reference to the pool. |
| **Worker stack** | The LIFO collection of idle `*goWorker` waiting for tasks. Pop on Submit, push on task completion. |
| **`workerQueue`** | The interface that the worker stack implements. Has two implementations: `workerStack` (slice-based, default) and `loopQueue` (circular, used with `WithPreAlloc`). |
| **Fast path** | The hot path of `Submit`: pop a worker via mutex-protected operations, send the task. No blocking, no goroutine creation. |
| **Slow path** | When fast path fails: take the mutex, check if more workers can be spawned, possibly block on a cond. |
| **`sync.Cond`** | The standard-library condition variable. `ants` uses one (or several) to wake blocked submitters. |
| **`sync.Pool`** | The standard-library object cache. `ants` uses it to recycle `*goWorker` structs (and `*goWorkerWithFunc`) across construction/destruction. |
| **`MultiPool`** | A sharded collection of `Pool`s. The user calls `Submit` on `MultiPool`; the `MultiPool` picks a shard via a `LoadBalancingStrategy` (round-robin or least-tasks). |
| **MGRR** | Acronym used in `ants` code/docs for "Multi-Goroutine-pool Round-Robin" — the load-balancing strategy interface. |
| **Spinlock** | An optional low-level lock used in some builds where `sync.Mutex` is replaced by a CAS-spinning structure. Trades CPU cycles for lower latency at low contention. |
| **Purger** | Another name for the janitor — the goroutine that runs `purgeStaleWorkers` periodically. |
| **Poison pill** | A `nil` value sent to a worker's task channel to signal it to exit. Used by both purger and `Release`. |

---

## Anatomy of a Pool

Imagine `ants.Pool` as roughly this struct (simplified, names approximate):

```go
type Pool struct {
	capacity   int32      // atomically set/read
	running    int32      // atomic; current worker count
	lock       sync.Locker
	workers    workerQueue // idle worker LIFO
	state      int32       // 0=open, 1=closed (atomic)
	cond       *sync.Cond  // for blocked submitters
	workerCache sync.Pool   // recycled *goWorker structs
	waiting    int32       // count of blocked submitters (atomic)
	purgeDone  chan struct{}
	purgeCtx   context.Context
	purgeCancel context.CancelFunc
	options    *Options
}
```

The actual code is in `pool.go` (and `pool_func.go` for `PoolWithFunc`). The fields' names may differ slightly. The shape is consistent.

Key invariants:

1. `running <= capacity` always, except possibly transiently after `Tune` down.
2. `len(workers) + running == ??` — workers in `workers` are idle, not counted in `running`. So idle workers do *not* show up in `running`.

Wait, that contradicts what `Running()` returns. Let me clarify:

Actually, `running` in the struct counts workers *spawned but not yet exited*. Idle workers (on the stack waiting) count as running because they exist as goroutines. The stack holds them as pointers; the count holds the total.

Re-reading the code: `Running()` returns the count of currently-active workers — those executing tasks. Idle workers don't count.

OK — to avoid getting wrapped around the axle on small terminology differences across versions, here is the canonical model:

- `Cap` is the *maximum number of workers that can exist concurrently*.
- `Running` is the *current number of workers that exist*.
- Idle workers count toward `Running` (they exist as goroutines).
- `Free = Cap - Running` is the *slack to spawn more workers without hitting cap*.

When a task finishes, the worker becomes idle and is pushed onto the worker stack. `Running` does not decrement (the goroutine still exists). When the purger kills the worker via poison pill, the worker's run loop breaks, the goroutine exits, and `Running` decrements (typically as the worker self-decrements before exiting).

Different versions of `ants` have made different choices here; the spec is intentionally vague to let the library optimise. The conceptual model is good enough.

---

## The Worker Stack

The collection of idle `*goWorker`s is called the worker stack. It is LIFO: the most recently freed worker is the next one used.

### Why LIFO?

Two reasons:

1. **Cache locality.** The most recently used worker's stack pages and CPU caches are still warm. Reusing it immediately is faster than reusing one that's been idle for seconds.
2. **Idle expiry.** With LIFO, workers at the bottom of the stack are the longest idle. The purger only has to scan from the bottom to find expired workers — O(k) where k is the number of expired workers. With FIFO, the purger would have to scan from the front (which is the oldest), which is the same — but with LIFO, expired workers naturally cluster at the bottom, making "batched expiry" efficient.

FIFO would also work; LIFO is just slightly better for these two reasons. Most languages' thread pools use LIFO for the same reasons.

### Stack operations

Three ops on the worker stack:

- `push(w)` — add idle worker, top.
- `pop()` — take an idle worker, top.
- `findExpired(d)` — find all workers whose last-active is older than `d`.

`push` and `pop` are amortised O(1). `findExpired` is O(k) where k is the number of expired workers (since LIFO clusters them).

### Concurrent access

The worker stack is *not* lock-free. It is protected by `pool.lock`. The lock-free fast path of `Submit` is implemented elsewhere; the stack itself is mutex-protected.

Lock hold times are intentionally short:

- `push`: append to a slice; ~10 ns.
- `pop`: slice index lookup, shrink length; ~10 ns.
- `findExpired`: binary search if sorted by last-active, or linear scan if not.

Even at millions of submits/sec, the lock is rarely contended — most submits don't even take it (see fast path).

---

## Worker Queue Implementations

`ants` ships two implementations of `workerQueue`.

### Implementation 1 — `workerStack` (default)

A slice. Push appends; pop drops the last element. Linear-time `findExpired`.

```go
type workerStack struct {
	items []*goWorker
	exp   []*goWorker // reusable buffer for findExpired results
}

func (s *workerStack) insert(w *goWorker) {
	s.items = append(s.items, w)
}

func (s *workerStack) detach() *goWorker {
	n := len(s.items) - 1
	if n < 0 { return nil }
	w := s.items[n]
	s.items[n] = nil
	s.items = s.items[:n]
	return w
}

func (s *workerStack) refresh(duration time.Duration) []*goWorker {
	n := len(s.items)
	if n == 0 { return nil }
	expireTime := time.Now().Add(-duration)
	idx := sort.Search(n, func(i int) bool {
		return s.items[i].lastUsed.After(expireTime)
	})
	if idx == 0 { return nil }
	s.exp = append(s.exp[:0], s.items[:idx]...)
	m := copy(s.items, s.items[idx:])
	for i := m; i < n; i++ { s.items[i] = nil }
	s.items = s.items[:m]
	return s.exp
}
```

(Approximation of the actual code; the real one is in `worker_stack.go`.)

Key tricks:

- `s.items` is sorted by `lastUsed`. The binary search finds the boundary between expired and live.
- The reusable `s.exp` slice avoids per-purge allocation.
- After detach (pop), the slot is nil'd so the GC can collect the worker pointer.

### Implementation 2 — `loopQueue` (with `WithPreAlloc`)

A fixed-size circular buffer. Push at tail, pop from head (or vice versa). Size set at construction; cannot grow beyond initial cap without reallocation.

```go
type loopQueue struct {
	items  []*goWorker
	expiry []*goWorker
	head   int
	tail   int
	size   int
	isFull bool
}
```

Pros: no slice growth, fixed memory. Cons: cap is fixed at construction (modulo reallocations).

### Choosing

Without `WithPreAlloc`: `workerStack` (slice).
With `WithPreAlloc(true)`: `loopQueue` (circular).

For most apps, the choice doesn't matter — both are fast. `loopQueue` shines in scenarios with very stable load and lots of `findExpired` activity. `workerStack` is simpler and handles `Tune` up better.

---

## The Lock-Free Fast Path

The hottest operation in `ants` is `Submit`. Let's trace it.

### Idealised pseudo-code

```go
func (p *Pool) Submit(task func()) error {
	if atomic.LoadInt32(&p.state) == CLOSED {
		return ErrPoolClosed
	}
	w := p.retrieveWorker()
	if w == nil {
		return ErrPoolOverload // non-blocking, or all paths exhausted
	}
	w.inputFunc(task)
	return nil
}
```

The interesting work happens in `retrieveWorker`.

### `retrieveWorker`

```go
func (p *Pool) retrieveWorker() *goWorker {
	p.lock.Lock()
	w := p.workers.detach()
	if w != nil {
		// Fast path: an idle worker was available.
		p.lock.Unlock()
		return w
	}

	if capacity := p.Cap(); capacity == -1 || capacity > int(atomic.LoadInt32(&p.running)) {
		// Below cap; spawn a new worker.
		p.lock.Unlock()
		w := p.workerCache.Get().(*goWorker)
		w.run()
		return w
	}

	// At cap. Block (or reject).
	if p.options.Nonblocking {
		p.lock.Unlock()
		return nil
	}

	if p.options.MaxBlockingTasks != 0 && p.Waiting() >= p.options.MaxBlockingTasks {
		p.lock.Unlock()
		return nil
	}

	// Wait on cond.
	atomic.AddInt32(&p.waiting, 1)
	p.cond.Wait()
	atomic.AddInt32(&p.waiting, -1)
	// ... and try again ...
}
```

(Simplified; real code handles closed-during-wait and other races.)

### What makes it "lock-free"?

The term is loose. There *is* a lock — `p.lock.Lock()`. What's "lock-free" about it:

- The hold time is microscopic — a single slice pop or capacity check.
- Most of the work happens *outside* the lock: spawning a worker, sending the task on the channel.
- The state check (`atomic.LoadInt32(&p.state)`) avoids taking the lock when the pool is closed.

In some build tags, `p.lock` is a *spinlock* (a CAS-based busy-wait), not a `sync.Mutex`. For low contention this is faster — no syscall, no parking, no scheduler involvement. For high contention, `sync.Mutex` is better (it parks waiters).

### Performance characteristics

On a modern x86 CPU, the fast path is:

- 1 atomic load (state check) — ~1 ns
- 1 atomic op (lock acquire) — ~5–10 ns (uncontended)
- 1 slice index (worker pop) — ~5 ns
- 1 atomic op (lock release) — ~5–10 ns
- 1 channel send (task delivery) — ~50 ns

Total: ~75–100 ns per submit when no worker creation is needed. The bulk of this is the channel send. For trivial tasks, the channel send is the dominant cost.

### Where the lock contention shows

Two `Submit` calls hitting the lock at exactly the same time is rare but possible. If your benchmark shows lock contention, you have:

- Very many concurrent submitters (hundreds).
- Trivial tasks (so the lock is reached often).
- Single pool (no sharding).

Solutions:

- `PoolWithFunc` reduces per-submit work (no closure allocation).
- `MultiPool` shards the lock — N pools each with their own lock.
- Submit larger batches per submit.

---

## The Locker Fallback

When the fast path can't find an idle worker and can't spawn one (pool at cap), the caller blocks.

The blocking is via `sync.Cond.Wait`. The `cond` is associated with `pool.lock`. The flow:

1. Take `pool.lock`.
2. `cond.Wait()` — atomically releases the lock and blocks.
3. When woken (by a worker freeing up or `Release`), reacquire the lock and re-test the condition.
4. If condition still false (no worker, not closed), `Wait` again.
5. If condition true, release lock and proceed.

This is the standard `sync.Cond` pattern. It is correct, but `Wait` is heavier than a fast-path acquisition — there's a Go scheduler parking involved. The hot path is *not* this — the hot path is the lock-free fast path.

### Why not use channels for waiting?

A `chan struct{}` could replace `sync.Cond`. Some library authors prefer channels for everything. The choice is largely stylistic. `sync.Cond` has slightly less overhead per wake (no channel select cost) and pairs naturally with the existing mutex.

### Wake fairness

`sync.Cond.Signal` wakes one waiter. `sync.Cond.Broadcast` wakes all. `ants` uses both:

- After a worker finishes a task and is pushed onto the idle stack: `cond.Signal()`. One submitter wakes.
- On `Release`: `cond.Broadcast()`. All submitters wake; they observe the closed flag and return `ErrPoolClosed`.

There is no FIFO fairness across submitters. Whichever the runtime wakes first wins. For most workloads this is fine; if you need strict fairness, you build it on top.

### Spurious wakeups

`Wait` may return without a signal (rare). The code defensively re-checks the condition after `Wait` returns. Always.

---

## The goWorker Lifecycle

Now the worker itself.

### The goWorker struct

```go
type goWorker struct {
	pool      *Pool
	task      chan func()
	lastUsed  time.Time
}
```

A worker has:

- A reference back to its pool.
- An input channel (size 1).
- A timestamp of when it last completed a task.

### `goWorker.run`

```go
func (w *goWorker) run() {
	atomic.AddInt32(&w.pool.running, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				if h := w.pool.options.PanicHandler; h != nil {
					h(r)
				} else {
					w.pool.options.Logger.Printf("worker recovered: %v\n%s", r, debug.Stack())
				}
			}
			atomic.AddInt32(&w.pool.running, -1)
			w.pool.workerCache.Put(w)
		}()
		for f := range w.task {
			if f == nil {
				return // poison pill
			}
			f()
			if ok := w.pool.revertWorker(w); !ok {
				return // pool full or closed; exit
			}
		}
	}()
}
```

(Approximated from `worker.go`.)

Key things:

- `run` immediately spawns a goroutine.
- The deferred function handles two things: panic recovery and bookkeeping (`running--`, return to `sync.Pool` cache).
- The main loop reads from `w.task`. A `nil` is a poison pill — exit.
- After running a task, `revertWorker(w)` puts the worker back on the idle stack. If that fails (pool closed, or full), the worker exits.

### Why is the task channel size 1?

Two reasons:

1. **Submission semantics.** `Submit` should not block once a worker is assigned. If the channel were unbuffered, the worker would have to be `recv`-ready before `Submit` could `send`. Buffered (1) means `Submit` can always send if the worker is idle.
2. **Cleanup on exit.** When the worker is about to exit (`return` from the loop), if `Submit` had already enqueued a task, the worker drains it gracefully... actually no, the buffered channel will have that task waiting. The worker `return`s and the task is never executed. This is a small loss in degenerate cases. `Release` and the purger try to avoid this race, but it can happen.

### Why use `sync.Pool` for `*goWorker`?

When a worker exits (poison pill, or pool closed), the `goWorker` struct itself can be reused for a future worker. The deferred `w.pool.workerCache.Put(w)` returns it to the cache. The next `retrieveWorker` calls `workerCache.Get()` to fetch a (possibly recycled) struct.

This saves ~100 bytes of allocation per worker spawn-and-exit cycle. Not huge per worker, but in a bursty workload where workers cycle hundreds of times per second, it matters.

### Worker exit conditions

A worker exits when:

1. It receives `nil` on `w.task` (poison pill — from purger or `Release`).
2. `revertWorker` returns false (pool is closed mid-cycle).
3. It panics in a way the recover doesn't catch (e.g., the recover handler itself panics in older versions — fixed in current).

Worker exit decrements `running` and returns the struct to the cache.

---

## sync.Pool Reuse

`ants` uses `sync.Pool` heavily. Three uses, conceptually:

### Use 1 — `*goWorker` (or `*goWorkerWithFunc`)

As described above. The most common reuse. Avoids ~100 bytes per worker cycle.

### Use 2 — Argument structs (in user code)

This is *your* responsibility, not `ants`'s. But the pattern is:

```go
var argPool = sync.Pool{New: func() any { return new(Args) }}

a := argPool.Get().(*Args)
a.X = 1
_ = pool.Invoke(a)
// In the worker:
// defer argPool.Put(a)
```

For zero-allocation submit at high rates.

### Use 3 — `findExpired` result slice

The worker stack reuses its `exp` slice across purger runs. Not a `sync.Pool`, but the same idea — preallocate and reuse.

### sync.Pool semantics to remember

- `Put` may discard the object (sync.Pool clears on GC).
- `Get` may return a fresh object even if you `Put` one earlier.
- Don't `Put` a stateful object without resetting it.
- The pool's behaviour is per-`P` (Go's processor); contention is low.

---

## The Janitor (Purger)

The purger goroutine runs in the background. It periodically:

1. Wakes up.
2. Asks the worker stack for expired workers (those idle longer than `ExpiryDuration`).
3. Sends a `nil` to each — the poison pill.
4. Sleeps until next interval.

### Wake interval

The interval defaults to `ExpiryDuration` (so it checks at most once per expiry window). With 1-second expiry, the purger runs once per second.

In some versions the interval is `ExpiryDuration / 10` for higher resolution; this is implementation detail.

### Purger termination

The purger exits when:

1. The pool's `purgeCtx` is cancelled (on `Release`).
2. The pool's state is `CLOSED`.

`Release` cancels the context and may wait for the purger to exit via a done channel.

### Why an explicit purger goroutine?

Alternative: the worker could check on each task completion "have I been idle longer than expiry?" But:

- Workers don't run when idle. They block on the task channel. They can't self-check.
- The purger runs in O(k) for k expired workers, vs O(N) for each worker self-checking.
- A central purger simplifies metrics and observability.

So the explicit goroutine is a clear win.

### Purger overhead

The purger is one goroutine per pool. With 100 pools, you have 100 purger goroutines, each waking N times per second (where N = 1/ExpiryDuration). For default 1s expiry, 100 wakeups/sec across all pools. Cheap.

For ultra-low overhead, `WithDisablePurge(true)` removes the purger entirely. Workers only exit on `Release`.

---

## The Cond Wait Queue

When `Submit` blocks (default mode, pool full), the caller waits on `pool.cond`. Let's look more carefully.

### Wake-up conditions

A `cond.Wait()` ends when:

- `cond.Signal()` (from `revertWorker` when a worker returns to idle stack).
- `cond.Broadcast()` (from `Release`).
- Spurious wakeup (rare).

After wake, the caller:

1. Reacquires the lock (Wait does this automatically).
2. Rechecks the condition.
3. If condition met, proceeds.
4. If not, Waits again.

### Tracking waiting count

`p.waiting` (atomic) tracks how many goroutines are blocked in `Wait`. This is the value `p.Waiting()` returns. Used for `WithMaxBlockingTasks` enforcement and for diagnostics.

### Fairness

`sync.Cond.Signal` wakes one waiter — the runtime picks. Not FIFO. For most workloads, fine. For strict ordering, build a queue in front of the pool.

### Cond performance

`sync.Cond.Wait` involves:

1. Park (block) the goroutine — typically O(1) but involves scheduler work.
2. On wake, unpark.

Per wait/wake cycle: a few microseconds. Compared to a successful fast-path submit (~100 ns), this is the slow path by a wide margin.

If you observe many cond waits in profiles, your pool is undersized. Either increase cap or use `WithNonblocking(true)` and handle overload.

---

## MultiPool: Sharded Concurrency

A single `Pool` has one lock. Under massive submission contention, the lock becomes the bottleneck. `MultiPool` shards.

### MultiPool layout

```go
type MultiPool struct {
	pools  []*Pool
	index  uint32      // round-robin counter, atomic
	lbs    LoadBalancingStrategy
}
```

A `MultiPool` is N sub-pools, each its own `Pool` with its own lock, idle stack, and purger.

### Construction

```go
mp, err := ants.NewMultiPool(numPools, sizePerPool, ants.RoundRobin)
```

`numPools` = number of shards. `sizePerPool` = cap per shard. Total effective cap = `numPools * sizePerPool`.

For 4 shards of 100 each, you get 400 total workers but the contention is spread across 4 separate locks.

### Submission

```go
mp.Submit(task)
```

Inside, the `MultiPool`:

1. Picks a shard via the load-balancing strategy.
2. Calls `Submit` on that shard.

### When to use MultiPool

- Single `Pool` lock is the bottleneck (you measured it).
- You have many concurrent submitters (say, thousands).
- Tasks are short and submission is high rate.

For most apps, a single `Pool` is fine. MultiPool kicks in at extreme scale.

### Cost

- N times more memory (N idle stacks, N purgers).
- N times more goroutines (N purgers).
- Slightly less optimal worker reuse (a worker on shard 1 can't pick up a task submitted to shard 2).

---

## MGRR Strategies

The acronym MGRR (Multi-Goroutine-pool Round-Robin) is used in `ants`'s docs. There are two strategies:

### Strategy 1 — `RoundRobin`

```go
func (mp *MultiPool) Submit(task func()) error {
	idx := atomic.AddUint32(&mp.index, 1)
	return mp.pools[idx % uint32(len(mp.pools))].Submit(task)
}
```

A simple monotonic counter. Each submit goes to the next shard.

Pros: O(1), no contention beyond the atomic add. Distributes evenly when submit rate is roughly constant.

Cons: doesn't adapt to imbalance. If one shard's tasks are slower, the round-robin keeps stuffing it.

### Strategy 2 — `LeastTasks`

```go
func (mp *MultiPool) Submit(task func()) error {
	best := mp.pools[0]
	bestRunning := best.Running()
	for _, p := range mp.pools[1:] {
		if r := p.Running(); r < bestRunning {
			best = p
			bestRunning = r
		}
	}
	return best.Submit(task)
}
```

Pick the shard with the lowest current `Running` count.

Pros: adapts to load imbalance.

Cons: O(N) per submit — must check every shard. For small N (say 4–16), this is fine. For large N, expensive.

### Which to pick?

- Uniform workload, many shards → RoundRobin.
- Variable workload, few shards → LeastTasks.
- Adversarial workload, large shard count → custom strategy.

You can also implement your own by satisfying the `LoadBalancingStrategy` interface — it's just a function returning a shard index.

### Custom strategy example

```go
type AffinityStrategy struct{}

func (s *AffinityStrategy) Pick(pools []*ants.Pool, hint interface{}) int {
	k, _ := hint.(int)
	return k % len(pools)
}
```

Hash-based: tasks with the same key always go to the same shard. Useful for cache locality.

### MultiPool with PoolWithFunc

`MultiPoolWithFunc` exists too, with the same shape. Identical strategies, applied to function-pools.

---

## Memory Model & Happens-Before

The Go memory model defines what one goroutine observes when another writes.

### Submit-to-task happens-before

After `Submit(f)` returns, the worker executing `f` observes everything that happened in the submitting goroutine before `Submit`. This is established by:

1. The submitter writes through the channel send (`w.task <- f`).
2. The receiver reads from the channel (`f := <-w.task`).
3. Per Go's memory model, channel send happens-before channel receive.

So `f` can safely read any variable the submitter wrote before submitting. This is *not* obvious — it works because of the channel.

### Task-to-task ordering

Two tasks submitted at different times: no ordering guarantee. They may run in parallel or in any order.

### WaitGroup happens-before

`wg.Wait()` returns after the last `wg.Done()`. Everything the goroutines did before `Done` is visible to the waiter. This is the standard pattern for "collect results after pool completes."

### Tune vs Submit

`Tune` updates `Cap` atomically. A `Submit` after `Tune` sees the new cap. A `Submit` concurrent with `Tune` may see either old or new cap — undefined but legal. The next `Submit` will see the new value.

### Release vs Submit

`Release` atomically sets the closed flag. After `Release` returns, all subsequent `Submit`s observe the flag and return `ErrPoolClosed`. Concurrent submits may see either state — race-correct.

### Running counter

`atomic.AddInt32(&running, 1)` and `atomic.AddInt32(&running, -1)` are paired. `atomic.LoadInt32(&running)` returns a consistent value at the moment of the load, though the value may be stale by the time you use it.

---

## Scheduler Interaction

The Go scheduler (GMP — goroutine, M=thread, P=processor) is what makes the pool work.

### Where the runtime's choices matter

- **Goroutine creation cost.** Each new worker is a `go func() {...}()`. The runtime allocates a `g` struct and a 2 KB stack. Across many spawns this adds up; `sync.Pool` reuse and the LIFO stack mitigate.
- **Channel send cost.** The hot path of `Submit` is a channel send. The runtime handles this via the channel's internal mutex and parking the receiver. For a 1-buffered channel with the receiver already parked on it, the send is fast (~50 ns).
- **Mutex parking.** When `pool.lock.Lock()` contends, the runtime parks the waiting goroutine. Parking is fast (~200 ns) and doesn't waste a thread.
- **`runtime.Gosched`.** `ants` doesn't call this. The runtime preempts goroutines (since 1.14) without explicit cooperation.

### `runtime.LockOSThread`

`ants` doesn't lock workers to OS threads. If your task needs OS thread locking (e.g., OpenGL contexts), do it explicitly inside the task:

```go
_ = pool.Submit(func() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	// ... thread-bound work ...
})
```

The worker will stay locked until the task finishes (and the defer runs). Subsequent tasks on that worker run on... well, the locked thread *until* the lock is released. Take care.

### NUMA awareness

Go doesn't expose NUMA. Workers run wherever the scheduler puts them. If you need NUMA-aware execution, you need explicit OS thread management, which doesn't fit `ants`'s model.

---

## Atomic Counters and Snapshots

`ants` exposes several counters: `Running`, `Free`, `Cap`, `Waiting`. All are atomic loads.

### Are the snapshots consistent?

A single call to `Running()` is atomic. Combining `Running()` and `Cap()` is not — they may be from different moments.

For diagnostics, this is fine. For correctness-critical decisions (e.g., admission), use the pool's own `Submit` semantics; don't try to second-guess from snapshots.

### Lock-free reads

All four counters are atomic loads — no lock taken. Good for high-frequency observation (e.g., a `/metrics` endpoint scraped 10 times/sec).

### Counter accuracy

Counters may briefly disagree:

- `Running` may be > `Cap` after `Tune` down (transient).
- `Free` may be negative briefly under heavy `Tune` contention.

Test code should not assume strict invariants. Production code should treat counters as advisory.

---

## Internal Diagnostics

`ants` is small enough to instrument. If you need detailed insight:

### Fork and add tracing

The library is BSD-licensed. Fork it, add `tracing.WithContext(ctx).Add("ants.submit")` lines, push the fork as a private module. Standard practice for libraries you depend on heavily.

### Use `pprof` for high-level

Run with `import _ "net/http/pprof"`. Inspect goroutine count, CPU time in `ants.*`, allocation in `ants.*`. If you see big numbers, you have something to investigate.

### Use the `runtime/trace` for low-level

`runtime/trace` captures scheduler events, goroutine spawning, channel send/recv. The pool's behaviour is visible.

### Custom counters

Wrap the pool with your own counters:

```go
type InstrumentedPool struct {
	p          *ants.Pool
	submitOK   int64
	submitDrop int64
}

func (i *InstrumentedPool) Submit(t func()) error {
	err := i.p.Submit(t)
	if err == nil {
		atomic.AddInt64(&i.submitOK, 1)
	} else {
		atomic.AddInt64(&i.submitDrop, 1)
	}
	return err
}
```

Lift to Prometheus via your standard pipeline.

---

## Performance Considerations

### Submit throughput on a single pool

With trivial tasks, a single `Pool` does ~5–10M submits/sec on a modern multicore machine. Beyond that, the lock contends. For higher throughput, use `MultiPool`.

### Memory per worker

A worker = 1 `goWorker` struct (~96 bytes) + 1 goroutine (stack of 2 KB minimum, grown as needed). So a pool of 10000 workers is at minimum 20 MB of stack memory.

### Memory per blocked submitter

Each blocked submitter is one goroutine (~2 KB stack). 1000 blocked = 2 MB.

### Memory per pool

A pool itself is roughly:

- 200 bytes of `Pool` struct.
- The worker stack: 8 bytes per slot * cap (so 80 KB for cap 10000).
- The `sync.Pool` cache: variable.
- The purger goroutine: 2 KB.

Total fixed cost: ~80 KB for a cap-10000 pool. Negligible.

### GC pressure

Allocations come from:

- `Submit(closure)` — the closure is allocated unless inlined.
- Argument structs passed to `Invoke` — allocated by caller.
- Internal `goWorker` structs — allocated on first spawn, reused via `sync.Pool`.

For zero-allocation submit, use `PoolWithFunc` + `sync.Pool` for argument structs.

### CPU cost of janitor

Per pool: one wakeup per `ExpiryDuration`. Each wakeup does an O(k) scan. For default 1 s expiry and a pool that doesn't accumulate expired workers, k = 0 — negligible. For pools with many expired workers (cycling pool), k can be larger, but still amortised fast.

---

## Edge Cases & Internal Pitfalls

### Edge 1 — Race between `Release` and `Submit`

`Submit` checks the closed flag, then proceeds. `Release` sets the flag. If `Release` runs between `Submit`'s check and its handoff to a worker, the worker may receive a task that won't run (if `Release` already woke that worker via poison pill). The task is dropped silently.

In practice: this race is rare and intentional — the cost of synchronising every `Submit` to handle this case is too high. `Submit` callers should know that submitting during shutdown is best-effort.

### Edge 2 — Worker stack and `Tune`

Tuning down doesn't kick workers off the stack. The stack may briefly contain more workers than `cap`. The next `retrieveWorker` will pop them normally; they continue running tasks (since they exist). Eventually they're killed by the purger or by exhaustion (running task, no work after).

### Edge 3 — Worker stack reuse across `WithPreAlloc` modes

You can't switch `PreAlloc` at runtime. The queue implementation is fixed at construction.

### Edge 4 — `sync.Pool` may not return your worker

The `workerCache` is a `sync.Pool`. GCs may drop items. `Get` may return a fresh object. This is benign — the only cost is occasional re-allocation.

### Edge 5 — Cond wake on closed pool

When `Release` broadcasts, blocked submitters wake. They see closed and return error. There's a window where the cond is being signalled and the closed flag check races. Code handles this defensively.

### Edge 6 — Worker channel buffer of 1

The channel is buffered (size 1) so `Submit` can always send without blocking the submitter. If the worker's previous task is still running, the new task waits in the buffer. This is the only "queue" inside the pool — exactly one slot per worker.

This means at any moment, the pool has up to `Cap` in-flight tasks plus `Cap` in-buffer tasks. Not strictly a queue in user-visible terms, but a buffer that exists.

### Edge 7 — Panic in `panicHandler`

In current versions, the worker's outer recover catches it. In older versions, it could escape and kill the goroutine. Always test your handler.

### Edge 8 — Lock-free path when running == cap exactly

If `running == cap`, the fast path fails (`retrieveWorker` returns nil from `detach` because no idle worker, and `running >= cap` so no new spawn). Falls through to the slow path (block or reject).

### Edge 9 — Race on `MultiPool.index`

The atomic counter monotonically increases. Even at very high rates, it doesn't wrap meaningfully (`uint32` wraps after ~4B calls — negligible for any real workload).

### Edge 10 — Janitor and `Release` ordering

If a task is mid-execution when `Release` is called, the worker continues. After the task, the worker returns to the idle stack. The next purger run (or `Release`'s own broadcast) picks it up. The worker exits cleanly.

---

## Source Walkthrough

A high-level reading of the key files in the repo (paths may vary by version).

### `pool.go`

The main `Pool` struct and methods. Constructors, `Submit`, `Release`, `Tune`. ~500 lines.

Key functions:

- `NewPool` — constructor.
- `Submit` — the main entry point.
- `retrieveWorker` — fast path / slow path logic.
- `revertWorker` — return a worker to the idle stack.
- `Tune`, `Release`, `ReleaseTimeout`.

### `pool_func.go`

The `PoolWithFunc` variant. Mirrors `pool.go` but for `Invoke(interface{})`.

### `worker.go`

The `goWorker` struct. `run`, `inputFunc` (the actual task channel send).

### `worker_func.go`

The `goWorkerWithFunc` variant.

### `worker_stack.go`

The default `workerStack` implementation. ~100 lines.

### `worker_loop_queue.go`

The `loopQueue` implementation for pre-alloc mode.

### `options.go`

The `Options` struct and all `WithXxx` functions. Each is short.

### `multipool.go`

The `MultiPool` struct, `LoadBalancingStrategy` interface, and the `RoundRobin` / `LeastTasks` implementations.

### `ants.go`

Package-level convenience: `ants.Submit` (uses a default global pool), `ants.Release`, sentinel errors.

Reading the source is a one-evening project. Recommended.

---

## Test

### Q1
Why is the worker stack LIFO?

**A.** Cache locality (most recent worker has hot caches) and efficient idle expiry (long-idle workers cluster at the bottom).

### Q2
What is the "fast path" of `Submit`?

**A.** The path that pops an idle worker via short mutex-protected operation and sends the task on the worker's channel. No goroutine creation, no waiting.

### Q3
What is the difference between `workerStack` and `loopQueue`?

**A.** `workerStack` uses a slice that grows as needed. `loopQueue` uses a fixed-size circular buffer (with `WithPreAlloc(true)`).

### Q4
How does `ReleaseTimeout` interrupt running tasks?

**A.** It does not. It waits for `Running` to drop to 0 or times out. Tasks complete normally — `Release` only kills idle workers.

### Q5
What is the role of `sync.Pool` in `ants`?

**A.** It caches `*goWorker` structs across spawn/exit cycles, avoiding repeated allocation.

### Q6
Why is the task channel of `goWorker` buffered with size 1?

**A.** So `Submit` can send without blocking even if the worker hasn't started receiving yet.

### Q7
What does the purger goroutine do?

**A.** Periodically scans the idle worker stack for expired workers and sends them poison pills.

### Q8
What is the difference between `RoundRobin` and `LeastTasks` in `MultiPool`?

**A.** `RoundRobin` increments a counter and picks `pools[counter % len]`. `LeastTasks` scans all shards and picks the one with the lowest `Running` count.

### Q9
Is `Submit` lock-free?

**A.** No, but the lock hold time is microscopic. The fast path is fast enough to be commonly described as "near lock-free."

### Q10
Why does the worker have a back-reference to the pool?

**A.** So it can call `revertWorker(self)` after finishing a task to return to the idle stack, and so it can read options like the panic handler.

### Q11
What happens to a worker that panics with the recover catching it?

**A.** The recover invokes the panic handler (or default logger). The recover then returns. The deferred `running--` and `workerCache.Put` run. The goroutine exits. A new worker may be spawned on the next submit.

Actually, this is a nuance — in many versions, after recover, the loop continues, not exits. Behaviour is version-dependent: some treat panics as worker-killing, others let the worker continue. The library's docs are explicit per version.

### Q12
Is the worker stack thread-safe?

**A.** The stack itself is not. It's protected by `pool.lock`. All access goes through the lock.

### Q13
Why might `Submit` be a hotspot in profiles?

**A.** Mainly the channel send to the worker's input channel. Subordinate: closure allocation and lock acquisition.

### Q14
What is the typical wake interval of the purger?

**A.** `ExpiryDuration` (or `ExpiryDuration / 10` in some versions). Default 1 s.

### Q15
Can two `goWorker`s share an input channel?

**A.** No. Each worker has its own channel. Sharing would require all workers to compete on receive, which the design explicitly avoids.

### Q16
What does `revertWorker` do?

**A.** Pushes the worker back onto the idle stack and signals the cond (waking one blocked submitter, if any). Returns false if the pool is closed.

### Q17
What is the difference between `MultiPool` and N separate `Pool`s?

**A.** `MultiPool` routes submits via a strategy. With N separate pools, you route manually. Functionally similar; `MultiPool` is convenience plus an opaque API.

### Q18
Is `Tune` synchronous on the cap update?

**A.** Yes. The atomic write of cap is immediate. The visible effect (workers stopping spawning or being made available) is also immediate. Only running workers don't disappear.

### Q19
Does `ants` use `runtime.Gosched`?

**A.** Not in the user-facing code paths. The runtime preempts goroutines automatically.

### Q20
What is the cost of a Submit when `running == cap` and `WithNonblocking(true)`?

**A.** Roughly: 1 atomic load (closed check), 1 lock acquire+release (to check stack), atomic compare with cap. Total: a few hundred ns. The path is short.

---

## Tricky Questions

### TQ1
**Q.** Why doesn't `ants` use `chan func()` directly, with N workers all receiving from one channel?

**A.** Because of the cond-wait semantics. With N receivers on one channel, `Submit` blocks until *some* receiver is ready. That's identical to a buffered channel of size N with closure for backpressure. But you lose flexibility — no per-worker timeouts, no fine control over which worker runs what (e.g., affinity), no LIFO behaviour, no expiry. The current design with one channel per worker enables those.

### TQ2
**Q.** Why isn't the worker stack a lock-free data structure (e.g., Treiber stack)?

**A.** Could be. Treiber stacks have ABA issues with `*goWorker` reuse via `sync.Pool` (since pointers can be re-used). The library uses a mutex-protected slice because it's simpler, fast enough, and doesn't have ABA. For massive contention, `MultiPool` shards better than any lock-free single stack would.

### TQ3
**Q.** Why does `Release` not kill running tasks?

**A.** Go has no goroutine cancellation primitive. Killing a goroutine is impossible. The only way is cooperative — the task must check a flag or context. `Release` doesn't pass such a signal; that's the user's job.

### TQ4
**Q.** Can a single `Submit` cause the pool to grow by more than 1?

**A.** No. Each `Submit` either picks an existing idle worker (no growth) or spawns one new worker (growth of 1). Never more.

### TQ5
**Q.** What if I `Submit` from the panic handler?

**A.** Tricky. You're inside a worker's deferred recover. The worker is about to exit. The pool may be closed. The `Submit` may succeed (different worker), may block (if pool is full), may error (if pool is closed). Generally don't.

### TQ6
**Q.** Is the worker stack sorted?

**A.** In `workerStack`, yes — by `lastUsed`. This enables binary search in `findExpired`. In `loopQueue`, sorted by insertion order (FIFO of insertion, but the LIFO of operation pops the most recent).

### TQ7
**Q.** What is the memory overhead of a 10000-worker pool with no submits?

**A.** ~80 KB for the stack slice, ~960 KB total if all 10000 workers were spawned (96 bytes each), but workers aren't spawned until submitted. With zero submits, just the Pool struct and the purger goroutine — ~5 KB.

### TQ8
**Q.** What happens if `running` becomes -1 due to a bug?

**A.** Shouldn't happen, but if it did, `Running()` returns the underlying int32 (could be huge as unsigned interpretation). Hopefully you have CI that catches this.

### TQ9
**Q.** Why are `Cap`, `Running`, etc. exposed but not the worker stack length?

**A.** The worker stack length is implementation-specific. Exposing it would lock the implementation. `Running` is a clean abstraction.

### TQ10
**Q.** Why is there no `Drain()` method that waits for tasks?

**A.** `ReleaseTimeout` is the closest equivalent. Adding `Drain()` (wait without closing) is feature creep — users can do `for pool.Running() > 0 { time.Sleep(...) }` or use a `WaitGroup` outside.

### TQ11
**Q.** Does `MultiPool` always have N purgers?

**A.** Yes — one per sub-pool. For very large `numPools`, that's many goroutines. Default expiry is 1 s, so wakes are not too frequent.

### TQ12
**Q.** Can I implement a custom `workerQueue`?

**A.** Yes — the interface is exported. Fork or wrap. Library authors do this for specialised workloads (e.g., priority-aware queues).

### TQ13
**Q.** What is the role of `cond.Signal` vs `cond.Broadcast`?

**A.** `Signal` on worker freeing (one waiter wakes). `Broadcast` on `Release` (all waiters wake to see closed flag).

### TQ14
**Q.** Why doesn't `ants` use channels for everything?

**A.** Could. Channels in Go have a per-operation cost (~50 ns). For a pool optimised for millions of ops/sec, sync primitives (mutex, cond) are slightly faster at low contention. The library mixes both.

### TQ15
**Q.** What if I want millions of pools?

**A.** That's a lot of purgers. Reduce by setting `WithDisablePurge(true)`. Or pool the pools (a meta-pool of pools, with idle pools recycled). At million-pool scale, you have bigger problems.

### TQ16
**Q.** Why is `MultiPool` not the default?

**A.** Single `Pool` is fast enough for almost everyone. `MultiPool` adds operational complexity (more purgers, less locality of worker reuse). Reach for it when measured.

### TQ17
**Q.** Are sub-pools of a `MultiPool` independent?

**A.** Yes. Each has its own state, lock, stack, purger. They're regular `Pool`s under the hood.

### TQ18
**Q.** What's the difference between `LoadBalancingStrategy` and a custom router function?

**A.** None functionally — the interface is just a function. Use a struct if you need state (e.g., consistent hash); use a closure for stateless strategies.

### TQ19
**Q.** Can the panic handler block?

**A.** Yes — but doing so blocks the worker (it's inside the recover deferred). Don't block in panic handlers.

### TQ20
**Q.** Why doesn't `ants` provide context-aware Submit?

**A.** Design choice. Adding `ctx` to `Submit` would either complicate the fast path (extra arg, more state) or split the API. The library punts to the user: thread your context through closures. Some users disagree with this choice.

---

## Self-Assessment Checklist

- [ ] Diagram the `Pool` struct's main fields from memory.
- [ ] Walk through `Submit` step by step, distinguishing fast and slow paths.
- [ ] Explain why the worker stack is LIFO.
- [ ] Explain what the purger does and how its interval is chosen.
- [ ] Distinguish `Pool` from `MultiPool` and explain when each is right.
- [ ] Describe the two `MGRR` strategies and their trade-offs.
- [ ] Trace `goWorker.run` from spawn to exit, including panic handling.
- [ ] Explain `sync.Pool` usage for `goWorker` reuse.
- [ ] Describe the cond-wait flow for blocked submitters.
- [ ] Argue for or against the choice of `sync.Mutex` over a spinlock in the pool.

---

## Summary

`ants` is a small, focused goroutine pool. Internally:

- A `Pool` holds: cap, running counter, an idle worker stack (LIFO), a mutex + cond for blocking, a `sync.Pool` cache of `goWorker` structs, and a purger goroutine.
- `Submit` has a fast path (pop idle worker, send task) and a slow path (block or reject).
- Workers are long-lived goroutines that loop reading from a 1-buffered task channel; they exit on poison pill.
- `sync.Pool` recycles `goWorker` structs across spawn/exit cycles.
- The purger periodically removes idle-expired workers.
- `MultiPool` shards across N sub-pools to reduce lock contention.
- `MGRR` strategies (RoundRobin, LeastTasks) pick a shard per submit.

You should now be able to read the `ants` source confidently. Production patterns and observability are in `professional.md`.

---

## Further Reading

- The `ants` repo source — `pool.go`, `worker.go`, `worker_stack.go`, `options.go`. One evening.
- Go memory model: <https://go.dev/ref/mem>
- `sync.Cond` GoDoc — <https://pkg.go.dev/sync#Cond>
- `sync.Pool` GoDoc — <https://pkg.go.dev/sync#Pool>
- "Concurrency patterns in Go" by Bryan Mills (GopherCon).

## Related Topics

- `02-sync-primitives` — `sync.Mutex`, `sync.Cond`, `sync.Pool`, the building blocks.
- `13-runtime-scheduler` — GMP and how it interacts with pooled goroutines.
- `16-goroutine-pools-stdlib` — a stdlib-only pool for comparison.
- `21-lock-free-techniques` — when and how to write lock-free code.

---

## Diagrams

### Diagram 1 — Pool layout

```
Pool {
  capacity:    int32 (atomic)
  running:     int32 (atomic)
  state:       int32 (atomic, 0=open 1=closed)
  waiting:     int32 (atomic)

  lock:        sync.Locker
  cond:        *sync.Cond

  workers:     workerQueue (idle stack, mutex-protected)
  workerCache: sync.Pool (recycled *goWorker)

  options:     *Options
  purgeCtx, purgeCancel
}
```

### Diagram 2 — Submit fast path

```
Submit(f):
  if state == CLOSED: return ErrPoolClosed
  lock.Lock()
  w = workers.pop()
  if w != nil:
    lock.Unlock()
    w.task <- f
    return nil
  ...
```

### Diagram 3 — Submit slow path

```
Submit(f):
  ... fast path failed ...
  if running < cap:
    lock.Unlock()
    w = workerCache.Get()
    w.run()  // spawn new goroutine
    w.task <- f
    return nil
  // at cap
  if nonblocking or waiting >= maxBlocking:
    lock.Unlock()
    return ErrPoolOverload
  waiting++
  cond.Wait()  // releases lock atomically
  waiting--
  ... retry ...
```

### Diagram 4 — goWorker lifecycle

```
worker.run:
  spawn goroutine:
    defer:
      recover (call panic handler)
      running--
      workerCache.Put(self)
    for f := range task:
      if f == nil: return
      f()
      if not revertToPool: return
```

### Diagram 5 — MultiPool layout

```
MultiPool {
  pools: [*Pool, *Pool, ..., *Pool]    // N shards
  index: uint32                         // round-robin counter (atomic)
  lbs:   LoadBalancingStrategy
}

Submit(f):
  idx = lbs.Pick(pools)
  return pools[idx].Submit(f)
```

### Diagram 6 — Purger flow

```
purgeStaleWorkers:
  ticker := NewTicker(ExpiryDuration)
  for:
    select case <-ticker.C: case <-closeCh: return
    if state == CLOSED: return
    lock.Lock()
    expired = workers.findExpired(ExpiryDuration)
    lock.Unlock()
    for w in expired: w.task <- nil
```

### Diagram 7 — Cond wake on revert

```
revertWorker(w):
  if state == CLOSED: return false
  lock.Lock()
  workers.push(w)
  cond.Signal()  // wake one blocked Submit
  lock.Unlock()
  return true
```

### Diagram 8 — Cap vs Running over time

```
       cap
         |--------------------------------
running  | /\___/\___/\___/_____/\_____
         |/
         +--------------------------------
                   t

Tune down at midpoint:
       cap
         |--/\
running  |    \____________________/\___
         +--------------------------------
```

After Tune down, running may briefly exceed cap until tasks finish.

### Deep Dive: Lock Implementation

The pool uses `sync.Locker`, an interface satisfied by `*sync.Mutex` and any custom locker. In some builds, `ants` swaps in a custom spinlock.

#### Why spinlock?

`sync.Mutex` is a hybrid: it tries a spin first, then parks. Parking involves the runtime scheduler — saving registers, blocking the goroutine, scheduling another. Cheap (~200 ns) but not zero.

A pure spinlock skips parking. It busy-spins on CAS until it acquires the lock. For very short critical sections at high contention, this can be faster — no scheduler involvement. For long sections or low contention, it wastes CPU.

The `ants` library has historically toggled between mutex and spinlock for benchmarking. Current default is `sync.Mutex` because:

- It handles long critical sections gracefully.
- It cooperates with the Go scheduler.
- The spinlock-win is mostly in synthetic benchmarks.

If you fork and care to optimise, the swap is trivial.

#### Spinlock sketch

```go
type spinLock uint32

func (sl *spinLock) Lock() {
	for !atomic.CompareAndSwapUint32((*uint32)(sl), 0, 1) {
		runtime.Gosched()
	}
}

func (sl *spinLock) Unlock() {
	atomic.StoreUint32((*uint32)(sl), 0)
}
```

`runtime.Gosched()` yields between spins to avoid starving other goroutines. Not strictly necessary but polite.

#### Mutex vs spinlock numbers

On modern x86:

- Mutex uncontended: ~15 ns lock+unlock.
- Spinlock uncontended: ~8 ns lock+unlock.
- Mutex with light contention: ~30 ns (one spin + park).
- Spinlock with light contention: ~15 ns (a few spins).
- Mutex with heavy contention: ~500 ns (park, schedule, wake).
- Spinlock with heavy contention: unbounded — burns CPU.

The library wisely defaults to mutex.

---

### Deep Dive: Channel Send Semantics

The hot path of `Submit` ends with `w.task <- f`. Let's see what this involves.

#### Channel internal structure

A Go channel is a struct with:

- A circular buffer (size 1 for `goWorker.task`).
- A mutex.
- Wait queues for senders and receivers.

#### Send on a 1-buffer channel

1. Acquire channel's mutex.
2. If buffer has room (the receiver hasn't picked up yet), copy `f` into the buffer, release mutex, return.
3. Else, there's a parked receiver — copy `f` directly to the receiver's stack frame, wake it, return.

The "direct copy" optimisation is one reason channel send is so fast in Go — no double-copy through the buffer.

#### Receive on the worker side

`for f := range w.task` is sugar for:

```go
for {
	f, ok := <-w.task
	if !ok { return }
	// use f
}
```

(Actually `range` for channels doesn't check `ok`; it exits when the channel is closed. `ants` never closes the channel — it uses nil as poison pill.)

The worker's receive blocks the goroutine on the channel's wait queue. The runtime parks it. When `Submit` sends, the runtime wakes it.

#### Why nil as poison pill?

`f` is `func()` — a nil value is legal and distinguishable from a valid task. Checking `if f == nil { return }` is cheap.

An alternative would be closing the channel. But closing breaks the `range` loop too — same effect. The library chose nil because:

- Closing requires all senders to coordinate (you can't send on a closed channel).
- Sending nil is a one-way action; no extra synchronisation.

---

### Deep Dive: The `running` Counter

This counter is more subtle than it looks.

#### What does `running` mean exactly?

The number of `goWorker` goroutines currently in existence. Includes:

- Workers actively executing tasks.
- Workers idle on the stack waiting for a task.
- Workers in transition (just popped, about to receive a task; or just pushed, about to be reused).

Does *not* include:

- Workers that have received their poison pill and are about to exit.
- Workers that exited via panic that wasn't caught.

#### When is it incremented?

In `w.run()` — at the very start, before the goroutine starts. This is *before* any task runs. Once the increment succeeds, the worker is committed to existing.

#### When is it decremented?

In the worker's deferred cleanup — after `recover` if any, before `workerCache.Put`. The decrement is atomic.

#### What if two `Submit`s race the increment?

The cap check is inside the lock:

```go
p.lock.Lock()
defer p.lock.Unlock()
if int(atomic.LoadInt32(&p.running)) < p.Cap() {
	atomic.AddInt32(&p.running, 1)
	spawn worker
}
```

The check-and-increment is atomic under the lock. Two `Submit`s race the lock, not the counter. Only one wins the increment.

#### Race window after lock release

After `lock.Unlock()`, the worker is being spawned. There's a tiny window where `running` has been incremented but the worker goroutine hasn't yet started — `Running()` reports the new value but no work is happening yet. This is intentional and benign.

---

### Deep Dive: `revertWorker`

Returning a worker to the idle stack. The function looks something like:

```go
func (p *Pool) revertWorker(w *goWorker) bool {
	if atomic.LoadInt32(&p.state) == CLOSED {
		return false
	}
	w.lastUsed = time.Now()
	p.lock.Lock()
	if atomic.LoadInt32(&p.state) == CLOSED {
		p.lock.Unlock()
		return false
	}
	p.workers.insert(w)
	p.cond.Signal()
	p.lock.Unlock()
	return true
}
```

Double-checked state: once before the lock (fast bail), once after. The lock'd check is the authoritative one.

If the function returns false, the caller (the worker's main loop) exits the goroutine.

#### Why signal after insert?

The wake-up needs to happen after the new idle worker is visible. Signal before insert would wake a submitter that then takes the lock, looks at the stack, finds nothing, and goes back to wait. Wasteful but not incorrect. Signal after insert is the natural ordering.

#### Why `Signal` not `Broadcast`?

Only one new slot of work was added, so only one waiter should wake. `Broadcast` would wake everyone, who would all contend for the single slot, with N-1 immediately going back to wait. Inefficient.

---

### Deep Dive: `Tune` Implementation

```go
func (p *Pool) Tune(size int) {
	if capacity := p.Cap(); capacity == -1 || size <= 0 || size == capacity {
		return
	}
	atomic.StoreInt32(&p.capacity, int32(size))
	if size > capacity {
		if size-capacity == 1 {
			p.cond.Signal()
			return
		}
		p.cond.Broadcast()
	}
}
```

(Approximate.)

What it does:

- Ignore no-op tunes (same size).
- Ignore the "unlimited" case (`-1`).
- Atomically store the new cap.
- If growing, wake some waiters (Signal for +1, Broadcast for bigger growth).

What it doesn't do:

- Wake workers that are already running.
- Push expired workers off the stack.
- Affect in-flight tasks.

The implicit assumption: callers tune in moderate increments. Tuning from 100 to 1 is legal but pointless — the running 100 workers continue.

---

### Deep Dive: `Release` Implementation

```go
func (p *Pool) Release() {
	if !atomic.CompareAndSwapInt32(&p.state, OPEN, CLOSED) {
		return // already closed
	}
	if p.purgeCancel != nil { p.purgeCancel() }
	<-p.purgeDone
	p.lock.Lock()
	p.workers.reset()
	p.lock.Unlock()
	p.cond.Broadcast()
}
```

Step by step:

1. Atomically flip state from OPEN to CLOSED. If already closed, return (idempotency).
2. Cancel the purger and wait for it.
3. Take the lock, reset the worker stack (sends nil to all idle workers, clears the stack).
4. Broadcast cond to wake all blocked submitters; they observe state=CLOSED and return error.

#### What `workers.reset()` actually does

Approximately:

```go
func (s *workerStack) reset() {
	for _, w := range s.items {
		w.task <- nil // poison pill
	}
	s.items = s.items[:0]
}
```

Each idle worker gets the poison pill. The worker's run loop receives nil, breaks the loop, runs the deferred cleanup, and exits.

#### What about in-flight workers?

They're not on the stack. They have their own task running. After their task, they call `revertWorker`, which returns false (state=CLOSED), so the worker exits.

#### What about blocked submitters?

The cond.Broadcast wakes them. Each rechecks the condition; sees state=CLOSED; returns `ErrPoolClosed`.

#### Race: submit during release

Possible. `Submit` checks state, then takes lock, then re-checks state inside the lock. If `Release` happens between the two checks, the submitter falls into the second check's CLOSED branch and returns error.

If `Release` happens after the second check but before the worker actually receives the task, the worker may receive a task it can't run (because it's about to exit). The task is silently dropped. This is a known race; the cost is task loss during shutdown, which most users accept.

---

### Deep Dive: `ReleaseTimeout`

```go
func (p *Pool) ReleaseTimeout(timeout time.Duration) error {
	p.Release()
	endTime := time.Now().Add(timeout)
	for time.Now().Before(endTime) {
		if p.Running() == 0 && p.Waiting() == 0 {
			return nil
		}
		time.Sleep(10 * time.Millisecond)
	}
	return ErrTimeout
}
```

Polling. Inelegant but simple. The polling interval (10 ms) is short enough for fast drains, long enough to not burn CPU.

A more sophisticated implementation would use a `done` channel signalled when the last worker exits. The library chose polling because it's simpler and the cost is small (only during shutdown).

---

### Deep Dive: `goWorker.run` in Detail

Let's look at the worker's run loop more closely.

```go
func (w *goWorker) run() {
	atomic.AddInt32(&w.pool.running, 1)
	go func() {
		defer func() {
			if w.pool.addRunning(-1) == 0 && w.pool.IsClosed() {
				w.pool.once.Do(func() { close(w.pool.allDone) })
			}
			w.pool.workerCache.Put(w)
			if r := recover(); r != nil {
				h := w.pool.options.PanicHandler
				if h != nil {
					h(r)
				} else {
					w.pool.options.Logger.Printf("worker recovered: %v\n%s", r, debug.Stack())
				}
			}
			w.pool.cond.Signal()
		}()
		for f := range w.task {
			if f == nil { return }
			f()
			if ok := w.pool.revertWorker(w); !ok { return }
		}
	}()
}
```

Key points:

- Increment outside the spawned goroutine, before the spawn. Ensures `running` is correct even if the spawn hasn't run yet.
- Deferred cleanup decrements, returns struct to cache, signals cond.
- Recover catches panics. The handler may be custom or default.
- The loop reads tasks; nil is poison pill.
- `revertWorker(w)` after each task. If it returns false, exit.

#### Why is recover *inside* the deferred?

`recover()` only works inside a deferred function. The defer is the standard idiom.

#### Why signal cond on exit?

A worker exiting frees no slot — `running` is decremented, so future submits will find more slack. But the cond signal is still useful because submitters waiting on the cond may now spawn a new worker.

#### Why `once.Do(close(allDone))`?

If `ReleaseTimeout` is sophisticated enough to use a channel-based done signal instead of polling, the worker signals it on the final exit. The `once.Do` ensures the channel is closed only once.

---

### Deep Dive: `PoolWithFunc` Differences

`PoolWithFunc` mirrors `Pool` but with an argument channel.

```go
type PoolWithFunc struct {
	// ... same fields as Pool ...
	poolFunc func(interface{})
}

type goWorkerWithFunc struct {
	pool *PoolWithFunc
	arg  chan interface{}
	lastUsed time.Time
}

func (w *goWorkerWithFunc) run() {
	atomic.AddInt32(&w.pool.running, 1)
	go func() {
		defer /* ... */
		for arg := range w.arg {
			if arg == nil { return }
			w.pool.poolFunc(arg)
			w.pool.revertWorker(w)
		}
	}()
}
```

Differences:

- Channel of `interface{}` not `func()`.
- The function is stored on the pool, not sent per task.
- `Invoke(arg)` is the entry point.

#### Why a separate struct?

To avoid runtime type checks. The `goWorker` for `Pool` only knows how to run `func()`. The `goWorkerWithFunc` only knows how to run `poolFunc(arg)`. Sharing one struct would mean a runtime branch on every task — slow.

#### Memory difference

`*goWorker`: ~96 bytes.
`*goWorkerWithFunc`: ~96 bytes (almost identical).

Practically the same. The difference is in per-task cost: `Pool` allocates a closure each Submit; `PoolWithFunc` does not.

---

### Deep Dive: `MultiPool` Implementation

```go
type MultiPool struct {
	pools []*Pool
	index uint32
	lbs   LoadBalancingStrategy
}

func NewMultiPool(numPools, sizePerPool int, lbs LoadBalancingStrategy, opts ...Option) (*MultiPool, error) {
	pools := make([]*Pool, numPools)
	for i := range pools {
		p, err := NewPool(sizePerPool, opts...)
		if err != nil { return nil, err }
		pools[i] = p
	}
	return &MultiPool{pools: pools, lbs: lbs}, nil
}

func (mp *MultiPool) Submit(task func()) error {
	return mp.next().Submit(task)
}

func (mp *MultiPool) next() *Pool {
	switch mp.lbs {
	case RoundRobin:
		idx := atomic.AddUint32(&mp.index, 1) - 1
		return mp.pools[int(idx)%len(mp.pools)]
	case LeastTasks:
		best := mp.pools[0]
		for _, p := range mp.pools[1:] {
			if p.Running() < best.Running() {
				best = p
			}
		}
		return best
	}
	return mp.pools[0]
}
```

Notice:

- Each sub-pool is a regular `Pool` with the same options.
- The strategy is selected at construction; can't change at runtime.
- `next()` is called per `Submit`. For `LeastTasks`, this is O(N).

#### MultiPool aggregate methods

```go
func (mp *MultiPool) Running() int {
	total := 0
	for _, p := range mp.pools {
		total += p.Running()
	}
	return total
}
```

Same for `Free`, `Cap`, `Waiting`. Summed across sub-pools.

#### Tune on MultiPool

Some versions support per-pool tune via index; others tune all uniformly. Check docs.

---

### Deep Dive: Concurrency Hazards

Let me catalogue the subtle concurrency hazards in the implementation.

#### Hazard 1 — Submit during Release

Already covered. Workaround: producers should coordinate with shutdown.

#### Hazard 2 — Tune during Submit

`Tune` updates cap atomically. A concurrent `Submit` may observe old or new cap, both legal. The next `Submit` sees the new value.

#### Hazard 3 — Worker self-modifying

A worker's task could `Submit` more tasks, call `Tune`, or `Release`. All legal but smelly. `Release` from inside a task is genuinely buggy — likely deadlock.

#### Hazard 4 — `sync.Pool` Put after Release

A worker exiting after `Release` calls `workerCache.Put(w)`. Legal: the `sync.Pool` is per-Pool, but the cache is still valid. The struct may or may not be reused — depends on GC timing.

#### Hazard 5 — Pool dropped before all workers exit

If the user drops their pool pointer mid-shutdown, GC may want to collect the pool struct. But workers reference it via `w.pool`. As long as workers exist, the pool stays alive.

After all workers exit, the pool is GC-eligible. Cleanup is automatic.

#### Hazard 6 — Cond signal after Release

`revertWorker` signals the cond after pushing the worker. If `Release` runs after the push but before the signal, the cond may be signalled on a closed pool. Harmless — submitters wake, see closed, return error.

#### Hazard 7 — Purger race with Submit

The purger pops expired workers. A concurrent `Submit` tries to pop too. Both go through the lock, so the race is serialised — no two goroutines pop the same worker.

#### Hazard 8 — Worker channel send during exit

If a Submit hands off a task to a worker that's about to exit (race), the task ends up in the buffered channel and is never executed. Acceptable loss during shutdown; not acceptable in steady state. Library tries to avoid this with state checks.

#### Hazard 9 — Time.Now() and lastUsed

The purger compares `time.Now()` minus `ExpiryDuration` with worker `lastUsed`. Monotonic time is used implicitly via `time.Time` arithmetic. No clock skew issues.

#### Hazard 10 — Memory barrier ordering

All field updates use either atomic or lock-protected access. Go's memory model guarantees happens-before across these. No need for explicit fences.

---

### Deep Dive: How `ants` Avoids the Common Pool Pitfalls

Classic thread pool implementations have well-known pitfalls. `ants` avoids them as follows:

#### Pitfall: lost wake-ups

If a worker frees up just as a submitter is about to wait, the submitter might miss the signal. `sync.Cond.Wait` is designed to handle this — re-check the condition after wake, and the lock acquisition pairs naturally. `ants` re-checks, so no lost wakes.

#### Pitfall: thundering herd

When many submitters are waiting and one slot frees, ideally one wakes. `cond.Signal` does this. `cond.Broadcast` (used on Release) wakes all, but they all see closed and return — no thundering herd.

#### Pitfall: priority inversion

A high-priority producer waiting behind a low-priority producer. `ants` has no priority, so no inversion. If you need priority, build it externally.

#### Pitfall: dead worker

A worker that's stuck in an infinite task. `ants` can't help here — Go has no goroutine cancellation. The worker is "lost" to the pool. Mitigation: tasks must self-time-out.

#### Pitfall: leaked workers

Without `Release`, workers leak. `ants` has the purger to mitigate idle leaks, but `Release` is still required to fully drain.

#### Pitfall: tasks running after shutdown

`Release` doesn't kill running tasks. If your tasks ignore the world, they run forever. `ReleaseTimeout` gives a deadline.

#### Pitfall: ABA on stack pointers

With `sync.Pool` reusing `*goWorker`, ABA is theoretically possible (a popped pointer is reused before a competing CAS notices). `ants` avoids this by using a mutex-protected stack, not lock-free CAS. The mutex serialises everything.

---

### Deep Dive: Optimisations the Library Chose Not to Make

A few things the library could do but doesn't.

#### Lock-free worker stack (Treiber)

Could replace the mutex+slice with a CAS-based linked list. Would be faster at high contention. Doesn't, because:

- Mutex is fast enough.
- ABA with `sync.Pool` reuse is awkward.
- Simpler code is easier to maintain.

#### Per-CPU sharding

Each goroutine has a hint of its `P` (the runtime processor). Some libraries use this for per-P sharding. `MultiPool` is a coarse alternative; per-P would be finer but more complex.

#### Adaptive sizing

A pool that automatically tunes itself based on queue depth. Possible but invasive. Users can build it on top with `Tune`.

#### Work stealing across workers

Workers don't steal work from each other (no queues to steal from). The design is single-queue (just the cond wait queue of submitters). Work stealing would require a different model.

#### Pre-allocated stack

The `WithPreAlloc` option is one form. A more aggressive optimisation would pre-spawn all workers at construction. Not done because most pools rarely reach full capacity; pre-spawning wastes memory.

---

### Deep Dive: When the Pool's Choices Break Down

Real workloads where `ants`'s defaults are suboptimal:

#### Workload 1 — Latency-sensitive with strict ordering

Pool doesn't order tasks. Submitting A then B doesn't guarantee A runs first. For strict ordering, use cap=1 or build a serialiser.

#### Workload 2 — Mixed-priority tasks

No priority. Either separate pools per priority, or sort outside.

#### Workload 3 — Very short tasks (sub-microsecond)

Submit overhead dominates. Plain `go f()` is faster (paradoxically — pool is hot path overhead). The pool's overhead matters when tasks take less time than ~1 µs.

#### Workload 4 — Very long tasks (minutes)

Pool gives nothing. Spawn cost is irrelevant. Use plain goroutines + context.

#### Workload 5 — Memory-bound tasks

If each task uses 100 MB of memory, pool size 100 is 10 GB. Pool doesn't account for this. You need a different bound (semaphore on memory).

#### Workload 6 — Tasks with stack growth

Some tasks recurse deeply. The first task on a worker grows the stack to (say) 64 KB. Subsequent tasks have a 64 KB stack. The worker keeps the bigger stack forever. Over time, pool memory grows. Mitigation: shorter expiry to recycle workers.

---

### Deep Dive: How to Modify `ants`

If you fork the library:

#### Goal: Add per-task timeout

Wrap the task in a goroutine + select. Each Submit creates a context with deadline. Inside the wrapped task, use `select` with `time.After`. Not free — adds a goroutine per task — but possible.

#### Goal: Add priority

Replace the single cond with multiple conds, one per priority. Signal the highest-priority one with a waiter on a free slot.

#### Goal: Add metrics

Expose hooks: `OnSubmit`, `OnTaskStart`, `OnTaskEnd`. Each hook is a function called by the pool at the relevant moment. Trivial to add; would benefit observability.

#### Goal: Replace the queue

Implement your own `workerQueue` (if exported). Plug it via an option. Library authors do this for specialised use cases.

---

## More Test Questions

### Q21
What's the difference between `cond.Signal` and `cond.Broadcast`?

**A.** `Signal` wakes one waiter; `Broadcast` wakes all. `ants` uses `Signal` per freed slot and `Broadcast` on `Release` (to wake all so they see closed).

### Q22
Why is `ReleaseTimeout` implemented with polling?

**A.** Simplicity. A channel-based signal would require a hook in every worker exit path. Polling is uglier but contained.

### Q23
Why is the worker stack mutex-protected instead of lock-free?

**A.** ABA hazard with `sync.Pool` reuse. Mutex is fast enough. Simpler maintenance.

### Q24
What happens if `revertWorker` returns false?

**A.** The calling worker exits its run loop. The deferred cleanup runs (decrement `running`, return struct to cache, signal cond).

### Q25
Why does `Tune` call `cond.Broadcast` when growing significantly?

**A.** To wake many submitters at once. A bigger growth means multiple slots opened, multiple waiters can proceed.

### Q26
Can the purger and a worker simultaneously try to pop the same idle worker?

**A.** No. Both go through `pool.lock`. The lock serialises access. Only one wins per acquisition.

### Q27
How does `MultiPool` aggregate `Cap`?

**A.** Sum of sub-pool caps. Reported as the total.

### Q28
Why does `goWorker.run` use a defer for cleanup?

**A.** So cleanup runs even on panic. `defer` is the standard idiom for "must run on exit."

### Q29
What is `w.lastUsed`?

**A.** The time when the worker last finished a task. Used by the purger to determine expiry.

### Q30
Why is the worker channel buffered with exactly 1?

**A.** So Submit can send a task to an idle-or-soon-to-be-idle worker without blocking. The buffer holds the pending task until the worker is ready to receive.

### Q31
What does the library do on first `Submit` to an empty pool?

**A.** Fast path fails (no idle worker). Falls to "spawn new worker" branch. Increments `running`, calls `workerCache.Get` (or new), runs `goWorker.run`, sends the task.

### Q32
Why use `atomic.LoadInt32(&p.state)` instead of `p.state`?

**A.** To ensure memory ordering. Without atomic, a stale value might be observed. Atomic load establishes happens-before with any atomic store.

### Q33
What's the role of `sync.Once` in pool teardown?

**A.** To close the `allDone` channel exactly once. Multiple workers might race to close it; `Once` prevents duplicates.

### Q34
Can a single `Submit` cause `running` to grow by more than 1?

**A.** No. Each `Submit` spawns at most one worker.

### Q35
What is the asymptotic complexity of `findExpired`?

**A.** O(log n) for the binary search in `workerStack` (since sorted by `lastUsed`), plus O(k) to copy out the k expired workers. Total O(log n + k).

### Q36
What if a worker panics inside the recover handler?

**A.** Version-dependent. Modern versions have a second recover or fail gracefully. Older versions might kill the goroutine. Always test your handler.

### Q37
Why does `ants` not have a `Drain` method?

**A.** `ReleaseTimeout` covers the use case. Adding `Drain` (drain without close) is feature creep — users can poll `Running`.

### Q38
How does `MultiPool` handle uneven sub-pool sizes?

**A.** Sub-pools are all the same size at construction. Per-pool tune may diverge them.

### Q39
What is the maximum sane `numPools` for `MultiPool`?

**A.** Practically, ~1000. Beyond that, the meta-overhead of N purgers dominates.

### Q40
Can two `MultiPool`s share sub-pools?

**A.** Not by the standard API. You'd construct each `MultiPool` with its own sub-pools.

---

## More Tricky Questions

### TQ21
**Q.** I'm benchmarking a single-pool 100k submit/sec workload. CPU profile shows ~20% in `runtime.mutex_lock`. Is this fixable?

**A.** Likely yes. Try `MultiPool` with 4 shards. The lock should split. If 20% stays roughly proportional (per sub-pool), the lock isn't the bottleneck — your tasks are.

### TQ22
**Q.** My pool's `Running()` slowly grows over hours without my submitting more work. What's happening?

**A.** Likely workers panicking and not being recovered properly. Or tasks blocking forever. Inspect goroutine dumps; look for stuck workers.

### TQ23
**Q.** I have a pool with `WithDisablePurge(true)` and `WithExpiryDuration(...)`. Which wins?

**A.** `DisablePurge`. The purger isn't started, so `ExpiryDuration` is irrelevant.

### TQ24
**Q.** I want to know which worker ran my task (for affinity tracking). Possible?

**A.** Not via the public API. You'd have to wrap each worker via a custom queue and tag it. Probably not worth the complexity.

### TQ25
**Q.** Can a goroutine running outside the pool call `pool.Tune` safely?

**A.** Yes. `Tune` is goroutine-safe.

### TQ26
**Q.** Does `Submit` allocate?

**A.** Yes — the closure escape-analysis usually shows it. With `PoolWithFunc.Invoke`, the per-call allocation is gone (but argument allocation depends on you).

### TQ27
**Q.** What if `ExpiryDuration` is set to a value smaller than a typical task duration?

**A.** Tasks run normally. The expiry is for *idle* workers, not running ones. The setting effectively doesn't matter for always-busy pools.

### TQ28
**Q.** Two `MultiPool`s with overlapping options. Do they conflict?

**A.** No. Each is independent. Their sub-pools are independent. No shared state.

### TQ29
**Q.** Does the cond wait queue use any heap allocation?

**A.** Inside `sync.Cond`, each waiting goroutine attaches a sudog (runtime-managed). It's not user-heap; it's runtime state. Cost is minimal.

### TQ30
**Q.** Why doesn't `Submit` return a `Future` like Java?

**A.** Go's idiom is channels and `WaitGroup`s. A `Future` type would be ad-hoc. The library punts to user code to build it if needed.

### TQ31
**Q.** Can I replace `sync.Pool` cache with my own?

**A.** Not via the public API. Fork required.

### TQ32
**Q.** Is `MultiPool.Submit` faster than `Pool.Submit`?

**A.** Per-call, it's slightly slower (the lbs adds work). Under massive contention, total throughput is higher because the per-sub-pool lock contention is lower. Measure with realistic load.

### TQ33
**Q.** Why does `MultiPool` not pre-spawn its sub-pools' workers?

**A.** Same reason `Pool` doesn't — workers are lazy. The first submit per sub-pool spawns.

### TQ34
**Q.** What's the cost of `Running()` on `MultiPool`?

**A.** Sum of N atomic loads. O(N). For small N, negligible.

### TQ35
**Q.** Can the panic handler be set per-task?

**A.** Not directly. Set it on the pool. To customise per-task, wrap your task in a closure that has its own recover.

---

## Advanced Topics

### Topic 1 — Custom workerQueue

Some teams build their own queue (e.g., a priority queue, a per-shard queue). The `workerQueue` interface is exported in some versions:

```go
type workerQueue interface {
	insert(worker)
	detach() worker
	refresh(duration time.Duration) []worker
	reset()
	len() int
	isEmpty() bool
}
```

Implement it, then... well, you can't plug it in via the public API of `ants` v2. This is private. To use, fork.

Real production code rarely needs this — `workerStack` and `loopQueue` cover almost every case.

### Topic 2 — Custom LoadBalancingStrategy

For `MultiPool`, this is sometimes exposed:

```go
type LoadBalancingStrategy int

const (
	RoundRobin LoadBalancingStrategy = iota
	LeastTasks
)
```

Just two values. Extending requires fork. If you need affinity-based, hash-based, or rendezvous routing, fork or write your own wrapper.

### Topic 3 — Goroutine local storage

Go doesn't have GLS. If your tasks need per-worker state (like a connection), you have options:

- **Per-task allocation.** Allocate on each task. Slow.
- **`PoolWithFunc` with struct argument.** Pre-allocate, send via Invoke.
- **`sync.Pool`-cached state.** Get on task entry, Put on exit.
- **Fork `ants` to add per-worker fields.** Heaviest but most flexible.

### Topic 4 — Cross-pool back-pressure

If your producer feeds multiple pools, you may want global back-pressure. Approaches:

- A `chan struct{}` of capacity N acquired before any pool submit; released after.
- A semaphore (`golang.org/x/sync/semaphore`) shared across producers.
- A separate "admission" pool of cap N gating all real work.

Each adds latency but enforces global bounds.

### Topic 5 — Hot-swappable pool

Atomically swap one pool for another (e.g., on configuration reload that can't be expressed as `Tune`):

```go
type PoolHolder struct {
	mu sync.RWMutex
	p  *ants.Pool
}

func (h *PoolHolder) Submit(t func()) error {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.p.Submit(t)
}

func (h *PoolHolder) Swap(newP *ants.Pool) {
	h.mu.Lock()
	old := h.p
	h.p = newP
	h.mu.Unlock()
	go old.ReleaseTimeout(30 * time.Second)
}
```

Background-release the old pool after swap.

### Topic 6 — Test harness for pool behaviour

To test code that uses `ants`:

- Inject a fake pool that just runs everything inline.
- Or use a real pool with small cap and observe behaviour.

```go
type Submitter interface { Submit(func()) error }

type inlineSubmitter struct{}
func (inlineSubmitter) Submit(f func()) error { f(); return nil }
```

Pass `inlineSubmitter{}` in tests for synchronous behaviour. Pass `*ants.Pool` in production.

### Topic 7 — Worker count vs goroutine count

`runtime.NumGoroutine()` counts *all* goroutines, including:

- Workers (Running count).
- Idle workers on stack.
- Purger goroutines.
- Blocked submitters.

So `NumGoroutine > Running` is normal. Don't confuse them.

### Topic 8 — Stack size of workers

Each worker starts with ~2 KB stack. Tasks may grow it (recursive code, large local frames). Once grown, the stack stays at that size (Go shrinks stacks lazily, but in practice the steady-state stack of a worker reflects the largest task it has run).

For pools that run very different tasks (some recursive, some not), the workers' stacks are sized for the worst case. Mitigation: separate pools per task type.

---

## Real Implementation Reading Tips

When you read the actual `ants` source:

1. **Start with `ants.go`.** Look at the exported API. Trace `NewPool` and `Submit`.
2. **Read `options.go`.** All the options are short.
3. **Read `pool.go`.** The main type. `Submit`, `retrieveWorker`, `revertWorker`.
4. **Read `worker.go`.** The worker loop.
5. **Read `worker_stack.go`.** The slice-based queue.
6. **Read `multipool.go`.** Wraps pool.

Skip on first reading:

- `worker_loop_queue.go` (pre-alloc variant).
- `pool_func.go` (mirrors `pool.go`).
- Tests (large but useful as examples).

Read with a debugger or print statements:

```go
log.Printf("retrieveWorker: idle=%d running=%d cap=%d",
	len(p.workers), p.Running(), p.Cap())
```

Inserted into a fork, you'll see exactly what each path does.

---

## Final Self-Assessment

- [ ] Can you draw the worker stack and explain LIFO?
- [ ] Can you explain the lock-free fast path of `Submit`?
- [ ] Do you know what the purger does and when?
- [ ] Can you trace a worker from spawn through panic-recover through exit?
- [ ] Can you explain when to choose `Pool` vs `MultiPool`?
- [ ] Can you compare `RoundRobin` and `LeastTasks` and pick the right one?
- [ ] Can you explain why `Release` doesn't kill running tasks?
- [ ] Can you list 3 hazards of concurrent submit/release?
- [ ] Can you predict the throughput of a pool given task duration and capacity?
- [ ] Can you read the `ants` source without external help?

If you can do all of those, you have a senior-level understanding of `ants`. Onward to `professional.md` for production deployment.

---

## Appendix — Benchmark Anatomy

The `ants` repo includes benchmarks. Reading them teaches you what to measure.

### Benchmark structure

A typical `ants` benchmark:

```go
func BenchmarkPoolSubmit(b *testing.B) {
	pool, _ := ants.NewPool(50000)
	defer pool.Release()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = pool.Submit(func() {})
	}
	b.StopTimer()
	// drain
}
```

`b.N` is the iteration count, scaled by the framework. The benchmark reports ns/op and allocations.

### Comparing baselines

The library compares:

- `BenchmarkGoroutines` — plain `go f()` baseline.
- `BenchmarkSemaphore` — `golang.org/x/sync/semaphore` baseline.
- `BenchmarkAntsPool` — `Pool.Submit`.
- `BenchmarkAntsPoolWithFunc` — `PoolWithFunc.Invoke`.
- `BenchmarkAntsMultiPool` — `MultiPool.Submit`.

On a 10-task workload at 10 µs per task:

- Goroutines: ~3-5x lower throughput in steady-state due to allocation.
- Semaphore: same as goroutines, plus semaphore overhead.
- Pool: peak throughput.
- PoolWithFunc: 10-20% above Pool.
- MultiPool: similar to Pool at low contention, much higher at high contention.

### Things to measure

When benchmarking your own use of `ants`, capture:

- **Throughput (ops/sec).** Tasks completed per second.
- **Submit latency (ns/op).** Per-submit cost. Use `time.Now()`/`time.Since`.
- **GC time.** From `runtime.MemStats.PauseTotalNs`.
- **Allocations per op (alloc/op).** From the framework.
- **Heap size.** Steady-state and peak.
- **Goroutine count.** Steady-state and peak.

### Don't benchmark in isolation

Trivial-task throughput numbers are misleading. Real tasks have:

- I/O — dominates everything; pool overhead invisible.
- Allocations — affects GC; possibly large factor.
- Locks — contention varies with workload.
- Cache effects — hot data fits in L1; cold data doesn't.

Always benchmark with workloads representative of your production tasks.

---

## Appendix — Reading the goWorker Lifecycle Once More

To make the lifecycle absolutely clear, here's a detailed step-by-step.

### Step 1 — Construction

A `goWorker` may be constructed:

- Fresh: `&goWorker{pool: p, task: make(chan func(), 1)}`.
- Recycled: `p.workerCache.Get().(*goWorker)` — fields are reset.

### Step 2 — `run()` called

Increment `p.running` atomically. Spawn the goroutine. Inside:

```go
defer cleanup()
for f := range w.task {
	if f == nil { return }
	f()
	if !w.pool.revertWorker(w) { return }
}
```

### Step 3 — First task

`Submit` sends `f` on `w.task`. The for-range receives. Runs `f`.

### Step 4 — `f` completes

`revertWorker(w)` is called. It:

1. Updates `w.lastUsed = time.Now()`.
2. Locks the pool.
3. Pushes `w` onto the worker stack.
4. Signals the cond.
5. Unlocks.

If the pool is closed, returns false. Otherwise true.

### Step 5 — Wait for next task

Loop back to `for f := range w.task`. Worker is on the idle stack. Eventually:

- A new `Submit` pops `w`, sends a task on `w.task` — worker wakes, runs it.
- Or the purger sends nil — worker exits via the `if f == nil { return }`.

### Step 6 — Exit

Either path leads to the deferred cleanup:

1. Recover from panic (if any).
2. Decrement `p.running`.
3. Signal cond (in case waiters can now spawn).
4. Put `w` back to `workerCache`.
5. Maybe close `allDone` if last worker.

The goroutine ends. The `g` struct is reclaimed by the runtime.

### Step 7 — Recycle

When a future `Submit` needs to spawn a worker, `workerCache.Get()` may return the recycled struct. Or it may return a fresh one (if the cache discarded it).

---

## Appendix — Variant Behaviours Across Versions

`ants` has had several minor versions. Selected behavioural differences:

- **v2.0** — initial v2 release. Functional options.
- **v2.4** — `MultiPool` introduced.
- **v2.5** — `ReleaseTimeout` added.
- **v2.7** — improved purger; `WithDisablePurge`.
- **v2.9** — performance optimisations to the worker stack.
- **v2.10** — generics-aware `PoolWithFunc`.

Specific bugs fixed across versions:

- A race in `Tune` down causing `running` to underflow (fixed pre-2.7).
- An edge in `Release` where a task in the buffer was dropped silently (improved 2.8+).
- A leak when the panic handler itself panicked (fixed via outer recover).

When debugging an unusual issue, check your version against the changelog.

---

## Appendix — Pool Reading Recipe

If you're handed a Go service that uses `ants` and asked "is this OK?", check:

1. **Is `Release` deferred?** Search for `defer pool.Release()` matching every `NewPool`.
2. **Is `Submit`'s error handled?** Grep for `pool.Submit(` and see if the return value is consumed.
3. **Is a panic handler installed?** Look for `WithPanicHandler`.
4. **Are tasks context-aware?** Tasks should select on context.Done somewhere.
5. **Is the pool sized correctly?** Cap should reflect downstream capacity. Read comments.
6. **Are loop variables captured correctly?** `for _, x := range xs { x := x; _ = pool.Submit(...) }`.
7. **Is the pool global or per-service?** Avoid globals in services.
8. **Is `Tune` called from inside tasks?** Almost always a smell.
9. **Is `MultiPool` used?** If so, why? Measured contention?
10. **Are there per-tenant pools?** Each pool should be sized appropriately.

Each of these can be a question in a code review.

---

## Appendix — Common Source-Reading Mistakes

When you read the `ants` source for the first time, beware:

### Mistake 1 — Mistaking `running` for "active workers"

`running` counts all workers that exist as goroutines, including idle ones on the stack. Don't confuse with "active" (executing a task).

### Mistake 2 — Misreading the LIFO semantics

The stack pops from the *end* of the slice (LIFO). Pushes go to the end. Don't confuse with FIFO (which would pop from the head).

### Mistake 3 — Thinking the channel is a task queue

The worker's task channel is for that *one* worker only. It's not a shared queue. Each worker has its own.

### Mistake 4 — Assuming `Release` interrupts tasks

It does not. Read `Release` and `revertWorker` together to see this.

### Mistake 5 — Confusing `waiting` with `running`

`waiting` is the count of blocked submitters. `running` is workers. Different things.

### Mistake 6 — Thinking the purger has a queue

The purger looks at the worker stack directly. No queue. It iterates expired workers and sends each a poison pill.

### Mistake 7 — Believing `Tune` is preemptive

It updates cap but doesn't kick workers. New submits respect the new cap; existing workers continue.

### Mistake 8 — Missing the `sync.Pool` cache

The `workerCache` field is easy to miss. Without understanding it, the worker-allocation path is confusing.

---

## Appendix — Where the Lock Lives

Some readers wonder "is the channel send under the lock?"

Tracing through the fast path:

```go
p.lock.Lock()
w := p.workers.detach()
p.lock.Unlock()
w.task <- f  // OUTSIDE the lock
```

The lock holds only for the slice pop. The channel send is unlocked. This is crucial — the lock hold time is sub-microsecond.

If the channel send were inside the lock, a slow receiver (worker that hasn't gotten back to its receive yet) would block the lock holder. Disaster.

Outside the lock, the send blocks only the submitting goroutine, not the pool's lock.

---

## Appendix — Pool Resizing Math

If you `Tune` the pool, what is the steady-state behaviour?

Let:
- `λ` = arrival rate (tasks/sec).
- `μ` = service rate per worker (= 1 / avg task duration).
- `C` = capacity.

Steady state requires `λ ≤ C * μ`. If not, the pool overflows (blocking → infinite queue, or non-blocking → drops).

If `λ < C * μ`:
- Utilisation = `λ / (C * μ)`.
- Average busy workers = `λ / μ` (Little's Law).
- Pool is fine.

If `λ > C * μ`:
- Pool is overloaded.
- Either `Submit` blocks (and producer queue grows) or rejects (and tasks are lost).

`Tune` is the lever to control `C` to keep utilisation in a healthy range. Target ~70–80% — leaves headroom for jitter but not too much waste.

### Example

Tasks take 10 ms (μ = 100 ops/sec/worker). Arrival rate = 5000 ops/sec. Required C: `5000 / 100 = 50` workers minimum. Practical: 60-70 to handle bursts.

---

## Appendix — When the Pool Hits the Network

For I/O-bound tasks, the pool's behaviour interacts with network limits.

### Outbound HTTP

If your pool of 1000 workers all make HTTP requests, you have 1000 simultaneous TCP connections. Check:

- Server's max connections (e.g., Nginx `worker_connections`).
- Client's connection pool size (`http.Transport.MaxIdleConnsPerHost`).
- OS file descriptor limit (`ulimit -n`).

The pool itself doesn't enforce a connection limit. Add a `MaxIdleConnsPerHost` setting on `http.Transport`.

### DNS

DNS resolutions are not pooled by default. 1000 simultaneous DNS lookups can flood your resolver. Use `Resolver` with a `LookupHost` cache, or pin to specific IPs.

### Connection pools per-service

For RPC services, the standard approach is one client per service with its own connection pool. The `ants` pool feeds into them, not around them.

---

## Appendix — Profiling Recipes

### Goroutine count

```go
log.Printf("goroutines: %d, pool running: %d, pool waiting: %d",
	runtime.NumGoroutine(), pool.Running(), pool.Waiting())
```

If `NumGoroutine > Running + Waiting + N (overhead)` by a lot, you have other goroutines — investigate.

### CPU profile

`go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30`.

Look for:

- `runtime.chansend` — submit's channel send. Hot if pool is busy.
- `runtime.lock` — mutex lock. Hot if contended.
- `runtime.findrunnable` — scheduler. Hot if many goroutines.

### Heap profile

`go tool pprof http://localhost:6060/debug/pprof/heap`.

Look for:

- `ants.NewPool` — pool struct allocations.
- `runtime.newobject` from `ants` — worker struct allocations.
- Your task closures.

### Block profile

```go
runtime.SetBlockProfileRate(1) // sample every blocked event
```

Look for:

- `sync.Cond.Wait` from `ants` — blocked submitters.
- Channel send from `ants` — workers receiving tasks.

### Mutex profile

```go
runtime.SetMutexProfileFraction(1)
```

Look for:

- `ants.(*Pool).lock` — pool mutex contention.

---

## Appendix — Memory Layout Considerations

`Pool` struct fields are arranged for cache friendliness in modern versions:

- Hot read-only fields (cap, options ptr) near the start.
- Atomic counters (running, waiting, state) grouped, padded to avoid false sharing.
- Lock + worker queue near the end (less frequently touched in fast path).

False sharing between `running` and `waiting` could be an issue if they're on the same cache line. Modern versions pad them.

You won't usually need to think about this — it's library internals. But if you fork and tinker, layout matters.

---

## Appendix — Comparison with Other Libraries

Go has a few other goroutine pool libraries.

### `panjf2000/ants`

- 13k+ stars.
- Maintained.
- The de facto standard.

### `gammazero/workerpool`

- Smaller, less featureful.
- No options; cap is set at construction.
- Simpler API; good for beginners.

### `Jeffail/tunny`

- Older.
- API based on `Process()` instead of `Submit`.
- Less popular but still functional.

### `golang.org/x/sync/errgroup` with `SetLimit`

- Not a pool — spawns goroutines per task.
- Just caps concurrency.
- Good for one-off batches with error semantics.

### Plain `chan func()`

- Build yourself in 30 lines.
- No external dependency.
- Lacks options, multipool, expiry.

### Choosing

For production Go services: `ants`. For one-off batches: `errgroup`. For simple bounded concurrency without per-task goroutines: a hand-rolled channel + workers.

---

## Appendix — Pool Anti-Patterns

These are senior-level mistakes I've seen in real code.

### Anti 1 — Wrapping every goroutine with the pool

```go
go func() { _ = pool.Submit(func() { doWork() }) }()
```

You're spawning a goroutine to submit. Pointless. Just `pool.Submit(func() { doWork() })`.

### Anti 2 — One pool per request

```go
func (s *Server) Handle(r Request) {
	pool, _ := ants.NewPool(10)
	defer pool.Release()
	// ... use pool ...
}
```

A new pool per request. The pool's overhead dominates. Use a shared pool.

### Anti 3 — Pool to bound CPU when GOMAXPROCS already does

`runtime.GOMAXPROCS=4` and you've got `NewPool(4)` for CPU tasks. The pool adds no value — the runtime already limits CPU parallelism. Drop the pool.

### Anti 4 — Submitting blocking tasks

```go
_ = pool.Submit(func() {
	<-channel // may block forever
})
```

The pool can't help here. The worker is blocked. If the channel never fires, the worker is stuck. Use `select` with context or timeout.

### Anti 5 — Treating Cap as a queue length

A pool of cap 1000 doesn't mean "queue 1000 tasks." It means "run up to 1000 at once." For a queue, build it in front.

### Anti 6 — Pool sharing across mutexes

If your pool's tasks all contend on one mutex, you're not getting concurrency. The mutex serialises. Pool capacity is wasted.

### Anti 7 — Submit-and-wait inline

```go
done := make(chan struct{})
_ = pool.Submit(func() { defer close(done); doWork() })
<-done
```

You're using the pool to run something synchronously. Just call `doWork()` directly. The pool only helps if you submit many tasks and don't wait inline.

### Anti 8 — Pool inside a hot per-request handler

Allocating a `chan` or `WaitGroup` per request, then using `ants`. Often the per-request allocation is bigger than the pool savings. Profile.

### Anti 9 — Failure to handle ErrPoolClosed

```go
// long-lived submitter
for evt := range events {
	_ = pool.Submit(handle(evt)) // ignored error
}
```

During shutdown, all submits silently fail. Producer keeps running. Always check.

### Anti 10 — Mixing async and sync via the pool

```go
result := make(chan int)
_ = pool.Submit(func() { result <- compute() })
return <-result // synchronous
```

You've made an async API. Synchronously waiting for one task adds context-switch overhead vs just calling `compute()` directly. Only use this if `compute()` may block on shared state you want to serialize via the pool.

---

## Appendix — The Cost of Misuse

Each anti-pattern above has a concrete cost. Some examples from real services:

- **Per-request pool:** Service spent 30% CPU in `runtime.newproc` (pool init) and `runtime.morestack` (worker stack growth). Fix: one pool, shared. 30% drop.
- **Submitting blocking tasks:** Pool of 100 workers, all stuck waiting on a goneawry channel. Throughput dropped to 0. Fix: timeout + context.
- **Mutex-serialised tasks:** Pool of 1000 doing the work of 1. Fix: shard the mutex or remove it.

In production, these are not theoretical.

---

## Appendix — Pool Reliability Patterns

### Health check

```go
http.HandleFunc("/health/pool", func(w http.ResponseWriter, r *http.Request) {
	running, free, cap := pool.Running(), pool.Free(), pool.Cap()
	if free <= 0 {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	fmt.Fprintf(w, "running=%d free=%d cap=%d", running, free, cap)
})
```

K8s readiness probe: pool must have free capacity. Otherwise, traffic is shed by the load balancer.

### Circuit breaker around the pool

If the pool is overloaded for too long, open a circuit:

```go
if pool.Free() == 0 && consecutiveOverloads > 10 {
	circuitOpen = true
}
```

When open, `Submit` is replaced by a fast-fail. Allow callers to fall back.

### Bulkhead

One pool per logical dependency:

```go
type Backends struct {
	googlePool *ants.Pool
	awsPool    *ants.Pool
}
```

A burst from Google traffic doesn't starve AWS calls.

### Retry budget

Track retries; if they exceed a budget, stop retrying:

```go
if retries > 0.1 * totalRequests {
	stopRetrying()
}
```

Prevents retry storms that compound failures.

---

## Final Summary

You should now be able to:

- Read the `ants` source with confidence.
- Explain every major data structure and its concurrency story.
- Trace `Submit` and `Release` from the top.
- Identify hot paths and potential bottlenecks.
- Reason about benchmarks and pick the right comparisons.
- Recognise anti-patterns in code reviews.
- Make informed decisions about `MultiPool`, options, and tuning.

Most production code only needs the junior/middle API. But when something goes wrong, the senior understanding is what lets you debug it without guesswork. Onward.

---

## Appendix — Case Studies of Internal Decisions

To round out the senior view, here are three design decisions in `ants` that reveal trade-offs.

### Case 1 — Why use `sync.Cond` instead of channels for waiting?

A `sync.Cond` is conceptually similar to a channel with broadcast. Both have:

- Wait/Wake semantics.
- Goroutine parking.

The choice between them is mostly stylistic. `sync.Cond`:

- Pairs naturally with the existing mutex.
- Has slightly lower per-wake overhead.
- Supports `Signal` (one waiter) and `Broadcast` (all).

A channel-based design would use one `chan struct{}` per blocked submitter. Each `Submit` allocates a channel. Each freed worker selects on the next channel.

The library chose `sync.Cond` because:
- Channels would require per-submitter allocation.
- The pairing with the worker stack's mutex is clean.
- `sync.Cond` has been battle-tested for decades.

The trade-off: `sync.Cond` lacks the composability of channels (can't `select` on a Cond). For `ants`'s narrow needs, this isn't a problem.

### Case 2 — Why a slice-based worker stack instead of a doubly-linked list?

A list-based stack would have:
- O(1) push and pop.
- O(N) findExpired (linear).
- No need for slice growth.

A slice-based stack has:
- O(1) amortised push and pop (with occasional resize).
- O(log N + k) findExpired (binary search + linear copy).
- Slice resize cost (amortised away).

The library chose slice because:
- Slices have great cache locality.
- Binary search on sorted lastUsed makes findExpired O(log N + k).
- Slice resize is amortised cheap.
- Lists have GC overhead per node.

For the typical pool size (hundreds to thousands), the slice is faster in benchmarks.

### Case 3 — Why one task channel per worker instead of a shared channel?

Alternative design: one shared `chan func()`. All workers receive from it. `Submit` just sends.

This would be simpler but has problems:
- All N workers contend on the same channel — runtime overhead per send/receive.
- No way to send a poison pill to a specific worker (broadcasting doesn't work — only one receives).
- Worker idle stack would have to be separate metadata.

With one channel per worker:
- No worker-side contention.
- Targeted poison pill (purger sends to specific worker).
- The "stack of idle workers" is implicit: workers blocked on their own channel are idle.

The chosen design trades a per-worker channel (one extra field) for clean targeting and no contention. Worth it.

---

## Appendix — Implementing a Pool from Scratch

To sharpen understanding, here's a minimal pool you could write yourself.

```go
package mypool

import (
	"context"
	"errors"
	"sync"
)

type Pool struct {
	cap     int
	tasks   chan func()
	wg      sync.WaitGroup
	ctx     context.Context
	cancel  context.CancelFunc
}

func NewPool(cap int) *Pool {
	ctx, cancel := context.WithCancel(context.Background())
	p := &Pool{
		cap:    cap,
		tasks:  make(chan func()),
		ctx:    ctx,
		cancel: cancel,
	}
	for i := 0; i < cap; i++ {
		p.wg.Add(1)
		go p.worker()
	}
	return p
}

func (p *Pool) worker() {
	defer p.wg.Done()
	for {
		select {
		case <-p.ctx.Done():
			return
		case task, ok := <-p.tasks:
			if !ok { return }
			task()
		}
	}
}

func (p *Pool) Submit(task func()) error {
	select {
	case <-p.ctx.Done():
		return errors.New("pool closed")
	case p.tasks <- task:
		return nil
	}
}

func (p *Pool) Release() {
	p.cancel()
	close(p.tasks)
	p.wg.Wait()
}
```

This 60-line pool:
- Spawns all workers up front (no lazy allocation).
- Uses one shared channel (contention possible but bounded).
- Cancels on Release.
- Has no expiry, no panic handler, no MultiPool, no Tune.

It is a useful baseline. `ants` adds all the production features on top.

### Comparing your hand-rolled pool to `ants`

- **Lazy worker spawning:** Your pool spawns all at once. `ants` is lazy. For small pools, doesn't matter. For large pools, your pool wastes memory.
- **Shared channel:** Your workers contend. `ants` has one channel per worker. At high rate, your pool may bottleneck on the channel.
- **No expiry:** Your idle workers exist forever. `ants` reaps them.
- **No tune:** Your cap is fixed. `ants` is dynamic.
- **No panic handling:** A task panic kills a worker in your pool. `ants` recovers.
- **No options:** Your defaults are baked in. `ants` is configurable.

For a learning project, your hand-rolled pool is great. For production, `ants`.

---

## Appendix — Common Profiling Findings and Diagnoses

A catalogue of profile findings and what they usually mean.

### Finding 1 — `runtime.chansend1` at 10% of CPU

The `Submit` channel send is hot. Usually means submit rate is very high. Verify by counting submits per second.

Mitigations:
- Batch submits (one task does the work of 10).
- Switch to `PoolWithFunc` (smaller send payload).
- Use `MultiPool` (per-shard channels reduce contention).

### Finding 2 — `runtime.lock_slow` at 20% of CPU

The pool's lock is contended. Confirm with mutex profile.

Mitigations:
- `MultiPool` to split the lock.
- Reduce submit rate by batching.

### Finding 3 — `runtime.findrunnable` high

Scheduler is overloaded with too many goroutines. Counts include workers + blocked submitters + everything else.

Mitigations:
- Cap blocked submitters with `WithMaxBlockingTasks`.
- Reduce overall goroutine pressure.

### Finding 4 — Many goroutines in `chanrecv`

Blocked submitters waiting on `pool.cond`. Indicates the pool is at capacity.

Mitigations:
- Increase pool cap.
- Switch to non-blocking and shed load.

### Finding 5 — High GC pause

Heap allocations from closures or argument structs.

Mitigations:
- `PoolWithFunc` for hot loops.
- `sync.Pool` for argument structs.

### Finding 6 — Memory grows after spike, doesn't return

Workers' stacks remain grown. Either:
- Shorten `ExpiryDuration` to recycle them.
- Live with it (it's not technically a leak).

### Finding 7 — `runtime.morestack_noctxt` hot

Workers' stacks are growing on demand. Pre-warming may help (force initial growth).

### Finding 8 — `runtime.gcBgMarkWorker` very hot

GC is busy. Allocations somewhere. Heap profile to find them.

### Finding 9 — `runtime.newproc` hot

Goroutines being spawned a lot. Either pool is under-capped (workers being killed and respawned) or you're not using the pool at all somewhere.

### Finding 10 — Idle CPU but slow service

The pool is correctly sized but downstream is slow. The pool is not the problem. Look elsewhere.

---

## Appendix — Internal Counter Semantics Cheat Sheet

| Counter | Type | Increment | Decrement | Reads from |
|---------|------|-----------|-----------|------------|
| `running` | int32 atomic | worker spawn | worker exit | `Running()`, cap checks |
| `capacity` | int32 atomic | `Tune` | `Tune` | `Cap()`, cap checks |
| `waiting` | int32 atomic | cond.Wait start | cond.Wait end | `Waiting()`, MaxBlocking checks |
| `state` | int32 atomic | (never up) | `Release` (CAS to CLOSED) | `IsClosed()` |
| `workers len` | slice | `revertWorker` | `retrieveWorker`, `findExpired`, `reset` | (internal only) |

Notice:
- `running` counts goroutines, not active workers. Idle workers count.
- `len(workers)` is the idle count specifically.
- `waiting` is blocked submitters, not running tasks.

---

## Appendix — Cross-Version Considerations

`ants` evolves. When upgrading:

1. **Read the changelog.** Breaking changes are rare in v2 but documented.
2. **Test under load.** Performance regressions occasionally slip in.
3. **Check panic behaviour.** Recovery semantics have varied.
4. **Audit options.** Some options gain new defaults.

For long-lived services, pin to a specific version (`go.mod`). Don't `go get -u` automatically.

If you fork, name your fork. Many projects do this for libraries they depend on heavily.

---

## Appendix — `PoolWithFunc` vs `Pool` — Decision Tree

```
Are you submitting only ONE function with varying arguments?
├── Yes → Is throughput > 100k/sec?
│   ├── Yes → PoolWithFunc (or generics variant)
│   └── No → Pool (simpler, fine)
└── No → Pool (no choice)
```

Always default to `Pool`. Switch only with profile evidence.

---

## Appendix — `Pool` vs `MultiPool` — Decision Tree

```
Are you observing lock contention in Pool.Submit?
├── No → Pool (simpler)
└── Yes → Are you running on > 8 cores with high submitter count?
    ├── No → Pool with WithPreAlloc or batching first; remeasure
    └── Yes → MultiPool
        └── Pick strategy:
            ├── Uniform load → RoundRobin
            ├── Variable load → LeastTasks
            └── Affinity/sharding key → Custom strategy
```

`MultiPool` is rarely needed. When needed, the benefits are significant. Don't reach for it by default.

---

## Appendix — Things Senior Code Reviewers Look For

In a `ants` PR, a reviewer asks:

1. Is the pool sized appropriately for the workload?
2. Are options set? Which? Why?
3. Is `Release` deferred?
4. Are tasks context-aware?
5. Is there a panic handler?
6. Is the producer rate vs pool throughput documented?
7. Are submits checked for errors?
8. Is the pool shared or per-request?
9. Are there tests that exercise the pool's behaviour under load?
10. Is there observability (metrics for `Running`/`Free`)?

A junior PR with `pool := ants.NewPool(100); defer pool.Release(); pool.Submit(task)` gets the questions. A senior PR pre-answers them with comments and config.

---

## Final Exam

A few exam-style questions to test mastery.

### Exam 1
Given a pool of cap 100, 1000 task arrival rate per second, average task duration 50 ms. Is the pool sized correctly? Show your work.

**Answer.** Required workers = `λ * τ = 1000 * 0.05 = 50`. Pool of 100 is comfortable. Utilisation ~50%. Headroom for bursts. Fine.

### Exam 2
Same as Exam 1 but task duration jumps to 200 ms. Re-evaluate.

**Answer.** Required = `1000 * 0.2 = 200`. Pool of 100 is undersized by 2x. Either: tune up to 250, switch to non-blocking + shed load, or accept queue growth (and possible OOM).

### Exam 3
You see `Running=99, Free=1` for hours. Is the pool overloaded?

**Answer.** Mostly. Free is hovering near zero — any spike will saturate. Increase cap or shed load. Investigate why Running is so high.

### Exam 4
Pool of cap 1000. `Running=1000, Waiting=500` constantly. Is the pool overloaded?

**Answer.** Yes. 500 callers blocked at any time means submit p99 is roughly `500 * average_task_duration / 1000` extra. Tune up or shed load.

### Exam 5
You see `ErrPoolOverload` log entries at 100/sec. The pool is non-blocking with cap 100. Pool's `Running` peaks at 100. What's wrong?

**Answer.** Producer rate exceeds pool throughput. Pool is dropping. Need to increase cap, decrease task duration, or build a real queue.

### Exam 6
Your pool's `Running` is stuck at the cap forever. Tasks should finish. What now?

**Answer.** Probably workers stuck in tasks (blocking I/O, deadlock). Get a goroutine dump to see where they're parked. Fix the tasks.

### Exam 7
Service uses `ants.NewPool(100)` and `ants.NewPool(100)` for two workloads. Memory usage is high. Why?

**Answer.** Two pools, each up to 100 workers. Total: 200 workers, ~400 KB minimum stack. Plus per-worker grown stacks. Plus janitors. Sum it. Consider consolidating if the workloads can share, but only if their throughput characteristics match.

### Exam 8
You add `WithDisablePurge(true)` to a busy production pool. What changes?

**Answer.** Idle workers never expire. Pool's `Running` will reach `Cap` and stay there forever (until `Release`). Memory usage stabilises at peak. CPU usage drops slightly (no janitor). Operationally fine if your peak is sustainable.

### Exam 9
After `Release`, you see `pool.Running() > 0` for several seconds. Bug?

**Answer.** No. `Release` doesn't kill running tasks. Wait for `Running == 0` or use `ReleaseTimeout`.

### Exam 10
You upgrade `ants` and see throughput drop 10%. What now?

**Answer.** Read the changelog for performance regressions. Profile both versions. If unexplained, file an issue. Pin the old version meanwhile.

### Exam 11
Pool with cap 50, 10 producers each submitting 1000 tasks. Task duration 10 ms. How long roughly?

**Answer.** Total tasks = 10000. With cap 50, parallel throughput = 50 * 100 = 5000 tasks/sec. Total time = 10000 / 5000 = 2 seconds. Plus overhead.

### Exam 12
You want to add tracing to every submitted task without modifying the tasks. How?

**Answer.** Wrap Submit in a method that takes context + task and adds spans before calling the underlying Submit with a wrapper closure. Or use a custom panic handler (not appropriate for tracing). The wrapper approach is cleaner.

### Exam 13
Pool of cap 1000 leaks memory at ~50 MB/hour. Investigate.

**Answer.** Heap profile. Check task closures for retained references. Check that `Release` is called. Check workers' stacks aren't growing unboundedly (recursive tasks). Verify the panic handler isn't accumulating state.

### Exam 14
You want to expose a metric for "average submit latency". How?

**Answer.** Wrap Submit: record `time.Now()` before, `time.Since()` after, push to histogram. Beware: most Submits are sub-microsecond; instrument cost may dominate. Sample if needed.

### Exam 15
Two `ants.Pool` instances in your service use the same `*log.Logger`. The logger uses a mutex internally. Is this a problem?

**Answer.** Not usually. `log.Logger` has its own mutex; writes are serialised. Performance impact depends on log volume. For high-rate logging, switch to a logger with internal sharding (zap, zerolog).

---

## Appendix — How `ants` Compares to Java's ThreadPoolExecutor

For readers coming from Java, here is the side-by-side.

| Aspect | Java `ThreadPoolExecutor` | `ants.Pool` |
|--------|--------------------------|-------------|
| Workers | OS threads | Go goroutines |
| Core size | Pre-spawned | Lazy |
| Max size | Hard cap | Hard cap |
| Queue | `BlockingQueue` (separate object) | Caller-as-queue (no separate object) |
| Reject policy | Configurable (Abort, CallerRuns, Discard, DiscardOldest) | Blocking or non-blocking (no DiscardOldest equivalent) |
| Idle timeout | `keepAliveTime` | `ExpiryDuration` |
| Future | `Future<T>` returned | None (build with WaitGroup or channel) |
| Shutdown | `shutdown()` then `awaitTermination` | `Release()` then `ReleaseTimeout` |
| Interrupt running | `shutdownNow()` interrupts threads | Not possible (no goroutine interrupt) |
| Hooks | `beforeExecute`, `afterExecute` | Not exposed (panic handler only) |
| Priority | Possible with `PriorityBlockingQueue` | Not supported |

Java's API is more featureful (priority, futures, hooks); `ants` is more minimal and aligned with Go idioms (no futures, no interruption, context-based cancellation handled by you).

---

## Appendix — Reading Order for the `ants` Source

For someone new to the codebase, this is the recommended reading order:

1. `ants.go` — package-level API. Quick overview.
2. `options.go` — what's configurable.
3. `pool.go` — the main type. Spend time here.
4. `worker.go` — worker lifecycle.
5. `worker_stack.go` — idle stack.
6. `pool_func.go` — variant for `PoolWithFunc`.
7. `worker_func.go` — variant worker.
8. `multipool.go` — sharded variant.
9. `worker_loop_queue.go` — pre-alloc variant.
10. Tests (`*_test.go`) — examples and edge cases.

Each file is short. The whole library is under 1500 lines.

---

## Appendix — Watching the Pool in Action

A simple instrumented run:

```go
package main

import (
	"fmt"
	"sync"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(10)
	defer pool.Release()

	stop := make(chan struct{})
	go func() {
		t := time.NewTicker(100 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-stop: return
			case <-t.C:
				fmt.Printf("running=%d free=%d waiting=%d cap=%d\n",
					pool.Running(), pool.Free(), pool.Waiting(), pool.Cap())
			}
		}
	}()

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			time.Sleep(200 * time.Millisecond)
		})
	}
	wg.Wait()
	close(stop)
	time.Sleep(200 * time.Millisecond) // let monitor flush
}
```

Output (roughly):

```
running=10 free=0 waiting=0 cap=10
running=10 free=0 waiting=30 cap=10
running=10 free=0 waiting=20 cap=10
running=10 free=0 waiting=10 cap=10
running=10 free=0 waiting=0  cap=10
running=0  free=10 waiting=0 cap=10
```

You can see the cap, the saturation, the waiting growing then draining.

### What you'd see if non-blocking

With `WithNonblocking(true)` and cap 10:

```
running=10 free=0 waiting=0 cap=10
running=10 free=0 waiting=0 cap=10
...
```

`Waiting` stays 0 — there are no blocked submitters. Excess submits return `ErrPoolOverload` instead.

---

## Appendix — Stress Test Recipes

To validate your understanding, run these:

### Stress 1 — Maximum submission rate

Single pool, very tight loop, trivial task. Measure submits/sec.

### Stress 2 — Maximum concurrency

Many pools or `MultiPool`, watch for lock contention in profile.

### Stress 3 — Mixed workload

Half short, half long tasks. Pool should not be exhausted by long ones (use separate pool for long).

### Stress 4 — Burst recovery

Run quietly for 1 minute, then submit 10x normal load for 10 seconds, then quiet again. Watch `Running` rise and fall.

### Stress 5 — Panic resilience

Make 1% of tasks panic. Verify pool keeps running. Verify panic counter increments.

### Stress 6 — Graceful shutdown

Submit tasks, signal shutdown, watch `Release` complete. Verify all tasks completed or were dropped predictably.

### Stress 7 — Idle expiry

Submit a burst, then idle. Watch `Running` drop to 0 after the expiry. Verify no leaks.

### Stress 8 — Tune up/down

Start with cap 10, submit 50 tasks (40 blocked). Tune to 100. Watch 40 immediately admitted. Tune back to 10. Watch the next burst respect the lower cap.

---

## Appendix — Code Walk: Submit, Step by Step

Let's walk through `Submit` one final time with the most plausible production-grade pseudo-code.

```go
func (p *Pool) Submit(task func()) error {
	// 1. Fast closed check (no lock).
	if atomic.LoadInt32(&p.state) == CLOSED {
		return ErrPoolClosed
	}

	// 2. Try to obtain a worker.
	w, err := p.retrieveWorker()
	if err != nil {
		return err
	}

	// 3. Send the task on the worker's channel (outside the lock).
	w.task <- task
	return nil
}

func (p *Pool) retrieveWorker() (*goWorker, error) {
retry:
	p.lock.Lock()

	// Re-check closed under the lock.
	if atomic.LoadInt32(&p.state) == CLOSED {
		p.lock.Unlock()
		return nil, ErrPoolClosed
	}

	// Try to pop an idle worker.
	if w := p.workers.detach(); w != nil {
		p.lock.Unlock()
		return w, nil
	}

	// No idle worker. Can we spawn a new one?
	running := int(atomic.LoadInt32(&p.running))
	cap := p.Cap()
	if cap == -1 || running < cap {
		// Yes — spawn.
		p.lock.Unlock()
		w := p.workerCache.Get().(*goWorker)
		w.pool = p
		w.lastUsed = time.Now()
		w.run()
		return w, nil
	}

	// At capacity. Handle non-blocking and MaxBlockingTasks.
	if p.options.Nonblocking {
		p.lock.Unlock()
		return nil, ErrPoolOverload
	}
	if p.options.MaxBlockingTasks != 0 &&
		int(atomic.LoadInt32(&p.waiting)) >= p.options.MaxBlockingTasks {
		p.lock.Unlock()
		return nil, ErrPoolOverload
	}

	// Wait on cond.
	atomic.AddInt32(&p.waiting, 1)
	p.cond.Wait() // releases lock
	atomic.AddInt32(&p.waiting, -1)

	// Woken — retry.
	p.lock.Unlock()
	goto retry
}
```

This is approximately what `ants` does. Real code has a few more optimisations (e.g., a `signal` instead of `wait` if the closed flag changes), but the structure is the same.

### Critical observations

1. The lock is held only for stack ops and the state recheck. Channel send is outside.
2. Non-blocking returns `ErrPoolOverload` cleanly.
3. The retry loop handles spurious wakes and race-on-revert: the woken submitter might find the pool full again if another submitter grabbed the slot first.
4. `workerCache.Get` may return either a recycled struct (good) or a fresh `*goWorker` from the `New` function (also fine).

### Why `goto retry`?

Because the alternative — `for { ... break ... }` — would require structural changes. `goto` is idiomatic in Go for early-exit retry loops in performance-sensitive code.

---

## Appendix — Common Misreadings of the Source

When new engineers read `ants.go` and the supporting files, they often:

### Misreading 1 — Thinking `Submit` always allocates a worker

It does only if the idle stack is empty *and* `running < cap`. Otherwise it pops a recycled worker.

### Misreading 2 — Thinking `goWorker.task` is shared

It is not. Each worker has its own task channel.

### Misreading 3 — Thinking the worker stack is FIFO

It is LIFO. `detach` pops from the end.

### Misreading 4 — Thinking the panic handler runs on a different goroutine

It runs on the worker goroutine inside the recover.

### Misreading 5 — Thinking `Release` waits for tasks

It does not. `ReleaseTimeout` does.

### Misreading 6 — Thinking `Tune` interrupts running workers

It does not. New cap applies only to future submits and worker recycling.

### Misreading 7 — Thinking `Cap = Running + Free + Waiting`

It's `Cap = Running + Free`. `Waiting` is blocked submitters, not on the pool's capacity.

### Misreading 8 — Thinking `MultiPool` is the same as `[]*Pool`

Conceptually similar; `MultiPool` adds routing.

### Misreading 9 — Thinking the purger interrupts running workers

It does not. Only idle workers receive the poison pill.

### Misreading 10 — Thinking `sync.Pool` cache is bypassable

It is internal. If `Get` returns a fresh struct, that's fine; the pool functions identically. You cannot disable the cache.

---

## Appendix — Production Anecdotes

A few real stories from teams using `ants` (paraphrased, anonymised).

### Anecdote 1 — Tencent's gnet

`gnet` is a network framework that uses `ants` internally. Their use case: per-connection callbacks need to run concurrently but bounded. Default config; `WithExpiryDuration(10 * time.Second)` to keep workers warm between callback batches.

### Anecdote 2 — Bytedance's traffic ingress

Bytedance reportedly uses `ants` at edge for processing inbound HTTP. Cap is high (10k+), with `MultiPool` to spread contention. Custom panic handler integrated with their tracing.

### Anecdote 3 — A startup's email sender

Small Go service, 50-worker pool for SendGrid calls. Initial mistake: no panic handler. A bad email body caused a panic on every retry, exhausting the pool over hours. Fixed by adding `WithPanicHandler` with metric.

### Anecdote 4 — A monitoring SaaS

Pool of 1000 for metric ingestion. Sometimes saturated under spike. They added `WithNonblocking(true)` and a Redis fallback queue for overflow. Latency improved by 80%; lost zero events.

### Anecdote 5 — A misconfigured pool

A team set `WithExpiryDuration(100 * time.Millisecond)`. Workers cycled constantly. CPU usage doubled. After investigation, restored to default 1 s — CPU dropped, throughput unchanged.

---

## Appendix — Three Final Test Cases for Yourself

### Test Yourself 1

Write a small program that:
1. Creates a pool of cap 10.
2. Submits 100 tasks that each sleep 10 ms and print their index.
3. Prints "all done" after.

If you can do this in 30 lines without looking, you have the junior level.

### Test Yourself 2

Modify the above:
1. 1% of tasks should panic.
2. Install a panic handler that counts panics.
3. Print the count at the end.

If you can, middle level.

### Test Yourself 3

Modify further:
1. Add SIGTERM handling with `ReleaseTimeout(30 * time.Second)`.
2. Plumb a `context.Context` through tasks.
3. Tune the pool every 5 seconds based on `Running`.

If you can, senior level. The internals you've learned in this file should make all three trivial.

---

## Appendix — Last Words

`ants` is a small, focused, well-designed library. Its complexity is in the details, not the surface. After this file, the source should feel familiar; the API should feel justified; the choices should feel defensible.

The next file (`professional.md`) is about deploying `ants` in production: observability, multi-tenant patterns, integration with errgroup, graceful shutdown patterns, capacity planning, case studies. It builds on this senior understanding to answer "how does my company actually run `ants` services."

Read on.

---

### Diagram 9 — Worker stack growth and expiry

```
Time t=0:   stack=[]
            running=0

Time t=1:   submit, no idle, spawn w1
            stack=[]  running=1

Time t=2:   submit, no idle, spawn w2
            stack=[]  running=2

Time t=3:   w1 finishes
            stack=[w1]  running=2

Time t=4:   submit, pop w1
            stack=[]  running=2

Time t=10:  w2 finishes; both have been idle
            stack=[w2,w1]  running=2  (sorted by lastUsed)

Time t=11:  purger runs, finds w1 expired (idle 7s > 5s)
            stack=[w2]  running=1  (w1 received nil, exited)
```

### Diagram 10 — MGRR strategies

```
RoundRobin:    index++ mod N
LeastTasks:    pick pool with min Running()
Custom:        user-defined (e.g., hash-based)

Submit(f) -> lbs.Pick(pools) -> pools[i].Submit(f)
```

---
