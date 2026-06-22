# Continuous Profiling — Hands-On Exercises

> **Topic:** [Continuous Profiling Roadmap](README.md)
> **Focus:** Practical exercises that take you from "I can read a flame graph" to "I can stand up a fleet-wide continuous-profiling pipeline, diff a canary against baseline in a deploy gate, and click from a p99 alert to the exact hot line of code."

---

## Table of Contents

1. [Introduction](#introduction)
2. [Warm-Up](#warm-up)
3. [Core](#core)
4. [Advanced](#advanced)
5. [Capstone](#capstone)
6. [Related Topics](#related-topics)

---

## Introduction

You cannot learn profiling by reading about flame graphs any more than you can learn to swim from a diagram of a pool. You learn it by adding `net/http/pprof` to a real service, collecting a 30-second CPU profile under load, opening `go tool pprof -http`, and staring at the widest leaf until you understand *why* it is wide. You learn continuous profiling by standing up Pyroscope in Docker, pushing profiles from your service, and querying "top CPU over the last 15 minutes" — then by diffing two profiles and watching a regression light up red. Every task below produces an artefact you can look at: a flame graph, a diff, a query result, a failed CI check. None of them is satisfiable by reasoning in the abstract.

The exercises are tiered. The **Warm-Up** band trains the mechanics — read a flame graph correctly, collect a profile from a live process, attach a profiler to a running PID — so that pulling a profile is reflex, not a research project. The **Core** band is where the real skills live: reproduce a CPU hotspot and fix it, reproduce an allocation hotspot and pool it, learn the CPU-vs-off-CPU distinction on two endpoints that fail in opposite ways, and set up a local continuous-profiling pipeline you can query over time. The **Advanced** band separates middle from senior — differential profiling, tying a latency spike to a flame graph at a timestamp, and zero-instrumentation whole-system profiling with eBPF. The **Capstone** band stops being about one process and becomes strategy: a deploy gate that fails on a CPU regression, and a continuous-profiling design for a polyglot fleet with consistent labels, an overhead budget, and a runbook.

Do not skip ahead. The Capstone tasks assume you can read a diff flame graph without looking up which colour means "grew," and that you instinctively reach for the off-CPU profile when the CPU profile is flat. The skills `profiling-techniques` (the laptop-side mechanics of generating and benchmarking flame graphs), `memory-leak-detection` (the systematic heap hunt), and `observability-stack` (where profiling fits with logs, metrics, and traces) are worth keeping open as you work.

A note on tooling. Install the **Go toolchain** (`go tool pprof` is the gold-standard reference and several tasks use it), **Docker** + `docker compose` (for running Pyroscope or Parca locally), **py-spy** (`pip install py-spy`, for attaching to Python by PID), and **async-profiler** (for the JVM tasks, if you go that route). For the eBPF task you need a Linux host (or a Linux VM/container with the right capabilities) to run **parca-agent** or Pyroscope's eBPF profiler. Everything else runs on a laptop. For background reading at each level, see [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md), [professional.md](professional.md), and [interview.md](interview.md).

---

## Warm-Up

These are 15-to-30-minute exercises. The goal is fluency with the mechanics — read, collect, attach — not insight. If a Warm-Up task takes more than an hour, stop and re-read the corresponding section of [junior.md](junior.md).

### Task 1: Read three flame graphs and name the line to fix

**Problem.** Below are three flame graphs rendered as ASCII (top = leaf = the code actually on the CPU). For each, name the **widest leaf**, state what you would optimise first, and confirm out loud that the width you are reading is *aggregate samples*, not elapsed time or left-to-right order.

```text
GRAPH A                                         GRAPH B
┌───────────────── main ─────────────────┐     ┌──────────── main ────────────┐
├──────── serveHTTP ────────┬─ cron ──────┤     ├────────── handler ───────────┤
├─ decode ─┬──── query ──────┤            │     ├─ validate ─┬──── render ──────┤
│ Unmarshal│   scanRows      │  gcAssist  │     │  regexp.   │   bytes.Buffer   │
│  18%     │     47%         │    9%      │     │  Compile   │   .WriteString   │
└──────────┘                 └────────────┘     │   71%      │      12%         │
                                                └────────────┘

GRAPH C
┌─────────────────────── main ───────────────────────┐
├──────────────────── workerPool ─────────────────────┤
├─ task ─┬─ task ─┬─ task ─┬──────── json.Marshal ─────┤
│  4%    │  4%    │  4%    │  reflect.Value.Interface  │
│        │        │        │           58%             │
└────────┴────────┴────────┴───────────────────────────┘
```

**Constraints.**
- For each graph, name exactly one leaf as the optimisation target and give the percentage.
- State, for at least one graph, why a *wide box low down* (e.g. `main`, `serveHTTP`) is not the target.
- No tools — this is a reading drill.

**Hints.**
- The leaf is the topmost box in a tower; the widest leaf consumed the most resource.
- `scanRows`, `regexp.Compile`, and `reflect.Value.Interface` are the leaves doing the actual work.
- Width = number of samples that contained that frame. A box twice as wide used roughly twice the CPU.

**Self-check.**
- [ ] Graph A target: `scanRows` (47%) — fetch/scan less, or cache the query.
- [ ] Graph B target: `regexp.Compile` (71%) — compile the pattern once, not per request.
- [ ] Graph C target: `reflect.Value.Interface` under `json.Marshal` (58%) — avoid reflection-heavy marshalling on the hot path.
- [ ] You can state that width is samples, not time, and that left-to-right order is alphabetical, not chronological.

### Task 2: Add `net/http/pprof` to a Go service and collect a CPU profile

**Problem.** Take (or write) a small Go HTTP service, expose the profiling endpoints with the standard `net/http/pprof` import, drive a little load at it, collect a 30-second CPU profile, and open the interactive flame graph. Run `top` and `list` in the text REPL.

**Constraints.**
- Profiling endpoints MUST bind to localhost (or an internal admin port), never a public interface.
- Collect for 30 seconds *while traffic is flowing* — an idle profile is empty.
- Use both the web UI and the REPL: `top` and `list <function>`.

**Hints.**
```go
import _ "net/http/pprof" // registers /debug/pprof/* as a side effect
// in main(): go http.ListenAndServe("localhost:6060", nil)
```
```bash
# Generate load in another terminal, then:
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/profile?seconds=30

# Or the REPL:
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
(pprof) top          # top functions by self CPU
(pprof) top -cum     # by cumulative (function + callees)
(pprof) list <fn>    # annotated source, line-by-line cost
```

**Self-check.**
- [ ] The web UI opens a flame graph and you can identify the widest leaf.
- [ ] `top` shows functions ranked by self CPU; `top -cum` reorders by cumulative.
- [ ] `list <function>` shows per-line cost with the hot line highlighted.
- [ ] Your pprof endpoint is bound to localhost, not `0.0.0.0`.

### Task 3: Attach py-spy to a running Python process by PID

**Problem.** Start a long-running Python process (any CPU-busy loop or a small Flask/FastAPI app under load). Without restarting or modifying it, attach `py-spy` to it *by PID*, watch the live `top` view, and record a 30-second flame graph SVG.

**Constraints.**
- You may NOT add an `import`, change the code, or restart the process — the whole point is profiling something already running.
- Produce a saved `flame.svg` you can open in a browser.
- Find the PID yourself (`ps`, `pgrep`, or your OS task tooling).

**Hints.**
```bash
pip install py-spy
pgrep -f myapp.py                       # find the PID
py-spy top --pid 12345                  # live top-like view
py-spy record --pid 12345 --duration 30 --output flame.svg
py-spy dump --pid 12345                 # one-shot: what is every thread doing now?
```
- On macOS/Linux you may need `sudo` to attach to another process.

**Self-check.**
- [ ] `py-spy top --pid` shows live per-function CPU without touching the target's code.
- [ ] `flame.svg` opens and shows the hot stack.
- [ ] You did not restart or modify the profiled process.
- [ ] You can explain why attach-by-PID is the seed of continuous profiling (no redeploy needed).

---

## Core

These tasks are 1-to-3 hours each. They require you to write or instrument code, profile it, change it, and re-profile to *prove* the change worked. If you can do all of them comfortably, you are at the middle level.

### Task 4: Find and fix a CPU hotspot, then prove the box shrank

**Problem.** Write (or take) a Go service with one deliberately CPU-hot path — for example, a handler that recompiles a regex on every request, or recomputes something cacheable in a tight loop. Profile it under load, find the hot loop in the flame graph, fix it, re-profile, and show the box shrank.

**Constraints.**
- Capture a *baseline* CPU profile to a file before you change anything: keep `cpu_before.pb.gz`.
- The fix must be a real algorithmic/caching fix, not just "do less work in the benchmark."
- Capture `cpu_after.pb.gz` after the fix and compare the hot function's share before vs after.

**Hints.**
```bash
# Save profiles to files (not just the live UI) so you can compare them later:
curl -s "http://localhost:6060/debug/pprof/profile?seconds=30" > cpu_before.pb.gz
# ... apply the fix, redeploy, drive the same load ...
curl -s "http://localhost:6060/debug/pprof/profile?seconds=30" > cpu_after.pb.gz
go tool pprof -top cpu_before.pb.gz | head
go tool pprof -top cpu_after.pb.gz  | head
```
- A classic plant: `regexp.MustCompile` inside the handler → hoist it to a package-level `var`.
- Drive the *same* load profile before and after, or the comparison is meaningless.

**Self-check.**
- [ ] You identified the hot function from the baseline flame graph, not from intuition.
- [ ] The hot function's self-CPU share dropped materially (e.g. 60%+ → single digits).
- [ ] You kept both profile files and can show the before/after `top`.
- [ ] You drove comparable load for both captures.

### Task 5: Reproduce an allocation hotspot, pool it, measure the GC drop

**Problem.** Write a Go handler that allocates a fresh buffer (or large slice/map) per request. Profile its allocations with the heap `alloc` profile, find the per-request allocation, replace it with a `sync.Pool` (or pre-sized reuse), re-profile, and measure the reduction in allocations and GC pressure.

**Constraints.**
- Use the **`alloc`** heap profile (`alloc_space` / `alloc_objects`) for the GC-pressure question — not `inuse`. The `alloc` view counts everything ever allocated, which is what drives GC.
- Show the per-request buffer as a wide box in the *before* alloc profile and a much smaller one after.
- Quantify the GC change (e.g. `runtime.MemStats.NumGC` rate, or the `gcAssist` share of the CPU profile).

**Hints.**
```bash
go tool pprof -http=:8080 -sample_index=alloc_space \
  http://localhost:6060/debug/pprof/heap
# also worth: -sample_index=alloc_objects
```
```go
var bufPool = sync.Pool{New: func() any { return make([]byte, 0, 4096) }}
// in handler: b := bufPool.Get().([]byte); defer bufPool.Put(b[:0])
```
- `alloc` vs `inuse`: `alloc` for GC churn, `inuse` for live-memory leaks. This task is about churn.

**Self-check.**
- [ ] The before `alloc_space` profile shows the per-request allocation as a dominant frame.
- [ ] After pooling, that frame's allocated bytes drop sharply.
- [ ] You measured a GC reduction (fewer collections per second, or lower `gcAssist` in the CPU profile).
- [ ] You used `alloc`, not `inuse`, and can say why.

### Task 6: CPU vs off-CPU — two endpoints that fail in opposite ways

**Problem.** Build a service with two endpoints: one **CPU-bound** (spins the processor — e.g. a hashing or busy-compute loop) and one **blocked** (sleeps on I/O, a lock, or a slow downstream — e.g. an un-pooled DB call or an explicit `time.Sleep`/contended mutex). Show that the CPU profile catches the first and is blind to the second, and that the off-CPU / block profile catches the second.

**Constraints.**
- The blocked endpoint must be slow in *wall-clock* time while using almost no CPU.
- Collect a CPU profile and demonstrate the CPU-bound endpoint dominates it while the blocked one barely appears.
- Collect a block/mutex (or off-CPU) profile and demonstrate the blocked endpoint dominates *that*.

**Hints.**
```go
// Enable block + mutex profiling (off by default in Go):
runtime.SetBlockProfileRate(10_000)    // sample ~1 event / 10µs blocked
runtime.SetMutexProfileFraction(5)     // sample ~1/5 of contention events
```
```bash
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/block
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/mutex
```
- "Slow but CPU idle" is the off-CPU tell. The CPU profile of the blocked endpoint will look almost empty.

**Self-check.**
- [ ] The CPU profile is dominated by the CPU-bound endpoint; the blocked one is nearly absent.
- [ ] The block/off-CPU profile is dominated by the blocked endpoint.
- [ ] You can state the rule: "CPU profile when it's hot, off-CPU/block profile when it's waiting."
- [ ] You enabled block/mutex profiling explicitly (it is off by default).

### Task 7: Stand up Pyroscope (or Parca) locally and query profiles over time

**Problem.** Run Pyroscope (or Parca) locally via `docker compose`, push or scrape profiles from your service, and use the UI to query "top CPU over the last 15 minutes" and to select a specific time window. This is your first *continuous* (time-indexed) profiling pipeline.

**Constraints.**
- Profiles must be stored time-indexed and queryable by a time range, not collected one-off.
- Attach consistent labels: at minimum `service_name` and `version` (and `env`).
- Demonstrate selecting a narrow time window and seeing the flame graph *for that window only*.

**Hints.**
```yaml
# docker-compose.yml (Pyroscope server)
services:
  pyroscope:
    image: grafana/pyroscope:latest
    ports: ["4040:4040"]
```
```go
// Push from a Go service with the Pyroscope SDK:
pyroscope.Start(pyroscope.Config{
    ApplicationName: "checkout.cpu",
    ServerAddress:   "http://localhost:4040",
    Tags:            map[string]string{"version": "v1.2.3", "env": "local"},
    ProfileTypes:    []pyroscope.ProfileType{pyroscope.ProfileCPU, pyroscope.ProfileAllocSpace},
})
```
- Parca scrapes `/debug/pprof/*` like Prometheus scrapes `/metrics`; Pyroscope supports both push (SDK) and pull (eBPF/agent).
- The UI's time picker is the whole point — drive a load spike, then narrow the window to it.

**Self-check.**
- [ ] The UI shows your service's CPU flame graph for a chosen time range.
- [ ] "Top CPU over the last 15 min" returns a ranked view.
- [ ] Selecting a narrow window changes the flame graph to that window only.
- [ ] Your profiles carry `service_name` and `version` labels.

---

## Advanced

These tasks are 4-to-8 hours each. They reward methodical work over speed, and they are what separate a middle engineer from a senior one. Several have more than one defensible approach.

### Task 8: Diff two profiles and read the delta

**Problem.** Collect a baseline CPU profile, make a code change (an improvement *or* a regression — try both), collect a second profile under the same load, and run a **differential** comparison. Read the diff: which frames grew, which shrank, and by how much.

**Constraints.**
- Use `go tool pprof -diff_base` to compute the delta — do not eyeball two separate flame graphs.
- Keep load identical across both captures, or the diff conflates your change with traffic differences.
- Produce one run where a frame *grows* (red) and one where it *shrinks* (blue/green), and explain the colour.

**Hints.**
```bash
curl -s "http://localhost:6060/debug/pprof/profile?seconds=30" > old.pb.gz
# ... change code, redeploy, drive identical load ...
curl -s "http://localhost:6060/debug/pprof/profile?seconds=30" > new.pb.gz

# Diff: positive (red) = grew in new; negative (blue) = shrank in new
go tool pprof -http=:8080 -diff_base old.pb.gz new.pb.gz
go tool pprof -top -diff_base old.pb.gz new.pb.gz | head
```
- A diff flame graph shows the *delta* per frame: a function that got hotter is the regression; one that got cooler is the win.
- Differential flame graphs are the killer feature of continuous profiling — they are how a deploy gate spots a regression automatically.

**Self-check.**
- [ ] You ran `-diff_base` (a true delta), not a side-by-side eyeball.
- [ ] You produced both a "grew" (red) and a "shrank" diff and can read the sign.
- [ ] Load was identical across both captures.
- [ ] You can articulate that the diff measures change in *aggregate samples*, not change in wall-clock time.

### Task 9: Tie a latency spike to a flame graph at a timestamp

**Problem.** Using your continuous-profiling pipeline from Task 7, generate a deliberate latency spike at a known time (inject CPU-burning work, contention, or a slow path for a fixed window). Then, *after the fact*, pull the flame graph for exactly that window and identify the function responsible — without reproducing anything.

**Constraints.**
- The spike must be a transient window (e.g. 60 seconds), not a permanent change — you are practising querying *history*.
- You must find the cause from the time-windowed profile alone, then confirm it matches the code you injected.
- Note the timestamp before you start so you can navigate to it precisely.

**Hints.**
- This is the whole promise of continuous profiling: the evidence already exists; you query the window, you do not re-run the program.
- In Pyroscope, narrow the time picker to the spike window; the flame graph reflows to only those samples.
- In a real incident the chain is: a metric alerts at `t`, a trace points at a service, the *profile for `t`* names the line. Practise the last hop here.

**Self-check.**
- [ ] You navigated to the spike window after it ended (querying history, not live).
- [ ] The flame graph for that window is dominated by the function you injected.
- [ ] A profile from a *quiet* window does not show that function dominating — proving the time-indexing works.
- [ ] You can describe the metric → trace → profile click-path that this last step completes.

### Task 10: Whole-system eBPF profiling of a process you did NOT instrument

**Problem.** Run an eBPF-based whole-system profiler (parca-agent or Pyroscope's eBPF profiler) on a Linux host and profile a process you did **not** instrument and cannot modify — a stripped binary, a process in another language, or even a shell pipeline. Prove you got a flame graph with zero code changes to the target.

**Constraints.**
- The target must have **no profiling SDK, no `import`, no agent baked in** — that is the point of eBPF whole-system profiling.
- You need a Linux host (or VM/container with `CAP_BPF`/`CAP_PERFMON` or privileged mode).
- Produce a flame graph attributing CPU to the un-instrumented target.

**Hints.**
```bash
# parca-agent (run on the node; needs privileges to load eBPF programs)
sudo parca-agent \
  --remote-store-address=localhost:7070 \
  --remote-store-insecure \
  --node=local
```
```bash
# Or Pyroscope eBPF (grafana/pyroscope-ebpf), typically run privileged:
docker run --privileged --pid=host \
  pyroscope/pyroscope-ebpf:latest ebpf --server-address=http://host:4040
```
- Pick a busy target with no instrumentation: a `stress-ng` worker, a `sha256sum /dev/zero` loop, or a stripped C/Rust binary.
- Symbolization of stripped binaries is the catch — note where names resolve and where you get raw addresses (see the Symbolization section of the roadmap).

**Self-check.**
- [ ] You profiled a process with zero instrumentation and got a flame graph.
- [ ] The target had no SDK/import/agent of its own.
- [ ] You can explain why eBPF profiling is language-agnostic (it samples kernel-side stacks, not language hooks).
- [ ] You noted whether symbolization succeeded or produced raw addresses, and why.

---

## Capstone

These are open-ended scenarios. The point is not a single correct answer but to design and defend a complete approach. Treat each as if you are presenting it at a design review to a staff engineer.

### Task 11: Build a deploy-gate profile-regression check

**Problem.** Build an automated check that runs as part of a deploy (or in CI against a canary): it collects a CPU profile from the new build, diffs it against a stored baseline, and **fails the deploy** if any function's CPU share grew beyond a threshold you define.

**Constraints.**
- The check must collect a canary profile, diff it against a baseline profile (the last known-good build), and exit non-zero on regression.
- Define a concrete threshold (e.g. "fail if any single function's self-CPU share grew by more than 5 absolute percentage points, or more than 2× relative").
- Run identical load against baseline and canary, or the diff is noise — document how you make the workload comparable.
- Handle the noise problem: a sampled profile is statistical, so a tiny delta is not a regression. State your significance rule.

**Hints.**
```bash
# Sketch: collect canary, diff against baseline, parse the top delta, gate on it.
curl -s "http://canary:6060/debug/pprof/profile?seconds=60" > canary.pb.gz
go tool pprof -top -diff_base baseline.pb.gz canary.pb.gz > diff.txt
# parse diff.txt; if any function's delta exceeds the threshold -> exit 1
```
- Continuous-profiling vendors (Polar Signals/Parca, Pyroscope) ship regression-detection on exactly this idea — build the minimal version yourself first.
- Beware Goodhart-style gaming and false positives: a slightly noisy diff should not block every deploy. Tune the threshold against several known-good deploys before trusting it.

**What "done" looks like.** A script (or CI step) that, given a baseline profile and a fresh canary profile, produces a pass/fail with a human-readable reason ("`json.Marshal` self-CPU grew 6.2pp, over the 5pp budget"). You can demo it failing on a planted regression and passing on a benign change. You have written down the threshold, the significance rule (why small deltas are ignored), and how the baseline is updated when a deploy is accepted.

### Task 12: Design continuous profiling for a polyglot fleet

**Problem.** Design and stand up continuous profiling for a small multi-service, multi-language setup — say a Go API gateway, a Python worker, and a JVM service — with consistent `service`/`version` labels across all three, an overhead budget, and a runbook that takes an on-call from a p99 alert to the exact flame graph.

**Constraints.**
- The same label contract everywhere: `service_name`, `version`, `env` (and ideally `region`/`instance`) — identical keys and value formats across Go, Python, and JVM, so one query and one dashboard work for all three.
- A stated **overhead budget** (e.g. "≤ 2% CPU and ≤ 1% memory for profiling per process") and how you keep within it (sample rate, profile types enabled, push interval).
- Profiles must be time-indexed and queryable by service/version/window, and correlatable with the metrics and traces (profile-to-trace links / exemplars where supported).
- A written **runbook**: "given a p99 alert, here is the exact click-path from metric → trace → flame graph."

**Hints.**
- Agree the label contract *first*, as a shared doc, then implement per language — a single key mismatch (`service` vs `service_name`) breaks the uniform query, exactly like the cardinality lesson in `../metrics/`.
- Decide push (SDKs, per-language) vs pull/eBPF (one agent per node, language-agnostic) — or a hybrid. The eBPF agent gives you uniform coverage with no per-service work; SDKs give richer labels and allocation profiles.
- Keep the overhead budget honest: enable CPU everywhere, enable alloc/heap selectively, and pick a sample rate that fits the budget. Measure the actual overhead, do not assume it.
- The runbook's last hop reuses Task 9: alert at `t` → trace names the service → profile for `t` names the line.

**What "done" looks like.** A one-page label contract (keys, value formats, which profile types each service emits). A running pipeline (SDKs and/or an eBPF agent → Pyroscope/Parca) where one dashboard renders flame graphs for any of the three services via a service selector. A documented overhead budget with a measured actual number per service. A one-page runbook an on-call can follow: from a p99 metric alert, find the slow span in the trace, pull the profile for that service and timestamp, and land on the hot line — all without reproducing anything. You can demo it: inject a regression in the Python worker, watch the p99 alert, and walk the runbook to the offending line in under two minutes.

---

## If you can do all of these, you have the senior level

You can add profiling to a service in any of the major languages, attach to a running process by PID with no redeploy, and read a flame graph by reflex — widest leaf first, top-down, knowing the width is samples and the x-axis is not time. You can reproduce and fix both a CPU hotspot and an allocation hotspot and *prove* the fix with a before/after profile. You know when the CPU profile is lying to you and reach for the off-CPU/block profile instead. You can stand up a continuous pipeline, query profiles over time, diff two builds, and tie a historical latency spike to the exact line that caused it. And you can profile a process nobody instrumented, using eBPF, in any language. The next step is not more profiling drills — it is owning the deploy gate and the fleet design that turn all of this from a debugging skill into a standing, automated guarantee that performance regressions never reach production unnoticed.

---

## Related Topics

- [Continuous Profiling — Junior](junior.md)
- [Continuous Profiling — Middle](middle.md)
- [Continuous Profiling — Senior](senior.md)
- [Continuous Profiling — Professional](professional.md)
- [Continuous Profiling — Interview](interview.md)
- [Continuous Profiling — Roadmap README](README.md)

**Sibling diagnostic topics:**

- [Metrics](../metrics/) — the signal that *alerts* you something is slow; the start of the click-path that ends in a flame graph.
- [Tracing](../tracing/) — narrows the slowness to a span; the profile narrows it to a line. Profile-to-trace exemplars link the two.
- [Logging](../logging/) — the per-event pillar where identity (`user_id`, `request_id`) belongs.
- [Observability Engineering](../observability-engineering/) — how the four signals fit together end to end.
- [Dynamic Instrumentation & eBPF](../dynamic-instrumentation-and-ebpf/) — the kernel tech behind language-agnostic, zero-instrumentation profiling (Task 10).
- [Telemetry Cost & Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — the overhead/storage budget that keeps continuous profiling affordable at fleet scale.

**Cross-roadmap links:**

- [Quality Engineering → Performance → Profiling](../../quality-engineering/performance/01-profiling/) — the one-off, laptop, "now I'll fix this function" counterpart. These exercises find the hot function in production; that section teaches you to optimise it.
