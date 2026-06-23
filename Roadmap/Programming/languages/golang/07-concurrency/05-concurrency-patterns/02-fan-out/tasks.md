# Fan-Out — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — Minimal fan-out skeleton

Write a function `SquareAll(in <-chan int, n int) <-chan int` that fans out `n` workers reading from `in`, each computing `v*v` and writing to a shared output channel. Close the output once all workers exit.

- Producer should be a goroutine that emits 1..10 and closes `in`.
- Consumer reads from the returned channel and prints each value.
- Run with `n=4`. Verify output set is `{1, 4, 9, 16, 25, 36, 49, 64, 81, 100}` (order may vary).

**Goal.** Internalize the canonical "input channel, N workers, WaitGroup, closer goroutine" skeleton.

---

### Task 2 — Parallel HTTP HEAD prober

Given a slice of URLs, fan-out N workers that each issue `http.Head` and report `(url, status, err)` as a struct on an output channel. Print results as they arrive.

- N is configurable (default 8).
- Use a `sync.WaitGroup`; do not yet introduce `context` or `errgroup`.
- Test with 50 URLs, half pointing at `http://example.com` and half at `http://10.255.255.1` (which times out).

**Hint.** Always close `resp.Body` even on error paths to avoid leaking connections. A 5-second `http.Client.Timeout` keeps the test bounded.

**Goal.** Build a real, useful tool with the simplest possible fan-out.

---

### Task 3 — Word counter across files

Write `CountWords(paths []string, n int) (map[string]int, error)`. Fan out N workers that each open a file, scan words, and emit `map[string]int` on a result channel. Merge all per-worker maps into one final map.

- Use `bufio.Scanner` with `bufio.ScanWords`.
- Each worker emits one map at the end of its files (do NOT emit per-word).
- The final merge happens in the main goroutine after the result channel closes.

**Goal.** Practice "per-worker accumulator + merge" — avoids any shared-state writes.

---

## Medium

### Task 4 — errgroup-based fan-out fetcher

Rewrite Task 2 using `golang.org/x/sync/errgroup`:

- Producer goroutine pushes URLs onto a channel.
- N worker goroutines pull URLs and fetch them.
- First fetch error cancels all other workers via the derived ctx.
- Caller receives `([]Response, error)`.

Add a unit test that returns a custom HTTP server — half the handlers return 200, half return 500 after a delay. Verify that `errgroup.Wait()` returns the first 500 error and that no goroutine outlives the function.

**Hint.** Register the producer with `g.Go` so its errors propagate too. The closer goroutine for the result channel is *not* registered with `g.Go` because it must run regardless of errors.

**Goal.** Wire ctx + errgroup correctly. This is the production fan-out shape.

---

### Task 5 — Dynamic worker count

Build a fan-out where the worker count adapts to the input channel's *queue depth*:
- Start with 4 workers.
- Every 100ms, sample `len(in)`.
- If `len(in) > 80% capacity`, spawn one more worker (cap at 32).
- If `len(in) == 0` for 5 consecutive samples, retire one worker (floor 4).

Compare its throughput against a static N=16 fan-out on a workload that bursts every 10 seconds.

**Hint.** Each worker reads an additional "stop" channel via `select`. The supervisor sends on it to retire a worker.

**Goal.** See where dynamic sizing pays off (bursty load) and where it does not (steady stream — static is simpler and faster).

---

### Task 6 — Image batch resizer

Given a directory of JPEGs, fan out N workers that each resize an image to 256x256 using `golang.org/x/image/draw` or any equivalent, write to an output directory, and emit `(path, dur, err)` on a result channel.

- N defaults to `runtime.NumCPU()` (CPU-bound work).
- Tolerate per-file errors: log and continue, do not abort the batch.
- Print a summary at the end: total files, errors, p50/p99 duration.

**Hint.** Use `image.Decode` + `draw.CatmullRom.Scale` + `jpeg.Encode`. Profile with `go test -cpuprofile`; you should see ~`NumCPU` workers active in flame graph.

**Goal.** Apply CPU-bound fan-out sizing. See real wall-clock speedup from parallelism.

---

### Task 7 — Fan-out with rate limit

Fan out 32 workers but limit the *aggregate* request rate to 50 req/s using `golang.org/x/time/rate`:

```go
limiter := rate.NewLimiter(rate.Limit(50), 10)
// inside worker:
if err := limiter.Wait(ctx); err != nil { return err }
// then make the request
```

- Make 1000 fake requests (sleep 50ms each).
- Verify total wall-clock is ~`1000/50 = 20s` (rate-limited), not `1000/32 × 50ms ≈ 1.5s` (concurrency-limited).

**Goal.** See the orthogonality of "concurrency cap" (workers) vs "throughput cap" (limiter). Both layers are usually needed against external APIs.

---

## Hard

### Task 8 — Goroutine leak detection test

Write a test using `go.uber.org/goleak`:

1. Spawn `Process(ctx, in, 8, work)`.
2. Send 1000 jobs through `in` slowly (1ms each).
3. After receiving 5 results, call `cancel()`.
4. Verify that `goleak.VerifyNone(t)` passes — no worker, producer, or closer goroutine survives.

If your `Process` does not handle cancel correctly (forgets the inner `select` on `out <- r`), the test will fail with a goroutine stack pointing at the blocked send. Fix the implementation until the test passes.

**Goal.** Make leak detection part of muscle memory. Every fan-out helper deserves a `goleak` test.

---

### Task 9 — Benchmark N values across workload types

Write a benchmark that runs the same job set under fan-out with `n ∈ {1, 2, 4, 8, 16, 32, 64}` for two workload types:

- **CPU-bound:** SHA-256 of 1 MB random byte slice.
- **IO-bound:** `time.Sleep(50ms)` (simulates a network call).

For each combination, report `ns/op` and `MB/s` (use `b.SetBytes`). Use `benchstat` to compare runs.

Expected:
- CPU-bound throughput plateaus near `NumCPU` and *decreases* slightly above.
- IO-bound throughput climbs through 64 and beyond, until your machine's goroutine overhead kicks in.

**Goal.** See the two scaling laws with your own eyes, on your own hardware.

---

### Task 10 — Fan-out across multiple input channels

Build `MultiFanOut(ins []<-chan Job, n int) <-chan Result`. Inputs come from several upstream stages; you want N workers servicing all of them.

Two implementations:
1. **Pre-merge:** First fan-in `ins` to one channel `merged`, then plain fan-out from `merged`.
2. **Direct:** Each worker uses `select` over all `ins` channels, plus `<-ctx.Done()`.

Compare the two: which is simpler, which is faster, which is more flexible (e.g. dynamically adding inputs)?

**Hint.** The `select` form does not scale beyond ~16 inputs because `select` cases are checked in randomized order with cost O(cases). The pre-merge form is O(1) per receive after the merge.

**Goal.** Recognize when to compose patterns vs flatten them.

---

### Task 11 — Work-stealing fan-out

Implement a fan-out where each worker has its own local queue (a buffered channel) and idle workers can "steal" from busy peers.

Skeleton:
- N workers, each with a local channel `[]chan Job` of buffer size B.
- A dispatcher reads from a global input and distributes round-robin to the N local channels.
- When a worker's local channel is empty, it tries `select { case j := <-localQueues[(self+offset)%N]: ... default: }` cycling through peers.

Compare its throughput on a *skewed* workload (10% of jobs are 100x slower than the rest) against plain fan-out from a shared channel.

**Goal.** See where work stealing helps (skewed workloads) and where shared-channel fan-out is plenty (uniform workloads).

---

### Task 12 — Bounded fan-out with backpressure visible to the producer

Build a fan-out where the producer can observe queue depth and slow down its own emission rate when the workers fall behind.

- Input channel buffer = 100.
- Producer emits at 1000/s but checks `if len(in) > 90 { time.Sleep(10ms) }`.
- Workers process at 500/s.
- Run for 30 seconds; record the producer's emission rate and the queue depth over time.

Expected: producer self-throttles to ~500/s after a brief overshoot. Without the check, the producer would wedge on `in <- v` permanently.

**Goal.** Make backpressure explicit. Surface it as a metric, not a silent block.

---

# Solutions

## Solution 1 — Minimal fan-out skeleton

```go
package main

import (
    "fmt"
    "sync"
)

func SquareAll(in <-chan int, n int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                out <- v * v
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

func main() {
    in := make(chan int)
    go func() {
        defer close(in)
        for i := 1; i <= 10; i++ { in <- i }
    }()
    for v := range SquareAll(in, 4) {
        fmt.Println(v)
    }
}
```

Key invariants: producer closes `in`, closer goroutine closes `out`, every worker calls `wg.Done` on exit.

---

## Solution 2 — Parallel HTTP HEAD prober

```go
type Probe struct {
    URL    string
    Status int
    Err    error
}

func Probe(urls []string, n int) <-chan Probe {
    in := make(chan string)
    out := make(chan Probe)
    var wg sync.WaitGroup

    go func() {
        defer close(in)
        for _, u := range urls { in <- u }
    }()

    client := &http.Client{Timeout: 5 * time.Second}
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for u := range in {
                resp, err := client.Head(u)
                p := Probe{URL: u, Err: err}
                if err == nil {
                    p.Status = resp.StatusCode
                    resp.Body.Close()
                }
                out <- p
            }
        }()
    }

    go func() { wg.Wait(); close(out) }()
    return out
}
```

The producer goroutine *and* the workers must shut down cleanly. The producer closes `in`; the closer closes `out` after `wg.Wait`.

---

## Solution 3 — Word counter across files

```go
func CountWords(paths []string, n int) (map[string]int, error) {
    in := make(chan string)
    out := make(chan map[string]int, n)
    errs := make(chan error, n)
    var wg sync.WaitGroup

    go func() {
        defer close(in)
        for _, p := range paths { in <- p }
    }()

    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            local := map[string]int{}
            for p := range in {
                f, err := os.Open(p)
                if err != nil {
                    errs <- err
                    continue
                }
                s := bufio.NewScanner(f)
                s.Split(bufio.ScanWords)
                for s.Scan() {
                    local[s.Text()]++
                }
                f.Close()
            }
            out <- local
        }()
    }

    go func() { wg.Wait(); close(out); close(errs) }()

    final := map[string]int{}
    for m := range out {
        for k, v := range m {
            final[k] += v
        }
    }
    if err, ok := <-errs; ok {
        return final, err
    }
    return final, nil
}
```

No mutex on the map — each worker has a private one. Final merge runs sequentially in main.

---

## Solution 4 — errgroup-based fan-out fetcher

```go
type Resp struct { URL string; Status int; Body []byte }

func FetchAll(ctx context.Context, urls []string, n int) ([]Resp, error) {
    g, ctx := errgroup.WithContext(ctx)
    in := make(chan string)
    out := make(chan Resp)

    g.Go(func() error {
        defer close(in)
        for _, u := range urls {
            select {
            case <-ctx.Done(): return ctx.Err()
            case in <- u:
            }
        }
        return nil
    })

    var wwg sync.WaitGroup
    for i := 0; i < n; i++ {
        wwg.Add(1)
        g.Go(func() error {
            defer wwg.Done()
            for u := range in {
                req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
                resp, err := http.DefaultClient.Do(req)
                if err != nil { return err }
                body, _ := io.ReadAll(resp.Body)
                resp.Body.Close()
                if resp.StatusCode >= 500 {
                    return fmt.Errorf("%s: %d", u, resp.StatusCode)
                }
                select {
                case <-ctx.Done(): return ctx.Err()
                case out <- Resp{u, resp.StatusCode, body}:
                }
            }
            return nil
        })
    }

    go func() { wwg.Wait(); close(out) }()

    var results []Resp
    for r := range out { results = append(results, r) }
    return results, g.Wait()
}
```

The closer goroutine is plain `go func` (not `g.Go`) because it must run regardless of errors and never returns one itself.

---

## Solution 5 — Dynamic worker count (skeleton)

```go
type Pool struct {
    in     chan Job
    stop   []chan struct{}
    workers int
    mu     sync.Mutex
    work   func(Job)
}

func (p *Pool) addWorker() {
    p.mu.Lock(); defer p.mu.Unlock()
    if p.workers >= 32 { return }
    stop := make(chan struct{})
    p.stop = append(p.stop, stop)
    p.workers++
    go func() {
        for {
            select {
            case <-stop: return
            case j, ok := <-p.in:
                if !ok { return }
                p.work(j)
            }
        }
    }()
}

func (p *Pool) removeWorker() {
    p.mu.Lock(); defer p.mu.Unlock()
    if p.workers <= 4 { return }
    last := len(p.stop) - 1
    close(p.stop[last])
    p.stop = p.stop[:last]
    p.workers--
}

func (p *Pool) supervisor() {
    t := time.NewTicker(100 * time.Millisecond)
    defer t.Stop()
    idle := 0
    for range t.C {
        depth := len(p.in)
        cap := cap(p.in)
        switch {
        case depth*5 > cap*4:
            p.addWorker(); idle = 0
        case depth == 0:
            idle++
            if idle >= 5 { p.removeWorker(); idle = 0 }
        default:
            idle = 0
        }
    }
}
```

The supervisor watches queue depth and adjusts. In production, gate the changes behind hysteresis (don't add and remove on the same tick).

---

## Solution 6 — Image batch resizer (essence)

```go
func Resize(paths []string, n int) error {
    in := make(chan string)
    var wg sync.WaitGroup

    go func() {
        defer close(in)
        for _, p := range paths { in <- p }
    }()

    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for p := range in {
                if err := resizeOne(p); err != nil {
                    log.Printf("resize %s: %v", p, err)
                }
            }
        }()
    }
    wg.Wait()
    return nil
}

func resizeOne(path string) error {
    f, err := os.Open(path); if err != nil { return err }
    defer f.Close()
    src, _, err := image.Decode(f); if err != nil { return err }
    dst := image.NewRGBA(image.Rect(0, 0, 256, 256))
    draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)
    out, err := os.Create(filepath.Join("out", filepath.Base(path))); if err != nil { return err }
    defer out.Close()
    return jpeg.Encode(out, dst, &jpeg.Options{Quality: 85})
}
```

CPU-bound work — pick `n = runtime.NumCPU()`. More workers thrash the scheduler.

---

## Solution 7 — Fan-out with rate limit

```go
func Fetch(ctx context.Context, urls []string, n int) error {
    limiter := rate.NewLimiter(rate.Limit(50), 10)
    in := make(chan string)
    var wg sync.WaitGroup

    go func() {
        defer close(in)
        for _, u := range urls { in <- u }
    }()

    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for u := range in {
                if err := limiter.Wait(ctx); err != nil { return }
                _ = u // make request
                time.Sleep(50 * time.Millisecond)
            }
        }()
    }
    wg.Wait()
    return nil
}
```

`limiter.Wait` blocks until the limiter has tokens. With 50 req/s and 32 workers, the workers spend most of their time in `Wait` — and that's correct.

---

## Solution 8 — Goroutine leak detection test

```go
import "go.uber.org/goleak"

func TestProcessNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    in := make(chan int)
    go func() {
        defer close(in)
        for i := 0; i < 1000; i++ {
            select {
            case <-ctx.Done(): return
            case in <- i:
            }
            time.Sleep(time.Millisecond)
        }
    }()

    out := Process(ctx, in, 8, func(_ context.Context, v int) int {
        time.Sleep(2 * time.Millisecond)
        return v * 2
    })

    var got int
    for range out {
        got++
        if got == 5 { cancel() }
    }
}
```

If the worker forgets the inner `select`, after `cancel()` some workers may still be blocked on `out <- r`. `goleak` reports the offending stack.

---

## Solution 9 — Benchmark N values

```go
func BenchmarkFanOut(b *testing.B) {
    cpu := func(_ context.Context, v []byte) [32]byte { return sha256.Sum256(v) }
    io := func(ctx context.Context, _ int) int {
        select { case <-ctx.Done(): case <-time.After(50*time.Millisecond): }
        return 0
    }

    payload := make([]byte, 1<<20) // 1 MB

    for _, n := range []int{1, 2, 4, 8, 16, 32, 64} {
        b.Run(fmt.Sprintf("cpu/n=%d", n), func(b *testing.B) {
            b.SetBytes(int64(len(payload)))
            in := make(chan []byte)
            go func() {
                defer close(in)
                for i := 0; i < b.N; i++ { in <- payload }
            }()
            out := Process(context.Background(), in, n, cpu)
            for range out {}
        })
        b.Run(fmt.Sprintf("io/n=%d", n), func(b *testing.B) {
            in := make(chan int)
            go func() {
                defer close(in)
                for i := 0; i < b.N; i++ { in <- i }
            }()
            out := Process(context.Background(), in, n, io)
            for range out {}
        })
    }
}
```

Run with `go test -bench=. -benchmem -count=10` and feed to `benchstat`.

---

## Solution 10 — Multiple input channels

```go
// Pre-merge form (simpler, scales to many inputs):
func MultiFanOut(ctx context.Context, ins []<-chan Job, n int) <-chan Result {
    merged := merge(ctx, ins...)
    return Process(ctx, merged, n, work)
}

// Direct select form (good for ≤ 4 inputs):
func MultiFanOutSelect(ctx context.Context, a, b <-chan Job, n int) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for {
                var j Job
                var ok bool
                select {
                case <-ctx.Done(): return
                case j, ok = <-a:
                    if !ok { a = nil; if b == nil { return } else { continue } }
                case j, ok = <-b:
                    if !ok { b = nil; if a == nil { return } else { continue } }
                }
                r := work(ctx, j)
                select {
                case <-ctx.Done(): return
                case out <- r:
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

Setting a closed channel to `nil` excludes it from future `select` cases. Both branches converge to `nil` when both inputs close, then the loop returns.

---

## Solution 11 — Work-stealing fan-out (essence)

```go
func WorkStealing(jobs []Job, n int) []Result {
    locals := make([]chan Job, n)
    for i := range locals { locals[i] = make(chan Job, 64) }

    // dispatcher: round-robin
    go func() {
        for i, j := range jobs { locals[i%n] <- j }
        for i := range locals { close(locals[i]) }
    }()

    out := make(chan Result, len(jobs))
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        i := i
        go func() {
            defer wg.Done()
            for {
                // try local first
                select {
                case j, ok := <-locals[i]:
                    if !ok { goto steal }
                    out <- work(j)
                    continue
                default:
                }
            steal:
                stole := false
                for off := 1; off < n; off++ {
                    peer := (i + off) % n
                    select {
                    case j, ok := <-locals[peer]:
                        if ok { out <- work(j); stole = true }
                    default:
                    }
                    if stole { break }
                }
                if !stole {
                    // all locals empty — exit
                    return
                }
            }
        }()
    }
    wg.Wait()
    close(out)
    var rs []Result
    for r := range out { rs = append(rs, r) }
    return rs
}
```

The exit condition is delicate; in production use a coordinator that signals "all input drained" before workers terminate.

---

## Solution 12 — Bounded fan-out with visible backpressure

```go
in := make(chan int, 100)
var emitted, processed atomic.Int64

// producer
go func() {
    defer close(in)
    ticker := time.NewTicker(time.Millisecond)
    defer ticker.Stop()
    for i := 0; i < 30000; i++ {
        if len(in) > 90 { time.Sleep(10 * time.Millisecond) }
        in <- i
        emitted.Add(1)
        <-ticker.C
    }
}()

// workers (process at 500/s combined => one job per 2ms total)
var wg sync.WaitGroup
wg.Add(8)
for i := 0; i < 8; i++ {
    go func() {
        defer wg.Done()
        for range in {
            time.Sleep(16 * time.Millisecond) // 8 workers × 1/16ms = 500/s
            processed.Add(1)
        }
    }()
}

// observer
go func() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for range t.C {
        log.Printf("emitted=%d processed=%d depth=%d", emitted.Load(), processed.Load(), len(in))
    }
}()

wg.Wait()
```

Watch the log: `emitted` rises faster than `processed` until the producer's `if len(in) > 90` kicks in, then they converge.

---

End of tasks. Each task is a small step in the same direction: from "spawn N goroutines" toward "run a production-grade parallel pipeline that shuts down cleanly under all conditions." Build them in order; reuse code from earlier tasks; keep tests green throughout.
