---
layout: default
title: Cache Coherence — Find the Bug
parent: Cache Coherence
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/04-cache-coherence/find-bug/
---

# Cache Coherence — Find the Bug

A set of code snippets each containing a cache-coherence performance bug. Identify the issue and propose a fix.

---

## Bug 1

```go
type Stats struct {
    Requests int64
    Errors   int64
}

var s Stats

func RecordSuccess() { atomic.AddInt64(&s.Requests, 1) }
func RecordError()   {
    atomic.AddInt64(&s.Requests, 1)
    atomic.AddInt64(&s.Errors, 1)
}
```

**What's wrong:** Requests and Errors share a cache line (16 bytes apart at most). Concurrent calls from many cores cause false sharing.

**Fix:** Pad between the fields:

```go
type Stats struct {
    Requests int64
    _        [56]byte
    Errors   int64
    _        [56]byte
}
```

---

## Bug 2

```go
var counter atomic.Int64

func bump() { counter.Add(1) }
```

Called from 64 goroutines simultaneously.

**What's wrong:** Single contended atomic. The line bounces among 64 cores. Throughput plateaus.

**Fix:** Per-CPU sharded counter:

```go
type Counter struct {
    shards []paddedInt64
}

type paddedInt64 struct {
    v atomic.Int64
    _ [56]byte
}
```

---

## Bug 3

```go
type Cache struct {
    mu   sync.Mutex
    data map[string]Value
    hits int64
    misses int64
}
```

**What's wrong:** `hits` and `misses` are mutated atomically (typically), but they share a line with `data` (the map header) and `mu`. Every map operation invalidates the counters' line; every counter increment invalidates the mutex's line.

**Fix:** Split hot fields from cold:

```go
type Cache struct {
    hits     atomic.Int64
    _        [56]byte
    misses   atomic.Int64
    _        [56]byte
    mu       sync.Mutex
    data     map[string]Value
}
```

---

## Bug 4

```go
type Locks [8]sync.Mutex
```

**What's wrong:** 8 mutexes × 8 bytes each = 64 bytes. All 8 mutexes on a single cache line. Locking any one invalidates the others.

**Fix:**

```go
type Locks [8]struct {
    mu sync.Mutex
    _  [56]byte
}
```

---

## Bug 5

```go
type Job struct {
    done atomic.Bool
    data [200]byte
}

// Many goroutines read data; one sets done.
```

**What's wrong:** `done` and `data` share a line. Every Set(done) invalidates the line for readers of `data`. Even though `data` is read-only after job creation, readers see invalidations.

**Fix:** Move `done` to its own line:

```go
type Job struct {
    done atomic.Bool
    _    [63]byte
    data [200]byte
}
```

---

## Bug 6

```go
func bump() {
    pid := getGoroutineID() // not a real function; pretend it exists
    counters[pid%len(counters)].v.Add(1)
}
```

Where `counters` is a `[]struct{ v atomic.Int64 }` (no padding).

**What's wrong:** Sharded, but adjacent counters share lines. Two goroutines hashing to adjacent indices still false-share.

**Fix:** Pad each slot:

```go
type slot struct { v atomic.Int64; _ [56]byte }
counters := make([]slot, n)
```

---

## Bug 7

```go
var ch = make(chan Job, 1000)

// 64 worker goroutines all receive from ch.
```

**What's wrong:** The channel's hchan struct is hot. All 64 workers contend on its internal state.

**Fix:** Shard the channel:

```go
const N = 8
chans := make([]chan Job, N)
for i := range chans { chans[i] = make(chan Job, 1000) }
// Workers split among chans.
```

---

## Bug 8

```go
var mu sync.RWMutex
var x int

func get() int {
    mu.RLock()
    defer mu.RUnlock()
    return x
}
```

Called from 64 goroutines, x is updated rarely.

**What's wrong:** RWMutex's reader counter is mutated on every RLock. The reader counter's line bounces among 64 cores. Reads serialise on coherence, not on writes.

**Fix:** Use atomic.Int snapshot:

```go
var x atomic.Int64

func get() int64 { return x.Load() }
```

If x is more complex, use atomic.Pointer to an immutable snapshot.

---

## Bug 9

```go
type Resource struct {
    refs int64
    data []byte
}

func (r *Resource) Acquire() { atomic.AddInt64(&r.refs, 1) }
func (r *Resource) Release() {
    if atomic.AddInt64(&r.refs, -1) == 0 {
        cleanup(r)
    }
}
```

Called from many goroutines.

**What's wrong:** `refs` is contended; the line bounces. Also, `refs` likely shares a line with `data` (the slice header), so every refcount op invalidates `data`'s header for readers.

**Fix:** Pad refs to its own line:

```go
type Resource struct {
    refs atomic.Int64
    _    [56]byte
    data []byte
}
```

For very high contention, consider biased reference counting (out of scope).

---

## Bug 10

```go
var config struct {
    Enabled bool
    Timeout time.Duration
    MaxConn int
}

func reload(c struct{...}) { config = c }
```

**What's wrong:** Multiple fields written non-atomically; readers may see torn state. Also, config's fields likely fit in one or two lines; concurrent reads + occasional writes cause unnecessary coherence traffic.

**Fix:** Snapshot pointer:

```go
var config atomic.Pointer[Config]
// readers: config.Load()
// writer: config.Store(newConfig)
```

---

## Bug 11

```go
type Worker struct {
    done atomic.Bool
    out  chan Result
}

workers := make([]Worker, 64)
```

**What's wrong:** Workers in the array share cache lines. Setting one worker's done invalidates adjacent workers' lines.

**Fix:** Pad each Worker:

```go
type Worker struct {
    done atomic.Bool
    out  chan Result
    _    [55]byte
}
```

Note: `chan` is a pointer (8 bytes); total for fields ~9 bytes; pad to 64.

---

## Bug 12

```go
type Counter struct {
    value int32
    _     [60]byte
}
```

Used on a 32-bit ARM platform.

**What's wrong:** `int32` is 4 bytes; padding makes total 64. But on 32-bit ARM, `atomic` on `int32` is fine, but the surrounding struct alignment may put `value` at a 4-byte (not 8-byte) boundary, which is OK for 32-bit atomics but suspicious. More importantly: the padding is correct, but if this struct lives in an array, the start of each element may not be cache-line-aligned.

**Fix:** Ensure the array of structs is cache-line aligned (via `//go:align 64` on the outer container).

---

## Bug 13

```go
var counter int64
go func() { for { counter++ } }()
go func() { for { fmt.Println(atomic.LoadInt64(&counter)) } }()
```

**What's wrong:** Writer uses `++` (not atomic); reader uses `atomic.LoadInt64`. This is a data race. The race detector will catch it.

**Fix:** Use atomic operations on both sides:

```go
go func() { for { atomic.AddInt64(&counter, 1) } }()
```

This is a correctness bug, not just a coherence one.

---

## Bug 14

```go
type Server struct {
    handlers map[string]http.HandlerFunc
    mu       sync.RWMutex
}

func (s *Server) AddHandler(path string, h http.HandlerFunc) {
    s.mu.Lock()
    s.handlers[path] = h
    s.mu.Unlock()
}

func (s *Server) Lookup(path string) http.HandlerFunc {
    s.mu.RLock()
    h := s.handlers[path]
    s.mu.RUnlock()
    return h
}
```

For a high-throughput service with rare AddHandler.

**What's wrong:** Lookup is hot; RLock cost is wasted. The map header line also bounces between readers and writer.

**Fix:** Snapshot pattern:

```go
type Server struct {
    handlers atomic.Pointer[map[string]http.HandlerFunc]
    mu       sync.Mutex // for writers
}

func (s *Server) Lookup(path string) http.HandlerFunc {
    return (*s.handlers.Load())[path]
}
```

---

## Bug 15

```go
type RingBuffer struct {
    write uint64
    read  uint64
    buf   [N]Item
}
```

**What's wrong:** write and read share a cache line. Producer (writing write, reading read) and consumer (writing read, reading write) bounce the line.

**Fix:**

```go
type RingBuffer struct {
    write atomic.Uint64
    _     [56]byte
    read  atomic.Uint64
    _     [56]byte
    buf   [N]Item
}
```

For maximum performance, also cache the other side's index per side.

---

## Bug 16

```go
type Counter struct {
    v atomic.Int64
}

var counters [1024]Counter
```

**What's wrong:** `Counter` is 8 bytes (plus alignment). 8 counters fit in a cache line. Adjacent indexes false-share.

**Fix:**

```go
type Counter struct {
    v atomic.Int64
    _ [56]byte
}
```

Now each Counter is 64 bytes; one per cache line.

---

## Bug 17

```go
type Stat struct {
    Count int64
    Name  string
}

stats := []Stat{...}
```

Stat is 24 bytes (8 + 16). 2-3 Stats per cache line.

**What's wrong:** Concurrent Count updates on adjacent Stats false-share.

**Fix:** Pad:

```go
type Stat struct {
    Count int64
    Name  string
    _     [40]byte
}
```

Now each Stat is 64 bytes; one per line.

---

## Bug 18

```go
type Worker struct {
    JobsDone atomic.Int64
    Mu       sync.Mutex
    queue    []Job
}
```

Multiple workers each update their own JobsDone; one supervisor reads them all and acquires Mu to extend the queue.

**What's wrong:** JobsDone and Mu are on the same line (probably). Every Done increment invalidates Mu's line; every Lock invalidates JobsDone's line.

**Fix:** Pad between:

```go
type Worker struct {
    JobsDone atomic.Int64
    _        [56]byte
    Mu       sync.Mutex
    queue    []Job
}
```

---

## Bug 19

```go
var startupTime = time.Now()

func uptime() time.Duration { return time.Since(startupTime) }
```

Called frequently (e.g., per request for telemetry).

**What's wrong:** `time.Since` calls `time.Now()`, which on some platforms reads a shared timer page. In a hot loop across cores, this is a coherence event per call.

**Fix:** Cache the time per worker or per second:

```go
type cachedTime struct {
    cached atomic.Int64
}

go func() {
    for {
        time.Sleep(1 * time.Second)
        c.cached.Store(time.Now().Unix())
    }
}()
```

Trade granularity for speed.

---

## Bug 20

```go
type Pool struct {
    items []*Item
    mu    sync.Mutex
}

func (p *Pool) Get() *Item {
    p.mu.Lock()
    defer p.mu.Unlock()
    if len(p.items) > 0 {
        it := p.items[len(p.items)-1]
        p.items = p.items[:len(p.items)-1]
        return it
    }
    return new(Item)
}
```

**What's wrong:** Global mutex serialises all Gets. The mu line bounces.

**Fix:** Use `sync.Pool` from the standard library — already per-P sharded with padding.

---

## Summary

Twenty bugs. Each is a real pattern you will encounter. The fixes share a common shape: pad to isolate, shard to distribute, snapshot to publish.

End of find-bug.md.
