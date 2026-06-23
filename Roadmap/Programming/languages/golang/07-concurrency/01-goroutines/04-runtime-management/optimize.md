# Runtime Goroutine Management — Optimization Exercises

Each exercise gives a working but suboptimal program plus a target. The goal is to apply the right runtime knob (or to *remove* one that was hurting) and measure the improvement.

---

## Easy

### Exercise 1 — Right-size `GOMAXPROCS` for a CPU-bound container

**Starting code:**

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func main() {
    fmt.Println("GOMAXPROCS:", runtime.GOMAXPROCS(0))
    var wg sync.WaitGroup
    start := time.Now()
    for i := 0; i < 16; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            sum := 0
            for j := 0; j < 200_000_000; j++ {
                sum += j
            }
            _ = sum
        }()
    }
    wg.Wait()
    fmt.Println("elapsed:", time.Since(start))
}
```

**Baseline.** Run in a container limited to 2 CPUs on a 16-core host. Without intervention, `GOMAXPROCS` is 16; the runtime oversubscribes and the kernel throttles.

**Target.** Reduce elapsed time by ~25% via correct `GOMAXPROCS`.

**Constraint.** Do not change the workload.

---

### Exercise 2 — Remove `runtime.Gosched` from a hot loop

**Starting code:**

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    start := time.Now()
    sum := 0
    for i := 0; i < 100_000_000; i++ {
        sum += i * i
        runtime.Gosched()
    }
    fmt.Println(sum, time.Since(start))
}
```

**Target.** Speed up by ≥ 5x.

**Constraint.** Keep the workload identical.

---

### Exercise 3 — Replace `ReadMemStats` polling with `runtime/metrics`

**Starting code:**

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func report() {
    var m runtime.MemStats
    for range time.Tick(time.Second) {
        runtime.ReadMemStats(&m)
        fmt.Println("heap:", m.HeapAlloc, "gc cycles:", m.NumGC)
    }
}

func main() {
    go report()
    var data [][]byte
    for {
        data = append(data, make([]byte, 1<<16))
        if len(data) > 10000 {
            data = data[:0]
        }
        time.Sleep(time.Millisecond)
    }
}
```

**Issue.** `runtime.ReadMemStats` stops the world briefly each call (~ms on a busy heap).

**Target.** Replace with `runtime/metrics` to avoid STW. Confirm via a CPU profile that the pause is gone.

---

### Exercise 4 — Set `GOMEMLIMIT` to prevent OOM

**Starting code:** A program allocates aggressively in bursts. Without `GOMEMLIMIT`, in a 1 GB container, it eventually OOM-kills.

```go
package main

import (
    "time"
)

func main() {
    var keep [][]byte
    for {
        for i := 0; i < 1000; i++ {
            keep = append(keep, make([]byte, 1<<20))
        }
        time.Sleep(2 * time.Second)
        keep = keep[:100] // drop most
        time.Sleep(2 * time.Second)
    }
}
```

**Target.** Add `debug.SetMemoryLimit` so the program never OOMs in a 1 GB container.

**Constraint.** Throughput may degrade; survival is the goal.

---

### Exercise 5 — Add `pprof.Do` middleware

**Starting code:**

```go
package main

import (
    "fmt"
    "net/http"
)

func handle(w http.ResponseWriter, r *http.Request) {
    sum := 0
    for i := 0; i < 100_000_000; i++ {
        sum += i
    }
    fmt.Fprintf(w, "%d", sum)
}

func main() {
    http.HandleFunc("/work", handle)
    http.ListenAndServe(":8080", nil)
}
```

**Target.** Wrap the handler with `pprof.Do` so a CPU profile (`go tool pprof http://localhost:8080/debug/pprof/profile?seconds=5`) can be sliced by endpoint and method.

---

## Medium

### Exercise 6 — Tune `GOGC` for a memory-rich, latency-sensitive service

**Starting code:** A web service with a typical heap of 800 MB on a 4 GB host, default `GOGC=100`. Profile shows GC consumes 18% of CPU.

**Target.** Reduce GC CPU to under 10% without exceeding 2 GB heap.

**Constraint.** Workload unchanged.

---

### Exercise 7 — Reduce goroutine churn via worker pool

**Starting code:**

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func main() {
    start := time.Now()
    var wg sync.WaitGroup
    for i := 0; i < 200_000; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            sum := 0
            for j := 0; j < 1000; j++ {
                sum += j
            }
            _ = sum
        }(i)
    }
    wg.Wait()
    fmt.Println("elapsed:", time.Since(start), "goroutines now:", runtime.NumGoroutine())
}
```

**Issue.** 200 000 ultra-short goroutines; scheduling overhead dominates.

**Target.** Reduce elapsed time by ≥ 30% via a bounded pool. Use `errgroup.SetLimit(N)` or a manual channel pool with `N = GOMAXPROCS`.

---

### Exercise 8 — Adopt the official Go runtime metrics collector

**Starting code:**

```go
package main

import (
    "net/http"
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

var heapGauge = prometheus.NewGauge(prometheus.GaugeOpts{
    Name: "go_heap_alloc_bytes",
})

func main() {
    prometheus.MustRegister(heapGauge)
    // Manually update heapGauge from runtime.MemStats in a loop...
    http.Handle("/metrics", promhttp.Handler())
    http.ListenAndServe(":2112", nil)
}
```

**Target.** Replace with `collectors.NewGoCollector(WithGoRuntimeMetricsCollection)`. Confirm `/metrics` exports dozens of `go_` metrics including histograms.

---

### Exercise 9 — Cap stack growth in a recursion-prone codebase

**Context.** Your code uses a recursive parser. A malformed input has triggered a goroutine stack growing to 800 MB before failure, eating into the container's memory.

**Target.** Set `debug.SetMaxStack` to crash early. Choose a value: 16 MB? 8 MB? Justify.

---

### Exercise 10 — Mutex profile only during investigation

**Starting code:** Service runs with `runtime.SetMutexProfileFraction(1)` (every event) all the time. Overhead is noticeable in CPU profile (~3% spent in mutex profile recording).

**Target.** Reduce baseline overhead. Provide a `/debug/mutex/enable?rate=N` and `/debug/mutex/disable` admin endpoint so the profile can be turned on for an investigation.

---

## Hard

### Exercise 11 — Adaptive `GOMEMLIMIT` controller

**Starting code:**

```go
debug.SetMemoryLimit(900 << 20) // static
```

**Target.** Write a controller that:

1. Reads `/proc/pressure/memory` every 30 s.
2. Lowers the limit when PSI `some` avg10 > 5.0 (floor at 60% of base).
3. Raises back toward 90% of container cap when avg10 < 1.0.
4. Logs each change.

Validate by running the program in a container alongside a memory-pressuring neighbour.

---

### Exercise 12 — Build a `pprof`-label-aware logging middleware

**Goal.** Add structured logging to your HTTP handlers that includes the current pprof labels for cross-correlation with profiles.

```go
func loggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // 1. Set pprof labels for endpoint + method
        // 2. Run handler
        // 3. After handler, log entry includes all labels
        // 4. Use pprof.ForLabels to enumerate
    })
}
```

**Target.** Logs have fields matching the profile labels. Test by capturing a CPU profile and a log line for the same request and verifying labels match.

---

### Exercise 13 — Continuous-profile pipeline in 200 lines

**Goal.** Write an in-process profiler that, every 60 s:

- Takes a 10-second CPU profile.
- Takes a heap snapshot.
- Takes a goroutine snapshot.
- POSTs each to `http://profiler:8080/upload?type=cpu|heap|goroutine&svc=$NAME&host=$HOST`.

Handle failures gracefully (network down, profiler unreachable). Cap CPU overhead to < 1%.

---

### Exercise 14 — Stack-trace-driven leak detection in tests

**Starting code:**

```go
func TestSomeWorkflow(t *testing.T) {
    runMyCode()
}
```

**Target.** Wrap with a setup/teardown that:

1. Records `pprof.Lookup("goroutine").WriteTo(buf, 1)` before the test.
2. Calls `runtime.GC()` and waits up to 5 s for goroutine counts to stabilize.
3. Records the same profile after.
4. Diff: any creation stack with more goroutines after fails the test.

Use it on a known-leaky function and confirm it fails.

---

### Exercise 15 — Trace-driven scheduler latency investigation

**Context.** A service shows `/sched/latencies:seconds` p99 at 5 ms. You suspect a goroutine storm.

**Target.**

1. Capture a `runtime/trace` for 5 seconds during the spike.
2. Open in `go tool trace`. Look at the scheduler latency profile.
3. Identify the goroutine creation site responsible for the spike.
4. Refactor: replace unbounded `go fn()` with a bounded pool.
5. Re-capture trace. Confirm p99 < 1 ms.

---

## Solutions

### Solution 1 — `GOMAXPROCS` for container

Use `uber-go/automaxprocs`:

```go
import _ "go.uber.org/automaxprocs"
```

Or manually:

```go
runtime.GOMAXPROCS(2)
```

With 2 cores actually available, runtime stops oversubscribing. Elapsed drops because there is no longer kernel-level CPU throttling penalty.

---

### Solution 2 — Remove `Gosched`

```go
for i := 0; i < 100_000_000; i++ {
    sum += i * i
}
```

5–10x speedup. Each `Gosched` is ~300 ns; multiplied by 10^8, that is 30 seconds wasted in scheduler overhead.

---

### Solution 3 — `runtime/metrics`

```go
import "runtime/metrics"

func report() {
    samples := []metrics.Sample{
        {Name: "/memory/classes/heap/objects:bytes"},
        {Name: "/gc/cycles/total:gc-cycles"},
    }
    for range time.Tick(time.Second) {
        metrics.Read(samples)
        fmt.Println("heap:", samples[0].Value.Uint64(), "gc cycles:", samples[1].Value.Uint64())
    }
}
```

No STW pause. Most metrics are continuously updated; reads are atomic.

---

### Solution 4 — `SetMemoryLimit`

```go
import "runtime/debug"

func init() {
    debug.SetMemoryLimit(900 << 20) // 90% of 1 GB
}
```

Now when the workload bursts, the runtime preemptively GCs and (when necessary) returns memory to the OS via the scavenger. Process survives even if throughput dips.

---

### Solution 5 — Profile labels middleware

```go
import (
    "context"
    "net/http"
    "runtime/pprof"
)

func labelsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        labels := pprof.Labels(
            "endpoint", r.URL.Path,
            "method",   r.Method,
        )
        pprof.Do(r.Context(), labels, func(ctx context.Context) {
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    })
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/work", handle)
    http.ListenAndServe(":8080", labelsMiddleware(mux))
}
```

Then `go tool pprof -tagfocus=endpoint=/work http://localhost:8080/debug/pprof/profile?seconds=5`.

---

### Solution 6 — Tune `GOGC`

Raise `GOGC` to 200 — GC triggers when heap doubles vs 100%. GC frequency halves; CPU time spent in GC drops similarly. Heap grows somewhat (closer to 1.5 GB peak) but stays under 2 GB.

```go
debug.SetGCPercent(200)
```

Measure with `/cpu/classes/gc/total:cpu-seconds` over a stable interval. If still too high, raise further or set `GOMEMLIMIT` to bound total memory.

---

### Solution 7 — Bounded pool

```go
import "golang.org/x/sync/errgroup"

g := new(errgroup.Group)
g.SetLimit(runtime.GOMAXPROCS(0))
for i := 0; i < 200_000; i++ {
    i := i
    g.Go(func() error {
        sum := 0
        for j := 0; j < 1000; j++ {
            sum += j
        }
        _ = sum
        return nil
    })
}
g.Wait()
```

Or:

```go
jobs := make(chan int, 1000)
var wg sync.WaitGroup
for w := 0; w < runtime.GOMAXPROCS(0); w++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for range jobs {
            sum := 0
            for j := 0; j < 1000; j++ {
                sum += j
            }
            _ = sum
        }
    }()
}
for i := 0; i < 200_000; i++ {
    jobs <- i
}
close(jobs)
wg.Wait()
```

Throughput improves because the scheduler is not constantly creating, parking, and reclaiming short-lived goroutines.

---

### Solution 8 — Official collector

```go
import (
    "net/http"
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/collectors"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
    reg := prometheus.NewRegistry()
    reg.MustRegister(collectors.NewGoCollector(
        collectors.WithGoCollections(
            collectors.GoRuntimeMetricsCollection,
        ),
    ))
    http.Handle("/metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))
    http.ListenAndServe(":2112", nil)
}
```

`/metrics` now exposes `go_sched_goroutines`, `go_gc_pauses_seconds_bucket` (histogram), `go_memory_classes_heap_objects_bytes`, plus dozens more.

---

### Solution 9 — `SetMaxStack`

8 MB is plenty for any reasonable Go function — far above the few KB most goroutines actually use, but small enough to crash quickly on infinite recursion.

```go
debug.SetMaxStack(8 << 20)
```

Justification: at 8 MB, a runaway recursion crashes in milliseconds, not after eating the container's entire memory. If a legitimate algorithm needs more, prefer iterative restructuring.

---

### Solution 10 — Toggleable mutex profile

```go
mux.HandleFunc("/debug/mutex/enable", func(w http.ResponseWriter, r *http.Request) {
    rate, _ := strconv.Atoi(r.URL.Query().Get("rate"))
    if rate <= 0 { rate = 5 }
    prev := runtime.SetMutexProfileFraction(rate)
    fmt.Fprintf(w, "set to %d (prev %d)", rate, prev)
})
mux.HandleFunc("/debug/mutex/disable", func(w http.ResponseWriter, _ *http.Request) {
    prev := runtime.SetMutexProfileFraction(0)
    fmt.Fprintf(w, "disabled (prev %d)", prev)
})
```

Auth-protect both. Default state is disabled; an operator enables before investigation and disables after.

---

### Solution 11 — Adaptive `SetMemoryLimit`

```go
type psi struct {
    SomeAvg10 float64
}

func readPSI(path string) (psi, error) {
    b, err := os.ReadFile(path)
    if err != nil { return psi{}, err }
    for _, line := range strings.Split(string(b), "\n") {
        if !strings.HasPrefix(line, "some ") { continue }
        var avg10, avg60, avg300 float64
        var total int64
        fmt.Sscanf(line, "some avg10=%f avg60=%f avg300=%f total=%d",
            &avg10, &avg60, &avg300, &total)
        return psi{SomeAvg10: avg10}, nil
    }
    return psi{}, nil
}

func runAdapter(ctx context.Context, capBytes int64) {
    base  := capBytes * 90 / 100
    floor := capBytes * 60 / 100
    cur   := base
    debug.SetMemoryLimit(cur)
    log.Printf("SetMemoryLimit %d", cur)
    t := time.NewTicker(30 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            p, err := readPSI("/proc/pressure/memory")
            if err != nil { continue }
            target := cur
            switch {
            case p.SomeAvg10 > 5.0:
                target = cur * 90 / 100
                if target < floor { target = floor }
            case p.SomeAvg10 < 1.0:
                target = cur * 110 / 100
                if target > base { target = base }
            }
            if target != cur {
                debug.SetMemoryLimit(target)
                log.Printf("SetMemoryLimit %d -> %d (PSI=%.2f)", cur, target, p.SomeAvg10)
                cur = target
            }
        }
    }
}
```

Validate: start a `stress-ng --vm 2 --vm-bytes 500M` in a neighbouring container. Watch the limit drop and rise.

---

### Solution 12 — Logging middleware

```go
func loggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        labels := pprof.Labels(
            "endpoint", r.URL.Path,
            "method",   r.Method,
            "request_id", r.Header.Get("X-Request-Id"),
        )
        pprof.Do(r.Context(), labels, func(ctx context.Context) {
            start := time.Now()
            next.ServeHTTP(w, r.WithContext(ctx))
            fields := map[string]string{}
            pprof.ForLabels(ctx, func(k, v string) bool {
                fields[k] = v
                return true
            })
            fields["duration_ms"] = strconv.FormatInt(time.Since(start).Milliseconds(), 10)
            // emit fields as JSON log line
            log.Println(toJSON(fields))
        })
    })
}
```

Each log line carries the labels; the same labels appear in profile output. Cross-correlation works.

---

### Solution 13 — Continuous profiler

Sketch with cap on CPU overhead:

```go
func profilerLoop(ctx context.Context, endpoint, svc, host string) {
    t := time.NewTicker(60 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done(): return
        case <-t.C:
        }
        var buf bytes.Buffer
        if err := pprof.StartCPUProfile(&buf); err == nil {
            select {
            case <-ctx.Done(): pprof.StopCPUProfile(); return
            case <-time.After(10 * time.Second):
            }
            pprof.StopCPUProfile()
            upload(endpoint, "cpu", svc, host, buf.Bytes())
        }
        buf.Reset()
        if err := pprof.Lookup("heap").WriteTo(&buf, 0); err == nil {
            upload(endpoint, "heap", svc, host, buf.Bytes())
        }
        buf.Reset()
        if err := pprof.Lookup("goroutine").WriteTo(&buf, 0); err == nil {
            upload(endpoint, "goroutine", svc, host, buf.Bytes())
        }
    }
}

func upload(endpoint, kind, svc, host string, data []byte) {
    req, _ := http.NewRequest("POST",
        fmt.Sprintf("%s/upload?type=%s&svc=%s&host=%s", endpoint, kind, svc, host),
        bytes.NewReader(data))
    client := &http.Client{Timeout: 30 * time.Second}
    resp, err := client.Do(req)
    if err != nil { return }
    resp.Body.Close()
}
```

Total CPU overhead: ~10 sec/60 sec × 0.1% baseline overhead = ~0.02%. Plus snapshots: a few ms each. Well under 1%.

---

### Solution 14 — Leak-detecting test wrapper

```go
import "runtime/pprof"

func goroutineDump() string {
    var buf bytes.Buffer
    pprof.Lookup("goroutine").WriteTo(&buf, 1)
    return buf.String()
}

func leakCheck(t *testing.T, fn func()) {
    t.Helper()
    before := goroutineDump()
    fn()
    for i := 0; i < 50; i++ {
        runtime.GC()
        if runtime.NumGoroutine() == strings.Count(before, "goroutine ") {
            return
        }
        time.Sleep(100 * time.Millisecond)
    }
    after := goroutineDump()
    t.Errorf("possible leak\n--- BEFORE ---\n%s\n--- AFTER ---\n%s", before, after)
}
```

Or use `go.uber.org/goleak`, which does this in a production-ready way.

---

### Solution 15 — Trace-driven investigation

1. Capture: `curl http://service:8080/debug/trace?seconds=5 > trace.out`.
2. Open: `go tool trace trace.out`.
3. Navigate: "Scheduler latency profile" — shows aggregate scheduler wait by goroutine creation site.
4. Identify the top creation site. Usually a handler that spawns one or more goroutines per request without bound.
5. Refactor:

```go
// Before
go fetchA(ctx, id)
go fetchB(ctx, id)

// After: bounded pool, reused across requests
var pool = newWorkerPool(runtime.GOMAXPROCS(0) * 2)
pool.submit(func() { fetchA(ctx, id) })
pool.submit(func() { fetchB(ctx, id) })
```

6. Re-capture. p99 of `/sched/latencies:seconds` should drop.

In some workloads the right fix is *not* a pool but reducing concurrency upstream. The trace tells you which.
