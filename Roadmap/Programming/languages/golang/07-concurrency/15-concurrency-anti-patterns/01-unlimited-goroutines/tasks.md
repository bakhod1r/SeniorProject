---
layout: default
title: Tasks
parent: Unlimited Goroutines
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 7
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/01-unlimited-goroutines/tasks/
---

# Unlimited Goroutines — Hands-on Tasks

> Practical exercises ordered by difficulty. Each task includes a problem statement, hints, a runnable solution skeleton, expected output, and a grading rubric.

---

## Easy

### Task 1 — Observe the anti-pattern

**Problem.** Write a small program that demonstrates unbounded fan-out and its memory cost. Spawn 100 000 goroutines, each sleeping for 5 seconds. Print `runtime.NumGoroutine()` and `runtime.MemStats.Alloc` before, during, and after the spawn.

**Hints.**
- Use `time.Sleep` to keep goroutines alive.
- Use `runtime.ReadMemStats(&ms)` to read memory.
- Use a `sync.WaitGroup` to wait for completion.

**Solution skeleton:**

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func main() {
    printStats("before")

    var wg sync.WaitGroup
    for i := 0; i < 100_000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            time.Sleep(5 * time.Second)
        }()
    }

    time.Sleep(time.Second)
    printStats("during")

    wg.Wait()
    runtime.GC()
    printStats("after")
}

func printStats(label string) {
    var ms runtime.MemStats
    runtime.ReadMemStats(&ms)
    fmt.Printf("%s: goroutines=%d, alloc=%d KB\n",
        label, runtime.NumGoroutine(), ms.Alloc/1024)
}
```

**Expected output (approximate):**
```
before: goroutines=1, alloc=200 KB
during: goroutines=100001, alloc=800000 KB
after: goroutines=1, alloc=300 KB
```

**Grading rubric:**
- Spawns 100 000 goroutines: 30 pts.
- Prints memory stats before/during/after: 30 pts.
- Uses WaitGroup correctly: 20 pts.
- Output shows memory growth: 20 pts.

---

### Task 2 — Convert unbounded to bounded with errgroup

**Problem.** You are given:

```go
func ProcessURLs(urls []string) []Result {
    results := make([]Result, len(urls))
    var wg sync.WaitGroup
    for i, u := range urls {
        wg.Add(1)
        go func(i int, u string) {
            defer wg.Done()
            results[i] = fetch(u)
        }(i, u)
    }
    wg.Wait()
    return results
}
```

Convert it to bounded fan-out using `errgroup.WithContext` and `SetLimit(8)`. Make it return an error.

**Hints.**
- Import `golang.org/x/sync/errgroup`.
- Use `g.Go(func() error { ... })`.
- Return `g.Wait()`.

**Solution skeleton:**

```go
package main

import (
    "context"

    "golang.org/x/sync/errgroup"
)

func ProcessURLs(ctx context.Context, urls []string) ([]Result, error) {
    results := make([]Result, len(urls))
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(8)
    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            r, err := fetch(gctx, u)
            if err != nil { return err }
            results[i] = r
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}

type Result struct{}
func fetch(ctx context.Context, u string) (Result, error) { return Result{}, nil }
```

**Expected output.** Code compiles. Tests (which you'll write next task) pass.

**Grading rubric:**
- Uses errgroup.WithContext: 25 pts.
- Calls SetLimit(8): 25 pts.
- Passes gctx to fetch: 25 pts.
- Returns aggregated error: 25 pts.

---

### Task 3 — Write a test that catches unbounded fan-out

**Problem.** Write a test that verifies the function from Task 2 spawns no more than 16 goroutines at any time. (16 = 8 worker goroutines + some headroom.)

**Hints.**
- Use `runtime.NumGoroutine()` periodically in a parallel goroutine.
- Use `defer goleak.VerifyNone(t)` to catch leaks.

**Solution skeleton:**

```go
package main

import (
    "context"
    "runtime"
    "sync/atomic"
    "testing"
    "time"

    "go.uber.org/goleak"
)

func TestProcessURLs_RespectsBound(t *testing.T) {
    defer goleak.VerifyNone(t)

    var peak atomic.Int64
    stop := make(chan struct{})
    go func() {
        ticker := time.NewTicker(time.Millisecond)
        defer ticker.Stop()
        for {
            select {
            case <-stop:
                return
            case <-ticker.C:
                cur := int64(runtime.NumGoroutine())
                for {
                    old := peak.Load()
                    if cur <= old { break }
                    if peak.CompareAndSwap(old, cur) { break }
                }
            }
        }
    }()

    urls := make([]string, 1000)
    for i := range urls {
        urls[i] = "http://example.com"
    }
    _, err := ProcessURLs(context.Background(), urls)
    if err != nil { t.Fatal(err) }

    close(stop)
    if peak.Load() > 30 { // base goroutines + 8 workers + headroom
        t.Errorf("peak goroutines %d exceeded bound", peak.Load())
    }
}
```

**Expected output.** Test passes.

**Grading rubric:**
- Uses goleak: 25 pts.
- Samples NumGoroutine: 25 pts.
- Asserts bound: 25 pts.
- Cleans up sampler: 25 pts.

---

### Task 4 — Fix a Kafka-like consumer

**Problem.** You have a consumer that processes messages from a channel:

```go
func Consume(messages <-chan Message) {
    for msg := range messages {
        go process(msg)
    }
}
```

Convert to use a bounded worker pool. The pool should have 16 workers. Make sure the consumer waits for all in-flight work when the input channel closes.

**Hints.**
- Set up workers reading from an internal channel.
- The main loop forwards to the internal channel.
- Use `sync.WaitGroup` to wait for workers.

**Solution skeleton:**

```go
package main

import "sync"

type Message struct{}

func Consume(messages <-chan Message) {
    const workers = 16
    jobs := make(chan Message)
    var wg sync.WaitGroup

    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for m := range jobs {
                process(m)
            }
        }()
    }

    for m := range messages {
        jobs <- m
    }
    close(jobs)
    wg.Wait()
}

func process(m Message) {}
```

**Expected output.** Compiles; consumer waits for workers to drain.

**Grading rubric:**
- Bounded worker count: 25 pts.
- Workers consume from internal channel: 25 pts.
- Wait on shutdown: 25 pts.
- No goroutine leak: 25 pts.

---

### Task 5 — Implement a `chan struct{}` semaphore

**Problem.** Implement a counting semaphore as a wrapper around a `chan struct{}`. It should expose `Acquire(ctx)`, `Release()`, and `TryAcquire()` methods.

**Hints.**
- A `chan struct{}` of capacity N is a semaphore.
- Acquire = send; Release = receive.
- TryAcquire uses a `select` with `default`.

**Solution skeleton:**

```go
package sem

import "context"

type Sem struct {
    ch chan struct{}
}

func New(n int) *Sem {
    return &Sem{ch: make(chan struct{}, n)}
}

func (s *Sem) Acquire(ctx context.Context) error {
    select {
    case s.ch <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (s *Sem) TryAcquire() bool {
    select {
    case s.ch <- struct{}{}:
        return true
    default:
        return false
    }
}

func (s *Sem) Release() {
    <-s.ch
}
```

**Expected output.** Compiles. Tests (which you write next) pass.

**Grading rubric:**
- Channel-based implementation: 25 pts.
- Context-aware Acquire: 25 pts.
- Non-blocking TryAcquire: 25 pts.
- Tests pass: 25 pts.

---

## Medium

### Task 6 — Bounded recursive directory walk

**Problem.** Write a function `WalkBounded(root string, concurrency int)` that walks a directory tree and prints every regular file's path. Use a bounded errgroup so that concurrency never exceeds `concurrency`.

**Hints.**
- Recursive Walk inside errgroup goroutines.
- Use the *same* errgroup across recursion (capture it in closure).
- Take care with `g.Wait` placement — only the top-level should Wait.

**Solution skeleton:**

```go
package main

import (
    "context"
    "fmt"
    "os"
    "path/filepath"

    "golang.org/x/sync/errgroup"
)

func WalkBounded(ctx context.Context, root string, concurrency int) error {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(concurrency)
    var walk func(string)
    walk = func(dir string) {
        g.Go(func() error {
            entries, err := os.ReadDir(dir)
            if err != nil { return err }
            for _, e := range entries {
                full := filepath.Join(dir, e.Name())
                if e.IsDir() {
                    walk(full)
                } else {
                    fmt.Println(full)
                }
            }
            return gctx.Err()
        })
    }
    walk(root)
    return g.Wait()
}
```

**Caveat.** This actually has a subtle bug: `g.Wait()` returns when the *current* batch of Go-spawned goroutines completes, but if those goroutines spawn more (via `walk`), the count tracking is correct because `g.Go` increments. Test carefully.

**Expected output.** Lists all files; concurrency stays bounded.

**Grading rubric:**
- Uses errgroup.SetLimit: 25 pts.
- Recursively walks: 25 pts.
- Handles cancellation: 25 pts.
- No deadlock: 25 pts.

---

### Task 7 — Per-tenant fairness

**Problem.** Implement a function that processes incoming jobs fairly across tenants. Each tenant should not be able to consume more than 10 simultaneous slots; total slots are 100.

**Hints.**
- Global semaphore of size 100.
- Per-tenant semaphore of size 10 (lazily created).
- Acquire both; release both.

**Solution skeleton:**

```go
package main

import (
    "context"
    "sync"

    "golang.org/x/sync/semaphore"
)

type FairPool struct {
    global  *semaphore.Weighted
    mu      sync.Mutex
    tenants map[string]*semaphore.Weighted
    limit   int64
}

func New(global, perTenant int64) *FairPool {
    return &FairPool{
        global:  semaphore.NewWeighted(global),
        tenants: make(map[string]*semaphore.Weighted),
        limit:   perTenant,
    }
}

func (fp *FairPool) Do(ctx context.Context, tenant string, fn func() error) error {
    if err := fp.global.Acquire(ctx, 1); err != nil { return err }
    defer fp.global.Release(1)

    fp.mu.Lock()
    sem, ok := fp.tenants[tenant]
    if !ok {
        sem = semaphore.NewWeighted(fp.limit)
        fp.tenants[tenant] = sem
    }
    fp.mu.Unlock()

    if err := sem.Acquire(ctx, 1); err != nil { return err }
    defer sem.Release(1)

    return fn()
}
```

**Expected output.** Per-tenant cap of 10, total cap of 100.

**Grading rubric:**
- Global cap: 25 pts.
- Per-tenant cap: 25 pts.
- Lazy tenant creation: 25 pts.
- Correct release order: 25 pts.

---

### Task 8 — Bounded pipeline

**Problem.** Build a 3-stage pipeline: producer → transformer → consumer. Each stage has 4 workers. Channels between stages have buffer 16. The producer reads from a slice of inputs; the consumer prints results.

**Hints.**
- Three goroutine groups, each with `SetLimit(4)`.
- Buffered channels for backpressure.
- Close channels properly.

**Solution skeleton:**

```go
package main

import (
    "context"
    "fmt"
    "sync"

    "golang.org/x/sync/errgroup"
)

func Pipeline(ctx context.Context, inputs []int) error {
    stage1 := make(chan int, 16)
    stage2 := make(chan int, 16)

    g, gctx := errgroup.WithContext(ctx)

    // Producer
    g.Go(func() error {
        defer close(stage1)
        for _, v := range inputs {
            select {
            case <-gctx.Done():
                return gctx.Err()
            case stage1 <- v:
            }
        }
        return nil
    })

    // Transformer
    g.Go(func() error {
        defer close(stage2)
        tg, tctx := errgroup.WithContext(gctx)
        tg.SetLimit(4)
        var mu sync.Mutex
        for v := range stage1 {
            v := v
            tg.Go(func() error {
                r := v * v
                mu.Lock()
                defer mu.Unlock()
                select {
                case <-tctx.Done():
                    return tctx.Err()
                case stage2 <- r:
                }
                return nil
            })
        }
        return tg.Wait()
    })

    // Consumer
    g.Go(func() error {
        for v := range stage2 {
            fmt.Println(v)
        }
        return nil
    })

    return g.Wait()
}
```

**Expected output.** Prints inputs squared, in some order.

**Grading rubric:**
- Three stages: 25 pts.
- Bounded workers per stage: 25 pts.
- Buffered channels: 25 pts.
- Proper cleanup: 25 pts.

---

### Task 9 — Goroutine leak detection in CI

**Problem.** Take a package with multiple test files. Add `goleak` to the test main, configure it to ignore the test framework's own goroutines.

**Hints.**
- Create a `main_test.go` file with `TestMain`.
- Call `goleak.VerifyTestMain(m)`.

**Solution skeleton:**

```go
// main_test.go
package mypkg

import (
    "testing"

    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m,
        goleak.IgnoreTopFunction("testing.(*T).Parallel"),
    )
}
```

Run `go test ./...`. Any test that leaks fails the suite.

**Expected output.** Test suite passes if no leaks; fails with stack trace if any.

**Grading rubric:**
- TestMain exists: 25 pts.
- Calls VerifyTestMain: 25 pts.
- Sensible ignores: 25 pts.
- Catches a synthetic leak: 25 pts.

---

### Task 10 — Concurrent retry with backoff

**Problem.** Write a function `RetryParallel(ctx, items, attempts, fn)` that:
- Processes `items` with at most 8 concurrent goroutines.
- Retries each item up to `attempts` times with exponential backoff.
- Aggregates errors.

**Hints.**
- Use errgroup with SetLimit.
- Inner loop in each goroutine does retries.
- Use `math/rand` for jitter.

**Solution skeleton:**

```go
package main

import (
    "context"
    "math"
    "math/rand"
    "time"

    "golang.org/x/sync/errgroup"
)

func RetryParallel(ctx context.Context, items []Item, attempts int, fn func(context.Context, Item) error) error {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(8)
    for _, it := range items {
        it := it
        g.Go(func() error {
            var lastErr error
            for i := 0; i < attempts; i++ {
                if err := fn(gctx, it); err == nil { return nil } else { lastErr = err }
                if i+1 == attempts { break }
                d := backoff(i)
                select {
                case <-gctx.Done():
                    return gctx.Err()
                case <-time.After(d):
                }
            }
            return lastErr
        })
    }
    return g.Wait()
}

func backoff(attempt int) time.Duration {
    base := math.Pow(2, float64(attempt)) * float64(100*time.Millisecond)
    jitter := rand.Float64() * 0.3 * base
    return time.Duration(base + jitter)
}

type Item struct{}
```

**Expected output.** All items processed; transient failures retry.

**Grading rubric:**
- Bounded parallelism: 25 pts.
- Retries: 25 pts.
- Exponential backoff: 25 pts.
- Context cancellation respected: 25 pts.

---

## Hard

### Task 11 — Implement a production worker pool

**Problem.** Implement a `Pool` type matching the senior-level production worker pool from the senior doc:
- `New(cfg Config) *Pool` constructor.
- `Start(ctx)` to launch workers.
- `Submit(ctx, job)` returns error on context cancellation or pool stopped.
- `TrySubmit(job)` returns bool, non-blocking.
- `Stop(ctx)` for graceful shutdown with timeout.
- `Stats()` returns counters.
- Panic recovery per job.
- Atomic counters for in-flight and completed.

**Hints.**
- See senior.md section 8 for reference.
- Test extensively.

**Solution skeleton.** (See `senior.md` section 8 — about 130 lines.)

**Expected output.** Tests pass; benchmarks show throughput scales with worker count.

**Grading rubric:**
- All listed methods: 30 pts.
- Panic recovery: 20 pts.
- Atomic counters: 20 pts.
- Graceful shutdown with timeout: 30 pts.

---

### Task 12 — Bound a real-world codebase site

**Problem.** Find an open-source Go project with an unbounded `for ... go ...` pattern (you can search GitHub for "go func" in for loops). Submit a PR that:
- Identifies the bug.
- Adds a bound (errgroup with SetLimit).
- Includes a test verifying the bound.
- Updates docs if applicable.

**Hints.**
- Look for cron jobs, batch processors, fan-out functions.
- Be polite in the PR; explain the issue.

**Solution skeleton.** (Project-specific; submit a real PR.)

**Expected output.** PR submitted and merged.

**Grading rubric:**
- Real PR submitted: 50 pts.
- Bug identified accurately: 20 pts.
- Fix is correct: 20 pts.
- Test included: 10 pts.

---

### Task 13 — Build a custom lint rule

**Problem.** Write a `golang.org/x/tools/go/analysis` analyser that detects `go` statements inside `for range` over slices and channels. The analyser should flag with a helpful message.

**Hints.**
- Use the `inspect` package.
- Walk the AST; find `*ast.RangeStmt` then `*ast.GoStmt` inside.

**Solution skeleton:**

```go
package gofor

import (
    "go/ast"

    "golang.org/x/tools/go/analysis"
    "golang.org/x/tools/go/analysis/passes/inspect"
    "golang.org/x/tools/go/ast/inspector"
)

var Analyzer = &analysis.Analyzer{
    Name: "gofor",
    Doc:  "checks for unbounded go inside for range",
    Requires: []*analysis.Analyzer{inspect.Analyzer},
    Run:  run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    insp := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)
    insp.Preorder([]ast.Node{(*ast.RangeStmt)(nil)}, func(n ast.Node) {
        rs := n.(*ast.RangeStmt)
        ast.Inspect(rs.Body, func(b ast.Node) bool {
            if gs, ok := b.(*ast.GoStmt); ok {
                pass.Reportf(gs.Pos(), "unbounded go inside for range; add errgroup.SetLimit or semaphore")
            }
            return true
        })
    })
    return nil, nil
}
```

Wire into a `cmd/main.go`:

```go
package main

import (
    "golang.org/x/tools/go/analysis/singlechecker"

    "yourpkg/gofor"
)

func main() { singlechecker.Main(gofor.Analyzer) }
```

Run: `go run cmd/main.go ./...`.

**Expected output.** Reports violations.

**Grading rubric:**
- Analyser compiles: 25 pts.
- Detects the pattern: 25 pts.
- Helpful message: 25 pts.
- Wired into singlechecker: 25 pts.

---

### Task 14 — Benchmark different bounds

**Problem.** Write a benchmark that compares throughput at different worker counts (1, 2, 4, 8, 16, 32, 64, 128, 256). Plot the results. Identify the optimum.

**Hints.**
- Use `b.Run` for sub-benchmarks.
- Use a sleep-based fake job to simulate I/O.
- Use a CPU-bound fake job to simulate CPU.

**Solution skeleton:**

```go
package pool_test

import (
    "fmt"
    "sync"
    "testing"
    "time"
)

func BenchmarkWorkers(b *testing.B) {
    for _, n := range []int{1, 2, 4, 8, 16, 32, 64, 128, 256} {
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            jobs := make(chan struct{}, n*2)
            var wg sync.WaitGroup
            for i := 0; i < n; i++ {
                wg.Add(1)
                go func() {
                    defer wg.Done()
                    for range jobs {
                        time.Sleep(time.Millisecond) // simulate work
                    }
                }()
            }
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                jobs <- struct{}{}
            }
            close(jobs)
            wg.Wait()
        })
    }
}
```

Run: `go test -bench BenchmarkWorkers -benchtime=10s -benchmem`.

**Expected output.** Throughput numbers; identify the plateau.

**Grading rubric:**
- Sub-benchmarks for each n: 25 pts.
- Realistic fake work: 25 pts.
- Results plotted or tabulated: 25 pts.
- Analysis identifies optimum: 25 pts.

---

### Task 15 — Reproduce and fix a memory leak

**Problem.** Construct a program that demonstrates a goroutine leak (e.g., a goroutine waiting on a channel that is never closed). Use `pprof` to identify the leak. Fix it.

**Hints.**
- Spawn a goroutine that does `<-ch` on a channel nobody sends to.
- Use `pprof.Lookup("goroutine").WriteTo(os.Stdout, 1)` to dump stacks.
- Fix by adding a `select` with context cancellation.

**Solution skeleton:**

```go
package main

import (
    "context"
    "fmt"
    "os"
    "runtime"
    "runtime/pprof"
    "time"
)

func leakyVersion() {
    ch := make(chan int)
    go func() {
        <-ch // leaks
    }()
}

func fixedVersion(ctx context.Context) {
    ch := make(chan int)
    go func() {
        select {
        case <-ch:
        case <-ctx.Done():
        }
    }()
}

func main() {
    for i := 0; i < 100; i++ {
        leakyVersion()
    }
    time.Sleep(time.Second)
    fmt.Println("goroutines:", runtime.NumGoroutine())
    pprof.Lookup("goroutine").WriteTo(os.Stdout, 1)
}
```

**Expected output.** 101 goroutines; pprof shows 100 stuck on `<-ch`.

Then write a version with `fixedVersion(ctx)` and cancel the context; observe goroutines return to baseline.

**Grading rubric:**
- Reproduces leak: 25 pts.
- pprof identifies the leak: 25 pts.
- Fix works: 25 pts.
- Final goroutine count = baseline: 25 pts.

---

### Task 16 — Implement a drain-on-shutdown pool

**Problem.** Implement a pool that on Shutdown drains in-flight work up to a configurable timeout. After the timeout, the workers are forcibly stopped via context cancellation. Use `context.WithCancel` and a separate stop signal.

**Hints.**
- Use two contexts: jobCtx (for current jobs) and shutdownCtx (for accept new).
- Close the input channel on Shutdown; wait up to timeout; cancel jobCtx if exceeded.

**Solution skeleton.** (See senior.md A.3.)

**Expected output.** Compiles; Shutdown(ctx) returns quickly on drain; returns deadline error if timed out.

**Grading rubric:**
- Drain logic: 25 pts.
- Timeout: 25 pts.
- Cancel-on-timeout: 25 pts.
- Idempotent Shutdown: 25 pts.

---

### Task 17 — Build a per-host HTTP client wrapper

**Problem.** Wrap `http.Client` so that:
- At most 20 concurrent calls per host.
- A retry on transient failure (5xx, network error) with exponential backoff.
- Context cancellation aborts in-flight calls.

**Hints.**
- Use a `sync.Map` keyed by host to lazy-create per-host semaphores.
- Wrap `http.Client.Do`.

**Solution skeleton:**

```go
package httpx

import (
    "context"
    "math/rand"
    "net/http"
    "net/url"
    "sync"
    "time"

    "golang.org/x/sync/semaphore"
)

type Client struct {
    cli    *http.Client
    perHostLimit int64
    sems   sync.Map // host -> *semaphore.Weighted
}

func New(perHostLimit int64) *Client {
    return &Client{cli: &http.Client{}, perHostLimit: perHostLimit}
}

func (c *Client) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
    host := req.URL.Host
    semI, _ := c.sems.LoadOrStore(host, semaphore.NewWeighted(c.perHostLimit))
    sem := semI.(*semaphore.Weighted)
    if err := sem.Acquire(ctx, 1); err != nil { return nil, err }
    defer sem.Release(1)

    var lastErr error
    for attempt := 0; attempt < 3; attempt++ {
        req2 := req.Clone(ctx)
        resp, err := c.cli.Do(req2)
        if err == nil && resp.StatusCode < 500 { return resp, nil }
        if resp != nil { resp.Body.Close() }
        lastErr = err
        d := time.Duration(1<<attempt)*100*time.Millisecond +
            time.Duration(rand.Intn(100))*time.Millisecond
        select {
        case <-ctx.Done():
            return nil, ctx.Err()
        case <-time.After(d):
        }
    }
    return nil, lastErr
}

var _ = url.Parse // avoid unused
```

**Expected output.** Compiles; manual test against `httpbin.org/status/500` shows retries.

**Grading rubric:**
- Per-host limit: 25 pts.
- Retry logic: 25 pts.
- Context cancellation: 25 pts.
- Backoff with jitter: 25 pts.

---

### Task 18 — Production-grade SQS consumer

**Problem.** Write an SQS-style consumer (you can mock SQS) that:
- Pulls messages in batches of 10.
- Processes with a bounded worker pool (16 workers).
- ACKs messages after processing.
- Stops gracefully on SIGTERM.

**Hints.**
- Use signal.Notify for SIGTERM.
- Use a buffered channel for messages.
- Workers consume; consumer pulls.

**Solution skeleton:**

```go
package main

import (
    "context"
    "os"
    "os/signal"
    "syscall"

    "golang.org/x/sync/errgroup"
)

type Msg struct{ ID string }

type SQS interface {
    Pull(ctx context.Context, n int) ([]Msg, error)
    Ack(ctx context.Context, id string) error
}

func Run(ctx context.Context, q SQS) error {
    sig := make(chan os.Signal, 1)
    signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    go func() { <-sig; cancel() }()

    msgCh := make(chan Msg, 32)

    g, gctx := errgroup.WithContext(ctx)

    g.Go(func() error {
        defer close(msgCh)
        for {
            if err := gctx.Err(); err != nil { return nil }
            msgs, err := q.Pull(gctx, 10)
            if err != nil { return err }
            for _, m := range msgs {
                select {
                case <-gctx.Done():
                    return nil
                case msgCh <- m:
                }
            }
        }
    })

    pg, pgctx := errgroup.WithContext(gctx)
    pg.SetLimit(16)
    g.Go(func() error {
        for m := range msgCh {
            m := m
            pg.Go(func() error {
                if err := process(pgctx, m); err != nil { return err }
                return q.Ack(pgctx, m.ID)
            })
        }
        return pg.Wait()
    })

    return g.Wait()
}

func process(ctx context.Context, m Msg) error { return nil }
```

**Expected output.** Consumer pulls and processes; on SIGTERM, gracefully drains.

**Grading rubric:**
- Bounded workers: 25 pts.
- ACK after processing: 25 pts.
- SIGTERM handling: 25 pts.
- Graceful shutdown: 25 pts.

---

### Task 19 — Test bound enforcement under load

**Problem.** Take any bounded fan-out function (e.g., from Task 2) and write a stress test that hammers it with 10 000 calls. The test should:
- Assert that peak goroutine count never exceeded the bound + headroom.
- Assert that all 10 000 calls eventually succeeded.
- Assert that no goroutines remain at the end.

**Hints.**
- Use `goleak.VerifyNone`.
- Sample `runtime.NumGoroutine()` in a separate goroutine.
- Use `b.RunParallel` for parallelism.

**Solution skeleton.** (Based on Task 3, scaled up.)

```go
func TestStress(t *testing.T) {
    defer goleak.VerifyNone(t)
    var peak atomic.Int64
    base := int64(runtime.NumGoroutine())
    stop := make(chan struct{})
    go func() {
        for {
            select {
            case <-stop: return
            default:
                cur := int64(runtime.NumGoroutine())
                for { old := peak.Load(); if cur <= old || peak.CompareAndSwap(old, cur) { break } }
                time.Sleep(time.Millisecond)
            }
        }
    }()

    var wg sync.WaitGroup
    for i := 0; i < 10000; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); urls := []string{"a"}; _, _ = ProcessURLs(context.Background(), urls) }()
    }
    wg.Wait()
    close(stop)

    if peak.Load()-base > 100 {
        t.Errorf("peak %d exceeded baseline %d", peak.Load(), base)
    }
}
```

**Expected output.** Test passes.

**Grading rubric:**
- Stress level (10k calls): 25 pts.
- Bound assertion: 25 pts.
- Leak assertion: 25 pts.
- Sampler cleanup: 25 pts.

---

### Task 20 — Capture-the-flag: find the leak

**Problem.** Given the following program, find the leak:

```go
package main

import (
    "context"
    "fmt"
    "runtime"
    "time"
)

func startWorker() chan int {
    in := make(chan int)
    go func() {
        for n := range in {
            fmt.Println(n)
        }
    }()
    return in
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    for i := 0; i < 100; i++ {
        ch := startWorker()
        ch <- i
        // forgot to close ch
    }
    fmt.Println("goroutines:", runtime.NumGoroutine())
    <-ctx.Done()
}
```

**Hints.**
- Look at lifetime of `ch`.
- The goroutine inside `startWorker` loops on `for n := range in`.

**Solution.** The leak: every `startWorker` call creates a goroutine that loops on `range in`. The loop only exits when `in` is closed. Since `ch` is never closed, all 100 goroutines remain alive.

**Fix.** Either:
- Pass `ctx` and use `select`.
- Close `ch` after sending.

```go
func startWorker(ctx context.Context) chan int {
    in := make(chan int)
    go func() {
        for {
            select {
            case n, ok := <-in:
                if !ok { return }
                fmt.Println(n)
            case <-ctx.Done():
                return
            }
        }
    }()
    return in
}
```

**Expected output.** Original: ~100 goroutines. Fixed: small constant.

**Grading rubric:**
- Leak identified: 25 pts.
- Root cause explained: 25 pts.
- Fix works: 25 pts.
- Verification with pprof or NumGoroutine: 25 pts.

---

## Summary

These 20 tasks cover the breadth of the unlimited-goroutines anti-pattern: detection, prevention, fix, and verification. Complete them in order; each builds on the previous.

By the end, you should be able to:
- Recognise unbounded fan-out in any Go codebase.
- Apply the right cure (worker pool, semaphore, errgroup).
- Write tests that catch the anti-pattern.
- Build production-grade patterns (drain-on-shutdown, per-tenant fairness).
- Use observability tools (pprof, goleak, runtime metrics) to diagnose.

If you've done all 20, you've earned the senior-level rating for this anti-pattern. Move on to the next topic.

End of Tasks file.
