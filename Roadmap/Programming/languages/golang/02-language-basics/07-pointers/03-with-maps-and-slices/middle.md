# Go Pointers with Maps & Slices — Middle Level

## 1. Introduction

At the middle level you reason precisely about the interactions between pointers, slice element addressability, append-realloc semantics, map non-addressability, and the GC implications of pointer-vs-value choices in collections.

---

## 2. Prerequisites
- Junior-level material
- Slice internals (header, capacity, growth)
- Map internals (hash buckets)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Realloc | When append exceeds capacity and allocates a new backing array |
| Capacity | Maximum length the slice can grow to without realloc |
| Pointer density | Number of pointer fields/elements per data structure |
| Slice aliasing | Two slices sharing the same backing array (or a portion) |
| Map bucket | Internal cell holding hash table entries |

---

## 4. Core Concepts

### 4.1 Append Semantics
```go
s := make([]int, 3, 5)
s = append(s, 99)   // fits in cap; same backing
s = append(s, 1, 2, 3) // exceeds cap; realloc
```

After realloc, the OLD backing array is detached. Any pointers to the old array become stale.

```go
p := &s[0]
s = append(s, manyValues...) // realloc
*p // refers to old array
```

### 4.2 Slice Aliasing
```go
a := []int{1, 2, 3, 4, 5}
b := a[1:4] // shares backing
b[0] = 99
// a[1] is now 99
```

### 4.3 Map Value Cannot Be Addressed
The runtime moves values during rehashing. Stable addresses would prevent this.

For mutation, store pointers:
```go
m := map[string]*Counter{"a": {}}
m["a"].N++ // OK: pointer dereference is addressable
```

### 4.4 Pointer-to-Slice Use Case
```go
func reset(sp *[]int) { *sp = nil }
// Reassigns the caller's slice header.
```

Use when the function must REPLACE the slice, not just modify elements.

### 4.5 GC Implications
- `[]T` (value slice): single allocation, contiguous, fewer GC roots.
- `[]*T` (pointer slice): N+1 allocations (slice + each *T), pointer scan per element.

For 1M items, the difference can be 100× in GC scan time.

### 4.6 Map Inline vs Pointer Storage
- Small value type (≤ ~128 B): stored inline in buckets.
- Large or pointer-typed value: stored as pointer; bucket holds the pointer.

For huge structs in maps, prefer `map[K]*V` to keep buckets compact.

---

## 5. Real-World Analogies

**A bookshelf with rearrangements**: when more books arrive than the shelf holds, the librarian moves everything to a bigger shelf. Anyone with a finger pointing at a book on the old shelf is left with a dangling reference.

---

## 6. Mental Models

### Model 1 — Slice header + array

```
Slice s:  ┌────────┬─────┬─────┐
          │ array* │ len │ cap │
          └───┬────┴─────┴─────┘
              │
              ▼
         ┌─────┬─────┬─────┬─────┐
         │  1  │  2  │  3  │ ... │
         └─────┴─────┴─────┴─────┘
         backing array (heap or stack)
```

### Model 2 — Append decision

```
if len(s) < cap(s):
    s.array[len(s)] = newValue
    s.len++
else:
    newArr := alloc(2 * cap(s))
    copy(newArr, s.array)
    newArr[len(s)] = newValue
    s = {newArr, len(s)+1, 2*cap(s)}
```

The realloc is what invalidates external pointers.

---

## 7. Pros & Cons

### Pros (Slice element pointers)
- Direct mutation
- Useful for in-place algorithms

### Cons
- Stale after append realloc
- Aliasing surprises

### Pros (Map of pointers)
- Mutable values
- Compact buckets (8 B per pointer)

### Cons
- Extra allocation per value
- More GC roots

---

## 8. Use Cases

1. In-place slice mutation via index pointer.
2. Map of pointers for mutable values.
3. Pointer-to-slice for header reassignment.
4. Slice of pointers for shared/heterogeneous items.
5. Sub-slice for views without copy.

---

## 9. Code Examples

### Example 1 — Index Loop With Pointer
```go
s := []Point{{1,2}, {3,4}, {5,6}}
for i := range s {
    s[i].X *= 2 // index access; mutates in place
    // or: p := &s[i]; p.X *= 2
}
```

### Example 2 — Stale Pointer Demo
```go
s := make([]int, 3, 3)
s[0] = 1; s[1] = 2; s[2] = 3
p := &s[0]
s = append(s, 99)  // realloc!
fmt.Println(*p, s) // *p=1 (old array); s=[1 2 3 99] (new array)
```

### Example 3 — Map of Pointers
```go
type Player struct{ Score int }
players := map[string]*Player{
    "alice": {},
    "bob":   {},
}
players["alice"].Score = 100
players["bob"].Score = 50
```

### Example 4 — Pointer-to-Slice for Append
```go
func appendItems(sp *[]Item, items ...Item) {
    *sp = append(*sp, items...)
}

var s []Item
appendItems(&s, Item{}, Item{})
fmt.Println(len(s)) // 2
```

### Example 5 — Defensive Copy
```go
type Cache struct{ items []Item }

func (c *Cache) Set(items []Item) {
    c.items = append([]Item(nil), items...) // independent copy
}
```

### Example 6 — Map Value Extract-Mutate-Restore (When Pointer Not Used)
```go
type Counter struct{ N int }
m := map[string]Counter{}
m["a"] = Counter{}

c := m["a"]
c.N++
m["a"] = c
fmt.Println(m["a"].N) // 1
```

---

## 10. Coding Patterns

### Pattern 1 — Map of Pointers
```go
m := map[K]*V{}
```
Standard for any V that needs in-place mutation.

### Pattern 2 — Slice Index Mutation
```go
for i := range s { s[i].update() }
```

### Pattern 3 — Defensive Copy
```go
out := append([]T(nil), in...) // independent copy
```

### Pattern 4 — Pointer-to-Slice (Rare)
```go
func grow(sp *[]int, vs ...int) { *sp = append(*sp, vs...) }
```

### Pattern 5 — Refresh After Append
```go
s = append(s, ...) // ALWAYS reassign
```

---

## 11. Clean Code Guidelines

1. Prefer index access (`s[i]`) over element pointers when possible.
2. Use `map[K]*V` for mutable struct values.
3. Don't store pointers to slice elements past appends.
4. Always reassign after `append`.
5. Defensive copy when storing caller-provided slices.

---

## 12. Product Use / Feature Example

**Event aggregator with mutable counters**:

```go
type Stats struct {
    Count int
    Sum   float64
}

aggregator := map[string]*Stats{}

func record(category string, value float64) {
    s, ok := aggregator[category]
    if !ok {
        s = &Stats{}
        aggregator[category] = s
    }
    s.Count++
    s.Sum += value
}

record("fast", 1.0); record("fast", 2.0); record("slow", 5.0)
fmt.Printf("%+v\n", aggregator["fast"]) // &{2 3.0}
```

`*Stats` enables direct mutation; with `Stats`, you'd need extract-modify-restore each call.

---

## 13. Error Handling

```go
m := map[string]*Counter{}
c, ok := m["a"]
if !ok {
    return fmt.Errorf("missing")
}
if c == nil {
    return fmt.Errorf("nil counter")
}
c.N++
```

---

## 14. Security Considerations

1. Aliasing: caller-provided slices passed to your function are NOT defensively copied unless you do so.
2. Map of pointers exposes internal state if returned.
3. Stale pointers after append are a subtle bug source.

---

## 15. Performance Tips

1. Pre-allocate slice cap: `make([]T, 0, expectedN)`.
2. Pre-allocate map size: `make(map[K]V, expectedN)`.
3. `[]T` vs `[]*T`: prefer values for fewer GC roots.
4. Map with large value type: use `map[K]*V` for compact buckets.
5. Don't copy huge slices unnecessarily — pass by header (which is what you'd do anyway).

---

## 16. Metrics & Analytics

```go
counters := map[string]int{}
for _, e := range events {
    counters[e.Type]++
}
```

For int-typed map values, `m[k]++` works directly (it's `m[k] = m[k] + 1`).

---

## 17. Best Practices

1. Map of pointers for mutable struct values.
2. Slice index access for element mutation.
3. Defensive copy for safety.
4. Pre-allocate capacity.
5. Reassign after append.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — Stale Pointer After Append
Discussed extensively.

### Pitfall 2 — Subslice Holds Backing Alive
```go
big := make([]byte, 1<<20)
small := big[:10]
big = nil
// small keeps the 1 MB array alive
```

### Pitfall 3 — Map Value Can't Be Addressed
Use pointer values.

### Pitfall 4 — Slice Aliasing Through Subslice
```go
a := []int{1, 2, 3}
b := a[:]
b[0] = 99
// a[0] is also 99
```

### Pitfall 5 — `append` to Sub-slice
```go
a := []int{1, 2, 3, 4, 5}
b := a[:3] // cap = 5
b = append(b, 99) // OVERWRITES a[3]
fmt.Println(a) // [1 2 3 99 5]
```

To isolate: `b := append([]int{}, a[:3]...)`.

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| `&m[k]` | Use map[K]*V or extract |
| Stale pointer after append | Reassign or refresh |
| Subslice append surprising | Use defensive copy |
| Forgetting to capture append result | Always `s = append(s, ...)` |

---

## 20. Common Misconceptions

**1**: "Slices are pass-by-reference."
**Truth**: Header pass-by-value; backing shared.

**2**: "Map of values is the same as map of pointers."
**Truth**: Mutation semantics differ — values can't have field mutated; pointers can.

**3**: "Subslice is independent."
**Truth**: Shares backing array with parent; can affect parent's elements.

---

## 21. Tricky Points

1. Append's realloc invalidates element pointers.
2. Subslice append may overwrite parent slice elements (within cap).
3. Map values can't be addressed even when pointer-typed (the pointer itself is in the map; the dereferenced target IS addressable).
4. `make` size hints help avoid reallocations.

---

## 22. Test

```go
func TestMapPointerMutation(t *testing.T) {
    m := map[string]*Counter{"a": {N: 0}}
    m["a"].N++
    if m["a"].N != 1 { t.Fail() }
}

func TestStaleAppend(t *testing.T) {
    s := make([]int, 3, 3)
    p := &s[0]
    s = append(s, 99)
    *p = 999
    if s[0] == 999 { t.Errorf("expected stale pointer; got s[0]=%d", s[0]) }
}
```

---

## 23. Tricky Questions

**Q1**: What does this print?
```go
a := []int{1, 2, 3}
b := a[:2]
b = append(b, 99)
fmt.Println(a)
```
**A**: `[1 2 99]`. b's append wrote to a[2] within shared backing.

**Q2**: What does this print?
```go
m := map[string]int{"a": 1}
v := m["a"]
v++
fmt.Println(m["a"])
```
**A**: `1`. `v` is a copy.

---

## 24. Cheat Sheet

```go
// Mutable map values: use pointer
m := map[K]*V{}; m[k] = &V{}; m[k].Field = ...

// Slice element pointer (careful with append)
p := &s[i]; *p = ...

// Pointer to slice (rare)
func reset(sp *[]int) { *sp = nil }

// Always reassign append
s = append(s, ...)

// Defensive copy
out := append([]T(nil), in...)
```

---

## 25. Self-Assessment Checklist

- [ ] I use map[K]*V for mutable struct values
- [ ] I always reassign after append
- [ ] I avoid stale pointers
- [ ] I defensively copy at API boundaries
- [ ] I pre-allocate capacity for known sizes

---

## 26. Summary

Slices: header-by-value, backing shared; elements addressable but pointers go stale after append realloc. Maps: handle shared, values not addressable; use `map[K]*V` for mutable values. Always reassign after `append`. Defensive copy for safety. Pre-allocate capacities for performance.

---

## 27. What You Can Build

- In-place slice algorithms
- Mutable counter/aggregation maps
- Caches with safe storage
- Sub-slice processors

---

## 28. Further Reading

- [Slices internals](https://go.dev/blog/slices-intro)
- [Maps in action](https://go.dev/blog/maps)

---

## 29. Related Topics

- 2.7.1, 2.7.2
- 2.3.2 Slices, 2.3.4 Maps
- 2.6.7 Call by Value

---

## 30. Diagrams & Visual Aids

### Append realloc

```
Before append (cap=3):
  s [arr*=A | len=3 | cap=3] → [1, 2, 3]
  p = &s[0]                  ↗

After append exceeds cap:
  s [arr*=B | len=4 | cap=6] → [1, 2, 3, 99]   ← new array B
  p still points to A:        → [1, 2, 3]      ← stale!
```
