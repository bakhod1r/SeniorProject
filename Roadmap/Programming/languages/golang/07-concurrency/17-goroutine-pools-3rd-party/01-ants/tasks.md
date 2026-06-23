---
layout: default
title: Tasks
parent: ants
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/01-ants/tasks/
---

# ants — Hands-On Tasks

[← Back](../)

A graded series of hands-on programming tasks. Each task has a goal, acceptance criteria, and hints. Work through them in order — they build on each other.

Run each in a fresh module:

```bash
mkdir ants-task-N && cd ants-task-N
go mod init ants-task-N
go get github.com/panjf2000/ants/v2
```

---

## Task 1 — Hello Pool

**Goal:** Write a program that creates a pool of size 5, submits 10 tasks that each print their index, and waits for all of them.

**Acceptance criteria:**
- The program prints 10 distinct lines.
- The program exits cleanly.
- No goroutines leak.

**Hints:**
- `ants.NewPool(5)`.
- `defer pool.Release()`.
- `sync.WaitGroup` for waiting.
- Shadow the loop variable.

**Verification:**
```bash
go run main.go
```

Should print 10 lines and exit.

---

## Task 2 — Bounded URL Fetcher

**Goal:** Read URLs from a file, fetch each, save the response body to disk. Cap concurrency at 50.

**Acceptance criteria:**
- Reads URLs from `urls.txt` (one per line).
- Uses `ants.NewPool(50)`.
- Saves each response to `out/<sanitised-url>`.
- Prints total/success/failure at the end.

**Hints:**
- `http.Client` with timeout.
- `os.MkdirAll` for output dir.
- `strings.NewReplacer` for URL sanitisation.
- `sync.WaitGroup` + atomic counters.

**Verification:**

Create `urls.txt` with 100 URLs (some 200s, some 404s, some invalid). Run; verify `out/` contains downloaded files and the printout shows expected counts.

---

## Task 3 — Pool Stats Dashboard

**Goal:** Extend Task 2 with a goroutine that prints pool stats (`Running`, `Free`, `Cap`) every 500 ms.

**Acceptance criteria:**
- A stats goroutine prints periodically while work is happening.
- Stops when work is done.

**Hints:**
- `time.NewTicker`.
- `pool.Running()`, `pool.Free()`, `pool.Cap()`.
- Use a `done` channel to signal completion.

**Verification:**

Run with 200 URLs and watch the stats. You should see `Running` rise to 50, stay there, then drop to 0.

---

## Task 4 — Panic Handler

**Goal:** Write a program with a pool of size 10, submit 100 tasks where 10% panic randomly. Install a panic handler that increments a counter. Print the count at the end.

**Acceptance criteria:**
- Panics are caught; the pool keeps running.
- The counter at the end equals (approximately) 10.
- No crash.

**Hints:**
- `ants.WithPanicHandler(handler)`.
- `atomic.AddInt64` for the counter.
- `rand.Float64() < 0.1` for "10% chance."

**Verification:**

Run several times; counter should be around 10 each time.

---

## Task 5 — Non-Blocking Submit

**Goal:** Configure a pool with `WithNonblocking(true)` and submit 1000 tasks rapidly. Count successful submits, overloaded submits.

**Acceptance criteria:**
- Pool cap is, say, 10.
- All 1000 submits return either nil or `ErrPoolOverload`.
- Counts are printed at the end.

**Hints:**
- `errors.Is(err, ants.ErrPoolOverload)`.
- `atomic.AddInt64` counters.

**Verification:**

Run. Verify `submitted + overloaded == 1000`. Verify `submitted` is around 10 (the cap), plus however many tasks completed during the submit loop.

---

## Task 6 — Submit with Retry

**Goal:** Write a wrapper around `pool.Submit` that retries on `ErrPoolOverload` with exponential backoff (1 ms → 2 ms → 4 ms → ... up to 100 ms). Cap retries at 10. Return error if exceeded.

**Acceptance criteria:**
- Each retry sleeps exponentially longer.
- Honours `context.Context` cancellation.
- Maximum 10 retries.

**Hints:**
- `time.After(d)`.
- `min(backoff*2, 100*time.Millisecond)`.
- `errors.Is(err, ants.ErrPoolOverload)`.

**Verification:**

Test with a small pool (cap 1) and many concurrent submitters. Verify retries happen and most eventually succeed.

---

## Task 7 — PoolWithFunc

**Goal:** Refactor Task 2 to use `PoolWithFunc`. Each "task" is now an invocation with a URL argument.

**Acceptance criteria:**
- The function is set once at pool creation.
- `Invoke(url)` is used instead of `Submit(closure)`.
- Same end-to-end behaviour.

**Hints:**
- `ants.NewPoolWithFunc(50, func(arg interface{}) { ... })`.
- Type-assert `arg.(string)`.
- `pool.Invoke(url)`.

**Verification:**

Benchmark Task 2 vs Task 7. PoolWithFunc should be slightly faster (or at least no slower).

---

## Task 8 — Multi-Pool Sharding

**Goal:** Use `MultiPool` with 4 sub-pools, cap 25 each. Submit 1000 tasks. Verify the work is distributed evenly.

**Acceptance criteria:**
- Use `RoundRobin` strategy.
- Print task counts per shard at the end.
- Distribution is approximately even (within 10%).

**Hints:**
- `ants.NewMultiPool(4, 25, ants.RoundRobin)`.
- Tag each task with its shard somehow (closure capture).

**Verification:**

Run. Each shard should have ~250 tasks.

---

## Task 9 — Tune at Runtime

**Goal:** Create a pool of cap 10. Submit a continuous stream of tasks. After 5 seconds, `Tune` the pool to 50. After another 5 seconds, `Tune` to 5. Print stats throughout.

**Acceptance criteria:**
- Pool starts at cap 10.
- Tune up at t=5 increases throughput visibly.
- Tune down at t=10 decreases throughput (over time, as tasks finish).
- Stats logged every second.

**Hints:**
- Time-aware tuning with `time.Timer`.
- Tasks take ~100 ms.
- Submit at >50 tasks/sec.

**Verification:**

Watch `Running` over time. Should follow cap roughly.

---

## Task 10 — Graceful Shutdown

**Goal:** Write a program that runs a pool with 100 long-running tasks. On SIGTERM (Ctrl-C), the program should drain (`ReleaseTimeout(30 * time.Second)`) and exit cleanly.

**Acceptance criteria:**
- Pool starts and tasks begin running.
- On Ctrl-C, the program prints "draining" and waits for tasks.
- If tasks complete within 30 s, prints "drained cleanly." Otherwise, prints "drain timeout."
- Exits with code 0.

**Hints:**
- `signal.Notify` for SIGTERM/SIGINT.
- `<-sigs` to wait for the signal.
- `pool.ReleaseTimeout(d)`.

**Verification:**

Run. Hit Ctrl-C. Observe the drain.

---

## Task 11 — Context-Aware Tasks

**Goal:** Extend Task 10 so tasks honour a `context.Context`. On shutdown, the context is cancelled, and tasks short-circuit immediately.

**Acceptance criteria:**
- Tasks receive a `context.Context`.
- Inside, they `select` on `ctx.Done()`.
- On shutdown, in-flight tasks see cancellation and return quickly.
- `ReleaseTimeout` finishes in a few seconds, not 30.

**Hints:**
- `context.WithCancel`.
- Pass context through closure or wrapper.
- `select { case <-ctx.Done(): return; default: }` inside tasks.

**Verification:**

Run. Hit Ctrl-C. Drain should be much faster than Task 10.

---

## Task 12 — Bulkheaded Multi-Tenant

**Goal:** Implement a `MultiTenantService` with three pools (free, paid, enterprise). Submit tasks tagged by tier. Each tier should be isolated.

**Acceptance criteria:**
- Three pools with different caps.
- A `Submit(tier, task)` method routes correctly.
- A "noisy" free tier (1000 simultaneous submits) does not affect paid or enterprise pools.

**Hints:**
- `map[Tier]*ants.Pool`.
- `WithNonblocking(true)` on free, default on others.

**Verification:**

Submit 1000 free tasks and 10 paid tasks. Paid tasks complete quickly even while free is saturated.

---

## Task 13 — Metrics Wrapper

**Goal:** Wrap `ants.Pool` with a struct that exposes Prometheus metrics: `submits_total{result}`, `panics_total`, `running`, `free`, `cap`.

**Acceptance criteria:**
- Metrics are exposed at `/metrics` via the default HTTP mux.
- They update as tasks are submitted.
- Run `curl localhost:8080/metrics` shows them.

**Hints:**
- `prometheus.NewCounterVec`, `prometheus.NewGaugeVec`.
- `prometheus.MustRegister`.
- `http.Handle("/metrics", promhttp.Handler())`.

**Verification:**

Run, submit some tasks, curl `/metrics`, verify the counters.

---

## Task 14 — errgroup Integration

**Goal:** Combine `errgroup` with `ants.Pool`. Process a slice of items, propagate the first error, cancel siblings.

**Acceptance criteria:**
- Use `errgroup.WithContext`.
- Each task submits to the pool and waits for the result via a channel.
- If a task returns an error, the rest cancel.

**Hints:**
- `g, ctx := errgroup.WithContext(parent)`.
- `g.Go(func() error { ... return errCh })`.
- Inside the goroutine, `pool.Submit` and read from `errCh`.

**Verification:**

Make one task return an error. Verify other tasks observe `ctx.Done()` and bail.

---

## Task 15 — Latency Profile

**Goal:** Measure the per-submit latency of `pool.Submit` for a pool of cap 100. Report median, p99, and max over 10000 submits.

**Acceptance criteria:**
- Measures `time.Now()` before each submit and `time.Since(start)` after.
- Sorts and reports stats.
- Tasks are trivial (no-op).

**Hints:**
- `[]time.Duration` for samples.
- `sort.Slice` to sort.
- `durs[N/2]` for median, `durs[N*99/100]` for p99.

**Verification:**

Run. Expect median < 1 µs, p99 < 10 µs on a modern machine.

---

## Task 16 — Pool Reboot

**Goal:** Write a program that creates a pool, submits work, calls `Release`, then calls `Reboot` and submits more work.

**Acceptance criteria:**
- After `Reboot`, `Submit` succeeds.
- Tasks before `Release` complete; tasks after `Reboot` run on (possibly new) workers.

**Hints:**
- `pool.Reboot()`.
- `pool.IsClosed()` toggles.

**Verification:**

Print `IsClosed` at each stage to confirm transitions.

---

## Task 17 — Sized for Downstream

**Goal:** Build a service that makes outbound HTTP calls to a backend with a strict 50-concurrent limit. Use `ants` to enforce this.

**Acceptance criteria:**
- Pool sized at 50.
- Even with 1000 producers, no more than 50 concurrent calls.
- Verifiable by monitoring outbound concurrency.

**Hints:**
- Add a fake backend with a `chan struct{}` that returns after 100 ms.
- Count peak concurrent calls with a counter that increments at start and decrements at end.

**Verification:**

Peak counter should not exceed 50.

---

## Task 18 — Pool of Pools

**Goal:** Build a "router pool" — wraps multiple `ants.Pool`s, picks one based on a key (hash). Same tenant always uses the same pool.

**Acceptance criteria:**
- `Submit(key, task)` consistently routes the same `key` to the same pool.
- Multiple distinct keys spread across pools.
- Hash function is reproducible.

**Hints:**
- `hash/fnv`.
- `pool := pools[hash % len(pools)]`.

**Verification:**

Submit 1000 tasks with 10 distinct keys. Verify each key lands on exactly one pool.

---

## Task 19 — Backpressure on Slow Consumer

**Goal:** Show that with a blocking pool, a slow consumer naturally slows down a fast producer.

**Acceptance criteria:**
- Producer in a loop submits 10000 tasks.
- Each task sleeps 100 ms.
- Pool cap is 10.
- Print producer's elapsed time at the end.
- Should be approximately `10000 / 10 * 100ms = 100s`.

**Hints:**
- Time.Now() before and after the submit loop.
- `time.Sleep(100 * time.Millisecond)` inside tasks.

**Verification:**

Elapsed time ≈ 100s (give or take a few percent).

---

## Task 20 — Submit with Timeout

**Goal:** Implement `submitWithTimeout(p, task, timeout)` that returns `ErrTimeout` if `Submit` doesn't return within the deadline.

**Acceptance criteria:**
- Returns nil on successful submit.
- Returns `ErrTimeout` if pool is saturated and timeout passes.
- Doesn't leak goroutines on timeout.

**Hints:**
- Spawn a goroutine that calls `Submit`; the goroutine writes the result to a channel.
- `select` between the channel and `time.After(timeout)`.
- For non-leak: ensure the spawned goroutine exits even on timeout (drain the channel or use buffered).

**Verification:**

Create a pool of cap 1, submit a long task, then call `submitWithTimeout` with 100 ms. Should return `ErrTimeout`.

---

## Stretch Tasks

These are harder. Try them after the main 20.

### Task A — Adaptive Pool

Build a pool that auto-tunes its cap based on observed task duration. If p99 latency exceeds a threshold, shrink. If `Free` is consistently 0, grow.

### Task B — Priority Pool

Build a priority pool using multiple `ants.Pool`s. Submit accepts a priority; higher-priority pools are checked first.

### Task C — Custom workerQueue

Fork `ants` and replace `workerStack` with a custom data structure (e.g., a heap sorted by `lastUsed`). Benchmark the change.

### Task D — Cross-Pod Pool

Build a "pool" that shards across multiple machines via RPC. (Not a real pool — distributed task queue with `ants` underneath on each node.)

### Task E — Submit-by-Affinity

Build a `RouterPool` where each unique key always lands on the same shard. Use FNV hash. Bonus: dynamic reshard if a shard saturates.

---

## Reflection Prompts

After completing the tasks, write 1-2 paragraphs answering:

1. What surprised you about the API?
2. What was the hardest task and why?
3. Which task is most representative of production code you'd write?
4. What would you build next with `ants` after this?
5. What did you find lacking in `ants`'s API? How would you address it?

---

## Grading Yourself

Score 1-5 per task:

- 1 — Couldn't start.
- 2 — Got partway; got stuck.
- 3 — Completed; works but ugly.
- 4 — Completed; clean code.
- 5 — Completed; clean, with tests, ready for production.

Aim for 4+ on most. The stretch tasks are intentionally hard.

---

## Tips

- Read the task. Then read it again.
- Sketch the code on paper before typing.
- Run early; iterate.
- When stuck, re-read the relevant section of `junior.md` / `middle.md`.
- Use the GoDoc for the library: <https://pkg.go.dev/github.com/panjf2000/ants/v2>.
- Test under load; surprises only show up at scale.
- Ask: would I trust this code in production?

---

## Submission

This file doesn't accept submissions. The exercise is for your own growth. Push your code to your own GitHub for future reference and to share with peers.

---

## Worked Example — Task 1 Solution

For reference, here's a clean solution to Task 1.

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, err := ants.NewPool(5)
	if err != nil {
		panic(err)
	}
	defer pool.Release()

	var wg sync.WaitGroup
	for i := 1; i <= 10; i++ {
		wg.Add(1)
		i := i
		if err := pool.Submit(func() {
			defer wg.Done()
			fmt.Printf("task %d\n", i)
		}); err != nil {
			wg.Done()
			fmt.Printf("submit %d failed: %v\n", i, err)
		}
	}
	wg.Wait()
}
```

Things this gets right:
- Defers `Release`.
- Checks `NewPool` error.
- Shadows the loop variable.
- Checks `Submit` error (and compensates the WaitGroup).
- Uses `defer wg.Done()`.

---

## Worked Example — Task 11 Solution

Context-aware version.

```go
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(100,
		ants.WithPanicHandler(func(p interface{}) {
			log.Printf("panic: %v", p)
		}),
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-sigs
		log.Println("shutdown signal")
		cancel()
	}()

	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		i := i
		_ = pool.Submit(func() {
			defer wg.Done()
			select {
			case <-ctx.Done(): return
			default:
			}
			// Simulate work that checks context.
			for j := 0; j < 100; j++ {
				if ctx.Err() != nil { return }
				time.Sleep(10 * time.Millisecond)
			}
			_ = i
		})
	}

	go func() {
		wg.Wait()
	}()

	<-ctx.Done()
	log.Println("draining")
	if err := pool.ReleaseTimeout(30 * time.Second); err != nil {
		log.Printf("drain timeout: %v", err)
	} else {
		log.Println("drained cleanly")
	}
	fmt.Println("done")
}
```

Things this demonstrates:
- Signal handler triggers cancel.
- Tasks check `ctx.Err()` periodically.
- `ReleaseTimeout` waits for tasks; tasks exit quickly because of cancel.

---

## Code Style Tips

For all tasks:

- Use `gofmt` (or `goimports`) on save.
- Use `go vet` for static analysis.
- Run `go test -race` for any tests.
- Use `gopls` if you have an editor that supports it.

For each task, the code should be:

- < 200 lines (most tasks).
- Self-contained (no external services if possible).
- Easy to read at a glance.

If your code is much longer or complex, you may be over-engineering. Step back and simplify.

---

## Discussion: Why These Tasks

Each task targets a specific competency:

- Tasks 1-5: basics.
- Tasks 6-11: production patterns.
- Tasks 12-15: integration concerns.
- Tasks 16-20: edge cases and specialised use.

If you do all 20, you have hands-on experience with every meaningful aspect of `ants`. The stretch tasks push beyond.

---

## After the Tasks

Once you complete the tasks:

- Re-read `professional.md` with new context.
- Pick a small open-source Go project; add `ants` if appropriate.
- Write a blog post about your experience.
- Help someone else learn.

---

## End of Tasks

The exercises are yours to attempt. Go build.

---

