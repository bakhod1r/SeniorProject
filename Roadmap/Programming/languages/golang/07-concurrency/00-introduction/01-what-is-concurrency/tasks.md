# What is Concurrency — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions or solution sketches are at the end.

---

## Easy

### Task 1 — Sequential baseline

Write a program that calls three functions sequentially, each of which sleeps for 1 second and prints its name. Time the total. Output should be ~3 seconds.

- Use `time.Now()` and `time.Since`.
- Print "total: 3.0s" or similar.

**Goal.** Establish a baseline for the next tasks.

---

### Task 2 — Concurrent rewrite

Take Task 1's program and rewrite it to run the three functions concurrently using goroutines and a `sync.WaitGroup`. The total should drop to ~1 second.

- Use `defer wg.Done()` in each goroutine.
- Call `wg.Add(1)` *before* `go`.

**Goal.** Observe the speedup from concurrency on independent I/O-bound tasks.

---

### Task 3 — CPU-bound parallelism

Compute the sum of integers from 1 to 100 million. First sequentially. Then concurrently, splitting the work into `runtime.NumCPU()` chunks. Time both versions and compare.

- The result of both versions must match.
- Expected speedup: 2x–6x depending on machine and other load.

**Goal.** See real parallelism in action.

---

### Task 4 — Concurrency without parallelism

Take Task 3's concurrent version. Set `runtime.GOMAXPROCS(1)` at the start of `main` and rerun. Note that the concurrent version is now no faster than sequential (and possibly slower due to scheduling overhead).

**Goal.** Understand that concurrency without parallelism does not speed up CPU-bound work.

---

### Task 5 — I/O hiding on single core

Take Task 2's I/O-bound concurrent program. Set `GOMAXPROCS=1` and rerun. The total should *still* be ~1 second, because the goroutines yield on `time.Sleep` (a synchronisation point) regardless of core count.

**Goal.** See that I/O-bound concurrency wins even without parallelism.

---

### Task 6 — Inspecting `runtime` constants

Write a small program that prints:

- `runtime.NumCPU()`
- `runtime.GOMAXPROCS(0)`
- `runtime.NumGoroutine()` before and after spawning 100 short-lived goroutines.

**Goal.** Get comfortable with runtime introspection.

---

## Medium

### Task 7 — Concurrent URL fetcher

Write a function `FetchAll(urls []string) []string` that fetches each URL with `http.Get` and returns the response status as a string per URL, in the same order. Use one goroutine per URL.

- Use `sync.WaitGroup`.
- Preserve order via a pre-allocated `[]string`.
- Cap concurrency at 10 with a semaphore channel.

**Goal.** Build a real-world concurrent I/O routine.

---

### Task 8 — Race detector

Write code with a deliberate data race:

```go
var counter int
var wg sync.WaitGroup
for i := 0; i < 1000; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        counter++
    }()
}
wg.Wait()
fmt.Println(counter)
```

Run normally — note the result varies. Run `go run -race main.go` and read the race report. Fix it three ways:

1. `sync.Mutex` around `counter++`.
2. `sync/atomic.AddInt64`.
3. A `chan int` collecting per-goroutine results and a final loop summing.

Benchmark all three with `time` and compare.

**Goal.** Internalise the race detector and three idiomatic fixes.

---

### Task 9 — Amdahl simulator

Write a program that takes two inputs: serial fraction `s` (e.g., 0.1) and number of cores `n` (e.g., 8). Print the theoretical max speedup according to Amdahl's law. Loop through cores 1, 2, 4, 8, 16, 32, 64 and print a small table.

**Goal.** Internalise the law numerically.

---

### Task 10 — Throughput vs latency demo

Build a small simulated server: 100 incoming "requests," each taking 100 ms to process (`time.Sleep`). Measure:

1. Sequential: total time, average per-request latency.
2. Concurrent with one goroutine per request: total time, average per-request latency.

Note that latency per request stays at 100 ms but throughput rises from 10 req/s to 100 req/s.

**Goal.** See throughput vs latency separately in numbers.

---

### Task 11 — Bounded concurrency

Take Task 7 and modify it: instead of one goroutine per URL, use a fixed pool of 4 worker goroutines reading from a `chan string` of URLs and writing to a `chan Result`. Process 100 URLs.

- The main goroutine sends URLs, closes the input channel, then waits for results.
- A separate goroutine `wg.Wait()`s on workers and closes the output channel.

**Goal.** Master the worker-pool template.

---

### Task 12 — Goroutine count under load

Modify Task 11 to print `runtime.NumGoroutine()` every 100 ms in a background goroutine until the pool finishes. Verify the count is bounded at `workers + a few overhead goroutines`.

**Goal.** See bounded concurrency in action.

---

## Hard

### Task 13 — Pipeline of three stages

Build a three-stage pipeline:

1. **Generator:** sends integers 1–100 on a channel.
2. **Squarer:** reads ints, sends squares.
3. **Filter:** reads ints, sends only those divisible by 7.

Each stage is its own goroutine, connected by channels. The main goroutine ranges over the final channel and prints.

- Close each channel when its source is done.
- Ensure no goroutine leaks if the consumer stops early (add a `done` channel or `context.Context`).

**Goal.** Build a real pipeline with proper teardown.

---

### Task 14 — Scatter-gather with cancellation

Write a function `First(ctx context.Context, urls []string) (string, error)` that:

1. Spawns one goroutine per URL.
2. Returns the body of the first successful response.
3. Cancels the other goroutines via `ctx`.
4. Returns an error if all fail.

Use `errgroup.WithContext` or a manual `select` + cancel.

**Goal.** Master scatter-gather with proper cancellation.

---

### Task 15 — Bottleneck detection

Build a simulated pipeline with these stages:

1. Reader: 100 items/sec (use `time.Tick`).
2. Processor: 1000 items/sec.
3. Writer: 50 items/sec.

Connect them with buffered channels. Run for 30 seconds. Print queue depths every second.

Observe: the writer's input channel fills up; the processor blocks on sending; the reader continues at 100/sec but throughput is bottlenecked at 50/sec.

Then: parallelise the writer with 3 worker goroutines. Re-run. Observe: throughput should rise to ~100/sec (matching the reader, now the bottleneck).

**Goal.** See bottleneck migration in real time.

---

### Task 16 — False sharing benchmark

Write a benchmark that has 8 goroutines, each incrementing its own counter `1_000_000` times. Compare two layouts:

```go
type narrow struct {
    counters [8]int64
}

type padded struct {
    counters [8]struct {
        v   int64
        _   [56]byte
    }
}
```

Use `go test -bench`. Expect the padded version to be 2x–5x faster on most x86 hardware.

**Goal.** Observe false sharing in numbers.

---

### Task 17 — Goroutine leak test

Write a function that leaks a goroutine (e.g., sends to a `chan int` with no receiver and no context cancellation). Use `go.uber.org/goleak` in a test to detect it. Then fix the function and verify the test passes.

**Goal.** Learn goroutine-leak detection in tests.

---

### Task 18 — Concurrent prime sieve

Implement the classic Eratosthenes sieve using one goroutine per prime, connected by channels. The pattern: each goroutine reads from its input channel, filters out multiples of its prime, and sends survivors to its output channel. New primes spawn new filter goroutines.

- Print the first 100 primes.
- Verify the program shuts down cleanly when done.

**Goal.** Build a non-trivial concurrent pipeline.

---

### Task 19 — Hedged request

Implement `Hedged(ctx context.Context, urls []string, delay time.Duration) (string, error)`:

1. Start a request to `urls[0]` immediately.
2. After `delay` (e.g., 50 ms), start a request to `urls[1]` if the first has not returned.
3. Return whichever response arrives first; cancel the other.

This is the standard latency-tail-mitigation pattern in services where p99 is much higher than p50.

**Goal.** Implement a production-grade latency-reduction primitive.

---

### Task 20 — Concurrency cost calculator

Write a small tool that, given:

- Sequential time per task `t_seq` (microseconds)
- Number of tasks `n`
- Number of cores `c`

calculates expected throughput improvement from concurrency, accounting for:

- Per-goroutine overhead (~0.5 µs)
- Amdahl with assumed 10% serial fraction
- Memory pressure (no precise model; warn if n × overhead > 10% of t_total)

Test with several inputs. Build intuition for when concurrency pays.

**Goal.** Quantify the concurrency decision.

---

## Solutions and hints

### Task 1 solution

```go
package main

import (
    "fmt"
    "time"
)

func task(name string) {
    fmt.Println("start", name)
    time.Sleep(time.Second)
    fmt.Println("end", name)
}

func main() {
    start := time.Now()
    task("A")
    task("B")
    task("C")
    fmt.Println("total:", time.Since(start))
}
```

### Task 2 solution

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func task(name string, wg *sync.WaitGroup) {
    defer wg.Done()
    fmt.Println("start", name)
    time.Sleep(time.Second)
    fmt.Println("end", name)
}

func main() {
    start := time.Now()
    var wg sync.WaitGroup
    for _, n := range []string{"A", "B", "C"} {
        wg.Add(1)
        go task(n, &wg)
    }
    wg.Wait()
    fmt.Println("total:", time.Since(start))
}
```

### Task 3 solution (sketch)

```go
const N = 100_000_000
workers := runtime.NumCPU()
chunk := N / workers
results := make([]int64, workers)

var wg sync.WaitGroup
for w := 0; w < workers; w++ {
    wg.Add(1)
    go func(w int) {
        defer wg.Done()
        var s int64
        for i := w * chunk; i < (w+1)*chunk; i++ {
            s += int64(i)
        }
        results[w] = s
    }(w)
}
wg.Wait()

var total int64
for _, r := range results {
    total += r
}
```

### Task 8 solution (atomic version)

```go
var counter int64
var wg sync.WaitGroup
for i := 0; i < 1000; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        atomic.AddInt64(&counter, 1)
    }()
}
wg.Wait()
fmt.Println(counter)
```

### Task 13 solution sketch

```go
gen := func() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 1; i <= 100; i++ {
            out <- i
        }
    }()
    return out
}

sq := func(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}

flt := func(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            if v%7 == 0 {
                out <- v
            }
        }
    }()
    return out
}

for v := range flt(sq(gen())) {
    fmt.Println(v)
}
```

### Task 16 solution sketch

```go
type narrow struct {
    counters [8]int64
}

type padded struct {
    counters [8]struct {
        v int64
        _ [56]byte
    }
}

func BenchmarkNarrow(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var n narrow
        var wg sync.WaitGroup
        for w := 0; w < 8; w++ {
            wg.Add(1)
            go func(w int) {
                defer wg.Done()
                for k := 0; k < 1_000_000; k++ {
                    n.counters[w]++
                }
            }(w)
        }
        wg.Wait()
    }
}

func BenchmarkPadded(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var p padded
        var wg sync.WaitGroup
        for w := 0; w < 8; w++ {
            wg.Add(1)
            go func(w int) {
                defer wg.Done()
                for k := 0; k < 1_000_000; k++ {
                    p.counters[w].v++
                }
            }(w)
        }
        wg.Wait()
    }
}
```

### Task 19 solution sketch

```go
func Hedged(ctx context.Context, urls []string, delay time.Duration) (string, error) {
    if len(urls) == 0 {
        return "", errors.New("no urls")
    }
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    type result struct {
        body string
        err  error
    }
    out := make(chan result, 2)

    go func() { out <- fetch(ctx, urls[0]) }()
    go func() {
        select {
        case <-ctx.Done():
            return
        case <-time.After(delay):
        }
        if len(urls) > 1 {
            out <- fetch(ctx, urls[1])
        }
    }()

    r := <-out
    return r.body, r.err
}
```

---

## Wrap-up

After completing these tasks you should feel comfortable:

- Writing concurrent Go code that works.
- Recognising when concurrency helps and when it does not.
- Diagnosing data races, goroutine leaks, false sharing, and bottleneck migration.
- Applying Amdahl's law to predict speedup.
- Building structured pipelines and scatter-gather flows with proper cancellation.

The next file (`find-bug.md`) tests your debugging skills on broken concurrent code.
