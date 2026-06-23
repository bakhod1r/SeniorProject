# 8.16 — `sort`, `slices`, and `maps`

Three packages, one job: ordering and bulk operations on collections.
`sort` is the original interface-based API that has shipped since Go 1.
`slices` and `maps` are the generic Go 1.21+ replacements that handle 90%
of real code in one line. This leaf covers all three together because
new code freely mixes them, and the migration story matters.

The internal sort algorithm changed in Go 1.19 to pattern-defeating
quicksort (`pdqsort`) — `O(n log n)` worst case, fast on already-sorted
or partially-sorted data. Both `sort.Sort` and `slices.Sort` use it.

## Files in this leaf

| File | Read this when… |
|------|-----------------|
| [junior.md](junior.md) | You need the everyday APIs and copy-paste examples |
| [middle.md](middle.md) | You're implementing `Less`, picking stable vs unstable, mixing `sort` and `slices` |
| [senior.md](senior.md) | You need exact contracts: total order, stability, allocator behavior |
| [professional.md](professional.md) | You're shipping high-throughput code, measuring `SortFunc` vs `Sort` |
| [specification.md](specification.md) | You want the formal reference — every function, every guarantee |
| [interview.md](interview.md) | You're preparing for or running interviews on stdlib ordering |
| [tasks.md](tasks.md) | You want hands-on exercises with acceptance criteria |
| [find-bug.md](find-bug.md) | You want to train your eye for sorting and search bugs |
| [optimize.md](optimize.md) | You're cutting allocations or micro-tuning hot sort paths |

## Prerequisites

- Go 1.22+ (examples assume `slices`, `maps`, `cmp`, and the iterator
  forms added in 1.23 are available; deps on 1.21 or 1.23 features are
  marked inline).
- Comfortable with generics and basic interfaces.

## Cross-references

- [`08-standard-library/03-time`](../03-time/index.md) — `time.Time` is
  sortable; the comparator pitfalls show up there too.
- [`08-standard-library/04-encoding-json`](../04-encoding-json/) — map
  iteration order matters for stable JSON output.
- [`08-standard-library/17-container`](../17-container/) — heap and list
  for sorting that doesn't fit the `slices` model.
