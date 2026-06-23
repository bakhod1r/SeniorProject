---
layout: default
title: Tasks
parent: tunny
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/02-tunny/tasks/
---

# tunny — Tasks

This file contains 20 graded exercises. They run from "first program with tunny" to "production-grade service". Work through them in order. Most should take 15-60 minutes; a few are larger.

Solutions are not provided — by design. The point is to type the code, run it, and debug it. The other files in this series serve as references.

---

## Task 1 — Hello, tunny

**Goal:** Write a 10-line program that uses `tunny.NewFunc` to compute the square of a number.

**Specification:**
- Pool size: 1.
- Payload: an `int`.
- Result: an `int` (squared).
- Print the result of `Process(7)`.

**Acceptance:**
- The program prints `49`.
- The program exits cleanly without leaking goroutines.

---

## Task 2 — Pool with multiple callers

**Goal:** Write a program that uses a pool of size 4 to process 20 payloads concurrently.

**Specification:**
- Spawn 20 goroutines.
- Each goroutine calls `Process(i)` for `i` in 0..19.
- Each payload should be squared by the worker.
- Collect results into a slice indexed by `i`.

**Acceptance:**
- All 20 results are correct (`i*i`).
- The program uses `sync.WaitGroup` to wait for completion.
- The pool is closed cleanly.

---

## Task 3 — Type-safe wrapper

**Goal:** Wrap `tunny.NewFunc` in a typed adapter so callers do not see `interface{}`.

**Specification:**
- Define a `StringHasher` type that wraps a tunny pool.
- `NewStringHasher(n int)` returns `*StringHasher`.
- `(*StringHasher).Hash(s string) []byte` returns the SHA-256 of `s`.
- `(*StringHasher).Close()` releases the pool.

**Acceptance:**
- Compiler enforces the types.
- `Hash` produces correct SHA-256 values.
- No type assertions outside the wrapper.

---

## Task 4 — Sized from runtime

**Goal:** Make pool size dynamic based on the machine.

**Specification:**
- Pool size = `runtime.NumCPU()`.
- Print the pool size at startup.
- Process 100 payloads of CPU-bound work (e.g. a 100 ms busy loop).
- Measure and print the total wall-clock time.

**Acceptance:**
- On a 4-core machine, the wall time is approximately 100 * 0.1 / 4 = 2.5 seconds.
- The program respects the machine's parallelism budget.

---

## Task 5 — Worker with state

**Goal:** Move from `NewFunc` to `New` with the `Worker` interface, using per-worker state.

**Specification:**
- Define a struct `*Hasher` with a `hash.Hash` field.
- Implement the `Worker` interface.
- `Process([]byte) any` returns the hash of the bytes.
- The `hash.Hash` is reused across calls — call `Reset` before each `Write` + `Sum`.

**Acceptance:**
- Pool of size 4 hashes 1000 random payloads.
- Hashes are correct.
- The hash object is reused (verify by adding a counter and printing it at end).

---

## Task 6 — ProcessTimed deadlines

**Goal:** Use `ProcessTimed` to enforce a per-call deadline.

**Specification:**
- Pool of size 1 with a worker that sleeps for 1 second.
- Caller calls `ProcessTimed` with a 100 ms timeout.
- Print the result and the error.

**Acceptance:**
- The result is `nil`.
- The error is `tunny.ErrJobTimedOut`.
- The worker eventually finishes (you can verify with logging).

---

## Task 7 — ProcessCtx with HTTP request

**Goal:** Use `ProcessCtx` inside an HTTP handler so client disconnects propagate.

**Specification:**
- HTTP server on `localhost:8080`.
- Pool of size 4, each worker doing 500 ms of CPU work.
- The handler calls `ProcessCtx(r.Context(), ...)`.
- If the caller disconnects, the worker should be interrupted (Hint: implement `Interrupt`).

**Acceptance:**
- A normal `curl` returns the result.
- `curl --max-time 0.2` cancels mid-flight. The server logs the cancellation; the worker stops.

---

## Task 8 — Implement Interrupt correctly

**Goal:** Add a working `Interrupt` to a sleeping worker so deadlines can cancel it.

**Specification:**
- Worker's `Process` sleeps for 1 second by default.
- The sleep should be cancellable via `Interrupt`.
- Use a `context.WithCancel` inside `Process`; `Interrupt` calls the cancel function.

**Acceptance:**
- `ProcessTimed(payload, 100ms)` returns within ~100 ms (not 1 s).
- `Process(payload)` runs for the full 1 s.

---

## Task 9 — BlockUntilReady with a rate limiter

**Goal:** Use `BlockUntilReady` to throttle workers via a shared `rate.Limiter`.

**Specification:**
- Pool of size 8.
- All workers share a single `golang.org/x/time/rate.Limiter` allowing 10 events per second.
- Each `BlockUntilReady` calls `lim.Wait(ctx)`.
- `Process` does trivial work (e.g. just returns the payload).
- Measure throughput by submitting 100 calls and timing.

**Acceptance:**
- Total time ≥ 10 seconds (100 calls at 10/s).
- All workers are throttled identically.

---

## Task 10 — Worker with database connection

**Goal:** Each worker holds a dedicated database connection.

**Specification:**
- Define a `*DBWorker` with a `*sql.DB.Conn` field.
- `Process` runs a simple `SELECT 1` query.
- The factory opens a connection per worker.
- `Terminate` closes the connection.

**Acceptance:**
- Pool of size 4 has 4 active DB connections.
- After `Close`, all connections are released.

If you do not have a database, simulate with a fake "connection" type.

---

## Task 11 — Image resize service

**Goal:** Build a small image processing service.

**Specification:**
- HTTP endpoint `/resize?w=N&h=N` accepts a JPEG body.
- Pool of size `NumCPU` decodes, resizes, encodes as PNG.
- Each worker reuses a `bytes.Buffer`.
- Per-call timeout of 5 seconds via `ProcessCtx`.

**Acceptance:**
- A `curl -d @image.jpg ...` returns a PNG.
- The service does not OOM on 100 concurrent requests.
- Metrics show queue length growing under load.

---

## Task 12 — Graceful shutdown

**Goal:** Add graceful shutdown to the service from Task 11.

**Specification:**
- The service catches SIGTERM and SIGINT.
- HTTP server shuts down first.
- The pool drains (waits for queue to empty).
- The pool closes last.
- Bound by a 30-second timeout.

**Acceptance:**
- Trigger `kill -TERM <pid>`. The service exits cleanly.
- In-flight requests complete before exit.
- The exit code is 0.

---

## Task 13 — Metrics export

**Goal:** Export Prometheus metrics for the pool.

**Specification:**
- Three metrics: `pool_size`, `pool_queue_length`, `process_duration_seconds`.
- Expose on `:9090/metrics`.
- A goroutine updates `pool_queue_length` every 5 seconds.

**Acceptance:**
- `curl localhost:9090/metrics` returns the expected text format.
- Under load, `pool_queue_length` is visible.

---

## Task 14 — Panic recovery

**Goal:** Add panic recovery to a worker.

**Specification:**
- Wrap the worker's `Process` with `defer recover()`.
- On panic, return a typed error.
- Test by passing a payload that triggers a panic (e.g. an int when a string is expected).

**Acceptance:**
- The service does NOT crash.
- The error is returned to the caller.
- The pool keeps serving other requests.

---

## Task 15 — Typed generic pool

**Goal:** Build a `Pool[In, Out any]` generic wrapper.

**Specification:**
- Constructor: `NewPool[In, Out any](n int, fn func(In) Out) *Pool[In, Out]`.
- Method: `Run(in In) Out`.
- Method: `Close()`.
- Behind the scenes, uses `tunny.NewFunc`.

**Acceptance:**
- Compile-time type safety.
- Usable: `p := NewPool(4, func(s string) int { return len(s) })`.
- `n := p.Run("hello")` is `5`.

---

## Task 16 — Pool registry

**Goal:** Manage multiple pools centrally.

**Specification:**
- A `Registry` type that holds named pools.
- Methods: `Register(name, *tunny.Pool)`, `Get(name) (*tunny.Pool, ok)`, `CloseAll()`, `Stats() map[string]int64`.
- Stats returns each pool's queue length.

**Acceptance:**
- Multiple pools can be registered.
- `CloseAll` closes them in order.
- Concurrent access is safe.

---

## Task 17 — Priority pool

**Goal:** Implement a priority pool with two underlying tunny pools.

**Specification:**
- `PriorityPool` has `high` and `low` priority tunny pools.
- Method: `High(ctx, in)` routes to the high-priority pool.
- Method: `Low(ctx, in)` routes to the low-priority pool.
- Sizes configurable independently.

**Acceptance:**
- High-priority calls do not queue behind low-priority calls.
- Both pools share the same worker logic.
- Both close cleanly.

---

## Task 18 — Soak test

**Goal:** Run a tunny-backed service under sustained load for 1 hour.

**Specification:**
- Use the service from Task 11.
- Drive it with `hey` or similar at 50 RPS for 1 hour.
- Monitor memory, goroutine count, p99 latency.

**Acceptance:**
- Memory stable (within 20%).
- Goroutine count stable.
- p99 latency stable.

If something drifts, find and fix the cause. This is the most valuable exercise in the list.

---

## Task 19 — Live pool resize

**Goal:** Add an admin endpoint to resize the pool at runtime.

**Specification:**
- HTTP endpoint `/admin/pool/size?n=N` calls `SetSize(N)`.
- Authentication required (any mechanism).
- Validate `N >= 1`.
- Log the change with old and new sizes.

**Acceptance:**
- `curl -X POST -u admin:secret 'http://localhost:8080/admin/pool/size?n=16'` resizes the pool.
- Concurrent requests during resize work correctly.

---

## Task 20 — End-to-end production service

**Goal:** Build a complete production-grade tunny service.

**Specification:** Combine Tasks 11, 12, 13, 14, 16, 18:

- HTTP service with `/resize` and `/healthz`.
- Pool sized from config.
- Graceful shutdown.
- Prometheus metrics.
- Panic recovery.
- Pool registry (for multiple pools).
- Soak test passes.

**Acceptance:**
- The service deploys cleanly to a Kubernetes cluster (or equivalent).
- Metrics flow to Prometheus.
- Alerts can be configured.
- The service survives a 24-hour soak test.

This is the "you have built it for real" task. Allocate a week.

---

## Conclusion

Twenty tasks, graded. By the end you have built everything from a hello-world to a production-grade service.

If you complete all twenty, you are operationally fluent in tunny. Pick the next library to learn this way, and the next, and the next. The discipline compounds.

If you complete fewer than ten, work through them in order before moving on. Skipping ahead does not save time.

If a task takes much longer than expected, the difficulty is usually in the surrounding code (HTTP handling, deployment, etc), not in tunny itself. Tunny is small; everything else is the production discipline.

---

## Hints

A few hints for the harder tasks.

### Hint for Task 11 — image resize

Use `image/jpeg` for decode, `image/png` for encode. `golang.org/x/image/draw.CatmullRom.Scale` for resizing. Reuse `bytes.Buffer` on the worker.

### Hint for Task 12 — graceful shutdown

Use `signal.NotifyContext` (Go 1.16+) to bind shutdown to a context. Drain by polling `pool.QueueLength()`. Use a `select` with the shutdown context to bound the drain.

### Hint for Task 13 — Prometheus

Use `prometheus/client_golang/prometheus/promauto` for self-registering metrics. Use `promhttp.Handler()` for the endpoint.

### Hint for Task 14 — panic recovery

Use a named return value in `Process`:

```go
func (w *worker) Process(p any) (out any) {
    defer func() {
        if r := recover(); r != nil {
            out = fmt.Errorf("panic: %v", r)
        }
    }()
    return realWork(p)
}
```

### Hint for Task 18 — soak test

Tools: `hey`, `vegeta`, `k6`. Watch metrics with `runtime.NumGoroutine()` logged periodically and via Prometheus. Look for monotonic growth.

### Hint for Task 19 — live resize

`SetSize` is goroutine-safe. Just expose it. Be careful about authentication; never expose admin endpoints without it.

---

## After You Finish

Pick a topic that gave you trouble. Read the relevant chapter again. Re-do the task.

Then move on: build something tunny-shaped in your day job. Real code teaches faster than exercises.

---

## Stretch Tasks

If you finished all twenty, here are five more for extra depth.

### Stretch 1 — Custom dispatcher

Build your own pool that wraps tunny but adds a custom dispatch policy (e.g. round-robin instead of pseudo-random). You will likely need many size-1 pools internally.

### Stretch 2 — Distributed pool

Coordinate two services, each with its own tunny pool, via a message queue. Demonstrate that work flows across them based on capacity.

### Stretch 3 — Performance profile

Take the service from Task 11. Use `pprof` and `go tool trace` to identify the top three CPU consumers. Optimize one of them. Measure throughput before and after.

### Stretch 4 — Tunny vs ants benchmark

Build the same simple workload using tunny and ants. Benchmark both at various pool sizes. Document the results. Decide which is better for that workload and why.

### Stretch 5 — Write a blog post

Take what you learned from these tasks and write a 1500-word blog post: "What I learned building a tunny-backed service". Publish it. Teaching is the best way to consolidate.

---

## Submitting Solutions

These tasks are for your own learning. There is no submit button. But you may find value in:

- Posting your solutions on GitHub for peer review.
- Walking through a difficult task with a colleague.
- Comparing your approach to the patterns in `middle.md`.

The exercise of writing and explaining your code is where most learning happens.

---

## Time Budget

A rough estimate:

- Tasks 1-5: 15 minutes each. Total: 75 minutes.
- Tasks 6-10: 30 minutes each. Total: 2.5 hours.
- Tasks 11-15: 60 minutes each. Total: 5 hours.
- Tasks 16-19: 1-2 hours each. Total: 6 hours.
- Task 20: 1 week.
- Stretch tasks: variable.

Total for tasks 1-19: about two days of focused work. Spread over two weeks of part-time work. Reasonable for someone new to tunny who wants to be fluent.

---

## Final Tips

1. **Type the code yourself.** Copy-pasting does not teach.
2. **Run it.** Read the output. Match what you expected.
3. **Break it on purpose.** Skip the `defer Close`. See what happens.
4. **Compare with the other files.** When stuck, re-read the relevant chapter.
5. **Move on.** If a task takes much longer than the budget, you may be missing context. Skim the related file, then return.

You are building skill. Skill takes time. Be patient with the process.

End of tasks file. Good luck.

---

## Postscript

Working through twenty tasks is a serious investment. Most engineers will not do it. Those who do gain a level of fluency that those who do not cannot fake.

If you complete this list, you can confidently claim "I know tunny" — and back it up with code.

Practice is the differentiator. Theory plus practice produces engineers who can ship.

Now go ship.

End.

---

If you build something good with tunny, share it with the community. Open-source repos teach others. Be that teacher.
