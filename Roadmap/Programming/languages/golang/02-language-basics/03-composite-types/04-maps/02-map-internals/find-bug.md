# Map Internals — Find the Bug

> Author: Bakhodir Yashin Mansur

Ten realistic broken snippets. Each has a symptom, a root cause anchored in map internals, and a fix. Read them in order — every fix depends on understanding one or two layers from [middle.md](middle.md) and [senior.md](senior.md).

---

## Bug 1: Concurrent map writes in a request handler

```go
package main

import (
    "log"
    "net/http"
)

var hits = map[string]int{}

func handler(w http.ResponseWriter, r *http.Request) {
    hits[r.URL.Path]++
    w.WriteHeader(204)
}

func main() {
    http.HandleFunc("/", handler)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

**Symptom.** Under modest load (a few hundred RPS), the server crashes with `fatal error: concurrent map writes`. The crash is not a panic — `recover()` will not help.

**Cause.** `hits` is touched by every incoming request, and `net/http` serves each request on its own goroutine. Two goroutines hitting `hits[r.URL.Path]++` simultaneously race the `hashWriting` bit-check inside `mapassign`. The runtime detects the conflict (sometimes) and calls `throw`. When it doesn't detect, you get silent corruption.

**Fix.** Add synchronization. For high write churn, a sharded counter is best; for moderate load, `sync.RWMutex`:

```go
var (
    mu   sync.RWMutex
    hits = map[string]int{}
)

func handler(w http.ResponseWriter, r *http.Request) {
    mu.Lock()
    hits[r.URL.Path]++
    mu.Unlock()
    w.WriteHeader(204)
}
```

For a top-N URL pattern with thousands of distinct paths and high write rate, prefer a sharded map or `sync/atomic` counters in a stable lookup table.

---

## Bug 2: Mutating a slice key by accident

```go
package main

import "fmt"

func main() {
    keys := [][3]int{{1, 2, 3}, {4, 5, 6}}
    m := map[[3]int]string{}

    for i, k := range keys {
        m[k] = fmt.Sprintf("entry-%d", i)
    }

    // Try to look up the first key, but with a mutated reused buffer.
    var buf [3]int
    for j := range buf { buf[j] = keys[0][j] }
    buf[0] = 99
    fmt.Println(m[buf])           // expected: empty (different key)
    buf[0] = 1
    fmt.Println(m[buf])           // expected: entry-0
}
```

This snippet is fine because Go arrays are value types. But change `[3]int` to a slice header and the program breaks. The instructive *bug* is in the next variant — read on.

### Variant: using a slice value as a key (compile error)

```go
m := map[[]int]string{} // does not compile: invalid map key type []int
```

**Why.** Slices are not comparable, so they cannot be map keys. The Go spec explicitly forbids this.

**Fix.** Convert slice to a string (`string(buf)` for `[]byte`, or `strings.Join` for `[]string`) and use that as the key. Or use a fixed-size array.

### Real variant: pointer-to-array as a key

```go
m := map[*[3]int]string{}

a := [3]int{1, 2, 3}
m[&a] = "first"
a[0] = 99
fmt.Println(m[&a])  // "first" — pointer identity, not value identity
```

The map keys on the *pointer*, not the array contents. Mutating the array doesn't change the lookup result. This is sometimes wanted, often a bug. Switch to `[3]int` as the key (value semantics) when you need value identity.

---

## Bug 3: Retained pointers preventing GC

```go
package main

type Session struct {
    ID    string
    State [4096]byte
}

var sessions = map[string]*Session{}

func login(id string) {
    s := &Session{ID: id}
    sessions[id] = s
}

func logout(id string) {
    sessions[id] = nil   // <-- bug
}
```

**Symptom.** Memory grows steadily. `pprof -inuse_space` shows millions of `*Session` allocations long after the corresponding users logged out.

**Cause.** Setting the map value to `nil` clears the *pointer* but leaves the *map entry* alive. The map still holds a slot for key `id`; `len(sessions)` keeps growing. Worse, the bucket array eventually grows to accommodate millions of stale-key entries even though every value is `nil`.

**Fix.** Use `delete(sessions, id)`. The runtime then frees the value-pointer reference and lets GC collect the `Session`.

```go
func logout(id string) {
    delete(sessions, id)
}
```

A subtler version: the map value is a struct containing pointers, and the code zeros some fields but never deletes. The map entry stays, the struct stays, only the inner fields are nil. Same fix.

---

## Bug 4: Modify-during-range with assumptions about visit order

```go
package main

func main() {
    m := map[int]int{}
    for i := 0; i < 100; i++ { m[i] = i }

    // Delete all even keys and replace them with squared values.
    for k, v := range m {
        if k%2 == 0 {
            delete(m, k)
            m[k+1000] = v * v
        }
    }
    // The author assumed they would visit each old key once and end up with 50 squared values.
    // Actually: the squared values may also be iterated and re-deleted/inserted unpredictably.
}
```

**Symptom.** The final map is not what the author expected. Sometimes there are 100 entries, sometimes 73, sometimes 142. The behavior depends on iteration order and grow timing.

**Cause.** Per the Go spec, "If a map entry is created during iteration, that entry may be produced during the iteration or may be skipped." The `m[k+1000] = v * v` insertion may land in a bucket the iterator hasn't visited yet — in which case the new entry is seen by the loop, and `k+1000` is even (since `k` was even), so it gets deleted and replaced with `(k+1000+1000) = k+2000`. The cycle continues.

**Fix.** Iterate over a snapshot:

```go
type pair struct{ k, v int }
var snap []pair
for k, v := range m { snap = append(snap, pair{k, v}) }
for _, p := range snap {
    if p.k%2 == 0 {
        delete(m, p.k)
        m[p.k+1000] = p.v * p.v
    }
}
```

Or build a separate result map and swap at the end. Never mutate the map you are ranging over unless the mutation is `delete` of the *current* key and you accept the spec's loose guarantees.

---

## Bug 5: NaN keys you can never look up

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    cache := map[float64]string{}
    cache[1.0] = "one"
    cache[math.NaN()] = "not a number"
    cache[math.NaN()] = "also not"

    fmt.Println(cache[math.NaN()])  // ""
    fmt.Println(len(cache))         // 3 — the two NaNs are distinct slots
}
```

**Symptom.** You can `Store` NaN keys but never `Get` them by key. They show up in `for range`, but every value is unreachable. The map grows without bound if you insert many NaNs.

**Cause.** `math.NaN() != math.NaN()` by IEEE 754. The map computes a hash and walks slots looking for a matching key via `t.key.equal` — which is `==`, which is always false for NaN. So every NaN insert lands in a new slot, and no NaN lookup ever matches.

**Fix.** Filter or remap before inserting:

```go
func keyOf(f float64) float64 {
    if math.IsNaN(f) { return math.MaxFloat64 } // or reject the input outright
    return f
}
cache[keyOf(x)] = v
```

If you cannot avoid floats as keys, consider an integer ID derived from the float's representation:

```go
key := math.Float64bits(f)
```

`Float64bits(NaN())` is at least *some* uint64, and identical NaNs map to identical bits — though different NaN representations still hash differently.

---

## Bug 6: A package-level "global cache" that occasionally has stale entries

```go
package config

var lookup = map[string]string{}

func Set(k, v string) {
    lookup[k] = v
}

func Get(k string) string {
    return lookup[k]
}
```

**Symptom.** Inconsistent reads. Sometimes `Get` returns the value set milliseconds earlier, sometimes the empty string. Occasionally the program crashes with `fatal error: concurrent map writes`.

**Cause.** Same as Bug 1 — no synchronization. Without a happens-before edge between `Set` and `Get`, the reader is not guaranteed to see the write. Even with the write committed, two writers can corrupt the map. The crash is the *good* outcome; the stale read is the silent bad outcome.

**Fix.** Wrap with `sync.RWMutex`:

```go
var (
    mu     sync.RWMutex
    lookup = map[string]string{}
)

func Set(k, v string) {
    mu.Lock()
    lookup[k] = v
    mu.Unlock()
}

func Get(k string) string {
    mu.RLock()
    v := lookup[k]
    mu.RUnlock()
    return v
}
```

For a write-once-read-many config pattern, `sync.Map` is also viable — see [professional.md](professional.md) §3.2.

---

## Bug 7: Iteration over a map while another goroutine writes

```go
package main

import (
    "sync"
    "time"
)

func main() {
    var mu sync.Mutex
    m := map[int]int{}
    for i := 0; i < 1000; i++ { m[i] = i }

    go func() {
        for {
            mu.Lock()
            m[time.Now().Nanosecond()] = 1
            mu.Unlock()
        }
    }()

    // Reader iterates without holding the lock.
    for k, v := range m {
        _ = k; _ = v
    }
}
```

**Symptom.** `fatal error: concurrent map iteration and map write`.

**Cause.** `mapiternext` checks `hashWriting` and throws if it sees a write in progress. Even though the writer holds `mu`, the reader does not, so the runtime sees a race. The lock was acquired by the wrong party.

**Fix.** Hold the lock for the whole iteration:

```go
mu.Lock()
for k, v := range m { _ = k; _ = v }
mu.Unlock()
```

Or, for a long iteration where holding the writer-lock is unacceptable, copy keys under the lock and iterate the copy:

```go
mu.Lock()
keys := make([]int, 0, len(m))
for k := range m { keys = append(keys, k) }
mu.Unlock()
for _, k := range keys {
    mu.RLock()
    v := m[k]
    mu.RUnlock()
    _ = v
}
```

---

## Bug 8: Misunderstanding `m[k]` on a missing key

```go
package main

import "fmt"

func main() {
    counts := map[string][]int{}
    counts["a"] = append(counts["a"], 1)
    counts["a"] = append(counts["a"], 2)

    fmt.Println(counts["a"])  // [1 2] — works

    // Now an alternative that "looks similar":
    counts2 := map[string][]int{}
    s := counts2["b"]
    s = append(s, 1)
    s = append(s, 2)
    fmt.Println(counts2["b"])  // [] — bug: the map never got the appended slice
}
```

**Symptom.** A counter pattern silently drops entries when written via a local variable instead of the map slot.

**Cause.** `counts2["b"]` returns a *copy* of the slice header (zero-value `nil`). Appending to `s` does not update the map. Map values are not addressable — you cannot have `*[]int` into the bucket — so you must always write back via `m[k] = ...`.

**Fix.** Write back to the map:

```go
counts2["b"] = append(counts2["b"], 1)
counts2["b"] = append(counts2["b"], 2)
```

For pointer-valued maps (`map[string]*Counter`), the deref works inline because `m[k]` is a pointer.

---

## Bug 9: Cached `mapassign` pointer across a grow

This bug is unusual in pure Go but trivial to write with `unsafe`. It's also a classic foot-gun in language-internals demos.

```go
package main

import (
    "fmt"
    "unsafe"
)

//go:linkname mapassign runtime.mapassign
func mapassign(t unsafe.Pointer, h unsafe.Pointer, key unsafe.Pointer) unsafe.Pointer

// ... wiring omitted for brevity; pretend we have a way to call mapassign and stash the
// returned pointer.

func main() {
    m := make(map[int]int)
    ptr := /* mapassign returns &slot for key 1 */ unsafe.Pointer(nil)
    *(*int)(ptr) = 1
    m[1] = 1

    // Now insert enough keys to trigger a grow.
    for i := 2; i < 1_000_000; i++ { m[i] = i }

    // The previously-stashed pointer is now pointing into the OLD bucket array,
    // which is being evacuated. Writing through it may overwrite arbitrary memory.
    *(*int)(ptr) = 999
    fmt.Println(m[1])  // 1 — the new bucket array has 1; we just trashed the old one
}
```

**Symptom.** Heap corruption that surfaces seconds or minutes later as a crash with no obvious cause.

**Cause.** The compiler is allowed to assume that the slot pointer returned by `mapassign` is used immediately for the assignment and not retained. Once a grow happens, the old bucket may be deallocated or re-used; pointers into it become dangling. The compiler does not emit retention; you must not stash these pointers.

**Fix.** Never cache map-slot pointers across operations. The compiler's `m[k] = v` rewrite is the only safe pattern. If you need persistent pointers to data, store `*V` in the map and let the caller hold the pointer.

The same problem can arise in pure Go via `unsafe.Pointer(&m[k])` if it ever compiled — but it doesn't, because map values are not addressable. The non-addressability rule is precisely what prevents this bug.

---

## Bug 10: GC pressure from `map[string][]byte` with large values

```go
package main

type Cache struct {
    mu sync.RWMutex
    m  map[string][]byte
}

func (c *Cache) Put(k string, v []byte) {
    c.mu.Lock(); defer c.mu.Unlock()
    c.m[k] = v
}

func (c *Cache) Get(k string) []byte {
    c.mu.RLock(); defer c.mu.RUnlock()
    return c.m[k]
}
```

**Symptom.** GC pauses creep from 1 ms to 50 ms as the cache fills with several million entries. Tail latency degrades. Throughput is fine; but p99 latency drops noticeably.

**Cause.** GC scans every bucket and overflow bucket. Each value is `[]byte` (a slice header with a pointer to the data). The runtime must visit the pointer in every slot — and, because the bucket array is sparse (load factor 6.5), it also visits empty pointer slots (cheap but not free).

**Fix.** Store the byte data in a single contiguous arena indexed by integer offsets; keep the map as `map[string]int`:

```go
type Cache struct {
    mu     sync.RWMutex
    index  map[string]int    // key -> offset into data
    lens   map[string]int    // key -> length
    data   []byte            // arena
}

func (c *Cache) Put(k string, v []byte) {
    c.mu.Lock(); defer c.mu.Unlock()
    off := len(c.data)
    c.data = append(c.data, v...)
    c.index[k] = off
    c.lens[k] = len(v)
}

func (c *Cache) Get(k string) []byte {
    c.mu.RLock(); defer c.mu.RUnlock()
    off, ok := c.index[k]
    if !ok { return nil }
    return c.data[off : off+c.lens[k]]
}
```

GC now scans the `index` and `lens` maps (one string pointer + one int per entry) and one slice of bytes (no pointers inside). Pause times drop back to single-digit ms even at tens of millions of entries.

Production libraries that take this further: [bigcache](https://github.com/allegro/bigcache), [freecache](https://github.com/coocood/freecache).

---

## Bug 11: Forgetting that a 256-byte struct key takes the indirect path

```go
package main

type bigKey struct {
    payload [256]byte
}

func main() {
    m := map[bigKey]int{}
    var k bigKey
    for i := 0; i < 1_000_000; i++ {
        k.payload[0] = byte(i)
        m[k] = i
    }
}
```

**Symptom.** Memory and CPU are much higher than expected for a "simple" million-key map. `pprof -alloc_objects` shows millions of small allocations from `mapassign`.

**Cause.** `bigKey` exceeds `maxKeySize = 128`. The runtime sets `indirectkey` on the maptype, which means each slot holds `*bigKey`, not `bigKey` inline. Every insert allocates a separate heap object for the key. The bucket array is small, but the per-entry allocation cost is real.

**Fix.** If you can shrink the key, do so:

```go
type smallKey [16]byte
```

If not, consider hashing the key yourself and using `map[uint64]Value`:

```go
m := map[uint64]int{}
m[hashKey(k)] = i
```

Watch out for hash collisions — if collisions are possible, store a slice of values per hash, or use a more rigorous keying scheme.

---

## Bug 12: Reading from a map immediately after `make`, expecting an error

```go
package main

import "fmt"

func main() {
    var m map[string]int
    fmt.Println(m["x"])     // 0 — fine
    fmt.Println(len(m))     // 0 — fine

    m["x"] = 1              // panic: assignment to entry in nil map
}
```

**Symptom.** Code that read from a nil map works for years; the first write crashes with `assignment to entry in nil map`.

**Cause.** A nil map is a valid read target (returns zero values) but not a valid write target. The runtime checks this in `mapassign` and panics.

**Fix.** Initialise with `make` before any write:

```go
m := make(map[string]int)
m["x"] = 1
```

Or use a composite literal:

```go
m := map[string]int{}
m["x"] = 1
```

Common in code that has a "lazy init" pattern:

```go
func (s *Server) inc(k string) {
    if s.counts == nil { s.counts = map[string]int{} }
    s.counts[k]++
}
```

If `inc` is called concurrently, the nil check is also a race — wrap in `sync.Once`, or initialise at construction time.

---

## Summary

Most map bugs collapse to one of three families:

1. **Concurrency**: writes without sync (`fatal: concurrent map writes`), or reads during writes.
2. **Mis-modeled value semantics**: forgetting that `m[k]` returns a copy, slot pointers don't survive, NaN keys are unreachable, slices/maps can't be keys.
3. **Memory shape**: never-shrinking after delete, GC scan cost on pointer-rich values, indirect key/value paths for large types.

When debugging a map issue, run with `-race` first, then `pprof` second, then read the bucket-level details in [senior.md](senior.md).

---

## Further reading

- `runtime/map.go`: https://github.com/golang/go/blob/master/src/runtime/map.go
- Go spec on map types: https://go.dev/ref/spec#Map_types
- `-race` detector: https://go.dev/blog/race-detector
- `pprof`: https://go.dev/blog/pprof
- `bigcache` design notes: https://blog.allegro.tech/2016/03/writing-fast-cache-service-in-go.html
