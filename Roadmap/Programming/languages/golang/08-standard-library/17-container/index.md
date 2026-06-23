# 8.17 `container/*` — Index

The standard library ships three pre-generics container packages:
`container/heap`, `container/list`, `container/ring`. None of them is
generic; all of them require an interface implementation or
`interface{}` payloads. Two of them (`heap`, `list`) still earn their
keep in real code; one (`ring`) is mostly historical.

This leaf covers the contracts, the priority-queue idiom that makes
`heap` worthwhile, the LRU-cache idiom that makes `list` worthwhile,
and where to reach for a third-party generic alternative instead.

## Files

| File | Audience | Topics |
|------|----------|--------|
| [junior.md](junior.md) | First exposure | Heap interface, push/pop, list traversal, ring basics |
| [middle.md](middle.md) | Production user | Priority queues with `Update`, LRU cache, generic wrappers |
| [senior.md](senior.md) | Library author | Invariants, complexity proofs, allocation profile, GC pressure |
| [professional.md](professional.md) | Systems work | Timer wheels, scheduler queues, top-K, replacement choices |
| [specification.md](specification.md) | Reference | Exact method signatures and contracts |
| [interview.md](interview.md) | Hiring loop | Twenty-five questions with model answers |
| [tasks.md](tasks.md) | Practice | Ten exercises across all three packages |
| [find-bug.md](find-bug.md) | Drills | Eight broken snippets to diagnose |
| [optimize.md](optimize.md) | Tuning | Cache locality, allocation reduction, generic rewrites |

Cross-references: [`../16-sort-slices-maps/`](../16-sort-slices-maps/)
for the underlying `sort.Interface` that `heap.Interface` extends, and
for the generic `slices`/`maps` packages that increasingly replace the
old container code.
