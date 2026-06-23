# Go Pointers with Maps & Slices — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: Are slices passed by reference?**

**Answer**: No — they're passed by value. The slice HEADER (3 words: pointer, len, cap) is copied. But the header points to a backing array that's SHARED. Element mutations propagate; header reassignment doesn't.

```go
func zero(s []int) { s[0] = 0 } // visible to caller
func clear(s []int) { s = nil }   // local; not visible
```

---

**Q2: Why is `&m["key"]` a compile error?**

**Answer**: Map values are not addressable because the runtime may move them during rehashing. A stable address would prevent that. To mutate a struct value, store pointers: `map[K]*V`.

---

**Q3: How do you mutate a struct stored in a map?**

**Answer**: Two options:

```go
// Option 1: store pointers
m := map[string]*Counter{"a": {}}
m["a"].N++

// Option 2: extract, modify, restore
c := m["a"]
c.N++
m["a"] = c
```

Pointer storage is the standard idiom for mutable values.

---

**Q4: Can you take the address of a slice element?**

**Answer**: Yes:
```go
p := &s[0]
*p = 99
```

But: after `append(s, ...)` that triggers reallocation, `p` becomes stale (points to the old backing array).

---

## Middle Level Questions

**Q5: What's the difference between `[]T` and `[]*T`?**

**Answer**:
- `[]T`: contiguous values, single allocation, fewer GC roots, better cache locality.
- `[]*T`: pointers to T instances (which may be allocated separately), N+1 allocations, N pointer GC roots.

Use `[]*T` when sharing T across slices, when T is large, or for polymorphism. Otherwise prefer `[]T`.

---

**Q6: What happens when `append` exceeds the slice's capacity?**

**Answer**:
1. The runtime allocates a new backing array (typically 2× the old cap for small slices).
2. Existing elements are copied to the new array.
3. The new element is added.
4. The function returns a slice header pointing to the new array.

If you stored pointers to elements of the old array, those pointers are now stale.

---

**Q7: Why must you reassign after `append`?**

**Answer**: `append` may reallocate, returning a new slice header. Without reassigning:
```go
append(s, v) // returned value discarded; s unchanged
s = append(s, v) // s updated
```

You may not see the appended value if the function discards the return.

---

**Q8: How do you defensively copy a slice?**

**Answer**:
```go
out := append([]T(nil), in...)
```

Or:
```go
out := make([]T, len(in))
copy(out, in)
```

Both produce an independent slice with its own backing array.

---

## Senior Level Questions

**Q9: Are map operations goroutine-safe?**

**Answer**: **No**. Concurrent reads + writes (or two writes) panic with "concurrent map read and map write". Options:
- `sync.RWMutex` for protected access.
- `sync.Map` for "set once, read many" or disjoint-key workloads.
- `atomic.Pointer[map]` for snapshot-replace pattern.

---

**Q10: How does map growth work?**

**Answer**: Maps grow incrementally:
1. When load factor exceeds threshold (~6.5 avg per bucket), a new buckets array is allocated (2× size).
2. Subsequent operations move buckets from old to new (incremental rehash).
3. After all buckets moved, the old array is freed.

This amortizes the O(N) rehash cost across operations.

---

**Q11: What's the cost of pointer density in slices/maps?**

**Answer**: Each pointer is a GC root. The GC scans roots on every cycle.

For 1M items:
- `[]Item` (value slice): 1 root (the backing array).
- `[]*Item` (pointer slice): 1M+ roots.

GC scan time differs by orders of magnitude. For high-throughput services, pointer density is a major performance concern.

---

**Q12: Why does a subslice keep the entire backing array alive?**

**Answer**: The slice header's `array` field points into the backing array. The GC tracks the entire allocation block, not portions. As long as ANY slice references the backing, the whole block is alive.

To shrink:
```go
small := make([]T, len(big[:n]))
copy(small, big[:n])
// big can now be GC'd
```

---

## Scenario-Based Questions

**Q13: A service uses a `map[string]Config` where Config is 4 KB. Map operations are slow. Why?**

**Answer**: Map buckets store 8 (key, value) pairs each. With 4 KB values, each bucket is ~32 KB — far exceeding cache lines. Probing requires loading entire buckets, causing cache misses.

Fix: `map[string]*Config`. Each bucket value slot is 8 B; buckets fit in L1 cache.

---

**Q14: Tests pass locally but fail in CI with "concurrent map read and map write". What's wrong?**

**Answer**: Goroutines access a shared map without synchronization. CI is faster (or slower) and exposes the race.

Fix:
- `sync.RWMutex` around all access.
- `sync.Map`.
- `atomic.Pointer[map]` if the map is read-mostly.

Always run tests with `-race`.

---

## FAQ

**Why do slices share backing arrays after function calls?**

To enable in-place mutation efficiently. Copying the array on every call would be expensive.

---

**Should I always use `make([]T, 0, n)` instead of `var s []T`?**

If you know `n` (or an upper bound), yes. Saves reallocations. For unknown sizes, `var s []T` is fine; `append` grows incrementally.

---

**When should I use `sync.Map` vs `sync.RWMutex` + map?**

`sync.Map` excels at:
- Set-once, read-many.
- Goroutines with disjoint keys.

For typical mixed read+write, `sync.RWMutex + map` is usually faster and clearer.

---

**Can I delete from a map while iterating?**

Yes. `delete(m, k)` during iteration is safe; the deleted entry may or may not appear in the iteration depending on timing.

Adding entries during iteration is also safe but the new entries may or may not appear.
