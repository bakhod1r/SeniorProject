# pprof and Profiling Tools — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Full Profile Catalogue](#the-full-profile-catalogue)
3. [Mutex and Block Profiles in Depth](#mutex-and-block-profiles-in-depth)
4. [Heap, Allocs, and the gc Parameter](#heap-allocs-and-the-gc-parameter)
5. [`go tool pprof` REPL Mastery](#go-tool-pprof-repl-mastery)
6. [The Web UI and Flame Graphs](#the-web-ui-and-flame-graphs)
7. [`runtime/trace` for Scheduler Insight](#runtimetrace-for-scheduler-insight)
8. [Profile Diffs](#profile-diffs)
9. [Production Snapshot Discipline](#production-snapshot-discipline)
10. [Testing with pprof](#testing-with-pprof)
11. [Common Anti-Patterns](#common-anti-patterns)
12. [Diagnostics Playbook](#diagnostics-playbook)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

At junior level you learned the surface: how to expose pprof, take a profile, and run `top` in the REPL. At middle level you treat pprof as a daily tool. You know all eight profile types and when to reach for each. You read flame graphs fluently. You compare profiles across time. You combine `runtime/trace` with pprof when scheduler behaviour matters. And you have hardened pprof so it can ship to production safely.

After this file you will:

- Know every profile in the standard library and what it samples.
- Enable mutex and block profiles correctly and read their output.
- Use `go tool pprof` filters: `-focus`, `-ignore`, `-hide`, `-show`, `-tagfocus`.
- Diff two heap profiles with `-base`.
- Capture and analyse a `runtime/trace` and align it with pprof data.
- Write tests that compare pre/post goroutine counts.
- Recognise the anti-patterns: pprof on `0.0.0.0`, infinite-window CPU profiles, ignoring the `gc` flag.

For the deeper material — labels, continuous profiling backends, custom profile registration — see `senior.md`. For internals — how the sampler decides what to record, the protobuf format itself — see `professional.md`.

---

## The Full Profile Catalogue

The pprof registry exposes nine well-known profile types. Memorise them; they are the menu.

### `goroutine`

Snapshot of every live goroutine. **Use first** for leaks, stuck services, and "why is `runtime.NumGoroutine()` so high".

- HTTP: `/debug/pprof/goroutine`
- Three debug levels: `0` binary, `1` grouped text, `2` every goroutine.
- Slightly stops the world; cheap unless goroutine count is huge.

### `heap`

Sampled allocations that are **still in use** (have not been garbage collected). The default view shows in-use memory by call site.

- HTTP: `/debug/pprof/heap`
- Useful flags: `?gc=1` forces GC before sampling.
- Sample rate: `runtime.MemProfileRate` (default 512 KB).

### `allocs`

Total allocations since program start. Same data source as `heap` but a different view: it shows everything sampled, not just what is still live.

- HTTP: `/debug/pprof/allocs`
- CLI: `go tool pprof -alloc_objects` or `-alloc_space`.

### `threadcreate`

Stack at the point each OS thread was created. Useful when `runtime.NumThread()` or the M count climbs.

- HTTP: `/debug/pprof/threadcreate`
- Off-by-default? No, always available but rarely large.

### `block`

Goroutines blocked on synchronisation: channel send/receive, `sync.Mutex.Lock`, `sync.WaitGroup.Wait`, `time.Sleep`.

- HTTP: `/debug/pprof/block`
- **Off by default.** Enable with `runtime.SetBlockProfileRate(rate)`. The rate is in nanoseconds — a value of 1 records every blocking event, 100000 (100 microseconds) records about 1 in 10,000.

### `mutex`

Contended `sync.Mutex.Lock` and `sync.RWMutex.Lock` calls — specifically the ones that had to wait.

- HTTP: `/debug/pprof/mutex`
- **Off by default.** Enable with `runtime.SetMutexProfileFraction(rate)`. Rate of 1 samples every contention, 100 samples 1%.

### `profile` (CPU)

Periodic CPU sampling. Duration-based. The HTTP endpoint takes a `seconds=N` parameter.

- HTTP: `/debug/pprof/profile?seconds=30`
- Default sample rate: 100 Hz.
- Overhead: ~5% during collection.

### `trace`

A full execution trace, not a sampled profile. Captured by `runtime/trace`. Massive output; richest signal.

- HTTP: `/debug/pprof/trace?seconds=5`
- Inspect with `go tool trace trace.out`, not `go tool pprof`.

### A note on `cmdline` and `symbol`

The endpoints `/debug/pprof/cmdline` and `/debug/pprof/symbol` are not profiles. The first returns the binary's command-line arguments; the second resolves PC addresses to symbol names. They exist to support the pprof tool when fetching profiles over HTTP.

---

## Mutex and Block Profiles in Depth

Most production services run with **both off**. To debug a contention problem you must enable one — usually at startup, behind a feature flag.

```go
import "runtime"

func enableContentionProfiles() {
    // Sample 1 in 100 contended mutex events.
    runtime.SetMutexProfileFraction(100)
    // Record every blocking event longer than 1ms.
    runtime.SetBlockProfileRate(int(time.Millisecond))
}
```

### Tuning the rates

For `SetBlockProfileRate`:

- `0` (default) — off.
- `1` — every event. Expensive.
- `N` — record events that took at least N nanoseconds.

For `SetMutexProfileFraction`:

- `0` (default) — off.
- `1` — every contention.
- `N` — about 1 in N.

In production, start with `SetMutexProfileFraction(100)` and `SetBlockProfileRate(int(time.Millisecond))`. That gives meaningful samples without significant overhead.

### Reading a block profile

```
(pprof) top
Showing nodes accounting for 4.2s, 100% of 4.2s total
      flat  flat%   sum%        cum   cum%
     3.5s 83.33% 83.33%      3.5s 83.33%  main.(*Cache).Get.func1
     0.7s 16.67%   100%      0.7s 16.67%  main.worker
```

The numbers are **time spent blocked**, not wall-clock time. If three goroutines all blocked for 1 second simultaneously on the same call site, the profile shows 3 seconds.

### Reading a mutex profile

```
(pprof) top
Showing nodes accounting for 2.1s, 100% of 2.1s total
      flat  flat%   sum%        cum   cum%
     1.8s 85.71% 85.71%      1.8s 85.71%  sync.(*Mutex).Lock /shared/cache.go:42
     0.3s 14.29%   100%      0.3s 14.29%  sync.(*RWMutex).RLock
```

The samples are **time the holder kept the lock while another goroutine waited**, not pure wait time. A high number means "this lock is a bottleneck."

---

## Heap, Allocs, and the `gc` Parameter

The heap profile records sampled allocations. Two pivots are important.

### In-use vs alloc

```bash
# memory currently in use (default)
go tool pprof http://host:6060/debug/pprof/heap

# memory ever allocated (often gives more clues for GC pressure)
go tool pprof -alloc_space http://host:6060/debug/pprof/allocs
```

A function that allocates 10 GB but releases it all immediately shows nothing in `inuse_space` but huge in `alloc_space`.

### Forcing GC for a clean view

By default the heap profile includes objects that are dead but have not been collected yet. To see only live memory:

```bash
go tool pprof http://host:6060/debug/pprof/heap?gc=1
```

The HTTP handler runs `runtime.GC()` first. Slight pause, much cleaner data.

### The four heap views

| View | Flag | Meaning |
|------|------|---------|
| `inuse_space` | default | bytes still allocated |
| `inuse_objects` | `-inuse_objects` | object count still allocated |
| `alloc_space` | `-alloc_space` | total bytes ever allocated |
| `alloc_objects` | `-alloc_objects` | total objects ever allocated |

Switch live in the REPL with `sample_index`:

```
(pprof) sample_index=alloc_space
(pprof) top
```

---

## `go tool pprof` REPL Mastery

The REPL has more commands than `top` and `list`. The useful ones:

### `top`

```
(pprof) top         # top 10 by flat
(pprof) top 30      # top 30
(pprof) top -cum    # sort by cumulative
(pprof) top -flat   # default
```

- **Flat**: time spent in this function itself.
- **Cum**: time in this function plus everything it called.

For a goroutine profile, "time" is "goroutine count."

### `list`

```
(pprof) list main.worker
ROUTINE ======================== main.worker in /path/main.go
        0          5   |  func worker(ch <-chan int) {
        0          5   |      for v := range ch {
        5          5   |          process(v)
        0          0   |      }
        0          0   |  }
```

Left column is **flat**, right is **cum**.

### `peek`

```
(pprof) peek main.worker
   3.5s    main.dispatch
   1.5s    main.(*Pool).run
```

Shows callers of a function. Inverse of `list`.

### `traces`

```
(pprof) traces
-----------+-------------------------------------------------------
       5  main.worker
          main.dispatch
          main.main
```

Each unique stack is shown once, with the sample count. For a goroutine profile, this is essentially `?debug=1` but interactive.

### `web`

Opens a graph rendering in your browser (requires graphviz). Each node is a function; each edge a caller→callee relationship; node size is proportional to flat samples; edge weight is sample count.

### Filters

| Flag | Effect |
|------|-------|
| `-focus=regex` | only samples matching the regex |
| `-ignore=regex` | drop samples matching the regex |
| `-hide=regex` | hide functions but keep their cost in parent |
| `-show=regex` | inverse of `-hide` |
| `-tagfocus=key=val` | only samples with this label |
| `-tagignore=key=val` | drop samples with this label |

Examples:

```
(pprof) focus=worker top
(pprof) ignore=runtime top
```

Same flags work on the command line:

```bash
go tool pprof -focus=worker -ignore=runtime g.prof
```

---

## The Web UI and Flame Graphs

```bash
go tool pprof -http=:9090 cpu.prof
```

Open `http://localhost:9090`. Five views in the dropdown:

1. **Top** — same as the REPL `top`.
2. **Graph** — the graphviz call graph.
3. **Flame Graph** — the icicle view.
4. **Source** — annotated source listing.
5. **Peek** — callers.

### How to read a flame graph

- **x-axis**: relative cost (CPU time, goroutine count, allocation bytes — depends on the profile).
- **y-axis**: stack depth. The top of each tower is the function actually doing work.
- **Width**: the wider the rectangle, the more cost.
- **Colour**: usually random or by package — not meaningful unless your tool sets a colour scheme.

A leak hunt example: in a goroutine flame graph, the wide rectangle at the top is the stack on which most leaked goroutines are parked. Click it; it zooms in. The hierarchy below it is the call path that created those goroutines.

### Icicle vs flame

The default `go tool pprof` web flame graph is **icicle-shaped** (stack grows down). Brendan Gregg's classical flame graph is **upside-down** (stack grows up). Same data, mirrored.

---

## `runtime/trace` for Scheduler Insight

Profiles tell you *what* code is running. Traces tell you *when* and *how* the scheduler interleaved it. The trace records every:

- Goroutine create / start / end / block / unblock
- GC start / stop
- Network poller wakeup
- Syscall enter / exit
- User-defined regions and tasks

### Capturing a trace programmatically

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
defer f.Close()

trace.Start(f)
defer trace.Stop()

// ... work to be traced ...
```

### Capturing over HTTP

```bash
curl -o trace.out http://localhost:6060/debug/pprof/trace?seconds=5
go tool trace trace.out
```

The browser opens with views:

- **View trace** — the timeline. Each goroutine on a horizontal lane.
- **Goroutine analysis** — per-function aggregates.
- **Synchronization blocking profile** — like the block profile but tied to specific events.
- **User-defined tasks / regions** — if you used `trace.NewTask` and `trace.WithRegion`.
- **Scheduler latency profile** — time goroutines spent runnable but not running.

### When to reach for trace instead of pprof

| Question | Better tool |
|----------|-------------|
| Which function uses the most CPU? | CPU profile |
| Which goroutines exist right now? | goroutine profile |
| Where do my goroutines block? | block profile or trace |
| Why is my p99 latency bad? | trace |
| Is my GC interfering with requests? | trace |
| Do my goroutines wait long to be scheduled? | trace |

---

## Profile Diffs

The `-base` flag compares two profiles. The output is `current - base`. Positive numbers grew, negative shrank.

```bash
# baseline at startup
curl -o g1.prof http://localhost:6060/debug/pprof/goroutine

# after suspect load
curl -o g2.prof http://localhost:6060/debug/pprof/goroutine

go tool pprof -base g1.prof g2.prof
```

A leak hunt then becomes: `(pprof) top` and look at the largest positive numbers. Those are the call sites that gained goroutines between the two snapshots.

Heap diffs work the same way:

```bash
go tool pprof -base before.heap after.heap
```

---

## Production Snapshot Discipline

Most teams hit pprof reactively — only after an incident. The mature pattern is to capture profiles **continuously and routinely**, so when something goes wrong you have history.

### Hourly snapshots

```go
func snapshotLoop(ctx context.Context, dir string) {
    t := time.NewTicker(time.Hour)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            ts := time.Now().UTC().Format("20060102T150405Z")
            for _, name := range []string{"goroutine", "heap", "allocs"} {
                path := filepath.Join(dir, fmt.Sprintf("%s-%s.prof", name, ts))
                f, err := os.Create(path)
                if err != nil {
                    log.Printf("snapshot: %v", err)
                    continue
                }
                _ = pprof.Lookup(name).WriteTo(f, 0)
                _ = f.Close()
            }
        }
    }
}
```

Rotate older files to S3 or just keep the last N. Disk is cheap.

### Signal-triggered snapshots

```go
signal.Notify(ch, syscall.SIGUSR1)
go func() {
    for range ch {
        path := fmt.Sprintf("/tmp/g-%d.prof", time.Now().Unix())
        f, _ := os.Create(path)
        _ = pprof.Lookup("goroutine").WriteTo(f, 0)
        _ = f.Close()
        log.Printf("snapshot at %s", path)
    }
}()
```

`kill -USR1 <pid>` from an on-call shell.

### Snapshots from the orchestrator

In Kubernetes, exec into a pod and run `wget` against `127.0.0.1:6060/debug/pprof/goroutine?debug=2`. Stream the output into your laptop and analyse offline.

---

## Testing with pprof

A useful pattern in tests: assert that a function does not leak goroutines.

```go
func TestNoLeak(t *testing.T) {
    before := runtime.NumGoroutine()

    doWork()
    time.Sleep(50 * time.Millisecond) // allow background to settle

    after := runtime.NumGoroutine()
    if after > before {
        // dump for diagnosis
        buf := new(bytes.Buffer)
        _ = pprof.Lookup("goroutine").WriteTo(buf, 1)
        t.Fatalf("leaked %d goroutines\n%s", after-before, buf.String())
    }
}
```

Better: use `go.uber.org/goleak` (covered in `02-detecting-leaks/`). The pprof dump on failure makes diagnosis painless.

### Compile-time profile injection

The `go test` command has flags for profiles:

```bash
go test -cpuprofile cpu.prof -memprofile mem.prof -mutexprofile mu.prof -blockprofile bl.prof
go tool pprof cpu.prof
```

For benchmarks:

```bash
go test -bench=. -benchtime=10s -cpuprofile cpu.prof -memprofile mem.prof
```

---

## Common Anti-Patterns

### Anti-pattern: pprof on `0.0.0.0`

```go
http.ListenAndServe(":6060", nil) // BAD
```

If the host is on the internet, pprof is too. Always `127.0.0.1:6060`.

### Anti-pattern: massive CPU windows

```bash
curl http://host:6060/debug/pprof/profile?seconds=600
```

Ten-minute profiles are rarely useful and produce huge files. Two 30-second profiles are better than one 600-second profile.

### Anti-pattern: ignoring `gc=1` on heap

Without `?gc=1`, your heap profile contains dead objects waiting to be collected. Often the "leak" you are chasing is just retained garbage.

### Anti-pattern: enabling mutex profile at fraction 1 in production

```go
runtime.SetMutexProfileFraction(1) // BAD in prod
```

Every contention is sampled. The runtime spends measurable time recording. Use 100 or higher.

### Anti-pattern: comparing CPU profiles of different durations

A 10-second profile and a 60-second profile are not directly comparable in absolute numbers. Always match `seconds=`.

### Anti-pattern: importing `net/http/pprof` in a library

The package mutates the default mux via `init()`. Libraries should never do this. Only main packages should import it.

---

## Diagnostics Playbook

| Symptom | First step | Second step |
|---------|------------|-------------|
| Memory growing | `curl heap?gc=1`, compare two | `allocs` for total churn |
| CPU pegged | `profile?seconds=30` | `list` the hot functions |
| Goroutine count growing | `goroutine?debug=1` | `?debug=2` for state |
| p99 latency spike | `trace?seconds=5` | scheduler latency view |
| Lock-heavy code | enable mutex profile | `top -cum`, then `list` |
| Channel waits | enable block profile | distinguish chan vs mutex stacks |
| Too many threads | `threadcreate` | look for cgo or syscall stacks |

### A leak hunt walk-through

1. `curl -s host:6060/debug/pprof/goroutine?debug=1 | head -1` — quick count.
2. Wait 1 minute under steady load. Repeat.
3. If count grew: `curl -o g1.prof host:6060/debug/pprof/goroutine`, wait, again `-o g2.prof`.
4. `go tool pprof -base g1.prof g2.prof`.
5. `(pprof) top -cum`.
6. The top stack is where goroutines are accumulating. Read it with `list`.

### A latency walk-through

1. `curl -o trace.out host:6060/debug/pprof/trace?seconds=5` during a busy period.
2. `go tool trace trace.out`.
3. **Synchronization blocking profile** for blocking culprits.
4. **Scheduler latency profile** for "runnable but not running" time.
5. **View trace** if you need to see one specific request.

---

## Self-Assessment

- [ ] I can list all eight built-in profile types and what they sample.
- [ ] I know how to enable mutex and block profiles and at what rates.
- [ ] I use `?gc=1` when looking at heap.
- [ ] I read flame graphs by stack-depth and width.
- [ ] I diff profiles with `-base`.
- [ ] I capture a `runtime/trace` and know what to look at first.
- [ ] I never bind pprof to a public address.
- [ ] I have hourly snapshots wired in at least one service.
- [ ] I can spot the anti-patterns: `0.0.0.0`, fraction=1 in prod, library import of pprof.

---

## Summary

Middle-level pprof is about fluency. The toolchain has a small surface — eight profile types, six REPL commands, a few CLI flags — but you only get value when you use them habitually. Enable mutex and block profiles where they help. Diff profiles instead of staring at one. Pair `runtime/trace` with pprof when latency is the question. Keep pprof on a private port. Snapshot continuously so you have a baseline. The combination of `goroutine?debug=1` for triage, `-base` for diffs, and the web UI for visualisation handles most production debugging without ever stepping into a debugger.
