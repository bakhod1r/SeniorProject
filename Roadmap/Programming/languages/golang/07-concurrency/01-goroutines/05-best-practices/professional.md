# Goroutine Best Practices — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Rules as Runtime Invariants](#the-rules-as-runtime-invariants)
3. [`pprof.SetGoroutineLabels` and Profile-Driven Operations](#pprofsetgoroutinelabels-and-profile-driven-operations)
4. [Cost Model of Each Violation at Scale](#cost-model-of-each-violation-at-scale)
5. [Detecting Drift in Production](#detecting-drift-in-production)
6. [Tracing Discipline](#tracing-discipline)
7. [The `goleak` Algorithm and Its Limits](#the-goleak-algorithm-and-its-limits)
8. [Open Questions at the Edge](#open-questions-at-the-edge)
9. [Summary](#summary)

---

## Introduction

At professional level the rules stop being a checklist and start being a model. Each rule maps to a measurable invariant in the runtime, a metric on a dashboard, a line of code in the standard library, or a section of the Go memory model. The point is no longer "follow this rule" — the point is "given a production trace, identify which rule a regression broke." This file is for the engineer responsible for the Go fleet's concurrency health: someone who reads goroutine profiles weekly, owns the SRE side of the stack, and gets paged when the count drifts.

---

## The Rules as Runtime Invariants

Each canonical rule corresponds to a property the runtime can be queried for.

### Rule 1 (clear exit) ↔ `runtime.NumGoroutine()` stability

A healthy service's goroutine count oscillates within a bounded range. Plot `runtime.NumGoroutine()` (or `go_goroutines` from `expvar`/Prometheus) over 24 hours. The shape should be:

- Cyclical with traffic (per-request goroutines come and go).
- Bounded by configuration (worker pool sizes).
- Returning to a baseline during quiet periods.

A monotonically rising count is a leak. The invariant: the time-derivative of `NumGoroutine` averaged over an hour should be ~0 at steady state.

### Rule 2 (`Add`/`Done`) ↔ `WaitGroup` source invariants

The `sync.WaitGroup` source has internal counters with atomic accesses. The invariant: `state2.counter >= 0` at all times after `Wait` is called concurrently. The race detector and runtime check this:

```
panic: sync: negative WaitGroup counter
```

Caused by an extra `Done`, or by `Add` after `Wait`. Recognise it instantly.

### Rule 3 (loop variables) ↔ language semantics

This is a compile-time/language semantics rule. Pre-Go 1.22, the `for` loop reused variables. Post-1.22, each iteration gets fresh ones. The `go vet` analyser `loopclosure` reports the old pattern. The runtime cannot help here; the discipline is upstream.

### Rule 4 (context) ↔ `ctx.Done()` channel semantics

`context.Context` is fundamentally an interface around a `Done() <-chan struct{}`. Cancellation closes the channel. Every goroutine that reads `<-ctx.Done()` in a `select` is "linked" to the cancellation tree.

The invariant a profile can verify: after `ctx` is cancelled, every goroutine in its subtree should exit within some bounded time. If not, identify them by goroutine label or stack trace.

### Rule 5 (recover) ↔ `runtime.gopanic` flow

`recover` works by walking up the `defer` chain looking for a frame that called `runtime.gorecover`. When found, the panic is consumed. When not found, `runtime.fatalpanic` runs and the process exits.

The invariant: the goroutine creation site and the deferred recover must be in the same goroutine call frame. A `recover` in a different goroutine's frame is not in the panicking frame's defer chain and is useless.

### Rule 6 (`errgroup`) ↔ first-error semantics

`errgroup.Group.errOnce sync.Once` ensures the cancellation triggers exactly once. The invariant: `g.Wait()` returns either nil or the *first* non-nil error reported by `g.Go`. Subsequent errors are dropped (or collected if you replace with `errors.Join`-aware variant).

### Rule 7 (channels vs mutex) ↔ memory model edges

Channels and mutexes both establish happens-before edges per the Go memory model. The invariant: every read of shared state must be preceded by a happens-before edge from the write you intend to observe. The race detector verifies this.

### Rule 8 (no `time.Sleep`) ↔ deterministic synchronisation

Sleep is wall-clock-dependent; channel and mutex operations are deterministic relative to program events. The invariant: tests should be deterministic in the absence of CPU starvation. A test using `time.Sleep` violates this and produces flake.

### Rule 9 (race detector) ↔ memory model verification

The race detector implements TSan (ThreadSanitizer). Every memory access is logged with a vector clock; conflicts are reported. The invariant: no concurrent access to the same address without a connecting happens-before edge.

### Rule 10 (bound concurrency) ↔ resource budget

The invariant: `goroutines_in_flight ≤ K` where K is a function of memory budget, file descriptor budget, and downstream tolerance. K is observable. If your goroutine count exceeds K at any point, the rule is broken.

### Rule 11 (documented safety) ↔ caller contract

Not a runtime invariant; a documentation invariant. The runtime cannot help.

### Rule 12 (leak detection) ↔ profile-based assertion

`goleak.VerifyTestMain` reads the goroutine profile at test exit and asserts none remain. The invariant: at the end of every test, the live goroutine count equals the count at the start (modulo ignored backgrounds).

---

## `pprof.SetGoroutineLabels` and Profile-Driven Operations

The `runtime/pprof.SetGoroutineLabels` API attaches labels to a goroutine that show up in the goroutine profile. Use it to make profiles diagnosable.

### How it works

```go
ctx := pprof.WithLabels(ctx, pprof.Labels("task", "fetch", "url", url))
pprof.SetGoroutineLabels(ctx)
// ... goroutine runs with labels attached ...
```

Inside the profile output, every stack frame is annotated with its label set. You can filter `pprof` by label:

```bash
go tool pprof -tagfocus 'task=fetch' http://host:6060/debug/pprof/goroutine
```

This shows only goroutines with `task=fetch`. Powerful when you want to know "how many fetch goroutines are alive right now, and what are they doing?"

### Patterns that pay off

- **Label at request entry.** Every HTTP handler labels its context with the route, request ID, and user tenant (without putting PII in the label). The full goroutine tree spawned by the handler inherits the labels.
- **Label long-running workers.** Each worker pool tags itself: `pool=image-resize`, `worker_id=3`.
- **Label by phase.** A pipeline stage labels itself: `phase=decode`, `phase=process`, `phase=encode`. Now `pprof` shows which phase has the backed-up goroutines.

### Cost

Setting labels is a slice copy and a runtime hashmap update — single-digit microseconds. Don't label inside tight inner loops; label at entry to a goroutine or a phase.

### Caveat

Labels are stored in goroutine-local state. They survive across function calls inside that goroutine. They do **not** automatically propagate to children unless you call `pprof.SetGoroutineLabels` again in the child (you typically do, via the inherited `ctx`).

---

## Cost Model of Each Violation at Scale

How bad is breaking each rule, measured in observable terms?

| Rule | First-order cost per violation | Compound cost at 10 000 events |
|---|---|---|
| 1 (clear exit) | ~2-4 KB stack + closure heap leaked | 20-40 MB; eventually OOM |
| 2 (`Add`/`Done`) | Race or hang | Cascading failures, debugging hours |
| 3 (loop var) | Wrong result | Silent data corruption; hard to detect |
| 4 (context) | Slow shutdown | Pod kills, deploy windows blown |
| 5 (recover) | Process exit | Restart cascades, p99 latency spikes |
| 6 (errgroup) | Code complexity | Bugs in error/cancellation paths |
| 7 (chan vs mutex) | 10-100x perf swing | Contention hot spots, p99 spikes |
| 8 (`time.Sleep`) | Test flake | Test infrastructure cost |
| 9 (race in CI) | Undetected data race | Hidden corruption, customer impact |
| 10 (bound) | Memory spike | OOM, fleet-wide impact |
| 11 (doc safety) | Caller misuse | Race bugs in *callers' code* |
| 12 (leak detection) | Slow drift | Eventual OOM, on-call burden |

The rules with highest unit cost are 10 (bound) and 5 (recover): each can take down the process. The rules with highest compound cost are 1 (leak) and 9 (race): each accumulates silently.

---

## Detecting Drift in Production

Drift is when small violations of the rules accumulate over many releases. Detect it by alerting on signals:

### Signal 1: `go_goroutines` trend

Set up a Prometheus rule:

```yaml
- alert: GoroutineLeak
  expr: |
    deriv(go_goroutines[1h]) > 0.5
    AND go_goroutines > 1000
  for: 1h
  annotations:
    summary: "Goroutine count rising over 1h: {{ $value }} per second"
```

A positive derivative averaged over an hour, with absolute count above a threshold, is a leak in progress.

### Signal 2: panic rate

A `panics_total` counter (incremented in your `safeGo` helper). Alert on any non-zero rate:

```yaml
- alert: GoroutinePanic
  expr: increase(goroutine_panics_total[5m]) > 0
  annotations:
    summary: "Goroutine panic in {{ $labels.goroutine }}"
```

### Signal 3: in-flight count vs bound

Each worker pool exposes `pool_in_flight{name="..."}`. Compare to the configured cap:

```yaml
- alert: PoolSaturated
  expr: pool_in_flight / pool_capacity > 0.95
  for: 5m
  annotations:
    summary: "Pool {{ $labels.name }} saturated"
```

### Signal 4: context-cancel-to-exit latency

After a shutdown signal, every goroutine has a bounded time to exit. Measure how many are still alive 5 seconds after cancel:

```go
cancel()
time.AfterFunc(5*time.Second, func() {
    n := runtime.NumGoroutine()
    if n > expected {
        log.Printf("slow shutdown: %d goroutines alive", n)
    }
})
```

### Signal 5: stack-trace fingerprint changes

The unique set of stack-trace fingerprints in `pprof.Lookup("goroutine")` should be stable. A sudden new fingerprint appearing at high count is a new leak path. Diff weekly.

---

## Tracing Discipline

`runtime/trace` captures every scheduler event. Use it for one-off investigations, not for production telemetry. The professional discipline:

- **Run a 5-second trace under a representative workload.** Most concurrency questions are answered in 5 seconds of trace data.
- **Look for `proc` blocking.** A goroutine that takes a lock and runs for milliseconds blocks the local P; the trace shows the gap.
- **Look for goroutine starvation.** A goroutine that should make progress but doesn't, visible as a flat run-queue with no transitions.
- **Combine with goroutine labels.** Labels propagate into traces.

A code base with disciplined goroutine usage produces clean traces: short goroutines, predictable lifecycles, no surprises.

---

## The `goleak` Algorithm and Its Limits

`goleak.VerifyTestMain` reads the goroutine profile via `runtime.Stack` or `pprof.Lookup("goroutine")`, filters known acceptable goroutines (the test runner, GC, sysmon), and asserts the rest are empty. The algorithm:

```
profile = pprof.Lookup("goroutine").Stack
for each goroutine in profile:
    if matches any ignore filter:
        continue
    fail("leaked goroutine: " + stack)
```

It's that simple. The strengths:

- Catches the vast majority of test-induced leaks.
- Easy to add to a codebase.
- Output points directly at the leaked goroutine's stack.

The limits:

- It runs at test exit. A goroutine that leaks during the test but exits before assertion (via `t.Cleanup` or timer) is missed.
- It can't distinguish "leaked" from "expected background." You configure the ignore list.
- It doesn't help in production. Use `pprof` there.
- It increases test latency by ~100 ms per package due to the profile snapshot.

For production, the equivalent is alerting on `go_goroutines` and periodically scraping `/debug/pprof/goroutine` for offline analysis.

---

## Open Questions at the Edge

A few questions the rules don't fully answer; senior engineers form opinions:

### Should every goroutine be cancellable?

Strict reading: yes (Rule 1 + Rule 4). Pragmatic reading: trivial work (a millisecond callback) doesn't need a context. The threshold is debated. Most teams settle on "if it could ever block on I/O or take more than 1 ms, it needs context."

### How big should a worker pool be?

Litmus tests: memory budget, downstream rate limits, observed tail latency. No universal answer. Start at `2 * GOMAXPROCS` for CPU-bound, `64` for HTTP-bound, and measure.

### Is `sync.Pool` worth the complexity?

Often, no. `sync.Pool` reduces allocations but adds reasoning cost. Use only when allocation profiling shows a hot path with frequent same-type allocation.

### When does `runtime.Gosched()` help?

Almost never in modern Go. The scheduler preempts. There are obscure cases (a tight CPU loop with no function call where you want to yield to the GC's sweep) but most are myths now.

### Should `recover` log or panic-again?

Two camps. Camp "log and continue": recoverable in process, log and continue serving. Camp "log and re-panic": if a panic happened, the program is in an unknown state; restart. Pragmatic: log and continue for *handler-scoped* panics; re-panic for *invariant violations*.

These are the questions a professional Go engineer has answered for their codebase, in writing, with reasoning.

---

## Summary

The twelve canonical goroutine rules are not arbitrary discipline. Each maps to a runtime invariant, a profile signal, or a memory-model property. Each violation has an observable cost. Each violation can be detected — `goleak` for leaks at test time, `pprof` for live processes, `go_goroutines` for trend, `panics_total` for boundary-recover bugs. The professional engineer's job is to wire these signals into alerts, run profile-driven operations weekly, and lift the team's discipline so the rules become invisible — they are simply how Go is written here.
