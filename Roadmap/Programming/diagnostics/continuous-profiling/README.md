# Continuous Profiling Roadmap

> *"A profile you took once on your laptop tells you how your laptop was slow. A profile that's always running in production tells you which line of code is burning a CPU right now, for a real customer, under real load."*

This roadmap is about **always-on, low-overhead profiling of production systems** — sampling the CPU, heap, locks, and goroutines/threads of every process in the fleet, continuously, and storing the profiles time-indexed so you can ask "what was burning CPU during the 14:32 latency spike?" and "did this deploy regress allocations?" It is the emerging **fourth signal** of observability, sitting alongside [Logging](../logging/), [Metrics](../metrics/), and [Tracing](../tracing/). The point-in-time, run-it-on-your-laptop counterpart lives in [Quality Engineering → Performance → Profiling](../../quality-engineering/performance/01-profiling/); this roadmap is about doing it *continuously, in prod, fleet-wide*.

> Looking for *how to optimise a hot function* once you've found it? That's [Performance → Profiling](../../quality-engineering/performance/01-profiling/). This section finds the hot function in production; that one teaches you to fix it.
>
> Looking for the *kernel-level instrumentation* that makes language-agnostic profiling possible? See [Dynamic Instrumentation & eBPF](../dynamic-instrumentation-and-ebpf/).

---

## Why a Dedicated Roadmap

Most engineers profile *reactively, once, on a laptop, with synthetic input* — and the bug only manifests under production data, production concurrency, and production cache behaviour. Continuous profiling inverts that:

- **The bug only shows in prod.** The slow path is the one your test workload never hits — a pathological customer payload, a cold cache, a contended lock at 10× the QPS you tested.
- **Sampling is cheap enough to leave on.** A timer-sampled profiler costs ~1–2% CPU. That's affordable as a permanent tax, which makes "profile everything, always" viable.
- **Profiles become time-indexed, like metrics.** You stop asking "let me reproduce and profile this" and start asking "show me the flame graph for the p99 window last Tuesday."
- **Differential flame graphs are the killer feature.** Diff this deploy against the last one and the regression lights up in red — automatically, in the deploy gate.

| Roadmap | Question it answers |
|---|---|
| [Logging](../logging/README.md) | What happened, in human-readable form? |
| [Metrics](../metrics/README.md) | What's the aggregate behaviour over time? |
| [Tracing](../tracing/README.md) | What path did one request take across services? |
| **Continuous Profiling** (this) | Which *line of code* is burning CPU / allocating / blocking, right now, in prod? |
| [Point-in-time profiling](../../quality-engineering/performance/01-profiling/) | Why is *this function* slow, and how do I fix it? (one-off, on a laptop) |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | What Continuous Profiling Is | Always-on prod sampling vs one-off laptop profiling; the 4th signal |
| 02 | Profile Types | CPU (on-CPU), wall-clock/off-CPU, heap/alloc, goroutine/thread, mutex/block |
| 03 | Reading Flame Graphs | Width = aggregate samples (NOT time order); icicle vs flame; how to read one |
| 04 | Differential Flame Graphs | Diffing two profiles (before/after deploy); the killer feature |
| 05 | How Sampling Profilers Work | Timer/perf-event sampled stacks; statistical sampling vs instrumentation |
| 06 | Symbolization | Turning addresses into function names; debug info, unwinding, stripped binaries |
| 07 | The pprof Format | The lingua franca; `go tool pprof`, protobuf profiles, the OTel profiling signal |
| 08 | eBPF Whole-System Profiling | Profiling *any* language with zero instrumentation; parca-agent, Pyroscope eBPF |
| 09 | Tooling Landscape | Parca, Pyroscope/Grafana, Polar Signals, Datadog, CodeGuru |
| 10 | Language Specifics | Go pprof, JVM async-profiler/JFR, py-spy, Node, Rust pprof-rs |
| 11 | The Workflow | Collect → store time-indexed → query → diff → tie a latency spike to a flame graph |
| 12 | Correlation & Cost | Profile-to-trace links/exemplars, overhead budgets, storage cost, deploy-gate regression detection |

---

## Languages

Examples in **Go** (built-in `net/http/pprof` and `go tool pprof` — the gold standard), **Java/JVM** (async-profiler, Java Flight Recorder / JFR), **Python** (`py-spy`, Pyroscope), **Node** (`--prof`, `clinic`, `0x`), **Rust** (`pprof-rs`, `perf`), and the **language-agnostic** path via eBPF (parca-agent, Pyroscope eBPF) that profiles any process with no code changes.

---

## Status

✅ **Content complete** — `junior` · `middle` · `senior` · `professional` · `interview` · `tasks`.

---

## References

- *Systems Performance* & *BPF Performance Tools* — Brendan Gregg (flame graphs, sampling, off-CPU analysis)
- *Flame Graphs* — Brendan Gregg (the original writeup and the "width is samples, not time" rule)
- Parca / Polar Signals docs — continuous profiling architecture and the pprof storage model
- Grafana Pyroscope docs — language SDKs and eBPF whole-system profiling
- OpenTelemetry — the profiling signal specification (the emerging 4th signal)
- Go blog — *Profiling Go Programs* (the canonical pprof tutorial)

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
