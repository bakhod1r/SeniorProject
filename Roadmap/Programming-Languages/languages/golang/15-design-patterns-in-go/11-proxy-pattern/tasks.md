# Proxy — Practice Tasks

Work through these in order; each builds on the last. Use `go test -race` throughout.

---

## Task 1 (Junior): Caching proxy
Given:
```go
type KV interface { Get(key string) (string, error) }
```
Implement `CachingKV` that wraps a `KV`, caches successful `Get` results in a map, and serves repeat reads from the cache. Write a test using a fake `KV` that counts how many times the real `Get` is called; assert the second read for the same key does not hit the real store.

**Acceptance:** second `Get(k)` increments no real-call counter.

---

## Task 2 (Junior): Virtual proxy
Add `LazyKV` that takes a `func() KV` and only builds the real `KV` on the first `Get`. Prove with a test that constructing `LazyKV` does not call the factory, and the first `Get` does.

**Acceptance:** factory call count is 0 after construction, 1 after any number of `Get`s.

---

## Task 3 (Middle): Make the cache concurrency-safe
Run Task 1's `CachingKV` under `go test -race` with 50 goroutines reading the same and different keys. Fix the data race with a `sync.RWMutex`. 

**Acceptance:** `-race` is clean; reads still hit the cache.

---

## Task 4 (Middle): Protection proxy with invalidation
Extend the interface:
```go
type KV interface {
    Get(ctx context.Context, key string) (string, error)
    Set(ctx context.Context, key, val string) error
}
```
Write `GuardedKV` that allows `Get` for everyone but only allows `Set` for an admin role taken from `ctx`. Then write `CachingKV` so that `Set` invalidates the cached entry. Stack them: `Guarded(Caching(real))`.

**Acceptance:** non-admin `Set` returns `ErrForbidden`; after an admin `Set`, the next `Get` returns the new value (not stale).

---

## Task 5 (Middle): Get the stack order right
Build `Logging(Guarded(Caching(real)))`. Add a logging proxy that records every method call. Write a test asserting: (a) a denied `Set` is logged, (b) a cache *hit* `Get` is logged (logging is outermost), (c) the real store is not called on a hit. Then swap to `Guarded(Logging(Caching(real)))` and observe what changes in the logs. Explain the difference in a comment.

**Acceptance:** test demonstrates the ordering effect; comment explains it.

---

## Task 6 (Senior): Func-adapter proxy
Reimplement the caching proxy for this single-method interface using the func-adapter idiom (no struct that you hand-write methods on beyond the adapter):
```go
type Fetcher interface { Fetch(url string) ([]byte, error) }
```
Provide `WithCache(next Fetcher) Fetcher` returning a `FetcherFunc`.

**Acceptance:** `WithCache` composes; caching works; no bespoke struct beyond the func adapter.

---

## Task 7 (Senior): Collapse the thundering herd
Take Task 6's caching fetcher. Write a test that launches 100 goroutines fetching the *same* uncached URL simultaneously and asserts the real fetch happens **once**. Achieve this with `golang.org/x/sync/singleflight`.

**Acceptance:** real-fetch counter == 1 despite 100 concurrent misses.

---

## Task 8 (Senior): Expose and defend the boundary
Bound the cache (LRU, capacity 100) and expose `HitRate() float64` and `Size() int`. Write a benchmark comparing direct fetch vs cached fetch at 90% hit rate. In a short note, state at what hit rate the proxy stops paying for itself.

**Acceptance:** LRU evicts beyond 100 entries; benchmark shows the crossover; note explains the break-even hit rate.

---

## Stretch
- Add a metrics/tracing proxy that records per-method latency as a span; verify it adds one span per call and zero behavior change.
- Convert `LazyKV` to handle a fallible factory that retries on the next call after a failure (do not cache the failure).
