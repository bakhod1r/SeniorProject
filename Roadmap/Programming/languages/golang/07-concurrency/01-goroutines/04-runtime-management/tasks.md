# Runtime Goroutine Management — Tasks

Hands-on exercises for each API group. Solutions are at the end of each section. Run each program; verify the behaviour matches what you expect before peeking.

---

## Easy

### Task 1 — Counting goroutines through a lifecycle

Write a program that:

1. Prints `runtime.NumGoroutine()` before spawning anything.
2. Spawns 50 goroutines, each sleeping 100 ms.
3. Prints `runtime.NumGoroutine()` while they are alive.
4. Waits for them.
5. Prints `runtime.NumGoroutine()` again.

Expected: numbers around 1 → 51 → 1.

### Task 2 — Read `GOMAXPROCS` and `NumCPU`

Write a program that prints `runtime.NumCPU()`, then `runtime.GOMAXPROCS(0)`, sets `GOMAXPROCS` to 2, and prints the new value plus the returned previous value. Run with and without `GOMAXPROCS=4 go run main.go`.

### Task 3 — Print the current goroutine's stack

Write a program with a few nested function calls. From the innermost function, print the current goroutine's stack using `debug.Stack()`.

### Task 4 — `Goexit` with deferred prints

Write a goroutine that:

- Defers a print of "first defer."
- Defers a print of "second defer."
- Calls `runtime.Goexit()`.
- Has a print of "unreachable" after `Goexit`.

Verify the output order: `second defer`, `first defer`. The unreachable line should never print.

### Task 5 — Force GC and observe

Write a program that:

1. Allocates 100 MB worth of byte slices.
2. Records `/memory/classes/heap/objects:bytes` from `runtime/metrics`.
3. Nils the references.
4. Calls `runtime.GC()`.
5. Records the metric again. The drop should be visible.

---

## Medium

### Task 6 — `LockOSThread` lifecycle

Write a goroutine that:

1. Calls `runtime.LockOSThread()`.
2. Prints `runtime.NumGoroutine()`.
3. Sleeps 100 ms.
4. Calls `runtime.UnlockOSThread()`.

Spawn 5 such goroutines concurrently. Observe via `/proc/self/status` (Linux) how many threads the process has during the sleep. Expected: ≥ 5 OS threads.

### Task 7 — Goroutine leak detector

Write a test-helper function:

```go
func assertNoLeak(t *testing.T, fn func()) {
    before := runtime.NumGoroutine()
    fn()
    for i := 0; i < 10; i++ {
        runtime.GC()
        if runtime.NumGoroutine() <= before {
            return
        }
        time.Sleep(50 * time.Millisecond)
    }
    t.Fatalf("leak: before=%d after=%d", before, runtime.NumGoroutine())
}
```

Use it on (a) a function that returns cleanly, and (b) a function that leaks a goroutine blocked on `time.Sleep(time.Hour)`. Verify case (a) passes and case (b) fails.

### Task 8 — Apply profiling labels to an HTTP handler

Write an HTTP server with a single handler `/work`. The handler does ~100 ms of CPU work. Wrap it with `pprof.Do` to tag goroutines with `endpoint=/work` and `kind=cpu`. Capture a 5-second CPU profile while hitting it with `wrk` or `hey`. Confirm via `go tool pprof -tagfocus=endpoint=/work cpu.pprof` that the profile is correctly tagged.

### Task 9 — Print runtime metrics in a loop

Write a program that, every 2 seconds, reads:

- `/sched/goroutines:goroutines`
- `/memory/classes/heap/objects:bytes`
- `/gc/cycles/total:gc-cycles`

and prints them in a single line. Allocate some bytes in a background goroutine so the metrics actually change.

### Task 10 — `SetMaxStack` to crash early on recursion

Write a program that:

1. Calls `debug.SetMaxStack(1 << 20)` (1 MB).
2. Defers a recover with `fmt.Println("recovered:", r)`.
3. Calls a recursive function with no base case.

Expected: crash with "stack overflow" message, recovered.

### Task 11 — Use `SetMemoryLimit` to control allocation

Write a program that allocates 10 MB chunks in a loop with a 100 ms sleep between. Set `debug.SetMemoryLimit(50 << 20)` (50 MB) and `debug.SetGCPercent(-1)` (so the *only* GC trigger is the memory limit). Plot heap size over time using `/memory/classes/heap/objects:bytes`. Expected: heap oscillates around 50 MB, not growing unbounded.

---

## Hard

### Task 12 — Stack dump on signal

Write a server that listens on SIGUSR1. On signal, dumps all goroutine stacks to a file `stacks-<timestamp>.txt` using `runtime.Stack(buf, true)`. Test by sending `kill -USR1 <pid>` while the server has 100 goroutines blocked on a channel.

### Task 13 — Adaptive `GOMEMLIMIT`

Write a controller that:

1. Reads `/sys/fs/cgroup/memory.max` for the container's hard cap.
2. Sets `debug.SetMemoryLimit(cap * 90 / 100)`.
3. Every 30 seconds, reads `/proc/pressure/memory` PSI `some` avg10.
4. If avg10 > 5.0, lowers the memory limit by 10% (floor at 60% of cap).
5. If avg10 < 1.0, raises back toward 90% of cap.
6. Logs every change.

Test by allocating aggressively while a memory-hungry neighbour runs on the same machine.

### Task 14 — Continuous profile dispatcher

Write an in-process profiler that, every 60 seconds:

1. Captures a 5-second CPU profile.
2. Captures a heap profile snapshot.
3. Captures a goroutine profile snapshot.
4. Saves each to disk with a filename including timestamp and profile type.

Run it under load. Confirm the files are valid (`go tool pprof <file>`).

### Task 15 — `runtime/trace` capture endpoint

Add a `/debug/trace?seconds=N` endpoint to your HTTP server. It should call `trace.Start(w)`, sleep `N` seconds (default 5, max 60), then `trace.Stop`. Test by hitting the endpoint while serving requests, then open the result with `go tool trace`. Inspect the goroutine timeline.

### Task 16 — Detect cgo thread storm

Write a program that spawns 500 goroutines, each calling a 100 ms cgo function (use `time.Sleep` with `purego` or actual `import "C"`). Measure the thread count via `/proc/self/status`. Then apply `debug.SetMaxThreads(50)` and verify the program crashes with a clean error.

### Task 17 — Build a `runtime/metrics`-driven dashboard

Use `prometheus/client_golang` with `collectors.NewGoCollector(collectors.WithGoCollections(collectors.GoRuntimeMetricsCollection))`. Serve `/metrics`. Run Prometheus locally and create a Grafana dashboard with:

- Goroutine count over time.
- GC pause p99 histogram.
- Heap size over time.
- Mutex contention rate (after `SetMutexProfileFraction(5)`).
- Scheduler latency p99.

---

## Solutions

### Solution 1

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func main() {
    fmt.Println("before:", runtime.NumGoroutine())
    var wg sync.WaitGroup
    for i := 0; i < 50; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            time.Sleep(100 * time.Millisecond)
        }()
    }
    time.Sleep(10 * time.Millisecond)
    fmt.Println("during:", runtime.NumGoroutine())
    wg.Wait()
    fmt.Println("after:", runtime.NumGoroutine())
}
```

### Solution 2

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    fmt.Println("NumCPU:", runtime.NumCPU())
    fmt.Println("GOMAXPROCS default:", runtime.GOMAXPROCS(0))
    prev := runtime.GOMAXPROCS(2)
    fmt.Println("set to 2; previous:", prev)
    fmt.Println("current:", runtime.GOMAXPROCS(0))
}
```

### Solution 3

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    a()
}

func a() { b() }
func b() { c() }
func c() {
    fmt.Printf("%s", debug.Stack())
}
```

### Solution 4

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer fmt.Println("first defer")
        defer fmt.Println("second defer")
        runtime.Goexit()
        fmt.Println("unreachable")
    }()
    wg.Wait()
}
```

Output:
```
second defer
first defer
```

### Solution 5

```go
package main

import (
    "fmt"
    "runtime"
    "runtime/metrics"
)

func main() {
    s := []metrics.Sample{{Name: "/memory/classes/heap/objects:bytes"}}
    var data [][]byte
    for i := 0; i < 100; i++ {
        data = append(data, make([]byte, 1<<20))
    }
    metrics.Read(s)
    fmt.Println("with data:", s[0].Value.Uint64())
    data = nil
    runtime.GC()
    metrics.Read(s)
    fmt.Println("after GC:", s[0].Value.Uint64())
}
```

### Solution 6

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

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            runtime.LockOSThread()
            defer runtime.UnlockOSThread()
            time.Sleep(100 * time.Millisecond)
        }()
    }
    time.Sleep(20 * time.Millisecond)
    fmt.Println("threads:", threads())
    wg.Wait()
}
```

### Solution 7

```go
package mypkg

import (
    "runtime"
    "testing"
    "time"
)

func assertNoLeak(t *testing.T, fn func()) {
    t.Helper()
    before := runtime.NumGoroutine()
    fn()
    for i := 0; i < 10; i++ {
        runtime.GC()
        if runtime.NumGoroutine() <= before {
            return
        }
        time.Sleep(50 * time.Millisecond)
    }
    t.Fatalf("leak: before=%d after=%d", before, runtime.NumGoroutine())
}

func TestNoLeak_good(t *testing.T) {
    assertNoLeak(t, func() {
        done := make(chan struct{})
        go func() { close(done) }()
        <-done
    })
}

func TestNoLeak_bad(t *testing.T) {
    assertNoLeak(t, func() {
        go time.Sleep(time.Hour)
    })
}
```

`TestNoLeak_bad` should fail. Use `t.Skip` or `go test -run TestNoLeak_good` for the good case.

### Solution 8

```go
package main

import (
    "context"
    "net/http"
    _ "net/http/pprof"
    "runtime/pprof"
)

func main() {
    http.Handle("/work", http.HandlerFunc(handle))
    http.ListenAndServe(":8080", nil)
}

func handle(w http.ResponseWriter, r *http.Request) {
    labels := pprof.Labels("endpoint", "/work", "kind", "cpu")
    pprof.Do(r.Context(), labels, func(ctx context.Context) {
        cpuBurn(ctx)
        w.Write([]byte("done"))
    })
}

func cpuBurn(_ context.Context) {
    x := 0
    for i := 0; i < 200_000_000; i++ {
        x += i
    }
    _ = x
}
```

Capture: `go tool pprof http://localhost:8080/debug/pprof/profile?seconds=5`. Then `tagfocus`.

### Solution 9

```go
package main

import (
    "fmt"
    "runtime/metrics"
    "time"
)

func main() {
    samples := []metrics.Sample{
        {Name: "/sched/goroutines:goroutines"},
        {Name: "/memory/classes/heap/objects:bytes"},
        {Name: "/gc/cycles/total:gc-cycles"},
    }
    go func() {
        var keep [][]byte
        for {
            keep = append(keep, make([]byte, 1<<20))
            if len(keep) > 100 {
                keep = keep[:0]
            }
            time.Sleep(20 * time.Millisecond)
        }
    }()
    for {
        metrics.Read(samples)
        fmt.Printf("g=%d heap=%dKB gc=%d\n",
            samples[0].Value.Uint64(),
            samples[1].Value.Uint64()/1024,
            samples[2].Value.Uint64())
        time.Sleep(2 * time.Second)
    }
}
```

### Solution 10

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    debug.SetMaxStack(1 << 20)
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    grow(0)
}

func grow(n int) {
    var buf [4096]byte
    _ = buf
    grow(n + 1)
}
```

Note: `recover` may not catch the runtime's stack-overflow panic in all versions. If not recovered, the program crashes with a clear stack-overflow message.

### Solution 11

```go
package main

import (
    "fmt"
    "runtime/debug"
    "runtime/metrics"
    "time"
)

func main() {
    debug.SetMemoryLimit(50 << 20)
    debug.SetGCPercent(-1)
    s := []metrics.Sample{{Name: "/memory/classes/heap/objects:bytes"}}
    for i := 0; i < 100; i++ {
        _ = make([]byte, 10<<20)
        metrics.Read(s)
        fmt.Println("iter", i, "heap MB:", s[0].Value.Uint64()/(1<<20))
        time.Sleep(100 * time.Millisecond)
    }
}
```

### Solution 12

```go
package main

import (
    "fmt"
    "os"
    "os/signal"
    "runtime"
    "syscall"
    "time"
)

func main() {
    for i := 0; i < 100; i++ {
        ch := make(chan struct{})
        go func() { <-ch }() // blocked forever
        _ = ch
    }
    sig := make(chan os.Signal, 1)
    signal.Notify(sig, syscall.SIGUSR1)
    for range sig {
        fn := fmt.Sprintf("stacks-%d.txt", time.Now().Unix())
        f, _ := os.Create(fn)
        buf := make([]byte, 1<<20)
        n := runtime.Stack(buf, true)
        f.Write(buf[:n])
        f.Close()
        fmt.Println("wrote", fn)
    }
}
```

### Solution 13

Sketch (omitting full PSI parser):

```go
package main

import (
    "log"
    "runtime/debug"
    "time"
)

func runAdapter(capBytes int64) {
    base := capBytes * 90 / 100
    floor := capBytes * 60 / 100
    cur := base
    debug.SetMemoryLimit(cur)
    for range time.Tick(30 * time.Second) {
        psi := readPSI()
        target := cur
        switch {
        case psi.SomeAvg10 > 5.0 && cur > floor:
            target = cur * 9 / 10
        case psi.SomeAvg10 < 1.0 && cur < base:
            target = cur * 11 / 10
            if target > base { target = base }
        }
        if target != cur {
            log.Printf("SetMemoryLimit %d -> %d (PSI=%.2f)", cur, target, psi.SomeAvg10)
            debug.SetMemoryLimit(target)
            cur = target
        }
    }
}

type psi struct{ SomeAvg10 float64 }

func readPSI() psi {
    // Implement parsing of /proc/pressure/memory
    return psi{}
}
```

### Solution 14

```go
package main

import (
    "fmt"
    "os"
    "runtime/pprof"
    "time"
)

func runProfiler() {
    for range time.Tick(60 * time.Second) {
        ts := time.Now().Unix()
        if f, err := os.Create(fmt.Sprintf("cpu-%d.pprof", ts)); err == nil {
            pprof.StartCPUProfile(f)
            time.Sleep(5 * time.Second)
            pprof.StopCPUProfile()
            f.Close()
        }
        if f, err := os.Create(fmt.Sprintf("heap-%d.pprof", ts)); err == nil {
            pprof.Lookup("heap").WriteTo(f, 0)
            f.Close()
        }
        if f, err := os.Create(fmt.Sprintf("goroutine-%d.pprof", ts)); err == nil {
            pprof.Lookup("goroutine").WriteTo(f, 0)
            f.Close()
        }
    }
}
```

### Solution 15

```go
package main

import (
    "net/http"
    "runtime/trace"
    "strconv"
    "time"
)

func main() {
    http.HandleFunc("/debug/trace", func(w http.ResponseWriter, r *http.Request) {
        sec, _ := strconv.Atoi(r.URL.Query().Get("seconds"))
        if sec <= 0 { sec = 5 }
        if sec > 60 { sec = 60 }
        w.Header().Set("Content-Type", "application/octet-stream")
        if err := trace.Start(w); err != nil {
            http.Error(w, err.Error(), 500)
            return
        }
        time.Sleep(time.Duration(sec) * time.Second)
        trace.Stop()
    })
    http.ListenAndServe(":8080", nil)
}
```

### Solution 16

```go
package main

/*
#include <unistd.h>
void slow(void) { usleep(100000); }
*/
import "C"

import (
    "fmt"
    "os"
    "runtime/debug"
    "strings"
    "sync"
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
    debug.SetMaxThreads(50)
    var wg sync.WaitGroup
    for i := 0; i < 500; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            C.slow()
        }()
    }
    wg.Wait()
    fmt.Println("threads:", threads())
}
```

Expected: program crashes with `runtime: program exceeds N-thread limit`.

### Solution 17

```go
package main

import (
    "net/http"
    "runtime"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/collectors"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
    runtime.SetMutexProfileFraction(5)
    reg := prometheus.NewRegistry()
    reg.MustRegister(collectors.NewGoCollector(
        collectors.WithGoCollections(collectors.GoRuntimeMetricsCollection),
    ))
    http.Handle("/metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))
    http.ListenAndServe(":2112", nil)
}
```

Connect Prometheus, build the Grafana dashboard. Use queries like `go_sched_goroutines`, `go_gc_pauses_seconds`, `go_memory_classes_heap_objects_bytes`.
