# sync.Map — Find the Bug

> Each section presents a snippet of plausible-looking Go code, asks "what is wrong?" and gives the answer plus a fix. Read the snippet first, hypothesize, then check.

---

## Bug 1 — The classic concurrent write

```go
package main

import "sync"

var counters = map[string]int{}

func Hit(name string) {
    counters[name]++
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); Hit("page") }()
    }
    wg.Wait()
}
```

**What is wrong?**

`counters` is a plain map. `Hit` writes to it from 100 goroutines. The runtime aborts with `fatal error: concurrent map writes`.

**Fix**: either wrap `counters` in a `sync.RWMutex`, or use `sync.Map` with `CompareAndSwap`, or — best for a counter — use `atomic.Int64`:

```go
var counter atomic.Int64
func Hit() { counter.Add(1) }
```

If you really want per-name counters, a `sync.Map[string]*atomic.Int64` works:

```go
var counters sync.Map // map[string]*atomic.Int64
func Hit(name string) {
    v, _ := counters.LoadOrStore(name, new(atomic.Int64))
    v.(*atomic.Int64).Add(1)
}
```

---

## Bug 2 — `sync.Map` as an unsafe replacement

```go
var users sync.Map

func Set(id int, name string) {
    users.Store(id, name)
}

func Get(id int) string {
    v, _ := users.Load(id)
    return v.(string)
}
```

**What is wrong?**

If `Get` is called with an id that was never stored, `v` is `nil`. `nil.(string)` panics: "interface conversion: interface {} is nil, not string."

**Fix**: check `ok` from `Load`:

```go
func Get(id int) (string, bool) {
    v, ok := users.Load(id)
    if !ok {
        return "", false
    }
    return v.(string), true
}
```

Always propagate `ok` to the caller. Never type-assert without comma-ok unless you have *guaranteed* the type.

---

## Bug 3 — Lost update via `Load` + `Store`

```go
var m sync.Map

func Inc(key string) {
    v, _ := m.LoadOrStore(key, 0)
    m.Store(key, v.(int)+1)
}
```

**What is wrong?**

Between `LoadOrStore` and `Store`, another goroutine may also load the same value, increment, and store. Both stores write the same `v+1`. One increment is lost.

**Fix**: `CompareAndSwap` retry loop (Go 1.20+):

```go
func Inc(key string) {
    for {
        v, _ := m.LoadOrStore(key, 0)
        if m.CompareAndSwap(key, v, v.(int)+1) {
            return
        }
    }
}
```

Or, for a single global counter, `atomic.Int64`:

```go
var counter atomic.Int64
func Inc() { counter.Add(1) }
```

---

## Bug 4 — Copying a `sync.Map`

```go
type Cache struct {
    m sync.Map
}

func (c Cache) Get(k string) (any, bool) {
    return c.m.Load(k)
}
```

**What is wrong?**

`Get` has a value receiver. Calling it copies `Cache`, which copies the embedded `sync.Map`. `go vet` warns: `Get passes lock by value: Cache contains sync.Map contains sync.Mutex`.

**Fix**: use a pointer receiver:

```go
func (c *Cache) Get(k string) (any, bool) { ... }
```

This applies to all `sync` types. Always pass them by pointer.

---

## Bug 5 — `Range` for an atomic snapshot

```go
func Snapshot(m *sync.Map) []string {
    var keys []string
    m.Range(func(k, _ any) bool {
        keys = append(keys, k.(string))
        return true
    })
    return keys
}

// Caller
keys := Snapshot(m)
for _, k := range keys {
    v, _ := m.Load(k)
    fmt.Println(k, v)
}
```

**What is wrong?**

The "snapshot" is not atomic. A key in `keys` may have been deleted between the `Range` and the `Load`. The second-loop `Load` returns `ok == false`, and the code does not handle that case.

Worse: the snapshot itself may be inconsistent — keys inserted during `Range` may or may not appear; the order is unspecified.

**Fix**: handle the missing case, or use a different data structure if you truly need a snapshot:

```go
for _, k := range keys {
    if v, ok := m.Load(k); ok {
        fmt.Println(k, v)
    }
}
```

For a real atomic snapshot, use `RWMutex + map`:

```go
type Snap struct {
    mu sync.RWMutex
    m  map[string]any
}

func (s *Snap) Snapshot() map[string]any {
    s.mu.RLock()
    defer s.mu.RUnlock()
    out := make(map[string]any, len(s.m))
    for k, v := range s.m {
        out[k] = v
    }
    return out
}
```

---

## Bug 6 — Storing the wrong type

```go
var cache sync.Map

func Set(k string, v int) {
    cache.Store(k, v)
}

func GetStr(k string) string {
    v, _ := cache.Load(k)
    return v.(string)
}
```

**What is wrong?**

`Set` stores an `int`. `GetStr` type-asserts to `string`. Panic: "interface conversion: int is not string."

**Fix**: type-safe wrapper, or rename to make the type obvious:

```go
type IntMap struct { m sync.Map }
func (im *IntMap) Set(k string, v int) { im.m.Store(k, v) }
func (im *IntMap) Get(k string) (int, bool) {
    v, ok := im.m.Load(k)
    if !ok { return 0, false }
    return v.(int), true
}
```

Better: a generic wrapper (see tasks.md Task 7).

---

## Bug 7 — Slice as a key

```go
var m sync.Map
m.Store([]byte("hello"), 1)
```

**What is wrong?**

Slices are not comparable in Go. `sync.Map` uses the slice as a hash key, which panics: `runtime error: hash of unhashable type []uint8`.

**Fix**: convert to string:

```go
m.Store(string([]byte("hello")), 1)
```

`string([]byte)` and `string(rune)` allocations are unfortunately required. For high-throughput code, consider hashing the bytes yourself and using the hash as the key, then verifying the full bytes on `Load`.

---

## Bug 8 — `close` on a missing channel after `LoadAndDelete`

```go
var subs sync.Map // map[string]chan Event

func Subscribe(id string) chan Event {
    ch := make(chan Event, 16)
    subs.Store(id, ch)
    return ch
}

func Unsubscribe(id string) {
    v, _ := subs.LoadAndDelete(id)
    close(v.(chan Event)) // panic if Unsubscribe called twice
}
```

**What is wrong?**

If `Unsubscribe(id)` is called twice, the second call gets `(nil, false)` from `LoadAndDelete`. The `v.(chan Event)` panics on nil-to-channel assertion. Even if you check `ok`, calling `close` twice would panic with `close of closed channel`.

**Fix**:

```go
func Unsubscribe(id string) {
    v, ok := subs.LoadAndDelete(id)
    if !ok {
        return
    }
    close(v.(chan Event))
}
```

The atomicity of `LoadAndDelete` guarantees only one caller successfully closes.

---

## Bug 9 — Read-then-Range race

```go
var workers sync.Map // map[int]*Worker

func ShutdownAll() {
    workers.Range(func(_, v any) bool {
        v.(*Worker).Stop()
        return true
    })
}
```

**What is wrong?**

If `Stop()` removes the worker from `workers` (via `workers.Delete(id)`), it modifies the map during iteration. Behaviour is implementation-defined; the same worker may be visited again with a stale pointer, or some workers may be skipped.

**Fix**: collect first, then act:

```go
func ShutdownAll() {
    var ws []*Worker
    workers.Range(func(_, v any) bool {
        ws = append(ws, v.(*Worker))
        return true
    })
    for _, w := range ws {
        w.Stop()
    }
}
```

Side effects of the callback should not modify the map being iterated.

---

## Bug 10 — Forgetting `sync.Map` has no `Len`

```go
var sessions sync.Map

func ActiveCount() int {
    return len(sessions) // compile error
}
```

**What is wrong?**

`sync.Map` is not a built-in map. `len` does not apply. Even `Range`-and-count is inconsistent because the count changes between visits.

**Fix**: track count externally with `atomic.Int64`:

```go
type SessionStore struct {
    m sync.Map
    n atomic.Int64
}

func (s *SessionStore) Add(id string, sess *Session) {
    if _, loaded := s.m.LoadOrStore(id, sess); !loaded {
        s.n.Add(1)
    }
}

func (s *SessionStore) Remove(id string) {
    if _, loaded := s.m.LoadAndDelete(id); loaded {
        s.n.Add(-1)
    }
}

func (s *SessionStore) Count() int64 { return s.n.Load() }
```

---

## Bug 11 — `LoadOrStore` evaluating expensive args

```go
var cache sync.Map

func Get(k string) *Entry {
    actual, _ := cache.LoadOrStore(k, slowCompute(k))
    return actual.(*Entry)
}
```

**What is wrong?**

`slowCompute(k)` is *always* called, even if `k` already exists. Go evaluates function arguments eagerly. The expensive computation is wasted on cache hits.

**Fix**: check first with `Load`, fall back to `LoadOrStore`:

```go
func Get(k string) *Entry {
    if v, ok := cache.Load(k); ok {
        return v.(*Entry)
    }
    actual, _ := cache.LoadOrStore(k, slowCompute(k))
    return actual.(*Entry)
}
```

Even better: combine with `singleflight` so multiple cache-miss goroutines do not all compute (tasks.md Task 8).

---

## Bug 12 — Goroutine leak via channel of unknown size

```go
type Bus struct {
    subs sync.Map // map[string]chan Event
}

func (b *Bus) Publish(e Event) {
    b.subs.Range(func(_, v any) bool {
        v.(chan Event) <- e // may block forever
        return true
    })
}
```

**What is wrong?**

If a subscriber is slow or absent (already shut down but not yet removed), the send blocks. The publisher's goroutine hangs forever. All subsequent publishes pile up behind it.

**Fix**: use a buffered channel and a non-blocking send:

```go
func (b *Bus) Publish(e Event) {
    b.subs.Range(func(_, v any) bool {
        select {
        case v.(chan Event) <- e:
        default:
            // subscriber too slow; drop or log
        }
        return true
    })
}
```

Or use a different fan-out structure (atomic.Pointer to a slice of subscribers, batched per-subscriber goroutines).

---

## Bug 13 — Comparing non-comparable values in CAS

```go
var configs sync.Map

func Update(key string, old, new []string) bool {
    return configs.CompareAndSwap(key, old, new)
}
```

**What is wrong?**

`[]string` is not comparable. The `CompareAndSwap` call panics: "runtime error: comparing uncomparable type []string."

**Fix**: store pointers instead, or hash:

```go
type Config struct {
    Items []string
    rev   int
}

func Update(key string, old, new *Config) bool {
    return configs.CompareAndSwap(key, old, new) // pointer comparison
}
```

Pointer comparison is fast and meaningful: same pointer means same configuration.

---

## Bug 14 — Mistaking "set if absent" semantics

```go
var inflight sync.Map

func Begin(id string) bool {
    _, loaded := inflight.LoadOrStore(id, true)
    return !loaded
}
```

The intent is "return true if I successfully claimed `id`, false if someone else already has it." That works.

```go
func End(id string) {
    inflight.Store(id, false)
}
```

**What is wrong?**

`End` stores `false` instead of deleting. The next `Begin` sees `id` already present (with value `false`) and returns `false` — the caller cannot start a new operation.

**Fix**:

```go
func End(id string) {
    inflight.Delete(id)
}
```

If you want to distinguish "in progress" from "completed," store an explicit state enum and use `CompareAndSwap`.

---

## Bug 15 — Map of mutable structs

```go
type User struct {
    Name string
    Hits int
}

var users sync.Map

func Bump(id string) {
    v, _ := users.Load(id)
    u := v.(*User)
    u.Hits++ // RACE
}
```

**What is wrong?**

`sync.Map` makes the map safe. It does not make the *values* safe. Two goroutines calling `Bump` for the same `id` race on `u.Hits`.

**Fix**: use an atomic field, or store immutable values and replace via `CompareAndSwap`:

```go
type User struct {
    Name string
    Hits atomic.Int64
}

func Bump(id string) {
    v, _ := users.Load(id)
    v.(*User).Hits.Add(1)
}
```

Or:

```go
for {
    v, _ := users.Load(id)
    old := v.(*User)
    next := *old // copy
    next.Hits++
    if users.CompareAndSwap(id, v, &next) {
        return
    }
}
```

The CAS pattern stores a *new* pointer each time, preserving immutability of each version. Slower but compositional.

---

## Bug 16 — `Range` callback that calls `Range`

```go
m.Range(func(k1, _ any) bool {
    m.Range(func(k2, _ any) bool {
        if k1 == k2 {
            fmt.Println("self", k1)
        }
        return true
    })
    return true
})
```

**What is wrong?**

Re-entering `Range` is permitted, but its interaction with the outer iteration is implementation-defined. The behaviour may change between Go versions. You may visit some keys more than once across the two loops, or miss interactions you assumed.

**Fix**: collect once, then iterate the slice:

```go
var keys []any
m.Range(func(k, _ any) bool { keys = append(keys, k); return true })
for _, k := range keys {
    // ...
}
```

---

## Bug 17 — Treating `sync.Map` as ordered

```go
var ordered sync.Map
ordered.Store(3, "c")
ordered.Store(1, "a")
ordered.Store(2, "b")

ordered.Range(func(k, v any) bool {
    fmt.Println(k, v)
    return true
})
```

The author expects `1 a / 2 b / 3 c`.

**What is wrong?**

`sync.Map` has no order, just like the built-in map. The output is unspecified.

**Fix**: collect into a slice, sort, then print:

```go
type kv struct{ k int; v string }
var kvs []kv
ordered.Range(func(k, v any) bool {
    kvs = append(kvs, kv{k.(int), v.(string)})
    return true
})
sort.Slice(kvs, func(i, j int) bool { return kvs[i].k < kvs[j].k })
for _, p := range kvs {
    fmt.Println(p.k, p.v)
}
```

If ordering is critical to your design, use a sorted slice or a tree instead.

---

## Bug 18 — Forgetting that `Delete` does not return the old value

```go
func Pop(key string) (any, bool) {
    v, ok := cache.Load(key)
    if !ok {
        return nil, false
    }
    cache.Delete(key)
    return v, true
}
```

**What is wrong?**

Between `Load` and `Delete`, another goroutine may delete and re-insert a *different* value. Your `Delete` removes the new value; your return reports the old. Worse, the new value is lost.

**Fix**: `LoadAndDelete`:

```go
func Pop(key string) (any, bool) {
    return cache.LoadAndDelete(key)
}
```

Atomic. No race window.

---

## Bug 19 — Map keys that float

```go
var m sync.Map
m.Store(0.1+0.2, "result")
v, ok := m.Load(0.3)
fmt.Println(v, ok) // <nil> false
```

**What is wrong?**

`0.1 + 0.2 != 0.3` in IEEE 754. The map key is `0.30000000000000004`. Looking up `0.3` misses.

**Fix**: round or quantise float keys, or do not use floats as keys. Use a tolerance-aware lookup if you must:

```go
func FuzzyLoad(m *sync.Map, f float64, eps float64) (any, bool) {
    var found any
    var ok bool
    m.Range(func(k, v any) bool {
        if math.Abs(k.(float64)-f) < eps {
            found, ok = v, true
            return false
        }
        return true
    })
    return found, ok
}
```

This is O(n). Float keys are usually a design smell.

---

## Bug 20 — Closing the entry's data while still in the map

```go
var conns sync.Map

func RemoveAndClose(id string) {
    if v, ok := conns.Load(id); ok {
        v.(*Conn).Close() // CLOSE before delete
        conns.Delete(id)
    }
}
```

**What is wrong?**

Between `Close` and `Delete`, another goroutine may `Load` the entry and use it. They get a closed connection.

**Fix**: delete first, then close:

```go
func RemoveAndClose(id string) {
    if v, ok := conns.LoadAndDelete(id); ok {
        v.(*Conn).Close()
    }
}
```

`LoadAndDelete` makes the entry invisible to others before you act on it.

---

## Bug 21 — Using `sync.Map` for a single value

```go
var settings sync.Map
settings.Store("config", currentConfig)

func GetConfig() *Config {
    v, _ := settings.Load("config")
    return v.(*Config)
}
```

**What is wrong?**

You are using a concurrent map to store one entry. That is `atomic.Pointer[Config]` with extra steps and worse performance.

**Fix**:

```go
var settings atomic.Pointer[Config]
func GetConfig() *Config { return settings.Load() }
func SetConfig(c *Config) { settings.Store(c) }
```

Faster, simpler, type-safe.

---

## Bug 22 — Iterating to clear

```go
func Clear(m *sync.Map) {
    m.Range(func(k, _ any) bool {
        m.Delete(k)
        return true
    })
}
```

**What is wrong?**

This *mostly* works, but concurrent writers can race with the delete (their write may happen between your visit and your delete, and you erase their update). Also, the documentation does not guarantee that modifying the map during `Range` clears it.

**Fix**: replace the entire map:

```go
type Store struct {
    m atomic.Pointer[sync.Map]
}
func (s *Store) Clear() {
    s.m.Store(&sync.Map{})
}
```

Or, if you cannot replace the variable (e.g., it is embedded), use an external `RWMutex` and lock during clear:

```go
type Store struct {
    mu sync.RWMutex
    m  *sync.Map
}
func (s *Store) Clear() {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.m = &sync.Map{}
}
```

---

## Bug 23 — Storing per-shard sync.Maps without amortising lookup

```go
const N = 64
var shards [N]sync.Map

func Set(k string, v any) {
    h := fnv32(k)
    shards[h%N].Store(k, v)
}
```

The idea is to reduce contention. **What is wrong?**

`sync.Map`'s contention is internal to each instance. By sharding, you have 64 `sync.Map` instances, each with its own slow path. You are paying the `sync.Map` overhead 64 times for no benefit.

**Fix**: shard a `RWMutex + map[K]V` instead. The `RWMutex` is the right primitive to shard; `sync.Map` is not.

```go
type shard struct {
    sync.RWMutex
    m map[string]any
}
var shards [N]shard
```

---

## Bug 24 — Storing a `sync.Map` value in another `sync.Map`

```go
var groups sync.Map // map[string]sync.Map ?? no — map[string]*sync.Map

func AddTo(group, key string, v any) {
    inner, _ := groups.LoadOrStore(group, sync.Map{}) // BUG
    inner.(sync.Map).Store(key, v)                    // BUG
}
```

**What is wrong?**

`sync.Map{}` is a value. `LoadOrStore` stores the value (copies it). Every load returns a fresh copy of the empty map. The `Store` happens on the copy and is discarded.

**Fix**: use pointers:

```go
func AddTo(group, key string, v any) {
    inner, _ := groups.LoadOrStore(group, &sync.Map{})
    inner.(*sync.Map).Store(key, v)
}
```

Now all loads return the same `*sync.Map` and stores are visible across goroutines.

---

## Bug 25 — `CompareAndSwap` on a missing key

```go
var counters sync.Map

func Inc(key string) {
    for {
        v, _ := counters.Load(key)
        if counters.CompareAndSwap(key, v, v.(int)+1) {
            return
        }
    }
}
```

**What is wrong?**

If the key is missing, `Load` returns `(nil, false)`. The type assertion `v.(int)` panics with "interface conversion: interface is nil, not int."

Even with comma-ok, `CompareAndSwap` would not insert anyway — it returns `false` for absent keys.

**Fix**: `LoadOrStore(key, 0)` first:

```go
func Inc(key string) {
    for {
        v, _ := counters.LoadOrStore(key, 0)
        if counters.CompareAndSwap(key, v, v.(int)+1) {
            return
        }
    }
}
```

`LoadOrStore` guarantees the key is present with at least `0`. The subsequent CAS can then safely operate.
