---
layout: default
title: Find the Bug
parent: Copy-on-Write
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/05-copy-on-write/find-bug/
---

# Copy-on-Write — Find the Bug

> Each snippet contains a real concurrency bug: a mutation-after-publish, a lost update, a leak, a type panic, or a misuse of an atomic primitive. Find it, explain it, fix it.

---

## Bug 1 — Mutation after publish

```go
type Config struct {
    Hosts []string
}

var cfg atomic.Pointer[Config]

func init() {
    cfg.Store(&Config{Hosts: []string{"a"}})
}

func AddHost(h string) {
    old := cfg.Load()
    next := *old
    next.Hosts = append(next.Hosts, h) // BUG
    cfg.Store(&next)
}
```

**Bug.** `next.Hosts` is a slice that shares its backing array with `old.Hosts`. If `old.Hosts` had spare capacity, `append` writes into that shared array, mutating data that in-flight readers are using. The race detector catches this immediately under concurrent load.

**Fix.** Allocate a fresh backing array:

```go
next.Hosts = append([]string(nil), old.Hosts...)
next.Hosts = append(next.Hosts, h)
```

The first append creates a new backing array; the second is safe.

---

## Bug 2 — Lost update without writer mutex

```go
var cfg atomic.Pointer[Counters]

type Counters struct {
    Requests int64
    Errors   int64
}

func RecordRequest() {
    old := cfg.Load()
    next := *old
    next.Requests++
    cfg.Store(&next)
}

func RecordError() {
    old := cfg.Load()
    next := *old
    next.Errors++
    cfg.Store(&next)
}
```

**Bug.** Two goroutines calling these functions simultaneously can lose updates. Both Load the same snapshot, each modifies a different field, but each `Store` overwrites the other's snapshot.

**Fix.** Either use a writer mutex:

```go
var mu sync.Mutex

func RecordRequest() {
    mu.Lock()
    defer mu.Unlock()
    old := cfg.Load()
    next := *old
    next.Requests++
    cfg.Store(&next)
}
```

Or use atomic primitives directly on the fields:

```go
type Counters struct {
    Requests atomic.Int64
    Errors   atomic.Int64
}

// then use:
counters.Requests.Add(1)
```

(But note: with atomic fields, the snapshot itself is no longer truly immutable.)

---

## Bug 3 — atomic.Value type mismatch

```go
var v atomic.Value

func init() {
    v.Store(&Config{Hosts: []string{"a"}})
}

func SetTimeout(t time.Duration) {
    v.Store(Timeout{Value: t}) // BUG: panic
}
```

**Bug.** `atomic.Value` requires all `Store` calls to use the same concrete dynamic type. `*Config` and `Timeout` are different types — the second `Store` panics with "store of inconsistently typed value into Value."

**Fix.** Combine both fields into one snapshot type:

```go
type Snapshot struct {
    Hosts   []string
    Timeout time.Duration
}

var v atomic.Value

func init() {
    v.Store(&Snapshot{Hosts: []string{"a"}, Timeout: 5 * time.Second})
}

func SetTimeout(t time.Duration) {
    old := v.Load().(*Snapshot)
    next := *old
    next.Timeout = t
    v.Store(&next)
}
```

Or, better, use `atomic.Pointer[Snapshot]` (Go 1.19+) which catches type errors at compile time.

---

## Bug 4 — Mutex held during slow I/O

```go
func Reload(path string) error {
    mu.Lock()
    defer mu.Unlock()
    data, err := os.ReadFile(path) // could take 100ms
    if err != nil { return err }
    var next Config
    if err := json.Unmarshal(data, &next); err != nil { return err }
    cfg.Store(&next)
    return nil
}
```

**Bug.** The mutex is held during slow file I/O. Other writers wait for up to the I/O duration. If `Reload` is called concurrently from multiple sources (signal handler, poll loop, admin endpoint), they queue up.

**Fix.** Do I/O outside the lock:

```go
func Reload(path string) error {
    data, err := os.ReadFile(path)
    if err != nil { return err }
    var next Config
    if err := json.Unmarshal(data, &next); err != nil { return err }
    mu.Lock()
    defer mu.Unlock()
    cfg.Store(&next)
    return nil
}
```

Note: this changes the semantics slightly — if you need read-modify-write atomic across the I/O (e.g., to base on the latest version), keep the lock held but accept the cost.

---

## Bug 5 — Forgetting to copy the map

```go
type Config struct {
    Endpoints map[string]string
}

var cfg atomic.Pointer[Config]
var mu sync.Mutex

func SetEndpoint(name, url string) {
    mu.Lock()
    defer mu.Unlock()
    old := cfg.Load()
    next := *old
    next.Endpoints[name] = url // BUG: mutates old.Endpoints
    cfg.Store(&next)
}
```

**Bug.** Maps are reference types. `next.Endpoints` and `old.Endpoints` point at the same map. Setting `next.Endpoints[name]` mutates the published snapshot's map — a data race with any reader iterating it.

**Fix.** Allocate a fresh map:

```go
next.Endpoints = make(map[string]string, len(old.Endpoints)+1)
for k, v := range old.Endpoints {
    next.Endpoints[k] = v
}
next.Endpoints[name] = url
```

---

## Bug 6 — Two Loads in one expression

```go
func ShouldRetry() bool {
    c := cfg.Load()
    return c.MaxRetries > 0 && cfg.Load().Backoff > 0
}
```

**Bug.** Two `Load` calls. A `Store` between them gives mixed-snapshot semantics: `MaxRetries` from snapshot v1, `Backoff` from snapshot v2.

**Fix.** Single Load, cached:

```go
func ShouldRetry() bool {
    c := cfg.Load()
    return c.MaxRetries > 0 && c.Backoff > 0
}
```

---

## Bug 7 — Watcher with infinite loop

```go
type Store struct {
    cur  atomic.Pointer[Config]
    chs  []chan *Config
    mu   sync.Mutex
}

func (s *Store) Update(c *Config) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.cur.Store(c)
    for _, ch := range s.chs {
        ch <- c // BUG: blocks if subscriber is slow
    }
}
```

**Bug.** Synchronous send to a channel. If any subscriber's channel is full or unread, the writer blocks indefinitely while holding the mutex. All other writers wait too.

**Fix.** Non-blocking send with drop:

```go
for _, ch := range s.chs {
    select {
    case ch <- c:
    default:
        // subscriber slow; drop
    }
}
```

Or asynchronous dispatch:

```go
for _, ch := range s.chs {
    go func(ch chan *Config) {
        ch <- c
    }(ch)
}
```

Both have trade-offs. Drop is simpler; goroutine is more reliable but may stack.

---

## Bug 8 — Nil initial snapshot

```go
var cfg atomic.Pointer[Config]

func GetTimeout() time.Duration {
    return cfg.Load().Timeout // panic if no Store happened
}

func init() {
    // forgot to Store an initial snapshot!
}
```

**Bug.** `cfg.Load()` returns nil because nothing was ever stored. The dereference panics.

**Fix.** Always store an initial value:

```go
func init() {
    cfg.Store(&Config{Timeout: 5 * time.Second})
}
```

Or defensive accessor:

```go
func GetTimeout() time.Duration {
    c := cfg.Load()
    if c == nil { return defaultTimeout }
    return c.Timeout
}
```

---

## Bug 9 — Snapshot leaked into a forever-running goroutine

```go
func StartProcessor(s *Store) {
    snap := s.Get()
    go func() {
        for {
            process(snap) // never re-loads
            time.Sleep(time.Second)
        }
    }()
}
```

**Bug.** The goroutine holds `snap` forever. Subsequent updates are invisible to it. The pinned snapshot prevents GC; if many updates have happened, memory grows.

**Fix.** Re-load periodically:

```go
go func() {
    for {
        snap := s.Get() // re-load each iteration
        process(snap)
        time.Sleep(time.Second)
    }
}()
```

---

## Bug 10 — Returning a snapshot's mutable map by reference

```go
type Store struct {
    cur atomic.Pointer[Config]
}

func (s *Store) Endpoints() map[string]string {
    return s.cur.Load().Endpoints // BUG: caller can mutate
}
```

**Bug.** The caller receives a map they can mutate. Any modification breaks the snapshot's immutability and races with other readers.

**Fix.** Return a defensive copy:

```go
func (s *Store) Endpoints() map[string]string {
    src := s.cur.Load().Endpoints
    out := make(map[string]string, len(src))
    for k, v := range src {
        out[k] = v
    }
    return out
}
```

Or expose a lookup method instead:

```go
func (s *Store) Endpoint(name string) (string, bool) {
    v, ok := s.cur.Load().Endpoints[name]
    return v, ok
}
```

---

## Bug 11 — Update method that calls itself recursively

```go
func (s *Store) UpdateAndNotify(fn func(*Config)) {
    s.mu.Lock()
    defer s.mu.Unlock()
    old := s.cur.Load()
    next := *old
    fn(&next)
    s.cur.Store(&next)
    s.notifyWatchers(&next) // BUG: notifies under mutex
}

func (s *Store) notifyWatchers(c *Config) {
    for _, w := range s.watchers {
        w(c) // watcher may call Update, deadlocking
    }
}
```

**Bug.** Watchers are called while holding the writer mutex. If a watcher's handler calls `Update`, it self-deadlocks on the same mutex.

**Fix.** Either dispatch watchers asynchronously:

```go
for _, w := range s.watchers {
    go w(c)
}
```

Or copy the watcher list and call outside the lock:

```go
func (s *Store) UpdateAndNotify(fn func(*Config)) {
    s.mu.Lock()
    old := s.cur.Load()
    next := *old
    fn(&next)
    s.cur.Store(&next)
    watchers := append([]Watcher(nil), s.watchers...)
    s.mu.Unlock()
    for _, w := range watchers {
        w(&next)
    }
}
```

---

## Bug 12 — CAS without retry

```go
func IncrementVersion() {
    old := cfg.Load()
    next := *old
    next.Version++
    cfg.CompareAndSwap(old, &next) // BUG: ignores return
}
```

**Bug.** CAS may fail if another writer interleaved. The function silently doesn't update if so. The caller has no idea.

**Fix.** Retry on failure:

```go
func IncrementVersion() {
    for {
        old := cfg.Load()
        next := *old
        next.Version++
        if cfg.CompareAndSwap(old, &next) {
            return
        }
    }
}
```

---

## Bug 13 — Subscriber that never unsubscribes

```go
func StartFeatureWatcher(s *Store) {
    ch := s.Subscribe()
    go func() {
        for c := range ch {
            updateFeatures(c)
        }
    }()
    // forgot to call unsubscribe
}
```

**Bug.** The subscriber goroutine runs forever, and `s.watchers` grows. Memory leak. Every Update walks an ever-larger watcher list.

**Fix.** Wire unsubscribe to a stop signal:

```go
func StartFeatureWatcher(ctx context.Context, s *Store) {
    ch, unsub := s.Subscribe()
    go func() {
        defer unsub()
        for {
            select {
            case c := <-ch:
                updateFeatures(c)
            case <-ctx.Done():
                return
            }
        }
    }()
}
```

---

## Bug 14 — Snapshot used after closed channel

```go
type Store struct {
    cur atomic.Pointer[Config]
    ch  chan struct{}
}

func (s *Store) Publish(c *Config) {
    s.cur.Store(c)
    close(s.ch)
}

func (s *Store) Wait() *Config {
    <-s.ch          // wait for publish
    return s.cur.Load()
}
```

**Bug.** `close(s.ch)` can only be called once. A second `Publish` panics.

**Fix.** Replace the channel atomically too:

```go
type Store struct {
    cur atomic.Pointer[Config]
    ch  atomic.Pointer[chan struct{}]
}

func (s *Store) Publish(c *Config) {
    old := s.ch.Load()
    next := make(chan struct{})
    s.ch.Store(&next)
    s.cur.Store(c)
    close(*old)
}
```

---

## Bug 15 — Mutating a snapshot returned from another function

```go
func tweakConfig(c *Config) {
    c.Hosts = append(c.Hosts, "x") // BUG: mutates shared snapshot
}

func handler() {
    c := store.Get()
    tweakConfig(c)
}
```

**Bug.** `tweakConfig` mutates the snapshot it was passed. If `c` is the current snapshot, this corrupts shared state.

**Fix.** Pass a copy or rebuild via Update:

```go
func handler() {
    store.Update(func(c *Config) {
        c.Hosts = append([]string(nil), c.Hosts...)
        c.Hosts = append(c.Hosts, "x")
    })
}
```

The `Update` builds a fresh snapshot; tweakConfig becomes safe.

---

## Bug 16 — Store followed by Load expecting freshness

```go
func ApplyAndCheck() {
    store.Update(func(c *Config) { c.Enabled = true })
    if !store.Get().Enabled {
        log.Println("update did not take effect")
    }
}
```

**Bug.** Probably no bug, but tricky. If another goroutine `Update`s between Update and Get, Get may not see Enabled=true. The "check" is racy.

**Fix.** Either capture the result of Update or accept that another writer may have changed it:

```go
func ApplyAndCheck() {
    store.Update(func(c *Config) { c.Enabled = true })
    // accept that another writer may have flipped it; don't check
}
```

Or use a stronger primitive that returns the result:

```go
result := store.UpdateAndReturn(func(c *Config) *Config {
    next := *c
    next.Enabled = true
    return &next
})
if !result.Enabled { /* impossible */ }
```

---

## Bug 17 — Re-using a snapshot pointer

```go
func ToggleFeature(name string) {
    mu.Lock()
    defer mu.Unlock()
    c := cfg.Load()
    c.Features[name] = !c.Features[name] // BUG: mutates published snapshot
    cfg.Store(c)                          // re-publishes mutated snapshot
}
```

**Bug.** Two errors:
1. `c.Features[name] = ...` mutates the published snapshot's map.
2. `cfg.Store(c)` re-publishes the same pointer — confusing for consumers comparing pointers for change.

**Fix.** Build a fresh snapshot:

```go
func ToggleFeature(name string) {
    mu.Lock()
    defer mu.Unlock()
    old := cfg.Load()
    next := *old
    next.Features = make(map[string]bool, len(old.Features))
    for k, v := range old.Features {
        next.Features[k] = v
    }
    next.Features[name] = !next.Features[name]
    cfg.Store(&next)
}
```

---

## Bug 18 — Comparing snapshots by value

```go
func HasConfigChanged(prev *Config) bool {
    return *cfg.Load() != *prev // BUG: maps aren't comparable
}
```

**Bug.** If Config contains a map or slice, value comparison doesn't compile. If Config has only comparable fields, it works but is slow and semantically dubious.

**Fix.** Compare by pointer identity:

```go
func HasConfigChanged(prev *Config) bool {
    return cfg.Load() != prev
}
```

Or use a version field:

```go
func HasConfigChanged(prevVersion int64) (bool, int64) {
    cur := cfg.Load().Version
    return cur != prevVersion, cur
}
```

---

## Bug 19 — Hot-loop with many Loads

```go
func Process() {
    for i := 0; i < 1000000; i++ {
        if cfg.Load().Enabled {
            doWork(cfg.Load().Param)
        }
    }
}
```

**Bug.** Two `Load`s per iteration. Per-call ~1.5 ns × 2M = 3 ms wasted. Also, two snapshots may be different if updates happen.

**Fix.** Load once at top:

```go
func Process() {
    c := cfg.Load()
    for i := 0; i < 1000000; i++ {
        if c.Enabled {
            doWork(c.Param)
        }
    }
}
```

---

## Bug 20 — Multiple atomic pointers without atomic update

```go
var configA atomic.Pointer[A]
var configB atomic.Pointer[B]

func UpdateBoth(a *A, b *B) {
    configA.Store(a)
    configB.Store(b) // BUG: not atomic with above
}
```

**Bug.** A reader between the two Stores sees new A + old B. The two stores are independently atomic but not joint-atomic.

**Fix.** Combine into one snapshot:

```go
type AB struct {
    A *A
    B *B
}

var combined atomic.Pointer[AB]

func UpdateBoth(a *A, b *B) {
    combined.Store(&AB{A: a, B: b})
}
```

---

## Tips for Finding COW Bugs

1. **Run with the race detector.** Mutation-after-publish surfaces immediately.
2. **Look for `next.X` where X is a slice or map.** Probable shared-storage bug.
3. **Check that writers are serialized.** Two writers without a mutex = lost updates.
4. **Verify deep copy.** Slice deep copy = `append([]T(nil), src...)`. Map = explicit loop.
5. **Look for multiple Loads in one logical operation.** Should be one Load + local variable.
6. **Check for nil Load.** Always Store an initial snapshot.
7. **Test goroutine count over time.** Growing count = leaked subscribers or pinned snapshots.
8. **Use pprof for heap analysis.** Many old-version snapshots alive = pinning.

---

## Closing

20 bugs covering the main classes of COW errors. Most production COW failures are variations of these. Internalize the patterns; recognize them in code review.

Good debugging.
