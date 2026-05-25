# Proxy — Find the Bug

Each scenario is a Go proxy that looks correct but has a real defect. Find it, explain why it breaks, and fix it.

---

## Bug 1 — Racy cache map

```go
type CachingKV struct {
    real KV
    m    map[string]string
}

func (c *CachingKV) Get(key string) (string, error) {
    if v, ok := c.m[key]; ok {
        return v, nil
    }
    v, err := c.real.Get(key)
    if err != nil {
        return "", err
    }
    c.m[key] = v
    return v, nil
}
```

**Bug:** `c.m` is read and written from multiple goroutines with no lock — a data race; concurrent map access can panic.
**Fix:** guard with a `sync.RWMutex` (RLock for the read, Lock for the write), or use `sync.Map`.

---

## Bug 2 — Stale cache after write

```go
func (c *CachingKV) Set(key, val string) error {
    return c.real.Set(key, val) // cache not touched
}
```

**Bug:** `Set` updates the real store but leaves the old value in the cache. Subsequent `Get` returns stale data.
**Fix:** invalidate or update the cache under the lock: `delete(c.m, key)` (or `c.m[key] = val`) after a successful `Set`.

---

## Bug 3 — Lazy proxy builds eagerly

```go
func NewLazyConn(dsn string) *LazyConn {
    db, _ := sql.Open("postgres", dsn) // built in constructor!
    return &LazyConn{real: db}
}
```

**Bug:** the "virtual" proxy opens the connection in its constructor, defeating the entire point of laziness.
**Fix:** store only the `dsn` and build the real object inside the first method call, guarded by `sync.Once` or a mutex.

---

## Bug 4 — Caching a failure permanently

```go
type lazy struct{ get func() *Client }
func newLazy(dsn string) *lazy {
    return &lazy{get: sync.OnceValue(func() *Client {
        c, err := Dial(dsn)
        if err != nil { panic(err) } // becomes permanent
        return c
    })}
}
```

**Bug:** `sync.OnceValue` caches the panic forever; a transient dial failure makes the proxy unusable for the process lifetime.
**Fix:** use a mutex-guarded getter that returns the error and does **not** store the failure, so the next call retries. Reserve `OnceValue` for "valid at startup or the process is broken."

---

## Bug 5 — Embedding bypasses protection

```go
type guarded struct {
    Store // embedded
    role  func(context.Context) Role
}
func (g guarded) Delete(ctx context.Context, id string) error {
    if g.role(ctx) != Admin { return ErrForbidden }
    return g.Store.Delete(ctx, id)
}
// Later, Store gains a Purge(ctx) method.
```

**Bug:** `guarded` embeds `Store`, so the new `Purge` is auto-forwarded **ungated** — callers can purge without admin rights.
**Fix:** don't embed in a policy proxy; forward every method explicitly so a new interface method fails to compile until you decide its guard.

---

## Bug 6 — Thundering herd on miss

```go
func (c *CachingKV) Get(key string) (string, error) {
    c.mu.RLock(); v, ok := c.m[key]; c.mu.RUnlock()
    if ok { return v, nil }
    v, err := c.real.Get(key) // 100 concurrent misses → 100 backend calls
    if err == nil { c.mu.Lock(); c.m[key] = v; c.mu.Unlock() }
    return v, err
}
```

**Bug:** under a cold cache, N concurrent goroutines for the same key all miss and all call the backend — a stampede.
**Fix:** collapse duplicate in-flight calls with `golang.org/x/sync/singleflight` so one backend call serves all waiters.

---

## Bug 7 — Lost context cancellation

```go
type loggingStore struct{ real Store }
func (l loggingStore) Read(ctx context.Context, id string) (string, error) {
    log.Println("read", id)
    return l.real.Read(context.Background(), id) // dropped ctx!
}
```

**Bug:** the proxy passes `context.Background()` instead of the caller's `ctx`, discarding cancellation and deadlines.
**Fix:** forward the received `ctx` unchanged: `l.real.Read(ctx, id)`.

---

## Bug 8 — Unbounded cache (memory leak)

```go
type CachingKV struct {
    real KV
    mu   sync.Mutex
    m    map[string]string // grows forever
}
```

**Bug:** the cache never evicts; under high-cardinality keys it grows until the process OOMs.
**Fix:** bound it — an LRU with a capacity cap (and optionally TTLs). Expose `Size()` as a metric.

---

## Bug 9 — Caching non-idempotent or error responses

```go
func (c *CachingFetcher) Fetch(url string) ([]byte, error) {
    if v, ok := c.m[url]; ok { return v, nil }
    body, err := c.real.Fetch(url)
    c.m[url] = body // cached even when err != nil, and for non-GET
    return body, err
}
```

**Bug:** it caches even on error (storing a partial/empty body) and ignores method/idempotency, so a transient 500 is served forever.
**Fix:** cache only on success (`err == nil`) and only for idempotent requests; never cache error responses unless deliberately with a short negative-TTL.

---

## How to approach these
1. Ask "what state did the proxy add?" → check its concurrency safety.
2. Ask "what mutates the real subject?" → check cache invalidation.
3. Ask "does control still apply if the interface grows?" → check embedding.
4. Ask "what does `ctx` do here?" → check propagation.
5. Ask "what bounds this?" → check eviction and error caching.
