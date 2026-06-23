# Generic Functions — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Real Production Patterns](#real-production-patterns)
3. [Result[T] and Option[T]](#resultt-and-optiont)
4. [Generic Functional Helpers](#generic-functional-helpers)
5. [Ordered Iteration](#ordered-iteration)
6. [Transformation Pipelines](#transformation-pipelines)
7. [Concurrent Generic Helpers](#concurrent-generic-helpers)
8. [Generic Repositories](#generic-repositories)
9. [Generic Caches](#generic-caches)
10. [Generic Pools](#generic-pools)
11. [Generic Test Helpers](#generic-test-helpers)
12. [Code Review Checklist](#code-review-checklist)
13. [Team Conventions](#team-conventions)
14. [Adoption Roadmap](#adoption-roadmap)
15. [Tricky Questions](#tricky-questions)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)

---

## Introduction

This file shows generic functions as they appear in **real production Go code** — not toy examples, but the building blocks of services. Each section gives a complete, runnable pattern you can adapt directly.

A few principles apply throughout:

1. **Hide complexity behind a clean call site.** A generic helper should be easy to call.
2. **Always include `context.Context` for I/O.** Generics don't change this rule.
3. **Be conservative with public APIs.** Internal generic helpers can iterate; public ones cannot.
4. **Compose, don't proliferate.** A few well-chosen generics beat many narrow ones.

---

## Real Production Patterns

The patterns below come from real Go services running in production. Each is opinionated for clarity.

---

## Result[T] and Option[T]

Go does not have built-in algebraic data types, but generics let you build approximations.

### Option[T]

```go
package option

type Option[T any] struct {
    value T
    ok    bool
}

func Some[T any](v T) Option[T] { return Option[T]{value: v, ok: true} }
func None[T any]() Option[T]    { return Option[T]{} }

func (o Option[T]) Get() (T, bool) { return o.value, o.ok }
func (o Option[T]) IsSome() bool   { return o.ok }
func (o Option[T]) IsNone() bool   { return !o.ok }

func (o Option[T]) Or(def T) T {
    if o.ok { return o.value }
    return def
}

func Map[T any, U any](o Option[T], f func(T) U) Option[U] {
    if !o.ok {
        return None[U]()
    }
    return Some(f(o.value))
}

func FlatMap[T any, U any](o Option[T], f func(T) Option[U]) Option[U] {
    if !o.ok {
        return None[U]()
    }
    return f(o.value)
}
```

Usage:

```go
maybeUser := findUser(id)                 // Option[User]
maybeName := option.Map(maybeUser, func(u User) string { return u.Name })
name := maybeName.Or("anonymous")
```

When to reach for `Option[T]`:
- You have a **public API** where nil pointers would be ambiguous.
- You want to chain transformations without nil-checking each step.

When **not** to:
- For a private function, `(T, bool)` is more idiomatic Go.
- For error situations, use `error`, not `Option`.

### Result[T]

```go
package result

type Result[T any] struct {
    value T
    err   error
}

func Ok[T any](v T) Result[T]      { return Result[T]{value: v} }
func Err[T any](e error) Result[T] { return Result[T]{err: e} }

func (r Result[T]) Unwrap() (T, error) { return r.value, r.err }

func Map[T any, U any](r Result[T], f func(T) U) Result[U] {
    if r.err != nil {
        return Err[U](r.err)
    }
    return Ok(f(r.value))
}

func MapErr[T any, U any](r Result[T], f func(T) (U, error)) Result[U] {
    if r.err != nil {
        return Err[U](r.err)
    }
    u, err := f(r.value)
    if err != nil {
        return Err[U](err)
    }
    return Ok(u)
}
```

This wrapper is useful when you want to collect or pipeline errors functionally. Most Go code is happier with the standard `(T, error)` return idiom — only adopt `Result[T]` if you have a real reason.

---

## Generic Functional Helpers

A small, opinionated set of helpers covers ~95% of real needs.

```go
package fp

func Map[T, U any](xs []T, f func(T) U) []U {
    out := make([]U, len(xs))
    for i, x := range xs {
        out[i] = f(x)
    }
    return out
}

func Filter[T any](xs []T, pred func(T) bool) []T {
    out := make([]T, 0, len(xs))
    for _, x := range xs {
        if pred(x) {
            out = append(out, x)
        }
    }
    return out
}

func Reduce[T, U any](xs []T, init U, f func(U, T) U) U {
    acc := init
    for _, x := range xs {
        acc = f(acc, x)
    }
    return acc
}

func Find[T any](xs []T, pred func(T) bool) (T, bool) {
    for _, x := range xs {
        if pred(x) {
            return x, true
        }
    }
    var zero T
    return zero, false
}

func Any[T any](xs []T, pred func(T) bool) bool {
    for _, x := range xs {
        if pred(x) { return true }
    }
    return false
}

func All[T any](xs []T, pred func(T) bool) bool {
    for _, x := range xs {
        if !pred(x) { return false }
    }
    return true
}

func GroupBy[T any, K comparable](xs []T, key func(T) K) map[K][]T {
    out := make(map[K][]T)
    for _, x := range xs {
        k := key(x)
        out[k] = append(out[k], x)
    }
    return out
}

func ToSet[T comparable](xs []T) map[T]struct{} {
    out := make(map[T]struct{}, len(xs))
    for _, x := range xs {
        out[x] = struct{}{}
    }
    return out
}

func KeyBy[T any, K comparable](xs []T, key func(T) K) map[K]T {
    out := make(map[K]T, len(xs))
    for _, x := range xs {
        out[key(x)] = x
    }
    return out
}
```

**Don't** add methods like `Take`, `Drop`, `Every`, `Some`, `Includes` to this list unless multiple call sites prove they're needed. Bigger libraries become harder to teach.

---

## Ordered Iteration

Go's `map` iteration order is intentionally randomized. When you need ordered output (logs, snapshots, deterministic tests) generics give you a clean tool.

```go
import "sort"

// SortedKeys returns the keys of m in ascending order.
// K must satisfy cmp.Ordered (Go 1.21+).
func SortedKeys[K cmp.Ordered, V any](m map[K]V) []K {
    keys := make([]K, 0, len(m))
    for k := range m {
        keys = append(keys, k)
    }
    sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
    return keys
}

// SortedEntries returns map entries sorted by key.
type Entry[K, V any] struct {
    Key   K
    Value V
}

func SortedEntries[K cmp.Ordered, V any](m map[K]V) []Entry[K, V] {
    keys := SortedKeys(m)
    out := make([]Entry[K, V], len(keys))
    for i, k := range keys {
        out[i] = Entry[K, V]{Key: k, Value: m[k]}
    }
    return out
}
```

Usage in a deterministic logger:

```go
for _, e := range SortedEntries(metrics) {
    log.Printf("%s = %d", e.Key, e.Value)
}
```

For a custom sort comparator:

```go
func SortedBy[T any](xs []T, less func(a, b T) bool) []T {
    out := make([]T, len(xs))
    copy(out, xs)
    sort.Slice(out, func(i, j int) bool { return less(out[i], out[j]) })
    return out
}
```

Returning a copy keeps the original immutable — preferred for shared state.

---

## Transformation Pipelines

A common pattern: data flows through several transformations.

### Direct composition

```go
result := fp.Map(
    fp.Filter(users, isAdult),
    func(u User) string { return u.Name },
)
```

This is readable up to two transformations. Beyond that, prefer a pipeline helper.

### Pipeline helper

```go
type Step[T any] func([]T) []T

func Pipeline[T any](xs []T, steps ...Step[T]) []T {
    for _, s := range steps {
        xs = s(xs)
    }
    return xs
}

usersForReport := Pipeline(users,
    func(xs []User) []User { return fp.Filter(xs, isAdult) },
    func(xs []User) []User { return fp.Filter(xs, isActive) },
    sortByName,
)
```

When stages change types, a single-`T` pipeline doesn't fit. Use explicit composition or a builder:

```go
type Stream[T any] struct{ Items []T }

func From[T any](xs []T) *Stream[T] { return &Stream[T]{Items: xs} }

func (s *Stream[T]) Filter(p func(T) bool) *Stream[T] {
    s.Items = fp.Filter(s.Items, p)
    return s
}

// Type-changing step requires a free function (Go method limitation):
func StreamMap[T, U any](s *Stream[T], f func(T) U) *Stream[U] {
    return &Stream[U]{Items: fp.Map(s.Items, f)}
}

// Usage
names := StreamMap(
    From(users).Filter(isActive).Filter(isAdult),
    func(u User) string { return u.Name },
)
```

Methods can't introduce new type parameters, so `StreamMap` is a free function. We accept the small awkwardness in exchange for the chained `Filter` calls.

---

## Concurrent Generic Helpers

Many real services need parallel `Map`. Generics shine here.

```go
import "sync"

// ParallelMap applies f to each element of xs concurrently with
// up to `concurrency` workers. Order is preserved.
func ParallelMap[T, U any](
    ctx context.Context,
    xs []T,
    concurrency int,
    f func(context.Context, T) (U, error),
) ([]U, error) {
    out := make([]U, len(xs))
    sem := make(chan struct{}, concurrency)
    var wg sync.WaitGroup
    var firstErr error
    var errOnce sync.Once

    for i, x := range xs {
        i, x := i, x
        select {
        case <-ctx.Done():
            return nil, ctx.Err()
        case sem <- struct{}{}:
        }
        wg.Add(1)
        go func() {
            defer wg.Done()
            defer func() { <-sem }()
            v, err := f(ctx, x)
            if err != nil {
                errOnce.Do(func() { firstErr = err })
                return
            }
            out[i] = v
        }()
    }
    wg.Wait()
    if firstErr != nil {
        return nil, firstErr
    }
    return out, nil
}
```

Usage:

```go
users, err := ParallelMap(ctx, ids, 10, func(ctx context.Context, id string) (User, error) {
    return userClient.Get(ctx, id)
})
```

For a saner version use `golang.org/x/sync/errgroup`:

```go
func ParallelMapEG[T, U any](
    ctx context.Context, xs []T, concurrency int,
    f func(context.Context, T) (U, error),
) ([]U, error) {
    out := make([]U, len(xs))
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(concurrency)
    for i, x := range xs {
        i, x := i, x
        g.Go(func() error {
            v, err := f(ctx, x)
            if err != nil { return err }
            out[i] = v
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return out, nil
}
```

This is the form most production codebases settle on.

---

## Generic Repositories

Repositories often share boilerplate: get-by-id, save, delete. A generic interface captures the shape:

```go
type Identifier[ID comparable] interface {
    GetID() ID
}

type Repository[ID comparable, T Identifier[ID]] interface {
    Get(ctx context.Context, id ID) (T, error)
    Save(ctx context.Context, x T) error
    Delete(ctx context.Context, id ID) error
}

type InMemoryRepo[ID comparable, T Identifier[ID]] struct {
    mu    sync.RWMutex
    items map[ID]T
}

func NewInMemoryRepo[ID comparable, T Identifier[ID]]() *InMemoryRepo[ID, T] {
    return &InMemoryRepo[ID, T]{items: make(map[ID]T)}
}

func (r *InMemoryRepo[ID, T]) Get(ctx context.Context, id ID) (T, error) {
    r.mu.RLock(); defer r.mu.RUnlock()
    if x, ok := r.items[id]; ok {
        return x, nil
    }
    var zero T
    return zero, ErrNotFound
}

func (r *InMemoryRepo[ID, T]) Save(ctx context.Context, x T) error {
    r.mu.Lock(); defer r.mu.Unlock()
    r.items[x.GetID()] = x
    return nil
}

func (r *InMemoryRepo[ID, T]) Delete(ctx context.Context, id ID) error {
    r.mu.Lock(); defer r.mu.Unlock()
    delete(r.items, id)
    return nil
}
```

Usage:

```go
type User struct{ ID string; Name string }
func (u User) GetID() string { return u.ID }

repo := NewInMemoryRepo[string, User]()
_ = repo.Save(ctx, User{ID: "1", Name: "Ada"})
```

We pair this generic interface with a generic decorator:

```go
func WithLogging[ID comparable, T Identifier[ID]](r Repository[ID, T], log *slog.Logger) Repository[ID, T] {
    return &loggingRepo[ID, T]{inner: r, log: log}
}
```

This is one of the highest-value uses of generics in modern Go services: cross-cutting concerns expressed once, applied to many concrete types.

---

## Generic Caches

A simple TTL cache:

```go
type cacheEntry[V any] struct {
    value     V
    expiresAt time.Time
}

type Cache[K comparable, V any] struct {
    mu      sync.Mutex
    entries map[K]cacheEntry[V]
    ttl     time.Duration
}

func NewCache[K comparable, V any](ttl time.Duration) *Cache[K, V] {
    return &Cache[K, V]{
        entries: make(map[K]cacheEntry[V]),
        ttl:     ttl,
    }
}

func (c *Cache[K, V]) Get(k K) (V, bool) {
    c.mu.Lock(); defer c.mu.Unlock()
    e, ok := c.entries[k]
    if !ok || time.Now().After(e.expiresAt) {
        delete(c.entries, k)
        var zero V
        return zero, false
    }
    return e.value, true
}

func (c *Cache[K, V]) Set(k K, v V) {
    c.mu.Lock(); defer c.mu.Unlock()
    c.entries[k] = cacheEntry[V]{
        value:     v,
        expiresAt: time.Now().Add(c.ttl),
    }
}
```

For a fetch-through cache:

```go
func (c *Cache[K, V]) GetOrFetch(ctx context.Context, k K, fetch func(context.Context, K) (V, error)) (V, error) {
    if v, ok := c.Get(k); ok {
        return v, nil
    }
    v, err := fetch(ctx, k)
    if err != nil {
        var zero V
        return zero, err
    }
    c.Set(k, v)
    return v, nil
}
```

For real production caches, prefer `golang.org/x/sync/singleflight` to avoid stampedes — that library is also generic-friendly with a small wrapper.

---

## Generic Pools

A typed wrapper around `sync.Pool`:

```go
type Pool[T any] struct {
    inner sync.Pool
}

func NewPool[T any](newFn func() T) *Pool[T] {
    return &Pool[T]{
        inner: sync.Pool{
            New: func() any { return newFn() },
        },
    }
}

func (p *Pool[T]) Get() T {
    return p.inner.Get().(T)
}

func (p *Pool[T]) Put(x T) {
    p.inner.Put(x)
}
```

Why this is worth doing:
- The original `sync.Pool` returns `any` — every caller writes a type assertion.
- A generic wrapper does the assertion **once**, keeping the user-facing API clean.
- The runtime cost is a single function call.

Usage:

```go
buf := NewPool[*bytes.Buffer](func() *bytes.Buffer { return new(bytes.Buffer) })

b := buf.Get()
b.Reset()
b.WriteString("...")
buf.Put(b)
```

---

## Generic Test Helpers

Generics greatly improve test ergonomics.

```go
package testutil

func Equal[T comparable](t *testing.T, want, got T) {
    t.Helper()
    if want != got {
        t.Errorf("want %v, got %v", want, got)
    }
}

func DeepEqual[T any](t *testing.T, want, got T) {
    t.Helper()
    if !reflect.DeepEqual(want, got) {
        t.Errorf("want %v, got %v", want, got)
    }
}

func Contains[T comparable](t *testing.T, xs []T, x T) {
    t.Helper()
    for _, v := range xs {
        if v == x { return }
    }
    t.Errorf("expected %v in %v", x, xs)
}

func MustNoError[T any](t *testing.T, v T, err error) T {
    t.Helper()
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    return v
}
```

Usage:

```go
user := testutil.MustNoError(t, repo.Get(ctx, id))
testutil.Equal(t, "Ada", user.Name)
```

`MustNoError` is particularly nice — it removes the common `if err != nil { t.Fatal(err) }` boilerplate while remaining typed.

---

## Code Review Checklist

When reviewing PRs that introduce generic functions, confirm each item:

- [ ] **Is it actually used by ≥2 concrete types?** If only one, generics are premature.
- [ ] **Are the constraints minimal?** No "just in case" loosening.
- [ ] **Does the function have a doc comment with an example?** Generic signatures benefit from prose.
- [ ] **Are tests exercising at least two type instantiations?**
- [ ] **Does it integrate with existing helpers** (e.g., does it need `Map` or duplicate `Map`'s body)?
- [ ] **Is there a `context.Context` if the function does I/O?**
- [ ] **Are errors wrapped with enough information?**
- [ ] **Is the function placed in the right package** (generic helpers package, not domain code)?
- [ ] **Has compile time been measured** for the affected packages?

---

## Team Conventions

Pick a few rules and write them down. A starter set:

1. **Generic helpers live in `internal/<domain>x`** packages: `slicesx`, `mapsx`, `fp`. Domain code rarely imports the runtime parameters.
2. **Constraints are defined once.** Reuse `cmp.Ordered`, `constraints.Integer`, etc. — don't redefine.
3. **Naming convention.** Type parameters: `T` (single), `T, U` (two), `K, V` (key/value), `ID, T` (entity helpers). Avoid `A`, `B`, `C` unless mathematically motivated.
4. **Public generic APIs require an RFC.** Internal helpers are free; exported ones change the project's commitments.
5. **Benchmarks for hot-path generics.** If the helper is called in a request-handler hot loop, a benchmark must be added.
6. **Prefer `(T, bool)` over `Option[T]`** unless an external API contract requires the latter.
7. **Prefer `(T, error)` over `Result[T]`** for public APIs. Only use `Result[T]` for pipeline-heavy internal code.

Document these in `CONTRIBUTING.md` so they're applied consistently.

---

## Adoption Roadmap

If you're introducing generics into an existing codebase:

### Phase 1 — Internal helpers (1-2 weeks)

- Add a `slicesx`/`mapsx` package with `Map`, `Filter`, `Reduce`, `GroupBy`, `Uniq`.
- Refactor 5-10 obvious places in business code.
- Run benchmarks; ensure no regressions.

### Phase 2 — Test helpers (1 week)

- Add `testutil` with `Equal`, `DeepEqual`, `MustNoError`.
- Refactor a sample test file to use them.
- Run the full test suite; ensure no regressions.

### Phase 3 — Repositories and caches (2-4 weeks)

- Introduce `Repository[ID, T]` for new domains.
- Migrate existing repositories incrementally — one domain at a time.
- Add generic caching/logging decorators.

### Phase 4 — Public API (carefully)

- Audit any exported helpers for generality.
- Consider `Option[T]` / `Result[T]` only if a real consumer needs them.
- Update API docs and changelog before merging.

Throughout, keep an explicit list of "places we tried generics and rolled back" so the team learns from misfires too.

---

## Tricky Questions

**Q1.** A teammate adds `Map`, `Filter`, `Reduce`, `Take`, `Drop`, `Each`, `Every`, `Some`, `None`. Should the team accept this PR?
**A.** Probably not in one shot. Start with the three or four with proven demand; add the rest as needed. Each new helper is API surface to maintain.

**Q2.** Why is `Repository[ID comparable, T Identifier[ID]]` better than `Repository[T]`?
**A.** It enforces the relationship between `T`'s identifier and the repository key at compile time. The compiler will refuse `Repository[string, Order]` unless `Order` has `GetID() string`.

**Q3.** Why might `ParallelMap` be a bad fit for memory-bound workloads?
**A.** Spawning many goroutines can multiply allocations and pressure the GC. Always cap concurrency.

**Q4.** When does `Option[T]` surpass `(T, bool)` as an API?
**A.** When you want method-style chaining (`o.Map(...)`, `.Or(...)`) or when a public API wants to make missingness explicit beyond Go's tuple convention.

**Q5.** Should you make `singleflight.Group` generic?
**A.** Yes — it's a top-3 win. The standard library hasn't (yet) but small wrappers are widespread and worth it.

---

## Cheat Sheet

```go
// Production helpers
fp.Map, fp.Filter, fp.Reduce, fp.Find, fp.GroupBy, fp.KeyBy

// Wrappers
Option[T], Result[T]                 // when API needs explicit "no value"
Pool[T]                              // typed sync.Pool
Cache[K, V]                          // typed TTL cache

// Concurrency
ParallelMap[T, U](ctx, xs, n, f)     // bounded parallel transformation

// Domain layer
Repository[ID comparable, T Identifier[ID]]

// Test helpers
testutil.Equal, testutil.MustNoError, testutil.DeepEqual

// Conventions
- Helpers live in `*x` packages
- Tight constraints, doc + example, ≥2 callers
- Benchmark hot-path generics
- (T, error) and (T, bool) preferred to Result/Option in idiomatic code
```

---

## Summary

Production-grade generic functions are short, well-documented, and live in dedicated helper packages. The biggest wins come from cross-cutting concerns: caches, pools, repositories, parallel transforms, and test helpers. The biggest risks are over-abstraction and API churn. A small, opinionated standard set — chosen with the team — beats an ever-growing library where every commit adds yet another `Take` or `Drop`.

[← senior.md](./senior.md) · [specification.md →](./specification.md)
