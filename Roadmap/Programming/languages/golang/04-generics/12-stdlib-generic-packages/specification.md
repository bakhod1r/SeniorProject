# Stdlib Generic Packages — Specification

## Table of Contents
1. [Source of truth](#source-of-truth)
2. [`slices` package signatures](#slices-package-signatures)
3. [`maps` package signatures](#maps-package-signatures)
4. [`cmp` package signatures](#cmp-package-signatures)
5. [Constraints used](#constraints-used)
6. [Documented complexity](#documented-complexity)
7. [Versioning notes](#versioning-notes)
8. [Summary](#summary)

---

## Source of truth

This file is **not** the Go language specification — `slices`, `maps`, and `cmp` are libraries, not language features. The authoritative documentation lives at:

- <https://pkg.go.dev/slices>
- <https://pkg.go.dev/maps>
- <https://pkg.go.dev/cmp>
- Release notes: <https://go.dev/doc/go1.21>, <https://go.dev/doc/go1.22>, <https://go.dev/doc/go1.23>, <https://go.dev/doc/go1.24>

Signatures below are paraphrased from the published godoc. Quote the official source for canonical wording.

---

## `slices` package signatures

The `slices` package contains functions that work with slices of any type. Every function has a documented signature; these are the most important.

### Membership and equality (since 1.21)

```go
func Contains[S ~[]E, E comparable](s S, v E) bool
func ContainsFunc[S ~[]E, E any](s S, f func(E) bool) bool
func Index[S ~[]E, E comparable](s S, v E) int
func IndexFunc[S ~[]E, E any](s S, f func(E) bool) int
func Equal[S ~[]E, E comparable](s1, s2 S) bool
func EqualFunc[S1 ~[]E1, S2 ~[]E2, E1, E2 any](s1 S1, s2 S2, eq func(E1, E2) bool) bool
```

Note the `~[]E` constraint. This permits any **named slice type** (e.g., `type IDs []int`) and not only the literal `[]E`. Without `~`, those would fail to satisfy.

### Sorting (since 1.21)

```go
func Sort[S ~[]E, E cmp.Ordered](x S)
func SortFunc[S ~[]E, E any](x S, cmp func(a, b E) int)
func SortStableFunc[S ~[]E, E any](x S, cmp func(a, b E) int)
func IsSorted[S ~[]E, E cmp.Ordered](x S) bool
func IsSortedFunc[S ~[]E, E any](x S, cmp func(a, b E) int) bool
func BinarySearch[S ~[]E, E cmp.Ordered](x S, target E) (int, bool)
func BinarySearchFunc[S ~[]E, E, T any](x S, target T, cmp func(E, T) int) (int, bool)
```

The `BinarySearchFunc` comparator takes `(elem, target)` — note that the target type `T` may differ from the element type `E`. This lets you search a `[]Person` for a `string` key.

### Min / Max (since 1.21)

```go
func Min[S ~[]E, E cmp.Ordered](x S) E              // panics if x is empty
func MinFunc[S ~[]E, E any](x S, cmp func(a, b E) int) E
func Max[S ~[]E, E cmp.Ordered](x S) E              // panics if x is empty
func MaxFunc[S ~[]E, E any](x S, cmp func(a, b E) int) E
```

### Mutation (since 1.21)

```go
func Insert[S ~[]E, E any](s S, i int, v ...E) S    // panics on bad i
func Delete[S ~[]E, E any](s S, i, j int) S          // zeroes [i,j) tail
func DeleteFunc[S ~[]E, E any](s S, del func(E) bool) S
func Replace[S ~[]E, E any](s S, i, j int, v ...E) S
func Compact[S ~[]E, E comparable](s S) S
func CompactFunc[S ~[]E, E any](s S, eq func(E, E) bool) S
func Reverse[S ~[]E, E any](s S)
func Clone[S ~[]E, E any](s S) S
func Concat[S ~[]E, E any](slices ...S) S            // 1.22+
func Repeat[S ~[]E, E any](x S, count int) S         // 1.22+
```

The mutation functions either zero the freed portion (`Delete`, `Compact`) or may reallocate (`Insert`). Always reassign.

### Iterator-returning (since 1.23)

```go
func All[S ~[]E, E any](s S) iter.Seq2[int, E]
func Values[S ~[]E, E any](s S) iter.Seq[E]
func Backward[S ~[]E, E any](s S) iter.Seq2[int, E]
func Sorted[E cmp.Ordered](seq iter.Seq[E]) []E
func SortedFunc[E any](seq iter.Seq[E], cmp func(a, b E) int) []E
func SortedStableFunc[E any](seq iter.Seq[E], cmp func(a, b E) int) []E
func Collect[E any](seq iter.Seq[E]) []E
func AppendSeq[S ~[]E, E any](s S, seq iter.Seq[E]) S
```

These build the iterator bridge. `Collect` is the most common: feed an `iter.Seq[E]` and get a `[]E`.

---

## `maps` package signatures

The `maps` package is small. Its surface in 1.23+:

```go
// Since 1.21
func Equal[M1, M2 ~map[K]V, K, V comparable](m1 M1, m2 M2) bool
func EqualFunc[M1 ~map[K]V1, M2 ~map[K]V2, K comparable, V1, V2 any](m1 M1, m2 M2, eq func(V1, V2) bool) bool
func Clone[M ~map[K]V, K comparable, V any](m M) M
func Copy[M1 ~map[K]V, M2 ~map[K]V, K comparable, V any](dst M1, src M2)
func DeleteFunc[M ~map[K]V, K comparable, V any](m M, del func(K, V) bool)

// Since 1.23 (return iterators)
func Keys[Map ~map[K]V, K comparable, V any](m Map) iter.Seq[K]
func Values[Map ~map[K]V, K comparable, V any](m Map) iter.Seq[V]
func All[Map ~map[K]V, K comparable, V any](m Map) iter.Seq2[K, V]
func Collect[K comparable, V any](seq iter.Seq2[K, V]) map[K]V
func Insert[M ~map[K]V, K comparable, V any](m M, seq iter.Seq2[K, V])
```

Note: Go 1.21 originally shipped `maps.Keys` returning `[]K`. Go 1.23 changed it to return an iterator. Code using the 1.21 form needs `slices.Collect(maps.Keys(m))` after the upgrade. The Go team accepted this break because both APIs were short-lived and the iterator form composes better.

---

## `cmp` package signatures

The `cmp` package is the smallest of the three:

```go
// Since 1.21
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64 |
    ~string
}

func Compare[T Ordered](x, y T) int
func Less[T Ordered](x, y T) bool

// Since 1.22
func Or[T comparable](vals ...T) T
```

`cmp.Compare` returns:
- `-1` if `x < y`
- `0` if `x == y`
- `+1` if `x > y`

For floating-point types, the function uses a total ordering: `NaN` is treated as **less than** any other value, and `-0` is treated as less than `+0`. This is documented and stable.

`cmp.Or` returns the first argument that is not the zero value of `T`. If all arguments are zero, it returns the zero value. Variadic with no arguments fails inference.

---

## Constraints used

Three constraints dominate this section:

```go
// from cmp
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64 |
    ~string
}

// builtin
type comparable interface { /* opaque */ }

// builtin
type any = interface{}
```

The `slices` and `maps` packages use:

- `[E comparable]` for membership, equality, and `Compact`
- `[E cmp.Ordered]` for sorting, search, min/max
- `[E any]` for the `*Func` variants

The `~[]E` and `~map[K]V` patterns appear everywhere — they make the function accept named slice/map types.

---

## Documented complexity

The pkg.go.dev pages document complexity for the non-obvious cases:

| Function | Time | Space |
|----------|------|-------|
| `slices.Sort` | `O(n log n)` worst, `O(n)` on sorted | `O(log n)` stack |
| `slices.SortStableFunc` | `O(n log n)` | `O(log² n)` stack |
| `slices.BinarySearch` | `O(log n)` | `O(1)` |
| `slices.Contains` / `Index` | `O(n)` | `O(1)` |
| `slices.Equal` | `O(n)`, short-circuit on length mismatch | `O(1)` |
| `slices.Compact` | `O(n)` in place | `O(1)` |
| `slices.Insert` | `O(n + k)` for inserting `k` items | may reallocate |
| `slices.Delete` | `O(n)` shift + `O(j-i)` zeroing | `O(1)` |
| `slices.Clone` | `O(n)` | `O(n)` |
| `slices.Concat` | `O(sum-of-lengths)` with one allocation | `O(sum-of-lengths)` |
| `maps.Clone` | `O(n)` with runtime fast path | `O(n)` |
| `maps.Equal` | `O(n)` | `O(1)` |
| `maps.Copy` | `O(n)` | grows `dst` |
| `maps.DeleteFunc` | `O(n)` | `O(1)` |
| `cmp.Compare` | `O(1)` for fixed types, `O(min(len))` for strings | `O(1)` |

These complexities are **lower bounds** on what you can achieve without algorithmic specialization. The Go team has tuned constants aggressively over releases.

---

## Versioning notes

A few concrete API changes worth memorizing:

1. **`maps.Keys` return type changed** — `[]K` in 1.21/1.22, `iter.Seq[K]` in 1.23+.
2. **`slices.Concat`** added in 1.22 — earlier versions need a manual loop.
3. **`cmp.Or`** added in 1.22 — earlier versions need an explicit chain.
4. **`slices.Sorted`** added in 1.23 — earlier versions need `Clone` + `Sort`.
5. **`slices.Repeat`** added in 1.22 — same reason.
6. **`weak.Pointer[T]`** added in 1.24 — completely new package.
7. **Generic type aliases** allowed in 1.24 — earlier versions reject `type Vec[T any] = []T`.

If you publish a library, document the minimum Go version that supports the API you call. CI matrices should test on the minimum and the latest stable release.

---

## Selected pkg-doc excerpts

For reference, here are paraphrased excerpts of the most-cited entries in the godoc.

### `slices.Sort`

> Sort sorts a slice of any ordered type in ascending order. When sorting floating-point numbers, NaNs are ordered before other values.

`slices.Sort` is in-place, unstable, `O(n log n)` worst case via pdqsort. Released in Go 1.21.

### `slices.SortStableFunc`

> SortStableFunc sorts the slice x while keeping the original order of equal elements, using cmp to compare elements in the same way as SortFunc.

Stable, `O(n log n)` time. The pkg-doc emphasizes the **`cmp`-style** signature — return `int`, not `bool`.

### `slices.BinarySearch`

> BinarySearch searches for target in a sorted slice and returns the position where target is found, or the position where target would appear in the sort order; it also returns a bool saying whether the target is really found in the slice.

The "would appear" half is what makes `BinarySearch` useful for **sorted insert**: even when not found, the returned index is the correct insertion point.

### `slices.Compact`

> Compact replaces consecutive runs of equal elements with a single copy. This is like the uniq command found on Unix. Compact modifies the contents of the slice s and returns the modified slice, which may have a smaller length. Compact zeroes the elements between the new length and the original length.

Three things called out: only **consecutive** dedup, the slice **is modified**, and the freed slots are **zeroed**.

### `slices.Concat`

> Concat returns a new slice concatenating the passed in slices.

Single-allocation, contiguous, accepts a variadic of slices. Released in Go 1.22.

### `cmp.Compare`

> Compare returns -1 if x is less than y, 0 if x equals y, +1 if x is greater than y. For floating-point types, a NaN is considered less than any non-NaN, a NaN is considered equal to a NaN, and -0.0 is not less than (is equal to) 0.0.

Total order, NaN-tolerant, `-0` and `+0` collapse.

### `cmp.Or`

> Or returns the first of its arguments that is not equal to the zero value. If no argument is non-zero, it returns the zero value.

Note: arguments are still **all evaluated** (Go's argument evaluation rule). For short-circuit, write the chain manually.

### `maps.Clone`

> Clone returns a copy of m. This is a shallow clone: the new keys and values are set using ordinary assignment.

The phrase "ordinary assignment" is the whole story: pointer values, slices, and maps inside the value type are shared.

### `maps.DeleteFunc`

> DeleteFunc deletes any key/value pairs from m for which del returns true.

In-place, `O(n)`, modifies the input map. The callback receives both `(K, V)` so you can filter by either.

## Summary

The `slices`, `maps`, and `cmp` packages have a small, **stable** surface — the kind that Go's compatibility promise will preserve for a decade. Knowing the signatures lets you:

1. Pick the right function without guessing
2. Match `go.mod` to the API you need (1.21 vs 1.22 vs 1.23 vs 1.24)
3. Spot misuse in code review by comparing call to signature

Two key patterns to memorize:

- `~[]E` and `~map[K]V` — named types are first-class
- `cmp.Compare` and `cmp.Or` — the universal comparator pair

Move on to `interview.md` to drill the most common questions about these packages.
