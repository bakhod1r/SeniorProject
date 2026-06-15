# `runtime/trace` & Application Tracing — Optimization

> Honest framing first: the execution tracer is not "slow" — since the Go 1.21 rewrite it is cheap enough to run aggressively. What is genuinely worth optimizing is the *workflow* around tracing: when you capture, how much you capture, how you keep overhead bounded and traces small, how you get the capture to land on the incident, and how you automate the analysis. Each entry below states the problem, shows a "before" and "after", and the realistic gain. The closing sections cover measurement and when to *not* trace.

---

## Optimization 1 — Bound the capture window

**Problem:** Trace size and capture overhead both scale with *scheduling activity*. A long window on a busy server produces a multi-hundred-MB-to-GB file that is slow to write, slow to ship, and slow to open — for no extra signal, because the patterns repeat.

**Before:**
```bash
curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=120'
# 1.8 GB; go tool trace takes minutes and a lot of RAM
```

**After:**
```bash
curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=3'
# tens of MB; opens in seconds
```

**Expected gain:** 10–40x smaller file, proportionally less write overhead during capture, and a trace that opens in seconds instead of minutes. The single highest-leverage trace optimization.

---

## Optimization 2 — Scope the trace to one phase, not the whole program

**Problem:** Tracing a whole binary captures startup, warmup, and shutdown noise that dwarfs the phase you care about, both in size and in the analysis time spent scrolling past it.

**Before:**
```go
trace.Start(f)
defer trace.Stop()
// startup + warmup + steady state + shutdown, all recorded
run()
```

**After:**
```go
warmup()
trace.Start(f)
processSteadyStateBatch() // ONLY this is recorded
trace.Stop()
```

**Expected gain:** A smaller, focused trace where the interesting phase is the *whole* file, not a 5% slice buried in noise. Faster to open and far faster to read.

---

## Optimization 3 — Use the flight recorder instead of always-on tracing

**Problem:** Teams that want "continuous tracing for incidents" sometimes leave `trace.Start` running forever. That adds steady overhead in the hot path and writes an unbounded file. It is the most expensive way to get the least useful artifact.

**Before:**
```go
trace.Start(f) // never stopped; grows without bound, steady overhead
serve()
```

**After:**
```go
fr := trace.NewFlightRecorder() // runtime/trace on 1.25+, else x/exp/trace
fr.SetPeriod(5 * time.Second)
fr.SetSize(10 << 20)            // bounded memory
_ = fr.Start()
// dump only on an anomaly: fr.WriteTo(file)
```

**Expected gain:** Overhead drops from "always recording everything to disk" to a *bounded* in-memory cost, and you still capture the recent past on demand. The flight recorder is the correct primitive for continuous coverage.

---

## Optimization 4 — Capture the past, not the future (dump-on-anomaly)

**Problem:** `?seconds=N` records the *next* N seconds. By the time a human (or an alert) reacts to a latency spike, the spike is over, and the trace shows a healthy window. You spend overhead and get nothing.

**Before:**
```bash
# spike at 14:02:31; reaction at 14:04:00:
curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=10' # healthy
```

**After:**
```go
// latency middleware dumps the rolling window when a request is slow:
start := time.Now()
next.ServeHTTP(w, r)
if time.Since(start) > 150*time.Millisecond {
    f, _ := os.CreateTemp("", "anomaly-*.trace")
    _, _ = fr.WriteTo(f) // the window leading UP TO the slow request
    f.Close()
}
```

**Expected gain:** The captured trace is *centred on the anomaly* instead of a random healthy window. This is the difference between a useful incident trace and wasted overhead.

---

## Optimization 5 — Size the flight-recorder buffer for your event rate

**Problem:** `SetPeriod` and `SetSize` are both upper bounds; the effective window is whichever binds first. An undersized buffer silently retains far less history than the requested period, so dumps cover milliseconds instead of seconds.

**Before:**
```go
fr.SetPeriod(30 * time.Second) // "I want 30s"
fr.SetSize(1 << 20)            // 1 MiB → actually holds ~0.5s on a busy box
```

**After:**
```go
fr.SetPeriod(30 * time.Second)
fr.SetSize(64 << 20)           // enough bytes to actually hold ~30s for THIS workload
```

**Expected gain:** Dumps that cover the window you intended. Measure your event rate first (Optimization 12) so the cap is sized, not guessed.

---

## Optimization 6 — Scope regions to meaningful phases, not every function

**Problem:** Wrapping every small function in a region floods the trace with annotation events, inflates size, and buries the phases that matter under noise. Annotations are not free — each is an event.

**Before:**
```go
trace.WithRegion(ctx, "parseHeader", func() { parseHeader() })   // tiny
trace.WithRegion(ctx, "validateField", func() { validate(f) })   // tiny, in a loop
trace.WithRegion(ctx, "appendByte", func() { buf = append(...) })// absurd
```

**After:**
```go
trace.WithRegion(ctx, "decode", func() { decode(r) })   // one meaningful phase
trace.WithRegion(ctx, "db.query", func() { rows = q() }) // another
```

**Expected gain:** A trace whose regions map to *phases you reason about* (decode, query, render), smaller annotation overhead, and a readable task breakdown instead of thousands of micro-regions.

---

## Optimization 7 — Reduce goroutine churn (smaller trace and faster program)

**Problem:** A process that spawns a goroutine per tiny unit of work generates enormous traces (millions of lifecycle events) — and is usually slow for the *same* reason (scheduler overhead, starvation). The trace size is a symptom of a design problem.

**Before:**
```go
for _, item := range millionItems {
    go process(item) // a goroutine per item
}
```

**After:**
```go
sem := make(chan struct{}, runtime.GOMAXPROCS(0))
for _, item := range millionItems {
    sem <- struct{}{}
    go func(it Item) { defer func() { <-sem }(); process(it) }(item)
}
```

**Expected gain:** Far fewer lifecycle events (smaller trace), and usually lower latency too — bounded concurrency removes the scheduler-latency starvation the trace would otherwise reveal. A rare two-for-one: the optimization that shrinks the trace also speeds the program.

---

## Optimization 8 — Disable tracing where it adds no signal

**Problem:** Some code paths (idle loops, health checks, background reapers) generate scheduling events that pad the trace without contributing to the question you are asking.

**Before:** Trace the whole server while investigating one endpoint's latency, so the trace is dominated by the health-check goroutine and the metrics flusher.

**After:** Drive load *only* on the endpoint under investigation during the capture window, or scope the in-code trace to the handler path. Capture during a load test that exercises the suspect path, not idle background traffic.

**Expected gain:** A higher signal-to-noise trace where the relevant goroutines dominate, so the goroutine analysis and blocking profiles point at the real cause instead of background chatter.

---

## Optimization 9 — Write the trace to fast local storage

**Problem:** The writer goroutine flushing batches competes for I/O. Writing the trace to a slow network mount perturbs the very latency you are measuring and inflates apparent capture cost.

**Before:**
```bash
curl -o /data/trace.out '...'   # /data is a slow NFS mount
```

**After:**
```bash
curl -o /tmp/trace.out '...'    # local SSD
# then ship /tmp/trace.out off-box over a fast path
```

**Expected gain:** Capture overhead drops to the tracer's *actual* cost instead of the tracer-plus-slow-disk cost, and the measured latency is no longer distorted by the act of measuring.

---

## Optimization 10 — Convert blocking profiles to pprof for sharing

**Problem:** The four blocking profiles live inside the `go tool trace` UI, which needs the (possibly large) trace file present and a running local server. Sharing "here is the lock contention" with a colleague means shipping the whole trace.

**Before:** Send the 200 MB `trace.out` and say "open it and look at the synchronization profile."

**After:** The blocking profiles are real pprof profiles — save the one that matters and share *it*:
```bash
# from the go tool trace UI, download the synchronization blocking profile, then:
go tool pprof -http=:0 sync-block.pb.gz   # small, self-contained
```

**Expected gain:** A small, focused artifact (kilobytes, not megabytes) that a colleague opens in `go tool pprof` without the whole trace — faster handoff and easier archival.

---

## Optimization 11 — Automate trace-on-SLO-breach

**Problem:** Relying on a human to capture a trace during an incident means the capture is late (Optimization 4) and inconsistent. The trace you most need is the one nobody was awake to take.

**Before:** Runbook step: "if p99 is bad, SSH in and `curl` the trace endpoint." (Often happens minutes late, or not at all.)

**After:** A watchdog goroutine dumps the flight recorder automatically on breach:
```go
func slowWatch(fr *trace.FlightRecorder, p99 func() time.Duration, slo time.Duration) {
    for range time.Tick(time.Second) {
        if p99() > slo {
            f, _ := os.CreateTemp("", "slo-breach-*.trace")
            _, _ = fr.WriteTo(f)
            f.Close()
            log.Printf("SLO breach: dumped %s", f.Name())
        }
    }
}
```

**Expected gain:** Every breach produces a trace, automatically, centred on the breach — no human in the loop, no late capture. The incident artifact exists before anyone pages.

---

## Optimization 12 — Measure tracer overhead before trusting it

**Problem:** "The tracer is cheap since 1.21" is true on average and wrong for your specific workload if it does very fine-grained scheduling. Enabling tracing on a budget you did not measure is how you ship a latency regression.

**Before:** Enable continuous tracing in production on the assumption it is free.

**After:** Measure the delta on the real workload:
```bash
hey -z 30s -c 50 http://localhost:8080/api > baseline.txt
curl -s -o /tmp/t.out 'http://localhost:6060/debug/pprof/trace?seconds=30' &
hey -z 30s -c 50 http://localhost:8080/api > traced.txt
# compare throughput and p99 between baseline and traced
```

**Expected gain:** A real overhead budget for *this* service, so the decision to enable tracing (and at what window) is grounded in numbers, not folklore.

---

## Optimization 13 — Capture trace artifacts in CI for regressions

**Problem:** Performance regressions in scheduling behaviour (a new lock, a goroutine explosion, a phase that started blocking) are invisible to unit tests and easy to miss in review. They surface only in production.

**Before:** No scheduling-level coverage; a PR that introduces lock contention passes CI and regresses prod.

**After:** A benchmark produces a trace, a parser (`golang.org/x/exp/trace` reader) asserts on its shape, and the artifact is uploaded for inspection:
```yaml
- run: go test -trace=trace.out -bench=BenchmarkHandler -run='^$' ./...
- run: go run ./tools/traceassert -max-region=db.query=50ms trace.out
- uses: actions/upload-artifact@v4
  with: { name: trace, path: trace.out }
```

**Expected gain:** Scheduling regressions caught at PR time, plus an archived trace artifact per build for after-the-fact comparison. Trace shape becomes a tested invariant.

---

## Optimization 14 — Right-size the diagnostic: trace, pprof, or metric

**Problem:** Reaching for a trace by reflex wastes overhead and analysis time when a lighter tool answers the question. The trace is the heavy instrument; it should be the *last* one you reach for, not the first.

**Before:** Capture a trace for every performance question, including "is p99 trending up this week" (a metric) and "what burns CPU" (a profile).

**After:** Match the tool to the question shape:
```text
trend over time          → metric (cheap, continuous)
CPU / allocation hotspot → pprof profile (sampled, light)
"slow despite idle CPU"  → trace (heavy, but the only tool that sees waiting)
```

**Expected gain:** No tracer overhead spent on questions a metric or profile answers more cheaply, and faster answers because the right tool is more direct. The cheapest trace is the one you correctly decided not to take.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For tracing workflows the most useful signals are:

```bash
# How big is the trace, and how long to open?
ls -lh trace.out
time go tool trace trace.out   # parse + serve time

# Tracer overhead on YOUR workload (compare the two):
hey -z 30s -c 50 http://localhost:8080/api                              # baseline
( curl -s -o /tmp/t.out 'http://localhost:6060/debug/pprof/trace?seconds=30' & \
  hey -z 30s -c 50 http://localhost:8080/api )                          # traced

# Flight-recorder window actually retained (dump and check coverage):
# open the dump in go tool trace and read the time span it covers vs SetPeriod

# Event-rate proxy for sizing SetSize: bytes per second of tracing
# (trace size / window seconds) on a representative load
```

Track two metrics in particular: the **capture overhead delta** (the cost you pay to trace) and the **time-to-open** of the resulting trace (the cost you pay to analyse). A "trace optimization" that does not move those is not one.

---

## When NOT to Trace

The execution tracer is the heavy instrument. It is the wrong reach for many questions.

- **Trend questions** — "is latency creeping up over the week" is a *metric*, not a trace. Tracing answers point-in-time causality, not trends.
- **CPU or allocation hotspots** — a *profile* (pprof) is lighter and more direct. The trace is overkill and answers a different question.
- **Cross-service "which service is slow"** — that is *distributed tracing* (OpenTelemetry), a different layer. `runtime/trace` stops at the process boundary.
- **A healthy system you are "just curious" about** — tracing has overhead and produces a large artifact; capture when you have a *specific* causality question, not on spec.
- **Long-horizon recording** — hours-long traces are impractical to capture and to open. If you need continuous coverage, that is the flight recorder's bounded window, not a long `trace.Start`.

Trace when you have a concrete causality question that resource tools cannot answer: "why was *this* request slow when the CPU was idle." For everything else, lean on metrics and profiles — and spend the overhead you would have spent tracing on the question that actually needs it.

---

## Summary

The execution tracer is cheap since Go 1.21; the workflow around it is what you optimize. The wins come from treating capture as a *budgeted, targeted* operation: bound the window, scope to one phase, prefer the flight recorder (bounded memory) over always-on tracing, and capture the *past* on an anomaly instead of guessing the future with `?seconds=N`. Keep traces small and readable by scoping regions to real phases and reducing goroutine churn; keep capture honest by writing to fast local storage and measuring the overhead on your own workload. Automate the capture (dump-on-SLO-breach) and the analysis (CI trace assertions, blocking profiles exported to pprof) so the incident trace exists before anyone pages.

The biggest optimization, though, is upstream of all of these: deciding honestly whether a trace is the right instrument at all. For trends use a metric, for hotspots use a profile, for cross-service slowness use distributed tracing — and reserve the trace for the one question only it can answer: "slow despite spare capacity, *why*."
