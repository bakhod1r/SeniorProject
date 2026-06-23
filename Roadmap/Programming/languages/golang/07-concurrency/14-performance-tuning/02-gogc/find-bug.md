# GOGC and GOMEMLIMIT — Find the Bug

Each section is a snippet of code or configuration with at least one bug related to GC tuning. The bug is described after the snippet, with the fix and reasoning.

---

## Bug 1 — `GOMEMLIMIT` matches the cgroup limit

### Configuration

```yaml
# Kubernetes pod manifest
resources:
  limits:
    memory: "512Mi"
env:
  - name: GOMEMLIMIT
    value: "512MiB"
```

### Bug

`GOMEMLIMIT=512MiB` matches the container limit exactly. The Go runtime targets 512 MiB for what it considers in-use memory (`Sys`-like measure), but the kernel measures the full process — including non-Go memory: goroutine stacks not tracked the same way, glibc/musl overhead, file mappings, cgo allocations. The kernel OOM-kills the container before Go even reaches its soft limit.

### Fix

```yaml
env:
  - name: GOMEMLIMIT
    value: "460MiB"   # ~90% of 512Mi
```

Leave a 10–20% margin. For cgo-heavy services, leave 20–30%.

---

## Bug 2 — `runtime.GC()` after every request

```go
package main

import (
    "net/http"
    "runtime"
)

func handler(w http.ResponseWriter, r *http.Request) {
    defer runtime.GC() // "be tidy"
    process(r)
    w.Write([]byte("ok"))
}

func process(r *http.Request) { /* ... */ }

func main() {
    http.HandleFunc("/", handler)
    http.ListenAndServe(":8080", nil)
}
```

### Bug

`runtime.GC()` runs a full synchronous garbage collection cycle. With it in `defer`, every request triggers a global GC, including stop-the-world phases. Throughput collapses; tail latency explodes.

### Fix

Remove the `runtime.GC()` call. The runtime's concurrent collector schedules itself appropriately based on `GOGC`/`GOMEMLIMIT`. If memory smoothing is needed, set `GOMEMLIMIT`.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    process(r)
    w.Write([]byte("ok"))
}
```

---

## Bug 3 — `GOGC=off` in a long-running server

```go
package main

import (
    "net/http"
    "runtime/debug"
)

func main() {
    debug.SetGCPercent(-1) // "faster, no GC overhead"
    http.HandleFunc("/api", apiHandler)
    http.ListenAndServe(":8080", nil)
}

func apiHandler(w http.ResponseWriter, r *http.Request) { /* allocates */ }
```

### Bug

GC is disabled. Memory grows without bound until the OS kills the process. The author measured a tiny CPU win in benchmarks and missed that the server allocates per-request.

### Fix

```go
func main() {
    // Default GOGC=100 is fine, with a memory limit to prevent runaway.
    debug.SetMemoryLimit(900 << 20) // 900 MiB cap
    http.HandleFunc("/api", apiHandler)
    http.ListenAndServe(":8080", nil)
}
```

---

## Bug 4 — Ballast and `GOMEMLIMIT` together

```go
package main

import (
    "runtime/debug"
)

var ballast = make([]byte, 1<<30) // 1 GiB

func init() {
    debug.SetMemoryLimit(2 << 30) // 2 GiB
}

func main() { /* ... */ }
```

### Bug

Mixing a pre-1.19 ballast with a 1.19+ `GOMEMLIMIT` wastes 1 GiB. The ballast's purpose was to inflate "live" for the old pacer; the new pacer with `GOMEMLIMIT` makes the ballast obsolete. Now the program reports 1 GiB of fake live data and the `GOMEMLIMIT` budget effectively shrinks.

### Fix

Remove the ballast:

```go
package main

import "runtime/debug"

func init() {
    debug.SetMemoryLimit(2 << 30)
}

func main() { /* ... */ }
```

---

## Bug 5 — `debug.SetMemoryLimit` called after large allocations

```go
package main

import (
    "runtime/debug"
)

var cache map[string][]byte

func init() {
    cache = loadCache() // 800 MiB
    debug.SetMemoryLimit(500 << 20) // 500 MiB
}

func loadCache() map[string][]byte { /* ... */ return nil }

func main() { /* ... */ }
```

### Bug

The cache (800 MiB) is loaded first, then a 500 MiB limit is applied. The runtime is already 300 MiB over the limit. The pacer enters death spiral, GC fires constantly, the program either OOMs or hits the 50% CPU cap and crawls.

### Fix

Set the limit before allocating, ideally via env var:

```sh
GOMEMLIMIT=900MiB ./app
```

Or set programmatically before the large load:

```go
func init() {
    debug.SetMemoryLimit(900 << 20) // 900 MiB
    cache = loadCache()             // 800 MiB
}
```

---

## Bug 6 — Pool of pointers used after `Put`

```go
package main

import (
    "fmt"
    "sync"
)

var pool = sync.Pool{
    New: func() any { return new([1024]byte) },
}

func main() {
    a := pool.Get().(*[1024]byte)
    a[0] = 42
    pool.Put(a)
    fmt.Println(a[0]) // BUG: still using a after Put
}
```

### Bug

After `Put`, the pool may hand `a` to any other caller. Any read after `Put` is a data race in concurrent programs and undefined behaviour in general. The bug is subtle here (single-threaded) but a real hazard.

### Fix

Do not use the pooled object after `Put`. Pattern:

```go
func use() {
    a := pool.Get().(*[1024]byte)
    defer pool.Put(a)
    a[0] = 42
    // Use a here, never after pool.Put.
    fmt.Println(a[0])
}
```

---

## Bug 7 — Pool polluted with wrong-size buffers

```go
package main

import "sync"

var pool = sync.Pool{
    New: func() any {
        b := make([]byte, 4096)
        return &b
    },
}

func process(data []byte) {
    bufPtr := pool.Get().(*[]byte)
    buf := *bufPtr
    // Caller used buf, then shrank it.
    buf = buf[:0]
    pool.Put(&buf) // BUG: storing a slice of length 0 back
}
```

### Bug

The slice header is shared. After `Put`, the next `Get` returns a slice of length 0 (not 4096). The next caller may unexpectedly find a buffer that "looks" empty but has the right capacity, or accidentally write past their intended range.

### Fix

Restore length before `Put`, or pool the raw pointer / capacity-validated slice:

```go
func process(data []byte) {
    bufPtr := pool.Get().(*[]byte)
    buf := (*bufPtr)[:cap(*bufPtr)] // always start at full capacity
    defer func() {
        *bufPtr = (*bufPtr)[:cap(*bufPtr)]
        pool.Put(bufPtr)
    }()
    _ = buf
}
```

---

## Bug 8 — Reading `MemStats` in a hot loop

```go
package main

import (
    "runtime"
)

func reportMemory() uint64 {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    return m.HeapAlloc
}

func handleRequest() {
    _ = reportMemory() // called per request
    // ... process ...
}
```

### Bug

`runtime.ReadMemStats` triggers a brief stop-the-world. Calling it per request adds STW pauses proportional to request rate.

### Fix

Sample once per second in a background goroutine and serve the cached value:

```go
package main

import (
    "runtime"
    "sync/atomic"
    "time"
)

var lastHeap atomic.Uint64

func init() {
    go func() {
        var m runtime.MemStats
        for range time.Tick(time.Second) {
            runtime.ReadMemStats(&m)
            lastHeap.Store(m.HeapAlloc)
        }
    }()
}

func reportMemory() uint64 {
    return lastHeap.Load()
}
```

---

## Bug 9 — Confusing `Sys` and `HeapAlloc`

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    // "Memory usage" — to send to monitoring
    fmt.Printf("memory=%d bytes\n", m.HeapAlloc)
}
```

### Bug

`HeapAlloc` reports bytes in live heap objects only. It excludes stacks, runtime overhead, freed-but-unreleased pages. The metric will be much lower than RSS, leading to misleading alerts and dashboards.

### Fix

Report `Sys` or pair both metrics:

```go
fmt.Printf("heap_alloc=%d sys=%d released=%d\n",
    m.HeapAlloc, m.Sys, m.HeapReleased)
```

For Prometheus, expose all three.

---

## Bug 10 — Goroutine leak hidden by GC

```go
package main

import (
    "fmt"
    "net/http"
    "runtime"
    "time"
)

func handler(w http.ResponseWriter, r *http.Request) {
    ch := make(chan struct{})
    go func() {
        time.Sleep(10 * time.Second)
        ch <- struct{}{} // BUG: nobody else may read this
    }()
    w.Write([]byte("ok"))
    // Handler returns, but goroutine is parked forever on ch <- ...
}

func main() {
    http.HandleFunc("/", handler)
    go func() {
        for range time.Tick(5 * time.Second) {
            fmt.Println("goroutines:", runtime.NumGoroutine())
        }
    }()
    http.ListenAndServe(":8080", nil)
}
```

### Bug

The handler creates a goroutine that blocks on an unbuffered send. The handler returns, dropping the only reference to `ch`. The goroutine is leaked: it lives forever, its stack is scanned every GC cycle, and `NumGoroutine` grows without bound.

GC tuning does not help — these goroutines are reachable from the runtime's scheduler. The fix is to ensure goroutines exit.

### Fix

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ch := make(chan struct{}, 1) // buffered, send won't block
    go func() {
        time.Sleep(10 * time.Second)
        ch <- struct{}{}
    }()
    w.Write([]byte("ok"))
}
```

Or use a `context.Context` with deadline and select.

---

## Bug 11 — `GOMEMLIMIT` set in init under load

```go
package main

import (
    "os"
    "runtime/debug"
    "strconv"
)

func main() {
    if s := os.Getenv("GOMEMLIMIT_MIB"); s != "" {
        if n, err := strconv.Atoi(s); err == nil {
            debug.SetMemoryLimit(int64(n) << 20)
        }
    }
    server()
}

func server() { /* ... */ }
```

### Bug

`os.Getenv` happens after the runtime has already initialised. Any allocations from `init` functions in imported packages happen before the limit is applied. For a small program this is fine, but for an app with heavy package init it can already be near the limit at startup.

### Fix

Set the limit via the environment variable `GOMEMLIMIT` directly. The runtime reads it before user code starts.

```sh
GOMEMLIMIT=512MiB ./app
```

If you must read a custom env var, do it in a build-time wrapper or use the official `GOMEMLIMIT` from the start.

---

## Bug 12 — Atomic toggle of `GOGC` from many goroutines

```go
package main

import (
    "runtime/debug"
    "time"
)

func tuner() {
    high := false
    for range time.Tick(time.Second) {
        if high {
            debug.SetGCPercent(100)
        } else {
            debug.SetGCPercent(300)
        }
        high = !high
    }
}
```

### Bug

`debug.SetGCPercent` is thread-safe, but rapidly toggling `GOGC` destabilises the pacer's learned state. Cycle-to-cycle behaviour becomes erratic; allocations during the transition see inconsistent assist rates.

### Fix

Change `GOGC` rarely, if at all. Prefer `GOMEMLIMIT` for steady operational tuning. If autotuning is needed, change values minutes apart, not seconds.

---

## Bug 13 — Long-lived map never shrinks

```go
package main

import "sync"

var (
    mu   sync.Mutex
    data = make(map[string]struct{}, 1_000_000)
)

func add(k string)    { mu.Lock(); data[k] = struct{}{}; mu.Unlock() }
func remove(k string) { mu.Lock(); delete(data, k); mu.Unlock() }
```

### Bug

`map`s in Go do not shrink when keys are deleted. A workload that adds and removes a million keys regularly keeps the map's bucket array sized for the high-water mark forever. The GC scans those buckets each cycle.

### Fix

Periodically rebuild the map:

```go
func compact() {
    mu.Lock()
    defer mu.Unlock()
    if len(data) < 1000 && cap(data) > 100_000 { // pseudo, no map cap
        newMap := make(map[string]struct{}, len(data))
        for k := range data {
            newMap[k] = struct{}{}
        }
        data = newMap
    }
}
```

(Go's `map` has no `cap`; this is heuristic. Triggers can be time-based or size-ratio-based.)

---

## Bug 14 — Forgotten `pprof` profiler at default rate

```go
package main

import (
    "net/http"
    _ "net/http/pprof"
)

func main() {
    go http.ListenAndServe("localhost:6060", nil)
    realServer()
}

func realServer() { /* ... */ }
```

### Bug

`net/http/pprof` registers handlers but does not turn on per-request memory profiling. However, if the deployment also sets `runtime.MemProfileRate = 1` (which some tooling does), every allocation is sampled. The sampling itself becomes a bottleneck. This isn't strictly a `GOGC` bug, but it's commonly mistaken for one.

### Fix

Verify `runtime.MemProfileRate` is at the default (`512 * 1024` — one sample per ~512 KB). Adjust only in dedicated profiling sessions.

---

## Bug 15 — `runtime.GC()` to "free memory" before reporting

```go
package main

import (
    "fmt"
    "runtime"
)

func reportRSS() {
    runtime.GC()
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("RSS-ish: %d MiB\n", m.Sys>>20)
}
```

### Bug

The author calls `runtime.GC()` to "stabilise" the measurement, but `runtime.GC` plus `ReadMemStats` together is a heavy pair to call on a hot endpoint. Worse, `Sys` does not drop after GC; only `HeapAlloc` does. So the call is paying STW cost for no information.

### Fix

Drop the `GC()` call; report `HeapAlloc`, `Sys`, and `HeapReleased` separately:

```go
func reportRSS() {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("heap_alloc=%d sys=%d released=%d\n",
        m.HeapAlloc, m.Sys, m.HeapReleased)
}
```

If you need RSS, read `/proc/self/status` on Linux for the kernel's view.
