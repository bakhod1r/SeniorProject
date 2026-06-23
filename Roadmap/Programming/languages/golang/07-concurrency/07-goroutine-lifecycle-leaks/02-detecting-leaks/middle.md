# Detecting Goroutine Leaks — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Full `pprof goroutine` Workflow](#the-full-pprof-goroutine-workflow)
3. [Reading `debug=1` vs `debug=2`](#reading-debug1-vs-debug2)
4. [Grouping Stacks by Frame](#grouping-stacks-by-frame)
5. [False Positives — Runtime-Owned Goroutines](#false-positives--runtime-owned-goroutines)
6. [`goleak` in Depth](#goleak-in-depth)
7. [Filtering with `pprof.SetGoroutineLabels`](#filtering-with-pprofsetgoroutinelabels)
8. [Programmatic Profile Capture](#programmatic-profile-capture)
9. [Diffing Two Profiles](#diffing-two-profiles)
10. [`go tool pprof` Interactive Session](#go-tool-pprof-interactive-session)
11. [`gops` Walk-through](#gops-walk-through)
12. [`runtime/trace` for Lifetime Events](#runtimetrace-for-lifetime-events)
13. [Common Anti-Patterns](#common-anti-patterns)
14. [Self-Assessment](#self-assessment)
15. [Summary](#summary)

---

## Introduction

At junior level you learned the tools individually: `NumGoroutine`, `pprof`, `goleak`. At middle level you put them together into an investigation workflow. The mindset shifts from "this tool exists" to "given a service whose memory is climbing at 50 MB per hour, in what order do I reach for which tool, and how do I interpret what each one tells me?"

After this file you will:

- Execute the full `pprof goroutine` workflow from production binary to root-caused file:line.
- Read `debug=1` and `debug=2` outputs fluently, including state strings.
- Group thousands of stacks into a handful of buckets and prioritise.
- Recognise runtime-internal goroutines and ignore them correctly.
- Use `goleak` options (`IgnoreTopFunction`, `IgnoreCurrent`, `Cleanup`) idiomatically.
- Label goroutines so you can filter profiles by subsystem.
- Diff two profiles taken minutes apart to find the leaking signature.
- Drive `go tool pprof` in interactive mode and read a `traces` and `peek` command output.
- Inspect a running process with `gops` without restarting it.
- Capture a `runtime/trace` and see goroutine creation/destruction events in the browser viewer.

This file does not yet cover production monitoring (Prometheus, OpenTelemetry) — that is the senior file. It also does not cover scheduler-level internals — that is the professional file. Cross-reference [01-lifecycle](../01-lifecycle/) for goroutine state names, [03-preventing-leaks](../03-preventing-leaks/) for fixes, and [04-pprof-tools](../04-pprof-tools/) for the broader pprof tool family.

---

## The Full `pprof goroutine` Workflow

A realistic incident:

> "Memory has been climbing 50 MB per hour since yesterday's deploy. Process is at 8 GB and not stabilising."

Step by step:

1. **Confirm it is a goroutine leak.** Compare `go_goroutines` (the metric) with `go_memstats_alloc_bytes`. If both are rising in lockstep, suspect goroutines. If goroutines are flat and heap is climbing, it is a heap leak — different investigation.
2. **Take a baseline goroutine profile.** From a healthy replica or a cold start:
   ```
   curl -s http://baseline-host:6060/debug/pprof/goroutine?debug=1 > base.txt
   ```
3. **Take a current profile.** From the leaking pod:
   ```
   curl -s http://leaky-host:6060/debug/pprof/goroutine?debug=1 > now.txt
   ```
4. **Diff and sort by count.** Stacks that appear far more often in `now.txt` than in `base.txt` are your suspects.
5. **Open `now.txt` and find the top stack by count.** The first line of every block has a number — that is how many goroutines share that stack.
6. **Read the topmost function.** That is where they are parked. The `created by` line says who spawned them.
7. **Inspect the code at that file:line.** Look for the missing `context.Done`, the unclosed channel, the lock that no one releases.
8. **Patch and verify.** After deploy, re-run step 3. The count for that stack should drop to a small constant.

Total time for an experienced engineer: 10–20 minutes. The longest step is usually step 7 (understanding why the code is wrong).

---

## Reading `debug=1` vs `debug=2`

### `debug=1` — counts and unique stacks

```
goroutine profile: total 5187
5102 @ 0x103d8b6 0x103d7d1 0x1043f0f 0x1067e2a 0x1046521
#       0x1067e29       main.(*pollster).poll+0x29      /src/poll.go:42
#       0x1046520       main.startPollster.func1+0x40   /src/poll.go:18

12 @ 0x103d8b6 0x103d7d1 0x1043f0f 0x10a31a8
#       0x10a31a7       net/http.(*conn).serve+0x4a7    /usr/go/src/net/http/server.go:1990
...
```

Each block is one *unique* stack trace. The leading number is the count of goroutines sharing it. `5102` of `5187` are at `poll.go:42`. That is your leak. The other 85 are spread across legitimate work.

### `debug=2` — every goroutine printed individually

```
goroutine 1 [chan receive]:
main.main()
        /src/main.go:25 +0x44

goroutine 2 [force gc (idle), 18 minutes]:
runtime.gopark(...)
runtime.forcegchelper()
        /usr/go/src/runtime/proc.go:305 +0xb0
created by runtime.init.6
        /usr/go/src/runtime/proc.go:293 +0x25
```

`debug=2` is verbose but shows you:

- The state string in brackets: `chan receive`, `chan send`, `select`, `IO wait`, `sync.Mutex.Lock`, `sleep`, `force gc (idle)`.
- The duration since the goroutine entered that state. `[chan receive, 18 minutes]` is suspicious; `[chan receive]` (no duration) means under a minute.
- The argument values at each frame — the runtime captures them when the goroutine was parked.

Rule of thumb: start with `debug=1` for triage, switch to `debug=2` once you know which stack to investigate.

---

## Grouping Stacks by Frame

When `debug=1` shows millions of unique stacks (rare, but possible with deep recursion or closures spawned in loops), you need to group at a coarser granularity. The principle is "the closest function frame to the parked state is the root cause."

Approach in pure shell:

```bash
curl -s host:6060/debug/pprof/goroutine?debug=1 \
  | awk '
    /^[0-9]+ @/ { count=$1; getline; print count, $1 }
  ' \
  | sort -rn | head
```

This prints, for every unique stack, the count and the topmost function. Sorted by count, the leak stands out.

Approach in Go with the protobuf format:

```go
import (
    "github.com/google/pprof/profile"
)

func loadTopFunctions(path string) (map[string]int64, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close()
    p, err := profile.Parse(f)
    if err != nil {
        return nil, err
    }
    counts := make(map[string]int64)
    for _, s := range p.Sample {
        if len(s.Location) == 0 {
            continue
        }
        top := s.Location[0]
        if len(top.Line) == 0 {
            continue
        }
        fn := top.Line[0].Function.Name
        counts[fn] += s.Value[0]
    }
    return counts, nil
}
```

Now you have a `map[function]count` you can sort, log, or expose as a metric.

---

## False Positives — Runtime-Owned Goroutines

The Go runtime spawns goroutines that look like leaks but are not. Treat them as wallpaper:

| Top frame | Role | Permanent? |
|-----------|------|------------|
| `runtime.gopark` from `runtime.forcegchelper` | Force-GC trigger | Yes |
| `runtime.gopark` from `runtime.bgscavenge` | Memory scavenger | Yes |
| `runtime.gopark` from `runtime.bgsweep` | GC sweeper | Yes |
| `runtime.gopark` from `runtime.runfinq` | Finalisers runner | Yes |
| `runtime.notetsleep` from `runtime.sysmon` | System monitor | Yes (but on its own OS thread, often not counted) |
| `internal/poll.runtime_pollWait` from `net.(*netFD).Read` | Network read | Only while connection is open |
| `runtime.gopark` from `time.Sleep` | A real sleep | Yes for the duration |
| `runtime.gcBgMarkWorker` | GC mark worker | Comes and goes per GC cycle |

`goleak` already filters most of these. If you write your own detector, you must filter them yourself, or every test will fail.

A useful helper:

```go
func isRuntime(stack string) bool {
    for _, prefix := range []string{
        "runtime.forcegchelper",
        "runtime.bgscavenge",
        "runtime.bgsweep",
        "runtime.runfinq",
        "runtime.gcBgMarkWorker",
        "runtime.sysmon",
    } {
        if strings.Contains(stack, prefix) {
            return true
        }
    }
    return false
}
```

Be careful: filtering too aggressively hides real leaks. The above list is "things I have seen and verified are runtime"; a leak with a `runtime.gopark` topmost frame and a *non-runtime* `created by` line is still a leak.

---

## `goleak` in Depth

### `VerifyTestMain` with options

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m,
        goleak.IgnoreTopFunction("github.com/golang/glog.(*loggingT).flushDaemon"),
        goleak.IgnoreTopFunction("go.opencensus.io/stats/view.(*worker).start"),
        goleak.IgnoreCurrent(),
    )
}
```

- `IgnoreTopFunction("pkg.Fn")` — drop goroutines whose topmost frame is `pkg.Fn`. Useful for known background workers in dependencies you cannot modify.
- `IgnoreCurrent()` — snapshot the goroutines alive at this call; treat them as the baseline for "no leaks." Useful when `TestMain` itself spawns long-lived workers before `m.Run`.
- `IgnoreAnyFunction("pkg.Fn")` — drop goroutines whose stack *anywhere* mentions `pkg.Fn`. More aggressive than `IgnoreTopFunction`.
- `Cleanup(cleanup func(error))` — run a callback when a leak is detected, before failing.

### `VerifyNone` inside a single test

```go
func TestWorkerShutsDown(t *testing.T) {
    defer goleak.VerifyNone(t,
        goleak.IgnoreTopFunction("internal/poll.runtime_pollWait"),
    )
    w := startWorker()
    w.Stop()
}
```

The `defer` ensures `VerifyNone` runs after all of the test body, including any `t.Cleanup` callbacks the test registered. If the worker did not actually stop, this test fails with the offender's stack printed.

### Custom `Option` for tests with parallel subtests

```go
func TestParallel(t *testing.T) {
    snapshot := goleak.IgnoreCurrent()
    t.Run("a", func(t *testing.T) {
        t.Parallel()
        defer goleak.VerifyNone(t, snapshot)
        runScenarioA(t)
    })
    t.Run("b", func(t *testing.T) {
        t.Parallel()
        defer goleak.VerifyNone(t, snapshot)
        runScenarioB(t)
    })
}
```

`IgnoreCurrent` is captured once at the parent's entry; each child checks against it. Without this, parallel subtests see each other's goroutines and report false leaks.

### When `goleak` is not enough

If a test legitimately needs to spawn a long-running goroutine that lives past the test (rare but real — e.g. a global initialiser), `goleak` will fail. Options:

1. Move the legitimate goroutine into `TestMain` and call `goleak.IgnoreCurrent()` after starting it.
2. Use `IgnoreTopFunction` with the exact function name.
3. Restructure the code so the goroutine has a `Close()` method and the test can call it.

Option 3 is almost always the right answer. The other two are escape hatches.

---

## Filtering with `pprof.SetGoroutineLabels`

You can attach key-value labels to a goroutine. Subsequent goroutine profiles include those labels, and `go tool pprof` lets you filter on them.

```go
import (
    "context"
    "runtime/pprof"
)

func handleRequest(ctx context.Context, req *Request) {
    labels := pprof.Labels(
        "subsystem", "billing",
        "tenant", req.Tenant,
    )
    pprof.Do(ctx, labels, func(ctx context.Context) {
        processRequest(ctx, req)
    })
}
```

`pprof.Do` sets the labels for the *current* goroutine and any goroutines it spawns inside the callback. After the callback returns, labels are restored.

To filter:

```
go tool pprof -tagfocus='subsystem=billing' http://host:6060/debug/pprof/goroutine
(pprof) top
```

Only billing goroutines appear. The CPU profile and block profile honour the same labels.

When to use it: you have a server that handles many subsystems, and a leak is concentrated in one. Labels let you find the subsystem in seconds without parsing every stack.

---

## Programmatic Profile Capture

Hard-coded triggers:

```go
// On SIGUSR1, dump goroutine profile to /tmp/goroutines-<unix>.txt
func install() {
    c := make(chan os.Signal, 1)
    signal.Notify(c, syscall.SIGUSR1)
    go func() {
        for range c {
            path := fmt.Sprintf("/tmp/goroutines-%d.txt", time.Now().Unix())
            f, err := os.Create(path)
            if err != nil {
                log.Println(err)
                continue
            }
            _ = pprof.Lookup("goroutine").WriteTo(f, 2)
            f.Close()
            log.Println("wrote", path)
        }
    }()
}
```

Now `kill -USR1 <pid>` writes a timestamped stack dump. Two snapshots five minutes apart give you a diff.

Threshold-based:

```go
func watchLeaks(ctx context.Context, threshold int) {
    t := time.NewTicker(30 * time.Second)
    defer t.Stop()
    seen := 0
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            n := runtime.NumGoroutine()
            if n > threshold && n > seen+100 {
                seen = n
                f, _ := os.Create(fmt.Sprintf("/var/log/goroutines-%d.txt", time.Now().Unix()))
                _ = pprof.Lookup("goroutine").WriteTo(f, 1)
                f.Close()
                log.Printf("leak watch: %d goroutines, dumped", n)
            }
        }
    }
}
```

Self-instrumenting: when the count crosses a threshold and keeps climbing, automatically write a profile to disk. The on-call engineer wakes up with the evidence already collected.

---

## Diffing Two Profiles

The protobuf format works with `go tool pprof -base`:

```
curl -s http://host:6060/debug/pprof/goroutine > t0.pb.gz
sleep 300
curl -s http://host:6060/debug/pprof/goroutine > t1.pb.gz
go tool pprof -base t0.pb.gz t1.pb.gz
(pprof) top
```

The `top` output shows only the *delta*: goroutines that appeared between t0 and t1. The top entry is your leak signature.

Text-format diffing for `debug=1` is rougher but works:

```bash
diff <(awk '/^[0-9]+ @/ {n=$1; getline; print n, $0}' base.txt | sort) \
     <(awk '/^[0-9]+ @/ {n=$1; getline; print n, $0}' now.txt  | sort)
```

You get added lines (in `now.txt`) and counts that changed. New stacks are by definition the leak.

---

## `go tool pprof` Interactive Session

```
$ go tool pprof http://host:6060/debug/pprof/goroutine
Fetching profile over HTTP from http://host:6060/debug/pprof/goroutine
Saved profile in /home/u/pprof/pprof.goroutine.001.pb.gz
Type: goroutine
(pprof) top
Showing nodes accounting for 5187, 100% of 5187 total
      flat  flat%   sum%        cum   cum%
      5102 98.36% 98.36%       5102 98.36%  main.(*pollster).poll
         12  0.23% 98.59%         12  0.23%  net/http.(*conn).serve
          ...
```

Useful commands inside the prompt:

- `top` — top N by goroutine count.
- `top --cum` — sort by cumulative count (includes descendants).
- `list main.poll` — show source code annotated with sample counts.
- `peek main.poll` — show callers and callees of `main.poll`.
- `traces` — print every individual stack with its count.
- `web` — render an SVG (needs graphviz installed).
- `tree` — text-form call tree, useful in remote shells.

The `list` command is the magic moment: it shows you the function source with the line where each goroutine is parked underlined by the sample count.

---

## `gops` Walk-through

Install once:

```
go install github.com/google/gops@latest
```

Inside your program (only if you want the richer features):

```go
import "github.com/google/gops/agent"

func main() {
    if err := agent.Listen(agent.Options{}); err != nil {
        log.Fatal(err)
    }
    // ... your program ...
}
```

Now from another terminal:

```
$ gops
12345 my-server  go1.22.0  /home/u/bin/my-server

$ gops stack 12345
... full goroutine stack dump ...

$ gops stats 12345
goroutines: 5187
OS threads: 32
GOMAXPROCS: 8
num CPU:    8

$ gops memstats 12345
heap alloc:        4.8 GB
total alloc:       21.6 GB
GC cycles:         144
...
```

Useful when you cannot or will not expose pprof over HTTP — the gops agent uses a local socket, not the network. Great for daemons and CLIs.

---

## `runtime/trace` for Lifetime Events

A goroutine *trace* captures every goroutine creation, blocking event, unblocking event, syscall, and GC pause. The viewer is a browser timeline.

Capture a 5-second trace:

```go
import "runtime/trace"

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    if err := trace.Start(f); err != nil {
        log.Fatal(err)
    }
    defer trace.Stop()

    // ... do your work ...
}
```

Or via HTTP if `net/http/pprof` is registered:

```
curl -o trace.out http://host:6060/debug/pprof/trace?seconds=5
```

View:

```
go tool trace trace.out
```

This opens a browser. The "Goroutine analysis" page lists each goroutine's lifetime. The "Goroutines" timeline shows creation and destruction events. A leak shows up as a goroutine bar that begins but never ends within the trace window.

For long-running leaks you may not see the end event (because there is no end), but you will see the creation, the function that owns it, and the user-visible region tag if you used `trace.WithRegion`.

---

## Common Anti-Patterns

- **Catching leaks only in production.** By then it has already cost you outages. Move detection left: tests, CI, staging.
- **Trusting a single `NumGoroutine` reading.** Always take two with a delay; trends matter, not snapshots.
- **Ignoring `goleak` failures with `IgnoreTopFunction`.** Every ignore is a future bug.
- **Setting the same label on every goroutine.** Labels lose value when they have no cardinality. Use them on a hot path or a tenant boundary.
- **Triggering `pprof.WriteTo` on every request.** A profile dump on a 100k QPS endpoint will starve the runtime. Trigger on signal or on threshold, not on every call.
- **Diffing `debug=2` text by `diff` directly.** Stacks have varying argument values and pointers; `diff` produces garbage. Always diff `debug=1` (counts + unique stacks) or the protobuf form via `-base`.
- **Leaving `runtime/trace` running for minutes.** Trace files grow at megabytes per second. Keep windows short (5–10 seconds).

---

## Self-Assessment

- [ ] I can fetch a goroutine profile from a running process and tell which stack has the most goroutines.
- [ ] I know the difference between `debug=1` and `debug=2` and when to use each.
- [ ] I can list at least five runtime-internal goroutines I should not flag as leaks.
- [ ] I have written a `TestMain` with `goleak.VerifyTestMain` and at least one `IgnoreTopFunction`.
- [ ] I can use `pprof.Do` to label a request's goroutines and filter a profile by tag.
- [ ] I can capture a goroutine profile on `SIGUSR1` from my own code.
- [ ] I have used `go tool pprof -base` to diff two profiles.
- [ ] I can drive `go tool pprof` interactively (`top`, `list`, `peek`).
- [ ] I have installed `gops` and used it to inspect a running process.
- [ ] I can capture a `runtime/trace` and find a goroutine that never ends.

---

## Summary

Middle-level leak detection is procedural. You learn the order of operations: confirm the symptom is goroutine-shaped, snapshot a baseline, snapshot the current state, diff, identify the highest-count stack, walk the code at that file:line, and patch. The tooling around this workflow — `pprof goroutine?debug=1` for triage, `pprof goroutine?debug=2` for stack reading, `pprof.SetGoroutineLabels` for filtering, `goleak` for tests, `gops` for live inspection, `runtime/trace` for lifetime events — covers everything from a unit test to a 2 AM incident. The senior file ([senior.md](senior.md)) builds on this with production monitoring (Prometheus, OpenTelemetry, alerting); the professional file dives into the runtime internals that make these tools tick.
