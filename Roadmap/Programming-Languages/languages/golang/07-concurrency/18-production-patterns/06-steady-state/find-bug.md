---
layout: default
title: Steady-State — Find the Bug
parent: Steady-State
grand_parent: Production Patterns
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/06-steady-state/find-bug/
---

# Steady-State — Find the Bug

[← Back](../)

Each snippet below has a steady-state bug — something that does not crash, does not fail a load test, and only shows up after hours or days of production traffic. Read the snippet, name the bug, and write the fix. The answers are at the end.

## Table of Contents

1. [Bug 1 — Unbounded channel buffer](#bug-1--unbounded-channel-buffer)
2. [Bug 2 — Per-request goroutine, no cap](#bug-2--per-request-goroutine-no-cap)
3. [Bug 3 — Missing `resp.Body.Close`](#bug-3--missing-respbodyclose)
4. [Bug 4 — Slow ticker leak](#bug-4--slow-ticker-leak)
5. [Bug 5 — Map-as-cache, never expiring](#bug-5--map-as-cache-never-expiring)
6. [Bug 6 — `sql.DB` left with default pool size](#bug-6--sqldb-left-with-default-pool-size)
7. [Bug 7 — Tenant semaphore map grows forever](#bug-7--tenant-semaphore-map-grows-forever)
8. [Bug 8 — `time.After` in a select loop](#bug-8--timeafter-in-a-select-loop)
9. [Bug 9 — Hot loop allocating in a tight cycle](#bug-9--hot-loop-allocating-in-a-tight-cycle)
10. [Bug 10 — `GOMEMLIMIT` set after first allocation](#bug-10--gomemlimit-set-after-first-allocation)
11. [Answers](#answers)

---

## Bug 1 — Unbounded channel buffer

```go
type Server struct {
    jobs chan Job
}

func NewServer() *Server {
    return &Server{jobs: make(chan Job, 1<<30)}
}

func (s *Server) Submit(j Job) {
    s.jobs <- j
}

func (s *Server) worker() {
    for j := range s.jobs {
        process(j)
    }
}
```

What is wrong with the buffer of `1<<30`? When does it bite?

---

## Bug 2 — Per-request goroutine, no cap

```go
func handleRequest(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    go func() {
        if err := publishToKafka(body); err != nil {
            log.Println(err)
        }
    }()
    w.WriteHeader(http.StatusAccepted)
}
```

The handler returns immediately and lets Kafka publish in the background. What breaks at scale?

---

## Bug 3 — Missing `resp.Body.Close`

```go
func fetchAll(urls []string) {
    for _, u := range urls {
        resp, err := http.Get(u)
        if err != nil {
            log.Println(err)
            continue
        }
        var data Response
        json.NewDecoder(resp.Body).Decode(&data)
        process(data)
    }
}
```

There is no `resp.Body.Close()` and no `io.Copy(io.Discard, resp.Body)`. What two resources leak?

---

## Bug 4 — Slow ticker leak

```go
func eachRequest(ctx context.Context, do func()) {
    t := time.NewTicker(1 * time.Second)
    for {
        select {
        case <-t.C:
            do()
        case <-ctx.Done():
            return
        }
    }
}
```

It looks fine — the `select` watches `ctx.Done`. What is leaking?

---

## Bug 5 — Map-as-cache, never expiring

```go
type Cache struct {
    mu sync.Mutex
    m  map[string][]byte
}

func (c *Cache) Set(k string, v []byte) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.m[k] = v
}

func (c *Cache) Get(k string) ([]byte, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    v, ok := c.m[k]
    return v, ok
}
```

The cache is correct, fast, and lock-balanced. What is the steady-state problem?

---

## Bug 6 — `sql.DB` left with default pool size

```go
func openDB() *sql.DB {
    db, err := sql.Open("pgx", os.Getenv("DSN"))
    if err != nil {
        log.Fatal(err)
    }
    return db
}
```

This compiles and serves requests. Why does it become a steady-state problem at scale?

---

## Bug 7 — Tenant semaphore map grows forever

```go
type Scheduler struct {
    mu       sync.Mutex
    sems     map[string]*semaphore.Weighted
    perTenant int64
}

func (s *Scheduler) Do(ctx context.Context, tenantID string, fn func()) error {
    s.mu.Lock()
    sem, ok := s.sems[tenantID]
    if !ok {
        sem = semaphore.NewWeighted(s.perTenant)
        s.sems[tenantID] = sem
    }
    s.mu.Unlock()

    if err := sem.Acquire(ctx, 1); err != nil {
        return err
    }
    defer sem.Release(1)
    fn()
    return nil
}
```

Per-tenant isolation works. Why is this still a steady-state bug for any service with rotating tenant IDs?

---

## Bug 8 — `time.After` in a select loop

```go
func wait(ctx context.Context, ch chan Event) {
    for {
        select {
        case e := <-ch:
            handle(e)
        case <-time.After(5 * time.Second):
            heartbeat()
        case <-ctx.Done():
            return
        }
    }
}
```

It looks fine and probably passes tests. Why does it leak under steady-state load?

---

## Bug 9 — Hot loop allocating in a tight cycle

```go
func sumLines(r io.Reader) (int, error) {
    sc := bufio.NewScanner(r)
    n := 0
    for sc.Scan() {
        line := sc.Text()
        parts := strings.Split(line, ",")
        for _, p := range parts {
            x, _ := strconv.Atoi(p)
            n += x
        }
    }
    return n, sc.Err()
}
```

It is correct. Why does it create GC pressure that degrades a long-running service?

---

## Bug 10 — `GOMEMLIMIT` set after first allocation

```go
func main() {
    server := NewServer() // allocates large pools
    debug.SetMemoryLimit(1 << 30)
    log.Fatal(server.ListenAndServe())
}
```

The limit is set. Why does the service still OOM near the limit?

---

## Answers

### Bug 1

The buffer is so large that it is effectively unbounded. Under sustained overload — even a brief one — the buffer accumulates a billion jobs, each holding references to whatever the job carries. The heap grows linearly with the queue depth until OOM. The fix is to pick a real capacity (a small multiple of the worker count, e.g., `4 * workers`) and a shedding policy:

```go
select {
case s.jobs <- j:
default:
    return ErrQueueFull
}
```

### Bug 2

Each request spawns a goroutine. Under burst, ten thousand requests per second produce ten thousand goroutines per second, each doing a TCP write to Kafka. Goroutine count grows until the runtime is starved, and at the same time Kafka producer connections multiply. Fix with a bounded worker pool that pulls from a queue, with a shed-on-full policy.

### Bug 3

Two things leak: the HTTP connection (it cannot return to the keep-alive pool until the body is fully read and closed) and the body's buffer (held by the transport while the response is "still in use"). Always:

```go
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()
```

### Bug 4

The ticker's underlying timer is *not* released until you call `t.Stop()`. The function returns on `ctx.Done`, but the runtime still holds the ticker goroutine alive (it does eventually, via finalizer, but not in a bounded way). In a service that creates these on each request, the ticker leak accumulates. Fix:

```go
t := time.NewTicker(1 * time.Second)
defer t.Stop()
```

### Bug 5

It never deletes. Memory grows monotonically with the number of distinct keys seen. The fix is a bounded cache (LRU, TTL, or both). Use `hashicorp/golang-lru`, `dgraph-io/ristretto`, or your own size-capped implementation.

### Bug 6

`sql.DB` defaults to `MaxOpenConns=0` (unlimited). Under burst, the pool opens as many connections as the load requests; eventually it hits the database's `max_connections` limit and the next request fails with "too many connections" — and even before that, the database's per-connection memory pushes it into swap. Fix:

```go
db.SetMaxOpenConns(25)
db.SetMaxIdleConns(25)
db.SetConnMaxLifetime(30 * time.Minute)
```

### Bug 7

The `sems` map only adds entries; it never removes. In a service with a few hundred long-lived tenants this is fine. In a service where tenant IDs are session IDs, request IDs, or other rotating values, the map grows forever. Fix: TTL eviction of idle tenants, or a fixed-size LRU.

### Bug 8

`time.After` creates a new timer on every select iteration, and the timer is not garbage-collected until the channel either fires or — much later — the runtime collects it. In a hot loop receiving frequently from `ch`, you create thousands of unfired timers per second. Fix: hoist the timer.

```go
t := time.NewTimer(5 * time.Second)
defer t.Stop()
for {
    select {
    case e := <-ch:
        handle(e)
        if !t.Stop() { <-t.C }
        t.Reset(5 * time.Second)
    case <-t.C:
        heartbeat()
        t.Reset(5 * time.Second)
    case <-ctx.Done():
        return
    }
}
```

### Bug 9

`sc.Text()` allocates a new string each iteration. `strings.Split` allocates a new slice. `strconv.Atoi` may allocate for error paths. In a hot loop, this is per-line garbage that the GC must constantly collect. Fix: reuse buffers (`sc.Bytes()`), preallocate the split slice, or scan byte-by-byte. Then run `benchstat` to confirm the GC pause drops.

### Bug 10

`SetMemoryLimit` is honoured from the moment it is set. The `NewServer()` call happens *before* it, so the pools allocate without the runtime knowing about the limit. The GC then sees a heap that is already at the limit at the next cycle and cannot keep up — which is why the service drifts toward OOM despite the limit being "set." Fix: set the limit first, before any user allocation.

```go
func main() {
    debug.SetMemoryLimit(1 << 30)
    server := NewServer()
    log.Fatal(server.ListenAndServe())
}
```

Better still, use `automemlimit` so the limit is derived from the cgroup at process start, before `main` runs.

---

## Bonus bugs

A few harder ones that have shown up in production.

### Bug 11 — The race that only the runtime sees

```go
type Cache struct {
    data atomic.Value // map[string][]byte
}

func (c *Cache) Set(k string, v []byte) {
    old := c.data.Load().(map[string][]byte)
    new := make(map[string][]byte, len(old)+1)
    for k, v := range old {
        new[k] = v
    }
    new[k] = v
    c.data.Store(new)
}

func (c *Cache) Get(k string) ([]byte, bool) {
    m := c.data.Load().(map[string][]byte)
    v, ok := m[k]
    return v, ok
}
```

Looks fine: copy-on-write, atomic swap. Why is this a steady-state bug?

**Answer.** Concurrent `Set` calls each compute a new map from the same `old` snapshot. The last writer wins; updates from concurrent writers are lost. Worse, every `Set` allocates a full copy of the map; under high write rate, allocation pressure spikes and GC CPU climbs. The cache is correct in terms of "no race detector complaints" but is *neither* concurrency-safe nor steady-state friendly. Replace with `sync.Map` for read-mostly workloads, or with a sharded map for write-heavy workloads.

### Bug 12 — The connection that "never returns"

```go
conn, err := db.Conn(ctx)
if err != nil {
    return err
}
defer conn.Close()
if _, err := conn.ExecContext(ctx, "BEGIN"); err != nil {
    return err
}
if err := doWork(ctx, conn); err != nil {
    return err
}
return conn.ExecContext(ctx, "COMMIT").Err()
```

The transaction is implemented manually with `BEGIN`/`COMMIT`. Why is this a steady-state leak?

**Answer.** There is no `ROLLBACK` on error paths. If `doWork` fails, the function returns; `conn.Close()` returns the connection to the pool — but the *Postgres-side* transaction is still open. The pooled connection is now "tainted." When the next caller picks it up and runs a query, the query is implicitly inside the leftover transaction. After many such failures, the database is full of in-progress transactions; locks accumulate; eventually the database refuses new connections. Fix: explicit `ROLLBACK` on every error path. Better: use `database/sql.Tx`, which handles this automatically.

### Bug 13 — The slow-path goroutine

```go
func handle(req Request) Response {
    cached, ok := lookupCache(req)
    if ok {
        return cached
    }
    result := slowComputation(req) // takes seconds
    go cache.Set(req.Key, result)
    return result
}
```

Caching looks correct: cache the slow result, return immediately. Why is this a steady-state bug under burst?

**Answer.** Under a burst of cache misses for distinct keys, the function spawns one goroutine per request to do the cache `Set`. Goroutine count grows during the burst, then settles back. That's fine in isolation. But if `cache.Set` is slow (e.g., it talks to a remote Redis), and the burst is sustained, the goroutines accumulate. The function returns quickly, but the background goroutines pile up. Use a worker pool for the cache writes; or do the cache `Set` synchronously after returning the result (e.g., flush in a `defer`).

### Bug 14 — The closure that holds everything

```go
type LargeStruct struct { /* 10 MB of data */ }

func process(large *LargeStruct) {
    small := large.Tag
    go func() {
        time.Sleep(1 * time.Hour)
        log.Println("delayed log:", small)
    }()
}
```

A `LargeStruct` of ten MiB is processed; a small string is logged after one hour. What is the steady-state issue?

**Answer.** The goroutine closure captures `small`, but `small` was created by `large.Tag`. Depending on how `Tag` is defined, the closure may keep a reference to the entire `LargeStruct` via the string's underlying byte array (if `Tag` is a substring). The GC cannot reclaim `large` until the goroutine finishes — one hour later. Multiply by request rate. Fix: explicitly copy the string with `string([]byte(small))`, or restructure the closure to not need a reference at all.

### Bug 15 — The timer that was never started

```go
func withTimeout(d time.Duration, fn func() error) error {
    t := time.NewTimer(d)
    errCh := make(chan error, 1)
    go func() { errCh <- fn() }()
    select {
    case err := <-errCh:
        // don't stop the timer
        return err
    case <-t.C:
        return ErrTimeout
    }
}
```

Looks like a timeout wrapper. Why is this a steady-state leak?

**Answer.** When `fn` returns before the timer, the timer is left to fire on its own. Each call leaks one timer. Over time, the runtime's timer heap fills with un-stopped timers. Memory grows, and timer-fire CPU rises. Fix: `defer t.Stop()` immediately after creating the timer.

```go
t := time.NewTimer(d)
defer t.Stop()
```

---

## Patterns these bugs share

A few themes emerge:

1. **Per-request resource without a cap.** Bugs 1, 2, 5, 11.
2. **Missing pairing for resource lifecycle.** Bugs 3, 4, 7, 8, 12, 15.
3. **Closure or capture holding more than intended.** Bug 14.
4. **Order-of-operations bug (e.g., set limit before allocation).** Bug 10.

The remedy is the same for all of them: name the resource, name its bound, name the metric that detects when it is exceeded. If any of those is missing, you have a candidate steady-state bug.

---

## How to use this page

Treat this page as a sparring partner. Read a snippet, decide what is wrong, then read the answer. Time yourself: a senior engineer should diagnose each one in under thirty seconds. A junior might take five minutes per snippet. The skill is *fingerprint recognition*: seeing the bug-shape before reading the details.

For team training, schedule a one-hour session where each engineer reads one bug aloud, the team diagnoses it together, and an instructor confirms the answer. Repeat monthly with new bugs collected from real post-mortems.

---

## Where to find more buggy code

The bugs above are stylised. Real production code has its own patterns. For more practice:

- **Your own post-mortems.** Every incident is a learning opportunity. Anonymise and share.
- **Public post-mortems.** GitHub's, Cloudflare's, Stripe's, Discord's. Most have a "Go" section or describe Go services.
- **Open-source issue trackers.** Search for "memory leak" or "goroutine leak" in popular Go projects. Read the diffs.
- **The Go runtime issue tracker.** When the Go team finds a leak in the runtime, the fix is illustrative.
- **The `golangci-lint` rule set.** Each lint rule corresponds to a class of bug; the rule documentation explains why.

The more buggy code you read, the better your fingerprint recognition. Senior engineers can identify the type of bug from the failure mode in seconds; that comes from years of pattern matching.

---

## A note on collaboration

Code reviews are the best place to catch steady-state bugs *before* they ship. A reviewer who looks for:

- Every `make(chan` with no capacity (or a large capacity).
- Every `go func` without an obvious exit condition.
- Every `Open` or `Acquire` without a paired `Close` or `Release`.
- Every `db.Query`, `client.Do`, `os.Open` for missing error or close handling.
- Every long-lived map or slice that grows over time.

…will catch ninety percent of steady-state bugs before they reach production. Build the review habit; it pays back.
