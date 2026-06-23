# GODEBUG & `runtime/debug` — Optimization

> Honest framing first: `GODEBUG` and `runtime/debug` are not themselves performance features — they are control and observability surfaces. The "optimization" here is using them to *find* and *fix* GC, memory, and startup problems, and to *configure* the runtime correctly for an environment. The single biggest win in this space is usually a correctly sized memory limit, not a clever trick. Each entry below states the problem, shows a "before" setup, an "after" setup, and the realistic gain. The closing sections cover measurement and the cases where these knobs are the wrong tool.

---

## Optimization 1 — Cap memory with `GOMEMLIMIT` instead of over-provisioning the container

**Problem:** A service is given a large container to "avoid OOMs," but it actually OOMs intermittently because the default ratio-driven GC lets the heap spike past the container limit during bursts.

**Before:**
```bash
# 4 GiB container, default GC, no limit; still OOMs on spikes
./app
```
The heap grows by the `GOGC` ratio with no awareness of the container ceiling.

**After:**
```bash
# 4 GiB container; tell the runtime to stay under it
GOMEMLIMIT=3600MiB ./app
```
The GC now collects more aggressively as memory approaches 3600 MiB, absorbing bursts before the OOM killer fires.

**Expected gain:** OOMs on transient spikes largely disappear, often letting you *shrink* the container. The limit converts "hope the heap doesn't spike" into "the runtime actively prevents it." Cost: slightly more GC CPU near the ceiling — a good trade against a crash.

---

## Optimization 2 — Maximize throughput with `GOGC=off` plus a limit

**Problem:** A batch/throughput service spends meaningful CPU on GC because the default ratio triggers frequent collections even though plenty of memory headroom exists.

**Before:**
```bash
GOGC=100 ./batch    # GC every time heap doubles, regardless of headroom
```

**After:**
```bash
GOGC=off GOMEMLIMIT=3600MiB ./batch
```
With the ratio disabled, GC runs *only* as memory approaches the limit. The heap grows freely up to the ceiling, minimising GC cycles for throughput-bound work — while still capping memory.

**Expected gain:** On allocation-heavy batch jobs, total GC CPU drops substantially (the heap is collected far less often), improving throughput. Caveat: the heap routinely sits near the limit, so there is no low-water-mark headroom — only use this when memory near the ceiling is acceptable.

---

## Optimization 3 — Find the real GC cost before tuning anything

**Problem:** A team "optimizes GC" by guessing at `GOGC` values without knowing whether GC is even the bottleneck. Effort is wasted; results are random.

**Before:** Blind `GOGC=50` then `GOGC=200` experiments with no measurement.

**After:** Measure first, with `gctrace` for a quick read and `runtime/metrics` for the real number.
```bash
GODEBUG=gctrace=1 ./app 2> gc.log   # eyeball cumulative GC %
```
```go
// or, structured and stable:
s := []metrics.Sample{{Name: "/cpu/classes/gc/total:cpu-seconds"}}
metrics.Read(s) // fraction of CPU spent on GC
```

**Expected gain:** You discover whether GC is 2% or 25% of CPU *before* changing anything. If it's 2%, you stop and look elsewhere (allocations, locks, I/O). Measurement turns folklore into engineering — the largest "optimization" is often realising GC was never the problem.

---

## Optimization 4 — Detect the GC death spiral with the right alert

**Problem:** A too-tight memory limit puts the runtime into a GC death spiral — constant GC, collapsed throughput — but RSS stays capped, so RSS-based alerts never fire. The incident is invisible until users complain.

**Before:**
```yaml
# alert: only on memory
- alert: HighMemory
  expr: container_memory_rss > 0.9 * limit   # never fires during a spiral
```

**After:**
```yaml
# alert on GC CPU fraction, the actual symptom
- alert: GCDeathSpiral
  expr: rate(go_gc_cpu_seconds_total[5m]) / rate(process_cpu_seconds_total[5m]) > 0.25
```

**Expected gain:** The death spiral becomes visible the moment it starts, instead of after a latency complaint. This is the alert that pays for itself — RSS alone is blind to the most common memory-limit misconfiguration.

---

## Optimization 5 — Make RSS honest with `madvdontneed` under cgroups

**Problem:** Under Linux's default `MADV_FREE`, freed pages count against RSS until kernel pressure. Container dashboards show inflated memory, autoscalers over-provision, and the OOM killer's accounting is misled.

**Before:**
```bash
./app   # RSS reads ~30% high; freed memory lingers in the count
```

**After:**
```bash
GODEBUG=madvdontneed=1 ./app   # return pages eagerly; RSS reflects real usage
```

**Expected gain:** RSS tracks actual usage, so autoscaling and OOM accounting make correct decisions and you can pack containers tighter. Cost: real CPU for the eager `MADV_DONTNEED` and page faults on next use — measure it, but for memory-accounting-sensitive deployments it is usually worth it.

---

## Optimization 6 — Speed up startup by finding the slow `init`

**Problem:** A binary takes seconds to start and nobody knows why. Slow startup hurts deploy velocity, autoscaling responsiveness, and serverless cold starts.

**Before:** Guessing which package is slow, adding ad-hoc timing logs everywhere.

**After:**
```bash
GODEBUG=inittrace=1 ./app 2>&1 | sort -t@ -k2 -n | tail
```
Each line shows a package's `init` start time, clock duration, and allocations. The culprit is the line with the fat `clock` and `bytes`.

**Expected gain:** Pinpoints the expensive `init` in seconds — often a package building a large table or compiling regexes at import time. Moving that work to lazy initialization (`sync.Once`) can cut startup dramatically, with zero guesswork.

---

## Optimization 7 — Avoid `FreeOSMemory` as a memory strategy

**Problem:** A team calls `debug.FreeOSMemory()` on a timer (or per request) to "keep memory low." Each call forces a full GC; under load this dominates CPU and *worsens* the very problem it was meant to solve.

**Before:**
```go
go func() {
    for range time.Tick(5 * time.Second) {
        debug.FreeOSMemory() // a full GC every 5s, fighting the pacer
    }
}()
```

**After:**
```bash
# steady-state memory control is the pacer's job
GOMEMLIMIT=3600MiB GODEBUG=madvdontneed=1 ./app
```
Reserve `FreeOSMemory` for a single call after a genuine one-off spike:
```go
runNightlyReindex()
debug.FreeOSMemory() // once, deliberately
```

**Expected gain:** Removing the periodic full GCs recovers the CPU they were burning; `GOMEMLIMIT` does the steady-state job far more cheaply. Net throughput improves and memory stays controlled.

---

## Optimization 8 — Cache build provenance instead of recomputing it

**Problem:** A `/version` handler calls `debug.ReadBuildInfo()` and walks `Settings` on every request. The build info is immutable for the process lifetime, so this is pure waste on a hot endpoint.

**Before:**
```go
func versionHandler(w http.ResponseWriter, r *http.Request) {
    info, _ := debug.ReadBuildInfo()        // parsed every request
    rev := findSetting(info, "vcs.revision") // walked every request
    fmt.Fprint(w, rev)
}
```

**After:**
```go
var buildRevision = func() string {
    info, ok := debug.ReadBuildInfo()
    if !ok { return "unknown" }
    return findSetting(info, "vcs.revision")
}() // computed once at init

func versionHandler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprint(w, buildRevision)
}
```

**Expected gain:** Trivial per-request cost eliminated; the handler becomes a constant-string write. Minor in isolation, but it is the correct pattern — provenance is frozen at build time, so read it once.

---

## Optimization 9 — Stage Go upgrades to bank gains without behavior risk

**Problem:** A team avoids upgrading Go (missing real compiler/runtime/GC performance improvements) because "upgrades are risky." The fear conflates the toolchain bump with the behavior change.

**Before:** Stuck on an old Go for years; no PGO, no newer GC and inlining improvements, slower binaries.

**After:**
```
1. Bump the toolchain, keep the `go` line  → behavior-neutral; bank perf gains. Soak.
2. Canary the new defaults via GODEBUG env; watch /godebug/non-default-behavior/*.
3. Raise the `go` line as its own reviewed change; pin only what the counters flag.
```

**Expected gain:** You capture the per-release performance improvements (often single-digit percent compile/runtime gains, plus features like PGO) *immediately* and safely, because the `go` line pins behavior. Decoupling the two unblocks upgrades that were stalled by misplaced risk.

---

## Optimization 10 — Use `non-default-behavior` counters to drop unneeded pins

**Problem:** Accumulated `//go:debug` pins force old, often slower or less secure, code paths long after they were needed. Nobody removes them because nobody knows if they're still load-bearing.

**Before:**
```go
//go:debug httplaxcontentlength=1  // added long ago; still needed?
//go:debug tlsrsakex=1             // ditto
package main
```

**After:**
```go
// scrape the counters in production over a representative window
// /godebug/non-default-behavior/httplaxcontentlength:events == 0 across all replicas
//   → the old path is not exercised → safe to remove the pin (with care)
```
Remove pins whose counters stay zero under real load; keep (and ticket) those that don't.

**Expected gain:** Each removed pin restores the modern default — often a security improvement and sometimes a faster path. The counters turn "we're afraid to touch the pins" into a measurable cleanup. (Remember: zero is evidence, not proof — pair with tests and a careful rollout.)

---

## Optimization 11 — Profile diagnostics overhead before leaving traces on

**Problem:** A team leaves `GODEBUG=gctrace=1` (or worse) on in production "for visibility," paying continuous I/O and log-volume cost, and risks `allocfreetrace` being left on by accident.

**Before:**
```bash
GODEBUG=gctrace=1,scheddetail=1,schedtrace=100 ./app   # in steady-state prod
```
A scheduler detail dump every 100 ms plus per-cycle GC lines floods the log pipeline.

**After:**
```bash
# steady-state: no diagnostic GODEBUG; use runtime/metrics for continuous data
./app
# investigation: enable per-replica, time-boxed, on a dedicated stream
GODEBUG=gctrace=1 ./app 2> /var/log/app/gc-canary.log
```

**Expected gain:** Reclaims the I/O and log-storage cost of always-on tracing, and removes the risk of a catastrophic `allocfreetrace` left enabled. Continuous numbers come from `runtime/metrics` at a fraction of the cost; traces are for bounded investigations.

---

## Optimization 12 — Guard against runaway resource use with caps

**Problem:** A goroutine leak that blocks in syscalls slowly exhausts host OS threads, degrading every process on the node before the offender is identified. The blast radius is the whole machine.

**Before:** No cap; thread count climbs into the tens of thousands and the node thrashes.

**After:**
```go
func main() {
    debug.SetMaxThreads(10000) // well above real max, below host-harmful
    // ...
}
```
The offending process now aborts with a clear message at the cap, instead of silently taking the node down.

**Expected gain:** Not a throughput optimization — a *blast-radius* optimization. It converts a slow, node-wide degradation into a fast, contained, observable failure of the single bad process. Recovery and diagnosis are dramatically faster.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For these knobs the most useful signals are:

```bash
# Quick human read of GC behavior
GODEBUG=gctrace=1 ./app 2> gc.log   # cumulative GC %, heap triple, goal

# Find slow startup
GODEBUG=inittrace=1 ./app 2>&1 | sort -t@ -k2 -n | tail

# Structured, stable runtime numbers (prefer these for automation)
#   /cpu/classes/gc/total:cpu-seconds   -> GC CPU fraction
#   /gc/heap/live:bytes                 -> live heap
#   /gc/cycles/total:gc-cycles          -> GC cycle rate
#   /godebug/non-default-behavior/*     -> compatibility reliance

# Verify a memory limit holds under load (no death spiral)
GOMEMLIMIT=3600MiB GODEBUG=gctrace=1 ./app 2> gc.log
#   watch: does cumulative % stay sane, or climb into double digits?

# Confirm RSS behavior under cgroups
GODEBUG=madvdontneed=1 ./app   # then compare RSS to default
```

Track two metrics above all: **GC CPU fraction** (the headline cost of an over-tight limit or an over-frequent ratio) and **live heap vs limit** (the headroom that separates "controlled" from "death spiral"). A memory-limit change that doesn't move these isn't an optimization.

---

## When These Are the Wrong Tool

- **Allocation problems belong in `pprof`, not GC tuning.** If you allocate too much, no `GOGC`/`GOMEMLIMIT` value fixes it — profile and reduce allocations. The knobs trade CPU for memory; they don't remove the work.
- **`gctrace` is not a metrics pipeline.** Its format is unstable. For dashboards and alerts, use `runtime/metrics`.
- **`FreeOSMemory` is not a memory strategy.** It's a one-off cleanup, not a steady-state lever; `GOMEMLIMIT` is.
- **`SetGCPercent(-1)` is not a throughput switch for servers.** It disables GC; in a long-lived process memory grows unbounded. Use `GOGC=off` *with* a limit instead.
- **GODEBUG compatibility settings are not performance flags.** They restore old behavior for compatibility; relying on them is debt with an expiry, not an optimization.

Use these mechanisms when you have a concrete, measured goal: cap memory to fit a container, maximise batch throughput within a memory budget, find a slow `init`, detect the death spiral, or bound a blast radius. Otherwise, measure first — the best "optimization" is frequently discovering the runtime was never the bottleneck.

---

## Summary

`GODEBUG` and `runtime/debug` don't make code fast; they let you *configure* and *diagnose* the runtime so it behaves well in its environment. The durable wins are a correctly sized `GOMEMLIMIT` (the difference between OOMs and a stable, smaller container), the `GOGC=off`-plus-limit configuration for throughput-bound work, `madvdontneed` for honest RSS under cgroups, `inittrace` for slow startups, and the death-spiral alert on GC CPU fraction rather than RSS. Just as important is what *not* to do: don't tune GC blind, don't leave traces on in production, don't make `FreeOSMemory` a strategy, don't disable GC in a server, and don't treat compatibility pins as optimizations. Measure with `runtime/metrics` (stable) over `gctrace` (human-only), set the limit from the container budget minus non-Go memory minus headroom, and stage Go upgrades to bank performance gains without behavior risk. The biggest optimization, as ever, is measuring first and discovering whether the runtime is the bottleneck at all.
