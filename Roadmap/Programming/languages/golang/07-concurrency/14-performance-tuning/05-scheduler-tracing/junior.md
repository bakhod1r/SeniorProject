# Scheduler Tracing — Junior Level

[Back to index](index.md)

## Table of Contents
1. [Introduction](#introduction)
2. [What Is Scheduler Tracing?](#what-is-scheduler-tracing)
3. [Three Tools, One Topic](#three-tools-one-topic)
4. [Getting Started with `GODEBUG=schedtrace`](#getting-started-with-godebugschedtrace)
5. [Reading the schedtrace Output](#reading-the-schedtrace-output)
6. [What Each Field Means](#what-each-field-means)
7. [`scheddetail=1` for per-G/M/P View](#scheddetail1-for-per-gmp-view)
8. [Reading scheddetail Output](#reading-scheddetail-output)
9. [Recognising Common Patterns](#recognising-common-patterns)
10. [M-Starvation Signal](#m-starvation-signal)
11. [Syscall Storm Signal](#syscall-storm-signal)
12. [Netpoller Saturation Signal](#netpoller-saturation-signal)
13. [GC Stall Signal](#gc-stall-signal)
14. [Stuck-P Signal](#stuck-p-signal)
15. [`GODEBUG=gctrace=1` Alongside](#godebuggctrace1-alongside)
16. [Sysmon Events](#sysmon-events)
17. [`runtime/trace` Quickstart](#runtimetrace-quickstart)
18. [Capturing a Trace from HTTP](#capturing-a-trace-from-http)
19. [Opening the Trace UI](#opening-the-trace-ui)
20. [The Five Built-in Views](#the-five-built-in-views)
21. [Reading the Timeline](#reading-the-timeline)
22. [`runtime/metrics` for Structured Data](#runtimemetrics-for-structured-data)
23. [Two Metrics You Will Use Every Day](#two-metrics-you-will-use-every-day)
24. [When to Reach for Which Tool](#when-to-reach-for-which-tool)
25. [Hands-On Lab: Capturing Your First Trace](#hands-on-lab-capturing-your-first-trace)
26. [Common Beginner Mistakes](#common-beginner-mistakes)
27. [Mini Cheat Sheet](#mini-cheat-sheet)
28. [Self-Assessment](#self-assessment)
29. [Summary](#summary)

---

## Introduction

You have learned that Go schedules goroutines on a fixed pool of OS threads using the G-M-P model. So far that has been a mental picture. In this section the picture becomes data: you can ask the runtime to print, every second, exactly how many Ps are running, how many threads are spinning, how many goroutines are queued globally, and how many timers each P holds. With a different switch, you can ask the runtime to record every single scheduler event into a binary file and then open it in a browser as a timeline.

This is **scheduler tracing**. It is the lowest-friction way to answer questions like:

- Why is my service spending 30% of its time idle when load tests show CPU saturation?
- Why are my latency p99 spikes correlated with garbage collections?
- Why do some Ps sit with empty run queues while others are overloaded?
- Why does the goroutine count climb during traffic but never fall?

At junior level you learn the two zero-cost mechanisms — `GODEBUG=schedtrace` and `GODEBUG=scheddetail` — and the workflow of capturing a `runtime/trace` and opening it in the UI. You learn the vocabulary: `gomaxprocs`, `idleprocs`, `threads`, `spinningthreads`, `runqueue`. You learn five common patterns by sight. You will not yet write custom regions or analyse the binary format — that comes in middle and senior. You will, however, leave this file able to diagnose half the production scheduler issues you will ever see.

---

## What Is Scheduler Tracing?

"Scheduler tracing" is an umbrella term for **observing how the Go runtime scheduled your goroutines**. It is the third leg of Go performance diagnostics, alongside profiling (what code is running) and metrics (aggregate numbers like requests/sec).

| Tool | Answers | Cost |
|------|---------|------|
| Profiling (`pprof`) | "Which function is using CPU?" | ~5% during capture |
| Metrics | "What are aggregate numbers right now?" | near-zero |
| Tracing | "When and on which thread did each scheduler event happen?" | varies; bigger files, richer signal |

The scheduler trace adds *time* and *parallelism* to your understanding. A profile says "function `decode` took 40% of CPU." A trace says "goroutine 17 ran `decode` from t=12.5s to t=12.8s on P2 while P0 was waiting in netpoll." For latency, queueing, and starvation problems, the second view is irreplaceable.

---

## Three Tools, One Topic

There are three concrete tools to learn here. They are independent — you can use any one without the others — but they are most powerful in combination.

1. **`GODEBUG=schedtrace=N`**
   Environment variable. Every N milliseconds, the runtime prints one summary line to standard error. Free to enable, useful in production, but coarse.

2. **`runtime/trace` package**
   Standard library API plus a `/debug/pprof/trace` HTTP endpoint. Captures every scheduler event into a binary file. `go tool trace` opens that file in a browser. Heavyweight; reach for it when summary lines are not enough.

3. **`runtime/metrics` package**
   Standard library API. Reads scheduler counters and histograms programmatically — perfect for Prometheus exporters and dashboards. Zero overhead; you should be exporting at least a few of these from every service.

The pattern is: dashboards from `runtime/metrics`, ongoing summary lines from `schedtrace` when you suspect something, deep dives with `runtime/trace` when you have a concrete reproduction.

---

## Getting Started with `GODEBUG=schedtrace`

The easiest scheduler-tracing tool in Go takes one environment variable.

```bash
GODEBUG=schedtrace=1000 ./my-server
```

That tells the runtime: every **1000 milliseconds**, emit one line on standard error describing global scheduler state. The output looks like:

```
SCHED 1003ms: gomaxprocs=8 idleprocs=5 threads=10 spinningthreads=0 needspinning=0 idlethreads=4 runqueue=0 [0 0 0 0 1 0 0 0]
SCHED 2009ms: gomaxprocs=8 idleprocs=2 threads=10 spinningthreads=1 needspinning=0 idlethreads=2 runqueue=3 [4 5 2 0 6 0 0 1]
SCHED 3015ms: gomaxprocs=8 idleprocs=0 threads=12 spinningthreads=0 needspinning=0 idlethreads=0 runqueue=18 [12 8 9 6 10 7 11 5]
```

The interval can be anything: `schedtrace=100` (every 100ms — chatty) up to `schedtrace=10000` (every 10s — sleepy). For most production work, `1000` is the right balance.

You can combine flags with commas:

```bash
GODEBUG=schedtrace=1000,scheddetail=1,gctrace=1 ./my-server
```

This emits per-G/M/P detail (next section), GC traces, and the summary line.

You can also enable schedtrace at runtime if you can re-exec the process; otherwise it must be set before start. (Some advanced setups expose a debug endpoint that calls `runtime/debug.SetGCPercent` and similar, but `schedtrace` cannot be flipped at runtime in standard Go.)

---

## Reading the schedtrace Output

Here is a single line broken into pieces:

```
SCHED 1003ms: gomaxprocs=8 idleprocs=5 threads=10 spinningthreads=0 needspinning=0 idlethreads=4 runqueue=0 [0 0 0 0 1 0 0 0]
```

- `SCHED` — the literal prefix telling you this is a scheduler-trace line.
- `1003ms` — wall-clock since program start.
- `gomaxprocs=8` — current `GOMAXPROCS` value (P count).
- `idleprocs=5` — Ps currently idle.
- `threads=10` — total OS threads (Ms) in the process.
- `spinningthreads=0` — Ms in the "spinning" state (actively looking for work).
- `needspinning=0` — count of pending spinning-M requests.
- `idlethreads=4` — Ms that are parked waiting for work.
- `runqueue=0` — length of the **global** runqueue.
- `[0 0 0 0 1 0 0 0]` — per-P local runqueue lengths, in P-id order.

Read it as a snapshot: "right now, 8 Ps exist, 5 are idle, 10 threads in total, 4 of them parked, 0 spinning, 0 Gs in the global queue, only P4 has any local work and only one G there." This is a near-idle server.

The 3015ms line above shows the opposite extreme: zero idle Ps, every P has a backlog of Gs, the global queue has 18 Gs waiting. The runtime spawned 2 extra threads to handle the load. That is a busy server.

---

## What Each Field Means

These are the fields you need to know cold.

### `gomaxprocs`

Number of Ps. Equal to `runtime.GOMAXPROCS(0)`. Set by the env var, by `runtime.GOMAXPROCS`, or by cgroup quota (Go 1.25+). If you see `gomaxprocs=2` on an 8-core box, you have a container limit you did not expect.

### `idleprocs`

Ps with no work — neither running a goroutine nor about to. Persistently high `idleprocs` under load means your code is not producing enough work to fill the cores (or it is bottlenecked elsewhere — IO, locks).

### `threads`

Total OS threads associated with this Go process. Includes Ms running Go code, Ms blocked in syscalls, Ms parked. Should be roughly `GOMAXPROCS + a few` for a healthy CPU-bound program; in cgo-heavy or syscall-heavy programs it can grow.

### `spinningthreads`

Ms that are actively scanning for runnable Gs without holding work themselves. The runtime caps this at roughly `GOMAXPROCS/2` to avoid burning CPU. Persistent non-zero spinning under load is a sign of churn — Gs become runnable but get stolen before the spinning M finds them.

### `needspinning`

Pending requests to "go spin." Usually 0. If you see it growing, the wake-protocol is stressed.

### `idlethreads`

Ms parked on `notesleep` waiting for work. The runtime keeps a pool of these so it does not have to call `clone(2)` every time a syscall returns. High `idlethreads` is normal; it just means you have peaked thread count and then quieted.

### `runqueue`

Length of the **global** runqueue. The fall-back queue for Gs that did not fit in any P's local 256-slot ring buffer, or that were placed globally for fairness reasons. Long global queues mean the local queues are saturated and the scheduler is in batch-fairness mode.

### `[ ... ]` per-P runqueues

One number per P, in order P0 through P(N-1). The length of each P's local runqueue. Reading this is how you spot starvation patterns:

- `[20 20 20 20 0 0 0 0]` — four Ps have backlogs, four are empty. Work is not being stolen — possibly a CPU-pinning issue or extremely short-lived Gs.
- `[5 5 5 5 5 5 5 5]` — even distribution. Healthy.
- `[200 0 0 0 0 0 0 0]` — one P is hot, work is producing faster than stealers can keep up.

---

## `scheddetail=1` for per-G/M/P View

`schedtrace` gives a one-line summary. `scheddetail` adds — under each summary line — a dump of every G, M, and P. Use it when the summary is not enough.

```bash
GODEBUG=schedtrace=1000,scheddetail=1 ./my-server 2>sched.log
```

The output is verbose; capture to a file and grep it.

---

## Reading scheddetail Output

A real scheddetail block looks like this (truncated):

```
SCHED 1003ms: gomaxprocs=8 idleprocs=0 threads=12 spinningthreads=0 needspinning=0 idlethreads=4 runqueue=2 gcwaiting=0 nmidlelocked=0 stopwait=0 sysmonwait=0
  P0: status=1 schedtick=4521 syscalltick=3 m=1 runqsize=8 gfreecnt=12 timerslen=0
  P1: status=1 schedtick=4188 syscalltick=2 m=2 runqsize=6 gfreecnt=10 timerslen=2
  P2: status=2 schedtick=3920 syscalltick=410 m=-1 runqsize=0 gfreecnt=8 timerslen=0
  P3: status=1 schedtick=4001 syscalltick=1 m=3 runqsize=12 gfreecnt=9 timerslen=0
  ...
  M11: p=-1 curg=-1 mallocing=0 throwing=0 preemptoff= locks=0 dying=0 spinning=false blocked=true lockedg=-1
  M10: p=3 curg=421 mallocing=0 throwing=0 preemptoff= locks=0 dying=0 spinning=false blocked=false lockedg=-1
  ...
  G1: status=4(semacquire) m=-1 lockedm=-1
  G17: status=1() m=-1 lockedm=-1
  G421: status=2() m=10 lockedm=-1
  ...
```

### P status values

- `0` = `_Pidle`
- `1` = `_Prunning`
- `2` = `_Psyscall`
- `3` = `_Pgcstop`
- `4` = `_Pdead`

In the example, P2 has `status=2` (syscall). Its `m=-1` means no M is currently attached. That P was donated by some M that entered a syscall — sysmon may snatch it back if the syscall lingers.

### M fields

- `p=N` — the P this M is bound to, or `-1`.
- `curg=N` — the goroutine ID currently running on this M, or `-1`.
- `spinning=true|false` — is this M searching for work?
- `blocked=true|false` — is this M parked on a futex (idle)?
- `lockedg=N` — `LockOSThread` partner G, or `-1`.

### G status values

The number before `()` is the G's state:

- `0` = `_Gidle`
- `1` = `_Grunnable` — ready, queued, not yet running.
- `2` = `_Grunning` — currently on an M.
- `3` = `_Gsyscall` — in a system call.
- `4` = `_Gwaiting` — blocked (text in parens explains why: `chan receive`, `semacquire`, `select`, `IO wait`).
- `5` = `_Gmoribund_unused`.
- `6` = `_Gdead`.
- `7` = `_Genqueue_unused`.
- `8` = `_Gcopystack`.
- `9` = `_Gpreempted`.

A `_Gwaiting` G with `IO wait` text is sitting in the netpoller. With `chan receive`, it is on a channel. With `sync.Cond.Wait`, on a condition variable.

`scheddetail` gives you the full picture of *exactly which G is in what state and which M is running which G*. Combined with `goroutine?debug=2` from pprof, you have everything you need to reason about a stuck program.

---

## Recognising Common Patterns

Five patterns cover most production issues. After the next sections you should be able to spot each from a few schedtrace lines.

---

## M-Starvation Signal

**Symptom:** persistent `spinningthreads > 0` under load, accompanied by uneven per-P runqueues.

```
SCHED 1000ms: ... spinningthreads=2 ... [0 0 12 0 0 0 0 8]
SCHED 2000ms: ... spinningthreads=3 ... [0 0 9 0 0 1 0 6]
SCHED 3000ms: ... spinningthreads=2 ... [0 0 11 0 0 0 0 7]
```

Two Ps are constantly busy, six are empty, and a few Ms are burning CPU spinning to find work. The producer goroutines are pinning themselves to those two Ps (often via `runtime.LockOSThread` or, more commonly, by being short-lived enough that the cost to put them on `runnext` exceeds the cost of stealing).

Fixes: spread work more, avoid `LockOSThread`, increase work-batch sizes per goroutine.

---

## Syscall Storm Signal

**Symptom:** `threads` grows substantially above `gomaxprocs`, often paired with high `syscalltick` deltas in scheddetail.

```
SCHED 1000ms: gomaxprocs=8 threads=12 ...
SCHED 2000ms: gomaxprocs=8 threads=24 ...
SCHED 3000ms: gomaxprocs=8 threads=48 ...
```

Each blocking syscall donates its P; the runtime creates new Ms to keep the Ps busy. If many goroutines are blocked in syscalls simultaneously (file IO, DNS, cgo), the thread count balloons.

Fixes: batch IO, use buffered IO, prefer the netpoller over blocking reads, cache DNS, avoid cgo on hot paths.

---

## Netpoller Saturation Signal

**Symptom:** many Gs in `_Gwaiting` with `IO wait`; per-P runqueues short; CPU usage low; latency high.

```
G201: status=4(IO wait) m=-1 lockedm=-1
G202: status=4(IO wait) m=-1 lockedm=-1
G203: status=4(IO wait) m=-1 lockedm=-1
... thousands of these ...
```

All the work is waiting on the network. The scheduler is healthy; the network is the bottleneck. This is not a scheduler problem.

Fixes: check downstream services, connection pools, TCP buffers.

---

## GC Stall Signal

**Symptom:** `gcwaiting=1` in summary, often accompanied by `stopwait > 0`.

```
SCHED 5000ms: ... gcwaiting=1 stopwait=2 sysmonwait=0 ...
```

A stop-the-world phase of garbage collection is in progress. The runtime is waiting for `stopwait=2` more Ps to reach a safe point before it proceeds. If you see `gcwaiting=1` lingering across multiple schedtrace lines, you have a goroutine that cannot be preempted (rare since Go 1.14 added async preemption).

Combine with `gctrace=1` to see GC timing directly.

---

## Stuck-P Signal

**Symptom:** the same P never appears with `status=1` (running). It sits in `_Psyscall` or `_Pidle`.

```
P5: status=2 schedtick=100 syscalltick=12000 m=-1
P5: status=2 schedtick=100 syscalltick=12100 m=-1
P5: status=2 schedtick=100 syscalltick=12200 m=-1
```

`schedtick` is not advancing. The P has been donated to a syscall and never recovered. Sysmon will normally rescue it in tens of microseconds; if you see this persist for seconds, you have either a kernel issue (uninterruptible IO) or a misbehaving cgo call.

---

## `GODEBUG=gctrace=1` Alongside

Garbage collection runs concurrently with scheduling, but the GC mark phase steals CPU from your code and the STW pause stops everything. Pair gctrace with schedtrace:

```bash
GODEBUG=schedtrace=1000,gctrace=1 ./my-server
```

A gctrace line looks like:

```
gc 7 @1.234s 1%: 0.018+1.2+0.005 ms clock, 0.14+0.4/1.1/2.3+0.04 ms cpu, 100->101->50 MB, 102 MB goal, 8 P
```

Read as: GC cycle #7 started 1.234s after program start, took 1% of CPU since the last GC, pauses were 0.018ms (sweep) + 1.2ms (mark) + 0.005ms (mark-termination). Heap went from 100 MB before to 101 MB peak to 50 MB after. Target was 102 MB. 8 Ps participated.

When you see a latency spike in your service metrics, check whether a gctrace line landed in the same second. If yes, GC is part of the story.

---

## Sysmon Events

Sysmon is a single goroutine that runs without a P, sleeping between 20µs and 10ms, doing housekeeping. Its job: snatch back Ps that have been in syscalls too long, force GC if memory is high, run scheduled timers, preempt long-running Gs.

Most sysmon work is invisible. Two signals worth noticing:

- **Repeated `syscalltick` jumps in scheddetail.** Means sysmon retook the P from a blocked syscall.
- **`sysmonwait=1`** in summary. Sysmon parked itself because nothing needed doing.

You will read about sysmon in detail in `10-scheduler-deep-dive`. At junior level, just know it exists and that sometimes it shows up in traces.

---

## `runtime/trace` Quickstart

The schedtrace and scheddetail mechanisms are *summaries*. For per-event detail — every G start, every channel send that unblocked a receiver, every GC mark assist — use the `runtime/trace` package.

```go
package main

import (
    "log"
    "os"
    "runtime/trace"
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

    doWork()
}

func doWork() {
    // your normal program.
}
```

Run the program. A `trace.out` file appears.

The cost: a typical program runs ~5–25% slower while tracing. The file size grows linearly with events; a few seconds of moderate load can produce tens of megabytes. **Trace short windows.**

---

## Capturing a Trace from HTTP

For long-running services, importing `net/http/pprof` is the convention. It registers `/debug/pprof/trace`:

```go
import (
    "net/http"
    _ "net/http/pprof"
)

func main() {
    go func() {
        log.Println(http.ListenAndServe("127.0.0.1:6060", nil))
    }()

    // ... rest of your program ...
}
```

Then from another shell:

```bash
curl -o trace.out http://127.0.0.1:6060/debug/pprof/trace?seconds=5
```

Five seconds is usually enough. Ten seconds is the upper limit unless you have a slow-burn problem.

Never expose pprof on `0.0.0.0`. Always loopback or behind a private mesh.

---

## Opening the Trace UI

```bash
go tool trace trace.out
```

A browser tab opens with a menu of views. The HTML is served from `localhost` on a random port; the `go tool trace` process must stay running.

```
2026/05/12 14:30:01 Parsing trace...
2026/05/12 14:30:01 Splitting trace for viewer...
2026/05/12 14:30:01 Opening browser. Trace viewer is listening on http://127.0.0.1:43521
```

Large traces (hundreds of MB) take 30 seconds or more to parse on first open.

---

## The Five Built-in Views

The menu page lists:

1. **View trace** — the timeline. Most powerful, also slowest to render. Each P is a horizontal lane; coloured blocks are running Gs.
2. **Goroutine analysis** — per-function summary. "Function X was responsible for 1200 goroutines, total network wait 4.2s, total scheduler wait 0.8s."
3. **Network blocking profile** — like a pprof block profile but only for netpoll waits, with click-through to the timeline.
4. **Synchronization blocking profile** — channels, mutexes, condition variables, etc.
5. **Syscall blocking profile** — time spent in syscalls.
6. **Scheduler latency profile** — time goroutines spent runnable but not yet running. This is the **single most useful view** for latency debugging.
7. **User-defined tasks** — only populated if you used `trace.NewTask` (covered in senior).
8. **User-defined regions** — only populated if you used `trace.WithRegion` (covered in senior).
9. **Minimum mutator utilization** — what fraction of CPU is available for your code at the worst moments (GC-dominated).

Junior priority: **scheduler latency profile** for "why is my p99 high" questions, **goroutine analysis** for "where does my service spend time."

---

## Reading the Timeline

When you click **View trace**, you get an enormous time-vs-P chart.

- The x-axis is time. Zoom with mouse wheel or `w`/`s` keys.
- One row per **P**, plus rows for the global heap, sysmon, GC.
- Coloured blocks are running Gs. Hover for the G id and function name.
- Vertical white gaps on a P row mean the P was idle.
- Red blocks usually mean GC mark assist.
- Click a block; the details panel shows G id, function, start/end times.

Trick: zoom into a 1ms window and look at how the work spreads across Ps. A healthy CPU-bound workload fills all rows. A scheduler issue shows up as gaps or as one row hammering while the rest idle.

The first time you use this view it is overwhelming. Resist the urge to read every block. Pick a Q (a 5ms window when latency spiked) and look only at it.

---

## `runtime/metrics` for Structured Data

The `runtime/metrics` package gives you the same data the runtime tracks for itself, in a machine-readable form. Perfect for Prometheus, OpenTelemetry, or just printing to logs.

```go
package main

import (
    "fmt"
    "runtime/metrics"
)

func main() {
    samples := []metrics.Sample{
        {Name: "/sched/goroutines:goroutines"},
        {Name: "/sched/latencies:seconds"},
    }
    metrics.Read(samples)

    for _, s := range samples {
        fmt.Printf("%s = %v\n", s.Name, s.Value)
    }
}
```

The list of all metric names is in `metrics.All()`. The package is stable; metric names are versioned. Some metrics are scalars, some are histograms (you read `metrics.Float64Histogram`).

---

## Two Metrics You Will Use Every Day

### `/sched/goroutines:goroutines`

Scalar `uint64`. The current goroutine count. Equivalent to `runtime.NumGoroutine()` but cheaper to export from a metrics endpoint.

```go
s := metrics.Sample{Name: "/sched/goroutines:goroutines"}
metrics.Read([]metrics.Sample{s})
fmt.Println(s.Value.Uint64())
```

### `/sched/latencies:seconds`

Histogram. For each completed G, the time it spent in `_Grunnable` before being picked up by an M. Tail percentiles of this histogram are the closest thing to "scheduler latency" you can get from inside Go.

```go
s := metrics.Sample{Name: "/sched/latencies:seconds"}
metrics.Read([]metrics.Sample{s})
hist := s.Value.Float64Histogram()
fmt.Printf("buckets: %v counts: %v\n", hist.Buckets, hist.Counts)
```

A healthy server has median scheduler latency in microseconds. Tens of milliseconds at p99 is a sign of P contention or GC.

Other useful metrics to know exist:

- `/cpu/classes/gc/total:cpu-seconds` — GC CPU.
- `/cpu/classes/scavenge/total:cpu-seconds` — scavenger CPU.
- `/cpu/classes/idle:cpu-seconds` — idle CPU.
- `/sync/mutex/wait/total:seconds` — total mutex wait.

---

## When to Reach for Which Tool

| Question | First tool |
|----------|------------|
| "Are we using our cores?" | `schedtrace` summary line. |
| "Why is a specific request slow?" | `runtime/trace`. |
| "Why did p99 latency spike at 14:23 yesterday?" | `runtime/metrics` historical data first, then trace next reproduction. |
| "How many goroutines are alive?" | `/sched/goroutines:goroutines`. |
| "Is GC eating my latency?" | `gctrace=1`. |
| "Which P is overloaded?" | `schedtrace` per-P runqueues. |
| "Is one goroutine pinning a P?" | `scheddetail=1` plus `runtime/trace`. |

Promote tracing from "I will reach for it during an incident" to "I export it always." A few `runtime/metrics` scalars on your dashboard cost nothing and save you the next outage.

---

## Hands-On Lab: Capturing Your First Trace

Save the following as `main.go`:

```go
package main

import (
    "context"
    "fmt"
    "log"
    "math/rand"
    "os"
    "runtime/trace"
    "sync"
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

    ctx := context.Background()
    runWorkload(ctx)
}

func runWorkload(ctx context.Context) {
    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            worker(ctx, id)
        }(i)
    }
    wg.Wait()
}

func worker(ctx context.Context, id int) {
    start := time.Now()
    for time.Since(start) < 500*time.Millisecond {
        burnCPU()
        time.Sleep(time.Duration(rand.Intn(10)) * time.Millisecond)
    }
    fmt.Printf("worker %d done\n", id)
}

func burnCPU() {
    x := 0
    for i := 0; i < 1_000_000; i++ {
        x += i
    }
    _ = x
}
```

Build, run, and open the trace:

```bash
go run main.go
go tool trace trace.out
```

In the browser:

1. Click **View trace**. You should see 8 Ps (or however many cores), with worker activity striped across them.
2. Zoom in. Spot the `time.Sleep` gaps as white space.
3. Open **Goroutine analysis**. You should see one row per goroutine, dominated by `worker`.
4. Open **Scheduler latency profile**. With only 8 workers and no contention, latencies should be microseconds.

Now increase the worker count to 200 and rerun. The scheduler latency profile will start showing tails into milliseconds. That is the scheduler doing its job under load.

---

## Common Beginner Mistakes

### Mistake: Tracing for too long

```bash
curl -o trace.out 'http://host:6060/debug/pprof/trace?seconds=60'
```

A 60-second trace can be hundreds of megabytes and take minutes to load. Use 1–5 seconds and capture during the actual symptom window. Long traces hide the signal in noise.

### Mistake: Forgetting `defer trace.Stop()`

If you call `trace.Start` and forget `Stop`, the file is truncated or partly empty. Always defer.

### Mistake: Running trace and CPU profile simultaneously

You can do it, but the overlap inflates both. Capture one at a time unless you specifically need correlation.

### Mistake: Reading absolute numbers without context

A `runqueue=18` means nothing without knowing `gomaxprocs` and your normal workload. Always compare to a baseline taken at idle and at typical load.

### Mistake: Treating schedtrace lines as truth between samples

The line is a snapshot. Between two lines, anything can happen. If you see `runqueue=0` in two consecutive lines, do not conclude "the runqueue was always empty"; it might have spiked to 1000 and back in the middle.

### Mistake: Pasting schedtrace output without `gomaxprocs`

When sharing with a colleague, always include `gomaxprocs`. `runqueue=20` on `gomaxprocs=2` is desperate; on `gomaxprocs=64` it is fine.

### Mistake: Confusing `/debug/pprof/trace` with `/debug/pprof/profile`

The first is a `runtime/trace` capture. The second is a CPU profile. They are distinct files with distinct viewers. `go tool trace` for the trace, `go tool pprof` for the profile.

---

## Mini Cheat Sheet

```bash
# Per-second scheduler summary line:
GODEBUG=schedtrace=1000 ./prog

# Add per-G/M/P detail:
GODEBUG=schedtrace=1000,scheddetail=1 ./prog

# Plus GC traces:
GODEBUG=schedtrace=1000,scheddetail=1,gctrace=1 ./prog

# Capture a 5-second runtime/trace from a service:
curl -o trace.out http://127.0.0.1:6060/debug/pprof/trace?seconds=5

# Open it:
go tool trace trace.out

# Read scheduler-latency histogram programmatically:
# (see /sched/latencies:seconds in runtime/metrics)
```

Lines you should recognise at a glance:

```
SCHED 1000ms: gomaxprocs=8 idleprocs=0 threads=10 spinningthreads=0 needspinning=0 idlethreads=2 runqueue=0 [...]
```

Status numbers:

- G: `1`=runnable, `2`=running, `3`=syscall, `4`=waiting.
- P: `0`=idle, `1`=running, `2`=syscall, `3`=gcstop.

---

## Self-Assessment

- [ ] I can enable `GODEBUG=schedtrace=1000` and read every field of one output line.
- [ ] I know what `idleprocs`, `spinningthreads`, `runqueue`, and the bracketed per-P list mean.
- [ ] I can spot at least three of the five common patterns (M-starvation, syscall storm, netpoller saturation, GC stall, stuck-P).
- [ ] I have captured a `runtime/trace` and opened it with `go tool trace`.
- [ ] I know what each of the five built-in trace views shows.
- [ ] I have read `/sched/goroutines:goroutines` and `/sched/latencies:seconds` from `runtime/metrics`.
- [ ] I do not bind pprof to `0.0.0.0` and I keep trace captures to under 10 seconds.
- [ ] I pair `gctrace=1` with `schedtrace` when latency might be GC.

---

## Summary

`GODEBUG=schedtrace=1000` is the cheapest scheduler observability tool you have. Every second, it tells you how many Ps, threads, and Gs exist, and how the work is distributed. `scheddetail=1` adds per-G/M/P detail when the summary is not enough. For event-level diagnostics, `runtime/trace` captures every scheduler event into a binary file viewable with `go tool trace`. For structured dashboards, `runtime/metrics` exports the same data as scalars and histograms. Five patterns — M-starvation, syscall storm, netpoller saturation, GC stalls, stuck Ps — cover most production issues. Pair `gctrace=1` when GC is suspected. Keep traces short. Always loopback-only. The middle-level file builds on this with the trace UI in depth; senior layers user regions, tasks, and continuous tracing on top.
