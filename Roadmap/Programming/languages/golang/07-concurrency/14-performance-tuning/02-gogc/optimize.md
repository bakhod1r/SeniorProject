# GOGC and GOMEMLIMIT — Optimization Exercises

> Each exercise gives a working but suboptimal program, a target metric, and asks you to improve. Solutions are at the end. The goal is to internalise the cost model of GC tuning and apply it to realistic workloads.

---

## Easy

### Exercise 1 — Reduce GC frequency for a batch job

**Starting code:**

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

type Item struct {
    ID   int
    Data [128]byte
}

func process(items []Item) int {
    sum := 0
    for i := range items {
        sum += int(items[i].Data[0])
    }
    return sum
}

func main() {
    start := time.Now()
    total := 0
    for i := 0; i < 10_000; i++ {
        batch := make([]Item, 1000)
        total += process(batch)
    }
    fmt.Println("total:", total)
    fmt.Println("elapsed:", time.Since(start))

    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Println("NumGC:", m.NumGC)
    fmt.Println("PauseTotal:", time.Duration(m.PauseTotalNs))
}
```

**Baseline.** ~50–80 GC cycles, noticeable pause total. **Target.** ≤10 GC cycles, faster wall-clock. **Constraint.** No source change to `process` or `Item`.

---

### Exercise 2 — Cap container memory usage

**Starting code:**

```go
package main

import (
    "fmt"
    "runtime"
)

var keep [][]byte

func main() {
    for i := 0; i < 1000; i++ {
        keep = append(keep, make([]byte, 1<<20)) // 1 MiB each
    }
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("Sys: %d MiB\n", m.Sys>>20)
}
```

**Baseline.** `Sys` grows to ~1100 MiB. **Target.** Keep `Sys` under 1200 MiB but ensure all 1000 allocations succeed. **Constraint.** Setting an artificially low `GOMEMLIMIT` that causes a death spiral is not acceptable.

---

### Exercise 3 — Cut allocations in a hot path

**Starting code:**

```go
package main

import (
    "fmt"
    "runtime"
    "strings"
)

func joinNumbers(nums []int) string {
    s := ""
    for _, n := range nums {
        s += fmt.Sprintf("%d,", n)
    }
    return strings.TrimRight(s, ",")
}

func main() {
    var before, after runtime.MemStats
    runtime.ReadMemStats(&before)
    for i := 0; i < 10_000; i++ {
        _ = joinNumbers([]int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10})
    }
    runtime.ReadMemStats(&after)
    fmt.Println("alloc:", after.TotalAlloc-before.TotalAlloc)
    fmt.Println("ngc:", after.NumGC-before.NumGC)
}
```

**Baseline.** Heavy allocation per call. **Target.** Reduce `TotalAlloc` by at least 80%. **Constraint.** Function signature stays the same.

---

## Medium

### Exercise 4 — Apply `sync.Pool` to a buffer

**Starting code:**

```go
package main

import (
    "bytes"
    "fmt"
    "runtime"
)

func encode(v int) []byte {
    var buf bytes.Buffer
    fmt.Fprintf(&buf, "value=%d", v)
    return buf.Bytes()
}

func main() {
    var before, after runtime.MemStats
    runtime.ReadMemStats(&before)
    sum := 0
    for i := 0; i < 1_000_000; i++ {
        b := encode(i)
        sum += len(b)
    }
    runtime.ReadMemStats(&after)
    fmt.Println("sum:", sum)
    fmt.Println("alloc:", after.TotalAlloc-before.TotalAlloc)
    fmt.Println("ngc:", after.NumGC-before.NumGC)
}
```

**Baseline.** Each call allocates a new buffer plus a returned slice. **Target.** Reduce GC cycles by at least 50%. **Constraint.** The returned bytes are read by the caller; you must not break that contract.

---

### Exercise 5 — Tune a CPU-bound benchmark

**Starting code:**

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

type Node struct {
    V    int
    Next *Node
}

func build(n int) *Node {
    var head *Node
    for i := 0; i < n; i++ {
        head = &Node{V: i, Next: head}
    }
    return head
}

func sumAll(h *Node) int {
    s := 0
    for h != nil {
        s += h.V
        h = h.Next
    }
    return s
}

func main() {
    start := time.Now()
    for i := 0; i < 100; i++ {
        h := build(100_000)
        _ = sumAll(h)
    }
    fmt.Println("elapsed:", time.Since(start))

    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("NumGC: %d GCCPUFraction: %.2f%%\n", m.NumGC, m.GCCPUFraction*100)
}
```

**Baseline.** GC fraction is non-trivial because of the linked-list allocations. **Target.** Reduce wall-clock time. **Allowed.** Tuning `GOGC` and `GOMEMLIMIT`; you may also rewrite `build` if useful.

---

### Exercise 6 — Stabilise tail latency

**Starting code:**

```go
package main

import (
    "fmt"
    "math/rand"
    "time"
)

type Request struct {
    Body []byte
}

func handle(r Request) {
    // simulate work that allocates
    buf := make([]byte, len(r.Body)*4)
    for i := range buf {
        buf[i] = r.Body[i%len(r.Body)]
    }
    _ = buf
}

func main() {
    start := time.Now()
    var latencies []time.Duration
    for i := 0; i < 10_000; i++ {
        size := 1024 + rand.Intn(8192)
        r := Request{Body: make([]byte, size)}
        t := time.Now()
        handle(r)
        latencies = append(latencies, time.Since(t))
    }
    var max time.Duration
    for _, d := range latencies {
        if d > max {
            max = d
        }
    }
    fmt.Println("elapsed:", time.Since(start), "max:", max)
}
```

**Baseline.** `max` is dominated by occasional GC pauses or large allocations. **Target.** Reduce `max` to < 1 ms. **Allowed.** Pooling, escape analysis, tuning.

---

## Hard

### Exercise 7 — Container-aware tuning

You are deploying a service in a Kubernetes pod with `limits.memory: 1Gi`. The service has:

- A 200 MiB in-memory cache (long-lived).
- 5,000 concurrent HTTP requests, each allocating ~50 KiB.
- A cgo dependency that uses ~80 MiB of off-heap memory.

**Task.** Pick `GOMEMLIMIT` and `GOGC` values. Justify each number. Compute the expected peak `Sys` and the margin to the kernel limit.

---

### Exercise 8 — Diagnose and fix a death spiral

**Starting state.** Service in production with `GOMEMLIMIT=600MiB`. Live working set is ~700 MiB. `gctrace` shows `P%` at 50%, cycles back-to-back. Latency is degraded.

**Task.** Diagnose. Propose three possible fixes, in order of preference. Implement the first one (in code or config).

---

### Exercise 9 — Build a self-tuning admission controller

**Task.** Write HTTP middleware that:

1. Samples `runtime/metrics:/cpu/classes/gc/total:cpu-seconds` every 200 ms.
2. Computes the GC CPU fraction over the most recent 1 s window.
3. If the fraction exceeds 30%, returns HTTP 503 to new requests until the fraction drops below 20%.
4. Logs each transition.

**Target.** A service that survives an unbounded request burst without OOM-kill or runaway CPU.

---

### Exercise 10 — Compare three configurations under load

You have a Go HTTP API serving 50 KiB JSON responses at 5,000 req/s steady state.

**Configurations.**

1. **A.** `GOGC=100`, no `GOMEMLIMIT`, no pooling.
2. **B.** `GOGC=300`, `GOMEMLIMIT=2GiB`, no pooling.
3. **C.** `GOGC=100`, `GOMEMLIMIT=1.5GiB`, `sync.Pool` for response buffers.

**Task.** Predict, before running, which one wins on (a) average latency, (b) P99 latency, (c) RSS. Then run a benchmark with `wrk` or `vegeta` and report actual numbers.

---

## Solutions

### Solution 1

Raise `GOGC` so the heap grows more between cycles:

```sh
GOGC=500 go run main.go
```

GC cycles drop from ~50–80 to under 10. Wall-clock improves because less time is spent on mark and assist. Alternatively, reuse the `batch` slice across iterations (true optimisation):

```go
batch := make([]Item, 1000)
for i := 0; i < 10_000; i++ {
    total += process(batch)
}
```

Combined with `GOGC=300`, both wall-clock and GC count drop sharply.

### Solution 2

Set `GOMEMLIMIT=1200MiB`. The runtime will collect more aggressively as the heap approaches the limit, keeping `Sys` near 1200 MiB. The 1000 1-MiB allocations all succeed.

```sh
GOMEMLIMIT=1200MiB go run main.go
```

Verify `Sys` stays in range and no death spiral occurs (GC fraction stays under ~25%).

### Solution 3

Use `strings.Builder` (or `strconv.AppendInt` into a preallocated byte slice):

```go
func joinNumbers(nums []int) string {
    var b strings.Builder
    b.Grow(len(nums) * 4)
    for i, n := range nums {
        if i > 0 {
            b.WriteByte(',')
        }
        fmt.Fprintf(&b, "%d", n)
    }
    return b.String()
}
```

For even better:

```go
func joinNumbers(nums []int) string {
    buf := make([]byte, 0, len(nums)*4)
    for i, n := range nums {
        if i > 0 {
            buf = append(buf, ',')
        }
        buf = strconv.AppendInt(buf, int64(n), 10)
    }
    return string(buf)
}
```

`TotalAlloc` drops by an order of magnitude.

### Solution 4

```go
package main

import (
    "bytes"
    "fmt"
    "runtime"
    "sync"
)

var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func encode(v int) []byte {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    fmt.Fprintf(buf, "value=%d", v)
    out := make([]byte, buf.Len())
    copy(out, buf.Bytes())
    bufPool.Put(buf)
    return out
}
```

The pool eliminates the buffer allocation. `out` is still allocated because the caller's contract requires a fresh slice; if that contract is flexible, return a pooled byte slice instead.

### Solution 5

The linked-list nodes escape to the heap (each `&Node{...}`). Options:

1. **Allocate a slab.** Build the list inside a `[]Node` so the allocator can place them contiguously:

```go
nodes := make([]Node, n)
for i := 0; i < n; i++ {
    nodes[i] = Node{V: i}
    if i > 0 {
        nodes[i].Next = &nodes[i-1]
    }
}
head := &nodes[n-1]
```

Fewer allocations, better cache locality, less mark work.

2. **Tune.** `GOGC=500` reduces GC cycles substantially since the program is allocation-heavy.

Combining both is the cleanest win.

### Solution 6

The `make([]byte, len(r.Body)*4)` and `make([]byte, size)` allocations on every request cause occasional GC pauses. Pool both buffers and bound size class:

```go
package main

import (
    "fmt"
    "math/rand"
    "sync"
    "time"
)

var bufPool = sync.Pool{
    New: func() any {
        b := make([]byte, 64*1024)
        return &b
    },
}

func handle(body []byte) {
    bp := bufPool.Get().(*[]byte)
    defer bufPool.Put(bp)
    buf := (*bp)[:len(body)*4]
    for i := range buf {
        buf[i] = body[i%len(body)]
    }
    _ = buf
}

func main() {
    start := time.Now()
    var max time.Duration
    for i := 0; i < 10_000; i++ {
        size := 1024 + rand.Intn(8192)
        body := make([]byte, size)
        t := time.Now()
        handle(body)
        if d := time.Since(t); d > max {
            max = d
        }
    }
    fmt.Println("elapsed:", time.Since(start), "max:", max)
}
```

Pool the request body too if your real workload allows.

### Solution 7

**Pick values:**

- Container limit: 1024 MiB.
- Subtract cgo budget: ~80 MiB.
- Subtract runtime overhead margin: ~80 MiB.
- Available for Go heap: ~860 MiB.
- `GOMEMLIMIT=850MiB`.
- `GOGC=100` (default).

**Expected peak Sys:** ~850 MiB. **Margin:** 174 MiB to the kernel limit. **Justification:** the cache is long-lived and accounted for in `live`; per-request 50 KiB × 5,000 ≈ 250 MiB peak in-flight which fits comfortably below the limit.

### Solution 8

**Diagnosis.** Live data exceeds `GOMEMLIMIT`. The pacer races the limit, GC fires constantly, the 50% CPU cap kicks in. The service is wedged.

**Three fixes, in order of preference:**

1. **Raise `GOMEMLIMIT`** to ~110% of the actual working set (e.g., 800 MiB). The container limit must accommodate this.
2. **Reduce working set.** Identify the long-lived allocations (`pprof --heap`), shrink the cache, evict aggressively, switch to lazy loading.
3. **Scale horizontally.** Add replicas to reduce per-instance working set.

The configuration change (raising `GOMEMLIMIT`) is fastest. Code change (reducing working set) is the durable fix.

### Solution 9

```go
package main

import (
    "log"
    "net/http"
    "runtime/metrics"
    "sync/atomic"
    "time"
)

var shed atomic.Bool

func gcMonitor() {
    sample := []metrics.Sample{{Name: "/cpu/classes/gc/total:cpu-seconds"}}
    var prev float64
    var prevTime time.Time
    for range time.Tick(200 * time.Millisecond) {
        metrics.Read(sample)
        cur := sample[0].Value.Float64()
        now := time.Now()
        if !prevTime.IsZero() {
            dt := now.Sub(prevTime).Seconds()
            if dt > 0 {
                frac := (cur - prev) / dt
                if frac > 0.30 && !shed.Load() {
                    shed.Store(true)
                    log.Println("shedding ON")
                } else if frac < 0.20 && shed.Load() {
                    shed.Store(false)
                    log.Println("shedding OFF")
                }
            }
        }
        prev, prevTime = cur, now
    }
}

func middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if shed.Load() {
            http.Error(w, "overloaded", http.StatusServiceUnavailable)
            return
        }
        next.ServeHTTP(w, r)
    })
}

func main() {
    go gcMonitor()
    h := middleware(http.DefaultServeMux)
    http.ListenAndServe(":8080", h)
}
```

### Solution 10

**Predictions.**

- **A:** highest GC frequency, OK average latency, worst P99 (frequent assist), lowest RSS.
- **B:** lowest GC frequency, best average latency, mixed P99 (rare but larger cycles), highest RSS.
- **C:** moderate GC frequency, best P99 (pooled buffers reduce allocation pressure), middle RSS, bounded by `GOMEMLIMIT`.

**Measurement.** Run `wrk -t8 -c100 -d60s` for each configuration. Expected outcome: C wins on P99, B wins on throughput, A is the loser overall. In real services, this is roughly the experience documented in many production case studies.
