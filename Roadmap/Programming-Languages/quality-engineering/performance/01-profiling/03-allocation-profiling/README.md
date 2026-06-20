# Allocation Profiling

> *"Most 'GC problems' are allocation problems in disguise — the GC ran a lot because there was a lot to collect."*

Allocation profiling attributes *where allocations happen*, not what stays alive. In GC'd languages this is usually a better optimisation target than heap usage, because reducing allocation rate reduces both GC pressure *and* per-call cost.

---

## Scope

- Go `pprof -alloc_space` and `-alloc_objects` — the two questions are different
- Java JFR allocation events, async-profiler `--alloc`
- Python `tracemalloc`, `mem_top`
- .NET ETW allocation events
- The escape-analysis connection — what would have stayed on the stack but didn't
- Reading: per-call-site allocation totals vs counts; "many small" vs "few large"
- Common culprits: hidden boxing, string concatenation, defensive copies, intermediate slices

## Related

- **[Memory Profiling](../02-memory-profiling/)** — what's *retained* (different question, same tool sometimes).
- **[Memory Optimization](../../05-memory-and-allocation-profiling/)** — reducing rate at the source.
- **[Language Internals → Escape Analysis](../../../../language-internals/memory-management/08-escape-analysis/)** — why some allocations could have stayed on the stack.
- **[Language Internals → Tracing GC](../../../../language-internals/memory-management/05-tracing-garbage-collection/)** — why allocation rate matters for pause times.

---

## Status

✅ Content-complete — all five tiers written ([junior](junior.md) / [middle](middle.md) / [senior](senior.md) / [professional](professional.md) / [interview](interview.md)).
