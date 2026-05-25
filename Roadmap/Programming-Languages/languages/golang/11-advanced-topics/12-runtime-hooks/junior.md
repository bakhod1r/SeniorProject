# Runtime Hooks — Junior

## 1. What is a "runtime hook"?

When your Go program runs, there is a small amount of code shipped inside the binary called the **Go runtime**. It manages the things you never write yourself: goroutines, the garbage collector, the stack, channels, maps, panics. A **runtime hook** is a function in the standard library that lets you peek at or nudge that runtime from inside your own program.

The most common reasons to use them:

- Read a diagnostic value (how many goroutines? how much heap?).
- Tell the scheduler something (yield, lock to a thread).
- Tune the GC for a specific workload.
- Capture a profile or trace from production.

You do not need most of these on day one. But three or four are useful immediately, and that is what this page covers.

---

## 2. The packages you will meet

| Package | What it does | When to use |
|---------|--------------|-------------|
| `runtime` | Scheduler & introspection | Counting goroutines, getting stack info |
| `runtime/debug` | Tuning & build info | Reading the build version, printing stacks |
| `runtime/metrics` | Modern metric stream | Exposing runtime numbers to monitoring |
| `runtime/pprof` | Profile capture | CPU and heap profiling |

The other two — `runtime/trace` and the `GODEBUG` knobs — show up in the middle/senior pages. Don't worry about them yet.

---

## 3. How many goroutines am I running?

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    for i := 0; i < 5; i++ {
        go func(id int) {
            time.Sleep(time.Second)
            fmt.Println("worker", id)
        }(i)
    }
    fmt.Println("goroutines:", runtime.NumGoroutine())
    time.Sleep(2 * time.Second)
}
```

`runtime.NumGoroutine` returns the count of currently existing goroutines, including the main goroutine and any started by the runtime itself. It is cheap to call.

Why care? If this number grows forever in a long-running service, you have a goroutine leak — almost always more important than memory leaks.

---

## 4. How many CPUs is the runtime using?

```go
fmt.Println("NumCPU:", runtime.NumCPU())          // logical CPUs visible
fmt.Println("GOMAXPROCS:", runtime.GOMAXPROCS(0)) // current setting
```

`runtime.GOMAXPROCS(n)` sets the maximum number of OS threads that can run Go code concurrently. Passing `0` reports the current value without changing it. You almost never need to set it explicitly — the runtime initializes it to `NumCPU()` automatically. The exceptions:

- Old Go versions (pre 1.25) running inside containers with a CPU quota — they used to ignore the quota; use the `automaxprocs` library or set `GOMAXPROCS` from the cgroup limit.
- Benchmarks where you want deterministic concurrency (`GOMAXPROCS=1`).

---

## 5. How much memory is the program using?

The classic call is `runtime.ReadMemStats`:

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)

    fmt.Printf("HeapAlloc:    %d KB\n", m.HeapAlloc/1024)
    fmt.Printf("HeapInuse:    %d KB\n", m.HeapInuse/1024)
    fmt.Printf("HeapReleased: %d KB\n", m.HeapReleased/1024)
    fmt.Printf("NumGC:        %d\n",    m.NumGC)
}
```

What the numbers mean:

| Field | Meaning |
|-------|---------|
| `HeapAlloc` | Bytes of live heap objects |
| `HeapInuse` | Bytes in spans currently used |
| `HeapReleased` | Bytes already returned to the OS |
| `NumGC` | How many GC cycles have finished |

A caveat: `ReadMemStats` briefly **stops the world** to collect a consistent snapshot. In a tight monitoring loop that is wasteful; prefer the `runtime/metrics` package (next section) for anything you scrape periodically. For one-off debugging from a single goroutine, `ReadMemStats` is fine.

---

## 6. The modern way: `runtime/metrics`

```go
package main

import (
    "fmt"
    "runtime/metrics"
)

func main() {
    samples := []metrics.Sample{
        {Name: "/sched/goroutines:goroutines"},
        {Name: "/memory/classes/heap/objects:bytes"},
        {Name: "/gc/cycles/automatic:gc-cycles"},
    }
    metrics.Read(samples)

    for _, s := range samples {
        fmt.Printf("%-50s %d\n", s.Name, s.Value.Uint64())
    }
}
```

Two reasons to prefer this:

1. **No stop-the-world.** The metrics are read lock-free.
2. **Stable, versioned names.** New runtime releases add metrics; old names keep working.

The full list comes from `metrics.All()`. About 50 metrics are available today.

---

## 7. Where am I in the code? `runtime.Caller`

For logging and error reporting it is useful to know "which file/line called me":

```go
package main

import (
    "fmt"
    "runtime"
)

func logHere(msg string) {
    _, file, line, ok := runtime.Caller(1)
    if ok {
        fmt.Printf("%s:%d: %s\n", file, line, msg)
    } else {
        fmt.Println(msg)
    }
}

func main() {
    logHere("hello")
}
```

`runtime.Caller(0)` returns information about the call to `Caller` itself. `Caller(1)` is the caller of the current function, `Caller(2)` the caller's caller, and so on. Most logging libraries use this internally so you don't have to.

For a whole stack, use `debug.PrintStack()` or `runtime.Stack(buf, false)`.

---

## 8. Dumping the current stack

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func b() {
    debug.PrintStack() // writes the current goroutine's stack to stderr
}

func a() { b() }
func main() { a(); fmt.Println("done") }
```

If you want the stack as a string (e.g., to attach to a log line), use:

```go
buf := make([]byte, 4096)
n := runtime.Stack(buf, false) // false = current goroutine only
fmt.Println(string(buf[:n]))
```

Passing `true` dumps **every** goroutine. That is incredibly useful during panic post-mortems, but it briefly stops the world.

---

## 9. Reading the build info

When a user reports a bug, you want to know what version of your service they hit:

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    info, ok := debug.ReadBuildInfo()
    if !ok {
        fmt.Println("no build info (built without modules?)")
        return
    }
    fmt.Println("module:", info.Main.Path, info.Main.Version)
    for _, s := range info.Settings {
        if s.Key == "vcs.revision" || s.Key == "vcs.time" {
            fmt.Println(s.Key, "=", s.Value)
        }
    }
}
```

When you build with `go build` from a git checkout, the toolchain stamps the commit hash and timestamp automatically (Go 1.18+). Expose this on a `/version` endpoint.

---

## 10. Yielding to the scheduler — `runtime.Gosched`

`runtime.Gosched()` says "I'd like to let other goroutines run for a moment". You rarely need it: the scheduler preempts goroutines automatically. The two real cases are tight CPU loops (where preemption can be delayed) and tests where you want to nudge a scheduling decision.

```go
for {
    if done() {
        return
    }
    runtime.Gosched() // be polite, give the scheduler a chance
}
```

If you find yourself reaching for `Gosched` to "fix" a hang, it is almost certainly the wrong tool — use channels or `sync` primitives.

---

## 11. What you should not touch yet

There are runtime hooks that are powerful and easy to misuse. Save these for later pages:

- `runtime.GC()` — forces a GC. Useful in tests, harmful in services.
- `runtime.SetFinalizer` — register a function to run after an object becomes unreachable. Has subtle gotchas; prefer `defer Close()`.
- `runtime.LockOSThread` — pins a goroutine to one OS thread. Needed only for GUI code and a few C libraries.
- `runtime/debug.FreeOSMemory` — last-resort memory returner; abuse degrades performance.
- `runtime/debug.SetGCPercent` / `SetMemoryLimit` — GC tuning; needs measurement.

The pattern: every hook in this list has a default that works for the vast majority of programs.

---

## 12. A first useful pattern

A small "introspect" endpoint you can attach to any HTTP server:

```go
import (
    "encoding/json"
    "net/http"
    "runtime"
)

func introspect(w http.ResponseWriter, r *http.Request) {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    json.NewEncoder(w).Encode(map[string]any{
        "goroutines": runtime.NumGoroutine(),
        "heapAlloc":  m.HeapAlloc,
        "numGC":      m.NumGC,
    })
}
```

Hooked at `/debug/introspect` (behind localhost or admin auth), this answers the three questions you will most often ask of a running service.

---

## 13. Summary

The runtime exposes a small surface for introspection and tuning. As a junior you should be comfortable with: counting goroutines (`runtime.NumGoroutine`), reading memory (`ReadMemStats` or, better, `runtime/metrics`), yielding (`Gosched`), reading a stack (`debug.PrintStack`), reading build info (`debug.ReadBuildInfo`). Avoid the tuning knobs (`SetGCPercent`, `SetMemoryLimit`, `FreeOSMemory`) until you can measure their effect.

---

## Further reading
- `runtime` package: https://pkg.go.dev/runtime
- Diagnostics guide: https://go.dev/doc/diagnostics
- `runtime/metrics` quick tour: https://pkg.go.dev/runtime/metrics#hdr-Supported_metrics
