# Flame Graphs

> *"Once you can read a flame graph, you can debug performance in any language whose profiler emits stacks."*

Flame graphs are the visualisation Brendan Gregg invented to make sampled stack profiles tractable to read. Width = time spent (or allocations, or any sampled metric); stack depth = call depth; colour is usually meaningless (just contrast). They work for CPU, allocations, off-CPU, lock contention — anything that emits stacks.

---

## Scope

- Anatomy: x-axis = time/share, y-axis = stack depth, ordering is alphabetical (no time axis)
- Reading: wide plateaus = hot functions, deep narrow towers = hot call paths, "icicle" inverted flame graphs
- Differential flame graphs — before/after comparison
- Off-CPU flame graphs — what's *blocking*, not what's running (the under-used variant)
- Generating: `flamegraph.pl`, `cargo flamegraph`, `pprof -http`, async-profiler, Speedscope, FlameScope
- Common misreadings: "this function is 50% so I'll optimise it" (cumulative vs flat confusion)

## Related

- **[CPU Profiling](../01-cpu-profiling/)** — the most common profile flame graphs visualise.
- **[Allocation Profiling](../03-allocation-profiling/)** — same visualisation, different metric.
- **Brendan Gregg's reference** — `brendangregg.com/flamegraphs.html` (the canonical resource).

---

## Status

✅ Content-complete — all five tiers written ([junior](junior.md) / [middle](middle.md) / [senior](senior.md) / [professional](professional.md) / [interview](interview.md)).
