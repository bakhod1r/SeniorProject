# Slice Tricks — Specification

> **Focus:** Reference card for the canonical slice idioms — the operations catalogued in the Go wiki's "SliceTricks" page — with allocation profile, asymptotic cost, pointer-safety notes, and the `slices` package (Go 1.21+) equivalent for each.
>
> **Sources:**
> - SliceTricks wiki: https://github.com/golang/go/wiki/SliceTricks
> - `slices` package: https://pkg.go.dev/slices
> - `slices` source: https://cs.opensource.google/go/go/+/refs/tags/go1.23.0:src/slices/slices.go
> - `builtin.clear`: https://pkg.go.dev/builtin#clear
> - Three-index slice expression: https://go.dev/ref/spec#Slice_expressions

---

## 1. Conventions used in this reference

| Symbol | Meaning |
|--------|---------|
| `s` | a slice `[]T` |
| `n` | `len(s)` |
| `c` | `cap(s)` |
| `T` | element type |
| `T*` | a type containing one or more pointers (`*X`, `string`, `[]X`, `map[K]V`, `interface{}`, `chan`, function, or a struct/array transitively containing any of these) |
| `i`, `j` | indices into `s`, `0 ≤ i ≤ j ≤ n` |
| "in-place" | reuses the existing backing array; no new allocation when `cap` suffices |

`B/op` is bytes per operation; `allocs/op` is heap allocations per operation. Both measured by `go test -benchmem` for `[]int` slices of length 1000 unless noted.

---

## 2. Insert at index `i`

**Wiki trick:**

```go
s = append(s[:i], append([]T{x}, s[i:]...)...)
```

**`slices.*` equivalent:**

```go
s = slices.Insert(s, i, x)             // single element
s = slices.Insert(s, i, x1, x2, x3)    // multiple elements (variadic)
```

| | Wiki trick | `slices.Insert` |
|-|------------|-----------------|
| Allocations (cap fits) | 1 (literal) | 0 |
| Allocations (cap grows) | 2 | 1 |
| Time | O(n−i) | O(n−i) |
| Pointer-safe | yes | yes |

---

## 3. Insert range at index `i`

**Wiki trick:**

```go
s = append(s[:i], append(v, s[i:]...)...)   // v is []T
```

**`slices.*` equivalent:**

```go
s = slices.Insert(s, i, v...)
```

Same allocation profile as single insert.

---

## 4. Delete preserving order

**Wiki trick:**

```go
s = append(s[:i], s[i+1:]...)
```

**Pointer-safe variant (Go 1.21+):**

```go
copy(s[i:], s[i+1:])
clear(s[len(s)-1:])
s = s[:len(s)-1]
```

**`slices.*` equivalent:**

```go
s = slices.Delete(s, i, i+1)
```

| | Wiki trick | `slices.Delete` (Go 1.22+) |
|-|------------|----------------------------|
| Allocations | 0 | 0 |
| Time | O(n−i) | O(n−i) |
| Zeros tail for `T*` | no | yes |

---

## 5. Delete range `[i, j)`

**Wiki trick:**

```go
s = append(s[:i], s[j:]...)
```

**Pointer-safe variant:**

```go
copy(s[i:], s[j:])
clear(s[len(s)-(j-i):])
s = s[:len(s)-(j-i)]
```

**`slices.*` equivalent:**

```go
s = slices.Delete(s, i, j)
```

| | Wiki trick | `slices.Delete` |
|-|------------|-----------------|
| Allocations | 0 | 0 |
| Time | O(n−j) | O(n−j) |
| Zeros tail for `T*` | no | yes |

---

## 6. Delete without preserving order (swap-and-pop)

**Wiki trick:**

```go
s[i] = s[len(s)-1]
s = s[:len(s)-1]
```

**Pointer-safe variant:**

```go
s[i] = s[len(s)-1]
var zero T
s[len(s)-1] = zero
s = s[:len(s)-1]
```

**`slices.*` equivalent:** **none** — write the trick inline.

| | Trick |
|-|-------|
| Allocations | 0 |
| Time | O(1) |

---

## 7. Cut range (delete then return removed elements)

**Wiki trick:**

```go
removed := append([]T(nil), s[i:j]...)
s = append(s[:i], s[j:]...)
```

**`slices.*` equivalent:**

```go
removed := slices.Clone(s[i:j])
s = slices.Delete(s, i, j)
```

| | Trick | `slices.*` |
|-|-------|------------|
| Allocations | 1 (clone) | 1 (clone) |
| Time | O(n−i) | O(n−j + (j−i)) |
| Zeros tail | no | yes |

---

## 8. Replace `s[i:j]` with `v`

**Wiki trick:**

```go
s = append(s[:i], append(v, s[j:]...)...)
```

**`slices.*` equivalent:**

```go
s = slices.Replace(s, i, j, v...)
```

| | Trick | `slices.Replace` |
|-|-------|------------------|
| Allocations (cap fits) | 1 (intermediate) | 0 |
| Allocations (cap grows) | 2 | 1 |
| Time | O(n−i + len(v)) | O(n−i + len(v)) |
| Zeros tail when shrinking | no | yes (since 1.22) |

---

## 9. Push back

**Wiki trick:**

```go
s = append(s, x)
```

**`slices.*` equivalent:** none; `append` is canonical.

| | Cost |
|-|------|
| Amortized time | O(1) |
| Worst-case time | O(n) (grow + copy) |
| Allocations (cap fits) | 0 |
| Allocations (cap grows) | 1 |

---

## 10. Pop back

**Wiki trick:**

```go
x, s = s[len(s)-1], s[:len(s)-1]
```

**Pointer-safe variant:**

```go
x := s[len(s)-1]
var zero T
s[len(s)-1] = zero
s = s[:len(s)-1]
```

**`slices.*` equivalent:** none; the trick is canonical.

| | Cost |
|-|------|
| Time | O(1) |
| Allocations | 0 |
| Zeros tail for `T*` | manual |

---

## 11. Push front

**Wiki trick:**

```go
s = append([]T{x}, s...)
```

**`slices.*` equivalent:**

```go
s = slices.Insert(s, 0, x)
```

| | Wiki trick | `slices.Insert` |
|-|------------|-----------------|
| Allocations | 1 (always, no in-place option) | 0 if cap fits, else 1 |
| Time | O(n) | O(n) |

---

## 12. Pop front

**Wiki trick:**

```go
x, s = s[0], s[1:]
```

**Pointer-safe variant:**

```go
x := s[0]
var zero T
s[0] = zero
s = s[1:]
```

**`slices.*` equivalent:** none; the trick is canonical. **But beware: this leaks backing storage on long-lived queues.** Use a ring buffer for production FIFOs (see [professional.md](professional.md) §3).

| | Cost |
|-|------|
| Time | O(1) |
| Allocations | 0 |
| Backing-storage leak risk | yes for long-running queues |

---

## 13. Reverse

**Wiki trick:**

```go
for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
    s[i], s[j] = s[j], s[i]
}
```

**`slices.*` equivalent:**

```go
slices.Reverse(s)
```

| | Cost |
|-|------|
| Time | O(n/2) swaps |
| Allocations | 0 |

---

## 14. Rotate left by `k`

**Wiki trick (three-reverses):**

```go
k %= len(s)
slices.Reverse(s[:k])
slices.Reverse(s[k:])
slices.Reverse(s)
```

**`slices.*` equivalent:** **none** (as of Go 1.23).

| | Cost |
|-|------|
| Time | ~1.5n writes |
| Allocations | 0 |

---

## 15. Shuffle (Fisher–Yates)

**Wiki trick:**

```go
for i := len(s) - 1; i > 0; i-- {
    j := rand.IntN(i + 1)
    s[i], s[j] = s[j], s[i]
}
```

**stdlib equivalent:**

```go
rand.Shuffle(len(s), func(i, j int) { s[i], s[j] = s[j], s[i] })
```

| | Cost |
|-|------|
| Time | O(n) swaps |
| Allocations | 0 |
| RNG quality | use `math/rand/v2`; older `math/rand` is fine if seeded |

---

## 16. Filter in place

**Wiki trick:**

```go
n := 0
for _, x := range s {
    if keep(x) {
        s[n] = x
        n++
    }
}
clear(s[n:])   // for T*
s = s[:n]
```

**`slices.*` equivalent:** `slices.DeleteFunc(s, func(x T) bool { return !keep(x) })`.

| | Cost |
|-|------|
| Time | O(n) |
| Allocations | 0 |
| Zeros tail for `T*` | manual; `DeleteFunc` does it |

---

## 17. Filter allocating

**Wiki trick:**

```go
out := make([]T, 0, len(s))
for _, x := range s {
    if keep(x) {
        out = append(out, x)
    }
}
s = out
```

**`slices.*` equivalent:** none (write the loop).

| | Cost |
|-|------|
| Time | O(n) |
| Allocations | 1 |
| Original `s` mutated | no |

---

## 18. Dedupe adjacent equal (sorted input)

**Wiki trick:**

```go
n := 1
for i := 1; i < len(s); i++ {
    if s[i] != s[i-1] {
        s[n] = s[i]
        n++
    }
}
clear(s[n:])
s = s[:n]
```

**`slices.*` equivalent:**

```go
s = slices.Compact(s)                                       // ==
s = slices.CompactFunc(s, func(a, b T) bool { return ... }) // custom equality
```

| | Cost |
|-|------|
| Time | O(n) |
| Allocations | 0 |
| Zeros tail for `T*` (Go 1.22+) | yes (`Compact`) |
| Requires sorted input | yes |

---

## 19. Dedupe unsorted (preserve order)

**Wiki trick:**

```go
seen := make(map[T]struct{}, len(s))   // T must be comparable
n := 0
for _, x := range s {
    if _, ok := seen[x]; !ok {
        seen[x] = struct{}{}
        s[n] = x
        n++
    }
}
clear(s[n:])
s = s[:n]
```

**`slices.*` equivalent:** none.

| | Cost |
|-|------|
| Time | O(n) average |
| Allocations | 1 (the map) |
| Requires comparable `T` | yes |

---

## 20. Batch / chunk

**Wiki trick:**

```go
out := make([][]T, 0, (len(s)+k-1)/k)
for i := 0; i < len(s); i += k {
    end := i + k
    if end > len(s) { end = len(s) }
    out = append(out, s[i:end])
}
```

**`slices.*` equivalent (Go 1.23+):**

```go
for chunk := range slices.Chunk(s, k) {
    process(chunk)
}
```

| | Trick | `slices.Chunk` |
|-|-------|----------------|
| Returns | `[][]T` | iterator |
| Allocations | 1 (outer slice) | 0 |
| Sub-slices share with `s` | yes | yes |

---

## 21. Flatten `[][]T` → `[]T`

**Wiki trick:**

```go
total := 0
for _, inner := range s {
    total += len(inner)
}
out := make([]T, 0, total)
for _, inner := range s {
    out = append(out, inner...)
}
```

**`slices.*` equivalent (Go 1.22+):**

```go
out := slices.Concat(s...)
```

| | Cost |
|-|------|
| Time | O(N) where N is total elements |
| Allocations | 1 |

---

## 22. Clone (full data copy)

**Wiki trick:**

```go
out := append([]T(nil), s...)
// or
out := make([]T, len(s))
copy(out, s)
```

**`slices.*` equivalent:**

```go
out := slices.Clone(s)
```

| | Cost |
|-|------|
| Time | O(n) |
| Allocations | 1 |
| Independent backing array | yes |

---

## 23. Scoped clone (cap matches len; shared backing)

**Wiki trick:**

```go
out := s[:len(s):len(s)]
```

| | Cost |
|-|------|
| Time | O(1) |
| Allocations | 0 |
| Independent backing array | no (header only) |
| Caller's `append` allocates new array | yes (cap is full) |
| Caller's element-write affects `s` | yes |

---

## 24. Grow capacity

**Wiki trick:**

```go
s = append(s, make([]T, n)...)[:len(s)]
```

**`slices.*` equivalent:**

```go
s = slices.Grow(s, n)   // ensures cap >= len + n; len unchanged
```

| | Cost |
|-|------|
| Time | O(len(s)) when grow occurs, else O(1) |
| Allocations | 1 if grow occurs, else 0 |

---

## 25. Stack (LIFO)

**Operations** — using a slice:

```go
stack = append(stack, x)                    // push
x, stack = stack[len(stack)-1], stack[:len(stack)-1]   // pop
top := stack[len(stack)-1]                  // peek
```

For `T*`: zero the popped slot before re-slicing.

| | Cost |
|-|------|
| Push | amortized O(1) |
| Pop | O(1) |
| Peek | O(1) |
| Backing storage | bounded by max depth ever reached |

---

## 26. Queue (FIFO) — slice-based (DON'T for long runs)

**Operations:**

```go
q = append(q, x)            // push back
x, q = q[0], q[1:]          // pop front -- LEAKS for long-lived queues
```

| | Cost |
|-|------|
| Push | amortized O(1) |
| Pop | O(1) |
| Backing storage | grows without bound on long runs |

**Use a ring buffer** for production queues. See [professional.md](professional.md) §3.

---

## 27. Equality

**Wiki trick:**

```go
if len(a) != len(b) { return false }
for i := range a {
    if a[i] != b[i] { return false }
}
return true
```

**`slices.*` equivalent:**

```go
slices.Equal(a, b)                                                     // T comparable
slices.EqualFunc(a, b, func(x, y T) bool { return ... })               // custom eq
```

| | Cost |
|-|------|
| Time | O(n) |
| Allocations | 0 |

---

## 28. Index / Contains

**Wiki trick:**

```go
for i, x := range s {
    if x == target { return i }
}
return -1
```

**`slices.*` equivalent:**

```go
slices.Index(s, target)
slices.Contains(s, target)
slices.IndexFunc(s, func(x T) bool { return ... })
slices.ContainsFunc(s, func(x T) bool { return ... })
```

| | Cost |
|-|------|
| Time | O(n) |
| Allocations | 0 |

---

## 29. Binary search (sorted slices)

**`slices.*`:**

```go
i, found := slices.BinarySearch(s, target)
i, found := slices.BinarySearchFunc(s, target, cmp.Compare)
```

| | Cost |
|-|------|
| Time | O(log n) |
| Allocations | 0 |
| Requires sorted `s` | yes |

---

## 30. Sort

**`slices.*`:**

```go
slices.Sort(s)                                                  // T ordered
slices.SortFunc(s, func(a, b T) int { return ... })             // custom
slices.SortStableFunc(s, func(a, b T) int { return ... })       // stable
```

| | Cost |
|-|------|
| Time | O(n log n) |
| Allocations | 0 |
| Stable | only `SortStableFunc` |

---

## 31. Min / Max

**`slices.*`:**

```go
m := slices.Min(s)                                              // T ordered
m := slices.MinFunc(s, func(a, b T) int { return ... })
M := slices.Max(s)
M := slices.MaxFunc(s, func(a, b T) int { return ... })
```

Panics on empty slice. Use `len(s) > 0` guard.

---

## 32. Pointer-zeroing reference

Element types that **must** be zeroed when leaving `len`:

| Type | Reason |
|------|--------|
| `*T` | Pointer holds heap reference |
| `string` | `(ptr, len)`; ptr keeps data alive |
| `[]T` | `(ptr, len, cap)`; ptr keeps backing alive |
| `map[K]V` | Reference type |
| `chan T` | Reference type |
| `func()` | Holds captured variables |
| `interface{}`, `any` | Itab holds pointer to concrete value |
| `struct { ..., *X, ... }` | Transitively pointer-containing |
| `[N]string`, `[N]*T` | Array of pointer types |

Element types that **don't** need zeroing:

| Type | Reason |
|------|--------|
| `int`, `int8..int64`, `uint*`, `float*`, `complex*`, `byte`, `rune`, `bool` | Pointer-free |
| `[N]int`, `[N]byte` etc. | Array of pointer-free type |
| `struct { x, y int }` | No pointers in the layout |

The `clear` built-in works for any type and is the recommended generic helper:

```go
clear(s[n:])
```

---

## 33. Allocation profile cheat sheet

For `s []int` of length 1000:

| Operation | `B/op` | `allocs/op` |
|-----------|-------|-------------|
| `slices.Clone(s)` | 8192 | 1 |
| `slices.Insert(s, 500, 999)` if cap≥1001 | 0 | 0 |
| `slices.Insert(s, 500, 999)` if cap=1000 | 16384 | 1 |
| `slices.Delete(s, 500, 501)` | 0 | 0 |
| `slices.Compact(s)` (no dupes) | 0 | 0 |
| `slices.Concat(s1, s2)` | 16384 | 1 |
| `slices.Reverse(s)` | 0 | 0 |
| `slices.SortFunc(s, f)` | 0 | 0 |
| `slices.BinarySearch(s, x)` | 0 | 0 |
| `s[len(s)-1], s = s[:len(s)-1]` (swap-pop without zero) | 0 | 0 |
| `out := append([]int(nil), s...)` (wiki clone) | 8192 | 1 |
| `out := append([]int{x}, s...)` (wiki push-front) | 16384 | 2 |
| `append(s[:i], append([]int{x}, s[i:]...)...)` (wiki insert) | 8192 | 1 |
| Filter in-place loop | 0 | 0 |
| Map-based dedupe | varies (map) | 1+ |

These numbers depend on Go version and platform; the relative ordering is stable.

---

## 34. Go version compatibility table

| Helper | Available from | Tail-clear for `T*` |
|--------|----------------|---------------------|
| `slices.Insert` | 1.21 | n/a |
| `slices.Delete` | 1.21 | 1.22+ |
| `slices.Replace` | 1.21 | 1.22+ |
| `slices.Clone` | 1.21 | n/a |
| `slices.Concat` | 1.22 | n/a |
| `slices.Compact` | 1.21 | 1.22+ |
| `slices.CompactFunc` | 1.21 | 1.22+ |
| `slices.Reverse` | 1.21 | n/a |
| `slices.Sort` | 1.21 | n/a |
| `slices.BinarySearch` | 1.21 | n/a |
| `slices.Index`, `slices.Contains` | 1.21 | n/a |
| `slices.IndexFunc`, `slices.ContainsFunc` | 1.21 | n/a |
| `slices.Equal`, `slices.EqualFunc` | 1.21 | n/a |
| `slices.Min`, `slices.Max` | 1.21 | n/a |
| `slices.DeleteFunc` | 1.21 | 1.22+ |
| `slices.Grow` | 1.21 | n/a |
| `slices.Chunk` (iterator) | 1.23 | n/a |
| `clear` built-in | 1.21 | n/a |
| `iter.Seq` | 1.23 | n/a |

Pre-1.21 code: use the wiki tricks plus a manual `for ... { s[i] = zero }` tail clear.

---

## 35. Quick decision flow

```
Question: "Modify a slice — which trick?"

1. Is the operation a one-shot insert/delete/clone/concat/compact/reverse/sort?
   YES → use slices.X. STOP.
   NO  → continue.

2. Is it a swap-and-pop delete (order doesn't matter)?
   YES → write it inline (3 lines). STOP.

3. Is it a rotate by k?
   YES → use the three-reverses trick (no stdlib helper). STOP.

4. Is it a filter?
   YES → slices.DeleteFunc(s, !keep). STOP.

5. Is it a dedupe?
   - sorted: slices.Compact. STOP.
   - unsorted, preserve order: hand-roll the map-based loop. STOP.
   - unsorted, OK to reorder: slices.Sort + slices.Compact. STOP.

6. Is it a FIFO at scale?
   YES → ring buffer, not a slice queue.

7. Is it returning a slice from a public API?
   YES → slices.Clone (full isolation) or s[:len(s):len(s)] (scoped). STOP.
```

---

## 36. Related references

- SliceTricks wiki: https://github.com/golang/go/wiki/SliceTricks
- `slices` package: https://pkg.go.dev/slices
- `slices` source: https://cs.opensource.google/go/go/+/refs/tags/go1.23.0:src/slices/slices.go
- `iter` package (Go 1.23+): https://pkg.go.dev/iter
- `clear` built-in: https://pkg.go.dev/builtin#clear
- Sibling — slice header internals: [../05-slice-header-internals/](../05-slice-header-internals/)
- Sibling — capacity and growth: [../01-capacity-and-growth/](../01-capacity-and-growth/)
