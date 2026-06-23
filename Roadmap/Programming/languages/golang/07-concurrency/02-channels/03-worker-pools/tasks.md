# Worker Pools — Tasks

Hands-on exercises for the worker pool pattern. Each task includes a goal, constraints, hints, and a stretch variant. Solve them in order — later tasks build on earlier ones.

## Table of Contents
1. [Setup](#setup)
2. [Junior Tasks](#junior-tasks)
3. [Mid-Level Tasks](#mid-level-tasks)
4. [Senior Tasks](#senior-tasks)
5. [Project Tasks](#project-tasks)
6. [Self-Review Checklist](#self-review-checklist)

---

## Setup

```bash
mkdir worker-pool-exercises
cd worker-pool-exercises
go mod init exercises
go get golang.org/x/sync/errgroup
go get golang.org/x/sync/semaphore
```

Run every solution with `go run ./cmd/<task>` and tests with `go test -race ./...`.

---

## Junior Tasks

### Task 1 — Squarer

**Goal:** Build a 30-line worker pool that squares 100 integers using 4 workers.

**Requirements:**
- Use `sync.WaitGroup`.
- Buffered jobs and results channels.
- Print results in any order.

**Hint:** Closer goroutine + `for r := range results`.

**Stretch:** Print results in input order using an index field.

---

### Task 2 — File Hasher

**Goal:** Walk a directory and SHA-256 each file in parallel.

**Requirements:**
- Pool of `runtime.NumCPU()` workers.
- Each worker reads a file path from `jobs` and emits `{path, hash}` to `results`.
- Skip directories and unreadable files (log and continue).

**Hint:** Use `filepath.Walk` to populate jobs. Buffered jobs channel of size 64.

**Stretch:** Print a final summary line with total files, total bytes, total elapsed.

---

### Task 3 — URL Fetcher

**Goal:** Fetch a list of URLs and print status code + body length.

**Requirements:**
- Pool of 8 workers.
- Each worker performs an HTTP GET with a 5-second timeout.
- On error, log "URL %s: error %v".

**Hint:** Use `http.Client{Timeout: 5*time.Second}` shared across workers.

**Stretch:** Compute aggregate stats: total bytes, average latency, error rate.

---

### Task 4 — CSV Parser

**Goal:** Read a 1 GB CSV in parallel.

**Requirements:**
- Producer reads lines from a CSV (one line per job).
- Pool of 16 workers parses each line into a struct.
- Consumer counts valid rows and errors.

**Hint:** `encoding/csv` with `Read` per line in the producer.

**Stretch:** Compute a histogram of one numeric column from valid rows.

---

### Task 5 — Word Counter

**Goal:** Count word frequencies across a list of files in parallel.

**Requirements:**
- Pool of NumCPU workers.
- Each worker tokenises one file and produces a partial count map.
- Consumer merges partial maps into a global map.

**Hint:** Workers return `map[string]int`; consumer does `for k, v := range m`.

**Stretch:** Print the top 10 most frequent words.

---

## Mid-Level Tasks

### Task 6 — Cancellable Pool

**Goal:** Add `context.Context` cancellation to Task 3.

**Requirements:**
- Pool accepts a context.
- Workers check `ctx.Done()` between jobs and inside the HTTP call.
- Cancel after 10 seconds; partial results are acceptable.

**Hint:** Two `select`s: outer for jobs/cancel, inner for results/cancel. Pass ctx to `http.NewRequestWithContext`.

**Stretch:** After cancellation, print how many requests completed and how many were cancelled mid-flight.

---

### Task 7 — Errgroup Migration

**Goal:** Convert Task 5 (word counter) to use `errgroup`.

**Requirements:**
- `errgroup.WithContext`.
- `g.SetLimit(NumCPU)`.
- Return the first file-read error.
- Aggregate counts in a thread-safe map.

**Hint:** `sync.Mutex` around the global map, or use a per-goroutine partial map merged after `g.Wait()`.

**Stretch:** Replace the mutex with sharded maps (16 shards, hash key to shard) for better concurrency.

---

### Task 8 — Bounded Submit

**Goal:** Build a `Submit(ctx, job)` API that returns `ErrPoolFull` when the queue is full.

**Requirements:**
- Pool struct with `Submit`, `Stop`, `Results()` methods.
- `Submit` uses `select` with a `default` case for non-blocking send.
- `Stop` closes jobs channel and waits for drain.

**Hint:**

```go
select {
case p.jobs <- j: return nil
case <-ctx.Done(): return ctx.Err()
default: return ErrPoolFull
}
```

**Stretch:** Add a `TrySubmit` (non-blocking) and a `BlockingSubmit` (blocks indefinitely).

---

### Task 9 — Per-Job Timeout

**Goal:** Add per-job timeouts to Task 6.

**Requirements:**
- Each HTTP fetch has its own 2-second timeout.
- Parent context still applies (whichever fires first).
- Log timed-out jobs separately.

**Hint:** `context.WithTimeout(parentCtx, 2*time.Second)` inside the worker; defer cancel.

**Stretch:** Track P50, P95, P99 latency of completed jobs.

---

### Task 10 — Pipeline of Pools

**Goal:** Build a 3-stage pipeline: download → resize → upload.

**Requirements:**
- Stage 1: 16 download workers (HTTP).
- Stage 2: NumCPU resize workers (CPU-bound; use a placeholder `time.Sleep`).
- Stage 3: 8 upload workers (HTTP).
- Each stage closes its own output channel after its workers exit.

**Hint:** Each stage is a function returning the output channel: `func stage(in <-chan T) <-chan U`.

**Stretch:** Make each stage size configurable; emit per-stage metrics.

---

### Task 11 — Result Ordering

**Goal:** Build a pool that emits results in input order despite concurrent processing.

**Requirements:**
- Each job has an index.
- Output is a slice indexed by input index OR a stream that emits in order using a reorder buffer.
- Pool of 8.

**Hint:** Slice version: `results[j.Index] = result`. Stream version: use a min-heap or map keyed by next-expected index.

**Stretch:** Implement both versions and benchmark them.

---

### Task 12 — Retry-on-Error Pool

**Goal:** Workers retry transient errors up to 3 times with exponential backoff.

**Requirements:**
- Wrap `process` in a retry loop.
- Distinguish transient errors (network, 5xx) from permanent (4xx, parse).
- Backoff: 100 ms, 200 ms, 400 ms (with jitter).

**Hint:** `errors.Is` to classify. `time.Sleep(backoff + rand jitter)` between retries.

**Stretch:** Move retries to a separate retry pool fed by failed jobs.

---

## Senior Tasks

### Task 13 — Adaptive Concurrency Control

**Goal:** Implement a pool whose size adjusts based on success/failure ratio (AIMD).

**Requirements:**
- Start at N=4. On 10 consecutive successes, +1 (max 32). On any failure, halve (min 4).
- Use semaphore approach (no long-lived workers).

**Hint:** A goroutine adjusts the semaphore capacity by spawning/closing tokens.

**Stretch:** Use the Vegas algorithm (latency-based) instead.

---

### Task 14 — Shutdown with Deadline

**Goal:** Implement `Stop(ctx)` that drains in-flight jobs but cancels them if the context fires first.

**Requirements:**
- Stop() closes jobs.
- Wait for workers to drain.
- If ctx fires, cancel pool's internal context to force exit.
- Return `ErrShutdownTimeout` if cancelled.

**Hint:** Two channels: `jobsClosed` and `done`. Race them against `ctx.Done()`.

**Stretch:** Emit a metric for jobs that were cancelled mid-process.

---

### Task 15 — Sharded Pool

**Goal:** Build a pool that routes jobs to N shards based on a key, so same-key jobs hit the same worker (locality).

**Requirements:**
- 16 shards, each with its own pool of 4 workers.
- `Submit(key string, j Job)` hashes key to a shard.
- Each shard maintains its own LRU cache for hot keys.

**Hint:** `fnv32a.Hash(key) % 16`. Per-shard cache (no need for cross-shard sync).

**Stretch:** Add per-shard metrics; identify hot shards.

---

### Task 16 — Pool with sync.Pool

**Goal:** Reduce allocations in a pool that processes 1 GiB of data through 1 KiB buffers.

**Requirements:**
- Each worker `Get`s a buffer from a `sync.Pool`.
- Process; copy out result; `Put` buffer back (reset first).
- Verify allocation reduction with `go test -bench -benchmem`.

**Hint:** `bufPool.New = func() any { return make([]byte, 0, 1024) }`. Always copy out (`append([]byte(nil), buf...)`) before Put.

**Stretch:** Compare `sync.Pool` vs reusable per-worker buffer (no pool, just a worker-local slice). Which wins?

---

### Task 17 — Multi-Error Aggregation

**Goal:** Run a pool that processes 1000 jobs and collects every error (not just the first).

**Requirements:**
- Use `errors.Join` (Go 1.20+) or `go.uber.org/multierr`.
- Pool size 8. Don't fail fast.
- Final return: `(successCount int, errs error)`.

**Hint:** Mutex-protected `errors.Join(errs, err)` after each failure. Or per-worker error slice merged at the end.

**Stretch:** Group errors by type (network, parse, timeout) and report counts.

---

### Task 18 — Goroutine Leak Test

**Goal:** Write a test that detects when a pool leaks goroutines.

**Requirements:**
- Helper: `withLeakCheck(t, fn)` records `runtime.NumGoroutine()` before/after, fails if higher.
- Test cases: forgot to close jobs, blocked send, panic with no recover.

**Hint:** Allow some flexibility (goroutines may take a moment to exit; loop with `time.Sleep` for ~50 ms before final check).

**Stretch:** Print the goroutine stacks of leaked goroutines using `runtime.Stack`.

---

### Task 19 — Rate-Limited Pool

**Goal:** Pool of 64 workers feeding a downstream that allows 50 req/s.

**Requirements:**
- `golang.org/x/time/rate.Limiter`.
- Workers call `limiter.Wait(ctx)` before each downstream call.
- Verify under benchmark that throughput plateaus at 50 req/s, not faster.

**Hint:** `rate.NewLimiter(rate.Limit(50), 10)`. The burst (10) lets short bursts proceed.

**Stretch:** Plot throughput over 5 minutes; verify the limiter smooths bursts.

---

### Task 20 — Bulkhead by Tenant

**Goal:** Multi-tenant pool that prevents tenant A from starving tenant B.

**Requirements:**
- Map of tenant ID → Pool.
- Each tenant pool has its own queue and N workers.
- `Submit(tenantID, j)` routes to the right pool.

**Hint:** Lazy-create tenant pools on first submit; keep a registry with a mutex.

**Stretch:** Auto-evict tenant pools that have been idle for 10 minutes.

---

## Project Tasks

### Project 1 — Parallel Web Crawler

**Goal:** Build a respectful web crawler with a worker pool.

**Requirements:**
- Seed URLs.
- Workers fetch, parse for links, enqueue new URLs.
- Bound to a single domain (don't crawl the wider web in tests).
- Per-host rate limit (1 req/s per host).
- Max depth (default 3).
- Max pages (default 100).

**Sketch:**

```text
[seed URLs] → [URL queue] → [N fetch workers] → [parser pool] → [more URLs]
                  ▲                                                  │
                  └──────── visited set ◄────────────────────────────┘
```

**Stretch:** Persist the visited set to disk so a restart resumes.

---

### Project 2 — Image Thumbnailer Service

**Goal:** HTTP service that accepts image uploads and generates 3 thumbnails.

**Requirements:**
- POST /upload → returns 202 + job ID.
- Worker pool of NumCPU performs resize (placeholder `time.Sleep` is fine if you don't have libvips).
- GET /status/{id} → returns "queued", "processing", "done", or "failed".
- Bounded queue; reject (429) when full.

**Stretch:** Add S3 upload as a second pipeline stage with its own pool.

---

### Project 3 — Batch Importer

**Goal:** CLI that reads a CSV and inserts rows into Postgres in parallel.

**Requirements:**
- Parser pool (NumCPU workers, validates rows).
- Writer pool (matches DB max_connections; 8 by default).
- Batches: writers receive 100 rows at a time.
- Idempotent: re-running on the same CSV produces the same DB state.

**Stretch:** Resume from the last successful batch on crash.

---

### Project 4 — Webhook Fanout

**Goal:** Service that, on each event, POSTs to up to 10k subscribers.

**Requirements:**
- Subscriber registry (in memory is fine).
- Per-subscriber rate limit (5 req/s).
- Fanout pool of 64.
- Retry pool (separate) for failed deliveries: 3 attempts with exponential backoff.
- Dead-letter queue for permanently failed deliveries.

**Stretch:** Add a circuit breaker per subscriber.

---

### Project 5 — Log Shipper

**Goal:** Service that reads JSON log lines from stdin, batches them, and sends to a remote endpoint.

**Requirements:**
- Reader: parses lines from stdin.
- Batcher: groups into batches of 100 lines or 5 seconds (whichever first).
- Sender pool: 4 workers POST batches.
- Bounded queues throughout; on overload, drop with metrics.

**Stretch:** Add gzip compression to batches; measure throughput improvement.

---

## Self-Review Checklist

For each task, verify:

- [ ] Compiles with `go build`.
- [ ] Passes `go test -race`.
- [ ] No goroutine leaks (`runtime.NumGoroutine()` stable).
- [ ] Channels closed exactly once.
- [ ] Every `wg.Add` matched by `wg.Done`.
- [ ] `ctx.Done()` honored in worker, producer, and (where needed) consumer.
- [ ] Errors handled (logged, embedded, or aggregated).
- [ ] Pool size justified (CPU-bound? I/O-bound? downstream limit?).
- [ ] Buffer sizes justified (default `N` jobs and `N` results).
- [ ] Graceful shutdown completes without dropping in-flight work.

A solution that doesn't tick all of these is not done.
