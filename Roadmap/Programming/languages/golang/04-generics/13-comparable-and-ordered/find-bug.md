# `comparable` and `cmp.Ordered` — Find the Bug

## How to use

Each problem shows a code snippet. Read it carefully and answer:
1. What is the bug?
2. How would you fix it?
3. Is this a compile-time or runtime failure?

Solutions are at the end. The bugs are realistic — many are common in production code that uses the 1.20 relaxed `comparable` or sorts floats with NaN.

---

## Bug 1 — comparing structs that contain slices

```go
type Tag struct{ Name string }

type Item struct {
    ID   int
    Tags []Tag
}

func Has[T comparable](s []T, v T) bool {
    for _, x := range s { if x == v { return true } }
    return false
}

items := []Item{{ID: 1, Tags: []Tag{{Name: "a"}}}}
target := Item{ID: 1, Tags: []Tag{{Name: "a"}}}
fmt.Println(Has(items, target))
```

**Hint:** `Item` has a slice field.

---

## Bug 2 — `comparable` instead of `cmp.Ordered`

```go
func MaxOf[T comparable](a, b T) T {
    if a > b { return a }
    return b
}
```

**Hint:** What does `comparable` allow?

---

## Bug 3 — sorting floats with NaN using `<`

```go
slices.SortFunc(xs, func(a, b float64) int {
    if a < b { return -1 }
    if a > b { return 1 }
    return 0
})

xs := []float64{3, math.NaN(), 1, 2}
// after sort: ?
```

**Hint:** What is `NaN < anything`?

---

## Bug 4 — `Set[any]` with a slice value

```go
type Set[T comparable] struct{ m map[T]struct{} }

s := &Set[any]{m: map[any]struct{}{}}
s.m[[]int{1}] = struct{}{}   // ?
```

**Hint:** Compile or runtime?

---

## Bug 5 — NaN in a `Set[float64]`

```go
s := NewSet[float64]()
s.Add(math.NaN())
s.Add(math.NaN())
fmt.Println(s.Len())
```

**Hint:** `NaN == NaN`?

---

## Bug 6 — sorting `[]time.Time` with `slices.Sort`

```go
ts := []time.Time{time.Now(), time.Now().Add(-time.Hour)}
slices.Sort(ts)   // ?
```

**Hint:** Is `time.Time` in `cmp.Ordered`?

---

## Bug 7 — generic `Min` over `complex128`

```go
import "cmp"

func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}

c1, c2 := 1+2i, 3+4i
Min(c1, c2)   // ?
```

**Hint:** Is complex Ordered?

---

## Bug 8 — `~int` missing in custom Ordered

```go
type MyOrdered interface {
    int | float64 | string
}

type Score int

func Top[T MyOrdered](s []T) T { ... }
Top([]Score{1, 2, 3}) // ?
```

**Hint:** What does the missing tilde mean?

---

## Bug 9 — pointer equality vs value equality

```go
type User struct{ Name string }

func Has[T comparable](s []T, v T) bool {
    for _, x := range s { if x == v { return true } }
    return false
}

u1 := &User{Name: "A"}
u2 := &User{Name: "A"}
fmt.Println(Has([]*User{u1}, u2))   // ?
```

**Hint:** What does `==` mean on `*User`?

---

## Bug 10 — `cmp.Or` with non-comparable

```go
import "cmp"

type Tag struct{ Items []string }
result := cmp.Or(Tag{}, Tag{Items: []string{"x"}}, Tag{})  // ?
```

**Hint:** `cmp.Or`'s constraint.

---

## Bug 11 — sort comparator violates trichotomy

```go
slices.SortFunc(s, func(a, b Item) int {
    if a.Score > b.Score { return -1 }
    return 1   // never returns 0
})
```

**Hint:** What does sort assume about equal elements?

---

## Bug 12 — `comparable` constraint with map field

```go
type Doc struct {
    ID   string
    Meta map[string]string
}

func Dedup[T comparable](s []T) []T {
    seen := map[T]struct{}{}
    out := []T{}
    for _, v := range s {
        if _, ok := seen[v]; !ok {
            seen[v] = struct{}{}
            out = append(out, v)
        }
    }
    return out
}

Dedup([]Doc{{ID: "a"}, {ID: "a"}})   // ?
```

**Hint:** `Doc` has a map field.

---

## Bug 13 — comparing `any` holding mismatched types

```go
var a any = 1
var b any = int64(1)
fmt.Println(a == b)   // ?
```

**Hint:** Same numeric value, different dynamic types.

---

## Bug 14 — `slices.Sort` over a typed slice that is `~[]complex128`

```go
type Phasors []complex128
ps := Phasors{1+2i, 3+4i}
slices.Sort(ps)   // ?
```

**Hint:** What is the underlying element type?

---

## Bug 15 — `comparable` accepted but hashes panic

```go
type Set[T comparable] struct{ m map[T]struct{} }

s := &Set[any]{m: map[any]struct{}{}}
s.m[func() {}] = struct{}{}    // ?
```

**Hint:** Functions and `==`.

---

## Bug 16 — wrong NaN handling in custom heap

```go
func (h *Heap[T cmp.Ordered]) heapifyUp(i int) {
    for i > 0 {
        parent := (i - 1) / 2
        if h.data[i] < h.data[parent] {
            h.data[i], h.data[parent] = h.data[parent], h.data[i]
            i = parent
        } else {
            break
        }
    }
}
```

**Hint:** `T = float64`, NaN.

---

## Solutions

### Bug 1 — runtime panic
`Item` is **not** comparable because it has a slice field. The constraint check passes only because... it actually doesn't. The compiler rejects `Has[Item]` at compile time:
```
Item does not satisfy comparable
```
Fix: define an `Equal` method or use `slices.EqualFunc`.

### Bug 2 — compile error
`comparable` allows `==`/`!=` only. Use `cmp.Ordered`:
```go
import "cmp"
func MaxOf[T cmp.Ordered](a, b T) T {
    if a > b { return a }
    return b
}
```

### Bug 3 — incorrect sort
`NaN < x` and `NaN > x` are both false, so the comparator returns 0 for any pair involving NaN — telling sort the elements are equal. The sort terminates with NaN in unpredictable positions.
Fix: use `cmp.Compare`:
```go
slices.SortFunc(xs, func(a, b float64) int {
    return cmp.Compare(a, b)
})
```
Or call `slices.Sort` directly (it uses `cmp.Compare` internally).

### Bug 4 — runtime panic
The 1.20 relaxation lets `Set[any]` compile. At insertion, hashing the `[]int` key panics: `runtime error: hash of unhashable type []int`.
Fix: validate before inserting, or use a non-`any` key type.

### Bug 5 — duplicate NaNs
`Set` cannot deduplicate NaN because `NaN != NaN`. After two `Add(math.NaN())` calls, `Len()` returns 2.
Fix: filter out NaN before inserting, or convert via `math.Float64bits` for canonical NaN keys.

### Bug 6 — compile error
`time.Time` is a struct, not in `cmp.Ordered`. The compiler rejects `slices.Sort(ts)`.
Fix:
```go
slices.SortFunc(ts, func(a, b time.Time) int { return a.Compare(b) })
```

### Bug 7 — compile error
`complex128` is **not** in `cmp.Ordered`. `Min(c1, c2)` fails to compile.
Fix: pick an ordering policy explicitly:
```go
slices.SortFunc(cs, func(a, b complex128) int {
    return cmp.Compare(cmplx.Abs(a), cmplx.Abs(b))
})
```

### Bug 8 — compile error
`Score`'s underlying type is `int`, but `MyOrdered` lists bare `int`, not `~int`. So `Score` does not satisfy `MyOrdered`.
Fix: import `cmp.Ordered`, or add `~`:
```go
type MyOrdered interface {
    ~int | ~float64 | ~string
}
```

### Bug 9 — false (often unintended)
`==` on `*User` compares **addresses**. Two different allocations with identical fields are unequal.
Fix: dereference, or use a value type, or use `slices.IndexFunc` with a custom comparator.

### Bug 10 — compile error
`cmp.Or`'s constraint is `[T comparable]`. `Tag` has a slice field and is not comparable.
Fix: extract a comparable identifier (the `ID`) or use a custom helper.

### Bug 11 — sort panics or loops
A comparator that never returns 0 violates the strict-weak-order requirement. `slices.Sort` may produce wrong results or in older Go versions diverge.
Fix:
```go
slices.SortFunc(s, func(a, b Item) int { return cmp.Compare(b.Score, a.Score) })
```

### Bug 12 — compile error
`Doc` has a `map[string]string` field — not comparable. `Dedup[Doc]` fails to compile.
Fix: dedup by `ID`:
```go
seen := map[string]struct{}{}
for _, d := range docs {
    if _, ok := seen[d.ID]; !ok {
        seen[d.ID] = struct{}{}
        out = append(out, d)
    }
}
```

### Bug 13 — false
`==` on `any` requires identical dynamic types. `int` and `int64` are different even when their values match.
Fix: convert before comparing, or use `reflect.DeepEqual` for cross-type semantics.

### Bug 14 — compile error
`slices.Sort` requires `~[]E, E cmp.Ordered`. `complex128` is not Ordered, so even `Phasors` (whose underlying is `[]complex128`) fails.
Fix: `slices.SortFunc(ps, func(a, b complex128) int { return cmp.Compare(cmplx.Abs(a), cmplx.Abs(b)) })`

### Bug 15 — runtime panic
Function values are not comparable; storing one as a map key panics. The constraint check passes because of 1.20's relaxation, but the runtime rejects the operation.
Fix: explicitly forbid function values in your set, or use a `HashSet` with explicit hash/equal.

### Bug 16 — heap invariant broken for NaN
`<` on `float64` returns false when NaN is involved, so a NaN may stay where it is even though the heap should re-arrange.
Fix:
```go
if cmp.Compare(h.data[i], h.data[parent]) < 0 { ... }
```
Routing through `cmp.Compare` gives a deterministic NaN ordering and preserves heap invariants.

---

## Lessons

Patterns from these bugs:

1. **A struct is comparable only if all fields are.** Slices, maps, and functions disqualify the whole struct (Bugs 1, 12).
2. **`comparable` allows `==`/`!=` only.** For `<`, use `cmp.Ordered` (Bug 2).
3. **`<` on floats is NaN-blind.** Sort comparators must use `cmp.Compare` (Bugs 3, 16).
4. **`Set[any]` compiles in 1.20+ but can panic at runtime.** Validate or restrict (Bugs 4, 15).
5. **NaN cannot deduplicate** in a normal set (Bug 5).
6. **`time.Time` is not Ordered.** Use `slices.SortFunc` with `time.Time.Compare` (Bug 6).
7. **Complex is not Ordered, by design.** Pick a policy explicitly (Bugs 7, 14).
8. **Custom `Ordered` constraints need `~`.** Otherwise domain types fail (Bug 8).
9. **Pointer `==` compares addresses.** Different allocations with the same content are not equal (Bug 9).
10. **`cmp.Or` requires `comparable`.** Slice/map fields disqualify (Bug 10).
11. **Comparators must respect trichotomy.** Always return 0 for equal elements (Bug 11).
12. **Cross-type `any` comparison checks dynamic type identity, not value.** `int` vs `int64` are unequal (Bug 13).

A senior engineer reads `comparable` and `cmp.Ordered` as **contracts**: a constraint promises an operation, but the runtime might still object if the dynamic value disrespects the spirit of the contract. Mismatch between the promise and the value is the bug surface.
