# CPU Profiling

> *"A function that's 30% of the profile is the one to look at. A function that's 0.3% is not — even if the change is satisfying to make."*

CPU profiles attribute *where the CPU spent its cycles* — wall-clock vs on-CPU, sampling vs instrumenting, what's actually a "hot" function vs what just *runs* a lot. This is the most commonly read profile shape, and the one where bad reading habits do the most damage.

---

## Scope

- Sampling profilers: how they work (signal-driven stack capture, perf events), accuracy vs overhead
- Wall-clock vs on-CPU time — and why the two profiles disagree
- `pprof` (Go), async-profiler / JFR (Java), `perf` (Linux), Instruments (macOS), `py-spy` (Python), `cargo flamegraph` (Rust)
- Symbolication: why a frame says `??` and how to fix it
- Reading: top, callgraph, cumulative vs flat; the difference matters

## Related

- **[Flame Graphs](../04-flame-graphs/)** — the dominant visualisation for CPU profiles.
- **[Benchmarking](../../02-benchmarking-and-microbenchmarks/)** — comparison after profile-guided change.
- **[Diagnostics → Diagnostic Endpoints](../../../../diagnostics/diagnostic-endpoints/)** — `/debug/pprof` for live capture.

---

## Status

✅ Content-complete — all five tiers written ([junior](junior.md) / [middle](middle.md) / [senior](senior.md) / [professional](professional.md) / [interview](interview.md)).
