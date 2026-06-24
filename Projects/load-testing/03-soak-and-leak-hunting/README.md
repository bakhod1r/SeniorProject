# Soak Testing & Leak Hunting

> Run a Go service under steady, unremarkable load for 12–24 hours and watch it
> die slowly. The bugs that hide in a 5-minute test — a goroutine blocked
> forever, a map that never evicts, an `*http.Response` body nobody closed —
> only show up as a curve that won't flatten. Plant them, then hunt them with
> pprof until the line goes flat.

| | |
|---|---|
| **Tier** | Load-testing (meta-skill) |
| **Primary domain** | Endurance testing & resource-leak diagnosis |
| **Skills exercised** | Go runtime & GC, `net/http/pprof`, heap/goroutine profiling, `runtime/metrics`, `GOMEMLIMIT`, fd accounting (`lsof`), RSS vs heap reasoning, latency-drift detection |
| **Interview sections** | 1 (Go runtime), 17 (performance), 18 (observability) |
| **Est. effort** | 3–5 focused days (plus wall-clock soak time) |

---

## 1. Context

You own a Go HTTP service that passes every test, sails through a 5-minute load
run, and ships. Three days later, on-call gets paged: the pod RSS has climbed
from 180 MB to 2.1 GB, the kubelet OOM-kills it, it restarts, and the clock
resets. Nobody can reproduce it locally because nobody runs it for three days
locally.

This is the class of bug a soak test exists to catch: **slow drift**. Memory
that grows without bound, goroutines that accumulate, file descriptors that
leak, GC pauses that creep up, p99 that drifts from 8 ms to 40 ms over six
hours. None of it is visible in a short run. All of it is fatal in production.

Your job is to build a soak harness, run a Go service under sustained load for
many hours, and **deliberately plant** the canonical Go leak sources — then find
each one with the runtime's own tools. You will produce flat curves and the
profiles that prove they're flat, not vibes.

## 2. Goals / Non-goals

**Goals**
- Stand up a soak harness: a Go service under steady load with RSS, heap,
  goroutine count, open-fd count, and GC-pause trend recorded every few seconds
  for ≥ 12 hours.
- Plant each canonical Go leak (goroutine, fd, unbounded map, unstopped ticker)
  and **detect it from the metric curve**, then **localize it** with pprof.
- Use heap-diff profiling (`pprof -base`) to point at the exact allocation site
  of a growing map.
- Distinguish a real leak from legitimate steady-state cache growth and from RSS
  that is heap-fragmentation / not-yet-returned-to-OS rather than live memory.
- Demonstrate that a fix **flattens** the curve over a fresh long run.

**Non-goals**
- Peak-throughput or breakpoint testing — that's `04-capacity-and-breakpoint-testing`.
- Injecting infrastructure faults — that's `02-chaos-and-fault-injection`.
- Native/cgo leaks (malloc arenas, C libraries). Stay in pure Go; `lsof` for fds
  is the one OS-level tool you'll need.
- Hunting CPU regressions — this lab is about *resources that don't come back*,
  not *cycles*.

## 3. Functional requirements

1. A **target service** (`cmd/svc`) — a real-ish Go HTTP API (a few endpoints
   that allocate, call a downstream, touch a cache, open files/sockets) with
   `net/http/pprof` mounted on a separate admin port and a `/metrics` endpoint.
2. A **leak registry**: each leak is a build/runtime flag
   (`-leak=goroutine|fd|map|ticker|none`) so a single binary can be run clean or
   with exactly one planted leak. Leaks must be *plausible* code, not strawmen.
3. A **load driver** (`cmd/drive`) that holds a fixed, moderate request rate
   (open-model, not closed-loop) for the full soak duration with a deterministic
   request mix.
4. A **sampler** (`cmd/sample` or a sidecar script) that scrapes
   `runtime/metrics`, `/debug/pprof/`, and `lsof` on an interval and appends to a
   CSV/Parquet time series, plus captures a heap and goroutine profile every N
   minutes for later diffing.
5. A **report step** that turns the time series into the curves of §5 and the
   pprof diffs of §10.

## 4. Load & data profile

- **Duration:** one clean baseline run **≥ 12 h** (24 h preferred); each
  leak-hunt run long enough for the curve to be unambiguous — typically 1–4 h, or
  *accelerated* by raising request rate so a slow leak surfaces in minutes
  (state the acceleration factor).
- **Load:** steady **moderate** rate — e.g. 200–500 req/s — deliberately *below*
  the service's ceiling so any drift is a leak, not saturation. Open-model: the
  driver sends at a fixed rate regardless of how fast the service responds.
- **Request mix:** deterministic given a seed; e.g. 70% reads (cache hit/miss
  mix), 20% writes, 10% a downstream-call endpoint that opens a socket.
- **Cache realism:** the service has a *legitimate* bounded cache that warms over
  the first ~20 min then plateaus — present specifically so you must tell true
  steady-state growth apart from a leak.
- **Sampling cadence:** resource metrics every 5–10 s; full heap + goroutine
  profile every 5 min (cheap, and diffable).

## 5. Non-functional requirements / SLOs

The whole lab is "make these curves flat." Targets for the **clean** service
over an N-hour run (N ≥ 12):

| Metric | Source | Target over N hours |
|--------|--------|---------------------|
| Goroutine count | `runtime/metrics` `/sched/goroutines:goroutines` | **Flat** — bounded, returns to baseline ±5% between load waves; no monotonic rise |
| Live heap (`HeapAlloc` / `/memory/classes/heap/objects:bytes`) | `runtime/metrics` | Sawtooth around a **flat mean**; mean drift < 5% over the run |
| Process RSS | `/proc/<pid>/status` `VmRSS` | Plateaus after warm-up; no sustained upward slope; gap vs live heap explained (frag / not-returned-to-OS) |
| Open file descriptors | `lsof -p <pid>` count / `/proc/<pid>/fd` | **Flat** — bounded by pool sizes; no monotonic climb |
| GC pause (p99 `pause_ns`) | `runtime/metrics` `/gc/pauses:seconds` histogram | Stable; p99 pause < 5 ms and **not trending up** as the run continues |
| GC frequency / CPU fraction | `/gc/cycles/total:gc-cycles`, `/cpu/classes/gc/total:cpu-seconds` | Steady cycles-per-minute; GC CPU fraction flat |
| Request p99 latency | service histogram | **No drift** — p99 at hour 12 within 10% of p99 at hour 1 |

> The number that matters isn't the absolute value — it's the **slope**. A flat
> line over 12 hours is the deliverable; a rising line is the bug.

## 6. Architecture constraints & guidance

- **Pure Go target.** `net/http` service, `net/http/pprof` imported and mounted
  on an admin-only port (never the public one). Pin the Go version — GC behavior
  changes across releases.
- **Read metrics from `runtime/metrics`, not the deprecated `runtime.MemStats`
  fields where a `runtime/metrics` equivalent exists.** It's the stable,
  histogram-aware API: goroutine count, GC pause distribution, heap class
  breakdown, GC CPU.
- **`GOMEMLIMIT`** is part of the experiment surface, not just config — you'll
  run with it set and unset and observe the GC's response near the limit.
- Run the service in a container with a **memory limit** (e.g. `--memory=512m`)
  so OOM is a real outcome you can trigger and observe, not a hypothetical.
- Keep the load driver on a separate host/process from the service so the
  driver's own allocations never contaminate the service's profiles.
- Store every profile (`heap.<t>.pb.gz`, `goroutine.<t>.txt`) with a timestamp so
  any two can be diffed after the fact.

## 7. Data model (the soak time series)

```
sample (every 5–10s):
  ts                 int64    // unix ms
  goroutines         int
  heap_alloc_bytes   uint64   // live objects
  heap_sys_bytes     uint64   // reserved from OS (heap)
  rss_bytes          uint64   // VmRSS from /proc
  open_fds           int      // count of /proc/<pid>/fd
  gc_pause_p99_ns    uint64   // from /gc/pauses histogram
  gc_cycles          uint64   // monotonic counter
  next_gc_bytes      uint64   // GC trigger target (vs GOMEMLIMIT)
  req_p99_ms         float64  // service-reported

profiles (every 5 min):
  heap.<ts>.pb.gz             // go tool pprof -base heap.<t0> heap.<t1>
  goroutine.<ts>.txt          // ?debug=2 full stacks for blocked-goroutine grouping
```
The diff between two heap profiles (`-base`) and between two goroutine dumps is
where localization happens; the scalar time series is where *detection* happens.

## 8. Interface contract

- `GET  /healthz` → `200`
- `GET  /api/...` → the workload endpoints (read / write / downstream-call)
- Admin port:
  - `GET /debug/pprof/heap` → heap profile (`?gc=1` to force GC first for a clean
    live-heap reading)
  - `GET /debug/pprof/goroutine?debug=2` → full goroutine stacks
  - `GET /debug/pprof/allocs` → allocation profile
  - `GET /metrics` → Prometheus exposition incl. mirrored `runtime/metrics`
- Flags: `-leak={none|goroutine|fd|map|ticker}`, `-rate`, `-cache-size`,
  `-gomemlimit` (or env `GOMEMLIMIT`), `-accel` (rate multiplier).

## 9. Key technical challenges

- **Leak vs steady-state cache growth.** A warming bounded cache also makes the
  heap line go up — for a while. You must show it *plateaus* (and prove the
  eviction works) versus a true leak that *never* plateaus. The tell is the
  second derivative over a long enough window, plus a heap diff that keeps
  pointing at the same growing object.
- **RSS vs live heap.** RSS can stay high while the live heap shrinks: freed
  memory may be `MADV_DONTNEED`'d lazily, and heap fragmentation reserves spans
  the allocator won't release. A rising *RSS* with a flat *live heap* is not a Go
  leak — it's the runtime not returning memory to the OS yet, and you must say so
  rather than chase a phantom.
- **Goroutine leaks are silent.** A goroutine blocked on a channel send/receive
  or a never-cancelled `context` consumes a few KB of stack and never shows in
  heap-allocation profiles as "live" the way you'd expect — you find it in the
  **goroutine** profile, grouped by blocking stack, with a count that only rises.
- **fd leaks are invisible to pprof.** An unclosed `resp.Body` or `*sql.Rows`
  leaks a socket/fd that the Go heap tools can't see at all; only `lsof` /
  `/proc/<pid>/fd` reveals it, and it ends in `EMFILE: too many open files`.
- **Latency drift has many causes.** Drifting p99 might be GC pressure from a
  growing heap, lock contention that worsens as a map grows, or the OS reclaiming
  pages — you must attribute it, not just observe it.

## 10. Experiments to run (break it / tune it)

For each: name the curve that detects it, the tool that localizes it, and the
before/after once fixed.

1. **Goroutine leak — forgotten context cancel.** An endpoint spawns a worker
   that selects on a channel + a `ctx.Done()` that's never triggered (caller
   forgot `defer cancel()`). *Measure:* `/sched/goroutines` climbing linearly
   with request count. *Localize:* `goroutine?debug=2`, group by blocking stack —
   thousands parked on the same `chan receive`. *Fix:* propagate cancellation;
   show the count returns to baseline between waves.
2. **Heap-diff a growing map.** A request-keyed map (e.g. per-request entry
   cached "for later") is written but never deleted. *Measure:* live heap mean
   drifting up, never plateauing. *Localize:* `go tool pprof -base heap.t0
   heap.t1` → the growth concentrates at one `map` assignment line. *Fix:* bound
   it (LRU/TTL); prove the diff is now empty and the mean is flat.
3. **fd leak — unclosed response body.** The downstream-call endpoint does
   `http.Get` but never `resp.Body.Close()`, so the connection/fd leaks (and the
   keep-alive pool can't reuse). *Measure:* `lsof -p <pid> | wc -l` climbing;
   eventually `EMFILE`. *Localize:* confirm with `lsof` showing accumulating
   sockets in `CLOSE_WAIT`/`ESTABLISHED`; correlate with the endpoint. *Fix:*
   `defer resp.Body.Close()` (+ drain); show fd count flat and pool reuse.
4. **Unstopped `time.Ticker`.** A handler creates `time.NewTicker` per request
   without `Stop()`. *Measure:* both goroutine count and heap creep (ticker +
   its goroutine retained). *Localize:* goroutine dump shows runtime timer
   goroutines / `time.Ticker` references in the heap diff. *Fix:* `defer
   ticker.Stop()`; flat curves.
5. **GC pause trend under a slowly growing heap.** Run leak #2 and watch the
   `/gc/pauses` p99 and GC frequency as the live heap grows. *Measure:* pause p99
   and GC CPU fraction trending up as heap size rises. *Show:* the pause
   regression is a *symptom* of the leak, and disappears when the heap is bounded.
6. **`GOMEMLIMIT` on a near-OOM service.** Take a service whose heap grows toward
   the container's 512 MB limit. Run (a) no `GOMEMLIMIT` → GC stays lazy, RSS
   marches to the cgroup limit, kernel OOM-kills it; (b) `GOMEMLIMIT=450MiB` → GC
   gets aggressive near the soft limit, `next_gc` clamps, the process survives
   but burns more GC CPU (and can enter a GC death-spiral if *truly* out of
   room). *Measure:* `next_gc_bytes` vs limit, GC CPU fraction, survival vs
   OOM-kill. Explain the trade-off.
7. **Prove the fix flattens RSS over a long run.** After fixing leak #2, do a
   fresh ≥ 12 h run. *Deliver:* the RSS and live-heap curves side by side, both
   plateaued, with the heap-diff between hour 1 and hour 12 essentially empty.
8. **Cache vs leak discrimination (control).** Run with the *legitimate* bounded
   cache and **no** planted leak. Show the heap rises during the ~20 min warm-up
   then plateaus, eviction counter is non-zero, and the hour-1→hour-12 heap diff
   is empty — the curve that *looks* like a leak for 20 minutes but isn't.

## 11. Milestones

1. Target service + `net/http/pprof` + `/metrics` (mirroring `runtime/metrics`);
   load driver holding a steady rate; sampler writing the time series.
2. First clean baseline run; produce the §5 curves; confirm they're flat (or find
   an *accidental* leak — common, and a good sign the harness works).
3. Plant + detect + localize leaks #1–#4; one findings entry per leak with the
   detecting curve and the pprof/`lsof` evidence.
4. GC + `GOMEMLIMIT` experiments (#5, #6); the near-OOM trade-off write-up.
5. Fix-and-flatten long run (#7) and the cache-vs-leak control (#8); final report.

## 12. Acceptance criteria (definition of done)

- [ ] A ≥ 12 h clean run with **flat** goroutine, fd, and live-heap curves —
      plotted, with the RSS-vs-heap gap explained.
- [ ] Each of the four planted leaks: detected from a named metric curve **and**
      localized to the responsible code via pprof (`-base` heap diff or grouped
      goroutine dump) or `lsof`.
- [ ] The growing-map leak localized by a `pprof -base` diff that names the
      allocation line; after the fix, the same diff is empty.
- [ ] The fd leak confirmed by `lsof` showing accumulating sockets and an
      `EMFILE`; after the fix, fd count is flat.
- [ ] `GOMEMLIMIT` experiment showing the on/off difference near the container
      limit (survival vs OOM-kill, `next_gc` clamping, GC-CPU cost) with numbers.
- [ ] A documented method for telling steady-state cache growth from a leak, with
      the control run as evidence.
- [ ] Every curve and profile reproducible from a committed command + seed.

## 13. Stretch goals

- **Continuous profiling** (Pyroscope/Parca): keep heap + goroutine profiles for
  the whole soak and scrub back to the moment a curve bent.
- **`sync.Pool` misuse:** show a pool that retains oversized buffers inflating
  RSS, and the per-GC-cycle pool drain that complicates "live heap" reasoning.
- **Finalizer pitfalls:** plant a `runtime.SetFinalizer` cycle/ordering bug that
  delays reclamation; observe the heap-class effect.
- **`MADV_DONTNEED` vs `MADV_FREE`:** run with `GODEBUG=madvdontneed=1` and show
  the RSS-return-to-OS difference under the same workload.
- **Automated leak gate:** a CI job that runs a short accelerated soak and fails
  the build if the goroutine or heap slope exceeds a threshold (linear-regression
  on the time series).

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Leak detection | Spots a rising curve and names the leak class | Builds the harness so *any* of the four classes is caught automatically; quantifies the slope |
| Localization | Uses pprof to find the goroutine/allocation | Reads a `-base` heap diff and grouped goroutine dump fluently; pinpoints the line and explains the retention path |
| RSS vs heap | Knows RSS ≠ live heap | Explains fragmentation + lazy return-to-OS, proves which one a given gap is, and won't chase a phantom |
| GC understanding | Reads GC pause/frequency from `runtime/metrics` | Predicts the pause trend from heap growth; reasons about `GOMEMLIMIT`/`next_gc` near a hard limit and the death-spiral risk |
| fd discipline | Knows unclosed bodies leak fds | Catches it via `lsof`, ties it to keep-alive pool reuse, and prevents the whole class |
| Cache vs leak | Suspects growth might be a cache | Proves plateau vs unbounded growth with a control and second-derivative reasoning |
| Communication | Curves + a findings note | Could defend "this line is flat, here's why, here's the profile" to a staff panel |

## 15. References

- Go docs: `runtime/metrics`, `net/http/pprof`, `runtime/pprof`; the `GOMEMLIMIT`
  / soft-memory-limit design doc and `GODEBUG=gctrace=1`.
- `go tool pprof` — heap profiling and `-base` differential profiling; `?gc=1`
  and `?debug=2` query params.
- *The Go Memory Model* and the runtime GC pacer notes (for pause/`next_gc`
  reasoning).
- `lsof` / `/proc/<pid>/fd` and `/proc/<pid>/status` (`VmRSS`) for OS-level fd and
  RSS accounting.
- Continuous-profiling: Pyroscope / Parca / Google-Wide Profiling paper.
- See also: `Interview Question/01-golang-language-and-runtime/` (goroutines, GC,
  scheduler, memory) and `Interview Question/18-observability/` (profiling,
  metrics, drift detection).
