# runtime Package Deep — Junior

## 1. What is the `runtime` package?

There are two things in Go that both go by the name "runtime", and people mix them up constantly:

1. **The runtime** (lowercase, conceptual) — the scheduler, garbage collector, memory allocator, and goroutine machinery baked into every Go binary. This is what subtopics 01–04 of this section covered. You can't `import` it. You don't call it directly. It just *runs*.
2. **The `runtime` package** (the importable one) — a thin, official Go API that exposes a slice of those internals to your code. You write `import "runtime"` and call functions like `runtime.NumGoroutine()` or `runtime.GC()`.

This subtopic is about #2 — the *user-facing* `runtime` package. It is the only sanctioned door into the runtime. Everything else (the `g`, `m`, `p` structs, `mallocgc`, `schedule`) is unexported and not part of the Go 1.x compatibility promise.

> Think of it as the dashboard of a car. The engine (the actual runtime) does the work. The dashboard (the `runtime` package) shows you a handful of gauges and gives you a few buttons — speedometer, fuel level, hazard lights. You don't drive *with* the dashboard, but you'd be flying blind without it.

---

## 2. `runtime` vs `runtime.` — naming clarified

When this document or any Go documentation says:

- **"the runtime"** — the conceptual subsystem (scheduler + GC + allocator + ...).
- **`runtime` package** or **`runtime.X`** — the importable Go package at `$GOROOT/src/runtime` whose *exported* identifiers (uppercase) you can use.

The same directory holds both: `$GOROOT/src/runtime/*.go`. Lowercase identifiers in those files (`schedule`, `gopark`, `mallocgc`) are internal. Uppercase ones (`NumGoroutine`, `GC`, `ReadMemStats`) are the public API.

So `runtime.GC()` (uppercase G, exported) lives in `runtime/mgc.go` and is a thin wrapper around the unexported `gcStart`. Reading the unexported half is a separate skill (subtopic 01). Calling the exported half is what most programmers will ever do, and that's the focus here.

---

## 3. Prerequisites

- You can write a small Go program with goroutines and channels.
- You've at least heard of garbage collection.
- You're comfortable opening `pkg.go.dev/runtime` and skimming the function list.

You do **not** need to have read runtime source. This level is about *using* the package, not understanding its guts.

---

## 4. Glossary

| Term | Meaning |
|------|---------|
| **`runtime` package** | The importable Go package whose exported API exposes runtime internals to user code |
| **`runtime/debug`** | Subpackage for debugging: stack traces, GC tuning, build info |
| **`runtime/pprof`** | Subpackage for CPU/heap/goroutine profiling |
| **`runtime/trace`** | Subpackage for execution traces (scheduler events, GC, syscalls) |
| **`runtime/metrics`** | Subpackage (Go 1.16+) — the modern, stable, structured way to read runtime stats |
| **`runtime/race`** | Subpackage that ships with the race detector (`-race` flag) |
| **`MemStats`** | A struct populated by `runtime.ReadMemStats` containing heap, GC, and allocator counters |
| **`GOMAXPROCS`** | The number of OS threads simultaneously executing Go code |
| **`Gosched`** | Voluntarily yield the CPU to let other goroutines run |
| **`Caller` / `Stack`** | Functions to inspect the current call stack for debugging or logging |

---

## 5. The subpackages — a quick map

The exported `runtime` package has a small surface (~50 functions). But it's the root of a family of subpackages, each focused on a particular task:

| Path | Purpose | Typical use |
|------|---------|-------------|
| `runtime` | Core API: goroutines, GC, env info | `NumGoroutine`, `GC`, `GOMAXPROCS` |
| `runtime/debug` | Stack dumps, GC tuning, build info | `debug.Stack()`, `debug.SetGCPercent`, `debug.ReadBuildInfo` |
| `runtime/pprof` | Profilers (CPU, heap, block, mutex) | `pprof.StartCPUProfile`, `pprof.WriteHeapProfile` |
| `runtime/trace` | Execution traces for `go tool trace` | `trace.Start`, `trace.Stop` |
| `runtime/metrics` | Stable, named, structured runtime metrics | `metrics.Read`, `metrics.All` |
| `runtime/race` | Linked in automatically with `go test -race` | (not directly imported) |

`runtime/metrics` is the modern replacement for many `MemStats` use cases. New code reading runtime stats over time should prefer it. We'll see both styles below.

---

## 6. Functions you'll actually use early on

These are the half-dozen calls a junior Go programmer encounters first. Memorize them — they show up in tutorials, blog posts, and every "diagnose a weird Go problem" guide.

```go
import "runtime"

// How many goroutines exist right now (across the whole program).
n := runtime.NumGoroutine()

// How many logical CPUs the OS reports.
ncpu := runtime.NumCPU()

// How many CPUs Go is *allowed* to use simultaneously.
// Passing 0 means "tell me without changing".
gmp := runtime.GOMAXPROCS(0)

// Yield to the scheduler — lets other goroutines run.
// Almost never needed in well-written code; useful in tight CPU loops.
runtime.Gosched()

// Force a full garbage collection cycle. Blocks until done.
// Useful in tests/benchmarks; rarely a good idea in production code.
runtime.GC()

// Snapshot of memory stats into a caller-provided struct.
var ms runtime.MemStats
runtime.ReadMemStats(&ms)
```

Each of these is a one-line API hiding a substantial chunk of internal work. `NumGoroutine` reads the global `sched.gcount`. `GC` calls `gcStart(gcTrigger{kind: gcTriggerCycle})`. `Gosched` calls `mcall(gosched_m)` to swap to the g0 stack and re-enter the scheduler.

---

## 7. Environment introspection

The `runtime` package also exposes constants and one function describing the build environment. These are evaluated at compile time (the constants) or read from a runtime variable (the function):

```go
fmt.Println("Go version:  ", runtime.Version()) // e.g. "go1.22.3"
fmt.Println("OS:          ", runtime.GOOS)      // "linux", "darwin", "windows"
fmt.Println("Arch:        ", runtime.GOARCH)    // "amd64", "arm64"
fmt.Println("Compiler:    ", runtime.Compiler)  // "gc" or "gccgo"
```

`runtime.GOOS` and `runtime.GOARCH` are typed `string` constants. They're useful for log lines ("starting on linux/amd64") and for the occasional platform check inside test helpers. They are **not** the right way to do cross-platform code — build tags (`//go:build linux`) and `_linux.go` file suffixes are.

---

## 8. Debugging helpers: `Caller` and `Stack`

Two functions every Go programmer eventually meets:

```go
// runtime.Caller(skip int) returns info about the caller `skip` frames up.
// skip=0 is the call to Caller itself; skip=1 is the function that called you.
pc, file, line, ok := runtime.Caller(1)
if ok {
    fmt.Printf("called from %s:%d\n", file, line)
    _ = pc // program counter, useful with runtime.FuncForPC
}

// runtime.Stack(buf, all) writes a stack trace into buf.
// If all=true, dumps every goroutine — extremely useful when diagnosing a hang.
buf := make([]byte, 1<<16)
n := runtime.Stack(buf, true)
fmt.Println(string(buf[:n]))
```

`Caller` is how logging libraries figure out which file/line invoked `log.Info(...)`. `Stack` with `all=true` is the same dump you get when a Go program crashes with an unrecovered panic — useful for a "dump everything before we exit" hook.

For cleaner stack traces in a structured format, prefer `runtime.Callers` + `runtime.CallersFrames` (returns a `Frames` iterator over `pc` values). `runtime/debug.Stack()` is a one-liner that produces the trace of *just the current goroutine* without you sizing a buffer.

---

## 9. A small intro program

A working example that touches six runtime calls. Save as `runtime_demo.go`, then `go run runtime_demo.go`.

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    fmt.Printf("Go %s on %s/%s, %d CPUs, GOMAXPROCS=%d\n",
        runtime.Version(),
        runtime.GOOS,
        runtime.GOARCH,
        runtime.NumCPU(),
        runtime.GOMAXPROCS(0),
    )

    fmt.Println("Goroutines at start:", runtime.NumGoroutine())

    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            // Tight loop that yields voluntarily; without Gosched this
            // could starve other goroutines on a single-P configuration.
            for j := 0; j < 1000; j++ {
                if j%100 == 0 {
                    runtime.Gosched()
                }
            }
        }(i)
    }

    fmt.Println("Goroutines mid-flight:", runtime.NumGoroutine())
    wg.Wait()

    runtime.GC() // make MemStats reflect a clean state

    var ms runtime.MemStats
    runtime.ReadMemStats(&ms)
    fmt.Printf("HeapAlloc=%d bytes, NumGC=%d, PauseTotalNs=%d\n",
        ms.HeapAlloc, ms.NumGC, ms.PauseTotalNs)

    fmt.Println("Goroutines at end:", runtime.NumGoroutine())
}
```

This program uses `Version`, `GOOS`, `GOARCH`, `NumCPU`, `GOMAXPROCS`, `NumGoroutine`, `Gosched`, `GC`, and `ReadMemStats`. Almost the entire junior-level surface in 30 lines.

---

## 10. A quick tour of `MemStats`

`runtime.MemStats` has ~25 fields. You don't need all of them. The ones that matter early:

| Field | Meaning |
|-------|---------|
| `Alloc` / `HeapAlloc` | Bytes of heap memory currently in live (non-freed) objects |
| `TotalAlloc` | Cumulative bytes allocated over the program's lifetime (never decreases) |
| `Sys` | Total bytes obtained from the OS (heap + stacks + runtime overhead) |
| `HeapObjects` | Number of live heap objects |
| `NumGC` | How many GC cycles have run |
| `PauseTotalNs` | Cumulative nanoseconds the program was stopped for GC |
| `PauseNs[(NumGC+255)%256]` | Most recent GC pause |
| `NextGC` | Heap size that will trigger the next GC |
| `GCCPUFraction` | Fraction of total CPU time spent in GC (0.0–1.0) |

```go
var ms runtime.MemStats
runtime.ReadMemStats(&ms)

fmt.Printf("heap live:   %d KB\n", ms.HeapAlloc/1024)
fmt.Printf("total ever:  %d KB\n", ms.TotalAlloc/1024)
fmt.Printf("GC cycles:   %d\n",   ms.NumGC)
fmt.Printf("last pause:  %v ns\n", ms.PauseNs[(ms.NumGC+255)%256])
```

`ReadMemStats` is **not free** — it stops the world briefly. Don't call it in a hot path. Once a second from a metrics goroutine is fine; once per request is not.

For long-lived monitoring, the modern alternative is `runtime/metrics`:

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/memory/classes/heap/objects:bytes"},
    {Name: "/sched/goroutines:goroutines"},
}
metrics.Read(samples)
fmt.Println(samples[0].Value.Uint64(), samples[1].Value.Uint64())
```

`runtime/metrics` has a stable, documented naming scheme and doesn't carry the legacy baggage of `MemStats`.

---

## 11. Common confusions

- **"Should I sprinkle `runtime.GC()` in my code?"** Almost always no. The GC runs on its own schedule, tuned by `GOGC` and the pacer. Forcing collections wastes CPU and rarely helps. Exceptions: deterministic benchmarks, tests asserting "no leak after teardown", and `debug.FreeOSMemory()` right before a long sleep on a memory-tight system.
- **"Does `runtime.GC()` free memory back to the OS?"** No. It runs a mark-and-sweep cycle, marking freed objects as reusable by the Go heap. Returning pages to the OS is a separate concern — handled lazily by the scavenger, or forcibly by `debug.FreeOSMemory()`.
- **"Does `runtime.Gosched()` sleep?"** No. It puts the current goroutine back on the run queue and re-enters the scheduler. If nothing else is runnable, the same goroutine resumes immediately. It is not `time.Sleep(0)`.
- **"Is `runtime.NumGoroutine()` exact?"** It's a live count from `sched.gcount`, atomically updated. It includes the goroutine asking. It does *not* tell you which goroutines exist — for that, use `runtime.Stack(buf, true)`.
- **"`runtime.GOMAXPROCS(8)` makes my program faster"?** Maybe. It caps the number of OS threads running Go code concurrently. Default since Go 1.5 is `NumCPU()`. Setting it higher than `NumCPU()` rarely helps; setting it lower can help under heavy oversubscription. Don't tune it without measuring.
- **"Why use `runtime` in production at all?"** Reasonable cases: exposing `/debug/pprof` endpoints, periodic `runtime/metrics` sampling for Prometheus, a `SIGQUIT` handler that dumps `runtime.Stack(buf, true)` for postmortem. Outside of diagnostics, you mostly shouldn't reach for it.

---

## 12. Summary

The `runtime` package is the official, importable interface to the Go runtime — the dashboard on top of the engine. Its core gives you environment info (`Version`, `GOOS`, `GOARCH`, `NumCPU`), goroutine and scheduler controls (`NumGoroutine`, `GOMAXPROCS`, `Gosched`), garbage collector controls (`GC`, `ReadMemStats`), and debugging helpers (`Caller`, `Stack`). Its subpackages — `debug`, `pprof`, `trace`, `metrics`, `race` — handle stack traces, profiling, execution traces, structured metrics, and the race detector.

At this level the goal is to *know the menu*: which function answers which question. You don't need to call `runtime.GC()` in real code; you do need to recognize it in someone else's. You should be able to write a 30-line program that prints Go version, goroutine count, heap size, and GC cycles — and to read `pkg.go.dev/runtime` without feeling lost.

---

## Further reading

- `runtime` package docs: `https://pkg.go.dev/runtime`
- `runtime/debug` docs: `https://pkg.go.dev/runtime/debug`
- `runtime/metrics` docs: `https://pkg.go.dev/runtime/metrics` — the modern stats API
- `runtime/pprof` docs: `https://pkg.go.dev/runtime/pprof`
- "Diagnostics" — official Go blog/doc: `https://go.dev/doc/diagnostics` — tour of the runtime-adjacent tooling
- "Go's memory statistics" — Dave Cheney — readable walk-through of `MemStats` fields
- Source: `$GOROOT/src/runtime/debug.go`, `$GOROOT/src/runtime/mstats.go`, `$GOROOT/src/runtime/proc.go`
