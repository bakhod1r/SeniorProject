# Runtime Goroutine Management — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "Which `runtime.*` function does what, and which ones should I actually call?"

The Go runtime is a complete operating system in miniature, hidden behind the standard library. Most of it you never see — the scheduler, the garbage collector, the stack manager, and the netpoller all do their work without being asked. But the runtime also exposes a small public API. These are the functions you can call from your code: `runtime.NumGoroutine`, `runtime.GOMAXPROCS`, `runtime.Gosched`, `runtime.Goexit`, `runtime.Stack`, `runtime.LockOSThread`, and roughly a dozen siblings in `runtime/debug`, `runtime/pprof`, `runtime/trace`, and `runtime/metrics`.

At junior level the goal is to know which APIs exist, what each one does in plain English, and which ones you should ever reach for. The honest summary is that most of these APIs are diagnostic — you read them more often than you write them. A program that survives without ever calling `runtime.Gosched`, `runtime.LockOSThread`, `runtime.GC`, or `runtime.SetFinalizer` is the normal case, not an exception. Knowing they exist matters; knowing when to leave them alone matters more.

After this file you will:

- Recognise every public runtime knob by name and one-line purpose.
- Read goroutine counts and dump live stacks for debugging.
- Read or set `GOMAXPROCS` correctly (and know why you usually do not need to).
- Understand why `runtime.Gosched`, `runtime.LockOSThread`, and `runtime.SetFinalizer` are advanced tools that are easy to misuse.
- Use `runtime/debug.Stack()` and `runtime/debug.PrintStack()` in error handlers.
- Have a feel for `runtime/debug.SetGCPercent` and `SetMemoryLimit` as GC tuners.
- Know that `runtime/metrics` is the modern, structured way to read runtime data.

You do not need to know GMP internals, work-stealing, or async preemption yet. That is the [02-vs-os-threads](../02-vs-os-threads/) and senior/professional material. Here we focus on the API surface and the everyday usage.

---

## Prerequisites

- **Required:** Comfortable writing goroutines (`go f()`) and waiting on them with `sync.WaitGroup`. See [01-overview](../01-overview/).
- **Required:** Go 1.21 or newer. Several APIs in this section (`SetMemoryLimit`, `runtime/metrics`) require Go 1.19+; examples are written for 1.21+ defaults.
- **Required:** Familiarity with how to run a program with environment variables: `GOMAXPROCS=2 go run main.go`.
- **Helpful:** Some idea of what garbage collection is at the level of "the runtime reclaims unreachable memory periodically." Internals are not required.
- **Helpful:** Awareness that Go programs have multiple OS threads even when you do not ask for them.

If you have built a small program that spawns goroutines and you can run it from the terminal, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`runtime` package** | The standard-library package exposing the public runtime API: scheduler hints, goroutine counts, stack traces, finalizers, OS-thread pinning. |
| **`runtime/debug`** | A sibling package for *debug-oriented* runtime controls: max stack, max threads, GC tuning, stack dumps, build info. |
| **`runtime/pprof`** | Profiling API: CPU, heap, mutex, block, goroutine profiles. Includes `SetGoroutineLabels` for tagging goroutines. |
| **`runtime/trace`** | Full event-stream tracing: every goroutine state transition, GC event, syscall, and network poll. Heavy but invaluable. |
| **`runtime/metrics`** | Go 1.16+ structured metrics API — replaces the older ad-hoc `runtime.ReadMemStats` reads with a single typed system. |
| **`NumGoroutine`** | Returns the count of live goroutines including system ones (GC workers, finalizer goroutine, sysmon when present). |
| **`GOMAXPROCS`** | The number of P (processor) contexts — the maximum number of OS threads simultaneously executing Go code. |
| **`NumCPU`** | The number of logical CPUs available to the current process at startup. Not always equal to `GOMAXPROCS`. |
| **`Gosched`** | Voluntarily yields the current goroutine back to the scheduler. Almost never needed in modern Go (async preemption since 1.14). |
| **`Goexit`** | Terminates the calling goroutine after running its deferred functions. Does not affect other goroutines. |
| **`LockOSThread` / `UnlockOSThread`** | Pin or unpin the calling goroutine to its current OS thread. Used for thread-local state (OpenGL, signals, some C libraries). |
| **`Stack`** | Fills a buffer with a stack trace of the current goroutine, or of *all* goroutines if `all=true`. |
| **`SetFinalizer`** | Attaches a finalizer function to a heap object; the finalizer runs in a dedicated goroutine after the object becomes unreachable. |
| **Finalizer goroutine** | A single runtime-managed goroutine that runs all finalizer callbacks. Serializes finalization. |
| **`SetMaxStack`** | The hard upper bound for any single goroutine's stack size, in bytes. Default ~1 GB on 64-bit. |
| **`SetMaxThreads`** | The hard upper bound on the number of OS threads the runtime may create. Default 10 000. Hitting it crashes the program. |
| **`SetGCPercent`** | Sets the GC trigger: the new live heap is allowed to grow this percentage above the previous live heap before GC starts. |
| **`SetMemoryLimit`** | Go 1.19+. Soft memory cap; the runtime runs GC more aggressively as live + reserved memory approaches the limit. |
| **`SetTraceback`** | Controls the verbosity of panic stack dumps: `none`, `single`, `all`, `system`, `crash`. |
| **`pprof.SetGoroutineLabels`** | Attaches key/value labels to the calling goroutine for profiling and tracing. Inherited by child goroutines spawned afterwards. |

---

## Core Concepts

### The runtime is a library; you can talk to it

The Go runtime is not the operating system. It is a library compiled into every Go binary, exposing public functions in the `runtime` package and its subpackages. When you write `runtime.NumGoroutine()`, you are calling into that library exactly like you would call any other Go function. The runtime then walks its internal data structures and gives you back a number.

This matters because:

1. Calls into the runtime have a cost. Many take a global lock. `runtime.NumGoroutine` is cheap; `runtime.Stack(buf, true)` stops the world.
2. The runtime can be tuned without recompilation, via environment variables (`GOGC`, `GOMAXPROCS`, `GOMEMLIMIT`, `GODEBUG`) and via the API.
3. The runtime evolves between Go versions. The defaults for `GOGC` (100), the existence of `GOMEMLIMIT` (added in 1.19), the meaning of `GOMAXPROCS` in containers (auto-respected from 1.25 onward via `GOMAXPROCS=container`) — all of these change.

### APIs grouped by purpose

The dozen-plus APIs split cleanly into five buckets. Memorise this taxonomy before memorising the function names.

| Bucket | Purpose | Main APIs |
|---|---|---|
| Counting & inspection | "How many goroutines? Show me their stacks." | `NumGoroutine`, `Stack`, `debug.Stack`, `debug.PrintStack` |
| Scheduling | "Tune or hint the scheduler." | `GOMAXPROCS`, `NumCPU`, `Gosched`, `Goexit`, `LockOSThread`, `UnlockOSThread` |
| Memory / GC tuning | "Change when GC runs." | `debug.SetGCPercent`, `debug.SetMemoryLimit`, `GC`, `debug.FreeOSMemory` |
| Resource limits | "Stop runaway growth." | `debug.SetMaxStack`, `debug.SetMaxThreads`, `debug.SetPanicOnFault` |
| Profiling & tracing | "See what the runtime is doing." | `pprof.SetGoroutineLabels`, `trace.Start`/`Stop`, `runtime/metrics` |

Plus two singletons:

- `SetFinalizer` — a destructor-like mechanism, almost always discouraged.
- `SetCgoTraceback` — only relevant if you are doing cgo and want crash dumps to include C frames.

### Most APIs are diagnostic, not control

A common beginner instinct after discovering this surface is "let me sprinkle `runtime.Gosched()` for fairness" or "let me call `runtime.GC()` to clean up." This is almost always wrong. The runtime is self-tuning. Manual intervention usually makes things worse and adds maintenance burden.

The exceptions worth knowing:

- `GOMAXPROCS` in containers (covered in middle/senior) — the runtime cannot always read cgroup limits, so you may need to set it explicitly.
- `debug.SetMemoryLimit` (Go 1.19+) — strongly recommended for any service running in a container with a memory cap. It prevents OOM kills.
- `pprof.SetGoroutineLabels` — labels are non-invasive and turn profile output from "10 000 anonymous goroutines" into "10 000 goroutines tagged by tenant, endpoint, request id."

The rest you read, not write.

### `NumGoroutine` is the cheapest health check

```go
log.Printf("live goroutines: %d", runtime.NumGoroutine())
```

This single line, printed every few seconds, will catch most goroutine leaks during development. A healthy steady-state server has a count that oscillates around a stable number (the worker pool size + a handful of system goroutines). A leak shows as a monotonically increasing count.

### Stack dumps come in two flavours

- `runtime.Stack(buf, false)` — current goroutine's stack, suitable for an error log.
- `runtime.Stack(buf, true)` — *every* goroutine's stack. Stops the world. Used in panic handlers and the `SIGQUIT` (kill -3) dump.

The `runtime/debug` package wraps these as `debug.Stack()` (returns a `[]byte` of the current goroutine) and `debug.PrintStack()` (writes to stderr).

### `GOMAXPROCS` is "how many CPU cores Go is allowed to use"

```go
runtime.GOMAXPROCS(0)        // returns current value, does not change it
runtime.GOMAXPROCS(4)        // sets to 4, returns previous value
runtime.GOMAXPROCS(-1)       // since Go 1.5 same as 0 (read-only)
runtime.NumCPU()             // the number of cores the OS says we have
```

By default, `GOMAXPROCS` equals `NumCPU` at startup. In containers with a CPU quota, this can be wrong (the runtime sees host cores, not your allotted slice). Fixing this is a middle-level topic.

### `Gosched` is almost never useful

`runtime.Gosched()` says: "I am willing to give up the CPU now; put me back on the runqueue." In pre-1.14 Go, you needed this in tight CPU loops to avoid starving other goroutines. Since Go 1.14, the scheduler preempts goroutines asynchronously every ~10 ms, so manual yielding is rarely necessary.

The handful of cases where `Gosched` still matters:

- Benchmarks that want to ensure peers have run before measuring.
- Code that *knows* it is about to do something expensive and wants to be polite first (extremely rare in application code).

### `Goexit` runs defers, then exits the goroutine

```go
defer fmt.Println("cleanup")
runtime.Goexit() // prints "cleanup", then the goroutine ends
```

It is rare in application code. The runtime itself uses it to terminate goroutines from `testing.T.FailNow()`. If you find yourself reaching for `Goexit`, you almost certainly want a normal `return` instead.

### `LockOSThread` pins a goroutine to its OS thread

```go
runtime.LockOSThread()
defer runtime.UnlockOSThread()
// from here on, this goroutine runs on the same OS thread until UnlockOSThread.
```

Used when:

- You call a C library that uses thread-local storage (OpenGL, some OpenSSL paths).
- You need a specific OS signal mask on this thread.
- You are implementing a single-threaded protocol (a UI event loop).

Side effect: when the goroutine exits while locked, the OS thread is destroyed. This is a deliberate safety net so leftover thread-local state cannot leak.

Full coverage is in [02-vs-os-threads](../02-vs-os-threads/). Here, just know the function exists and is rare.

### Finalizers exist; you almost never want them

```go
runtime.SetFinalizer(obj, func(o *Type) {
    // run when obj becomes unreachable
})
```

Finalizers run in a single dedicated goroutine, after a GC cycle has proved the object unreachable. They are unordered, may run late or never, and inhibit GC efficiency. Use `defer` and explicit `Close()` for resource cleanup instead. The Go standard library uses finalizers in a few places (`os.File`, `*net.conn`) as a last-resort safety net, not as a primary mechanism.

### `runtime/debug` controls the "hard" knobs

- `debug.SetMaxStack(bytes)` — kill any goroutine whose stack exceeds this size. Default 1 GB. Lower it to crash earlier on infinite recursion.
- `debug.SetMaxThreads(n)` — kill the program if more than `n` OS threads are needed. Default 10 000. Prevents thread-bomb DoS via cgo or unbounded blocking syscalls.
- `debug.SetGCPercent(p)` — GC triggers when live heap grows by `p` % since the last GC. Default 100 (i.e. heap doubles before GC). Set to -1 to disable GC.
- `debug.SetMemoryLimit(bytes)` — Go 1.19+. Soft memory limit. The runtime adapts GC frequency to stay under it. Use this in containers.
- `debug.SetTraceback(level)` — controls how much detail panic dumps show.

### `runtime/metrics` is the future, `runtime.ReadMemStats` is the past

`ReadMemStats` returns a fixed struct of memory counters. It is still supported, but the modern way is:

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/sched/goroutines:goroutines"},
    {Name: "/memory/classes/heap/objects:bytes"},
}
metrics.Read(samples)
```

Structured, typed, versioned, and includes goroutine-scheduler metrics (`/sched/latencies:seconds`) that `MemStats` does not. Adopt it.

### Profiling labels turn anonymous goroutines into stories

```go
import (
    "context"
    "runtime/pprof"
)

labels := pprof.Labels("tenant", "acme", "request", "abc123")
pprof.Do(ctx, labels, func(ctx context.Context) {
    handleRequest(ctx)
})
```

Inside `pprof.Do`, the goroutine and any goroutines it spawns inherit the labels. Profiles taken during this period show those labels, so you can answer "which tenant burned the CPU" rather than "some HTTP handler did."

---

## Real-World Analogies

### The runtime is the dashboard of a car

Most of the time you watch — speed, fuel, temperature. Occasionally you turn a knob — cruise control, climate. You rarely open the hood. `NumGoroutine`, `MemStats`, `metrics.Read` are the dashboard. `SetGOMAXPROCS`, `SetMemoryLimit`, `SetGCPercent` are the climate knobs. `runtime.GC`, `LockOSThread`, `SetFinalizer` are tools you only reach for after you know exactly which part of the engine you are touching.

### `GOMAXPROCS` is the kitchen's burner count

You have a kitchen with N burners (`GOMAXPROCS`). You have many dishes (goroutines). Burners are limited; chefs (Ms) shuffle dishes onto burners. Setting `GOMAXPROCS=1` means the whole kitchen has one burner — everything cooks, just one dish at a time. Setting it to your true core count means full parallelism.

### Finalizers are post-mortem notes

When an object dies, the finalizer is a note its lawyer reads. You do not know when the lawyer will get around to it. You cannot rely on its order with other lawyers' notes. You should not put critical instructions in it ("close this file") — by then the funeral is already over.

### Profiling labels are stickers on lab samples

A profile is a freezer full of unlabelled vials of CPU time. Labels are stickers — "patient A, day 3, batch 17." Now you can look at the freezer and find the vials you care about. Without labels, you have to taste each vial.

### `runtime/metrics` is the SCADA system

In a factory, instead of running around with a clipboard reading gauges (`ReadMemStats`), you have a SCADA system: every gauge in the plant streamed to a single console, in known units, with known histograms. That is `runtime/metrics`.

---

## Mental Models

### Model 1: "The runtime is opinionated, and usually right"

Go's defaults are tuned by people who watch hundreds of services. `GOGC=100` is reasonable. `GOMAXPROCS=NumCPU()` is reasonable. The default 1 GB max stack is reasonable. Most production tuning is *correcting* an environment the runtime cannot see (container CPU/memory limits) rather than overriding good defaults.

### Model 2: "API by question"

Match the question to the API:

- "How many goroutines?" → `runtime.NumGoroutine`
- "Show me all stacks." → `runtime.Stack(buf, true)` or `SIGQUIT`
- "How many cores?" → `runtime.NumCPU`
- "How parallel am I?" → `runtime.GOMAXPROCS(0)`
- "Stop my goroutine now and run defers." → `runtime.Goexit`
- "Tie me to one OS thread." → `runtime.LockOSThread`
- "How big is GC pressure?" → `runtime/metrics`
- "Tag goroutines for profiling." → `pprof.SetGoroutineLabels`
- "Hard cap on memory." → `debug.SetMemoryLimit`

### Model 3: "The hot APIs are read-only"

The APIs you should use often (`NumGoroutine`, `NumCPU`, `Stack`, `metrics.Read`, `debug.Stack`) are read-only. The APIs you should use sparingly (`GC`, `Goexit`, `Gosched`, `LockOSThread`, `SetFinalizer`) mutate runtime state. Read-only is safe; mutating is for specific, justified moments.

### Model 4: "GC tuning is two knobs, not seven"

For production tuning, only `SetGCPercent` and `SetMemoryLimit` matter. `GC()` exists but is a code smell outside benchmarks. `FreeOSMemory` exists but is rarely useful (the runtime returns memory to the OS automatically in modern Go).

### Model 5: "Labels travel through `pprof.Do`, nowhere else"

The single most useful profiling change you can make in a server is to wrap each request in `pprof.Do(ctx, labels, handler)`. Manual `SetGoroutineLabels` is fine but easy to forget on context boundaries. `pprof.Do` does it for you with automatic propagation to child goroutines.

---

## Pros & Cons

### Pros of using the runtime API

- **Visibility.** With three lines of code you can know how many goroutines you have, how much memory is live, and how often the GC runs.
- **Tuning without recompiling.** `GOMAXPROCS`, `GOGC`, `GOMEMLIMIT` are environment variables; the API mirrors them.
- **Production safety nets.** `SetMaxThreads` and `SetMaxStack` turn slow OOM into fast crash, which is easier to debug.
- **Structured metrics.** `runtime/metrics` exposes dozens of counters that previously required `MemStats` plus scheduler-internal tricks.
- **Profile-friendly.** `pprof.SetGoroutineLabels` lets you slice profiles by anything you choose.

### Cons / Footguns

- **Many APIs are inviting traps.** `runtime.Gosched` looks useful but is almost never the answer. `runtime.GC` is fine in tests, terrible in production code.
- **Mutating settings late in the program is dangerous.** Setting `GOMAXPROCS` after startup is supported but disrupts running goroutines. Set it once, early.
- **Finalizers can pin memory forever.** A finalizer keeps a reference to its object until the finalizer runs; circular finalizers leak.
- **Stack dumps stop the world.** `Stack(buf, true)` pauses all goroutines until the dump completes. Useful in panic, painful on a hot path.
- **`LockOSThread` semantics are subtle.** Lock counts, defer interactions, thread destruction on exit — easy to get wrong.

---

## Use Cases

| Scenario | Which API | Why |
|---|---|---|
| Detect goroutine leak in dev | `runtime.NumGoroutine` | Log the count periodically; rising = leak. |
| Show all stacks on a stuck server | `SIGQUIT` (kill -3) or `runtime.Stack(buf, true)` | Snapshot every goroutine. |
| Tune parallelism in a container | `runtime.GOMAXPROCS(n)` | The runtime sees host cores; container has fewer. |
| Cap memory in Kubernetes | `debug.SetMemoryLimit(bytes)` | Avoid OOM kills; let GC throttle. |
| Slice CPU profile by tenant | `pprof.Do(ctx, labels, fn)` | Labels appear in pprof output. |
| Get GC pause histogram | `runtime/metrics` reading `/gc/pauses:seconds` | Structured, accurate. |
| Pin a goroutine to a thread for OpenGL | `runtime.LockOSThread` | OpenGL requires a fixed thread context. |
| Force a stack dump in a custom panic handler | `debug.Stack()` | Get the current goroutine's trace as bytes. |
| Cap stack growth to catch runaway recursion | `debug.SetMaxStack(1<<20)` | Crash early at 1 MB instead of 1 GB. |
| Defend against fork-bomb via cgo | `debug.SetMaxThreads(200)` | Crashes the process rather than the host. |

---

## Code Examples

### Example 1: Counting live goroutines

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    fmt.Println("before:", runtime.NumGoroutine())
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            // some work
        }()
    }
    fmt.Println("peak:", runtime.NumGoroutine())
    wg.Wait()
    fmt.Println("after:", runtime.NumGoroutine())
}
```

`NumGoroutine` is cheap (one atomic read) and safe to call from anywhere.

### Example 2: Reading and setting `GOMAXPROCS`

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    fmt.Println("CPUs:", runtime.NumCPU())
    fmt.Println("GOMAXPROCS default:", runtime.GOMAXPROCS(0))

    prev := runtime.GOMAXPROCS(2)
    fmt.Println("set to 2; previous was:", prev)
    fmt.Println("now:", runtime.GOMAXPROCS(0))
}
```

`GOMAXPROCS(0)` reads without changing. `GOMAXPROCS(n)` sets to `n` and returns the previous value.

### Example 3: Dumping the current goroutine's stack

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    deep()
}

func deep() {
    deeper()
}

func deeper() {
    buf := make([]byte, 4096)
    n := runtime.Stack(buf, false)
    fmt.Printf("%s", buf[:n])
}
```

Output shows the stack of the current goroutine. With `runtime.Stack(buf, true)` you would get every goroutine's stack.

### Example 4: Stack via `runtime/debug`

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    fmt.Printf("%s", debug.Stack())   // returns []byte
    debug.PrintStack()                 // writes to stderr
}
```

Same idea, easier to use for the common case.

### Example 5: A panic handler that logs the stack

```go
package main

import (
    "log"
    "runtime/debug"
)

func safe(fn func()) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("panic: %v\n%s", r, debug.Stack())
        }
    }()
    fn()
}

func main() {
    safe(func() { panic("boom") })
    log.Println("survived")
}
```

This is the workhorse pattern for any worker goroutine in production.

### Example 6: `Goexit` runs defers

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
        defer fmt.Println("deferred")
        runtime.Goexit()
        fmt.Println("unreachable")
    }()
    wg.Wait()
    fmt.Println("main done")
}
```

Output:
```
deferred
main done
```

The `unreachable` line never prints. `Goexit` returns from every frame.

### Example 7: Locking to an OS thread

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    fmt.Println("this goroutine is now pinned to one OS thread")
}
```

After `LockOSThread`, the goroutine cannot migrate. Other goroutines may still run on that thread when the locked goroutine yields, but the *locked* goroutine itself will only ever run on this thread.

### Example 8: Setting a soft memory limit

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    prev := debug.SetMemoryLimit(512 << 20) // 512 MB
    fmt.Println("previous limit:", prev)
}
```

Once set, the GC will run more frequently as the live heap approaches 512 MB, hopefully preventing an OOM kill from the kernel.

### Example 9: Tuning GC percent

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    prev := debug.SetGCPercent(50) // GC when heap grows 50% since last GC
    fmt.Println("previous GOGC:", prev)
}
```

Lower `GOGC` = more frequent GC = less peak memory, more CPU spent. Higher = the opposite.

### Example 10: Reading runtime metrics

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
        {Name: "/cpu/classes/gc/total:cpu-seconds"},
    }
    metrics.Read(samples)
    for _, s := range samples {
        fmt.Printf("%s = %v\n", s.Name, s.Value)
    }
}
```

Each `Sample.Value` is a tagged union; check `Value.Kind()` before extracting.

### Example 11: Profiling labels

```go
package main

import (
    "context"
    "runtime/pprof"
)

func handle(ctx context.Context, tenant string) {
    labels := pprof.Labels("tenant", tenant)
    pprof.Do(ctx, labels, func(ctx context.Context) {
        work(ctx)
    })
}

func work(ctx context.Context) {
    // CPU profile sampled here will be tagged with tenant=...
}
```

Use `pprof.Do` instead of `SetGoroutineLabels` directly; it scopes the labels correctly.

### Example 12: A complete diagnostic dump on SIGUSR1

```go
package main

import (
    "fmt"
    "os"
    "os/signal"
    "runtime"
    "syscall"
)

func main() {
    sig := make(chan os.Signal, 1)
    signal.Notify(sig, syscall.SIGUSR1)
    go func() {
        for range sig {
            buf := make([]byte, 1<<20)
            n := runtime.Stack(buf, true)
            fmt.Fprintf(os.Stderr, "--- ALL STACKS ---\n%s", buf[:n])
        }
    }()
    select {} // keep running
}
```

Send `kill -USR1 <pid>` and the server prints every goroutine's stack to stderr without crashing.

### Example 13: A finalizer (for awareness, not imitation)

```go
package main

import (
    "fmt"
    "runtime"
)

type Resource struct {
    id int
}

func main() {
    r := &Resource{id: 42}
    runtime.SetFinalizer(r, func(r *Resource) {
        fmt.Println("finalizing", r.id)
    })
    r = nil
    runtime.GC() // force a cycle so the finalizer runs
    // The finalizer runs in a dedicated goroutine; we may exit before it does.
    runtime.GC()
}
```

Even with explicit `runtime.GC()`, finalizers may run after `main` exits — meaning you may not see the print. Do not rely on finalizers for correctness.

### Example 14: `Gosched` in a tight CPU loop

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    runtime.GOMAXPROCS(1)
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        for i := 0; i < 5; i++ {
            fmt.Println("A", i)
            runtime.Gosched()
        }
    }()
    go func() {
        defer wg.Done()
        for i := 0; i < 5; i++ {
            fmt.Println("B", i)
            runtime.Gosched()
        }
    }()
    wg.Wait()
}
```

With `GOMAXPROCS=1`, async preemption still works in Go 1.14+; the `Gosched` calls are largely redundant but not harmful. In Go 1.13 and earlier they were necessary to interleave.

### Example 15: Setting a max stack guard

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    debug.SetMaxStack(2 << 20) // 2 MB
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

The program crashes with `stack overflow` after ~500 frames instead of after ~250 000. Useful in tests guarding against unbounded recursion.

---

## Coding Patterns

### Pattern 1: Goroutine count as a smoke test

```go
import "runtime"

func TestNoLeak(t *testing.T) {
    before := runtime.NumGoroutine()
    runMyCode()
    runtime.GC()
    after := runtime.NumGoroutine()
    if after > before {
        t.Errorf("leak: before=%d after=%d", before, after)
    }
}
```

Crude but catches obvious leaks. Use `goleak` (uber-go/goleak) for production-grade leak detection.

### Pattern 2: Panic-safe goroutine wrapper

```go
func Go(name string, fn func()) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("goroutine %s panicked: %v\n%s", name, r, debug.Stack())
            }
        }()
        fn()
    }()
}
```

Use everywhere instead of bare `go fn()`. Ensures the program does not die from a single goroutine panic.

### Pattern 3: Always set memory limit in containers

```go
func init() {
    if s := os.Getenv("GOMEMLIMIT"); s == "" {
        // Optional: derive from /sys/fs/cgroup/memory.max
        debug.SetMemoryLimit(900 << 20) // 90% of 1 GB container
    }
}
```

`GOMEMLIMIT` environment variable does the same, but explicit code is verifiable.

### Pattern 4: Diagnostic endpoint on production servers

```go
http.HandleFunc("/debug/stacks", func(w http.ResponseWriter, r *http.Request) {
    buf := make([]byte, 1<<20)
    n := runtime.Stack(buf, true)
    w.Write(buf[:n])
})
```

Often combined with `net/http/pprof`. Make sure it is behind authentication.

### Pattern 5: Label every request

```go
func wrap(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        labels := pprof.Labels("path", r.URL.Path, "method", r.Method)
        pprof.Do(r.Context(), labels, func(ctx context.Context) {
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    })
}
```

CPU profiles taken later will let you ask "which paths are slow?" — invaluable.

---

## Clean Code

- **Read first, write last.** A program that calls `NumGoroutine`, `metrics.Read`, and `debug.Stack` is usually healthy. A program that calls `GC`, `Gosched`, and `Goexit` should explain why in a comment.
- **Set tunables once, at startup.** Use `init()` or `main()` early. Late changes to `GOMAXPROCS` or `SetMemoryLimit` confuse capacity planning.
- **Prefer `pprof.Do` over `SetGoroutineLabels`.** The former scopes labels correctly; the latter can leak labels into the parent goroutine's continuation.
- **Use `debug.Stack` for current frame, `runtime.Stack(buf, true)` for all.** Do not roll your own.
- **Never call `runtime.GC` in production code.** Benchmarks only.
- **Document every `LockOSThread`.** A comment explaining *why* the goroutine is pinned saves the next reader hours.

---

## Product Use / Feature

| Feature | How runtime APIs enable it |
|---|---|
| `/debug/pprof` endpoint | `net/http/pprof` calls into `runtime/pprof` to dump heap/goroutine/CPU profiles on demand. |
| Health check | `runtime.NumGoroutine()` plus a histogram of goroutine counts answers "is the server leaking?" |
| OOM avoidance | `debug.SetMemoryLimit` aligned with the container's memory cap. |
| Tenant-aware CPU billing | `pprof.SetGoroutineLabels` with `tenant=X`, sampled later for cost attribution. |
| Stuck server diagnosis | `SIGQUIT` (built-in) or HTTP endpoint serving `runtime.Stack(_, true)`. |
| Crash diagnostics | `debug.SetTraceback("all")` so a panic prints every goroutine's stack. |

---

## Error Handling

The runtime APIs themselves rarely return errors. The handful that do:

- `runtime.Stack` returns `n int` — the number of bytes written. Check it.
- `runtime.SetFinalizer` panics on misuse (wrong argument types). Treat the call site as a bug if it panics.
- `debug.SetGCPercent`, `debug.SetMemoryLimit`, `debug.SetMaxStack`, `debug.SetMaxThreads` return the *previous* value, not an error.

What you do need to handle:

- **Buffer too small in `runtime.Stack`.** If `n == len(buf)`, the trace was truncated. Grow the buffer and retry.
- **Panic in a goroutine.** Any goroutine you spawn should `defer recover()` if you cannot prove it cannot panic.
- **Finalizer panics.** A panic in a finalizer crashes the program. Wrap finalizer bodies in `defer recover()` if you cannot prove they cannot panic.

```go
func stackAll() []byte {
    n := 1 << 12
    for {
        buf := make([]byte, n)
        got := runtime.Stack(buf, true)
        if got < n {
            return buf[:got]
        }
        n *= 2
        if n > 64<<20 {
            return buf // give up at 64 MB
        }
    }
}
```

---

## Security Considerations

- **Diagnostic endpoints are leaks.** A `/debug/stacks` or `/debug/pprof` endpoint reveals function names, file paths, even some values via closure captures. Never expose them on the public internet.
- **`SIGQUIT` is unauthenticated.** Anyone who can send signals to the process can dump every goroutine's stack to its stderr. Run with `GOTRACEBACK=none` or supervise stderr to avoid leaking traces to log shippers.
- **`SetMaxThreads` is a DoS defence.** If your service does cgo and a peer can trigger many concurrent cgo calls, an attacker can exhaust the kernel thread limit. `SetMaxThreads` turns that into a controlled crash instead of a host-wide hang.
- **Finalizers can be a side channel.** A finalizer's running time is observable. If the finalizer body branches on secret data, that timing leaks the secret. Keep finalizers data-independent.
- **Profiling labels are PII risk.** Putting user emails or tokens into labels means they appear in pprof output and in any log shipper that ingests it. Use stable IDs instead.

---

## Performance Tips

- **`runtime.NumGoroutine` is O(1).** Call it freely.
- **`runtime.Stack(_, true)` stops the world.** Do not call on the hot path; reserve for diagnostics.
- **`SetGoroutineLabels` is cheap.** A few atomic writes. Use it liberally.
- **`SetMemoryLimit` shifts CPU vs memory.** Tight limits = more GC = more CPU. Measure before committing.
- **`runtime/metrics` reads are cheap.** Scrape periodically, e.g. every 5 seconds for Prometheus.
- **`GC()` is expensive and rarely warranted.** Force a GC in a benchmark, never in production code.
- **`Gosched` adds overhead.** Each call is a scheduler entry. In tight loops, more harm than good in modern Go.
- **Finalizers slow GC.** Each finalizable object adds work. Avoid for hot allocations.

---

## Best Practices

- Log `runtime.NumGoroutine()` and a few `runtime/metrics` values every minute.
- Set `GOMEMLIMIT` (or call `debug.SetMemoryLimit`) in every containerised service.
- Wrap every long-running goroutine in a panic recoverer.
- Add `pprof.Do(ctx, labels, fn)` around request handlers.
- Never call `runtime.GC` in production code paths.
- Document each `LockOSThread` with a comment explaining why.
- Reserve `Gosched`, `Goexit`, `SetFinalizer` for known specific use cases.
- Prefer `runtime/metrics` over `ReadMemStats` for new code.

---

## Edge Cases & Pitfalls

- **`GOMAXPROCS(0)` is a getter only since Go 1.5.** Passing `-1` is also a getter. Anything `> 0` is a setter.
- **`LockOSThread` is reference-counted since Go 1.10.** Lock twice, unlock twice. Mismatched lock/unlock is a runtime panic.
- **Finalizer goroutines run in arbitrary order.** Object A's finalizer may run before or after Object B's, even if A was set first.
- **`SetFinalizer(obj, nil)` removes the finalizer.** Useful if you re-pool an object.
- **`SetMaxThreads` crashes hard.** When the limit is hit, the runtime calls `exit(1)`. There is no graceful recovery.
- **`GOMEMLIMIT` is soft, not hard.** The runtime tries to stay under it but can exceed temporarily under burst allocation.
- **Stack traces are not stable across Go versions.** The format may change. Do not parse them; treat as opaque text.

---

## Common Mistakes

- **Calling `runtime.GC` for "cleanup" before responding to a request.** This adds 5–50 ms of pause for no benefit. The runtime knows when to GC.
- **Sprinkling `runtime.Gosched` for "fairness."** Async preemption made this obsolete in 2020.
- **Forgetting `defer runtime.UnlockOSThread`.** A locked goroutine that exits without unlocking takes the OS thread down with it — useful as a safety net, surprising as a default.
- **Setting `GOMAXPROCS` from inside a library.** A library should never set a process-global tunable. Leave that to `main`.
- **Calling `debug.SetMaxThreads(1)` "to be safe."** Any non-trivial program needs more. You will crash on startup.
- **Reading `MemStats` in a hot loop.** It stops the world. Use `runtime/metrics` instead.
- **Putting business state in a finalizer.** Finalizers may never run. Use `Close` and `defer`.

---

## Common Misconceptions

- **"`runtime.GC()` makes things faster."** No. Forcing a GC interrupts work; the runtime would have GC'd at a better moment anyway.
- **"More goroutines means slower."** Up to a point, no. The scheduler can handle hundreds of thousands. The cost is in what each goroutine *does*, not in its existence.
- **"`GOMAXPROCS=1` is single-threaded."** Wrong. There is still at least one extra M for blocking syscalls and the GC. `GOMAXPROCS` is the *Go code* parallelism, not the total thread count.
- **"`Goexit` is `os.Exit` for goroutines."** Half right. It runs defers; `os.Exit` does not. `Goexit` only terminates the current goroutine; `os.Exit` terminates the whole program.
- **"Finalizers are like C++ destructors."** Nothing like it. They are non-deterministic, may not run, run in their own goroutine, and serialize through one thread.

---

## Tricky Points

- The return value of `runtime.GOMAXPROCS(n)` is the *previous* value. Easy to misread as "the value I just set."
- `runtime.NumCPU()` returns the number of cores visible to the process at startup. It does not refresh when cgroups change at runtime.
- `runtime.Stack` writes `_Gready` goroutines first, then `_Gwaiting`, etc., in an order that may change between versions.
- `runtime/debug.SetGCPercent` takes a percentage; `100` means heap may double before GC. `-1` disables GC entirely (rare; benchmarks only).
- `debug.SetMemoryLimit(math.MaxInt64)` removes the limit. Useful for unsetting.
- `pprof.SetGoroutineLabels(ctx)` requires a context produced by `pprof.WithLabels` (or `pprof.Do`). A bare `context.Background()` clears labels.

---

## Test

Try to answer these without scrolling up. Then check.

1. What does `runtime.NumGoroutine()` count? Does it include the main goroutine?
2. What is the difference between `runtime.NumCPU()` and `runtime.GOMAXPROCS(0)`?
3. What happens if you call `runtime.GOMAXPROCS(0)`? `GOMAXPROCS(-1)`? `GOMAXPROCS(1)`?
4. What does `runtime.Goexit()` do that `return` does not?
5. What does `runtime.LockOSThread()` do, and what happens if you exit without `UnlockOSThread`?
6. Name three APIs in `runtime/debug` and what each does.
7. What is the difference between `runtime.Stack(buf, true)` and `runtime/debug.Stack()`?
8. When would you call `debug.SetMemoryLimit`?
9. What does `pprof.SetGoroutineLabels` do, and how is it different from `pprof.Do`?
10. Should you ever call `runtime.GC()` in production code? Why or why not?

**Answers:**

1. All live goroutines, including the main goroutine and any system goroutines (GC worker, sysmon when it runs as a goroutine, finalizer goroutine).
2. `NumCPU` is the number of logical cores the OS exposes. `GOMAXPROCS(0)` is the parallelism limit Go is willing to use (defaults to `NumCPU`).
3. `GOMAXPROCS(0)` reads the value without changing it. `GOMAXPROCS(-1)` is the same (read-only since Go 1.5). `GOMAXPROCS(1)` sets parallelism to 1 and returns the previous value.
4. `Goexit` terminates the current goroutine after running deferred functions, even if it is many call frames deep. `return` exits only one frame.
5. It pins the calling goroutine to its current OS thread until `UnlockOSThread`. If the goroutine exits while locked, the OS thread is destroyed.
6. Examples: `SetMaxStack` (per-goroutine stack ceiling), `SetMaxThreads` (process-wide thread ceiling), `SetGCPercent`, `SetMemoryLimit`, `Stack`, `PrintStack`, `SetTraceback`, `FreeOSMemory`.
7. `runtime.Stack(buf, true)` writes all goroutines' stacks into the supplied buffer (stops the world). `debug.Stack()` returns just the current goroutine's stack as a freshly allocated `[]byte`.
8. In any service running inside a container with a memory cap. It prevents OOM kills by making GC more aggressive as the limit approaches.
9. `SetGoroutineLabels` attaches labels to the calling goroutine for profiling. `pprof.Do` is a higher-level helper that sets labels for the duration of a function call and restores them after — recommended.
10. No, except in microbenchmarks. The runtime's GC scheduling is near-optimal. Manual calls only add pauses without long-term memory benefit.

---

## Tricky Questions

**Q: If `runtime.NumGoroutine()` is 7, can I assume my code created 7?**

A: No. The runtime adds its own goroutines (GC workers proportional to GOMAXPROCS, the finalizer goroutine, sometimes a trace/network helper). At rest, expect 2–5 "free" goroutines. The interesting metric is the delta, not the absolute.

**Q: Does `runtime.GOMAXPROCS(1)` make a program single-threaded?**

A: No. It limits to one P, so only one goroutine runs Go code at a time. But OS threads can still grow — for blocking syscalls, cgo calls, and runtime helpers. `top` may show several threads.

**Q: I call `runtime.Stack(buf, true)` from a panic. Will it dump every goroutine?**

A: Yes, but the panic itself may already have triggered the default traceback (controlled by `GOTRACEBACK`). To suppress the default and write your own, set `GOTRACEBACK=none` and recover the panic.

**Q: A finalizer references the object it finalizes. When does the object actually get freed?**

A: A finalizer that references its object resurrects the object for one more GC cycle. The object is reclaimed on the *next* cycle after the finalizer runs. Avoid this pattern.

**Q: I set `debug.SetMemoryLimit(100MB)` and my program still gets OOM-killed. Why?**

A: `SetMemoryLimit` is soft. Under burst allocation, the runtime cannot stop the user code mid-allocation. Set the limit below the container's hard cap (e.g. 90%) and ensure the workload's peak allocations fit.

---

## Cheat Sheet

```
// Counting / inspection
runtime.NumGoroutine() int
runtime.NumCPU() int
runtime.Stack(buf []byte, all bool) int
debug.Stack() []byte
debug.PrintStack()

// Scheduling
runtime.GOMAXPROCS(n int) int   // n>0 sets, n<=0 reads (same as 0)
runtime.Gosched()               // yield
runtime.Goexit()                // exit current goroutine, run defers
runtime.LockOSThread()
runtime.UnlockOSThread()

// GC / memory
runtime.GC()                            // force GC (rare)
debug.SetGCPercent(p int) int           // GOGC; -1 disables GC
debug.SetMemoryLimit(n int64) int64     // GOMEMLIMIT; soft cap
debug.FreeOSMemory()                    // hint to release to OS

// Resource limits
debug.SetMaxStack(bytes int) int        // per-goroutine cap
debug.SetMaxThreads(n int) int          // process-wide cap
debug.SetPanicOnFault(b bool) bool

// Finalizers
runtime.SetFinalizer(obj, fn)           // fn(obj) on collection; or nil to remove

// Tracing / debugging
debug.SetTraceback("all")               // verbosity for panic dump
runtime.SetCgoTraceback(...)
runtime.SetMutexProfileFraction(rate int) int
runtime.SetBlockProfileFraction(rate int) int

// Profiling labels
pprof.SetGoroutineLabels(ctx)
pprof.Do(ctx, pprof.Labels("k","v"), func(ctx context.Context) { ... })

// Full runtime trace
trace.Start(w io.Writer) error
trace.Stop()

// Structured metrics (Go 1.16+)
metrics.All() []metrics.Description
metrics.Read(samples []metrics.Sample)
```

---

## Self-Assessment Checklist

- [ ] I can read live goroutine count and use it for leak detection.
- [ ] I can print the current goroutine's stack and all goroutines' stacks.
- [ ] I know what `GOMAXPROCS` and `NumCPU` mean and how they relate.
- [ ] I can explain why I would call `SetMemoryLimit` in a container.
- [ ] I know that `Gosched`, `GC`, and `Goexit` are rarely needed.
- [ ] I can wrap a request handler with `pprof.Do` to add labels.
- [ ] I can read at least three values via `runtime/metrics`.
- [ ] I can recover from a panic in a goroutine and log the stack.
- [ ] I know `LockOSThread` exists, what it is for, and that it is rare.
- [ ] I know finalizers exist and that they are usually the wrong tool.

---

## Summary

The runtime API is small but pivotal. The everyday tools — `NumGoroutine`, `NumCPU`, `GOMAXPROCS(0)`, `debug.Stack`, `debug.SetMemoryLimit`, `pprof.Do`, `runtime/metrics` — are read-mostly, cheap, and safe. The advanced tools — `Gosched`, `Goexit`, `GC`, `LockOSThread`, `SetFinalizer`, `SetMaxThreads` — are powerful but easy to misapply. Memorise the taxonomy (counting, scheduling, GC, limits, profiling) and you will know which API to reach for in any situation.

At middle level we will tune `GOMAXPROCS` and `GOMEMLIMIT` for containers, configure `debug.SetMaxStack` to catch runaway recursion, and integrate `runtime/metrics` into Prometheus. At senior level we will use `pprof.SetGoroutineLabels`, build label-aware request middleware, and capture `runtime/trace` snapshots from running services. At professional level we will look at where each of these APIs hooks into the runtime internals.

---

## What You Can Build

- A `/debug/stacks` HTTP endpoint that dumps every goroutine.
- A SIGUSR1 handler that prints all stacks without exiting.
- A leak-detecting test wrapper using `NumGoroutine` deltas.
- A Prometheus exporter that scrapes `runtime/metrics` every 5 s.
- A request middleware that labels each request's goroutines.
- A safety wrapper that recovers panics and logs `debug.Stack()`.
- A cgo-aware service with `SetMaxThreads` as a DoS safety net.
- A container-aware `init()` that sets `GOMEMLIMIT` from cgroup.

---

## Further Reading

- The standard library docs for [`runtime`](https://pkg.go.dev/runtime), [`runtime/debug`](https://pkg.go.dev/runtime/debug), [`runtime/pprof`](https://pkg.go.dev/runtime/pprof), [`runtime/trace`](https://pkg.go.dev/runtime/trace), [`runtime/metrics`](https://pkg.go.dev/runtime/metrics).
- The Go release notes for 1.14 (async preemption), 1.19 (`SetMemoryLimit`), 1.21 (improved scheduler), 1.25 (container-aware `GOMAXPROCS`).
- `GOTRACEBACK` documentation in `runtime/extern.go`.
- The pprof book chapter on goroutine labels.
- `go doc runtime` and `go doc runtime/metrics` from your terminal.

---

## Related Topics

- [01-overview](../01-overview/) — what a goroutine is.
- [02-vs-os-threads](../02-vs-os-threads/) — `LockOSThread`, `GOMAXPROCS`, M:N model.
- [03-stack-growth](../03-stack-growth/) — what `SetMaxStack` actually caps.
- [05-best-practices](../05-best-practices/) — when to leave the runtime alone.
- [06-common-pitfalls](../06-common-pitfalls/) — finalizer footguns, `GC()` abuse.
- Scheduler deep-dive (later section) — what `GOMAXPROCS` actually controls internally.
- Garbage collector section — what `GOGC` and `GOMEMLIMIT` actually do internally.

---

## Diagrams & Visual Aids

### API map by purpose

```
                runtime + subpackages
                          |
   +---------+------------+----------+-------------+
   |         |            |          |             |
 count    schedule       GC/mem    limits      profile/trace
   |         |            |          |             |
 NumGo    GOMAXPROCS    GC         SetMaxStack   pprof labels
 Stack    NumCPU       SetGCPct   SetMaxThreads  trace.Start
 debug.   Gosched      SetMemLim                 metrics.Read
  Stack   Goexit       FreeOSMem
          LockOSThr
          UnlockOSThr
```

### When to call which

```
"Is my program leaking?"           -> NumGoroutine, metrics
"Show me what's stuck"             -> Stack(_, true)
"Crash earlier on recursion"       -> SetMaxStack
"Avoid OOM in container"           -> SetMemoryLimit
"Tag profile by tenant"            -> pprof.Do
"Pin to OS thread for GL"          -> LockOSThread
"Run code on goroutine exit"       -> defer, NOT SetFinalizer
"Force GC for a benchmark"         -> GC()
"Yield in a tight loop"            -> (probably nothing; async preempt handles it)
```

### Lifetime of a labeled goroutine

```
parent goroutine
  |
  | pprof.Do(ctx, labels, fn)
  |    -- pushes labels onto parent's profiler context
  |    fn runs:
  |       go child()         <- child inherits labels at spawn
  |       go grandchild()    <- also labeled
  |    fn returns
  |    -- labels popped from parent
  v
```

Labels propagate by *value at spawn time*. A child started after `pprof.Do` returns does not inherit the labels.

### `LockOSThread` + `Goexit`

```
goroutine G on thread T
  LockOSThread()
   ... runs on T only ...
  runtime.Goexit()
   -- defers run on T
   -- goroutine ends
   -- thread T is destroyed (because lock was held)
```

This is *intentional*. State on T (thread-locals, signal mask) does not leak into a future goroutine on T.
