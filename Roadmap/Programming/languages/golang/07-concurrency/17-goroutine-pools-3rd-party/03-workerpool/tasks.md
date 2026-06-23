---
layout: default
title: Tasks
parent: workerpool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/03-workerpool/tasks/
---

# gammazero/workerpool — Hands-On Tasks

Eighteen exercises arranged by difficulty. Each task has clear acceptance criteria. Type, run, observe.

Setup once:

```bash
mkdir wp-exercises && cd wp-exercises
go mod init example.com/wp-exercises
go get github.com/gammazero/workerpool
```

Then create a file per task.

---

## Task 1: Hello, Pool

**Goal:** Write a program that submits 5 tasks to a pool of size 2 and prints "hello N" from each.

**Acceptance:** All 5 messages print before the program exits. At most 2 print simultaneously.

**Skeleton:**

```go
package main

import (
    "fmt"
    "time"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(2)
    defer pool.StopWait()

    for i := 1; i <= 5; i++ {
        // submit a task that prints "hello N" and sleeps 100ms
    }
}
```

Fill in the loop. Verify the output.

---

## Task 2: Captured Loop Variable

**Goal:** Submit 10 tasks that each print their index. First write the buggy version that prints "10" ten times. Then fix it.

**Acceptance:** Final version prints each of 0 through 9 (in some order).

**Question:** Does your Go version (1.22+) make the shadow `i := i` unnecessary? Verify by removing it on each version.

---

## Task 3: Bounded Fetcher

**Goal:** Given a list of 30 URLs, fetch them with at most 5 concurrent fetches. Print URL + status code for each.

**Inputs:** A `[]string` of URLs (use real ones from httpbin.org or example.com).

**Acceptance:**
- Total fetches: 30.
- Peak concurrent: 5 (at most).
- Each result prints once.

**Hint:** Use `http.Client` with a `Timeout`.

---

## Task 4: SumOfSquares

**Goal:** Compute the sum of squares from 1 to 1,000,000 using a pool. Each task computes the square of one number. Aggregate via atomic counter.

**Acceptance:**
- Result equals `333_333_833_333_500_000`.
- No race detector warnings (`go test -race ./...` if you write it as a test).

**Discussion:** Compare wall-clock time of pool version vs. sequential `for` loop. Which is faster? Why?

---

## Task 5: Worker Concurrency Verification

**Goal:** Submit 100 tasks to a pool of size 8. Each task increments an in-flight atomic counter, sleeps 100ms, then decrements. Track the peak in-flight value.

**Acceptance:**
- All 100 tasks complete.
- Peak in-flight value is exactly 8 (or fewer, in rare timing edge cases).

This validates the library's contract experimentally.

---

## Task 6: SubmitWait Backpressure

**Goal:** Modify Task 4 (SumOfSquares) to use `SubmitWait` instead of `Submit`. Measure the wall-clock time.

**Acceptance:**
- Result is still correct.
- Wall-clock time is roughly `numWorkers * task_time` divided across the work — substantially slower than `Submit`.

**Discussion:** Why is `SubmitWait` slower here? In what scenarios is `SubmitWait` the right choice anyway?

---

## Task 7: Panic Recovery

**Goal:** Submit 10 tasks. Some panic, some succeed. Verify the pool survives and the surviving tasks complete.

**Acceptance:**
- Tasks 5 and 7 panic; the others succeed.
- After `StopWait`, the success count is 8.
- The program does not crash.

**Hint:** Use `defer recover()` in the task closure to log the panic value, then re-panic or absorb it.

---

## Task 8: Context Timeout

**Goal:** Submit 5 tasks, each making an HTTP GET to `https://httpbin.org/delay/N` where N is the index. Use `context.WithTimeout(ctx, 3*time.Second)` per task. Tasks 4 and 5 should time out.

**Acceptance:**
- Tasks 1, 2, 3 succeed.
- Tasks 4, 5 fail with `context.DeadlineExceeded` (visible in printed errors).
- Pool exits cleanly.

---

## Task 9: Bounded Queue

**Goal:** Wrap `workerpool` with a semaphore of capacity 10. Submit 100 tasks rapidly. Drop tasks that overflow.

**Acceptance:**
- At most 10 tasks are queued or running at any time.
- 90+ tasks are dropped and reported.

**Hint:** Use `select` with `default` for non-blocking acquire.

---

## Task 10: Per-Tenant Pool

**Goal:** Build a `TenantPool` type that maps tenant IDs to per-tenant `workerpool.WorkerPool` instances. Tenants share no workers.

**Acceptance:**
- Submitting under tenant "A" does not affect tenant "B"'s capacity.
- Stopping the `TenantPool` stops all underlying pools.

**Discussion:** What's the cost of this design vs. a single shared pool with per-tenant tokens?

---

## Task 11: Producer-Consumer Pipeline

**Goal:** Build a two-stage pipeline:
- Stage 1: Pool of 4 workers reads ints from a channel and doubles them.
- Stage 2: Pool of 2 workers reads doubled ints and adds 1.

Final results are collected in a slice. Source ints: 1 to 100.

**Acceptance:**
- Final slice contains 100 values, each equal to `2*input + 1`.
- Both pools are stopped before the program exits.

**Hint:** Use channels between stages; close them in the right order.

---

## Task 12: Drain with Deadline

**Goal:** Submit 50 slow tasks (each sleeps 500ms) to a pool of size 4. Call `StopWait` but with a 2-second deadline. After deadline, hard-stop.

**Acceptance:**
- Approximately 16 tasks complete (4 workers × 4 batches in 2 seconds).
- The program exits within ~2.5 seconds.
- The number of dropped tasks is logged.

---

## Task 13: Pool with Metrics

**Goal:** Wrap a pool with counters for `submitted`, `completed`, and `panics`. Print the values every 1 second from a goroutine.

**Acceptance:**
- After `StopWait`, `submitted == completed + panics`.
- Counters increment correctly.

**Bonus:** Use Prometheus metrics if you have a registry.

---

## Task 14: Per-Task Timeout via Wrapper

**Goal:** Build a `TimedPool` type with method `SubmitTimeout(d time.Duration, f func(context.Context) error)`. The method creates a context with the given deadline and passes it to the task.

**Acceptance:**
- Tasks respect the deadline.
- Errors from the task are surfaced (via a channel or shared structure).

---

## Task 15: Submit from Many Goroutines

**Goal:** Spawn 100 goroutines that each submit 100 tasks to a single pool of size 8. Total: 10,000 tasks.

**Acceptance:**
- All 10,000 tasks complete.
- No panics, no race detector warnings.
- Final atomic counter equals 10,000.

**Discussion:** What does the dispatcher look like under this contention? Try with `-cpu 1` and `-cpu 8`; observe.

---

## Task 16: Tree Walker with Pool

**Goal:** Given a tree structure (e.g., a directory tree with `filepath.WalkDir`), use a pool to process each node concurrently. Each node prints its path.

**Acceptance:**
- All nodes printed.
- Concurrency is bounded by `maxWorkers`.
- Use `sync.WaitGroup` to know when all nodes have been processed.

**Trap:** Avoid the recursive `SubmitWait` deadlock by using `Submit` + `WaitGroup`.

---

## Task 17: Comparison Benchmark

**Goal:** Write a benchmark suite comparing:
1. `workerpool.Submit`.
2. Raw goroutine + `sync.WaitGroup`.
3. A hand-rolled `chan func() + N goroutines` pool.

For each, measure ns/op and allocations.

**Acceptance:**
- Benchmarks run cleanly with `go test -bench=. -benchmem`.
- You can articulate why each approach has the cost it does.

**Hint:** Keep the task itself trivial (atomic.AddInt64) so submit overhead is visible.

---

## Task 18: Production Wrapper

**Goal:** Build a complete production-grade wrapper with:
- Bounded queue (semaphore).
- Context-aware submit.
- Panic recovery with logging.
- Metrics (submitted, completed, dropped, queue_depth).
- Graceful shutdown with deadline.

**Acceptance:**
- Tests cover: normal flow, full queue, panic recovery, shutdown deadline.
- `go test -race` passes.
- The wrapper is 150-250 lines.

This is the capstone exercise. After completing it, you have a reusable component.

---

## Bonus Exercises

### Bonus A: Retry with Backoff

Build a task wrapper that retries on error, with exponential backoff (100ms, 200ms, 400ms, ...). Max 5 attempts.

### Bonus B: Circuit Breaker

Wrap submit with a circuit breaker: if 50% of recent tasks fail, reject new submits for 30 seconds.

### Bonus C: Priority Queueing

Build two pools: one high-priority (small), one low-priority (large). Route submissions based on a priority parameter.

### Bonus D: Adaptive Sizing

Periodically measure queue depth. If consistently > threshold, increase `maxWorkers` (via pool swap). If < threshold, decrease.

### Bonus E: Cross-Process Pool

Use `workerpool` inside a service that also receives RPC submissions. Combine an HTTP/gRPC handler with the pool. Implement a graceful shutdown.

---

## Submission Checklist

For each task you complete:

- [ ] Code compiles.
- [ ] Code runs and produces expected output.
- [ ] `go vet ./...` is clean.
- [ ] `go test -race ./...` passes (if applicable).
- [ ] No goroutine leaks (test with `runtime.NumGoroutine` before and after).
- [ ] Comments explain non-obvious choices.

---

## How to Use This List

- **Pick and choose:** Not all tasks suit everyone. Skim the list; do what interests you.
- **Build incrementally:** Each task is small (15-60 minutes typically). Do one a day.
- **Compare with others:** If you're learning with a team, do the tasks individually and compare solutions.
- **Extend:** Once you've done a task, modify the parameters and rerun. Build intuition.
- **Document:** Keep notes on what you learned from each task.

---

## After Completing All 18

You will:

- Have working code for every common pool use case.
- Understand the API end-to-end through muscle memory.
- Have caught common pitfalls (capture, deadlock, missing StopWait).
- Built a production-grade wrapper you can reuse.

You will be at the senior to professional level of `workerpool` fluency.

---

## A Note on Solutions

This file deliberately does not include full solutions. The point is to write the code yourself. If you get stuck:

1. Re-read the relevant sections of junior/middle/senior files.
2. Look at the library's own examples.
3. Ask a teammate or community.

The struggle is the learning.

---

## Going Beyond

Once you've completed these, propose your own exercises. Build a small library or CLI tool that uses `workerpool` end-to-end. Open-source it. The act of teaching others is the deepest form of learning.

---

## Final Encouragement

Eighteen tasks is enough to internalise this library. After completing them, you will be able to:

- Use the library confidently in any context.
- Spot subtle bugs in others' code.
- Decide when to use, wrap, fork, or migrate.
- Operate it in production with metrics and graceful shutdown.

Go write code.

---

## Appendix: Sample Solutions for Selected Tasks

To help you check your work, here are sample (not necessarily optimal) solutions for a few of the tasks. Try the task first; consult only when stuck.

### Sample for Task 1: Hello, Pool

```go
package main

import (
    "fmt"
    "time"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(2)
    defer pool.StopWait()

    for i := 1; i <= 5; i++ {
        i := i // shadow for pre-1.22 Go
        pool.Submit(func() {
            time.Sleep(100 * time.Millisecond)
            fmt.Printf("hello %d\n", i)
        })
    }
}
```

Output (one possible order):

```
hello 1
hello 2
hello 3
hello 4
hello 5
```

### Sample for Task 4: SumOfSquares

```go
package main

import (
    "fmt"
    "sync/atomic"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(runtime.NumCPU())
    defer pool.StopWait()

    var sum int64
    for i := 1; i <= 1_000_000; i++ {
        i := i
        pool.Submit(func() {
            atomic.AddInt64(&sum, int64(i)*int64(i))
        })
    }
    pool.StopWait()

    fmt.Println("sum of squares:", sum)
}
```

Note: this version is likely SLOWER than a sequential `for` loop because the per-task work is trivial. Try chunking:

```go
const chunkSize = 10000
for start := 1; start <= 1_000_000; start += chunkSize {
    start := start
    end := start + chunkSize
    if end > 1_000_001 {
        end = 1_000_001
    }
    pool.Submit(func() {
        local := int64(0)
        for i := start; i < end; i++ {
            local += int64(i) * int64(i)
        }
        atomic.AddInt64(&sum, local)
    })
}
```

Chunking reduces submit overhead.

### Sample for Task 9: Bounded Queue

```go
package main

import (
    "errors"
    "fmt"
    "sync/atomic"
    "time"

    "github.com/gammazero/workerpool"
)

type BoundedPool struct {
    inner *workerpool.WorkerPool
    sem   chan struct{}
}

func NewBoundedPool(maxW, cap int) *BoundedPool {
    return &BoundedPool{
        inner: workerpool.New(maxW),
        sem:   make(chan struct{}, cap),
    }
}

func (bp *BoundedPool) Submit(f func()) error {
    select {
    case bp.sem <- struct{}{}:
    default:
        return errors.New("pool full")
    }
    bp.inner.Submit(func() {
        defer func() { <-bp.sem }()
        f()
    })
    return nil
}

func (bp *BoundedPool) StopWait() {
    bp.inner.StopWait()
}

func main() {
    bp := NewBoundedPool(4, 10)
    defer bp.StopWait()

    var accepted, dropped int64
    for i := 0; i < 100; i++ {
        if err := bp.Submit(func() {
            time.Sleep(100 * time.Millisecond)
        }); err != nil {
            atomic.AddInt64(&dropped, 1)
        } else {
            atomic.AddInt64(&accepted, 1)
        }
    }
    fmt.Printf("accepted=%d dropped=%d\n", accepted, dropped)
}
```

### Sample for Task 12: Drain with Deadline

```go
package main

import (
    "fmt"
    "sync/atomic"
    "time"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(4)

    var done int64
    for i := 0; i < 50; i++ {
        pool.Submit(func() {
            time.Sleep(500 * time.Millisecond)
            atomic.AddInt64(&done, 1)
        })
    }

    drained := make(chan struct{})
    go func() {
        pool.StopWait()
        close(drained)
    }()

    select {
    case <-drained:
        fmt.Println("clean drain")
    case <-time.After(2 * time.Second):
        before := pool.WaitingQueueSize()
        pool.Stop()
        <-drained
        fmt.Printf("deadline; dropped %d\n", before)
    }
    fmt.Println("completed:", atomic.LoadInt64(&done))
}
```

Expected output (timing-dependent):
```
deadline; dropped ~30
completed: ~16-20
```

### Sample for Task 18: Production Wrapper

See the `Pool` type in the professional file (Appendix H). Use that as a reference implementation. Type it out yourself rather than copy-pasting; the typing is part of the learning.

---

## Appendix: Common Errors While Doing These Tasks

### "fatal error: all goroutines are asleep - deadlock!"

You probably called `SubmitWait` inside a task on a small pool. Switch to `Submit` + `WaitGroup`.

### "panic: send on closed channel"

You stopped the pool while a goroutine was mid-Submit. Stop producers before stopping the pool.

### Race detector warnings

Shared state without synchronisation. Add a mutex, an atomic, or use a channel.

### Tasks not running

Either you forgot `StopWait`, or the pool was already stopped. Check both.

### Memory growing during run

Unbounded queue with fast producer. Add a semaphore.

---

## Appendix: Extending the Tasks

After completing all 18, try:

1. Modify each task to use `ants` instead of `workerpool`. Note the API differences.
2. Modify each task to use raw goroutines + WaitGroup. Note the line count differences.
3. Modify each task to use `errgroup.SetLimit`. Note when this is simpler.
4. Write benchmarks comparing the three.

This expanded exercise gives you broad pool-library fluency.

---

## Appendix: Group Exercises

If you're learning with others, try:

### Pair Programming

Two people, one keyboard. Switch every 15 minutes. One drives, one navigates. Code-review as you go.

### Code Reading

Pick a task. Each person writes their solution privately. Then trade and review. Discuss differences.

### Time-Boxed Sprints

30 minutes per task. After time is up, share solutions and discuss what was learned.

### Bug Injection

Each person writes a correct solution, then introduces a subtle bug. Trade and find the bugs.

These group exercises accelerate learning beyond solo study.

---

## Appendix: Building a Portfolio

Each completed task adds to your portfolio. Save them in a public repo:

```
wp-exercises/
├── task01-hello/
├── task02-loop-capture/
├── ...
└── task18-production-wrapper/
```

Each subdirectory has its own `main.go` (or `pool.go` + test file). README describes the task and your approach.

A potential employer scanning your GitHub sees that you've practiced a real library deeply. That's distinctive.

---

## Appendix: Reflections After Each Task

After each task, write 100 words:

- What worked?
- What didn't?
- What surprised you?
- What would you do differently next time?

Reflection cements learning. The act of writing forces deeper processing.

After 18 reflections, you have a personal record of your learning journey with this library. Reread it in six months; you'll be surprised what you'd forgotten.

---

## End of Tasks

Practice beats reading. Eighteen tasks is plenty. Pick five for today; ten for the week; eighteen for the month.

Code. Run. Observe. Repeat. That is how mastery happens.

