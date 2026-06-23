# sync.Map — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Internal Layout](#the-internal-layout)
3. [The Read/Dirty Split](#the-readdirty-split)
4. [The `expunged` Sentinel](#the-expunged-sentinel)
5. [The Fast Read Path](#the-fast-read-path)
6. [The Slow Path and Promotion](#the-slow-path-and-promotion)
7. [How `LoadOrStore` Avoids the Lock](#how-loadorstore-avoids-the-lock)
8. [How `Delete` Works](#how-delete-works)
9. [How Go 1.20 CAS Methods Fit In](#how-go-120-cas-methods-fit-in)
10. [Amplification and Memory Behaviour](#amplification-and-memory-behaviour)
11. [Why It Is Slow for Write-Heavy Workloads](#why-it-is-slow-for-write-heavy-workloads)
12. [Self-Assessment](#self-assessment)
13. [Summary](#summary)

---

## Introduction

To understand `sync.Map`'s performance profile — fast read-mostly, slow write-heavy, memory amplification under churn — you need to look inside. This file walks the implementation of `sync.Map` as of Go 1.22. The data structure is small (~250 lines) but dense; we will dissect it.

Source: `src/sync/map.go` in the Go repository. The discussion follows the actual code; quotes and field names are taken from there. By the end you should be able to predict, for any given access pattern, which path the runtime takes and what it costs.

---

## The Internal Layout

```go
type Map struct {
    mu Mutex

    // read is an atomic pointer to a readOnly struct.
    // Read operations consult it first without taking mu.
    read atomic.Pointer[readOnly]

    // dirty is a normal map, protected by mu. Holds entries
    // that are not yet promoted to read, including newly added keys.
    dirty map[any]*entry

    // misses counts how many Load operations had to fall back to dirty.
    // When misses exceeds len(dirty), dirty is promoted to read.
    misses int
}

type readOnly struct {
    m       map[any]*entry
    amended bool // true if dirty contains a key not in m
}

type entry struct {
    p atomic.Pointer[any] // *any: holds the value pointer
}
```

Key invariants:

1. The `read` map is read-only and accessed without `mu`. It is replaced atomically.
2. The `dirty` map is mutable and requires `mu`. It is *initialised lazily* — nil until needed.
3. Every entry that exists in `read` either exists in `dirty` (with the same `*entry` pointer) or `dirty` is nil. The `*entry` pointer is shared, so updates via one are visible via the other.
4. New keys go to `dirty` only.

The clever bit: a `Load` that finds a key in `read` never takes `mu`. The atomic pointer-load of `read` plus a map lookup is the entire hot path.

---

## The Read/Dirty Split

Think of `read` as the "fast path data" and `dirty` as the "slow path data."

- **read**: a snapshot of the map that does not need locking. Reads of keys present here are essentially free.
- **dirty**: a normal map under a mutex. New writes go here. When the slow path is hit often enough, dirty is promoted to read.

```
+--------------------+      atomic.Pointer       +--------------------+
|     sync.Map       |     ----------------->    |   readOnly         |
|                    |                           |   m   amended      |
|    mu    misses    |                           +--------------------+
|                    |
|    dirty (mu held) |
|    +------------+  |
|    |   map      |  |
|    +------------+  |
+--------------------+
```

The `readOnly.amended` flag is critical. It is `true` if `dirty` contains *any* key not in `m`. A `Load` that misses `read.m` checks `amended`: if `false`, the key truly does not exist (no need to take `mu`); if `true`, the slow path is required.

This means an unmodified `sync.Map` (no new keys since last promotion) gives zero-lock reads for both hits *and* misses. Adding a new key flips `amended` to `true`, and from then on misses cost a lock until the next promotion.

---

## The `expunged` Sentinel

A deletion problem: how do you delete a key from a read-only structure?

Answer: you do not. You leave the entry in place but mark its value pointer specially. There are three states for an `entry.p`:

1. A pointer to the actual stored value: alive.
2. `nil`: deleted from the read map, but still present in dirty (or dirty does not exist yet).
3. `expunged`: deleted *and* the entry was confirmed missing from dirty when dirty was rebuilt.

`expunged` is a package-level sentinel:

```go
var expunged = new(any)
```

Why three states? Because of the promotion protocol:

- Deleting an entry while it is still in dirty: set `e.p = nil`. Future loads see nil and treat it as "not found."
- Re-inserting a key with `p == nil`: just CAS the pointer back to the new value. Fast path stays in read.
- When dirty is rebuilt (on first new-key store after promotion), any `nil` entry in read that is *not* migrated to dirty is upgraded to `expunged`. An `expunged` entry can never be revived via the fast path — you must take `mu` and write through dirty.

```
entry.p state machine:

   alive(*v)  --Delete-->  nil  --rebuildDirty-->  expunged
        ^                   |
        |                   |
        +----Store----------+
        |                   |
        +-----LoadOrStore---+

   expunged --Store(with mu)--> alive(*v) (after re-adding to dirty)
```

This dance avoids two problems:

- Without `expunged`, a key in dirty being re-stored would always have to take `mu`, even if the read map still had the entry. With `expunged`, we know "the read entry is dead and we cannot ressurect it without the lock."
- Without `nil`, deletes would force a dirty rebuild for every removal. The `nil`-then-`expunged` two-step amortises the cost.

---

## The Fast Read Path

Pseudocode for `Load`:

```go
func (m *Map) Load(key any) (any, bool) {
    read := m.read.Load()
    e, ok := read.m[key]
    if !ok && read.amended {
        m.mu.Lock()
        // double-check after acquiring the lock
        read = m.read.Load()
        e, ok = read.m[key]
        if !ok && read.amended {
            e, ok = m.dirty[key]
            m.missLocked()
        }
        m.mu.Unlock()
    }
    if !ok {
        return nil, false
    }
    return e.load()
}
```

The hot path (key present in `read.m`):

1. Atomic load of the `read` pointer.
2. Map lookup. (Built-in map; very fast.)
3. Atomic load of the entry's value pointer.
4. Return.

No lock. No allocations. About 15–25 ns on modern hardware.

The slow path (key missing from `read` and `amended == true`):

1. Take `mu`.
2. Re-read `read` (it may have changed while we waited).
3. Look up in `read.m` again.
4. If still missing, look up in `dirty`.
5. Increment `misses`.
6. If `misses >= len(dirty)`, promote dirty to read.
7. Release `mu`.

This is much slower. The `missLocked` function is the promotion trigger.

---

## The Slow Path and Promotion

Promotion happens inside `missLocked`:

```go
func (m *Map) missLocked() {
    m.misses++
    if m.misses < len(m.dirty) {
        return
    }
    m.read.Store(&readOnly{m: m.dirty})
    m.dirty = nil
    m.misses = 0
}
```

When promotion fires:

- The dirty map becomes the new read map.
- The old read map is dropped (garbage collected).
- `dirty` is nilled. The next `Store` of a new key re-creates it.
- `misses` resets.

The trigger condition — `misses >= len(dirty)` — is heuristic. It means "we have taken the slow path enough times that the cost of one full rebuild equals the cost of more slow lookups." After promotion, all current keys are in `read`, so subsequent loads are fast again.

### Cost of promotion

Promotion is O(1) — it is a pointer swap. The cost is hidden in the *next* store of a new key, which rebuilds `dirty` by copying all non-expunged entries from `read`:

```go
func (m *Map) dirtyLocked() {
    if m.dirty != nil {
        return
    }
    read := m.read.Load()
    m.dirty = make(map[any]*entry, len(read.m))
    for k, e := range read.m {
        if !e.tryExpungeLocked() {
            m.dirty[k] = e
        }
    }
}

func (e *entry) tryExpungeLocked() bool {
    p := e.p.Load()
    for p == nil {
        if e.p.CompareAndSwap(nil, expunged) {
            return true
        }
        p = e.p.Load()
    }
    return p == expunged
}
```

This is O(n) where n is the read map size. For a 100 000-entry map, this rebuild can cost a millisecond. The first new-key write after a promotion pays.

---

## How `LoadOrStore` Avoids the Lock

The trickiest method. Pseudocode (simplified):

```go
func (m *Map) LoadOrStore(key, value any) (any, bool) {
    // Fast path: key already in read with a live value.
    read := m.read.Load()
    if e, ok := read.m[key]; ok {
        if actual, loaded, ok := e.tryLoadOrStore(value); ok {
            return actual, loaded
        }
    }

    m.mu.Lock()
    read = m.read.Load()
    if e, ok := read.m[key]; ok {
        if e.unexpungeLocked() {
            // was expunged; must re-add to dirty
            m.dirty[key] = e
        }
        actual, loaded, _ := e.tryLoadOrStore(value)
        m.mu.Unlock()
        return actual, loaded
    }
    if e, ok := m.dirty[key]; ok {
        actual, loaded, _ := e.tryLoadOrStore(value)
        m.missLocked()
        m.mu.Unlock()
        return actual, loaded
    }
    // Key is brand new.
    if !read.amended {
        // First new key — make dirty if needed and flip amended.
        m.dirtyLocked()
        m.read.Store(&readOnly{m: read.m, amended: true})
    }
    m.dirty[key] = newEntry(value)
    m.mu.Unlock()
    return value, false
}
```

`tryLoadOrStore` on the entry uses a CAS loop:

```go
func (e *entry) tryLoadOrStore(i any) (actual any, loaded, ok bool) {
    p := e.p.Load()
    if p == expunged {
        return nil, false, false // caller must take lock
    }
    if p != nil {
        return *(*any)(p), true, true // already has a value
    }
    ic := i
    for {
        if e.p.CompareAndSwap(nil, &ic) {
            return i, false, true // stored
        }
        p = e.p.Load()
        if p == expunged {
            return nil, false, false
        }
        if p != nil {
            return *(*any)(p), true, true
        }
    }
}
```

The fast path for an *existing* live entry is just a pointer load. The fast path for a `nil`-deleted entry is a CAS. Only `expunged` forces the lock. This is what makes `LoadOrStore` so cheap when keys are stable.

---

## How `Delete` Works

```go
func (m *Map) Delete(key any) {
    m.LoadAndDelete(key)
}

func (m *Map) LoadAndDelete(key any) (any, bool) {
    read := m.read.Load()
    e, ok := read.m[key]
    if !ok && read.amended {
        m.mu.Lock()
        read = m.read.Load()
        e, ok = read.m[key]
        if !ok && read.amended {
            e, ok = m.dirty[key]
            delete(m.dirty, key)
            m.missLocked()
        }
        m.mu.Unlock()
    }
    if ok {
        return e.delete()
    }
    return nil, false
}

func (e *entry) delete() (any, bool) {
    for {
        p := e.p.Load()
        if p == nil || p == expunged {
            return nil, false
        }
        if e.p.CompareAndSwap(p, nil) {
            return *(*any)(p), true
        }
    }
}
```

Deletion of a key in `read.m` is just a CAS from the value pointer to `nil`. No lock. The entry stays in `read.m` with `p == nil`. On the next dirty rebuild, it will be upgraded to `expunged` and not migrated.

Deletion of a key only in `dirty` (newly added since last promotion) takes the lock and removes the entry from `dirty`.

This is why deletes are cheap in the steady state but cause memory amplification: the deleted entry occupies a slot in `read.m` until the next rebuild.

---

## How Go 1.20 CAS Methods Fit In

`Swap`, `CompareAndSwap`, `CompareAndDelete` reuse the entry's atomic value pointer. They are largely fast-path: if the key is in `read.m` with a live value, the operation is a CAS on the entry's pointer, no lock.

```go
func (m *Map) CompareAndSwap(key, old, new any) bool {
    read := m.read.Load()
    if e, ok := read.m[key]; ok {
        return e.tryCompareAndSwap(old, new)
    }
    if !read.amended {
        return false
    }
    m.mu.Lock()
    defer m.mu.Unlock()
    // ... look in dirty, etc.
}

func (e *entry) tryCompareAndSwap(old, new any) bool {
    p := e.p.Load()
    if p == nil || p == expunged || *(*any)(p) != old {
        return false
    }
    nc := new
    for {
        if e.p.CompareAndSwap(p, &nc) {
            return true
        }
        p = e.p.Load()
        if p == nil || p == expunged || *(*any)(p) != old {
            return false
        }
    }
}
```

The CAS at the entry level operates on pointers, not on the user-visible values. The user's `==` semantics are checked via `*(*any)(p) != old`. If the underlying value type is non-comparable, that comparison panics — which is why the spec says `CompareAndSwap` panics on non-comparable values.

---

## Amplification and Memory Behaviour

Three things to understand:

### 1. Read map size only grows

The `read.m` is replaced wholesale on promotion. Between promotions, deleted entries are kept (with `p == nil` or `expunged`). The map shrinks only on promotion, when expunged entries are not migrated.

### 2. Dirty rebuild is O(n)

Every transition from `dirty == nil` to `dirty != nil` rebuilds dirty by walking all of `read.m`. For a 1M-entry map with 50% expunged, that is a 1M-entry copy plus 500k CAS operations.

### 3. High churn = repeated rebuild

If you constantly add new keys, dirty fills up, gets promoted, gets cleared, the next new key rebuilds it from the freshly-promoted `read`. Each rebuild copies the current read. For a steadily-growing map this is acceptable; for a high-churn map where keys come and go, the amortised cost climbs.

### Memory amplification factor

A `sync.Map` with N live entries and D deleted-but-not-rebuilt entries holds:

- The `read.m` map of N + D entries.
- The `dirty` map (if amended) holding at most N entries.
- The pointer indirection through `*entry` and `*any` for every entry.

In the worst case (just before a rebuild) memory usage is approximately 2× the equivalent `map[K]V` with N entries. The pointer overhead alone is ~32 bytes per entry on 64-bit systems.

---

## Why It Is Slow for Write-Heavy Workloads

Pulling it all together, write-heavy `sync.Map` underperforms because:

1. **Every store of a new key needs `mu`.** No fast path.
2. **The first new-key store after a promotion rebuilds dirty.** O(n).
3. **Every store of an `expunged` key needs `mu` plus re-insertion into dirty.**
4. **Every store boxes the value as an interface, allocating on the heap.** GC pressure.
5. **Every store must coordinate with concurrent loads on the same entry via CAS.** Cache-line contention on shared entries.

By contrast, `RWMutex+map` writes:

1. Take `mu.Lock()`.
2. Insert into a typed map (no boxing for typed `V`).
3. Release.

The mutex is the only contention point. For uniformly-distributed writes, throughput is `1 / lock_hold_time`. For a 100 ns hold time, that is 10M ops/s on a single lock — actually competitive with `sync.Map`. And the writes are amortised on a typed value, no boxing.

`sync.Map` wins for reads. It loses for writes. The fast-read-path design is non-negotiable: reads must be lock-free. Everything else is sacrificed.

---

## Self-Assessment

- [ ] I can sketch the `Map`, `readOnly`, and `entry` structs from memory.
- [ ] I can explain the three states of `entry.p`: alive, nil, expunged.
- [ ] I can describe the fast path for `Load` in one sentence.
- [ ] I can describe how `missLocked` triggers promotion.
- [ ] I can predict, for a given access pattern, whether the fast or slow path fires.
- [ ] I know why amplification happens after high churn.
- [ ] I can explain why write-heavy workloads underperform.
- [ ] I know how `Swap`, `CompareAndSwap`, `CompareAndDelete` reuse the entry pointer.
- [ ] I can read `src/sync/map.go` and follow the control flow.
- [ ] I can defend the claim "the read path is the only design constraint that mattered."

---

## Summary

`sync.Map` is two maps in a trench coat. The `read` map serves the fast lock-free path; the `dirty` map serves the slow lock-held path. The `expunged` sentinel and the three-state `entry.p` enable safe deletion without immediate rebuild. Promotion happens when slow-path misses pile up; it costs an O(n) rebuild paid at the next new-key store.

The design is uncompromisingly optimised for two access patterns: read-mostly with stable keys (the fast path dominates), and disjoint-key writes (no shared-entry contention). Outside those patterns, the slow path and rebuilds dominate, and a plain `RWMutex+map` wins.

The Go 1.20 CAS methods slot in cleanly: they operate on the entry pointer, reusing the fast path when the key is in `read`. They do not change the overall structure.

If you understand the read/dirty/expunged dance, you can predict `sync.Map`'s performance for any workload before measuring. And you can articulate, with technical authority, why the simple-sounding alternative — `RWMutex+map` — beats it everywhere except its narrow sweet spot.
