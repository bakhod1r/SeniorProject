# Memory Profiling

> *"The leak you can find is the one you can attribute. The leak you can attribute is the one whose retention path you can read."*

Memory profiling answers *what is alive in the heap right now, and what keeps it alive*. Distinct from [Allocation Profiling](../03-allocation-profiling/) (which counts what was *allocated*), this section is about what was *retained*.

---

## Scope

- Heap snapshots: `.hprof` (Java), `runtime.WriteHeapProfile` (Go), `tracemalloc` (Python), `.heapsnapshot` (Node)
- The dominator tree — "if X were collected, how much memory would be freed?"
- Retained vs shallow size — the most-misread number in any heap tool
- Eclipse MAT, VisualVM, Chrome DevTools heap snapshots, `go tool pprof -alloc_space`
- Leak hunting: comparison snapshots ("before" / "after" diffs), growing collections
- The GC-vs-leak distinction — high heap usage is not always a leak

## Related

- **[Allocation Profiling](../03-allocation-profiling/)** — the *rate* side; usually the easier optimisation target.
- **[Memory Optimization](../../05-memory-and-allocation-profiling/)** — what to do once you know what's retained.
- **[Diagnostics → Post-Mortem Analysis](../../../../diagnostics/post-mortem-analysis/)** — heap dumps captured at crash time.
- **[Language Internals → Memory Management](../../../../language-internals/memory-management/)** — GC strategies and their effect on what "memory profile" even means.

---

## Status

✅ Content-complete — all five tiers written ([junior](junior.md) / [middle](middle.md) / [senior](senior.md) / [professional](professional.md) / [interview](interview.md)).
