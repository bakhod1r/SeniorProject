# `runtime/trace` & Application Tracing — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Tracing-or-Not Decision: First Principles](#the-tracing-or-not-decision-first-principles)
3. [When a Trace Beats pprof and Metrics](#when-a-trace-beats-pprof-and-metrics)
4. [Overhead Budgeting in Production](#overhead-budgeting-in-production)
5. [Trace Size Management](#trace-size-management)
6. [The Flight-Recorder-on-Anomaly Pattern](#the-flight-recorder-on-anomaly-pattern)
7. [Correlating `runtime/trace` with Distributed Tracing](#correlating-runtimetrace-with-distributed-tracing)
8. [Diagnosing Tail Latency](#diagnosing-tail-latency)
9. [Diagnosing Goroutine Starvation](#diagnosing-goroutine-starvation)
10. [Diagnosing GC Assist and Allocation Pressure](#diagnosing-gc-assist-and-allocation-pressure)
11. [Diagnosing Lock Contention](#diagnosing-lock-contention)
12. [Diagnosing Syscall and Network Blocking](#diagnosing-syscall-and-network-blocking)
13. [A Production Tracing Strategy](#a-production-tracing-strategy)
14. [Anti-Patterns](#anti-patterns)
15. [Senior-Level Checklist](#senior-level-checklist)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

A senior engineer's relationship with the execution tracer is not "do I know `trace.Start`" — junior.md covered that, and middle.md covered tasks, regions, and logs. The senior question is: *when is a trace the right instrument for an incident, what does it cost the running process, and how do I get a useful trace out of production without standing in front of the timeline at the moment the symptom occurs?*

The execution tracer is the only standard-library tool that sees **wall-clock causality**: which goroutine was runnable but not running, which one held a lock while others queued, when GC stole a core mid-request, how long a syscall parked an M. Metrics tell you *that* p99 doubled. pprof tells you *where* CPU went. The trace tells you *why a specific request was slow when the CPU was idle* — and that "why" is where most production latency mysteries actually live.

This file is about *strategy and diagnosis*. After reading it you will:
- Decide when a trace earns its overhead versus when metrics or pprof suffice
- Budget tracer overhead and bound trace size for a production capture
- Use the flight recorder to snapshot the recent past on an anomaly, instead of guessing when to press record
- Correlate an intra-process trace with a distributed-tracing span so the two systems compose
- Read the scheduler-latency, syscall, network, sync, and GC views to diagnose real incidents: tail latency, starvation, GC assist, P-stealing, and lock contention

The mechanics are trivial. Knowing *which view answers which incident*, and getting the capture to happen at the right microsecond, is the job.

---

## The Tracing-or-Not Decision: First Principles

The execution tracer is a tool, not a default. Reaching for it is downstream of two real questions: *do I have a wall-clock-causality question?* and *can I afford to record every scheduling event for a few seconds?*

### What a trace actually buys you

Three things, none of which metrics or pprof provide:

1. **Wall-clock causality.** A trace records the *order and duration* of every scheduling transition. "G7 became runnable at T, but no P picked it up until T+40ms" is a fact only the trace knows. Metrics aggregate it away; pprof never samples a parked goroutine.
2. **Correlation across subsystems on one timeline.** A GC mark phase, a syscall, a lock wait, and your request's region all sit on the *same* nanosecond axis. You can *see* that the slow request overlapped a GC assist — a correlation no other tool draws for you.
3. **Logical attribution via tasks/regions.** With annotation (middle.md), the trace maps scheduler reality onto *your* vocabulary: "the `db.query` region of request `req-42` spent 18ms runnable-but-not-running."

### What a trace costs you

- **Overhead while recording.** Far lower since the Go 1.21 rewrite, but non-zero. Every scheduling event is recorded; on a busy server that is millions of events per second.
- **Size.** A few seconds of a busy process is tens to hundreds of MB. The artifact must be written, shipped off-box, and parsed.
- **Analysis time.** The timeline is dense. A trace is a *targeted* instrument; it rewards you when you have a specific causality question and punishes you when you "just look."

### When the answer is yes

- Latency is high but CPU is low — the textbook trace case.
- p99/p999 is bad while p50 is fine — tail latency lives in waiting, which only the trace sees.
- You suspect contention, starvation, or GC interference and need to *prove* it.
- A goroutine "disappears" for a window and you need to know what parked it.

### When the answer is no

- The process is plainly CPU-bound — pprof is lighter and more direct.
- You need a *trend* over hours or days — that is a metric, not a trace.
- The question is "which service in the chain is slow" — that is distributed tracing, a different tool (and a different topic, [04-opentelemetry-in-go](../04-opentelemetry-in-go/senior.md)).

### When the answer is "yes, but capture it surgically"

The common senior position: do not run the tracer continuously, and do not guess when to press record. Either gate a short capture behind an admin endpoint that an on-call engineer hits during the symptom, or — better — run a **flight recorder** that keeps a rolling in-memory window and dumps it when an anomaly fires. Both are covered below.

---

## When a Trace Beats pprof and Metrics

The three diagnostics overlap, and choosing wrong wastes hours. The senior decision rule:

| Question shape | Right tool | Why |
|----------------|-----------|-----|
| "How much CPU does X burn?" | CPU profile (pprof) | Samples on-CPU stacks; blind to waiting |
| "What allocates?" | heap profile (pprof) | Attributes allocation to call sites |
| "Is p99 trending up over the week?" | metrics | Cheap, continuous, aggregate |
| "Why was *this* request slow when CPU was idle?" | **trace** | Only the trace sees runnable-but-not-running, lock waits, GC interference on the wall clock |
| "Is one mutex serialising my goroutines?" | trace (or mutex profile) | The sync blocking profile pinpoints the contended call site *and* shows the queue forming on the timeline |
| "Did GC steal time from this request?" | **trace** | GC phases sit on the same timeline as your region; the correlation is visible |
| "Are goroutines starved for a P?" | **trace** | The scheduler-latency profile is the only tool that measures runnable-but-not-running directly |

The sharp framing: **pprof and metrics tell you about resource consumption; the trace tells you about time and causality.** When the symptom is "slow despite spare capacity," resource tools are blind by construction, and only the trace can see the gap between *runnable* and *running*.

A caveat worth internalising: the trace is *not* a replacement for the others. The mature workflow is a relay — a metric alerts on p99, a CPU profile rules out a hot function, and *then* a trace explains the waiting. Each hands off to the next.

---

## Overhead Budgeting in Production

Before you enable the tracer on a production process, you must budget what it costs. The Go 1.21 tracer rewrite changed these numbers materially, so anything you read from before 1.21 is pessimistic.

### What the overhead is made of

- **Per-event recording.** Each scheduling transition appends an event to a per-P buffer. The hot path is a few atomic operations and a buffer write — cheap, but multiplied by event rate.
- **Stack collection.** Many events carry a stack. Stack unwinding is the dominant per-event cost; the 1.21 tracer made it cheaper but it is still the expensive part.
- **Buffer flushing.** Full per-P buffers are handed to a writer goroutine. On a very busy process this is real I/O bandwidth.

### Budgeting rule of thumb

For a typical server workload on Go 1.21+, expect single-digit-percent CPU overhead while a trace is active, and proportionally more on a process that does a huge amount of cheap, fine-grained scheduling (lots of tiny goroutines, heavy channel traffic). The honest senior move is to **measure it on your own workload**, not to trust a blog number:

```bash
# Steady-state throughput without tracing
hey -z 30s -c 50 http://localhost:8080/api > baseline.txt

# Same load while a trace runs (capture via the endpoint in parallel)
curl -s -o /tmp/t.out 'http://localhost:6060/debug/pprof/trace?seconds=30' &
hey -z 30s -c 50 http://localhost:8080/api > traced.txt
```

Compare throughput and tail latency between the two runs. That delta *is* your overhead budget for this workload.

### Budgeting implications

- **Never leave the tracer always-on.** Continuous full tracing in a hot path is a self-inflicted latency regression. If you want continuous coverage, use the flight recorder (rolling window) — it has a *bounded* cost because it records into a fixed-size buffer and discards the old, rather than streaming everything to disk.
- **Bound the window.** Overhead applies only while recording. A 5-second capture costs five seconds of overhead, then nothing.
- **Watch the writer.** On an I/O-constrained box, the act of *writing* the trace can perturb the very latency you are measuring. Write to a fast local disk or stream off-box, not to a slow network mount in the request path.

---

## Trace Size Management

Trace size scales with *scheduling activity*, not wall-clock time. A mostly-idle process traced for a minute may produce a few MB; a busy one traced for five seconds may produce hundreds. Senior practice is to control size before it becomes an operational problem.

### Levers that reduce size

- **Shorten the window.** The single biggest lever. `?seconds=3` instead of `?seconds=30` is a 10x reduction with usually no loss of signal — patterns repeat.
- **Capture during the symptom only.** A trace of a healthy period is large *and* useless. The flight recorder is the precise tool here: it holds only the recent past and dumps a bounded window.
- **Reduce goroutine churn.** This is a *design* lever, not a capture lever, but a process that spawns a goroutine per tiny unit of work produces enormous traces (and is often slow for the same reason). Pooling or batching shrinks both the latency and the trace.
- **Trace one phase, not the whole program.** A tight `trace.Start`/`Stop` (or flight-recorder dump) around the suspect phase beats tracing startup, warmup, and shutdown noise.

### Operational handling of large traces

- **Ship off-box.** Do not let multi-hundred-MB traces accumulate on a production disk. Stream the capture straight to object storage or pull it to a workstation.
- **`go tool trace` parse cost.** The viewer parses the whole file into memory before it serves the UI. A 1 GB trace can take minutes to open and a lot of RAM. Keep captures small enough to open in seconds.
- **Retention.** Treat trace files as sensitive (they contain stacks, timing, and any data you put in `trace.Log`) and short-lived. Delete after analysis.

---

## The Flight-Recorder-on-Anomaly Pattern

The deepest problem with on-demand tracing is *timing*: the symptom is a 200ms spike that happened 90 seconds ago, and by the time on-call hits the trace endpoint, it is gone. The **flight recorder** solves this. It keeps a rolling, bounded, in-memory window of trace data continuously, and writes it out only when *you* decide something interesting happened.

### API status (read this carefully)

The flight recorder shipped experimentally in `golang.org/x/exp/trace` as `trace.FlightRecorder`, and was promoted to the standard library as `runtime/trace.FlightRecorder` in Go 1.25. The shape is the same; the import path differs by toolchain version. On 1.25+, prefer the standard-library form; on 1.21–1.24, use the `x/exp/trace` form.

### The pattern

```go
import "runtime/trace" // Go 1.25+; else golang.org/x/exp/trace

var fr = trace.NewFlightRecorder()

func main() {
    fr.SetPeriod(5 * time.Second) // keep ~5s of recent history
    fr.SetSize(10 << 20)          // bounded buffer; advisory upper bound
    if err := fr.Start(); err != nil {
        log.Fatal(err)
    }
    // ... serve traffic; the recorder runs continuously but bounded ...
}

// Called when an anomaly fires — a slow request, an SLO breach, a watchdog.
func dumpTraceOnAnomaly(reason string) {
    f, err := os.CreateTemp("", "anomaly-*.trace")
    if err != nil {
        return
    }
    defer f.Close()
    if _, err := fr.WriteTo(f); err != nil {
        log.Printf("flight recorder dump failed: %v", err)
        return
    }
    log.Printf("wrote anomaly trace %s (reason=%s)", f.Name(), reason)
}
```

`SetPeriod` controls *how much recent history* the buffer retains; `SetSize` bounds *how much memory* it may use (the effective window is whichever limit binds first). `WriteTo` snapshots the current rolling window into a normal trace file you open with `go tool trace`.

### Where the trigger comes from

The flight recorder is only as good as the thing that decides to dump it. Real triggers:

- **In-request latency threshold.** A middleware times each request; if one exceeds a threshold, it calls `dumpTraceOnAnomaly`. You get a trace of the *exact* slow request's recent past.
- **SLO-breach watchdog.** A background goroutine watches a latency histogram or error rate; on breach, it dumps.
- **Manual.** An admin endpoint that dumps on demand — strictly better than `?seconds=5` because it captures the *past*, not the next five seconds.

### Why this is the senior default for production

On-demand tracing answers "what is happening now"; the flight recorder answers "what just happened." Production incidents are almost always the latter. A bounded rolling buffer has a *predictable* overhead and produces a *small, targeted* trace centred on the anomaly — exactly the two properties on-demand full tracing lacks.

---

## Correlating `runtime/trace` with Distributed Tracing

The single most expensive misconception about `runtime/trace` is that it *is* distributed tracing. It is not (junior.md and middle.md both hammer this). The senior skill is not just knowing they differ — it is making them *compose* so an incident flows cleanly from one to the other.

### The two layers

- **Distributed tracing (OpenTelemetry — sibling topic [04-opentelemetry-in-go](../04-opentelemetry-in-go/senior.md))** propagates a trace/span context across services over the wire. It answers *which service in the chain is slow*. Its span on service B is "service B handled this request in 240ms."
- **`runtime/trace`** records *one process's* scheduler. It answers *why service B was internally slow*. Its task/region is "inside service B, the `cache.lookup` region spent 200ms blocked on a mutex."

### Making them compose

The two systems do not share an identifier automatically, but you can bridge them so a distributed span points you at the right intra-process trace:

1. **Stamp the OTel trace/span ID into a `trace.Log`.** When you open a `trace.NewTask` for a request, log the distributed IDs:
   ```go
   ctx, task := trace.NewTask(ctx, "handle")
   defer task.End()
   sc := otelTrace.SpanContextFromContext(ctx)
   trace.Logf(ctx, "otel", "trace_id=%s span_id=%s", sc.TraceID(), sc.SpanID())
   ```
   Now, given a slow span ID from your distributed-tracing UI, you can search the intra-process trace's task logs for the matching request.

2. **Name the task after the operation.** Use the same operation name in both systems (`handle`, `checkout`) so the human reading both UIs has one vocabulary.

3. **Trigger the flight-recorder dump from the same place OTel marks the span as slow.** A single latency middleware can both set a span attribute (`slow=true`) and call `dumpTraceOnAnomaly`. The distributed UI flags the slow request; the dumped intra-process trace explains it.

### The incident flow

The mature pipeline reads top-down: a metric alerts on p99; the distributed trace localises the slowness to service B; the flag on that span (or the logged trace/span ID) points you at the intra-process trace dumped from service B; the intra-process trace's blocking profile names the contended lock or the GC assist. Four tools, one handoff chain — and `runtime/trace` is the *last mile* that explains the within-process "why."

---

## Diagnosing Tail Latency

Tail latency (p99/p999 bad while p50 is fine) is the canonical case where the trace earns its keep, because the tail almost always lives in *waiting*, which resource tools cannot see.

### The investigation

1. **Confirm the shape.** Metrics say p50 = 8ms, p99 = 180ms, CPU is at 40%. Spare capacity plus a bad tail screams "waiting," not "computing."
2. **Capture during the symptom.** Use the flight recorder (dump on a request exceeding ~150ms) so the trace is *centred on a slow request*, not a random window.
3. **Open goroutine analysis** in `go tool trace`. Read the breakdown: how much of the slow request's time was *execution* vs *scheduler wait* vs *sync block* vs *GC*. The dominant bucket is your lead.
4. **Jump to the matching blocking profile.** If scheduler wait dominates → scheduler-latency profile (starvation). If sync block dominates → synchronization profile (contention). If GC dominates → look at the GC lanes on the timeline.
5. **Open the timeline around the slow request's task.** *See* the gap. A common tail-latency picture: the request's goroutine becomes runnable, then sits for 40ms because all Ps are busy with a GC mark assist, then runs in 3ms. The 40ms is the tail, and it is pure waiting.

### What the tail usually turns out to be

- **GC interference** — the request happened to land during a GC cycle and either assisted or waited.
- **A contended lock** — most requests take it uncontended; the tail is the ones that queued.
- **Scheduler starvation** — a burst spawned more runnable goroutines than Ps, and the tail requests waited in the run queue.
- **A slow downstream** — the goroutine blocked on a network read; the trace shows the block, the distributed trace shows the culprit service.

The trace does not always tell you the *fix*, but it tells you the *category*, which is most of the battle.

---

## Diagnosing Goroutine Starvation

Starvation is "the goroutine is ready to run but no processor will run it." It is invisible to CPU profiles (the goroutine burns no CPU while runnable) and to metrics (which see only the resulting latency). The scheduler-latency profile is the only tool that measures it directly.

### Reading it

- **Scheduler-latency profile** attributes *runnable-but-not-running* time to the call sites that spawned the waiting goroutines. A fat entry means "goroutines created here spent a lot of time queued."
- **On the timeline:** look for goroutine bars that show a gap between "became runnable" (the unblock marker) and "started running." Wide gaps across many goroutines at once = saturation.

### Common causes and the senior response

- **Too many goroutines for too few Ps.** A request fans out into hundreds of goroutines; with `GOMAXPROCS` cores, most sit in the run queue. Fix: bound concurrency (a worker pool, a semaphore) so you do not create more runnable work than you can run.
- **`GOMAXPROCS` misconfigured in a container.** The classic: the runtime sees the host's 64 cores but the cgroup grants 2. The scheduler thinks it has 64 Ps' worth of parallelism; in reality the OS gives it 2 CPUs, so 62 Ps' worth of goroutines starve. The trace shows the symptom; the fix is setting `GOMAXPROCS` to the cgroup limit (or using a library that does, or relying on the automatic cgroup-aware `GOMAXPROCS` in Go 1.25+).
- **A single goroutine hogging a P without yielding.** A tight CPU loop with no preemption point (rare since async preemption in 1.14, but possible in cgo) starves others. The timeline shows one bar running uninterrupted while others queue.

The diagnostic value: starvation looks *exactly* like a slow downstream from the outside (high latency, low CPU). Only the scheduler-latency profile distinguishes "waiting for a CPU" from "waiting for the network."

---

## Diagnosing GC Assist and Allocation Pressure

GC in Go is concurrent, but it is not free, and the trace is the clearest window into *when GC stole time from a specific request*.

### What the trace shows about GC

- **GC phases on the timeline.** Dedicated GC lanes show mark and sweep activity. You can line up a slow request's region directly against an active GC cycle.
- **Mark assist.** When allocation outpaces the background mark workers, the *allocating goroutine* is conscripted to do mark work — "GC assist." On the timeline this appears as your goroutine doing GC work instead of your work. It is one of the most insidious tail-latency causes because it punishes exactly the goroutines that allocate the most.
- **STW pauses.** The remaining short stop-the-world phases (sweep termination, mark termination) show as brief moments where everything pauses. Usually sub-millisecond on modern Go, but visible.

### The senior diagnosis

1. **See the correlation.** In the trace timeline, the slow request's region overlaps a GC mark phase, and within it you see assist work attributed to the request's own goroutine.
2. **Confirm with a heap profile.** The trace tells you GC is interfering; the *heap profile* (pprof) tells you *what allocates*. This is the relay again — trace finds the symptom, heap profile finds the cause.
3. **Fix the allocation, not the GC.** The remedy is almost never "tune `GOGC`" first; it is "stop allocating so much in the hot path" — reuse buffers (`sync.Pool`), avoid per-request allocations, hoist allocations out of loops. `GOGC`/`GOMEMLIMIT` tuning is the second lever, after the allocation profile is understood.

The trace's unique contribution here is the *temporal correlation*: it proves that GC assist, specifically, was on the critical path of the slow request — a claim no aggregate GC metric can make.

---

## Diagnosing Lock Contention

Lock contention is when goroutines serialise behind a mutex, turning concurrent work into a queue. The synchronization blocking profile is the detector; the timeline is the confirmation.

### Reading it

- **Synchronization blocking profile** attributes blocked time to the call sites that blocked on channels and `sync` primitives. A fat entry on `(*Mutex).Lock` (or a specific call site under it) names the hot lock.
- **On the timeline:** the contention signature is a *staircase* — one goroutine holds the lock and runs, the others sit blocked, then the lock hands off and the next runs while the rest still wait. Many goroutines, one running at a time, on a resource that should allow parallelism.

### Common causes and responses

- **A coarse lock around too much work.** The fix is to shrink the critical section — hold the lock only around the shared mutation, not around I/O or computation that could happen outside it.
- **A single global lock on a hot path.** Shard it (`N` locks keyed by hash), switch to `sync.RWMutex` if reads dominate, or replace it with a lock-free structure or per-goroutine state.
- **Lock held across a blocking call.** The worst pattern: a goroutine holds a mutex *while* doing I/O, so every other goroutine queues behind the network. The timeline shows the holder blocked-in-syscall while a queue of blocked-on-mutex goroutines stacks up behind it. Move the I/O outside the lock.

The trace's edge over the mutex profile (pprof) is the timeline: the mutex profile gives you the aggregate, but the trace lets you *watch the queue form* and confirm that the contention is on the critical path of your slow requests, not a benign background lock.

---

## Diagnosing Syscall and Network Blocking

Time spent in syscalls and the network poller is invisible to CPU profiles (the goroutine is parked, not on-CPU) and is exactly what the syscall and network blocking profiles surface.

### Reading them

- **Network blocking profile** attributes time blocked in the network poller (socket reads/writes) to call sites. Fat entries mean slow upstreams, saturated connections, or undersized connection pools.
- **Syscall blocking profile** attributes time blocked inside syscalls — file I/O, DNS resolution, blocking `cgo` calls. Fat entries mean disk stalls or blocking C calls parking an M.

### What they distinguish

The diagnostic power is *attribution of waiting to a cause*. "The request was slow" could be CPU, lock, GC, scheduler, or I/O. The blocking profiles split the I/O slice cleanly:

- **Network block dominates** → the slowness is *downstream*. The intra-process trace stops at "blocked on a network read for 300ms"; the *distributed* trace tells you which downstream service ate the 300ms. This is precisely the handoff described in the correlation section.
- **Syscall block dominates** → the slowness is *local I/O or a blocking cgo call*. A connection-pool exhaustion, a slow disk, a synchronous DNS lookup, or a C library call that does not yield. Each has a different fix, and the syscall profile's call site tells you which.

### The senior watch-item: M-blocking and thread explosion

A goroutine blocked in a syscall parks its M; the runtime may spin up a new M to keep the Ps busy. A workload that does a lot of blocking syscalls can therefore create many OS threads. The trace's "View by thread" makes this visible (a growing thread count), and the fix is usually to bound the concurrency of the blocking operation so you do not conscript an unbounded number of OS threads.

---

## A Production Tracing Strategy

Pulling the above together into a coherent posture for a real service:

1. **Default to off.** Do not run the full tracer continuously. The baseline is metrics (always-on, cheap) and pprof endpoints (on-demand).
2. **Run a flight recorder.** Keep a bounded rolling window (e.g. 5s, 10MB cap) continuously. Its cost is predictable and small, and it captures the *past* — the only thing that matters for after-the-fact incidents.
3. **Trigger dumps on anomalies.** Wire the flight-recorder dump to (a) an in-request latency threshold, (b) an SLO-breach watchdog, and (c) a manual admin endpoint. Every dump names a reason.
4. **Gate the capture endpoint.** The trace endpoint (and `net/http/pprof`) is operational, not public — bind to localhost or put it behind authenticated admin access. A public trace endpoint is both an information leak and a DoS lever (forcing continuous tracing).
5. **Annotate for your domain.** Wrap each request in a `trace.NewTask`, wrap meaningful phases in regions, and stamp the distributed trace/span ID into a `trace.Log` so the intra-process trace correlates with the distributed one.
6. **Ship traces off-box and expire them.** Treat trace files as small, sensitive, short-lived incident artifacts — not as something that accumulates on a production disk.
7. **Define the relay.** Document the incident flow: metric → distributed trace → flight-recorder dump → intra-process blocking profile. On-call should know which tool answers which question without having to rediscover it under pressure.

---

## Anti-Patterns

- **Leaving the full tracer always-on in production.** A self-inflicted latency regression. Use the flight recorder for continuous coverage; it is bounded.
- **Guessing when to press record.** `?seconds=5` *after* the symptom captures the wrong window. The flight recorder captures the past; prefer it for incidents.
- **Reaching for a trace when CPU is the bottleneck.** A CPU-bound process wants a CPU profile. The trace is heavier and answers a question you are not asking.
- **Confusing `runtime/trace` with OpenTelemetry.** Intra-process scheduler vs cross-service spans. The shared word "trace" is responsible for an enormous amount of wasted effort.
- **Tracing the whole program for a one-request problem.** Huge file, buried signal. Trace the phase, or dump a flight-recorder window.
- **Exposing the trace endpoint publicly.** Information leak plus DoS lever. Always gate it.
- **Tuning `GOGC` before reading the allocation profile.** The trace shows GC interference; the *fix* usually starts with reducing allocation, found via a heap profile, not knob-twisting.
- **Setting `GOMAXPROCS` to the host CPU count inside a constrained container.** Manufactures scheduler starvation. The trace will show it; better to not cause it.
- **Putting secrets or PII in `trace.Log`.** The trace file is an artifact someone will open; treat its contents as logged data.
- **Holding a lock across I/O and then wondering why the sync profile is hot.** The timeline will show the queue; move the I/O out of the critical section.
- **Letting trace files accumulate on a production disk.** They are large and sensitive. Ship off-box and expire.

---

## Senior-Level Checklist

- [ ] Decide trace-vs-pprof-vs-metrics by the *shape* of the question (causality vs consumption vs trend)
- [ ] Budget and *measure* tracer overhead on your own workload before enabling in production
- [ ] Bound capture windows; manage trace size before it becomes an operational problem
- [ ] Run a flight recorder for continuous, bounded coverage instead of always-on tracing
- [ ] Wire flight-recorder dumps to latency thresholds, SLO watchdogs, and a manual endpoint
- [ ] Stamp distributed trace/span IDs into `trace.Log` so the two tracing layers compose
- [ ] Read goroutine analysis first, then the matching blocking profile, then the timeline
- [ ] Distinguish starvation (scheduler-latency) from downstream slowness (network block)
- [ ] Correlate GC assist on the timeline with a heap profile before tuning `GOGC`/`GOMEMLIMIT`
- [ ] Confirm lock contention by watching the queue form on the timeline, not just the sync profile
- [ ] Check `GOMAXPROCS` against the cgroup limit in containerised deployments
- [ ] Gate the trace/pprof endpoint; treat trace files as small, sensitive, short-lived artifacts

---

## Summary

The execution tracer is the one standard-library instrument that sees wall-clock causality: the gap between *runnable* and *running*, the lock that serialised your goroutines, the GC assist that landed on a specific request, the syscall that parked an M. That makes it the right tool for the hardest class of production problem — "slow despite spare capacity" — and the wrong tool for everything pprof and metrics already do well.

The senior responsibilities are strategic. Budget the overhead and measure it on your workload. Bound the window so traces stay small and openable. Stop guessing when to record — run a flight recorder (experimental in `golang.org/x/exp/trace`, GA as `runtime/trace.FlightRecorder` in Go 1.25) that keeps a bounded rolling window and dumps it on an anomaly, so you capture the *past* that actually contains the incident. Make `runtime/trace` compose with distributed tracing by stamping span IDs into trace logs, so an incident flows cleanly from metric to distributed trace to intra-process blocking profile.

The mechanics — `Start`, `Stop`, tasks, regions — are the easy part. Knowing which view diagnoses tail latency versus starvation versus GC assist versus contention, and getting the capture to happen at the right microsecond, is the senior skill that turns a dense timeline into a closed incident.

---

## Further Reading

- [`runtime/trace` package documentation](https://pkg.go.dev/runtime/trace) — official, authoritative; the `FlightRecorder` type lives here on Go 1.25+.
- [`go tool trace` / `cmd/trace` documentation](https://pkg.go.dev/cmd/trace) — what each view in the viewer means.
- [`golang.org/x/exp/trace`](https://pkg.go.dev/golang.org/x/exp/trace) — the experimental flight recorder and the programmatic trace reader, for Go 1.21–1.24.
- [Go diagnostics guide](https://go.dev/doc/diagnostics) — how tracing composes with profiling and metrics.
- [Go 1.21 release notes — execution tracer](https://go.dev/doc/go1.21) — the low-overhead, streamable tracer rewrite.
- [Go 1.25 release notes](https://go.dev/doc/go1.25) — `runtime/trace.FlightRecorder` going GA.
- [17.4 OpenTelemetry in Go](../04-opentelemetry-in-go/senior.md) — the distributed-tracing layer this one composes with.
