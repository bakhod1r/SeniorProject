# Runtime Hooks — Middle

## 1. From "I can read it" to "I can change it"

At junior level you read the runtime: how many goroutines, how much heap. At middle level you start changing its behavior — telling the GC how aggressive to be, bounding the memory it uses, profiling code under load, switching on `GODEBUG` flags for diagnosis.

These hooks are powerful but have semantics that matter. This page covers the ones you will use regularly in real services, and the ones you should know exist before you reach for them.

---

## 2. Tuning the GC: `SetGCPercent`

```go
import "runtime/debug"

prev := debug.SetGCPercent(200) // double the heap headroom
defer debug.SetGCPercent(prev)
```

`SetGCPercent(p)` is equivalent to setting `GOGC=p` at startup, applied immediately. It returns the previous value so you can restore it.

What `p` means: the GC tries to start a cycle when the live heap has grown by `p%` since the last cycle. Default is `100`, meaning GC fires when the heap doubles.

| Setting | Behavior |
|---------|----------|
| `100` (default) | GC at 2× live |
| `200` | GC at 3× live — less GC CPU, more memory |
| `50` | GC at 1.5× live — more GC CPU, less memory |
| `-1` | GC disabled (rarely correct; pair with `SetMemoryLimit`) |

When to raise it: GC-CPU-bound batch jobs where the working set is small and the spare memory is wasted on the floor. When to lower it: rarely — usually the right move is to allocate less.

---

## 3. Soft memory cap: `SetMemoryLimit` (Go 1.19+)

```go
import "runtime/debug"

debug.SetMemoryLimit(900 * 1 << 20) // 900 MiB
```

`SetMemoryLimit` (and the corresponding `GOMEMLIMIT` env var) tells the runtime "do not exceed N bytes of total memory if you can possibly help it". It is a **soft** limit: when memory pressure approaches `N`, the GC runs more aggressively. If allocation truly outpaces collection, the runtime will exceed the limit rather than OOM-kill the program.

Practical recipe for a container:

```go
// In init() of your main package
limitBytes := readCgroupMemoryLimit()
if limitBytes > 0 {
    debug.SetMemoryLimit(int64(float64(limitBytes) * 0.9))
}
```

Reserve ~10% for non-Go memory (cgo allocations, mmaps, page tables) and the kernel's accounting overhead. The `automemlimit` library does this automatically by reading `/sys/fs/cgroup/memory.max`.

Combinations:

| `GOGC` | `GOMEMLIMIT` | Effect |
|--------|--------------|--------|
| `100` | unset | Default: GC by ratio only |
| `100` | `900MiB` | GC by ratio, but tighten near 900 MiB |
| `off` | `900MiB` | GC only when memory pressure approaches 900 MiB |
| `off` | unset | GC disabled (do not do this in production) |

---

## 4. Releasing pages eagerly: `FreeOSMemory`

```go
import "runtime/debug"

processBigBatch()
debug.FreeOSMemory()   // run GC and return idle pages to the OS now
```

`FreeOSMemory()` forces a GC cycle and asks the runtime to advise the OS that idle pages can be reclaimed. On Linux that translates to `MADV_DONTNEED` (immediate) or `MADV_FREE` (lazy, default since Go 1.12 on kernels ≥ 4.5).

Use cases:

- Batch program that just finished a large stage and is about to idle.
- Long-lived service after a known peak (cron-style hourly compaction).
- Test harnesses that want a clean state between cases.

**Do not** call this on every request. It is a hammer; the GC pacer normally does this job better.

---

## 5. Capping per-goroutine stack: `SetMaxStack`

```go
import "runtime/debug"

debug.SetMaxStack(64 << 20) // 64 MiB cap
```

By default, a goroutine's stack can grow up to ~1 GiB on 64-bit. `SetMaxStack` lowers that ceiling. A goroutine that exceeds it panics with `runtime: goroutine stack exceeds N-byte limit`.

When is this useful? When you suspect runaway recursion or accidental quadratic stack consumption and you want to fail fast instead of OOM-ing the host. Treat it as a debugging tool, not a production knob.

---

## 6. Bounding OS threads: `SetMaxThreads`

```go
import "runtime/debug"

debug.SetMaxThreads(2000)
```

Default is 10000. A blocked syscall in a Go program creates a new OS thread; in pathological cases (millions of blocking syscalls) you can exhaust the host's thread limit. `SetMaxThreads` makes the runtime panic with a clear message instead.

If you find yourself anywhere near this limit, the real fix is to stop spawning goroutines that all block in syscalls — use a worker pool with a bounded count.

---

## 7. `runtime/metrics` — preferred over `ReadMemStats` in services

```go
package main

import (
    "fmt"
    "runtime/metrics"
)

func main() {
    names := []string{
        "/memory/classes/total:bytes",
        "/memory/classes/heap/objects:bytes",
        "/memory/classes/heap/free:bytes",
        "/memory/classes/heap/released:bytes",
        "/gc/cycles/automatic:gc-cycles",
        "/sched/goroutines:goroutines",
        "/sched/latencies:seconds", // histogram
    }
    samples := make([]metrics.Sample, len(names))
    for i, n := range names {
        samples[i].Name = n
    }
    metrics.Read(samples)

    for _, s := range samples {
        switch s.Value.Kind() {
        case metrics.KindUint64:
            fmt.Printf("%-50s %d\n", s.Name, s.Value.Uint64())
        case metrics.KindFloat64:
            fmt.Printf("%-50s %f\n", s.Name, s.Value.Float64())
        case metrics.KindFloat64Histogram:
            h := s.Value.Float64Histogram()
            fmt.Printf("%-50s %d buckets, total=%d\n",
                s.Name, len(h.Buckets), sum(h.Counts))
        }
    }
}

func sum(xs []uint64) (n uint64) { for _, x := range xs { n += x }; return }
```

Two operational reasons to migrate:

1. **No STW.** `ReadMemStats` briefly pauses every goroutine. `metrics.Read` does not.
2. **Histograms.** GC pauses (`/gc/pauses:seconds`) and scheduler latency (`/sched/latencies:seconds`) come as full distributions, not just means.

The Prometheus client library `client_golang` ships a collector that exposes the entire `runtime/metrics` view; turn it on in one line:

```go
prometheus.MustRegister(collectors.NewGoCollector(
    collectors.WithGoCollections(collectors.GoRuntimeMetricsCollection),
))
```

---

## 8. CPU profiling under load: `runtime/pprof`

```go
package main

import (
    "os"
    "runtime/pprof"
    "time"
)

func main() {
    f, err := os.Create("cpu.pprof")
    if err != nil { panic(err) }
    defer f.Close()

    if err := pprof.StartCPUProfile(f); err != nil { panic(err) }
    defer pprof.StopCPUProfile()

    work(30 * time.Second)
}
```

This writes a CPU profile sampled at 100 Hz to `cpu.pprof`. Open it with `go tool pprof cpu.pprof` and either `top`, `web`, or `list <func>`.

The sampling is statistical: at each tick, the runtime walks the stacks of all running goroutines. 30 seconds of profiling is enough to find any function that runs > 1% of the time.

If you already have an HTTP server, the easier route is the `net/http/pprof` package, which exposes `/debug/pprof/profile?seconds=30` on demand. **Bind it to a non-public port** — pprof reveals symbol names and code structure.

---

## 9. Heap profile snapshot

```go
import (
    "os"
    "runtime"
    "runtime/pprof"
)

func snapshotHeap(path string) error {
    runtime.GC() // get a clean snapshot (optional)
    f, err := os.Create(path)
    if err != nil { return err }
    defer f.Close()
    return pprof.WriteHeapProfile(f)
}
```

The heap profile reports live allocations at the time of capture (`inuse_space` and `inuse_objects` views) plus cumulative since-start counts (`alloc_space`, `alloc_objects`). Sampling rate is `runtime.MemProfileRate` (default 512 KiB). For tests where every allocation must be visible, set `runtime.MemProfileRate = 1` — but don't ship that to production.

A common diff workflow:

```
go tool pprof -base before.pprof after.pprof
```

…shows what allocated between the two snapshots.

---

## 10. Useful `GODEBUG` flags during diagnosis

| Setting | What it does | When |
|---------|--------------|------|
| `gctrace=1` | One line per GC cycle to stderr | Verify GC is healthy, see pause times |
| `schedtrace=1000` | Scheduler snapshot every second | Check P/G/M counts under load |
| `inittrace=1` | Print per-package init duration | Find slow `init()` functions |
| `madvdontneed=1` | Force eager page return | RSS not dropping after big batch |
| `gcstoptheworld=1` | Force STW GC | Reproducing pacer issues |
| `cgocheck=2` | Aggressive cgo pointer validation | Diagnosing cgo crashes |

Set them in the environment, not in code:

```
GODEBUG=gctrace=1,schedtrace=1000 ./myserver
```

A single `gctrace=1` line, decoded:

```
gc 18 @5.2s 4%: 0.1+3.0+0.05 ms clock, ... 60→68→40 MB, 80 MB goal, 8 P
```

means cycle #18 finished at 5.2 s, 4% cumulative GC CPU, three phases (sweep+mark+termination) in wall ms, heap went from 60 MiB at start to 68 MiB at mark end to 40 MiB live, goal was 80 MiB, with 8 P.

---

## 11. Stack of all goroutines on demand

A common operational pattern: when a service deadlocks, you want every goroutine's stack. Three ways to obtain it:

```go
// 1. The blunt way: any goroutine can call:
buf := make([]byte, 1<<20)
n := runtime.Stack(buf, true) // true = all goroutines, STW
log.Print(string(buf[:n]))
```

```go
// 2. The pprof way: ship the goroutine profile (no STW for `debug=1`):
pprof.Lookup("goroutine").WriteTo(w, 1)
```

```go
// 3. SIGQUIT: send the process SIGQUIT (Ctrl-\) and the runtime
//    dumps all stacks to stderr and exits. Do this from the terminal
//    when the process is unresponsive but not crashed.
```

The pprof goroutine profile is the friendliest for repeated capture in production.

---

## 12. Programmatic panic stack with `debug.Stack()`

```go
import "runtime/debug"

defer func() {
    if r := recover(); r != nil {
        log.Printf("panic: %v\n%s", r, debug.Stack())
    }
}()
```

`debug.Stack()` returns the current goroutine's stack as a byte slice. The pattern above is the foundation of every "panic recovery middleware" in Go HTTP frameworks. **Don't** swallow the panic silently; either re-panic after logging or convert it to an error response.

---

## 13. `runtime.SetBlockProfileRate` and `SetMutexProfileFraction`

Block and mutex profiles are off by default because they cost something on every sync operation. Enable them at startup if you suspect contention:

```go
runtime.SetBlockProfileRate(1)        // sample every blocking event
runtime.SetMutexProfileFraction(1)    // sample every mutex contention
```

Then read `pprof.Lookup("block")` and `pprof.Lookup("mutex")` for the profiles. In high-throughput services, dial these down (e.g., `100` to sample 1-in-100) so the profiler itself doesn't become the bottleneck.

---

## 14. Reading build metadata at runtime

```go
import "runtime/debug"

info, _ := debug.ReadBuildInfo()
for _, s := range info.Settings {
    fmt.Println(s.Key, s.Value)
}
```

You'll see entries like `GOOS=linux`, `vcs.revision=abc123...`, `vcs.time=2026-04-01T...`, `vcs.modified=false`. Surface these on `/version` so you can correlate logs with code at incident time.

---

## 15. Summary

At middle level, runtime hooks become tools you use for real work: tune GC headroom with `SetGCPercent`, cap memory with `SetMemoryLimit`, return pages with `FreeOSMemory`, capture profiles with `runtime/pprof`, expose `runtime/metrics` to your monitoring system, and turn on `GODEBUG=gctrace=1` during incidents. The discipline is measurement: read the numbers before turning the knobs, and verify each change with a follow-up profile.

---

## Further reading
- GC guide (tuning section): https://go.dev/doc/gc-guide
- `runtime/metrics` design: https://github.com/golang/proposal/blob/master/design/37112-metrics.md
- `pprof` reading guide: https://github.com/google/pprof/blob/main/doc/README.md
- `GODEBUG` reference: https://pkg.go.dev/runtime#hdr-Environment_Variables
- `automemlimit`: https://github.com/KimMachineGun/automemlimit
