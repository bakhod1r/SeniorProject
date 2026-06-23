# Generic Constraints Deep Dive — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end. Each task drills **constraint authoring** — designing or fixing the constraint, not just the body.

---

## Easy 🟢

### Task 1 — Numeric-only constraint
Write a `Number` constraint that admits all built-in integer and float types **plus** any defined type whose underlying type is one of them. Use it in `Sum[T Number](s []T) T`.

### Task 2 — `comparable` vs `cmp.Ordered`
Write two functions:
- `Eq[T ?](a, b T) bool` — return whether two values are equal.
- `Lt[T ?](a, b T) bool` — return whether `a < b`.

Pick the right constraint for each.

### Task 3 — Method-only constraint
Write a constraint `Stringer` (do not import `fmt`). Use it in `Names[T Stringer](xs []T) []string` that returns the result of `String()` for each.

### Task 4 — Mix `~int` and a method
Write a constraint that requires both `~int` underlying and a `Display() string` method. Define a type `OrderID int` with `Display()`. Verify your function works for `OrderID` but not for `int`.

### Task 5 — `~T` vs `T`
Define `type Celsius float64`. Write two functions:
- `Round1[T float64](v T) T` — should reject `Celsius`.
- `Round2[T ~float64](v T) T` — should accept `Celsius`.

Verify each compile-time behaviour.

---

## Medium 🟡

### Task 6 — Embed `comparable`
Define a constraint `Hashable` that embeds `comparable` and adds a `Hash() uint64` method. Implement `func Index[T Hashable](xs []T, target T) int` returning the index of the first match (using `==`).

### Task 7 — Slice-shape constraint
Write `Reverse[S ~[]E, E any](s S) S` so that calling it with a `MySlice` (defined as `type MySlice []int`) returns a `MySlice`, not `[]int`. Test that the return type is preserved.

### Task 8 — Map-key constraint
Write `Invert[K comparable, V comparable](m map[K]V) map[V]K`. Why does `V` need to be `comparable`?

### Task 9 — Constraint with union of methods
Write a constraint that requires either of two methods: `Read([]byte) (int, error)` **or** `Write([]byte) (int, error)`. Hint: this is a trick question.

### Task 10 — Refactor a giant union
You have:
```go
func Sum[T ~int | ~int8 | ~int16 | ~int32 | ~int64 |
         ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
         ~float32 | ~float64](s []T) T { ... }
```
Refactor into a named constraint `Numeric` and rewrite the function.

### Task 11 — Constraint requiring `Validate`
Define a constraint `Validatable` requiring `Validate() error`. Write `BatchValidate[T Validatable](xs []T) []error` that returns one error per element.

### Task 12 — Map values constraint
Write `MaxValue[K comparable, V cmp.Ordered](m map[K]V) (V, bool)` that returns the largest value (and false on empty map).

### Task 13 — `cmp.Ordered` based binary search
Write `BinarySearch[T cmp.Ordered](sorted []T, target T) (int, bool)`. Why does the constraint need ordering, not just equality?

### Task 14 — Empty type set detection
Write a constraint that has an empty type set on purpose. Demonstrate that you cannot instantiate a function using it. Then fix it.

---

## Hard 🔴

### Task 15 — Self-bounded `Less`
Define `Less[T any] interface { LessThan(other T) bool }`. Write `Min[T Less[T]](a, b T) T`. Then implement a `Money` type with `LessThan`, and use `Min` for it.

### Task 16 — Constraint hierarchy for IDs
Design a hierarchy:
- `Identifier` — base, requires `~int64 | ~string`.
- `NamedIdentifier` — embeds `Identifier`, adds `Name() string`.
- `AuditedIdentifier` — embeds `NamedIdentifier`, adds `CreatedAt() time.Time`.

Write three functions, one per layer, that demonstrates each level of the hierarchy.

### Task 17 — Migrating `x/exp/constraints` to `cmp.Ordered`
Take this code:
```go
import "golang.org/x/exp/constraints"

func Min[T constraints.Ordered](a, b T) T { ... }
```
Migrate to `cmp.Ordered`. List every change required (imports, go.mod, etc.).

### Task 18 — `comparable` post-1.20 trap
Write `func Has[T comparable](xs []T, target T) bool`. Show with a test that calling `Has([]any{[]int{1}}, []int{1})` panics at runtime in Go 1.20+. Document the runtime risk.

### Task 19 — Constraint with no core type
Write a constraint `MultiSlice` that admits `~[]int | ~[]string`. Try to write `func Len[T MultiSlice](s T) int { return len(s) }`. Explain why it fails. Fix it.

---

## Expert 🟣

### Task 20 — Design a generic, constrained `Result` type
Design `Result[T comparable]` with:
- `Ok[T comparable](v T) Result[T]`
- `Err[T comparable](e error) Result[T]`
- `(r Result[T]) Unwrap() (T, error)`

Discuss whether `comparable` is the right constraint, or whether `any` would be better. Argue both ways.

### Task 21 — Constraint API evolution
You ship v1:
```go
type Numeric interface { ~int | ~float64 }
func Sum[T Numeric](s []T) T { ... }
```
v2 wants to also accept `~int64` and `~float32`. Write the v2 constraint. Is this safe to release as a minor version, or does it require a major bump? Justify.

### Task 22 — Build the full `cmp.Ordered` from scratch
Without importing `cmp`, define `MyOrdered` as Go's stdlib does. Use it in a `Sort` function. Compare your version to `cmp.Ordered` after writing it.

---

## Solutions

### Solution 1
```go
type Number interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64
}

func Sum[T Number](s []T) T {
    var total T
    for _, v := range s { total += v }
    return total
}
```

### Solution 2
```go
import "cmp"

func Eq[T comparable](a, b T) bool { return a == b }
func Lt[T cmp.Ordered](a, b T) bool { return a < b }
```
`comparable` allows `==`/`!=` only. `cmp.Ordered` adds the ordering operators.

### Solution 3
```go
type Stringer interface { String() string }

func Names[T Stringer](xs []T) []string {
    out := make([]string, len(xs))
    for i, x := range xs { out[i] = x.String() }
    return out
}
```

### Solution 4
```go
type IntDisplayer interface {
    ~int
    Display() string
}

type OrderID int
func (o OrderID) Display() string { return fmt.Sprintf("order/%d", int(o)) }

func Show[T IntDisplayer](v T) string { return v.Display() }

Show(OrderID(1)) // OK
Show(int(1))     // compile error: int has no Display method
```

### Solution 5
```go
type Celsius float64

func Round1[T float64](v T) T { return T(math.Round(float64(v))) }
func Round2[T ~float64](v T) T { return T(math.Round(float64(v))) }

var c Celsius = 36.6
Round1(c) // compile error
Round2(c) // OK
```

### Solution 6
```go
type Hashable interface {
    comparable
    Hash() uint64
}

func Index[T Hashable](xs []T, target T) int {
    for i, v := range xs {
        if v == target { return i }
    }
    return -1
}
```
Note: the `Hash` method is required by the constraint but not used by `Index` — having the method is a contract guarantee.

### Solution 7
```go
func Reverse[S ~[]E, E any](s S) S {
    out := make(S, len(s))
    for i, v := range s { out[len(s)-1-i] = v }
    return out
}

type MySlice []int
m := MySlice{1, 2, 3}
r := Reverse(m) // r is MySlice, not []int
```

### Solution 8
```go
func Invert[K comparable, V comparable](m map[K]V) map[V]K {
    out := make(map[V]K, len(m))
    for k, v := range m { out[v] = k }
    return out
}
```
`V` must be `comparable` because it becomes a map key in the output.

### Solution 9
This is impossible with a single constraint. A constraint with two interfaces uses **intersection** — both methods would be required, not "either". To express "either", split into two functions or use an empty interface and a runtime check (defeating the point of generics).
```go
// Two separate functions
func ProcessReader[T interface{ Read(p []byte) (int, error) }](r T) { ... }
func ProcessWriter[T interface{ Write(p []byte) (int, error) }](w T) { ... }
```

### Solution 10
```go
type Numeric interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64
}

func Sum[T Numeric](s []T) T {
    var total T
    for _, v := range s { total += v }
    return total
}
```

### Solution 11
```go
type Validatable interface { Validate() error }

func BatchValidate[T Validatable](xs []T) []error {
    out := make([]error, len(xs))
    for i, x := range xs { out[i] = x.Validate() }
    return out
}
```

### Solution 12
```go
import "cmp"

func MaxValue[K comparable, V cmp.Ordered](m map[K]V) (V, bool) {
    var zero V
    if len(m) == 0 { return zero, false }
    first := true
    var best V
    for _, v := range m {
        if first || v > best { best = v; first = false }
    }
    return best, true
}
```

### Solution 13
```go
import "cmp"

func BinarySearch[T cmp.Ordered](sorted []T, target T) (int, bool) {
    lo, hi := 0, len(sorted)
    for lo < hi {
        mid := (lo + hi) / 2
        switch {
        case sorted[mid] < target: lo = mid + 1
        case sorted[mid] > target: hi = mid
        default: return mid, true
        }
    }
    return lo, false
}
```
Equality alone is not enough — binary search depends on `<` to halve the range.

### Solution 14
```go
type Empty interface { int; string }

func F[T Empty]() {}
// F[int]()    // compile error: int does not implement Empty
// F[string]() // compile error: string does not implement Empty

// Fix: union instead of intersection
type IntOrString interface { int | string }
func G[T IntOrString]() {}
G[int]()    // OK
G[string]() // OK
```

### Solution 15
```go
type Less[T any] interface { LessThan(other T) bool }

func Min[T Less[T]](a, b T) T {
    if a.LessThan(b) { return a }
    return b
}

type Money struct { Amount int; Currency string }
func (m Money) LessThan(other Money) bool {
    if m.Currency != other.Currency { panic("currency mismatch") }
    return m.Amount < other.Amount
}

cheap := Min(Money{100, "USD"}, Money{200, "USD"})
```

### Solution 16
```go
type Identifier interface { ~int64 | ~string }

type NamedIdentifier interface {
    Identifier
    Name() string
}

type AuditedIdentifier interface {
    NamedIdentifier
    CreatedAt() time.Time
}

func IDOnly[T Identifier](v T) T { return v }
func IDWithName[T NamedIdentifier](v T) string { return v.Name() }
func IDFull[T AuditedIdentifier](v T) (string, time.Time) {
    return v.Name(), v.CreatedAt()
}
```

### Solution 17
Changes:
1. `go.mod` requires `go 1.21` or later.
2. Replace `import "golang.org/x/exp/constraints"` with `import "cmp"`.
3. Replace `constraints.Ordered` with `cmp.Ordered`.
4. Optionally remove the `golang.org/x/exp/constraints` dependency from `go.mod` if no longer used elsewhere.

```go
import "cmp"

func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}
```

### Solution 18
```go
func Has[T comparable](xs []T, target T) bool {
    for _, x := range xs { if x == target { return true } }
    return false
}

// Test:
func TestHasPanic(t *testing.T) {
    defer func() {
        if recover() == nil { t.Fatal("expected panic") }
    }()
    Has([]any{[]int{1}}, []int{1}) // panics in 1.20+
}
```
Document the risk:
> Has uses `==` on T. If T is or contains an interface whose dynamic value
> is not comparable (slice/map/func), this will panic at runtime.

### Solution 19
```go
type MultiSlice interface { ~[]int | ~[]string }

// func Len[T MultiSlice](s T) int { return len(s) } // ❌ no core type

// Fix: parameterise the element
type SliceOf[E any] interface { ~[]E }
func Len[T SliceOf[E], E any](s T) int { return len(s) }
```
The original constraint has no core type because `[]int` and `[]string` have different underlying types. The fix is to make the element type a parameter, so the type set has a uniform underlying.

### Solution 20
```go
type Result[T comparable] struct {
    Value T
    Err   error
}

func Ok[T comparable](v T) Result[T]   { return Result[T]{Value: v} }
func Err[T comparable](e error) Result[T] {
    var zero T; return Result[T]{Value: zero, Err: e}
}
func (r Result[T]) Unwrap() (T, error) { return r.Value, r.Err }
```
**Argument for `comparable`:** allows `result == otherResult` patterns; matches map-key usage.
**Argument for `any`:** strictly more flexible. Slices and functions are valid `Result` values too. Most uses do not need `==`. Most stdlib generic wrappers (`atomic.Pointer[T]`) use `any` for this reason.

In practice, `any` is the better default — `Result` rarely needs equality.

### Solution 21
```go
// v2
type Numeric interface { ~int | ~int64 | ~float32 | ~float64 }
```

This is **safe** as a minor release. The type set strictly expands: every type that satisfied v1's `Numeric` still satisfies v2's. Old call sites continue to compile. Document the change in the CHANGELOG. Major version bump is **not** required.

### Solution 22
```go
type MyOrdered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64 |
    ~string
}

func Sort[T MyOrdered](s []T) {
    // simple insertion sort for demonstration
    for i := 1; i < len(s); i++ {
        for j := i; j > 0 && s[j] < s[j-1]; j-- {
            s[j], s[j-1] = s[j-1], s[j]
        }
    }
}
```
This is essentially `cmp.Ordered`. The stdlib version may differ in tooling-friendly representation, but the type set is identical.

---

## Final notes

These tasks deliberately focus on **constraint design** rather than algorithm content. The core skill is:

1. **Pick the loosest constraint** that the body actually needs.
2. **Use stdlib first** (`comparable`, `cmp.Ordered`).
3. **Compose with embedding**, not by duplicating type lists.
4. **Document the type set** when it is non-obvious.
5. **Plan for evolution** — loosen freely, tighten only with major version bumps.

The body is the **demand**, the constraint is the **supply**. Match them precisely.
