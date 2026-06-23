# `runtime/trace` & Application Tracing — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What does the Go execution tracer record, and how is it different from a CPU profile?

**Model answer.** The execution tracer is an *event recorder*, not a sampler. It records timestamped scheduling and runtime events: goroutine lifecycle (created, started, blocked, unblocked, ended), which P ran which G, GC phases, syscall boundaries, and blocking on channels/mutexes/network. A CPU profile, by contrast, *samples* the on-CPU call stack a few hundred times per second and tells you where CPU time goes. The decisive difference: a CPU profile is blind to *waiting* — a parked goroutine burns no CPU, so the profiler never sees it — while the trace's whole strength is showing waiting. Reach for the trace when the program is slow but CPU is low; reach for the profile when CPU is high.

**Common wrong answers.**
- "It's a more detailed CPU profile." (No — different mechanism, different question. Events vs samples.)
- "It samples goroutines." (No — it records *every* scheduling event, it does not sample.)
- "It does distributed tracing." (No — that is OpenTelemetry; this is one process's scheduler.)

**Follow-up.** *Name three things the trace sees that a CPU profile cannot.* — Lock-wait time, scheduler latency (runnable-but-not-running), and GC pauses/assist on the wall clock.

---

### Q2. How do you capture a trace, and how do you view it?

**Model answer.** Three capture paths, one viewer. In code: `trace.Start(w)` then `defer trace.Stop()`. Via test: `go test -trace=trace.out`. Via a live server: import `net/http/pprof` and `curl 'http://localhost:6060/debug/pprof/trace?seconds=5'`. All three produce the same kind of file, which you open with `go tool trace trace.out` — it launches a local web UI with the timeline and analysis views.

**Common wrong answers.**
- "You open it with `go tool pprof`." (No — `pprof` reads profiles; `trace` reads traces. They are different tools.)
- "You need internet to view it." (No — `go tool trace` runs entirely locally.)

**Follow-up.** *Why `defer trace.Stop()` immediately after `Start`?* — `Stop` flushes the buffers and writes the trailing markers; without it the file is empty or truncated.

---

### Q3. Why might a trace file be empty or refuse to open?

**Model answer.** Two classic causes. Empty/truncated: `trace.Stop()` never ran because the program exited via `os.Exit`, `log.Fatal`, or an unrecovered panic — none of which run deferred functions — so the buffers were never flushed. Refuses to open: the Go version that captured the trace differs from the `go tool trace` viewing it; the trace format is versioned, and the reader only understands a bounded range.

**Common wrong answer.** "The program was too fast." (No — even a tiny trace is valid if `Stop` ran.)

**Follow-up.** *How do you trace a program that calls `os.Exit`?* — Call `trace.Stop()` explicitly right before the exit, not just in a `defer`.

---

### Q4. What is the difference between `runtime/trace` and `runtime/pprof`?

**Model answer.** `runtime/trace` produces an execution *trace* — a timeline of timestamped events — viewed with `go tool trace`; it answers "when and why did goroutines run or block." `runtime/pprof` produces a *profile* — a statistical aggregate of samples — viewed with `go tool pprof`; it answers "where does CPU/memory/lock time accumulate." Trace is heavier (records every event), so you capture short windows; pprof is lighter (sampled), so it can run longer. They are complementary: a CPU profile finds the hot function, a trace explains why it is sometimes slow to *start*.

**Follow-up.** *Can you run both at once?* — Yes, independent subsystems: `go test -cpuprofile=cpu.out -trace=trace.out`.

---

### Q5. Is the execution tracer safe to use in production?

**Model answer.** Yes, with discipline. Since the Go 1.21 rewrite the tracer is much cheaper (no stop-the-world at start, cheaper per-event recording), so a short bounded capture is acceptable. The rules: bound the window (a few seconds), do not leave full tracing always-on in a hot path, gate the capture endpoint behind auth, and treat trace files as sensitive (they contain stacks and timing). For continuous coverage, use the flight recorder rather than always-on tracing.

**Follow-up.** *What is the overhead?* — Single-digit-percent CPU on a typical server while recording, more on a process with very fine-grained scheduling. Measure it on your own workload rather than trusting a number.

---

## Middle

### Q6. What is the difference between a task, a region, and a log?

**Model answer.** Three annotation primitives. A **task** (`trace.NewTask`) is a logical operation — a request, a job — that *can span goroutines*; it is propagated via `context.Context`, so anything created with the derived ctx is attributed to it even on another goroutine. A **region** (`trace.WithRegion` or `StartRegion`/`End`) marks a contiguous span of code on a *single goroutine*; it must begin and end on the same goroutine and be LIFO-nested. A **log** (`trace.Log`/`Logf`) is an instantaneous keyed marker — "cache miss", "retry #2". Rule of thumb: task for cross-goroutine logical work, region for an on-goroutine phase, log for a point-in-time event.

**Common wrong answer.** "Regions can span goroutines like tasks." (No — regions are single-goroutine and matched by a per-goroutine nesting stack; tasks are matched by an ID propagated through context.)

**Follow-up.** *Why can a task span goroutines but a region cannot?* — At the wire level, task begin/end events are paired by a task ID carried in the context, so they can fire on different goroutines; region begin/end events are paired by popping a per-goroutine stack, so they must stay on one goroutine.

---

### Q7. My annotations are missing in the viewer. What went wrong?

**Model answer.** Almost always a context-threading bug. `trace.NewTask` returns a *derived* context carrying the task ID. If you then call `WithRegion`/`Log` with the *original* context instead of the derived one, those events carry no task ID and are not attributed to the task — so the task looks empty. The fix is to thread the `NewTask`-returned `ctx` through everything. A secondary cause is a forgotten `defer task.End()`, which makes the task appear to run until the trace ends.

**Follow-up.** *How would you confirm the ctx-threading theory?* — Check that the region/log calls receive the exact variable `NewTask` returned, not a shadowed or original `ctx`.

---

### Q8. How do you read the four blocking profiles, and what does each find?

**Model answer.** All four attribute *time not running* to the call sites responsible, as pprof-style profiles derived from the event stream. **Scheduler-latency profile**: time runnable-but-not-running — goroutine starvation / CPU saturation. **Synchronization blocking profile**: time blocked on channels and `sync` primitives — your lock-contention detector. **Network blocking profile**: time blocked in the network poller — slow upstreams or saturated connections. **Syscall blocking profile**: time blocked in syscalls — disk I/O or blocking cgo. The reading order: goroutine analysis first to learn *what kind* of waiting dominates, then the matching blocking profile to learn *where*, then the timeline to *see* it.

**Common wrong answer.** "They show CPU usage." (No — they show *blocked/waiting* time, the opposite of CPU profiles.)

**Follow-up.** *A blocking profile is in pprof format — what can you do with that?* — Save it and open it in `go tool pprof`, not only in the trace viewer.

---

### Q9. What does the trace show about garbage collection, and why does it matter?

**Model answer.** The trace puts GC on the *same timeline* as your work: GC cycle start/end, mark and sweep phases, the short stop-the-world phases, and — critically — *mark assist*, where an allocating goroutine is conscripted to do GC work because allocation outpaced the background workers. This matters because it lets you *correlate* a slow request with GC: you can see the request's region overlap an active GC cycle and watch the request's own goroutine doing assist work instead of request work. No aggregate GC metric can make that "this GC assist was on the critical path of *this* request" claim.

**Follow-up.** *You see GC assist hurting a request — first fix?* — Reduce allocation in the hot path (pooling, fewer per-request allocations), found via a heap profile. Tuning `GOGC`/`GOMEMLIMIT` is the second lever, not the first.

---

### Q10. Why is bounding the trace window important?

**Model answer.** Trace size scales with *scheduling activity*, not wall-clock time. A busy server can emit hundreds of MB in a few seconds because every scheduling event is recorded. A short window keeps the file small enough to (a) write without perturbing the process, (b) ship off-box, and (c) open quickly — `go tool trace` parses the whole file into memory before serving the UI, so a 1 GB trace can take minutes and a lot of RAM. Patterns repeat, so a few seconds is almost always enough signal.

**Follow-up.** *What if you need continuous coverage?* — Use the flight recorder, which keeps a bounded rolling window instead of streaming everything.

---

## Senior

### Q11. When do you choose a trace over pprof or metrics?

**Model answer.** By the *shape* of the question. Metrics answer "is p99 trending up over time" — cheap, continuous, aggregate. pprof answers "how much CPU/memory does X consume" — resource consumption. The trace answers "why was *this* request slow when CPU was idle" — wall-clock causality. The decisive rule: pprof and metrics tell you about resource *consumption*; the trace tells you about *time and causality*. When the symptom is "slow despite spare capacity," resource tools are blind by construction — only the trace sees the gap between runnable and running. In practice it is a relay: a metric alerts, a CPU profile rules out a hot function, then a trace explains the waiting.

**Common wrong answer.** "Always use a trace, it has the most detail." (No — for a CPU-bound process, pprof is lighter and more direct; the trace answers a question you are not asking.)

**Follow-up.** *p50 is fine but p99 is terrible — which tool?* — Trace. Tail latency lives in waiting (contention, GC, starvation, slow downstream), which only the trace sees.

---

### Q12. Explain the flight recorder and the problem it solves.

**Model answer.** On-demand tracing has a timing problem: the symptom is a spike that happened 90 seconds ago, and by the time you hit the trace endpoint it is gone. `?seconds=5` captures the *next* five seconds, not the past. The flight recorder fixes this — it keeps a rolling, bounded, in-memory window of recent trace data continuously, and dumps it only when *you* decide something interesting happened, capturing the *past*. You configure it with `SetPeriod` (how much history to retain) and `SetSize` (memory cap), and dump with `WriteTo`, which writes a self-contained, openable trace. It was experimental in `golang.org/x/exp/trace` as `FlightRecorder` and went GA as `runtime/trace.FlightRecorder` in Go 1.25.

**Common wrong answer.** "It records everything to disk continuously." (No — it keeps a *bounded* in-memory window and discards the old; that is what makes its cost predictable.)

**Follow-up.** *Why is the dump always a valid trace even though old history was discarded?* — The 1.21 format is generational; each generation is self-contained, and a dump begins at a generation boundary, so you never get half a generation.

---

### Q13. Walk me through diagnosing goroutine starvation.

**Model answer.** Starvation is "ready to run but no P will run it" — invisible to CPU profiles (no CPU burned while runnable) and to metrics (they see only the latency). I open the **scheduler-latency profile**, the only tool that measures runnable-but-not-running directly; a fat entry attributes the wait to the call site that spawned the queued goroutines. On the timeline I look for a gap between a goroutine's "became runnable" marker and "started running," across many goroutines at once. Common causes: too many goroutines for too few Ps (fix: bound concurrency with a worker pool or semaphore); `GOMAXPROCS` set to the host CPU count inside a constrained cgroup (fix: set it to the cgroup limit); or a non-yielding goroutine hogging a P. The key insight: starvation looks *exactly* like a slow downstream from the outside — only the scheduler-latency profile distinguishes "waiting for a CPU" from "waiting for the network."

**Follow-up.** *Container shows high latency, low CPU, and you see starvation — what do you check first?* — `GOMAXPROCS` vs the cgroup CPU limit; the runtime seeing 64 host cores while the cgroup grants 2 manufactures starvation.

---

### Q14. How do you diagnose lock contention with a trace?

**Model answer.** The **synchronization blocking profile** is the detector — it attributes blocked time to the call sites that blocked on channels and `sync` primitives, so a fat entry on `(*Mutex).Lock` names the hot lock. I confirm on the timeline by looking for the contention *signature*: a staircase where one goroutine holds the lock and runs while the others sit blocked, then the lock hands off and the next runs while the rest still wait — many goroutines, one running at a time, on a resource that should allow parallelism. The worst variant is a lock held *across* a blocking call (I/O inside the critical section), which queues everyone behind the network; the fix is to move the I/O out of the lock. The trace's edge over the mutex profile is the timeline — you watch the queue form and confirm the contention is on the critical path of your slow requests.

**Follow-up.** *Sync profile shows a hot RWMutex on a read-heavy path — fix?* — If reads dominate, ensure you are using `RLock`, shard the lock, or move to a structure that does not serialise reads.

---

### Q15. How does `runtime/trace` relate to distributed tracing (OpenTelemetry)?

**Model answer.** They are different layers that *compose*, and conflating them is the most expensive misconception about `runtime/trace`. OpenTelemetry propagates a trace/span context across services over the wire and answers *which service in the chain is slow*. `runtime/trace` records one process's scheduler and answers *why that service is internally slow*. They do not share an identifier automatically, but you bridge them: when you open a `trace.NewTask` for a request, stamp the OTel trace/span ID into a `trace.Log`, and trigger your flight-recorder dump from the same middleware that flags the slow span. Then an incident flows top-down: metric alerts → distributed trace localises to service B → the logged span ID points at the intra-process trace dumped from B → B's blocking profile names the contended lock. `runtime/trace` is the last mile.

**Common wrong answer.** "`runtime/trace` tasks and OTel spans are the same thing." (No — same word, completely different scale: intra-process scheduler vs cross-service propagation.)

**Follow-up.** *The intra-process trace shows a 300ms network block — what does it tell you about the downstream?* — Only that your goroutine waited 300ms on a read; *which* downstream service ate it is the distributed trace's job.

---

### Q16. Design the tracer overhead budget for enabling tracing on a production service.

**Model answer.** First, decompose the cost: per-event recording (cheap, per-P, lock-free append), stack collection (the expensive part, an unwind per event that carries a stack), and batch flushing (I/O bandwidth to the writer). Then *measure* it on the real workload — run steady-state load with and without a trace active and compare throughput and tail latency; that delta is the budget. Implications: never leave full tracing always-on (it is a self-inflicted latency regression); bound the window so overhead applies only while recording; watch the writer on I/O-constrained boxes (writing the trace can perturb the latency you are measuring, so write to fast local disk or stream off-box); and for continuous coverage use the flight recorder, whose cost is bounded because it records into a fixed-size buffer.

**Follow-up.** *Why is the flight recorder's overhead more predictable than always-on tracing?* — It records into a bounded buffer and discards old data rather than streaming everything to a writer, so its cost does not grow with trace duration.

---

## Staff / Architect

### Q17. Design a production tracing strategy for a fleet of Go services.

**Model answer.** Layered, default-off, automated.

1. **Baseline observability is metrics and pprof, not tracing.** Metrics are always-on and cheap; pprof is on-demand. Full tracing is never the standing default.
2. **Run a flight recorder per service** — a bounded rolling window (e.g. 5s / 10MB) continuously. Predictable cost, captures the past.
3. **Trigger dumps on anomalies**: an in-request latency threshold, an SLO-breach watchdog, and a manual admin endpoint, each naming a reason.
4. **Gate the diagnostics surface** — bind to a private interface, wrap in auth. A public trace endpoint is a data leak and a DoS lever.
5. **Annotate for the domain** — a `NewTask` per request, regions per phase, and the OTel trace/span ID logged so intra-process traces correlate with distributed ones.
6. **Build a parsing pipeline** — ingest flight-recorder dumps with `golang.org/x/exp/trace`'s reader and auto-classify them ("dominated by sync block on the cache mutex") so on-call gets a category, not a raw file.
7. **Document the relay**: metric → distributed trace → flight-recorder dump → intra-process blocking profile, so on-call knows which tool answers which question under pressure.
8. **Ship traces off-box, expire them**, treat them as small sensitive artifacts.

**Follow-up.** *How would you stop on-call from drowning in raw trace files?* — Programmatic classification in the ingest pipeline; deliver a labelled summary plus the file, not the file alone.

---

### Q18. Explain the 1.21 tracer rewrite and why it mattered architecturally.

**Model answer.** Pre-1.21, starting a trace required a stop-the-world pause to snapshot the goroutine set, and per-event recording (especially stack collection) was expensive — together making tracing too costly to run aggressively in production. The 1.21 rewrite did two structural things. First, it removed the STW-at-start by adopting a **generational** format: the trace is divided into self-contained generations, each re-establishing the context (goroutine set, stacks) needed to interpret it, so the tracer can establish a consistent picture without freezing the world. Second, the generational format is **streamable** — a consumer can begin decoding at any generation boundary. That streamability is exactly what makes the flight recorder possible: it retains only the recent generations and discards the rest, and because each is self-contained, a dump of the recent past is a valid, openable trace. So the rewrite is what turned tracing from a heavyweight offline tool into something you can run continuously (via the flight recorder) in production.

**Follow-up.** *Why can a 1.20 `go tool trace` not open a 1.22 trace?* — The format is versioned; the major break was at 1.21, and the reader only understands a bounded range of versions. Capture and view with the same Go version.

---

### Q19. How would you parse a trace programmatically, and what would you build with it?

**Model answer.** Use the reader in `golang.org/x/exp/trace`: open a `trace.NewReader` over the trace bytes and loop `ReadEvent()`, switching on `Kind()` and accumulating — the events expose their time, goroutine, and kind-specific detail (region, task, state transition, log). Every `go tool trace` view is just a deterministic pass over this same stream, so anything the tool computes, you can recompute in the shape you need. What I would build: CI assertions on trace shape ("no `db.query` region exceeds 50ms in this benchmark trace, fail the build otherwise"); an anomaly classifier that ingests flight-recorder dumps and labels them by dominant blocking category; and custom aggregations the built-in views do not surface (mark-assist time per task, scheduler-latency percentiles). The caveat: the reader is in `x/exp`, explicitly unstable — pin the version and expect to adjust on upgrades, which is the price of programmatic access years before the API stabilises.

**Follow-up.** *When is `go tool trace` enough vs the reader?* — For one-off human analysis, the tool. For a *pipeline* (CI, ingest, dashboards), the reader, despite its instability.

---

### Q20. A service has high p99 latency, normal p50, and 40% CPU. Walk the full investigation.

**Model answer.** The shape — bad tail, fine median, spare CPU — screams *waiting*, so this is a trace problem, not a pprof one.

1. **Confirm with metrics**: spare capacity plus a bad tail rules out a CPU bottleneck.
2. **Capture during the symptom** with the flight recorder, dumping on requests exceeding ~150ms, so the trace is centred on a *slow* request, not a random window.
3. **Goroutine analysis** on the slow request's goroutines: read the time breakdown — execution vs scheduler wait vs sync block vs network block vs GC. The dominant bucket is the lead.
4. **Branch on the dominant bucket**: scheduler wait → scheduler-latency profile (starvation; check `GOMAXPROCS` vs cgroup); sync block → synchronization profile (contention; look for a lock held across I/O); network block → the slowness is downstream, hand off to the distributed trace; GC → correlate the request's region with a GC cycle on the timeline and confirm assist, then take a heap profile.
5. **Open the timeline** around the request's task to *see* the gap and confirm the story — e.g. the goroutine became runnable, sat 40ms while all Ps did GC assist, then ran in 3ms.
6. **Fix by category** and re-measure: bound concurrency, fix `GOMAXPROCS`, shrink the critical section, reduce allocation, or escalate the downstream.

The trace does not always hand you the fix, but it hands you the *category*, which closes most of the gap.

**Follow-up.** *What if goroutine analysis shows the slow time is mostly "execution," not waiting?* — Then it is genuinely CPU on the critical path; switch to a CPU profile — the trace told you it was the wrong tool, which is itself a useful answer.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Trace vs CPU profile in one line? | Trace records every scheduling event (sees waiting); profile samples on-CPU stacks (blind to waiting). |
| View a trace with? | `go tool trace` (not `go tool pprof`). |
| Why is the trace file empty? | `trace.Stop()` never ran (`os.Exit`/`log.Fatal`/panic). |
| Task vs region? | Task spans goroutines (ctx-propagated); region is single-goroutine, LIFO-nested. |
| Annotations missing? | Wrong `ctx` threaded — pass the `NewTask`-derived one. |
| Which profile finds lock contention? | Synchronization blocking profile. |
| Which finds starvation? | Scheduler-latency profile. |
| Is it distributed tracing? | No — one process's scheduler; OTel is cross-service. |
| Flight recorder GA in? | Go 1.25 (`runtime/trace.FlightRecorder`); experimental before in `x/exp/trace`. |
| Why does the flight recorder capture the *past*? | It keeps a bounded rolling in-memory window of recent generations. |
| Tracer got cheap in which release? | Go 1.21 (generational, streamable, no STW at start). |
| Parse a trace in code with? | `golang.org/x/exp/trace`'s reader (`NewReader`/`ReadEvent`). |

---

## Mock Interview Pacing

A 30-minute interview on the execution tracer might cover:

- 0–5 min: warm-up — Q1, Q2, Q4. Establish that the candidate knows trace vs profile and the three capture paths.
- 5–15 min: middle — Q6 (task/region/log), Q8 (blocking profiles), Q9 (GC). The annotation model and the blocking profiles are the field-test of real usage.
- 15–25 min: a senior scenario — Q13 (starvation), Q14 (contention), or Q15 (distributed-tracing relationship). Drive into a diagnosis they have actually done.
- 25–30 min: a curveball — Q17 (production strategy) or Q20 (full investigation).

If the candidate claims production tracing experience, go straight to Q12 (flight recorder) and Q15 (it-is-not-distributed-tracing) — both separate people who have *run* tracing from people who have only read about it. If they have only read about it, stay in middle territory and probe Q7 (missing annotations) and Q10 (why bound the window). A staff candidate should reach Q17 or Q18 within fifteen minutes and be able to explain *why* the 1.21 rewrite makes the flight recorder possible.
