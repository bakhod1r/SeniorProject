# Goroutine Best Practices — Tasks

## Table of Contents
1. [How to use this file](#how-to-use-this-file)
2. [Task 1 — Apply the twelve rules](#task-1--apply-the-twelve-rules)
3. [Task 2 — Build a `safeGo` helper](#task-2--build-a-safego-helper)
4. [Task 3 — Convert hand-rolled coordination to `errgroup`](#task-3--convert-hand-rolled-coordination-to-errgroup)
5. [Task 4 — Bound concurrency](#task-4--bound-concurrency)
6. [Task 5 — Graceful shutdown](#task-5--graceful-shutdown)
7. [Task 6 — Eliminate `time.Sleep`](#task-6--eliminate-timesleep)
8. [Task 7 — Add `goleak` to a test package](#task-7--add-goleak-to-a-test-package)
9. [Task 8 — Document concurrency safety](#task-8--document-concurrency-safety)
10. [Task 9 — Find races with `-race`](#task-9--find-races-with--race)
11. [Task 10 — Pprof goroutine analysis](#task-10--pprof-goroutine-analysis)
12. [Task 11 — Build a worker pool with all the rules](#task-11--build-a-worker-pool-with-all-the-rules)
13. [Task 12 — Stretch tasks](#task-12--stretch-tasks)

---

## How to use this file

Each task has:

- **Problem.** What to build or fix.
- **Constraints.** Rules that must hold.
- **Acceptance.** How to know you're done.
- **Hints.** Where to look in junior/middle if stuck.

Solutions are intentionally not provided — the point is to write the code yourself and verify against the acceptance criteria. Use the race detector and `goleak` everywhere.

---

## Task 1 — Apply the twelve rules

**Problem.** Take the following broken function and rewrite it so it satisfies every rule from junior:

```go
func processAll(items []Item) {
    var wg sync.WaitGroup
    for _, item := range items {
        go func() {
            wg.Add(1)
            defer wg.Done()
            process(item)
        }()
    }
    time.Sleep(time.Second)
}
```

**Constraints.**

- Each goroutine has a documented exit story.
- `wg.Add` is in the parent.
- Loop variable is passed as a parameter.
- Function takes `ctx context.Context` as its first parameter.
- Panics in `process` are recovered.
- Concurrency is bounded at 16.
- No `time.Sleep`.
- The function returns an error if `ctx` cancels.

**Acceptance.**

- The function passes `go test -race`.
- A `goleak.VerifyNone` after calling it passes.
- A cancellation test (cancel `ctx` mid-flight) returns within 100 ms.

**Hints.** junior § Rules 1, 2, 3, 4, 5, 8, 10. Use `errgroup.WithContext` and `g.SetLimit`.

---

## Task 2 — Build a `safeGo` helper

**Problem.** Implement a helper package `safego` with the signature:

```go
package safego

// Go runs fn in a new goroutine. If fn panics, the panic is recovered,
// logged with the goroutine name, and a metric is incremented.
func Go(name string, fn func())

// GoCtx is like Go but threads a context.
func GoCtx(ctx context.Context, name string, fn func(context.Context))
```

**Constraints.**

- Recovery logs the panic value, the stack trace, and the goroutine name.
- A metric `safego_panics_total{name="..."}` (any implementation; a global `map[string]int` with a mutex is fine for the exercise) is incremented.
- No imports outside the standard library and `golang.org/x/sync` (for tests).
- `GoCtx` does not start the goroutine if `ctx` is already cancelled.

**Acceptance.**

- A test that calls `safego.Go("test", func(){ panic("boom") })` does not crash the process.
- The test asserts the metric was incremented.
- `goleak.VerifyTestMain(m)` passes.

**Hints.** junior § Rule 5, Example 4. The "ctx cancelled before start" check is `if ctx.Err() != nil { return }`.

---

## Task 3 — Convert hand-rolled coordination to `errgroup`

**Problem.** Convert this function to use `errgroup`:

```go
func fetchAll(urls []string) ([]Response, error) {
    var wg sync.WaitGroup
    results := make([]Response, len(urls))
    errs := make(chan error, len(urls))

    for i, url := range urls {
        wg.Add(1)
        go func(i int, url string) {
            defer wg.Done()
            r, err := fetch(url)
            if err != nil {
                errs <- err
                return
            }
            results[i] = r
        }(i, url)
    }
    wg.Wait()
    close(errs)

    for err := range errs {
        if err != nil {
            return nil, err
        }
    }
    return results, nil
}
```

**Constraints.**

- The new function accepts `ctx context.Context` and propagates it.
- Concurrency is bounded at 8.
- First error cancels peers.
- No goroutine leak.

**Acceptance.**

- The new code is shorter (likely ~50% the lines).
- `go test -race` passes.
- `goleak.VerifyNone` passes.

**Hints.** junior § Rule 6, middle § "`errgroup` in Anger".

---

## Task 4 — Bound concurrency

**Problem.** Take an HTTP handler that spawns a goroutine per request to do background work. Bound the in-flight count at 100 globally.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    go background(r.Context())
    w.WriteHeader(202)
}
```

**Constraints.**

- At most 100 concurrent `background` calls across all requests.
- If the cap is reached, the handler returns 503.
- Each `background` recovers panics.
- Each `background` respects its context.

**Acceptance.**

- A test that spawns 200 concurrent requests sees ~100 succeed and ~100 fail with 503.
- The 100 that succeed all complete eventually.
- `goleak.VerifyNone` after the test passes.

**Hints.** junior § Rule 10. A semaphore channel of size 100 is the simplest implementation. Use `select` with a `default` case to non-blockingly try to acquire.

---

## Task 5 — Graceful shutdown

**Problem.** Build a small service with:

- An HTTP server on port 8080 that takes 1-5 seconds per request.
- A background goroutine that ticks every second and logs the count of in-flight requests.
- A SIGTERM handler that shuts everything down within 30 seconds.

**Constraints.**

- All goroutines use a single root context.
- On SIGTERM, no new requests are accepted, in-flight requests are drained, the background ticker stops.
- If shutdown takes more than 30 seconds, log "force exit" and call `os.Exit(2)`.

**Acceptance.**

- Sending SIGTERM with one in-flight request causes the service to wait for the request to finish, then exit cleanly.
- Sending SIGTERM with no in-flight requests causes immediate exit (< 1 second).
- A test that holds a request hostage past 30 seconds verifies the force exit.

**Hints.** middle § "Graceful Shutdown".

---

## Task 6 — Eliminate `time.Sleep`

**Problem.** Here is a flaky test:

```go
func TestWorker(t *testing.T) {
    w := newWorker()
    w.Start()
    time.Sleep(50 * time.Millisecond)
    if !w.Ready() {
        t.Fatal("not ready")
    }
    w.Submit(Job{ID: 1})
    time.Sleep(100 * time.Millisecond)
    if w.ProcessedCount() != 1 {
        t.Fatal("did not process")
    }
}
```

Rewrite the worker and the test so the test uses no `time.Sleep`.

**Constraints.**

- The worker exposes synchronisation points: a channel that closes when `Ready()`, a way to wait for "N jobs processed."
- Test uses `time.After` only as a deadline guard.

**Acceptance.**

- The test passes 1000 times consecutively (`go test -run TestWorker -count=1000`).
- `go test -race` passes.

**Hints.** middle § "Testing Concurrent Code".

---

## Task 7 — Add `goleak` to a test package

**Problem.** Take any of your existing Go projects with a `_test.go` file. Add `goleak.VerifyTestMain` to it.

**Constraints.**

- If `TestMain` already exists, integrate, don't replace.
- Add `goleak.IgnoreTopFunction` entries only for documented background goroutines (e.g., from `database/sql`, `net/http`).
- All existing tests still pass.

**Acceptance.**

- `goleak.VerifyTestMain(m)` is called.
- Tests pass.
- Add a deliberate leak (`go func() { select{} }()`) in a test and verify the suite fails.

**Hints.** middle § "Leak Detection in CI".

---

## Task 8 — Document concurrency safety

**Problem.** Add concurrency-safety doc comments to the following types:

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string][]byte
}
func (c *Cache) Get(k string) ([]byte, bool)
func (c *Cache) Set(k string, v []byte)
func (c *Cache) Reset()

type Builder struct {
    parts []string
}
func (b *Builder) Add(s string)
func (b *Builder) String() string

type Counter struct {
    n atomic.Int64
}
func (c *Counter) Inc()
func (c *Counter) Value() int64
```

**Constraints.**

- Each type's comment names its concurrency policy explicitly.
- Methods with different policies (e.g., `Reset` requires exclusive access) say so.
- Match the wording style of the standard library (`bytes.Buffer`, `sync.Map`).

**Acceptance.**

- A reviewer can determine the policy without reading the source.
- Linters (`revive`'s `package-comments`) approve.

**Hints.** junior § Rule 11, Example 6.

---

## Task 9 — Find races with `-race`

**Problem.** Take the following code:

```go
type Stats struct {
    count int
    sum   int
}

func (s *Stats) Add(x int) {
    s.count++
    s.sum += x
}

func (s *Stats) Mean() float64 {
    return float64(s.sum) / float64(s.count)
}

func main() {
    s := &Stats{}
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        i := i
        wg.Add(1)
        go func() { defer wg.Done(); s.Add(i) }()
    }
    wg.Wait()
    fmt.Println(s.Mean())
}
```

Run `go run -race main.go`. Observe the race report. Fix the code in three different ways:

1. With a `sync.Mutex`.
2. With `sync/atomic`.
3. By making `Stats` a channel-owned actor.

**Constraints.**

- Each fix must pass `go run -race`.
- For each, write 2-3 sentences on why this fix is the right one for some use case (and the wrong one for others).

**Acceptance.**

- Three versions compile and run race-free.
- Notes accompany each.

**Hints.** junior § Rule 7, middle § "Concurrent Data Structures".

---

## Task 10 — Pprof goroutine analysis

**Problem.** Write a small Go program that intentionally leaks goroutines:

```go
package main

import (
    "fmt"
    "net/http"
    _ "net/http/pprof"
    "time"
)

func leak() {
    ch := make(chan int)
    go func() { ch <- 42 }()  // never received
}

func main() {
    go http.ListenAndServe(":6060", nil)
    for {
        leak()
        time.Sleep(10 * time.Millisecond)
        fmt.Println("running")
    }
}
```

Run it, then in another terminal:

```bash
go tool pprof http://localhost:6060/debug/pprof/goroutine
(pprof) top 10
(pprof) traces
```

**Constraints.**

- Identify the leaking call site from the profile.
- Estimate the leak rate (goroutines per second).
- Fix the leak.

**Acceptance.**

- After the fix, `runtime.NumGoroutine()` stays bounded.
- You can describe the original profile in plain English.

**Hints.** professional § "Detecting Drift in Production".

---

## Task 11 — Build a worker pool with all the rules

**Problem.** Implement a worker pool with this API:

```go
type Pool struct { /* ... */ }

// NewPool creates a pool of n workers.
func NewPool(n int) *Pool

// Submit submits a job. Returns an error if the pool is closed or ctx cancels.
func (p *Pool) Submit(ctx context.Context, job func(context.Context)) error

// Close stops accepting new jobs and waits for in-flight jobs to finish.
// Returns when all workers have exited or ctx cancels.
func (p *Pool) Close(ctx context.Context) error
```

**Constraints.**

- Worker count is bounded (no more than n workers).
- Workers respect a context (a top-level ctx held by the Pool).
- Each worker recovers panics in jobs.
- `Submit` blocks if all workers are busy and the internal queue is full (queue size = n).
- `Close` is idempotent.
- Pool is safe for concurrent use.

**Acceptance.**

- Unit tests with `goleak` pass.
- `go test -race` passes.
- A test that submits 1000 jobs and panics on every fifth job: pool survives, processes all jobs that don't panic, logs the panics.

**Hints.** junior § Rule 10, middle § "Worker Pools".

---

## Task 12 — Stretch tasks

### Stretch A: a context-aware periodic ticker

Implement `RunPeriodic(ctx context.Context, interval time.Duration, fn func(context.Context))` that calls `fn` every `interval` until `ctx` cancels. Cleanly stops on cancel. Don't use `time.Ticker.Stop()` from inside the goroutine until after the loop ends.

### Stretch B: a fan-out / fan-in pipeline

Build a 3-stage pipeline: `decode -> process -> encode`. Each stage is a function `func(ctx context.Context, in <-chan T) <-chan U` that spawns its own goroutine. Compose them: `enc := encode(ctx, process(ctx, decode(ctx, src)))`. Cancellation of `ctx` shuts down the entire pipeline.

### Stretch C: a deadlock you can solve

Write a function that deadlocks. Then fix it. Then write a test that would have caught the deadlock without `-race` (hint: a goroutine count assertion in a goleak-style helper).

### Stretch D: race the race detector

Write a piece of code with a data race that the race detector *fails* to catch in 100% of runs. (Hint: the detector reports observed races; if the test doesn't exercise the race-y path, it can be silent.) Explain why coverage matters for race detection.

### Stretch E: contribute a linter rule

Pick one of the twelve rules. Write a custom `analysis.Analyzer` for `golang.org/x/tools/go/analysis` that flags violations. Test it against your codebase. (This is genuinely hard but extremely useful.)

---

## Self-check

After completing tasks 1-11:

- [ ] My code has been run under `-race` and the race detector reports no races.
- [ ] `goleak.VerifyTestMain` passes in every test package I touched.
- [ ] Every goroutine I wrote has a one-line comment naming its exit.
- [ ] I have used `errgroup` at least once.
- [ ] I have used `pprof.Lookup("goroutine")` to diagnose a real or contrived leak.
- [ ] I no longer write `time.Sleep` to wait for goroutines.
- [ ] Every exported type I wrote has a concurrency-safety doc comment.
- [ ] I have built and tested a worker pool from scratch.
- [ ] I can explain why my graceful shutdown bounds the wait time.

When you can tick all ten, you have internalised the rules.
