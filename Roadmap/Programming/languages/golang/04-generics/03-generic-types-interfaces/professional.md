# Generic Types & Interfaces — Professional Level

## Table of Contents
1. [Production goals](#production-goals)
2. [Pattern 1 — typed concurrent map](#pattern-1-typed-concurrent-map)
3. [Pattern 2 — generic event bus](#pattern-2-generic-event-bus)
4. [Pattern 3 — generic repository](#pattern-3-generic-repository)
5. [Pattern 4 — generic builder](#pattern-4-generic-builder)
6. [Pattern 5 — generic in-memory cache with TTL](#pattern-5-generic-in-memory-cache-with-ttl)
7. [Pattern 6 — generic worker pool](#pattern-6-generic-worker-pool)
8. [Pattern 7 — generic pipeline](#pattern-7-generic-pipeline)
9. [Pattern 8 — generic result wrapper](#pattern-8-generic-result-wrapper)
10. [Code review checklist](#code-review-checklist)
11. [Team conventions](#team-conventions)
12. [Library design checklist](#library-design-checklist)
13. [Anti-patterns to flag](#anti-patterns-to-flag)
14. [Migration from `interface{}` codebase](#migration-from-interface-codebase)
15. [Real metrics from production](#real-metrics-from-production)
16. [Summary](#summary)

---

## Production goals

In a real codebase, generic types and interfaces have to fulfil four jobs at once:

1. **Reduce duplication** — one `Cache`, one `Repository`, one `EventBus`.
2. **Preserve type safety** — no `interface{}`, no runtime casts at boundaries.
3. **Stay debuggable** — error messages, stack traces, and logs should still be sensible.
4. **Stay reviewable** — generic code is harder to read than non-generic code, so the API surface must remain narrow and consistent.

The patterns below are battle-tested ones drawn from public Go libraries and large in-house repositories.

---

## Pattern 1 — typed concurrent map

A direct, type-safe wrapper around `sync.Map` is one of the most common generic types in production Go.

```go
package gomap

import "sync"

type SyncMap[K comparable, V any] struct {
    m sync.Map
}

func (s *SyncMap[K, V]) Load(key K) (V, bool) {
    v, ok := s.m.Load(key)
    if !ok {
        var zero V
        return zero, false
    }
    return v.(V), true
}

func (s *SyncMap[K, V]) Store(key K, value V) { s.m.Store(key, value) }

func (s *SyncMap[K, V]) LoadOrStore(key K, value V) (V, bool) {
    actual, loaded := s.m.LoadOrStore(key, value)
    return actual.(V), loaded
}

func (s *SyncMap[K, V]) Delete(key K) { s.m.Delete(key) }

func (s *SyncMap[K, V]) Range(fn func(K, V) bool) {
    s.m.Range(func(k, v any) bool {
        return fn(k.(K), v.(V))
    })
}
```

### Why we keep `sync.Map` underneath

`sync.Map` has hand-tuned read-heavy optimizations (lazy promotion, atomic snapshots). Re-implementing it from scratch is risky. The wrapper just gives type safety; the core algorithm stays the same.

### Cost

The `v.(V)` and `k.(K)` assertions are small but real. For pure value types they perform an unbox; for pointer types they are usually a no-op after the compiler has the type info. Benchmark on your workload before optimizing further.

### Variation — sharded map for high contention

```go
type ShardedMap[K comparable, V any] struct {
    shards [numShards]struct {
        mu sync.RWMutex
        m  map[K]V
    }
    hash func(K) uint64
}
```

The hash function is parameter-aware (e.g., for `string` use FNV; for `int` use the value). You can take a `hash` function as a constructor argument or constrain `K` further.

---

## Pattern 2 — generic event bus

Event-driven architecture benefits massively from generics — every event type used to require its own bus or a shared `interface{}` bus with type assertions.

```go
package eventbus

import "sync"

type Handler[E any] func(E)

type EventBus[E any] struct {
    mu       sync.RWMutex
    handlers []Handler[E]
}

func New[E any]() *EventBus[E] {
    return &EventBus[E]{}
}

func (b *EventBus[E]) Subscribe(h Handler[E]) func() {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.handlers = append(b.handlers, h)
    idx := len(b.handlers) - 1
    return func() {
        b.mu.Lock()
        defer b.mu.Unlock()
        b.handlers[idx] = nil
    }
}

func (b *EventBus[E]) Publish(e E) {
    b.mu.RLock()
    handlers := append([]Handler[E](nil), b.handlers...) // snapshot
    b.mu.RUnlock()
    for _, h := range handlers {
        if h != nil {
            h(e)
        }
    }
}
```

### Usage

```go
type OrderPlaced struct{ ID string; Amount int64 }

bus := eventbus.New[OrderPlaced]()
unsub := bus.Subscribe(func(e OrderPlaced) {
    log.Printf("order placed: %s, %d", e.ID, e.Amount)
})
defer unsub()

bus.Publish(OrderPlaced{ID: "o-42", Amount: 9_900})
```

Each event type gets its own bus instance with its own handler set. Compile-time check stops you from publishing the wrong type.

### Discussion — channel-based variant

```go
type ChanBus[E any] struct {
    mu   sync.RWMutex
    subs []chan E
}

func (b *ChanBus[E]) Subscribe(buf int) <-chan E { /* ... */ }
func (b *ChanBus[E]) Publish(e E)                { /* ... */ }
```

Channel-based buses give back-pressure for free but require careful close semantics. Pick based on your deployment.

---

## Pattern 3 — generic repository

The repository pattern hides storage details behind a narrow interface. With generics, the boilerplate drops dramatically.

```go
package repo

import (
    "context"
    "errors"
)

var ErrNotFound = errors.New("not found")

type ID interface{ ~string | ~int64 }

type Repository[T any, K ID] interface {
    Get(ctx context.Context, id K) (T, error)
    Save(ctx context.Context, v T) (K, error)
    Delete(ctx context.Context, id K) error
    List(ctx context.Context, limit, offset int) ([]T, error)
}
```

### SQL implementation

```go
type SQLRepo[T any, K ID] struct {
    db        *sql.DB
    table     string
    selectQ   string
    insertQ   string
    deleteQ   string
    listQ     string
    scan      func(*sql.Rows) (T, error)
    keyFromT  func(T) K
}

func (r *SQLRepo[T, K]) Get(ctx context.Context, id K) (T, error) {
    var zero T
    rows, err := r.db.QueryContext(ctx, r.selectQ, id)
    if err != nil { return zero, err }
    defer rows.Close()
    if !rows.Next() { return zero, ErrNotFound }
    return r.scan(rows)
}

func (r *SQLRepo[T, K]) Save(ctx context.Context, v T) (K, error) {
    k := r.keyFromT(v)
    _, err := r.db.ExecContext(ctx, r.insertQ, k, /* ... */)
    return k, err
}
```

### Per-domain configuration

```go
type User struct {
    ID    string
    Email string
}

func scanUser(rows *sql.Rows) (User, error) {
    var u User
    return u, rows.Scan(&u.ID, &u.Email)
}

userRepo := &SQLRepo[User, string]{
    db:       db,
    table:    "users",
    selectQ:  "SELECT id, email FROM users WHERE id = $1",
    insertQ:  "INSERT INTO users (id, email) VALUES ($1, $2)",
    deleteQ:  "DELETE FROM users WHERE id = $1",
    listQ:    "SELECT id, email FROM users LIMIT $1 OFFSET $2",
    scan:     scanUser,
    keyFromT: func(u User) string { return u.ID },
}
```

### Trade-off — SQL strings vs query builder

The SQL strings are still hand-written per domain. Some teams parameterize further with code generation or a query builder. The right balance depends on schema diversity.

### Discussion — when *not* to use this pattern

- When CRUD differs significantly per domain, a generic repository becomes a leaky abstraction — better to write specialized repositories.
- When the storage uses fundamentally different paradigms (graph, document, time-series), the abstraction starts to lie.

---

## Pattern 4 — generic builder

A builder lets you assemble a complex value step by step. With generics, the same builder shape works for many concrete types.

```go
package httpclient

type Builder[Cfg any] struct {
    cfg Cfg
}

func New[Cfg any](initial Cfg) *Builder[Cfg] {
    return &Builder[Cfg]{cfg: initial}
}

func (b *Builder[Cfg]) With(modify func(*Cfg)) *Builder[Cfg] {
    modify(&b.cfg)
    return b
}

func (b *Builder[Cfg]) Build() Cfg { return b.cfg }
```

Usage:

```go
type Cfg struct {
    Timeout time.Duration
    Retries int
    BaseURL string
}

cfg := New(Cfg{Timeout: 30 * time.Second}).
    With(func(c *Cfg) { c.Retries = 3 }).
    With(func(c *Cfg) { c.BaseURL = "https://api.example.com" }).
    Build()
```

A "functional options" generic variant:

```go
type Option[T any] func(*T)

func Build[T any](initial T, opts ...Option[T]) T {
    cfg := initial
    for _, o := range opts { o(&cfg) }
    return cfg
}

func WithRetries(n int) Option[Cfg] { return func(c *Cfg) { c.Retries = n } }
```

This pairs the well-known options pattern with generics so options can themselves be type-parameterized.

---

## Pattern 5 — generic in-memory cache with TTL

```go
package cache

import (
    "sync"
    "time"
)

type entry[V any] struct {
    value     V
    expiresAt time.Time
}

type Cache[K comparable, V any] struct {
    mu  sync.RWMutex
    m   map[K]entry[V]
    ttl time.Duration
}

func New[K comparable, V any](ttl time.Duration) *Cache[K, V] {
    return &Cache[K, V]{m: make(map[K]entry[V]), ttl: ttl}
}

func (c *Cache[K, V]) Get(k K) (V, bool) {
    c.mu.RLock()
    e, ok := c.m[k]
    c.mu.RUnlock()
    if !ok || time.Now().After(e.expiresAt) {
        var zero V
        return zero, false
    }
    return e.value, true
}

func (c *Cache[K, V]) Set(k K, v V) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.m[k] = entry[V]{value: v, expiresAt: time.Now().Add(c.ttl)}
}

func (c *Cache[K, V]) Delete(k K) {
    c.mu.Lock()
    defer c.mu.Unlock()
    delete(c.m, k)
}

// StartCleaner runs a background goroutine that periodically deletes expired entries.
func (c *Cache[K, V]) StartCleaner(interval time.Duration, stop <-chan struct{}) {
    go func() {
        t := time.NewTicker(interval)
        defer t.Stop()
        for {
            select {
            case <-t.C:
                now := time.Now()
                c.mu.Lock()
                for k, e := range c.m {
                    if now.After(e.expiresAt) { delete(c.m, k) }
                }
                c.mu.Unlock()
            case <-stop:
                return
            }
        }
    }()
}
```

`Cache[string, *User]` and `Cache[int, []byte]` are different concrete caches in the same code base, with no boxing.

---

## Pattern 6 — generic worker pool

```go
package workerpool

import (
    "context"
    "sync"
)

type Job[In, Out any] struct {
    Input  In
    Result chan<- Result[Out]
}

type Result[Out any] struct {
    Value Out
    Err   error
}

type Pool[In, Out any] struct {
    jobs chan Job[In, Out]
    wg   sync.WaitGroup
    fn   func(context.Context, In) (Out, error)
}

func NewPool[In, Out any](workers int, fn func(context.Context, In) (Out, error)) *Pool[In, Out] {
    return &Pool[In, Out]{
        jobs: make(chan Job[In, Out], workers*2),
        fn:   fn,
    }
}

func (p *Pool[In, Out]) Start(ctx context.Context, n int) {
    for i := 0; i < n; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for j := range p.jobs {
                v, err := p.fn(ctx, j.Input)
                j.Result <- Result[Out]{Value: v, Err: err}
            }
        }()
    }
}

func (p *Pool[In, Out]) Submit(j Job[In, Out]) { p.jobs <- j }

func (p *Pool[In, Out]) Stop() {
    close(p.jobs)
    p.wg.Wait()
}
```

`NewPool[string, []byte](10, fetchURL)` gives a typed worker pool — no `interface{}` casts.

---

## Pattern 7 — generic pipeline

A pipeline takes a function for each stage and chains them. Each stage may transform `T → U`, so we use top-level generic functions (not methods).

```go
package pipeline

import "context"

func Stage[In, Out any](
    ctx context.Context,
    in <-chan In,
    fn func(In) (Out, error),
) (<-chan Out, <-chan error) {
    out := make(chan Out)
    errs := make(chan error, 1)
    go func() {
        defer close(out)
        for v := range in {
            select {
            case <-ctx.Done(): errs <- ctx.Err(); return
            default:
            }
            r, err := fn(v)
            if err != nil { errs <- err; return }
            out <- r
        }
    }()
    return out, errs
}
```

Composing:

```go
parsed, e1 := pipeline.Stage(ctx, lines, parseLine)
filtered, e2 := pipeline.Stage(ctx, parsed, filterRow)
sums, e3 := pipeline.Stage(ctx, filtered, computeSum)
```

The element type changes at each stage (`string → Row → Row → Total`) and is inferred by the compiler from `fn`.

---

## Pattern 8 — generic result wrapper

A `Result[T]` packages a value-or-error into a single move-able envelope. Useful for collecting results from concurrent operations.

```go
type Result[T any] struct {
    Value T
    Err   error
}

func Ok[T any](v T) Result[T]   { return Result[T]{Value: v} }
func Fail[T any](err error) Result[T] { return Result[T]{Err: err} }

func (r Result[T]) Unwrap() (T, error) { return r.Value, r.Err }
```

Pairs well with channels:

```go
out := make(chan Result[Order], len(ids))
for _, id := range ids {
    go func(id string) {
        o, err := repo.Get(ctx, id)
        if err != nil { out <- Fail[Order](err); return }
        out <- Ok(o)
    }(id)
}

for i := 0; i < len(ids); i++ {
    r := <-out
    if r.Err != nil { /* handle */ continue }
    process(r.Value)
}
```

---

## Code review checklist

When reviewing a pull request that adds or changes a generic type:

- [ ] Is the parameter list small (≤ 3)?
- [ ] Are constraints chosen tightly (`comparable` where possible, `any` only when needed)?
- [ ] Are receivers consistent (all pointer or all value)?
- [ ] Are zero-value returns correct (`var zero T`)?
- [ ] Are exported fields documented per parameter?
- [ ] Is there at least one test that uses two different `T`s?
- [ ] Does the type avoid runtime type assertions on its own `T`?
- [ ] Are no method-level type parameters being attempted (would not compile, but stop early refactors)?
- [ ] Are interfaces clearly *value* or *constraint* (no half-half mixing)?
- [ ] Are concurrency invariants documented if the type is shared?
- [ ] Are benchmarks added if it sits on a hot path?
- [ ] Does the type identity (`pkg.Stack[int]`) match the package's naming convention?

---

## Team conventions

A consistent in-repo style for generics pays off quickly:

1. **Parameter names**: `T` for value, `K`/`V` for key/value, `E` for element/event, `R` for result, `In`/`Out` for pipeline edges.
2. **Constructor**: `New[T]()` for unparameterized creation, `NewT[T](...)` only if there is a separate creation flow.
3. **Pointer receivers** for any method that touches mutable state.
4. **One generic type per file** when the type is non-trivial — easier to follow.
5. **Doc comments**: explicitly mention each parameter and its constraint.

```go
// Cache is a TTL-bound in-memory cache.
//
// K is the key type. It must be comparable (used in the underlying map).
// V is the value type. It can be any type.
type Cache[K comparable, V any] struct { /* ... */ }
```

---

## Library design checklist

For a generic *library* (intended to be imported by other packages):

- [ ] All exported types have unambiguous names (`gomap.SyncMap`, not `gomap.M`).
- [ ] Parameter names and order are stable across versions.
- [ ] No "magic" constraints — constraints are either standard (`any`, `comparable`, `cmp.Ordered`) or defined and exported in the library.
- [ ] Examples in `_test.go` files showing typical instantiations.
- [ ] Benchmarks for at least one representative `T`.
- [ ] Compatibility with go vet, staticcheck, golangci-lint.
- [ ] No dependence on internal compiler details (e.g., do not assume monomorphization is happening).

---

## Anti-patterns to flag

| Anti-pattern | Why it's bad |
|--------------|-------------|
| `Set[any]` | Defeats the type safety; equivalent to `map[any]struct{}` |
| Type assertion inside a method on `Stack[T]` | Indicates `T` is wrong or another parameter is needed |
| `func (s *Stack[T]) X()` and `func (s Stack[T]) Y()` mixing receivers | Violates method-set consistency rules |
| Generic type embedded in another generic type with mismatched constraints | Will compile but is fragile under refactoring |
| Using `reflect` on `T` to special-case behavior | The constraint should encode it instead |
| Returning `*Stack[T]` from a method that "should" return a transformed `*Stack[U]` | Method type parameters are not allowed; refactor to free function |
| Generics as a workaround for missing variance | Go does not have variance; do not fake it |

---

## Migration from `interface{}` codebase

Real-world projects pre-1.18 are full of `interface{}` containers. A safe migration plan:

### Step 1 — list the abstractions

`Cache`, `Set`, `EventBus`, `Repository`, `Result`, `Option`. Each of these may exist in your codebase under various names.

### Step 2 — pick one, write the generic version alongside

Do not delete the old type. Add `CacheV2[K, V]` next to it.

### Step 3 — port one call site

Replace `cache.Cache` with `cache.CacheV2[K, V]` in one file. Run tests. Resolve type-assertion errors.

### Step 4 — repeat across the codebase

When all call sites are ported, delete the original `Cache`. Rename `CacheV2` → `Cache`.

### Step 5 — backfill tests

Tests written for `interface{}` may not catch type-mismatch bugs the new system *does* catch. Refresh the test suite.

This staged approach makes a large generics migration tractable.

---

## Real metrics from production

The numbers vary per workload, but typical findings:

- **Boxing avoidance** in a generic `Set[int64]` vs `map[interface{}]struct{}`: 30–60% memory savings, 20–40% lookup speed.
- **`sync.Map` typed wrapper** adds essentially zero overhead vs raw `sync.Map`; the type assertion is cheap.
- **Generic event bus** vs `interface{}` bus: similar throughput; the value comes from compile-time safety, not raw speed.
- **Generic repository** complies with go vet, fewer runtime panics from misuse.
- **Compile time** of a heavily generic package can rise by 20–50%; usually still acceptable.

Always measure on your own workload before quoting numbers.

---

## Summary

Production usage of generic types and interfaces clusters around a small set of patterns: typed concurrent maps, event buses, repositories, builders, caches, worker pools, pipelines, and result wrappers. The patterns share traits — small parameter lists, consistent receivers, narrow exported APIs, and clear concurrency stories. Code review and team conventions matter as much as the patterns themselves; generics introduce cognitive load that careful style can offset.

End of professional.md.
