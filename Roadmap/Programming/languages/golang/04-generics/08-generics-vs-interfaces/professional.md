# Generics vs Interfaces — Professional Level

## Table of Contents
1. [The library author's view](#the-library-authors-view)
2. [`sort.Interface` vs `slices.Sort`](#sortinterface-vs-slicessort)
3. [Why `io.Reader` stays as an interface](#why-ioreader-stays-as-an-interface)
4. [`container/list` vs a generic Stack](#containerlist-vs-a-generic-stack)
5. [Backwards-compatible migrations](#backwards-compatible-migrations)
6. [The Hashicorp pattern](#the-hashicorp-pattern)
7. [Designing for two generations of users](#designing-for-two-generations-of-users)
8. [Lessons from the standard library](#lessons-from-the-standard-library)
9. [Summary](#summary)

---

## The library author's view

A library author has different incentives from an application engineer. Library code lives for years, used by thousands of consumers, with no central control over which Go version they run. The decision matrix is heavier:

| Concern | Application code | Library code |
|---------|------------------|--------------|
| Time to first deploy | Hours | Months |
| Number of consumers | Few | Many |
| Cost of breaking change | Internal release | Major-version bump |
| Pressure to migrate to generics | Developer ergonomics | Backwards compatibility |

Professional library authors have settled on a few patterns the rest of us can copy.

---

## `sort.Interface` vs `slices.Sort`

The `sort` package, shipped in 2009, is the canonical interface-based API:

```go
type Interface interface {
    Len() int
    Less(i, j int) bool
    Swap(i, j int)
}
sort.Sort(byAge(people))
```

Every type that wants to be sorted implements three methods. The library is small, the surface tiny, and the same algorithm sorts anything.

In Go 1.21 the team added `slices.Sort`:

```go
slices.Sort([]int{3, 1, 2})
slices.SortFunc(people, func(a, b Person) int { return a.Age - b.Age })
```

What changed?

| Aspect | `sort.Sort` | `slices.Sort` |
|--------|-------------|----------------|
| Type safety | None at the slice — `interface{}` underneath | Full — `[]T` |
| Performance | Indirect dispatch on every compare | Inlinable comparator |
| Boilerplate | Three methods or a closure-based wrapper | One call |
| Pre-1.21 callers | Unaffected | Need newer Go |

The team did **not** remove `sort.Sort`. They added the generic version alongside. This is the canonical pattern: **add the generic, keep the interface, deprecate gently**.

### The takeaway for library authors

- A generic API can be **faster and cleaner** for the common case.
- An interface API can stay **stable** for the long tail.
- Both can coexist. Removing the old one is rarely worth the breakage.

---

## Why `io.Reader` stays as an interface

`io.Reader` is the most-imitated interface in the Go ecosystem:

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}
```

There is no `io.Reader[T]` generic equivalent, and there will not be. Why?

1. **Each implementation reads from a different source.** `*os.File` reads from disk, `*bytes.Reader` from memory, `*tls.Conn` from a TCP socket plus crypto state. The body is genuinely different per type. That is **subtype polymorphism**.

2. **The data type is always `[]byte`.** There is no `T` to vary. A reader of strings would be a different abstraction (`bufio.Scanner`, `iter.Seq[string]`).

3. **The ecosystem composes via interfaces.** `io.Copy(dst, src)` accepts any `Reader` and any `Writer`. The `io.LimitReader`, `io.MultiReader`, `io.TeeReader` wrappers all rely on the interface chain. Generics would force every wrapper to be parametrized over `T`, which is redundant when `T` is always `[]byte`.

4. **Late binding.** Third-party libraries (gzip, encryption, network protocols) provide their own `Reader` implementations without touching `io`. Generics close the type set; interfaces leave it open.

The lesson: **when the shape varies, generics. When the behaviour varies, interfaces.** `io.Reader` varies behaviour, not shape, so it stays.

### What about `iter.Seq[T]`?

Go 1.23 added `iter.Seq[T any]` for range-over-func. This is **not** the same as `io.Reader`:

- `iter.Seq[T]` is generic because the element type varies.
- `io.Reader` is interface-shaped because the **act of reading bytes** varies.

Both exist in modern Go. They are not in tension; they cover different problems.

---

## `container/list` vs a generic Stack

Pre-1.18, `container/list` was Go's built-in doubly-linked list. Its API:

```go
type List struct { ... }
type Element struct { Value interface{}; ... }

l := list.New()
l.PushBack(42)
v := l.Front().Value.(int) // type assertion required
```

Every `Value` is `interface{}`. Callers assert. The package is **discouraged** today — the godoc literally says "consider whether a slice would be simpler". Why?

1. **Boxing on every push.** `42` becomes a heap-allocated `interface{}`.
2. **Type assertion on every read.** The compiler cannot help; runtime panics if you got it wrong.
3. **Slice operations are usually fine.** Most Go programs use slices, not linked lists.

Post-1.18, a generic linked list is trivially:

```go
type Node[T any] struct {
    v          T
    prev, next *Node[T]
}
type List[T any] struct {
    head, tail *Node[T]
    n          int
}
```

No boxing, no assertions. A library author releasing a new linked list today would not use `interface{}`.

### What did the stdlib team do?

Almost nothing. `container/list` is still there. It is **not** generic. The team chose stability over modernization. New code is told to use slices or write its own typed linked list. This decision is deliberate:

- Migrating `container/list` to generics is a breaking change.
- The package was never popular.
- Investing in `slices` and `maps` was a higher-impact use of stdlib effort.

A pragmatic library author follows the same logic: **migrate when the win is real, not when fashion demands it**.

---

## Backwards-compatible migrations

When a library decides to introduce generics, three migration paths exist:

### Path 1 — Parallel API, same package

Add the generic version alongside the interface version:

```go
// Old
func Sort(data Interface) { ... }

// New (Go 1.21+)
func SortSlice[T cmp.Ordered](s []T) { ... }
```

Pros: no module bump. Cons: API surface grows.

### Path 2 — Parallel package

Put the generic version in a sister package:

```go
// Old: github.com/foo/bar
// New: github.com/foo/bar/slices
```

This is what the stdlib did with `slices` (vs `sort`). The two coexist; new code imports the new package.

### Path 3 — New major version

Release `/v2` with a generic API. Keep `/v1` alive for old callers:

```go
// v1
import "github.com/hashicorp/golang-lru"
cache, _ := lru.New(128) // returns interface{}

// v2
import "github.com/hashicorp/golang-lru/v2"
cache, _ := lru.New[string, *User](128) // returns *User
```

Pros: clean break, no old API noise. Cons: every consumer must change imports.

### Choosing a path

| Project size | Recommended path |
|--------------|------------------|
| Stdlib | Parallel package |
| Big external library | New major version |
| Small library | Parallel API in same package |

The wrong choice is often **modifying the existing API in place**. That breaks the world for no real gain.

---

## The Hashicorp pattern

Hashicorp's `golang-lru` migration is the textbook example of generic adoption:

1. **Release v2 with generics.** New module path: `github.com/hashicorp/golang-lru/v2`.
2. **Keep v1 alive.** Same module, no breaking changes.
3. **Document migration.** README and code comments point users to v2.
4. **No magic.** v1 still uses `interface{}`. v2 uses `[K comparable, V any]`.

```go
// v1 — old API
cache, _ := lru.New(128)
cache.Add("user_id", 42)
v, _ := cache.Get("user_id")
id := v.(int) // assertion

// v2 — generic API
cache, _ := lru.New[string, int](128)
cache.Add("user_id", 42)
id, _ := cache.Get("user_id") // already typed
```

Library authors publishing post-1.18 generic-friendly versions follow this pattern. It is the safest migration: clear semver story, no silent breakage, easy rollback.

### What about the interface vs generic question itself?

`golang-lru` migrated from `interface{}` (which was a stand-in for generics) to actual generics. The library was always **conceptually** generic — every cache holds one type of value. The interface form was just the pre-1.18 workaround.

When a library is **conceptually** interface-shaped (different implementations behind one name — like `io.Reader`), it does not migrate at all. It stays an interface forever.

---

## Designing for two generations of users

A library author in 2026 must serve:

- Users on Go 1.21+ who expect generic APIs.
- Users on Go 1.18-1.20 who can use generics but lack `slices`/`maps`/`cmp`.
- Users still on Go 1.17 (rare but real in regulated industries).

A practical approach:

1. **Set `go.mod` to the lowest version your callers tolerate.**
2. **Add generics conservatively.** Each generic function constrains your minimum Go version.
3. **For widely used libraries, keep a non-generic fallback** for users who cannot upgrade.
4. **Document the Go version your library requires** in the README.

For internal libraries, this is much less of a concern — your team controls the Go version. The hard cases are public modules with thousands of unknown consumers.

---

## Lessons from the standard library

The stdlib's adoption of generics is instructive:

| Package | Status | Why |
|---------|--------|-----|
| `slices`, `maps`, `cmp` | New, generic | Same body for many types |
| `sync/atomic` | Generic `Pointer[T]` | Type-safe wrapper |
| `sync` | `OnceValue[T]`, mostly generic | Same body for many types |
| `io` | Stays interface | Behaviour varies per implementation |
| `net/http` | Stays interface | Plugin / handler model |
| `database/sql` | Stays interface | Driver abstraction |
| `container/list` | Stays interface (discouraged) | Migration cost not worth it |
| `sort` | Both — `sort` and `slices.Sort` | Stability + new ergonomic API |
| `errors` | Stays interface | Polymorphic error types |
| `iter` | Generic `Seq[T]`, `Seq2[K, V]` | Same body, many element types |

The pattern is consistent: **shape-uniform → generic; behaviour-varying → interface; expensive to migrate → leave alone**.

A library author copying these decisions cannot go far wrong.

---

## Summary

The professional view of generics vs interfaces is **strategic**, not tactical:

1. **Both belong in the same toolbox.** A library uses both at different layers.
2. **Migrate from `interface{}` to generics when the body is uniform.** That is the historical case where the interface was a workaround.
3. **Do not migrate from real interfaces (`io.Reader`, `error`, `http.Handler`) to generics.** They are interface-shaped by nature.
4. **Add the generic API alongside the interface API.** Do not break callers.
5. **Use the Hashicorp `/v2` pattern** for major migrations of widely used libraries.
6. **Keep one Go version above your stated minimum** of headroom in your CI matrix.

The biggest professional lesson: **the choice between generics and interfaces is rarely a fight**. Most libraries use both. The interesting question is which layer of the library uses which tool, and how the public API stays stable across Go versions while internals modernize.

Move on to `specification.md` to see how the Go spec frames the two tools as type-set descriptors.
