# Scheduler Tracing — Tasks

[Back to index](index.md)

Hands-on exercises. Each task has a goal, suggested approach, success criteria, and a hint section. Do them in order; later tasks build on what earlier ones taught.

## Table of Contents
1. [Task 1: Read Your First schedtrace](#task-1-read-your-first-schedtrace)
2. [Task 2: Identify Per-P Imbalance](#task-2-identify-per-p-imbalance)
3. [Task 3: Capture and Open Your First Trace](#task-3-capture-and-open-your-first-trace)
4. [Task 4: Diagnose with Goroutine Analysis](#task-4-diagnose-with-goroutine-analysis)
5. [Task 5: Instrument a Server with Tasks and Regions](#task-5-instrument-a-server-with-tasks-and-regions)
6. [Task 6: Build a Continuous Tracing Loop](#task-6-build-a-continuous-tracing-loop)
7. [Task 7: Export Scheduler Metrics to Prometheus](#task-7-export-scheduler-metrics-to-prometheus)
8. [Task 8: Compute p99 Scheduler Latency](#task-8-compute-p99-scheduler-latency)
9. [Task 9: Extract Sched Profile to pprof](#task-9-extract-sched-profile-to-pprof)
10. [Task 10: Build a Custom Trace Analyzer](#task-10-build-a-custom-trace-analyzer)

---

## Task 1: Read Your First schedtrace

**Goal.** Produce, capture, and interpret a `schedtrace` stream.

**Steps.**

1. Write a small program that creates 100 goroutines, each doing a CPU-bound loop for 1 second.
2. Run with `GODEBUG=schedtrace=200`.
3. Redirect stderr to a file: `2>sched.log`.

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            x := 0
            for j := 0; j < 100_000_000; j++ {
                x += j
            }
            _ = x
            if id == 0 {
                fmt.Println("done")
            }
        }(i)
    }
    wg.Wait()
}
```

**Success.** Your log file contains lines like:

```
SCHED 0ms: gomaxprocs=8 idleprocs=8 threads=2 spinningthreads=0 needspinning=0 idlethreads=0 runqueue=0 [0 0 0 0 0 0 0 0]
SCHED 203ms: gomaxprocs=8 idleprocs=0 threads=10 spinningthreads=0 needspinning=0 idlethreads=2 runqueue=20 [12 11 13 10 12 11 12 12]
SCHED 405ms: gomaxprocs=8 idleprocs=0 threads=10 spinningthreads=0 needspinning=0 idlethreads=2 runqueue=15 [10 9 11 8 11 9 10 11]
```

**Verify your understanding.**

- What is the `gomaxprocs` value? Why?
- What does `runqueue=20` mean?
- Why does `threads` start at 2 then jump?

**Hint.** `gomaxprocs` equals `runtime.GOMAXPROCS(0)`. Threads jump because new Ms spawn when Ps have work waiting. The runqueue is the global queue — overflow from local runqueues.

---

## Task 2: Identify Per-P Imbalance

**Goal.** Construct a program where work is intentionally concentrated on two Ps, and observe the imbalance in `schedtrace`.

**Steps.**

1. Set `runtime.GOMAXPROCS(8)`.
2. Spawn 2 goroutines that each spawn 10 children in a tight loop, then exit. Spawn rate should keep two Ps busy.
3. Run with `GODEBUG=schedtrace=200`.

```go
package main

import (
    "runtime"
    "sync"
    "time"
)

func main() {
    runtime.GOMAXPROCS(8)
    var wg sync.WaitGroup
    for p := 0; p < 2; p++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            deadline := time.Now().Add(2 * time.Second)
            for time.Now().Before(deadline) {
                for i := 0; i < 10; i++ {
                    go func() {
                        x := 0
                        for j := 0; j < 100_000; j++ {
                            x += j
                        }
                        _ = x
                    }()
                }
                runtime.Gosched()
            }
        }()
    }
    wg.Wait()
}
```

**Success.** schedtrace lines show one or two Ps with large local runqueues; the others smaller. Steal eventually balances them but there is a transient imbalance.

```
SCHED 200ms: ... [120 110 5 5 5 5 5 5]
```

**Verify.** Without steal (which is built in), all the children would queue on the producer's P. The 5-each across other Ps is the result of stealing.

---

## Task 3: Capture and Open Your First Trace

**Goal.** Capture a `runtime/trace`, open it in `go tool trace`, and tour the views.

**Steps.**

1. Modify the program from Task 1 to call `trace.Start` and `trace.Stop`:

```go
package main

import (
    "log"
    "os"
    "runtime/trace"
    "sync"
)

func main() {
    f, err := os.Create("trace.out")
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()
    if err := trace.Start(f); err != nil {
        log.Fatal(err)
    }
    defer trace.Stop()

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            x := 0
            for j := 0; j < 10_000_000; j++ {
                x += j
            }
            _ = x
        }()
    }
    wg.Wait()
}
```

2. Run, then `go tool trace trace.out`.

**Success.** A browser opens. Confirm you can:

- See N per-P lanes in **View trace by proc**.
- Open **Goroutine analysis** and see `main.main.func1` listed.
- Open **Scheduler latency profile** — at low load, p99 should be < 1ms.

**Verify.** Click around. Hover the timeline blocks. Note the durations.

---

## Task 4: Diagnose with Goroutine Analysis

**Goal.** Use the goroutine analysis view to find which function dominates scheduler waiting.

**Steps.**

1. Write a program that mixes a CPU-bound function and a channel-passing function:

```go
package main

import (
    "log"
    "os"
    "runtime/trace"
    "sync"
)

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    var wg sync.WaitGroup
    ch := make(chan int, 1)

    for i := 0; i < 32; i++ {
        wg.Add(1)
        go cpuWorker(&wg)
    }
    for i := 0; i < 32; i++ {
        wg.Add(1)
        go chanWorker(&wg, ch)
    }
    go func() {
        for i := 0; i < 1024; i++ {
            ch <- i
        }
        close(ch)
    }()

    wg.Wait()
    log.Println("done")
}

func cpuWorker(wg *sync.WaitGroup) {
    defer wg.Done()
    x := 0
    for i := 0; i < 50_000_000; i++ {
        x += i
    }
    _ = x
}

func chanWorker(wg *sync.WaitGroup, ch chan int) {
    defer wg.Done()
    for range ch {
        // nothing; just consume.
    }
}
```

2. Run, open trace, navigate to **Goroutine analysis**.

**Success.** You see two function rows: `main.cpuWorker` with mostly Execution time, and `main.chanWorker` with significant Sync time (waiting on channel receive).

---

## Task 5: Instrument a Server with Tasks and Regions

**Goal.** Add `trace.NewTask` and `trace.WithRegion` to an HTTP handler; observe in the User-defined views.

**Steps.**

1. Write a server with three phases per request: parse, query, encode.

```go
package main

import (
    "context"
    "fmt"
    "net/http"
    _ "net/http/pprof"
    "runtime/trace"
    "time"
)

func handle(w http.ResponseWriter, r *http.Request) {
    ctx, task := trace.NewTask(r.Context(), "handle")
    defer task.End()

    var result string
    trace.WithRegion(ctx, "parse", func() {
        time.Sleep(2 * time.Millisecond)
    })
    trace.WithRegion(ctx, "query", func() {
        time.Sleep(10 * time.Millisecond)
        result = "ok"
    })
    trace.WithRegion(ctx, "encode", func() {
        fmt.Fprintln(w, result)
    })
}

func main() {
    http.HandleFunc("/", handle)
    http.ListenAndServe("127.0.0.1:8080", nil)
}
```

2. Start the server.
3. From another shell, capture a trace and load with `wrk` or `hey`:

```bash
curl -o trace.out http://127.0.0.1:8080/debug/pprof/trace?seconds=5 &
hey -z 5s -c 50 http://127.0.0.1:8080/
wait
go tool trace trace.out
```

4. Open **User-defined tasks**. You should see hundreds of `handle` tasks, each with average duration ~12ms.
5. Open **User-defined regions**. You should see `parse` ~2ms, `query` ~10ms, `encode` <1ms.

**Success.** Click on a slow `handle` task. Confirm its child regions match the phases.

---

## Task 6: Build a Continuous Tracing Loop

**Goal.** Implement a background goroutine that captures 2-second traces every minute, rotating files.

**Skeleton.**

```go
package main

import (
    "context"
    "fmt"
    "log"
    "os"
    "path/filepath"
    "runtime/trace"
    "time"
)

func runTraceLoop(ctx context.Context, dir string, every, dur time.Duration) {
    if err := os.MkdirAll(dir, 0o755); err != nil {
        log.Printf("mkdir: %v", err)
        return
    }
    t := time.NewTicker(every)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            captureOne(dir, dur, now)
        }
    }
}

func captureOne(dir string, dur time.Duration, now time.Time) {
    name := filepath.Join(dir, fmt.Sprintf("trace-%s.out", now.Format("20060102T150405")))
    f, err := os.Create(name)
    if err != nil {
        log.Printf("create: %v", err)
        return
    }
    defer f.Close()
    if err := trace.Start(f); err != nil {
        log.Printf("trace.Start: %v", err)
        return
    }
    time.Sleep(dur)
    trace.Stop()
    log.Printf("captured: %s", name)
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    go runTraceLoop(ctx, "/tmp/traces", time.Minute, 2*time.Second)

    // Application work here. For demo:
    for i := 0; i < 60; i++ {
        time.Sleep(time.Second)
    }
}
```

**Add.** A retention policy: keep only the most recent N files; delete older ones.

**Success.** After 10 minutes, `/tmp/traces` contains 10 files of ~few-MB each. Open one with `go tool trace`.

---

## Task 7: Export Scheduler Metrics to Prometheus

**Goal.** Implement a `/metrics` HTTP endpoint that reports goroutine count and scheduler-latency histogram.

**Skeleton.**

```go
package main

import (
    "fmt"
    "net/http"
    "runtime/metrics"
)

func metricsHandler(w http.ResponseWriter, r *http.Request) {
    samples := []metrics.Sample{
        {Name: "/sched/goroutines:goroutines"},
        {Name: "/sched/latencies:seconds"},
    }
    metrics.Read(samples)

    fmt.Fprintln(w, "# HELP go_goroutines Live goroutine count")
    fmt.Fprintln(w, "# TYPE go_goroutines gauge")
    fmt.Fprintf(w, "go_goroutines %d\n", samples[0].Value.Uint64())

    h := samples[1].Value.Float64Histogram()
    fmt.Fprintln(w, "# HELP go_sched_latency_seconds Scheduler latency histogram")
    fmt.Fprintln(w, "# TYPE go_sched_latency_seconds histogram")
    var cumulative uint64
    for i, c := range h.Counts {
        cumulative += c
        fmt.Fprintf(w, "go_sched_latency_seconds_bucket{le=\"%g\"} %d\n", h.Buckets[i+1], cumulative)
    }
    fmt.Fprintf(w, "go_sched_latency_seconds_bucket{le=\"+Inf\"} %d\n", cumulative)
    fmt.Fprintf(w, "go_sched_latency_seconds_count %d\n", cumulative)
}

func main() {
    http.HandleFunc("/metrics", metricsHandler)
    http.ListenAndServe("127.0.0.1:9090", nil)
}
```

**Success.** `curl http://127.0.0.1:9090/metrics` returns Prometheus-format output. Add this to a real Prometheus and graph `histogram_quantile(0.99, rate(go_sched_latency_seconds_bucket[1m]))`.

---

## Task 8: Compute p99 Scheduler Latency

**Goal.** Write a function that reads `/sched/latencies:seconds` and returns p50, p99, p999.

```go
package main

import (
    "fmt"
    "runtime/metrics"
)

func percentiles() (p50, p99, p999 float64) {
    s := metrics.Sample{Name: "/sched/latencies:seconds"}
    metrics.Read([]metrics.Sample{s})
    h := s.Value.Float64Histogram()
    var total uint64
    for _, c := range h.Counts {
        total += c
    }
    if total == 0 {
        return
    }
    targets := map[float64]uint64{
        0.50:  total / 2,
        0.99:  total - total/100,
        0.999: total - total/1000,
    }
    var cum uint64
    var p map[float64]float64 = make(map[float64]float64)
    for i, c := range h.Counts {
        cum += c
        upper := h.Buckets[i+1]
        for q, t := range targets {
            if _, ok := p[q]; !ok && cum >= t {
                p[q] = upper
            }
        }
    }
    return p[0.50], p[0.99], p[0.999]
}

func main() {
    p50, p99, p999 := percentiles()
    fmt.Printf("p50=%.6fs p99=%.6fs p999=%.6fs\n", p50, p99, p999)
}
```

**Success.** Under no load, p99 < 100µs. Run under a busy CPU-bound workload (e.g., from Task 1) and observe p99 rise.

---

## Task 9: Extract Sched Profile to pprof

**Goal.** Capture a trace, extract the scheduler latency profile, open in pprof.

**Steps.**

1. Capture a trace from any of the previous tasks.
2. Run:

```bash
go tool trace -pprof=sched trace.out > sched.prof
go tool pprof -http=:8080 sched.prof
```

3. Open `http://localhost:8080` in browser.

**Success.** You see a flame graph of scheduler-latency time attributed to the functions that became runnable. Use pprof commands like `top`, `list`, `peek`, and `focus` to filter.

---

## Task 10: Build a Custom Trace Analyzer

**Goal.** Use `golang.org/x/exp/trace` to parse a trace and compute per-task duration histograms.

**Skeleton.**

```go
package main

import (
    "fmt"
    "io"
    "log"
    "os"
    "sort"

    "golang.org/x/exp/trace"
)

func main() {
    if len(os.Args) < 2 {
        log.Fatal("usage: analyze trace.out")
    }
    f, err := os.Open(os.Args[1])
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()

    r, err := trace.NewReader(f)
    if err != nil {
        log.Fatal(err)
    }

    type taskInfo struct {
        name  string
        start trace.Time
    }
    tasks := map[trace.TaskID]taskInfo{}
    durations := map[string][]float64{}

    for {
        ev, err := r.ReadEvent()
        if err == io.EOF {
            break
        }
        if err != nil {
            log.Fatal(err)
        }
        switch ev.Kind() {
        case trace.EventTaskBegin:
            t := ev.Task()
            tasks[t.ID] = taskInfo{name: t.Type, start: ev.Time()}
        case trace.EventTaskEnd:
            t := ev.Task()
            if info, ok := tasks[t.ID]; ok {
                durations[info.name] = append(durations[info.name], ev.Time().Sub(info.start).Seconds())
                delete(tasks, t.ID)
            }
        }
    }

    for name, ds := range durations {
        sort.Float64s(ds)
        if len(ds) == 0 {
            continue
        }
        p50 := ds[len(ds)/2]
        p99 := ds[len(ds)-len(ds)/100-1]
        fmt.Printf("%-20s n=%d p50=%.3fms p99=%.3fms\n", name, len(ds), p50*1000, p99*1000)
    }
}
```

**Success.** Run on a trace from Task 5. Output looks like:

```
handle               n=250 p50=12.345ms p99=14.567ms
```

**Stretch.** Add filter flags. Bucket by hour. Compare two traces.

---

## Wrap-Up

You have:

- Read `schedtrace` and `scheddetail` output.
- Captured and analysed a `runtime/trace` in the UI.
- Instrumented a server with tasks and regions.
- Built continuous tracing.
- Exported scheduler metrics.
- Computed scheduler-latency percentiles.
- Extracted a scheduler profile to pprof.
- Built a custom trace analyzer.

Move on to `find-bug.md` for diagnostic exercises with broken code, and `optimize.md` for performance improvements driven by trace data.
