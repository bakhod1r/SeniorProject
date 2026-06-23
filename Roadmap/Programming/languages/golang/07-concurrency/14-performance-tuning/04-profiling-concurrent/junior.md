# Profiling Concurrent Go Code — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use--feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
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
29. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

When a single goroutine runs slowly the CPU profile tells the whole story: which function burns cycles, which loop dominates, which allocation costs the most. The moment you add a second goroutine the picture changes. Some of your time is not spent computing — it is spent **waiting**. Waiting for a lock another goroutine holds. Waiting for a channel that no one has sent on yet. Waiting for the scheduler to give you a P. None of that waiting shows up in a CPU profile, because CPU profiling samples on-CPU work only.

This page introduces the three profiles that exist precisely to measure waiting:

- **Goroutine profile** — a snapshot of every live goroutine and where it is parked.
- **Mutex profile** — time goroutines spent waiting for `sync.Mutex` and `sync.RWMutex`.
- **Block profile** — time goroutines spent blocked on any synchronisation primitive: channels, `sync.WaitGroup`, `time.Sleep`, condition variables.

Plus the most powerful concurrency diagnostic Go ships: `runtime/trace`. A trace is not a sampled profile — it records every scheduler event. You see the exact moment each goroutine became runnable, started running, blocked, unblocked, exited.

You already know `go tool pprof` from the previous page. Here you will learn the small additional vocabulary needed to use it on concurrent code: how to enable the off-by-default profiles, how to read their output, when to reach for `runtime/trace` instead, and what a "hot synchronisation point" looks like in a flame graph.

By the end of this file you will be able to find the bottleneck in a contended program in under ten minutes.

---

## Prerequisites

Before this page, you should be comfortable with:

- The pprof basics from [`07-goroutine-lifecycle-leaks/04-pprof-tools`](../../07-goroutine-lifecycle-leaks/04-pprof-tools/) — exposing `/debug/pprof`, running `go tool pprof`, reading `top` and `list`.
- Goroutines and the G-M-P model from [`01-goroutines`](../../01-goroutines/) and [`10-scheduler-deep-dive`](../../10-scheduler-deep-dive/).
- Mutexes from [`02-sync-package/01-mutex-rwmutex`](../../02-sync-package/01-mutex-rwmutex/).
- Channels from [`03-channels`](../../03-channels/).

If any of those are shaky, take a detour. The terminology below assumes them.

---

## Glossary

- **Sample.** A single observation the profiler records. A CPU profile sample is a stack at some moment in time. A mutex profile sample is a contention event with the stack of the waiter.
- **Sampling rate / fraction.** How often the runtime records an event. For mutex/block profiles this is set with `SetMutexProfileFraction` and `SetBlockProfileRate`.
- **Contention.** A goroutine had to wait because another already held the lock or because the channel was full/empty.
- **On-CPU time.** Cycles the goroutine actually ran.
- **Off-CPU time.** Time the goroutine was alive but not running. The block and mutex profiles cover most of off-CPU time for concurrency.
- **Trace event.** A single entry in `runtime/trace`: goroutine create, start, block, unblock, end, GC start, etc.
- **Region / task.** User-defined spans inside a trace (`trace.WithRegion`, `trace.NewTask`).
- **Label.** A key/value pair attached to a goroutine via `pprof.Do` or `pprof.SetGoroutineLabels`. Visible in profiles.
- **Flat / cum.** Flat is samples attributed to the function itself. Cum is samples in this function plus everything it called.
- **Diff profile.** A profile minus another profile, produced with `-base`.

---

## Core Concepts

### The three concurrency profiles

Every pprof endpoint you already know — `heap`, `allocs`, `threadcreate`, `profile` (CPU) — answers "where is work happening?" The three profiles below answer the inverse: **"where is work NOT happening, and why?"**

| Profile | Endpoint | Off by default? | What it samples |
|---------|----------|-----------------|-----------------|
| `goroutine` | `/debug/pprof/goroutine` | no | every live goroutine, with its current stack |
| `mutex` | `/debug/pprof/mutex` | yes | contended `Mutex.Lock` / `RWMutex.Lock` |
| `block` | `/debug/pprof/block` | yes | every blocking sync event (channels, sleeps, condition variables, mutex, WaitGroup) |

The first is always available because every running Go program already has its goroutine list. The other two require you to opt in — they cost CPU and memory while enabled.

### Enabling the off-by-default profiles

```go
import (
    "runtime"
    "time"
)

func enableContentionProfiles() {
    // Sample about 1 in 100 contended mutex events.
    runtime.SetMutexProfileFraction(100)
    // Record blocking events that lasted at least 1ms.
    runtime.SetBlockProfileRate(int(time.Millisecond))
}
```

Call this once at startup. Both rates can be changed at runtime — set to `0` to disable.

### What CPU profiles cannot tell you

A CPU profile only samples while the goroutine is on-CPU. If your program spends 90% of its time waiting on a mutex, the CPU profile will look almost empty. You might see a few percent in `runtime.gopark` or `runtime.semacquire1`. That is the runtime tagging "this goroutine is going to sleep." It is not the same as showing you the lock.

That's why concurrency debugging needs different profiles. CPU profile says "wall-clock time is missing from this stack." Block/mutex profiles fill in the missing time.

### The goroutine profile

Available always. Three modes:

```bash
# binary format, for go tool pprof
curl -o g.prof http://localhost:6060/debug/pprof/goroutine

# grouped text format, one line per unique stack
curl 'http://localhost:6060/debug/pprof/goroutine?debug=1'

# every goroutine printed individually, with state
curl 'http://localhost:6060/debug/pprof/goroutine?debug=2'
```

Use `debug=1` to answer "what are my goroutines doing right now, and how many of each?" Use `debug=2` to see them all with their wait reason — useful when you suspect a leak or hang. Use the binary form when you want to load the snapshot in `go tool pprof`.

### `runtime/trace` — the heavyweight tool

The trace records events. Run it for 1–5 seconds; that already produces hundreds of MB on a busy service. Capture only when you need it:

```bash
curl -o trace.out http://localhost:6060/debug/pprof/trace?seconds=3
go tool trace trace.out
```

A browser opens. You see a timeline of goroutines, a goroutine analysis view, a synchronisation blocking profile, a scheduler latency profile, and any user-defined tasks/regions you instrumented.

When to use trace: questions about *timing* and *ordering*. "Why does this request sometimes take 200ms when usually it takes 5ms?" "Are my workers actually parallel?" "How long are goroutines runnable before getting scheduled?"

---

## Real-World Analogies

### A busy restaurant kitchen

A CPU profile is a stopwatch on each cook. It tells you who chopped vegetables the longest. The **mutex profile** is a clipboard noting every time two cooks reached for the same knife. The **block profile** is the time anyone spent waiting at the pass for a dish to be ready. The **goroutine profile** is a snapshot of every cook in the kitchen at one moment — chopping, waiting, fetching from the fridge, on a smoke break. The **trace** is a security camera recording — you can rewind and watch what happened second by second.

If service is slow, the stopwatch will not help you. The clipboard will: the same knife getting fought over is your hot lock. The waiting-at-the-pass time tells you where the kitchen is single-threaded. The snapshot tells you whether half the staff is idle. The camera tells you the exact order in which things went wrong on the bad night.

### A highway

CPU profile = cars moving. Mutex profile = cars piled up at a single toll booth. Block profile = cars stopped because the next exit is jammed. Goroutine profile = aerial photograph. Trace = traffic camera footage.

You cannot fix a traffic jam by measuring how fast individual cars are driving.

---

## Mental Models

### "On-CPU vs off-CPU"

Every goroutine at any moment is either:

- **On-CPU**: running user code. Visible in CPU profile.
- **Off-CPU runnable**: ready, waiting for a P. Visible in trace scheduler latency.
- **Off-CPU blocked**: in `gopark`, waiting for an event. Visible in goroutine/block/mutex profiles.

Total time = on-CPU + runnable + blocked. If your latency is high and CPU usage is low, you are off-CPU. The concurrency profiles measure where.

### "Profile == sample, Trace == log"

Profiles are statistical: the runtime records a fraction of events. Cheap, but only approximate. Traces are exhaustive: every event, no sampling. Expensive, but precise.

For "where is my service spending time on aggregate?" use profiles. For "explain this one slow request" use trace.

### "Mutex profile measures the holder, not the waiter"

Read carefully. The mutex profile records contention; the cost is attributed to the **stack that released the lock** (or sometimes the stack of the waiter — see middle.md for the gory detail). Either way, the value is "wait time caused by this lock." If `cache.go:42` shows 30s of mutex time, it means goroutines collectively waited 30 seconds on the lock used at that line.

### "Block profile counts every waiter"

Three goroutines wait one second each on the same channel send: the block profile shows 3 seconds at that send site, not 1.

---

## Pros & Cons

### Pros

- Built into the standard library — nothing to install.
- Three different lenses on concurrency: snapshot, contention, blocking.
- `runtime/trace` is unique to Go; no other mainstream runtime ships an equivalent for free.
- Compatible with the existing pprof toolchain — `top`, `list`, `web`, flame graphs.
- Production-safe at sensible sampling rates.

### Cons

- Mutex and block profiles are off by default. Half the engineers in any codebase don't know they exist.
- Mutex profile only sees `sync.Mutex` / `RWMutex` — not channels, not `sync.Once`, not internal runtime locks (unless you build with `GOEXPERIMENT=staticlockranking` and decode them yourself).
- Block profile semantics are subtle — wait time is summed across goroutines, which can confuse first-time readers.
- `runtime/trace` output is large. A 5-second trace on a busy server can be 200 MB.
- The trace viewer (`go tool trace`) is browser-based and historically slow on large files.

---

## Use Cases

You should reach for these profiles when:

- **CPU is low but latency is high.** Off-CPU is dominating. Start with block profile.
- **A single mutex is suspected hot.** Mutex profile, with the lock guarded line clearly visible.
- **Goroutine count is climbing.** Goroutine profile, `debug=2`, search for the wait reason.
- **A request occasionally takes 50× as long.** Trace, with user regions instrumenting the slow path.
- **You added parallelism and got no speedup.** Trace or block profile to find serialisation.
- **`sync.RWMutex` reads are taking too long.** Mutex profile — `RLock` waits show up too.
- **You suspect a goroutine leak.** Goroutine profile + diff.
- **You're tuning a worker pool size.** Trace to see whether workers are CPU-bound or blocked.

---

## Code Examples

### Example 1: enable all three concurrency profiles

```go
package main

import (
    "log"
    "net/http"
    _ "net/http/pprof"
    "runtime"
    "time"
)

func main() {
    // Enable contention profiles. Do this once, at startup.
    runtime.SetMutexProfileFraction(100)              // 1 in 100 contentions
    runtime.SetBlockProfileRate(int(time.Millisecond)) // events >= 1ms

    go func() {
        log.Println(http.ListenAndServe("127.0.0.1:6060", nil))
    }()

    runWorkload()
}

func runWorkload() {
    // ... your service ...
    select {}
}
```

### Example 2: a deliberately contended program

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    // Pretend the critical section is expensive.
    time.Sleep(time.Microsecond * 100)
    c.n++
}

func main() {
    var c Counter
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 1000; j++ {
                c.Inc()
            }
        }()
    }
    wg.Wait()
    fmt.Println(c.n)
}
```

Run with `-mutexprofile`:

```bash
go test -run=^$ -bench=. -mutexprofile mu.prof
# or for a main, expose pprof and curl /debug/pprof/mutex
```

`go tool pprof mu.prof`, then `top`. You will see `main.(*Counter).Inc` at the top with most of the contention.

### Example 3: a deliberately blocked program

```go
package main

import (
    "fmt"
    "sync"
)

func producer(out chan<- int, wg *sync.WaitGroup) {
    defer wg.Done()
    for i := 0; i < 10; i++ {
        out <- i // blocks because consumer is slow
    }
    close(out)
}

func consumer(in <-chan int, wg *sync.WaitGroup) {
    defer wg.Done()
    for v := range in {
        // slow processing
        for i := 0; i < 1_000_000; i++ {
            _ = i * v
        }
    }
}

func main() {
    ch := make(chan int) // unbuffered
    var wg sync.WaitGroup
    wg.Add(2)
    go producer(ch, &wg)
    go consumer(ch, &wg)
    wg.Wait()
    fmt.Println("done")
}
```

Enable the block profile (`SetBlockProfileRate(1)` for example purposes only), run, then take the block profile. The producer line `out <- i` dominates — that's where time is spent waiting.

### Example 4: take a goroutine snapshot programmatically

```go
package main

import (
    "os"
    "runtime/pprof"
)

func snapshot(path string) error {
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer f.Close()
    return pprof.Lookup("goroutine").WriteTo(f, 0)
}
```

`pprof.Lookup("goroutine").WriteTo(f, 0)` writes binary; `, 1)` writes grouped text; `, 2)` writes every goroutine.

### Example 5: capture a short trace

```go
package main

import (
    "log"
    "os"
    "runtime/trace"
    "time"
)

func main() {
    f, err := os.Create("trace.out")
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()

    if err := trace.Start(f); err != nil {
        log.Fatal(err)
    }
    defer trace.Stop()

    work(2 * time.Second)
}

func work(d time.Duration) {
    deadline := time.Now().Add(d)
    for time.Now().Before(deadline) {
        // ... do something ...
    }
}
```

After running: `go tool trace trace.out`.

---

## Coding Patterns

### Pattern: lazy profile enabling via env var

```go
import (
    "os"
    "runtime"
    "strconv"
    "time"
)

func init() {
    if v, err := strconv.Atoi(os.Getenv("GO_MUTEX_PROFILE_FRACTION")); err == nil && v > 0 {
        runtime.SetMutexProfileFraction(v)
    }
    if v, err := strconv.Atoi(os.Getenv("GO_BLOCK_PROFILE_RATE_NS")); err == nil && v > 0 {
        runtime.SetBlockProfileRate(v)
    }
    _ = time.Millisecond // keep import in some setups
}
```

Default to off, flip on in staging or for a tagged build.

### Pattern: pair every profile capture with a goroutine snapshot

When you grab a CPU profile or heap profile during an incident, also grab the goroutine snapshot. It costs nothing and gives you the "who was waiting" picture that the CPU profile lacks.

```bash
ts=$(date +%Y%m%dT%H%M%S)
curl -so cpu-$ts.prof   "http://localhost:6060/debug/pprof/profile?seconds=15"
curl -so heap-$ts.prof  "http://localhost:6060/debug/pprof/heap?gc=1"
curl -so g-$ts.prof     "http://localhost:6060/debug/pprof/goroutine"
curl -so mutex-$ts.prof "http://localhost:6060/debug/pprof/mutex"
curl -so block-$ts.prof "http://localhost:6060/debug/pprof/block"
```

### Pattern: scope a trace to a known interval

```go
trace.Start(f)
doInterestingThing()
trace.Stop()
```

A 100 ms targeted trace is much easier to analyse than a 5-second open trace.

---

## Clean Code

- Always document why a mutex/block profile is enabled. The next reader should not have to guess what fraction is sensible.
- Keep `pprof.Do` blocks small and tagged with stable label keys (`worker`, `tenant`, `endpoint`). Don't tag with high-cardinality values like request IDs — labels are a small set, not a span store.
- Pair `trace.Start` / `trace.Stop` with `defer`. Forgetting to stop a trace wastes disk and slows the program.
- Treat profile capture endpoints like any other operational endpoint: bind to localhost, document them, hide them from external traffic.

---

## Product Use / Feature

In a real product, the typical flow looks like this:

1. **Service runs continuously** with pprof on a private port and mutex/block profiles enabled at low fractions.
2. **An on-call gets paged** — latency p99 spiked.
3. **They open the runbook**: "concurrent-latency-spike."
4. **The runbook says**: capture `goroutine?debug=1` first. Then `block` and `mutex` for 30 s. Then a 5 s trace.
5. **They diff** the captured `block` profile against last hour's baseline (which is in S3 because of continuous profiling).
6. **The diff** points at the hot site. They commit a fix, deploy, watch the diff shrink.

This page teaches you steps 4–6. Continuous profiling and runbooks come at senior level.

---

## Error Handling

Profiling tools rarely fail visibly. When they do, the modes are:

- `pprof.Lookup(name)` returns `nil` for an unknown name. Check it.
- `trace.Start` returns an error if a trace is already running. Always check.
- HTTP profile fetches can time out. Use a sensible `seconds=` and a longer client timeout.
- A pprof handler will return 200 with a malformed body if the profile is corrupt. `go tool pprof` will refuse to parse it. Re-capture.

```go
p := pprof.Lookup("goroutine")
if p == nil {
    log.Println("goroutine profile not registered (impossible in std builds)")
    return
}
if err := p.WriteTo(f, 0); err != nil {
    log.Printf("write profile: %v", err)
}
```

---

## Security Considerations

- **Never** expose `/debug/pprof` on a public interface. Bind to `127.0.0.1` or behind authenticated proxy.
- The goroutine profile in `debug=2` mode includes stack frames. Stack frames sometimes contain argument values. Treat the dump as **secret-equivalent**.
- `runtime/trace` output is even more revealing — it shows the structure of your code under load.
- Storing profiles in S3 is fine, but encrypt at rest and tag with TTL. Old goroutine dumps from a year-old binary are still useful to attackers.

---

## Performance Tips

- `SetMutexProfileFraction(100)` is a safe default for production. `1` is for short forensic windows only.
- `SetBlockProfileRate(int(time.Millisecond))` records events of at least 1 ms. Drop noise below.
- A 5-second trace is enough for most timing questions. Longer traces blow up file size linearly.
- For benchmarks, prefer `go test -mutexprofile mu.prof -blockprofile bl.prof` over enabling at runtime — `go test` resets the fractions for you.
- Use `?gc=1` on heap, not block/mutex — `gc=1` only applies to heap.

---

## Best Practices

- **Enable mutex/block profiles in production at modest rates.** The cost is a fraction of a percent; the diagnostic value when something goes wrong is enormous.
- **Snapshot routinely**, not only during incidents. Hourly goroutine snapshots cost basically nothing and give you a baseline.
- **Diff, don't stare.** Two profiles compared with `-base` reveal patterns no single profile can.
- **Pair a profile with a trace** when latency is in question. The profile answers "where," the trace answers "when."
- **Label goroutines** by role (worker pool, request handler, GC goroutine) so profiles slice cleanly. (Senior topic, but start the habit.)
- **Document the rates** you use, in code or in a runbook.

---

## Edge Cases & Pitfalls

### `SetMutexProfileFraction(0)` then back to N

Some events recorded between the disable and re-enable are dropped. Don't oscillate the rate.

### Block profile vs mutex profile overlap

A blocked `Lock` shows up in both. The block profile measures wait time; the mutex profile measures contention. For lock-specific debugging, prefer the mutex profile.

### `time.Sleep` in the block profile

A sleep is a blocking event. It shows up. This is occasionally useful ("why did this RPC retry take so long?") but more often noise. Filter with `-ignore=time.Sleep`.

### Reading mutex/block profile units

The "samples" axis is **nanoseconds of contention**, not number of contentions. `2.1s` of mutex profile means goroutines collectively waited 2.1 seconds.

### Trace shows fewer goroutines than the program runs

`go tool trace` filters very-short-lived goroutines from the timeline view. They are still in the data. Use "Goroutine analysis" for full counts.

### Symbol resolution in pprof for stripped binaries

A profile is portable, but `go tool pprof` needs the binary to resolve symbols. Either profile against a debug binary, or pass `-symbolize=force`. Without symbols you get raw addresses.

---

## Common Mistakes

- **Forgetting to enable mutex/block profiles.** The endpoints exist; you query them; they return empty data. Confusing.
- **Setting `SetBlockProfileRate(1)` in production.** Records every blocking event. Visible CPU cost.
- **Comparing on-CPU and off-CPU profiles directly.** They have different units; the numbers do not add up.
- **Profiling a benchmark without `-run=^$`.** Tests run too, polluting the data.
- **Using `runtime/trace` for "where does my CPU go."** Wrong tool. Use the CPU profile.
- **Treating goroutine profiles as accurate counts in real time.** Goroutines start and finish constantly; the count fluctuates. Take two snapshots and diff.

---

## Common Misconceptions

- **"Mutex profile is the same as block profile."** No. Block is broader. Mutex is specific to `sync.Mutex` / `RWMutex`.
- **"Channels show up in the mutex profile."** No. Channel sends/receives show up in the block profile.
- **"Trace = profile, just more data."** No. Trace is exhaustive event recording; profile is statistical sampling.
- **"A goroutine profile is real-time."** No. It's a snapshot taken at a single moment.
- **"Enabling mutex profile slows everything by 5%."** No. At fraction 100 the overhead is typically under 1%.

---

## Tricky Points

- **Mutex profile reports contention at the Unlock site or at the Lock site depending on Go version.** Modern versions (since Go 1.18+) attribute consistently. Old versions could surprise you.
- **`sync.RWMutex.RLock` contention** shows up too — useful for "my readers are starving on a writer."
- **`pprof` can't see `runtime.lock` (internal Go locks).** A trace can sometimes reveal them ("STW" markers) but `mutex` profile cannot.
- **A `select` with multiple cases shows up in the block profile at the `select` line**, not at any specific case.

---

## Test

Write a small program where two goroutines fight for the same mutex. Enable the mutex profile. Capture it. Confirm the contended line shows at the top of `top -cum`. Then add `sync.RWMutex` and a reader/writer asymmetry; confirm the writer's blocked time dominates.

Repeat with a buffered channel of capacity 1 and slow consumer. Enable the block profile. Confirm the send site dominates.

Capture a 1-second trace. Open `go tool trace`. Find your two goroutines in the timeline. Identify visually where they were blocked.

---

## Tricky Questions

1. The CPU profile shows my service is using 8% CPU but p99 is 2 seconds. Where is the time going?
2. I see `runtime.gopark` at the top of a CPU profile. What does that mean?
3. The mutex profile reports 50 seconds of contention in a 30-second window. Bug?
4. Two services with similar load: A enables mutex profile at fraction 1, B at fraction 1000. Why is A's p99 higher?
5. I added a trace.Start in `main` but `go tool trace` says the file is empty. What did I forget?
6. The goroutine profile shows 10,000 goroutines all in `chan receive`. Is it a leak?
7. Why doesn't the block profile show contention on `sync.Once.Do`?

(Brief answers in middle.md and senior.md.)

---

## Cheat Sheet

```text
Enable:
  runtime.SetMutexProfileFraction(100)
  runtime.SetBlockProfileRate(int(time.Millisecond))

Endpoints:
  /debug/pprof/goroutine        snapshot of all goroutines
  /debug/pprof/goroutine?debug=1   grouped text
  /debug/pprof/goroutine?debug=2   every goroutine + state
  /debug/pprof/mutex            mutex contention
  /debug/pprof/block            all blocking events
  /debug/pprof/profile?seconds=N CPU
  /debug/pprof/trace?seconds=N   full trace

Inspect:
  go tool pprof <file>          REPL
  go tool pprof -http=:9090 <file>  web UI / flame graph
  go tool pprof -base a b       diff
  go tool trace trace.out       trace UI

Test flags:
  go test -mutexprofile mu.prof
  go test -blockprofile bl.prof
  go test -cpuprofile cpu.prof
  go test -trace trace.out
```

---

## Self-Assessment Checklist

- [ ] I can enable the mutex profile and explain what fraction 100 means.
- [ ] I can enable the block profile and explain what rate (in ns) means.
- [ ] I know the difference between the mutex and block profiles.
- [ ] I can take a goroutine snapshot in three formats.
- [ ] I can capture a 3-second trace and open it.
- [ ] I know why CPU profile alone is insufficient for concurrency bugs.
- [ ] I can name three reasons a request would be off-CPU.
- [ ] I have at least once run `go tool pprof` on a real contention problem.

---

## Summary

Concurrency profiling is a small extension of the pprof toolchain you already know. Three additional endpoints — `goroutine`, `mutex`, `block` — and one heavyweight tool, `runtime/trace`, give you visibility into time spent **not** running. Enable the mutex and block profiles at modest fractions in production. When latency is the question, capture the trio together: CPU profile, goroutine snapshot, and a brief trace. Diff against a baseline. The bottleneck almost always reveals itself in one of those views.

At middle level we will turn this knowledge into a workflow: which profile first, how to read the output efficiently, how to navigate `go tool trace`, and how to wire up continuous profiling so the data is already on hand when an incident starts.

---

## What You Can Build

- A small benchmark harness that compares two versions of a concurrent data structure by mutex profile.
- A diagnostic HTTP endpoint that bundles "snapshot all three concurrency profiles + a trace" into one zip download.
- A test helper that fails if a function adds more than N microseconds of mutex contention.
- A team runbook: "concurrent-latency-spike" — the exact curls to run.

---

## Further Reading

- [`07-goroutine-lifecycle-leaks/04-pprof-tools/junior.md`](../../07-goroutine-lifecycle-leaks/04-pprof-tools/junior.md) — pprof basics.
- [Go diagnostics page](https://go.dev/doc/diagnostics) — official overview.
- Russ Cox, "Profiling Go Programs" (2011, still mostly accurate).
- Felix Geisendörfer's blog — many deep articles on Go profilers.

## Related Topics

- [`10-scheduler-deep-dive/04-scheduler-tracing`](../../10-scheduler-deep-dive/04-scheduler-tracing/) — `GODEBUG=schedtrace`.
- [`05-scheduler-tracing`](../05-scheduler-tracing/) — sibling.
- [`02-sync-package/01-mutex-rwmutex`](../../02-sync-package/01-mutex-rwmutex/) — what the mutex profile measures.

---

## Diagrams & Visual Aids

### The lenses

```
On-CPU       ────►   CPU profile
                     allocs / heap

Off-CPU
  waiting    ────►   block profile
  for lock   ────►   mutex profile
  parked     ────►   goroutine profile

Anything    ────►   runtime/trace
ordered in
time
```

### Flow: latency triage

```
p99 latency spike
        │
        ▼
goroutine?debug=1      ── stuck or leaking?
        │
        ▼
mutex + block (30s)    ── on a hot lock or channel?
        │
        ▼
trace (3-5s)           ── precise timing of one slow path?
        │
        ▼
   fix + diff
```

### A typical flame graph for a contended program

```
[main.worker                    ]  100%
[ main.(*Cache).Get             ]   95%
[  sync.(*Mutex).Lock           ]   90%   ←  hot synchronisation
[   runtime.semacquire1         ]   90%
[    runtime.gopark             ]   90%
```

Wide all the way down to `gopark` means the goroutine is waiting. Compare against the same flame graph after sharding the lock — the width near `gopark` collapses.
