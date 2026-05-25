# Map Internals — Tasks

> Author: Bakhodir Yashin Mansur

Hands-on exercises that build intuition for the runtime's hashmap. Each task starts with the goal, ends with a verification step, and points back to the relevant file in this directory.

---

## Task 1 — Observe iteration order randomness

**Goal.** Confirm that map iteration order is randomized per range, per map, and per process.

**Steps.**

1. Create a `map[int]struct{}{}` with keys 1..10.
2. Print the iteration order three times in the same process.
3. Run the program three times.
4. Compare orders.

```go
package main

import "fmt"

func main() {
    m := map[int]struct{}{}
    for i := 1; i <= 10; i++ { m[i] = struct{}{} }
    for run := 0; run < 3; run++ {
        fmt.Printf("run %d: ", run)
        for k := range m { fmt.Print(k, " ") }
        fmt.Println()
    }
}
```

**Verify.** All three runs within one process should differ from each other; running the program twice should also differ. If you ever see the same order twice, you have a bug or a very small map (try with 30 keys).

**Read.** [junior.md](junior.md) §6.

---

## Task 2 — Demonstrate value non-addressability

**Goal.** See the compiler error for `m[k].Field = v` and verify both workarounds.

**Steps.**

1. Define `type P struct{ X int }`.
2. Try `m["a"].X = 2` and observe the compile error.
3. Apply workaround A: copy-modify-write.
4. Apply workaround B: store `*P` instead of `P`.

```go
package main

type P struct{ X int }

func main() {
    m := map[string]P{"a": {}}
    // m["a"].X = 2 // uncomment: cannot assign to struct field m["a"].X in map

    // A
    v := m["a"]; v.X = 2; m["a"] = v

    // B
    m2 := map[string]*P{"a": {}}
    m2["a"].X = 2
}
```

**Verify.** The commented line refuses to compile; both workarounds run without complaint. Inspect with `go vet` to be sure.

**Read.** [junior.md](junior.md) §7.

---

## Task 3 — Trigger a doubling grow and time it

**Goal.** Build a map past its load-factor threshold and measure the per-operation cost.

**Steps.**

1. `make(map[int]int)` with no hint.
2. Insert keys 0..N-1 timing each insert with `time.Now()`.
3. Plot the timing — you should see occasional spikes when grows happen.
4. Repeat with `make(map[int]int, N)` and compare.

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    const N = 1_000_000
    times := make([]time.Duration, N)
    m := map[int]int{}
    for i := 0; i < N; i++ {
        s := time.Now()
        m[i] = i
        times[i] = time.Since(s)
    }
    // Print every 50_000th insert
    for i := 0; i < N; i += 50_000 {
        fmt.Printf("%7d: %v\n", i, times[i])
    }
}
```

**Verify.** Some indices around powers-of-two thresholds (`B` flipping) show a 10–50× cost compared with neighbours. With the pre-hint version, no such spikes exist.

**Read.** [middle.md](middle.md) §3–§5.

---

## Task 4 — Trigger a same-size grow

**Goal.** Cause `tooManyOverflowBuckets` to fire by inserting then deleting in a churn pattern.

**Steps.**

1. Fill a map with N keys.
2. Delete them all.
3. Re-insert N keys.
4. Repeat (2)–(3) many times.
5. After each cycle, force a GC and print `runtime.MemStats.HeapAlloc`.

The same-size grow should fire as overflow buckets accumulate; after each cycle the memory should *roughly* stabilise instead of growing without bound.

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    m := make(map[int]int, 100_000)
    var s runtime.MemStats
    for cycle := 0; cycle < 20; cycle++ {
        for i := 0; i < 100_000; i++ { m[i] = i }
        for k := range m { delete(m, k) }
        runtime.GC()
        runtime.ReadMemStats(&s)
        fmt.Printf("cycle %2d: heap = %d KB, mapcount = %d\n",
            cycle, s.HeapAlloc/1024, len(m))
    }
}
```

**Verify.** Memory grows for the first few cycles then plateaus. Without same-size grow it would keep climbing.

**Read.** [middle.md](middle.md) §4.

---

## Task 5 — Reproduce a concurrent-write fatal error

**Goal.** See `fatal error: concurrent map writes` and confirm `sync.RWMutex` prevents it.

**Steps.**

1. Two goroutines write to the same map in tight loops.
2. Run the program; it should die in milliseconds.
3. Wrap each write in `mu.Lock()` / `mu.Unlock()`.
4. Run again; it should run forever.

```go
package main

import "sync"

func main() {
    m := map[int]int{}
    go func() { for { m[1] = 1 } }()
    go func() { for { m[2] = 2 } }()
    select {}
}
```

**Verify.** The unsynced version crashes with `fatal error: concurrent map writes`. The synced version doesn't.

**Bonus.** Run the unsynced version with `-race` and compare the diagnostic: `-race` gives line numbers and stack traces; the bare `throw` gives just the fatal message.

**Read.** [junior.md](junior.md) §8, [middle.md](middle.md) §8.

---

## Task 6 — Build a sharded map

**Goal.** Implement a 256-shard map and benchmark it against `map + RWMutex` and `sync.Map` under contention.

**Steps.**

1. Implement `Sharded[V]` with 256 shards keyed on FNV-32 of the string key.
2. Implement the same operations with `sync.RWMutex` and `sync.Map`.
3. Use `testing.B` to drive 8 concurrent goroutines doing 1k Set/1k Get cycles.
4. Run with `-cpu=8` and compare ns/op.

```go
func BenchmarkSharded(b *testing.B) {
    m := NewSharded[string]()
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            i++
            k := fmt.Sprintf("k%d", i&1023)
            m.Set(k, "v")
            _, _ = m.Get(k)
        }
    })
}
```

**Verify.** Sharded should be 3–8× faster than RWMutex on a contended workload, comparable to or faster than `sync.Map` for hot-key reads with writes.

**Read.** [professional.md](professional.md) §3.6, [optimize.md](optimize.md) §6.

---

## Task 7 — Profile collision-heavy keys

**Goal.** Build a key type that hashes badly and observe the slowdown.

**Steps.**

1. Define `type bad [32]byte` and store random data in it for `N` keys.
2. Define `type alsoBad struct{ a, b [16]byte }` filled the same way.
3. Time lookups for both. Compare with `map[uint64]struct{}{}` of the same size.

```go
type bad [32]byte

func main() {
    const N = 1_000_000
    bm := make(map[bad]struct{}, N)
    keys := make([]bad, N)
    for i := range keys {
        rand.Read(keys[i][:])
        bm[keys[i]] = struct{}{}
    }
    s := time.Now()
    for _, k := range keys { _, _ = bm[k] }
    fmt.Println("bad lookups:", time.Since(s))

    im := make(map[uint64]struct{}, N)
    ikeys := make([]uint64, N)
    for i := range ikeys {
        ikeys[i] = rand.Uint64()
        im[ikeys[i]] = struct{}{}
    }
    s = time.Now()
    for _, k := range ikeys { _, _ = im[k] }
    fmt.Println("uint64 lookups:", time.Since(s))
}
```

**Verify.** The `uint64` map should be 2–3× faster — fast-path benefit and smaller key equality cost.

**Bonus.** Force collisions by using a custom struct key with a deterministic bad hash; observe lookups go from O(1) to O(N).

**Read.** [senior.md](senior.md) §9.

---

## Task 8 — Reproduce iteration anomalies during grow

**Goal.** See the iteration yield duplicates or skip entries when the map is mutated mid-iteration.

**Steps.**

1. Build a map with 64 entries.
2. In a single goroutine, start iterating with `for k, v := range m`.
3. Inside the loop, delete some keys and insert new ones.
4. Count how many distinct keys you saw and compare to the number of operations.

```go
package main

import "fmt"

func main() {
    m := map[int]int{}
    for i := 0; i < 64; i++ { m[i] = i }
    seen := map[int]int{}
    for k, v := range m {
        seen[k]++
        m[k+1000] = v   // insert during range
        delete(m, k+5)  // delete a key we may not have visited
    }
    dup := 0
    for _, n := range seen { if n > 1 { dup++ } }
    fmt.Println("duplicates yielded:", dup, "; total seen:", len(seen))
}
```

**Verify.** Run multiple times; you may see duplicates and missing keys. The spec permits both.

**Read.** [middle.md](middle.md) §9, [senior.md](senior.md) §10.

---

## Task 9 — Measure GC cost on pointer-rich maps

**Goal.** Show that `map[string]*Order` has higher GC scan cost than `map[string]int` of the same size.

**Steps.**

1. Build two maps with 1M entries. One has `*Order` values, the other has `int` indices into a parallel slice.
2. Force a few GCs (`runtime.GC()`) and time them with `runtime/trace` or `GODEBUG=gctrace=1`.
3. Compare wall-clock GC pause time.

```bash
GODEBUG=gctrace=1 go run ./cmd/big-map-pointer
GODEBUG=gctrace=1 go run ./cmd/big-map-index
```

**Verify.** The pointer-rich map's GC pauses are larger (often 3–10×). The index map's GC pauses stay close to a fresh process.

**Read.** [professional.md](professional.md) §5.

---

## Task 10 — Capacity hint sweep

**Goal.** Quantify the cost of missing a capacity hint at various scales.

**Steps.**

1. For N in `{1k, 10k, 100k, 1M, 10M}`, benchmark insert-N-keys with and without `make(map[K]V, N)`.
2. Report ms/op and B/op for each.

```go
func benchN(N int, hint bool) (ms float64, bytes uint64) {
    var s runtime.MemStats
    runtime.GC(); runtime.ReadMemStats(&s); before := s.HeapAlloc
    t := time.Now()
    var m map[int]int
    if hint { m = make(map[int]int, N) } else { m = map[int]int{} }
    for i := 0; i < N; i++ { m[i] = i }
    ms = float64(time.Since(t).Microseconds()) / 1000
    runtime.GC(); runtime.ReadMemStats(&s); bytes = s.HeapAlloc - before
    _ = m
    return
}
```

**Verify.** Time savings grow with N (1.4× at 10k, 1.8× at 1M). Memory difference is small.

**Read.** [optimize.md](optimize.md) §3.

---

## Task 11 — Demonstrate the shrink trick

**Goal.** Confirm that `delete` does not shrink and that allocating a new map does.

**Steps.**

1. Fill a 10M-entry `map[int]int`.
2. Measure `HeapAlloc`.
3. `delete` every entry.
4. Measure again — should be ~unchanged.
5. Allocate a new map and re-copy live entries (there are zero, so the new map is empty).
6. Measure again — should drop dramatically.

```go
func main() {
    m := make(map[int]int, 10_000_000)
    for i := 0; i < 10_000_000; i++ { m[i] = i }
    report(m, "filled")
    for k := range m { delete(m, k) }
    report(m, "drained")
    m = make(map[int]int)
    report(m, "fresh")
}
```

**Verify.** The drained map's memory is identical to the filled map. The fresh map's is near zero.

**Read.** [junior.md](junior.md) §9, [professional.md](professional.md) §4.

---

## Task 12 — Use unsafe to print bucket count

**Goal.** Reach into the `hmap` header to print `B` and `count`.

This is intentionally fragile — it depends on runtime layout. The point is to verify your mental model, not to ship the code.

```go
package main

import (
    "fmt"
    "unsafe"
)

type hmap struct {
    count     int
    flags     uint8
    B         uint8
    noverflow uint16
    hash0     uint32
    buckets    unsafe.Pointer
    oldbuckets unsafe.Pointer
    nevacuate  uintptr
    extra unsafe.Pointer
}

func peek(m any) (count int, B uint8) {
    h := *(**hmap)(unsafe.Pointer(&m))
    return h.count, h.B
}

func main() {
    m := make(map[int]int)
    for i := 0; i < 200; i++ { m[i] = i }
    n, b := peek(any(m))
    fmt.Println("count=", n, "B=", b, "buckets=", 1<<b)
}
```

**Verify.** With 200 entries and load factor 6.5, `B = 6` (64 buckets). The numbers may differ on the Swiss-table backend — that's the lesson: never rely on `unsafe` for runtime details.

**Read.** [specification.md](specification.md) §2.

---

## Summary

These twelve tasks cover layout, iteration, growth, concurrency, sharding, GC cost, and observability. Doing them in order builds the same mental model as reading the source. Skip ahead if a topic is already clear; revisit once you've read [senior.md](senior.md) for the source-level grounding.
