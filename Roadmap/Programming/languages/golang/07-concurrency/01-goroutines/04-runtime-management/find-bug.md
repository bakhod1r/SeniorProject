# Runtime Goroutine Management — Find the Bug

Each exercise shows a program that misuses a runtime API. Identify the bug, predict the symptom, and write the fix. Solutions follow.

---

## Easy

### Bug 1 — Manual `GC()` on a hot path

```go
package main

import (
    "log"
    "net/http"
    "runtime"
)

func handle(w http.ResponseWriter, r *http.Request) {
    runtime.GC() // "clean up before responding"
    w.Write([]byte("ok"))
}

func main() {
    http.HandleFunc("/", handle)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

**Symptom?**

**Fix?**

---

### Bug 2 — `GOMAXPROCS` in a library

```go
// library: github.com/example/cool-lib/lib.go
package coollib

import "runtime"

func init() {
    runtime.GOMAXPROCS(4) // "we use 4 cores efficiently"
}
```

**Symptom?**

**Fix?**

---

### Bug 3 — Unmatched `LockOSThread`

```go
package main

import (
    "fmt"
    "runtime"
)

func work() {
    runtime.LockOSThread()
    fmt.Println("doing work on a fixed thread")
    // forgot to unlock
}

func main() {
    for i := 0; i < 10; i++ {
        go work()
    }
    select {}
}
```

**Symptom?**

**Fix?**

---

### Bug 4 — `runtime.Stack` with a fixed too-small buffer

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func main() {
    for i := 0; i < 1000; i++ {
        go func() { time.Sleep(time.Hour) }()
    }
    time.Sleep(10 * time.Millisecond)
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        buf := make([]byte, 4096) // too small
        n := runtime.Stack(buf, true)
        fmt.Printf("got %d bytes\n", n)
        fmt.Printf("%s\n", buf[:n])
    }()
    wg.Wait()
}
```

**Symptom?**

**Fix?**

---

### Bug 5 — Finalizer that resurrects the object

```go
package main

import (
    "fmt"
    "runtime"
)

type Cache struct {
    data []byte
}

var global *Cache

func main() {
    c := &Cache{data: make([]byte, 1<<20)}
    runtime.SetFinalizer(c, func(c *Cache) {
        global = c // resurrect!
        fmt.Println("finalized")
    })
    c = nil
    runtime.GC()
    runtime.GC()
    fmt.Println("global is nil:", global == nil)
}
```

**Symptom?**

**Fix?**

---

## Medium

### Bug 6 — Profiling labels set without `pprof.Do`

```go
package main

import (
    "context"
    "runtime/pprof"
)

func handleRequest(ctx context.Context, tenant string) {
    labels := pprof.Labels("tenant", tenant)
    ctx = pprof.WithLabels(ctx, labels)
    pprof.SetGoroutineLabels(ctx)
    work(ctx)
    // labels are not cleared
}

func work(ctx context.Context) {}

func main() {
    for _, t := range []string{"acme", "widgets", "globex"} {
        handleRequest(context.Background(), t)
    }
}
```

**Symptom?**

**Fix?**

---

### Bug 7 — Goroutine leak from missing `context.Cancel`

```go
package main

import (
    "context"
    "fmt"
    "runtime"
    "time"
)

func worker(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-time.After(time.Second):
            // do work
        }
    }
}

func main() {
    for i := 0; i < 1000; i++ {
        ctx, _ := context.WithCancel(context.Background())
        go worker(ctx)
    }
    time.Sleep(2 * time.Second)
    fmt.Println("goroutines:", runtime.NumGoroutine())
}
```

**Symptom?**

**Fix?**

---

### Bug 8 — `SetMaxThreads` set too low

```go
package main

import (
    "fmt"
    "os"
    "runtime/debug"
    "strings"
    "sync"
    "time"
)

func threads() int {
    b, _ := os.ReadFile("/proc/self/status")
    for _, l := range strings.Split(string(b), "\n") {
        if strings.HasPrefix(l, "Threads:") {
            var n int
            fmt.Sscanf(l, "Threads: %d", &n)
            return n
        }
    }
    return -1
}

func main() {
    debug.SetMaxThreads(5)
    var wg sync.WaitGroup
    for i := 0; i < 20; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            f, _ := os.Open("/etc/hostname")
            buf := make([]byte, 64)
            f.Read(buf)
            f.Close()
            time.Sleep(50 * time.Millisecond)
        }()
    }
    wg.Wait()
    fmt.Println("threads:", threads())
}
```

**Symptom?**

**Fix?**

---

### Bug 9 — `runtime.Gosched` inside a hot allocator loop

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
        sum += i
        runtime.Gosched() // "for fairness"
    }
    fmt.Println(sum, time.Since(start))
}
```

**Symptom?**

**Fix?**

---

### Bug 10 — `GOMEMLIMIT` set tighter than working set

```go
package main

import (
    "fmt"
    "runtime/debug"
    "runtime/metrics"
    "time"
)

func main() {
    debug.SetMemoryLimit(50 << 20) // 50 MB
    var data [][]byte
    for i := 0; i < 200; i++ {
        data = append(data, make([]byte, 1<<20)) // 1 MB each
    }
    s := []metrics.Sample{
        {Name: "/cpu/classes/gc/total:cpu-seconds"},
        {Name: "/memory/classes/heap/objects:bytes"},
    }
    for i := 0; i < 5; i++ {
        time.Sleep(time.Second)
        metrics.Read(s)
        fmt.Printf("gc=%.3fs heap=%dMB\n",
            s[0].Value.Float64(),
            s[1].Value.Uint64()/(1<<20))
    }
    _ = data
}
```

**Symptom?**

**Fix?**

---

## Hard

### Bug 11 — Goroutine exit while locked, breaking a global

```go
package main

import (
    "fmt"
    "os"
    "runtime"
    "strings"
    "sync"
    "time"
)

func threads() int {
    b, _ := os.ReadFile("/proc/self/status")
    for _, l := range strings.Split(string(b), "\n") {
        if strings.HasPrefix(l, "Threads:") {
            var n int
            fmt.Sscanf(l, "Threads: %d", &n)
            return n
        }
    }
    return -1
}

func work(id int) {
    runtime.LockOSThread()
    fmt.Println("worker", id, "starting on thread")
    time.Sleep(50 * time.Millisecond)
    // No UnlockOSThread; exits while locked
}

func main() {
    for round := 0; round < 5; round++ {
        var wg sync.WaitGroup
        for i := 0; i < 10; i++ {
            wg.Add(1)
            go func(id int) {
                defer wg.Done()
                work(id)
            }(i)
        }
        wg.Wait()
        time.Sleep(100 * time.Millisecond)
        fmt.Println("round", round, "threads:", threads())
    }
}
```

**Symptom?**

**Fix?**

---

### Bug 12 — `SetGCPercent(-1)` left enabled

```go
package main

import (
    "fmt"
    "runtime/debug"
    "runtime/metrics"
    "time"
)

func setup() {
    debug.SetGCPercent(-1) // "for setup speed"
    // ... heavy init ...
    // forgot to restore
}

func main() {
    setup()
    var data [][]byte
    for i := 0; i < 200; i++ {
        data = append(data, make([]byte, 1<<20))
        time.Sleep(50 * time.Millisecond)
    }
    s := []metrics.Sample{{Name: "/memory/classes/heap/objects:bytes"}}
    metrics.Read(s)
    fmt.Println("heap:", s[0].Value.Uint64()/(1<<20), "MB")
    _ = data
}
```

**Symptom?**

**Fix?**

---

### Bug 13 — Profile labels not cleared across pooled goroutines

```go
package main

import (
    "context"
    "runtime/pprof"
)

type Pool struct {
    work chan func(context.Context)
}

func NewPool(n int) *Pool {
    p := &Pool{work: make(chan func(context.Context), 100)}
    for i := 0; i < n; i++ {
        go p.run()
    }
    return p
}

func (p *Pool) run() {
    for fn := range p.work {
        fn(context.Background())
    }
}

func (p *Pool) Submit(tenant string, fn func(context.Context)) {
    p.work <- func(ctx context.Context) {
        labels := pprof.Labels("tenant", tenant)
        ctx = pprof.WithLabels(ctx, labels)
        pprof.SetGoroutineLabels(ctx)
        fn(ctx)
    }
}
```

**Symptom?**

**Fix?**

---

### Bug 14 — Finalizer running too late

```go
package main

import (
    "fmt"
    "os"
    "runtime"
)

type File struct {
    f *os.File
}

func Open(name string) *File {
    f, _ := os.Open(name)
    fw := &File{f: f}
    runtime.SetFinalizer(fw, func(fw *File) {
        fw.f.Close()
    })
    return fw
}

func main() {
    for i := 0; i < 100_000; i++ {
        _ = Open("/etc/hostname")
    }
    fmt.Println("opened many; never closed explicitly")
}
```

**Symptom?**

**Fix?**

---

### Bug 15 — `runtime/trace` left enabled in production

```go
package main

import (
    "log"
    "net/http"
    "runtime/trace"
    "strconv"
)

func main() {
    http.HandleFunc("/debug/trace", func(w http.ResponseWriter, r *http.Request) {
        sec, _ := strconv.Atoi(r.URL.Query().Get("seconds"))
        if sec <= 0 { sec = 5 }
        trace.Start(w)
        // forgot to stop or to set a timer
    })
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

**Symptom?**

**Fix?**

---

## Solutions

### Fix 1 — Manual `GC()`

**Symptom.** Every request adds a 5–50 ms pause for full GC. p99 latency is dominated by GC, throughput drops 5–10x. The "cleanup" provides no benefit; the runtime would have GC'd more efficiently at its own cadence.

**Fix.** Remove the `runtime.GC()` line entirely.

```go
func handle(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("ok"))
}
```

If memory pressure is a real concern, set `GOMEMLIMIT` once at startup. Do not force GC per request.

---

### Fix 2 — `GOMAXPROCS` in a library

**Symptom.** Any application using `coollib` has its `GOMAXPROCS` silently overridden to 4. On a 32-core production box, this caps throughput at 4 cores. On a 1-core container, this oversubscribes and adds scheduler contention.

**Fix.** Libraries must not set process-global tunables. Remove the `init`. If the library has performance recommendations, document them; let the application set `GOMAXPROCS`.

---

### Fix 3 — Unmatched `LockOSThread`

**Symptom.** Each goroutine ties up an OS thread for life. When the goroutine exits, the thread is destroyed (intentional). Repeated work loops cause thread churn: thread create + thread destroy on every iteration. Performance degrades; on Linux, thread creation is ~10–50 µs.

**Fix.**

```go
func work() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    fmt.Println("doing work on a fixed thread")
}
```

Or, if pinning is not actually required: remove `LockOSThread` entirely.

---

### Fix 4 — Truncated stack dump

**Symptom.** `runtime.Stack(buf, true)` writes as much as fits into `buf` and returns the (truncated) byte count. With 1000 goroutines and a 4 KB buffer, the dump is unreadable.

**Fix.**

```go
buf := make([]byte, 1<<20) // 1 MB; grow as needed
for {
    n := runtime.Stack(buf, true)
    if n < len(buf) {
        fmt.Printf("%s\n", buf[:n])
        return
    }
    buf = make([]byte, 2*len(buf))
}
```

---

### Fix 5 — Resurrecting finalizer

**Symptom.** The finalizer assigns `c` to a global variable. The object is reachable again after finalization. It is not freed in this cycle. A subsequent GC will mark it (still reachable via `global`), and it will never be freed unless `global` is cleared. The print also lies — "finalized" runs once, but the object lives on.

**Fix.** Never reference the finalized object from outside the finalizer. Better: do not use finalizers for resource management at all.

```go
// Don't resurrect.
runtime.SetFinalizer(c, func(c *Cache) {
    fmt.Println("finalized")
    // do not assign c anywhere
})
```

For cache scenarios, use explicit `Close`/`Release` and `sync.Pool`.

---

### Fix 6 — `SetGoroutineLabels` without scope

**Symptom.** After `handleRequest("acme")` returns, the calling goroutine still has `tenant=acme` set. The next iteration overwrites with `tenant=widgets`. Profile output from the main goroutine appears mislabeled depending on call order. Other goroutines spawned later from this goroutine inherit stale labels.

**Fix.** Use `pprof.Do`, which restores labels on return.

```go
func handleRequest(ctx context.Context, tenant string) {
    labels := pprof.Labels("tenant", tenant)
    pprof.Do(ctx, labels, func(ctx context.Context) {
        work(ctx)
    })
}
```

---

### Fix 7 — Unleashed `CancelFunc`

**Symptom.** `context.WithCancel` returns a `CancelFunc` that *must* be called or the context never cancels. The example assigns it to `_` (discards it). All 1000 workers run forever. `NumGoroutine()` reports ~1001.

**Fix.**

```go
for i := 0; i < 1000; i++ {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel() // or schedule cancellation explicitly
    go worker(ctx)
}
```

Or scope the context to the worker's lifetime: have `worker` accept a `done <-chan struct{}` and cancel via that.

Tip: `go vet` flags the `_ = cancel` pattern with the `lostcancel` analyzer.

---

### Fix 8 — `SetMaxThreads(5)`

**Symptom.** The program likely *exits* with `runtime: program exceeds 5-thread limit`. Even simple file I/O spawns Ms for blocking syscalls; 5 threads is far below what a 20-goroutine workload needs.

**Fix.** Raise the limit, or remove the call. A reasonable safety net is 2000 or higher.

```go
debug.SetMaxThreads(2000)
```

---

### Fix 9 — `Gosched` overhead

**Symptom.** The loop runs 5–10x slower than without `Gosched`. Each `Gosched` is a scheduler entry (~300 ns). Multiplied by 100 M iterations, that is 30 seconds of pure overhead. In modern Go, async preemption ensures fairness without manual yielding.

**Fix.** Remove `runtime.Gosched()`.

```go
for i := 0; i < 100_000_000; i++ {
    sum += i
}
```

---

### Fix 10 — `GOMEMLIMIT` too tight

**Symptom.** With 200 MB of live data and a 50 MB limit, the runtime tries to GC continuously but cannot reduce live memory below the working set. CPU time spent in GC climbs to ~25–50%. Heap stays around 200 MB (limit is soft). Throughput collapses.

**Fix.** Raise the limit above the working set.

```go
debug.SetMemoryLimit(300 << 20) // give headroom
```

Rule: set `GOMEMLIMIT` to ~90% of the *container memory cap*, not to a number smaller than your live data.

---

### Fix 11 — Locked-exit thread churn

**Symptom.** Each round creates 10 threads (one per locked goroutine), then destroys them when the goroutines exit. Thread count fluctuates wildly; `threads()` may show low or peaks depending on timing. Each round adds 10 × ~50 µs of thread creation/destruction overhead.

**Fix.** Either unlock before exit:

```go
func work(id int) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    ...
}
```

or, if you intentionally want long-lived locked threads, create them once and reuse via a channel-fed worker pool.

---

### Fix 12 — Disabled GC

**Symptom.** Heap grows unbounded — 200 MB at the end of the loop, with no GC. In a real service this would eventually OOM-kill the process.

**Fix.** Restore GC after the special-case setup.

```go
func setup() {
    prev := debug.SetGCPercent(-1)
    defer debug.SetGCPercent(prev)
    // ... heavy init ...
}
```

Even better: do not disable GC. The runtime usually handles startup allocation fine. If profiling shows GC dominates startup, increase `GOGC` instead of disabling.

---

### Fix 13 — Stale labels in pool workers

**Symptom.** A pool worker processes job A (labels `tenant=acme`), then job B (`tenant=widgets`). Between jobs, the worker goroutine retains the labels from the previous job. CPU samples taken during job B may be labeled `tenant=acme` if the work runs briefly before the new `SetGoroutineLabels` call.

**Fix.** Use `pprof.Do` for proper scoping:

```go
func (p *Pool) Submit(tenant string, fn func(context.Context)) {
    p.work <- func(ctx context.Context) {
        labels := pprof.Labels("tenant", tenant)
        pprof.Do(ctx, labels, fn)
    }
}
```

This sets labels at entry and restores them at exit. The worker goroutine returns to unlabeled state between jobs.

---

### Fix 14 — File descriptors leaked

**Symptom.** Finalizers run on the GC's schedule. With 100 000 files opened and only `*File` GC'd, the file descriptors stay open until each finalizer runs. The process may hit the per-process FD limit (1024 by default) long before the finalizer goroutine catches up. The runtime serializes finalizer execution, so the queue grows.

**Fix.** Use explicit `Close()` with `defer`, not finalizers, for resource cleanup.

```go
func main() {
    for i := 0; i < 100_000; i++ {
        f, _ := os.Open("/etc/hostname")
        f.Close() // explicit
    }
}
```

`os.File` keeps a finalizer as a *last-resort* safety net for cases where the user forgets `Close`. Never rely on it as the primary mechanism.

---

### Fix 15 — Trace never stopped

**Symptom.** The first request to `/debug/trace` starts a trace and never stops it. The trace runs forever, consuming 5–20% CPU and unbounded disk/network as it streams event data to the writer. Subsequent requests fail (trace already in progress). The response never returns.

**Fix.** Always stop the trace after the requested duration.

```go
http.HandleFunc("/debug/trace", func(w http.ResponseWriter, r *http.Request) {
    sec, _ := strconv.Atoi(r.URL.Query().Get("seconds"))
    if sec <= 0 || sec > 60 { sec = 5 }
    if err := trace.Start(w); err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    time.Sleep(time.Duration(sec) * time.Second)
    trace.Stop()
})
```

Also: behind authentication, with a maximum duration cap, and a rate limit. Otherwise an attacker can DoS your server by hammering `/debug/trace?seconds=60`.
