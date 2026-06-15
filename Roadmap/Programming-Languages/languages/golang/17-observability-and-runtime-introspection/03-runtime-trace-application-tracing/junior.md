# `runtime/trace` & Application Tracing — Junior Level

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
> Focus: "What is the execution tracer?" and "How is it different from a CPU profile?"

When a Go program runs slowly, your first instinct is to reach for a CPU profile (`runtime/pprof`). A CPU profile answers one question: **where does the program spend its time?** It samples the call stack a few hundred times per second and tells you "42% of CPU time is inside `json.Unmarshal`."

That is useful — but it is blind to an entire class of problems. A CPU profile cannot tell you that your goroutine spent 800 milliseconds *waiting* for a mutex, or *blocked* on a network read, or *sitting in the run queue* because all your CPUs were busy. Waiting does not burn CPU, so the CPU profiler never sees it.

The **execution tracer** sees all of it. Instead of sampling, it records *events*: every time a goroutine starts running, stops running, blocks on a channel, makes a syscall, gets preempted, or waits for the garbage collector. It writes those events, each with a nanosecond timestamp, to a file. You then open that file with a built-in tool and get a **timeline** of exactly what every goroutine and every CPU was doing, moment by moment.

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()
// ... the code you want to trace runs here ...
```

Then:

```bash
go tool trace trace.out
```

That opens a web UI in your browser showing the timeline.

After reading this file you will:
- Understand what the execution tracer records and why it is unique
- Capture a trace three different ways (in code, via `go test`, via HTTP)
- Open and navigate `go tool trace`
- Know the difference between `runtime/trace` and `runtime/pprof`
- Know when a trace is the right tool and when a profile is

You do **not** need to understand the binary trace format, the flight recorder, or tracer internals yet. This file is about the moment you say "my CPU profile looks fine, but the program is still slow — *why*?"

---

## Prerequisites

- **Required:** A working Go installation, version 1.21 or newer (the tracer was rewritten in 1.21 to be far cheaper; everything here works on 1.21+). Check with `go version`.
- **Required:** Comfort with goroutines, channels, and the `go` keyword. Tracing is fundamentally about goroutine behaviour. See the concurrency section if those feel shaky.
- **Required:** Basic familiarity with `os.Create` and `defer`.
- **Helpful:** Having seen a CPU profile (`runtime/pprof` or `go test -cpuprofile`). The trace makes the most sense as a *contrast* to the profile.
- **Helpful:** A program with some concurrency in it — a web server, a worker pool, anything with more than one goroutine doing real work.

If `go version` prints `go1.21` or higher, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Execution tracer** | The runtime subsystem that records timestamped scheduling and runtime events into a trace file. |
| **Trace** | The output file (often `trace.out`) containing the recorded events. |
| **Event** | A single recorded occurrence: a goroutine started, blocked, unblocked, a GC ran, a syscall happened, etc. |
| **`go tool trace`** | The command-line tool that opens a trace file and serves a browser UI to explore it. |
| **Goroutine** | A lightweight thread managed by the Go runtime. The tracer follows the life of every one. |
| **G, M, P** | The three actors of the Go scheduler: **G**oroutine, **M**achine (OS thread), **P**rocessor (a scheduling context). The trace shows what each P is running. |
| **Scheduler latency** | Time a goroutine is *runnable* (ready to run) but not yet running because no P is free. |
| **Blocking** | A goroutine is parked, not consuming CPU: waiting on a channel, mutex, network, or syscall. |
| **STW (stop-the-world)** | A moment when the runtime pauses all goroutines, e.g. for some GC phases or, historically, to start a trace. |
| **`runtime/pprof`** | The *other* introspection package — produces CPU/heap/block/mutex *profiles* (statistical aggregates), not timelines. |

---

## Core Concepts

### What the tracer records

The execution tracer is not a profiler. It is an **event recorder**. The events it captures include:

- **Goroutine lifecycle:** created, started running, stopped, blocked, unblocked, finished.
- **Scheduling:** which P picked up which G, when a G was preempted, how long a G waited in a run queue (scheduler latency).
- **Garbage collection:** when GC started, its phases, mark-assist work done by your goroutines, and any stop-the-world pauses.
- **Syscalls:** when a goroutine entered and exited a system call (which is where time on disk I/O and some network I/O shows up).
- **Blocking on synchronization:** channel send/receive, `sync.Mutex`, `sync.WaitGroup`, network poller (network reads/writes), and `select`.
- **Processor (P) state:** how many Ps were active over time, when they went idle.

Every event carries a timestamp and, usually, a stack trace. That combination — *what happened, exactly when, and where in the code* — is the tracer's superpower.

### Why this is unique versus a CPU profile

This is the single most important idea in this file, so it is worth stating sharply:

- A **CPU profile** answers **"where does on-CPU time go?"** It samples running stacks. It is *blind to waiting.*
- An **execution trace** answers **"when and why did each goroutine run or not run?"** It records every transition. It *sees waiting* — in fact, waiting is what it is best at.

If your program is CPU-bound (busy computing), a CPU profile is the better tool. If your program is *latency*-bound — slow despite low CPU usage, suffering from lock contention, scheduler starvation, GC pauses, or I/O stalls — the execution trace is the tool that reveals it.

### Capturing a trace: the in-code way

The most direct method uses three calls from `runtime/trace`:

```go
f, _ := os.Create("trace.out")
trace.Start(f)   // begin recording events to f
// ... run the workload ...
trace.Stop()     // flush and stop
f.Close()
```

`trace.Start(w io.Writer)` begins recording; `trace.Stop()` flushes everything and stops. You almost always pair `trace.Start` with `defer trace.Stop()`.

### Capturing a trace: via `go test`

If the code you want to trace is exercised by a test or benchmark, you do not need to touch the source at all:

```bash
go test -trace=trace.out -run=TestThing ./...
```

The testing framework starts and stops the tracer around the whole test run for you. This is the easiest way to trace a specific code path.

### Capturing a trace: via HTTP (`net/http/pprof`)

For a running server, import the pprof HTTP handlers and hit the trace endpoint:

```go
import _ "net/http/pprof"
```

Then, with the server running:

```bash
curl -o trace.out http://localhost:6060/debug/pprof/trace?seconds=5
```

This records a 5-second trace of the live server — exactly the right tool when production latency is the problem.

### Viewing: `go tool trace`

```bash
go tool trace trace.out
```

This launches a local web server and opens a page with several links. The two you will use most as a junior:

- **"View trace by proc"** — the timeline. Horizontal lanes for each P, with coloured bars showing which goroutine ran when, plus GC and syscall activity. This is the marquee view.
- **"Goroutine analysis"** — a table of every goroutine grouped by what function it ran, with a breakdown of where its time went (running, blocked on network, waiting on the scheduler, etc.).

There are also profile-style links ("Scheduler latency profile", "Network blocking profile", "Synchronization blocking profile", "Syscall blocking profile") that present blocking causes as flame-graph-style profiles. Those are the trace's answer to "where is the *waiting* going?"

### `runtime/trace` vs `runtime/pprof`

These two packages are easy to confuse:

| | `runtime/trace` | `runtime/pprof` |
|---|---|---|
| Produces | An execution **trace** (timeline of events) | A **profile** (statistical aggregate) |
| Answers | When/why goroutines ran or blocked | Where CPU/memory/lock time accumulates |
| Viewer | `go tool trace` | `go tool pprof` |
| Best for | Latency, scheduling, contention, GC | CPU hotspots, allocation hotspots |

They are complementary, not competitors. A common workflow is to use a CPU profile to find the hot function, then a trace to understand why that function is sometimes slow to *start*.

---

## Real-World Analogies

**1. A flight data recorder vs a fuel gauge.** A CPU profile is a fuel gauge: it tells you how much fuel (CPU) each engine is burning. The execution trace is the flight data recorder: a moment-by-moment log of every control input, altitude change, and stall. When the plane lands late despite plenty of fuel, only the recorder tells you it spent 20 minutes circling (waiting) before landing.

**2. A factory floor camera.** Imagine a security camera filming an assembly line. The CPU profile is a clipboard tally of "which station did the most work." The trace is the video: you can *see* a worker standing idle because the part they need is stuck upstream. The idleness is invisible on the clipboard but obvious on the video.

**3. A restaurant kitchen ticket timeline.** A profile says "the grill station cooked the most." A trace says "ticket #42 sat for 6 minutes waiting for a clean plate, then 30 seconds on the grill." The bottleneck was the *wait*, not the cooking.

**4. A subway map with timestamps.** A profile tells you which line carries the most passengers. A trace tells you that on Tuesday at 8:03 a train sat in the tunnel for 4 minutes because the platform ahead was full. The trace captures the *blocking*.

---

## Mental Models

### Model 1 — The trace is a timeline; the profile is a histogram

A profile collapses time: it tells you totals. A trace preserves time: it tells you *sequence and duration of every event*. When the question has the word "when" or "why" or "waiting" in it, reach for the trace.

### Model 2 — Waiting is first-class

In a CPU profile, a goroutine that is blocked simply does not appear (it is burning no CPU). In a trace, that same goroutine has a clearly visible *blocked* interval with a reason attached. The trace makes the invisible visible.

### Model 3 — Everything is keyed to G, M, P

The trace is fundamentally a story about the scheduler. Every bar in the timeline is "this **G**oroutine ran on this **P** (backed by this **M**achine thread) from time T1 to T2." Once you internalise G/M/P, the timeline stops looking like noise.

### Model 4 — A trace is heavier than a profile

A CPU profile samples a few hundred times per second — almost free. A trace records *every* scheduling event, which can be millions per second on a busy program. That means traces are larger and a touch more intrusive, so you capture short windows (a few seconds), not hours.

### Model 5 — Three capture paths, one viewer

In code (`trace.Start`/`Stop`), via test (`-trace`), or via HTTP (`/debug/pprof/trace`). All three produce the same kind of file, and all three are read by the same `go tool trace`.

---

## Pros & Cons

### Pros

- **Reveals waiting, blocking, and scheduling** that a CPU profile cannot see.
- **Nanosecond-precision timeline** of goroutine and GC behaviour.
- **Built into the standard library and toolchain** — no third-party dependency.
- **Multiple capture methods** for tests, code, and live servers.
- **Shows GC impact directly** — you can see exactly when GC stole time from your goroutines.
- **Much cheaper since Go 1.21** — the tracer rewrite slashed overhead.

### Cons

- **Traces are large.** A few seconds of a busy server can be tens or hundreds of MB.
- **Some overhead while tracing.** Lower than it used to be, but not zero — you capture short windows.
- **Steeper learning curve than a profile.** The timeline is dense; reading it takes practice.
- **Not a distributed tracer.** It traces *one process's* scheduler — it is not OpenTelemetry spans across services (a frequent confusion; see [04-opentelemetry-in-go](../04-opentelemetry-in-go/junior.md)).
- **Best on short windows.** Hours-long traces are impractical to capture and to open.

---

## Use Cases

You should reach for the execution tracer when:

- **The program is slow but CPU usage is low.** Classic sign of blocking/waiting — exactly what the trace shows.
- **You suspect lock contention.** The synchronization blocking profile pinpoints contended mutexes.
- **Latency is spiky.** A trace shows whether a spike lines up with a GC pause or a scheduler stall.
- **You suspect goroutines are starved.** The scheduler latency profile shows time spent runnable-but-not-running.
- **You want to see GC's real cost** to a specific request, not just aggregate GC stats.
- **A goroutine "disappears" for a while** and you want to know what it was blocked on.

You should **not** reach for it when:

- The program is plainly CPU-bound — a CPU profile is simpler and lighter.
- You need cross-service request tracing — that is distributed tracing (OpenTelemetry), a different topic.
- You need to trace for hours — the trace would be enormous.

---

## Code Examples

### Example 1 — Tracing a whole program

```go
package main

import (
    "os"
    "runtime/trace"
    "sync"
)

func main() {
    f, err := os.Create("trace.out")
    if err != nil {
        panic(err)
    }
    defer f.Close()

    if err := trace.Start(f); err != nil {
        panic(err)
    }
    defer trace.Stop()

    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            sum := 0
            for j := 0; j < 1_000_000; j++ {
                sum += j
            }
        }()
    }
    wg.Wait()
}
```

Run it, then:

```bash
go run .
go tool trace trace.out
```

Open "View trace by proc" — you will see eight goroutines spread across your CPUs.

### Example 2 — Tracing via a test

No source changes needed:

```bash
go test -trace=trace.out -run=TestPipeline ./pipeline
go tool trace trace.out
```

The tracer wraps the entire test run.

### Example 3 — Tracing a live server

```go
package main

import (
    "log"
    "net/http"
    _ "net/http/pprof" // registers /debug/pprof/* handlers
)

func main() {
    go func() {
        log.Println(http.ListenAndServe("localhost:6060", nil))
    }()
    // ... your real server ...
    select {}
}
```

While it runs:

```bash
curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=5'
go tool trace trace.out
```

You just captured 5 seconds of the live process.

### Example 4 — Trace and CPU profile side by side

```bash
go test -bench=BenchmarkWork -cpuprofile=cpu.out -trace=trace.out ./...
go tool pprof  cpu.out     # where the CPU time goes
go tool trace  trace.out   # when/why goroutines ran or blocked
```

Two views of the same run. The contrast teaches you which tool to use next time.

### Example 5 — Bounding the trace window

You rarely want to trace the whole program. Trace just the interesting phase:

```go
trace.Start(f)
processOneBatch()   // only this is recorded
trace.Stop()
```

A small window produces a small, readable trace.

---

## Coding Patterns

### Pattern: defer Stop immediately after Start

```go
if err := trace.Start(f); err != nil {
    return err
}
defer trace.Stop()
```

Pairing them prevents the classic "started a trace but never stopped it, so the file is empty/corrupt" bug.

### Pattern: a `-trace` flag on your binary

```go
var traceFile = flag.String("trace", "", "write execution trace to file")

func main() {
    flag.Parse()
    if *traceFile != "" {
        f, _ := os.Create(*traceFile)
        defer f.Close()
        trace.Start(f)
        defer trace.Stop()
    }
    run()
}
```

Now any user can capture a trace without recompiling: `./app -trace=trace.out`.

### Pattern: HTTP endpoint for production

Importing `net/http/pprof` for its side effects wires up `/debug/pprof/trace` automatically. Keep that endpoint bound to localhost or behind auth — it is operational, not public.

---

## Clean Code

- **Always `defer trace.Stop()`** right after a successful `trace.Start`. An unstopped trace produces an unusable file.
- **Check the error from `trace.Start`.** It returns an error if a trace is already running.
- **Trace short windows, not whole programs**, unless the program is short. Smaller traces open faster and read clearer.
- **Name trace files descriptively** (`trace-checkout-slow.out`), not just `trace.out`, when you keep several.
- **Do not leave `trace.Start` in hot production paths permanently.** Capture on demand; do not record continuously (until you learn the flight recorder, senior level).

---

## Product Use / Feature

The execution tracer underpins real operational features:

- **Latency investigations.** "p99 of `/checkout` doubled" — capture a 5s trace during the spike and look for GC pauses or lock contention.
- **Capacity planning.** The trace shows whether goroutines are CPU-starved (scheduler latency) under load, signalling you need more cores or fewer goroutines.
- **Regression triage.** Compare a trace from a fast release with one from a slow release to spot a new blocking pattern.
- **On-call runbooks.** "If the service is slow but CPU is low, grab a trace from `/debug/pprof/trace?seconds=5`" is a standard playbook line.

---

## Error Handling

The tracer itself rarely fails, but a few errors are worth knowing.

### `trace.Start` returns "tracing already enabled"

Only one trace can run at a time per process. If you call `trace.Start` while a trace (or a `go test -trace`) is active, it errors. Always check the return value:

```go
if err := trace.Start(f); err != nil {
    log.Printf("could not start trace: %v", err)
}
```

### Empty or truncated trace file

Almost always means `trace.Stop()` never ran — the program exited (or `os.Exit`/`panic`) before the deferred stop. `os.Exit` does **not** run deferred functions; call `trace.Stop()` explicitly before exiting.

### `go tool trace` fails to open the file

If the file is from a much newer or older Go version than your installed toolchain, the format may not match. Use the same Go version to capture and to view.

### Out of disk space

A busy program can write a large trace fast. Bound the window (a few seconds) and ensure the target disk has room.

---

## Security Considerations

- **Traces leak internals.** A trace contains stack traces, function names, and timing — potentially revealing code structure and request patterns. Treat trace files as sensitive artifacts.
- **Protect the HTTP endpoint.** `/debug/pprof/trace` (and all of `net/http/pprof`) must never be exposed on a public interface without authentication. Bind it to `localhost` or put it behind an authenticated admin route.
- **User annotations may carry data.** If you log values with `trace.Log` (middle level), avoid putting secrets or PII into trace messages — the trace is a file someone will open.
- **Capturing a trace has overhead**, so an attacker who can trigger continuous tracing on a public endpoint has a denial-of-service lever. Another reason to lock down the endpoint.

---

## Performance Tips

- **Trace short windows.** A few seconds is almost always enough to see a pattern.
- **The 1.21+ tracer is cheap**, but not free — do not leave continuous tracing on in production hot paths.
- **Prefer `go test -trace`** for reproducible local investigations; it is the least intrusive.
- **Capture during the symptom**, not before or after. A trace of a healthy period tells you little about the slow period.
- **Use the blocking profiles** inside `go tool trace` ("Synchronization blocking profile", etc.) to jump straight to the cause instead of scrolling the raw timeline.

---

## Best Practices

1. **Pair `trace.Start` with `defer trace.Stop()`** every single time.
2. **Reach for the trace when CPU is low but latency is high**; reach for a CPU profile when CPU is high.
3. **Use the right capture method:** test for local code, HTTP for live servers, in-code for a specific phase.
4. **Match Go versions** between capture and `go tool trace`.
5. **Bound the window** to a few seconds to keep traces readable.
6. **Start with the goroutine analysis and blocking profiles**, then drill into the raw timeline only when you have a lead.
7. **Do not confuse this with distributed tracing** — `runtime/trace` is one process's scheduler, not cross-service spans.
8. **Secure the pprof/trace HTTP endpoint.**

---

## Edge Cases & Pitfalls

### Pitfall 1 — `os.Exit` skips `defer trace.Stop()`

`os.Exit` (and an unrecovered fatal in some paths) does not run deferred functions. Your trace file is left incomplete. Call `trace.Stop()` explicitly before exiting.

### Pitfall 2 — Two tracers at once

A `go test -trace` already starts the tracer; if your code *also* calls `trace.Start`, the second call errors. Do not embed `trace.Start` in code you then run under `-trace`.

### Pitfall 3 — Tracing the whole program when you wanted one phase

You end up with a huge file dominated by startup noise. Bound the window around the interesting work.

### Pitfall 4 — Expecting cross-service spans

The execution trace stops at the process boundary. A slow downstream HTTP call shows up only as "this goroutine was blocked on a network read for 300ms" — not as a span in the downstream service. For cross-service, use OpenTelemetry.

### Pitfall 5 — Confusing the two `go tool` commands

`go tool pprof` reads profiles; `go tool trace` reads traces. Feeding a trace to pprof (or vice versa) fails confusingly.

### Pitfall 6 — Version mismatch on capture/view

A trace captured with Go 1.22 may not open with a Go 1.19 `go tool trace`. Keep the toolchain consistent.

---

## Common Mistakes

- **Forgetting `defer trace.Stop()`**, leaving an empty trace file.
- **Using a CPU profile for a latency problem** (or a trace for a CPU hotspot) — wrong tool, wasted hours.
- **Exposing `/debug/pprof/trace` publicly.**
- **Tracing for too long**, producing a file too large to open.
- **Calling `os.Exit` before the trace flushes.**
- **Assuming the trace shows other services** — it does not; it is intra-process.
- **Reading the raw timeline first** instead of starting from the goroutine analysis and blocking profiles.

---

## Common Misconceptions

> *"The execution trace is just a more detailed CPU profile."*

No. A CPU profile samples on-CPU stacks; it is blind to waiting. The trace records *all* scheduling events, including blocking. They answer different questions.

> *"`runtime/trace` does distributed tracing like Jaeger/OpenTelemetry."*

No. `runtime/trace` traces one process's goroutine scheduler. Distributed tracing (spans across services) is OpenTelemetry — a separate topic ([04-opentelemetry-in-go](../04-opentelemetry-in-go/junior.md)). The shared word "trace" causes endless confusion.

> *"Tracing freezes my program."*

Modern tracing (1.21+) does not stop the world to start. There is overhead, but the program keeps running.

> *"A trace and a profile are interchangeable."*

They share the goal of understanding performance but are mechanically and conceptually different — events vs samples, timeline vs histogram.

> *"I should leave tracing on all the time."*

No — capture short windows on demand. (Continuous, snapshot-on-demand tracing is the *flight recorder*, a senior topic.)

---

## Tricky Points

- **Network and disk I/O show up as blocking/syscall events**, not as CPU time. That is why the trace, not the profile, finds I/O stalls.
- **Only one trace runs per process at a time.** `trace.Start` errors if one is already active.
- **`go test -trace` and in-code `trace.Start` conflict** — pick one.
- **`go tool trace` is a local web server**, not a static report. It needs the original trace file present while you browse.
- **The trace includes GC events**, so you can directly correlate a latency spike with a GC pause.
- **Scheduler latency** (runnable-but-not-running) is its own profile inside the tool — a subtle cause of slowness that nothing else surfaces as clearly.

---

## Test

Try this in a scratch folder.

```bash
mkdir trace-test
cd trace-test
go mod init example.com/tt
cat > main.go <<'EOF'
package main

import (
    "os"
    "runtime/trace"
    "sync"
)

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    var mu sync.Mutex
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()
            for j := 0; j < 100000; j++ {
            }
            mu.Unlock()
        }()
    }
    wg.Wait()
}
EOF
go run .
go tool trace trace.out
```

Expected: `go tool trace` opens a browser. Because 100 goroutines fight over one mutex, the "Synchronization blocking profile" will show heavy blocking on `mu`.

Now answer:
1. Which link in `go tool trace` shows time spent waiting on the mutex? (Answer: Synchronization blocking profile.)
2. Would a CPU profile of this program reveal the mutex contention as clearly? (Answer: no — the waiting goroutines burn no CPU.)
3. What happens if you remove `defer trace.Stop()`? (Answer: the file is likely empty/truncated.)
4. Is this trace showing other processes? (Answer: no — only this process.)

---

## Tricky Questions

**Q1.** My CPU profile shows nothing hot, but the program is slow. What now?

A. That is the textbook case for a trace. Low CPU + high latency means time is going to *waiting* — blocking, scheduler latency, or GC — none of which a CPU profile shows. Capture a trace and look at the blocking profiles.

**Q2.** Can I run a CPU profile and a trace at the same time?

A. Yes — they are independent subsystems. `go test -cpuprofile=cpu.out -trace=trace.out` captures both in one run.

**Q3.** Why is my trace file 400 MB?

A. The program is busy and you traced for too long. Each scheduling event is recorded; a busy server emits millions per second. Trace a shorter window.

**Q4.** Does `trace.Stop()` block?

A. It flushes buffered events and stops recording; it returns quickly. The cost is paid during recording, not at stop.

**Q5.** I see "tracing already enabled" — why?

A. Another trace is active. Common when you call `trace.Start` in code *and* run under `go test -trace`. Use one or the other.

**Q6.** Is the trace endpoint safe to leave on in production?

A. The *capability* is fine; the *exposure* must be controlled. Bind `net/http/pprof` to localhost or behind authentication. Never expose it publicly.

**Q7.** Will the trace show me which downstream service was slow?

A. No. It shows your goroutine was blocked on a network read for some duration, but not what happened on the other end. For that, use distributed tracing (OpenTelemetry).

**Q8.** Does tracing change my program's timing?

A. Slightly — there is overhead, so absolute timings shift a little. But the *relative* picture (who blocks on what) is what you read, and that stays valid.

**Q9.** Can I open a trace without internet?

A. Yes. `go tool trace` runs entirely locally; it serves the UI from your own machine.

**Q10.** Should beginners learn the trace or the profile first?

A. The profile first (simpler, lighter), then the trace once you hit a latency problem the profile cannot explain.

---

## Cheat Sheet

```go
// In code
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()
defer f.Close()
```

```bash
# Via test
go test -trace=trace.out ./...

# Via live server (import _ "net/http/pprof")
curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=5'

# View any trace
go tool trace trace.out

# Capture trace AND cpu profile together
go test -trace=trace.out -cpuprofile=cpu.out ./...
```

```
Which tool?
  high CPU, hot function   -> go tool pprof (CPU profile)
  low CPU, high latency    -> go tool trace (execution trace)
  waiting / blocking / GC  -> go tool trace
  cross-service request    -> OpenTelemetry (not this!)
```

| Symptom | Tool | View |
|---------|------|------|
| Lock contention | trace | Synchronization blocking profile |
| Goroutine starvation | trace | Scheduler latency profile |
| I/O stalls | trace | Network/Syscall blocking profile |
| GC pauses | trace | Timeline (GC lanes) |
| CPU hotspot | pprof | flat/cumulative |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence how the execution trace differs from a CPU profile
- [ ] Name three things the tracer records that a CPU profile cannot see
- [ ] Capture a trace in code with `trace.Start`/`trace.Stop`
- [ ] Capture a trace via `go test -trace`
- [ ] Capture a trace from a live server via `/debug/pprof/trace`
- [ ] Open a trace with `go tool trace` and find the goroutine analysis
- [ ] Explain why `defer trace.Stop()` matters
- [ ] State that `runtime/trace` is intra-process, not distributed tracing
- [ ] Decide between a profile and a trace for a given symptom
- [ ] Explain why a trace is heavier than a profile

---

## Summary

The execution tracer records timestamped scheduling events — goroutine lifecycle, blocking, syscalls, GC, and P state — into a trace file you open with `go tool trace`. Its unique value is that it sees **waiting**: lock contention, scheduler latency, GC pauses, and I/O stalls that a CPU profile, which only samples on-CPU time, is blind to.

Capture a trace three ways: in code with `trace.Start`/`trace.Stop`, via `go test -trace`, or from a live server via `net/http/pprof`'s `/debug/pprof/trace`. View any of them with `go tool trace`, starting from the goroutine analysis and blocking profiles before drilling into the raw timeline.

Always `defer trace.Stop()`. Trace short windows. Use a profile for CPU hotspots and a trace for latency problems. And remember: this traces *one process's scheduler* — it is not distributed tracing.

---

## What You Can Build

After learning this:

- **A `-trace` flag** on your CLI or server that captures an execution trace on demand.
- **An operational runbook** that captures a 5s trace from a live service during a latency spike.
- **A latency investigation workflow** that uses a trace to find lock contention or GC pauses.
- **A side-by-side analysis** that pairs a CPU profile with a trace to choose the next optimization.

You cannot yet:
- Annotate your own logical tasks and regions in the trace (next: middle.md — `trace.NewTask`, `trace.WithRegion`)
- Use the flight recorder to snapshot the recent past on an anomaly (senior.md)
- Reason about tracer overhead and the binary event format (professional.md)

---

## Further Reading

- [`runtime/trace` package documentation](https://pkg.go.dev/runtime/trace) — official, authoritative.
- [`go tool trace` command documentation](https://pkg.go.dev/cmd/trace) — what the viewer shows.
- [The Go Blog: "More predictable benchmarking with testing.B.Loop"](https://go.dev/blog/) — general profiling/tracing context.
- [Go 1.21 release notes — execution tracer](https://go.dev/doc/go1.21) — the low-overhead rewrite.
- [Diagnostics guide](https://go.dev/doc/diagnostics) — how tracing fits with profiling and debugging.

---

## Related Topics

- [17.1 `runtime/pprof` & Profiling](../01-runtime-pprof-profiling/junior.md) — the complementary profiler
- [17.2 `net/http/pprof` Endpoints](../02-net-http-pprof/junior.md) — the HTTP capture surface
- [17.4 OpenTelemetry in Go](../04-opentelemetry-in-go/junior.md) — distributed tracing (the *other* "tracing")
- The Go scheduler (G, M, P) — what the timeline actually shows
- Garbage collection — the GC events visible in a trace

---

## Diagrams & Visual Aids

```
Profile vs Trace:

  CPU PROFILE (sampling)            EXECUTION TRACE (events)
  -----------------------           ------------------------
  "where does CPU go?"              "when/why did Gs run/block?"

  json.Unmarshal  42% ████          time →
  db.Query        18% ██            P0  [G1 run][GC][G1 run]
  (waiting?)       —  (invisible)   P1  [G2 run][   blocked on mu   ]
                                    P2  [        idle        ][G3]
  blind to waiting                  waiting is fully visible
```

```
Three ways to capture, one way to view:

  in code        trace.Start(f) / trace.Stop()  ┐
  via test       go test -trace=trace.out       ├──> trace.out ──> go tool trace
  via HTTP       /debug/pprof/trace?seconds=5    ┘
```

```
go tool trace landing page (the links you use):

  ┌───────────────────────────────────────────────┐
  │ View trace by proc        ← the timeline       │
  │ Goroutine analysis        ← per-goroutine time │
  │ Scheduler latency profile ← runnable-not-run   │
  │ Network blocking profile  ← waiting on net I/O │
  │ Sync blocking profile     ← waiting on mutex   │
  │ Syscall blocking profile  ← waiting in syscall │
  └───────────────────────────────────────────────┘
```

```
The G/M/P story every bar tells:

   P0 lane:  ┌─── G7 ───┐┌─ GC ─┐┌──── G7 ────┐
             run         assist   run
                              ▲
                "this Goroutine ran on this P,
                 on this M (OS thread), from T1 to T2"
```
